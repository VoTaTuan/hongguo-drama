import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RefreshCw } from './icons';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { loadRandomPool, pickRandomDrama, playRecommendedDrama } from './randomDramaModel.mjs';
import { translateGenre } from './genreMap';
import './RandomDrama.css';

export function DramaPoster({ item, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item?.cover]);
  return <div className={`drama-poster ${className}`}>
    {item?.cover && !failed ? <img key={`${item.series_id}:${item.cover}`} src={item.cover} alt={`Poster ${item.series_title}`} onError={() => setFailed(true)} />
      : <div className="drama-poster-fallback"><Film size={36} /><span>Chưa có poster</span></div>}
  </div>;
}

function StoryTickets({ shaking }) {
  return <svg className={`story-tickets ${shaking ? 'is-shaking' : ''}`} viewBox="0 0 240 270" aria-hidden="true">
    <g className="story-tickets-sticks" fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="2.5">
      <rect x="67" y="42" width="25" height="155" rx="5" transform="rotate(-15 80 180)" />
      <rect x="105" y="28" width="25" height="169" rx="5" transform="rotate(-3 117 180)" />
      <rect x="139" y="45" width="25" height="152" rx="5" transform="rotate(14 151 180)" />
      <path d="m73 67 11-3m28-14 11-1m37 23 10 3" strokeLinecap="round" />
    </g>
    <path d="M52 116h136l-13 121c-1 10-109 10-110 0Z" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2.5" />
    <path d="M53 116q67 17 134 0M72 222q48 12 96 0" fill="none" stroke="var(--accent)" strokeWidth="2" />
    <rect x="98" y="151" width="44" height="52" rx="8" fill="var(--primary)" />
    <path d="m115 164 15 12-15 12Z" fill="white" />
    <path className="story-ticket-motion" d="m24 127-7 9 7 9m192-18 7 9-7 9" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export default function RandomDrama({ active, refreshKey = 0, onNavigate }) {
  const [source, setSource] = useState('all');
  const { sources: mediaSources, revision: sourceRevision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const [pool, setPool] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [playError, setPlayError] = useState('');
  const listController = useRef(null);
  const playController = useRef(null);
  const drawTimer = useRef(null);
  const previous = useRef(null);

  const load = useCallback(async (forceRefresh = false) => {
    listController.current?.abort();
    playController.current?.abort();
    clearTimeout(drawTimer.current);
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true); setShaking(false); setResolving(false); setSelected(null);
    setError(''); setPlayError(''); setPool([]); setUnavailable([]);
    try {
      const result = await loadRandomPool(options => window.electronAPI.browseList(options), { source, forceRefresh, signal: controller.signal, sources: mediaSources });
      if (controller.signal.aborted) return;
      setPool(result.items); setUnavailable(result.unavailable);
      if (!result.items.length) setError('Nguồn này hiện chưa có phim nào để quay. Hãy tải lại hoặc đổi nguồn khác.');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'Tải danh sách phim thất bại, vui lòng thử lại');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [source, mediaSources]);

  useEffect(() => {
    if (sourcesLoading) { setPool([]); setSelected(null); setResolving(false); setShaking(false); }
    if (source !== 'all' && !mediaSources.some(item => item.id === source)) { setSource('all'); return; }
    if (active && !sourcesLoading) load(refreshKey > 0);
    return () => {
      listController.current?.abort(); playController.current?.abort(); clearTimeout(drawTimer.current);
    };
  }, [active, load, refreshKey, sourceRevision, sourcesLoading]);

  const draw = () => {
    if (!active || loading || sourcesLoading || shaking || resolving) return;
    const next = pickRandomDrama(pool, previous.current);
    if (!next) { setError('Danh sách hiện chưa có phim khác. Hãy làm mới danh sách hoặc đổi nguồn khác.'); return; }
    setError(''); setPlayError(''); setShaking(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    drawTimer.current = setTimeout(() => {
      previous.current = next; setSelected(next); setShaking(false);
    }, reduced ? 0 : 620);
  };

  const play = async () => {
    if (!active || !selected || resolving || sourcesLoading) return;
    playController.current?.abort();
    const controller = new AbortController();
    playController.current = controller;
    setResolving(true); setPlayError('');
    try { await playRecommendedDrama(window.electronAPI, selected, { signal: controller.signal }); }
    catch (cause) { if (!controller.signal.aborted) setPlayError(cause.message || 'Mở thất bại, vui lòng thử lại'); }
    finally { if (!controller.signal.aborted) setResolving(false); }
  };

  const sourceLabel = id => mediaSourceLabel(id, mediaSources);
  return <div className="random-drama">
    <div className="random-drama-toolbar">
      <p>Ngại chọn phim? Hãy để ống quay chọn ngẫu nhiên tập tiếp theo.</p>
      <label>Phạm vi quay<select value={source} onChange={event => setSource(event.target.value)}>
        <option value="all">Tất cả nguồn</option>{mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select></label>
    </div>
    <div className={`random-drama-stage ${selected ? 'has-result' : ''}`}>
      <div className="random-drama-ritual">
        <button className="story-ticket-button" onClick={draw} disabled={loading || sourcesLoading || shaking || resolving || !pool.length}
          aria-label={selected ? 'Lắc ống quay, chọn phim khác' : 'Lắc ống quay, chọn một bộ phim'}>
          <StoryTickets shaking={shaking} />
          <span>{shaking ? 'Phim hay sắp hé lộ…' : selected ? 'Bấm để quay bộ khác' : 'Bấm để quay ngẫu nhiên'}</span>
        </button>
        {!selected && <div className="random-drama-opening"><h3>Khám phá phim đầy bất ngờ</h3><p>Mỗi lượt quay một bộ phim, thấy thích là xem ngay.</p></div>}
      </div>
      {selected && <div className="random-drama-result" aria-live="polite">
        <DramaPoster item={selected} />
        <div className="random-drama-result-copy"><p className="drama-source-label">{sourceLabel(selected.source)} · Quay ngẫu nhiên</p>
          <h3>{selected.series_title}</h3>
          {selected.episode_count > 0 && <p>Tổng {selected.episode_count} tập</p>}
          {selected.tags?.length > 0 && <p className="random-drama-tags">{selected.tags.map(translateGenre).join(' · ')}</p>}
          <div className="random-drama-actions">
            <button className="btn btn-primary" disabled={resolving || shaking} onClick={play}><Play size={16} />{resolving ? 'Đang mở…' : 'Phát trong kho phim'}</button>
            <button className="btn btn-outline" disabled={resolving || shaking} onClick={draw}><RefreshCw size={15} />Quay lại</button>
          </div>
          {resolving && <button className="drama-text-button" onClick={() => { playController.current?.abort(); setResolving(false); setPlayError('Đã hủy tải, bạn có thể thử lại hoặc quay phim khác.'); }}>Hủy tải</button>}
          {playError && <p className="drama-inline-error" role="alert">{playError}</p>}
        </div>
      </div>}
    </div>
    <div className="random-drama-status" aria-live="polite">
      {loading || sourcesLoading ? <><p><RefreshCw size={14} className="spin" />Đang chuẩn bị danh sách phim vào ống quay…</p><button className="drama-text-button" onClick={() => {
        listController.current?.abort(); setLoading(false); setError('Đã hủy tải. Bạn có thể tải lại hoặc đổi nguồn khác.');
      }}>Hủy tải</button></> : <>
        {error ? <p role="alert">{error}</p> : <p>Đã chuẩn bị {pool.length} phim · Không trùng lặp liên tiếp</p>}
        {unavailable.length > 0 && pool.length > 0 && <p>{unavailable.map(sourceLabel).join(', ')} tạm thời chưa lấy được danh sách, lượt này lấy từ các nguồn còn lại.</p>}
        {(error || unavailable.length > 0) && <button className="drama-text-button" onClick={() => load(true)}>Tải lại danh sách phim</button>}
        {!pool.length && onNavigate && <button className="drama-text-button" onClick={() => onNavigate('download')}>Tìm kiếm theo tên phim</button>}
      </>}
    </div>
    {sourcesError && <p className="random-drama-note" role="status">Cập nhật danh sách nguồn thất bại, tạm thời dùng danh sách cũ; bạn có thể cấu hình lại nguồn trong Cài đặt.</p>}
    <p className="random-drama-note">Quay ngẫu nhiên từ danh mục nguồn đã chọn, không đại diện cho bảng xếp hạng. Việc phát phụ thuộc vào các tập khả dụng của nguồn.</p>
  </div>;
}
