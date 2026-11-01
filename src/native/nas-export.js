'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const axios = require('axios');
const { seasonTitle } = require('./watch-history');
const { fetchPublicDetails } = require('./public-details');
const { publishMergedOutput } = require('./merge-runner');

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

async function checkRoot(destination) {
  try {
    if (!path.isAbsolute(destination.root) || await fsp.realpath(destination.root) !== destination.root ||
        !(await fsp.stat(destination.root)).isDirectory() || (await fsp.stat(destination.root)).dev !== destination.device)
      throw new Error();
  } catch (_) { throw new Error('Thư mục NAS không khả dụng, vui lòng gắn kết lại thư mục chia sẻ rồi thử lại'); }
}

async function directoryAt(destination, name) {
  await checkRoot(destination);
  const relative = path.relative(destination.root, destination.directory);
  if ((!relative && !destination.flat) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      path.basename(relative) !== relative) throw new Error('Thư mục đích NAS không hợp lệ');
  let directory = destination.root;
  for (const segment of [...(relative ? [relative] : []), ...(name ? [name] : [])]) {
    if (segment !== path.basename(segment) || segment === '..' || segment === '.') throw new Error('Thư mục con NAS không hợp lệ');
    directory = path.join(directory, segment);
    try { await fsp.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fsp.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Thư mục NAS không thể là liên kết tượng trưng (symlink) hoặc tệp thông thường');
  }
  return directory;
}

async function publishFile(target, data, source) {
  const temporary = path.join(path.dirname(target), `.nas-${randomUUID()}.tmp`);
  try {
    if (source) await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    else await fsp.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    publishMergedOutput(temporary, target);
  } finally { await fsp.unlink(temporary).catch(() => {}); }
}

async function writeMissing(target, data) {
  try { await publishFile(target, data); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fsp.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Trong NAS đã có tệp thông tin cùng tên không hợp lệ, vui lòng kiểm tra rồi thử lại');
  }
}

function imageExtension(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Nguồn không cung cấp ảnh bìa JPEG, PNG hoặc WebP khả dụng');
}

async function fetchPoster(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Địa chỉ ảnh bìa không hợp lệ');
  const response = await axios.get(url.href, { responseType: 'arraybuffer', timeout: 10000,
    signal: AbortSignal.timeout(10000), maxContentLength: 12 * 1024 * 1024, maxRedirects: 3,
    headers: { 'User-Agent': 'Mozilla/5.0' } });
  return Buffer.from(response.data);
}

async function prepareNasExport({ root, folderName, series }, { metadataFetcher = fetchPublicDetails, posterFetcher = fetchPoster } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !folderName || path.basename(folderName) !== folderName ||
      folderName === '.' || folderName === '..') throw new Error('Thư mục NAS hoặc tên thư mục không hợp lệ');
  root = await fsp.realpath(root);
  const parsed = seasonTitle(series.series_title);
  const destination = { root, device: (await fsp.stat(root)).dev, directory: root, flat: true,
    seriesId: String(series.series_id), title: folderName.replace(/-[a-f0-9]{12}$/, ''), season: parsed.invalid ? 1 : parsed.season };
  const directory = await directoryAt(destination), warnings = [];
  try {
    const existing = await fsp.lstat(path.join(directory, 'tvshow.nfo'));
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size > 256 * 1024)
      throw new Error('Thư mục đã chọn có thông tin phim dạng liên kết hoặc không hợp lệ, vui lòng chọn thư mục khác');
    const nfo = await fsp.readFile(path.join(directory, 'tvshow.nfo'), 'utf8');
    if (!nfo.includes(`<uniqueid type="hongguo" default="true">${xml(destination.seriesId)}</uniqueid>`))
      throw new Error('Thư mục đã chọn chứa thông tin phim khác hoặc không xác định được nguồn gốc, vui lòng chọn thư mục riêng cho bộ phim này');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let metadata = series;
  if (/^\d{6,30}$/.test(destination.seriesId)) {
    try { const fresh = await metadataFetcher(destination.seriesId); if (fresh?.success) metadata = { ...series, ...fresh }; }
    catch (_) { /* Missing source fields are reported below without blocking videos. */ }
  }
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
  if (description) {
    await writeMissing(path.join(directory, '简介.txt'), `${series.series_title}\n\n${description}\n`);
    const nfo = `<?xml version="1.0" encoding="UTF-8"?>\n<tvshow>\n  <title>${xml(series.series_title)}</title>\n  <plot>${xml(description)}</plot>\n  <uniqueid type="hongguo" default="true">${xml(destination.seriesId)}</uniqueid>\n</tvshow>\n`;
    await writeMissing(path.join(directory, 'tvshow.nfo'), nfo);
  } else warnings.push('Nguồn tạm thời chưa cung cấp tóm tắt cốt truyện, có thể nhấn lại để bổ sung tóm tắt và thông tin phim');
  try {
    const existing = await Promise.all(['jpg', 'png', 'webp'].map(ext => fsp.lstat(path.join(directory, `poster.${ext}`)).then(stat => stat.isFile() && !stat.isSymbolicLink() && stat.size > 0).catch(error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })));
    if (!existing.some(Boolean)) {
      const cover = metadata.cover || series.cover;
      if (!cover) throw new Error('Chưa cung cấp ảnh bìa');
      const image = Buffer.from(await posterFetcher(cover));
      const extension = imageExtension(image);
      await writeMissing(path.join(directory, `poster.${extension}`), image);
    }
  } catch (_) { warnings.push('Không thể lưu ảnh bìa, có thể nhấn lại để bổ sung'); }
  return { destination, warnings };
}

