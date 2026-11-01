import React, { useEffect, useRef, useState } from 'react';

const displayKey = value => value.replaceAll('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl').replaceAll('Command', 'Cmd').replaceAll('Control', 'Ctrl');

export default function BossKeySettings({ active = true }) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const capturedKey = useRef(null);
  useEffect(() => { if (!active) setRecording(false); }, [active]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (!window.electronAPI?.getBossKeyState) { setError('Vui lòng cập nhật ứng dụng trước khi thiết lập Phím Boss'); return; }
    window.electronAPI.getBossKeyState().then(state => {
      if (cancelled) return;
      setConfig(state); setDraft(displayKey(state.accelerator)); setError(state.error || '');
    }).catch(() => { if (!cancelled) setError('Không thể đọc cài đặt Phím Boss, vui lòng mở lại trang Cài đặt'); });
    return () => { cancelled = true; };
  }, [active]);

  const save = async enabled => {
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await window.electronAPI.setBossKey({ enabled, accelerator: enabled || !config.enabled ? draft : config.accelerator });
      if (!result.success) throw Error(result.error || 'Lưu Phím Boss thất bại');
      setConfig(result); setDraft(displayKey(result.accelerator));
      setMessage(result.registered ? 'Đã lưu, có thể dùng Phím Boss cả khi ứng dụng chạy nền' : 'Đã lưu, Phím Boss đang tắt');
    } catch (failure) { setError(failure.message || 'Không thể lưu, vui lòng thử lại'); }
    finally { setSaving(false); }
  };
  const disabled = !active || !config || saving;
  const record = event => {
    if (!recording || event.repeat || event.isComposing) return;
    if (event.key === 'Tab') { setRecording(false); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setRecording(false); setError(''); return; }
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.code === 'Space' ? 'Space' : event.key.toUpperCase();
    if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/.test(key) || (!/^F\d+$/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      setError('Vui lòng nhấn Ctrl, Cmd hoặc Alt kết hợp với chữ cái, chữ số hoặc phím cách, hoặc F1–F12'); return;
    }
    capturedKey.current = event.code || event.key;
    setDraft([event.ctrlKey && 'Control', event.metaKey && 'Command', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+'));
    setRecording(false); setError(''); setMessage('Đã ghi nhận tổ hợp phím mới, vui lòng nhấn Lưu');
  };
  return <>
    <div className="shortcut-settings-row boss-key-row" data-boss-key-settings>
      <label className="boss-key-toggle"><input type="checkbox" aria-label="Bật phím Boss" checked={config?.enabled === true} disabled={disabled}
        onChange={event => save(event.target.checked)} /> Phím Boss (ẩn nhanh)</label>
      <button id="boss-key-shortcut" type="button" className={`btn btn-outline shortcut-record boss-key-input${recording ? ' is-recording' : ''}`} aria-label="Phím tắt Boss" disabled={disabled}
        aria-describedby="boss-key-help" aria-pressed={recording}
        onClick={() => { setRecording(!recording); setError(''); setMessage(''); }} onKeyDown={record}
        onKeyUp={event => { if (capturedKey.current === (event.code || event.key)) { event.preventDefault(); capturedKey.current = null; } }}
        onBlur={() => { setRecording(false); capturedKey.current = null; }}>
        {recording ? 'Vui lòng nhấn tổ hợp phím…' : displayKey(draft)}
      </button>
      <button type="button" className="btn btn-outline btn-sm" aria-label="Lưu phím Boss" disabled={disabled} onClick={() => save(config.enabled)}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
    </div>
    <p className="settings-hint boss-key-hint" id="boss-key-help">Nhấp vào ô phím tắt, bấm tổ hợp phím mong muốn rồi nhấn Lưu; nhấn Esc để hủy. Hỗ trợ tổ hợp Ctrl, Cmd, Alt hoặc các phím F1–F12. Khi bật, phím tắt hoạt động toàn cục: bấm lần 1 để tạm dừng và ẩn ứng dụng, bấm lần nữa để hiện lại cửa sổ. Trên Mac sẽ đồng thời ẩn/hiện biểu tượng trên Dock.</p>
    {error && <p className="shortcut-error settings-hint boss-key-hint" role="alert">{error}</p>}
    {message && <p className="settings-hint boss-key-hint" role="status" aria-live="polite">{message}</p>}
  </>;
}
