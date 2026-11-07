/**
 * main.js - Trình tải Phim Ngắn Hồng Quả 5.4 (Bản độc lập) Tiến trình chính
 *
 * Chức năng:
 *   1. Phân tích phim ngắn Hồng Quả (Liên kết chia sẻ / series_id -> Danh sách toàn bộ tập)
 *   2. Gửi hàng loạt tác vụ tải vào hàng đợi
 *   3. Tải đồng thời: Tải luồng liên kết phát trực tiếp -> spade_a phái sinh AES Key -> giải mã CENC-AES-CTR -> xuất mp4
 *   4. Quản lý tải xuống: Đẩy tiến độ, tạm dừng/hủy, thử lại, xóa, mở thư mục chứa
 *   5. Cài đặt: Thư mục tải về, quy tắc đặt tên, số luồng đồng thời (Lưu trữ tệp JSON)
 */
const { app, BrowserWindow, BaseWindow, View, WebContentsView, globalShortcut, ipcMain: rawIpcMain, dialog, shell, session, protocol, Menu, MenuItem, Notification, screen, safeStorage } = require('electron');
const path = require('path');
const IS_PREVIEW = require('./package.json').name === 'hongguo-experience-preview';
if (IS_PREVIEW) {
  app.setName('Phim Ngắn Hồng Quả (Bản xem trước)');
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', path.join(app.getPath('appData'), 'hongguo-experience-preview'));
  }
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => app.emit('activate'));
// Bản di động Windows: Dữ liệu đi cùng thư mục ứng dụng, mang theo khi di chuyển ứng dụng.
// Việc di chuyển phải diễn ra sau khi lấy được khóa đơn phiên bản (single instance lock), tránh 2 tiến trình trong cùng thư mục dọn dẹp tệp tạm của nhau.
const { applyPortableDataDir, getPortableDirectory } = require('./src/native/portable-data');
let portableConfig = { mode: 'default', dir: '', reason: '', copied: [],
  portableDir: getPortableDirectory({ env: process.env, platform: process.platform, execPath: process.execPath }) };
if (hasSingleInstanceLock && !IS_PREVIEW && app.commandLine.hasSwitch?.('user-data-dir') !== true) {
  try {
    // Dữ liệu phiên duyệt web cũng đi cùng thư mục ứng dụng; applyPortableDataDir đồng thời thiết lập
    // userData và sessionData, nếu thất bại lưu lý do vào portableConfig.reason.
    portableConfig = applyPortableDataDir({ app, defaultUserData: app.getPath('userData'), execPath: process.execPath });
    if (portableConfig.copied?.length) console.log('[Config] Đã di chuyển dữ liệu bản di động:', portableConfig.copied.join(', '));
    if (portableConfig.reason) console.warn('[Config]', portableConfig.reason);
  } catch (error) {
    console.warn('[Config] Thư mục dữ liệu bản di động không khả dụng:', error.message);
  }
}
const fs = require('fs');
const fsp = require('fs/promises');
const axios = require('axios');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID, createHash } = require('node:crypto');

const hongguo = require('./src/native/hongguo');
const { normalizeDownloadQuality, meetsDownloadQuality } = require('./src/native/download-quality');
const { decryptInWorker } = require('./src/native/decrypt-worker.cjs');
const store = require('./src/store');
const watchHistory = require('./src/native/watch-history');
const { createAccountService, safeMessage: accountSafeMessage } = require('./src/native/account-session');
const seriesSearch = require('./src/native/series-search');
const { searchHongguo } = require('./src/native/hongguo-search');
const { fitWindowBounds, getWindowScale, saveWindowZoom, restoreMainWindowBounds, rememberMainWindowBounds } = require('./src/native/window-layout');
const { createEpisodePanelController } = require('./src/native/episode-panel');
const { availableRelease } = require('./src/native/app-update');
const { createAnnouncementService } = require('./src/native/app-announcements');
const { fetchPublicDetails } = require('./src/native/public-details');
const { fetchEpisodeComments } = require('./src/native/episode-comments');
const { fetchDanmaku, setDeviceIdentityFile } = require('./src/native/danmaku');
const LicenseManager = require('./src/native/license-manager');
const licenseManager = new LicenseManager();
const { exportSeriesText } = require('./src/native/text-export');
const { prepareNasExport, inspectNasEpisode, copyNasEpisode, nasEpisodeFilename, checkNasDirectory } = require('./src/native/nas-export');
const mediaAccess = require('./src/native/media-access').createMediaAccess(process.env.VITE_DEV_SERVER_URL);
const rendererSecurity = require('./src/native/renderer-security').createRendererSecurity(
  path.join(__dirname, 'dist-react', 'index.html'), process.env.VITE_DEV_SERVER_URL);
const attachFloatingPlayerWindow = require('./src/native/floating-player-window');
const APP_VERSION = app.getVersion() || '1.0.0';

const APP_TITLE = IS_PREVIEW ? 'Phim Ngắn Hồng Quả (Bản xem trước)' : 'Phim Ngắn Hồng Quả';
const { createStealthController } = require('./src/native/stealth-window');
const { createBossKeyController } = require('./src/native/boss-key');

const casting = require('./src/native/casting').createCastingService();
const castFileRefs = new Map();
const localFileReaders = new Map();
let castBusy = false;
let mainWindow = null;
let appUpdateInstaller = null;
let appUpdater = null;
let updateDownloadGeneration = 0;
let pendingUpdateOperations = 0;
let quitCleanup = null;
let quitReady = false;
let mergeTempCleanup = null;
const UPDATE_BLOCKED_CHANNELS = new Set(['hongguo-download-batch', 'download-single-episode', 'download-series-to-nas', 'retry-task', 'retry-tasks', 'resume-all', 'merge-series', 'transcode-for-playback', 'prepare-online-play', 'start-casting', 'save-settings', 'set-boss-key']);
const ipcMain = {
  handle(channel, handler) {
    rawIpcMain.handle(channel, async (event, ...args) => {
      if (!rendererSecurity.isTrustedSender(event, mainWindow)) throw new Error('Yêu cầu từ cửa sổ không hợp lệ');
      if (quitCleanup) return { success: false, error: 'Đang thoát, vui lòng đợi quá trình dọn dẹp hoàn tất.' };
      if (appUpdateInstaller?.getState().status === 'installing' && UPDATE_BLOCKED_CHANNELS.has(channel)) {
        return { success: false, error: 'Đang cài đặt bản cập nhật, vui lòng đợi ứng dụng khởi động lại.' };
      }
      const blocksUpdate = UPDATE_BLOCKED_CHANNELS.has(channel);
      if (blocksUpdate) pendingUpdateOperations++;
      try { return await handler(event, ...args); }
      finally { if (blocksUpdate) pendingUpdateOperations--; }
    });
  },
};
let storageError = null;
store.setErrorHandler?.(payload => {
  storageError = payload;
  sendToRenderer('storage-error', payload);
});

// ===== Khả năng tương thích giải mã video =====
// Video nền tảng là HEVC (bytevc1), Chromium trên Windows chỉ có thể dựa vào giải mã phần cứng HEVC.
// Nếu card đồ họa không hỗ trợ, hoặc bị danh sách chặn GPU của Chromium chặn, sẽ xuất hiện tình trạng "màn hình đen nhưng có tiếng".
// Tại đây chủ động bật hỗ trợ giải mã HEVC của nền tảng và nới lỏng danh sách chặn, có thể cứu vãn khá nhiều máy tính;
// Nếu vẫn không được, sẽ dùng "chuyển mã chế độ tương thích" làm phương án dự phòng (xem transcodeForPlayback).
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Cho phép cố gắng sử dụng bộ giải mã nền tảng ngay cả khi không có giải mã phần cứng
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');


// ===== Phát trực tuyến: Giao thức luồng tùy chỉnh (Bộ nhớ đệm RAM + Hỗ trợ Range) =====
// Nguồn phát dạng rõ sẽ cấp trực tiếp dạng luồng theo yêu cầu Range của trình phát; nguồn mã hóa vẫn tải trước rồi giải mã.
// Địa chỉ CDN chỉ lưu trong tiến trình chính, bộ dựng sử dụng địa chỉ phiên ngẫu nhiên.
const STREAM_SCHEME = 'hongguo-stream';
// Giao thức phát tệp cục bộ đã tải về.
// Không thể dùng trực tiếp file:// trong chế độ phát triển — trang dựng đến từ http://localhost:5173,
// Chromium sẽ từ chối bằng "Not allowed to load local resource" (biểu hiện là trình phát đen màn hình, 0:00).
// Vì vậy chuyển sang dùng tiến trình chính đọc tệp bằng Node và cung cấp qua giao thức tùy chỉnh, có hỗ trợ Range để kéo tua tiến độ.
//
// Lưu ý: Hai scheme này cố ý không bật bypassCSP — việc video có tải được hay không do danh sách trắng CSP của index.html
// quyết định (media-src / connect-src phải liệt kê rõ hongguo-stream: và hongguo-local:).
// Dùng bypassCSP để bỏ qua CSP của chính mình sẽ làm mất một tầng bảo vệ, che đậy sơ hở cấu hình, không thêm lại.
const LOCAL_SCHEME = 'hongguo-local';
protocol.registerSchemesAsPrivileged([
  {
    scheme: STREAM_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
  {
    scheme: LOCAL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

/** vid -> { buffer, size, lastUsed, seriesId, vidIndex } */
const onlineCache = new Map();
const ONLINE_MAX_BYTES = 300 * 1024 * 1024; // Ngân sách đọc nguyên tập và dọn dẹp bộ nhớ đệm, không phải giới hạn tổng RAM tiến trình
const onlinePreparing = new Map(); // vid -> shared preparation + abort controller
const onlineWork = new Set(); // Includes canceled work until its resource cleanup finishes.

function trackOnlineWork(controller, promise) {
  const job = { controller, promise };
  onlineWork.add(job);
  return promise.finally(() => onlineWork.delete(job));
}
const onlineSessions = new Map(); // opaque stream ID -> playback lifetime

function onlineCacheTotal() {
  let t = 0;
  for (const e of onlineCache.values()) t += e.size;
  return t;
}

function trimOnlineCache() {
  let total = onlineCacheTotal();
  while (total > ONLINE_MAX_BYTES && onlineCache.size > 1) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, e] of onlineCache) {
      if (e.lastUsed < oldest) { oldest = e.lastUsed; oldestKey = k; }
    }
    if (!oldestKey) break;
    total -= onlineCache.get(oldestKey).size;
    deleteOnlineCacheEntry(oldestKey);
  }
}

function releaseOnlineSession(id) {
  const session = onlineSessions.get(id);
  if (!session) return;
  onlineSessions.delete(id);
  disposeOnlineDisk(session.entry);
  for (const controller of session.requests) controller.abort();
  const pending = session.job;
  if (pending && ![...onlineSessions.values()].some(s => s.job === pending)) {
    pending.controller.abort();
    if (onlinePreparing.get(session.cacheKey || session.vid) === pending) onlinePreparing.delete(session.cacheKey || session.vid);
  }
}

function clearOnlineCache() {
  for (const id of [...onlineSessions.keys()]) releaseOnlineSession(id);
  for (const key of [...onlineCache.keys()]) deleteOnlineCacheEntry(key);
}




function disposeOnlineDisk(entry) {
  if (!entry?.disk || entry.disk.readers || [...onlineCache.values()].some(e => e.disk === entry.disk)
    || [...onlineSessions.values()].some(s => s.entry?.disk === entry.disk)) return;
  try { fs.rmSync(entry.disk.directory, { recursive:true, force:true }); } catch (_) {}
}
function deleteOnlineCacheEntry(key) {
  const entry = onlineCache.get(key); onlineCache.delete(key); disposeOnlineDisk(entry);
}
function checkCustomAccess(vid) {
  if (String(vid).startsWith('custom:')) require('./src/native/custom-source').assertEnabled(vid);
}
async function prepareHlsFile(playInfo, output, options = {}) {
  try { return await require('./src/native/hls-media').remuxHls({ url:playInfo.url, output, ffmpeg:resolveFfmpeg('ffmpeg'),
    headers:{ ...(playInfo.userAgent ? {'User-Agent':playInfo.userAgent} : {}), ...(playInfo.referer ? {Referer:playInfo.referer} : {}) },
    ...options, checkAccess:() => checkCustomAccess(playInfo.vid) }); }
  catch (error) {
    checkCustomAccess(playInfo.vid);
    if (!options.signal?.aborted && !options.cancelToken?.reason) error.mediaRetryable = true;
    throw error;
  }
}

// ===== Quản lý tác vụ tải xuống =====
let downloadTasks = [];
let downloadQueue = [];
let activeDownloads = 0;
const runningDownloads = new Set();
const runningDownloadPaths = new Set();
const downloadRuns = new Map();
let MAX_CONCURRENT_DOWNLOADS = 3;

// ===== Cài đặt =====
function getDefaultSettings() {
  return {
    root: IS_PREVIEW ? path.join(app.getPath('userData'), 'downloads') : app.getPath('downloads'),
    // Mẫu đặt tên tệp: Các biến khả dụng series_title (Tên phim), vid_index (Tập), ep_title (Tiêu đề)
    name_format: 'series_title vid_index',
    max_concurrent: 3,
    download_resolve_interval: 500,
    ui_zoom: 1,
    download_quality: 'auto',
    custom_sources: [],
    // Tự động xóa tệp cục bộ sau khi xem hết một tập (vừa xem vừa dọn, tránh chiếm dụng ổ đĩa)
    auto_delete_watched: false,
    // Chế độ tương thích: Tự động chuyển mã sang H.264 khi máy không thể giải mã HEVC (sửa lỗi "màn hình đen có tiếng")
    compat_mode: true,
    cache_next_episode: true,
    picture_in_picture_mode: 'custom',
    app_updates_enabled: !IS_PREVIEW,
    watch_updates_enabled: true,
    watch_sequels_enabled: true,
    watch_notifications_enabled: false,
    // Thử nghiệm: Ưu tiên tìm kiếm App Hồng Quả; thất bại / kết quả trống tự động lùi về API web chính thức.
    search_app_enabled: false,
    // ===== Proxy mạng =====
    // proxy_enabled: Có bật proxy hay không (khi tắt sẽ bỏ qua proxy hệ thống, kết nối trực tiếp)
    // proxy_mode:    system=theo hệ thống/biến môi trường · custom=chỉ định thủ công · direct=buộc kết nối trực tiếp
    proxy_enabled: false,
    proxy_mode: 'system',
    proxy_host: '127.0.0.1',
    proxy_port: 7890,
    proxy_username: '',
    proxy_password: '',
  };
}

// Khi khởi động ghi lại proxy ban đầu của hệ thống/terminal. Sau đó direct/custom sẽ ghi đè các biến này,
// "Theo hệ thống" phải đọc bản chụp nhanh này, nếu không sẽ coi lần kết nối trực tiếp hoặc thủ công trước đó là proxy hệ thống.
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
let activeProxyAuth = null;
const sessionProxyConfigs = new WeakMap();
let proxyApplyVersion = 0;
let desiredProxyConfig = null;

// proxy-from-env 2.1.0 không có tham số env; phân tích ảnh chụp nhanh khởi động theo cùng quy tắc, đối chiếu từng trường hợp giữa kiểm thử và phụ thuộc thực tế.
function snapshotProxyUrl(targetUrl = 'https://www.baidu.com') {
  let target;
  try { target = new URL(targetUrl); } catch (_) { return null; }
  if (!target.host) return null;
  const protocol = target.protocol.split(':', 1)[0];
  const hostname = target.host.replace(/:\d*$/, '');
  const port = parseInt(target.port) || { ftp: 21, gopher: 70, http: 80, https: 443, ws: 80, wss: 443 }[protocol] || 0;
  const env = key => originalProxyEnv[key.toLowerCase()] || originalProxyEnv[key.toUpperCase()] || '';
  const bypass = env('no_proxy').toLowerCase();
  if (bypass === '*') return null;
  if (bypass && bypass.split(/[,\s]/).some(entry => {
    if (!entry) return false;
    const match = entry.match(/^(.+):(\d+)$/);
    const host = match ? match[1] : entry;
    const bypassPort = match ? parseInt(match[2]) : 0;
    if (bypassPort && bypassPort !== port) return false;
    if (!/^[.*]/.test(host)) return hostname === host;
    return hostname.endsWith(host.startsWith('*') ? host.slice(1) : host);
  })) return null;
  const proxy = env(protocol + '_proxy') || env('all_proxy');
  return proxy ? (proxy.includes('://') ? proxy : `${protocol}://${proxy}`) : null;
}

function normalizeProxySettings(settings) {
  const copy = { ...settings };
  const host = String(copy.proxy_host || '').trim();
  if (!host.includes('@')) return copy;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`);
    if (url.username || url.password) {
      copy.proxy_username = decodeURIComponent(url.username);
      copy.proxy_password = decodeURIComponent(url.password);
      copy.proxy_host = host.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?)[^/]*@/i, '$1');
    }
  } catch (_) {
    // Địa chỉ không hợp lệ cũng không được trả nguyên vẹn userinfo về cho trang.
    copy.proxy_host = host.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?)[^/]*@/i, '$1');
  }
  return copy;
}

/**
 * Tính toán URL proxy đang có hiệu lực.
 * Trả về { mode, url }:
 *   mode='direct'  Kết nối trực tiếp
 *   mode='system'  API/tải xuống phân tích theo môi trường khởi động (url là định tuyến tới mục tiêu kiểm thử HTTPS); trình duyệt theo hệ thống
 *   mode='custom'  Chỉ định thủ công
 */
function resolveProxyConfig(settings) {
  const s = settings || {};
  if (s.proxy_enabled !== true) {
    return { mode: 'direct', url: null };
  }
  const mode = s.proxy_mode || 'system';
  if (mode === 'direct') {
    return { mode: 'direct', url: null };
  }
  if (mode === 'custom') {
    const host = String(s.proxy_host || '').trim();
    const port = String(s.proxy_port || '').trim();
    if (!host) return { mode: 'custom', url: null };
    // Thành phần URL giúp tránh nối trùng cổng hoặc dấu ngoặc vuông IPv6 khi dán cả địa chỉ hoàn chỉnh.
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`);
      if (!port && !/:\d+\/?$/.test(host)) return { mode: 'custom', url: null };
      if (port) {
        if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return { mode: 'custom', url: null };
        url.port = port;
      }
      if (String(s.proxy_username || '').trim()) {
        url.username = encodeURIComponent(String(s.proxy_username).trim());
        url.password = encodeURIComponent(String(s.proxy_password || ''));
      }
      return { mode: 'custom', url: url.toString().replace(/\/$/, '') };
    } catch (_) { return { mode: 'custom', url: null }; }
  }
  // system: Lấy biến môi trường lúc khởi động làm chuẩn, không đọc giá trị đã bị tiến trình này ghi đè
  return { mode: 'system', url: snapshotProxyUrl() };
}

function publicProxyUrl(value) {
  if (!value) return null;
  try { const url = new URL(value); url.username = ''; url.password = ''; return url.toString(); }
  catch (_) { return '(địa chỉ proxy đã ẩn)'; }
}

function publicProxyError(message, settings, resolved) {
  let text = String(message || 'Kết nối proxy thất bại').replace(/([a-z]+:\/\/)[^\s/]*@/gi, '$1[xác thực đã ẩn]@');
  for (const secret of [settings.proxy_username, settings.proxy_password, resolved.url]) {
    if (secret) for (const value of new Set([String(secret), encodeURIComponent(String(secret))])) text = text.split(value).join('[đã ẩn]');
  }
  return text;
}

/**
 * Ghi proxy vào biến môi trường, axios sẽ tự động đọc (proxy-from-env),
 * nhờ đó phân tích API Hồng Quả và tải video đều đi qua proxy, không cần đổi mã nghiệp vụ.
 */
function applyProxyToEnv(resolved) {
  for (const key of PROXY_ENV_KEYS) {
    if (resolved.mode === 'system') {
      if (originalProxyEnv[key] !== undefined) process.env[key] = originalProxyEnv[key];
      else delete process.env[key];
    } else if (resolved.mode === 'custom' && resolved.url && key.toLowerCase() !== 'no_proxy') {
      process.env[key] = resolved.url;
    } else {
      delete process.env[key];
    }
  }
}

// proxyRules của Chromium sẽ bỏ qua tài khoản/mật khẩu trong URL; yêu cầu cửa sổ chuyển sang cung cấp xác thực qua sự kiện login.
function proxyRuleForSession(resolved) {
  let url;
  try { url = new URL(resolved.url); } catch (_) { return null; }
  const protocol = (url.protocol || 'http:').replace(/:$/, '').toLowerCase();
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const hostname = host.includes(':') ? `[${host}]` : host;
  if (!hostname) return null;
  const port = url.port;
  return {
    rule: port ? `${protocol}://${hostname}:${port}` : `${protocol}://${hostname}`,
    auth: url.username ? {
      host,
      port: port ? Number(port) : (protocol === 'https' ? 443 : protocol.startsWith('socks') ? 1080 : 80),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password || ''),
    } : null,
  };
}

/** Cửa sổ và bộ cập nhật dùng Session khác nhau, quy tắc proxy phải được áp dụng riêng biệt. */
async function applyProxyToSession(resolved, sessions = [session.defaultSession, appUpdater?.netSession], version = proxyApplyVersion) {
  let auth = null;
  let config = { mode: resolved.mode === 'direct' ? 'direct' : 'system' };
  if (resolved.mode === 'custom' && resolved.url) {
    const built = proxyRuleForSession(resolved);
    if (!built) throw new Error('Địa chỉ proxy không hợp lệ');
    auth = built.auth;
    config = { mode: 'fixed_servers', proxyRules: built.rule };
  }
  const key = JSON.stringify([config, auth]);
  await Promise.all(sessions.filter(Boolean).map(async ses => {
    if (sessionProxyConfigs.get(ses) !== key) {
      await ses.setProxy(config);
      await ses.clearAuthCache?.();
      await ses.closeAllConnections?.();
    }
    if (version !== proxyApplyVersion) {
      // Electron cannot cancel setProxy; a late completion must restore the newest choice.
      sessionProxyConfigs.delete(ses);
      await applyProxyToSession(desiredProxyConfig, [ses], proxyApplyVersion);
      throw new Error('Cài đặt proxy đã được cập nhật');
    }
    sessionProxyConfigs.set(ses, key);
  }));
  if (version === proxyApplyVersion) activeProxyAuth = auth;
}

function matchesProxyAuth(authInfo) {
  if (!authInfo?.isProxy || !activeProxyAuth) return false;
  const host = String(authInfo.host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === activeProxyAuth.host && Number(authInfo.port) === activeProxyAuth.port;
}

app.on('login', (event, _webContents, _details, authInfo, callback) => {
  if (!matchesProxyAuth(authInfo)) return;
  event.preventDefault();
  callback(activeProxyAuth.username, activeProxyAuth.password);
});

/** Cổng vào thống nhất: Được gọi khi cài đặt thay đổi hoặc khi khởi động */
async function applyProxySettings(settings) {
  const resolved = resolveProxyConfig(settings);
  const version = ++proxyApplyVersion;
  desiredProxyConfig = resolved;
  try { await applyProxyToSession(resolved, undefined, version); }
  catch (_) { throw new Error('Thiết lập proxy mạng thất bại, vui lòng thử lại.'); }
  if (version !== proxyApplyVersion) throw new Error('Cài đặt proxy đã được cập nhật');
  applyProxyToEnv(resolved);
  console.log(`[Proxy] mode=${resolved.mode}`);
  return resolved;
}

/** Xác thực bản nháp proxy trước khi lưu, tránh ghi cấu hình hỏng xuống đĩa rồi lần khởi động sau mới phát hiện. */
function validateProxyDraft(settings) {
  const s = settings || {};
  if (s.proxy_enabled !== true) return;
  const mode = s.proxy_mode || 'system';
  if (!['system', 'custom', 'direct'].includes(mode)) throw new Error('Chế độ proxy không được hỗ trợ');
  if (mode !== 'custom') return;
  const resolved = resolveProxyConfig(s);
  if (!resolved.url) throw new Error('Vui lòng điền đầy đủ địa chỉ proxy và cổng');
  let url;
  try { url = new URL(resolved.url); } catch (_) { throw new Error('Định dạng địa chỉ proxy không hợp lệ'); }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol)) throw new Error('Chỉ hỗ trợ proxy HTTP, HTTPS, SOCKS4 hoặc SOCKS5');
  if (!url.hostname) throw new Error('Định dạng địa chỉ proxy không hợp lệ');
  if (!proxyRuleForSession(resolved)) throw new Error('Địa chỉ proxy không thể dùng cho cài đặt mạng hệ thống');
}

function applyProxyWithTimeout(settings, timeoutMs) {
  let timer;
  return Promise.race([
    applyProxySettings(settings),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Khởi động proxy quá thời gian')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

/** Khi khởi động thử proxy đã lưu trước; cấu hình hỏng tạm thời kết nối trực tiếp để đảm bảo mở được cửa sổ cho người dùng sửa. */
async function applyProxyForStartup(settings) {
  try {
    validateProxyDraft(settings);
    await applyProxyWithTimeout(settings, 15000);
    return { fallback: false, reason: '', fallbackError: '' };
  } catch (error) {
    let fallbackError = '';
    try { await applyProxyWithTimeout({ ...settings, proxy_enabled: false, proxy_mode: 'direct' }, 5000); }
    catch (fallback) { fallbackError = fallback.message; }
    return { fallback: true, reason: error.message, fallbackError };
  }
}

function getCurrentSettings() {
  const saved = store.getSettings() || {};
  const merged = { ...getDefaultSettings(), ...saved };
  // Đảm bảo số tác vụ đồng thời hợp lệ
  const mc = parseInt(merged.max_concurrent, 10);
  MAX_CONCURRENT_DOWNLOADS = Number.isInteger(mc) && mc >= 1 && mc <= 10 ? mc : 3;
  const interval = parseInt(merged.download_resolve_interval, 10);
  const resolveInterval = Number.isInteger(interval) && interval >= 0 && interval <= 5000 ? interval : 500;
  return normalizeProxySettings({ ...merged, max_concurrent: MAX_CONCURRENT_DOWNLOADS, download_resolve_interval: resolveInterval });
}

// Làm sạch tên thư mục/tệp (loại bỏ ký tự không hợp lệ, dấu chấm và khoảng trắng ở cuối, tên dành riêng của Windows)
function sanitizeFolderName(name) {
  let cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/^ +/, '');
  // Cắt theo điểm mã trước để tránh chia đôi emoji; sau đó bỏ dấu chấm hoặc khoảng trắng ở cuối.
  const chars = Array.from(cleaned);
  if (chars.length > 80) cleaned = chars.slice(0, 80).join('');
  cleaned = cleaned.replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(cleaned)) {
    cleaned = `_${cleaned}`.replace(/[. ]+$/g, '');
  }
  return cleaned;
}

// Render tên tệp theo mẫu đặt tên, trả về tên (không kèm phần mở rộng) hoặc null
function renderName(format, seriesTitle, vidIndex, epTitle) {
  const fmt = String(format || '').trim();
  if (!fmt) return null;
  const vars = {
    'series_title': String(seriesTitle || '').trim(),
    'vid_index': String(vidIndex).padStart(3, '0'),
    'ep_title': String(epTitle || '').trim(),
  };
  const zhMap = {
    '剧名': 'series_title',
    '集数': 'vid_index',
    '标题': 'ep_title',
  };
  const zhRe = /剧名|集数|标题|TenPhim|Tap|TieuDe/gi;
  let name = fmt
    .replace(zhRe, (w) => zhMap[w] || w)
    .replace(/([A-Za-z]+(?:_[A-Za-z]+)*)/g, (tok) => (vars[tok] !== undefined ? (vars[tok] || '') : tok));
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return name || null;
}

// ===== Tải / Lưu tác vụ tải xuống =====
function loadDownloadTasks() {
  const saved = store.getTasks() || [];
  saved.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  downloadTasks = saved.map((task) => {
    const inProgress = task.status === 'downloading' || task.status === 'pending';
    return {
      ...task,
      status: inProgress ? 'failed' : task.status,
      error: inProgress ? 'Tác vụ bị ngắt khi đóng ứng dụng' : task.error,
      qualityNotice: task.status === 'completed' ? task.qualityNotice || '' : '',
    };
  });
}

/**
 * Điền lại hồ sơ phim ngắn từ các tác vụ tải xuống đã có.
 * Người dùng có thể đã tải về nhiều tập trước khi tính năng này ra mắt, không có hồ sơ thì trang phát sẽ không thấy được chúng.
 */
function rebuildSeriesRegistryFromTasks() {
  const groups = new Map();
  for (const t of downloadTasks) {
    const info = t.hongguoInfo;
    if (!info || !info.series_id) continue;
    const sid = String(info.series_id);
    if (!groups.has(sid)) {
      groups.set(sid, {
        series_id: sid,
        series_title: info.series_title || 'Phim_chua_dat_ten',
        cover: (t.videoInfo && t.videoInfo.cover) || '',
        episodes: new Map(),
      });
    }
    const g = groups.get(sid);
    const idx = Number(info.vid_index) || 0;
    if (!g.episodes.has(idx)) {
      g.episodes.set(idx, {
        vid: String(info.vid),
        vid_index: idx,
        title: info.ep_title || '',
        cover: (t.videoInfo && t.videoInfo.cover) || '',
      });
    }
  }

  let added = 0;
  for (const g of groups.values()) {
    const existing = seriesRegistry.find((s) => String(s.series_id) === g.series_id);
    const list = Array.from(g.episodes.values()).sort((a, b) => a.vid_index - b.vid_index);
    if (!existing) {
      seriesRegistry.push({
        series_id: g.series_id,
        series_title: g.series_title,
        cover: g.cover,
        total: list.length,
        episodes: list,
        updatedAt: 0, // Dữ liệu điền lại xếp sau dữ liệu tìm kiếm/phân tích
        dismissed: false,
      });
      added++;
    } else if (!existing.dismissed && (!existing.episodes || existing.episodes.length < list.length)) {
      // Khi danh sách tập trong hồ sơ chưa đầy đủ, bổ sung bằng các tập gom được từ tác vụ
      existing.episodes = list;
      existing.total = list.length;
      added++;
    }
  }
  if (added > 0) {
    saveSeriesRegistry();
    console.log(`[Series] Đã điền lại ${added} hồ sơ phim ngắn từ tác vụ tải xuống`);
  }
}

function saveDownloadTasks() {
  const serializable = downloadTasks.map((task) => {
    const { cancelSource, writer, ...rest } = task;
    return rest;
  });
  store.saveTasks(serializable);
  sendToRenderer('download-queue-changed', {});
}

/** Các thao tác thử lại/tiếp tục sẽ khôi phục trường tác vụ và hàng đợi nếu lưu trữ thất bại, tránh việc tác vụ chưa lưu bị khởi chạy sau đó. */
function snapshotQueueTasks(tasks) {
  return {
    previousQueue: [...downloadQueue],
    snapshots: tasks.map(task => ({ task, previous: { ...task } })),
  };
}

function restoreQueueTasks(snapshot) {
  for (const { task, previous } of snapshot.snapshots) {
    for (const key of Object.keys(task)) if (!(key in previous)) delete task[key];
    Object.assign(task, previous);
  }
  downloadQueue = snapshot.previousQueue;
  sendToRenderer('download-queue-changed', {});
}

// ===== Hồ sơ phim ngắn (Trang phát dựa vào đây để liệt kê đầy đủ danh sách tập) =====
let seriesRegistry = [];

function loadSeriesRegistry() {
  seriesRegistry = store.getSeries() || [];
}

function saveSeriesRegistry() {
  store.saveSeries(seriesRegistry);
}

/**
 * Đăng ký / Cập nhật một bộ phim ngắn. data cần chứa series_id và episodes.
 * Nếu đã có thì không ghi đè episodes (tránh làm mất dữ liệu tốt khi API gặp lỗi), chỉ bổ sung tiêu đề và ảnh bìa.
 */
function upsertSeriesRegistry(data) {
  if (!data || !data.series_id || !Array.isArray(data.episodes) || data.episodes.length === 0) return;
  const sid = String(data.series_id);
  const idx = seriesRegistry.findIndex((s) => String(s.series_id) === sid);
  const entry = {
    series_id: sid,
    series_title: data.series_title || 'Phim_chua_dat_ten',
    cover: data.cover || '',
    total: data.episodes.length,
    web_accessible_episodes: data.web_accessible_episodes ?? null,
    episodes: data.episodes.map((e) => ({
      vid: String(e.vid),
      vid_index: e.vid_index || 0,
      title: e.title || '',
      cover: e.cover || '',
      web_available: e.web_available ?? null,
      locked: e.locked === true,
    })),
    updatedAt: Date.now(),
    dismissed: false, // Từng bị người dùng xóa thủ công; khi đăng ký lại sẽ tự động hiển thị lại
    forgotten: false,
  };
  if (idx === -1) seriesRegistry.unshift(entry);
  else seriesRegistry[idx] = { ...seriesRegistry[idx], ...entry, dismissed: false };
  saveSeriesRegistry();
  return seriesRegistry.find(item => String(item.series_id) === sid);
}

/** Phim ngắn hiển thị trong thư viện (đã lọc các phim bị người dùng xóa) */
function visibleSeries() {
  return seriesRegistry.filter((s) => !s.dismissed);
}

// ===== Điều phối hàng đợi tải xuống =====
// Giải thích: Tại đây phải "trả về ngay lập tức". Triển khai ban đầu viết thành `await executeDownload(task)`,
// khiến mỗi lần gọi chỉ khởi chạy một tác vụ và bị chặn cho đến khi tác vụ đó kết thúc,
// dẫn đến số lượt tải đồng thời luôn là 1 (bất kể max_concurrent đặt là bao nhiêu).
// Hiện tại runTask tự gọi lại pumpQueue khi kết thúc, bộ điều phối chỉ chịu trách nhiệm phân phát theo giới hạn đồng thời.
function pumpQueue() {
  if (quitCleanup) return;
  downloadQueue = downloadQueue.filter(task => task.status === 'pending');
  for (const task of downloadQueue) repairTaskDestination(task);
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    const index = downloadQueue.findIndex(task => !runningDownloads.has(task.id) && !runningDownloadPaths.has(task.savePath));
    if (index < 0) break;
    const [task] = downloadQueue.splice(index, 1);
    runningDownloads.add(task.id);
    runningDownloadPaths.add(task.savePath);
    activeDownloads++;
    downloadRuns.set(task.id, runTask(task));
  }
}

