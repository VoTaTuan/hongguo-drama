import { useEffect, useState } from 'react';

const KEY = 'hongguo.hoverPopupEnabled';
const EVENT = 'hongguo-hover-popup-pref';

export function readHoverPopupEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setHoverPopupEnabled(enabled) {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: !!enabled }));
}

export function useHoverPopupEnabled() {
  const [enabled, setEnabled] = useState(readHoverPopupEnabled);
  useEffect(() => {
    const onChange = (e) => setEnabled(!!e.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [enabled, setHoverPopupEnabled];
}
