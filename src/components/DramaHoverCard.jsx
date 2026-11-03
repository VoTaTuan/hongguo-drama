import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './DramaHoverCard.css';
import { Heart, Bell, Layers, Play, Download, Film, Sparkles, Check, RefreshCw } from './icons';
import { translateGenre } from './genreMap';
import { DramaTitle, DramaDescription } from './TranslatedText';
import { readLocalLibrary, saveLocalSeries, subscribeLocalLibrary } from '../localLibrary';

export default function DramaHoverCard({
  item,
  targetRect,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onPlay,
  onDownload,
  onSelectSeries,
}) {
  const [description, setDescription] = useState(item?.description || '');
  const [descLoading, setDescLoading] = useState(false);
  const [library, setLibrary] = useState(readLocalLibrary());
  const [sequels, setSequels] = useState({ open: false, loading: false, list: [], error: '' });
  const [dragPos, setDragPos] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ startX: 0, startY: 0, initLeft: 0, initTop: 0 });
  const cardRef = useRef(null);

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    if (
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.drama-desc-actions') ||
      e.target.closest('.drama-hover-btn')
    ) {
      return;
    }
    e.preventDefault();
    const currentLeft = dragPos ? dragPos.x : left;
    const currentTop = dragPos ? dragPos.y : top;

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initLeft: currentLeft,
      initTop: currentTop,
    };
    setIsDragging(true);

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragStartRef.current.startX;
      const dy = moveEvent.clientY - dragStartRef.current.startY;
      let nextX = dragStartRef.current.initLeft + dx;
      let nextY = dragStartRef.current.initTop + dy;

      const maxW = window.innerWidth - 350;
      const maxH = window.innerHeight - 80;
      nextX = Math.max(8, Math.min(nextX, maxW));
      nextY = Math.max(8, Math.min(nextY, maxH));

      setDragPos({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const seriesId = String(item?.series_id || '');
  const seriesTitle = item?.series_title || '';
  const cover = item?.cover || '';

  // Lắng nghe thay đổi của Thư viện cục bộ (Yêu thích & Theo dõi)
  useEffect(() => {
    return subscribeLocalLibrary((next) => {
      setLibrary(next);
    });
  }, []);

  const localItem = library.items.find((entry) => entry.id === seriesId);
  const isFavorite = !!localItem?.favorite;
  const isFollowed = !!localItem?.followed;

  // Tải tóm tắt nếu chưa có
  useEffect(() => {
    let unmounted = false;
    if (item?.description) {
      setDescription(item.description);
      return;
    }
    if (window.electronAPI?.getPublicDetails && /^\d+$/.test(seriesId)) {
      setDescLoading(true);
      window.electronAPI.getPublicDetails(seriesId)
        .then((res) => {
          if (!unmounted && res?.description) {
            setDescription(res.description);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!unmounted) setDescLoading(false);
        });
    }
    return () => { unmounted = true; };
  }, [seriesId, item?.description]);

  // Xử lý chuyển đổi Yêu thích
  const toggleFavorite = (e) => {
    e.stopPropagation();
    saveLocalSeries({
      id: seriesId,
      title: seriesTitle,
      cover,
      favorite: !isFavorite,
    });
  };

  // Xử lý chuyển đổi Theo dõi tập mới & phần mới
  const toggleFollow = (e) => {
    e.stopPropagation();
    saveLocalSeries({
      id: seriesId,
      title: seriesTitle,
      cover,
      followed: !isFollowed,
    });
  };

  // Tìm phần tiếp theo / mùa mới
  const handleFindSequels = async (e) => {
    e.stopPropagation();
    if (sequels.open && sequels.list.length > 0) {
      setSequels((prev) => ({ ...prev, open: false }));
      return;
    }
    setSequels({ open: true, loading: true, list: [], error: '' });
    try {
      if (!window.electronAPI?.findSeriesSequels) {
        throw new Error('Tính năng tìm phần mới chưa sẵn sàng');
      }
      const res = await window.electronAPI.findSeriesSequels(seriesId, {
        title: seriesTitle,
        series_title: seriesTitle,
        cover,
      });
      if (!res?.success) throw new Error(res?.error || 'Tìm kiếm thất bại');
      const found = res.results || [];
      setSequels({
        open: true,
        loading: false,
        list: found.filter((s) => String(s.series_id) !== seriesId),
        error: found.length === 0 ? 'Chưa tìm thấy phần tiếp theo' : '',
      });
    } catch (err) {
      setSequels({ open: true, loading: false, list: [], error: err.message || 'Lỗi tìm kiếm' });
    }
  };

  if (!item) return null;

  // Tính toán vị trí hiển thị tối ưu tránh tràn màn hình
  const cardWidth = 340;
  let top = 100;
  let left = 100;

  if (targetRect && typeof window !== 'undefined') {
    // Chiều ngang: Ưu tiên căn theo lề trái của target, nếu tràn thì dịch sang trái
    left = targetRect.left;
    if (left + cardWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - cardWidth - 16);
    }
    if (left < 16) left = 16;

    // Chiều dọc: Ưu tiên đặt phía dưới targetRect, nếu không đủ chỗ thì đặt phía trên
    const expectedHeight = sequels.open ? 380 : 260;
    if (targetRect.bottom + expectedHeight + 16 <= window.innerHeight) {
      top = targetRect.bottom + 8;
    } else if (targetRect.top - expectedHeight - 8 >= 0) {
      top = targetRect.top - expectedHeight - 8;
    } else {
      top = Math.max(16, window.innerHeight - expectedHeight - 16);
    }
  }

  const displayLeft = dragPos ? dragPos.x : left;
  const displayTop = dragPos ? dragPos.y : top;

  const content = (
    <div
      ref={cardRef}
      className={`drama-hover-portal ${isDragging ? 'is-dragging' : ''} ${dragPos ? 'is-pinned' : ''}`}
      style={{ top: `${displayTop}px`, left: `${displayLeft}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={dragPos ? undefined : onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Thanh cầm kéo di chuyển vị trí */}
      <div
        className="drama-hover-drag-handle"
        onMouseDown={handleDragStart}
        title="Nhấn giữ và kéo để di chuyển popup ra bất cứ đâu"
      >
        <span className="drama-hover-drag-grip">⠿</span>
        {dragPos ? (
          <span className="drama-hover-pinned-tag">Đã ghim vị trí</span>
        ) : (
          <span className="drama-hover-drag-tip">Kéo để di chuyển</span>
        )}
      </div>

      <button
        type="button"
        className="drama-hover-close-btn"
        title="Đóng (hoặc di chuột ra ngoài)"
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
        ✕
      </button>

      {/* Header: Ảnh bìa + Tiêu đề + Badges */}
      <div className="drama-hover-header" onMouseDown={handleDragStart}>
        {cover ? (
          <img src={cover} alt={seriesTitle} className="drama-hover-cover" />
        ) : (
          <div className="drama-hover-cover cover-placeholder"><Film size={24} /></div>
        )}
        <div className="drama-hover-info">
          <DramaTitle title={seriesTitle} showOriginal={false} as="div" className="drama-hover-title" />
          <div className="drama-hover-orig-title" title={`Tên gốc: ${seriesTitle}`}>
            Tên gốc: {seriesTitle}
          </div>
          <div className="drama-hover-badges">
            {item.completion_status === 'completed' && (
              <span className="drama-hover-badge status-completed">Đã hoàn thành</span>
            )}
            {item.completion_status === 'ongoing' && (
              <span className="drama-hover-badge status-ongoing">Đang cập nhật</span>
            )}
            {(item.episode_label || item.episode_count > 0) && (
              <span className="drama-hover-badge">
                {translateGenre(item.episode_label) || `${item.episode_count} tập`}
              </span>
            )}
            {item.heat && (
              <span className="drama-hover-badge badge-heat">🔥 {translateGenre(item.heat)}</span>
            )}
            {item.rank > 0 && (
              <span className="drama-hover-badge">Hạng {item.rank}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tags / Thể loại */}
      {item.tags && item.tags.length > 0 && (
        <div className="drama-hover-tags">
          {item.tags.map((t) => {
            const mapped = translateGenre(t);
            return (
              <span key={t} className="drama-hover-tag">
                {mapped && mapped !== t ? mapped : <DramaTitle title={t} showOriginal={false} as="span">{t}</DramaTitle>}
              </span>
            );
          })}
        </div>
      )}

      {/* Tóm tắt cốt truyện dịch sang tiếng Việt */}
      <div className={`drama-hover-desc ${!description && !descLoading ? 'empty' : ''}`}>
        {descLoading ? (
          <span className="drama-desc-loading">Đang lấy tóm tắt nội dung…</span>
        ) : description ? (
          <DramaDescription description={description} />
        ) : (
          'Chưa có thông tin tóm tắt cốt truyện.'
        )}
      </div>

      {/* Hộp hiển thị kết quả tìm phần mới */}
      {sequels.open && (
        <div className="drama-hover-sequels">
          <div className="drama-hover-sequels-title">
            <Layers size={14} />
            <span>Các phần tiếp theo</span>
            {sequels.loading && <RefreshCw size={12} className="spin" />}
          </div>
          {sequels.loading && <p className="settings-hint">Đang quét các phần tiếp theo...</p>}
          {sequels.error && <p className="settings-hint">{sequels.error}</p>}
          {!sequels.loading && sequels.list.length > 0 && (
            <div className="drama-hover-sequel-list">
              {sequels.list.map((seq) => (
                <div key={seq.series_id} className="drama-hover-sequel-item">
                  <span className="drama-hover-sequel-name">
                    <DramaTitle title={seq.series_title} showOriginal={false}>{seq.series_title}</DramaTitle>
                  </span>
                  <div className="drama-hover-sequel-btns">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onPlay) onPlay(seq);
                        else if (onSelectSeries) onSelectSeries(seq);
                      }}
                      title="Phát ngay tập 1 của phần này"
                    >
                      Xem ngay
                    </button>
                    {onSelectSeries && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSeries(seq);
                        }}
                        title="Xem danh sách tập & tải về"
                      >
                        Chi tiết
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="drama-hover-actions">
        {/* Nút Yêu thích */}
        <button
          type="button"
          className={`drama-hover-btn ${isFavorite ? 'active-favorite' : ''}`}
          onClick={toggleFavorite}
          title={isFavorite ? 'Bỏ yêu thích' : 'Lưu vào danh sách yêu thích'}
        >
          <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          <span>{isFavorite ? 'Đã thích' : 'Yêu thích'}</span>
        </button>

        {/* Nút Theo dõi cập nhật */}
        <button
          type="button"
          className={`drama-hover-btn ${isFollowed ? 'active-followed' : ''}`}
          onClick={toggleFollow}
          title={isFollowed ? 'Bỏ theo dõi cập nhật' : 'Theo dõi tập mới & phần mới'}
        >
          <Bell size={14} fill={isFollowed ? 'currentColor' : 'none'} />
          <span>{isFollowed ? 'Đang theo dõi' : 'Theo dõi'}</span>
        </button>

        {/* Nút Tìm phần mới */}
        <button
          type="button"
          className="drama-hover-btn"
          onClick={handleFindSequels}
          title="Tìm các phần tiếp theo, mùa mới của phim này"
        >
          <Layers size={14} />
          <span>Tìm phần mới</span>
        </button>

        {/* Nút Tải về */}
        {onDownload && (
          <button
            type="button"
            className="drama-hover-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item);
            }}
            title="Tải các tập phim này"
          >
            <Download size={14} />
            <span>Tải về</span>
          </button>
        )}

        {/* Nút Xem ngay */}
        {onPlay && (
          <button
            type="button"
            className="drama-hover-btn btn-play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(item);
            }}
            title="Xem phim ngay"
          >
            <Play size={14} />
            <span>Xem</span>
          </button>
        )}
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
