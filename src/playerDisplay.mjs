/** Hàm định dạng thuần túy thông tin toàn màn hình của trình phát, thuận tiện cho việc kiểm thử đơn vị. */

export function formatClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatQualityMeta(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return 'Hình ảnh hiện tại: Đang chờ thông tin video';
  return `Hình ảnh hiện tại: ${Math.min(w, h)}P (${w} × ${h})`;
}
