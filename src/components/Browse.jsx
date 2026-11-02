import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './Browse.css';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { Film, RefreshCw, ExternalLink, Download, Play, Check, X, Search, Copy, Edit3 } from './icons';
import { isSubmitKey, parseEpisodeRange } from './episodeRange';
import { rememberCatalogTitles } from '../searchHistory';
import { translateGenre } from './genreMap';
import { DramaTitle, DramaDescription } from './TranslatedText';
import { getCachedTranslation, saveCustomOverride, removeCustomOverride, getTranslationConfig, translateText } from '../services/translator';

const PAGE_CACHE_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 25_000;
const PAGE_CACHE_KEY = 'hongguo.catalog.page.v1';
const CATALOG_CHANNEL_KEY = 'hongguo.catalog.channel.v1';
const PAGE_CACHE_MAX = 8;
const PAGE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readPageCacheFile() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(PAGE_CACHE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - PAGE_CACHE_MAX_AGE_MS;
    return parsed.filter(entry => entry && typeof entry.key === 'string' && Array.isArray(entry.results)
      && Number(entry.savedAt) >= cutoff).slice(0, PAGE_CACHE_MAX);
  } catch (_) { return []; }
}

function readPersistedPage(key) {
  return readPageCacheFile().find(entry => entry.key === key) || null;
}

function writePersistedPage(key, page) {
  try {
    if (typeof localStorage === 'undefined') return;
    const entries = readPageCacheFile().filter(entry => entry.key !== key);
    entries.unshift({ key, ...page });
    localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(entries.slice(0, PAGE_CACHE_MAX)));
  } catch (_) { /* quota or disabled storage: memory cache still works */ }
}

/**
 * Browse —— Khám phá phim theo thể loại
 *
 * Luồng dữ liệu:
 *   Danh mục nguồn độc lập -> Thẻ (series_id/tên phim/ảnh bìa/số tập/thẻ)
 *   Nhấn thẻ -> Tái sử dụng search-resolve lấy toàn bộ tập và ghi vào hồ sơ phim
 *         -> Tái sử dụng get-series-episodes lấy trạng thái từng tập: đã tải/đang tải/chưa tải
 *         -> Nhảy sang trình phát hoặc tải hàng loạt
 */