async function runTask(task) {
  const destination = task.savePath;
  try {
    await executeDownload(task);
  } catch (error) {
    console.error('[Download Queue] Tải xuống thất bại:', error);
  } finally {
    activeDownloads--;
    runningDownloads.delete(task.id);
    speedLastBytes.delete(task.id);
    runningDownloadPaths.delete(destination);
    downloadRuns.delete(task.id);
    pumpQueue();
  }
}

// Giữ lại tên cũ, logic bên trong giữ nguyên (nhiều nơi vẫn đang gọi)
function processDownloadQueue() {
  pumpQueue();
}

/** Lỗi nguồn có thể là tạm thời; chỉ dùng để chọn thông báo và làm mới nguồn phát, không bao giờ để tự tải lại. */
function sourceFailureIsTransient(error) {
  const sources = Array.isArray(error?.sources) ? error.sources : [];
  return sources.some(item =>
    (item.source === 'web' && /^HTTP_(?:404|410)$/.test(item.code))
    || /^(?:TIMEOUT|NETWORK_ERROR|HTTP_(?:408|5dd))$/.test(item.code));
}

// QUY TẮC: Không bao giờ tự tải. Mọi lượt tải, tiếp tục hoặc thử lại chỉ bắt đầu khi người dùng bấm.
// Khởi động lại ứng dụng, lỗi mạng hoặc lỗi nguồn không được phép tự đưa tác vụ vào hàng đợi.

/** Dọn dấu vết lịch tự thử lại còn sót trong dữ liệu cũ; hiện không còn tự thử lại. */
function clearSourceRetry(task) {
  delete task.retryAt;
  delete task.sourceRetries;
}

function cancelScheduledRetries(tasks) {
  let changed = false;
  for (const task of tasks) {
    if (task.status !== 'failed' || !task.retryAt) continue;
    clearSourceRetry(task);
    const reason = String(task.error || '').replace(/(?: 将在 .*后自动重试（\d+\/\d+）。| sẽ tự động thử lại sau .* \(\d+\/\d+\)\.)$/, '');
    task.error = `${reason ? reason + '; ' : ''}Đã hủy tự động thử lại, vui lòng thử lại thủ công`;
    changed = true;
  }
  return changed;
}

/**
 * Một chạm tạm dừng: Hủy tác vụ đang chạy, dọn sạch hàng đợi chờ, đánh dấu các tác vụ chờ thành đã dừng.
 * Trả về số tác vụ bị tạm dừng.
 */
function pauseAllTasks() {
  let stopped = 0;
  for (const task of downloadTasks) {
    if (task.status === 'failed' && task.retryAt) {
      clearSourceRetry(task);
      task.status = 'stopped';
      task.error = 'Đã tạm dừng thủ công';
      stopped++;
    } else if (task.status === 'pending') {
      clearSourceRetry(task);
      task.status = 'stopped';
      task.error = 'Đã tạm dừng thủ công';
      task.endTime = Date.now();
      stopped++;
    } else if (task.status === 'downloading') {
      task.cancelled = true;
      if (task.cancelSource) {
        try { task.cancelSource.cancel('Người dùng tạm dừng tất cả'); } catch (_) {}
      }
      if (task.writer) {
        try { task.writer.destroy(); } catch (_) {}
      }
      task.status = 'stopped';
      delete task.cancelSource;
      delete task.writer;
      stopped++;
    }
  }
  downloadQueue = [];
  saveDownloadTasks();
  sendToRenderer('download-queue-changed', {});
  return stopped;
}

/**
 * Một chạm bắt đầu: Đưa toàn bộ các tác vụ chưa hoàn thành (đã dừng / thất bại / đang chờ) vào hàng đợi chạy lại.
 * Trả về số tác vụ được xếp hàng lại.
 */
function resumeAllTasks() {
  let count = 0;
  const changed = downloadTasks.filter((task) => task.status === 'stopped' || task.status === 'failed' || task.status === 'pending'
    || (task.status === 'completed' && !hasCompleteTaskFile(task)));
  const snapshot = snapshotQueueTasks(changed);
  for (const task of changed) {
    clearSourceRetry(task);
    repairTaskDestination(task);
    task.status = 'pending';
    task.progress = 0;
    task.receivedBytes = 0;
    task.totalBytes = 0;
    task.cancelled = false;
    delete task.error;
    delete task.cancelSource;
    delete task.writer;

    if (!downloadQueue.some((t) => t.id === task.id)) downloadQueue.push(task);
    count++;
  }
  if (count > 0) {
    try { saveDownloadTasks(); }
    catch (error) { restoreQueueTasks(snapshot); throw error; }
    pumpQueue();
  }
  sendToRenderer('download-queue-changed', {});
  return count;
}

// ===== Phân phối tải xuống =====
/** Thông lượng tải thời gian thực (B/s): tổng byte nhận được của mọi tập trong 2 giây gần nhất; chỉ lưu trong bộ nhớ. */
const SPEED_WINDOW_MS = 2000;
let speedSamples = [];
const speedLastBytes = new Map();
function trackDownloadSpeed(task, received) {
  const now = Date.now();
  const last = speedLastBytes.get(task.id) || 0;
  if (received > last) speedSamples.push({ t: now, n: received - last });
  speedLastBytes.set(task.id, received);
  while (speedSamples.length && now - speedSamples[0].t > SPEED_WINDOW_MS) speedSamples.shift();
}
function currentTotalSpeed() {
  const cutoff = Date.now() - SPEED_WINDOW_MS;
  speedSamples = speedSamples.filter(s => s.t >= cutoff);
  return speedSamples.reduce((sum, s) => sum + s.n, 0) * 1000 / SPEED_WINDOW_MS;
}

async function executeDownload(task) {
  if (task.type === 'hongguo') {
    await executeHongguoDownload(task);
    return;
  }
  throw new Error('Loại tác vụ không xác định: ' + task.type);
}

// ===== Tải phim ngắn Hồng Quả =====
function verifyDownloadDecode(file, cancelToken = null) {
  const ffmpeg = resolveFfmpeg('ffmpeg');
  if (!ffmpeg) return Promise.reject(Object.assign(new Error('Công cụ kiểm tra giải mã video không khả dụng, vui lòng cài đặt lại rồi thử lại'), { code: 'LOCAL_MEDIA_TOOL_ERROR' }));
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    let settled = false, child;
    const abort = () => {
      if (settled) return;
      try { child?.kill(); } catch (_) {}
      finish(reject, Object.assign(new Error('Đã hủy kiểm tra giải mã video'), { code: 'ERR_CANCELED' }));
    };
    const cleanup = () => cancelToken?.unsubscribe?.(abort);
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle(value);
    };
    if (cancelToken?.reason) {
      finish(reject, Object.assign(new Error('Đã hủy kiểm tra giải mã video'), { code: 'ERR_CANCELED' }));
      return;
    }
    cancelToken?.subscribe?.(abort);
    child = execFile(ffmpeg, ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-t', '3', '-f', 'null', '-'],
      { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const code = String(error.code || '');
          if (error.killed || error.signal || code === 'ETIMEDOUT' || code === 'ABORT_ERR') {
            return finish(reject, Object.assign(new Error('Công cụ kiểm tra giải mã video quá thời gian hoặc không thể chạy'), { code: 'LOCAL_MEDIA_TOOL_ERROR', cause: error }));
          }
          if (['ENOENT', 'EACCES', 'EPERM', 'EINVAL'].includes(code)) {
            return finish(reject, Object.assign(new Error('Công cụ kiểm tra giải mã video không khả dụng, vui lòng sửa lại cài đặt rồi thử lại'), { code: 'LOCAL_MEDIA_TOOL_ERROR', cause: error }));
          }
          return finish(reject, Object.assign(new Error('Kiểm tra giải mã video thất bại, tệp có thể bị hỏng, vui lòng tải lại'), { code: 'MEDIA_DECODE_ERROR', cause: error }));
        }
        if (String(stderr || '').trim()) {
          return finish(reject, Object.assign(new Error('Kiểm tra giải mã video thất bại, tệp có thể bị hỏng, vui lòng tải lại'), { code: 'MEDIA_DECODE_ERROR' }));
        }
        finish(resolve);
      });
  });
}

async function verifyDownloadQuality(file, quality, existing = false, verifyDecode = false, cancelToken = null) {
  quality = normalizeDownloadQuality(quality);
  const ffprobe = resolveFfmpeg('ffprobe');
  if (!ffprobe) throw Object.assign(new Error('Công cụ kiểm tra video không khả dụng, vui lòng cài đặt lại rồi thử lại'), { code: 'LOCAL_MEDIA_TOOL_ERROR' });
  const info = await probeVideoInfo(ffprobe, file, undefined, true);
  const prefix = existing ? 'Tệp cục bộ hiện có' : 'Tệp nguồn phim';
  if (!info || ![info.w, info.h, info.duration].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error(`${prefix} thiếu luồng video hợp lệ, độ phân giải hoặc thời lượng, chưa hoàn thành tải về${existing ? '; tệp được giữ lại, vui lòng tự kiểm tra hoặc xóa' : ''}`);
  }
  if (!meetsDownloadQuality({ width: info.w, height: info.h }, quality)) {
    throw new Error(`${prefix} thực tế là ${Math.min(info.w, info.h)}P (${info.w}×${info.h}), không thỏa mãn ${quality.toUpperCase()}${existing ? '; tệp được giữ lại, nếu muốn tải lại hãy tự xóa tệp cục bộ' : ', chưa tự động hạ cấp'}`);
  }
  if (verifyDecode) await verifyDownloadDecode(file, cancelToken);
  return `${Math.min(info.w, info.h)}p`;
}

function publishDownloadFile(temporary, destination) {
  // Reuse merge publication: hard-link when supported, exclusive copy on FAT/exFAT.
  require('./src/native/merge-runner').publishMergedOutput(temporary, destination);
  fs.unlinkSync(temporary);
}

async function completeNasExports(task) {
  if (!task.nasDestination && !task.nasTargets?.length) return [];
  const warnings = [];
  for (const destination of task.nasDestination ? [task.nasDestination] : task.nasTargets || []) {
    try {
      await copyNasEpisode(task, destination);
      sendToRenderer('nas-export-done', { seriesId: task.hongguoInfo.series_id, vidIndex: task.hongguoInfo.vid_index, success: true });
    } catch (_) {
      const error = 'Sắp xếp NAS thất bại, vui lòng đảm bảo thư mục chia sẻ đang trực tuyến rồi nhấn lại「Tải về NAS」để thử lại; video cục bộ được giữ lại';
      warnings.push(error);
      sendToRenderer('nas-export-done', { seriesId: task.hongguoInfo.series_id, vidIndex: task.hongguoInfo.vid_index, success: false, error });
    }
  }
  task.nasWarning = warnings.join('；');
  return warnings;
}

async function executeHongguoDownload(task) {
  const { id, hongguoInfo, filename } = task;
  const { vid, series_title } = hongguoInfo || {};
  const source = axios.CancelToken.source();
  task.cancelSource = source;
  let tmpPath, writer;
  try {
    task.status = 'downloading'; task.cancelled = false; task.progress = 0; delete task.retryAt;
    delete task.qualityNotice; delete task.actualQuality;
    sendToRenderer('download-progress', { id, progress: 0, receivedBytes: 0, totalBytes: 0, qualityNotice: '', actualQuality: null });
    const settings = getCurrentSettings();
    // Old and retried tasks retain their original policy, independent of new defaults.
    const quality = normalizeDownloadQuality(task.downloadQuality);
    const allowLowerQuality = quality !== 'auto' && /^\d{1,30}$/.test(String(vid));
    const notifyQuality = pixels => {
      const lower = allowLowerQuality && pixels > 0 && pixels < Number.parseInt(quality, 10);
      const notice = lower ? `Đang tải nguồn chất lượng thấp hơn: ${pixels}P (gốc chọn ${quality.toUpperCase()})` : '';
      if (task.qualityNotice === notice) return;
      task.qualityNotice = notice;
      sendToRenderer('download-progress', { id, qualityNotice: notice });
    };
    const verifyReceived = async file => {
      const actual = await verifyDownloadQuality(file, allowLowerQuality ? 'auto' : quality, false, true, source.token);
      notifyQuality(Number.parseInt(actual, 10));
      return actual;
    };
    const root = String(settings.root || '').trim() || app.getPath('downloads');
    const downloadDir = task.customDir || seriesDownloadDir(root, hongguoInfo?.series_id, series_title);
    if (task.nasDestination) {
      if (task.pathConflict) throw new Error('Đường dẫn tệp NAS xung đột với tập khác, vui lòng kiểm tra thư mục đã chọn rồi thử lại');
      await checkNasDirectory(task.nasDestination);
    }
    else fs.mkdirSync(downloadDir, { recursive: true });
    const finalPath = task.savePath || path.join(downloadDir, filename);
    task.savePath = finalPath;
    // Recheck source access before reusing an existing third-party file or URL.
    const checkedPlayInfo = /^(xifan|hema|custom):/.test(String(vid))
      ? await hongguo.fetchPlayUrlSingle(vid, hongguoInfo?.series_id, { quality }) : null;
    if (checkedPlayInfo && !checkedPlayInfo.url) throw new Error(checkedPlayInfo.error || 'Nguồn phim chưa mở tập này');
    // Existing complete files need no additional media transfer.
    source.token.throwIfRequested();
    if (fs.existsSync(finalPath)) {
      if (!hasCompleteTaskFile(task)) throw new Error('Tệp cục bộ hiện có không hoàn chỉnh hoặc đường dẫn bị xung đột, tệp được giữ lại, vui lòng tự kiểm tra hoặc xóa');
      task.actualQuality = await verifyDownloadQuality(finalPath, quality, true);
      source.token.throwIfRequested();
      await completeNasExports(task);
      source.token.throwIfRequested();
      task.status = 'completed'; task.progress = 100; task.endTime = Date.now(); delete task.sourceRetries;
      saveDownloadTasks(); sendToRenderer('download-completed', { id, path: finalPath });
      return;
    }
    tmpPath = finalPath + '.enc.tmp';
    const cached = onlineCache.get(onlineCacheKey(vid, quality)) || onlineCache.get(String(vid));
    const sourceId = /^custom:[^:]+/.exec(String(vid))?.[0] || /^(xifan|hema):/.exec(String(vid))?.[1] || 'hongguo';
    let reusedCache = false;
    if (cached?.complete && cached.vid === String(vid) && cached.source === sourceId
      && cached.seriesId === String(hongguoInfo?.series_id || '') && cached.size > 0
      && (cached.filePath || Buffer.isBuffer(cached.buffer) && cached.buffer.length === cached.size)) {
      if (cached.filePath) {
        cached.disk.readers = (cached.disk.readers || 0) + 1;
        try { await fsp.copyFile(cached.filePath, tmpPath); }
        finally { cached.disk.readers--; disposeOnlineDisk(cached); }
      } else await fsp.writeFile(tmpPath, cached.buffer, { mode: 0o600 });
      source.token.throwIfRequested();
      try { task.actualQuality = await verifyDownloadQuality(tmpPath, quality, false, true, source.token); reusedCache = true; }
      catch (_) { fs.unlinkSync(tmpPath); }
      source.token.throwIfRequested();
      checkCustomAccess(vid);
      if (reusedCache) {
        publishDownloadFile(tmpPath, finalPath);
        task.receivedBytes = task.totalBytes = cached.size;
        cached.lastUsed = Date.now();
      }
    }
    if (!reusedCache) await withMediaRecovery(vid, hongguoInfo?.series_id, { playInfo: checkedPlayInfo, quality, allowLowerQuality, force: true, cancelToken: source.token, forDownload: true }, async playInfo => {
      source.token.throwIfRequested();
      notifyQuality(Math.min(Number(playInfo.width), Number(playInfo.height)));
      task.progress = 0; task.receivedBytes = 0; task.totalBytes = 0; speedLastBytes.delete(id);
      sendToRenderer('download-progress', { id, progress: 0, receivedBytes: 0, totalBytes: 0 });
      if (playInfo.format === 'hls') {
        await prepareHlsFile(playInfo,tmpPath,{cancelToken:source.token,onProgress:received => { task.receivedBytes = received; trackDownloadSpeed(task, received); sendToRenderer('download-progress',{id,progress:0,receivedBytes:received,totalBytes:0}); }});
        task.actualQuality = await verifyReceived(tmpPath);
        source.token.throwIfRequested(); checkCustomAccess(vid);
        publishDownloadFile(tmpPath,finalPath);
        return;
      }
      const response = await requestMedia(playInfo, { cancelToken: source.token });
      source.token.throwIfRequested();
      const totalLength = Number(response.headers['content-length']) || 0;
      task.totalBytes = totalLength;
      writer = fs.createWriteStream(tmpPath); task.writer = writer;
      let received = 0, lastProgress = 0;
      response.data.on('data', chunk => {
        received += chunk.length; task.receivedBytes = received; trackDownloadSpeed(task, received);
        task.progress = totalLength ? Math.min(99, Math.floor(received / totalLength * 100)) : 0;
        if (Date.now() - lastProgress >= 150 || received === totalLength) {
          sendToRenderer('download-progress', { id, progress: task.progress, receivedBytes: received, totalBytes: totalLength });
          lastProgress = Date.now();
        }
      });
      // pipeline rejects on either side and destroys both streams (including abrupt CDN close).
      await pipeline(response.data, writer);
      source.token.throwIfRequested();
      if (!received || (totalLength && received !== totalLength)) throw mediaTransferError('Tải video không hoàn chỉnh, vui lòng thử lại');
      if (playInfo.contentKey) {
        const decodedPath = tmpPath + '.decoded';
        try {
          await decryptContentKeyFile(tmpPath, decodedPath, playInfo.contentKey, { cancelToken: source.token });
          task.actualQuality = await verifyReceived(decodedPath);
          source.token.throwIfRequested();
          publishDownloadFile(decodedPath, finalPath);
        } finally { try { fs.unlinkSync(decodedPath); } catch (_) {} }
        fs.unlinkSync(tmpPath);
      } else if (playInfo.spadeA) {
        const key = hongguo.deriveKey(playInfo.spadeA);
        if (!key) throw new Error('Phái sinh Key giải mã thất bại');
        // Decrypt to another temporary file; never expose partial data as a completed MP4.
        const decodedPath = tmpPath + '.decoded';
        try {
          await decryptInWorker({ srcPath: tmpPath, dstPath: decodedPath, key }, { cancelToken: source.token });
          task.actualQuality = await verifyReceived(decodedPath);
          source.token.throwIfRequested();
          publishDownloadFile(decodedPath, finalPath);
        }
        finally { try { fs.unlinkSync(decodedPath); } catch (_) {} }
        fs.unlinkSync(tmpPath);
      } else {
        task.actualQuality = await verifyReceived(tmpPath);
        source.token.throwIfRequested();
        publishDownloadFile(tmpPath, finalPath);
      }
    });
    await completeNasExports(task);
    source.token.throwIfRequested();
    task.status = 'completed'; task.progress = 100; task.endTime = Date.now(); delete task.sourceRetries;
    if (task.qualityNotice) task.qualityNotice = task.qualityNotice.replace('正在下载', '已下载').replace('Đang tải', 'Đã tải');
    saveDownloadTasks(); sendToRenderer('download-completed', { id, path: finalPath, actualQuality: task.actualQuality, qualityNotice: task.qualityNotice || '' });
  } catch (error) {
    if (writer && !writer.destroyed) writer.destroy();
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    task.qualityNotice = '';
    // A retry may already be queued; the cancelled old run must not overwrite it.
    if (source.token.reason || axios.isCancel(error) || task.cancelled) {
      if (task.status !== 'pending') {
        task.status = 'stopped'; task.error = ''; task.endTime = Date.now();
        sendToRenderer('download-stopped', { id, qualityNotice: '' });
      }
    } else {
      task.status = 'failed'; task.error = error.message; task.endTime = Date.now();
      sendToRenderer('download-failed', { id, error: task.error, retryAt: null, sourceRetries: 0, qualityNotice: '' });
    }
    saveDownloadTasks();
  } finally {
    if (task.cancelSource === source) delete task.cancelSource;
    if (task.writer === writer) delete task.writer;
  }
}

// Gửi sự kiện tới tiến trình kết xuất
function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ===== IPC: Phân tích Hồng Quả và tải hàng loạt =====
ipcMain.handle('hongguo-resolve', async (event, input) => {
  try {
    const seriesId = await hongguo.resolveSeriesId(input);
    const data = await hongguo.fetchEpisodeList(seriesId);
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Hongguo] Phân tích thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== Tìm kiếm: Trình duyệt nhúng nghe trộm hongguoduanju.com =====
const SEARCH_SITE = 'https://hongguoduanju.com';
const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SEARCH_TIMEOUT_MS = 15000;

function sourcePageUrl(value) {
  const url = new URL(value);
  if (url.origin !== SEARCH_SITE || url.username || url.password) throw new Error('Chỉ cho phép mở trang nguồn Hồng Quả');
  return url.href;
}

let searchWindow = null;
let sniffWindow = null;
let searchWindowReady = null;

function getSearchWindow(background = false) {
  const current = background ? sniffWindow : searchWindow;
  if (current && !current.isDestroyed()) return current;
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    show: false,
    title: 'Tìm kiếm - Phim Ngắn Hồng Quả',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Điều hướng nội bộ giữ trong cùng một cửa sổ, tránh bật ra cửa sổ mới
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { win.loadURL(sourcePageUrl(url)).catch(() => {}); } catch (_) {}
    return { action: 'deny' };
  });
  for (const name of ['will-navigate', 'will-redirect']) {
    win.webContents.on(name, (event, url) => {
      try { sourcePageUrl(url); } catch (_) { event.preventDefault(); }
    });
  }
  win.on('closed', () => {
    if (searchWindow === win) searchWindow = null;
    if (sniffWindow === win) sniffWindow = null;
  });
  if (background) sniffWindow = win;
  else searchWindow = win;
  return win;
}

/**
 * Kịch bản trích xuất thẻ chung (dùng chung cho trang thể loại / trang tìm kiếm).
 * Chỉ phụ thuộc series_id trong liên kết (không phụ thuộc tên lớp hash), tên phim ưu tiên lấy img[alt],
 * nhờ vậy khi trang web thay đổi giao diện sẽ khó bị hỏng hơn.
 */
const SNIFFER_JS = `(() => {
  const out = [];
  const seen = new Set();
  const links = Array.from(document.querySelectorAll('a')).filter((a) =>
    /series_id=\\d{6,}/.test(a.getAttribute('href') || '')
  );
  for (const a of links) {
    const m = (a.getAttribute('href') || '').match(/series_id=(\\d{6,})/);
    if (!m) continue;
    const sid = m[1];
    if (seen.has(sid)) continue;
    seen.add(sid);

    const img = a.querySelector('img');
    let title = (img && img.getAttribute('alt')) || '';
    if (!title) {
      const t = a.querySelector('[class*="title"]');
      title = (t ? t.textContent : a.textContent || '').trim();
    }

    // Ảnh bìa: Ưu tiên picture>source[srcset] (trang thể loại dùng picture), dự phòng img[src]
    let cover = '';
    const pic = a.querySelector('picture');
    if (pic) {
      const src = pic.querySelector('source[srcset]');
      if (src) cover = (src.getAttribute('srcset') || '').split(' ')[0];
    }
    if (!cover && img) cover = img.getAttribute('src') || img.getAttribute('data-src') || '';

    // Tổng số tập: "Toàn bộ 86 tập"
    let episode_count = 0;
    const epEl = a.querySelector('[class*="episode"]');
    if (epEl) {
      const em = (epEl.textContent || '').match(/(\\d+)\\s*集/);
      if (em) episode_count = parseInt(em[1], 10);
    }

    // Thẻ phân loại
    const tags = Array.from(a.querySelectorAll('[class*="tag-text"]'))
      .map((e) => (e.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 4);

    out.push({
      series_id: sid,
      series_title: title.trim(),
      cover: cover,
      episode_count: episode_count,
      tags: tags,
    });
  }
  return JSON.stringify(out);
})()`;

/**
 * Thông tin bổ sung trang thể loại: Dữ liệu phân trang + các mục lọc thể loại khả dụng.
 * Thể loại được trích xuất từ liên kết /category/<cat>/<genre> trong trang, tránh hardcode.
 */
const BROWSE_META_JS = `(() => {
  const out = { page: 1, totalPages: 0, total: 0, genres: [] };

  // 1) Ưu tiên đọc dữ liệu phân trang nhúng sẵn trong trang
  try {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"pagination":\\s*\\{[^}]*"total":(\\d+)[^}]*"pageNum":(\\d+)[^}]*"pageSize":(\\d+)[^}]*"totalPages":(\\d+)/);
    if (m) {
      out.total = parseInt(m[1], 10);
      out.page = parseInt(m[2], 10);
      out.totalPages = parseInt(m[4], 10);
    }
  } catch (e) {}

  // 2) Dự phòng: Suy tính tổng số trang từ liên kết phân trang
  if (!out.totalPages) {
    let maxPage = 0;
    document.querySelectorAll('a[href*="page="]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/[?&]page=(\\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
    });
    out.totalPages = maxPage;
  }

  // 3) Mục lọc thể loại: /category/<cat>/<genre>
  const seen = new Set();
  document.querySelectorAll('a[href*="/category/"]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/category\\/[a-z0-9\\-]+\\/([a-z0-9\\-]+)/);
    if (!m) return;
    const slug = m[1];
    const label = (a.textContent || '').trim();
    if (!label || label.length > 8 || seen.has(slug)) return;
    seen.add(slug);
    out.genres.push({ slug: slug, label: label });
  });

  return JSON.stringify(out);
})()`;

/** Cửa sổ tìm kiếm ẩn thực hiện trinh sát tuần tự; toàn bộ tác vụ (bao gồm tải và đọc) dùng chung thời gian chờ. */
async function runSniffOnUrl(url, label, { deadline = 0 } = {}) {
  // Thực thi tuần tự trên cùng một cửa sổ, tránh việc điều hướng đồng thời làm gián đoạn lẫn nhau
  const task = async () => {
    const budget = deadline > 0 ? Math.min(SEARCH_TIMEOUT_MS, deadline - Date.now()) : SEARCH_TIMEOUT_MS;
    if (budget <= 0) throw new Error('Tìm kiếm quá thời gian, vui lòng thử lại sau');
    const win = getSearchWindow(true);
    // Reserve the last part of the deadline for empty-page details.
    const pollDeadline = Date.now() + budget * 0.9;
    let expired = false;
    const timeoutError = new Error('Tìm kiếm quá thời gian, vui lòng thử lại sau');
    const assertActive = () => {
      if (expired) throw timeoutError;
      if (win.isDestroyed()) throw new Error('Cửa sổ tìm kiếm đã đóng, vui lòng thử lại');
    };
    const evaluate = async script => {
      assertActive();
      const value = await win.webContents.executeJavaScript(script, true);
      assertActive();
      return value;
    };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        if (!win.isDestroyed()) win.destroy();
        reject(timeoutError);
      }, budget);
    });
    const sniff = async () => {
      console.log(`[${label}] Mở:`, url);
      try {
        await win.loadURL(url, { userAgent: SEARCH_UA });
      } catch (e) {
        // loadURL có thể bị reject khi trong trang có chuyển hướng/ngắt kết nối, tại đây tiếp tục thử đọc DOM
        console.warn(`[${label}] loadURL trả về bất thường (tiếp tục thử đọc):`, e.message);
      }
      assertActive();

      let last = [];
      const startedAt = Date.now();
      let reloaded = false;
      while (true) {
        assertActive();
        try {
          const raw = await evaluate(SNIFFER_JS);
          last = JSON.parse(raw || '[]');
        } catch (e) {
          assertActive();
          last = [];
        }
        const now = Date.now();
        if (last.length > 0 || now >= pollDeadline) break;
        // Trang web thỉnh thoảng trả về "Tải thất bại, vui lòng làm mới trang thử lại"; tự động làm mới một lần hữu ích hơn việc chờ hết giờ.
        if (!reloaded && now - startedAt >= 4000) {
          let failed = false;
          try {
            failed = (await evaluate(`/加载失败|请刷新页面重试/.test(document.body.innerText || '')`)) === true;
          } catch (_) { failed = false; }
          if (failed) {
            reloaded = true;
            console.log(`[${label}] Tải trang thất bại, tự động làm mới một lần`);
            try { await win.loadURL(url, { userAgent: SEARCH_UA }); } catch (_) { /* Tiếp tục thử đọc */ }
            assertActive();
            continue;
          }
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      let meta = { page: 1, totalPages: 0, total: 0, genres: [] };
      try {
        meta = JSON.parse((await evaluate(BROWSE_META_JS)) || '{}');
      } catch (_) {}
      assertActive();

      if (!last.length) {
        let pageTitle = '';
        try { pageTitle = await evaluate('document.title'); } catch (_) {}
        assertActive();
        let pageFailed = false;
        try {
          pageFailed = (await evaluate('(() => /加载失败|请刷新页面重试/.test(document.body ? document.body.innerText : ""))()')) === true;
        } catch (_) { pageFailed = false; }
        assertActive();
        // Khi trang báo lỗi rõ ràng thì không được coi là "thực sự không có kết quả", nếu không tìm kiếm thất bại sẽ bị nói là không tìm thấy.
        if (pageFailed) return { success: false, results: [], pageTitle, meta, error: 'Trang tìm kiếm Hồng Quả tải thất bại, vui lòng thử lại sau' };
        return { success: true, results: [], pageTitle, meta };
      }

      const results = last
        .filter((r) => r.series_id && r.series_title)
        .map((r) => ({
          ...r,
          url: `${SEARCH_SITE}/detail?series_id=${r.series_id}`,
        }));

      console.log(`[${label}] Khớp ${results.length} phim`);
      return { success: true, results, meta };
    };
    try { return await Promise.race([sniff(), timeout]); }
    finally { clearTimeout(timer); }
  };

  // Tuần tự hóa; deadline đồng thời bao quát cả thời gian xếp hàng, tránh việc sau khi xếp hàng lại nhận thêm 15 giây đầy đủ.
  const prev = searchWindowReady || Promise.resolve();
  const queued = prev.then(task, task);
  searchWindowReady = queued.catch(() => {});
  if (!deadline) return queued;
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    queued.catch(() => {});
    throw new Error('Tìm kiếm quá thời gian, vui lòng thử lại sau');
  }
  let guardTimer;
  const guard = new Promise((_, reject) => {
    guardTimer = setTimeout(() => reject(new Error('Tìm kiếm quá thời gian, vui lòng thử lại sau')), remaining);
  });
  try { return await Promise.race([queued, guard]); }
  finally { clearTimeout(guardTimer); }
}

async function runSearchSniff(keyword, options = {}) {
  return runSniffOnUrl(`${SEARCH_SITE}/search/${encodeURIComponent(keyword)}`, 'Search', { deadline: options.deadline || 0 });
}

// ===== Duyệt: Trang thể loại (bao gồm lọc chủ đề và phân trang) =====
const BROWSE_CATEGORIES = [
  { slug: 'real-drama', label: 'Phim người thật đóng' },
  { slug: 'comic-drama', label: 'Truyện tranh động (Anime)' },
  { slug: 'ai-drama', label: 'Phim AI' },
  { slug: 'comic', label: 'Truyện tranh' },
  { slug: 'hot-drama', label: 'BXH Thịnh hành', group: 'rank' },
  { slug: 'hot-real-drama', label: 'BXH Người thật đóng', group: 'rank' },
  { slug: 'hot-comic-drama', label: 'BXH Truyện tranh động', group: 'rank' },
  { slug: 'hot-ai-drama', label: 'BXH Phim AI', group: 'rank' },
];

ipcMain.handle('browse-categories', async () => BROWSE_CATEGORIES);

