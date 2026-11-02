import React, { useState, useRef, useEffect } from 'react';
import './HongguoDownload.css';
import { Search, Film, RefreshCw, ExternalLink, Globe } from './icons';
import { isSubmitKey } from './episodeRange';
import { readSearchHistory, saveSearchTerm, removeSearchTerm, clearSearchHistory, rememberCatalogTitles, getSearchSuggestions } from '../searchHistory';

import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { rankSearchResults } from './searchRanking.mjs';
import { DramaTitle } from './TranslatedText';
import { translateQueryToChinese, hasChinese } from '../services/translator';

const SEARCH_SAFETY_TIMEOUT_MS = 25000;

/**
 * SearchPanel —— Tìm kiếm phim ngắn theo nguồn đã chọn
 * Sau khi lấy được series_id sẽ chuyển cho component cha xử lý quy trình "lấy toàn bộ tập + chọn tập tải xuống".
 */
function SearchPanel({ onSelectSeries, onSwitchToInput, active = true }) {
  const [source, setSource] = useState('all');
  const { sources: mediaSources, revision: sourceRevision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const requestVersion = useRef(0);
  const pendingSearch = useRef(null);
  useEffect(() => () => { requestVersion.current++; cancelMore(); }, []);
  const [keyword, setKeyword] = useState('');
  const [history, setHistory] = useState(readSearchHistory);
  const [historyError, setHistoryError] = useState('');
  const inputRef = useRef(null);
  const suggestions = getSearchSuggestions(keyword, history);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // null=chưa tìm kiếm, []=không có kết quả
  const [error, setError] = useState('');
  const [searchWarning, setSearchWarning] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [translatedQuery, setTranslatedQuery] = useState('');
  const actualQueryRef = useRef('');
  const [more, setMore] = useState({});
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  const moreRequest = useRef(null);
  const [pickingId, setPickingId] = useState('');
  const cancelMore = () => {
    clearTimeout(moreRequest.current?.timer);
    moreRequest.current = null;
  };

  useEffect(() => {
    if (!active) {
      requestVersion.current++;
      pendingSearch.current = null;
      setPickingId('');
      setLoading(false);
      cancelMore(); setMoreLoading(false); setMoreError('');
    }
  }, [active]);

  useEffect(() => {
    requestVersion.current++; pendingSearch.current = null;
    setLoading(false); setPickingId(''); setResults(null); setError(''); setSearchWarning(''); setPageTitle(''); setMore({}); setMoreError(''); setMoreLoading(false); cancelMore();
    if (source !== 'all' && !mediaSources.some(item => item.id === source)) setSource('all');
  }, [sourceRevision, mediaSources]);

  const switchSource = (next) => {
    if (next === source) return;
    requestVersion.current++;
    pendingSearch.current = null;
    setSource(next);
    setTranslatedQuery('');
    actualQueryRef.current = '';
    setLoading(false);
    setPickingId('');
    setResults(null);
    setError('');
    setSearchWarning('');
    setPageTitle('');
    setMore({}); setMoreError(''); setMoreLoading(false); cancelMore();
  };

  const changeKeyword = (value) => {
    requestVersion.current++;
    pendingSearch.current = null;
    setKeyword(value);
    setTranslatedQuery('');
    actualQueryRef.current = '';
    setLoading(false);
    setPickingId('');
    setResults(null);
    setError('');
    setSearchWarning('');
    setMore({}); setMoreError(''); setMoreLoading(false); cancelMore();
  };

  const clearHistory = () => {
    try {
      clearSearchHistory();
      setHistory([]);
      setHistoryError('');
    } catch {
      setHistoryError('Xóa lịch sử tìm kiếm thất bại, vui lòng thử lại.');
    }
  };

  const removeHistory = (term) => {
    try {
      setHistory(removeSearchTerm(term));
      setHistoryError('');
    } catch {
      setHistoryError('Xóa mục lịch sử tìm kiếm này thất bại, vui lòng thử lại.');
    }
  };

  const doSearch = async () => {
    if (sourcesLoading) return;
    const kw = keyword.trim();
    if (!kw) {
      setError('Vui lòng nhập từ khóa tên phim');
      return;
    }
    const key = JSON.stringify([source, kw]);
    if (pendingSearch.current?.key === key) return;
    const request = ++requestVersion.current;
    pendingSearch.current = { key, request };
    setPickingId('');
    setLoading(true);
    setError('');
    setSearchWarning('');
    setResults(null);
    setPageTitle('');
    setMore({}); setMoreError(''); setMoreLoading(false); cancelMore();
    setSearchedKeyword(kw);

    // Tự động dịch từ khóa tiếng Việt sang tiếng Trung để tìm trên kho phim Hồng Quả
    let queryToSearch = kw;
    let zhTranslation = '';
    if (!hasChinese(kw)) {
      try {
        zhTranslation = await translateQueryToChinese(kw);
        if (zhTranslation && zhTranslation !== kw) {
          queryToSearch = zhTranslation;
        }
      } catch (_) {}
    }
    if (request !== requestVersion.current) return;
    setTranslatedQuery(zhTranslation && zhTranslation !== kw ? zhTranslation : '');
    actualQueryRef.current = queryToSearch;

    const sources = source === 'all' ? mediaSources.map(item => item.id) : [source];
    const settled = new Array(sources.length);
    const publishPartial = () => {
      if (request !== requestVersion.current) return;
      const merged = [], nextMore = {};
      sources.forEach((searchSource, index) => {
        const entry = settled[index];
        if (entry?.status !== 'fulfilled') return;
        merged.push(...(entry.value.results || []).map(item => ({ ...item, source: searchSource })));
        if (entry.value.channel && entry.value.channel !== 'dom' && entry.value.hasMore) {
          nextMore[searchSource] = { channel: entry.value.channel, cursor: entry.value.cursor || null, page: entry.value.page || 1, hasMore: true };
        }
      });
      if (merged.length) setResults(rankSearchResults(merged, queryToSearch));
      if (sources.length === 1) setPageTitle(settled[0]?.value?.pageTitle || '');
      // Do not offer pagination until every source has settled; otherwise the button can shift under the user.
      if (sources.every((_, index) => settled[index])) setMore(nextMore);
    };
    const applyResponses = (timedOut) => {
      const merged = [], failures = [], warnings = [], nextMore = {};
      sources.forEach((searchSource, index) => {
        const entry = settled[index];
        if (!entry) {
          if (timedOut) failures.push(`${mediaSourceLabel(searchSource, mediaSources)}: Tìm kiếm quá thời gian, không có kết quả trả về`);
          return;
        }
        if (entry.status === 'fulfilled') {
          merged.push(...(entry.value.results || []).map(item => ({ ...item, source: searchSource })));
          if (entry.value.partial) warnings.push(`${mediaSourceLabel(searchSource, mediaSources)}: ${entry.value.error || 'Tìm kiếm bổ sung chưa hoàn thành, có thể thử lại sau.'}`);
          if (entry.value.meta?.relaxed) warnings.push(`${mediaSourceLabel(searchSource, mediaSources)}: Không có phim khớp chính xác tên, đã dùng「${entry.value.meta.relaxedQuery}」để tìm bổ sung.`);
          if (entry.value.meta?.newRelease && entry.value.via !== 'app-new') warnings.push(`${mediaSourceLabel(searchSource, mediaSources)}: Trang web tạm thời không trả về kết quả cùng tên, đã tìm bổ sung ${entry.value.meta.newRelease} bộ từ phim mới trên App.`);
          if (sources.length === 1) setPageTitle(entry.value.pageTitle || '');
          if (entry.value.channel && entry.value.channel !== 'dom' && entry.value.hasMore) {
            nextMore[searchSource] = { channel: entry.value.channel, cursor: entry.value.cursor || null, page: entry.value.page || 1, hasMore: true };
          }
        } else {
          failures.push(`${mediaSourceLabel(searchSource, mediaSources)}: ${entry.reason?.message || 'Tìm kiếm thất bại'}`);
        }
      });
      rememberCatalogTitles(merged);
      if (settled.some(entry => entry?.status === 'fulfilled')) {
        try {
          setHistory(saveSearchTerm(kw));
          setHistoryError('');
        } catch {
          setHistoryError('Kết quả tìm kiếm đã hiển thị, nhưng lưu lịch sử tìm kiếm vào máy thất bại.');
        }
      }
      setResults(rankSearchResults(merged, queryToSearch));
      setMore(nextMore);
      setSearchWarning(warnings.join('; '));
      if (failures.length) setError(`${failures.join('; ')}. ${merged.length ? 'Đã hiển thị kết quả từ nguồn khác. ' : ''}Vui lòng thử lại hoặc đổi nguồn.`);
    };
    const safety = setTimeout(() => {
      if (request !== requestVersion.current) return;
      requestVersion.current++;
      pendingSearch.current = null;
      applyResponses(true);
      setLoading(false);
    }, SEARCH_SAFETY_TIMEOUT_MS);
    try {
      // Ghi nhận ngay khi mỗi nguồn hoàn thành; khi chạm ngưỡng hết giờ tổng vẫn có thể hiển thị kết quả của các nguồn đã xong.
      const responses = await Promise.allSettled(sources.map((searchSource, index) => window.electronAPI.searchSeries(queryToSearch, { source: searchSource })
        .then(res => {
          if (!res?.success) throw new Error(res?.error || 'Tìm kiếm thất bại, vui lòng thử lại');
          const entry = { status: 'fulfilled', value: res };
          settled[index] = entry;
          publishPartial();
          return entry;
        })
        .catch(error => {
          const entry = { status: 'rejected', reason: error };
          settled[index] = entry;
          publishPartial();
          throw error;
        })));
      if (request !== requestVersion.current) return;
      responses.forEach((entry, index) => { settled[index] ||= entry; });
      applyResponses(false);
    } catch (e) {
      if (request !== requestVersion.current) return;
      // allSettled thông thường không reject; giữ đường dẫn phòng vệ để tránh ngoại lệ đồng bộ khiến vòng quay tải bị kẹt.
      settled.forEach((entry, index) => { if (!entry) settled[index] = { status: 'rejected', reason: e }; });
      applyResponses(false);
    } finally {
      clearTimeout(safety);
      if (pendingSearch.current?.request === request) pendingSearch.current = null;
      if (request === requestVersion.current) setLoading(false);
    }
  };

  // Chọn một bộ phim -> Lấy danh sách tập đầy đủ -> Chuyển sang trang tải xuống
  const pick = async (item) => {
    const request = ++requestVersion.current;
    pendingSearch.current = null;
    setLoading(false);
    setPickingId(item.series_id);
    setError('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (request !== requestVersion.current) return;
      if (res && res.success && res.data) {
        onSelectSeries(res.data);
      } else {
        setError((res && res.error) || 'Lấy danh sách tập thất bại');
      }
    } catch (e) {
      if (request === requestVersion.current) setError('Lỗi lấy danh sách tập: ' + e.message);
    } finally {
      if (request === requestVersion.current) setPickingId('');
    }
  };

  const showBrowser = async () => {
    try {
      const term = (searchedKeyword || keyword).trim();
      const sourceUrl = term ? `https://hongguoduanju.com/search/${encodeURIComponent(term)}` : undefined;
      const res = await window.electronAPI.searchWindowShow(true, sourceUrl);
      if (res?.success === false) throw new Error(res.error || 'Mở trang nguồn thất bại');
    } catch (e) { setError(e.message || 'Mở trang nguồn thất bại, vui lòng thử lại'); }
  };

  const loadMore = async () => {
    const entries = Object.entries(more).filter(([, state]) => state.hasMore);
    const kw = (actualQueryRef.current || searchedKeyword).trim();
    if (!active || sourcesLoading || moreRequest.current || !kw || !entries.length) return;
    const request = { responses: new Map(), timer: null };
    moreRequest.current = request;
    setMoreLoading(true); setMoreError('');
    const finish = (timedOut = false) => {
      if (moreRequest.current !== request) return;
      cancelMore();
      const nextMore = { ...more }, additions = [], errors = [];
      for (const [searchSource, state] of entries) {
        const response = request.responses.get(searchSource);
        if (response?.success) {
          additions.push(...(response.results || []).map(item => ({ ...item, source: searchSource })));
          if (response.hasMore) nextMore[searchSource] = { channel: response.channel || state.channel, cursor: response.cursor || null, page: response.page || state.page + 1, hasMore: true };
          else delete nextMore[searchSource];
        } else {
          errors.push(`${mediaSourceLabel(searchSource, mediaSources)}: ${response?.error || (timedOut && !response ? 'Tải thêm quá thời gian, vui lòng thử lại' : 'Tải thêm thất bại')}`);
        }
      }
      if (additions.length) {
        setResults(prev => {
          const map = new Map((prev || []).map(item => [`${item.source}:${item.series_id}`, item]));
          for (const item of additions) map.set(`${item.source}:${item.series_id}`, item);
          return rankSearchResults([...map.values()], kw);
        });
      }
      setMore(nextMore);
      setMoreError(errors.join('; '));
      setMoreLoading(false);
    };
    // Preserve completed sources at the deadline; late IPC replies cannot alter the next request.
    request.timer = setTimeout(() => finish(true), SEARCH_SAFETY_TIMEOUT_MS);
    await Promise.all(entries.map(async ([searchSource, state]) => {
      let response;
      try {
        response = await window.electronAPI.searchSeriesMore(kw, { source: searchSource, channel: state.channel, cursor: state.cursor, page: state.page + 1 });
      } catch (error) { response = { success: false, error: error.message }; }
      if (moreRequest.current === request) request.responses.set(searchSource, response);
    }));
    finish();
  };

  const matchedCount = results ? results.filter(item => item.relevance < 2).length : 0;
  const contentCount = results ? results.filter(item => item.relevance === 2 && !item.fuzzy).length : 0;
  const fuzzyCount = results ? results.filter(item => item.fuzzy).length : 0;
  const otherCount = results ? results.filter(item => item.relevance > 2 && !item.fuzzy).length : 0;

  return (
    <div className="hongguo-card">
      <div className="card-header-title">
        <Search size={18} />
        <span>Tìm kiếm phim ngắn</span>
        <label className="source-control">Nguồn<select className="input-field" aria-label="Nguồn phim ngắn" value={source} onChange={(e) => switchSource(e.target.value)}><option value="all">Tất cả nguồn</option>{mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>

      {sourcesError && <p className="settings-hint" role="status">Cập nhật danh sách nguồn thất bại, tạm dùng danh sách cũ; có thể lưu lại nguồn trong cài đặt rồi thử lại.</p>}
      <div className="input-group">
        <input
          type="text"
          className="input-field"
          aria-label="Tìm kiếm tên phim ngắn"
          aria-describedby="search-suggestions-hint"
          ref={inputRef}
          list="local-search-suggestions"
          autoComplete="off"
          placeholder="Nhập tên phim ngắn, ví dụ: Nhất Thôn Nhân Dưỡng Nhất Cá Thần"
          value={keyword}
          onChange={(e) => changeKeyword(e.target.value)}
          onKeyDown={(e) => isSubmitKey(e) && doSearch()}
        />
        <button className="btn btn-primary" onClick={doSearch} disabled={loading || sourcesLoading}>
          {loading ? (
            <>
              <RefreshCw size={16} className="spin" />
              <span>Đang tìm...</span>
            </>
          ) : (
            <>
              <Search size={16} />
              <span>Tìm kiếm</span>
            </>
          )}
        </button>
      </div>
      <datalist id="local-search-suggestions">
        {suggestions.map(({ term, source: origin }) => <option key={term} value={term} label={origin} />)}
      </datalist>
      <p className="settings-hint search-suggestions-hint" id="search-suggestions-hint">Gợi ý trên máy: Khớp với lịch sử tìm kiếm và các tên phim thực tế đã duyệt lần này.</p>
      {history.length > 0 && <div className="search-history">
        <div className="search-history-heading"><span>Lịch sử tìm kiếm</span><button type="button" className="btn-chip" onClick={clearHistory}>Xóa lịch sử</button></div>
        <div className="search-history-terms">{history.map((term) => <span className="search-history-term" key={term}><button type="button" className="btn-chip" title={term} onClick={() => { changeKeyword(term); inputRef.current?.focus(); }}>{term}</button><button type="button" className="search-history-remove" aria-label={`Xóa lịch sử tìm kiếm: ${term}`} title="Xóa mục lịch sử này" onClick={() => removeHistory(term)}>×</button></span>)}</div>
      </div>}
      {historyError && <p className="search-history-error" role="alert">{historyError}</p>}
      <p className="settings-hint" style={{ marginTop: 8 }}>
        {source === 'all' ? 'Đồng thời tìm kiếm trên tất cả nguồn đã bật, kết quả có đánh dấu nguồn; chọn một bộ để xem toàn bộ tập.' : 'Tìm kiếm theo tên phim, chọn một bộ để xem toàn bộ tập.'}
      </p>

      {translatedQuery && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          marginTop: '10px',
          background: 'var(--bg-inset, rgba(59, 130, 246, 0.08))',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--text-secondary)'
        }}>
          <Globe size={15} style={{ color: 'var(--primary, #e50914)', flexShrink: 0 }} />
          <span>
            Đã tự động dịch từ khóa sang tiếng Trung: <strong>{searchedKeyword}</strong> ➔ <strong style={{ color: 'var(--primary, #e50914)' }}>{translatedQuery}</strong> để tìm trên nguồn phim.
          </span>
        </div>
      )}

      {results === null && !loading && !error && (
        <div className="search-welcome"><Search size={36} /><h3>Câu chuyện hay, bắt đầu từ một cái tên</h3><p>Nhập tên phim đầy đủ hoặc từ khóa để tìm phim ngắn bạn muốn xem.</p></div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {searchWarning && <p className="settings-hint" role="status">{searchWarning} Đã hiển thị kết quả tìm được đợt này.</p>}

      {loading && (
        <div className="search-loading">
          <RefreshCw size={18} className="spin" />
          <span>Đang tìm kiếm phim ngắn liên quan, lần tải đầu tiên có thể mất vài giây…</span>
        </div>
      )}

      {results && results.length === 0 && !loading && !error && (
        <div className="search-empty">
          <p>
            Không tìm thấy phim ngắn liên quan cho từ khóa "{searchedKeyword}"
            {translatedQuery ? ` (tiếng Trung: "${translatedQuery}")` : ''}
            {pageTitle ? ` (Tiêu đề trang: ${pageTitle})` : ''}
          </p>
          <div className="search-empty-actions">
            {source === 'hongguo' && <button className="btn btn-outline" onClick={showBrowser}>
              <ExternalLink size={15} />
              Mở trang nguồn
            </button>}
            {source === 'hongguo' && onSwitchToInput && (
              <button className="btn btn-outline" onClick={onSwitchToInput}>
                Chuyển sang Tải bằng liên kết / ID
              </button>
            )}
          </div>
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <div className="search-count">Tìm thấy {matchedCount} phim khớp tiêu đề{contentCount ? `, thêm ${contentCount} phim có cốt truyện nhắc đến từ này (xếp sau)` : ''}{fuzzyCount ? `, thêm ${fuzzyCount} kết quả tìm bổ sung` : ''}{otherCount ? `, thêm ${otherCount} kết quả khác do nguồn trả về (xếp sau)` : ''}</div>
          <div className="search-grid">
            {results.map((item) => (
              <button
                type="button"
                disabled={pickingId !== ''}
                key={`${item.source}:${item.series_id}`}
                className={`search-card ${pickingId === item.series_id ? 'picking' : ''}`}
                onClick={() => pickingId === '' && pick(item)}
                title={`Nhấn để xem và tải về: ${item.series_title}`}
              >
                <div className="search-cover">
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder">
                      <Film size={22} />
                    </div>
                  )}
                </div>
                <div className="search-card-body">
                  <DramaTitle title={item.series_title} className="search-card-title">{item.series_title}</DramaTitle>
                  <div className="search-card-sub">
                    {pickingId === item.series_id ? (
                      <>
                        <RefreshCw size={13} className="spin" /> Đang lấy danh sách tập…
                      </>
                    ) : (
                      <><span className="badge">{mediaSourceLabel(item.source, mediaSources)}</span>{item.new_release && <span className="badge-new">{item.released_today ? 'Mới hôm nay' : 'Phim mới trên App'}</span>}{item.fuzzy ? 'Tìm bổ sung · Xem các tập' : item.relevance === 2 ? 'Liên quan cốt truyện · Xem các tập' : item.relevance > 2 ? 'Kết quả khác · Xem các tập' : 'Xem các tập'}</>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {Object.values(more).some(state => state.hasMore) && (
            <div className="search-more">
              <button type="button" className="btn btn-outline" disabled={moreLoading} onClick={loadMore}>
                {moreLoading ? 'Đang tải…' : 'Tải thêm'}
              </button>
              {moreError && <span role="alert">{moreError}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SearchPanel;
