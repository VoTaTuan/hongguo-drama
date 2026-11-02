// Adapted from dawei233/hongguo-drama (GPL-3.0), commit c884fab6c6e36ad38173e251738b9b35f958383f.
// https://github.com/dawei233/hongguo-drama/tree/c884fab6c6e36ad38173e251738b9b35f958383f
'use strict';

/**
 * Thu thập danmaku chính thức của Hồng Quả (danmaku thực sự có trục thời gian video).
 *
 * ## Khác biệt với "Bình luận tập"
 *
 * `episode-comments.js` lấy 15 bình luận trên trang web chính thức **ẩn danh**, không liên quan đến thời gian video,
 * nghiêm ngặt mà nói không phải là danmaku. Module này thu thập giao diện danmaku phân đoạn thời gian mà client chính thức sử dụng:
 *
 *     POST https://api5-normal-sinfonlineb.fqnovel.com/novel/commentapi/comment/list/{vid}/v1/
 *
 * Mỗi danmaku đều có `offset_time` (mili-giây), sau khi đổi sang giây có thể phát theo tiến độ video.
 *
 * ## Phụ thuộc không thể kiểm soát (bắt buộc phải biết)
 *
 * Giao diện này không phải là giao diện công khai, cần giả mạo header chữ ký của client chính thức (X-Gorgon / X-Argus /
 * X-Ladon). Phía thượng nguồn có thể đổi thuật toán, đổi tham số hoặc chặn bất cứ lúc nào, **module này không thể đảm bảo khả dụng lâu dài**.
 * Do đó:
 *   - Bất kỳ thất bại nào cũng trả về `success: false` kèm một lời giải thích dễ hiểu, tuyệt đối không ném ngoại lệ;
 *   - Phía gọi bắt buộc phải chuẩn bị phương án hạ cấp (xem chuyển đổi nguồn trong `CommentDanmaku.jsx`);
 *   - Trên giao diện không được biến việc "không lấy được" thành "tập này không có danmaku".
 *
 * ## Quan hệ với bản tham chiếu
 *
 * Logic phân trang và phân tích được chuyển đổi từ `nas-backend/danmaku.py` (vốn là bản chuyển đổi từ bản Go của guoapp).
 * Trong đó hai nguồn tín hiệu phân trang, dừng sớm khi gặp trang trống liên tiếp v.v. đều là các chi tiết đúc kết từ thực nghiệm,
 * lý do được lưu giữ trong chú thích, đừng "đơn giản hóa" theo trực giác.
 */

const axios = require('axios');
const fs = require('node:fs');
const sign = require('./danmaku-sign');

const BASE_URL = 'https://api5-normal-sinfonlineb.fqnovel.com';
const COMMENT_PATH = vid => `/novel/commentapi/comment/list/${encodeURIComponent(vid)}/v1/`;

// Giả lập client Android chính thức; UA và tham số chữ ký phải đi đồng bộ theo bộ, không được chỉ sửa một cái.
const USER_AGENT =
  'com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; ' +
  'Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)';

const MAX_TEXT_LEN = 200;              // Văn bản quá dài sẽ bị bỏ (danmaku bình thường không dài như vậy)
const MAX_TIME_SECONDS = 604800;       // 7 ngày, vượt quá coi như dữ liệu bẩn
const PAGE_COUNT = 90;                 // Số mục yêu cầu thượng nguồn mỗi lần
const MAX_PAGES = 40;                  // Giới hạn trang tối đa, chống lặp vô hạn
const MAX_ITEMS = 3000;                // Giới hạn mỗi tập, chống tràn bộ nhớ và tải IPC
const REQUEST_TIMEOUT = 20000;
const EFFECTIVE_DURATION_MS = 3600000; // "Thời lượng tập" khai báo mỗi lần yêu cầu
const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // Giới hạn cửa sổ thượng nguồn, vượt quá sẽ bị từ chối
const MAX_EMPTY_PAGES = 2;             // Dừng khi gặp trang trống liên tiếp: thượng nguồn thi thoảng has_more=true nhưng luôn trả về trống
const PAGE_GAP_MS = 120;               // Khoảng cách giữa các trang liền kề, tránh dồn dập
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const CACHE_TTL_OK = 5 * 60 * 1000;
const CACHE_TTL_FAIL = 15 * 1000;
const CACHE_MAX = 64;

