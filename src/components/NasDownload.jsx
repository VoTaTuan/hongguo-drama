import React, { useEffect, useId, useRef, useState } from 'react';
import { Download } from './icons';
import './NasDownload.css';

export default function NasDownload({ seriesId, quality = 'auto', disabled = false }) {
  const descriptionId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const request = useRef(0);
  const submittingRef = useRef(false);
  const eventFailure = useRef(null);
  const currentSeries = useRef(seriesId);
  currentSeries.current = seriesId;

  useEffect(() => {
    request.current++;
    submittingRef.current = false;
    eventFailure.current = null;
    setSubmitting(false);
    setFeedback(null);
    return () => {
      request.current++;
      submittingRef.current = false;
    };
  }, [seriesId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onNasExportDone?.(event => {
      if (!event || String(event.seriesId) !== String(currentSeries.current)) return;
      if (!event.success) {
        const failure = { version: request.current, message: event.error || `Tập ${event.vidIndex} đồng bộ sang NAS thất bại.` };
        eventFailure.current = failure;
        setFeedback({ kind: 'error', message: failure.message, warnings: [] });
      }
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [seriesId]);

  const submit = async () => {
    if (!seriesId || disabled || submittingRef.current) return;
    const version = ++request.current;
    const requestedSeries = String(seriesId);
    submittingRef.current = true;
    eventFailure.current = null;
    setFeedback(null);
    setSubmitting(true);
    try {
      if (!window.electronAPI?.downloadSeriesToNas) throw new Error('Môi trường hiện tại chưa hỗ trợ tải về NAS');
      const result = await window.electronAPI.downloadSeriesToNas(seriesId, quality);
      if (version !== request.current || requestedSeries !== String(currentSeries.current)) return;
      if (result?.success) {
        if (eventFailure.current?.version === version) return;
        setFeedback({
          kind: 'success',
          message: `Đã thêm ${Number(result.count) || 0} tập tải về, dùng lại ${Number(result.copied) || 0} tập có sẵn. Thư mục lưu: ${result.directory}`,
          warnings: Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [],
        });
      } else if (!result?.canceled) {
        setFeedback({ kind: 'error', message: result?.error || 'Tải về NAS thất bại, vui lòng thử lại.', warnings: [] });
      }
    } catch (failure) {
      if (version === request.current && requestedSeries === String(currentSeries.current)) {
        setFeedback({ kind: 'error', message: failure.message || 'Tải về NAS thất bại, vui lòng thử lại.', warnings: [] });
      }
    } finally {
      if (version === request.current && requestedSeries === String(currentSeries.current)) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  if (!seriesId) return null;
  return <div className="nas-download">
    <button type="button" className="btn btn-outline" onClick={submit} disabled={disabled || submitting}
      aria-describedby={descriptionId} aria-label="Tải về NAS">
      <Download size={15} />
      {submitting ? 'Đang gửi…' : 'Tải về NAS'}
    </button>
    <div id={descriptionId} className="nas-download-description">
      <p>Lưu cùng ảnh bìa và tóm tắt nội dung, ghi trực tiếp vào thư mục NAS đã chọn. Tự động dùng lại các tập đã tải và bổ sung các tập còn thiếu.</p>
      <p>Vui lòng gắn kết thư mục chia sẻ NAS vào máy tính trước khi chọn vị trí lưu. Các tập được đặt tên chuẩn theo mùa và số tập.</p>
    </div>
    {feedback?.kind === 'success' && <p className="nas-download-success" role="status">{feedback.message}</p>}
    {feedback?.kind === 'error' && <p className="nas-download-error" role="alert">{feedback.message}</p>}
    {feedback?.kind === 'success' && feedback.warnings.map(warning => <p key={warning} className="nas-download-warning">{warning}</p>)}
  </div>;
}
