import React, { useEffect, useRef, useState } from 'react';

export default function SequelFinder({ seriesId, active = true, timeoutMs = 25000 }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState(false);
  const [opening, setOpening] = useState('');
  const request = useRef(0);
  const openingRef = useRef(false);
  const timer = useRef(0);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = 0; } };

  useEffect(() => {
    request.current++;
    openingRef.current = false;
    clearTimer();
    setOpen(false); setLoading(false); setOpening(''); setResults([]); setError(''); setPartial(false);
    return () => { request.current++; openingRef.current = false; clearTimer(); };
  }, [seriesId, active]);

  const close = () => {
    request.current++;
    openingRef.current = false;
    clearTimer();
    setOpen(false); setLoading(false); setOpening('');
  };

  const find = async () => {
    if (!active || !seriesId || openingRef.current) return;
    const version = ++request.current;
    clearTimer();
    setOpen(true); setLoading(true); setError(''); setPartial(false); setResults([]);
    // Truy vấn tiến trình chính có thể không trả về trong thời gian dài do trang web bị treo; frontend xử lý dự phòng để tránh xoay vòng liên tục.
    const timerId = setTimeout(() => {
      if (version !== request.current) return;
      if (timer.current === timerId) timer.current = 0;
      request.current++;
      setLoading(false);
      setError('Hết thời gian tìm kiếm, vui lòng thử lại sau.');
    }, Math.max(1, Number(timeoutMs) || 25000));
    timer.current = timerId;
    try {
      const local = await window.electronAPI.findSeriesSequels(seriesId, { localOnly: true });
      if (version !== request.current) return;
      if (local?.success) setResults(local.results || []);
      const result = await window.electronAPI.findSeriesSequels(seriesId);
      if (version !== request.current) return;
      if (!result?.success) throw new Error(result?.error || 'Tìm kiếm thất bại, vui lòng thử lại');
      setResults(current => {
        const merged = new Map((result.results || []).map(item => [String(item.series_id), item]));
        for (const item of current) if (!merged.has(String(item.series_id))) merged.set(String(item.series_id), item);
        return [...merged.values()];
      });
      setPartial(result.partial === true);
      setError(result.error || '');
    } catch (failure) {
      if (version === request.current) setError(failure.message || 'Tìm kiếm thất bại, vui lòng thử lại');
    } finally {
      // Chỉ hủy timer của phiên truy vấn hiện tại
      if (timer.current === timerId) { clearTimeout(timerId); timer.current = 0; }
      if (version === request.current) setLoading(false);
    }
  };

  const play = async (sequel) => {
    if (openingRef.current) return;
    openingRef.current = true;
    const version = ++request.current;
    setOpening(sequel.series_id); setLoading(false); setError('');
    try {
      let result = await window.electronAPI.playSeries({ seriesId: sequel.series_id, vidIndex: 1 });
      if (version !== request.current) return;
      if (!result?.success && result?.code === 'SERIES_NOT_FOUND') {
        const detail = await window.electronAPI.searchResolve(sequel.series_id);
        if (version !== request.current) return;
        if (!detail?.success) throw new Error(detail?.error || 'Thông tin phần tiếp theo tạm thời chưa khả dụng');
        const episode = detail.data?.episodes?.find(item => !item.locked);
        if (!episode) throw new Error('Phần tiếp theo tạm thời chưa có tập có thể phát');
        result = await window.electronAPI.playSeries({ seriesId: sequel.series_id, vidIndex: episode.vid_index });
        if (version !== request.current) return;
      }
      if (!result?.success) throw new Error(result?.error || 'Mở trình phát thất bại, vui lòng thử lại');
      setOpen(false);
    } catch (failure) {
      if (version === request.current) setError(failure.message || 'Mở thất bại, vui lòng thử lại');
    } finally {
      if (version === request.current) { setOpening(''); openingRef.current = false; }
    }
  };

  if (!active || !seriesId) return null;
  return <section className="sequel-finder" aria-label="Tìm phần tiếp theo của phim này">
    <div className="sequel-finder-actions">
      <button type="button" className="btn btn-outline btn-sm" onClick={find} disabled={loading || !!opening}
        aria-expanded={open} aria-controls="sequel-finder-results">{loading ? 'Đang tìm…' : open ? error ? 'Thử lại' : 'Tìm lại' : 'Tìm phần tiếp theo'}</button>
      {open && <button type="button" className="btn btn-outline btn-sm" onClick={close}>Thu gọn</button>}
    </div>
    {open && <div id="sequel-finder-results" className="sequel-finder-results">
      <p>Phần tiếp theo có thể có, vui lòng đối chiếu tên phim</p>
      {loading && <p role="status">{results.length ? 'Đã tìm thấy bản ghi cục bộ, đang bổ sung tìm kiếm…' : 'Đang tìm phần tiếp theo…'}</p>}
      {error && <p className="sequel-finder-error" role="alert">{error}</p>}
      {partial && <p role="status">Một số kết quả chưa tải xong, bạn có thể thử lại sau.</p>}
      {!loading && !results.length && <p role="status">{error || partial ? 'Tìm kiếm chưa hoàn tất, tạm thời chưa xác định được phần tiếp theo.' : 'Chưa tìm thấy phần tiếp theo, bạn có thể kiểm tra lại sau.'}</p>}
      {!!results.length && <ul className="sequel-finder-list">{results.map(sequel => <li key={sequel.series_id}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => play(sequel)} disabled={!!opening}
          aria-label={`Phát phần tiếp theo "${sequel.series_title}"`}>{sequel.series_title}{opening === sequel.series_id ? ' · Đang mở…' : ''}</button>
      </li>)}</ul>}
    </div>}
  </section>;
}
