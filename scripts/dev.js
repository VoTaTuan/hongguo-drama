/**
 * scripts/dev.js - Trình khởi động chế độ phát triển
 *
 * Trước khi khởi động, kiểm tra cổng mạng có bị chiếm dụng không:
 *   - Cổng trống: Dùng trực tiếp
 *   - Cổng bị chiếm dụng: Tự động đổi sang cổng khả dụng tiếp theo (kèm thông báo)
 * Sau đó khởi động máy chủ phát triển Vite, chờ sẵn sàng rồi mở cửa sổ Electron.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PREFERRED_PORT = 5173; // Giữ đồng bộ với vite.config.js

// Kiểm tra cổng có bị chiếm dụng không (trả về true=đang bận)
function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

// Tìm cổng khả dụng tiếp theo bắt đầu từ start
async function findFreePort(start) {
  let port = start;
  while (await checkPort(port)) port++;
  return port;
}

// Chờ cổng sẵn sàng (Vite khởi động hoàn tất)
function waitPortReady(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      checkPort(port).then((busy) => {
        if (busy) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Chờ Vite khởi động quá thời gian'));
        }
      });
    }, 300);
  });
}

async function main() {
  const occupied = await checkPort(PREFERRED_PORT);
  const port = occupied ? await findFreePort(PREFERRED_PORT + 1) : PREFERRED_PORT;

  if (occupied) {
    console.log(`\n[Kiểm tra cổng] Cổng ${PREFERRED_PORT} đã bị chiếm dụng, tự động chuyển sang cổng ${port}\n`);
  } else {
    console.log(`\n[Kiểm tra cổng] Cổng ${PREFERRED_PORT} đang trống, khởi động bình thường\n`);
  }

  // 1. Khởi động máy chủ phát triển Vite (strictPort đảm bảo dùng đúng cổng đã chọn)
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env },
  });

  vite.on('error', (e) => {
    console.error('[Khởi động thất bại] Không thể khởi động Vite:', e.message);
    process.exit(1);
  });

  // 2. Chờ Vite sẵn sàng rồi khởi động Electron
  try {
    await waitPortReady(port);
  } catch (e) {
    console.error('[Khởi động thất bại]', e.message);
    vite.kill();
    process.exit(1);
  }

  const electron = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${port}` },
  });

  const cleanup = () => {
    try { vite.kill(); } catch (_) {}
    try { electron.kill(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  electron.on('exit', () => cleanup());
}

main().catch((e) => {
  console.error('[Khởi động thất bại]', e);
  process.exit(1);
});
