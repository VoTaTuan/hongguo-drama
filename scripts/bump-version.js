/**
 * scripts/bump-version.js - Tăng phiên bản phát hành đồng bộ ở mọi nơi bắt buộc.
 *
 * Dùng: node scripts/bump-version.js [phiên bản mới]   (ví dụ 5.5 hoặc 5.5.0; bỏ trống = hỏi, gợi ý bản minor kế tiếp)
 *       node scripts/bump-version.js --yes 5.5         (không hỏi xác nhận)
 *
 * Quy ước dự án: phiên bản dạng X.Y.0 (hai thành phần công khai + vá nội bộ bằng 0).
 * Script cập nhật: package.json (version + artifactName), package-lock.json, installer.iss, scripts/check-release-version.cjs.
 * KHÔNG tự viết docs/release-X.Y.md, AGENTS.md hay announcements/: đó là nội dung phát hành do người phụ trách soạn.
 * BUMP_ROOT (tùy chọn) trỏ sang thư mục khác để thử mà không đụng vào dự án thật.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.BUMP_ROOT ? path.resolve(process.env.BUMP_ROOT) : path.resolve(__dirname, '..');
const file = name => path.join(ROOT, name);
const read = name => fs.readFileSync(file(name), 'utf8');

function parse(version) {
  const match = /^(\d+)\.(\d+)(?:\.0)?$/.exec(String(version).trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}
const toFull = ([major, minor]) => `${major}.${minor}.0`;
const toPublic = ([major, minor]) => `${major}.${minor}`;
const isNewer = (next, current) => next[0] > current[0] || next[0] === current[0] && next[1] > current[1];

/** Thay đúng `count` lần xuất hiện; sai số lượng nghĩa là cấu trúc tệp đã đổi, dừng thay vì sửa bừa. */
function replaceExactly(text, pattern, replacement, count, label) {
  let found = 0;
  // Dùng hàm thay thế để đếm chính xác; tự mở rộng $1, $2... vì hàm thay thế không tự làm việc đó.
  const result = text.replace(pattern, (...args) => {
    found++;
    return replacement.replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? '');
  });
  if (found !== count) throw new Error(`${label}: cần ${count} vị trí nhưng tìm thấy ${found}; hãy kiểm tra tệp rồi sửa tay.`);
  return result;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  const assumeYes = args.includes('--yes');
  let requested = args.find(arg => !arg.startsWith('--'));

  const currentFull = JSON.parse(read('package.json')).version;
  const current = parse(currentFull);
  if (!current || currentFull !== toFull(current)) throw new Error(`Phiên bản hiện tại "${currentFull}" không đúng dạng X.Y.0`);
  const suggested = toPublic([current[0], current[1] + 1]);

  console.log(`Phiên bản hiện tại: ${currentFull}`);
  if (!requested) requested = await ask(`Phiên bản mới (Enter = ${suggested}): `) || suggested;
  const next = parse(requested);
  if (!next) throw new Error(`"${requested}" không hợp lệ. Dùng dạng X.Y hoặc X.Y.0 (ví dụ ${suggested}).`);
  if (!isNewer(next, current)) throw new Error(`Phiên bản mới ${toFull(next)} phải lớn hơn hiện tại ${currentFull}.`);

  const oldFull = toFull(current), oldPublic = toPublic(current), newFull = toFull(next), newPublic = toPublic(next);
  if (!assumeYes) {
    const answer = await ask(`Tăng ${oldFull} -> ${newFull}? [y/N]: `);
    if (!/^y(es)?$/i.test(answer)) { console.log('Đã hủy, không thay đổi gì.'); process.exitCode = 2; return; }
  }

  // Tính toàn bộ nội dung mới trước, chỉ ghi khi mọi tệp đều hợp lệ để tránh cập nhật dở dang.
  const updates = new Map();
  let pkg = read('package.json');
  pkg = replaceExactly(pkg, new RegExp(`("version":\\s*")${oldFull.replace(/\./g, '\\.')}(")`), `$1${newFull}$2`, 1, 'package.json version');
  pkg = replaceExactly(pkg, new RegExp(`("artifactName":\\s*"[^"\\n]*?)${oldPublic.replace(/\./g, '\\.')}(?=-)`, 'g'), `$1${newPublic}`, 3, 'package.json artifactName');
  updates.set('package.json', pkg);

  // Chỉ đổi hai dòng version của chính dự án (gốc tệp và packages[""]); thư viện khác có thể trùng số phiên bản (vd. electron-winstaller 5.4.0).
  const lock = read('package-lock.json');
  const lockLines = lock.split('\n');
  const lockPattern = new RegExp(`^(\\s*"version":\\s*")${oldFull.replace(/\./g, '\\.')}(",?\\s*)$`);
  const lockRootEnd = lockLines.findIndex((line, index) => index > 0 && /^\s{4}"node_modules\//.test(line));
  const lockTargets = lockLines.map((line, index) => ({ line, index }))
    .filter(({ line, index }) => (lockRootEnd < 0 || index < lockRootEnd) && lockPattern.test(line.replace(/\r$/, '')));
  if (lockTargets.length !== 2) throw new Error(`package-lock.json version: cần 2 vị trí của dự án nhưng tìm thấy ${lockTargets.length}; hãy kiểm tra tệp rồi sửa tay.`);
  for (const { index } of lockTargets) lockLines[index] = lockLines[index].replace(lockPattern, `$1${newFull}$2`);
  updates.set('package-lock.json', lockLines.join('\n'));

  let iss = read('installer.iss');
  iss = replaceExactly(iss, new RegExp(`(#define MyAppVersion ")${oldFull.replace(/\./g, '\\.')}(")`), `$1${newFull}$2`, 1, 'installer.iss MyAppVersion');
  updates.set('installer.iss', iss);

  let check = read('scripts/check-release-version.cjs');
  check = replaceExactly(check, new RegExp(`assert\\.equal\\(pkg\\.version, '${oldFull.replace(/\./g, '\\.')}', 'Current source release target must be ${oldFull.replace(/\./g, '\\.')}'\\);`),
    `assert.equal(pkg.version, '${newFull}', 'Current source release target must be ${newFull}');`, 1, 'check-release-version.cjs');
  updates.set('scripts/check-release-version.cjs', check);

  for (const [name, content] of updates) fs.writeFileSync(file(name), content);
  console.log(`\nĐã tăng phiên bản ${oldFull} -> ${newFull} trong:`);
  for (const name of updates.keys()) console.log(`  - ${name}`);
  console.log(`\nCòn lại cho bạn (script không tự viết nội dung phát hành):`);
  console.log(`  - Tạo docs/release-${newPublic}.md (phát hành, xác minh, hạn chế).`);
  console.log(`  - Thêm mục "Phát hành ${newPublic}" vào AGENTS.md trỏ tới tài liệu đó.`);
  console.log(`  - Cập nhật announcements/ nếu cần thông báo trong ứng dụng.`);
  console.log(`  - Chạy npm test để xác nhận.`);
}

main().catch(error => { console.error(`Lỗi: ${error.message}`); process.exit(1); });
