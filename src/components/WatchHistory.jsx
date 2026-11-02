import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Clock } from './icons';
import './WatchHistory.css';
import { groupHistory } from './historyGroups.mjs';
import { DramaTitle } from './TranslatedText';

const SafeDramaTitle = typeof DramaTitle === 'function' ? DramaTitle : null;

const PREFERENCES_KEY = 'hongguo:watch-history-preferences';

export default function WatchHistory({ active = true, onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkingRow, setCheckingRow] = useState('');
  const [opening, setOpening] = useState('');
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState({});
  const [decisions, setDecisions] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('hongguo:history-groups')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
  });
  const decide = (id, target) => {
    const next = { ...decisions };
    if (target === undefined) delete next[id]; else next[id] = target;
    try { localStorage.setItem('hongguo:history-groups', JSON.stringify(next)); setDecisions(next); }
    catch { setError('分组未能保存，请检查本地存储后重试'); }
  };
  const [filter, setFilter] = useState('all');
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY));
      return {
        scope: ['all', 'latest', 'unfinished', 'skip-completed-low'].includes(saved?.scope) ? saved.scope : 'all',
        hideLowSeasons: saved?.hideLowSeasons === true,
      };
    } catch { return { scope: 'all', hideLowSeasons: false }; }
  });
  const { scope, hideLowSeasons } = preferences;
  const [progress, setProgress] = useState(null);
  const request = useRef(0);
  const openingRef = useRef(false);
  const openingRequest = useRef(0);
  const groups = groupHistory(rows, decisions);
  const groupById = new Map(groups.flatMap(items => items.map(row => [row.series_id, items])));
  const listedRows = groups.flatMap(items => hideLowSeasons && !expanded[items[0].series_id] ? items.slice(0, 1) : items);
  const completedCount = listedRows.filter(row => row.completed === true).length;
  const visibleRows = listedRows.filter(row => filter === 'all' || (row.completed === true) === (filter === 'completed'));

  const savePreferences = next => {
    setPreferences(next);
    try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); }
    catch { setStatus('Lựa chọn lần này đã có hiệu lực, nhưng chưa được lưu; sau khi khởi động lại có thể trở về mặc định.'); }
  };

  const load = async () => {
    const version = ++request.current;
    try {
      const result = await window.electronAPI.getWatchHistory();
      if (version !== request.current) return;
      if (!result?.success) throw new Error(result?.error || 'Tải lịch sử xem thất bại');
      setRows(result.results || []);
      setError('');
    } catch (failure) {
      if (version === request.current) setError(failure.message || 'Tải lịch sử xem thất bại, vui lòng thử lại');
    } finally { if (version === request.current) setLoading(false); }
  };

  useLayoutEffect(() => {
    setOpening(''); openingRef.current = false;
    return () => { openingRequest.current++; openingRef.current = false; };
  }, [active]);
  useEffect(() => {
    if (active) load();
    return () => { request.current++; };
  }, [active]);
  useEffect(() => window.electronAPI.onWatchHistoryUpdated?.(() => { if (active) load(); }), [active]);
  useEffect(() => window.electronAPI.onWatchHistoryProgress?.(data => { if (active) setProgress(data); }), [active]);

  const checkUpdates = async () => {
    setChecking(true); setStatus(''); setError(''); setProgress(null);
    try {
      const result = await window.electronAPI.refreshWatchHistory({ scope });
      if (!result?.success) throw new Error(result?.error || 'Kiểm tra thất bại, vui lòng thử lại');
      await load();
      setStatus(`Đã kiểm tra ${result.checked} bộ${result.failed ? `，${result.failed} bộ chưa hoàn thành, có thể thử lại sau` : ''}${result.remaining ? `；trong đợt này còn ${result.remaining} bộ, nhấn để tiếp tục kiểm tra` : ''}`);
    } catch (failure) { setError(failure.message || 'Kiểm tra thất bại, vui lòng thử lại'); }
    finally { setChecking(false); setProgress(null); }
  };

  const checkRow = async (row) => {
    if (checking || checkingRow) return;
    setCheckingRow(row.series_id); setStatus(''); setError('');
    try {
      const result = await window.electronAPI.checkWatchHistoryItem(row.series_id);
      if (!result?.success) throw new Error(result?.error || 'Kiểm tra thất bại, vui lòng thử lại');
      await load();
      setStatus(result.error
        ? `Các tập của《${row.series_title}》đã được kiểm tra; kiểm tra phần tiếp theo chưa hoàn thành: ${result.error}`
        : `《${row.series_title}》${result.checked ? 'đã kiểm tra xong' : 'không có cập nhật nào'}.`);
    } catch (failure) {
      await load();
      setError(failure.message || 'Kiểm tra thất bại, vui lòng thử lại');
    }
    finally { setCheckingRow(''); }
  };

  const remove = async (row) => {
    setRemoving(row.series_id); setError(''); setStatus('');
    try {
      const result = await window.electronAPI.removeWatchHistory(row.series_id);
      if (!result?.success) throw new Error(result?.error || 'Xóa thất bại, vui lòng thử lại');
      setRows(current => current.filter(item => item.series_id !== row.series_id));
      setStatus(`Đã xóa lịch sử xem của《${row.series_title}》, tệp video không bị ảnh hưởng.`);
      void load();
    } catch (failure) { setError(failure.message || 'Xóa thất bại, vui lòng thử lại'); }
    finally { setRemoving(''); }
  };

  const resume = async (row, sequel = null) => {
    if (!active || openingRef.current) return;
    const version = ++openingRequest.current;
    openingRef.current = true;
    setOpening(row.series_id); setError('');
    try {
      if (sequel) {
        let result = await window.electronAPI.playSeries({ seriesId: sequel.series_id, vidIndex: 1 });
        if (!result?.success && version !== openingRequest.current) return;
        if (!result?.success && result?.code === 'SERIES_NOT_FOUND') {
          const detail = await window.electronAPI.searchResolve(sequel.series_id);
          if (version !== openingRequest.current) return;
          if (!detail?.success) throw new Error(detail?.error || 'Chi tiết phần tiếp theo tạm thời không khả dụng');
          const episode = detail.data?.episodes?.find(item => !item.locked);
          if (!episode) throw new Error('Phần tiếp theo tạm thời chưa có tập nào phát được');
          result = await window.electronAPI.playSeries({ seriesId: sequel.series_id, vidIndex: episode.vid_index });
        }
        if (!result?.success) throw new Error(result?.error || 'Mở trình phát thất bại');
      } else {
        const result = await window.electronAPI.playSeries({ seriesId: row.series_id, vidIndex: row.vid_index, resume: true });
        if (!result?.success) throw new Error(result?.error || 'Mở trình phát thất bại');
      }
      // An unconfirmed title match must not clear the original show's update markers.
      if (sequel && row.similarSeries?.some(item => item.series_id === sequel.series_id)) return;
      const acknowledged = await window.electronAPI.acknowledgeWatchUpdates(row.series_id, { total: row.total, sequelIds: (row.sequels || []).map(item => item.series_id) });
      if (!acknowledged?.success) throw new Error(acknowledged?.error || 'Lưu đánh dấu cập nhật thất bại');
      if (version === openingRequest.current) setRows(current => current.map(item => item.series_id === row.series_id ? { ...item, hasUpdates: false, unreadEpisodes: 0 } : item));
    } catch (failure) { if (version === openingRequest.current) setError(failure.message || 'Mở thất bại, vui lòng thử lại'); }
    finally { if (version === openingRequest.current) { setOpening(''); openingRef.current = false; } }
  };

  const emptyTitle = hideLowSeasons
    ? filter === 'completed' ? 'Trong các phần mới nhất không có phim ngắn nào đã xem xong' : 'Trong các phần mới nhất không có phim ngắn nào chưa xem xong'
    : filter === 'completed' ? 'Chưa có phim ngắn nào đã xem xong' : 'Không có phim ngắn nào chưa xem xong';

  return <section className="history-container" aria-labelledby="history-title">
    <div className="history-header">
      <div><h1 id="history-title">Lịch sử xem</h1><p>Tiếp tục câu chuyện lần trước. Nhật ký chỉ được lưu trên máy tính này.</p></div>
      <div className="history-tools">
        <select className="history-scope" value={scope} onChange={event => savePreferences({ ...preferences, scope: event.target.value })} disabled={checking || !!checkingRow || loading} aria-label="Phạm vi kiểm tra hàng loạt">
          <option value="all">Toàn bộ lịch sử</option>
          <option value="latest">Chỉ phần mới nhất</option>
          <option value="unfinished">Chỉ phim chưa xem xong</option>
          <option value="skip-completed-low">Loại trừ phần cũ đã xem xong</option>
        </select>
        <button className="btn btn-outline" onClick={checkUpdates} disabled={checking || !!checkingRow || loading || !rows.length}>
          <RefreshCw size={15} className={checking ? 'spin' : ''} />{checking ? 'Đang kiểm tra cập nhật…' : 'Kiểm tra cập nhật'}
        </button>
      </div>
    </div>
    <p className="history-hint">Tự động kiểm tra tập mới trong khi chạy; nhiều phần của cùng một bộ phim sẽ dùng chung một lần tìm kiếm phần tiếp theo, các phần cũ đã xem xong được kiểm tra mỗi 24 giờ một lần. Phần mới mang mã phim khác sẽ được gắn nhãn "Nghi là phần tiếp theo". Có thể tắt kiểm tra hoặc bật thông báo hệ thống trong cài đặt.</p>
    <div className="history-filter-bar">
      <div className="history-filter" role="group" aria-label="Lọc tiến độ xem">
        {[
          ['all', 'Tất cả', listedRows.length],
          ['unfinished', 'Chưa xong', listedRows.length - completedCount],
          ['completed', 'Đã xong', completedCount],
        ].map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} disabled={loading} onClick={() => setFilter(value)}>{label} {count}</button>)}
      </div>
      <label className="history-display-option" title="Chỉ điều chỉnh danh sách hiện tại; phạm vi kiểm tra hàng loạt không đổi và không xóa lịch sử">
        <input type="checkbox" checked={hideLowSeasons} disabled={loading} onChange={event => savePreferences({ ...preferences, hideLowSeasons: event.target.checked })} />
        <span>Thu gọn phần cũ cùng bộ phim</span>
      </label>
    </div>
    <p className="history-hint">Xác định theo tiến độ đoạn kết của tập cuối hiện tại; sau khi ẩn phần cũ, số đếm chỉ đại diện cho các phần trong danh sách, bản ghi cũ có thể hiển thị chưa xem xong.</p>
    {error && <div className="history-error" role="alert"><span>{error}</span><button className="btn btn-outline btn-sm" onClick={load}>Tải lại</button></div>}
    {status && <p className="history-hint" role="status">{status}</p>}
    {checking && progress?.total > 0 && <p className="history-hint" role="status">
      Đang kiểm tra {(progress.checked || 0) + (progress.failed || 0) + (progress.skipped || 0)} / {progress.total}{progress.current ? `: ${progress.current}` : ''}
    </p>}
    {loading ? <p role="status">Đang đọc lịch sử xem…</p> : !rows.length ? <div className="history-empty">
      <Clock size={30} /><h2>Chưa có lịch sử xem</h2><p>Sau khi bạn thực sự bắt đầu phát, phim ngắn và tiến độ sẽ xuất hiện tại đây.</p>
      <button className="btn btn-primary" onClick={() => onNavigate?.('browse')}>Khám phá phim ngắn</button>
    </div> : !visibleRows.length ? <div className="history-empty" role="status">
      <Clock size={30} /><h2>{emptyTitle}</h2>
      <button type="button" className="btn btn-outline" onClick={() => setFilter('all')}>Xem tất cả</button>
    </div> : <ul className="history-list">{visibleRows.map(row => <li className={`history-row ${groupById.get(row.series_id)?.[0] !== row ? 'history-child' : ''}`} key={row.series_id}>
      <div className="history-main">
      <button className="history-resume" onClick={() => resume(row)} disabled={!active || !!opening || !!removing} aria-label={`Tiếp tục xem ${row.series_title} tập ${row.vid_index}${row.hasUpdates ? `, có cập nhật${row.unreadEpisodes ? `, thêm ${row.unreadEpisodes} tập mới` : ', phát hiện nghi là phần tiếp theo'}` : ''}`}>
        {row.cover ? <img className="history-cover" src={row.cover} alt="" loading="lazy" /> : <span className="history-cover history-cover-empty"><Play size={20} /></span>}
        <span className="history-copy">
          <span className="history-name">{row.completed && <span className="history-completed">Đã xem xong · </span>}{row.hasUpdates && <span className="history-dot" role="img" aria-label="Có cập nhật" />}{SafeDramaTitle ? <SafeDramaTitle title={row.series_title} as="span" style={{ display: 'inline' }} showOriginal={true}>{row.series_title}</SafeDramaTitle> : row.series_title}</span>
          <span className="history-progress">Xem đến tập {row.vid_index} / Tổng {row.total} tập · {Math.floor((row.currentTime || 0) / 60)}:{String(Math.floor((row.currentTime || 0) % 60)).padStart(2, '0')}</span>
          <span className="history-time">Xem gần đây {new Date(row.updatedAt).toLocaleString('vi-VN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
          {row.unreadEpisodes > 0 && <span className="history-update">Thêm {row.unreadEpisodes} tập mới</span>}
        </span>
        <span className="history-action"><Play size={15} />{opening === row.series_id ? 'Đang mở…' : 'Tiếp tục xem'}</span>
      </button>
      <div className="history-row-actions">
        {groupById.get(row.series_id)?.length > 1 && groupById.get(row.series_id)[0] === row && <button className="btn btn-outline btn-sm" aria-expanded={!hideLowSeasons || !!expanded[row.series_id]} onClick={() => { if (!hideLowSeasons) savePreferences({ ...preferences, hideLowSeasons: true }); setExpanded(value => ({ ...value, [row.series_id]: hideLowSeasons ? !value[row.series_id] : false })); }}>{!hideLowSeasons || expanded[row.series_id] ? 'Thu gọn' : 'Mở rộng'} {groupById.get(row.series_id).length} phần</button>}
        {groupById.get(row.series_id)?.length > 1 && <button className="btn btn-outline btn-sm" onClick={() => decide(row.series_id, null)}>Rời khỏi nhóm</button>}
        {Object.hasOwn(decisions, row.series_id) && <button className="btn btn-outline btn-sm" onClick={() => decide(row.series_id, undefined)}>Khôi phục nhóm tự động</button>}
        <button type="button" className="btn btn-outline btn-sm history-check" disabled={checking || !!checkingRow || !!removing || !!opening} aria-label={`Kiểm tra cập nhật cho《${row.series_title}》`} title="Chỉ kiểm tra lịch sử xem này" onClick={() => checkRow(row)}>
          <RefreshCw size={14} className={checkingRow === row.series_id ? 'spin' : ''} />{checkingRow === row.series_id ? 'Đang kiểm tra…' : 'Kiểm tra'}
        </button>
        <button type="button" className="btn btn-outline btn-sm history-remove" disabled={!!removing || !!opening || !!checkingRow} aria-label={`Xóa lịch sử xem《${row.series_title}》`} title="Chỉ xóa lịch sử xem, không xóa tệp video" onClick={() => remove(row)}>{removing === row.series_id ? 'Đang xóa…' : 'Xóa'}</button>
      </div>
      </div>
      {!!row.sequels?.length && <div className="history-sequels"><span>Nghi là phần tiếp theo</span>{row.sequels.map(sequel => <button key={sequel.series_id} className="btn btn-outline btn-sm" disabled={!active || !!opening || !!removing} onClick={() => resume(row, sequel)}>{SafeDramaTitle ? <SafeDramaTitle title={sequel.series_title} as="span" showOriginal={false}>{sequel.series_title}</SafeDramaTitle> : sequel.series_title}</button>)}</div>}
      {!!row.similarSeries?.length && <div className="history-sequels" title="Tên tương tự, chỉ để đối chiếu; không dùng để ẩn phần cũ hoặc gộp nhóm hàng loạt">
        <span>Nghi cùng bộ phim (Chỉ gợi ý)</span>{row.similarSeries.map(candidate => <button key={candidate.series_id} className="btn btn-outline btn-sm" disabled={!active || !!opening || !!removing} onClick={() => resume(row, candidate)}>{SafeDramaTitle ? <SafeDramaTitle title={candidate.series_title} as="span" showOriginal={false}>{candidate.series_title}</SafeDramaTitle> : candidate.series_title}</button>)}
        {row.similarSeries.filter(candidate => rows.some(item => item.series_id === candidate.series_id)).map(candidate => <button key={`group:${candidate.series_id}`} className="btn btn-outline btn-sm" onClick={() => decide(candidate.series_id, row.series_id)}>Xác nhận《{SafeDramaTitle ? <SafeDramaTitle title={candidate.series_title} as="span" showOriginal={false}>{candidate.series_title}</SafeDramaTitle> : candidate.series_title}》cùng bộ phim</button>)}
      </div>}
      {row.lastEpisodeCheckError && <p className="history-check-error">Kiểm tra cập nhật tập chưa hoàn thành: {row.lastEpisodeCheckError}</p>}
      {row.lastSequelCheckError && <p className="history-check-error">Kiểm tra phần tiếp theo chưa hoàn thành: {row.lastSequelCheckError}</p>}
      {!row.lastEpisodeCheckError && !row.lastSequelCheckError && row.lastCheckError && <p className="history-check-error">Kiểm tra cập nhật chưa hoàn thành: {row.lastCheckError}</p>}
    </li>)}</ul>}
  </section>;
}