const cache = new Map();
const pending = new Map();

// Thượng nguồn phân bổ tập con danmaku theo định danh ẩn danh, qua mỗi lần khởi động lại phải tái sử dụng cùng một định danh máy cục bộ.
let identity = null;
let identityFile = null;
function setDeviceIdentityFile(file) {
  identityFile = file;
  identity = null;
}
const deviceIdentity = () => {
  if (identity) return identity;
  const create = () => ({ deviceId: sign.newDeviceId(), installId: sign.newDeviceId() });
  if (!identityFile) return (identity = create());
  try {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(identityFile, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      saved = create();
      try { fs.writeFileSync(identityFile, JSON.stringify(saved), { flag: 'wx', mode: 0o600 }); }
      catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        saved = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      }
    }
    if (typeof saved?.deviceId !== 'string' || typeof saved?.installId !== 'string' ||
        !/^\d{19}$/.test(saved.deviceId) || !/^\d{19}$/.test(saved.installId)) throw new Error('Invalid local client');
    identity = { deviceId: saved.deviceId, installId: saved.installId };
  } catch {
    const error = new Error('Danmaku local configuration unavailable');
    error.code = 'DANMAKU_IDENTITY_IO';
    throw error;
  }
  return identity;
};

/** Chỉ dùng cho kiểm thử: Ghi đè dấu vân tay thiết bị trong tiến trình. */
function setDeviceIdentity(value) {
  identity = value;
}

// ── Phân tích (Khớp với quy tắc làm sạch của bản tham chiếu) ─────────────────

const asText = value => (value === null || value === undefined ? '' : typeof value === 'boolean' ? (value ? '1' : '0') : String(value));

/** Chuẩn hóa thành `#RRGGBB`, nếu không lấy được dùng màu trắng. */
function normalizeColor(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) return '#FFFFFF';
    return `#${(value & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0')}`;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return '#FFFFFF';
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(text)) return '#' + [...text.slice(1)].map(char => char + char).join('').toUpperCase();
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text)) return '#FFFFFF';
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed >= 0) return `#${(parsed & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0')}`;
  }
  return '#FFFFFF';
}

/**
 * Chuẩn hóa thành scroll / top / bottom.
 *
 * Giao diện bình luận Hồng Quả hiện **không gửi xuống** trường vị trí, nên thực tế luôn là `scroll`.
 * Giữ lại nhận diện dự phòng cho nhiều holder để chừa lối cho thượng nguồn bổ sung trường sau này;
 * đừng xóa chỉ vì "đằng nào cũng luôn là scroll".
 */
function normalizeMode(...holders) {
  for (const holder of holders) {
    if (!holder || typeof holder !== 'object') continue;
    for (const key of ['mode', 'danmaku_type', 'position', 'fix_type', 'danmaku_position']) {
      const value = holder[key];
      if (value === null || value === undefined) continue;
      const token = asText(value).trim().toLowerCase();
      if (['top', '2', 'fix_top', '顶部', 'trên'].includes(token)) return 'top';
      if (['bottom', '3', 'fix_bottom', '底部', 'dưới'].includes(token)) return 'bottom';
    }
  }
  return 'scroll';
}

/** Thay thế ký tự điều khiển và dấu ngắt dòng bằng khoảng trắng, tránh làm hỏng lớp kết xuất. */
function cleanControl(text) {
  let out = '';
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    out += code < 0x20 || code === 0x7f || char === '\u2028' || char === '\u2029' ? ' ' : char;
  }
  return out.trim();
}

/** Đổi mili-giây → giây, và lọc bỏ các giá trị ngoài giới hạn. */
function toSeconds(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const seconds = num / 1000;
  if (seconds < 0 || seconds > MAX_TIME_SECONDS) return null;
  return seconds;
}