async function invalidateCustomSource(id) {
  require('./src/native/custom-source').cancelRequests(id);
  const prefix = `custom:${id}:`;
  for (const [streamId, session] of [...onlineSessions]) if (session.vid.startsWith(prefix)) releaseOnlineSession(streamId);
  for (const [key, job] of [...onlinePreparing]) if (key.startsWith(prefix)) { job.controller.abort(); onlinePreparing.delete(key); }
  for (const key of [...onlineCache.keys()]) if (key.startsWith(prefix)) deleteOnlineCacheEntry(key);
  for (const job of compatPreparing.values()) if (job.sourceVid.startsWith(prefix)) cancelCompatJob(job);
  await Promise.all(downloadTasks.filter(task => String(task.hongguoInfo?.vid).startsWith(prefix) && isTaskInFlight(task)).map(task => stopTaskAndWait(task).catch(() => {})));
  try { saveDownloadTasks(); } catch (_) { /* storage-error already reports task persistence independently. */ }
}
ipcMain.handle('get-custom-sources', async () => ({success:true,sources:getCurrentSettings().custom_sources || []}));
ipcMain.handle('get-media-sources', async () => ({ success: true, sources: require('./src/native/media-sources').getMediaSources(getCurrentSettings()) }));
ipcMain.handle('set-builtin-source-enabled', async (_event, id, enabled) => {
  try {
    store.saveSettings(require('./src/native/media-sources').setBuiltinSourceEnabled(getCurrentSettings(), id, enabled));
    for (const win of new Set([mainWindow, ...BrowserWindow.getAllWindows()])) {
      if (win?.webContents && !win.webContents.isDestroyed()) win.webContents.send('media-sources-changed');
    }
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('save-custom-source', async (_event,draft) => {
  try {
    const source = require('./src/native/custom-source').validateSource(draft);
    const settings = getCurrentSettings(), sources = settings.custom_sources || [];
    if (source.id && !sources.some(item => item.id === source.id)) throw new Error('Nguồn phát không tồn tại');
    source.id ||= randomUUID();
    const next = sources.some(item => item.id === source.id) ? sources.map(item => item.id === source.id ? source : item) : [...sources,source];
    store.saveSettings({...settings,custom_sources:next});
    await invalidateCustomSource(source.id);
    return {success:true,source};
  } catch (error) { return {success:false,error:error.message}; }
});
ipcMain.handle('delete-custom-source', async (_event,id) => {
  try {
    const settings = getCurrentSettings();
    if (!(settings.custom_sources || []).some(source => source.id === id)) throw new Error('Nguồn phát không tồn tại');
    store.saveSettings({...settings,custom_sources:settings.custom_sources.filter(source => source.id !== id)});
    await invalidateCustomSource(id); return {success:true};
  } catch (error) { return {success:false,error:error.message}; }
});
ipcMain.handle('test-custom-source', async (_event,draft) => {
  try { return await require('./src/native/custom-source').testCustomSource(draft); }
  catch (error) { return {success:false,error:error.message}; }
});


ipcMain.handle('browse-list', async (_event, options) => {
  if (['xifan', 'hema'].includes(options?.source) && getCurrentSettings().builtin_sources?.[options.source] === false) return { success: false, results: [], error: 'Nguồn này đã tắt, có thể bật lại trong Cài đặt' };
  if (proxyStartupFallback) return { success: false, error: 'Cấu hình proxy mạng không hợp lệ, vui lòng sửa hoặc tắt hẳn proxy trong Cài đặt.' };
  if ((!options?.source || options.source === 'hongguo') && options?.catalogChannel != null
    && !['app', 'web'].includes(options.catalogChannel)) return { success: false, error: 'Tuyến danh mục Hồng Quả không được hỗ trợ' };
  const moduleName = String(options?.source).startsWith('custom:') ? './src/native/custom-source' : options?.source === 'hema' ? './src/native/hema'
    : options?.source === 'xifan' ? './src/native/xifan'
      : options?.catalogChannel === 'web' ? './src/native/catalog' : './src/native/hongguo-app-catalog';
  const catalogOptions = moduleName === './src/native/catalog'
    ? { ...options, allowTrustedDns: resolveProxyConfig(getCurrentSettings()).mode === 'direct' } : options;
  return require(moduleName).browseList(catalogOptions, (authInfo, callback) => {
    if (matchesProxyAuth(authInfo)) callback(activeProxyAuth.username, activeProxyAuth.password);
    else callback();
  });
});

const normalizeSearchTitle = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** Khi dấu câu/khoảng trắng khiến tên gốc không tìm được, cung cấp tối đa hai từ khóa bổ sung đã xóa dấu câu hoặc lấy đoạn đầu. */
function relaxedHongguoQueries(keyword) {
  const text = String(keyword || '').normalize('NFKC').trim();
  const stripped = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  const candidates = [];
  if (stripped && stripped !== text) candidates.push(stripped);
  const firstClause = text.split(/[\s\p{P}\p{S}]+/u).map(part => part.trim()).find(part => part.length >= 2);
  if (firstClause && firstClause !== text && !candidates.includes(firstClause)) candidates.push(firstClause);
  return candidates.slice(0, 2);
}

let appSearchCooldownUntil = 0;
const APP_SEARCH_COOLDOWN_MS = 2 * 60 * 1000;
let newReleaseCooldownUntil = 0;
const NEW_RELEASE_COOLDOWN_MS = 30 * 1000;
let proxyStartupFallback = false;

/**
 * Khi tìm kiếm trang web chính thức không có tiêu đề khớp, sử dụng danh sách "Mới ra mắt trong 7 ngày" của App để tìm bổ sung.
 * Chỉ áp dụng cho trang đầu tiên, và thất bại không ảnh hưởng đến kết quả web; kết quả thành công sẽ có gắn cờ new_release.
 */
async function searchNewReleasesForSearch(keyword, options = {}) {
  const { deadline } = options || {};
  // Tìm kiếm bằng 1 chữ/chỉ có dấu câu không thể khớp tiêu đề hiệu quả trong danh sách phim mới, và cũng không đáng gọi thêm 2 lần API App.
  const normalized = String(keyword || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
  if (normalized.length < 2) return { results: [], checked: false, error: '' };
  if (Date.now() < newReleaseCooldownUntil) {
    return { results: [], partial: false, checked: false, error: 'Tìm kiếm bổ sung phim mới trên App tạm thời không khả dụng, vui lòng thử lại sau' };
  }
  const budget = Number(deadline) || 0;
  if (!budget || budget - Date.now() < 900) return { results: [], checked: false, error: '' };
  try {
    const module = require('./src/native/hongguo-app-new');
    const detailed = await module.searchNewReleasesDetailed(keyword, {
      deadline: Math.min(budget, Date.now() + 8000),
    });
    if (detailed?.partial && !detailed?.results?.length) newReleaseCooldownUntil = Date.now() + NEW_RELEASE_COOLDOWN_MS;
    else newReleaseCooldownUntil = 0;
    return {
      results: Array.isArray(detailed?.results) ? detailed.results : [],
      partial: detailed?.partial === true,
      checked: true,
      error: detailed?.partial ? 'Danh mục mới App chỉ đọc được một phần thể loại' : '',
    };
  } catch (error) {
    newReleaseCooldownUntil = Date.now() + NEW_RELEASE_COOLDOWN_MS;
    console.warn('[Search] Tìm kiếm bổ sung phim mới trên App thất bại:', error?.message || error);
    return { results: [], checked: true, error: error?.message || 'Tìm kiếm bổ sung phim mới trên App thất bại' };
  }
}

function mergeNewReleases(results, extras) {
  const map = new Map((results || []).map(item => [String(item.series_id), item]));
  for (const extra of extras) {
    if (!extra?.series_id) continue;
    const id = String(extra.series_id);
    const existing = map.get(id);
    if (existing) {
      map.set(id, { ...extra, ...existing, new_release: true,
        ...(extra.released_today ? { released_today: true } : {}) });
    } else {
      map.set(id, extra);
    }
  }
  return [...map.values()];
}

async function searchAtSource(keyword, options = {}) {
  const page = options.page === undefined ? 1 : options.page;
  if (!Number.isSafeInteger(page) || page < 1 || page > 50) throw new Error('Số trang tìm kiếm phải là số nguyên từ 1 đến 50');
  const source = options.source || 'hongguo';
  if (['xifan', 'hema'].includes(source) && getCurrentSettings().builtin_sources?.[source] === false) throw new Error('Nguồn này đã tắt, có thể bật lại trong Cài đặt');
  if (page > 1 && source !== 'hongguo' && options.channel && options.channel !== source) throw new Error('Kênh tìm kiếm đã thay đổi, vui lòng tìm kiếm lại');
  const response = await searchAtSourcePage(keyword, { ...options, page });
  if (!response?.success) return response;
  const hasMore = response.hasMore === true && page < 50;
  return { ...response, channel: response.channel || source, page, hasMore,
    nextPage: hasMore ? page + 1 : null, cursor: response.cursor || null,
    meta: { ...(response.meta || {}), page, hasMore } };
}

async function searchAtSourcePage(keyword, options = {}) {
  const deadline = Number(options?.deadline) || 0;
  if (String(options?.source).startsWith('custom:')) return require('./src/native/custom-source').searchSeries(keyword, options);
  if (options?.source === 'hema') return require('./src/native/hema').search(keyword, options.page, { deadline });
  if (options?.source === 'xifan') return require('./src/native/xifan').search(keyword, options.page, { deadline });
  if (options?.source && options.source !== 'hongguo') throw new Error('Nguồn tìm kiếm không được hỗ trợ');
  const page = options.page;
  const searchQuery = normalizeSearchTitle(keyword);
  const reserveNewRelease = page === 1 && options?.fuzzy !== false && searchQuery.length >= 2;
  const officialDeadline = reserveNewRelease && deadline
    ? Math.min(deadline, Date.now() + 12000)
    : deadline;
  const requestOptions = deadline ? { deadline } : undefined;
  const officialRequestOptions = officialDeadline ? { deadline: officialDeadline } : undefined;
  const hasTitleMatch = items => !!searchQuery && items.some(item => normalizeSearchTitle(item.series_title).includes(searchQuery));
  const hasExactTitleMatch = items => !!searchQuery && items.some(item => normalizeSearchTitle(item.series_title) === searchQuery);
  // Từ trang 2 trở đi phải cố định kênh đã chọn ở trang 1, không được đổi nguồn giữa chừng gây trùng lặp/sót kết quả.
  if (page > 1) {
    if (options?.channel === 'app') {
      try {
        const result = await require('./src/native/hongguo-app-search').searchApp(keyword, { page, cursor: options.cursor || null, deadline });
        appSearchCooldownUntil = 0;
        return { ...result, via: 'app', meta: { total: result.results.length, page, hasMore: result.hasMore, relaxed: false } };
      } catch (error) {
        appSearchCooldownUntil = Date.now() + APP_SEARCH_COOLDOWN_MS;
        throw error;
      }
    }
    if (options?.channel === 'web') {
      const response = await searchHongguo(keyword, { ...requestOptions, page });
      return { ...response, success: true, via: 'api', channel: 'web', page, cursor: { page, nextPage: response.nextPage || null }, hasMore: !!response.hasMore, meta: { total: response.total, page, totalPages: response.totalPages, hasMore: !!response.hasMore, relaxed: false } };
    }
    throw new Error('Kênh tìm kiếm này không hỗ trợ tải thêm, vui lòng tìm kiếm lại');
  }
  const appEnabled = (options?.appSearch === true || (options?.appSearch !== false && getCurrentSettings().search_app_enabled === true))
    && Date.now() >= appSearchCooldownUntil;
  let appFallbackError = '';
  if (appEnabled) {
    try {
      const appDeadline = Math.min(deadline || Date.now() + 8000, Date.now() + 8000);
      const app = await require('./src/native/hongguo-app-search').searchApp(keyword, { page: 1, deadline: appDeadline });
      if (app.results.length && hasTitleMatch(app.results)) {
        appSearchCooldownUntil = 0;
        return { ...app, via: 'app', pageTitle: '', meta: { total: app.results.length, page: 1, hasMore: app.hasMore, relaxed: false } };
      }
      appSearchCooldownUntil = 0;
      appFallbackError = app.results.length ? 'Tìm kiếm App không có tiêu đề phù hợp' : 'Tìm kiếm App không trả về kết quả';
    } catch (error) {
      appSearchCooldownUntil = Date.now() + APP_SEARCH_COOLDOWN_MS;
      appFallbackError = error.message || 'Tìm kiếm App không khả dụng';
      console.warn('[Search] Tìm kiếm App Hồng Quả thất bại, quay về trang web:', appFallbackError);
    }
  }
  // Kết quả trang tìm kiếm web được frontend yêu cầu /api/search/result rồi kết xuất; gọi trực tiếp API
  // để tránh đợi vô ích tới 15 giây khi tải trang thất bại. Chỉ khi cấu trúc API thay đổi mới quay về sniffing trang.
  try {
    const response = await searchHongguo(keyword, officialRequestOptions);
    let results = response.results;
    const attempted = [], fuzzyErrors = [];
    if (options?.fuzzy !== false && !hasTitleMatch(results)) {
      // Khi dấu câu/khoảng trắng khiến nguồn không tìm được tên gốc, trước tiên thử lại với tên đầy đủ bỏ dấu câu, sau đó thử đoạn đầu;
      // dừng lại khi khớp tiêu đề hoàn chỉnh hoặc cả hai lần đều thất bại, tối đa 2 yêu cầu bổ sung.
      for (const relaxed of relaxedHongguoQueries(keyword)) {
        if (deadline && Date.now() >= deadline) { fuzzyErrors.push('Thời gian tìm kiếm đã hết'); break; }
        try {
          const extra = await searchHongguo(relaxed, officialRequestOptions);
          const merged = new Map(results.map(item => [String(item.series_id), item]));
          for (const item of extra.results) {
            const id = String(item.series_id);
            if (!merged.has(id)) merged.set(id, { ...item, fuzzy: true, fuzzy_query: relaxed });
          }
          results = [...merged.values()];
          attempted.push(relaxed);
          if (hasTitleMatch(results)) break;
        } catch (error) {
          fuzzyErrors.push(error.message || 'Tìm kiếm bổ sung thất bại');
          console.warn('[Search] Tìm kiếm mờ Hồng Quả thất bại:', error.message);
        }
      }
    }
    // Khi trang web không có tiêu đề khớp (thường gặp khi phim mới ra mắt trong ngày, chỉ mục tìm kiếm chưa đồng bộ), dùng danh sách mới ra mắt của App để tìm bổ sung.
    // Tên phim còn cần loại trừ che khuất kiểu "tên phim cũ chứa tên phim mới", ví dụ tìm "接班" chỉ trả về "接班人的考题".
    // Any non-exact result can be an older title that merely contains the query.
    // For longer titles, a "contains" match previously suppressed the new-release
    // lookup even when the exact new drama existed.
    const needsNewRelease = searchQuery.length >= 2 && !hasExactTitleMatch(results);
    let newRelease = { results: [], checked: false, error: '' };
    if (options?.fuzzy !== false && needsNewRelease) {
      // When the website already has usable results, give the App supplement a
      // short additive budget instead of blocking the whole search for 8 seconds.
      const supplementDeadline = results.length
        ? Math.min(deadline || Date.now() + 2500, Date.now() + 2500)
        : deadline;
      newRelease = await searchNewReleasesForSearch(keyword, { deadline: supplementDeadline });
      if (newRelease.results.length) results = mergeNewReleases(results, newRelease.results);
    }
    const relaxedQuery = attempted.join('、');
    const meta = {
      total: response.total,
      page: response.page,
      totalPages: response.totalPages,
      hasMore: response.hasMore,
      relaxed: attempted.length > 0,
      relaxedQuery,
      newRelease: newRelease.results.length,
      newReleaseChecked: newRelease.checked,
      newReleasePartial: newRelease.partial === true,
      ...(newRelease.error ? { newReleaseError: newRelease.error } : {}),
    };
    const webMeta = { ...meta, channel: 'web', cursor: { page: response.page, nextPage: response.nextPage || null }, hasMore: !!response.hasMore };
    const supplementalErrors = [
      ...fuzzyErrors,
      ...(newRelease.error || (newRelease.checked && newRelease.partial)
        ? [newRelease.error || 'Danh mục mới App chỉ đọc được một phần thể loại'] : []),
    ];
    if (supplementalErrors.length && !results.length) {
      // Từ gốc và từ tìm bổ sung đều không có kết quả, không thể coi lỗi dịch vụ là "không tìm thấy".
      return { success: false, results: [], via: 'api', channel: 'web', partial: true,
        error: `Tìm kiếm chưa hoàn thành: ${[...new Set(supplementalErrors)].join('; ')}`, meta: webMeta, appError: appFallbackError };
    }
    if (supplementalErrors.length) {
      return { success: true, results, pageTitle: '', via: 'api', channel: 'web', partial: true,
        error: `Tìm kiếm bổ sung chưa hoàn thành: ${[...new Set(supplementalErrors)].join('; ')}`, meta: webMeta,
        hasMore: !!response.hasMore, cursor: { page: response.page, nextPage: response.nextPage || null }, appError: appFallbackError };
    }
    return { success: true, results, pageTitle: '', via: 'api', channel: 'web', meta: webMeta, hasMore: !!response.hasMore, cursor: { page: response.page, nextPage: response.nextPage || null }, appError: appFallbackError };
  } catch (error) {
    const message = error?.message || String(error || 'Tìm kiếm thất bại');
    console.warn('[Search] Giao diện Hồng Quả thất bại:', message);
    if (!appEnabled && options?.appSearch !== false && Date.now() >= appSearchCooldownUntil
      && error?.kind !== 'input' && (!deadline || deadline - Date.now() >= 1000)) {
      try {
        const appDeadline = Math.min(deadline || Date.now() + 8000, Date.now() + 8000);
        const app = await require('./src/native/hongguo-app-search').searchApp(keyword, { page: 1, deadline: appDeadline });
        appSearchCooldownUntil = 0;
        if (app.results.length) {
          return { ...app, via: 'app', pageTitle: '', partial: true,
            error: `Tìm kiếm trang web chưa hoàn thành: ${message}; Đã tự động chuyển sang tìm kiếm App`, apiError: message,
            meta: { total: app.results.length, page: 1, hasMore: app.hasMore, relaxed: false } };
        }
        appFallbackError = 'Tìm kiếm App không trả về kết quả';
      } catch (appError) {
        appSearchCooldownUntil = Date.now() + APP_SEARCH_COOLDOWN_MS;
        appFallbackError = appError?.message || 'Tìm kiếm App không khả dụng';
        console.warn('[Search] Tìm kiếm App sau khi trang web thất bại cũng chưa hoàn thành:', appFallbackError);
      }
    }
    // Khi API gặp lỗi 5xx/thay đổi cấu trúc, danh sách mới của App vẫn có thể khả dụng, bổ sung được phim mới trong ngày thì không cần chỉ báo lỗi hoặc chờ sniffing trang.
    if (page === 1 && options?.fuzzy !== false && searchQuery.length >= 2) {
      const newRelease = await searchNewReleasesForSearch(keyword, { deadline });
      const newReleaseIssue = newRelease.error || (newRelease.partial ? 'Danh mục mới App chỉ đọc được một phần thể loại' : '');
      if (newRelease.results.length) {
        return { success: true, results: newRelease.results, pageTitle: '', via: 'app-new', channel: 'app-new', page: 1,
          total: newRelease.results.length, totalPages: 0, hasMore: false, nextPage: null, cursor: null, partial: true,
          error: `Tìm kiếm trang web chưa hoàn thành: ${message}; Đã hiển thị kết quả bổ sung từ App${newReleaseIssue ? `; Tìm kiếm bổ sung App chưa hoàn thành: ${newReleaseIssue}` : ''}`,
          meta: { total: newRelease.results.length, page: 1, totalPages: 0, hasMore: false, relaxed: false,
            newRelease: newRelease.results.length, newReleaseChecked: true, newReleasePartial: newRelease.partial === true,
            ...(newReleaseIssue ? { newReleaseError: newReleaseIssue } : {}) },
          apiError: message, appError: appFallbackError };
      }
      if (newRelease.checked && newReleaseIssue) {
        return { success: false, results: [], via: 'app-new', channel: 'app-new', page: 1, partial: true,
          error: `Tìm kiếm trang web chưa hoàn thành: ${message}; Tìm kiếm bổ sung App chưa hoàn thành: ${newReleaseIssue}`,
          meta: { total: 0, page: 1, totalPages: 0, hasMore: false, relaxed: false,
            newRelease: 0, newReleaseChecked: true, newReleasePartial: newRelease.partial === true,
            newReleaseError: newReleaseIssue },
          apiError: message, appError: appFallbackError };
      }
    }
    if (error.fallback !== true) throw error;
    if (deadline && Date.now() >= deadline) {
      return { success: false, results: [], via: 'dom', partial: true, error: 'Tìm kiếm quá thời gian, dự phòng trang web chưa bắt đầu', apiError: error.message };
    }
    try {
      const sniffed = await runSearchSniff(keyword, { deadline });
      return { ...sniffed, via: 'dom', channel: 'dom', hasMore: false, cursor: null, apiError: error.message, appError: appFallbackError };
    } catch (fallbackError) {
      console.warn('[Search] Dự phòng trang web thất bại:', fallbackError.message);
      return { success: false, results: [], via: 'dom', partial: true, error: `Tìm kiếm chưa hoàn thành: ${fallbackError.message}`, apiError: error.message };
    }
  }
}

ipcMain.handle('search-series', async (event, keyword, options = {}) => {
  try {
    const deadline = Date.now() + 20000;
    return await seriesSearch.searchSeries(keyword, (kw, call) => searchAtSource(kw, { ...options, deadline, ...(call || {}) }), [], { deadline });
  } catch (error) {
    console.error('[Search] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-series-more', async (event, keyword, options = {}) => {
  try {
    if (!Number.isSafeInteger(options?.page) || options.page < 2 || options.page > 50) throw new Error('Số trang tải thêm phải là số nguyên từ 2 đến 50');
    const deadline = Date.now() + 12000;
    return await searchAtSource(keyword, { ...options, deadline, fuzzy: false });
  } catch (error) {
    return { success: false, results: [], error: error.message, channel: options?.channel || '', cursor: options?.cursor || null };
  }
});

ipcMain.handle('find-series-sequels', async (_event, seriesId, options = {}) => {
  let entry = seriesRegistry.find(item => String(item.series_id) === String(seriesId));
  if (!entry) {
    const title = options?.series_title || options?.title;
    if (title && String(seriesId)) {
      entry = {
        series_id: String(seriesId),
        series_title: String(title),
        cover: options?.cover || '',
        episodes: []
      };
    } else if (String(seriesId) && /^\d{6,30}$/.test(String(seriesId))) {
      try {
        const data = await hongguo.fetchEpisodeList(String(seriesId));
        if (data && data.series_id) {
          upsertSeriesRegistry(data);
          entry = seriesRegistry.find(item => String(item.series_id) === String(seriesId));
        }
      } catch (_) {}
    }
  }
  if (!entry) return { success: false, results: [], error: 'Không tìm thấy hồ sơ phim này, vui lòng mở chi tiết phim trước.' };
  const deadline = Date.now() + 22000;
  return seriesSearch.findSeriesSequels(entry, seriesRegistry.filter(item => !item.forgotten),
    (kw, call) => searchAtSource(kw, { source: watchHistory.sourceOf(String(entry.series_id)), deadline, ...(call || {}) }),
    { localOnly: options?.localOnly === true, deadline });
});

// Sau khi chọn một bộ phim từ kết quả tìm kiếm, tải danh sách tập đầy đủ và đăng ký hồ sơ
ipcMain.handle('search-resolve', async (event, seriesId) => {
  try {
    if (!seriesId) return { success: false, error: 'Thiếu series_id' };
    const data = await hongguo.fetchEpisodeList(String(seriesId));
    upsertSeriesRegistry(data);
    return { success: true, data };
  } catch (error) {
    console.error('[Search] Lấy tập phim thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Hiển thị cửa sổ tìm kiếm (phương án dự phòng khi quá thời gian: để người dùng tự thao tác)
ipcMain.handle('search-window-show', async (event, visible, sourceUrl) => {
  let target;
  try { if (sourceUrl) target = sourcePageUrl(sourceUrl); }
  catch (error) { return { success: false, error: error.message }; }
  const win = getSearchWindow();
  if (target) {
    try { await win.loadURL(target, { userAgent: SEARCH_UA }); }
    catch (error) { return { success: false, error: error.message }; }
  }
  if (visible) {
    win.show();
    win.focus();
  } else {
    win.hide();
  }
  return { success: true };
});

// Hồ sơ phim ngắn đã đăng ký (không bao gồm các phim người dùng đã xóa)
ipcMain.handle('get-series-list', async (event, options) => {
  const list = visibleSeries();
  // Ứng viên ghép tập và ghép tập thực tế dùng chung kiểm tra đĩa, không thể coi hồ sơ phát trực tuyến là đã tải xuống.
  return options?.downloadedOnly === true
    ? list.filter(series => collectSeriesEpisodeFiles(series.series_id, series.series_title).ordered.length > 0)
    : list;
});

/** Xóa một bộ phim ngắn khỏi danh sách (chỉ hủy đăng ký, không xóa tệp cục bộ) */
ipcMain.handle('remove-series', async (event, seriesId) => {
  const sid = String(seriesId);
  const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
  if (!entry) return { success: false, error: 'Không tìm thấy phim này' };
  entry.dismissed = true;
  saveSeriesRegistry();
  return { success: true };
});

/** Giữ lại chỉ mục phát và tệp, chỉ xóa vĩnh viễn khỏi danh sách có thể khôi phục. */
ipcMain.handle('forget-series', async (_event, seriesId, options = {}) => {
  try {
    const sid = String(seriesId);
    if (!seriesRegistry.some(entry => String(entry.series_id) === sid)) return { success: false, error: 'Không tìm thấy phim này' };
    if (options.clearCache === true) await clearSeriesPlaybackCache(sid);
    const next = seriesRegistry.map(entry => String(entry.series_id) === sid ? { ...entry, dismissed: true, forgotten: true } : entry);
    store.saveSeries(next);
    seriesRegistry = next;
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

/** Xóa hàng loạt phim ngắn chưa từng tải tập nào (dọn dẹp các hồ sơ rỗng tạo ra khi duyệt phim) */
ipcMain.handle('purge-empty-series', async () => {
  let removed = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed) continue;
    const files = collectSeriesEpisodeFiles(s.series_id, s.series_title);
    const hasDiskFile = [...files.episodePaths, ...files.mergedPaths].some(file => {
      try { return fs.statSync(file).size > 1024 * 100; } catch (_) { return false; }
    });
    if (!hasDiskFile && !files.scanFailed) {
      s.dismissed = true;
      removed++;
    }
  }
  if (removed > 0) saveSeriesRegistry();
  return { success: true, count: removed };
});

/**
 * Bổ sung lại bản ghi tác vụ tải xuống từ đĩa.
 * Dùng cho trường hợp bản ghi tác vụ bị mất / bị dọn sạch, hoặc các bản trước tải trực tiếp mà chưa đăng ký —
 * Chỉ cần trên đĩa có tệp và trong hồ sơ phim có số tập tương ứng, thì đăng ký lại thành "đã hoàn thành".
 */
function rescanDownloadsFromDisk() {
  let added = 0;
  for (const s of seriesRegistry) {
    const sid = String(s.series_id);
    let scanned;
    try {
      scanned = collectSeriesEpisodeFiles(sid, s.series_title);
    } catch (_) {
      continue;
    }
    if (!scanned.dir || !scanned.ordered.length) continue;

    const existing = new Set(
      downloadTasks
        .filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid)
        .map((t) => Number(t.hongguoInfo.vid_index))
    );

    for (const f of scanned.ordered) {
      if (existing.has(f.vid_index)) continue;
      const ep = (s.episodes || []).find((e) => Number(e.vid_index) === f.vid_index);
      let size = 0;
      try { size = fs.statSync(f.path).size; } catch (_) {}
      downloadTasks.unshift({
        id: 'rescanned_' + randomUUID(),
        batchId: 'rescanned',
        savePath: f.path,
        customDir: scanned.dir,
        filename: f.filename,
        title: `《${s.series_title}》Tập ${String(f.vid_index).padStart(3, '0')}`,
        platform: 'hongguo',
        type: 'hongguo',
        status: 'completed',
        progress: 100,
        receivedBytes: size,
        totalBytes: size,
        startTime: Date.now(),
        videoInfo: {
          author: s.series_title,
          title: `《${s.series_title}》Tập ${String(f.vid_index).padStart(3, '0')}`,
          cover: s.cover || '',
          aweme_id: ep ? ep.vid : '',
        },
        hongguoInfo: {
          vid: ep ? ep.vid : '',
          series_id: sid,
          series_title: s.series_title,
          vid_index: f.vid_index,
          ep_title: ep ? ep.title : '',
        },
      });
      existing.add(f.vid_index);
      added++;
    }
  }
  if (added > 0) saveDownloadTasks();
  console.log(`[Rescan] Đã khôi phục ${added} bản ghi tải xuống từ đĩa`);
  return { success: true, count: added };
}

ipcMain.handle('rescan-downloads', async () => {
  try {
    return rescanDownloadsFromDisk();
  } catch (error) {
    console.error('[Rescan] Thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

/** Khôi phục hiển thị phim ngắn đã bị xóa */
ipcMain.handle('restore-dismissed-series', async () => {
  let n = 0;
  for (const s of seriesRegistry) {
    if (s.dismissed && !s.forgotten) { s.dismissed = false; n++; }
  }
  if (n > 0) saveSeriesRegistry();
  return { success: true, count: n };
});

ipcMain.handle('dismissed-count', async () => seriesRegistry.filter((s) => s.dismissed && !s.forgotten).length);

// ===== Hợp nhất một chạm (ffmpeg concat stream copy, không giảm chất lượng và nhanh) =====
let mergeTasks = []; // { id, seriesId, seriesTitle, status, progress, output, total, done, error }
const mergeRuns = new Map();

function resolveFfmpeg(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  // Bản đóng gói chính thức chỉ dùng nhị phân đi kèm gói. PATH / WinGet chỉ dành cho chế độ phát triển, tránh việc sau khi đóng gói dùng nhầm chương trình trùng tên bất kỳ trên hệ thống.
  const devLookup = typeof app !== 'undefined' && app.isPackaged !== true;
  const candidates = [
    // Tài nguyên thực thi phải nằm ngoài asar; khởi động Finder không phụ thuộc vào PATH của terminal.
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', executable) : null,
    path.join(__dirname, 'build', 'ffmpeg', `${process.platform}-${process.arch}`, executable),
    path.join(__dirname, 'build', 'ffmpeg', executable),
  ];
  if (devLookup) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const bare = process.platform === 'win32' ? dir.replace(/^"(.*)"$/, '$1') : dir;
      if (bare) candidates.push(path.join(bare, executable));
    }
  }
  for (const c of candidates) {
    if (!c) continue;
    try {
      fs.accessSync(c, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(c).isFile()) return c;
    } catch (_) {}
  }
  // Phương án dự phòng: Khi phát triển quét thư mục cài đặt winget
  if (!devLookup || process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (base && fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        if (!/ffmpeg/i.test(d)) continue;
        const exe = path.join(base, d);
        const found = findFileRecursive(exe, `${name}.exe`, 6);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function findFileRecursive(dir, fileName, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === fileName.toLowerCase()) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const r = findFileRecursive(path.join(dir, e.name), fileName, depth - 1);
    if (r) return r;
  }
  return null;
}

function probeDuration(ffprobePath, file, task) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const child = execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { timeout: 30000 },
      (err, stdout) => {
        if (task?.child === child) delete task.child;
        if (err) return resolve(0);
        const d = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(d) ? d : 0);
      });
    if (task) task.child = child;
  });
}

function probeVideoInfo(ffprobePath, file, task, rejectToolErrors = false) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    const child = execFile(ffprobePath, ['-v', 'error', '-show_data_hash', 'sha256',
      '-show_entries', 'stream=codec_type,codec_name,codec_tag_string,profile,level,width,height,pix_fmt,sample_aspect_ratio,r_frame_rate,time_base,extradata_hash,sample_rate,channels,channel_layout,bit_rate,color_range,color_space,color_transfer,color_primaries,field_order:format=duration,bit_rate,size', '-of', 'json', file],
      { timeout: 30000 }, (err, stdout) => {
        if (task?.child === child) delete task.child;
        if (err) {
          if (rejectToolErrors && (typeof err.code === 'string' || err.killed)) {
            return reject(Object.assign(new Error('Công cụ kiểm tra video không thể chạy, vui lòng kiểm tra cài đặt và quyền hạn rồi thử lại'), { code: 'LOCAL_MEDIA_TOOL_ERROR', cause: err }));
          }
          return resolve(null);
        }
        try { resolve(require('./src/native/merge-plan').readMergeInfo(JSON.parse(stdout))); }
        catch (_) { resolve(null); }
      });
    if (task) task.child = child;
  });
}

ipcMain.handle('get-ffmpeg-status', async () => {
  const ff = resolveFfmpeg('ffmpeg');
  const fp = resolveFfmpeg('ffprobe');
  return { success: true, ffmpeg: ff, ffprobe: fp, available: !!ff && !!fp };
});

function pathInside(root, target) {
  if (!root || !target) return false;
  let base = path.resolve(String(root));
  let file = path.resolve(String(target));
  try { if (fs.existsSync(base)) base = fs.realpathSync(base); } catch (_) {}
  try { if (fs.existsSync(file)) file = fs.realpathSync(file); } catch (_) {}
  if (process.platform === 'win32') {
    base = base.toLowerCase();
    file = file.toLowerCase();
  }
  const rel = path.relative(base, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function mediaRoots() {
  const roots = [];
  try {
    const root = String(getCurrentSettings().root || '').trim();
    if (root) roots.push(root);
  } catch (_) {}
  try {
    const downloads = app.getPath('downloads');
    if (downloads) roots.push(downloads);
  } catch (_) {}
  return roots;
}

function isInsideMediaRoot(target) {
  return mediaRoots().some((root) => pathInside(root, target));
}

function isRecordedMediaFile(target, episode) {
  try {
    if (!fs.lstatSync(target).isFile()) return false;
    const matches = (recorded, dir) => typeof recorded === 'string'
      && path.relative(path.resolve(recorded), path.resolve(target)) === ''
      && pathInside(dir || path.dirname(recorded), target);
    if (downloadTasks.some(task => matches(task.savePath, task.customDir)
      && (!episode || (hasCompleteTaskFile(task)
        && String(task.hongguoInfo?.series_id) === String(episode.seriesId)
        && Number(task.hongguoInfo?.vid_index) === Number(episode.vidIndex)
        && (!episode.vid || String(task.hongguoInfo?.vid) === String(episode.vid)))))) return true;
    return !episode && mergeTasks.some(task => matches(task.output));
  } catch (_) { return false; }
}

// Chỉ định vị thư mục tải xuống hoặc media đã đăng ký, không dùng openPath, tránh việc chạy nhầm tệp thực thi từ thư mục cha của đường dẫn bị thiếu.
ipcMain.handle('show-in-folder', async (event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) return { success: false, error: 'Thiếu đường dẫn' };
    const resolved = path.resolve(filePath);
    const recorded = isRecordedMediaFile(resolved);
    if (!isInsideMediaRoot(resolved) && !recorded) return { success: false, error: 'Chỉ có thể mở tệp trong thư mục tải xuống' };
    let target = resolved;
    if (!fs.existsSync(target)) target = path.dirname(resolved);
    if ((!isInsideMediaRoot(target) && !recorded) || !fs.existsSync(target)) return { success: false, error: 'Đường dẫn không tồn tại' };
    const stat = fs.statSync(target);
    if (!stat.isFile() && !stat.isDirectory()) return { success: false, error: 'Đường dẫn không tồn tại' };
    shell.showItemInFolder(target);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-merge-tasks', async () => mergeTasks.map(({ child, ...rest }) => rest));

function seriesDownloadDir(root, seriesId, seriesTitle) {
  const title = sanitizeFolderName(seriesTitle) || 'Phim ngắn chưa đặt tên';
  const suffix = createHash('sha256').update(String(seriesId)).digest('hex').slice(0, 12);
  return path.join(root, String(seriesId).startsWith('hema:') ? '河马短剧' : String(seriesId).startsWith('xifan:') ? '西饭短剧' : '红果短剧', `${title}-${suffix}`);
}

/** Tìm thư mục của một bộ phim trên đĩa (ưu tiên dùng bản ghi tác vụ, kế đến suy đoán theo tiêu đề) */
function resolveSeriesDir(seriesId, seriesTitle, covers) {
  const fromTask = covers.find((t) => t.customDir && fs.existsSync(t.customDir));
  if (fromTask) return fromTask.customDir;
  const fromFile = covers.find(t => t.savePath && fs.existsSync(path.dirname(t.savePath)));
  if (fromFile) return path.dirname(fromFile.savePath);
  const settings = getCurrentSettings();
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const guess = seriesDownloadDir(root, seriesId, seriesTitle);
  if (fs.existsSync(guess)) return guess;
  // Older versions used title-only directories. Reuse only when ownership is unambiguous.
  if (!/^(xifan|hema|custom):/.test(String(seriesId))) {
    const title = sanitizeFolderName(seriesTitle) || 'Phim ngắn chưa đặt tên';
    const owners = seriesRegistry.filter(s => sanitizeFolderName(s.series_title) === title);
    const legacy = path.join(root, '红果短剧', title);
    if (owners.length <= 1 && fs.existsSync(legacy)) return legacy;
  }
  return null;
}

function hasCompleteTaskFile(task) {
  if (!task?.savePath || task.pathConflict) return false;
  if (downloadTasks.some(other => other !== task && other.savePath === task.savePath && String(other.hongguoInfo?.vid) !== String(task.hongguoInfo?.vid))) return false;
  try { const stat = fs.statSync(task.savePath); return stat.isFile() && stat.size > 1024 * 100; }
  catch (_) { return false; }
}

function repairTaskDestination(task) {
  const conflicts = downloadTasks.filter(other => other !== task && other.savePath === task.savePath && String(other.hongguoInfo?.vid) !== String(task.hongguoInfo?.vid));
  if (conflicts.length) for (const item of [task, ...conflicts]) item.pathConflict = true;
  if (!task.pathConflict) return;
  if (task.nasDestination) return;
  const settings = getCurrentSettings(), info = task.hongguoInfo || {};
  task.customDir = seriesDownloadDir(settings.root || app.getPath('downloads'), info.series_id, info.series_title);
  const filename = uniqueEpisodeFilename(settings, info.series_title, { vid_index: info.vid_index, title: info.ep_title });
  const suffix = createHash('sha256').update(String(info.vid)).digest('hex').slice(0, 8);
  task.filename = filename.replace(/\.mp4$/, `-${suffix}.mp4`);
  task.savePath = path.join(task.customDir, task.filename);
  task.pathConflict = false;
}

function uniqueEpisodeFilename(settings, title, episode) {
  const index = String(episode.vid_index).padStart(3, '0');
  const format = settings.name_format || '';
  const rendered = renderName(format, title, episode.vid_index, episode.title) || title;
  return `${rendered}${/集数|vid_index/.test(format) ? '' : `_Tập${index}`}.mp4`;
}

function episodeFilePaths(file) {
  return [file, file + '.enc.tmp', file + '.enc.tmp.decoded'];
}

function ownsEpisodeFiles(file, owners) {
  const paths = new Set(episodeFilePaths(file));
  return !downloadTasks.some(task => paths.has(task.savePath) && !owners.includes(task))
    && !mergeTasks.some(task => paths.has(task.output));
}

/**
 * Ráp thứ tự hợp nhất: Chỉ nhận các tệp thực sự tồn tại trên đĩa (hàng đợi tác vụ có thể không nhất quán với tệp thực tế do gửi trùng,
 * xóa thủ công, tải qua nhiều phiên, v.v.).
 * Những tập có bản ghi tác vụ sẽ định vị chính xác theo mẫu tiêu đề; không có bản ghi thì quét thư mục theo số tập để dự phòng.
 */
function collectSeriesEpisodeFiles(seriesId, seriesTitle) {
  const sid = String(seriesId);
  const tasks = downloadTasks.filter(
    (t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid && t.savePath
  );
  const dir = resolveSeriesDir(sid, seriesTitle, tasks);

  const byIndex = new Map();
  const exists = (p) => {
    try { return fs.existsSync(p) && fs.statSync(p).size > 1024 * 100; } catch (_) { return false; }
  };

  // 1) Ưu tiên bản ghi tác vụ (mẫu đặt tên có thể khác với mặc định)
  for (const t of tasks) {
    if (!hasCompleteTaskFile(t) || !ownsEpisodeFiles(t.savePath, tasks)) continue;
    const idx = Number(t.hongguoInfo.vid_index) || 0;
    if (!idx) continue;
    const prev = byIndex.get(idx);
    if (!prev || (t.startTime || 0) > (prev.startTime || 0)) {
      byIndex.set(idx, { vid_index: idx, startTime: t.startTime || 0, path: t.savePath, filename: t.filename || path.basename(t.savePath) });
    }
  }

  // 2) Dự phòng bằng quét thư mục: Bổ sung các tệp tập phim trong thư mục phù hợp quy luật đặt tên theo số tập.
  //    Không phụ thuộc vào "tập phim đã đăng ký" — trên đĩa có thể tồn tại tệp mồ côi không có bản ghi tác vụ
  //    (tải qua các phiên trước, tác vụ bị dọn dẹp, v.v.), những tệp này cũng nên được hợp nhất vào.
  const sharedDirectory = dir && (downloadTasks.some(task => String(task.hongguoInfo?.series_id) !== sid && task.savePath && path.dirname(task.savePath) === dir)
    || mergeTasks.some(task => String(task.seriesId) !== sid && task.output && path.dirname(task.output) === dir));
  const registeredPaths = new Set([...downloadTasks.map(task => task.savePath), ...mergeTasks.map(task => task.output)].filter(Boolean));
  const episodePaths = new Set(tasks.map(task => task.savePath).filter(file => ownsEpisodeFiles(file, tasks)));
  const episodeNames = new Map();
  const formats = new Set([getCurrentSettings().name_format, 'series_title vid_index', 'series_title vid_index ep_title', 'series_title', '剧名 集数', '剧名 集数 标题', '剧名']);
  const entry = seriesRegistry.find(series => String(series.series_id) === sid);
  // Khi các hồ sơ cùng tên dùng chung thư mục, tên tệp không thể chứng minh quyền sở hữu, chỉ tin vào bản ghi tác vụ rõ ràng.
  const ambiguousTitle = sharedDirectory && (seriesRegistry.some(series => String(series.series_id) !== sid && sanitizeFolderName(series.series_title) === sanitizeFolderName(seriesTitle))
    || downloadTasks.some(task => String(task.hongguoInfo?.series_id) !== sid && task.savePath && path.dirname(task.savePath) === dir && sanitizeFolderName(task.hongguoInfo?.series_title || '') === sanitizeFolderName(seriesTitle)));
  if (!ambiguousTitle) for (const episode of entry?.episodes || []) {
    for (const name_format of formats) {
      if (sharedDirectory && !/剧名|\bseries_title\b/.test(name_format || '')) continue;
      episodeNames.set(uniqueEpisodeFilename({ name_format }, seriesTitle, episode), Number(episode.vid_index));
    }
  }
  let names = [], scanFailed = 0;
  if (dir) {
    try { names = fs.readdirSync(dir); } catch (_) { scanFailed = 1; }
    for (const name of episodeNames.keys()) {
      const full = path.join(dir, name);
      if (ownsEpisodeFiles(full, tasks)) episodePaths.add(full);
    }
    for (const n of names) {
      if (!/\.mp4$/i.test(n) || n.includes('合集') || n.includes('GopTap')) continue;
      const m = !sharedDirectory && n.match(/(\d{1,4})\.mp4$/i);
      const idx = episodeNames.get(n) || (m ? parseInt(m[1], 10) : 0);
      if (!idx || byIndex.has(idx)) continue;
      const full = path.join(dir, n);
      if (registeredPaths.has(full) || !ownsEpisodeFiles(full, tasks)) continue;
      if (exists(full)) byIndex.set(idx, { vid_index: idx, path: full, filename: n });
    }
  }
  for (const episode of byIndex.values()) episodePaths.add(episode.path);
  const temporaryPaths = new Set();
  for (const file of episodePaths) {
    if (!isFileInUse(file)) { temporaryPaths.add(file + '.enc.tmp'); temporaryPaths.add(file + '.enc.tmp.decoded'); }
  }
  const foreignOutputs = new Set(mergeTasks.filter(task => String(task.seriesId) !== sid).map(task => task.output));
  const mergedPaths = new Set(mergeTasks.filter(task => String(task.seriesId) === sid && task.output && !foreignOutputs.has(task.output)
    && !downloadTasks.some(download => download.savePath === task.output)).map(task => task.output));
  const concatPaths = new Set();
  if (dir && !sharedDirectory) {
    const safeTitle = sanitizeFolderName(seriesTitle);
    for (const name of names) {
      const full = path.join(dir, name);
      if (!safeTitle || foreignOutputs.has(full) || downloadTasks.some(task => task.savePath === full)) continue;
      const stem = name.replace(/(?: \(\d+\))?\.mp4$/, '');
      if (name.endsWith('.mp4') && (stem === `${safeTitle}_合集` || stem === `${safeTitle} 合集` || stem === `${safeTitle}_GopTap` || stem === `${safeTitle} GopTap`)) mergedPaths.add(full);
      if (name === `${safeTitle}.ffconcat.txt`) concatPaths.add(full);
    }
  }

  return {
    dir, sharedDirectory, episodeNames, episodePaths, temporaryPaths, mergedPaths, concatPaths, scanFailed,
    ordered: [...byIndex.values()].sort((a, b) => a.vid_index - b.vid_index),
  };
}

ipcMain.handle('merge-series', async (event, seriesId, outputName, options) => {
  try {
    if (mergeTempCleanup) await mergeTempCleanup;
    const sid = String(seriesId);
    const entry = seriesRegistry.find(s => String(s.series_id) === sid);
    const seriesTitle = entry?.series_title || downloadTasks.find(t => String(t.hongguoInfo?.series_id) === sid)?.hongguoInfo.series_title || 'Phim ngắn chưa đặt tên';
    const { dir, ordered } = collectSeriesEpisodeFiles(sid, seriesTitle);
    if (!ordered.length) return { success: false, error: 'Phim này chưa có tập nào tải xong' };
    const ffmpegPath = resolveFfmpeg('ffmpeg'), ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath || !ffprobePath) return { success: false, error: 'Không tìm thấy công cụ FFmpeg đầy đủ, không thể kiểm tra và gộp các tập' };
    if (mergeTasks.some(t => t.status === 'running')) return { success: false, error: 'Đã có tác vụ gộp đang chạy, vui lòng chờ hoàn thành hoặc hủy trước' };
    let precheckedInfos;
    if (options?.require1080 === true) {
      const below1080 = [];
      precheckedInfos = [];
      for (const episode of ordered) {
        let info;
        try { info = await probeVideoInfo(ffprobePath, episode.path, undefined, true); }
        catch (_) { info = null; }
        if (!info || !(info.w > 0) || !(info.h > 0)) {
          return { success: false, code: 'MERGE_1080_UNAVAILABLE',
            error: `Đọc thông tin video tập ${episode.vid_index} thất bại, không thể xác nhận có đạt 1080P hay không; vui lòng chọn Gộp nhanh hoặc Gộp tương thích.` };
        }
        const quality = Math.min(info.w, info.h);
        precheckedInfos.push(info);
        if (quality < 1080) below1080.push({ index: episode.vid_index, quality, w: info.w, h: info.h });
      }
      if (below1080.length) {
        const shown = below1080.slice(0, 3).map(item => `Tập ${item.index} thực tế là ${item.quality}P (${item.w}×${item.h})`).join(', ');
        const more = below1080.length > 3 ? `...tổng cộng ${below1080.length} tập chưa đạt 1080P` : `; tổng cộng ${below1080.length} tập chưa đạt 1080P`;
        return { success: false, code: 'MERGE_1080_UNAVAILABLE', error: `${shown}${more}; vui lòng chọn Gộp nhanh hoặc Gộp tương thích.` };
      }
      // Probing yields to other IPC requests; re-check before synchronously creating and saving a task.
      if (mergeTasks.some(t => t.status === 'running')) return { success: false, error: 'Đã có tác vụ gộp đang chạy, vui lòng chờ hoàn thành hoặc hủy trước' };
    }
    const outDir = dir || path.dirname(ordered[0].path);
    const baseName = outputName && String(outputName).trim() ? sanitizeFolderName(outputName) : `${sanitizeFolderName(seriesTitle)}_GopTap`;
    if (!baseName || baseName === '.' || baseName === '..') return { success: false, error: 'Vui lòng nhập tên tệp xuất hợp lệ' };
    let output = path.join(outDir, `${baseName}.mp4`);
    for (let number = 2; fs.existsSync(output); number++) output = path.join(outDir, `${baseName} (${number}).mp4`);
    const totalBytes = ordered.reduce((sum, e) => sum + fs.statSync(e.path).size, 0);
    const id = 'merge_' + randomUUID();
    const task = { id, seriesId: sid, seriesTitle, output, outputName: path.basename(output), total: ordered.length,
      done: 0, checked: 0, progress: 0, status: 'running', stage: 'checking', stageText: 'Kiểm tra các tập', totalBytes,
      totalDuration: 0, codecWarning: '', error: '', startTime: Date.now(), elapsedSeconds: 0, speed: 0, etaSeconds: null };
    mergeTasks.unshift(task);
    if (!saveMergeTasks()) { mergeTasks = mergeTasks.filter(t => t.id !== id); return { success: false, error: 'Không thể lưu tác vụ gộp, vui lòng kiểm tra thông báo lỗi lưu trữ rồi thử lại' }; }
    sendToRenderer('merge-task-added', { ...task });
    const { runMerge } = require('./src/native/merge-runner');
    const run = (async () => {
      try {
        await runMerge({ task, ordered, outDir, ffmpegPath, ffprobePath, probe: probeVideoInfo,
          precheckedInfos, pickEncoder: pickH264Encoder, compatible: !!options?.compatible,
          update: () => { const { child, ...data } = task; sendToRenderer('merge-progress', data); } });
      } catch (error) {
        task.status = task.cancelled ? 'stopped' : 'failed';
        task.stage = task.status; task.stageText = task.cancelled ? 'Đã hủy' : 'Gộp thất bại';
        task.error = task.cancelled ? 'Đã hủy' : error.message;
      } finally {
        task.endTime = Date.now();
        if (!saveMergeTasks()) task.storageWarning = 'Lịch sử gộp chưa được lưu, trạng thái tệp xuất vui lòng căn cứ theo đĩa';
        sendToRenderer(task.status === 'completed' ? 'merge-completed' : 'merge-failed', { id, path: output, error: task.error, verified: task.verified, storageWarning: task.storageWarning });
      }
    })().catch(error => console.error('[Merge] Thông báo tác vụ thất bại:', error.message)).finally(() => mergeRuns.delete(id));
    mergeRuns.set(id, run);
    return { success: true, id, output, outputName: task.outputName, count: ordered.length, totalBytes, totalDuration: 0, codecWarning: '' };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('cancel-merge', async (event, id) => {
  const task = mergeTasks.find(m => m.id === id);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };
  if (task.status !== 'running') return { success: false, error: 'Tác vụ đã kết thúc' };
  task.cancelled = true;
  require('./src/native/merge-runner').stopMergeChildren(task);
  return { success: true };
});

ipcMain.handle('delete-merge-task', async (event, id) => {
  const task = mergeTasks.find(m => m.id === id);
  if (task?.status === 'running') return { success: false, error: 'Vui lòng hủy gộp trước khi xóa bản ghi' };
  const previous = mergeTasks;
  mergeTasks = mergeTasks.filter(m => m.id !== id);
  if (!saveMergeTasks()) { mergeTasks = previous; return { success: false, error: 'Không thể lưu bản ghi tác vụ' }; }
  return { success: true };
});

function saveMergeTasks() {
  try { store.saveMergeTasks(mergeTasks.map(({ child, ...rest }) => rest)); return true; }
  catch (error) { console.error('[Merge] Lưu tác vụ thất bại:', error.message); return false; }
}

function loadMergeTasks() {
  try {
    mergeTasks = (store.getMergeTasks() || []).map(t => t.status === 'running'
      ? { ...t, status: 'stopped', stage: 'stopped', stageText: 'Đã gián đoạn', error: 'Gián đoạn khi đóng ứng dụng', endTime: Date.now() } : t);
  } catch (_) { mergeTasks = []; }
  const directories = [...new Set(mergeTasks.filter(task => typeof task.output === 'string' && path.isAbsolute(task.output)).map(task => path.dirname(task.output)))];
  mergeTempCleanup = require('./src/native/merge-runner').cleanupMergeTemps(directories)
    .catch(() => console.warn('[Merge] Một số tệp tạm còn sót lại không thể dọn dẹp'))
    .finally(() => { mergeTempCleanup = null; });
}

/**
 * Nguồn dữ liệu trang phát: Hợp nhất "hồ sơ phim ngắn" và "tác vụ tải xuống" thành trạng thái có thể phát của từng tập.
 * Quy tắc xác định có thể phát nhất quán với logic bỏ qua tải: tệp tồn tại và > 100KB.
 * Do tệp giải mã theo nguyên tắc "ghi .enc.tmp trước, thành công mới đổi tên .mp4", nên sẽ không đọc phải tệp dở dang.
 */
ipcMain.handle('get-series-episodes', async (event, seriesId) => {
  try {
    const sid = String(seriesId);
    const entry = seriesRegistry.find((s) => String(s.series_id) === sid);
    const tasks = downloadTasks.filter((t) => t.hongguoInfo && String(t.hongguoInfo.series_id) === sid);

    // Một tập chỉ giữ lại một tác vụ (khi gửi trùng cùng vid sẽ lấy tác vụ mới nhất)
    const taskByIndex = new Map();
    for (const t of tasks) {
      const idx = Number(t.hongguoInfo.vid_index);
      const prev = taskByIndex.get(idx);
      if (!prev || (t.startTime || 0) > (prev.startTime || 0)) taskByIndex.set(idx, t);
    }

    const baseEpisodes =
      entry && entry.episodes.length
        ? entry.episodes
        : tasks.map((t) => ({
            vid: t.hongguoInfo.vid,
            vid_index: t.hongguoInfo.vid_index,
            title: t.hongguoInfo.ep_title || '',
          }));

    // Dự phòng thư mục: Trên đĩa có thể tồn tại tệp "mồ côi" không có bản ghi tác vụ (tác vụ bị xóa, tải qua phiên khác, v.v.), chỉ dựa vào tác vụ sẽ báo nhầm thành "chưa tải".
    const seriesTitle = (entry && entry.series_title) ||
      (tasks[0] && tasks[0].hongguoInfo.series_title) || 'Phim ngắn chưa đặt tên';
    let scannedByIndex = new Map();
    let seriesDir = null;
    try {
      const scanned = collectSeriesEpisodeFiles(sid, seriesTitle);
      seriesDir = scanned.dir;
      for (const e of scanned.ordered) scannedByIndex.set(Number(e.vid_index), e);
    } catch (_) {}

    const episodes = baseEpisodes
      .map((ep) => {
        const idx = Number(ep.vid_index);
        const t = taskByIndex.get(idx);
        let status = 'missing';
        let fileUrl = null;
        let progress = 0;
        let fileSize = 0;
        let savePath = null;

        if (t && t.savePath) {
          savePath = t.savePath;
          if (fs.existsSync(t.savePath)) {
            fileSize = fs.statSync(t.savePath).size;
          }
          if (hasCompleteTaskFile(t)) {
            status = 'completed';
            fileUrl = localPlayUrl(t.savePath);
          } else if (t.status === 'downloading') {
            status = 'downloading';
            progress = t.progress || 0;
          } else if (t.status === 'pending') {
            status = 'pending';
          } else {
            status = t.status === 'completed' ? 'missing' : t.status;
          }
        }

        // Khi thiếu tác vụ (hoặc tác vụ không có tệp khả dụng), dùng kết quả quét đĩa làm dự phòng
        if (status === 'missing') {
          const f = scannedByIndex.get(idx);
          if (f) {
            savePath = f.path;
            fileUrl = localPlayUrl(f.path);
            try { fileSize = fs.statSync(f.path).size; } catch (_) {}
            status = 'completed';
          }
        }

        return {
          vid: ep.vid,
          vid_index: idx,
          title: sid.startsWith('xifan:')
            ? require('./src/native/xifan').episodeDisplayTitle(sid, seriesTitle, ep.title || '') : ep.title || '',
          web_available: ep.web_available ?? null,
          locked: ep.locked === true,
          taskId: t ? t.id : null,
          error: t?.error || '',
          retryAt: t?.retryAt || null,
          actualQuality: t?.actualQuality || null,
          status,
          progress,
          fileSize,
          fileUrl,
          savePath,
        };
      })
      .sort((a, b) => a.vid_index - b.vid_index);

    const completedCount = episodes.filter((e) => e.status === 'completed').length;
    return {
      success: true,
      data: {
        series_id: sid,
        series_title: seriesTitle,
        cover: (entry && entry.cover) || '',
        seriesDir,
        web_accessible_episodes: entry?.web_accessible_episodes ?? null,
        total: episodes.length,
        completedCount,
        episodes,
      },
    };
  } catch (error) {
    console.error('[Player] Đọc tập phim thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Tiếp tục phát từ điểm dừng
ipcMain.handle('save-playback-position', async (event, seriesId, vidIndex, currentTime, metadata) => {  try {
    const map = store.getPlayback() || {};
    const sid = String(seriesId);
    const series = seriesRegistry.find(item => String(item.series_id) === sid);
    if (!series) return { success: false, error: 'Không tìm thấy hồ sơ phim' };
    map[sid] = watchHistory.recordPlayback(map[sid], series, Number(vidIndex), Number(currentTime), Date.now(), metadata);
    store.savePlayback(map);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-playback-position', async (event, seriesId) => {
  const sid = String(seriesId);
  const accountResume = accountResumePositions.get(sid);
  if (accountResume) {
    accountResumePositions.delete(sid);
    return accountResume;
  }
  const map = store.getPlayback() || {};
  return map[sid] || null;
});

function navigateToPlayer(payload) {
  sendToRenderer('navigate', {
    page: 'player',
    payload: {
      seriesId: payload?.seriesId ? String(payload.seriesId) : '',
      vidIndex: Number(payload?.vidIndex) || 0,
      resume: payload?.resume === true,
    },
  });
  return { success: true };
}

/**
 * Chọn phát từ trang "Khám phá": Chuyển sang trang phát và chọn bộ phim đó.
 * Tiến trình chính chỉ chịu trách nhiệm gửi lệnh điều hướng, trạng thái cụ thể của các tập do tầng dựng tự lấy, tránh duy trì dữ liệu trùng lặp.
 */
ipcMain.handle('play-series', async (event, payload) => {
  const { seriesId, vidIndex } = payload || {};
  const entry = seriesRegistry.find(item => String(item.series_id) === String(seriesId));
  if (!entry) return { success: false, code: 'SERIES_NOT_FOUND', error: 'Không tìm thấy hồ sơ phim, vui lòng mở lại chi tiết' };
  if (entry.dismissed) {
    const wasForgotten = entry.forgotten;
    try { entry.dismissed = false; entry.forgotten = false; saveSeriesRegistry(); }
    catch (error) { entry.dismissed = true; entry.forgotten = wasForgotten; return { success: false, error: error.message }; }
  }
  return navigateToPlayer({ seriesId, vidIndex, resume: payload?.resume === true });
});

// ===== Phát trực tuyến =====
function playbackQuality(value = 'auto', vid = '') {
  if (!['auto', '720p', '1080p'].includes(value)) throw new Error('Độ phân giải phát trực tuyến không hợp lệ, vui lòng chọn Tự động, 720p hoặc 1080p');
  if (value !== 'auto' && /^(xifan|hema|custom):/.test(String(vid))) throw new Error('Nguồn này tạm thời chưa hỗ trợ chọn độ phân giải phát trực tuyến, vui lòng chọn Tự động');
  return value;
}

function onlineCacheKey(vid, quality = 'auto') {
  return quality === 'auto' ? String(vid) : `${vid}:${quality}`;
}


/** Only a single valid byte range is supported; malformed/unsatisfiable => 416. */
function mediaRange(range, size) {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end };
}

function bufferedMediaResponse(request, buffer) {
  const range = mediaRange(request.headers.get('range'), buffer.length);
  if (range === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buffer.length}` } });
  const { start, end } = range || { start: 0, end: buffer.length - 1 };
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${buffer.length}`;
  return new Response(request.method === 'HEAD' ? null : buffer.subarray(start, end + 1), { status: range ? 206 : 200, headers });
}

/** Same media headers and cancellation apply to download and playback. */
async function requestMedia(playInfo, options = {}) {
  const url = new URL(playInfo.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Địa chỉ phát không hợp lệ');
  checkCustomAccess(playInfo.vid);
  const custom = playInfo.source === 'custom';
  const web = playInfo.source === 'web';
  const config = { method: 'GET', url: url.href, responseType: 'stream', timeout: 60000, ...options,
    ...((web || custom) ? require('./src/native/web-media-guard').webMediaRequestOptions(url.href) : {}),
    headers: { 'User-Agent': playInfo.userAgent || (web ? hongguo.WEB_UA : hongguo.UA), 'Accept-Encoding': 'identity',
      ...((playInfo.referer || web) ? { Referer: playInfo.referer || hongguo.WEB_REFERER } : {}), ...options.headers } };
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { response = await axios(config); break; }
    catch (error) {
      error.response?.data?.destroy?.();
      const status = error.response?.status;
      const cancelled = config.signal?.aborted || config.cancelToken?.reason || axios.isCancel(error);
      if (!cancelled && (error.code === 'ERR_WEB_MEDIA_ADDRESS' || error.cause?.code === 'ERR_WEB_MEDIA_ADDRESS')) {
        hongguo.markWebMediaFailure?.(playInfo);
        throw Object.assign(mediaTransferError('Địa chỉ nguồn trang web không an toàn, đang thử nguồn khác'), { code: 'ERR_WEB_MEDIA_ADDRESS' });
      }
      const retryable = web ? [404, 410].includes(status) || status >= 500 && status <= 599 : status === 403;
      if (!cancelled && attempt === 0 && retryable) {
        if (['app', 'api'].includes(playInfo.source) && config.headers.Referer) delete config.headers.Referer;
        else if (['app', 'api'].includes(playInfo.source) && !config.headers.Referer) config.headers.Referer = hongguo.VIDEO_REFERER;
        continue;
      }
      if (!cancelled && config.method === 'GET' && (retryable || status === 403)) hongguo.markWebMediaFailure?.(playInfo);
      if (!cancelled && status) {
        const failure = new Error(`Yêu cầu nguồn thất bại (HTTP ${status}), vui lòng kết nối lại nguồn`);
        failure.mediaRetryable = [403, 404, 408, 410].includes(status) || status >= 500 && status <= 599;
        failure.mediaStatus = status;
        throw failure;
      }
      throw error;
    }
  }
  if ([200, 206].includes(response.status) && /(?:text\/html|application\/json)/i.test(response.headers['content-type'] || '')) {
    response.data.destroy();
    throw mediaTransferError('Nguồn trả về trang lỗi, vui lòng lấy lại nguồn');
  }
  if (config.method === 'GET' && !config.headers.Range && response.status === 206) {
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
    if (!range || Number(range[1]) + 1 !== Number(range[2])) {
      response.data.destroy();
      throw mediaTransferError('Phản hồi video không đầy đủ, vui lòng lấy lại nguồn');
    }
    response.headers['content-length'] = range[2];
  }
  return response;
}

function mediaTransferError(message) {
  return Object.assign(new Error(message), { code: 'MEDIA_TRANSFER_ERROR', mediaRetryable: true });
}

function awaitMediaOperation(promise, signal, timeout = 0) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (settle, value) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); settle(value);
    };
    const abort = () => finish(reject, Object.assign(new Error('Đã hủy yêu cầu media'), { code: 'ERR_CANCELED' }));
    if (timeout) timer = setTimeout(() => finish(reject, mediaTransferError('Lấy nguồn video quá thời gian, vui lòng thử lại sau')), timeout);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // The shared provider may finish later; only this consumer's wait is cancelled.
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

let activeResolvePromise = null;
let lastDownloadResolveAt = 0;

function throttleDownloadResolve(action, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Đã hủy yêu cầu media'), { code: 'ERR_CANCELED' }));
  const interval = getCurrentSettings().download_resolve_interval;
  const isIdle = !activeResolvePromise && (!Number.isInteger(interval) || interval <= 0 || Date.now() - lastDownloadResolveAt >= interval);
  if (isIdle) {
    let promise;
    try {
      const callResult = action();
      promise = Promise.resolve(callResult).finally(() => {
        lastDownloadResolveAt = Date.now();
        if (activeResolvePromise === promise) activeResolvePromise = null;
      });
      activeResolvePromise = promise;
      return promise;
    } catch (error) {
      lastDownloadResolveAt = Date.now();
      return Promise.reject(error);
    }
  }
  const run = async () => {
    if (signal?.aborted) throw Object.assign(new Error('Đã hủy yêu cầu media'), { code: 'ERR_CANCELED' });
    const currentInterval = getCurrentSettings().download_resolve_interval;
    if (Number.isInteger(currentInterval) && currentInterval > 0) {
      const elapsed = Date.now() - lastDownloadResolveAt;
      if (elapsed < currentInterval) {
        await new Promise(resolve => setTimeout(resolve, currentInterval - elapsed));
      }
    }
    if (signal?.aborted) throw Object.assign(new Error('Đã hủy yêu cầu media'), { code: 'ERR_CANCELED' });
    try {
      return await action();
    } finally {
      lastDownloadResolveAt = Date.now();
    }
  };
  const waiter = (activeResolvePromise || Promise.resolve()).then(run, run);
  const chained = waiter.finally(() => {
    if (activeResolvePromise === chained) activeResolvePromise = null;
  });
  activeResolvePromise = chained.catch(() => {});
  return waiter;
}

/** Retry the complete operation so a broken body never counts as a successful download. */
async function withMediaRecovery(vid, seriesId, options, consume) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  options.cancelToken?.subscribe(abort);
  const cancelled = () => {
    options.cancelToken?.throwIfRequested();
    if (options.signal?.aborted || controller.signal.aborted) throw Object.assign(new Error('Đã hủy yêu cầu media'), { code: 'ERR_CANCELED' });
  };
  const recoverable = error => error?.code === 'SOURCE_UNAVAILABLE'
    ? sourceFailureIsTransient(error)
    : error?.mediaRetryable || error?.code === 'MEDIA_DECODE_ERROR'
      || ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ERR_BAD_RESPONSE', 'ERR_STREAM_PREMATURE_CLOSE', 'EAI_AGAIN'].includes(error?.code);
  const rounds = options.recover !== false && /^\d{1,30}$/.test(String(vid)) ? 3 : 1;
  let lastError, decodeFailure, transfers = 0;
  try {
    for (let round = 0; round < rounds; round++) {
      cancelled();
      if (round) {
        let timer;
        const hasEmptyResponse = (lastError?.sources || []).some(s => s.code === 'EMPTY_RESPONSE');
        const delay = hasEmptyResponse ? Math.max(round * 1500, 1500) : round * 500;
        try { await awaitMediaOperation(new Promise(resolve => { timer = setTimeout(resolve, delay); }), controller.signal); }
        finally { clearTimeout(timer); }
      }
      cancelled();
      let info;
      try {
        const resolveFn = () => awaitMediaOperation(hongguo.fetchPlayUrlSingle(vid, seriesId,
          { quality: options.quality, allowLowerQuality: options.allowLowerQuality, force: options.force || round > 0 }), controller.signal, 30000);
        info = !round && options.playInfo || (options.forDownload ? await throttleDownloadResolve(resolveFn, controller.signal) : await resolveFn());
      } catch (error) {
        cancelled();
        if (!recoverable(error)) throw error;
        lastError = error;
        continue;
      }
      cancelled();
      if (!info?.url) {
        lastError = Object.assign(new Error(info?.error || 'Không lấy được địa chỉ phát hợp lệ'), { code: info?.code, sources: info?.sources });
        if (!recoverable(lastError) || info?.locked) throw lastError;
        continue;
      }
      const seen = new Set();
      for (const candidate of [info, ...(options.recover === false ? [] : info.variants || info.candidates || [])]) {
        const identity = JSON.stringify([candidate.url, candidate.contentKey, candidate.spadeA, candidate.userAgent, candidate.referer]);
        if (!candidate.url || seen.has(identity)) continue;
        seen.add(identity);
        cancelled();
        transfers++;
        try {
          const value = await consume(candidate);
          cancelled();
          return value;
        } catch (error) {
          cancelled();
          // Local storage/security failures cannot be repaired by trying a lower-quality video.
          const terminal = error?.path || error?.dest
            || /^(?:EACCES|EPERM|ENOSPC|EDQUOT|EROFS|EIO|ENOENT|EEXIST|ENOTDIR|EISDIR|EMFILE|ENFILE|EBUSY|ENAMETOOLONG|EMLINK|EFBIG|LOCAL_MEDIA_TOOL_ERROR|SECURITY_BLOCKED|ERR_WEB_MEDIA_ADDRESS)$/.test(error?.code);
          if (options.allowLowerQuality && terminal || (!recoverable(error) && !options.allowLowerQuality)) throw error;
          lastError = error;
          // A bad Web body changes source priority; retry lookup before giving up on App recovery.
          if (error?.code === 'MEDIA_DECODE_ERROR' && candidate.source !== 'web') decodeFailure = error;
          hongguo.markWebMediaFailure?.(candidate);
          if (transfers >= 4 && !options.allowLowerQuality) throw lastError;
        }
      }
      if (decodeFailure) throw decodeFailure;
    }
    throw lastError;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    options.cancelToken?.unsubscribe(abort);
  }
}

/** Proxy only addresses resolved by our native provider, never renderer-supplied URLs. */
function mediaWithCors(handler) {
  return async request => {
    const headers = mediaAccess.corsHeaders(request);
    if (!headers) return new Response('forbidden origin', { status: 403 });
    const response = await handler(request);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  };
}

function diskMediaResponse(request,entry,session) {
  const range = mediaRange(request.headers.get('range'),entry.size);
  if (range === false) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${entry.size}`}});
  const {start,end} = range || {start:0,end:entry.size-1};
  const headers = {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1)};
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${entry.size}`;
  if (request.method === 'HEAD') return new Response(null,{status:range?206:200,headers});
  const reader = fs.createReadStream(entry.filePath,{start,end}), controller = new AbortController();
  entry.disk.readers = (entry.disk.readers || 0) + 1;
  const abort = () => controller.abort();
  controller.signal.addEventListener('abort',() => reader.destroy());
  session.requests.add(controller); request.signal.addEventListener('abort',abort,{once:true});
  reader.once('close',() => {
    session.requests.delete(controller); request.signal.removeEventListener('abort',abort);
    entry.disk.readers--; disposeOnlineDisk(entry);
  });
  trackOnlineWork(controller, new Promise(resolve => reader.once('close', resolve)));
  if (request.signal.aborted) abort();
  return new Response(Readable.toWeb(reader),{status:range?206:200,headers});
}

function registerStreamProtocol() {
  protocol.handle(STREAM_SCHEME, mediaWithCors(async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\/+/, '');
    const session = url.hostname === 'play' && onlineSessions.get(id);
    if (!session || !session.entry) return new Response('not ready', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const entry = session.entry;
    try { checkCustomAccess(session.vid); } catch (_) { releaseOnlineSession(id); return new Response('source disabled',{status:403}); }
    if (entry.filePath) return diskMediaResponse(request,entry,session);
    entry.lastUsed = Date.now();
    if (entry.buffer) {
      if (session.mediaStarted && entry.mediaIdentity && session.mediaIdentity !== entry.mediaIdentity) return new Response('media changed', { status: 502 });
      return bufferedMediaResponse(request, entry.buffer);
    }
    const range = request.headers.get('range');
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response(null, { status: 416 });
    const controller = new AbortController();
    session.requests.add(controller);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const cleanup = () => { session.requests.delete(controller); request.signal.removeEventListener('abort', abort); };
    try {
      return await withMediaRecovery(session.vid, entry.seriesId,
        { playInfo: entry.playInfo, quality: entry.quality, signal: controller.signal, recover: !session.mediaStarted }, async playInfo => {
        const identity = JSON.stringify([playInfo.url, playInfo.contentKey, playInfo.spadeA]);
        const checkIdentity = () => {
          if (session.mediaStarted && session.mediaIdentity !== identity) throw new Error('Nguồn đã thay đổi, vui lòng kết nối lại để phát');
        };
        checkIdentity();
        if (playInfo.format === 'hls') {
          if (!entry.hlsJob) {
            entry.hlsIdentity = identity;
            entry.hlsJob = trackOnlineWork(controller, (async () => {
              const prepared = {...entry}; delete prepared.hlsJob;
              await prepareHlsEntry(playInfo,prepared,controller.signal,received => sendToRenderer('online-play-progress',
                {vid:session.vid,seriesId:entry.seriesId,vidIndex:entry.vidIndex,requestId:session.requestId,received,total:0,percent:0,phase:'downloading'}));
              try { checkIdentity(); } catch (error) { disposeOnlineDisk(prepared); throw error; }
              Object.assign(entry,prepared,{mediaIdentity:identity,vid:session.vid,source:/^custom:[^:]+/.exec(session.vid)?.[0] || 'hongguo',complete:true});
              delete entry.playInfo;
              onlineCache.set(session.cacheKey || session.vid,entry); trimOnlineCache();
            })().catch(error => { delete entry.hlsJob; delete entry.hlsIdentity; throw error; }));
          }
          if (entry.hlsIdentity !== identity) throw new Error('Nguồn đã thay đổi, vui lòng kết nối lại để phát');
          await entry.hlsJob; checkIdentity();
          session.mediaStarted = true; session.mediaIdentity = identity;
          cleanup(); return diskMediaResponse(request,entry,session);
        }
        // A fallback can change encryption and size; serve Range only after decoding that candidate.
        if (playInfo.spadeA || playInfo.contentKey) {
          const buffer = await trackOnlineWork(controller, fetchDecryptedEpisodeOnce(session.vid, null, entry.seriesId, playInfo, controller.signal));
          checkIdentity();
          entry.buffer = buffer; entry.size = buffer.length; entry.mediaIdentity = identity; delete entry.playInfo;
          session.mediaStarted = true; session.mediaIdentity = identity;
          cleanup();
          return bufferedMediaResponse(request, buffer);
        }
        const upstream = await requestMedia(playInfo, { method: request.method, signal: controller.signal,
          headers: range ? { Range: range } : {}, validateStatus: status => [200, 206, 416].includes(status) });
        try { checkIdentity(); } catch (error) { upstream.data.destroy(); throw error; }
        entry.playInfo = playInfo;
        upstream.data.once('error', () => {
          if (!controller.signal.aborted) hongguo.markWebMediaFailure?.(playInfo);
        });
        upstream.data.once('close', cleanup);
        const headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' };
        for (const name of ['content-length', 'content-range', 'accept-ranges']) {
          if (upstream.headers[name]) headers[name] = upstream.headers[name];
        }
        if (request.method === 'HEAD' || upstream.status === 416) {
          if (request.method === 'HEAD' && upstream.status !== 416) { session.mediaStarted = true; session.mediaIdentity = identity; }
          upstream.data.destroy(); cleanup();
          return new Response(null, { status: upstream.status, headers });
        }
        // Later requests must reconnect by playback time, never reuse offsets against a new rendition.
        session.mediaStarted = true;
        session.mediaIdentity = identity;
        return new Response(Readable.toWeb(upstream.data, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }), { status: upstream.status, headers });
      });
    } catch (error) {
      cleanup();
      if (error.code === 'MEDIA_TOO_LARGE') sendToRenderer('online-play-progress', { requestId: session.requestId, code: error.code, error: error.message });
      return new Response('media unavailable', { status: controller.signal.aborted ? 499 : 502 });
    }
  }));
}

/** Cung cấp địa chỉ phát ngẫu nhiên trong nội bộ tiến trình, không để lộ đường dẫn cục bộ cho trang web. */
function localPlayUrl(filePath) {
  if (!filePath) return null;
  return mediaAccess.localUrl(filePath);
}

/**
 * Đăng ký giao thức phát tệp cục bộ.
 * Chuyển sang tiến trình chính dùng Node đọc tệp cung cấp, thay vì để Chromium đọc file://:
 * Trong chế độ phát triển, trang dựng đến từ http://localhost:5173, Chromium sẽ từ chối yêu cầu file://
 * bằng "Not allowed to load local resource" (biểu hiện là trình phát đen màn hình, tiến độ 0:00).
 * Đi qua giao thức tùy chỉnh giúp cả hai chế độ phát triển và đóng gói hoạt động nhất quán, đồng thời hỗ trợ Range để kéo tua tiến độ.
 */
function localMediaBody(file, options) {
  const stream = fs.createReadStream(file, options);
  localFileReaders.set(file, (localFileReaders.get(file) || 0) + 1);
  stream.once('close', () => {
    const remaining = localFileReaders.get(file) - 1;
    if (remaining) localFileReaders.set(file, remaining); else localFileReaders.delete(file);
  });
  return Readable.toWeb(stream);
}

function registerLocalProtocol() {
  protocol.handle(LOCAL_SCHEME, mediaWithCors(async (request) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const filePath = mediaAccess.resolveLocal(request.url);
      if (!filePath) {
        return new Response('bad path', { status: 400, headers: { 'Content-Type': 'text/plain' } });
      }
      // Chỉ cho phép lấy tệp video, tránh việc giao thức này bị lợi dụng để đọc tệp cục bộ tùy ý
      if (!/\.(mp4|m4v|mov|webm)$/i.test(filePath)) {
        return new Response('forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }

      let size = 0;
      try {
        size = (await fsp.stat(filePath)).size;
      } catch (_) {
        console.warn('[Local] Tệp không tồn tại:', filePath);
        return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }

      const range = mediaRange(request.headers.get('range'), size);
      if (range === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      if (range) {
        const { start, end } = range;
        return new Response(request.method === 'HEAD' ? null : localMediaBody(filePath, { start, end }), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
          },
        });
      }

      return new Response(request.method === 'HEAD' ? null : localMediaBody(filePath), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(size),
        },
      });
    } catch (e) {
      console.error('[Local] Đọc thất bại:', e.message);
      return new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  }));
}

/** App CENC uses native FFmpeg for both senc and saiz/saio layouts. Never log key/args. */
async function decryptContentKeyFile(input, output, contentKey, { signal, cancelToken } = {}) {
  if (typeof contentKey !== 'string' || !/^[a-f\d]{32}$/i.test(contentKey)) throw new Error('Định dạng khóa giải mã nguồn video không hợp lệ');
  if (signal?.aborted) throw new Error('Đã hủy giải mã media');
  cancelToken?.throwIfRequested();
  const executable = resolveFfmpeg('ffmpeg');
  if (!executable) throw new Error('Không tìm thấy FFmpeg tích hợp sẵn, không thể chuẩn bị nguồn này. Vui lòng tải lại gói phát hành đầy đủ; nếu đã tự cài đặt FFmpeg, vui lòng thoát hoàn toàn ứng dụng rồi khởi động lại');
  try {
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const child = spawn(executable, ['-y', '-hide_banner', '-loglevel', 'error',
        '-decryption_key', contentKey, '-i', input, '-map', '0:v:0', '-map', '0:a?',
        '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let cancelled = false, killTimer;
      const abort = () => {
        if (cancelled) return;
        cancelled = true; child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      };
      const cleanup = () => {
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        cancelToken?.unsubscribe(abort);
      };
      // Discard native diagnostics: they may contain private input paths or key material.
      child.stderr.on('data', () => {});
      signal?.addEventListener('abort', abort, { once: true });
      cancelToken?.subscribe(abort);
      if (signal?.aborted || cancelToken?.reason) abort();
      child.once('error', () => { cleanup(); reject(new Error('Không thể khởi động FFmpeg tích hợp')); });
      child.once('close', code => {
        cleanup();
        if (cancelled) reject(new Error('Đã hủy giải mã media'));
        else if (code !== 0) reject(new Error(`Giải mã media thất bại (mã thoát FFmpeg ${code}), vui lòng lấy lại nguồn rồi thử lại`));
        else resolve();
      });
    });
    if (signal?.aborted) throw new Error('Đã hủy giải mã media');
    cancelToken?.throwIfRequested();
    if ((await fsp.stat(output)).size === 0) throw new Error('Giải mã media không tạo ra tệp khả dụng');
  } catch (error) {
    try { await fsp.unlink(output); } catch (_) {}
    throw error;
  }
}

/** Encrypted sources and compatibility transcoding still require the complete MP4. */
async function fetchDecryptedEpisode(vid, onProgress, seriesId, playInfo, signal, maxBytes = ONLINE_MAX_BYTES, force = false, quality = 'auto') {
  return withMediaRecovery(vid, seriesId, { playInfo, signal, force, quality }, candidate =>
    fetchDecryptedEpisodeOnce(vid, onProgress, seriesId, candidate, signal, maxBytes));
}

async function fetchDecryptedEpisodeOnce(vid, onProgress, seriesId, playInfo, signal, maxBytes = ONLINE_MAX_BYTES) {
  maxBytes = Math.min(maxBytes, ONLINE_MAX_BYTES);
  const tooLarge = () => Object.assign(new Error('Tập này quá lớn, vui lòng tải về trước khi xem'), { code: 'MEDIA_TOO_LARGE' });
  if (playInfo?.format === 'hls') throw new Error('Video HLS phải được chuẩn bị thành tệp media cục bộ trước');
  if (!playInfo?.url) throw new Error(playInfo?.error || 'Không lấy được địa chỉ phát hợp lệ');
  if (signal?.aborted) throw new Error('Đã hủy phát');
  if (playInfo.contentKey && !/^[a-f\d]{32}$/i.test(playInfo.contentKey)) throw new Error('Định dạng khóa giải mã nguồn video không hợp lệ');
  const response = await requestMedia(playInfo, { signal });
  const total = Number(response.headers['content-length']) || 0;
  if (total > maxBytes) { response.data.destroy(); throw tooLarge(); }
  const chunks = [];
  let received = 0, lastProgress = 0;
  if (playInfo.contentKey) {
    let temporary;
    try {
      temporary = await fsp.mkdtemp(path.join(app.getPath('temp'), 'hongguo-decrypt-'));
      const input = path.join(temporary, 'encrypted.mp4'), output = path.join(temporary, 'decoded.mp4');
      response.data.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) { response.data.destroy(tooLarge()); return; }
        if (onProgress && (Date.now() - lastProgress >= 150 || received === total)) {
          onProgress(received, total); lastProgress = Date.now();
        }
      });
      await pipeline(response.data, fs.createWriteStream(input, { mode: 0o600 }), { signal });
      if (!received || (total && received !== total)) throw mediaTransferError('Tải video chưa hoàn tất, vui lòng thử lại');
      if (onProgress) onProgress(received, received, 'decrypting');
      await decryptContentKeyFile(input, output, playInfo.contentKey, { signal });
      if ((await fsp.stat(output)).size > maxBytes) throw tooLarge();
      return await fsp.readFile(output);
    } finally {
      response.data.destroy();
      if (temporary) await fsp.rm(temporary, { recursive: true, force: true });
    }
  }
  for await (const chunk of response.data) {
    received += chunk.length;
    if (received > maxBytes) { response.data.destroy(); throw tooLarge(); }
    chunks.push(chunk);
    if (onProgress && (Date.now() - lastProgress >= 150 || received === total)) {
      onProgress(received, total); lastProgress = Date.now();
    }
  }
  if (signal?.aborted) throw new Error('Đã hủy phát');
  if (!received || (total && received !== total)) throw mediaTransferError('Tải video chưa hoàn tất, vui lòng thử lại');
  let buf = Buffer.concat(chunks);
  if (playInfo.spadeA) {
    if (onProgress) onProgress(buf.length, buf.length, 'decrypting');
    const key = hongguo.deriveKey(playInfo.spadeA);
    if (!key) throw new Error('Tạo khóa giải mã thất bại');
    buf = await decryptInWorker({ buffer: buf, key }, { signal });
  }
  return buf;
}

async function prepareHlsEntry(playInfo,entry,signal,onProgress) {
  entry.disk = {directory:await fsp.mkdtemp(path.join(app.getPath('temp'),'hongguo-online-')),readers:0};
  entry.filePath = path.join(entry.disk.directory,'video.mp4');
  try {
    await prepareHlsFile(playInfo,entry.filePath,{signal,onProgress});
    await verifyDownloadQuality(entry.filePath,entry.quality || 'auto');
    if (signal.aborted) throw new Error('Đã hủy phát');
    entry.size = fs.statSync(entry.filePath).size;
  } catch (error) { disposeOnlineDisk(entry); throw error; }
}

ipcMain.handle('prepare-online-play', async (event, payload) => {
  const { vid, seriesId, vidIndex, requestId, prefetch = false, force = false } = payload || {};
  if (!vid) return { success: false, error: 'Thiếu vid' };
  let quality;
  try { quality = playbackQuality(payload.quality, vid); } catch (error) { return { success: false, error: error.message }; }
  const sourceVid = String(vid), key = onlineCacheKey(sourceVid, quality), streamId = randomUUID();
  const session = { vid: sourceVid, seriesId: String(seriesId || ''), vidIndex: Number(vidIndex), cacheKey: key, requestId, requests: new Set(), entry: null };
  onlineSessions.set(streamId, session);
  try {
    checkCustomAccess(sourceVid);
    const checkedPlayInfo = /^(xifan|hema|custom):/.test(sourceVid) ? await hongguo.fetchPlayUrlSingle(sourceVid, seriesId, { force, quality }) : null;
    if (!onlineSessions.has(streamId)) throw new Error('Đã hủy phát');
    if (checkedPlayInfo && !checkedPlayInfo.url) throw new Error(checkedPlayInfo.error || 'Nguồn phim chưa mở tập này');
    if (force) deleteOnlineCacheEntry(key);
    let entry = onlineCache.get(key), cached = !!entry;
    if (!entry) {
      let job = onlinePreparing.get(key);
      if (!job || (force && !job.force)) {
        const controller = new AbortController();
        job = { controller, force };
        job.promise = trackOnlineWork(controller, (async () => {
          const progress = (received,total,phase) => {
            for (const active of onlineSessions.values()) if (active.cacheKey === key) {
              sendToRenderer('online-play-progress',{vid:sourceVid,seriesId,vidIndex,requestId:active.requestId,
                received,total,percent:total?Math.floor(received/total*100):0,phase:phase||'downloading'});
            }
          };
          const prepared = await withMediaRecovery(sourceVid,seriesId,{playInfo:checkedPlayInfo,quality,force,signal:controller.signal},async playInfo => {
            const entry = {quality,codec:playInfo.codec || '',size:0,lastUsed:Date.now(),seriesId:String(seriesId||''),vidIndex:Number(vidIndex)||0};
            if (playInfo.format === 'hls') await prepareHlsEntry(playInfo,entry,controller.signal,received => progress(received,0));
            else if (!prefetch && !playInfo.spadeA && !playInfo.contentKey) return {...entry,playInfo};
            else {
              entry.buffer = await fetchDecryptedEpisodeOnce(sourceVid,progress,seriesId,playInfo,controller.signal);
              entry.size = entry.buffer.length;
            }
            if (controller.signal.aborted) throw new Error('Đã hủy phát');
            Object.assign(entry,{vid:sourceVid,source:/^custom:[^:]+/.exec(sourceVid)?.[0] || /^(xifan|hema):/.exec(sourceVid)?.[1] || 'hongguo',complete:true});
            return entry;
          });
          prepared.lastUsed = Date.now();
          // Every waiter owns the finished file before eviction can remove its cache entry.
          for (const active of onlineSessions.values()) if (active.job === job) active.entry = {...prepared};
          if (prepared.complete && onlinePreparing.get(key) === job) { onlineCache.set(key,prepared); trimOnlineCache(); }
          return prepared;
        })().finally(() => { if (onlinePreparing.get(key) === job) onlinePreparing.delete(key); }));
        onlinePreparing.set(key, job);
      }
      session.job = job;
      entry = await job.promise;
    }
    if (!onlineSessions.has(streamId)) throw new Error('Đã hủy phát');
    session.entry = { ...entry }; entry.lastUsed = Date.now();
    return { success: true, url: `${STREAM_SCHEME}://play/${streamId}`, streamId, size: entry.size,
      cached, streaming: !!entry.playInfo, codec: entry.codec || '' };
  } catch (error) {
    releaseOnlineSession(streamId);
    return { success: false, error: error.message, code: error.code };
  }
});

ipcMain.handle('release-online-play', async (event, payload = {}) => {
  for (const [id, session] of [...onlineSessions]) {
    if ((payload.streamId && id === payload.streamId) || (payload.requestId && session.requestId === payload.requestId)) releaseOnlineSession(id);
  }
  return { success: true };
});

ipcMain.handle('online-cache-status', async () => {
  const items = [...onlineCache.entries()].map(([vid, e]) => ({
    vid, size: e.size, vidIndex: e.vidIndex, seriesId: e.seriesId,
  }));
  return { success: true, count: items.length, bytes: onlineCacheTotal(), items };
});

async function clearSeriesPlaybackCache(sid) {
  const belongs = entry => String(entry?.seriesId || '') === sid;
  const jobs = new Set([...onlineSessions.values()].filter(belongs).map(session => session.job).filter(Boolean));
  for (const [id, session] of [...onlineSessions]) if (belongs(session)) releaseOnlineSession(id);
  await Promise.allSettled([...jobs].filter(job => ![...onlineSessions.values()].some(session => session.job === job)).map(job => job.promise));
  for (const [key, entry] of [...onlineCache]) if (belongs(entry)) deleteOnlineCacheEntry(key);

  const cacheDir = path.resolve(getCompatDir());
  const base = sanitizeFolderName(sid);
  if (!base || seriesRegistry.some(item => String(item.series_id) !== sid && sanitizeFolderName(String(item.series_id)) === base)) {
    throw new Error('兼容缓存文件名与其他剧冲突，已停止清理');
  }
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(`^${escaped}_(\\d{3,})(?:_(?:720p|1080p))?\\.mp4(?:\\.part)?$`);
  const ownsName = name => {
    const match = namePattern.exec(name);
    const index = match ? Number(match[1]) : 0;
    return !!match && Number.isSafeInteger(index) && index > 0 && match[1] === String(index).padStart(3, '0');
  };
  const outputForName = name => path.join(cacheDir, name.replace(/\.part$/, ''));

  const active = [...compatPreparing].filter(([output]) =>
    path.dirname(path.resolve(output)) === cacheDir && ownsName(path.basename(output)));
  for (const [output, job] of active) {
    job.cancelled = true;
    job.controller.abort();
    await job.promise;
  }

  let entries;
  try { entries = await fsp.readdir(cacheDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !ownsName(entry.name)) continue;
    const file = path.join(cacheDir, entry.name);
    const output = outputForName(entry.name);
    const job = compatPreparing.get(output);
    if (job) {
      job.cancelled = true;
      job.controller.abort();
      await job.promise;
      continue;
    }
    if (isFileInUse(file)) continue;
    try { await fsp.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
ipcMain.handle('clear-series-playback-cache', async (_event, seriesId) => {
  try { await clearSeriesPlaybackCache(String(seriesId)); return { success: true }; }
  catch { return { success: false, error: '部分播放缓存未能清理，请停止播放后重试' }; }
});

ipcMain.handle('discover-cast-devices', async () => {
  try { return { success: true, devices: await casting.discover() }; }
  catch { return { success: false, error: '搜索电视失败，请检查局域网连接和防火墙' }; }
});
ipcMain.handle('start-casting', async (_event, payload = {}) => {
  if (castBusy) return { success: false, error: '正在连接电视，请稍候', ...casting.status() };
  castBusy = true;
  let pinned, pinnedFile, released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (pinnedFile) {
      const remaining = (castFileRefs.get(pinnedFile) || 1) - 1;
      if (remaining) castFileRefs.set(pinnedFile, remaining); else castFileRefs.delete(pinnedFile);
    }
    if (pinned?.disk) { pinned.disk.readers--; disposeOnlineDisk(pinned); }
  };
  try {
    const source = String(payload.source || '');
    const file = mediaAccess.resolveLocal(source);
    let media;
    if (file) media = { filePath: file };
    else {
      const url = new URL(source);
      const entry = url.protocol === `${STREAM_SCHEME}:` && url.hostname === 'play' && onlineSessions.get(url.pathname.slice(1))?.entry;
      if (!entry?.complete) throw new Error('请先完整缓存本集');
      pinned = entry;
      if (entry.disk) entry.disk.readers++;
      media = { buffer: entry.buffer, filePath: entry.filePath };
    }
    pinnedFile = media.filePath;
    if (pinnedFile) castFileRefs.set(pinnedFile, (castFileRefs.get(pinnedFile) || 0) + 1);
    const result = await casting.start(String(payload.deviceId), { ...media, title: String(payload.title || '').slice(0,150), release });
    return { success: true, ...result, ...casting.status() };
  } catch (error) {
    release();
    return { success: false, error: '连接电视失败，请确认电视可用并重试', ...casting.status() };
  } finally { castBusy = false; }
});
ipcMain.handle('control-casting', async (_event, action) => {
  if (castBusy && action !== 'Stop') return { success: false, error: '正在连接电视，请稍候', ...casting.status() };
  try { await casting.control(action); return { success: true, ...casting.status() }; }
  catch { return { success: false, error: '电视控制失败，请重新连接', ...casting.status() }; }
});

ipcMain.handle('clear-online-cache', async () => {
  clearOnlineCache();
  return { success: true };
});

// ===== Chế độ tương thích: Chuyển HEVC sang H.264, giải quyết "màn hình đen có tiếng" =====
const COMPAT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // Giới hạn bộ nhớ đệm chuyển mã
let compatDir = null;
let compatEncoder = null; // Bộ mã hóa H.264 tối ưu được phát hiện

function getCompatDir() {
  if (!compatDir) {
    compatDir = path.join(app.getPath('userData'), 'compat-cache');
    try { fs.mkdirSync(compatDir, { recursive: true }); } catch (_) {}
    // No jobs have used this directory yet; remove leftovers from an interrupted run.
    try {
      for (const name of fs.readdirSync(compatDir)) {
        if ((name.startsWith('.tmp_') && name.endsWith('.mp4')) || name.endsWith('.mp4.part')) {
          try { fs.unlinkSync(path.join(compatDir, name)); } catch (_) {}
        }
      }
    } catch (_) {}
  }
  return compatDir;
}

function compatFileName(seriesId, vidIndex, quality = 'auto') {
  if (!['string', 'number'].includes(typeof vidIndex) || !/^[1-9]\d*$/.test(String(vidIndex))
    || !Number.isSafeInteger(Number(vidIndex))) throw new Error('Số tập phải là số nguyên dương hợp lệ');
  return `${sanitizeFolderName(String(seriesId))}_${String(Number(vidIndex)).padStart(3, '0')}${quality === 'auto' ? '' : `_${playbackQuality(quality)}`}.mp4`;
}

function compatPathFor(seriesId, vidIndex, quality = 'auto') {
  return path.join(getCompatDir(), compatFileName(seriesId, vidIndex, quality));
}

function compatCacheStatus() {
  const dir = getCompatDir();
  let files = 0;
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp4') || f.startsWith('.tmp_')) continue;
      try { bytes += fs.statSync(path.join(dir, f)).size; files++; } catch (_) {}
    }
  } catch (_) {}
  return { dir, files, bytes };
}

function trimCompatCache(currentOutput) {
  const dir = getCompatDir();
  const protectedFiles = new Set([currentOutput]);
  for (const [output, job] of compatPreparing) {
    protectedFiles.add(output);
    for (const file of job.files || []) protectedFiles.add(file);
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.mp4') && !f.startsWith('.tmp_'))
      .map((f) => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { p, size: st.size, at: st.atimeMs || st.mtimeMs };
      });
  } catch (_) { return; }
  let total = entries.reduce((s, e) => s + e.size, 0);
  if (total <= COMPAT_MAX_BYTES) return;
  entries.sort((a, b) => a.at - b.at); // Xóa mục truy cập sớm nhất trước
  for (const e of entries) {
    if (total <= COMPAT_MAX_BYTES) break;
    if (protectedFiles.has(e.p)) continue;
    try { fs.unlinkSync(e.p); total -= e.size; } catch (_) {}
  }
}

/** Dò tìm bộ mã hóa H.264 khả dụng: Đầu tiên xem danh sách, sau đó mã hóa thử 1 khung hình trên thực tế (có trong danh sách chưa chắc dùng được, ví dụ nvenc khi không có card NVIDIA) */
async function pickH264Encoder(ffmpegPath, task) {
  if (compatEncoder) return compatEncoder;
  const { execFile } = require('child_process');

  const list = await new Promise((resolve) => {
    const child = execFile(ffmpegPath, ['-hide_banner', '-encoders'], { timeout: 20000 }, (err, stdout) => {
      if (task?.child === child) delete task.child;
      resolve(String(stdout || ''));
    });
    if (task) task.child = child;
  });
  if (task?.cancelled) throw new Error('Đã hủy');

  const candidates = (process.platform === 'darwin'
    ? ['h264_videotoolbox', 'libx264']
    : ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'libx264']).filter((e) =>
    list.includes(e)
  );
  if (!candidates.includes('libx264')) candidates.push('libx264'); // Phần mềm làm dự phòng

  const works = (enc) =>
    new Promise((resolve) => {
      const child = execFile(
        ffmpegPath,
        ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
         '-frames:v', '1', '-c:v', enc, '-f', 'null', '-'],
        { timeout: 25000 },
        (err) => { if (task?.child === child) delete task.child; resolve(!err); }
      );
      if (task) task.child = child;
    });

  for (const enc of candidates) {
    if (task?.cancelled) throw new Error('Đã hủy');
    if (await works(enc)) {
      compatEncoder = enc;
      break;
    }
    console.log('[Compat] Bộ mã hóa không khả dụng, bỏ qua:', enc);
  }
  if (!compatEncoder) compatEncoder = 'libx264';
  console.log('[Compat] Sử dụng bộ mã hóa:', compatEncoder);
  return compatEncoder;
}

/**
 * Chuyển mã sang H.264/AAC.
 * Trả về { success, path, size, elapsed }
 */
const compatPreparing = new Map();
const compatRequests = new Map();
let compatClearing = null;
const compatCancelled = () => ({ success: false, cancelled: true, error: 'Đã hủy chuyển mã' });
function cancelCompatJob(job) {
  job.cancelled = true;
  job.controller.abort();
}
ipcMain.handle('cancel-transcode-for-playback', async (_event, payload = {}) => {
  if (!payload.seriesId || payload.vidIndex == null) return { success: false };
  let key;
  try { key = compatPathFor(payload.seriesId, payload.vidIndex, playbackQuality(payload.quality, payload.vid || payload.seriesId)); }
  catch (error) { return { success: false, error: error.message }; }
  const request = payload.requestId ? compatRequests.get(String(payload.requestId)) : null;
  // An old request must never fall back to cancelling the newest job for this episode.
  if (payload.requestId && (!request || request.key !== key)) return { success: true };
  const job = request ? request.job : compatPreparing.get(key);
  if (request) request.cancelled = true;
  if (job && (!request || [...job.requests.values()].every(item => item.cancelled))) {
    cancelCompatJob(job);
    await job.promise;
  }
  return { success: true };
});
ipcMain.handle('transcode-for-playback', async (event, payload = {}) => {
  if (!payload.seriesId || payload.vidIndex == null) return { success: false, error: 'Thiếu thông tin phim' };
  let key;
  try { key = compatPathFor(payload.seriesId, payload.vidIndex, playbackQuality(payload.quality, payload.vid || payload.seriesId)); }
  catch (error) { return { success: false, error: error.message }; }
  const requestId = String(payload.requestId || randomUUID());
  const existing = compatRequests.get(requestId);
  if (existing) return existing.key === key ? existing.promise : { success: false, error: 'Mã định danh yêu cầu đã được sử dụng cho phim khác' };
  // Register before every await, including permission lookup and a cancelled predecessor.
  const previous = compatPreparing.get(key);
  let job = previous;
  if (job && !job.cancelled && job.sourceVid !== String(payload.vid || '')) return { success: false, error: 'Tập này đã có yêu cầu chuẩn bị từ nguồn khác, vui lòng thử lại sau' };
  if (!job || job.cancelled) {
    job = { controller: new AbortController(), cancelled: false, requests: new Map(), files: new Set(), sourceVid: String(payload.vid || '') };
    const clearing = compatClearing;
    job.promise = Promise.resolve().then(async () => {
      if (previous) await previous.promise;
      if (clearing) await clearing;
      if (job.cancelled) return compatCancelled();
      return transcodeForPlayback(payload, job);
    }).catch(error => ({ success: false, error: error.message })).finally(() => {
      if (compatPreparing.get(key) === job) compatPreparing.delete(key);
    });
    compatPreparing.set(key, job);
  }
  const request = { key, job, requestId, cancelled: false };
  job.requests.set(requestId, request);
  compatRequests.set(requestId, request);
  request.promise = job.promise.then(result => ({ ...(request.cancelled ? compatCancelled() : result), requestId })).finally(() => {
    job.requests.delete(requestId);
    if (compatRequests.get(requestId) === request) compatRequests.delete(requestId);
  });
  return request.promise;
});

async function transcodeForPlayback(payload, job = { controller: new AbortController() }) {
  let tmpInput, tmpOut, diskInput;
  const signal = job.controller.signal;
  const checkCancelled = () => { if (signal.aborted) throw new Error('Đã hủy chuyển mã'); };
  const abortPreparation = () => {
    const child = job.child;
    if (!child) return;
    try { child.kill('SIGTERM'); } catch (_) {}
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000);
    timer.unref?.();
    child.once('close', () => clearTimeout(timer));
  };
  const reportProgress = data => {
    if (!job.requests) return sendToRenderer('transcode-progress', { ...data, requestId: payload.requestId });
    for (const request of job.requests.values()) {
      if (!request.cancelled) sendToRenderer('transcode-progress', { ...data, requestId: request.requestId });
    }
  };
  signal.addEventListener('abort', abortPreparation, { once: true });
  try {
    checkCancelled();
    const { seriesId, vidIndex, filePath, force } = payload || {};
    const quality = playbackQuality(payload.quality, payload.vid || seriesId);
    if (!seriesId || vidIndex == null) return { success: false, error: 'Thiếu thông tin phim' };
    const out = compatPathFor(seriesId, vidIndex, quality);
    job.files ||= new Set();
    if (filePath) job.files.add(filePath);
    if (filePath && fs.existsSync(filePath) && !isInsideMediaRoot(filePath) && !isRecordedMediaFile(filePath, payload)) {
      return { success: false, error: 'Chỉ có thể chuyển mã video trong thư mục tải xuống' };
    }
    if (!(filePath && fs.existsSync(filePath)) && (/^(xifan|hema|custom):/.test(String(seriesId)) || /^(xifan|hema|custom):/.test(String(payload.vid)))) {
      const current = await hongguo.fetchEpisodeList(seriesId);
      checkCancelled();
      const episode = current.episodes.find(ep => Number(ep.vid_index) === Number(vidIndex));
      if (!episode || (payload.vid && payload.vid !== episode.vid)) return { success: false, error: 'Nguồn tập phim không khớp' };
      if (episode.locked) return { success: false, error: 'Tập này đã bị khóa, vui lòng mở khóa trên nền tảng nguồn' };
    }

    if (!force && fs.existsSync(out) && fs.statSync(out).size > 1024 * 100) {
      // Trúng bộ nhớ đệm (Cache hit)
      try { fs.utimesSync(out, new Date(), new Date()); } catch (_) {}
      return { success: true, url: localPlayUrl(out), size: fs.statSync(out).size, cached: true };
    }

    const ffmpegPath = resolveFfmpeg('ffmpeg');
    const ffprobePath = resolveFfmpeg('ffprobe');
    if (!ffmpegPath) return { success: false, error: 'Không tìm thấy FFmpeg, không thể chuyển mã' };

    // 1) Ưu tiên tệp gốc cục bộ; khi buộc tạo lại thì bỏ qua bộ nhớ đệm trực tuyến, lấy lại nguồn đầu vào.
    let inputPath = filePath || null;
    if (!inputPath || !fs.existsSync(inputPath)) {
      const vid = payload.vid;
      if (!vid) return { success: false, error: 'Không có tệp cục bộ và cũng không có vid' };
      const cached = !force && onlineCache.get(onlineCacheKey(vid, quality));
      if (cached?.filePath) { diskInput = cached; cached.disk.readers++; inputPath = cached.filePath; }
      else {
        const playInfo = String(vid).startsWith('custom:') ? await hongguo.fetchPlayUrlSingle(String(vid),seriesId,{force:!!force,quality}) : null;
        tmpInput = path.join(getCompatDir(), `.tmp_${randomUUID()}.mp4`);
        if (playInfo) await withMediaRecovery(vid,seriesId,{playInfo,signal,quality},async candidate => {
          if (candidate.format === 'hls') await prepareHlsFile(candidate,tmpInput,{signal});
          else {
            const buf = await fetchDecryptedEpisodeOnce(String(vid),()=>{},seriesId,candidate,signal);
            checkCancelled(); fs.writeFileSync(tmpInput,buf);
          }
        });
        else {
          const buf = cached?.buffer || await fetchDecryptedEpisode(String(vid), () => {}, seriesId, playInfo, signal, ONLINE_MAX_BYTES, !!force, quality);
          checkCancelled(); fs.writeFileSync(tmpInput,buf);
        }
        inputPath = tmpInput;
      }
    }

    if (quality !== 'auto') await verifyDownloadQuality(inputPath, quality);
    const duration = ffprobePath ? await probeDuration(ffprobePath, inputPath, job) : 0;
    checkCancelled();
    let encoder = force ? 'libx264' : await pickH264Encoder(ffmpegPath, job);
    checkCancelled();

    const started = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      checkCancelled();
      // 2) Chuyển mã (Bộ mã hóa phần cứng dùng các tham số được đề xuất tương ứng)
      const encArgs = encoder === 'libx264'
        ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.2']
        : encoder === 'h264_videotoolbox'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', '6M', '-pix_fmt', 'yuv420p']
        : encoder === 'h264_nvenc'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-b:v', '0']
        : encoder === 'h264_qsv'
        ? ['-c:v', 'h264_qsv', '-global_quality', '23']
        : encoder === 'h264_amf'
        ? ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
        : ['-c:v', encoder, '-cq', '23'];

      tmpOut = out + '.part';
      try { fs.existsSync(tmpOut) && fs.unlinkSync(tmpOut); } catch (_) {}

      const { spawn } = require('child_process');
      const args = [
        '-y', '-hide_banner', '-i', inputPath,
        ...encArgs,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        '-f', 'mp4', tmpOut,
      ];

      console.log(`[Compat] Chuyển mã Tập ${vidIndex}  Bộ mã hóa=${encoder}  Thời lượng=${duration.toFixed(0)}s`);
      let stderrTail = '';
      const code = await new Promise((resolve) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        let killTimer;
        const abort = () => {
          try { child.kill('SIGTERM'); } catch (_) {}
          killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000);
          killTimer.unref?.();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        let buf = '';
        child.stdout.on('data', (d) => {
          buf += d.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const m = line.match(/^out_time_us=(\d+)/);
            if (m && duration > 0) {
              const sec = parseInt(m[1], 10) / 1e6;
              const pct = Math.max(0, Math.min(99, Math.floor((sec / duration) * 100)));
              reportProgress({ seriesId: String(seriesId), vidIndex: Number(vidIndex), percent: pct });
            }
          }
        });
        child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-1500); });
        child.on('error', (e) => { stderrTail += ' | spawn: ' + e.message; resolve(-1); });
        child.on('close', (c) => {
          signal.removeEventListener('abort', abort);
          clearTimeout(killTimer);
          resolve(c);
        });
      });
      checkCancelled();

      if (code !== 0 || !fs.existsSync(tmpOut)) {
        try { fs.existsSync(tmpOut) && fs.unlinkSync(tmpOut); } catch (_) {}
        const tail = stderrTail.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
        console.warn('[Compat] Chuyển mã thất bại code=', code, tail);
        if (encoder !== 'libx264') {
          encoder = 'libx264';
          continue;
        }
        return { success: false, error: `Chuyển mã phần mềm thất bại (mã thoát FFmpeg ${code})${tail ? ': ' + tail : ''}` };
      }
      break;
    }

    fs.renameSync(tmpOut, out);
    trimCompatCache(out);
    const size = fs.statSync(out).size;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[Compat] Hoàn thành ${(size / 1048576).toFixed(1)}MB  Thời gian ${elapsed}s`);

    reportProgress({ seriesId: String(seriesId), vidIndex: Number(vidIndex), percent: 100, done: true });
    return { success: true, url: localPlayUrl(out), size, elapsed: Number(elapsed), encoder };
  } catch (error) {
    if (signal.aborted) return compatCancelled();
    console.error('[Compat] Chuyển mã thất bại:', error.message);
    return { success: false, error: error.message, code: error.code };
  } finally {
    signal.removeEventListener('abort', abortPreparation);
    if (diskInput) { diskInput.disk.readers--; disposeOnlineDisk(diskInput); }
    for (const temporary of [tmpInput, tmpOut]) {
      if (temporary) { try { await fsp.unlink(temporary); } catch (_) {} }
    }
  }
}

ipcMain.handle('compat-cache-status', async () => {
  const st = compatCacheStatus();
  return { success: true, ...st, maxBytes: COMPAT_MAX_BYTES };
});

ipcMain.handle('clear-compat-cache', async () => {
  if (compatClearing) return compatClearing;
  const jobs = [...compatPreparing.values()];
  for (const job of jobs) cancelCompatJob(job);
  const clearing = Promise.all(jobs.map(job => job.promise)).then(() => {
    const dir = getCompatDir();
    let freed = 0, count = 0, failed = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.mp4') && !f.endsWith('.part')) continue;
        const p = path.join(dir, f);
        try { const size = fs.statSync(p).size; fs.unlinkSync(p); freed += size; count++; } catch (_) { failed++; }
      }
    } catch (_) { failed++; }
    return { success: failed === 0, count, freed, error: failed ? 'Xóa một phần bộ nhớ đệm tương thích thất bại, vui lòng thử lại sau' : undefined };
  }).finally(() => { if (compatClearing === clearing) compatClearing = null; });
  compatClearing = clearing;
  return clearing;
});

/** Báo cáo thiết bị hiện tại có thể giải mã HEVC không (dùng để giao diện hiển thị nhắc nhở trước) */
ipcMain.handle('decode-capability', async () => ({
  ffmpegEncoder: compatEncoder || null,
  compatDir: getCompatDir(),
}));



/**
 * Thêm nhiều tập vào hàng đợi tải (dùng chung cho tải hàng loạt và "Tải tập này" trên trình phát).
 * Trả về số lượng tác vụ mới tạo.
 */
async function enqueueEpisodes({ seriesId, seriesTitle, episodes, cover, quality, nasDestination }) {
  if (!Array.isArray(episodes) || episodes.length === 0) return 0;
  const settings = getCurrentSettings();
  const downloadQuality = normalizeDownloadQuality(quality ?? settings.download_quality);
  if (/^(xifan|hema|custom):/.test(String(seriesId))) {
    const current = await hongguo.fetchEpisodeList(seriesId);
    episodes = episodes.map(requested => {
      const ep = current.episodes.find(item => item.vid === requested.vid && Number(item.vid_index) === Number(requested.vid_index));
      if (!ep) throw new Error('Tập không thuộc nguồn đã chọn, vui lòng mở lại phim');
      if (ep.locked) throw new Error('Tập này đã bị khóa, vui lòng mở khóa trên nền tảng nguồn');
      return ep;
    });
  } else if (episodes.some(ep => /^(xifan|hema|custom):/.test(String(ep.vid)))) {
    throw new Error('Nguồn phim không khớp');
  }

  // Validate duplicate quality before changing the queue or files. Never replace a user's file.
  const nasReady = new Set();
  for (const ep of episodes) {
    const dup = downloadTasks.find(t => String(t.hongguoInfo?.vid) === String(ep.vid));
    if (dup && ['pending', 'downloading'].includes(dup.status) && normalizeDownloadQuality(dup.downloadQuality) !== downloadQuality) {
      throw new Error('Tập này đã có tác vụ tải xuống với độ phân giải khác, vui lòng dừng tác vụ đó trước khi chọn lại');
    }
    if (dup?.status === 'completed' && hasCompleteTaskFile(dup)) {
      dup.actualQuality = await verifyDownloadQuality(dup.savePath, downloadQuality, true);
    }
    if (nasDestination) {
      const finalPath = path.join(nasDestination.directory, nasEpisodeFilename(nasDestination, ep));
      if (dup && (dup.status === 'downloading' || runningDownloads.has(dup.id)) && dup.savePath !== finalPath)
        throw new Error('Phim này đang được tải xuống vị trí khác, vui lòng tạm dừng tải xuống trước khi chọn thư mục lưu mới');
      if (downloadTasks.some(task => task !== dup && task.savePath === finalPath && String(task.hongguoInfo?.vid) !== String(ep.vid)))
        throw new Error('Đường dẫn video trong thư mục đã chọn xung đột với tập khác, không ghi đè tệp hiện có');
      const target = await inspectNasEpisode(nasDestination, ep);
      if (target.status === 'existing') {
        await verifyDownloadQuality(target.path, downloadQuality, true);
        nasReady.add(String(ep.vid));
      } else if (dup?.status === 'completed' && hasCompleteTaskFile(dup)) {
        await copyNasEpisode(dup, nasDestination);
        nasReady.add(String(ep.vid));
      } else if (target.status === 'conflict') throw new Error('Thư mục đã chọn có video trùng tên chưa được xác nhận, không ghi đè, vui lòng kiểm tra rồi thử lại');
    }
  }
  // No await follows this check until queue persistence, so active runs cannot be retargeted midway.
  if (nasDestination && episodes.some(ep => downloadTasks.some(task => String(task.hongguoInfo?.vid) === String(ep.vid) &&
      (task.status === 'downloading' || runningDownloads.has(task.id)) && task.savePath !== path.join(nasDestination.directory, nasEpisodeFilename(nasDestination, ep)))))
    throw new Error('Phim này đang được tải xuống vị trí khác, vui lòng tạm dừng tải xuống trước khi chọn thư mục lưu mới');
  const root = (settings.root && String(settings.root).trim()) ? String(settings.root).trim() : app.getPath('downloads');
  const cleanSeriesTitle = sanitizeFolderName(seriesTitle) || 'Phim Ngắn Hồng Quả';
  const downloadDir = nasDestination ? nasDestination.directory : seriesDownloadDir(root, seriesId, cleanSeriesTitle);
  if (!nasDestination) { try { fs.mkdirSync(downloadDir, { recursive: true }); } catch (_) {} }

  const batchId = 'hongguobatch_' + randomUUID();
  const firstCover = cover || (episodes[0] && episodes[0].cover) || '';

  const batchInfo = {
    batchId,
    platform: 'hongguo',
    nickname: `《${cleanSeriesTitle}》`,
    avatar: firstCover,
    totalCount: episodes.length,
    createTime: Date.now(),
  };

  let created = 0;
  const changedTasks = [];
  const previousQueue = downloadQueue.slice();
  for (const ep of episodes) {
    const epIndexStr = String(ep.vid_index).padStart(3, '0');
    const filename = nasDestination ? nasEpisodeFilename(nasDestination, ep) : uniqueEpisodeFilename(settings, cleanSeriesTitle, ep);
    const finalPath = path.join(downloadDir, filename);

    // Đã có cùng một tập trong hàng đợi / đã hoàn thành, tránh tạo trùng tác vụ
    const dup = downloadTasks.find(
      (t) => t.hongguoInfo && String(t.hongguoInfo.vid) === String(ep.vid)
    );
    if (dup) {
      changedTasks.push({ task: dup, previous: { ...dup } });
      if (nasDestination) {
        Object.assign(dup, { savePath: finalPath, customDir: downloadDir, filename, nasDestination, downloadQuality, nasWarning: '', pathConflict: false });
        delete dup.nasTargets;
        if (nasReady.has(String(ep.vid)) && dup.status !== 'downloading' && !runningDownloads.has(dup.id)) {
          Object.assign(dup, { status: 'completed', progress: 100, endTime: Date.now() });
          delete dup.error;
          downloadQueue = downloadQueue.filter(task => task !== dup);
        }
      }
      // Xếp hàng lại các tác vụ đã dừng hoặc thất bại
      if (dup.status === 'stopped' || dup.status === 'failed' || (dup.status === 'completed' && !hasCompleteTaskFile(dup))) {
        repairTaskDestination(dup);
        dup.status = 'pending';
        dup.cancelled = false;
        dup.progress = 0;
        dup.receivedBytes = 0;
        dup.totalBytes = 0;
        dup.downloadQuality = downloadQuality;
        delete dup.actualQuality;
        delete dup.error;
        if (!downloadQueue.some((t) => t.id === dup.id)) downloadQueue.push(dup);
        created++;
      }
      continue;
    }

    const task = {
      id: randomUUID(),
      batchId,
      batchInfo,
      savePath: finalPath,
      customDir: downloadDir,
      title: `《${cleanSeriesTitle}》Tập ${epIndexStr}${ep.title ? ' ' + ep.title : ''}`,
      filename,
      platform: 'hongguo',
      type: 'hongguo',
      downloadQuality,
      ...(nasDestination ? { nasDestination } : {}),
      status: nasReady.has(String(ep.vid)) ? 'completed' : 'pending',
      progress: nasReady.has(String(ep.vid)) ? 100 : 0,
      receivedBytes: 0,
      totalBytes: 0,
      startTime: Date.now(),
      videoInfo: {
        author: cleanSeriesTitle,
        title: `《${cleanSeriesTitle}》Tập ${epIndexStr}`,
        cover: ep.cover || firstCover,
        aweme_id: ep.vid,
      },
      hongguoInfo: {
        vid: ep.vid,
        series_id: seriesId,
        series_title: cleanSeriesTitle,
        vid_index: ep.vid_index,
        ep_title: ep.title,
      },
    };

    downloadTasks.unshift(task);
    if (task.status === 'pending') downloadQueue.push(task);
    sendToRenderer('download-task-added', task);
    if (task.status === 'pending') created++;
  }

  try { saveDownloadTasks(); }
  catch (error) {
    // An unpersisted submission must not start later through another queue action.
    downloadTasks = downloadTasks.filter(task => task.batchId !== batchId);
    restoreQueueTasks({ snapshots: changedTasks, previousQueue });
    throw error;
  }
  pumpQueue();
  return created;
}

const nasSubmissions = new Set();
ipcMain.handle('download-series-to-nas', async (_event, seriesId, quality) => {
  const sid = String(seriesId || '');
  if (nasSubmissions.has(sid)) return { success: false, error: 'Phim này đang được sắp xếp vào NAS, vui lòng chờ hoàn thành lần gửi này' };
  nasSubmissions.add(sid);
  try {
    const entry = seriesRegistry.find(item => String(item.series_id) === sid);
    if (!entry?.episodes?.length) return { success: false, error: 'Không tìm thấy hồ sơ phim này, vui lòng mở phim trước' };
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục chia sẻ NAS đã gắn kết', buttonLabel: 'Lưu vào thư mục này', properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { success: false, canceled: true };
    const folderName = `${sanitizeFolderName(entry.series_title) || 'Phim ngắn chưa đặt tên'}-${createHash('sha256').update(sid).digest('hex').slice(0, 12)}`;
    const { destination, warnings } = await prepareNasExport({ root: selection.filePaths[0], folderName, series: entry });
    const wanted = entry.episodes.filter(episode => !episode.locked);
    const locked = entry.episodes.length - wanted.length;
    if (locked) warnings.push(`${locked} tập đã bị khóa, cần mở khóa trên nền tảng nguồn trước khi tải`);
    const count = await enqueueEpisodes({ seriesId: sid, seriesTitle: entry.series_title, episodes: wanted,
      cover: entry.cover, quality, nasDestination: destination });
    const copied = wanted.filter(episode => downloadTasks.some(task => String(task.hongguoInfo?.series_id) === sid &&
      String(task.hongguoInfo?.vid) === String(episode.vid) && task.nasDestination?.directory === destination.directory &&
      task.status === 'completed' && hasCompleteTaskFile(task))).length;
    return { success: true, count, copied, warnings, directory: destination.directory };
  } catch (error) { return { success: false, error: error.message || 'Gửi tải về NAS thất bại, vui lòng kiểm tra thư mục chia sẻ rồi thử lại' }; }
  finally { nasSubmissions.delete(sid); }
});

ipcMain.handle('hongguo-download-batch', async (event, payload) => {
  try {
    const { seriesId, seriesTitle, episodes, quality, export: exportKinds } = payload || {};
    if (!Array.isArray(episodes) || episodes.length === 0) {
      return { success: false, error: 'Chưa chọn số tập' };
    }
    const count = await enqueueEpisodes({ seriesId, seriesTitle, episodes, quality });
    const kinds = normalizeTextExportKinds(exportKinds);
    const exportRequested = /^\d{6,30}$/.test(String(seriesId)) && Object.values(kinds).some(Boolean);
    const requestId = typeof payload.requestId === 'string' && payload.requestId.length <= 128 && payload.requestId
      ? payload.requestId : randomUUID();
    if (exportRequested) {
      Promise.resolve().then(() => {
        // Reuse persisted task destinations, including old settings and repaired filename conflicts.
        const destinations = episodes.map(ep => {
          const task = downloadTasks.find(item => String(item.hongguoInfo?.series_id) === String(seriesId)
            && String(item.hongguoInfo?.vid) === String(ep.vid));
          if (!task?.savePath) throw new Error('Không tìm thấy đường dẫn tải tập phim, vui lòng gửi lại');
          return { vid: String(task.hongguoInfo.vid), vid_index: task.hongguoInfo.vid_index, savePath: task.savePath };
        });
        const title = sanitizeFolderName(seriesTitle) || 'Phim Ngắn Hồng Quả';
        return exportSeriesText({ seriesId: String(seriesId), seriesTitle, episodes: destinations, kinds,
          reviewsPath: path.join(path.dirname(destinations[0].savePath), `${title}.reviews.json`) });
      }).then(result => sendToRenderer('text-export-done', { ...result, requestId, seriesId, kinds }))
        .catch(error => sendToRenderer('text-export-done', {
          requestId, seriesId, kinds, failed: true, error: String(error?.message || error),
        }));
    }
    return { success: true, count, requested: episodes.length, exportRequested, requestId };
  } catch (error) {
    console.error('[Hongguo] Gửi tải xuống hàng loạt thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// Nút "Tải tập này" trong trình phát: Bổ sung một tập theo series_id + vid_index
ipcMain.handle('download-single-episode', async (event, seriesId, vidIndex, quality) => {
  try {
    const entry = seriesRegistry.find((s) => String(s.series_id) === String(seriesId));
    if (!entry) return { success: false, error: 'Không tìm thấy hồ sơ phim này, vui lòng phân tích lại một lần' };
    const ep = entry.episodes.find((e) => Number(e.vid_index) === Number(vidIndex));
    if (!ep) return { success: false, error: 'Không tìm thấy tập này' };
    const count = await enqueueEpisodes({
      seriesId: entry.series_id,
      seriesTitle: entry.series_title,
      episodes: [{ ...ep, cover: entry.cover }],
      cover: entry.cover,
      quality,
    });
    return { success: true, count };
  } catch (error) {
    console.error('[Player] Tải tập đơn thất bại:', error.message);
    return { success: false, error: error.message };
  }
});

// ===== Lịch sử xem và kiểm tra cập nhật =====
let historyRefresh = null;
const historyItemChecks = new Map();
const historySequelPending = new Map();
const historySequelCache = new Map();
const accountResumePositions = new Map();
const HISTORY_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const HISTORY_COMPLETED_LOW_INTERVAL = 24 * 60 * 60 * 1000;
const HISTORY_SEQUEL_INTERVAL = 24 * 60 * 60 * 1000;
const HISTORY_BATCH_BUDGET = 90 * 1000;
const HISTORY_ITEM_TIMEOUT = 10 * 1000;
const HISTORY_SEQUEL_TIMEOUT = 12 * 1000;
const HISTORY_GROUP_CONCURRENCY = 2;
const HISTORY_EPISODE_CONCURRENCY = 2;
const HISTORY_SEQUEL_CACHE_TTL = 30 * 60 * 1000;
const HISTORY_SEQUEL_FAILURE_TTL = 5 * 60 * 1000;
const HISTORY_SCOPES = new Set(['all', 'latest', 'unfinished', 'skip-completed-low']);

function historyRows() {
  return watchHistory.listHistory(seriesRegistry, store.getPlayback(), getCurrentSettings().watch_sequels_enabled !== false);
}

let accountService = null;
let accountWebSession = null;
let accountCookieCleanup = null;
function getAccountWebSession() {
  accountWebSession ||= session.fromPartition('hongguo-account-login', { cache: false });
  return accountWebSession;
}

async function clearAccountCookies() {
  if (accountWebSession) await accountWebSession.clearStorageData({ storages: ['cookies'] });
  const cookies = await session.defaultSession.cookies.get({});
  await Promise.all(cookies
    .filter(cookie => /(?:^|\.)hongguoduanju\.com$/i.test(String(cookie.domain || '')))
    .map(async cookie => {
      const host = String(cookie.domain || '').replace(/^\./, '');
      if (!host) return;
      try { await session.defaultSession.cookies.remove(`https://${host}${cookie.path || '/'}`, cookie.name); } catch {}
    }));
}

