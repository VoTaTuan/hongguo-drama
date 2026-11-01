export const SHORTCUT_STORAGE_KEY = 'hongguo:preview:playback-shortcuts:v1';
export const SHORTCUT_EVENT = 'hongguo:playback-shortcuts-changed';
export const SHORTCUT_ACTIONS = [
  { id: 'play', label: 'Phát / Tạm dừng', key: 'space' },
  { id: 'backward', label: 'Tua lại 5 giây', key: 'arrowleft', repeat: true },
  { id: 'forward', label: 'Tua tới 5 giây', key: 'arrowright', repeat: true },
  { id: 'previous', label: 'Tập trước', key: 'arrowup' },
  { id: 'next', label: 'Tập tiếp theo', key: 'arrowdown' },
  { id: 'autoNext', label: 'Bật/tắt phát liên tục', key: 'a' },
  { id: 'slower', label: 'Giảm tốc 0.25x', key: 's', repeat: true },
  { id: 'faster', label: 'Tăng tốc 0.25x', key: 'd', repeat: true },
  { id: 'fullscreen', label: 'Toàn màn hình', key: 'f' },
];
export const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action.id, action.key])));
const KEY_PATTERN = /^(shift\+)?([a-z0-9]|space|arrowleft|arrowright|arrowup|arrowdown)$/;

export function shortcutKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null;
  let key = String(event.key || '').toLowerCase();
  if (event.code === 'Space' || key === ' ') key = 'space';
  else if (/^Key[A-Z]$/.test(event.code || '')) key = event.code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(event.code || '')) key = event.code.slice(5);
  const value = `${event.shiftKey ? 'shift+' : ''}${key}`;
  return KEY_PATTERN.test(value) && value !== 'shift+space' ? value : null;
}

export function formatShortcut(value) {
  const names = { space: 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' };
  return value.split('+').map(key => names[key] || (key === 'shift' ? 'Shift' : key.toUpperCase())).join(' + ');
}

export function validateShortcuts(bindings) {
  const seen = new Map();
  for (const action of SHORTCUT_ACTIONS) {
    const key = bindings?.[action.id];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key) || key === 'shift+space') return `Phím cho "${action.label}" không hợp lệ`;
    if (seen.has(key)) return `Bị trùng với "${seen.get(key)}", vui lòng chọn phím khác`;
    seen.set(key, action.label);
  }
  return '';
}

export function readShortcuts() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SHORTCUT_STORAGE_KEY));
    if (!validateShortcuts(stored)) return Object.fromEntries(SHORTCUT_ACTIONS.map(({ id }) => [id, stored[id]]));
  } catch { /* Missing or damaged preferences use the complete default map. */ }
  return { ...DEFAULT_SHORTCUTS };
}

export function saveShortcuts(bindings) {
  const error = validateShortcuts(bindings);
  if (error) throw new Error(error);
  window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(bindings));
  window.dispatchEvent(new Event(SHORTCUT_EVENT));
}

export function subscribeShortcuts(onChange) {
  const update = event => {
    if (event.type !== 'storage' || event.key === SHORTCUT_STORAGE_KEY || event.key === null) onChange(readShortcuts());
  };
  window.addEventListener(SHORTCUT_EVENT, update);
  window.addEventListener('storage', update);
  return () => {
    window.removeEventListener(SHORTCUT_EVENT, update);
    window.removeEventListener('storage', update);
  };
}

export function ignoresPlaybackShortcut(target, key) {
  if (target?.isContentEditable || target?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"]), [data-shortcut-settings], [role="dialog"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="listbox"]')) return true;
  if (target?.closest?.('[data-player-menu]')) {
    // Escape/selection returns focus to the trigger; a closed menu must not keep swallowing playback keys.
    const closedTrigger = target.closest('button[aria-haspopup][aria-expanded="false"]') && target.closest('.player-container');
    if (!closedTrigger || !key || key === ' ' || key === 'Enter') return true;
  }
  return !!(target?.closest?.('button, a') && !target.closest('.player-container'));
}
