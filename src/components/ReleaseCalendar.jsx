import React, { useEffect, useMemo, useState } from 'react';
import { publicDateKey, readLocalLibrary, removeLocalSeries, saveLocalSeries, subscribeLocalLibrary } from '../localLibrary';
import './ReleaseCalendar.css';
import { DramaTitle } from './TranslatedText';

export default function ReleaseCalendar({ onPlay, opening = '', active = true }) {
  const [library, setLibrary] = useState(readLocalLibrary);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [chosenMonth, setChosenMonth] = useState('');
  const [catalogCovers, setCatalogCovers] = useState(() => new Map());
  useEffect(() => subscribeLocalLibrary(setLibrary), []);
  useEffect(() => {
    if (!library.items.some(item => !item.cover) || !window.electronAPI?.getSeriesList) return;
    let cancelled = false;
    window.electronAPI.getSeriesList().then(items => {
      if (!cancelled && Array.isArray(items)) setCatalogCovers(new Map(items.map(item => [String(item.series_id), item.cover || ''])));
    }).catch(() => {}); // Missing local metadata leaves the poster placeholder available.
    return () => { cancelled = true; };
  }, []);
  const rows = useMemo(() => library.items.map(item => ({ ...item, cover: item.cover || catalogCovers.get(item.id) || '', date: publicDateKey(item.published_at) })), [library.items, catalogCovers]);
  const dated = rows.filter(item => item.date).sort((a, b) => b.date.localeCompare(a.date));
  const filtered = rows.filter(item => !favoritesOnly || item.favorite);
  const months = [...new Set(filtered.filter(item => item.date).map(item => item.date.slice(0, 7)))].sort().reverse();
  const month = months.includes(chosenMonth) ? chosenMonth : months[0] || '';
  const monthItems = filtered.filter(item => item.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
  const days = [...new Set(monthItems.map(item => item.date))];
  const undated = filtered.filter(item => !item.date);
  const favoritesCount = rows.filter(item => item.favorite).length;
  const row = item => <li key={item.id} className="release-row">
    <div className="release-poster" aria-hidden="true"><span>Chưa có poster</span>{item.cover && <img key={item.cover} src={item.cover} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}</div>
    <div className="release-title"><DramaTitle title={item.title} as="strong" showOriginal={true}>{item.title}</DramaTitle><span>{item.date ? `Công chiếu ${item.date}` : 'Chưa có ngày công chiếu'}</span></div>
    <div className="release-row-actions">
      <button type="button" className="btn btn-sm btn-outline" aria-label={`${item.favorite ? 'Bỏ yêu thích' : 'Yêu thích'} "${item.title}"`} aria-pressed={item.favorite} onClick={() => setLibrary(saveLocalSeries({ id: item.id, title: item.title, favorite: !item.favorite }))}>{item.favorite ? 'Đã thích' : 'Yêu thích'}</button>
      <button type="button" className="btn btn-sm btn-outline" aria-label={`Xóa "${item.title}"`} title="Chỉ xóa khỏi danh sách yêu thích và lịch trên máy, không xóa tệp video" onClick={() => setLibrary(removeLocalSeries(item.id))}>Xóa</button>
      <button type="button" className="btn btn-sm" disabled={!onPlay || !!opening || !active} aria-label={`Phát "${item.title}"`} onClick={() => onPlay?.({ seriesId: item.id, title: item.title })}>{opening === item.id ? 'Đang mở…' : 'Phát'}</button>
    </div>
  </li>;

  return <section className="release-calendar">
    <header><h2>Lịch phát hành & Cập nhật</h2><p className="page-description">Lịch công chiếu của các phim đã duyệt. Khi mở "Bình luận công khai", ngày công chiếu sẽ được lưu lại đây.</p></header>
    <p className="release-coverage">Đã lưu trên máy {rows.length} phim · Có ngày công chiếu {dated.length} phim{dated.length > 0 ? ` · ${dated[dated.length - 1].date} đến ${dated[0].date}` : ''}. Hiển thị theo múi giờ địa phương.</p>
    {library.error && <div className="release-error" role="alert"><p>{library.error}</p><button type="button" className="btn btn-sm" onClick={() => setLibrary(readLocalLibrary())}>Tải lại</button></div>}
    <div className="release-toolbar">
      <div className="release-filter" role="group" aria-label="Phạm vi lịch"><button type="button" aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>Tất cả đã duyệt</button><button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}>Yêu thích {favoritesCount}</button></div>
      {months.length > 0 && <label className="release-month">Tháng<select value={month} onChange={event => setChosenMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>Tháng {Number(value.slice(5))} năm {value.slice(0, 4)}</option>)}</select></label>}
    </div>
    {!library.error && !filtered.length && <div className="release-empty"><h3>{favoritesOnly ? 'Chưa có phim yêu thích trên máy' : 'Chưa có phim nào để hiển thị'}</h3><p>Đến mục "Khám phá phim" mở phim, bấm xem "Bình luận công khai" để cập nhật ngày công chiếu; hoặc nhấn "Yêu thích" để lưu xem sau.</p></div>}
    {days.map(day => <section className="release-day" key={day} aria-label={`Công chiếu ngày ${day}`}><h3><span>{Number(day.slice(8))}</span><small>Tháng {Number(day.slice(5, 7))}</small></h3><ul>{monthItems.filter(item => item.date === day).map(row)}</ul></section>)}
    {undated.length > 0 && <section className="release-undated"><h3>Chờ cập nhật ngày công chiếu <span>{undated.length} phim</span></h3><p>Các phim này đã được lưu trên máy nhưng nguồn chưa cung cấp ngày công chiếu đầu tiên.</p><ul>{undated.map(row)}</ul></section>}
  </section>;
}