function getAccountService() {
  if (!accountService) {
    accountCookieCleanup = clearAccountCookies().catch(error => console.warn('[Account] Xóa Cookie đăng nhập cũ thất bại:', accountSafeMessage(error)));
    accountService = createAccountService({
      filePath: path.join(app.getPath('userData'), 'account-session.bin'), safeStorage,
      webRequest: accountWebRequest,
      onAccountExpired: () => {
        clearAccountCookies().catch(error => console.warn('[Account] Xóa Cookie đăng nhập thất bại:', error.message));
        sendToRenderer('account-updated', { signedIn: false });
      },
    });
  }
  return accountService;
}

async function accountWebRequest(url, options = {}) {
  const response = await getAccountWebSession().fetch(url, {
    method: options.method || 'GET', headers: options.headers || {}, redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  const headers = {};
  for (const [name, value] of response.headers) headers[name] = value;
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) headers['set-cookie'] = cookies;
  return { status: response.status, headers, data: await response.text() };
}

async function accountAction(action) {
  try { const service = getAccountService(); await accountCookieCleanup; return await action(service); }
  catch (error) {
    const message = accountSafeMessage(error);
    console.warn('[Account]', message);
    return { success: false, error: message };
  }
}

function historyOptions(value) {
  const raw = typeof value === 'boolean' ? { force: value } : (value && typeof value === 'object' ? value : {});
  return { force: raw.force === true, scope: HISTORY_SCOPES.has(raw.scope) ? raw.scope : 'all' };
}

function historyGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = watchHistory.familyKey(row) || `series:${row.series_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

function historyFamilyRows(allRows, row) {
  const key = watchHistory.familyKey(row);
  return key ? allRows.filter(item => watchHistory.familyKey(item) === key) : [row];
}

function historyScopeRows(rows, scope) {
  if (scope === 'latest') return rows.filter(row => row.isLatestSeason);
  if (scope === 'unfinished') return rows.filter(row => !row.completed);
  if (scope === 'skip-completed-low') return rows.filter(row => !(row.completed && !row.isLatestSeason));
  return rows;
}

function historyInterval(row) {
  return row.completed && !row.isLatestSeason ? HISTORY_COMPLETED_LOW_INTERVAL : HISTORY_CHECK_INTERVAL;
}

function historyPriority(row) {
  if (row.hasUpdates) return 0;
  if (!row.completed) return 1;
  if (row.isLatestSeason) return 2;
  return 3;
}

function historyDeadline(ms) {
  return Date.now() + ms;
}

function historyTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms)); }),
  ]).finally(() => clearTimeout(timer));
}

async function runHistoryPool(items, concurrency, worker, deadline = 0) {
  let cursor = 0;
  const width = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: width }, async () => {
    while (cursor < items.length) {
      if (deadline && Date.now() >= deadline) return;
      const item = items[cursor++];
      await worker(item);
    }
  }));
}

function historySequelResult(series, deadline, retryFailed = false) {
  const key = watchHistory.familyKey(series) || `series:${series.series_id}`;
  const now = Date.now();
  let cached = historySequelCache.get(key);
  if (retryFailed && cached && (cached.result?.success !== true || cached.result?.partial === true)) {
    historySequelCache.delete(key);
    cached = null;
  }
  if (cached && cached.expires > now) return Promise.resolve(cached.result);
  if (historySequelPending.has(key)) return historySequelPending.get(key);
  const task = (async () => {
    const searchDeadline = Math.min(deadline || historyDeadline(HISTORY_SEQUEL_TIMEOUT), historyDeadline(HISTORY_SEQUEL_TIMEOUT));
    const local = watchHistory.findSequels(series, seriesRegistry.filter(item => !item.forgotten));
    let result;
    try {
      result = await historyTimeout(seriesSearch.findSeriesSequels(series, seriesRegistry.filter(item => !item.forgotten),
        (keyword, call) => searchAtSource(keyword, {
          source: watchHistory.sourceOf(String(series.series_id)), deadline: searchDeadline, ...(call || {}),
        }), { deadline: searchDeadline }), Math.max(1000, searchDeadline - Date.now()), 'Tìm kiếm phần tiếp theo quá thời gian');
    } catch (error) {
      result = { success: false, results: local, candidates: local, partial: true, error: error.message };
    }
    const ok = result?.success === true && result?.partial !== true;
    historySequelCache.set(key, {
      result, expires: Date.now() + (ok ? HISTORY_SEQUEL_CACHE_TTL : HISTORY_SEQUEL_FAILURE_TTL),
    });
    if (historySequelCache.size > 64) historySequelCache.delete(historySequelCache.keys().next().value);
    return result;
  })().finally(() => historySequelPending.delete(key));
  historySequelPending.set(key, task);
  return task;
}

function historyContext(rows, allRows, force, deadline, retryFailed = false) {
  const familyRows = historyFamilyRows(allRows, rows[0]);
  const latest = familyRows.reduce((best, row) => watchHistory.seasonOf(row) > watchHistory.seasonOf(best) ? row : best, familyRows[0]);
  const sequelDue = new Set();
  if (getCurrentSettings().watch_sequels_enabled !== false) {
    for (const row of rows) {
      const previous = store.getPlayback()[String(row.series_id)];
      if (force || Date.now() - (previous?.lastSequelCheckAt || 0) >= HISTORY_SEQUEL_INTERVAL) sequelDue.add(String(row.series_id));
    }
  }
  const latestSeries = seriesRegistry.find(item => String(item.series_id) === String(latest.series_id));
  const sequelPromise = sequelDue.size && latestSeries && watchHistory.sourceOf(String(latestSeries.series_id))
    ? historySequelResult(latestSeries, deadline, retryFailed) : null;
  return { sequelDue, sequelPromise, deadline, notifiedSequelIds: new Set() };
}

async function checkHistoryRow(row, context) {
  const sid = String(row.series_id);
  if (historyItemChecks.has(sid)) return historyItemChecks.get(sid);
  const task = (async () => {
    const itemDeadline = Math.min(context.deadline, historyDeadline(HISTORY_ITEM_TIMEOUT));
    try {
      const fresh = await historyTimeout(hongguo.fetchEpisodeList(sid, { force: true, deadline: itemDeadline }),
        Math.max(1, itemDeadline - Date.now()), 'Kiểm tra cập nhật tập phim quá thời gian');
      if (!Array.isArray(fresh?.episodes) || !fresh.episodes.length) throw new Error('Nguồn phim không trả về tập nào, vui lòng thử lại sau');

      let sequelResponse = null;
      if (context.sequelPromise && context.sequelDue.has(sid)) sequelResponse = await context.sequelPromise;

      // Re-read after network waits: a concurrent player save or episode refresh must not be rolled back.
      const map = store.getPlayback();
      if (!map[sid]) return { status: 'skipped' };
      const currentSeries = seriesRegistry.find(item => String(item.series_id) === sid);
      if (!currentSeries) return { status: 'skipped' };
      const previousRecord = map[sid];
      const next = watchHistory.applyEpisodeUpdate(previousRecord, currentSeries, fresh);
      if (sequelResponse) {
        const candidates = watchHistory.findSequels(currentSeries, sequelResponse.candidates || sequelResponse.results || []);
        const combined = new Map((previousRecord.sequels || []).map(item => [item.series_id, item]));
        for (const item of candidates) combined.set(item.series_id, item);
        next.sequels = [...combined.values()].slice(-20);
        next.similarSeries = watchHistory.findSimilarSeries(currentSeries,
          [...(Array.isArray(previousRecord.similarSeries) ? previousRecord.similarSeries : []), ...(sequelResponse.candidates || sequelResponse.results || [])]);
        next.lastSequelCheckError = sequelResponse.partial ? (sequelResponse.error || 'Vui lòng thử lại sau') : '';
        if (sequelResponse.success === true && sequelResponse.partial !== true) next.lastSequelCheckAt = Date.now();
      }
      next.lastCheckError = next.lastSequelCheckError ? `Chưa hoàn thành kiểm tra phần tiếp theo: ${next.lastSequelCheckError}` : '';
      const newEpisodes = next.knownTotal > (previousRecord.knownTotal ?? currentSeries.total ?? currentSeries.episodes?.length ?? 0);
      const knownSequels = new Set((previousRecord.sequels || []).map(item => item.series_id));
      const rowCandidates = sequelResponse
        ? watchHistory.findSequels(currentSeries, sequelResponse.candidates || sequelResponse.results || [])
        : [];
      const newSequel = sequelResponse?.success === true && rowCandidates.some(item => !knownSequels.has(item.series_id));
      if (fresh.episodes.length >= (currentSeries.episodes?.length || 0)) {
        const wasDismissed = currentSeries.dismissed === true;
        const wasForgotten = currentSeries.forgotten === true;
        upsertSeriesRegistry(fresh);
        if (wasDismissed) {
          Object.assign(seriesRegistry.find(item => String(item.series_id) === sid), { dismissed: true, forgotten: wasForgotten });
          saveSeriesRegistry();
        }
      }
      map[sid] = next;
      store.savePlayback(map);
      const settings = getCurrentSettings();
      const unseenSequels = rowCandidates.filter(item => !knownSequels.has(item.series_id) && !context.notifiedSequelIds.has(item.series_id));
      for (const item of unseenSequels) context.notifiedSequelIds.add(item.series_id);
      if ((newEpisodes || unseenSequels.length) && settings.watch_notifications_enabled === true && Notification?.isSupported()) {
        try {
          const title = currentSeries.series_title || fresh.series_title || 'Phim ngắn';
          const notification = new Notification({ title: `${title} có bản cập nhật mới`,
            body: newEpisodes ? `Đã cập nhật đến tập ${next.knownTotal}, mở lịch sử xem để tiếp tục.` : 'Phát hiện phần mới nghi vấn, mở lịch sử xem để kiểm tra.' });
          notification.on('click', () => {
            if (!mainWindow || mainWindow.isDestroyed()) createWindow();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show(); mainWindow.focus();
            sendToRenderer('navigate', { page: 'history' });
          });
          notification.show();
        } catch (error) { console.warn('[History] Thông báo hệ thống không khả dụng:', error.message); }
      }
      return { status: 'checked', hasUpdates: newEpisodes || newSequel,
        error: next.lastEpisodeCheckError || next.lastSequelCheckError || '' };
    } catch (error) {
      const map = store.getPlayback();
      if (map[sid]) {
        map[sid] = { ...map[sid], lastCheckedAt: Date.now(), lastEpisodeCheckError: error.message,
          lastSequelCheckError: map[sid].lastSequelCheckError || '', lastCheckError: error.message };
        store.savePlayback(map);
      }
      return { status: 'failed', error: error.message };
    }
  })().finally(() => historyItemChecks.delete(sid));
  historyItemChecks.set(sid, task);
  return task;
}

async function refreshWatchHistory(forceOrOptions = false) {
  if (historyRefresh) return historyRefresh;
  const options = historyOptions(forceOrOptions);
  if (!options.force && getCurrentSettings().watch_updates_enabled === false) {
    return { success: true, checked: 0, failed: 0, remaining: 0, disabled: true };
  }
  historyRefresh = (async () => {
    const now = Date.now();
    const allRows = historyRows();
    const scoped = historyScopeRows(allRows, options.scope);
    const eligible = scoped.filter(item => options.force || now - item.lastCheckedAt >= historyInterval(item));
    const groups = historyGroups(eligible).sort((a, b) => {
      const priority = rows => Math.min(...rows.map(historyPriority));
      return priority(a) - priority(b) || Math.max(...b.map(row => row.updatedAt)) - Math.max(...a.map(row => row.updatedAt));
    });
    const deadline = historyDeadline(HISTORY_BATCH_BUDGET);
    const processed = new Set();
    let checked = 0, failed = 0, skipped = 0;
    sendToRenderer('watch-history-progress', { phase: 'start', total: eligible.length, checked, failed, current: '', remaining: eligible.length });
    await runHistoryPool(groups, HISTORY_GROUP_CONCURRENCY, async group => {
      if (Date.now() >= deadline) return;
      const context = historyContext(group, allRows, options.force, deadline, options.force);
      await runHistoryPool(group, HISTORY_EPISODE_CONCURRENCY, async row => {
        const result = await checkHistoryRow(row, context);
        processed.add(String(row.series_id));
        if (result.status === 'checked') { checked++; if (result.error) failed++; }
        else if (result.status === 'failed') failed++;
        else skipped++;
        const remaining = eligible.filter(item => !processed.has(String(item.series_id))).length;
        sendToRenderer('watch-history-progress', {
          phase: 'running', total: eligible.length, checked, failed, skipped, current: row.series_title, remaining,
        });
      }, deadline);
    }, deadline);
    const remaining = eligible.filter(item => !processed.has(String(item.series_id))).length;
    sendToRenderer('watch-history-progress', { phase: 'done', total: eligible.length, checked, failed, skipped, current: '', remaining });
    sendToRenderer('watch-history-updated', {});
    return { success: true, checked, failed, skipped, remaining, total: eligible.length, scope: options.scope };
  })().catch(error => ({ success: false, error: error.message })).finally(() => { historyRefresh = null; });
  return historyRefresh;
}

ipcMain.handle('remove-watch-history', async (_event, seriesId) => {
  try {
    const map = { ...store.getPlayback() };
    delete map[String(seriesId)];
    store.savePlayback(map);
    sendToRenderer('watch-history-updated', { removedSeriesId: String(seriesId) });
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-watch-history', async () => ({ success: true, results: historyRows() }));
ipcMain.handle('refresh-watch-history', async (_event, options) => refreshWatchHistory({ force: true, scope: options?.scope }));
ipcMain.handle('check-watch-history-item', async (_event, seriesId) => {
  const sid = String(seriesId || '');
  const allRows = historyRows();
  const row = allRows.find(item => String(item.series_id) === sid);
  if (!row) return { success: false, error: 'Không tìm thấy lịch sử xem này, vui lòng làm mới rồi thử lại.' };
  const context = historyContext([row], allRows, true, historyDeadline(HISTORY_ITEM_TIMEOUT + HISTORY_SEQUEL_TIMEOUT), true);
  const result = await checkHistoryRow(row, context);
  sendToRenderer('watch-history-updated', {});
  return { success: result.status !== 'failed', checked: result.status === 'checked' ? 1 : 0,
    failed: result.status === 'failed' || result.error ? 1 : 0, status: result.status, error: result.error || '' };
});
ipcMain.handle('acknowledge-watch-updates', async (_event, seriesId, snapshot) => {
  try {
    const map = store.getPlayback();
    const sid = String(seriesId);
    if (map[sid]) { map[sid] = watchHistory.acknowledge(map[sid], snapshot); store.savePlayback(map); }
    sendToRenderer('watch-history-updated', {});
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

let accountLoginWindow = null;
ipcMain.handle('open-account-web-login', async () => {
  if (accountLoginWindow && !accountLoginWindow.isDestroyed()) { accountLoginWindow.focus(); return { success: true }; }
  getAccountService();
  await accountCookieCleanup;
  if (accountLoginWindow && !accountLoginWindow.isDestroyed()) { accountLoginWindow.focus(); return { success: true }; }
  getAccountService().cancelLogin();
  const win = new BrowserWindow({ width: 1000, height: 760, title: '红果官网登录', webPreferences: {
    session: getAccountWebSession(), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  accountLoginWindow = win;
  const official = value => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'hongguoduanju.com' || url.hostname.endsWith('.hongguoduanju.com')); } catch { return false; } };
  for (const name of ['will-navigate', 'will-redirect']) win.webContents.on(name, (event, url) => { if (!official(url)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const observer = require('./src/native/account-web-login').createWebLoginObserver({
    readCookies: () => getAccountWebSession().cookies.get({ url: 'https://hongguoduanju.com/' }),
    complete: cookie => accountAction(service => service.completeWebLogin(cookie)),
    cancel: () => getAccountService().cancelLogin(),
    onSignedIn: () => {
      sendToRenderer('account-updated', { signedIn: true });
      if (!win.isDestroyed()) win.close();
    },
    onError: error => console.warn('[Account]', accountSafeMessage(error)),
  });
  const changed = () => { void observer.inspect(); };
  getAccountWebSession().cookies.on('changed', changed);
  win.on('closed', () => {
    observer.close();
    getAccountWebSession().cookies.removeListener('changed', changed);
    if (accountLoginWindow === win) accountLoginWindow = null;
  });
  win.webContents.on('did-finish-load', changed);
  await win.loadURL('https://hongguoduanju.com/');
  return { success: true };
});

ipcMain.handle('get-account-status', async () => accountAction(service => service.status()));
ipcMain.handle('start-account-login', async () => {
  if (accountLoginWindow && !accountLoginWindow.isDestroyed()) accountLoginWindow.close();
  getAccountService().cancelLogin();
  await clearAccountCookies();
  return accountAction(service => service.startLogin());
});
ipcMain.handle('poll-account-login', async (_event, loginId) => {
  const result = await accountAction(service => service.pollLogin(String(loginId || '')));
  if (!result.success) await clearAccountCookies();
  if (result.status === 'signed-in') sendToRenderer('account-updated', { signedIn: true });
  return result;
});
ipcMain.handle('cancel-account-login', async (_event, loginId) => {
  const result = await accountAction(service => service.cancelLogin(String(loginId || '')));
  await clearAccountCookies();
  return result;
});
ipcMain.handle('logout-account', async () => {
  if (accountLoginWindow && !accountLoginWindow.isDestroyed()) accountLoginWindow.close();
  const result = await accountAction(service => service.logout());
  if (result.success) {
    await clearAccountCookies();
    sendToRenderer('account-updated', { signedIn: false });
  }
  return result;
});
ipcMain.handle('get-account-history', async (_event, options) => accountAction(service => service.history({ refresh: options?.refresh === true })));
ipcMain.handle('play-account-history', async (_event, seriesId) => {
  try {
    const sid = String(seriesId || '');
    if (!/^\d{1,30}$/.test(sid)) return { success: false, error: 'Mã lịch sử xem APP không hợp lệ' };
    const service = getAccountService();
    let row = service.row(sid);
    if (!row) {
      const refreshed = await service.refreshHistory();
      if (!refreshed.success) return refreshed;
      row = service.row(sid);
    }
    if (!row) return { success: false, error: 'Lịch sử xem APP đã thay đổi, vui lòng làm mới rồi thử lại' };
    let entry = seriesRegistry.find(item => String(item.series_id) === sid);
    if (!entry) {
      const data = await hongguo.fetchEpisodeList(sid);
      entry = upsertSeriesRegistry(data);
    }
    if (!entry || !entry.episodes?.length) return { success: false, error: 'Tạm thời không thể đọc các tập của phim này' };
    const episode = entry.episodes.find(item => String(item.vid) === String(row.episode_id))
      || (row.vid_index > 0 ? entry.episodes.find(item => Number(item.vid_index) === row.vid_index) : null);
    if (!episode) return { success: false, error: 'Tập tương ứng với tiến độ APP đã thay đổi, vui lòng mở lại phim này trong APP trước' };
    if (episode.locked) return { success: false, error: 'Tập phim ứng với tiến độ APP tạm thời không thể phát' };
    if (entry.dismissed) {
      entry.dismissed = false;
      entry.forgotten = false;
      saveSeriesRegistry();
    }
    accountResumePositions.set(sid, {
      vid_index: Number(episode.vid_index),
      currentTime: Math.max(0, Number(row.currentTime) || 0),
      updatedAt: Number(row.updatedAt) || Date.now(),
    });
    return navigateToPlayer({ seriesId: sid, vidIndex: episode.vid_index, resume: true });
  } catch (error) {
    accountResumePositions.delete(String(seriesId || ''));
    return { success: false, error: accountSafeMessage(error, 'Mở lịch sử xem của APP thất bại') };
  }
});

// ===== IPC: Cài đặt =====
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

const SETTINGS_KEYS = ['root', 'name_format', 'max_concurrent', 'download_resolve_interval', 'download_quality', 'export_text', 'auto_delete_watched', 'compat_mode', 'cache_next_episode', 'picture_in_picture_mode', 'show_danmaku_controls', 'app_updates_enabled', 'watch_updates_enabled', 'watch_sequels_enabled', 'watch_notifications_enabled', 'search_app_enabled', 'proxy_enabled', 'proxy_mode', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password'];

function normalizeTextExportKinds(value) {
  return { danmaku: value?.danmaku === true, comments: value?.comments === true, reviews: value?.reviews === true };
}

function settingsForRenderer(settings) {
  const copy = { ...settings };
  copy.proxy_password_set = !!copy.proxy_password;
  delete copy.proxy_password;
  return copy;
}

function applyEditableSettings(current, incoming) {
  const source = normalizeProxySettings(incoming && typeof incoming === 'object' ? incoming : {});
  if (Object.prototype.hasOwnProperty.call(source, 'picture_in_picture_mode')
    && !['native', 'custom'].includes(source.picture_in_picture_mode)) throw new Error('Chế độ cửa sổ thu nhỏ PiP không được hỗ trợ');
  const merged = { ...current };
  for (const key of SETTINGS_KEYS) {
    if (key === 'proxy_password') continue;
    if (Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key];
  }
  if (Object.prototype.hasOwnProperty.call(source, 'export_text')) merged.export_text = normalizeTextExportKinds(source.export_text);
  if (source.clear_proxy_password === true) merged.proxy_password = '';
  else if (typeof source.proxy_password === 'string' && source.proxy_password.length > 0) merged.proxy_password = source.proxy_password;
  else merged.proxy_password = current.proxy_password || '';
  merged.custom_sources = current.custom_sources;
  return merged;
}

ipcMain.handle('get-settings', async () => settingsForRenderer(getCurrentSettings()));

async function saveSettings(settings) {
  try {
    const current = getCurrentSettings();
    const wasCheckingUpdates = current.app_updates_enabled !== false;
    const merged = applyEditableSettings(current, settings);
    merged.download_quality = normalizeDownloadQuality(merged.download_quality);
    validateProxyDraft(merged);
    // Áp dụng proxy có hiệu lực trước rồi mới lưu xuống đĩa; nếu bất kỳ bước nào thất bại đều khôi phục proxy cũ để tránh cấu hình lỗi làm khóa lần khởi động sau.
    try { await applyProxyWithTimeout(merged, 15000); }
    catch (error) {
      try { await applyProxyWithTimeout(current, 5000); } catch (_) { /* Cấu hình cũ cũng có thể không khả dụng */ }
      throw error;
    }
    // Window/source preferences may change while the native proxy operation is pending.
    const latest = applyEditableSettings(getCurrentSettings(), settings);
    latest.download_quality = merged.download_quality;
    try { store.saveSettings(latest); }
    catch (error) {
      try { await applyProxyWithTimeout(current, 5000); } catch (_) { /* Cấu hình cũ cũng có thể không khả dụng */ }
      throw error;
    }
    if (merged.app_updates_enabled === false) { updateDownloadGeneration++; appUpdateInstaller?.cancel(); }
    if (wasCheckingUpdates !== (merged.app_updates_enabled !== false)) {
      sendToRenderer('app-update-preference', merged.app_updates_enabled !== false);
    }
    getCurrentSettings(); // Làm mới số luồng đồng thời
    proxyStartupFallback = false;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

let settingsSaveQueue = Promise.resolve();
ipcMain.handle('save-settings', (_event, settings) => {
  const result = settingsSaveQueue.then(() => saveSettings(settings));
  settingsSaveQueue = result.catch(() => {});
  return result;
});

// ===== IPC: Proxy mạng =====
ipcMain.handle('get-proxy-status', async () => {
  const settings = getCurrentSettings();
  const resolved = resolveProxyConfig(settings);
  return {
    enabled: settings.proxy_enabled === true,
    mode: resolved.mode,
    url: publicProxyUrl(resolved.url),
    effective: resolved.mode !== 'direct' && !!resolved.url,
  };
});

// Dùng giá trị biểu mẫu hiện tại để kiểm tra thực tế kết nối proxy (chưa lưu cũng kiểm tra được)
ipcMain.handle('test-proxy', async (event, draft) => {
  const settings = applyEditableSettings(getCurrentSettings(), draft);
  const resolved = resolveProxyConfig(settings);
  if (resolved.mode === 'custom' && !resolved.url) {
    return { success: false, error: 'Vui lòng điền đầy đủ địa chỉ proxy và cổng' };
  }

  // Chỉ kiểm tra định tuyến API/tải xuống. system dùng bản chụp lúc khởi động, tránh việc bản nháp chưa lưu đọc phải môi trường thủ công/trực tiếp hiện tại.
  let proxyOption = false;
  if (resolved.url) {
    try {
      const url = new URL(resolved.url);
      proxyOption = { protocol: url.protocol.replace(':', ''), host: url.hostname, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) };
      if (url.username) proxyOption.auth = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    } catch (_) { return { success: false, error: 'Định dạng địa chỉ proxy không hợp lệ' }; }
  }

  const started = Date.now();
  try {
    const res = await axios.get('https://www.baidu.com', {
      timeout: 12000,
      proxy: proxyOption,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true,
    });
    const ms = Date.now() - started;
    if (res.status >= 200 && res.status < 400) {
      return {
        success: true,
        elapsed: ms,
        mode: resolved.mode,
        via: publicProxyUrl(resolved.url) || '(kết nối trực tiếp)',
        message: `Kết nối API/tải về bình thường (HTTP ${res.status}, mất ${ms}ms)`,
      };
    }
    return { success: false, error: `Yêu cầu trả về HTTP ${res.status} (thời gian ${ms}ms)` };
  } catch (error) {
    const ms = Date.now() - started;
    const code = (error && error.code) || '';
    let hint = publicProxyError(error.message, settings, resolved);
    if (code === 'ECONNREFUSED') hint = 'Cổng proxy từ chối kết nối, vui lòng xác nhận phần mềm proxy đã khởi động và cổng được nhập chính xác';
    else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') hint = 'Kết nối quá thời gian, vui lòng kiểm tra địa chỉ/cổng proxy hoặc xem proxy có khả dụng không';
    else if (code === 'ENOTFOUND') hint = 'Không thể phân giải địa chỉ proxy, vui lòng kiểm tra tên máy chủ';
    else if (/407/.test(hint)) hint = 'Proxy yêu cầu xác thực, vui lòng điền tên người dùng và mật khẩu';
    return { success: false, error: `${hint} (thời gian ${ms}ms)`, code };
  }
});

// ===== IPC: Quản lý tải xuống =====
ipcMain.handle('get-download-tasks', () => {
  const STATUS_ORDER = {
    downloading: 0,
    pending: 1,
    failed: 2,
    stopped: 3,
    completed: 4,
  };
  const sorted = downloadTasks.slice().sort((a, b) => {
    const wa = STATUS_ORDER[a.status] ?? 99;
    const wb = STATUS_ORDER[b.status] ?? 99;
    if (wa !== wb) return wa - wb;
    if (wa <= 1) {
      return (a.hongguoInfo?.vid_index || 0) - (b.hongguoInfo?.vid_index || 0) || (a.startTime || 0) - (b.startTime || 0);
    }
    return (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0);
  });
  return sorted.map((task) => {
    const { cancelSource, writer, ...serializableTask } = task;
    const info = task.hongguoInfo;
    if (String(info?.series_id).startsWith('xifan:')
      && require('./src/native/xifan').episodeDisplayTitle(info.series_id, info.series_title, info.ep_title) !== info.ep_title) {
      serializableTask.title = `《${info.series_title}》Tập ${String(info.vid_index).padStart(3, '0')}`;
    }
    if (task.status === 'completed' && !hasCompleteTaskFile(task)) {
      return { ...serializableTask, status: 'failed', progress: 0, qualityNotice: '', error: 'Tệp cục bộ đã mất hoặc xung đột đường dẫn, vui lòng tải lại' };
    }
    return { ...serializableTask, qualityNotice: ['downloading', 'completed'].includes(task.status) ? task.qualityNotice || '' : '' };
  });
});


// ===== Dọn dẹp tệp (Xóa tệp cục bộ đã tải về) =====

/** Dùng chung cho tác vụ đơn và tập đơn: Tệp và sản phẩm tạm thời phải thuộc sở hữu độc quyền của bản ghi mục tiêu. */
function removeEpisodeFiles(paths, owners) {
  let freed = 0, failed = 0, count = 0, warning;
  for (const file of new Set(paths.filter(Boolean))) {
    const family = episodeFilePaths(file);
    if (!ownsEpisodeFiles(file, owners) || family.some(isFileInUse)
      || owners.some(task => mergeTasks.some(merge => String(merge.seriesId) === String(task.hongguoInfo?.series_id) && merge.status === 'running'))) {
      warning = 'Tệp đang được sử dụng hoặc đăng ký cho tác vụ khác / sản phẩm gộp, đã giữ lại tệp và lịch sử tác vụ';
      continue;
    }
    for (const p of family) {
      try {
        if (fs.existsSync(p)) {
          const st = fs.statSync(p);
          fs.unlinkSync(p);
          freed += st.size; count++;
        }
      } catch (_) { failed++; }
    }
  }
  return { count, freed, failed, warning };
}

async function stopTaskAndWait(task) {
  clearSourceRetry(task);
  task.cancelled = true;
  task.cancelSource?.cancel('Người dùng xóa tác vụ');
  task.writer?.destroy();
  task.status = 'stopped';
  downloadQueue = downloadQueue.filter(item => item.id !== task.id);
  await downloadRuns.get(task.id);
}

function isTaskInFlight(task) {
  return task.status === 'pending' || task.status === 'downloading' || runningDownloads.has(task.id);
}

function isFileInUse(file) {
  return castFileRefs.has(file) || localFileReaders.has(file) || runningDownloadPaths.has(file) || downloadTasks.some(task => task.savePath === file && isTaskInFlight(task));
}

function removeFinishedRecords(seriesId, saveChanges = false) {
  const ids = downloadTasks.filter(task => (seriesId == null || String(task.hongguoInfo?.series_id) === String(seriesId)) && !isTaskInFlight(task) && task.status === 'completed' && task.savePath && episodeFilePaths(task.savePath).every(file => !fs.existsSync(file))).map(task => task.id);
  if (ids.length || saveChanges) dropTaskRecords(ids);
}

/** Xóa một nhóm bản ghi tác vụ (xóa khỏi bộ nhớ RAM và hàng đợi) */
function dropTaskRecords(ids) {
  const set = new Set(ids.filter(id => !downloadTasks.some(task => task.id === id && isTaskInFlight(task))));
  const previousTasks = downloadTasks, previousQueue = downloadQueue;
  downloadTasks = downloadTasks.filter((t) => !set.has(t.id));
  downloadQueue = downloadQueue.filter((t) => !set.has(t.id));
  try { saveDownloadTasks(); }
  catch (error) { downloadTasks = previousTasks; downloadQueue = previousQueue; throw error; }
  return previousTasks.length - downloadTasks.length;
}

async function deleteTaskRecords(taskIds, options) {
  const deleteFiles = options?.deleteFiles === true;
  let freed = 0, failed = 0, fileCount = 0, count = 0;
  let cancelledRetries = false;
  const removed = [], errors = [], warnings = [];
  for (const id of new Set(taskIds)) {
    const task = downloadTasks.find(item => item.id === id);
    if (!task) continue;
    if (deleteFiles && mergeTasks.some(merge => String(merge.seriesId) === String(task.hongguoInfo?.series_id) && merge.status === 'running')) {
      failed++; errors.push('Phim này đang được gộp, vui lòng hoàn thành hoặc hủy gộp trước khi xóa tệp'); continue;
    }
    try {
      cancelledRetries = cancelScheduledRetries([task]) || cancelledRetries;
      clearSourceRetry(task);
      if (isTaskInFlight(task)) {
        await stopTaskAndWait(task);
        if (!downloadTasks.includes(task) || isTaskInFlight(task) || task.cancelled === false || task.retryAt) {
          errors.push('Trạng thái tác vụ đã thay đổi, đã giữ lại tệp và bản ghi, vui lòng thử lại'); continue;
        }
      }
      if (deleteFiles) {
        const result = removeEpisodeFiles([task.savePath], [task]);
        freed += result.freed; fileCount += result.count; failed += result.failed;
        if (result.warning) { warnings.push(result.warning); errors.push(result.warning); }
        if (result.failed) { errors.push('Một số tệp xóa thất bại, bản ghi tác vụ tương ứng đã được giữ lại'); continue; }
        if (result.warning) continue;
      }
      removed.push(id);
    } catch (error) { errors.push(error.message); }
  }
  try { if (removed.length || cancelledRetries) count = dropTaskRecords(removed); }
  catch (error) { errors.push(`Lưu bản ghi tác vụ thất bại, bản ghi gốc đã được giữ lại: ${error.message}${cancelledRetries ? '; trạng thái hủy tự động thử lại chưa được lưu' : ''}`); }
  return { success: errors.length === 0, count, fileCount, freed, failed, warning: warnings.length ? [...new Set(warnings)].join('；') : undefined, error: errors.length ? [...new Set(errors)].join('；') : undefined };
}

ipcMain.handle('delete-task', (_event, taskId, options) => {
  if (!downloadTasks.some(task => task.id === taskId)) return { success: false, count: 0, fileCount: 0, freed: 0, failed: 0, error: 'Tác vụ không tồn tại' };
  return deleteTaskRecords([taskId], options);
});

ipcMain.handle('delete-tasks', (_event, taskIds, options) => {
  if (!Array.isArray(taskIds) || !taskIds.length) return { success: false, count: 0, fileCount: 0, freed: 0, failed: 0, error: 'Không có tác vụ nào cần xóa' };
  return deleteTaskRecords(taskIds, options);
});

/**
 * Xóa toàn bộ tệp cục bộ của một bộ phim (bao gồm sản phẩm hợp nhất), và dọn dẹp các bản ghi tác vụ tương ứng.
 * Hồ sơ phim vẫn được giữ lại (vẫn xem được danh sách tập, có thể phát trực tuyến), chỉ chuyển thành "chưa tải".
 */
function deleteSeriesFiles(seriesId, options) {
  try {
    const sid = String(seriesId);
    const includeMerged = !(options && options.includeMerged === false);
    if (mergeTasks.some(task => task.seriesId === sid && task.status === 'running')) return { success: false, error: 'Phim này đang được ghép nối, vui lòng hoàn thành hoặc hủy ghép nối trước khi dọn dẹp' };
    const entry = seriesRegistry.find(s => String(s.series_id) === sid);
    const title = entry?.series_title || '';
    const files = collectSeriesEpisodeFiles(sid, title);
    const { dir } = files;
    const paths = new Set([...files.episodePaths, ...files.temporaryPaths,
      ...(includeMerged ? [...files.mergedPaths, ...files.concatPaths] : [])]);
    const cancelledRetries = cancelScheduledRetries(downloadTasks.filter(task => String(task.hongguoInfo?.series_id) === sid));
    let count = 0, freed = 0, failed = files.scanFailed;
    for (const file of paths) {
      if (isFileInUse(file)) continue;
      try {
        if (!fs.existsSync(file)) continue;
        const size = fs.statSync(file).size;
        fs.unlinkSync(file);
        freed += size;
        count++;
      } catch (_) { failed++; }
    }
    // Chỉ xóa thư mục rỗng của phim này; các tệp không xác định và tệp tạm đang tải sẽ khiến thư mục được giữ lại.
    try { if (dir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch (_) {}
    try { removeFinishedRecords(sid, cancelledRetries); }
    catch (error) { return { success: false, count, freed, failed, error: `Đã thực hiện dọn dẹp tệp; lưu bản ghi tác vụ thất bại, bản ghi gốc đã được giữ lại: ${error.message}${cancelledRetries ? '; trạng thái hủy tự động thử lại chưa được lưu' : ''}` }; }
    return { success: failed === 0, count, freed, failed, error: failed ? 'Một số tệp xóa thất bại, bản ghi tương ứng được giữ lại' : undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('delete-series-files', (_event, seriesId, options) => deleteSeriesFiles(seriesId, options));

/** Xóa tệp cục bộ của một tập đơn (dùng cho tính năng xem xong tự xóa) */
async function deleteEpisodeFile(seriesId, vidIndex) {
  try {
    const sid = String(seriesId);
    const idx = Number(vidIndex);
    if (!sid || !Number.isSafeInteger(idx) || idx < 1) return { success: false, error: 'Thông tin phim không hợp lệ', count: 0, freed: 0 };
    const tasks = downloadTasks.filter(task => String(task.hongguoInfo?.series_id) === sid && Number(task.hongguoInfo?.vid_index) === idx);
    if (tasks.some(isTaskInFlight) || mergeTasks.some(task => task.seriesId === sid && task.status === 'running')) return { success: false, error: 'Tập này đang tải hoặc đang ghép, tạm thời không xóa', count: 0, freed: 0 };
    const entry = seriesRegistry.find(item => String(item.series_id) === sid);
    const scanned = collectSeriesEpisodeFiles(sid, entry?.series_title || '');
    const paths = [...tasks.map(task => task.savePath), ...scanned.ordered.filter(episode => episode.vid_index === idx).map(episode => episode.path),
      ...(scanned.dir ? [...scanned.episodeNames].filter(([, index]) => index === idx).map(([name]) => path.join(scanned.dir, name)) : [])];
    const cancelledRetries = cancelScheduledRetries(tasks);
    const result = removeEpisodeFiles(paths, tasks);
    const ids = tasks.filter(task => task.savePath && ownsEpisodeFiles(task.savePath, tasks)
      && episodeFilePaths(task.savePath).every(file => !fs.existsSync(file))).map(task => task.id);
    try { if (ids.length || cancelledRetries) dropTaskRecords(ids); }
    catch (error) { return { ...result, success: false, error: `Đã thực hiện dọn dẹp tệp; lưu bản ghi tác vụ thất bại, bản ghi gốc đã được giữ lại: ${error.message}${cancelledRetries ? '; trạng thái hủy tự động thử lại chưa được lưu' : ''}` }; }
    return { ...result, success: result.failed === 0 && !result.warning,
      error: [result.warning, result.failed ? 'Xóa tệp thất bại, bản ghi tác vụ được giữ lại' : ''].filter(Boolean).join('；') || undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('delete-episode-file', (_event, seriesId, vidIndex) => deleteEpisodeFile(seriesId, vidIndex));

/** Phía giao diện giải phóng phương tiện đã xem trước; chỉ xóa tập hiện tại, không ảnh hưởng đến tập tiếp theo đã lưu trước vào bộ nhớ đệm. */
ipcMain.handle('cleanup-watched-episode', async (_event, seriesId, vidIndex) => {
  try {
    const sid = String(seriesId), idx = Number(vidIndex);
    if (!sid || !Number.isSafeInteger(idx) || idx < 1) return { success: false, error: 'Thông tin tập phim không hợp lệ' };
    if (downloadTasks.some(task => String(task.hongguoInfo?.series_id) === sid && Number(task.hongguoInfo?.vid_index) === idx && task.nasDestination))
      return { success: true, count: 0, freed: 0, skipped: true };
    if (downloadTasks.some(task => String(task.hongguoInfo?.series_id) === sid && Number(task.hongguoInfo?.vid_index) === idx && task.nasWarning))
      return { success: false, error: 'Tập này chưa hoàn thành sắp xếp NAS, video cục bộ được giữ lại; vui lòng nhấn lại「Tải về NAS」để thử lại' };
    const matches = entry => entry && String(entry.seriesId) === sid && Number(entry.vidIndex) === idx;
    const compatFiles = ['auto', '720p', '1080p'].map(quality => compatPathFor(sid, idx, quality));
    if ([...onlineSessions.values()].some(session => matches(session.entry || session)) || compatFiles.some(file => compatPreparing.has(file))) {
      return { success: false, error: 'Tập này vẫn đang phát hoặc chuẩn bị, hãy dọn dẹp sau' };
    }
    const result = await deleteEpisodeFile(sid, idx);
    if (!result.success) return result;
    for (const [key, entry] of [...onlineCache]) {
      if (!matches(entry)) continue;
      const bytes = entry.size || 0;
      deleteOnlineCacheEntry(key);
      if (entry.filePath && fs.existsSync(entry.filePath)) { onlineCache.set(key, entry); result.failed++; continue; }
      result.freed += bytes;
      result.count++;
    }
    for (const file of compatFiles) {
      if (isFileInUse(file)) { result.failed++; continue; }
      try {
        if (fs.existsSync(file)) { const size = fs.statSync(file).size; fs.unlinkSync(file); result.freed += size; result.count++; }
      } catch (_) { result.failed++; }
    }
    result.success = !result.failed;
    if (!result.success) result.error = 'Dọn dẹp một phần bộ nhớ đệm thất bại, vui lòng thử lại sau';
    return result;
  } catch (error) { return { success: false, error: error.message }; }
});

/** Thống kê dung lượng đĩa sử dụng ở các nơi (dùng để hiển thị "có thể giải phóng bao nhiêu") */
/** Thống kê và xóa dùng chung một tập hợp mục tiêu: bao gồm hồ sơ đã xóa và các phim chỉ có tác vụ tải xuống. */
function deletionTargets() {
  const targets = new Map();
  for (const series of seriesRegistry) {
    const id = String(series?.series_id || '').trim();
    if (id) targets.set(id, series.series_title || '');
  }
  for (const task of downloadTasks) {
    const info = task?.hongguoInfo;
    const id = String(info?.series_id || '').trim();
    if (!id) continue;
    if (!targets.has(id)) targets.set(id, info.series_title || '');
  }
  return [...targets].map(([series_id, series_title]) => ({ series_id, series_title }));
}

ipcMain.handle('get-storage-usage', async () => {
  try {
    const series = [];
    let totalBytes = 0;
    let totalFiles = 0;
    for (const target of deletionTargets()) {
      const entry = seriesRegistry.find(item => String(item.series_id) === target.series_id);
      const owned = collectSeriesEpisodeFiles(target.series_id, target.series_title || entry?.series_title || '');
      const merging = mergeTasks.some(task => String(task.seriesId) === String(target.series_id) && task.status === 'running');
      const paths = merging ? [] : new Set([...owned.episodePaths, ...owned.temporaryPaths, ...owned.mergedPaths, ...owned.concatPaths]);
      let bytes = 0, files = 0, merged = 0;
      for (const file of paths) {
        if (isFileInUse(file)) continue;
        try {
          const stat = fs.statSync(file);
          if (!stat.isFile()) continue;
          bytes += stat.size; files++;
          if (owned.mergedPaths.has(file)) merged++;
        } catch (_) {}
      }
      totalBytes += bytes;
      totalFiles += files;
      series.push({
        series_id: target.series_id,
        series_title: target.series_title || entry?.series_title || '',
        total: (entry?.episodes || []).length,
        files,
        bytes,
        merged,
      });
    }
    series.sort((a, b) => b.bytes - a.bytes);
    return { success: true, totalBytes, totalFiles, series };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** Xóa tất cả tệp cục bộ đã tải xuống (hồ sơ phim vẫn giữ lại, sau này vẫn có thể xem trực tuyến) */
ipcMain.handle('delete-all-downloaded', async () => {
  try {
    let freed = 0, count = 0, failed = 0, skipped = 0;
    const errors = [];
    const targets = deletionTargets();
    for (const { series_id: sid } of targets) {
      if (mergeTasks.some(task => String(task.seriesId) === String(sid) && task.status === 'running')) { skipped++; continue; }
      const result = deleteSeriesFiles(sid);
      if (result.error) errors.push(result.error);
      count += result.count || 0;
      freed += result.freed || 0;
      failed += result.failed ?? (result.success ? 0 : 1);
    }
    return { success: failed === 0 && errors.length === 0, count, freed, failed, skipped, warning: skipped ? `${skipped} bộ phim đang được gộp, đã bỏ qua` : undefined, error: (failed || errors.length) ? [...new Set(errors)].join('; ') || 'Một số tệp xóa thất bại, bản ghi tương ứng đã được giữ lại' : undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('stop-download', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };

  clearSourceRetry(task);
  task.cancelled = true;
  if (task.cancelSource) { try { task.cancelSource.cancel('Người dùng dừng tải xuống'); } catch (_) {} }
  if (task.writer) { try { task.writer.destroy(); } catch (_) {} }

  task.status = 'stopped';
  task.error = '';
  task.endTime = Date.now();
  delete task.cancelSource;
  delete task.writer;

  saveDownloadTasks();
  sendToRenderer('download-stopped', { id: taskId, path: task.savePath });
  return { success: true };
});

ipcMain.handle('retry-task', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };
  if (!['failed', 'stopped'].includes(task.status) && !(task.status === 'completed' && !hasCompleteTaskFile(task))) return { success: false, error: 'Tác vụ vẫn đang diễn ra hoặc đã hoàn thành' };

  const snapshot = snapshotQueueTasks([task]);
  clearSourceRetry(task);
  repairTaskDestination(task);

  task.status = 'pending';
  task.progress = 0;
  task.receivedBytes = 0;
  task.totalBytes = 0;
  task.cancelled = false;
  delete task.error;
  delete task.cancelSource;
  delete task.writer;

  if (!downloadQueue.some((t) => t.id === taskId)) downloadQueue.push(task);
  try { saveDownloadTasks(); }
  catch (error) { restoreQueueTasks(snapshot); return { success: false, error: error.message }; }
  processDownloadQueue();
  return { success: true };
});

ipcMain.handle('retry-tasks', async (event, taskIds) => {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { success: false, error: 'Không có tác vụ nào cần thử lại' };
  let count = 0;
  const changed = [];
  for (const taskId of taskIds) {
    const task = downloadTasks.find((t) => t.id === taskId);
    if (task && (task.status === 'failed' || task.status === 'stopped' || (task.status === 'completed' && !hasCompleteTaskFile(task)))) changed.push(task);
  }
  const snapshot = snapshotQueueTasks(changed);
  for (const task of changed) {
    const taskId = task.id;
    clearSourceRetry(task);
    repairTaskDestination(task);
    task.status = 'pending';
    task.progress = 0;
    task.receivedBytes = 0;
    task.totalBytes = 0;
    task.cancelled = false;
    delete task.error;
    delete task.cancelSource;
    delete task.writer;
    if (!downloadQueue.some((t) => t.id === taskId)) downloadQueue.push(task);
    count++;
  }
  if (count > 0) {
    try { saveDownloadTasks(); }
    catch (error) { restoreQueueTasks(snapshot); return { success: false, error: error.message, count: 0 }; }
    processDownloadQueue();
  }
  return { success: true, count };
});

// ===== IPC: Một chạm bắt đầu / Một chạm tạm dừng =====
ipcMain.handle('pause-all', async () => ({ success: true, count: pauseAllTasks() }));

ipcMain.handle('resume-all', async () => {
  try { return { success: true, count: resumeAllTasks() }; }
  catch (error) { return { success: false, count: 0, error: error.message }; }
});

// Trạng thái hàng đợi thời gian thực (cho giao diện hiển thị "Đang xử lý x/giới hạn đồng thời")
ipcMain.handle('get-queue-status', async () => ({
  active: activeDownloads,
  queued: downloadQueue.length,
  maxConcurrent: MAX_CONCURRENT_DOWNLOADS,
}));

ipcMain.handle('get-download-system-stats', async () => {
  const totalSpeed = currentTotalSpeed();
  let freeBytes = null;
  try {
    const root = (getCurrentSettings().root && String(getCurrentSettings().root).trim()) || app.getPath('downloads');
    if (fs.statfs) {
      const stats = await fsp.statfs(root);
      freeBytes = stats.bavail * stats.bsize;
    }
  } catch (_) {}
  return {
    totalSpeed,
    activeDownloads,
    queuedCount: downloadQueue.length,
    freeBytes,
  };
});

// --- HỆ THỐNG BẢN QUYỀN & TÀI KHOẢN V2.1.0 ---
ipcMain.handle('license-get-info', async () => {
  await licenseManager.fetchAuthConfig().catch(() => {});
  return licenseManager.getLicenseInfo();
});
ipcMain.handle('license-validate-key', async (_event, key) => licenseManager.validate(key));
ipcMain.handle('license-login-account', async (_event, user, pass) => licenseManager.authAccount(user, pass));
ipcMain.handle('license-register-account', async (_event, payload) => {
  const { username, email, phone, fullname, password } = payload || {};
  return licenseManager.registerAccount(username, email, phone, fullname, password);
});
ipcMain.handle('license-claim-trial', async (_event, username) => licenseManager.claimTrial14Days(username));
ipcMain.handle('license-forgot-password', async (_event, payload) => {
  const { username, email } = payload || {};
  return licenseManager.forgotPassword(username, email);
});
ipcMain.handle('license-verify-otp', async (_event, token) => licenseManager.verifyOtp(token));
ipcMain.handle('license-reset-password', async (_event, payload) => {
  const { token, newPassword } = payload || {};
  return licenseManager.resetPassword(token, newPassword);
});
ipcMain.handle('license-logout', async () => licenseManager.logout());

ipcMain.handle('clean-download-temp-files', async () => {
  try {
    const root = (getCurrentSettings().root && String(getCurrentSettings().root).trim()) || app.getPath('downloads');
    if (!fs.existsSync(root)) return { success: true, count: 0, freed: 0 };
    let freed = 0;
    let count = 0;
    const runningPaths = new Set(runningDownloadPaths);
    async function scanAndClean(dir, depth = 0) {
      if (depth > 2) return;
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanAndClean(full, depth + 1);
        } else if (entry.isFile()) {
          if (/\.(enc\.tmp|tmp|decoded)$/i.test(entry.name)) {
            if (!runningPaths.has(full) && !runningPaths.has(full.replace(/\.(enc\.tmp|tmp|decoded)$/i, ''))) {
              try {
                const stat = await fsp.stat(full);
                await fsp.unlink(full);
                freed += stat.size;
                count++;
              } catch (_) {}
            }
          }
        }
      }
    }
    await scanAndClean(root);
    return { success: true, count, freed };
  } catch (error) {
    return { success: false, error: error.message || 'Dọn dẹp tệp tạm thất bại' };
  }
});

ipcMain.handle('open-folder', async (event, taskId) => {
  const task = downloadTasks.find((t) => t.id === taskId);
  if (!task) return { success: false, error: 'Tác vụ không tồn tại' };

  const nasDirectory = task.nasDestination?.directory || task.nasTargets?.at(-1)?.directory;
  if (nasDirectory) {
    if (!fs.existsSync(nasDirectory)) return { success: false, error: 'Thư mục lưu NAS không khả dụng, vui lòng gắn kết lại rồi mở' };
    const error = await shell.openPath(nasDirectory);
    return error ? { success: false, error } : { success: true };
  }

  if (task.customDir && fs.existsSync(task.customDir)) {
    await shell.openPath(task.customDir);
    return { success: true };
  }
  if (task.savePath && fs.existsSync(task.savePath)) {
    const isDir = fs.statSync(task.savePath).isDirectory();
    if (isDir) {
      await shell.openPath(task.savePath);
    } else {
      shell.showItemInFolder(task.savePath);
    }
    return { success: true };
  }
  if (task.savePath) {
    const parentDir = path.dirname(task.savePath);
    if (fs.existsSync(parentDir)) {
      await shell.openPath(parentDir);
      return { success: true };
    }
  }
  return { success: false, error: 'Thư mục không tồn tại' };
});

// ===== Thông báo từ xa: JSON công khai cố định, tùy chọn thông thường và khẩn cấp độc lập với settings =====
const appAnnouncements = createAnnouncementService({
  store,
  version: APP_VERSION,
  request: (url, options) => axios.get(url, options),
  isEnabled: () => !IS_PREVIEW && !proxyStartupFallback,
});
ipcMain.handle('check-announcements', (_event, options) => appAnnouncements.checkAnnouncements(options));
ipcMain.handle('get-current-announcement', () => appAnnouncements.getCurrentAnnouncement());
ipcMain.handle('acknowledge-announcement', (_event, payload) => appAnnouncements.acknowledgeAnnouncement(payload));
ipcMain.handle('dismiss-announcement', (_event, payload) => appAnnouncements.dismissAnnouncement(payload));
ipcMain.handle('get-announcement-preferences', () => appAnnouncements.getAnnouncementPreferences());
ipcMain.handle('set-announcement-preferences', (_event, patch) => {
  const result = appAnnouncements.setAnnouncementPreferences(patch);
  if (result.success) sendToRenderer('announcement-preferences-changed', result.preferences);
  return result;
});

// ===== Cập nhật trong ứng dụng: Nguồn chính thức cố định, tải xuống và khởi động lại đều do người dùng xác nhận =====
let updateRequest = null;
let latestAppRelease = null;
function appUpdateSupport() {
  let reason = '';
  if (IS_PREVIEW || !app.isPackaged) reason = 'Phiên bản phát triển hoặc xem trước không hỗ trợ cài đặt trong ứng dụng, vui lòng sử dụng bản cài đặt chính thức.';
  else if (process.platform === 'win32' && (portableConfig.mode === 'portable' || portableConfig.portableDir
    || process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR)) reason = 'Bản di động cần cập nhật thủ công. Vui lòng thoát chương trình cũ, sau đó chạy gói cài đặt setup trên trang phát hành và khởi động từ lối tắt vừa tạo; bản cài đặt sẽ hỗ trợ cập nhật trong ứng dụng sau này. Nếu tiếp tục dùng bản di động, vui lòng giải nén toàn bộ bản mới và chạy trực tiếp tệp mới.';
  else if (!['darwin', 'win32'].includes(process.platform)) reason = 'Hệ thống hiện tại vui lòng truy cập trang phát hành để cập nhật thủ công.';
  else if (process.platform === 'darwin' && (process.execPath.startsWith('/Volumes/') || process.execPath.includes('/AppTranslocation/'))) reason = 'Vui lòng chuyển ứng dụng vào thư mục "Applications" rồi mở lại trước khi dùng tính năng cập nhật trong ứng dụng.';
  return { supported: !reason, reason };
}
function appUpdateState() {
  return appUpdateInstaller?.getState() || { ...appUpdateSupport(), status: 'idle', version: null, percent: 0, error: '' };
}
function getAppUpdateInstaller() {
  if (!appUpdateInstaller) {
    appUpdater = require('electron-updater').autoUpdater;
    appUpdater.on('login', (authInfo, callback) => {
      if (matchesProxyAuth(authInfo)) callback(activeProxyAuth.username, activeProxyAuth.password);
      else callback();
    });
    appUpdateInstaller = require('./src/native/app-update-installer').createUpdateInstaller({
      updater: appUpdater,
      currentVersion: APP_VERSION,
      isEnabled: () => !IS_PREVIEW && getCurrentSettings().app_updates_enabled !== false,
      installBlocker: () => {
        if (pendingUpdateOperations) return 'Đang xử lý tác vụ hoặc lưu cài đặt, vui lòng cài đặt bản cập nhật sau.';
        if (downloadRuns.size || downloadQueue.length) return 'Vẫn còn tác vụ đang tải hoặc đang chờ, vui lòng tạm dừng tất cả tác vụ trong Quản lý tải xuống trước khi cài đặt cập nhật.';
        if (mergeTasks.some(task => task.status === 'running') || compatPreparing.size || onlinePreparing.size) return 'Đang gộp hoặc chuẩn bị video, vui lòng đợi hoàn thành hoặc hủy trước khi cài đặt cập nhật.';
        if (storageError) return 'Lưu trữ dữ liệu cục bộ gặp sự cố, vui lòng xử lý vấn đề lưu trữ trước khi cài đặt cập nhật.';
        return '';
      },
      emit: state => sendToRenderer('app-update-state', state),
    });
  }
  return appUpdateInstaller;
}
ipcMain.handle('get-app-update-state', () => appUpdateState());
ipcMain.handle('download-app-update', async () => {
  const support = appUpdateSupport();
  if (!support.supported) return { success: false, error: support.reason };
  if (!latestAppRelease || getCurrentSettings().app_updates_enabled === false) return { success: false, error: 'Thông tin cập nhật đã hết hạn, vui lòng kiểm tra lại cập nhật.' };
  try {
    const request = updateDownloadGeneration;
    const installer = getAppUpdateInstaller();
    if (!['checking', 'downloading', 'downloaded', 'installing'].includes(installer.getState().status)) {
      await applyProxyToSession(desiredProxyConfig || resolveProxyConfig(getCurrentSettings()), [appUpdater.netSession]);
    }
    if (request !== updateDownloadGeneration) return { success: false, error: 'Cập nhật đã bị hủy.', state: installer.getState() };
    return await installer.download(latestAppRelease.version);
  }
  catch (_) { return { success: false, error: 'Không thể chuẩn bị cập nhật trong ứng dụng, vui lòng thử lại hoặc đến trang phát hành tải cài đặt.' }; }
});
ipcMain.handle('cancel-app-update', () => {
  if (appUpdateInstaller?.getState().status === 'installing') return { success: false, error: 'Đang cài đặt cập nhật, không thể hủy.', state: appUpdateState() };
  updateDownloadGeneration++;
  if (!appUpdateInstaller) return { success: true, state: appUpdateState() };
  return appUpdateInstaller.cancel();
});
ipcMain.handle('install-app-update', () => {
  if (!appUpdateInstaller) return { success: false, error: 'Vui lòng hoàn thành tải bản cập nhật trước.' };
  return appUpdateInstaller.install();
});
ipcMain.handle('check-app-update', async event => {
  if (proxyStartupFallback) return { enabled: false, release: null, error: 'Vui lòng sửa hoặc tắt hẳn proxy trước.' };
  if (IS_PREVIEW || !mainWindow || event.sender !== mainWindow.webContents) return { enabled: false, release: null };
  if (getCurrentSettings().app_updates_enabled === false) {
    latestAppRelease = null;
    return { enabled: false, release: null };
  }
  if (!updateRequest) {
    updateRequest = axios.get('https://api.github.com/repos/jackotom/hongguo-drama/releases/latest', {
      timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hongguo-Drama-Update-Check' },
    }).catch(() => axios.get('https://github.com/jackotom/hongguo-drama/releases/latest', {
      // GitHub's public release endpoint does not consume the anonymous API quota.
      timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024,
      headers: { Accept: 'application/json', 'User-Agent': 'Hongguo-Drama-Update-Check' },
      validateStatus: status => status === 200 || status === 302,
    }).then(response => {
      if (response.status !== 302) return response;
      const tag = /^https:\/\/github\.com\/jackotom\/hongguo-drama\/releases\/tag\/(v?\d+\.\d+(?:\.\d+)?)$/.exec(response.headers.location || '');
      if (!tag) throw new Error('Unexpected update redirect');
      return { data: { tag_name: tag[1] } };
    })).then(response => ({ release: availableRelease(response.data, APP_VERSION), error: '' }))
      .catch(() => ({ release: null, error: 'Tạm thời không thể kiểm tra cập nhật, vui lòng kiểm tra mạng rồi thử lại.' }))
      .finally(() => { updateRequest = null; });
  }
  const result = await updateRequest;
  const enabled = getCurrentSettings().app_updates_enabled !== false;
  latestAppRelease = enabled ? result.release : null;
  return { enabled, release: latestAppRelease, error: enabled ? result.error : '' };
});
ipcMain.handle('open-app-update', async event => {
  if (IS_PREVIEW || !mainWindow || event.sender !== mainWindow.webContents || getCurrentSettings().app_updates_enabled === false) {
    return { success: false, error: 'Thông tin cập nhật đã hết hạn, vui lòng thử lại sau' };
  }
  try { await shell.openExternal(latestAppRelease?.url || 'https://github.com/jackotom/hongguo-drama/releases/latest'); return { success: true }; }
  catch { return { success: false, error: 'Không thể mở trình duyệt, vui lòng thử lại sau' }; }
});

// ===== Thông tin ứng dụng =====
ipcMain.handle('get-public-details', async (event, seriesId, vid) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { success: false, error: 'Window unavailable' };
  return fetchPublicDetails(seriesId, vid);
});
ipcMain.handle('get-episode-comments', async (event, options) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { success: false, error: 'Window unavailable' };
  return fetchEpisodeComments(options);
});

ipcMain.handle('get-episode-danmaku', async (_event, options) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return fetchDanmaku(null);
  const { seriesId, vid, fresh, limit } = options;
  return fetchDanmaku({ seriesId, vid, fresh, limit });
});

ipcMain.handle('get-app-info', async () => ({
  version: APP_VERSION,
  brand: APP_TITLE,
  appName: APP_TITLE,
  platform: process.platform,
  preview: IS_PREVIEW,
  dataDir: app.getPath('userData'),
  configMode: portableConfig.mode,
  configNote: portableConfig.reason || '',
}));

// Mở liên kết bên ngoài (giữ lại để gọi khi cần)
ipcMain.handle('open-external-url', async (event, url) => {
  if (!url) return { success: false, error: 'Thiếu liên kết' };
  try {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      return { success: false, error: 'Chỉ hỗ trợ mở liên kết trang web' };
    }
    await shell.openExternal(target.href);
    return { success: true };
  } catch (err) {
    console.error('[Shell] Mở liên kết thất bại:', err.message);
    return { success: false, error: err.message };
  }
});

// Xử lý dịch thuật AI & Google Dịch (chạy trong Main Process để tránh lỗi CORS)
async function executeTranslation(text, config = {}) {
  const provider = config.provider || 'google';
  const direction = config.direction || 'zh2vi'; // 'zh2vi' | 'vi2zh'

  const aiSystemPrompt = direction === 'vi2zh'
    ? 'Bạn là chuyên gia dịch thuật và tìm kiếm phim ngắn. Hãy dịch từ khóa tìm kiếm tên phim hoặc thể loại sau đây từ tiếng Việt sang tiếng Trung giản thể (Simplified Chinese). Chỉ trả về duy nhất từ khóa tiếng Trung ngắn gọn, tuyệt đối không kèm giải thích, không kèm ghi chú hay dấu ngoặc kép.'
    : 'Bạn là chuyên gia dịch thuật phim ngắn tiếng Trung sang tiếng Việt. Hãy dịch tiêu đề hoặc tóm tắt sau đây sang tiếng Việt một cách tự nhiên, cuốn hút, đúng văn phong phim ngắn ngôn tình/hành động/hài hước. Chỉ trả về duy nhất kết quả dịch tiếng Việt, tuyệt đối không kèm giải thích, không kèm ghi chú hay dấu ngoặc kép.';

  if (provider === 'custom_ai') {
    if (!config.apiKey || !config.apiKey.trim()) {
      return { success: false, error: 'Chưa nhập API Key cho AI tùy chỉnh' };
    }
    try {
      let endpoint = String(config.endpoint || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey.trim()}`,
          },
          body: JSON.stringify({
            model: config.model || 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: aiSystemPrompt,
              },
              {
                role: 'user',
                content: text,
              },
            ],
            temperature: 0.3,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errDetail = '';
          try {
            const errJson = await response.json();
            errDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
          } catch (_) {
            errDetail = `HTTP ${response.status} ${response.statusText}`;
          }
          return { success: false, error: `Lỗi AI (${response.status}): ${errDetail}` };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
          return { success: false, error: 'Mô hình AI không trả về kết quả dịch' };
        }
        const cleaned = content.replace(/^["'《「]|["'》」]$/g, '').trim();
        return { success: true, text: cleaned };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { success: false, error: `Lỗi kết nối AI: ${err.message}` };
    }
  }

  // Google Translate (Miễn phí)
  try {
    const sl = direction === 'vi2zh' ? 'vi' : 'zh-CN';
    const tl = direction === 'vi2zh' ? 'zh-CN' : 'vi';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return { success: false, error: `Google Translate HTTP ${res.status}` };
      }
      const data = await res.json();
      if (!Array.isArray(data?.[0])) {
        return { success: false, error: 'Dữ liệu trả về từ Google Translate không đúng định dạng' };
      }
      const translated = data[0].map((item) => item?.[0] || '').join('').trim();
      return { success: true, text: translated };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { success: false, error: `Lỗi kết nối Google Dịch: ${err.message}` };
  }
}

