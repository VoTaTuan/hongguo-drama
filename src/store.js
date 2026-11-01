/**
 * store.js - Module lưu trữ dữ liệu Phim Ngắn Hồng Quả
 * Dùng một tệp JSON duy nhất lưu "Cài đặt" và "Nhiệm vụ tải về"
 */
const fs = require('fs');
const path = require('path');

let dataFile = null;
let cache = null; // { settings, tasks }
let durable = '{}';
let errorHandler = null;
let readError = null;
let writeError = false;
const READ_ERROR_MESSAGE = 'Đọc dữ liệu cục bộ thất bại, đã giữ nguyên tệp gốc và tạm dừng lưu; vui lòng kiểm tra quyền truy cập tệp hoặc thư mục rồi khởi động lại ứng dụng.';

function reportReadError() {
  try { errorHandler?.({ error: READ_ERROR_MESSAGE }); } catch {}
}

function loadCache() {
  if (!dataFile) throw new Error('store chưa được khởi tạo');
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
      throw new TypeError('Invalid store document');
    }
    for (const key of ['tasks', 'series', 'mergeTasks']) {
      if (key in cache && !Array.isArray(cache[key])) throw new TypeError(`Invalid store ${key}`);
    }
    for (const key of ['settings', 'playback']) {
      if (key in cache && (!cache[key] || typeof cache[key] !== 'object' || Array.isArray(cache[key]))) {
        throw new TypeError(`Invalid store ${key}`);
      }
    }
  } catch (e) {
    cache = {};
    if (e.code !== 'ENOENT') {
      readError = new Error(READ_ERROR_MESSAGE, { cause: e });
      readError.code = 'STORE_READ_FAILED';
      reportReadError();
    }
  }
  if (!Array.isArray(cache.tasks)) cache.tasks = [];
  if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
  durable = JSON.stringify(cache);
  return cache;
}

function flush() {
  if (!dataFile) return;
  if (readError) {
    cache = JSON.parse(durable);
    reportReadError();
    throw readError;
  }
  const temporary = dataFile + '.tmp';
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const serialized = JSON.stringify(cache || {}, null, 2);
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, serialized, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, dataFile);
    durable = serialized;
    if (writeError) {
      writeError = false;
      try { errorHandler?.(null); } catch {}
    }
  } catch (e) {
    try { fs.unlinkSync(temporary); } catch {}
    cache = JSON.parse(durable);
    writeError = true;
    try { errorHandler?.({ error: 'Lưu thất bại, vui lòng kiểm tra dung lượng ổ đĩa hoặc quyền thư mục; thay đổi chưa được lưu.' }); } catch {}
    throw e;
  }
}

function init(filePath) {
  dataFile = filePath;
  cache = null;
  readError = null;
  writeError = false;
  loadCache();
}

function getSettings() {
  return loadCache().settings;
}

function saveSettings(settings) {
  loadCache().settings = settings || {};
  flush();
}

function getAnnouncementState() {
  const state = loadCache().announcement;
  return state && typeof state === 'object' && !Array.isArray(state) ? structuredClone(state) : {};
}

function saveAnnouncementState(patch) {
  loadCache().announcement = { ...getAnnouncementState(), ...patch };
  flush();
}

function getTasks() {
  return loadCache().tasks;
}

function saveTasks(tasks) {
  loadCache().tasks = tasks || [];
  flush();
}

// ===== Hồ sơ phim ngắn (giúp trang phát liệt kê đầy đủ các tập ngay cả khi không có tác vụ tải xuống) =====
function getSeries() {
  const c = loadCache();
  if (!Array.isArray(c.series)) c.series = [];
  return c.series;
}

function saveSeries(list) {
  loadCache().series = list || [];
  flush();
}

// ===== Tiến độ phát (tiếp tục phát từ điểm dừng) =====
function getPlayback() {
  const c = loadCache();
  if (!c.playback || typeof c.playback !== 'object') c.playback = {};
  return c.playback;
}

function savePlayback(map) {
  loadCache().playback = map || {};
  flush();
}

// ===== Lịch sử tác vụ gộp tập =====
function getMergeTasks() {
  const c = loadCache();
  if (!Array.isArray(c.mergeTasks)) c.mergeTasks = [];
  return c.mergeTasks;
}

function saveMergeTasks(list) {
  loadCache().mergeTasks = list || [];
  flush();
}

module.exports = {
  setErrorHandler: (handler) => { errorHandler = handler; },
  init,
  getSettings,
  saveSettings,
  getAnnouncementState,
  saveAnnouncementState,
  getTasks,
  saveTasks,
  getSeries,
  saveSeries,
  getPlayback,
  savePlayback,
  getMergeTasks,
  saveMergeTasks,
};
