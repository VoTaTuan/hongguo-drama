// Adapted from dawei233/hongguo-drama (GPL-3.0), commit c884fab6c6e36ad38173e251738b9b35f958383f.
// https://github.com/dawei233/hongguo-drama/tree/c884fab6c6e36ad38173e251738b9b35f958383f
'use strict';

/**
 * Chữ ký yêu cầu (request signing) cho giao diện danmaku Hồng Quả/Phiên Sa (X-Gorgon / X-Ladon / X-Argus).
 *
 * ## Tại sao tệp này lại có cấu trúc như thế này
 *
 * Giao diện thượng nguồn không có bất kỳ tài liệu công khai nào, thuật toán ký chỉ có thể
 * chuyển đổi từng byte từ bản triển khai đã được xác minh hoạt động.
 * Tệp này là bản chuyển đổi sang JavaScript của `nas-backend/danmaku.py`, vốn lại là bản chuyển đổi từ
 * phiên bản Go của guoapp (`provider_hongguo_comment_sign.go`). Ba tầng triển khai, cùng một thuật toán.
 *
 * Do đó tệp này có 2 ràng buộc cứng:
 *
 * 1. **Không được "tiện tay sửa" các đoạn mã có vẻ giống lỗi trong bản tham chiếu.** Ví dụ phân phối khóa
 *    RC4 của X-Gorgon là gán `box[i] = box[j]` thay vì hoán đổi — điều này trông có vẻ sai, nhưng máy chủ
 *    chấp nhận nó. Đổi thành hoán đổi "đúng" sẽ làm chữ ký mất hiệu lực.
 * 2. **Không được thay đổi độ rộng và vị trí cắt của các phép toán thao tác bit.** Toàn bộ phép toán 64-bit dùng BigInt và mask
 *    rõ ràng; số nguyên độ chính xác tùy ý của Python ở đây phải dựa vào `BigInt.asUintN` để khớp ngữ nghĩa.
 *
 * Tính chính xác được khẳng định từng byte bởi `danmaku-sign.test.cjs` bằng vector vàng tạo từ bản tham chiếu.
 * Sau khi sửa tệp này phải chạy kiểm thử đó trước, rồi chạy `scripts/check-danmaku-official.cjs` để xác minh mạng.
 *
 * ## Phụ thuộc
 *
 * Hầu như chỉ dùng thư viện chuẩn Node. MD5 dùng `node:crypto`; **SM3 tự mang bản triển khai JS thuần**, vì
 * BoringSSL tích hợp của Electron không có SM3 (xem chi tiết trong chú thích `sm3`). AES-128-CBC dùng
 * `node:crypto`, cả Electron và Node hệ thống đều hỗ trợ.
 */

const { createHash, createCipheriv, randomBytes } = require('node:crypto');

const M64 = (1n << 64n) - 1n;
const M32 = (1n << 32n) - 1n;

// ── Tóm tắt (Digest) ─────────────────────────────────────────────────────────

const md5 = data => createHash('md5').update(data).digest();

/**
 * Chuẩn mã hóa SM3: **Tái sử dụng tệp có sẵn** `sm3.js` trong kho mã, không đổi sang `createHash('sm3')`.
 *
 * Node hệ thống dùng OpenSSL 3, có SM3; nhưng Electron tích hợp BoringSSL
 * (`process.versions.openssl === '0.0.0'`), không có SM3, `createHash('sm3')` sẽ ném
 * `Digest method not supported`. `app-source.js` trước đó cũng đã vì lý do này mà viết
 * `sm3.js`, ở đây dùng chung trực tiếp, tránh bảo trì cùng một thuật toán ở hai nơi.
 *
 * Sự khác biệt này trong unit test ngoại tuyến **hoàn toàn không thấy được** (test chạy trên Node hệ thống, xanh toàn bộ),
 * chỉ khi ứng dụng thực sự chạy lên và gọi giao diện một lần mới lộ ra: X-Argus không tính được, toàn bộ giao diện danmaku sẽ thất bại.
 * `danmaku-sign.test.cjs` dùng vector chuẩn SM3 (bao gồm đầu vào dài vượt khối) và so sánh đối chiếu hai chiều với bản native
 * của Node hệ thống để khóa chặt rào chắn này.
 */
const sm3 = require('./sm3');

// ── Phép toán bit (khớp với _rotl32/_rotl64/_rotr64/_rotl8/_reverse8 của Python) ──────

const rotl32 = (x, n) => {
  const v = x & 0xFFFFFFFFn;
  const s = BigInt(n & 31);
  return ((v << s) | (v >> ((32n - s) & 31n))) & 0xFFFFFFFFn;
};