function nasEpisodeFilename(destination, episode) {
  const index = Number(episode.vid_index);
  if (!Number.isSafeInteger(index) || index < 1 || !Number.isSafeInteger(destination.season) || destination.season < 1 ||
      !destination.title || path.basename(destination.title) !== destination.title) throw new Error('Thông tin tập phim trên NAS không hợp lệ');
  const season = String(destination.season).padStart(2, '0');
  return `${destination.title} S${season}E${String(index).padStart(3, '0')}.mp4`;
}

async function episodePaths(destination, episode) {
  const filename = nasEpisodeFilename(destination, episode);
  const directory = await directoryAt(destination, destination.flat ? '' : `Season ${String(destination.season).padStart(2, '0')}`);
  const stem = path.join(directory, filename.slice(0, -4));
  return { video: `${stem}.mp4`, nfo: `${stem}.nfo`, index: Number(episode.vid_index) };
}

async function inspectNasEpisode(destination, episode) {
  const files = await episodePaths(destination, episode);
  try {
    const stat = await fsp.lstat(files.video);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 102400) {
      const nfoStat = await fsp.lstat(files.nfo).catch(() => null);
      const nfo = nfoStat?.isFile() && !nfoStat.isSymbolicLink() && nfoStat.size <= 256 * 1024
        ? await fsp.readFile(files.nfo, 'utf8') : '';
      if (nfo.includes(`<uniqueid type="hongguo" default="true">${xml(episode.vid)}</uniqueid>`))
        return { status: 'existing', path: files.video };
    }
    return { status: 'conflict', path: files.video };
  } catch (error) { if (error.code === 'ENOENT') return { status: 'missing', path: files.video }; throw error; }
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyNasEpisode(task, destination) {
  if (String(task.hongguoInfo?.series_id) !== destination.seriesId) throw new Error('Định danh phim trên NAS không khớp');
  const episode = task.hongguoInfo, files = await episodePaths(destination, episode);
  let copied = path.resolve(task.savePath) !== files.video;
  if (!copied) {
    const stat = await fsp.lstat(files.video);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Video cùng tên trên NAS là liên kết hoặc tệp không hợp lệ, chưa ghi thông tin tập');
  }
  try { if (copied) await publishFile(files.video, null, task.savePath); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fsp.lstat(files.video), original = await fsp.stat(task.savePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== original.size || await digest(files.video) !== await digest(task.savePath))
      throw new Error('Trong NAS đã có video cùng tên với nội dung khác, đã giữ nguyên tệp gốc, không ghi đè');
    copied = false;
  }
  const nfo = `<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails>\n  <title>${xml(episode.ep_title || episode.title || `Tập ${files.index}`)}</title>\n  <season>${destination.season}</season>\n  <episode>${files.index}</episode>\n  <uniqueid type="hongguo" default="true">${xml(episode.vid)}</uniqueid>\n</episodedetails>\n`;
  await writeMissing(files.nfo, nfo);
  return { copied, path: files.video };
}

module.exports = { prepareNasExport, inspectNasEpisode, copyNasEpisode, nasEpisodeFilename, checkNasDirectory: directoryAt };
