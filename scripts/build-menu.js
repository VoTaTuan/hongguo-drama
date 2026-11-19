/**
 * scripts/build-menu.js - Menu đóng gói (được build.bat gọi).
 *
 * Toàn bộ chữ tiếng Việt có dấu nằm ở đây thay vì trong .bat: cmd.exe đọc sai tệp .bat chứa UTF-8 nhiều byte,
 * còn Node in UTF-8 đúng (build.bat đặt chcp 65001).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } };

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    // resolve(answer) phải chạy TRƯỚC rl.close(): sự kiện 'close' phát đồng bộ và sẽ trả '' trước nếu đảo thứ tự.
    rl.question(question, answer => { resolve(answer.trim()); rl.close(); });
    rl.once('close', () => resolve(''));
  });
}

const pause = () => ask('\nNhấn Enter để tiếp tục...');
// npm là npm.cmd trên Windows nên cần shell; truyền một chuỗi lệnh duy nhất (không kèm mảng đối số) để tránh cảnh báo DEP0190.
const run = (command, args = []) => spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: args.length === 0 }).status;
const closeApp = (flag, extra = []) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(__dirname, 'close-app.ps1'), flag, ...extra], { stdio: 'ignore' }).status;

/**
 * Nếu ứng dụng đang chạy (bản đóng gói hoặc chế độ dev) thì hỏi có đóng không; đang chạy sẽ gây lỗi EPERM khi build.
 * Trả về true nếu có thể build tiếp. `deps` cho phép thử mà không cần ứng dụng thật.
 */
async function ensureClosed({ check = () => closeApp('-Check'), close = () => closeApp('-Close'), prompt = ask, log = console.log } = {}) {
  if (check() === 0) return true;
  log('\nPhát hiện ứng dụng đang chạy. Đang chạy sẽ làm build bị lỗi EPERM.');
  const answer = await prompt('Đóng ứng dụng ngay bây giờ? [Y/N]: ');
  if (!/^y(es)?$/i.test(answer)) { log('Đã hủy: hãy đóng ứng dụng rồi chạy lại.'); return false; }
  if (close() !== 0) { log('Không đóng hết được ứng dụng, hãy đóng thủ công rồi chạy lại.'); return false; }
  log('Đã đóng ứng dụng.');
  return true;
}

function showMenu() {
  const v = version();
  console.clear();
  console.log('========================================================');
  console.log(` Đóng gói Phim Ngắn Hồng Quả  -  phiên bản hiện tại: ${v}`);
  console.log('========================================================\n');
  console.log('  [1] Bản chạy trực tiếp (dist\\win-unpacked)');
  console.log('      Build React + Electron, không tạo bộ cài.\n');
  console.log(`  [2] Bộ cài Inno Setup (dist\\hongguo-downloader-${v}-setup.exe)`);
  console.log('      Build lại React + Electron rồi biên dịch installer.iss.\n');
  console.log('  [3] Tăng phiên bản');
  console.log('      Cập nhật package.json, package-lock.json, installer.iss và');
  console.log('      scripts\\check-release-version.cjs. Không tự viết docs/thông báo.\n');
  console.log('  [0] Thoát\n');
}

const report = (status, success) => console.log(status === 0 ? `\n${success}` : '\nBuild thất bại hoặc bị hủy (xem thông báo ở trên).');

async function main() {
  for (;;) {
    showMenu();
    const choice = await ask('Chọn [1/2/3/0] rồi Enter: ');
    if (choice === '0' || choice === '') return;
    if (choice === '1') {
      console.log('\n=== Build bản chạy trực tiếp (win-unpacked) ===');
      if (!(await ensureClosed())) { await pause(); continue; }
      const status = run('npm run build:dir');
      report(status, 'Xong: dist\\win-unpacked\\');
      await pause();
    } else if (choice === '2') {
      console.log('\n=== Build bộ cài Inno Setup ===');
      if (!(await ensureClosed())) { await pause(); continue; }
      report(run(process.execPath, [path.join(__dirname, 'build-installer.js')]), 'Hoàn tất bộ cài.');
      await pause();
    } else if (choice === '3') {
      console.log('\n=== Tăng phiên bản ===');
      run(process.execPath, [path.join(__dirname, 'bump-version.js')]);
      await pause();
    }
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), error => { console.error(`Lỗi: ${error.message}`); process.exit(1); });
}

module.exports = { ensureClosed };