const rotl64 = (x, n) => {
  const v = BigInt.asUintN(64, x);
  const s = BigInt(((n % 64) + 64) % 64);
  return BigInt.asUintN(64, (v << s) | (v >> ((64n - s) & 63n)));
};

// _rotr64 của Python được định nghĩa là rotl64(x, -n).
const rotr64 = (x, n) => rotl64(x, -n);

const rotl8 = (x, n) => {
  const v = x & 0xFF;
  const s = n & 7;
  return ((v << s) | (v >> ((8 - s) & 7))) & 0xFF;
};

const reverse8 = x => {
  let v = x & 0xFF;
  v = ((v & 0xF0) >> 4) | ((v & 0x0F) << 4);
  v = ((v & 0xCC) >> 2) | ((v & 0x33) << 2);
  v = ((v & 0xAA) >> 1) | ((v & 0x55) << 1);
  return v & 0xFF;
};

// ── Tiện ích chung ──────────────────────────────────────────────────────────

/** PKCS#7, đệm cố định 1~16 byte (nhất quán với hongguoCommentPad của bản tham chiếu). */
function pad(data) {
  const padding = 16 - (data.length % 16);
  return Buffer.concat([Buffer.from(data), Buffer.alloc(padding, padding)]);
}

const u64le = buf => BigInt.asUintN(64, buf.readBigUInt64LE(0));
const putU64le = (value, target, offset) => target.writeBigUInt64LE(BigInt.asUintN(64, value), offset);

/** Số nguyên không dấu độ dài biến thiên của protobuf (tương đương với binary.AppendUvarint của Go). */
function uvarint(value) {
  let v = BigInt.asUintN(64, value);
  const out = [];
  for (;;) {
    const byte = Number(v & 0x7Fn);
    v >>= 7n;
    if (v) out.push(byte | 0x80);
    else {
      out.push(byte);
      return Buffer.from(out);
    }
  }
}

/** Nhất quán với newHongguoDeviceID của Go: 1e18 + số ngẫu nhiên, chuỗi số 19 chữ số. */
function newDeviceId(random = randomBytes) {
  const raw = BigInt.asUintN(64, BigInt('0x' + random(8).toString('hex')));
  return String(1000000000000000000n + (raw % 8000000000000000000n));
}

// ── Tham số query yêu cầu ──────────────────────────────────────────────────

/**
 * Các tham số query cố định. Những giá trị này giả lập client Android chính thức, thay đổi sẽ ảnh hưởng đến kiểm soát rủi ro của thượng nguồn,
 * không cần thiết thì không nên chỉnh sửa.
 */
function baseParams(deviceId, installId) {
  return {
    aid: '8662',
    app_name: 'novelread',
    version_code: '73532',
    version_name: '7.3.5.32',
    manifest_version_code: '73532',
    update_version_code: '73532',
    channel: 'update_64',
    device_platform: 'android',
    os: 'android',
    ssmix: 'a',
    device_type: '25053RT47C',
    device_brand: 'Redmi',
    language: 'zh',
    os_api: '36',
    os_version: '16',
    resolution: '1280*2772',
    dpi: '520',
    ac: 'wifi',
    device_id: deviceId,
    iid: installId,
  };
}

/**
 * Mô phỏng `urlencode` của Python (mặc định `quote_plus`).
 *
 * `encodeURIComponent` không escape `! ' ( ) *`, trong khi `quote` của Python thì có (nó chỉ giữ lại
 * `A-Za-z0-9_.-~`). Chữ ký được thực hiện trên chuỗi query, thiếu escape một ký tự `*` sẽ tính ra chữ ký mà máy chủ
 * từ chối, do đó ở đây bắt buộc phải bù đắp sự khác biệt này.
 */
const quotePlus = value =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');

function encodeQuery(pairs) {
  return pairs.map(([key, value]) => `${quotePlus(key)}=${quotePlus(value)}`).join('&');
}

/** Sắp xếp key theo thứ tự từ điển rồi mã hóa, nhất quán với hành vi url.Values.Encode của Go. */
function buildQuery({ stampMs, deviceId, installId, random = randomBytes }) {
  const params = baseParams(deviceId ?? newDeviceId(random), installId ?? newDeviceId(random));
  params._rticket = String(stampMs);
  const pairs = Object.entries(params).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return encodeQuery(pairs);
}

// ── X-Gorgon ──────────────────────────────────────────────────────────────

/**
 * Biến thể X-Gorgon mang nonce.
 *
 * Chú ý `box[i] = box[j]` là **phép gán** chứ không phải hoán đổi: chép nguyên xi bản tham chiếu, không "sửa cho đúng".
 */
