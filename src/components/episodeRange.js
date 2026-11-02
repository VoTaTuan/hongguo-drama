// Match whole tokens; clamp iteration to the actual episode count.
export function parseEpisodeRange(value, total) {
  const parts = String(value || '').trim().split(/[,，]/);
  const selected = new Set();
  for (const part of parts) {
    const match = part.trim().match(/^(\d+)(?:\s*[-~～]\s*(\d+))?$/);
    if (!match) throw new Error('Định dạng số tập không đúng, vui lòng nhập 1-30 hoặc 1, 5, 10; lựa chọn cũ đã được giữ nguyên.');
    const a = Number(match[1]), b = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1) {
      throw new Error('Số tập phải là số nguyên lớn hơn 0; lựa chọn cũ đã được giữ nguyên.');
    }
    for (let n = Math.max(1, Math.min(a, b)); n <= Math.min(total, Math.max(a, b)); n++) selected.add(n);
  }
  if (!selected.size) throw new Error(`Số tập vượt quá phạm vi, vui lòng chọn từ 1-${total} tập; lựa chọn cũ đã được giữ nguyên.`);
  return selected;
}

export const isSubmitKey = (event) => event.key === 'Enter' && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229;
