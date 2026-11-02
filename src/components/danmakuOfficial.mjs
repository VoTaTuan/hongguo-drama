// Adapted from dawei233/hongguo-drama, commit c884fab6c6e36ad38173e251738b9b35f958383f (GPL-3.0).
// https://github.com/dawei233/hongguo-drama
// Phân phối theo dòng thời gian tách biệt với hàng đợi bình luận; hai nguồn dùng chung cài đặt giao diện, bố cục đường chạy và sắp xếp lại cửa sổ.

import { commentIsBlocked, danmakuLayout, retireDanmaku, takeDanmakuReplay } from './danmakuModel.mjs';

export const DANMAKU_SOURCES = Object.freeze(['official', 'comments']);

/** Mặc định dùng danmaku thật; bất kỳ giá trị nào khác xuất hiện trong bộ nhớ đều quay về mặc định. */
export const DEFAULT_DANMAKU_SOURCE = 'official';

export function normalizeDanmakuSource(value) {
  return DANMAKU_SOURCES.includes(value) ? value : DEFAULT_DANMAKU_SOURCE;
}

export const SOURCE_LABELS = Object.freeze({
  official: 'Danmaku theo dòng thời gian',
  comments: 'Bình luận tập này',
});

// Thời gian một hàng danmaku chiếm toàn màn hình phụ thuộc vào chiều rộng và tốc độ; ở đây chỉ ràng buộc "khoảng cách ngang tối thiểu cần giữ giữa 2 hàng liên tiếp trong cùng một làn"
// để tránh danmaku phát sau va chạm vào danmaku phía trước.
const LANE_HEAD_GAP = 24;

// Mỗi khung hình tiêu thụ tối đa bao nhiêu danmaku chờ phát, tránh tràn vào cùng lúc (ví dụ sau khi giật lag lâu rồi phục hồi) làm mờ màn hình.
const MAX_EMIT_PER_FRAME = 4;

// Dòng thời gian kiểm soát thời điểm xuất hiện; mật độ kiểm soát khoảng cách tối thiểu khi bùng phát, không giới hạn số dòng cố định.
const EMIT_INTERVAL = Object.freeze({ sparse: 0.4, normal: 0.15, dense: 0.05 });

/** Danmaku trễ nghiêm trọng sẽ bị hủy trực tiếp: chúng đã qua trên dòng thời gian, phát bù chỉ làm rối mắt. */
const STALE_SECONDS = 5;

/**
 * Thời lượng hiển thị của mỗi danmaku trong chế độ giảm hiệu ứng chuyển động.
 *
 * Chế độ này mỗi lần chỉ hiển thị lần lượt 1 mục, vì vậy lưu lượng tự nhiên thấp hơn chế độ cuộn một bậc. Ngưỡng trễ phải được nới lỏng tương ứng
 * theo cùng bậc —— nếu không các danmaku đang xếp hàng sẽ bị coi là "trễ" và bị hủy hết trước khi đến lượt,
 * dẫn đến việc bật giảm chuyển động thì gần như không thấy danmaku.
 */
const REDUCED_MOTION_READ_SECONDS = 6;

/**
 * Điều kiện xác định "người dùng đã tua tiến độ".
 *
 * Khi phát bình thường, mức tăng của `currentTime` xấp xỉ bằng mức tăng thời gian media của khung hình này; khi xuất hiện mức tăng âm
 * hoặc bước nhảy dương vượt xa mức tăng bình thường, đó chắc chắn là tua (seek). Phán đoán này quyết định có cần tạo lại con trỏ phân phối tiếp theo hay không,
 * nếu phán đoán sai sẽ dẫn đến việc sau khi tua nhanh, toàn bộ danmaku đoạn giữa sẽ đổ dồn lên màn hình cùng lúc.
 */
function isSeek(lastTime, currentTime, elapsed) {
  if (lastTime === undefined) return true;
  const jump = currentTime - lastTime;
  if (jump < 0) return true;
  return jump > elapsed * 3 + 1;
}

/** Tìm chỉ số đầu tiên có time >= currentTime (danh sách sắp xếp tăng dần theo time). */
export function lowerBoundTime(list, currentTime) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid].time < currentTime) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function createOfficialFeed(seriesId, vid) {
  return {
    source: 'official',
    seriesId: String(seriesId ?? ''),
    vid: String(vid ?? ''),
    danmaku: [],
    loaded: false,
    loading: false,
    error: '',
    notice: '',
    truncated: false,
    partial: false,
    // Trạng thái hiệu ứng có cùng tên với thanh cuộn bình luận (items/nextId/cooldown), thuận tiện cho lớp render tái sử dụng cùng logic
    // vẽ và xử lý thay đổi cài đặt.
    animation: { items: [], nextId: 0, cursor: 0, cooldown: 0, lastTime: undefined },
  };
}