function commentXGorgon(rawQuery, stamp, nonce) {
  const head2 = ((nonce[0] % 7) + 1) << 5;
  const head3 = 0xE0 | (nonce[1] & 0x0F);

  const seed = Buffer.alloc(20);
  const digest = md5(Buffer.from(rawQuery, 'utf8'));
  digest.copy(seed, 0, 0, 4);
  seed.set([0, 1, 7, 4], 12);
  seed.writeUInt32BE(Number(BigInt(stamp) & M32), 16);

  const key = Buffer.from([0x4A, 0x00, 0x16, head3, 0x47, 0x6C, 0x00, head2]);

  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i++) box[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i & 7]) & 0xFF;
    box[i] = box[j];
  }

  j = 0;
  for (let offset = 0; offset < 20; offset++) {
    const i = (offset + 1) & 0xFF;
    j = (j + box[i]) & 0xFF;
    box[i] = box[j];
    seed[offset] ^= box[(box[i] + box[j]) & 0xFF];
  }

  for (let i = 0; i < 20; i++) {
    seed[i] = (reverse8(rotl8(seed[i], 4) ^ seed[(i + 1) % 20]) ^ 0xEB) & 0xFF;
  }

  return Buffer.concat([Buffer.from([0x84, 0x04, head2 & 0xFF, head3 & 0xFF, 0x00, 0x00]), seed]).toString('hex');
}

// ── X-Ladon ───────────────────────────────────────────────────────────────

/** Mở rộng khóa uint64 34 vòng + biến đổi phong cách TEA + base64. */
function commentLadon(aid, timestamp, prefix) {
  const digest = Buffer.from(md5(Buffer.concat([Buffer.from(prefix), Buffer.from(String(aid), 'utf8')])).toString('hex'), 'ascii');

  let left = u64le(digest.subarray(0, 8));
  let right = u64le(digest.subarray(8, 16));
  const queue = [u64le(digest.subarray(16, 24)), u64le(digest.subarray(24, 32))];

  const keys = [];
  for (let i = 0; i < 34; i++) {
    keys.push(left);
    const mixed = BigInt.asUintN(64, (rotr64(right, 8) + left) ^ BigInt(i));
    queue.push(mixed);
    left = BigInt.asUintN(64, mixed ^ rotl64(left, 3));
    right = queue.shift();
  }

  const data = Buffer.from(pad(Buffer.from(`${Math.trunc(timestamp)}-1611921764-3019`, 'utf8')));
  for (let offset = 0; offset < data.length; offset += 16) {
    let bl = u64le(data.subarray(offset, offset + 8));
    let br = u64le(data.subarray(offset + 8, offset + 16));
    for (const key of keys) {
      br = BigInt.asUintN(64, key ^ BigInt.asUintN(64, bl + rotr64(br, 8)));
      bl = BigInt.asUintN(64, br ^ rotl64(bl, 3));
    }
    putU64le(bl, data, offset);
    putU64le(br, data, offset + 8);
  }

  return Buffer.concat([Buffer.from(prefix), data]).toString('base64');
}

// ── X-Argus ───────────────────────────────────────────────────────────────

const ARGUS_KEY = Buffer.from('ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c', 'hex');

