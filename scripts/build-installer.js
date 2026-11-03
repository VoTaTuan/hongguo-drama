/**
 * build-installer.js - Đóng gói ứng dụng Phim Ngắn Hồng Quả bằng Inno Setup
 * 
 * Quy trình:
 *   1. Kiểm tra môi trường & dependencies
 *   2. Tạo / kiểm tra icon.ico
 *   3. Build React & Electron (dist/win-unpacked/)
 *   4. Kiểm tra file thực thi .exe
 *   5. Biên dịch bộ cài đặt Inno Setup (dist/hongguo-downloader-<version>-setup.exe)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const pkg = require(path.join(REPO, 'package.json'));
const APP_VERSION = pkg.version || '5.4.0';

const ISCC_PLACES = [
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'Inno Setup 6', 'ISCC.exe')
];

function run(title, command, args, options = {}) {
  console.log(`\n=== ${title} ===`);
  const isWindows = process.platform === 'win32';
  const isShellCommand = isWindows && (command === 'npm' || command === 'npx' || command.endsWith('.cmd') || command.endsWith('.bat'));
  const cmd = isWindows && (command === 'npm' || command === 'npx') ? `${command}.cmd` : command;
  
  const result = spawnSync(cmd, args, {
    cwd: REPO,
    stdio: 'inherit',
    shell: isShellCommand,
    ...options
  });

  if (result.error) {
    console.error(`Lỗi thực thi lệnh: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Dừng lại: bước "${title}" bị lỗi (mã thoát ${result.status}).`);
    process.exit(result.status || 1);
  }
}

function findISCC() {
  for (const p of ISCC_PLACES) {
    if (fs.existsSync(p)) return p;
  }
  const whereCmd = process.platform === 'win32' ? 'where' : 'which';
  const check = spawnSync(whereCmd, ['iscc'], { encoding: 'utf8', shell: false });
  if (check.status === 0 && check.stdout) {
    const lines = check.stdout.trim().split(/\r?\n/);
    if (lines.length > 0 && fs.existsSync(lines[0].trim())) {
      return lines[0].trim();
    }
  }
  return null;
}

function ensureIcon() {
  const icoPath = path.join(REPO, 'build', 'icon.ico');
  const pngPath = path.join(REPO, 'build', 'icon.png');
  if (fs.existsSync(icoPath) && fs.statSync(icoPath).size > 1024) {
    return;
  }
  if (!fs.existsSync(pngPath)) {
    console.warn('Không tìm thấy build/icon.png để tạo icon.ico');
    return;
  }
  console.log('Đang tạo build/icon.ico từ build/icon.png...');
  const psScript = `
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Bitmap]::FromFile((Resolve-Path 'build/icon.png'))
    $bmp = New-Object System.Drawing.Bitmap(256, 256)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, 256, 256)
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = [System.IO.File]::OpenWrite((Join-Path (Get-Location) 'build/icon.ico'))
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    $img.Dispose()
  `;
  spawnSync('powershell', ['-NoProfile', '-Command', psScript], { cwd: REPO, stdio: 'inherit', shell: false });
}

function main() {
  console.log(`========================================================`);
  console.log(` Đóng gói Phim Ngắn Hồng Quả v${APP_VERSION}`);
  console.log(`========================================================`);

  // Bước 1: Dependencies
  if (!fs.existsSync(path.join(REPO, 'node_modules'))) {
    run('Cài đặt thư viện dependencies', 'npm', ['install']);
  }

  // Bước 2: Icon
  ensureIcon();

  // Bước 3: Build React và pack Electron
  run('Build React & Đóng gói Electron (win-unpacked)', 'npm', ['run', 'build:dir']);

  // Bước 4: Kiểm tra file exe sau khi pack
  const exePath = path.join(REPO, 'dist', 'win-unpacked', 'Phim Ngắn Hồng Quả.exe');
  if (!fs.existsSync(exePath)) {
    console.error(`Dừng lại: Không tìm thấy file thực thi tại "${exePath}"`);
    process.exit(1);
  }
  console.log(`\nOK Đã tạo file thực thi: ${exePath}`);

  // Bước 5: Inno Setup
  const iscc = findISCC();
  if (!iscc) {
    console.error('\nChưa có Inno Setup 6. Vui lòng tải ở https://jrsoftware.org/isdl.php rồi thử lại.');
    process.exit(1);
  }

  run('Inno Setup', iscc, [`/DMyAppVersion=${APP_VERSION}`, path.join(REPO, 'installer.iss')]);

  const setupFile = path.join(REPO, 'dist', `hongguo-downloader-${APP_VERSION}-setup.exe`);
  if (fs.existsSync(setupFile)) {
    const sizeMB = (fs.statSync(setupFile).size / (1024 * 1024)).toFixed(1);
    console.log(`\n========================================================`);
    console.log(`Xong. Bộ cài: ${setupFile} (${sizeMB} MB)`);
    console.log(`========================================================\n`);
  } else {
    console.log(`\nXong bước Inno Setup.`);
  }
}

main();