ipcMain.handle('translate-text', async (_event, text, config = {}) => {
  if (!text || typeof text !== 'string') return { success: false, error: 'Văn bản cần dịch không hợp lệ' };
  return executeTranslation(text, config);
});

let windowLayout = 'landscape';
let landscapeBounds = null;
let layoutChanging = false;
const stealth = createStealthController({ screen, BaseWindow, View, getWindow: () => mainWindow });
const bossKey = createBossKeyController({ globalShortcut, getWindows: () => BaseWindow.getAllWindows(), getMainWindow: () => mainWindow, store,
  dock: process.platform === 'darwin' ? app.dock : undefined });
ipcMain.handle('get-boss-key-state', () => bossKey.getState());
ipcMain.handle('set-boss-key', (_event, value) => {
  const result = settingsSaveQueue.then(() => ({ success: true, ...bossKey.set(value) }))
    .catch(error => ({ success: false, error: error.message }));
  settingsSaveQueue = result.then(() => {});
  return result;
});
app.on('will-quit', () => bossKey.dispose());
function syncMainWindowScale() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const scale = getWindowScale(getCurrentSettings().ui_zoom);
  mainWindow.webContents.setZoomFactor(scale);
}
function changeMainWindowZoom(direction) {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'Cửa sổ chính không khả dụng' };
  try {
    saveWindowZoom(store, direction);
    syncMainWindowScale();
    const zoom = getWindowScale(getCurrentSettings().ui_zoom);
    sendToRenderer('interface-zoom-changed', zoom);
    return { success: true, zoom };
  } catch (_) {
    const error = 'Lưu kích thước giao diện thất bại, vui lòng kiểm tra dung lượng đĩa hoặc quyền thư mục rồi thử lại.';
    sendToRenderer('storage-error', { error });
    return { success: false, error };
  }
}
ipcMain.handle('change-window-zoom', (_event, direction) => changeMainWindowZoom(direction));
ipcMain.handle('set-stealth-mode', async (event, enabled) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof enabled !== 'boolean') return { success: false, error: 'Không thể chuyển đổi cửa sổ nhỏ' };
  if (enabled && (mainWindow.isFullScreen() || layoutChanging)) return { success: false, error: 'Vui lòng thoát toàn màn hình trước khi bật cửa sổ nhỏ ẩn danh' };
  try {
    episodePanel.close();
    stealth.setEnabled(enabled);
    syncMainWindowScale();
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});
const episodePanel = createEpisodePanelController({ ipcMain, screen, getMainWindow: () => mainWindow, getLayout: () => windowLayout });
ipcMain.handle('get-window-layout', () => windowLayout);
ipcMain.handle('set-window-layout', async (event, mode) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !['portrait', 'landscape'].includes(mode)) {
    return { success: false, error: 'Không thể chuyển đổi bố cục cửa sổ' };
  }
  if (stealth.enabled) return { success: false, error: 'Vui lòng thoát cửa sổ nhỏ ẩn danh trước' };
  if (layoutChanging) return { success: false, error: 'Cửa sổ đang chuyển đổi, vui lòng thử lại sau' };
  if (mode === windowLayout) return { success: true, mode };
  layoutChanging = true;
  try {
    const win = mainWindow;
    if (mode === 'portrait') landscapeBounds = win.getNormalBounds();
    if (win.isFullScreen()) {
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { win.removeListener('leave-full-screen', done); reject(new Error('Vui lòng thoát toàn màn hình trước khi chuyển đổi')); }, 3000);
        win.once('leave-full-screen', done);
        win.setFullScreen(false);
      });
    }
    if (win.isMaximized()) win.unmaximize();
    if (mode === 'landscape') episodePanel.close();
    const current = win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const bounds = fitWindowBounds(mode, current, area, landscapeBounds);
    win.setMinimumSize(Math.min(mode === 'portrait' ? 420 : 900, bounds.width), Math.min(560, bounds.height));
    win.setBounds(bounds);
    windowLayout = mode;
    syncMainWindowScale();
    return { success: true, mode };
  } catch (error) {
    return { success: false, error: error.message };
  } finally { layoutChanging = false; }
});

