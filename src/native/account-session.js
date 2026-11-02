const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { signedAccountRequest, requestJson } = require('./app-source');
const { getPlaybackDevice } = require('./playback-device');

const WEB_BASE = 'https://hongguoduanju.com';
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WEB_QUERY = {
  aid: '513755', passport_jssdk_version: '3.4.10', passport_jssdk_type: 'normal',
  account_sdk_source: 'web', is_from_ttaccountsdk: '1', language: 'zh',
};

function safeMessage(error, fallback = 'Thao tác tài khoản thất bại, vui lòng thử lại sau') {
  return String(error?.message || fallback)
    .replace(/https?:\/\/\S+/gi, '[địa chỉ]')
    .replace(/(?:sessionid|sid_tt|passport_csrf_token)=[^;\s]+/gi, '$1=[đã ẩn]')
    .slice(0, 160);
}

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
  ]).finally(() => clearTimeout(timer));
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function cleanCover(value) {
  const text = String(value || '').trim();
  const url = text.startsWith('//') ? `https:${text}` : text;
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (/\.heic$/i.test(parsed.pathname) && /-reading-sign\.fqnovelpic\.com$/i.test(parsed.hostname)) {
      const source = parsed.pathname.split('~tplv-', 1)[0];
      return `https://p3-novel.byteimg.com${source}~tplv-shrink:320:0.webp`;
    }
    return /\.heic$/i.test(parsed.pathname) ? '' : url;
  } catch { return ''; }
}

function responseData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Định dạng phản hồi giao diện tài khoản Hồng Quả bất thường');
  if (payload.message && String(payload.message).trim().toLowerCase() !== 'success') {
    const description = payload.data?.description || payload.message;
    throw new Error(cleanText(description) || 'Thao tác tài khoản Hồng Quả chưa hoàn thành');
  }
  if (payload.code !== undefined && Number(payload.code) !== 0) {
    throw new Error(cleanText(payload.message || payload.msg) || `Giao diện tài khoản Hồng Quả trả về lỗi (${payload.code})`);
  }
  if (!payload.data || typeof payload.data !== 'object') throw new Error('Nội dung trả về của giao diện tài khoản Hồng Quả trống');
  return payload.data;
}

function parseQr(payload) {
  const data = responseData(payload);
  const token = String(data.token || '').trim();
  const source = String(data.qrcode || '').trim();
  if (!token || !source) throw new Error('Định dạng mã QR đăng nhập Hồng Quả đã thay đổi');
  const image = /^data:image\//i.test(source) ? source : `data:image/png;base64,${source.split('base64,').pop()}`;
  const rawExpiry = Number(data.expire_time);
  const expiresIn = rawExpiry > 1_000_000_000
    ? Math.max(0, Math.min(600, rawExpiry - Math.floor(Date.now() / 1000)))
    : Math.max(0, Math.min(600, rawExpiry || 180));
  return { token, image, expiresIn: Math.round(expiresIn) };
}

function parsePassportProfile(payload) {
  const data = responseData(payload);
  const id = String(data.user_id_str || data.user_id || '').trim();
  if (!id) throw new Error('Trạng thái đăng nhập không qua xác minh tài khoản Hồng Quả, vui lòng quét mã lại');
  if (!/^\d{1,30}$/.test(id) || !/[1-9]/.test(id)) throw new Error('Mã tài khoản Hồng Quả không hợp lệ, vui lòng quét mã lại');
  return { id, nickname: cleanText(data.name || data.screen_name || data.username) || 'Người dùng Hồng Quả' };
}

function parseStoredProfile(value) {
  const id = String(value?.id || '').trim();
  if (!/^\d{1,30}$/.test(id) || !/[1-9]/.test(id)) return null;
  return { id, nickname: cleanText(value?.nickname) || 'Người dùng Hồng Quả' };
}

