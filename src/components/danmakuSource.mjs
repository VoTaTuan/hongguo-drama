// Adapted from dawei233/hongguo-drama, commit c884fab6c6e36ad38173e251738b9b35f958383f (GPL-3.0).
// https://github.com/dawei233/hongguo-drama
/**
 * Tùy chọn "Sử dụng nguồn đạn mạc nào".
 *
 * Lưu trữ dưới một khóa độc lập vì 2 lý do:
 *  1. Cài đặt hiển thị (cỡ chữ/độ mờ/tốc độ/vùng hiển thị/mật độ/từ khóa chặn) nên được dùng chung cho cả hai nguồn —— việc đổi nguồn không nên
 *     xóa các thông số người dùng đã chỉnh, vì vậy phần đó vẫn lưu trong `hongguo:comment-danmaku:v1`;
 *  2. Giá trị nguồn thuộc về "sử dụng luồng dữ liệu nào", không liên quan đến hiển thị, đồng thời cả trang `Cài đặt` và trình phát đều cần
 *     đọc nó. Đặt trong khóa độc lập và đồng bộ bằng sự kiện tùy chỉnh chung, không cần để `Cài đặt` phụ thuộc vào
 *     hook của trình phát.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_DANMAKU_SOURCE, normalizeDanmakuSource } from './danmakuOfficial.mjs';

const STORAGE_KEY = 'hongguo:danmaku-source:v1';
// localStorage trong cùng cửa sổ sẽ không kích hoạt sự kiện storage, nên tự phát một sự kiện.
const CHANGE_EVENT = 'hongguo:danmaku-source-change';

const storage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readDanmakuSource() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return raw === null || raw === undefined ? DEFAULT_DANMAKU_SOURCE : normalizeDanmakuSource(JSON.parse(raw));
  } catch {
    return DEFAULT_DANMAKU_SOURCE;
  }
}

export function writeDanmakuSource(value) {
  const next = normalizeDanmakuSource(value);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Khi bộ nhớ không khả dụng phiên này vẫn có hiệu lực, chỉ không lưu lâu dài; không làm gián đoạn phát video.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  return next;
}

export function useDanmakuSource() {
  const [source, setSource] = useState(readDanmakuSource);
  useEffect(() => {
    const sync = event => setSource(normalizeDanmakuSource(event?.detail));
    const syncStorage = event => {
      if (event.key === STORAGE_KEY) setSource(readDanmakuSource());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);
  return source;
}

export { STORAGE_KEY, CHANGE_EVENT };
