import { useCallback, useEffect, useRef, useState } from 'react';

export default function useFloatingPlayer(title, onChange, onBeforeMove) {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'player-floating-host';
    return element;
  });
  const [floating, setFloating] = useState(false);
  const slot = useRef(null);
  const popup = useRef(null);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  const disposing = useRef(false);
  const pendingRestore = useRef(null);

  const moveHost = useCallback(destination => {
    const video = host.querySelector('video');
    const snapshot = video ? { currentTime: video.currentTime, paused: video.paused, muted: video.muted,
      volume: video.volume, rate: video.playbackRate, source: video.currentSrc || video.src } : null;
    pendingRestore.current?.();
    if (snapshot) {
      onBeforeMove?.(snapshot);
      video.pause();
      const restore = () => {
        if (video.src !== snapshot.source && video.currentSrc !== snapshot.source) return;
        video.muted = snapshot.muted;
        video.volume = snapshot.volume;
        video.playbackRate = snapshot.rate;
        if (video.readyState > 0) {
          try { video.currentTime = snapshot.currentTime; } catch (_) {}
          if (!snapshot.paused) video.play().catch(() => {});
        }
      };
      video.addEventListener('loadedmetadata', restore, { once: true });
      pendingRestore.current = () => video.removeEventListener('loadedmetadata', restore);
      destination.appendChild(host);
      restore();
    } else destination.appendChild(host);
  }, [host, onBeforeMove]);

  const attachSlot = useCallback(element => {
    slot.current = element;
    if (element && !popup.current) element.appendChild(host);
  }, [host]);

  const toggle = useCallback(() => {
    if (popup.current && !popup.current.closed) { popup.current.close(); return; }
    const child = window.open('about:blank', 'hongguo-floating-player', 'popup,width=420,height=740');
    if (!child) throw new Error('Không thể mở cửa sổ nổi, vui lòng thử lại');
    popup.current = child;
    const restore = () => {
      if (popup.current !== child) return;
      popup.current = null;
      if (slot.current) moveHost(slot.current);
      if (!disposing.current) { setFloating(false); onChange?.(false); }
    };
    child.addEventListener('beforeunload', restore);
    child.addEventListener('pagehide', restore);
    try {
      child.document.title = latestTitle.current;
      child.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
      for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
        const copy = stylesheet.cloneNode(true);
        if (stylesheet.href) copy.href = stylesheet.href;
        child.document.head.appendChild(copy);
      }
      const style = child.document.createElement('style');
      style.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}.player-floating-host{display:block;width:100%;height:100%}.player-floating-host>.player-stage{width:100%;height:100%;max-height:none;aspect-ratio:auto;border-radius:0;margin:0}.player-controls-row{flex-wrap:wrap;gap:4px}.player-controls-volume input{width:48px}';
      child.document.head.appendChild(style);
      moveHost(child.document.body);
      setFloating(true);
      onChange?.(true);
      child.focus();
    } catch (error) {
      restore(); child.close();
      throw new Error('Khởi tạo cửa sổ nổi thất bại, vui lòng thử lại', { cause: error });
    }
  }, [host, onChange, moveHost]);

  useEffect(() => {
    if (popup.current && !popup.current.closed) popup.current.document.title = title;
  }, [title]);

  useEffect(() => {
    disposing.current = false;
    return () => {
      disposing.current = true;
      popup.current?.close();
      pendingRestore.current?.();
    };
  }, []);

  return { host, attachSlot, floating, toggle };
}
