// Tìm kiếm bổ sung danh mục "Phim mới gần đây" trên App: khi chỉ mục tìm kiếm web không đồng bộ với App, dùng API phân loại của App
// (thứ tự thời gian online giảm dần) để bổ sung phim ngắn mới ra mắt trong ngày mà tìm kiếm web chưa thấy.
const { signedMetadataRequest, parseSearchInteger, requestJson } = require('./app-source');
const { cleanTitle } = require('./hongguo-app-search');
const { catalogCover } = require('./hongguo-app-catalog');

const CATEGORY_API = '/reading/distribution/category/landpage/v/';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000;
const PAGE_LIMIT = 50;
// Mặc định lật 2 trang (người đóng + AI mỗi loại tối đa 100 mục), giảm xác suất phim mới trong ngày bận rộn rơi ra ngoài màn hình đầu.
const DEFAULT_PAGES = 2;
const MAX_RESULTS = 20;
// Phim người đóng và phim AI dùng cùng API phân loại, giá trị bộ lọc khác nhau; cả hai đều có thể xuất hiện trong kết quả tìm kiếm.
const GENRES = [
  { reqScene: 'default', genre: 'short_play' },
  { reqScene: 'ai_series', genre: 'ai_series' },
];

let cache = null; // { expires, pages, items }
let inflight = null; // { pages, task }

function appError(message, code) {
  return Object.assign(new Error(message), { code });
}

function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function newReleaseFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.series_id ?? '');
  if (!/^\d{1,30}$/.test(id)) return null;
  const title = cleanTitle(row.title || row.series_title || row.series_name);
  if (!title) return null;
  const labels = [];
  const addLabel = (value) => {
    const text = cleanTitle(value);
    if (text && !labels.includes(text)) labels.push(text);
  };
  // Nhãn "Phim mới" trong tag_info, ngày lên sóng trong sub_title_list; giữ lại cả hai để hiển thị và sắp xếp.
  addLabel(row.tag_info?.text);
  for (const item of Array.isArray(row.sub_title_list) ? row.sub_title_list : []) addLabel(item?.content);
  const releasedToday = labels.includes('今日上新') || labels.includes('Mới lên hôm nay');
  return {
    series_id: id,
    series_title: title,
    cover: catalogCover(row.cover),
    episode_count: parseSearchInteger(row.episode_cnt) || 0,
    description: cleanTitle(row.video_desc || row.series_intro),
    tags: labels.filter(label => label !== '新剧' && label !== '今日上新' && label !== 'Phim mới' && label !== 'Mới lên hôm nay').slice(0, 4),
    new_release: true,
    ...(releasedToday ? { released_today: true } : {}),
    source: 'hongguo',
    url: `https://hongguoduanju.com/detail?series_id=${id}`,
  };
}

function collectRows(rows) {
  const seen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = newReleaseFromRow(row);
    if (!item) continue;
    const existing = seen.get(item.series_id);
    if (!existing) { seen.set(item.series_id, item); continue; }
    // Cùng một bộ phim có thể xuất hiện đồng thời trong danh sách người đóng / AI; giữ lại cờ "Mới lên hôm nay" và các trường đầy đủ hơn.
    existing.released_today = existing.released_today || item.released_today;
    existing.tags = [...new Set([...existing.tags, ...item.tags])].slice(0, 4);
    if (!existing.cover) existing.cover = item.cover;
    if (!existing.description) existing.description = item.description;
    if (!existing.episode_count) existing.episode_count = item.episode_count;
  }
  return [...seen.values()];
}

async function defaultRequest(signed, deadline) {
  const remaining = Math.max(1, deadline - Date.now());
  try {
    return await requestJson(signed.url, { method: 'POST', headers: signed.headers, data: signed.body },
      deadline, AbortSignal.timeout(remaining));
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw appError('Yêu cầu phim mới trên App quá thời gian', 'APP_TIMEOUT');
    }
    if (/未返回有效数据|空响应/i.test(error.message || '')) throw appError('Phim mới trên App trả về phản hồi rỗng', 'APP_EMPTY');
    throw appError(error.message || 'Yêu cầu phim mới trên App thất bại', error.code || 'APP_NETWORK');
  }
}

function pageBody({ reqScene, genre }, offset, sessionId) {
  return {
    filter_ids: '',
    req_scene: reqScene,
    offset,
    need_selector_panel: false,
    limit: PAGE_LIMIT,
    select_items: {
      genre: [genre],
      sort: ['online_time'],
      category_dim_theme: [],
      category_dim_role: [],
      category_dim_epoch: [],
      gender: [],
      online_time: ['days_7'],
      creation_status: [],
    },
    session_id: sessionId,
    req_type: offset ? 'only_content' : 'default',
    client_req_type: 3,
  };
}

