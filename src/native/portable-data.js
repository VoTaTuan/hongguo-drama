/**
 * Thư mục dữ liệu bản di động Windows.
 *
 * Mục tiêu portable của electron-builder sẽ thiết lập PORTABLE_EXECUTABLE_DIR.
 * Bản di động đặt dữ liệu vào thư mục con data trong thư mục chương trình, mang theo khi di chuyển;
 * chỉ sao chép các tệp dữ liệu còn thiếu, không xóa dữ liệu cũ trong thư mục hệ thống.
 * Khi thư mục chương trình không có quyền ghi sẽ quay về dùng thư mục hệ thống.
 */
const fs = require('fs');
const path = require('path');

const DATA_FILES = Object.freeze(['data.json', 'danmaku-client.json']);
const PORTABLE_DATA_FOLDER = 'data';
const PORTABLE_MARKER = 'portable.marker';
const MIGRATION_SENTINEL = '.migration-incomplete';

function getPortableDirectory({ env = process.env, platform = process.platform, execPath = '' } = {}) {
  if (platform !== 'win32') return '';
  const configured = String(env.PORTABLE_EXECUTABLE_DIR || '').trim();
  if (configured) return path.resolve(configured);
  if (execPath && fs.existsSync(path.join(path.dirname(execPath), PORTABLE_MARKER))) return path.dirname(execPath);
  return '';
}

function isWritableDirectory(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

function recoverIncompleteMigration(toDir) {
  const sentinel = path.join(toDir, MIGRATION_SENTINEL);
  if (!fs.existsSync(sentinel)) return { ok: true };
  let names = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sentinel, 'utf8'));
    if (Array.isArray(parsed?.files)) names = parsed.files;
  } catch (_) { names = null; }
  if (!names) return { ok: false };
  const stuck = [];
  for (const name of names) {
    if (!DATA_FILES.includes(name)) continue;
    const file = path.join(toDir, name);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {
      stuck.push(name);
    }
  }
  if (stuck.length) return { ok: false, stuck };
  try { fs.unlinkSync(sentinel); } catch (_) { return { ok: false, stuck: ['sentinel'] }; }
  return { ok: true };
}

function migrateDataFiles(fromDir, toDir) {
  const copied = [];
  if (!fromDir || !toDir || path.resolve(fromDir) === path.resolve(toDir)) return { copied, failed: false };
  const pending = [];
  // Lưu tạm toàn bộ trước: Không chạm vào tệp chính thức trước khi tất cả sao chép thành công.
  try {
    for (const name of DATA_FILES) {
      const source = path.join(fromDir, name);
      const target = path.join(toDir, name);
      const temporary = `${target}.importing`;
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      try { fs.unlinkSync(temporary); } catch (_) { /* Không có tệp tạm còn sót lại */ }
      fs.copyFileSync(source, temporary);
      pending.push({ name, target, temporary });
    }
  } catch (_) {
    for (const item of pending) { try { fs.unlinkSync(item.temporary); } catch (_) { /* Đã không còn tồn tại */ } }
    return { copied: [], failed: true };
  }
  if (!pending.length) return { copied, failed: false };

  const sentinel = path.join(toDir, MIGRATION_SENTINEL);
  // Ghi cờ hiệu trước khi xác nhận: Khi gặp sự cố giữa chừng hoặc hoàn tác thất bại, lần khởi động sau sẽ biết không được dùng trực tiếp bộ dữ liệu này.
  try {
    fs.writeFileSync(sentinel, JSON.stringify({ files: pending.map(item => item.name) }));
  } catch (_) {
    for (const item of pending) { try { fs.unlinkSync(item.temporary); } catch (_) { /* Đã không còn tồn tại */ } }
    return { copied: [], failed: true };
  }

  const committed = [];
  try {
    for (const item of pending) {
      fs.renameSync(item.temporary, item.target);
      committed.push(item);
      copied.push(item.name);
    }
  } catch (_) {
    for (const item of committed) { try { fs.unlinkSync(item.target); } catch (_) { /* Khi không xóa được sẽ do sentinel xử lý dự phòng */ } }
    for (const item of pending) { try { fs.unlinkSync(item.temporary); } catch (_) { /* Đã đổi tên hoặc không tồn tại */ } }
    // Giữ lại sentinel; bên gọi sẽ quay về thư mục hệ thống, dọn dẹp/thử lại trong lần khởi động tiếp theo.
    return { copied: [], failed: true };
  }

  try {
    fs.unlinkSync(sentinel);
  } catch (_) {
    // Đã xác nhận nhưng không xóa được cờ hiệu: cũng quay về thư mục cũ, tránh lần khởi động sau hiểu nhầm dữ liệu còn sót là hoàn chỉnh.
    return { copied: [], failed: true };
  }
  return { copied, failed: false };
}