/**
 * Ghi một trang kết quả danmaku chính thức.
 *
 * Giao diện upstream mỗi lần trả về một tập con thu được (thực nghiệm cùng một tập trong vài chục giây sẽ trả về 71~104 kết quả khác nhau),
 * vì vậy ở đây chỉ thực hiện gộp và sắp xếp, **không coi `hasMore` là "đã tải toàn bộ"**;
 * văn bản trạng thái được quyết định thống nhất bởi `resolveDanmakuStatus`.
 */
export function appendOfficialPage(feed, data) {
  if (!data || typeof data !== 'object' || typeof data.success !== 'boolean' || !Array.isArray(data.items)) throw new Error('Invalid official danmaku page');
  if (String(data.series_id) !== feed.seriesId || String(data.episode_id) !== feed.vid) {
    throw new Error('Invalid official danmaku page');
  }
  const incoming = Array.isArray(data.items) ? data.items : [];
  const seen = new Set(feed.danmaku.map(item => `${item.time.toFixed(3)}|${item.text}`));
  for (const item of incoming) {
    if (!item || typeof item.text !== 'string' || !Number.isFinite(item.time)) continue;
    const key = `${item.time.toFixed(3)}|${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    feed.danmaku.push(item);
  }
  feed.danmaku.sort((a, b) => a.time - b.time);
  feed.loaded = true;
  feed.truncated = data.truncated === true;
  feed.partial = data.partial === true;
  feed.notice = (typeof data.notice === 'string' ? data.notice : '') || (feed.partial ? 'Chỉ lấy được một phần danmaku, có thể thử tải lại' : feed.truncated ? 'Đã đạt giới hạn đọc lần này, chỉ hiển thị một phần danmaku' : '');
  feed.animation.lastTime = undefined;
  feed.error = data.success === false ? (typeof data.error === 'string' && data.error ? data.error : 'Tải danmaku thất bại') : '';
  return feed;
}

/**
 * Phân phối danmaku theo thời gian video, và đẩy tiếp các danmaku đang hiển thị trên màn hình.
 *
 * @param {object} state    `feed.animation`
 * @param {Array}  danmaku  Danh sách danmaku sắp xếp tăng dần theo time
 * @param {number} currentTime Vị trí phát hiện tại của video (giây)
 * @param {number} elapsed  Thời gian media khung hình này đã chạy (giây, đã nhân tốc độ)
 * @param {object} options  `{ width, height, settings, reducedMotion, bottomInset }`
 * @returns {boolean} Có cần vẽ lại hay không
 */
export function advanceTimedDanmaku(state, danmaku, currentTime, elapsed, options) {
  const { width, height, settings, reducedMotion } = options;
  if (!(width >= 40) || !(height >= 60)) return false;
  const list = Array.isArray(danmaku) ? danmaku : [];
  const delta = Math.min(Math.max(elapsed, 0), 0.25);
  let changed = false;

  const emitting = options.emitting !== false;
  if (emitting && isSeek(state.lastTime, currentTime, elapsed)) {
    // Reposition future comments without erasing comments already crossing the screen.
    state.cursor = lowerBoundTime(list, currentTime);
    state.cooldown = 0;
    // A resumed or re-enabled sparse feed has no retired comments from this session.
    if (!reducedMotion && !state.items.length && !state.replayQueue?.length) {
      state.replayQueue = [];
      for (let index = state.cursor - 1; index >= 0 && state.replayQueue.length < 6; index--) {
        const entry = list[index];
        if (!commentIsBlocked(entry.text, settings) && !state.replayQueue.some(item => item.content === entry.text)) {
          state.replayQueue.push({ entry, content: entry.text });
        }
      }
    }
  }
  if (emitting) state.lastTime = currentTime;

  const before = state.items.length;
  for (const item of state.items) {
    item.age += delta;
    if (!reducedMotion) item.x -= 85 * settings.speed * delta;
  }
  retireDanmaku(state, reducedMotion);
  if (state.items.length !== before) changed = true;
  state.cooldown = Math.max(0, state.cooldown - delta);

  const { top, lineHeight, lanes } = danmakuLayout(options);

  const laneFree = index => {
    const occupants = state.items.filter(item => item.lane === index);
    if (!occupants.length) return true;
    // Cho phép phát nhiều mục trên cùng một làn: chỉ cần mục cuối cùng đã đi đủ xa, mục mới sẽ không bị đè lên mục trước.
    // Thanh cuộn bình luận upstream dùng quy tắc "làn này có người thì chiếm giữ", đối với danmaku thật (hàng trăm mục mỗi tập) sẽ làm rơi rụng rất nhiều.
    const newest = occupants.reduce((a, b) => (a.x > b.x ? a : b));
    return newest.x + newest.width + LANE_HEAD_GAP <= width;
  };

  let emitted = 0;
  const staleAfter = reducedMotion ? REDUCED_MOTION_READ_SECONDS : STALE_SECONDS;
  while (emitting && emitted < MAX_EMIT_PER_FRAME) {
    let entry = list[state.cursor];
    const timed = entry && entry.time <= currentTime;
    const stale = timed && currentTime - entry.time > staleAfter;
    const blocked = timed && commentIsBlocked(entry.text, settings);
    const visible = timed && state.items.some(item => item.entry === entry);
    if (blocked || stale || visible) {
      state.cursor++;
      continue;
    }
    if (state.cooldown > 0) break;

    const candidates = Array.from({ length: lanes }, (_, index) => index);
    // Tái sử dụng vị trí trống an toàn của các hàng hiện có trước, không đủ chỗ mới mở thêm hàng, tránh danmaku ngắn bị rải thành khoảng trống ngang trên toàn màn hình.
    const lane = candidates.find(laneFree);
    if (lane === undefined) break; // Giữ lại con trỏ cursor, thử lại ở khung hình tiếp theo
    if (!timed) {
      if (!(delta > 0) || !list.length) break;
      // Nearby fresh supply takes priority; only quiet stretches need retired comments.
      const pending = lowerBoundTime(list, currentTime + 2) - state.cursor;
      entry = takeDanmakuReplay(state, options, Math.max(0, pending), currentTime)?.entry;
      if (!entry) break;
    }

    const chars = Array.from(entry.text);
    const text = chars.length > 80 ? `${chars.slice(0, 79).join('')}…` : entry.text;
    const textWidth = (Array.from(text).length + 1) * settings.fontSize;
    state.items.push({
      id: state.nextId++,
      text,
      content: entry.text,
      entry,
      color: entry.color,
      mode: entry.mode,
      lane,
      x: reducedMotion ? 12 : width,
      y: top + lane * lineHeight,
      width: textWidth,
      age: 0,
    });
    state.cooldown = reducedMotion ? REDUCED_MOTION_READ_SECONDS : (EMIT_INTERVAL[settings.density] ?? EMIT_INTERVAL.normal);
    if (timed) state.cursor++;
    emitted++;
    changed = true;
  }

  return changed;
}

/**
 * Điểm xuất trạng thái kết thúc duy nhất.
 *
 * Danmaku chính thức có nhiều luồng thất bại (quá thời gian, lỗi HTTP, thành công một phần, kết quả thất bại từ bộ nhớ đệm).
 * Chỉ cần một luồng tự ghép văn bản trạng thái thì sẽ xảy ra sự cố kiểu "nguồn hỏng nhưng lại hiển thị tập này không có danmaku".
 * Vì vậy tất cả các luồng đều phải gọi hàm này, không tự ghép chuỗi ở nơi khác.
 */
export function resolveDanmakuStatus({ source, supported, enabled, active, visible, error, loading, notice, loaded, count }) {
  if (!supported) return source === 'official' ? 'Chỉ nguồn Hồng Quả mới hỗ trợ danmaku' : 'Chỉ tập hiện tại nguồn Hồng Quả mới hỗ trợ bình luận danmaku';
  if (!enabled) return source === 'official' ? 'Bật sau đó hiển thị danmaku theo dòng thời gian video' : 'Bật sau đó hiển thị bình luận công khai của tập này';
  if (!active) return source === 'official' ? 'Phát tập này sau đó hiển thị danmaku' : 'Phát tập này sau đó hiển thị bình luận danmaku';
  if (!visible) return '';
  // Thất bại ưu tiên hơn tất cả: thà báo "không lấy được" chứ không thể nói thành "không có danmaku"
  if (error) return error;
  if (loading) return 'Đang tải danmaku…';
  if (notice && !count) return notice;
  if (!loaded) return 'Đang tải danmaku…';
  if (!count) return notice || 'Tập này tạm thời chưa có danmaku';
  return `Đã tải ${count} danmaku${notice ? ` (${notice})` : ''}`;
}