async function fetchGenre(config, { pages, deadline, request }) {
  const rows = [];
  let offset = 0, sessionId = '';
  for (let page = 1; page <= pages; page++) {
    if (Date.now() >= deadline) break;
    const signed = signedMetadataRequest(CATEGORY_API, {}, pageBody(config, offset, sessionId));
    const payload = await request(signed, deadline);
    if (!payload || typeof payload !== 'object') throw appError('Phim mới trên App trả về phản hồi rỗng', 'APP_EMPTY');
    if (Number(payload.code ?? 0) !== 0) throw appError('Dịch vụ phim mới trên App tạm thời không khả dụng', 'APP_BUSINESS');
    const data = payload.data;
    if (!data || !Array.isArray(data.video_data)) throw appError('Cấu trúc dữ liệu phim mới trên App bất thường', 'APP_SCHEMA');
    rows.push(...data.video_data);
    if (data.has_more !== true) break;
    const next = parseSearchInteger(data.next_offset);
    // Con trỏ phải tiến lên, nếu không khi máy chủ bất thường sẽ bị lặp vô hạn trên cùng một trang.
    if (next === null || next <= offset) break;
    offset = next;
    sessionId = String(data.session_id || '');
  }
  // Chưa đọc được trang nào mà đã chạm mốc thời gian giới hạn thì không thể lưu vào bộ nhớ đệm như "thực sự không có phim mới".
  if (!rows.length && Date.now() >= deadline) throw appError('Yêu cầu phim mới trên App quá thời gian', 'APP_TIMEOUT');
  return rows;
}

function cachedItems(pages) {
  return cache && cache.expires > Date.now() && cache.pages >= pages ? cache.items : null;
}

/**
 * Đọc danh sách phim mới 7 ngày gần đây trên App (người đóng + AI), theo thứ tự thời gian online giảm dần, lấy tối đa pages trang.
 * Kết quả được lưu tạm thời trong bộ nhớ đệm tiến trình; nếu một trong hai loại thất bại vẫn có thể dùng kết quả của loại kia.
 */
async function listNewReleases(options = {}) {
  const { pages = DEFAULT_PAGES, deadline = 0, request = defaultRequest, useCache = true } = options || {};
  const count = Math.max(1, Math.min(8, Number(pages) || DEFAULT_PAGES));
  const cached = useCache ? cachedItems(count) : null;
  if (cached) return { items: cached, cached: true, partial: false };
  if (inflight && inflight.pages >= count) return inflight.task;
  const budget = Number(deadline) > 0 ? deadline : Date.now() + REQUEST_TIMEOUT_MS;
  if (budget <= Date.now()) throw appError('Yêu cầu phim mới trên App quá thời gian', 'APP_TIMEOUT');
  const task = (async () => {
    const settled = await Promise.allSettled(GENRES.map(config => fetchGenre(config, { pages: count, deadline: budget, request })));
    const rows = [], failures = [];
    for (const entry of settled) {
      if (entry.status === 'fulfilled') rows.push(...entry.value);
      else failures.push(entry.reason);
    }
    const items = collectRows(rows);
    if (!items.length && failures.length) throw failures[0];
    const result = { items, cached: false, partial: failures.length > 0 };
    // Chỉ lưu vào bộ nhớ đệm kết quả hoàn chỉnh; thất bại một phần hoặc danh sách rỗng sẽ yêu cầu lại ở lần tìm kiếm sau, tránh khóa phản hồi rỗng một phút.
    if (result.partial === false && items.length) cache = { expires: Date.now() + CACHE_TTL_MS, pages: count, items };
    return result;
  })();
  inflight = { pages: count, task };
  task.finally(() => { if (inflight?.task === task) inflight = null; }).catch(() => {});
  return task;
}

/**
 * Khớp theo tiêu đề trong danh sách phim mới của App: ưu tiên tiêu đề đầy đủ, tiếp theo chứa từ khóa tìm kiếm,
 * cuối cùng hỗ trợ khi người dùng nhập thừa số phần/hậu tố thì dùng tên phim khớp ngược lại.
 */
function matchNewReleases(items, keyword) {
  const query = normalizeTitle(keyword);
  if (query.length < 2 || !Array.isArray(items)) return [];
  const matches = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = normalizeTitle(item.series_title);
    if (!title) continue;
    let score = -1;
    if (title === query) score = 0;
    else if (title.includes(query)) score = 1;
    else if (title.length >= 2 && query.includes(title)) score = 2;
    if (score >= 0) matches.push({ item, score });
  }
  return matches.sort((a, b) => a.score - b.score
    || Number(!!b.item.released_today) - Number(!!a.item.released_today))
    .map(entry => entry.item).slice(0, MAX_RESULTS);
}

async function searchNewReleasesDetailed(keyword, options = {}) {
  const list = await listNewReleases(options);
  return {
    results: matchNewReleases(list.items, keyword),
    partial: list.partial === true,
    cached: list.cached === true,
  };
}

async function searchNewReleases(keyword, options = {}) {
  return (await searchNewReleasesDetailed(keyword, options)).results;
}

function clearNewReleaseCache() {
  cache = null; inflight = null;
}

module.exports = {
  listNewReleases,
  searchNewReleases,
  searchNewReleasesDetailed,
  matchNewReleases,
  newReleaseFromRow,
  collectRows,
  normalizeTitle,
  clearNewReleaseCache,
  CACHE_TTL_MS,
  DEFAULT_PAGES,
  MAX_RESULTS,
};
