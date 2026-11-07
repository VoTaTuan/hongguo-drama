import React, { useState, useEffect, useCallback, useRef } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './Browse.css';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { Film, RefreshCw, Download, Play, Check, X, Copy, Edit3, Share2, Image as ImageIcon } from './icons';
import { isSubmitKey, parseEpisodeRange } from './episodeRange';
import { DramaTitle, DramaDescription } from './TranslatedText';
import { getCachedTranslation, saveCustomOverride, removeCustomOverride, getTranslationConfig } from '../services/translator';

/**
 * SeriesDownloadDrawer —— Ngăn chi tiết + chọn tập để tải, dùng chung cho Khám phá và Quản lý tải về.
 *
 * `item` = { series_id, series_title, cover?, description? }; đặt null để đóng.
 * Luồng: search-resolve lấy toàn bộ tập -> get-series-episodes gộp trạng thái đã tải -> chọn tập -> hongguoDownloadBatch.
 */
function SeriesDownloadDrawer({ item, active = true, onClose, onQueued, showToast }) {
  const { sources: mediaSources } = useMediaSources();
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rangeInput, setRangeInput] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editTitleState, setEditTitleState] = useState(null);
  const [descOpen, setDescOpen] = useState(false);
  const lastPicked = useRef(null);
  const detailRequest = useRef(0);
  const copiedTimer = useRef(null);

  useEffect(() => () => { detailRequest.current++; clearTimeout(copiedTimer.current); }, []);

  useEffect(() => {
    const request = ++detailRequest.current;
    setDetail(null);
    setSelectedIdx(new Set());
    setRangeInput('');
    setRangeError('');
    setEditTitleState(null);
    setDescOpen(false);
    lastPicked.current = null;
    if (!item) { setDetailLoading(false); return; }
    setDetailLoading(true);
    (async () => {
      try {
        const res = await window.electronAPI.searchResolve(item.series_id);
        if (request !== detailRequest.current) return;
        if (!res || !res.success) {
          showToast((res && res.error) || 'Lấy danh sách tập thất bại', 'error');
          onClose();
          return;
        }
        const data = res.data;
        // Gộp trạng thái tải về
        const epRes = await window.electronAPI.getSeriesEpisodes(item.series_id);
        if (request !== detailRequest.current) return;
        const statusMap = {};
        if (epRes && epRes.success) {
          for (const e of epRes.data.episodes) statusMap[e.vid_index] = e;
        }
        const episodes = data.episodes.map((ep) => ({
          ...ep,
          status: statusMap[ep.vid_index] ? statusMap[ep.vid_index].status : 'missing',
          progress: statusMap[ep.vid_index] ? statusMap[ep.vid_index].progress : 0,
          fileUrl: statusMap[ep.vid_index] ? statusMap[ep.vid_index].fileUrl : null,
        }));
        const initialDetail = {
          ...data,
          series_title: item.series_title || data.series_title,
          cover: item.cover || data.cover || '',
          description: item.description || data.description || '',
          episodes,
          completedCount: episodes.filter((e) => e.status === 'completed').length,
        };
        setDetail(initialDetail);
        // Mặc định chọn tất cả các tập chưa tải
        setSelectedIdx(new Set(episodes.filter((e) => !e.locked && e.status !== 'completed').map((e) => e.vid_index)));

        if (!initialDetail.description && window.electronAPI?.getPublicDetails && /^\d+$/.test(String(item.series_id))) {
          window.electronAPI.getPublicDetails(item.series_id).then((pub) => {
            if (pub && pub.description && request === detailRequest.current) {
              setDetail((prev) => prev && prev.series_id === item.series_id ? { ...prev, description: pub.description, cover: pub.cover || prev.cover } : prev);
            }
          }).catch(() => {});
        }
      } catch (e) {
        if (request === detailRequest.current) { showToast('Mở thất bại: ' + e.message, 'error'); onClose(); }
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    })();
    // Chỉ tải lại khi đổi phim; showToast/onClose của cha có thể đổi danh tính mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.series_id]);

  const downloadThumbnail = async () => {
    if (!detail?.cover) return;
    try {
      showToast('Đang tải ảnh bìa…', 'info');
      const response = await fetch(detail.cover);
      if (!response.ok) throw new Error('Không thể tải ảnh');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const cleanName = (detail.series_title || 'thumbnail').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
      link.download = `${cleanName}_cover.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Đã tải ảnh bìa thành công!');
    } catch (err) {
      if (window.electronAPI?.openExternalUrl) {
        window.electronAPI.openExternalUrl(detail.cover);
      } else {
        window.open(detail.cover, '_blank');
      }
      showToast('Đã mở ảnh bìa trong trình duyệt');
    }
  };

  const handleCopyDramaInfo = async () => {
    if (!detail) return;
    const titleZh = detail.series_title || '';
    const titleVi = getCachedTranslation(titleZh) || titleZh;
    const totalEps = detail.total || detail.episodes?.length || 0;
    const rawDesc = detail.description || detail.intro || '';
    const descVi = rawDesc ? (getCachedTranslation(rawDesc) || rawDesc) : 'Chưa có tóm tắt';
    const coverUrl = detail.cover || '';

    const lines = [
      `🎬 Phim: ${titleVi}`,
      titleZh && titleZh !== titleVi ? `🏷️ Tên gốc: ${titleZh}` : null,
      `🔢 Số tập: ${totalEps} tập`,
      `📝 Tóm tắt nội dung:\n${descVi}`,
      coverUrl ? `🖼️ Ảnh bìa: ${coverUrl}` : null,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n\n'));
      setCopied(true);
      showToast('Đã sao chép thông tin phim vào bộ nhớ tạm!');
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      showToast('Sao chép thất bại: ' + err.message, 'error');
    }
  };

  const openEditTitleModal = (originalZh) => {
    const currentVi = getCachedTranslation(originalZh) || originalZh;
    setEditTitleState({ originalZh, customVi: currentVi });
  };

  const handleSaveCustomTitle = () => {
    if (!editTitleState?.originalZh) return;
    const { originalZh, customVi } = editTitleState;
    saveCustomOverride(originalZh, customVi);
    showToast('Đã lưu bản dịch tùy chỉnh!');
    setEditTitleState(null);
  };

  const handleResetCustomTitle = () => {
    if (!editTitleState?.originalZh) return;
    removeCustomOverride(editTitleState.originalZh);
    showToast('Đã khôi phục bản dịch mặc định!');
    setEditTitleState(null);
  };

  const handleCopyTitleOnly = async () => {
    if (!detail) return;
    const titleZh = detail.series_title || '';
    const titleVi = getCachedTranslation(titleZh) || titleZh;
    const textToCopy = titleZh && titleZh !== titleVi ? `${titleVi} (${titleZh})` : titleVi;
    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast('Đã sao chép tựa đề phim!');
    } catch (err) {
      showToast('Sao chép thất bại: ' + err.message, 'error');
    }
  };

  // Nhấn để chọn/bỏ một tập; giữ Shift để chọn cả dải từ tập vừa nhấn trước đó.
  const toggleIdx = (idx, event) => {
    if (!detail?.episodes.some((ep) => ep.vid_index === idx && !ep.locked)) return;
    const next = new Set(selectedIdx);
    const select = !next.has(idx);
    const anchor = lastPicked.current;
    const indexes = event?.shiftKey && anchor != null
      ? detail.episodes.filter((ep) => !ep.locked && ep.vid_index >= Math.min(anchor, idx) && ep.vid_index <= Math.max(anchor, idx)).map((ep) => ep.vid_index)
      : [idx];
    for (const index of indexes) {
      if (select) next.add(index);
      else next.delete(index);
    }
    lastPicked.current = idx;
    setSelectedIdx(next);
  };

  const selectMissing = () => setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked && e.status !== 'completed').map((e) => e.vid_index)));
  const invertSelection = () => setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked && !selectedIdx.has(e.vid_index)).map((e) => e.vid_index)));

  // Chọn nhanh khoảng: 1-50 / 10 tập đầu / 30 tập cuối / chọn tất cả / xóa chọn
  const applyRange = (expr) => {
    if (!detail) return;
    try {
      const nums = parseEpisodeRange(expr, detail.episodes.length);
      setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked && nums.has(e.vid_index)).map((e) => e.vid_index)));
      setRangeError('');
    } catch (error) { setRangeError(error.message); }
  };

  const downloadSelected = async () => {
    if (!detail || selectedIdx.size === 0) return;
    setSubmitting(true);
    try {
      const eps = detail.episodes.filter((e) => !e.locked && selectedIdx.has(e.vid_index));
      const transConfig = getTranslationConfig();
      let targetTitle = detail.series_title;
      if (transConfig.vietnamese_filenames) {
        const viTitle = getCachedTranslation(detail.series_title);
        if (viTitle && viTitle !== detail.series_title) {
          targetTitle = viTitle;
        }
      }
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: detail.series_id,
        seriesTitle: targetTitle,
        episodes: eps,
      });
      if (res && res.success) {
        showToast(`Đã thêm vào hàng đợi tải: ${res.count} tập`);
        onQueued?.(res);
      } else {
        showToast((res && res.error) || 'Gửi tải về thất bại', 'error');
      }
    } catch (e) {
      showToast('Lỗi gửi tải: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Bắt đầu từ tập đầu tiên; trình phát chọn nguồn cục bộ hoặc trực tuyến theo trạng thái thực tế.
  const playNow = async () => {
    if (!detail) return;
    const first = detail.episodes.find((e) => !e.locked);
    if (!first) return;
    try {
      const res = await window.electronAPI.playSeries({ seriesId: detail.series_id, vidIndex: first.vid_index });
      if (res?.success) onClose();
      else showToast(res?.error || 'Mở trình phát thất bại, vui lòng thử lại', 'error');
    } catch (e) {
      showToast('Mở trình phát thất bại: ' + e.message, 'error');
    }
  };

  const close = useCallback(() => onClose(), [onClose]);
  useDialogKeyboard(active && !!item && !editTitleState, close, '.browse-drawer');

  if (!item) return null;

  const rawDescription = detail?.description || detail?.intro || '';
  const translatedTitle = detail ? getCachedTranslation(detail.series_title) : '';
  const originalTitle = translatedTitle && translatedTitle !== detail.series_title ? detail.series_title : '';
  const lockedCount = detail ? detail.episodes.filter((ep) => ep.locked).length : 0;
  const missingCount = detail ? detail.episodes.filter((ep) => !ep.locked && ep.status !== 'completed').length : 0;
  const selectedDoneCount = detail ? detail.episodes.filter((ep) => selectedIdx.has(ep.vid_index) && ep.status === 'completed').length : 0;

  return (
    <>
      <div className="browse-drawer-mask" onClick={onClose}>
        <div className="browse-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết phim" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <div className="browse-drawer-head">
            <div className="browse-drawer-title">
              <Film size={18} />
              <span>{detail ? <DramaTitle title={detail.series_title} as="span" showOriginal={false}>{`《${detail.series_title}》`}</DramaTitle> : 'Đang tải…'}</span>
            </div>
            <div className="browse-drawer-tools">
              {detail && (
                <>
                  <button type="button" className="icon-btn" onClick={handleCopyTitleOnly} title="Sao chép tựa đề phim"><Copy size={15} /></button>
                  <button type="button" className="icon-btn" onClick={() => openEditTitleModal(detail.series_title)} title="Sửa bản dịch tên phim theo ý bạn"><Edit3 size={15} /></button>
                  <button type="button" className="icon-btn" onClick={handleCopyDramaInfo} title="Sao chép toàn bộ thông tin phim (tên Việt, tên gốc, số tập, tóm tắt, ảnh bìa)">
                    {copied ? <Check size={15} /> : <Share2 size={15} />}
                  </button>
                  {detail.cover && <button type="button" className="icon-btn" onClick={downloadThumbnail} title="Tải ảnh bìa (thumbnail) về máy"><ImageIcon size={15} /></button>}
                </>
              )}
              <button className="icon-btn" onClick={onClose} title="Đóng">
                <X size={16} />
              </button>
            </div>
          </div>

          {detailLoading && (
            <div className="browse-loading">
              <RefreshCw size={18} className="spin" />
              <span>Đang lấy toàn bộ tập…</span>
            </div>
          )}

          {detail && (
            <>
              <div className="browse-drawer-body">
                <div className="browse-drawer-info">
                  {detail.cover && <img src={detail.cover} alt="" className="browse-drawer-cover" />}
                  <div className="browse-drawer-meta">
                    <div className="browse-drawer-count">
                      {mediaSourceLabel(detail.series_id, mediaSources)} · {detail.total} tập · Đã tải <b>{detail.completedCount}</b>
                      {originalTitle && <span className="browse-drawer-original" title="Tên gốc"> · {originalTitle}</span>}
                    </div>
                    {rawDescription && (
                      <>
                        <DramaDescription description={rawDescription} className={`browse-drawer-desc ${descOpen ? 'is-open' : ''}`}>{rawDescription}</DramaDescription>
                        {rawDescription.length > 140 && (
                          <button type="button" className="browse-desc-toggle" onClick={() => setDescOpen((open) => !open)}>
                            {descOpen ? 'Thu gọn' : 'Xem thêm'}
                          </button>
                        )}
                      </>
                    )}
                    {detail.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
                      <div className="browse-drawer-sub">Nguồn web chỉ có {detail.web_accessible_episodes} tập đầu, các tập còn lại tự lấy qua nguồn App.</div>
                    )}
                    {lockedCount > 0 && <div className="browse-drawer-sub">{lockedCount} tập "Đã khóa" cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa.</div>}
                  </div>
                </div>

                <div className="browse-pick-bar">
                  <div className="browse-range-row">
                    <input
                      type="text"
                      className="input-field"
                      aria-label="Chọn phạm vi tập"
                      placeholder="Khoảng, vd: 1-50 hoặc 1,3,5"
                      value={rangeInput}
                      onChange={(e) => { setRangeInput(e.target.value); setRangeError(''); }}
                      onKeyDown={(e) => isSubmitKey(e) && applyRange(rangeInput)}
                    />
                    <button className="btn btn-outline btn-sm" onClick={() => applyRange(rangeInput)}>Áp dụng</button>
                  </div>
                  <div className="preset-row">
                    <button className="btn-chip" onClick={selectMissing} title="Chỉ chọn các tập chưa tải">Chưa tải ({missingCount})</button>
                    <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(10, detail.total)}`)}>10 tập đầu</button>
                    <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(30, detail.total)}`)}>30 tập đầu</button>
                    <button className="btn-chip" onClick={() => applyRange(`${Math.max(1, detail.total - 29)}-${detail.total}`)}>30 tập cuối</button>
                    <button className="btn-chip" onClick={() => setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked).map((e) => e.vid_index)))}>Chọn tất cả</button>
                    <button className="btn-chip" onClick={invertSelection}>Đảo chọn</button>
                    <button className="btn-chip" onClick={() => setSelectedIdx(new Set())}>Xóa chọn</button>
                  </div>
                  {rangeError && <p className="alert alert-error" role="alert">{rangeError}</p>}
                </div>

                <div className="browse-eps-legend" aria-hidden="true">
                  <span><i className="ep-key ep-key-missing" />Chưa tải</span>
                  <span><i className="ep-key ep-key-picked" />Sẽ tải</span>
                  <span><i className="ep-key ep-key-completed" />Đã tải (chọn lại để tải lại)</span>
                  <span className="browse-eps-hint">Giữ Shift để chọn một dải tập</span>
                </div>

                <div className="browse-eps">
                  {detail.episodes.map((ep) => {
                    const picked = selectedIdx.has(ep.vid_index);
                    return (
                      <button
                        disabled={ep.locked === true}
                        aria-pressed={picked}
                        key={ep.vid_index}
                        className={`ep-chip ep-${ep.status} ${picked ? 'ep-picked' : ''}`}
                        onClick={(event) => toggleIdx(ep.vid_index, event)}
                        title={ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : `${ep.title || `Tập ${ep.vid_index}`}${ep.status === 'completed' ? ' · đã tải' : ''}`}
                      >
                        <span className="ep-num">{ep.vid_index}</span>{ep.locked && <span className="ep-lock-label">Đã khóa</span>}
                        {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="browse-drawer-foot">
                <button className="btn btn-outline" disabled={!detail.episodes.some((ep) => !ep.locked)} onClick={playNow}>
                  <Play size={15} />
                  Phát ngay
                </button>
                <div className="browse-foot-summary" aria-live="polite">
                  {selectedIdx.size === 0
                    ? 'Chưa chọn tập nào'
                    : <>Sẽ tải <b>{selectedIdx.size}</b> tập{selectedDoneCount > 0 ? <> ({selectedDoneCount} tập tải lại)</> : null}</>}
                </div>
                <div className="browse-foot-right">
                  <button
                    className="btn btn-primary"
                    disabled={submitting || selectedIdx.size === 0}
                    onClick={downloadSelected}
                  >
                    <Download size={15} />
                    Tải mục đã chọn ({selectedIdx.size})
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal chỉnh sửa bản dịch tên phim */}
      {editTitleState && (
        <div className="browse-drawer-mask" style={{ zIndex: 1100 }} onClick={() => setEditTitleState(null)}>
          <div
            className="settings-card"
            style={{ maxWidth: '480px', width: '90%', margin: 'auto', background: 'var(--bg-card, #1e1e24)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit3 size={16} /> Chỉnh sửa bản dịch tên phim
              </h3>
              <button className="icon-btn" onClick={() => setEditTitleState(null)}><X size={16} /></button>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Tên gốc tiếng Trung:
              </label>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', padding: '6px 10px', background: 'var(--bg-inset)', borderRadius: '6px' }}>
                {editTitleState.originalZh}
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Tên tiếng Việt bạn muốn hiển thị:
              </label>
              <input
                type="text"
                className="input-field"
                value={editTitleState.customVi}
                onChange={(e) => setEditTitleState({ ...editTitleState, customVi: e.target.value })}
                placeholder="Nhập tên tiếng Việt theo ý muốn..."
                autoFocus
                onKeyDown={(e) => isSubmitKey(e) && handleSaveCustomTitle()}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleResetCustomTitle} title="Khôi phục về bản dịch tự động">
                Khôi phục tự động
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditTitleState(null)}>Hủy</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveCustomTitle} disabled={!editTitleState.customVi.trim()}>
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SeriesDownloadDrawer;
