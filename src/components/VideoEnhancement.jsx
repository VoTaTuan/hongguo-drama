import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createAnime4KRenderer, normalizeEnhancement, sharpenKernel } from '../videoEnhancement';
import './VideoEnhancement.css';

const STORAGE_KEY = 'hongguo:video-enhancement';

export function useVideoEnhancement() {
  const [settings, setSettings] = useState(() => {
    try { return normalizeEnhancement(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return normalizeEnhancement(null); }
  });
  const [status, setStatus] = useState({ state: 'idle', message: '' });
  const [saveError, setSaveError] = useState(false);
  const update = useCallback(patch => setSettings(current => normalizeEnhancement({ ...current, ...patch })), []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setSaveError(false); }
    catch { setSaveError(true); }
  }, [settings]);
  return { ...settings, update, status, setStatus, saveError };
}

export function VideoEnhancementControls({ enhancement, available = true }) {
  const { mode, strength, update, status, saveError } = enhancement;
  return <div className="video-enhancement-settings">
    <label>Tăng cường chất lượng hình ảnh
      <select aria-label="Tăng cường chất lượng hình ảnh" value={mode} disabled={!available} onChange={event => update({ mode: event.target.value })}>
        <option value="original">Gốc</option>
        <option value="sharpen">Làm nét</option>
        <option value="anime4k">Anime4K 2×</option>
      </select>
    </label>
    {mode === 'sharpen' && <label className="video-enhancement-strength">Độ làm nét
      <input aria-label="Độ làm nét" type="range" min="0" max="100" step="5" value={strength}
        disabled={!available} onChange={event => update({ strength: Number(event.target.value) })} />
      <output>{strength}%</output>
    </label>}
    <p className="video-enhancement-note">Chỉ tăng cường khi phát video, tệp tải về vẫn giữ chất lượng gốc.</p>
    {mode === 'anime4k' && <p className="video-enhancement-note">Thích hợp cho hoạt hình/anime; hỗ trợ nguồn phim 1080p trở xuống.</p>}
    {status.message && <p className={`video-enhancement-note ${status.state === 'error' ? 'enhancement-error' : ''}`} role="status">{status.message}</p>}
    {saveError && <p className="video-enhancement-note" role="status">Cài đặt chưa được lưu, lần sau mở có thể trở về mặc định.</p>}
  </div>;
}

export default function VideoEnhancement({ videoRef, source, available = true, enhancement }) {
  const { mode, strength, setStatus } = enhancement;
  const canvasRef = useRef(null);
  const filterId = `video-sharpen-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const originalFilter = video.style.filter;
    canvas.style.visibility = 'hidden';
    setStatus({ state: 'idle', message: '' });
    if (!available || !source || mode === 'original') return;
    if (mode === 'sharpen') {
      video.style.filter = `url(#${filterId})`;
      setStatus({ state: 'ready', message: 'Đã bật làm nét' });
      return () => { video.style.filter = originalFilter; };
    }

    const abort = new AbortController();
    let renderer;
    let pending = false;
    let failed = false;
    let frameId = null;
    let rafId = null;
    let drawing = false;
    let redraw = false;
    let revision = 0;
    const visible = () => !document.hidden && document.pictureInPictureElement !== video;
    const cancelFrame = () => {
      if (frameId !== null) video.cancelVideoFrameCallback?.(frameId);
      if (rafId !== null) cancelAnimationFrame(rafId);
      frameId = rafId = null;
    };
    const fail = error => {
      if (abort.signal.aborted || failed) return;
      failed = true;
      cancelFrame();
      canvas.style.visibility = 'hidden';
      renderer?.dispose();
      setStatus({ state: 'error', message: error.name === 'SecurityError'
        ? 'Nguồn phim này giới hạn xử lý hình ảnh; đã khôi phục gốc, có thể chuyển sang làm nét'
        : (error.message || 'Nguồn phim này chưa hỗ trợ tăng cường; đã khôi phục gốc, có thể chuyển sang làm nét') });
    };
    const schedule = () => {
      cancelFrame();
      if (abort.signal.aborted || failed || !visible() || video.paused || video.ended || video.seeking) return;
      if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(() => { frameId = null; draw(); });
      else rafId = requestAnimationFrame(() => { rafId = null; draw(); });
    };
    const draw = async () => {
      if (abort.signal.aborted || failed || !visible() || video.seeking || video.readyState < 2) return;
      if (!renderer) { await initialize(); return; }
      if (drawing) { redraw = true; return; }
      drawing = true;
      const drawRevision = revision;
      try {
        const rendered = await renderer.draw();
        if (!abort.signal.aborted && !failed && visible() && !video.seeking && drawRevision === revision && rendered) {
          canvas.style.visibility = 'visible';
          setStatus(current => current.state === 'ready' ? current : { state: 'ready', message: 'Đã bật Anime4K 2×' });
        }
      } catch (error) { fail(error); }
      finally {
        drawing = false;
        if (redraw) { redraw = false; draw(); }
        else schedule();
      }
    };
    const initialize = async () => {
      if (pending || renderer || failed || abort.signal.aborted || !visible() || video.readyState < 2 || !video.videoWidth) return;
      pending = true;
      setStatus({ state: 'loading', message: 'Đang chuẩn bị Anime4K…' });
      try {
        const next = await createAnime4KRenderer(video, canvas, { signal: abort.signal, onError: fail });
        if (abort.signal.aborted || failed) { next.dispose(); return; }
        renderer = next;
        draw();
      } catch (error) { if (error.name !== 'AbortError') fail(error); }
      finally { pending = false; }
    };
    const invalidate = () => { revision++; cancelFrame(); canvas.style.visibility = 'hidden'; };
    const refresh = () => { cancelFrame(); draw(); };
    const visibilityChange = () => { if (visible()) refresh(); else invalidate(); };
    const events = ['loadeddata', 'seeked', 'play', 'pause', 'ended', 'resize'];
    events.forEach(event => video.addEventListener(event, refresh));
    video.addEventListener('seeking', invalidate);
    video.addEventListener('emptied', invalidate);
    video.addEventListener('enterpictureinpicture', visibilityChange);
    video.addEventListener('leavepictureinpicture', visibilityChange);
    document.addEventListener('visibilitychange', visibilityChange);
    initialize();
    return () => {
      abort.abort();
      cancelFrame();
      renderer?.dispose();
      canvas.style.visibility = 'hidden';
      events.forEach(event => video.removeEventListener(event, refresh));
      video.removeEventListener('seeking', invalidate);
      video.removeEventListener('emptied', invalidate);
      video.removeEventListener('enterpictureinpicture', visibilityChange);
      video.removeEventListener('leavepictureinpicture', visibilityChange);
      document.removeEventListener('visibilitychange', visibilityChange);
    };
  }, [videoRef, source, available, mode, filterId, setStatus]);

  return <>
    <svg className="video-enhancement-filter" aria-hidden="true" focusable="false">
      <defs><filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feConvolveMatrix order="3" kernelMatrix={sharpenKernel(strength).join(' ')} divisor="1" bias="0" edgeMode="duplicate" preserveAlpha="true" />
      </filter></defs>
    </svg>
    <canvas ref={canvasRef} className="video-enhancement-canvas" aria-hidden="true" />
  </>;
}
