import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, RefreshCw } from './icons';
import { notifyMediaSourcesChanged } from './useMediaSources';
import { waitForRequest } from './randomDramaModel.mjs';
import './CustomSources.css';

const emptyDraft = () => ({ name: '', url: '', enabled: true });
export default function CustomSources({ active = true }) {
  const [sources, setSources] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const listVersion = useRef(0);
  const testController = useRef(null);
  const mutation = useRef(false);

  const load = useCallback(async () => {
    const version = ++listVersion.current;
    setLoading(true);
    try {
      const result = await window.electronAPI.getCustomSources();
      if (version !== listVersion.current) return;
      if (!result?.success) throw new Error(result?.error || 'Tải nguồn tùy chỉnh thất bại');
      setSources(result.sources || []);
    } catch (cause) { if (version === listVersion.current) setError(cause.message || 'Tải nguồn tùy chỉnh thất bại'); }
    finally { if (version === listVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (active) load();
    else { testController.current?.abort(); setBusy(current => current === 'test' ? '' : current); }
    return () => { listVersion.current++; testController.current?.abort(); };
  }, [active, load]);

  const patch = (key, value) => {
    testController.current?.abort(); setMessage(''); setError('');
    setDraft(current => ({ ...current, [key]: value }));
  };
  const edit = source => { testController.current?.abort(); setDraft({ ...source }); setDeleting(''); setMessage(''); setError(''); };
  const reset = () => { testController.current?.abort(); setDraft(emptyDraft()); setMessage(''); setError(''); };

  const test = async () => {
    if (busy || mutation.current) return;
    const controller = new AbortController();
    testController.current = controller;
    setBusy('test'); setMessage(''); setError('');
    try {
      const result = await waitForRequest(window.electronAPI.testCustomSource(draft), { signal: controller.signal, message: 'Kiểm tra hết thời gian, vui lòng kiểm tra lại địa chỉ API rồi thử lại' });
      if (controller.signal.aborted) return;
      if (!result?.success) throw new Error(result?.error || 'Kiểm tra thất bại, vui lòng kiểm tra địa chỉ API');
      setMessage(`Kết nối danh mục thành công, trả về ${result.count || 0} phim. Kiểm tra không đảm bảo mọi tập đều phát được; nhấn lưu để thêm vào danh sách nguồn.`);
    } catch (cause) { if (!controller.signal.aborted) setError(cause.message || 'Kiểm tra nguồn thất bại'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  };

  const persist = async (source, kind = 'save') => {
    if (busy || mutation.current) return;
    mutation.current = true; setBusy(kind); setMessage(''); setError('');
    try {
      const result = kind === 'delete' ? await window.electronAPI.deleteCustomSource(source.id)
        : await window.electronAPI.saveCustomSource(source);
      if (!result?.success) throw new Error(result?.error || 'Cấu hình nguồn chưa được lưu, vui lòng thử lại');
      notifyMediaSourcesChanged();
      if (kind === 'save' || (kind === 'delete' && draft.id === source.id)) setDraft(emptyDraft());
      setDeleting('');
      setMessage(kind === 'delete' ? 'Đã xóa cấu hình nguồn, video cục bộ vẫn được giữ nguyên.' : kind === 'toggle' ? (source.enabled ? 'Nguồn đã được bật.' : 'Nguồn đã tạm dừng.') : 'Nguồn đã được lưu, có thể chọn trong Tìm kiếm, Khám phá và Xem ngẫu nhiên.');
      await load();
    } catch (cause) { setError(cause.message || 'Cấu hình nguồn chưa được lưu, vui lòng thử lại'); }
    finally { mutation.current = false; setBusy(''); }
  };

  return <section className="settings-card custom-sources" aria-labelledby="custom-sources-title">
    <div className="custom-sources-heading"><Globe size={18} /><h3 id="custom-sources-title">Nguồn phát tùy chỉnh</h3></div>
    <p className="settings-hint">Kết nối Apple CMS V10 JSON API mà bạn có quyền sử dụng. Chỉ hỗ trợ liên kết trực tiếp MP4 / M3U8 từ API, không hỗ trợ trang web tùy ý, plugin hoặc mở khóa trả phí.</p>
    <form onSubmit={event => { event.preventDefault(); persist(draft); }}>
      <fieldset disabled={!!busy} className="custom-source-form">
        <label>Tên nguồn<input className="input-field" value={draft.name} maxLength={60} required placeholder="Ví dụ: Kho phim của tôi" onChange={event => patch('name', event.target.value)} /></label>
        <label>Địa chỉ API<input className="input-field" type="url" value={draft.url} maxLength={2048} required placeholder="https://example.com/api.php/provide/vod/" spellCheck={false} autoComplete="off" onChange={event => patch('url', event.target.value)} /></label>
        <label className="custom-source-enabled"><input type="checkbox" checked={draft.enabled !== false} onChange={event => patch('enabled', event.target.checked)} />Bật sau khi lưu</label>
        <div className="custom-source-actions"><button type="button" className="btn btn-outline" disabled={!draft.name.trim() || !draft.url.trim()} onClick={test}><RefreshCw size={14} />{busy === 'test' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}</button>
          <button className="btn btn-primary" type="submit">{busy === 'save' ? 'Đang lưu…' : draft.id ? 'Lưu thay đổi' : 'Lưu nguồn'}</button>
          {draft.id && <button className="btn btn-outline" type="button" onClick={reset}>Hủy chỉnh sửa</button>}
        </div>
      </fieldset>
    </form>
    {busy === 'test' && <button className="btn btn-outline btn-sm" onClick={() => { testController.current?.abort(); setBusy(''); setMessage('Đã hủy kiểm tra.'); }}>Hủy kiểm tra</button>}
    {message && <p className="custom-source-message" role="status">{message}</p>}
    {error && <div className="custom-source-error" role="alert"><p>{error}</p><button className="btn btn-outline btn-sm" disabled={!!busy || loading} onClick={() => { setError(''); load(); }}>Tải lại cấu hình</button></div>}
    <div className="custom-source-list" aria-label="Nguồn tùy chỉnh đã lưu">
      {loading && <p className="settings-hint" role="status">Đang tải danh sách nguồn…</p>}
      {!loading && sources.length === 0 && <p className="settings-hint">Chưa có nguồn tùy chỉnh nào. Các nguồn tích hợp sẵn có thể cấu hình ở trên.</p>}
      {sources.map(source => <div className="custom-source-row" key={source.id}>
        <div className="custom-source-info"><strong>{source.name}</strong><span>{source.enabled ? 'Đã bật' : 'Đã tắt'}</span><p>{source.url}</p></div>
        <div className="custom-source-actions"><button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => persist({ ...source, enabled: !source.enabled }, 'toggle')}>{source.enabled ? 'Tắt' : 'Bật'}</button>
          <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => edit(source)}>Sửa</button>
          <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => setDeleting(source.id)}>Xóa</button></div>
        {deleting === source.id && <div className="custom-source-delete" role="group" aria-label={`Xác nhận xóa ${source.name}`}><p>Xóa cấu hình "{source.name}"? Video đã tải trên máy vẫn được giữ lại; tính năng phát trực tuyến từ nguồn này sẽ không còn khả dụng.</p><button className="btn btn-danger-solid btn-sm" disabled={!!busy} onClick={() => persist(source, 'delete')}>Xác nhận xóa</button><button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => setDeleting('')}>Giữ lại nguồn</button></div>}
      </div>)}
    </div>
  </section>;
}
