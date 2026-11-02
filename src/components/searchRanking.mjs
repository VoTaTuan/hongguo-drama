/**
 * Chuẩn hóa tiêu đề và sắp xếp độ liên quan của kết quả tìm kiếm.
 * Ký tự toàn chiều rộng/bán chiều rộng, khoảng trắng và dấu câu không ảnh hưởng đến việc khớp (ví dụ: "言出法随，诸天万界" và "言出法随 诸天万界").
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function rankSearchResults(results, keyword) {
  const query = normalizeSearchText(keyword), seen = new Set();
  return (Array.isArray(results) ? results : []).filter(item => {
    const key = `${item?.source}:${item?.series_id}`;
    if (!item?.series_id || !item?.series_title || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(item => {
    const title = normalizeSearchText(item.series_title);
    const description = normalizeSearchText(item.series_intro || item.description || '');
    const titleMatch = !!query && title.includes(query);
    // Tìm kiếm bổ sung bản phát hành mới của App hỗ trợ khớp đảo ngược khi "người dùng nhập thêm số phần/hậu tố"; các kết quả loại này vẫn được tính là khớp tiêu đề,
    // không thể vì tiêu đề ngắn hơn từ khóa tìm kiếm mà bị xếp vào "kết quả khác".
    const reverseMatch = item.new_release === true && title.length >= 2 && !!query && query.includes(title);
    const contentMatch = !!query && description.includes(query);
    return { ...item, contentMatch,
      relevance: title === query ? 0 : titleMatch ? 1 : reverseMatch ? 1 : contentMatch ? 2 : 3 };
  }).sort((a, b) => a.relevance - b.relevance || (a.fuzzy === b.fuzzy ? 0 : a.fuzzy ? -1 : 1));
}