function parseHistory(payload) {
  const data = responseData(payload);
  const rows = data.data_list;
  if (!Array.isArray(rows)) throw new Error('Định dạng lịch sử xem của APP đã thay đổi');
  return rows.map(row => {
    if (row?.is_delete) return null;
    const seriesId = String(row?.book_id_str || row?.book_id || row?.series_id || '').trim();
    const episodeId = String(row?.vid || row?.item_id || '').trim();
    if (!/^\d{1,30}$/.test(seriesId) || !/^\d{1,30}$/.test(episodeId)) return null;
    const index = Number(row?.vid_index);
    const seconds = value => Math.max(0, (Number(value) || 0) / 1000);
    const rawTime = Number(row?.read_timestamp_ms || row?.last_watch_time) || 0;
    return {
      series_id: seriesId,
      series_title: cleanText(row?.series_title || row?.book_name),
      cover: cleanCover(row?.series_cover_url || row?.thumb_url || row?.cover),
      episode_id: episodeId,
      vid_index: Number.isSafeInteger(index) && index > 0 ? index : 0,
      currentTime: seconds(row?.current_play_position ?? row?.current_play_time),
      duration: seconds(row?.duration ?? row?.current_total_time),
      updatedAt: rawTime > 0 && rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime,
      total: Math.max(0, Number(row?.episode_cnt || row?.episode_count) || 0),
      account: true,
    };
  }).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((row, index, list) => list.findIndex(item => item.series_id === row.series_id) === index)
    .slice(0, 50);
}

