import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RefreshCw } from './icons';
import RandomDrama, { DramaPoster } from './RandomDrama';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { feedCacheKey, readFeedCache, writeFeedCache } from './feedCache.mjs';
import { loadRandomPool, playRecommendedDrama, waitForRequest } from './randomDramaModel.mjs';
import { translateGenre } from './genreMap';
import { DramaTitle, DramaDescription } from './TranslatedText';
import './DramaFeed.css';

const CATALOG_CHANNEL_KEY = 'hongguo.feed.catalog.channel.v1';
const RANKINGS = [
  ['hot-drama', 'BXH Phổ Biến'], ['hot-real-drama', 'Phim Người Đóng'],
  ['hot-comic-drama', 'Truyện Tranh Động'], ['hot-ai-drama', 'Phim Ngắn AI'],
];

function clockOf(timestamp) {
  if (!timestamp) return '';
  const time = new Date(timestamp);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Hiển thị trước danh sách phim lần trước trong phiên, rồi cập nhật ngầm; nếu cập nhật thất bại giữ nội dung cũ. Chỉ có "Làm mới danh sách" mới ép lấy mới nhất.
function DramaFeed({ active = true, onNavigate }) {
  const [source, setSource] = useState('hongguo');
  const [catalogChannel, setCatalogChannel] = useState(() => {
    try { return localStorage.getItem(CATALOG_CHANNEL_KEY) === 'web' ? 'web' : 'app'; }
    catch (_) { return 'app'; }
  });
  const { sources: mediaSources, revision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const [category, setCategory] = useState('hot-drama');
  const [items, setItems] = useState(() => readFeedCache(feedCacheKey(revision, source, category, catalogChannel))?.items || []);
  const [updatedAt, setUpdatedAt] = useState(() => readFeedCache(feedCacheKey(revision, source, category, catalogChannel))?.savedAt || 0);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playError, setPlayError] = useState('');
  const [randomRefresh, setRandomRefresh] = useState(0);
  const listController = useRef(null);
  const playController = useRef(null);
  const selectedIdRef = useRef('');
  const itemsRef = useRef([]);
  const revisionRef = useRef(revision);
  const selected = items[index];
  const random = category === 'random';
  const ranking = source === 'hongguo';
  const sourceLabel = mediaSourceLabel(source, mediaSources);
  itemsRef.current = items;
  selectedIdRef.current = selected ? String(selected.series_id) : '';

  const seedFeed = useCallback((nextSource, nextCategory, nextChannel = catalogChannel) => {
    const cached = nextCategory === 'random' ? null : readFeedCache(feedCacheKey(revision, nextSource, nextCategory, nextChannel));
    setItems(cached?.items || []);
    setUpdatedAt(cached?.savedAt || 0);
    setIndex(0);
  }, [revision, catalogChannel]);

  const stopRequests = useCallback(() => {
    listController.current?.abort();
    playController.current?.abort();
    setResolving(false);
    setPlayError('');
  }, []);

  const switchFeed = (nextSource, nextCategory) => {
    if (source === nextSource && category === nextCategory) return;
    stopRequests();
    setError(''); setNotice('');
    setLoading(nextCategory !== 'random');
    seedFeed(nextSource, nextCategory);
    setSource(nextSource); setCategory(nextCategory);
  };

  const switchCatalogChannel = next => {
    if (!['app', 'web'].includes(next) || next === catalogChannel) return;
    stopRequests();
    setError(''); setNotice(''); setLoading(true);
    seedFeed(source, category, next);
    setCatalogChannel(next);
    try { localStorage.setItem(CATALOG_CHANNEL_KEY, next); } catch (_) { /* selection still works for this launch */ }
  };

  const cancelLoad = () => {
    listController.current?.abort();
    setLoading(false);
    if (itemsRef.current.length) setNotice('Đã hủy cập nhật, vẫn hiển thị danh sách trước đó.');
    else setError('Đã hủy tải, có thể thử lại hoặc chuyển đổi nguồn.');
  };

  const loadList = useCallback(async (forceRefresh = false) => {
    if (!active || random || sourcesLoading || !source) return;
    if (!mediaSources.some(item => item.id === source)) return;
    const key = feedCacheKey(revision, source, category, catalogChannel);
    const cached = readFeedCache(key);
    if (!itemsRef.current.length && cached?.items?.length) {
      setItems(cached.items); setUpdatedAt(cached.savedAt); setIndex(0);
    }
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true); setError(''); setNotice('');
    try {
      let nextItems;
      if (ranking) {
        const result = await waitForRequest(window.electronAPI.browseList({
          source, category, page: 1, forceRefresh, catalogChannel,
        }), { signal: controller.signal, message: 'Tải BXH thịnh hành quá thời gian, vui lòng thử lại' });
        if (controller.signal.aborted) return;
        if (!result?.success) throw new Error(result?.error || 'BXH thịnh hành tạm thời không khả dụng');
        const seen = new Set();
        nextItems = (Array.isArray(result.results) ? result.results : []).filter(item => {
          const id = String(item?.series_id || '');
          if (!/^\d{6,30}$/.test(id) || typeof item.series_title !== 'string' || !item.series_title.trim() || seen.has(id)) return false;
          seen.add(id); return true;
        });
      } else {
        const result = await loadRandomPool(options => window.electronAPI.browseList(options), {
          source, sources: mediaSources, forceRefresh, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        nextItems = result.items;
      }
      if (!nextItems.length) {
        setError(itemsRef.current.length ? 'Nguồn lần này không trả về danh sách phim, vui lòng thử lại sau.' : 'Nguồn này tạm thời chưa có danh sách phim khả dụng, có thể thử lại hoặc đổi nguồn.');
        return;
      }
      const savedAt = Date.now();
      writeFeedCache(key, nextItems, savedAt);
      const keepId = selectedIdRef.current;
      setItems(nextItems);
      setUpdatedAt(savedAt);
      setIndex(() => {
        const found = keepId ? nextItems.findIndex(item => String(item.series_id) === keepId) : -1;
        return found >= 0 ? found : 0;
      });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'Tải danh sách phim thất bại, vui lòng thử lại hoặc đổi nguồn');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [active, random, sourcesLoading, source, category, catalogChannel, revision, ranking, mediaSources]);

  // Sau khi cấu hình nguồn được chỉnh sửa (revision thay đổi), danh sách cũ không còn đáng tin, xóa sạch rồi lấy lại theo revision mới.
  useEffect(() => {
    if (revisionRef.current === revision) return;
    revisionRef.current = revision;
    stopRequests();
    setItems([]); setUpdatedAt(0); setIndex(0);
    setError(''); setNotice(''); setLoading(false);
  }, [revision, stopRequests]);

  useEffect(() => {
    if (sourcesLoading) return;
    if (!mediaSources.some(item => item.id === source)) {
      const next = mediaSources[0]?.id || '';
      if (next) {
        seedFeed(next, 'hot-drama');
        setLoading(true);
        setSource(next); setCategory('hot-drama');
      } else {
        setItems([]); setUpdatedAt(0); setIndex(0); setLoading(false); setError(''); setNotice('');
      }
      return;
    }
    if (active && !random) loadList();
  }, [active, random, loadList, seedFeed, sourcesLoading, mediaSources, source]);

  useEffect(() => () => { listController.current?.abort(); playController.current?.abort(); }, []);

  const startItem = async () => {
    if (!active || !selected || resolving || sourcesLoading) return;
    playController.current?.abort();
    const controller = new AbortController();
    playController.current = controller;
    setPlayError(''); setResolving(true);
    try { await playRecommendedDrama(window.electronAPI, selected, { signal: controller.signal }); }
    catch (cause) { if (!controller.signal.aborted) setPlayError(cause.message || 'Tải thất bại, vui lòng thử lại phim này'); }
    finally { if (!controller.signal.aborted) setResolving(false); }
  };

  const selectItem = next => {
    if (resolving || next < 0 || next >= items.length) return;
    setPlayError(''); setIndex(next);
  };

  const introduction = selected?.intro || selected?.series_intro || selected?.description;
  const upcoming = items.slice(index + 1, index + 5);
  return <section className="drama-feed" aria-label="Thịnh hành đề xuất">
    <header className="drama-feed-header">
      <div><h2>Thịnh hành đề xuất</h2><p className="page-description">Khám phá câu chuyện tiếp theo từ BXH thịnh hành và danh sách phim.</p></div>
      <div className="drama-feed-actions">
        {!random && <label className="source-control">Nguồn<select className="input-field" aria-label="Nguồn đề xuất" value={source} onChange={event => switchFeed(event.target.value, 'hot-drama')}>
          {mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select></label>}
        {ranking && !random && <label className="source-control">Kênh danh mục<select className="input-field" aria-label="Kênh danh mục đề xuất" value={catalogChannel} onChange={event => switchCatalogChannel(event.target.value)}><option value="app">App (Nhanh · Một phần danh sách)</option><option value="web">Trang web (Danh mục đầy đủ)</option></select></label>}
        <button className="btn btn-outline" disabled={!random && (sourcesLoading || !source || (loading && !items.length))} onClick={() => random ? setRandomRefresh(value => value + 1) : loadList(true)}><RefreshCw size={15} />Làm mới danh sách</button>
      </div>
    </header>
    <div className="drama-feed-categories" role="group" aria-label="Chọn cách đề xuất">
      {ranking ? RANKINGS.map(([value, label]) => <button key={value} className={`browse-cat ${category === value ? 'active' : ''}`}
        aria-pressed={category === value} onClick={() => switchFeed(source, value)}>{label}</button>)
        : <button className={`browse-cat ${!random ? 'active' : ''}`} aria-pressed={!random} onClick={() => switchFeed(source, 'hot-drama')}>Danh sách nguồn</button>}
      <button className={`browse-cat drama-random-tab ${random ? 'active' : ''}`} aria-pressed={random} onClick={() => switchFeed(source, 'random')}>Lắc ngẫu nhiên</button>
    </div>
    {random ? <RandomDrama active={active} refreshKey={randomRefresh} onNavigate={onNavigate} /> : <>
      {sourcesError && <p className="drama-feed-hint" role="status">Cập nhật danh sách nguồn thất bại, tạm dùng danh sách cũ; có thể lưu lại nguồn trong cài đặt rồi thử lại.</p>}
      <div className="drama-feed-list-meta"><p>{ranking ? catalogChannel === 'app' ? 'BXH Phổ Biến Hồng Quả App' : 'BXH Phổ Biến Trang Chủ Hồng Quả' : `${sourceLabel} · Danh sách nguồn`}{items.length > 0 ? ` · Đợt này ${items.length} bộ` : ''}</p><span>{ranking ? 'Theo thứ tự bảng xếp hạng nguồn' : 'Theo thứ tự danh mục nguồn, không đại diện cho xếp hạng thịnh hành'}</span></div>
      {ranking && catalogChannel === 'app' && <p className="drama-feed-hint" role="status">Kênh nhanh chỉ hiển thị một phần danh sách; khi cần bảng xếp hạng đầy đủ hơn, có thể chuyển sang "Trang web" ở mục "Kênh danh mục".</p>}
      {(loading || sourcesLoading) && items.length === 0 && <div className="drama-feed-state" role="status"><RefreshCw size={24} className="spin" /><p>{sourcesLoading ? 'Đang tải danh sách nguồn…' : 'Đang tải danh sách phim thực tế…'}</p>
        {loading && !sourcesLoading && <button className="btn btn-outline" onClick={cancelLoad}>Hủy tải</button>}
      </div>}
      {loading && items.length > 0 && <div className="drama-feed-updating" role="status"><RefreshCw size={16} className="spin" /><span>Đang cập nhật danh sách phim, vẫn có thể duyệt kết quả trước đó…</span>
        <button className="btn btn-outline btn-sm" onClick={cancelLoad}>Hủy tải</button>
      </div>}
      {notice && items.length > 0 && <p className="drama-feed-notice" role="status">{notice}</p>}
      {error && items.length > 0 && <div className="drama-feed-update-error" role="alert">
        <span>Danh sách chưa được cập nhật: {error}{updatedAt ? ` (Vẫn hiển thị danh sách lúc ${clockOf(updatedAt)})` : ''}</span>
        <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => loadList(true)}>Thử lại</button>
      </div>}
      {!loading && !sourcesLoading && !selected && <div className="drama-feed-state" role={error ? 'alert' : 'status'}>
        <Film size={32} /><h3>{error ? 'Tạm thời chưa tải được danh sách phim' : !source ? 'Chưa có nguồn nào được bật, vui lòng thêm trong cài đặt' : 'Nguồn này tạm thời chưa trả về phim nào'}</h3>
        {error && <p>{error}</p>}
        <p>{ranking ? 'Có thể chuyển đổi kênh danh mục hoặc nguồn ở trên để tiếp tục khám phá phim ngắn.' : 'Có thể chuyển đổi nguồn ở trên để tiếp tục khám phá phim ngắn.'}</p>
        <div className="drama-feed-actions"><button className="btn btn-primary" disabled={!source} onClick={() => loadList(true)}>Tải lại</button>
          {onNavigate && <button className="btn btn-outline" onClick={() => onNavigate('download')}>Tìm kiếm theo tên phim</button>}</div>
      </div>}
      {selected && <>
        <div className="drama-feed-feature">
          <DramaPoster item={selected} />
          <div className="drama-feed-copy">
            <p className="drama-feed-rank">{ranking && selected.rank > 0 ? `Hạng ${selected.rank} BXH` : `Phim thứ ${index + 1} trong danh sách`}{ranking && selected.heat ? ` · ${translateGenre(selected.heat)}` : ''}</p>
            <h3>{selected.series_title}</h3>
            <DramaTitle title={selected.series_title} className="drama-feed-trans-title" showOriginal={false} />
            <p className="drama-feed-tags">{[selected.episode_count > 0 && `${selected.episode_count} tập`, ...(selected.tags || []).map(translateGenre)].filter(Boolean).join(' · ') || `Từ danh sách ${sourceLabel}`}</p>
            {typeof introduction === 'string' && introduction.trim() && <DramaDescription description={introduction} className="drama-feed-intro">{introduction}</DramaDescription>}
            <p className="drama-feed-play-note">Chọn tập, phát trong "Kho phim của tôi", tiếp tục xem từ lần trước.</p>
            <div className="drama-feed-actions"><button className="btn btn-primary" disabled={resolving} onClick={startItem}><Play size={16} />{resolving ? 'Đang mở kho phim…' : 'Phát trong kho phim'}</button>
              {resolving && <button className="btn btn-outline" onClick={() => { playController.current?.abort(); setResolving(false); setPlayError('Đã hủy tải, có thể thử lại phim này.'); }}>Hủy tải</button>}</div>
            {playError && <p className="drama-inline-error" role="alert">{playError}</p>}
          </div>
        </div>
        <div className="drama-feed-navigation">
          <span aria-live="polite">Phim thứ <strong>{index + 1}</strong> / {items.length} bộ</span>
          <div className="drama-feed-actions" role="group" aria-label="Chuyển đổi phim ngắn đề xuất">
            <button className="btn btn-outline" disabled={index === 0 || resolving} onClick={() => selectItem(index - 1)}>Phim trước</button>
            <button className="btn btn-outline" disabled={index === items.length - 1 || resolving} onClick={() => selectItem(index + 1)}>Phim tiếp theo</button>
          </div>
        </div>
        {upcoming.length > 0 ? <div className="drama-feed-upcoming"><h4>Xem tiếp theo</h4><div className="drama-feed-upcoming-list">
          {upcoming.map((item, offset) => <button key={item.series_id} className="drama-feed-next" disabled={resolving} onClick={() => selectItem(index + offset + 1)}>
            <DramaPoster item={item} /><span><strong>{item.series_title}</strong><small>{ranking && item.rank > 0 ? `Hạng ${item.rank} BXH` : `Phim thứ ${index + offset + 2} trong danh sách`}</small></span>
          </button>)}
        </div></div> : <p className="drama-feed-hint">Đã đến cuối danh sách phim lần này, hãy đổi nguồn hoặc lắc ngẫu nhiên để khám phá câu chuyện mới.</p>}
        <p className="drama-feed-source">{ranking ? `BXH đến từ ${catalogChannel === 'app' ? 'danh mục Hồng Quả App' : 'trang web công khai Hồng Quả'}, không phải gợi ý cá nhân hóa của tài khoản.` : `Danh sách phim đến từ danh mục hiện tại của ${sourceLabel}, không đại diện cho xếp hạng độ hot; việc phát tùy thuộc vào các tập khả dụng thực tế của nguồn.`}</p>
      </>}
    </>}
  </section>;
}

export default DramaFeed;
