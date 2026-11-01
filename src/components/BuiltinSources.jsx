import React, { useRef, useState } from 'react';
import { Globe } from './icons';
import useMediaSources, { notifyMediaSourcesChanged } from './useMediaSources';
import { BUILTIN_MEDIA_SOURCES } from './mediaSourcesModel.mjs';

export default function BuiltinSources() {
  const { sources, loading, error: loadError } = useMediaSources();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const toggle = async (id, enabled) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      const result = await window.electronAPI.setBuiltinSourceEnabled(id, enabled);
      if (!result?.success) throw new Error(result?.error || 'Trạng thái nguồn chưa được lưu, vui lòng thử lại');
    } catch (cause) { setError(cause.message || 'Trạng thái nguồn chưa được lưu, vui lòng thử lại'); }
    finally { pending.current = false; setSaving(false); }
  };
  return <section className="settings-card builtin-sources" aria-labelledby="builtin-sources-title">
    <div className="custom-sources-heading"><Globe size={18} /><h3 id="builtin-sources-title">Nguồn tích hợp sẵn</h3></div>
    <p className="settings-hint" id="builtin-sources-hint">Có hiệu lực ngay và tự động lưu. Khi tắt, tìm kiếm toàn cục, khám phá, gợi ý thịnh hành và xem ngẫu nhiên sẽ không dùng nguồn này nữa. Nguồn Hồng Quả luôn bật cố định.</p>
    {BUILTIN_MEDIA_SOURCES.map(({ id, label }) => <label className="builtin-source-row" key={id}>
      <span>{label}<em>{id === 'hongguo' ? 'Nguồn mặc định, luôn bật' : sources.some(source => source.id === id) ? 'Đã bật' : 'Đã tắt'}</em></span>
      <input type="checkbox" role="switch" aria-label={`Nguồn ${label}`} aria-describedby="builtin-sources-hint" checked={id === 'hongguo' || sources.some(source => source.id === id)} disabled={id === 'hongguo' || loading || saving || !!loadError} onChange={event => toggle(id, event.target.checked)} />
    </label>)}
    {saving && <p className="settings-hint" role="status">Đang lưu…</p>}
    {(error || loadError) && <p className="appearance-error" role="alert">{error || loadError}</p>}
    {loadError && <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={notifyMediaSourcesChanged}>Tải lại danh sách nguồn</button>}
  </section>;
}