/**
 * Phân tích một trang, trả về `{ items, nextMs }`.
 *
 * Tín hiệu phân trang có hai nguồn, thực tế đều từng xuất hiện:
 *   1. `data.extra.next_query_danmaku_list_time` — bản tham chiếu dùng cái này;
 *   2. `data.common_list_info` (`has_more` + `cursor.end_offset_time`).
 * Thực tế trong phản hồi `extra` thường là đối tượng rỗng, thông tin "còn nữa hay không" thực sự nằm ở `common_list_info`.
 * Nếu chỉ nhận cái thứ nhất, khi `extra` rỗng sẽ phán đoán nhầm "vẫn còn" thành "hết rồi", dẫn đến cả tập chỉ lấy được
 * 90 mục ở trang đầu. Đọc cả hai, trong đó `has_more: false` rõ ràng được ưu tiên.
 */
function parsePage(payload, vid) {
  const empty = { items: [], nextMs: null, hasMore: null };
  if (!payload || typeof payload !== 'object') return empty;
  const data = payload.data;
  if (!data || typeof data !== 'object') return empty;
  const rows = Array.isArray(data.data_list) ? data.data_list : [];

  let nextMs = null;
  let hasMore = null;

  const extra = data.extra;
  if (extra && typeof extra === 'object') {
    const raw = asText(extra.next_query_danmaku_list_time).trim();
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) nextMs = parsed;
    }
  }

  const info = data.common_list_info;
  if (info && typeof info === 'object') {
    const flag = info.has_more;
    if (typeof flag === 'boolean') hasMore = flag;
    else if (typeof flag === 'string') hasMore = ['1', 'true', 'yes'].includes(flag.trim().toLowerCase());
    else if (asText(flag)) hasMore = !['0', 'false', 'no'].includes(asText(flag));

    let cursor = info.cursor;
    if (typeof cursor === 'string' && cursor.trim().startsWith('{')) {
      try {
        cursor = JSON.parse(cursor);
      } catch {
        cursor = null;
      }
    }
    if (cursor && typeof cursor === 'object') {
      for (const key of ['end_offset_time', 'next_offset_time', 'offset']) {
        const candidate = Number.parseInt(cursor[key], 10);
        if (!Number.isFinite(candidate)) continue;
        if (nextMs === null || candidate > nextMs) nextMs = candidate;
        break;
      }
    }
  }

  // Khi nói rõ ràng không còn nữa thì không lật tiếp (lúc này dù có cursor cũng không nên tiếp tục)
  if (hasMore === false) nextMs = null;

  const items = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const comment = raw.comment;
    if (!comment || typeof comment !== 'object') continue;
    const common = comment.common && typeof comment.common === 'object' ? comment.common : {};

    // Chỉ nhận danmaku của đúng video này và ở trạng thái bình thường: giá trị khác sẽ lẫn dữ liệu bẩn chờ duyệt/đã thu gọn
    const groupId = asText(common.group_id);
    if (groupId && groupId !== vid) continue;
    if (asText(common.status) !== '1') continue;

    const content = common.content;
    const text = asText(content && typeof content === 'object' ? content.text : null);

    const expand = comment.expand && typeof comment.expand === 'object' ? comment.expand : {};
    let timeRaw = expand.offset_time;
    if (timeRaw === null || timeRaw === undefined) timeRaw = comment.offset_time;

    let colorRaw;
    for (const holder of [content, common, expand, comment]) {
      if (!holder || typeof holder !== 'object') continue;
      for (const key of ['color', 'font_color', 'text_color', 'col']) {
        if (holder[key] !== null && holder[key] !== undefined) {
          colorRaw = holder[key];
          break;
        }
      }
      if (colorRaw !== undefined) break;
    }

    items.push({ text, timeRaw, color: normalizeColor(colorRaw), mode: normalizeMode(raw, comment) });
  }

  if (nextMs !== null && nextMs <= 0) nextMs = null;
  return { items, nextMs, hasMore };
}

// ── Yêu cầu ─────────────────────────────────────────────────────────────────

