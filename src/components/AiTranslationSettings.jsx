import React, { useState, useEffect } from 'react';
import {
  getTranslationConfig,
  saveTranslationConfig,
  getTranslationCacheCount,
  clearTranslationCache,
  translateText,
  getCustomOverrides,
  removeCustomOverride,
} from '../services/translator';
import { Globe, RefreshCw, Check, AlertCircle } from './icons';

export default function AiTranslationSettings() {
  const [config, setConfig] = useState(getTranslationConfig);
  const [showKey, setShowKey] = useState(false);
  const [testInput, setTestInput] = useState('十八岁太奶奶驾到，重整家族荣耀');
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [cacheCount, setCacheCount] = useState(getTranslationCacheCount);
  const [toast, setToast] = useState('');
  const [overrides, setOverrides] = useState(getCustomOverrides);

  useEffect(() => {
    const handleOverrideUpdate = () => setOverrides(getCustomOverrides());
    window.addEventListener('hg-translation-override-changed', handleOverrideUpdate);
    return () => window.removeEventListener('hg-translation-override-changed', handleOverrideUpdate);
  }, []);

  const handleDeleteOverride = (zh) => {
    const updated = removeCustomOverride(zh);
    setOverrides(updated);
    setToast('Đã xóa bản dịch tùy chỉnh!');
    setTimeout(() => setToast(''), 2500);
  };

  const update = (patch) => {
    const next = saveTranslationConfig(patch);
    setConfig(next);
  };

  const handleTest = async () => {
    if (!testInput.trim()) return;
    setTesting(true);
    setTestResult('');
    setTestError('');
    try {
      // Dịch thử nghiệm trực tiếp với cấu hình hiện tại, không dùng cache
      const res = await translateText(testInput, { ...config, isTest: true, skipCache: true });
      if (!res || res === testInput) {
        setTestError('Không nhận được bản dịch tiếng Việt từ API.');
      } else {
        setTestResult(res);
      }
      setCacheCount(getTranslationCacheCount());
    } catch (err) {
      setTestError(err.message || 'Dịch thử nghiệm thất bại');
    } finally {
      setTesting(false);
    }
  };

  const handleClearCache = () => {
    const removed = clearTranslationCache();
    setCacheCount(0);
    setToast(`Đã xóa ${removed} bản dịch trong bộ nhớ đệm.`);
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <section className="settings-section">
      <div className="section-head">
        <Globe size={18} />
        <div>
          <h3>Dịch thuật AI & Dịch tự động Phim Ngắn</h3>
          <p className="section-desc">
            Tự động dịch tiêu đề và mô tả phim tiếng Trung sang tiếng Việt bằng Google Dịch hoặc mô hình AI (DeepSeek, OpenAI, v.v.).
          </p>
        </div>
      </div>

      <div className="settings-card">
        {/* Toggle bật/tắt */}
        <div className="setting-row">
          <div>
            <div className="setting-label">Tự động dịch sang tiếng Việt</div>
            <div className="setting-sub">Dịch tự động tiêu đề và tóm tắt nội dung khi duyệt và xem phim</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        {/* Toggle hiển thị tên gốc */}
        <div className="setting-row">
          <div>
            <div className="setting-label">Hiển thị kèm tên gốc tiếng Trung</div>
            <div className="setting-sub">Hiển thị dòng chữ nhỏ chứa tên gốc bên dưới tiêu đề đã dịch</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.showOriginal}
              onChange={(e) => update({ showOriginal: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        {/* Toggle đặt tên file tiếng Việt */}
        <div className="setting-row">
          <div>
            <div className="setting-label">Đặt tên thư mục & tập phim bằng tiếng Việt khi tải về</div>
            <div className="setting-sub">Tự động đặt tên thư mục và file video bằng tiếng Việt đã dịch (rất tiện cho Plex/Emby/Jellyfin)</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.vietnamese_filenames !== false}
              onChange={(e) => update({ vietnamese_filenames: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        {/* Lựa chọn phương thức dịch */}
        <div className="setting-row">
          <div>
            <div className="setting-label">Dịch vụ dịch thuật</div>
            <div className="setting-sub">Chọn Google Dịch miễn phí hoặc AI tùy chỉnh qua API Key</div>
          </div>
          <select
            className="input-field"
            style={{ width: 'auto', minWidth: '220px' }}
            value={config.provider}
            onChange={(e) => update({ provider: e.target.value })}
          >
            <option value="google">Google Dịch (Miễn phí, tức thì)</option>
            <option value="custom_ai">AI tùy chỉnh (DeepSeek / OpenAI...)</option>
          </select>
        </div>

        {/* Cấu hình khi chọn Custom AI */}
        {config.provider === 'custom_ai' && (
          <div className="ai-config-box" style={{ marginTop: '16px', padding: '16px', background: 'var(--bg-inset)', borderRadius: '8px' }}>
            <div className="setting-field" style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                API Endpoint (Base URL)
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="https://api.deepseek.com/v1"
                value={config.endpoint}
                onChange={(e) => update({ endpoint: e.target.value })}
              />
              <small style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                Hỗ trợ bất kỳ endpoint nào tương thích chuẩn OpenAI (ví dụ: DeepSeek, OpenAI, Groq, OpenRouter, Ollama...)
              </small>
            </div>

            <div className="setting-field" style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                API Key
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  className="input-field"
                  placeholder="sk-..."
                  value={config.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </div>

            <div className="setting-field">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                Tên Model (Mô hình AI)
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="deepseek-chat hoặc gpt-4o-mini"
                value={config.model}
                onChange={(e) => update({ model: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Kiểm tra kết nối dịch */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-muted)' }}>
          <div className="setting-label" style={{ marginBottom: '8px' }}>Thử nghiệm dịch</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input-field"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              style={{ flex: 1, minWidth: '240px' }}
              placeholder="Nhập câu tiếng Trung cần dịch thử..."
            />
            <button
              type="button"
              className="btn btn-outline"
              disabled={testing || !testInput.trim()}
              onClick={handleTest}
            >
              {testing ? <><RefreshCw size={14} className="spin" /> Đang dịch…</> : 'Dịch thử'}
            </button>
          </div>

          {testResult && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', color: 'var(--success)' }}>
              <strong>Kết quả dịch:</strong> {testResult}
            </div>
          )}

          {testError && (
            <div className="alert alert-error" style={{ marginTop: '10px', fontSize: '12px' }}>
              <AlertCircle size={14} /> {testError}
            </div>
          )}
        </div>

        {/* Bộ nhớ đệm */}
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Đã lưu <strong>{cacheCount}</strong> mục trong bộ nhớ đệm (giúp hiển thị tức thì, không tốn API).
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleClearCache}
            disabled={cacheCount === 0}
          >
            Xóa bộ nhớ đệm bản dịch
          </button>
        </div>

        {/* Danh sách bản dịch đã tùy chỉnh */}
        {Object.keys(overrides).length > 0 && (
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-muted)' }}>
            <div className="setting-label" style={{ marginBottom: '8px' }}>
              Bản dịch đã chỉnh sửa thủ công ({Object.keys(overrides).length})
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {Object.entries(overrides).map(([zh, vi]) => (
                <div
                  key={zh}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'var(--bg-inset)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{zh}</span> ➔ <strong style={{ color: 'var(--text-primary)' }}>{vi}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '2px 8px', fontSize: '11px', height: '24px' }}
                    onClick={() => handleDeleteOverride(zh)}
                    title="Khôi phục về bản dịch tự động"
                  >
                    Xóa
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {toast && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--success)' }}>
            <Check size={12} /> {toast}
          </div>
        )}
      </div>
    </section>
  );
}
