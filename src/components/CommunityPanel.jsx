import React, { useEffect, useId, useState } from 'react';
import { readLocalLibrary, saveLocalSeries, subscribeLocalLibrary, publicDateKey } from '../localLibrary';
import './CommunityPanel.css';

const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('vi-VN') : 'Chưa có dữ liệu';
const reviewDate = value => {
  if (!value) return '';
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
};

export default function CommunityPanel({ seriesId, episodeId, title, cover, children, trailingAction }) {
  const id = String(seriesId || '');
  const panelId = useId();
  const [openedSeries, setOpenedSeries] = useState('');
  const opened = !!id && openedSeries === id;
  const [scope, setScope] = useState('series');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [library, setLibrary] = useState(readLocalLibrary);
  const requestKey = `${id}:${episodeId || ''}:${retry}`;
  const detail = result?.key === requestKey ? result.data : null;
  const favorite = library.items.some(item => item.id === id && item.favorite);

  useEffect(() => subscribeLocalLibrary(setLibrary), []);
  useEffect(() => { setScope('series'); }, [id]);
  useEffect(() => {
    if (!opened) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        if (!window.electronAPI?.getPublicDetails) throw new Error('Môi trường hiện tại chưa hỗ trợ đọc bình luận công khai');
        const data = await window.electronAPI.getPublicDetails(id, episodeId || undefined);
        if (!data?.success) throw new Error(data?.error || 'Bình luận công khai tạm thời không thể tải');
        if (cancelled) return;
        setResult({ key: requestKey, data });
        setLibrary(saveLocalSeries({ id, title, cover, published_at: data.published_at }));
      } catch (failure) {
        if (!cancelled) setError(failure.message || 'Bình luận công khai tạm thời không thể tải');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [opened, id, episodeId, title, cover, requestKey]);

  if (!id) return null;
  const episodeScope = scope === 'episode' && !!episodeId;
  const reviews = episodeScope ? detail?.episode_reviews : detail?.reviews;
  const items = Array.isArray(reviews?.items) ? reviews.items.filter(item => item && typeof item.content === 'string') : [];
  const publishedDate = publicDateKey(detail?.published_at);

  return <section className="community-panel" aria-label="Bình luận công khai & Yêu thích trên máy">
    <div className="community-heading">
      <div><h3>Bình luận & Yêu thích</h3><p>Bình luận công khai (chỉ đọc). Danh sách yêu thích chỉ lưu trên máy này.</p></div>
      <div className="community-actions">
        {children}
        <button type="button" className="btn btn-outline" onClick={async () => {
          try {
            await navigator.clipboard.writeText(`https://hongguoduanju.com/detail?series_id=${encodeURIComponent(id)}`);
            setShareStatus('Đã sao chép liên kết chia sẻ');
          } catch { setShareStatus('Sao chép thất bại, vui lòng thử lại'); }
        }}>Sao chép liên kết chia sẻ</button>
        <button type="button" className={`btn ${favorite ? 'community-favorited' : 'btn-outline'}`} aria-pressed={favorite} onClick={() => setLibrary(saveLocalSeries({ id, title, cover, favorite: !favorite }))}>{favorite ? 'Đã lưu yêu thích' : 'Lưu vào yêu thích'}</button>
        <button type="button" className="btn btn-outline" aria-expanded={opened} aria-controls={panelId} onClick={() => setOpenedSeries(opened ? '' : id)}>{opened ? 'Thu gọn bình luận' : 'Xem bình luận công khai'}</button>
        {trailingAction && <div className="community-action-trailing">{trailingAction}</div>}
      </div>
    </div>
    {library.error && <p className="community-error" role="alert">{library.error}</p>}
    {shareStatus && <p className="community-note" role="status">{shareStatus}</p>}
    {opened && <div id={panelId} className="community-content" aria-busy={loading}>
      {loading && <p className="community-status" role="status">Đang tải điểm đánh giá và bình luận công khai…</p>}
      {!loading && error && <div className="community-error" role="alert"><p>{error}</p><button type="button" className="btn btn-sm" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
      {!loading && !error && detail && <>
        <dl className="community-metrics">
          <div><dt>Điểm đánh giá</dt><dd>{count(detail.rating)}</dd></div>
          <div><dt>Số lượt đánh giá</dt><dd>{count(detail.rating_count)}</dd></div>
          <div><dt>Lượt thích</dt><dd>{count(detail.like_count)}</dd></div>
          <div><dt>Lượt lưu</dt><dd>{count(detail.favorite_count)}</dd></div>
        </dl>
        {publishedDate && <p className="community-date">Công chiếu lần đầu: {publishedDate}</p>}
        <div className="community-review-heading">
          <div className="community-switch" role="group" aria-label="Phạm vi bình luận">
            <button type="button" aria-pressed={!episodeScope} onClick={() => setScope('series')}>Bình luận toàn bộ phim</button>
            <button type="button" aria-pressed={episodeScope} disabled={!episodeId} onClick={() => setScope('episode')}>Bình luận tập hiện tại</button>
          </div>
          <span>{reviews?.total != null ? `Tổng số công khai ${count(reviews.total)} · ` : ''}Trả về {items.length} bình luận</span>
        </div>
        {items.length ? <ul className="community-reviews">{items.map((review, index) => <li key={`${review.created_at || ''}:${index}`}>
          <div className="community-review-meta"><strong>{typeof review.author === 'string' && review.author.trim() ? review.author : 'Người dùng'}</strong><span>{reviewDate(review.created_at)}</span></div>
          <p>{review.content}</p>
          <div className="community-review-foot">{review.rating != null && <span>Điểm {count(review.rating)}</span>}{review.likes != null && <span>Thích {count(review.likes)}</span>}</div>
        </li>)}</ul> : <p className="community-status">{episodeScope && !reviews ? 'Nguồn phim này chưa cung cấp bình luận theo tập.' : 'Không có bình luận công khai nào.'}</p>}
        <p className="community-note">Hiển thị nội dung công khai trả về từ máy chủ, có thể chỉ gồm một phần bình luận; không đại diện cho toàn bộ danh sách.</p>
      </>}
    </div>}
  </section>;
}