function buildBody(vid, bookId, start, duration) {
  return {
    comment_source: 601,
    server_channel: 1000,
    group_id: vid,
    group_type: 30,
    comment_type: 20,
    sort: 1,
    count: PAGE_COUNT,
    cursor: '',
    aid: 8662,
    compliance_status: 0,
    business_param: {
      book_id: bookId,
      start_offset_time: start,
      playlet_item_duration: duration,
      need_danmaku_guide_type: [1, 3, 4, 2],
    },
  };
}

/**
 * Yêu cầu một cửa sổ thời gian tới giao diện bình luận.
 *
 * Dấu thời gian và nonce được tạo và dùng chung trong **cùng một hàm**: chữ ký được tính trên chuỗi query,
 * query chứa `_rticket`, còn `X-Khronos` dùng giây. Ba cái không nhất quán sẽ tạo ra chữ ký không hợp lệ.
 */
async function requestWindow({ vid, bookId, start, duration, transport = axios.post, now = Date.now, random = require('node:crypto').randomBytes }) {
  const stampMs = now();
  const stamp = Math.floor(stampMs / 1000);
  const nonce = random(sign.NONCE_BYTES);
  const { deviceId, installId } = deviceIdentity();

  const rawQuery = sign.buildQuery({ stampMs, deviceId, installId });
  const url = `${BASE_URL}${COMMENT_PATH(vid)}?${rawQuery}`;
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'X-XS-From-Web': '0',
    'Sdk-Version': '2',
    'Content-Type': 'application/json; charset=utf-8',
    'Comment-Source': '601',
    'Server-Channel': '1000',
    ...sign.signCommentHeaders({ rawQuery, stamp, nonce }),
  };

  const response = await transport(url, JSON.stringify(buildBody(vid, bookId, start, duration)), {
    headers,
    timeout: REQUEST_TIMEOUT,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    maxRedirects: 0,
    responseType: 'text',
    maxContentLength: MAX_RESPONSE_BYTES,
  });

  const body = typeof response?.data === 'string' ? response.data : JSON.stringify(response?.data ?? null);
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('Phản hồi danmaku quá lớn');
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('Giao diện danmaku trả về nội dung không phải JSON');
  }
  const code = payload?.code;
  if ((code !== 0 && code !== '0') || !Array.isArray(payload?.data?.data_list)) {
    throw new Error('Phản hồi giao diện danmaku không hợp lệ');
  }
  return payload;
}

// ── Giao diện đối ngoại ──────────────────────────────────────────────────────────

/**
 * Tổng hợp thành giá trị trả về cuối cùng.
 *
 * **Tất cả các đầu ra đều đi qua đây**: Nguồn không khả dụng, bị giới hạn tần suất, thành công một phần đều phải qua cùng một nơi để tính toán
 * `notice`, nếu không một nhánh nào đó return sớm sẽ hiển thị việc "không lấy được" thành "tập này không có danmaku".
 *
 * Khi `error` không rỗng thì `notice` luôn dùng thông tin giải thích lỗi, tuyệt đối không vì `items` rỗng mà đổi giọng nói
 * "Tập này tạm thời chưa có danmaku" — hai việc này có ý nghĩa hoàn toàn khác nhau đối với người dùng (một bên là lỗi nguồn, một bên là
 * tập này thực sự không có ai gửi danmaku).
 */
function finalize({ seriesId, vid, items, truncated, error }) {
  let notice;
  if (error) notice = error;
  else if (truncated) notice = `Danmaku khá nhiều, lần này chỉ tải trước ${items.length} mục`;
  else if (!items.length) notice = 'Tập này tạm thời chưa có danmaku';
  else notice = '';
  return {
    success: !error,
    source: 'official',
    series_id: seriesId,
    episode_id: vid,
    items,
    total: items.length,
    truncated: Boolean(truncated),
    partial: Boolean(error) && items.length > 0,
    error: error || '',
    notice,
  };
}

/**
 * Cắt gọt theo limit rồi tính lại thông báo một lần nữa.
 *
 * Cắt gọt chỉ thay đổi "bao nhiêu mục", không thể thay đổi "tại sao là những mục này": thông tin lỗi bắt buộc phải giữ nguyên,
 * nếu không kết quả thất bại trong bộ nhớ đệm khi trúng cache sẽ bị đóng gói lại thành kết quả bình thường.
 */