function Browse({ onNavigate, active = true }) {
  const [source, setSource] = useState('hongguo');
  const [catalogChannel, setCatalogChannel] = useState(() => {
    try { return localStorage.getItem(CATALOG_CHANNEL_KEY) === 'web' ? 'web' : 'app'; }
    catch (_) { return 'app'; }
  });
  const appCatalog = source === 'hongguo' && catalogChannel === 'app';
  const { sources: mediaSources, revision: sourceRevision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('real-drama');
  const [genre, setGenre] = useState('');
  const [page, setPage] = useState(1);
  const [completion, setCompletion] = useState('all');

  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0, genres: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshNotice, setRefreshNotice] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');

  // Ngăn kéo chi tiết
  const [detail, setDetail] = useState(null); // { series_id, series_title, cover, episodes: [...] }
  const [detailLoading, setDetailLoading] = useState(false);
  const [rangeInput, setRangeInput] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const loadingRequest = useRef(0);
  const pageCache = useRef(new Map()).current;
  const discoveryPages = useRef(new Map()).current;
  const refreshFirstPage = useRef(false);
  const refreshToFirstPage = useRef(false);
  const viewRef = useRef({ source: '', category: '', channel: '', genre: '', page: 0 });
  const resultsRef = useRef(results);
  const listTimer = useRef(null);
  const toastTimer = useRef(null);
  resultsRef.current = results;

  const invalidateList = useCallback(() => {
    listRequest.current++;
    loadingRequest.current = 0;
    clearTimeout(listTimer.current);
    // A cleanup can invalidate a request without starting a replacement. Clear the
    // skeleton here; a subsequent loadList immediately claims the token and shows it again.
    setLoading(false);
  }, []);

  const cancelList = () => {
    invalidateList();
    loadingRequest.current = 0;
    setLoading(false);
    setError('Đã hủy tải, có thể tải lại hoặc chuyển thể loại.');
  };

  const closeDetail = useCallback(() => {
    detailRequest.current++;
    setDetail(null);
    setDetailLoading(false);
  }, []);

  useEffect(() => () => {
    detailRequest.current++;
    invalidateList();
    clearTimeout(toastTimer.current);
  }, [invalidateList]);

  // Thống kê đã tải (theo series_id -> số tập đã tải)
  const [downloadedMap, setDownloadedMap] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const loadDownloadedMap = useCallback(async () => {
    try {
      const list = (await window.electronAPI.getSeriesList()) || [];
      const map = {};
      for (const s of list) {
        const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
        if (res && res.success) {
          map[String(s.series_id)] = {
            completed: res.data.completedCount,
            total: res.data.total,
          };
        }
      }
      setDownloadedMap(map);
    } catch (_) {}
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const list = await window.electronAPI.browseCategories();
      if (Array.isArray(list) && list.length) {
        setCategories(list);
      }
    } catch (_) {}
  }, []);

  const loadList = useCallback(
    async (cat, gen, pg, forceRefresh = false) => {
      invalidateList();
      const request = listRequest.current;
      const channel = source === 'hongguo' ? catalogChannel : '';
      const key = JSON.stringify([sourceRevision, source, channel, cat, gen, pg]);
      const persistedKey = JSON.stringify([source, channel, cat, gen, pg]);
      const queryKey = JSON.stringify([source, channel, cat, gen]);
      const previousBatch = discoveryPages.get(queryKey);
      // First-page App cards are safe to show as a stale preview; page 2+ depends on a live cursor.
      const canPersist = !source.startsWith('custom:') && (!appCatalog || pg === 1);
      let cached = pageCache.get(key);
      if (!cached && canPersist) {
        cached = readPersistedPage(persistedKey);
        if (cached) pageCache.set(key, cached);
      }
      const sameView = viewRef.current.source === source && viewRef.current.category === cat && viewRef.current.channel === channel;
      const sameQuery = sameView && viewRef.current.genre === gen;
      const samePage = viewRef.current.page === pg;
      const resettingToFirstPage = forceRefresh && refreshToFirstPage.current;
      viewRef.current = { source, category: cat, channel, genre: gen, page: pg };
      // A stale App first page is a useful cold-start preview, but must not replace the
      // page the user is already on when refreshing another page or after an expired back.
      const useCached = cached && (!appCatalog || !sameView || samePage);
      const fallbackUrl = source === 'hongguo' && catalogChannel === 'web'
        ? `https://hongguoduanju.com/${cat.startsWith('hot-') ? 'rank' : 'category'}/${encodeURIComponent(cat)}${gen ? `/${encodeURIComponent(gen)}` : ''}${pg > 1 ? `?page=${pg}` : ''}` : '';
      setUnsupported(false);
      setError('');
      setRefreshNotice('');
      const previousResults = forceRefresh && !resettingToFirstPage && sameQuery && samePage && resultsRef.current.length
        ? resultsRef.current : null;
      // Keep the current grid during a genre/page refresh instead of replacing it with skeletons.
      if (useCached) {
        setResults(cached.results);
        setMeta({ ...cached.meta, page: pg });
        setSourceUrl(cached.sourceUrl || fallbackUrl);
      } else {
        setResults(prev => previousBatch?.results || (sameView ? prev : []));
        setMeta(prev => previousBatch?.meta || (sameView ? prev : { total: 0, totalPages: 0, genres: [] }));
        setSourceUrl(prev => sameView ? prev : fallbackUrl);
      }
      if (!forceRefresh && cached && !appCatalog && Date.now() - cached.savedAt < PAGE_CACHE_TTL_MS) {
        setLoading(false);
        return;
      }
      setLoading(true);
      // A new query or App first-page request may replace the old cursor chain even without forceRefresh.
      if ((!sameQuery && !previousBatch) || (appCatalog && (forceRefresh || pg === 1))) setMeta(prev => ({ ...prev, cursorExpired: true }));
      loadingRequest.current = request;
      listTimer.current = setTimeout(() => {
        // A cleanup can invalidate the request without starting another load (e.g. while
        // source metadata is still loading). Never leave the skeleton spinning forever.
        if (loadingRequest.current !== request) return;
        loadingRequest.current = 0;
        invalidateList();
        setLoading(false);
        setError(cached ? 'Làm mới quá thời gian, vẫn hiển thị danh sách trước; có thể thử lại hoặc chuyển thể loại.' : 'Tải quá thời gian, vui lòng thử lại hoặc chuyển thể loại.');
      }, LIST_TIMEOUT_MS);
      try {
        const res = await window.electronAPI.browseList({ source, category: cat, genre: gen, page: pg, forceRefresh,
          ...(source === 'hongguo' ? { catalogChannel } : {}), ...(appCatalog ? { catalogScope: 'browse' } : {}) });
        if (request !== listRequest.current) return;
        setSourceUrl(res?.sourceUrl || fallbackUrl);
        if (appCatalog && res?.code === 'APP_CURSOR') {
          setMeta(prev => ({ ...prev, cursorExpired: true }));
          throw new Error('Dữ liệu phân trang đã hết hạn, vui lòng nhấn "Làm mới danh sách" để về trang đầu.');
        }
        if (!res?.success) throw new Error(res?.error || 'Nguồn phim tạm thời không khả dụng');
        const next = {
          results: Array.isArray(res.results) ? res.results : [],
          meta: { page: pg, total: res.total || 0, totalPages: res.totalPages || 0, genres: res.genres || [], hasMore: res.hasMore === true },
          sourceUrl: res.sourceUrl || fallbackUrl,
          savedAt: Date.now(),
        };
        if (!next.results.length && (cached || previousBatch) && res.unsupported !== true) {
          throw new Error(res.emptyMessage || 'Nguồn phim lần này không trả về danh sách, vui lòng thử lại sau.');
        }
        rememberCatalogTitles(next.results);
        setResults(next.results);
        setMeta(next.meta);
        setSourceUrl(next.sourceUrl);
        if (next.results.length) {
          if (!cat.startsWith('hot-')) {
            discoveryPages.delete(queryKey);
            discoveryPages.set(queryKey, next);
            if (discoveryPages.size > 24) discoveryPages.delete(discoveryPages.keys().next().value);
          }
          refreshToFirstPage.current = false;
          if (resettingToFirstPage) {
            setRefreshNotice(`Đã lấy lại ${next.results.length} bộ phim ngắn, đã về trang đầu.`);
          } else if (forceRefresh && previousResults) {
            const sameOrder = previousResults.length === next.results.length
              && previousResults.every((item, index) => String(item.series_id) === String(next.results[index]?.series_id));
            setRefreshNotice(sameOrder
              ? cat.startsWith('hot-')
                ? `Làm mới hoàn tất: Thứ tự bảng xếp hạng nguồn không đổi (${next.results.length} bộ).`
                : `Làm mới hoàn tất: Danh sách phim và thứ tự trả về không đổi (${next.results.length} bộ).`
              : `Làm mới hoàn tất: Danh sách phim đã cập nhật (${next.results.length} bộ).`);
          }
          if (!appCatalog || pg === 1) {
            pageCache.delete(key);
            pageCache.set(key, next);
            if (canPersist) writePersistedPage(persistedKey, next);
            if (pageCache.size > 24) pageCache.delete(pageCache.keys().next().value);
          }
        } else {
          if (!appCatalog) pageCache.delete(key);
          setUnsupported(res.unsupported === true);
          setError(res.emptyMessage || 'Trang này không lấy được nội dung, có thể tải lại hoặc đổi thể loại.');
        }
      } catch (e) {
        if (request !== listRequest.current) return;
        setError(`${sameView && !sameQuery ? 'Tải thất bại, vẫn hiển thị danh sách trước khi đổi' : cached ? 'Làm mới thất bại, vẫn hiển thị danh sách trước' : 'Tải thất bại'}: ${e.message || 'Vui lòng thử lại'}`);
      } finally {
        if (loadingRequest.current === request) {
          loadingRequest.current = 0;
          clearTimeout(listTimer.current);
          setLoading(false);
        }
      }
    },
    [invalidateList, source, sourceRevision, catalogChannel, appCatalog, pageCache, discoveryPages]
  );

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => { if (active) loadDownloadedMap(); }, [active, loadDownloadedMap]);

  useEffect(() => {
    invalidateList(); closeDetail(); pageCache.clear(); discoveryPages.clear();
    refreshFirstPage.current = false;
    refreshToFirstPage.current = false;
    setGenre(''); setPage(1); setResults([]); setMeta({ total: 0, totalPages: 0, genres: [] });
    setRefreshNotice('');
    if (!mediaSources.some(item => item.id === source)) { setSource('hongguo'); setCategory('real-drama'); }
  }, [sourceRevision, mediaSources, invalidateList, closeDetail, discoveryPages]);

  useEffect(() => {
    if (active && !sourcesLoading && mediaSources.some(item => item.id === source)) {
      const forceRefresh = refreshFirstPage.current;
      refreshFirstPage.current = false;
      loadList(category, genre, page, forceRefresh);
    }
    return invalidateList;
  }, [active, category, genre, page, loadList, sourcesLoading, mediaSources, invalidateList]);

  const refreshList = () => {
    if (appCatalog && page > 1) {
      invalidateList();
      refreshFirstPage.current = true;
      refreshToFirstPage.current = true;
      setPage(1);
    } else {
      return loadList(category, genre, page, true);
    }
  };

  const retryList = () => meta.cursorExpired
    ? refreshList()
    : loadList(category, genre, page, !appCatalog);

  const switchCatalogChannel = (next) => {
    if (!['app', 'web'].includes(next) || next === catalogChannel) return;
    invalidateList(); closeDetail();
    refreshFirstPage.current = false;
    refreshToFirstPage.current = false;
    setCatalogChannel(next);
    setGenre(''); setPage(1); setCompletion('all');
    setResults([]); setMeta({ total: 0, totalPages: 0, genres: [] });
    setSourceUrl(''); setError(''); setRefreshNotice(''); setUnsupported(false);
    try { localStorage.setItem(CATALOG_CHANNEL_KEY, next); } catch (_) { /* selection still works for this launch */ }
  };

  const switchSource = (next) => {
    if (next === source) return;
    invalidateList();
    closeDetail();
    refreshFirstPage.current = false;
    refreshToFirstPage.current = false;
    setSource(next);
    setCategory('real-drama');
    setGenre('');
    setPage(1);
    setResults([]);
    setMeta({ total: 0, totalPages: 0, genres: [] });
    setSourceUrl('');
    setError('');
    setRefreshNotice('');
  };

  const selectDiscoveryBatch = (cat, gen) => {
    const sameQuery = cat === category && gen === genre;
    if (sameQuery && loading) return;
    const previous = discoveryPages.get(JSON.stringify([source, source === 'hongguo' ? catalogChannel : '', cat, gen]))?.meta;
    const hasMore = previous && (previous.totalPages ? previous.page < previous.totalPages : previous.hasMore);
    const next = sameQuery && meta.cursorExpired ? 1 : hasMore ? previous.page + 1 : 1;
    refreshToFirstPage.current = false;
    if (sameQuery && next === page) return loadList(cat, gen, next, next === 1 || !appCatalog);
    invalidateList();
    refreshFirstPage.current = next === 1;
    setError(''); setRefreshNotice('');
    if (cat !== category) {
      setResults([]); setMeta({ total: 0, totalPages: 0, genres: [] });
    }
    setCategory(cat); setGenre(gen); setPage(next);
  };

  const switchCategory = (slug) => {
    if (!slug.startsWith('hot-') && slug !== 'comic') return selectDiscoveryBatch(slug, '');
    if (slug === category) return;
    invalidateList();
    refreshFirstPage.current = false;
    refreshToFirstPage.current = false;
    setError('');
    setRefreshNotice('');
    setMeta({ total: 0, totalPages: 0, genres: [] });
    setCategory(slug);
    setGenre('');
    setPage(1);
    setResults([]);
  };

  const switchGenre = (slug) => {
    if (!category.startsWith('hot-') && category !== 'comic') return selectDiscoveryBatch(category, slug);
    if (slug === genre) return;
    invalidateList();
    refreshToFirstPage.current = false;
    setError('');
    setRefreshNotice('');
    setGenre(slug);
    setPage(1);
    // loadList keeps the previous grid visible until the new genre arrives.
  };

  const gotoPage = (p) => {
    if (meta.cursorExpired) return;
    const max = meta.totalPages || (meta.page || page) + (meta.hasMore ? 1 : 0);
    const next = Math.min(Math.max(1, p), max);
    if (next === page) {
      if (error) loadList(category, genre, next);
      return;
    }
    invalidateList();
    setError('');
    setRefreshNotice('');
    setPage(next);
    document.querySelector('.main-content:not([hidden])')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ===== Mở một bộ phim =====
  const openSeries = async (item) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetail(null);
    setSelectedIdx(new Set());
    setRangeInput('');
    setRangeError('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (request !== detailRequest.current) return;
      if (!res || !res.success) {
        showToast((res && res.error) || 'Lấy danh sách tập thất bại', 'error');
        return;
      }
      const data = res.data;
      // Gộp trạng thái tải về
      const epRes = await window.electronAPI.getSeriesEpisodes(item.series_id);
      if (request !== detailRequest.current) return;
      const statusMap = {};
      if (epRes && epRes.success) {
        for (const e of epRes.data.episodes) statusMap[e.vid_index] = e;
      }
      const episodes = data.episodes.map((ep) => ({
        ...ep,
        status: statusMap[ep.vid_index] ? statusMap[ep.vid_index].status : 'missing',
        progress: statusMap[ep.vid_index] ? statusMap[ep.vid_index].progress : 0,
        fileUrl: statusMap[ep.vid_index] ? statusMap[ep.vid_index].fileUrl : null,
      }));
      const initialDetail = {
        ...data,
        series_title: item.series_title || data.series_title,
        cover: item.cover || data.cover || '',
        description: item.description || data.description || '',
        episodes,
        completedCount: episodes.filter((e) => e.status === 'completed').length,
      };
      setDetail(initialDetail);
      // Mặc định chọn tất cả các tập chưa tải
      setSelectedIdx(new Set(episodes.filter((e) => !e.locked && e.status !== 'completed').map((e) => e.vid_index)));

      if (!initialDetail.description && window.electronAPI?.getPublicDetails && /^\d+$/.test(String(item.series_id))) {
        window.electronAPI.getPublicDetails(item.series_id).then((pub) => {
          if (pub && pub.description && request === detailRequest.current) {
            setDetail((prev) => prev && prev.series_id === item.series_id ? { ...prev, description: pub.description, cover: pub.cover || prev.cover } : prev);
          }
        }).catch(() => {});
      }
    } catch (e) {
      if (request === detailRequest.current) showToast('Mở thất bại: ' + e.message, 'error');
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const downloadThumbnail = async () => {
    if (!detail?.cover) return;
    try {
      showToast('Đang tải ảnh bìa…', 'info');
      const response = await fetch(detail.cover);
      if (!response.ok) throw new Error('Không thể tải ảnh');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const cleanName = (detail.series_title || 'thumbnail').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
      link.download = `${cleanName}_cover.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Đã tải ảnh bìa thành công!');
    } catch (err) {
      if (window.electronAPI?.openExternalUrl) {
        window.electronAPI.openExternalUrl(detail.cover);
      } else {
        window.open(detail.cover, '_blank');
      }
      showToast('Đã mở ảnh bìa trong trình duyệt');
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopyDramaInfo = async () => {
    if (!detail) return;
    const titleZh = detail.series_title || '';
    const titleVi = getCachedTranslation(titleZh) || titleZh;
    const totalEps = detail.total || detail.episodes?.length || 0;
    const rawDesc = detail.description || detail.intro || '';
    const descVi = rawDesc ? (getCachedTranslation(rawDesc) || rawDesc) : 'Chưa có tóm tắt';
    const coverUrl = detail.cover || '';

    const lines = [
      `🎬 Phim: ${titleVi}`,
      titleZh && titleZh !== titleVi ? `🏷️ Tên gốc: ${titleZh}` : null,
      `🔢 Số tập: ${totalEps} tập`,
      `📝 Tóm tắt nội dung:\n${descVi}`,
      coverUrl ? `🖼️ Ảnh bìa: ${coverUrl}` : null,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n\n'));
      setCopied(true);
      showToast('Đã sao chép thông tin phim vào bộ nhớ tạm!');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      showToast('Sao chép thất bại: ' + err.message, 'error');
    }
  };

  const [editTitleState, setEditTitleState] = useState(null);

  const openEditTitleModal = (originalZh) => {
    const currentVi = getCachedTranslation(originalZh) || originalZh;
    setEditTitleState({ originalZh, customVi: currentVi });
  };

  const handleSaveCustomTitle = () => {
    if (!editTitleState?.originalZh) return;
    const { originalZh, customVi } = editTitleState;
    saveCustomOverride(originalZh, customVi);
    showToast('Đã lưu bản dịch tùy chỉnh!');
    setEditTitleState(null);
  };

  const handleResetCustomTitle = () => {
    if (!editTitleState?.originalZh) return;
    removeCustomOverride(editTitleState.originalZh);
    showToast('Đã khôi phục bản dịch mặc định!');
    setEditTitleState(null);
  };

  const handleCopyTitleOnly = async () => {
    if (!detail) return;
    const titleZh = detail.series_title || '';
    const titleVi = getCachedTranslation(titleZh) || titleZh;
    const textToCopy = titleZh && titleZh !== titleVi ? `${titleVi} (${titleZh})` : titleVi;
    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast('Đã sao chép tựa đề phim!');
    } catch (err) {
      showToast('Sao chép thất bại: ' + err.message, 'error');
    }
  };

  const toggleIdx = (idx) => {
    if (!detail?.episodes.some((ep) => ep.vid_index === idx && !ep.locked)) return;
    const next = new Set(selectedIdx);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIdx(next);
  };

  // Chọn nhanh khoảng: 1-50 / 10 tập đầu / 30 tập cuối / chọn tất cả / xóa chọn
  const applyRange = (expr) => {
    if (!detail) return;
    try {
      const nums = parseEpisodeRange(expr, detail.episodes.length);
      setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked && nums.has(e.vid_index)).map((e) => e.vid_index)));
      setRangeError('');
    } catch (error) { setRangeError(error.message); }
  };

  const downloadSelected = async () => {
    if (!detail || selectedIdx.size === 0) return;
    setSubmitting(true);
    try {
      const eps = detail.episodes.filter((e) => !e.locked && selectedIdx.has(e.vid_index));
      const transConfig = getTranslationConfig();
      let targetTitle = detail.series_title;
      if (transConfig.vietnamese_filenames) {
        const viTitle = getCachedTranslation(detail.series_title);
        if (viTitle && viTitle !== detail.series_title) {
          targetTitle = viTitle;
        }
      }
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: detail.series_id,
        seriesTitle: targetTitle,
        episodes: eps,
      });
      if (res && res.success) {
        showToast(`Đã thêm vào hàng đợi tải: ${res.count} tập`);
        setDetail(null);
        if (onNavigate) onNavigate('manager');
      } else {
        showToast((res && res.error) || 'Gửi tải về thất bại', 'error');
      }
    } catch (e) {
      showToast('Lỗi gửi tải: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Bắt đầu từ tập đầu tiên; trình phát chọn nguồn cục bộ hoặc trực tuyến theo trạng thái thực tế.
  const playNow = async () => {
    if (!detail) return;
    const first = detail.episodes.find((e) => !e.locked);
    if (!first) return;
    try {
      const res = await window.electronAPI.playSeries({ seriesId: detail.series_id, vidIndex: first.vid_index });
      if (res?.success) closeDetail();
      else showToast(res?.error || 'Mở trình phát thất bại, vui lòng thử lại', 'error');
    } catch (e) {
      showToast('Mở trình phát thất bại: ' + e.message, 'error');
    }
  };

  const showBrowser = async () => {
    if (source !== 'hongguo' || !sourceUrl) return;
    try {
      const res = await window.electronAPI.searchWindowShow(true, sourceUrl);
      if (res?.success === false) throw new Error(res.error || 'Mở trang nguồn thất bại');
      showToast('Đã mở trang nguồn hiện tại');
    } catch (e) { showToast(e.message || 'Mở trang nguồn thất bại', 'error'); }
  };

  useDialogKeyboard(active && (!!detail || detailLoading), closeDetail, '.browse-drawer');

  const visibleResults = completion === 'all' ? results : results.filter((item) => item.completion_status === completion);
  // Keep the label and navigation anchored to the cards that actually loaded.
  const displayedPage = meta.page || page;
  const totalPages = meta.totalPages || 0;
  const hasNextBatch = results.length > 0 && (totalPages ? displayedPage < totalPages : meta.hasMore);
  const pageNumbers = useMemo(() => {
    if (!totalPages) return [];
    const out = [];
    const cur = displayedPage;
    const push = (n) => {
      if (n >= 1 && n <= totalPages && !out.includes(n)) out.push(n);
    };
    out.push(1);
    for (let i = cur - 1; i <= cur + 1; i++) push(i);
    push(totalPages);
    return out.sort((a, b) => a - b);
  }, [totalPages, displayedPage]);

  return (
    <div className="browse-container">
      <div className="browse-header">
        <div className="browse-title">
          <div><h2>Khám phá phim ngắn</h2><p className="page-description">Chọn một bộ phim bạn thích, để câu chuyện tiếp diễn.</p></div>
        </div>
        <div className="browse-header-right">
          <label className="source-control">Nguồn<select className="input-field" aria-label="Nguồn phim ngắn" value={source} onChange={(e) => switchSource(e.target.value)}>{mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
          {source === 'hongguo' && <label className="source-control">Tuyến danh mục<select className="input-field" aria-label="Tuyến danh mục Hồng Quả" value={catalogChannel} onChange={(e) => switchCatalogChannel(e.target.value)}><option value="app">App (Nhanh · Một phần danh sách)</option><option value="web">Trang web chính thức (Đầy đủ)</option></select></label>}
          <button className="btn btn-primary" onClick={() => onNavigate('download')}><Search size={15} />Tìm kiếm phim</button>
          <button className="btn btn-outline" disabled={loading || sourcesLoading || meta.cursorExpired || page !== displayedPage || !hasNextBatch} onClick={() => gotoPage(displayedPage + 1)}><RefreshCw size={15} />Đổi một mẻ</button>
          <button className="btn btn-outline" disabled={loading || sourcesLoading} onClick={refreshList}><RefreshCw size={15} />Làm mới danh sách</button>
          {meta.total > 0 && <span className="browse-stat">Tổng {meta.total} bộ</span>}
          {source === 'hongguo' && catalogChannel === 'web' && sourceUrl && <button className="btn btn-outline" onClick={showBrowser}>
            <ExternalLink size={15} />
            Mở trang nguồn
          </button>}
        </div>
      </div>

      <p className="browse-source-note">Nhấn vào phân loại hoặc đề tài để đổi mẻ phim khác, nhấn tiếp vào phân loại hiện tại cũng có thể đổi tiếp; 4 bảng xếp hạng phát sóng nóng hiển thị theo thứ tự độ hot của nguồn. {appCatalog && 'Nhấn "Làm mới danh sách" để lấy lại trang đầu.'}</p>
      {source === 'hongguo' && <p className="browse-source-note">Bảng xếp hạng và cách chia đề tài giữa App và trang web có thể khác nhau.</p>}
      {refreshNotice && <p className="browse-source-note" role="status">{refreshNotice}</p>}

      {/* Phân loại tab */}
      {source === 'hongguo' && [false, true].map(ranking => {
        const group = (categories.length ? categories : [{ slug: 'real-drama', label: 'Phim người thật đóng' }])
          .filter(c => c.slug.startsWith('hot-') === ranking);
        return group.length > 0 && <div className="browse-cats" role="group" aria-label={ranking ? 'Bảng xếp hạng phát sóng nóng' : 'Phân loại phim ngắn'} key={String(ranking)}>
        <span className="browse-nav-label">{ranking ? 'Bảng xếp hạng' : 'Phân loại'}</span>
        {group.map((c) => (
          <button
            key={c.slug}
            className={`browse-cat ${category === c.slug ? 'active' : ''}`}
            aria-pressed={category === c.slug}
            onClick={() => switchCategory(c.slug)}
          >
            {c.label}
          </button>
        ))}
      </div>;
      })}

      {sourcesError && <p className="browse-source-note" role="status">Cập nhật danh sách nguồn thất bại, tạm thời dùng danh sách lần trước. Có thể lưu lại nguồn trong Cài đặt rồi thử lại.</p>}
      {source === 'hongguo' && catalogChannel === 'app' && <p className="browse-source-note" role="status">Tuyến nhanh App chỉ hiển thị một phần danh sách phim; khi cần danh mục đầy đủ hơn vui lòng chuyển sang "Trang web chính thức".</p>}
      {source.startsWith('custom:') && <p className="browse-source-note">Danh mục API đến từ {mediaSourceLabel(source, mediaSources)}, hiển thị theo thứ tự nguồn, không đại diện cho bảng xếp hạng hot.</p>}
      {source === 'xifan' && <p className="browse-source-note">Hiện cung cấp phân loại đề tài, bảng xếp hạng XiFan tạm thời chưa kết nối.</p>}

      {/* Đề tài chips */}
      {meta.genres.length > 0 && (
        <div className="browse-genres">
          <button
            className={`genre-chip ${genre === '' ? 'active' : ''}`}
            onClick={() => switchGenre('')}
          >
            {source === 'xifan' ? 'Phân loại mặc định' : 'Tất cả'}
          </button>
          {meta.genres.map((g) => (
            <button
              key={g.slug}
              className={`genre-chip ${genre === g.slug ? 'active' : ''}`}
              onClick={() => switchGenre(g.slug)}
            >
              {translateGenre(g.label)}
            </button>
          ))}
        </div>
      )}

      <div className="browse-completion-filter">
        <label htmlFor="browse-completion">Trạng thái phim</label>
        <select id="browse-completion" className="input-field" value={completion} onChange={(event) => setCompletion(event.target.value)} aria-describedby="browse-completion-hint">
          <option value="all">Tất cả</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="ongoing">Đang cập nhật</option>
        </select>
        <span id="browse-completion-hint">Chỉ lọc trang hiện tại; phim chưa ghi rõ trạng thái chỉ hiển thị ở "Tất cả".</span>
        {completion !== 'all' && <span role="status">Trang này {visibleResults.length} / {results.length} bộ</span>}
      </div>
      {!loading && !error && results.length > 0 && visibleResults.length === 0 && <div className="browse-filter-empty" role="status"><p>Trang này không có phim nào được đánh dấu rõ ràng là {completion === 'completed' ? 'Đã hoàn thành' : 'Đang cập nhật'}.</p><button className="btn btn-outline" onClick={() => setCompletion('all')}>Hiển thị tất cả trang này</button></div>}

      {error && results.length > 0 && <div className="alert alert-error browse-update-error" role="alert">
        <span>{error}</span><button className="btn btn-outline btn-sm" disabled={loading || sourcesLoading} onClick={retryList}>Thử lại</button>
      </div>}
      {error && results.length === 0 && <div className="browse-error-state" role={unsupported ? 'status' : 'alert'}><Film size={36} /><h3>{unsupported ? 'Đây là truyện tranh ảnh' : 'Tạm thời chưa thể tải danh sách phim'}</h3><p>{error}</p><div className="search-empty-actions">{unsupported ? <button className="btn btn-primary" onClick={() => switchCategory('comic-drama')}>Xem truyện tranh động (Anime)</button> : <button className="btn btn-primary" onClick={retryList}><RefreshCw size={15} />Tải lại</button>}<button className="btn btn-outline" onClick={() => onNavigate('download')}>Tìm kiếm theo tên phim</button></div></div>}

      {loading && results.length > 0 && <div className="browse-loading" role="status"><RefreshCw size={18} className="spin" /><span>Đang cập nhật danh sách phim, vẫn có thể duyệt kết quả trước…</span><button className="btn btn-outline btn-sm" onClick={cancelList}>Hủy tải</button></div>}

      {loading && results.length === 0 ? (
        <div className="browse-loading-state" role="status"><div className="browse-loading"><RefreshCw size={18} className="spin" /><span>Đang tải {categories.find((item) => item.slug === category)?.label || 'phim ngắn'}…</span><button className="btn btn-outline btn-sm" onClick={cancelList}>Hủy tải</button></div><div className="poster-skeletons" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div className="poster-skeleton" key={i}><div /><span /><span /></div>)}</div></div>
      ) : (
        <div className="browse-grid">
          {visibleResults.map((item) => {
            const dl = downloadedMap[String(item.series_id)];
            return (
              <button
                type="button"
                key={item.series_id}
                className="browse-card"
                onClick={() => openSeries(item)}
                title={item.series_title}
              >
                <div className="browse-cover">
                  {item.rank > 0 && <span className="browse-rank-badge">Hạng {item.rank}</span>}
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder"><Film size={22} /></div>
                  )}
                  {(item.episode_label || item.episode_count > 0) && (
                    <span className="browse-ep-badge">{translateGenre(item.episode_label) || `${item.episode_count} tập`}</span>
                  )}
                  {dl && dl.completed > 0 && (
                    <span className="browse-dl-badge">
                      <Check size={11} /> {dl.completed}/{dl.total}
                    </span>
                  )}
                  <div className="browse-hover">
                    <span className="browse-hover-play">
                      <Play size={16} /> {dl && dl.completed > 0 ? 'Phát' : 'Xem'}
                    </span>
                  </div>
                </div>
                <DramaTitle title={item.series_title} className="browse-card-title">{item.series_title}</DramaTitle>
                {item.completion_status === 'completed' && <div className="browse-completion-label">Đã hoàn thành</div>}
                {item.completion_status === 'ongoing' && <div className="browse-completion-label">Đang cập nhật</div>}
                {item.heat && <div className="browse-card-heat">{translateGenre(item.heat)}</div>}
                {item.tags && item.tags.length > 0 && (
                  <div className="browse-card-tags">
                    {item.tags.slice(0, 2).map((t) => (
                      <span key={t} className="browse-tag">{translateGenre(t)}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="browse-pager">
          <button className="pager-item" aria-label="Trang trước" disabled={displayedPage <= 1 || meta.cursorExpired} onClick={() => gotoPage(displayedPage - 1)}>‹</button>
          {pageNumbers.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="pager-gap">…</span>}
              <button
                className={`pager-item ${n === displayedPage ? 'active' : ''}`}
                disabled={meta.cursorExpired}
                onClick={() => gotoPage(n)}
              >
                {n}
              </button>
            </React.Fragment>
          ))}
          <button className="pager-item" aria-label="Trang sau" disabled={displayedPage >= totalPages || meta.cursorExpired} onClick={() => gotoPage(displayedPage + 1)}>›</button>
        </div>
      )}

      {!totalPages && (displayedPage > 1 || meta.hasMore) && <div className="browse-pager"><button className="pager-item" disabled={displayedPage <= 1 || loading || meta.cursorExpired} onClick={() => gotoPage(displayedPage - 1)}>Trang trước</button><span>Trang {displayedPage}</span><button className="pager-item" disabled={!meta.hasMore || loading || meta.cursorExpired} onClick={() => gotoPage(displayedPage + 1)}>Trang sau</button></div>}

      {/* ===== Ngăn kéo chi tiết phim ===== */}
      {(detail || detailLoading) && (
        <div className="browse-drawer-mask" onClick={closeDetail}>
          <div className="browse-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết phim" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="browse-drawer-head">
              <div className="browse-drawer-title">
                <Film size={18} />
                <span>{detail ? <DramaTitle title={detail.series_title} as="span" showOriginal={false}>{`《${detail.series_title}》`}</DramaTitle> : 'Đang tải…'}</span>
              </div>
              <button className="icon-btn" onClick={closeDetail} title="Đóng">
                <X size={16} />
              </button>
            </div>

            {detailLoading && (
              <div className="browse-loading">
                <RefreshCw size={18} className="spin" />
                <span>Đang lấy toàn bộ tập…</span>
              </div>
            )}

            {detail && (
              <>
                <div className="browse-drawer-body">
                  <div className="browse-drawer-info">
                    <div className="browse-drawer-cover-box">
                      {detail.cover && <img src={detail.cover} alt="" className="browse-drawer-cover" />}
                      {detail.cover && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm download-cover-btn"
                            onClick={downloadThumbnail}
                            title="Tải ảnh bìa (thumbnail) về máy"
                          >
                            <Download size={13} /> Tải ảnh bìa
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm copy-info-btn"
                            onClick={handleCopyDramaInfo}
                            title="Sao chép toàn bộ thông tin phim (tên Việt, tên gốc, số tập, tóm tắt, ảnh bìa)"
                          >
                            <Copy size={13} /> {copied ? 'Đã sao chép! ✓' : 'Sao chép thông tin'}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="browse-drawer-meta">
                      <div className="browse-drawer-count">
                        {mediaSourceLabel(detail.series_id, mediaSources)} · Tổng {detail.total} tập · Đã tải <b>{detail.completedCount}</b> tập
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                        <DramaTitle title={detail.series_title} as="h3" style={{ margin: 0, fontSize: '15px', flex: 1 }}>{detail.series_title}</DramaTitle>
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          onClick={handleCopyTitleOnly}
                          title="Sao chép tựa đề phim"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-tertiary)',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          onClick={() => openEditTitleModal(detail.series_title)}
                          title="Sửa bản dịch tên phim theo ý bạn"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-tertiary)',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                      {(detail.description || detail.intro) && (
                        <DramaDescription description={detail.description || detail.intro} className="browse-drawer-desc">{detail.description || detail.intro}</DramaDescription>
                      )}
                      {detail.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
                        <div className="browse-drawer-sub">Nguồn web cung cấp {detail.web_accessible_episodes} tập đầu, các tập sau tự động thử nguồn App.</div>
                      )}
                      {detail.episodes.some((ep) => ep.locked) && <div className="browse-drawer-sub">Các tập được đánh dấu "Đã khóa" cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa.</div>}
                      <div className="browse-drawer-sub">Đã chọn {selectedIdx.size} tập để tải</div>
                      <div className="browse-range-row">
                        <input
                          type="text"
                          className="input-field"
                          aria-label="Chọn phạm vi tập"
                          placeholder="Khoảng, vd: 1-50 hoặc 1,3,5"
                          value={rangeInput}
                          onChange={(e) => { setRangeInput(e.target.value); setRangeError(''); }}
                          onKeyDown={(e) => isSubmitKey(e) && applyRange(rangeInput)}
                        />
                        <button className="btn btn-outline btn-sm" onClick={() => applyRange(rangeInput)}>Áp dụng</button>
                      </div>
                      {rangeError && <p className="alert alert-error" role="alert">{rangeError}</p>}
                      <div className="preset-row mt8">
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(10, detail.total)}`)}>10 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(30, detail.total)}`)}>30 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`${Math.max(1, detail.total - 29)}-${detail.total}`)}>30 tập cuối</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked).map((e) => e.vid_index)))}>Chọn tất cả</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set())}>Xóa chọn</button>
                      </div>
                    </div>
                  </div>

                  <div className="browse-eps">
                    {detail.episodes.map((ep) => (
                      <button
                        disabled={ep.locked === true}
                        aria-pressed={selectedIdx.has(ep.vid_index)}
                        key={ep.vid_index}
                        className={`ep-chip ep-${ep.status} ${selectedIdx.has(ep.vid_index) ? 'ep-picked' : ''}`}
                        onClick={() => toggleIdx(ep.vid_index)}
                        title={ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : ep.title || `Tập ${ep.vid_index}`}
                      >
                        <span className="ep-num">{ep.vid_index}</span>{ep.locked && <span className="ep-lock-label">Đã khóa</span>}
                        {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
                        {selectedIdx.has(ep.vid_index) && <span className="ep-pick-dot" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="browse-drawer-foot">
                  <button className="btn btn-outline" disabled={!detail.episodes.some((ep) => !ep.locked)} onClick={playNow}>
                    <Play size={15} />
                    Phát ngay
                  </button>
                  <div className="browse-foot-right">
                    <button
                      className="btn btn-primary"
                      disabled={submitting || selectedIdx.size === 0}
                      onClick={downloadSelected}
                    >
                      <Download size={15} />
                      Tải mục đã chọn ({selectedIdx.size})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal chỉnh sửa bản dịch tên phim */}
      {editTitleState && (
        <div className="browse-drawer-mask" style={{ zIndex: 1100 }} onClick={() => setEditTitleState(null)}>
          <div
            className="settings-card"
            style={{
              maxWidth: '480px',
              width: '90%',
              margin: 'auto',
              background: 'var(--bg-card, #1e1e24)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '20px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit3 size={16} /> Chỉnh sửa bản dịch tên phim
              </h3>
              <button className="icon-btn" onClick={() => setEditTitleState(null)}><X size={16} /></button>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Tên gốc tiếng Trung:
              </label>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', padding: '6px 10px', background: 'var(--bg-inset)', borderRadius: '6px' }}>
                {editTitleState.originalZh}
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Tên tiếng Việt bạn muốn hiển thị:
              </label>
              <input
                type="text"
                className="input-field"
                value={editTitleState.customVi}
                onChange={(e) => setEditTitleState({ ...editTitleState, customVi: e.target.value })}
                placeholder="Nhập tên tiếng Việt theo ý muốn..."
                autoFocus
                onKeyDown={(e) => isSubmitKey(e) && handleSaveCustomTitle()}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleResetCustomTitle}
                title="Khôi phục về bản dịch tự động"
              >
                Khôi phục tự động
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setEditTitleState(null)}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveCustomTitle}
                  disabled={!editTitleState.customVi.trim()}
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default Browse;