/**
 * Phân tích thư mục dữ liệu bản di động. Không gọi trực tiếp app.setPath, thuận tiện cho kiểm thử đơn vị.
 * @returns {{ mode: 'default'|'portable', dir: string, reason: string, copied: string[], portableDir: string }}
 */
function resolvePortableDataDir({
  env = process.env,
  platform = process.platform,
  defaultUserData,
  execPath,
} = {}) {
  const fallback = { mode: 'default', dir: defaultUserData || '', reason: '', copied: [], portableDir: '' };
  if (platform !== 'win32') return fallback;
  // File EXE di động đơn lẻ được thiết lập biến môi trường bởi electron-builder; file ZIP di động nhận diện qua tệp cờ hiệu.
  const portableDir = getPortableDirectory({ env, platform, execPath });
  if (!portableDir) return fallback;
  const target = path.join(portableDir, PORTABLE_DATA_FOLDER);
  if (!isWritableDirectory(target)) {
    return {
      ...fallback,
      portableDir,
      reason: 'Thư mục chương trình bản di động không có quyền ghi, đã tiếp tục dùng thư mục cấu hình hệ thống; vui lòng đặt chương trình vào vị trí có quyền ghi hoặc chuyển sang bản cài đặt.',
    };
  }
  const recovered = recoverIncompleteMigration(target);
  if (!recovered.ok) {
    return {
      ...fallback,
      portableDir,
      reason: 'Lần di chuyển dữ liệu di động trước chưa hoàn thành, đã tiếp tục dùng thư mục cấu hình hệ thống; vui lòng kiểm tra thư mục data trong thư mục chương trình rồi thử lại.',
      copied: [],
    };
  }
  const migration = migrateDataFiles(defaultUserData, target);
  if (migration.failed) {
    return {
      ...fallback,
      portableDir,
      reason: 'Sao chép dữ liệu cũ thất bại, đã tiếp tục dùng thư mục cấu hình hệ thống; vui lòng kiểm tra quyền thư mục chương trình rồi khởi động lại. Tệp gốc chưa bị xóa.',
      copied: [],
    };
  }
  return { mode: 'portable', dir: target, reason: '', copied: migration.copied, portableDir };
}

/**
 * Áp dụng kết quả phân tích thực tế vào Electron app: Bản di động chuyển đổi đồng thời userData và sessionData.
 * Xuất riêng biệt thuận tiện cho việc kiểm thử với app giả lập, không cần khởi chạy Electron.
 */
function applyPortableDataDir({ app, env, platform, execPath, defaultUserData } = {}) {
  const resolved = resolvePortableDataDir({ env, platform, execPath, defaultUserData });
  if (resolved.mode === 'portable') {
    app.setPath('userData', resolved.dir);
    try { app.setPath('sessionData', resolved.dir); }
    catch (_) {
      resolved.reason = 'Thiết lập thư mục phiên bản di động thất bại, dữ liệu giao diện có thể vẫn lưu trong thư mục hệ thống; cài đặt và lịch sử tải về đã dùng thư mục chương trình.';
    }
  }
  return resolved;
}

module.exports = {
  DATA_FILES,
  PORTABLE_DATA_FOLDER,
  PORTABLE_MARKER,
  MIGRATION_SENTINEL,
  getPortableDirectory,
  isWritableDirectory,
  migrateDataFiles,
  resolvePortableDataDir,
  applyPortableDataDir,
};
