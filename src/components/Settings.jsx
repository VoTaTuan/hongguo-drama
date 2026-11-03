import React, { useState, useEffect, useRef } from 'react';
import { useDanmakuSource, writeDanmakuSource } from './danmakuSource.mjs';
import useDialogKeyboard from './useDialogKeyboard';
import './Settings.css';
import AppearanceSettings from './AppearanceSettings';
import ShortcutSettings from './ShortcutSettings';
import CustomSources from './CustomSources';
import BuiltinSources from './BuiltinSources';
import AnnouncementSettings from './AnnouncementSettings';
import AiTranslationSettings from './AiTranslationSettings';
import { Settings, Folder, Check, Globe, X, RefreshCw, AlertCircle, Download, Play, Layers, Sparkles } from './icons';

const FORMAT_PRESETS = [
  { label: 'TênPhim_TậpN', value: 'series_title vid_index' },
  { label: 'TênPhim_TậpN_TiêuĐề', value: 'series_title vid_index ep_title' },
];

const SETTINGS_SUB_TABS = [
  { id: 'download', label: 'Tải về', icon: Download },
  { id: 'playback', label: 'Phát & Xem', icon: Play },
  { id: 'appearance', label: 'Giao diện & Phím tắt', icon: Layers },
  { id: 'sources', label: 'Nguồn phim & Mạng', icon: Globe },
  { id: 'ai_system', label: 'Dịch AI & Hệ thống', icon: Sparkles },
];

const PROXY_MODES = [
  { value: 'system', label: 'Theo hệ thống', desc: 'API và tải về đọc proxy môi trường khi khởi động; trang Khám phá và yêu cầu trình duyệt dùng proxy hệ thống' },
  { value: 'custom', label: 'Tùy chỉnh thủ công', desc: 'Điền địa chỉ và cổng proxy HTTP/HTTPS, bỏ qua quy tắc vượt qua (NO_PROXY) trong biến môi trường' },
  { value: 'direct', label: 'Buộc kết nối trực tiếp', desc: 'Bỏ qua mọi proxy, kết nối trực tiếp' },
];

// Cổng mặc định của phần mềm proxy phổ biến, tiện điền nhanh bằng 1 click
const PORT_PRESETS = [
  { label: 'Clash / Mihomo', port: 7890 },
  { label: 'V2rayN', port: 10809 },
  { label: 'Shadowsocks', port: 1080 },
  { label: 'Burp / Bắt gói tin', port: 8080 },
];

/** Cài đặt đã lưu -> Mô tả proxy đang có hiệu lực */
function describeProxy(settings) {
  if (!settings || settings.proxy_enabled !== true) {
    return { on: false, text: 'Chưa bật (kết nối trực tiếp mọi yêu cầu)' };
  }
  const mode = settings.proxy_mode || 'system';
  if (mode === 'direct') {
    return { on: false, text: 'Đã bật nhưng chế độ là「Buộc kết nối trực tiếp」' };
  }
  if (mode === 'custom') {
    const host = (settings.proxy_host || '').trim();
    const port = (settings.proxy_port || '').toString().trim();
    if (!host) return { on: false, text: 'Đã bật nhưng chưa điền địa chỉ proxy' };
    return { on: true, text: `${host}${port ? ':' + port : ''}` };
  }
  return { on: true, text: 'API/Tải về theo môi trường khởi động, trình duyệt theo hệ thống' };
}