class CookieJar {
  constructor(header = '') {
    this.values = new Map();
    for (const pair of String(header).split(';')) {
      const at = pair.indexOf('=');
      if (at > 0) this.values.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  absorb(headers) {
    const raw = headers?.['set-cookie'];
    const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const line of lines) {
      const pair = String(line).split(';', 1)[0];
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      this.values.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  header() {
    return [...this.values].filter(([name, value]) => name && value).map(([name, value]) => `${name}=${value}`).join('; ');
  }
  hasSession() {
    return this.values.has('sessionid') || this.values.has('sessionid_ss');
  }
}

async function defaultWebRequest(url, options) {
  const axios = require('axios');
  const response = await axios({
    url, method: options.method || 'GET', headers: options.headers || {}, timeout: 12000,
    maxRedirects: 0, responseType: 'text', transformResponse: [data => data],
    maxContentLength: 2 * 1024 * 1024, maxBodyLength: 1024 * 1024, validateStatus: () => true,
  });
  return { status: response.status, headers: response.headers || {}, data: response.data || '' };
}

function checkedWebResponse(response) {
  if (!response || response.status !== 200) throw new Error(`Yêu cầu đăng nhập web Hồng Quả thất bại (HTTP ${response?.status || 'Không rõ'})`);
  const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
  if (!raw.trim() || raw.length > 2 * 1024 * 1024) throw new Error('Phản hồi đăng nhập web Hồng Quả bất thường');
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('Định dạng phản hồi đăng nhập web Hồng Quả bất thường'); }
  return payload;
}

function secureSessionStore({ filePath, safeStorage }) {
  return {
    save(credentials) {
      if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('Lưu trữ an toàn của hệ thống không khả dụng, phiên đăng nhập này chỉ giữ đến khi thoát ứng dụng');
      const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
      const temporary = `${filePath}.tmp`;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(temporary, 'w', 0o600);
      try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch {}
    },
    load() {
      if (!fs.existsSync(filePath)) return null;
      if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('Lưu trữ an toàn của hệ thống không khả dụng, không thể đọc phiên đăng nhập lần trước');
      const text = safeStorage.decryptString(fs.readFileSync(filePath));
      const value = JSON.parse(text);
      if (!value || typeof value.cookie !== 'string' || !value.cookie.trim()) throw new Error('Tệp trạng thái đăng nhập không hợp lệ, vui lòng quét mã lại');
      return value;
    },
    clear() {
      try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}

function createAccountService({
  filePath, safeStorage, webRequest = defaultWebRequest, identityRequest = getPlaybackDevice,
  accountRequest = requestJson, now = Date.now, onAccountExpired = () => {},
}) {
  const sessionStore = secureSessionStore({ filePath, safeStorage });
  let credentials = null;
  let profile = null;
  let history = [];
  let historyLoaded = false;
  let restorePromise = null;
  let generation = 0;
  let login = null;

  const publicAccount = extra => ({
    success: true, signedIn: !!profile, account: profile ? { ...profile } : null, ...extra,
  });

  async function accountJson(targetCredentials, apiPath, params = {}) {
    const signed = signedAccountRequest(apiPath, params, {
      device_id: targetCredentials.deviceId, iid: targetCredentials.installId, cdid: targetCredentials.cdid,
    });
    const deadline = Date.now() + 12000;
    return accountRequest(signed.url, {
      method: 'GET', headers: { ...signed.headers, Cookie: targetCredentials.cookie },
      preserveLargeIntegerFields: ['vid', 'video_id', 'item_id'],
    }, deadline, AbortSignal.timeout(12000));
  }

  async function verify(targetCredentials) {
    return parsePassportProfile(await webJson('/passport/account/info/v2/', {}, new CookieJar(targetCredentials.cookie)));
  }

  async function restore() {
    try {
      const saved = sessionStore.load();
      if (!saved) return publicAccount();
      const token = generation;
      const cachedProfile = parseStoredProfile(saved.profile);
      if (cachedProfile) {
        credentials = saved;
        profile = cachedProfile;
        withTimeout(verify(saved), 12000, 'Xác minh trạng thái đăng nhập quá thời gian').then(nextProfile => {
          if (token !== generation) return;
          profile = nextProfile;
          try { sessionStore.save({ ...saved, profile: nextProfile }); } catch {}
        }).catch(error => {
          if (token !== generation) return;
          const message = safeMessage(error);
          if (!/(?:会话过期|登录态未通过|账号编号无效|phiên hết hạn|trạng thái đăng nhập không qua|mã tài khoản không hợp lệ|HTTP\s*(?:401|403))/i.test(message)) return;
          credentials = null;
          profile = null;
          restorePromise = Promise.resolve(publicAccount());
          try { sessionStore.clear(); } catch {}
          onAccountExpired();
        });
        return publicAccount();
      }
      const nextProfile = await withTimeout(verify(saved), 12000, 'Xác minh trạng thái đăng nhập quá thời gian, vui lòng thử lại sau');
      if (token !== generation) return publicAccount();
      credentials = saved;
      profile = nextProfile;
      try { sessionStore.save({ ...saved, profile: nextProfile }); } catch {}
      return publicAccount();
    } catch (error) {
      return { success: true, signedIn: false, account: null, error: safeMessage(error, 'Tạm thời không thể khôi phục lần đăng nhập trước') };
    }
  }

  async function ensureRestored() {
    if (!restorePromise) restorePromise = restore();
    return restorePromise;
  }

  async function webJson(pathname, params = {}, jar = new CookieJar(), referer = `${WEB_BASE}/`) {
    const url = new URL(pathname, WEB_BASE);
    for (const [name, value] of Object.entries({ ...WEB_QUERY, ...params })) url.searchParams.set(name, value);
    const cookie = jar.header();
    const headers = {
      'User-Agent': WEB_UA, Referer: referer, Origin: WEB_BASE,
      Accept: 'application/json, text/javascript',
      ...(cookie ? { Cookie: cookie } : {}),
    };
    const response = await webRequest(url.href, { method: 'GET', headers });
    jar.absorb(response.headers);
    return checkedWebResponse(response);
  }

  async function finishRedirect(value, jar) {
    let url = new URL(value, WEB_BASE);
    for (let count = 0; count < 5; count++) {
      if (url.protocol !== 'https:' || !(url.hostname === 'hongguoduanju.com' || url.hostname.endsWith('.hongguoduanju.com'))) {
        throw new Error('Chuyển hướng xác nhận đăng nhập đến trang web không được hỗ trợ');
      }
      const response = await webRequest(url.href, {
        method: 'GET', headers: { 'User-Agent': WEB_UA, Referer: `${WEB_BASE}/`, Cookie: jar.header() },
      });
      jar.absorb(response.headers);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
        url = new URL(response.headers.location, url);
        continue;
      }
      if (response.status !== 200) throw new Error(`Xác nhận đăng nhập thất bại (HTTP ${response.status})`);
      return;
    }
    throw new Error('Số lần chuyển hướng xác nhận đăng nhập quá nhiều');
  }

  return {
    async status() {
      const restored = await ensureRestored();
      return restored.signedIn ? publicAccount() : restored;
    },

    async startLogin() {
      const jar = new CookieJar();
      const payload = await webJson('/passport/web/get_qrcode/', { next: `${WEB_BASE}/` }, jar);
      const qr = parseQr(payload);
      login = { id: randomUUID(), token: qr.token, jar, expiresAt: now() + qr.expiresIn * 1000 };
      return { success: true, loginId: login.id, image: qr.image, expiresIn: qr.expiresIn };
    },

    async pollLogin(loginId) {
      if (!login || login.id !== loginId) throw new Error('Phiên quét mã đã hết hạn, vui lòng lấy mã QR mới');
      if (now() >= login.expiresAt) {
        login = null;
        return { success: true, status: 'expired' };
      }
      const data = responseData(await webJson('/passport/web/check_qrconnect/', {
        next: `${WEB_BASE}/`, token: login.token,
      }, login.jar));
      console.log('[Account] QR status:', String(data.status || ''), data.redirect_url ? 'redirect' : 'no-redirect');
      if (['5', 'expired'].includes(String(data.status))) {
        login = null;
        return { success: true, status: 'expired' };
      }
      if (!['3', 'confirmed'].includes(String(data.status))) return { success: true, status: 'pending' };
      if (data.redirect_url) await finishRedirect(String(data.redirect_url), login.jar);
      console.log('[Account] Login session cookie:', login.jar.hasSession() ? 'present' : 'missing');
      if (!login.jar.hasSession()) return { success: true, status: 'pending' };

      const cookie = login.jar.header();
      console.log('[Account] Device identity and profile verify: start');
      const [identity, nextProfile] = await Promise.all([
        withTimeout(identityRequest(accountRequest), 10000, 'Khởi tạo thiết bị tài khoản quá thời gian, vui lòng thử lại'),
        withTimeout(verify({ cookie }), 15000, 'Xác minh thông tin tài khoản quá thời gian, vui lòng thử lại'),
      ]);
      console.log('[Account] Device identity and profile verify: done');
      const nextCredentials = {
        cookie, deviceId: identity.device_id, installId: identity.iid, cdid: identity.cdid,
      };
      let storageWarning = '';
      try { sessionStore.save({ ...nextCredentials, profile: nextProfile }); }
      catch (error) { storageWarning = safeMessage(error); }
      credentials = nextCredentials;
      profile = nextProfile;
      history = [];
      historyLoaded = false;
      generation++;
      login = null;
      restorePromise = Promise.resolve(publicAccount());
      return publicAccount({ storageWarning, status: 'signed-in' });
    },

    cancelLogin(loginId) {
      if (!login || (loginId && login.id !== loginId)) return { success: true };
      login = null;
      return { success: true };
    },

    async logout() {
      generation++;
      credentials = null;
      profile = null;
      history = [];
      historyLoaded = false;
      login = null;
      restorePromise = Promise.resolve(publicAccount());
      let storageWarning = '';
      try { sessionStore.clear(); } catch (error) { storageWarning = safeMessage(error); }
      return publicAccount({ storageWarning });
    },

    async refreshHistory() {
      const current = credentials;
      if (!current || !profile) return { success: true, signedIn: false, account: null, results: [] };
      const token = generation;
      const rows = parseHistory(await accountJson(current, '/reading/bookapi/read_history/list/v1/', {
        book_type: '2', limit: '0', offset: '0', last_min_read_timestamp_ms: '0',
        full_field: 'true', is_first_load: 'true', query_soft_deleted: 'false',
      }));
      if (token !== generation) return { success: true, signedIn: false, account: null, results: [] };
      history = rows.map(row => ({
        ...row,
        series_title: row.series_title || `Phim ${row.series_id}`,
      }));
      historyLoaded = true;
      return publicAccount({ results: history.map(row => ({ ...row })) });
    },

    async history({ refresh = false } = {}) {
      const current = credentials;
      if (!current || !profile) return { success: true, signedIn: false, account: null, results: [] };
      if (!historyLoaded || refresh) return this.refreshHistory();
      return publicAccount({ results: history.map(row => ({ ...row })) });
    },

    row(seriesId) {
      return history.find(row => row.series_id === String(seriesId)) || null;
    },
  };
}

module.exports = {
  createAccountService, secureSessionStore, parseQr, parsePassportProfile, parseHistory, safeMessage,
};
