// SPDX-License-Identifier: GPL-3.0-only
// Cầu nối CLI đọc-chỉ (JSON-Lines qua stdin/stdout, không mở cổng mạng) để công cụ ngoài
// như DramaStudio gọi phân giải danh sách tập và URL/khóa phát Hồng Quả theo từng yêu cầu người dùng.
// Không tự tải video, không tự thử lại vô hạn và không in khóa/URL/cookie ra stdout/stderr.
'use strict';

// Tự động chuyển tiếp sang dịch vụ nguồn gốc mới nhất (jackotom/hongguo-drama v8.2+ với V8-first & SDK v5)
// nếu thư mục anh em `../hongguo-drama-service/scripts/dramastudio-bridge.cjs` đã được cài đặt.
const fs = require('node:fs');
const path = require('node:path');
const upstreamServiceBridge = path.resolve(__dirname, '..', '..', 'hongguo-drama-service', 'scripts', 'dramastudio-bridge.cjs');
if (fs.existsSync(upstreamServiceBridge) && fs.statSync(upstreamServiceBridge).isFile()) {
  module.exports = require(upstreamServiceBridge);
  return;
}

const readline = require('node:readline');

const writeRawStdout = (line) => process.stdout.write(`${line}\n`);
// Chặn toàn bộ console.* của module nội bộ để không làm hỏng giao thức JSON-Lines hoặc lộ URL/khóa.
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};
console.debug = () => {};

const pkg = require('../package.json');
const hongguo = require('../src/native/hongguo');
const appSource = require('../src/native/app-source');
const { normalizeDownloadQuality } = require('../src/native/download-quality');

const ALLOWED_ERROR_CODES = new Set([
  'INVALID_INPUT',
  'SOURCE_UNAVAILABLE',
  'PREVIEW_ONLY',
  'EMPTY_RESPONSE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'DEVICE_REGISTRATION_FAILED',
  'BUSINESS_REJECTED',
  'INVALID_RESPONSE',
  'MISSING_MODEL',
  'SECURITY_BLOCKED',
  'NO_PLAYABLE_SOURCE',
  'QUALITY_UNAVAILABLE',
  'NO_COMPATIBLE_SOURCE',
]);

function safeErrorCode(rawCode, fallback = 'SOURCE_UNAVAILABLE') {
  const code = String(rawCode || '').trim();
  if (/^HTTP_[3-5]\d{2}$/.test(code)) return code;
  return ALLOWED_ERROR_CODES.has(code) ? code : fallback;
}

function safeMessage(error, fallback = 'Không thể phân giải nguồn video từ Hồng Quả') {
  const msg = String(error?.message || fallback).replace(/[\r\n\t]+/g, ' ').trim();
  // Không trả về URL có chữ ký hoặc chuỗi hex dài 32 ký tự trong thông báo lỗi.
  const cleaned = msg
    .replace(/https?:\/\/\S+/gi, '[URL_DA_CHE]')
    .replace(/\b[0-9a-f]{32}\b/gi, '[KHOA_DA_CHE]');
  return cleaned.slice(0, 320) || fallback;
}

function isDigitsId(value) {
  return typeof value === 'string' && /^\d{1,30}$/.test(value);
}

function extractHexKey(playInfo) {
  if (typeof playInfo?.contentKey === 'string' && /^[0-9a-f]{32}$/i.test(playInfo.contentKey)) {
    return playInfo.contentKey.toLowerCase();
  }
  if (typeof playInfo?.spadeA === 'string' && playInfo.spadeA.trim()) {
    try {
      const derived = hongguo.deriveKey(playInfo.spadeA.trim());
      if (Buffer.isBuffer(derived) && derived.length === 16) {
        return derived.toString('hex').toLowerCase();
      }
    } catch (_) {
      // Bỏ qua nếu spadeA không hợp lệ; bên gọi sẽ xử lý lỗi.
    }
  }
  return null;
}

function normalizeVariant(item) {
  if (!item || typeof item.url !== 'string' || !item.url.startsWith('https://')) return null;
  const contentKey = extractHexKey(item);
  const url = item.url.trim();
  const isHls = item.format === 'hls' || /\.m3u8(?:$|\?)/i.test(url);
  return {
    url,
    contentKey,
    userAgent: typeof item.userAgent === 'string' ? item.userAgent.slice(0, 256) : '',
    referer: typeof item.referer === 'string' ? item.referer.slice(0, 256) : '',
    codec: typeof item.codec === 'string' ? item.codec.slice(0, 32) : '',
    quality: typeof item.quality === 'string' ? item.quality.slice(0, 32) : '',
    source: typeof item.source === 'string' ? item.source.slice(0, 16) : 'app',
    isHls,
  };
}