function present(result, items, limit) {
  if (items.length <= limit) return { ...result, items, total: items.length };
  const sliced = items.slice(0, limit);
  return {
    ...result,
    items: sliced,
    total: sliced.length,
    truncated: true,
    notice: result.error ? result.notice : `Danmaku khá nhiều, lần này chỉ tải trước ${sliced.length} mục`,
  };
}

/**
 * Thu thập danmaku chính thức của một tập.
 *
 * @param {object} options
 * @param {string} options.seriesId ID phim (business_param.book_id)
 * @param {string} options.vid      ID video tập này (group_id). Hai cái này khác nhau, điền sai sẽ bị thượng nguồn từ chối.
 * @returns {Promise<{success:boolean, source:string, items:Array<{time:number,text:string,color:string,mode:string}>, notice:string, error:string}>}
 *          Sắp xếp theo thời gian tăng dần; mọi ngoại lệ đều chuyển thành `success:false` + giải thích, không ném ra ngoài.
 */
async function fetchDanmaku(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return finalize({ seriesId: '', vid: '', items: [], error: 'Yêu cầu danmaku không hợp lệ' });
  }
  const seriesId = typeof options.seriesId === 'string' ? options.seriesId.trim() : '';
  const vid = typeof options.vid === 'string' ? options.vid.trim() : '';
  const limit = options.limit === undefined ? MAX_ITEMS : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS ||
      (options.fresh !== undefined && typeof options.fresh !== 'boolean')) {
    return finalize({ seriesId, vid, items: [], error: 'Tham số yêu cầu danmaku không hợp lệ' });
  }
  // Cho phép kiểm thử tiêm vào: lớp truyền tải giả lập không gọi mạng, đồng hồ cố định và nonce cố định
  const transport = options.transport;
  const now = options.now || Date.now;
  const random = options.random;

  if (!/^\d{6,30}$/.test(seriesId) || !/^\d{6,30}$/.test(vid)) {
    return finalize({ seriesId, vid, items: [], error: 'Chỉ nguồn Hồng Quả mới hỗ trợ danmaku' });
  }

  const cacheKey = `${seriesId}:${vid}`;
  const hit = cache.get(cacheKey);
  // `fresh` dùng cho thao tác "thử lại" trên giao diện: kết quả thất bại có TTL 15 giây, nếu không bỏ qua thì người dùng bấm thử lại
  // sẽ chỉ nhận lại kết quả thất bại cùng một tệp cache, trông như nút bấm không phản hồi.
  if (hit && hit.expires > Date.now() && options.fresh !== true) return present(hit.result, hit.items, limit);
  if (pending.has(cacheKey)) {
    const shared = await pending.get(cacheKey);
    return present(shared.result, shared.items, limit);
  }

  const task = (async () => {
    const collected = [];
    const seen = new Set();
    let start = 0;
    let duration = EFFECTIVE_DURATION_MS;
    let emptyPages = 0;
    let truncated = false;
    let failure = '';

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        if (page > 0) await new Promise(resolve => setTimeout(resolve, PAGE_GAP_MS));

        let payload;
        try {
          payload = await requestWindow({ vid, bookId: seriesId, start, duration, transport, now, random });
        } catch (error) {
          // Giải thích lỗi cần giúp người dùng tự phán đoán: chuyện gì đã xảy ra, đã thử cái gì, còn có thể làm gì.
          // Thất bại trang đầu cho thấy nguồn không khả dụng; thất bại các trang sau thì giữ lại phần đã lấy được, không coi cả tập là hỏng.
          // Không truyền trực tiếp chuỗi ngoại lệ: lỗi Axios có thể mang theo URL chữ ký hoặc dấu vân tay thiết bị.
          failure = error?.code === 'DANMAKU_IDENTITY_IO'
            ? 'Đọc hoặc lưu cấu hình máy danmaku thất bại, vui lòng kiểm tra quyền thư mục dữ liệu rồi thử lại'
            : collected.length
            ? 'Tải danmaku tiếp theo bị gián đoạn, đã giữ lại phần đã lấy được'
            : error?.code === 'ECONNABORTED' || error?.name === 'TimeoutError' || error?.code === 'ERR_CANCELED'
              ? 'Giao diện danmaku phản hồi quá thời gian (đã thử yêu cầu chữ ký chính thức), có thể thử lại sau'
              : error?.response
                ? `Giao diện danmaku không khả dụng (HTTP ${Number.isInteger(error.response.status) ? error.response.status : 'lỗi'}), đã thử yêu cầu chữ ký chính thức; có thể chuyển sang dùng "Bình luận tập"`
                : 'Giao diện danmaku tạm thời không khả dụng (đã thử yêu cầu chữ ký chính thức), vui lòng thử lại sau';
          break;
        }

        const { items: pageItems, nextMs, hasMore } = parsePage(payload, vid);
        if (pageItems.length) emptyPages = 0;
        else emptyPages++;

        for (const item of pageItems) {
          const seconds = toSeconds(item.timeRaw);
          if (seconds === null) continue;
          const text = cleanControl(item.text);
          if (!text || text.length > MAX_TEXT_LEN) continue;
          const key = `${seconds.toFixed(3)}|${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push({ time: seconds, text, color: item.color, mode: item.mode });
          if (collected.length >= MAX_ITEMS) break;
        }

        if (collected.length >= MAX_ITEMS) {
          truncated = true;
          break;
        }
        if (nextMs === null) {
          if (hasMore === true) {
            truncated = true;
            if (!collected.length) failure = 'Giao diện danmaku không trả về phân trang hợp lệ, vui lòng thử lại sau';
          }
          break;
        }
        if (nextMs <= start || nextMs > MAX_TIME_SECONDS * 1000 || emptyPages >= MAX_EMPTY_PAGES || page === MAX_PAGES - 1) {
          truncated = true;
          if (!collected.length) failure = 'Giao diện danmaku không trả về phân trang hợp lệ, vui lòng thử lại sau';
          break;
        }
        start = nextMs;
        // Thượng nguồn từ chối cửa sổ vượt quá 24 giờ, nên duration kéo dài về sau phải có chặn trần
        duration = Math.min(Math.max(duration, start + EFFECTIVE_DURATION_MS), MAX_DURATION_MS);
        // Thượng nguồn nói "còn nữa" nhưng liên tục trả về trang trống — rào chắn phân trang ở trên sẽ dừng lại và đánh dấu bị cắt gọt.
      }
    } catch (error) {
      failure = 'Xử lý danmaku thất bại, vui lòng thử lại sau';
    }

    collected.sort((a, b) => a.time - b.time);

    // Lưu cache toàn bộ kết quả và toàn bộ danh sách; limit chỉ cắt gọt khi hiển thị, tránh để cache bị nhiễm bẩn bởi kết quả "nửa vời".
    const result = finalize({ seriesId, vid, items: collected, truncated, error: failure });
    cache.set(cacheKey, {
      expires: Date.now() + (failure ? CACHE_TTL_FAIL : CACHE_TTL_OK),
      items: collected,
      result,
    });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return { result, items: collected };
  })();

  pending.set(cacheKey, task);
  try {
    const { result, items } = await task;
    return present(result, items, limit);
  } finally {
    pending.delete(cacheKey);
  }
}

/** Chỉ dùng cho kiểm thử: Xóa bộ nhớ đệm và trạng thái đang xử lý. */
function resetDanmakuCache() {
  cache.clear();
  pending.clear();
}

module.exports = {
  fetchDanmaku,
  // Các thành phần nội bộ cần cho kiểm thử và tái sử dụng
  parsePage,
  normalizeColor,
  normalizeMode,
  cleanControl,
  toSeconds,
  buildBody,
  requestWindow,
  resetDanmakuCache,
  setDeviceIdentity,
  setDeviceIdentityFile,
  BASE_URL,
  COMMENT_PATH,
  USER_AGENT,
  MAX_ITEMS,
  MAX_TEXT_LEN,
  MAX_TIME_SECONDS,
  PAGE_COUNT,
};
