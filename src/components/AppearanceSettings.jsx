import React, { useEffect, useRef, useState } from 'react';
import { getThemePreference, setThemePreference, getPosterSize, setPosterSize } from '../theme';

export default function AppearanceSettings({ active = true }) {
  const [preference, setPreference] = useState(getThemePreference);
  const [posterSize, setPosterPreference] = useState(getPosterSize);
  const [zoom, setZoom] = useState(null);
  const [zoomBusy, setZoomBusy] = useState(false);
  const zoomPending = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let changed = false;
    const unsubscribe = window.electronAPI.onInterfaceZoomChanged?.(value => {
      changed = true;
      if (!cancelled) setZoom(value);
    });
    window.electronAPI.getSettings().then(settings => {
      if (!cancelled && !changed) setZoom(settings.ui_zoom ?? 1);
    }).catch(() => {
      if (!cancelled) setError('Không thể đọc tỉ lệ giao diện, vui lòng vào lại Cài đặt.');
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [active]);

  const changeZoom = async direction => {
    if (zoomPending.current) return;
    zoomPending.current = true;
    setZoomBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.changeWindowZoom(direction);
      if (!result?.success) throw new Error(result?.error || 'Lưu tỉ lệ giao diện thất bại, vui lòng thử lại.');
      setZoom(result.zoom);
    } catch (error) {
      setError(error.message || 'Lưu tỉ lệ giao diện thất bại, vui lòng thử lại.');
    } finally {
      zoomPending.current = false;
      setZoomBusy(false);
    }
  };

  const changePosterSize = event => {
    try {
      setPosterSize(event.target.value);
      setPosterPreference(event.target.value);
      setError('');
    } catch {
      setError('Lưu kích thước poster thất bại, vui lòng thử lại.');
    }
  };

  const changeTheme = (event) => {
    try {
      setThemePreference(event.target.value);
      setPreference(event.target.value);
      setError('');
    } catch {
      setError('Lưu giao diện thất bại, vui lòng thử lại.');
    }
  };

  return (
    <>
    <div className="settings-group">
      <label className="settings-label" htmlFor="appearance-theme">Chủ đề giao diện</label>
      <select id="appearance-theme" className="input-field select-field" value={preference} onChange={changeTheme} aria-describedby="appearance-hint">
        <option value="system">Theo hệ thống</option>
        <option value="light">Sáng</option>
        <option value="dark">Tối</option>
      </select>
      <p className="settings-hint" id="appearance-hint">Có hiệu lực ngay và tự động lưu. Khi chọn "Theo hệ thống", giao diện sẽ tự đổi theo cài đặt hệ điều hành.</p>
    </div>
    <div className="settings-group">
      <span className="settings-label" id="appearance-zoom-label">Thu phóng giao diện & cỡ chữ</span>
      <div className="appearance-zoom" role="group" aria-labelledby="appearance-zoom-label" aria-describedby="appearance-zoom-hint">
        <button type="button" className="btn btn-outline" aria-label="Thu nhỏ giao diện và cỡ chữ" disabled={zoomBusy || zoom === null || zoom <= 0.5} onClick={() => changeZoom('out')}>Thu nhỏ</button>
        <output aria-live="polite">{zoom === null ? 'Đang đọc…' : `${Math.round(zoom * 100)}%`}</output>
        <button type="button" className="btn btn-outline" aria-label="Phóng to giao diện và cỡ chữ" disabled={zoomBusy || zoom === null || zoom >= 2} onClick={() => changeZoom('in')}>Phóng to</button>
        <button type="button" className="btn btn-outline" disabled={zoomBusy || zoom === null || zoom === 1} onClick={() => changeZoom('reset')}>Đặt lại 100%</button>
      </div>
      <p className="settings-hint" id="appearance-zoom-hint">Mặc định 100%, không tự phóng to theo độ phân giải màn hình. Bạn có thể tự chỉnh kích cỡ chữ và nút (50%–200%), có hiệu lực ngay và ghi nhớ lựa chọn.</p>
    </div>
    <div className="settings-group">
      <label className="settings-label" htmlFor="appearance-poster-size">Kích thước poster</label>
      <select id="appearance-poster-size" className="input-field select-field" value={posterSize} onChange={changePosterSize} aria-describedby="appearance-poster-hint">
        <option value="small">Nhỏ</option>
        <option value="standard">Tiêu chuẩn</option>
        <option value="large">Lớn</option>
        <option value="extra-large">Rất lớn</option>
      </select>
      <p className="settings-hint" id="appearance-poster-hint">Poster ở trang Khám phá tự sắp xếp theo chiều rộng cửa sổ; khi tăng kích thước, mỗi hàng sẽ hiển thị ít mục hơn. Giữ nguyên tỷ lệ, có hiệu lực ngay và tự động lưu.</p>
      {error && <p className="appearance-error" role="alert">{error}</p>}
    </div>
    </>
  );
}