async function handleEpisodes(req) {
  const seriesId = String(req.seriesId || '').trim();
  if (!isDigitsId(seriesId)) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Mã seriesId Hồng Quả phải là chuỗi số 1–30 chữ số.' };
  }
  const detail = await hongguo.fetchEpisodeList(seriesId, { force: req.force === true });
  const vids = Array.isArray(detail?.episodes)
    ? detail.episodes.map((ep) => String(ep?.vid || '')).filter(isDigitsId)
    : [];
  if (!vids.length) {
    return { ok: false, code: 'MISSING_MODEL', error: 'Không tìm thấy danh sách tập khả dụng cho bộ phim này.' };
  }
  return {
    ok: true,
    seriesId: String(detail.series_id || seriesId),
    seriesTitle: String(detail.series_title || '').slice(0, 200),
    total: vids.length,
    vids,
  };
}

async function handleResolve(req) {
  const vid = String(req.vid || '').trim();
  const seriesId = req.seriesId == null ? '' : String(req.seriesId).trim();
  if (!isDigitsId(vid)) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Mã vid tập phim phải là chuỗi số 1–30 chữ số.' };
  }
  if (seriesId && !isDigitsId(seriesId)) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Mã seriesId phim không hợp lệ.' };
  }
  let quality = 'auto';
  try {
    quality = normalizeDownloadQuality(req.quality || 'auto');
  } catch (err) {
    return { ok: false, code: 'INVALID_INPUT', error: safeMessage(err) };
  }
  const allowLowerQuality = req.allowLowerQuality !== false;

  // Ưu tiên App API (1080p/720p đầy đủ) trước trang web công khai (vốn hay chỉ mở bản xem thử 360p 10s).
  let primaryError = null;
  let resolved = null;
  try {
    resolved = await appSource.fetchAppPlayUrl(vid, { quality, allowLowerQuality });
  } catch (err) {
    primaryError = err;
  }

  // Chỉ thử trang web công khai khi thực sự mở phát đầy đủ (fetchPlayUrlFromWeb từ chối protectedPlayback=true).
  // Tuyệt đối KHÔNG gọi probeOfficialPublicMedia (tránh tải nhầm bản xem thử SEO 10 giây 360p làm tập đầy đủ).
  if (!resolved?.url && (quality === 'auto' || allowLowerQuality)) {
    const webFull = await hongguo.fetchPlayUrlFromWeb(vid, seriesId || undefined);
    if (webFull?.url) {
      resolved = webFull;
    }
  }

  if (!resolved?.url) {
    const code = safeErrorCode(primaryError?.code, 'SOURCE_UNAVAILABLE');
    const detailMsg = code === 'EMPTY_RESPONSE'
      ? 'Giao diện App Hồng Quả trả về phản hồi rỗng (HTTP 200, 0 byte) — cổng máy chủ Hồng Quả đang tạm giới hạn IP/vùng hoặc xác thực thiết bị. Hãy thử lại sau, bật proxy phù hợp, hoặc tìm phim trên XiFan / Hà Mã.'
      : safeMessage(primaryError, 'Không lấy được luồng phát từ API Hồng Quả lúc này.');
    return {
      ok: false,
      code,
      error: detailMsg,
    };
  }

  const primary = normalizeVariant(resolved);
  if (!primary) {
    return {
      ok: false,
      code: 'SECURITY_BLOCKED',
      error: 'Địa chỉ luồng phát trả về không phải HTTPS hợp lệ.',
    };
  }

  const variants = [];
  const seen = new Set([`${primary.url}:${primary.contentKey || ''}`]);
  if (Array.isArray(resolved.variants)) {
    for (const item of resolved.variants) {
      if (variants.length >= 4) break;
      const norm = normalizeVariant(item);
      if (!norm) continue;
      const key = `${norm.url}:${norm.contentKey || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(norm);
    }
  }

  return {
    ok: true,
    ...primary,
    variants,
  };
}

async function dispatch(req) {
  if (!req || typeof req !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', error: 'Yêu cầu JSON không hợp lệ.' };
  }
  switch (req.cmd) {
    case 'ping':
      return { ok: true, version: String(pkg.version || '0.0.0'), appSource: true };
    case 'episodes':
      return await handleEpisodes(req);
    case 'resolve':
      return await handleResolve(req);
    case 'quit':
      return { ok: true, quitting: true };
    default:
      return { ok: false, code: 'INVALID_INPUT', error: 'Lệnh cầu nối không được hỗ trợ.' };
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue = queue.then(async () => {
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch (_) {
      writeRawStdout(JSON.stringify({ id: '', ok: false, code: 'INVALID_INPUT', error: 'JSON đầu vào không hợp lệ.' }));
      return;
    }
    const id = req?.id == null ? '' : String(req.id).slice(0, 64);
    try {
      const result = await dispatch(req);
      writeRawStdout(JSON.stringify({ id, ...result }));
      if (result.quitting) {
        process.exit(0);
      }
    } catch (error) {
      writeRawStdout(JSON.stringify({
        id,
        ok: false,
        code: safeErrorCode(error?.code, 'SOURCE_UNAVAILABLE'),
        error: safeMessage(error),
      }));
    }
  });
});

rl.on('close', () => {
  queue.finally(() => process.exit(0));
});