function SettingsPage({ active = true, preview = false, appInfo = null }) {
  const danmakuSource = useDanmakuSource();
  const [subTab, setSubTab] = useState('download');
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyDraft, setProxyDraft] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pictureModeSaving, setPictureModeSaving] = useState(false);
  const [pictureModeNotice, setPictureModeNotice] = useState('');
  const [pictureModeError, setPictureModeError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');
  const testVersion = useRef(0);
  const savingRef = useRef(false);
  const pictureModeRequest = useRef({ pending: false, version: 0 });
  const editedKeys = useRef(new Set());
  const savedTimer = useRef(null);

  const loadSettings = async () => {
    setLoadError('');
    try { setSettings({ download_quality: 'auto', picture_in_picture_mode: 'custom', ...await window.electronAPI.getSettings() }); }
    catch (error) { setLoadError(error.message || 'Tải cài đặt thất bại, vui lòng thử lại'); }
  };

  // Khi vào lại trang cài đặt sẽ đồng bộ các tùy chọn chia sẻ vừa đổi trong trình phát; giữ lại các trường người dùng chưa lưu.
  const refreshSettings = async () => {
    if (savingRef.current) return;
    const modeVersion = pictureModeRequest.current.version;
    try {
      const fresh = { download_quality: 'auto', picture_in_picture_mode: 'custom', ...await window.electronAPI.getSettings() };
      setSettings(prev => {
        if (!prev) return fresh;
        const merged = { ...fresh };
        for (const key of editedKeys.current) {
          if (Object.hasOwn(prev, key)) merged[key] = prev[key];
        }
        if (pictureModeRequest.current.pending || modeVersion !== pictureModeRequest.current.version) {
          merged.picture_in_picture_mode = prev.picture_in_picture_mode;
        }
        return merged;
      });
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'Tải cài đặt thất bại, vui lòng thử lại');
    }
  };

  useEffect(() => () => { testVersion.current++; clearTimeout(savedTimer.current); }, []);

  useEffect(() => {
    if (!active) {
      testVersion.current++;
      setTesting(false);
      setTestResult(null);
      return;
    }
    void refreshSettings();
  }, [active]);

  const update = (key, value) => {
    editedKeys.current.add(key);
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
    setSaveError('');
  };

  const changePictureInPictureMode = async (event) => {
    const mode = event.target.value;
    const request = pictureModeRequest.current;
    if (!['native', 'custom'].includes(mode) || request.pending) return;
    request.pending = true;
    request.version++;
    const previous = settings.picture_in_picture_mode === 'native' ? 'native' : 'custom';
    setSettings(prev => ({ ...prev, picture_in_picture_mode: mode }));
    setPictureModeSaving(true);
    setPictureModeNotice('');
    setPictureModeError('');
    try {
      const result = await window.electronAPI.saveSettings({ picture_in_picture_mode: mode });
      if (!result?.success) throw new Error(result?.error || 'Lưu cài đặt cửa sổ thu nhỏ PiP thất bại, vui lòng thử lại');
      setPictureModeNotice('Đã tự động lưu, có hiệu lực lần mở cửa sổ nổi tiếp theo');
    } catch (error) {
      setSettings(prev => ({ ...prev, picture_in_picture_mode: previous }));
      setPictureModeError(error.message || 'Lưu cài đặt cửa sổ thu nhỏ PiP thất bại, vui lòng thử lại');
    } finally {
      request.pending = false;
      request.version++;
      setPictureModeSaving(false);
    }
  };

  const selectFolder = async () => {
    try {
      const dir = await window.electronAPI.selectFolder();
      if (dir) update('root', dir);
    } catch (error) { setSaveError(error.message || 'Chọn thư mục thất bại, vui lòng thử lại'); }
  };

  const persist = async (next, isProxy = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      // Submit only edited fields; the main process merges newer playback options.
      const editable = ['root', 'name_format', 'download_quality', 'download_resolve_interval', 'cache_next_episode', 'compat_mode', 'auto_delete_watched', 'show_danmaku_controls', 'max_concurrent', 'proxy_enabled', 'proxy_mode', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password', 'watch_updates_enabled', 'watch_sequels_enabled', 'watch_notifications_enabled', 'search_app_enabled', 'app_updates_enabled'];
      const submitted = {};
      for (const key of editable) {
        if (Object.hasOwn(next, key) && (editedKeys.current.has(key) || isProxy && key.startsWith('proxy_'))) submitted[key] = next[key];
      }
      if (isProxy) submitted.clear_proxy_password = next.clear_proxy_password === true && !String(next.proxy_password || '');
      const res = await window.electronAPI.saveSettings(submitted);
      if (!res?.success) throw new Error(res?.error || 'Cài đặt chưa được lưu, vui lòng thử lại');
      if (isProxy) closeProxy();
      setSettings(await window.electronAPI.getSettings());
      editedKeys.current.clear();
      setDirty(false);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaveError(error.message || 'Lưu cài đặt thất bại, vui lòng thử lại');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const save = () => persist(settings);

  const closeProxy = () => {
    testVersion.current++;
    setTesting(false);
    setProxyOpen(false);
    setProxyDraft(null);
    setTestResult(null);
  };

  // ===== Hộp thoại proxy =====
  const openProxyModal = () => {
    testVersion.current++;
    setProxyDraft({
      proxy_enabled: settings.proxy_enabled === true,
      proxy_mode: settings.proxy_mode || 'system',
      proxy_host: settings.proxy_host || '127.0.0.1',
      proxy_port: settings.proxy_port || 7890,
      proxy_username: settings.proxy_username || '',
      proxy_password: '',
      clear_proxy_password: false,
    });
    setTestResult(null);
    setSaveError('');
    setProxyOpen(true);
  };

  const patchDraft = (key, value) => {
    testVersion.current++;
    setProxyDraft((prev) => ({ ...prev, [key]: value }));
    setTesting(false);
    setTestResult(null);
  };

  const runTest = async () => {
    const request = ++testVersion.current;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.electronAPI.testProxy(proxyDraft);
      if (request === testVersion.current) setTestResult(res);
    } catch (e) {
      if (request === testVersion.current) setTestResult({ success: false, error: e.message });
    } finally {
      if (request === testVersion.current) setTesting(false);
    }
  };

  const applyProxy = () => persist({ ...settings, ...proxyDraft }, true);

  useDialogKeyboard(active && proxyOpen, () => { if (!savingRef.current) closeProxy(); }, '.proxy-modal');

  if (!settings) {
    return <div className="settings-container">{loadError ? <div role="alert"><p>{loadError}</p><button className="btn btn-outline" onClick={loadSettings}>Tải lại</button></div> : 'Đang tải...'}</div>;
  }

  const proxyInfo = describeProxy(settings);
  const mode = proxyDraft ? proxyDraft.proxy_mode : 'system';

  return (
    <div className="settings-container">
      <div className="settings-header">
        <Settings size={22} />
        <div><h2>Cài đặt</h2><p className="page-description">Tùy chỉnh tải về, lưu trữ và kết nối mạng theo thói quen của bạn.</p></div>
      </div>

      <div className="settings-subtabs" role="tablist" aria-label="Nhóm cài đặt">
        {SETTINGS_SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isSelected = subTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`settings-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`settings-panel-${tab.id}`}
              className={`settings-subtab-btn ${isSelected ? 'active' : ''}`}
              onClick={() => setSubTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Giao diện & Phím tắt */}
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-appearance"
        aria-labelledby="settings-tab-appearance"
        style={{ display: subTab === 'appearance' ? undefined : 'none' }}
      >
        <section className="settings-card" aria-label="Cài đặt giao diện"><AppearanceSettings active={active} /></section>
        <ShortcutSettings active={active} />
      </div>

      {/* 2. Phát & Xem */}
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-playback"
        aria-labelledby="settings-tab-playback"
        style={{ display: subTab === 'playback' ? undefined : 'none' }}
      >
        <section className="settings-card" aria-label="Cài đặt cửa sổ thu nhỏ PiP">
          <div className="settings-group">
            <label className="settings-label" htmlFor="picture-in-picture-mode">Cửa sổ thu nhỏ PiP</label>
            <select id="picture-in-picture-mode" className="input-field select-field"
              value={settings.picture_in_picture_mode === 'native' ? 'native' : 'custom'}
              disabled={!active || saving || pictureModeSaving}
              aria-describedby="picture-in-picture-mode-hint"
              onChange={changePictureInPictureMode}>
              <option value="native">Gốc của hệ thống</option>
              <option value="custom">Tích hợp sẵn của ứng dụng</option>
            </select>
            <p className="settings-hint" id="picture-in-picture-mode-hint">Lựa chọn sẽ được tự động lưu ngay. Cửa sổ đang mở sẽ không bị ngắt quãng hoặc chuyển đổi, có hiệu lực ở lần mở tiếp theo. Gốc của hệ thống sử dụng tính năng Picture-in-Picture của hệ điều hành; tích hợp sẵn hiển thị được tên phim hiện tại và hỗ trợ quay lại cửa sổ chính.</p>
            {(pictureModeSaving || pictureModeNotice) && <p className="settings-hint" role="status">{pictureModeSaving ? 'Đang lưu…' : pictureModeNotice}</p>}
            {pictureModeError && <p className="appearance-error" role="alert">{pictureModeError}</p>}
          </div>
        </section>

        <p className="settings-hint">Đỉnh trang phát có thể bật chế độ cửa sổ nhỏ: Thu nhỏ cửa sổ, ghim trên cùng và hiển thị trên các màn hình ảo hỗ trợ; tạm dừng ẩn khi rời chuột, tiếp tục khi rê chuột lại, phím Esc hoặc Dock để khôi phục cửa sổ chính.</p>

        <fieldset className="settings-card" disabled={saving}>
          <div className="settings-group">
            <span className="settings-label">Phát và bộ nhớ đệm</span>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.cache_next_episode !== false} onChange={event => update('cache_next_episode', event.target.checked)} /><span className="proxy-switch-text">Lưu đệm 2 tập kế tiếp<em>Sau khi bắt đầu phát, tải trước tối đa 2 tập tiếp theo có thể phát trực tuyến, giảm thời gian chờ khi chuyển tập; sẽ tiêu tốn dung lượng mạng.</em></span></label>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.compat_mode !== false} onChange={event => update('compat_mode', event.target.checked)} /><span className="proxy-switch-text">Chế độ tương thích tự động<em>Thử chuyển mã khi không thể giải mã, khắc phục sự cố đen màn hình nhưng có tiếng.</em></span></label>
            <label className="proxy-switch-row"><input type="checkbox" aria-label="Ưu tiên tìm kiếm bằng App Hồng Quả" checked={settings.search_app_enabled === true} onChange={event => update('search_app_enabled', event.target.checked)} /><span className="proxy-switch-text">Ưu tiên tìm kiếm bằng App Hồng Quả<em>Tự động quay về trang web chính thức khi thất bại hoặc không có kết quả; khi tắt mục này, nếu trang chính thức không khả dụng vẫn sẽ thử tìm kiếm dự phòng qua App.</em></span></label>
          </div>
          <div className="settings-group">
            <span className="settings-label">Cài đặt nút Danmaku</span>
            <div className="settings-inline-save">
              <label className="proxy-switch-row"><input type="checkbox" aria-label="Hiển thị nút Danmaku" checked={settings.show_danmaku_controls !== false} onChange={event => update('show_danmaku_controls', event.target.checked)} /><span className="proxy-switch-text">Hiển thị nút Danmaku<em>Có hiệu lực sau khi lưu. Khi tắt sẽ ẩn Danmaku cùng nút cài đặt Danmaku và ngừng kích hoạt Danmaku; bật lại sẽ khôi phục tùy chọn Danmaku ban đầu.</em></span></label>
              <button type="button" className="btn btn-primary" aria-label="Lưu cài đặt hiện tại" onClick={save}>{saving ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu'}</button>
            </div>
          </div>
          <div className="settings-group">
            <label className="settings-label" htmlFor="danmaku-source">Nguồn Danmaku</label>
            <select id="danmaku-source" className="input-field select-field" value={danmakuSource} onChange={event => writeDanmakuSource(event.target.value)}>
              <option value="official">Danmaku theo dòng thời gian</option><option value="comments">Bình luận tập này (dự phòng)</option>
            </select>
            <p className="settings-hint">Chuyển đổi có hiệu lực ngay, chỉ yêu cầu nguồn đã chọn. Danmaku theo dòng thời gian chạy theo tiến độ video; bình luận tập hiển thị tuần tự, không khớp theo thời gian video. Cả hai nguồn dùng chung tùy chọn hiển thị.</p>
            <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
              try {
                const result = await window.electronAPI.openExternalUrl('https://github.com/dawei233/hongguo-drama');
                if (result?.success === false) throw new Error(result.error || 'Mở liên kết nguồn thất bại');
              } catch (error) { setSaveError(error.message || 'Mở liên kết nguồn thất bại'); }
            }}>Triển khai Danmaku tham khảo dawei233/hongguo-drama (GPL-3.0)</button>
          </div>
          <div className="settings-group">
            <span className="settings-label">Nhắc nhở theo dõi phim</span>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_updates_enabled !== false} onChange={event => update('watch_updates_enabled', event.target.checked)} /><span className="proxy-switch-text">Tự động kiểm tra tập mới<em>Trong khi ứng dụng chạy, kiểm tra mỗi phim khoảng 6 tiếng một lần; chia đợt kiểm tra khi danh sách dài</em></span></label>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_sequels_enabled !== false} onChange={event => update('watch_sequels_enabled', event.target.checked)} /><span className="proxy-switch-text">Tìm kiếm phần mới nghi vấn<em>Tìm kiếm theo tên phim khoảng 1 lần mỗi ngày, chỉ thông báo phim cùng tên có số mùa cao hơn; có thể bỏ sót hoặc báo nhầm</em></span></label>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_notifications_enabled === true} onChange={event => update('watch_notifications_enabled', event.target.checked)} /><span className="proxy-switch-text">Gửi thông báo hệ thống<em>Mặc định tắt. Khi bật cần cấp quyền thông báo hệ thống; tắt không ảnh hưởng đến chấm đỏ trong lịch sử xem</em></span></label>
          </div>
        </fieldset>
      </div>

      {/* 3. Nguồn phim & Mạng */}
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-sources"
        aria-labelledby="settings-tab-sources"
        style={{ display: subTab === 'sources' ? undefined : 'none' }}
      >
        <BuiltinSources />
        <CustomSources active={active} />
        <fieldset className="settings-card" disabled={saving}>
          <div className="settings-group">
            <label className="settings-label">Proxy mạng</label>
            <div className="proxy-status-row">
              <span className={`proxy-dot ${proxyInfo.on ? 'proxy-dot-on' : 'proxy-dot-off'}`} />
              <span className="proxy-status-text">
                {proxyInfo.on ? <>Đã bật: <code>{proxyInfo.text}</code></> : proxyInfo.text}
              </span>
              <button className="btn btn-outline btn-sm" onClick={openProxyModal}>
                <Globe size={15} />
                Cấu hình proxy
              </button>
            </div>
            <p className="settings-hint">
              Proxy thủ công dùng cho API, tải về và trình duyệt trong ứng dụng; khi theo hệ thống, API và tải về sẽ đọc proxy môi trường lúc khởi động cùng các quy tắc bỏ qua, các trang như Khám phá sẽ dùng proxy hệ thống. Có hiệu lực ngay sau khi lưu.
            </p>
          </div>
        </fieldset>
      </div>

      {/* 4. Tải về */}
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-download"
        aria-labelledby="settings-tab-download"
        style={{ display: subTab === 'download' ? undefined : 'none' }}
      >
        <fieldset className="settings-card" disabled={saving}>
          <div className="settings-group">
            <label className="settings-label">Thư mục tải về</label>
            <div className="folder-row">
              <input
                type="text"
                className="input-field"
                aria-label="Thư mục tải về"
                value={settings.root || ''}
                onChange={(e) => update('root', e.target.value)}
                placeholder="Chọn thư mục lưu tải về"
              />
              <button className="btn btn-outline" onClick={selectFolder}>
                <Folder size={16} />
                Chọn thư mục
              </button>
            </div>
            <p className="settings-hint">Tệp sẽ được lưu vào <code>Thư mục tải về/Phim Ngắn Hồng Quả/Tên phim/</code></p>
          </div>

          <div className="settings-group">
            <label className="settings-label">Quy tắc đặt tên tệp</label>
            <div className="preset-row">
              {FORMAT_PRESETS.map((p) => (
                <button
                  key={p.value}
                  className={`btn-chip ${settings.name_format === p.value ? 'btn-chip-primary' : ''}`}
                  onClick={() => update('name_format', p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="input-field mt8"
              aria-label="Quy tắc đặt tên tệp"
              value={settings.name_format || ''}
              onChange={(e) => update('name_format', e.target.value)}
            />
            <p className="settings-hint">
              Biến khả dụng: <code>series_title</code> (Tên phim) · <code>vid_index</code> (Tập, vd 001) · <code>ep_title</code> (Tiêu đề)
              . Mỗi tập giữ số tập riêng biệt, tránh ghi đè do trùng tên.
            </p>
          </div>

          <div className="settings-group">
            <label className="settings-label" htmlFor="default-download-quality">Độ phân giải tải về mặc định</label>
            <select id="default-download-quality" className="input-field select-field"
              value={settings.download_quality || 'auto'} aria-describedby="default-download-quality-hint"
              onChange={(event) => update('download_quality', event.target.value)}>
              <option value="auto">Tự động (Ưu tiên tương thích)</option>
              <option value="1080p">1080P</option>
              <option value="720p">720P</option>
            </select>
            <p className="settings-hint" id="default-download-quality-hint">Sau khi lưu sẽ áp dụng cho tác vụ tải mới, cũng có thể chọn riêng khi tải. Khi độ phân giải đã chọn của nguồn Hồng Quả không khả dụng hoặc tải thất bại, tự động thử độ phân giải thấp hơn và thông báo trong quản lý tải về; tệp đã có không tự xóa hoặc ghi đè.</p>
          </div>

          <div className="settings-group">
            <label className="settings-label">Số lượt tải đồng thời tối đa</label>
            <select
              className="input-field select-field"
              aria-label="Số lượt tải đồng thời tối đa"
              value={settings.max_concurrent || 3}
              onChange={(e) => update('max_concurrent', parseInt(e.target.value, 10))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>{n} tập tải cùng lúc</option>
              ))}
            </select>
            <p className="settings-hint">
              Tải cùng lúc <b>{settings.max_concurrent || 3}</b> tập (có hiệu lực ngay sau khi lưu).
              Số lượng tải đồng thời càng cao thì càng nhanh, nhưng có thể bị giới hạn tần suất gọi API, khuyến nghị 3~5.
            </p>
          </div>

          <div className="settings-group">
            <label className="settings-label">Độ trễ giãn cách xin link phát</label>
            <select
              className="input-field select-field"
              aria-label="Độ trễ giãn cách xin link phát"
              value={settings.download_resolve_interval !== undefined ? settings.download_resolve_interval : 500}
              onChange={(e) => update('download_resolve_interval', parseInt(e.target.value, 10))}
            >
              <option value={0}>Không giãn cách (0 ms)</option>
              <option value={300}>300 ms (Nhanh)</option>
              <option value={500}>500 ms (Mặc định - Ổn định)</option>
              <option value={800}>800 ms (An toàn)</option>
              <option value={1000}>1000 ms (1 giây - Tránh chặn rate-limit triệt để)</option>
              <option value={1500}>1500 ms (1.5 giây)</option>
              <option value={2000}>2000 ms (2 giây)</option>
            </select>
            <p className="settings-hint">
              Khoảng chờ an toàn giữa các yêu cầu phân tích link phim của các tập tải hàng loạt. Giúp tránh bị máy chủ trả về phản hồi rỗng (EMPTY_RESPONSE) khi tải nhiều tập cùng lúc.
            </p>
          </div>

          <div className="settings-group">
            <span className="settings-label">Dọn dẹp sau khi xem</span>
            <label className="proxy-switch-row"><input type="checkbox" checked={settings.auto_delete_watched === true} onChange={event => update('auto_delete_watched', event.target.checked)} /><span className="proxy-switch-text">Tự động xóa sau khi xem xong<em>Sau khi xem xong một tập, xóa video đã tải, bộ nhớ đệm phát trực tuyến và bộ nhớ đệm chuyển mã của tập đó. Tệp tải về sẽ bị xóa vĩnh viễn; có thể tải lại khi cần. Có hiệu lực sau khi lưu.</em></span></label>
          </div>
        </fieldset>
      </div>

      {/* 5. Dịch AI & Hệ thống */}
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id="settings-panel-ai_system"
        aria-labelledby="settings-tab-ai_system"
        style={{ display: subTab === 'ai_system' ? undefined : 'none' }}
      >
        <AiTranslationSettings />

        <fieldset className="settings-card" disabled={saving}>
          <div className="settings-group">
            <span className="settings-label">Vị trí tệp cấu hình</span>
            <p className="settings-hint settings-path"><code>{appInfo?.dataDir || 'Thư mục cấu hình hệ thống'}</code></p>
            {appInfo?.configNote
              ? <p className="settings-hint" role="status">{appInfo.configNote}</p>
              : <p className="settings-hint">{appInfo?.configMode === 'portable'
                ? 'Bản di động (Portable): Cài đặt, lịch sử tải về và dữ liệu giao diện được lưu trong thư mục data của chương trình; khi chuyển từ phiên bản cũ, lịch sử tìm kiếm ở thư mục hệ thống cũ sẽ không tự động mang sang. Vui lòng giữ lại thư mục này khi di chuyển hoặc sao lưu chương trình.'
                : 'Cài đặt, lịch sử tải về và dữ liệu giao diện được lưu trong thư mục người dùng của hệ thống; có thể sao chép thư mục này khi đổi máy tính.'}</p>}
          </div>

          {preview ? (
            <div className="settings-group">
              <span className="settings-label">Bản xem trước độc lập</span>
              <p className="settings-hint">Dữ liệu bản xem trước được lưu độc lập, không nhận cập nhật bản chính thức, không ghi đè lên Phim Ngắn Hồng Quả đã cài đặt.</p>
            </div>
          ) : (
            <div className="settings-group">
              <span className="settings-label">Kiểm tra cập nhật</span>
              <label className="proxy-switch-row"><input type="checkbox" aria-label="Tự động kiểm tra cập nhật" checked={settings.app_updates_enabled !== false} onChange={event => update('app_updates_enabled', event.target.checked)} /><span className="proxy-switch-text">Tự động kiểm tra cập nhật<em>Kiểm tra bản chính thức mới khi khởi động và mỗi 6 giờ trong khi chạy. Có hiệu lực sau khi lưu; tải xuống và khởi động lại cài đặt đều do bạn xác nhận.</em></span></label>
              <button type="button" className="btn btn-outline" disabled={settings.app_updates_enabled === false} onClick={() => window.dispatchEvent(new CustomEvent('hongguo-check-app-update'))}><RefreshCw size={15} />Kiểm tra cập nhật</button>
              <p className="settings-hint">Có thể mở lại nhắc nhở cập nhật đã đóng, xem tiến độ tải hoặc cài đặt bản mới đã tải về. Sau khi tắt kiểm tra cần bật lại và lưu.</p>
            </div>
          )}

          {!preview && <AnnouncementSettings />}
        </fieldset>
      </div>

      {/* Thanh footer lưu cài đặt chung */}
      <div className="settings-footer">
        {dirty && <span className="settings-hint" role="status">Có thay đổi chưa lưu</span>}
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Đang lưu…' : saved ? <><Check size={16} /> Đã lưu</> : 'Lưu cài đặt'}
        </button>
      </div>
      {saveError && !proxyOpen && <p className="alert alert-error" role="alert">{saveError}</p>}

      {proxyOpen && proxyDraft && (
        <div className="proxy-modal-mask" onClick={() => !saving && closeProxy()}>
          <div className="proxy-modal" role="dialog" aria-modal="true" aria-label="Cài đặt proxy mạng" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <Globe size={18} />
                <span>Cài đặt proxy mạng</span>
              </div>
              <button className="icon-btn" title="Đóng" disabled={saving} onClick={closeProxy}>
                <X size={16} />
              </button>
            </div>

            <fieldset className="proxy-modal-body" disabled={saving}>
              <label className="proxy-switch-row">
                <input
                  type="checkbox"
                  checked={proxyDraft.proxy_enabled}
                  onChange={(e) => patchDraft('proxy_enabled', e.target.checked)}
                />
                <span className="proxy-switch-text">
                  Bật proxy
                  <em>Khi tắt proxy sẽ không có hiệu lực, tất cả yêu cầu kết nối trực tiếp</em>
                </span>
              </label>

              <div className={`proxy-fields ${proxyDraft.proxy_enabled ? '' : 'proxy-fields-disabled'}`}>
                <div className="settings-group">
                  <label className="settings-label">Chế độ proxy</label>
                  <div className="proxy-mode-list">
                    {PROXY_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`proxy-mode-item ${mode === m.value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="proxy_mode"
                          value={m.value}
                          checked={mode === m.value}
                          disabled={!proxyDraft.proxy_enabled}
                          onChange={() => patchDraft('proxy_mode', m.value)}
                        />
                        <span className="proxy-mode-body">
                          <b>{m.label}</b>
                          <em>{m.desc}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Địa chỉ proxy</label>
                    <div className="proxy-host-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="Địa chỉ máy chủ proxy"
                        placeholder="127.0.0.1"
                        value={proxyDraft.proxy_host}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_host', e.target.value)}
                      />
                      <span className="proxy-colon">:</span>
                      <input
                        type="number"
                        className="input-field proxy-port"
                        aria-label="Cổng proxy"
                        placeholder="7890"
                        min="1"
                        max="65535"
                        value={proxyDraft.proxy_port}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_port', e.target.value)}
                      />
                    </div>
                    <div className="preset-row mt8">
                      {PORT_PRESETS.map((p) => (
                        <button
                          key={p.port}
                          type="button"
                          className="btn-chip"
                          disabled={!proxyDraft.proxy_enabled}
                          onClick={() => patchDraft('proxy_port', p.port)}
                        >
                          {p.label} {p.port}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Xác thực proxy (Tùy chọn)</label>
                    <div className="proxy-auth-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="Tên người dùng proxy"
                        placeholder="Tên người dùng"
                        autoComplete="off"
                        value={proxyDraft.proxy_username}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_username', e.target.value)}
                      />
                      <input
                        type="password"
                        className="input-field"
                        aria-label="Mật khẩu proxy"
                        placeholder={settings.proxy_password_set ? 'Đã lưu, để trống nếu không đổi' : 'Mật khẩu'}
                        autoComplete="new-password"
                        value={proxyDraft.proxy_password}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => {
                          patchDraft('proxy_password', e.target.value);
                          if (e.target.value) patchDraft('clear_proxy_password', false);
                        }}
                      />
                    </div>
                    <p className="settings-hint">{proxyDraft.clear_proxy_password ? 'Sau khi lưu sẽ xóa mật khẩu đã lưu.' : settings.proxy_password_set ? 'Đã lưu mật khẩu. Nhập mật khẩu mới để thay thế; để trống sẽ giữ nguyên.' : 'Để trống nếu proxy không yêu cầu xác thực'}</p>
                    {settings.proxy_password_set && <button type="button" className="btn btn-outline" disabled={!proxyDraft.proxy_enabled} onClick={() => { patchDraft('proxy_password', ''); patchDraft('clear_proxy_password', true); }}>Xóa mật khẩu đã lưu</button>}
                  </div>
                )}
              </div>

              <p className="settings-hint">Kiểm tra chỉ kiểm tra kết nối API và tải về tới Baidu, không đại diện cho trạng thái proxy của các yêu cầu trình duyệt như trang Khám phá.</p>
              {testResult && (
                <div className={`proxy-test-result ${testResult.success ? 'ok' : 'fail'}`}>
                  {testResult.success ? <Check size={15} /> : <AlertCircle size={15} />}
                  <span>
                    {testResult.success ? testResult.message : testResult.error}
                    {testResult.success && testResult.via ? ` · Qua ${testResult.via}` : ''}
                  </span>
                </div>
              )}
              {saveError && <p className="alert alert-error" role="alert">{saveError}</p>}
            </fieldset>

            <div className="proxy-modal-foot">
              <button className="btn btn-outline" onClick={runTest} disabled={testing || saving}>
                <RefreshCw size={15} />
                {testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
              </button>
              <div className="proxy-foot-right">
                <button className="btn btn-outline" disabled={saving} onClick={closeProxy}>Hủy</button>
                <button className="btn btn-primary" disabled={saving} onClick={applyProxy}>
                  <Check size={15} />
                  {saving ? 'Đang lưu…' : 'Lưu và áp dụng'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default SettingsPage;