/** Đóng gói protobuf thủ công + phái sinh SM3 + 72 vòng biến đổi + đóng gói AES-128-CBC. */
function commentArgus(rawQuery, timestamp, nonce) {
  const key = ARGUS_KEY;
  const parts = [];

  const varint = (field, value) => {
    parts.push(uvarint(BigInt(field) * 8n));
    parts.push(uvarint(value));
  };
  const bytesField = (field, value) => {
    parts.push(uvarint(BigInt(field) * 8n + 2n));
    parts.push(uvarint(BigInt(value.length)));
    parts.push(Buffer.from(value));
  };

  varint(1, BigInt(0x20200929 * 2));
  varint(2, 2n);
  varint(3, BigInt(nonce.readUInt32LE(6)));
  bytesField(4, Buffer.from('3019'));
  bytesField(6, Buffer.from('1611921764'));
  bytesField(7, Buffer.from('6.8.1.32'));
  bytesField(8, Buffer.from('v04.07.01-ml-android'));
  varint(9, 135135744n);
  bytesField(10, Buffer.alloc(8));
  varint(12, BigInt.asUintN(64, BigInt(timestamp) * 2n));

  const bodyHash = sm3(Buffer.alloc(16));
  const queryHash = sm3(Buffer.from(rawQuery, 'utf8'));
  bytesField(13, bodyHash.subarray(0, 6));
  bytesField(14, queryHash.subarray(0, 6));

  const nested = [0x08, (2 + (nonce[10] % 49) * 2) & 0xFF];
  for (const field of [2, 3, 4]) {
    nested.push(...uvarint(BigInt(field) * 8n));
    nested.push(...uvarint(1388734n));
  }
  bytesField(15, Buffer.from(nested));
  bytesField(20, Buffer.from('none'));
  varint(21, 738n);

  const data = Buffer.from(pad(Buffer.concat(parts)));

  const derived = sm3(Buffer.concat([key, Buffer.from([0x3C, 0xCC, 0x56, 0x7B]), key]));

  const rounds = new Array(72).fill(0n);
  for (let i = 0; i < 4; i++) rounds[i] = u64le(derived.subarray(i * 8, i * 8 + 8));
  for (let i = 4; i < 72; i++) {
    let mixed = BigInt.asUintN(64, rotr64(rounds[i - 1], 3) ^ rounds[i - 3]);
    mixed = BigInt.asUintN(64, mixed ^ rotr64(mixed, 1));
    rounds[i] = BigInt.asUintN(
      64,
      (~rounds[i - 4] & M64)
        ^ mixed
        ^ (BigInt.asUintN(64, 0x3DC94C3A046D678Bn >> BigInt((i - 4) % 62)) & 1n)
        ^ 3n,
    );
  }

  for (let offset = 0; offset < data.length; offset += 16) {
    let left = u64le(data.subarray(offset, offset + 8));
    let right = u64le(data.subarray(offset + 8, offset + 16));
    for (const round of rounds) {
      const next = BigInt.asUintN(
        64,
        left ^ (rotl64(right, 1) & rotl64(right, 8)) ^ rotl64(right, 2) ^ round,
      );
      left = right;
      right = next;
    }
    putU64le(left, data, offset);
    putU64le(right, data, offset + 8);
  }

  const xor = Buffer.from([0xD0, 0x4F, 0xFD, 0xFF, 0xD0, 0x4F, 0xFD, 0xFF]);
  for (let i = 0; i < data.length; i++) data[i] ^= xor[i % 8];
  const reversed = Buffer.concat([xor, data]).reverse();

  const container = pad(Buffer.concat([
    Buffer.from([0xA6, 0xE7, 0x83, 0xEE, 0x70, 0x01, 0x10, 0x09, 0x18]),
    reversed,
    Buffer.from([0x56, 0x7B]),
  ]));

  // AES-CBC của bản tham chiếu yêu cầu độ dài bản rõ đã là bội số của 16, và **không** nối thêm đệm,
  // nên ở đây bắt buộc phải tắt tự động đệm của Node, nếu không sẽ thừa ra một khối nguyên.
  const cipher = createCipheriv('aes-128-cbc', md5(key.subarray(0, 16)), md5(key.subarray(16)));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(container), cipher.final()]);

  return Buffer.concat([Buffer.from([0x3C, 0xCC]), encrypted]).toString('base64');
}

// ── Ghép header ────────────────────────────────────────────────────────────

/**
 * Tạo ra toàn bộ header chữ ký.
 *
 * `nonce` bắt buộc phải là 11 byte: mỗi đoạn được cấp cho thuật toán khác nhau (`[0:2]` vào Gorgon,
 * `[2:6]` vào Ladon, `[6:11]` vào Argus). Độ dài sai sẽ không báo lỗi, mà chỉ tính ra chữ ký
 * bị máy chủ từ chối — phía gọi phải tự mình đảm bảo.
 */
function signCommentHeaders({ rawQuery, stamp, nonce, aid = '8662' }) {
  return {
    'X-Gorgon': commentXGorgon(rawQuery, stamp, nonce),
    'X-Khronos': String(Math.trunc(stamp)),
    'X-SS-Req-Ticket': String(Math.trunc(stamp) * 1000),
    'X-SS-STUB': '',
    'X-Argus': commentArgus(rawQuery, stamp, nonce),
    'X-Ladon': commentLadon(aid, stamp, nonce.subarray(2, 6)),
  };
}

const NONCE_BYTES = 11;

module.exports = {
  baseParams,
  buildQuery,
  signCommentHeaders,
  newDeviceId,
  // Xuất tầng thấp: dùng cho kiểm thử đối chiếu từng mục với vector vàng
  commentXGorgon,
  commentLadon,
  commentArgus,
  md5,
  sm3,
  pad,
  uvarint,
  rotl64,
  rotr64,
  rotl8,
  reverse8,
  ARGUS_KEY,
  NONCE_BYTES,
};
