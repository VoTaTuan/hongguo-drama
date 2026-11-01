import React, { useEffect, useRef, useState } from 'react';

export default function AnnouncementSettings() {
  const [preferences, setPreferences] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [manualMessage, setManualMessage] = useState('');
  const pending = useRef(false);
  const manualPending = useRef(false);
  useEffect(() => {
    let active = true, revision = 0;
    const api = window.electronAPI;
    const unsubscribe = api.onAnnouncementPreferences(next => { revision++; if (active) setPreferences(next); });
    const current = revision;
    api.getAnnouncementPreferences().then(next => { if (active && current === revision) setPreferences(next); })
      .catch(() => { if (active) setError('Không thể đọc cài đặt thông báo, vui lòng khởi động lại ứng dụng rồi thử lại.'); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const update = async (key, enabled) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await window.electronAPI.setAnnouncementPreferences({ [key]: enabled });
      if (!result?.success) setError(result?.error || 'Lưu thất bại, cài đặt thông báo ban đầu được giữ nguyên.');
      else setPreferences(result.preferences);
    } catch { setError('Lưu thất bại, cài đặt thông báo ban đầu được giữ nguyên.'); }
    finally { pending.current = false; setSaving(false); }
  };
  const viewCurrent = async () => {
    if (manualPending.current) return;
    manualPending.current = true;
    setReading(true);
    setManualMessage('');
    try {
      const result = await window.electronAPI.getCurrentAnnouncement();
      if (result?.announcement) {
        window.dispatchEvent(new CustomEvent('hongguo-show-current-announcement', { detail: result.announcement }));
      } else setManualMessage(result?.error || 'Hiện tại không có thông báo nào.');
    } catch { setManualMessage('Đọc thông báo thất bại, vui lòng thử lại sau.'); }
    finally { manualPending.current = false; setReading(false); }
  };
  return <div className="settings-group">
    <span className="settings-label">Thông báo hệ thống</span>
    <label className="proxy-switch-row"><input type="checkbox" checked={preferences?.normalEnabled === false} disabled={!preferences || saving}
      onChange={event => update('normalEnabled', !event.target.checked)} /><span className="proxy-switch-text">Tắt thông báo thông thường<em>Khi bật tùy chọn này, hệ thống sẽ không đọc hoặc hiển thị thông báo thường; vẫn duy trì tắt sau khi nâng cấp phần mềm</em></span></label>
    <label className="proxy-switch-row"><input type="checkbox" checked={preferences?.emergencyEnabled === false} disabled={!preferences || saving}
      onChange={event => update('emergencyEnabled', !event.target.checked)} /><span className="proxy-switch-text">Tắt thông báo khẩn cấp<em>Khi bật tùy chọn này, hệ thống ngừng kiểm tra thông báo khẩn; khi bật lại, các thông báo đã xem sẽ không lặp lại</em></span></label>
    <p className="settings-hint">Thay đổi có hiệu lực ngay. Khi nhận thông báo khẩn, hệ thống kiểm tra 5 phút một lần, mỗi thông báo chỉ nhắc một lần; không bị ảnh hưởng bởi tùy chọn "Không nhắc lại hôm nay" của thông báo thường.</p>
    <button type="button" className="btn btn-outline" disabled={reading} aria-busy={reading} onClick={viewCurrent}>{reading ? 'Đang tải thông báo…' : 'Xem thông báo hiện tại'}</button>
    <p className="settings-hint">Xem thủ công không bị giới hạn bởi công tắc tự động hoặc thiết lập miễn nhắc nhở.</p>
    {manualMessage && <p className="settings-hint" role="status">{manualMessage}</p>}
    {error && <p className="alert alert-error" role="alert">{error}</p>}
  </div>;
}