// ===== Khởi tạo cửa sổ =====
function createWindow() {
  windowLayout = 'landscape';
  landscapeBounds = null;
  const options = {
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 620,
    ...(process.platform === 'darwin' ? restoreMainWindowBounds(store, screen) : {}),
    title: APP_TITLE,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 18 },
    } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      zoomMode: 'isolated',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  mainWindow = process.platform === 'darwin' ? new BaseWindow(options) : new BrowserWindow(options);
  if (process.platform === 'darwin') {
    // Own the live view so stealth can move it to a panel without recreating the player.
    const root = mainWindow.contentView;
    const view = new WebContentsView({ webPreferences: options.webPreferences });
    mainWindow.webContents = view.webContents;
    root.addChildView(view);
    const resizeView = () => {
      const { width, height } = root.getBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    root.on('bounds-changed', resizeView);
    resizeView();
  }
  const contents = mainWindow.webContents;

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('resize', syncMainWindowScale);
  mainWindow.on('enter-full-screen', syncMainWindowScale);
  mainWindow.on('leave-full-screen', syncMainWindowScale);
  mainWindow.webContents.on('did-finish-load', syncMainWindowScale);
  mainWindow.webContents.on('zoom-changed', (_event, direction) => changeMainWindowZoom(direction));
  syncMainWindowScale();
  contents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    if (params.selectionText && params.selectionText.trim()) {
      menu.append(new MenuItem({ label: 'Sao chép', role: 'copy' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cắt', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Dán', role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Chọn tất cả', role: 'selectAll' }));
    }
    if (menu.items.length > 0) {
      menu.popup({ window: mainWindow, x: params.x, y: params.y });
    }
  });
  rendererSecurity.protectWindow(mainWindow);
  attachFloatingPlayerWindow(mainWindow, {
    BrowserWindow,
    isTrustedUrl: rendererSecurity.isTrustedUrl,
    store,
    screen,
  });
  episodePanel.attach(mainWindow);
  if (process.platform === 'darwin') rememberMainWindowBounds(mainWindow, {
    store, screen, isNormal: () => !stealth.enabled && windowLayout === 'landscape' && !layoutChanging,
  });
  mainWindow.webContents.once('did-finish-load', () => {
    if (storageError) sendToRenderer('storage-error', storageError);
  });

  // Chế độ phát triển tải vite dev server, chế độ sản xuất tải sản phẩm đóng gói
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const page = process.platform === 'darwin' ? mainWindow.webContents : mainWindow;
  if (devUrl) {
    page.loadURL(devUrl);
  } else {
    page.loadFile(path.join(__dirname, 'dist-react', 'index.html'));
  }

  mainWindow.on('close', event => {
    if (process.platform !== 'darwin' && !quitReady) {
      event.preventDefault();
      app.quit();
    }
  });
  mainWindow.on('closed', () => {
    stealth.dispose();
    if (process.platform === 'darwin' && !contents.isDestroyed()) contents.destroy();
    mediaAccess.clear();
    clearOnlineCache();
    for (const job of compatPreparing.values()) { job.cancelled = true; job.controller.abort(); }
    mainWindow = null;
  });
}

// ===== Vòng đời ứng dụng =====
// Remote pages get no permissions; the trusted player keeps fullscreen and clipboard controls.
app.on('web-contents-created', (_event, contents) => {
  const allowed = (webContents, permission, details) => ['fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)
    && details?.isMainFrame === true && rendererSecurity.isTrustedUrl(details.requestingUrl)
    && rendererSecurity.isTrustedSender({ sender: webContents, senderFrame: webContents?.mainFrame }, mainWindow);
  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => callback(allowed(webContents, permission, details)));
  contents.session.setPermissionCheckHandler((webContents, permission, _origin, details) => allowed(webContents, permission, details));
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  let startupStage = 'Đọc dữ liệu cục bộ';
  try {
    const dataFile = path.join(app.getPath('userData'), 'data.json');
    store.init(dataFile);
    setDeviceIdentityFile(path.join(app.getPath('userData'), 'danmaku-client.json'));
    loadDownloadTasks();
    loadSeriesRegistry();
    try { rebuildSeriesRegistryFromTasks(); } catch (_) { /* storage-error reports the failed write when the window opens. */ }
    // Ổ đĩa ngoài hoặc ổ đĩa mạng có thể làm nghẽn quét đồng bộ; truy cập từng tập tìm kiếm theo nhu cầu, quản lý tải xuống giữ lại tính năng đăng ký bù thủ công.
    loadMergeTasks();
    getCompatDir();
    registerStreamProtocol();
    registerLocalProtocol();
    const settings = getCurrentSettings();

    bossKey.start();

    // Tự động kiểm tra bản quyền ngầm khi khởi động
    licenseManager.validateOnStartup().catch(() => {});
    licenseManager.onStatusChange((event) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('license-status-changed', event);
        }
      } catch (_) {}
    });

    // Proxy phải có hiệu lực trước khi tạo cửa sổ và gửi bất kỳ yêu cầu nào
    startupStage = 'Khởi tạo mạng';
    const proxyStartup = await applyProxyForStartup(settings);
    proxyStartupFallback = proxyStartup.fallback;
    if (proxyStartup.fallback) console.warn('[Proxy] Proxy khởi động không khả dụng, tạm thời kết nối trực tiếp:', proxyStartup.reason);
    else {
      // Không tự tải khi khởi động: tác vụ dở dang giữ nguyên trạng thái dừng/lỗi, chờ người dùng bấm Tiếp tục hoặc Thử lại.
      const held = cancelScheduledRetries(downloadTasks);
      for (const task of downloadTasks) {
        if (task.status === 'pending') {
          task.status = 'stopped';
          task.error = 'Chưa tải: đang chờ bạn cho phép tải';
        }
      }
      downloadQueue = [];
      try { saveDownloadTasks(); } catch (_) { /* store đã báo lỗi lưu trữ */ }
      if (held) console.log('[Queue] Đã hủy lịch tự thử lại cũ, không tự tải khi khởi động');
    }

    app.on('activate', () => {
      if (bossKey.hidden && bossKey.restore()) return;
      stealth.setEnabled(false);
      syncMainWindowScale();
      // Cửa sổ tìm kiếm có thể vẫn ở chế độ nền, không thể dùng tổng số cửa sổ để phán đoán cửa sổ chính có tồn tại hay không.
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });

    if (process.platform === 'darwin') {
      app.setAboutPanelOptions?.({ applicationVersion: APP_VERSION.replace(/^(\d+\.\d+)\.0$/, '$1'), version: '' });
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: APP_TITLE, submenu: [
          { role: 'about', label: `Giới thiệu ${APP_TITLE}` },
          { type: 'separator' },
          { role: 'services', label: 'Dịch vụ' },
          { type: 'separator' },
          { role: 'hide', label: 'Ẩn' },
          { role: 'hideOthers', label: 'Ẩn các ứng dụng khác' },
          { role: 'unhide', label: 'Hiện tất cả' },
          { type: 'separator' },
          { role: 'quit', label: 'Thoát' },
        ] },
        { label: 'Chỉnh sửa', submenu: [
          { role: 'undo', label: 'Hoàn tác' }, { role: 'redo', label: 'Làm lại' },
          { type: 'separator' },
          { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' },
          { role: 'paste', label: 'Dán' }, { role: 'selectAll', label: 'Chọn tất cả' },
        ] },
        { label: 'Xem', submenu: [
          { label: 'Kích thước thực tế', accelerator: 'CmdOrCtrl+0', click: () => changeMainWindowZoom('reset') },
          { label: 'Phóng to', accelerator: 'CmdOrCtrl+Plus', click: () => changeMainWindowZoom('in') },
          { label: 'Thu nhỏ', accelerator: 'CmdOrCtrl+-', click: () => changeMainWindowZoom('out') },
          { type: 'separator' }, { role: 'togglefullscreen', label: 'Toàn màn hình' },
        ] },
        { label: 'Cửa sổ', submenu: [
          { role: 'minimize', label: 'Thu nhỏ' }, { role: 'close', label: 'Đóng cửa sổ' },
          { type: 'separator' },
          { label: 'Quay lại cửa sổ chính', accelerator: 'CmdOrCtrl+1', click: () => app.emit('activate') },
          { label: 'Thoát cửa sổ ẩn danh', click: () => { stealth.setEnabled(false); syncMainWindowScale(); } },
        ] },
      ]));
    }
    // Warm the official-host trusted DNS cache before the first catalog card request.
    // This is best-effort and must never block startup or a user action.
    if (!proxyStartupFallback && resolveProxyConfig(getCurrentSettings()).mode === 'direct') {
      try { require('./src/native/web-media-guard').warmOfficialDns?.(); } catch (_) {}
    }
    startupStage = 'Tạo cửa sổ chính';
    createWindow();
    if (proxyStartup.fallback) {
      // Chỉ dừng tác vụ tự động; cửa sổ vẫn mở, người dùng có thể sửa proxy trong cài đặt hoặc tắt hẳn proxy.
      setTimeout(() => {
        try {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: `${APP_TITLE} - Proxy mạng`,
            message: 'Cấu hình proxy đã lưu lần trước không thể áp dụng, đã tạm thời khởi động bằng kết nối trực tiếp.',
            detail: `Tự động tiếp tục tải, làm mới theo dõi phim và tự động yêu cầu trang duyệt phim đã tạm dừng để tránh vượt qua proxy bạn đã thiết lập.${proxyStartup.fallbackError ? `\nKết nối trực tiếp tạm thời cũng thất bại: ${proxyStartup.fallbackError}` : ''}\nVui lòng sửa proxy trong cài đặt hoặc tắt hẳn proxy rồi lưu lại.`,
            buttons: ['Đã hiểu'],
            noLink: true,
          }).catch(() => {});
        } catch (_) { /* Bỏ qua trong môi trường không có cửa sổ */ }
      }, 500);
    } else {
      setTimeout(() => { void refreshWatchHistory(); }, 10000).unref();
      setInterval(() => { void refreshWatchHistory(); }, 15 * 60 * 1000).unref();
    }
  } catch (_) {
    console.error(`[Startup] ${startupStage} thất bại`);
    try {
      dialog.showErrorBox(`${APP_TITLE} khởi động thất bại`, `Không thể hoàn thành ${startupStage}. Vui lòng thoát và thử lại; nếu vẫn thất bại, hãy phản hồi thông báo này cho nhà phát triển. Dữ liệu hiện có sẽ không bị xóa.`);
    } finally { app.quit(); }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  casting.close();
  if (quitCleanup) { event.preventDefault(); return; }
  const jobs = [...compatPreparing.values()];
  const onlineJobs = [...onlineWork, ...onlinePreparing.values()];
  const pending = [...jobs.map(job => job.promise), ...onlineJobs.map(job => job.promise), ...mergeRuns.values(), ...downloadRuns.values()];
  if (compatClearing) pending.push(compatClearing);
  if (mergeTempCleanup) pending.push(mergeTempCleanup);
  const downloading = downloadRuns.size || downloadQueue.length;
  if (!pending.length && !downloading) { quitReady = true; return; }
  event.preventDefault();
  if (downloading) {
    try { pauseAllTasks(); }
    catch (_) {
      dialog.showErrorBox('Thoát chưa hoàn thành', 'Không thể lưu trạng thái tạm dừng tải về, đã hủy lần thoát này. Vui lòng kiểm tra bộ nhớ cục bộ rồi thử lại.');
      return;
    }
  }
  for (const job of jobs) cancelCompatJob(job);
  for (const job of onlineJobs) { try { job.controller.abort(); } catch (_) {} }
  for (const task of mergeTasks) {
    if (task.status !== 'running') continue;
    task.cancelled = true;
    require('./src/native/merge-runner').stopMergeChildren(task);
  }
  let timer;
  // A stalled child or predecessor must cancel this quit, never skip cleanup or quit later.
  quitCleanup = Promise.race([
    Promise.allSettled(pending).then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000); }),
  ]).then(completed => {
    clearTimeout(timer);
    quitCleanup = null;
    if (completed) app.quit();
    else dialog.showErrorBox('Thoát chưa hoàn thành', 'Dọn dẹp tác vụ quá 10 giây, đã hủy lần thoát này. Ứng dụng không bị buộc đóng, các tập gốc được giữ nguyên; tác vụ đang hoàn tất, vui lòng thử thoát lại sau.');
  });
});
