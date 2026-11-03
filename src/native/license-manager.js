const crypto = require('crypto');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ==========================================
// CẤU HÌNH V2.1.0 HONGGUO DOWNLOAD (HD)
// ==========================================
const SERVER_URL = 'https://automasterst.dpdns.org';
const SERVER_HOST = 'automasterst.dpdns.org';
const CLIENT_API_KEY = 'ams-v2-secure-api-key-2026';
const CLIENT_VERSION = '2.1.0';
const PRODUCT_ID = 'HD';
const PRODUCT_NAME = 'Hongguo Download';
const LICENSE_API_SEGMENT = 'capcut';

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy4U9SBhi8Gx2HbcaIl0v
h2HqtWmSEM3a4/91rFaO/XucMkGQs0vcrciRFgJmlfyb2RDUgvjcJxPBqBYXfWrR
HDNd7xuGOfOjrmXjRYu06z7xi1CRPeQ6HuAULC1QmKU9wqqgULXeljRse7w5y9YE
SdN0u2104QqyHmwDs2ZJRtTmORYQEZEGNORKpZ33p3/hHyocYPoJ9PWshZO8SPEm
ar2L2vnX4HtzOaSq4RHIA/0XcFEmV2a6OOdUzhXFhZH0I7hlu8qz/TQF6DvfXitZ
Jx5661ftPT29jfcZLFhD1RIZ5cZM3XBLXXupKND31Ew/cuNZq/UxnZdkHolEcWf7
4QIDAQAB
-----END PUBLIC KEY-----`;

function getAppDataDir() {
  const base = process.env.APPDATA || (
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share')
  );
  return path.join(base, 'CapCutTool', PRODUCT_ID);
}

const APPDATA_DIR = getAppDataDir();
try {
  fs.mkdirSync(APPDATA_DIR, { recursive: true });
} catch (_) {}

const ACCOUNT_FILE = path.join(APPDATA_DIR, 'account.txt');
const LICENSE_FILE = path.join(APPDATA_DIR, 'license.txt');
const GRACE_TOKEN_FILE = path.join(APPDATA_DIR, '.sys_token.bin');
const DEVICE_SECRET_FILE = path.join(APPDATA_DIR, '.sys_dev.bin');
const HWID_CACHE_FILE = path.join(APPDATA_DIR, 'hwid_cache.txt');

class LicenseManager {
  constructor() {
    this.serverUrl = SERVER_URL;
    this.hwid = this.getHwid();
    this.licenseKey = null;
    this.username = null;
    this.password = null;
    this.isAccount = false;
    this.sessionData = {};
    this.authModes = ['LICENSE'];
    this.validationToken = null;
    this.verifiedFeatures = new Set();
    this.heartbeatTimer = null;
    this.fastLockTimer = null;
    this.onStatusChangeCallbacks = [];
    this.fetchAuthConfig().catch(() => {});
  }

  async fetchAuthConfig() {
    try {
      const urlPath = `/api/v2/client/auth-config?productId=${encodeURIComponent(PRODUCT_ID)}`;
      const data = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: SERVER_HOST,
          port: 443,
          path: urlPath,
          method: 'GET',
          headers: this._getHeaders(),
          timeout: 5000,
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
        req.end();
      });

      if (data && data.success) {
        let modes = ['LICENSE'];
        const raw = data.auth_modes || data.auth_mode;
        if (Array.isArray(raw)) {
          modes = raw;
        } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
          try { modes = JSON.parse(raw); } catch (_) { modes = ['LICENSE']; }
        } else if (raw === 'ACCOUNT_ONLY') {
          modes = ['ACCOUNT'];
        } else if (raw === 'ACCOUNT_AND_LICENSE') {
          modes = ['ACCOUNT', 'LICENSE'];
        } else {
          modes = ['LICENSE'];
        }
        this.authModes = modes;
      }
    } catch (_) {
      // Giữ nguyên mặc định nếu không kết nối được
    }
    return this.authModes;
  }

  // Lắng nghe thay đổi trạng thái
  onStatusChange(fn) {
    if (typeof fn === 'function') this.onStatusChangeCallbacks.push(fn);
  }

  notifyStatusChange(status, reason = '') {
    this.onStatusChangeCallbacks.forEach((cb) => {
      try { cb({ status, reason, is_active: this.isActive() }); } catch (_) {}
    });
  }

  isActive() {
    if (this.sessionData && this.sessionData.is_locked === 1) return false;
    if (this.sessionData && this.sessionData.status === 'locked') return false;
    if (this.sessionData && this.sessionData.is_active === false) return false;
    return !!(this.licenseKey || this.username);
  }

  getLicenseInfo() {
    let exp = 'Vĩnh viễn';
    if (this.sessionData) {
      exp = this.sessionData.expiresAt || this.sessionData.expireDate || this.sessionData.expires_at || exp;
    }
    const features = this.sessionData?.features || (this.licenseKey ? 'base' : '');
    return {
      is_active: this.isActive(),
      is_locked: this.sessionData?.is_locked === 1,
      status: this.sessionData?.status || (this.isActive() ? 'active' : 'inactive'),
      license_key: this.licenseKey || '',
      username: this.username || '',
      hwid: this.hwid,
      expiresAt: exp,
      features,
      product_id: PRODUCT_ID,
      product_name: PRODUCT_NAME,
      client_version: CLIENT_VERSION,
      auth_modes: this.authModes,
    };
  }

  // -------------------------------------------------------------
  // HWID COMPUTATION (Cache + Hardware Queries)
  // -------------------------------------------------------------
  getHwid() {
    try {
      if (fs.existsSync(HWID_CACHE_FILE)) {
        const cached = fs.readFileSync(HWID_CACHE_FILE, 'utf8').trim().toUpperCase();
        if (cached && cached.length === 32 && /^[0-9A-F]+$/.test(cached)) {
          return cached;
        }
      }
    } catch (_) {}

    const hwid = this._computeHwid();
    try {
      fs.writeFileSync(HWID_CACHE_FILE, hwid, 'utf8');
    } catch (_) {}
    return hwid;
  }

  _computeHwid() {
    if (process.platform === 'win32') {
      let uuid = '';
      try {
        const out = execSync('wmic csproduct get uuid', { windowsHide: true, timeout: 4000 }).toString();
        uuid = out.split('\n')[1]?.trim() || '';
      } catch (_) {}

      let cpu = '';
      try {
        const out = execSync('wmic cpu get processorid', { windowsHide: true, timeout: 4000 }).toString();
        const lines = out.split('\n').slice(1).map(l => l.trim()).filter(Boolean).sort();
        cpu = lines.join('') || 'UNKNOWN_CPU';
      } catch (_) {
        cpu = 'UNKNOWN_CPU';
      }

      let mb = '';
      try {
        const out = execSync('wmic baseboard get serialnumber', { windowsHide: true, timeout: 4000 }).toString();
        mb = out.split('\n')[1]?.trim() || '';
      } catch (_) {}

      const combined = `${uuid}-${cpu}-${mb}`;
      return crypto.createHash('md5').update(combined).digest('hex').toUpperCase();
    } else if (process.platform === 'darwin') {
      try {
        const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 4000 }).toString();
        const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        return crypto.createHash('md5').update((m ? m[1] : '') + '-mac').digest('hex').toUpperCase();
      } catch (_) {
        return crypto.createHash('md5').update(os.hostname() + '-mac').digest('hex').toUpperCase();
      }
    } else {
      try {
        const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        return crypto.createHash('md5').update(id + '-linux').digest('hex').toUpperCase();
      } catch (_) {
        return crypto.createHash('md5').update(os.hostname() + '-linux').digest('hex').toUpperCase();
      }
    }
  }

  // -------------------------------------------------------------
  // E2EE ENCRYPTION & SIGNATURE VERIFICATION
  // -------------------------------------------------------------
  _getHeaders() {
    return {
      'X-API-Key': CLIENT_API_KEY,
      'X-Client-Version': CLIENT_VERSION,
      'Content-Type': 'application/json',
      'User-Agent': 'Edu-Metrics-Secure-Client',
    };
  }

  _getPayload(licenseKey) {
    return {
      licenseKey,
      machineId: this.hwid,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      machineInfo: {
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()?.[0]?.model || 'UNKNOWN_CPU',
        product: PRODUCT_ID,
      },
    };
  }

  postE2EE(urlPath, payload, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const aesKey = crypto.randomBytes(32);
      const aesIv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesIv);
      const encryptedPayload = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
        cipher.final(),
      ]);

      const keyAndIv = Buffer.concat([aesKey, aesIv]);
      const encryptedKey = crypto.publicEncrypt({
        key: RSA_PUBLIC_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      }, keyAndIv);

      const bodyStr = JSON.stringify({
        e2ee_payload: encryptedPayload.toString('base64'),
        e2ee_key: encryptedKey.toString('base64'),
      });

      const req = https.request({
        hostname: SERVER_HOST,
        port: 443,
        path: urlPath,
        method: 'POST',
        headers: {
          ...this._getHeaders(),
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout,
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            if (json.e2ee_response) {
              const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesIv);
              const decrypted = Buffer.concat([
                decipher.update(Buffer.from(json.e2ee_response, 'base64')),
                decipher.final(),
              ]);
              const decryptedText = decrypted.toString('utf8');
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                text: decryptedText,
                data: JSON.parse(decryptedText),
              });
            } else {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                text: raw,
                data: json,
              });
            }
          } catch (err) {
            reject(new Error(`Lỗi phân giải phản hồi từ máy chủ: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Lỗi kết nối máy chủ: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Hết thời gian chờ phản hồi từ máy chủ bản quyền'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  verifyServerSignature(responseText, signatureToken) {
    if (!signatureToken) return { valid: false, message: 'Thiếu chữ ký bảo mật từ Server!' };
    try {
      const parts = signatureToken.split('.');
      if (parts.length !== 3) return { valid: false, message: 'Định dạng chữ ký JWT không hợp lệ!' };
      const [headerB64, payloadB64, sigB64] = parts;

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const signature = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const valid = verifier.verify(RSA_PUBLIC_KEY, signature);
      if (!valid) return { valid: false, message: 'Chữ ký Server giả mạo!' };

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      const expectedHash = payload.contentHash;
      const actualHash = crypto.createHash('sha256').update(responseText, 'utf8').digest('hex');

      if (expectedHash !== actualHash) {
        return { valid: false, message: 'Nội dung gói tin đã bị can thiệp (Hash Mismatch)!' };
      }
      return { valid: true, message: 'Hợp lệ' };
    } catch (err) {
      return { valid: false, message: `Lỗi xác minh chữ ký: ${err.message}` };
    }
  }

  // -------------------------------------------------------------
  // LOCAL STORAGE ENCRYPTION (AES-256-GCM / Salt)
  // -------------------------------------------------------------
  _deriveGcmKey() {
    const salt = 'CapCut_V2_Secret_Salt_888';
    const rawKey = `${this.hwid}_${salt}`;
    return crypto.createHash('sha256').update(`AMS-LOCAL-GCM-v1|${rawKey}`).digest();
  }

  _encryptData(dataObj) {
    const nonce = crypto.randomBytes(12);
    const key = this._deriveGcmKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('ams-local-secret-v1', 'utf8'));
    const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(dataObj), 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'eyJhbGciOiJBMjU2R0NNIiwidHlwIjoiSldUIn0.' + Buffer.concat([nonce, tag, encrypted]).toString('base64');
  }

  _decryptData(encStr) {
    if (!encStr || typeof encStr !== 'string') return null;
    try {
      const prefix = 'eyJhbGciOiJBMjU2R0NNIiwidHlwIjoiSldUIn0.';
      if (encStr.startsWith(prefix)) {
        const blob = Buffer.from(encStr.slice(prefix.length), 'base64');
        if (blob.length < 12 + 16) return null;
        const nonce = blob.subarray(0, 12);
        const tag = blob.subarray(12, 28);
        const ciphertext = blob.subarray(28);

        const decipher = crypto.createDecipheriv('aes-256-gcm', this._deriveGcmKey(), nonce);
        decipher.setAAD(Buffer.from('ams-local-secret-v1', 'utf8'));
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
      }
      return JSON.parse(encStr);
    } catch (_) {
      return null;
    }
  }

  saveSecretFile(filePath, dataObj) {
    try {
      const enc = this._encryptData(dataObj);
      fs.writeFileSync(filePath, enc, 'utf8');
      return true;
    } catch (e) {
      console.error('[License] Lưu file thất bại:', e.message);
      return false;
    }
  }

  loadSecretFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return this._decryptData(content);
    } catch (_) {
      return null;
    }
  }

  loadSavedAuth() {
    const auth = {};
    const acc = this.loadSecretFile(ACCOUNT_FILE);
    if (acc) {
      Object.assign(auth, acc);
      this.username = acc.username || null;
      this.password = acc.password || null;
      if (acc.session_data) this.sessionData = acc.session_data;
    }
    const lic = this.loadSecretFile(LICENSE_FILE);
    if (lic && lic.key) {
      auth.key = lic.key;
      this.licenseKey = lic.key;
    }
    return auth;
  }

  // -------------------------------------------------------------
  // VALIDATE ONLINE & OFFLINE
  // -------------------------------------------------------------
  async validate(licenseKey) {
    const cleanKey = String(licenseKey || '').trim();
    if (!cleanKey) return { success: false, error: 'Vui lòng nhập License Key!' };

    const url = `/api/v2/${LICENSE_API_SEGMENT}/validate`;
    try {
      const res = await this.postE2EE(url, this._getPayload(cleanKey));
      const sigHeader = res.headers['x-signature'];
      const sigCheck = this.verifyServerSignature(res.text, sigHeader);
      if (!sigCheck.valid) {
        return { success: false, error: `Cảnh báo bảo mật: ${sigCheck.message}` };
      }

      const data = res.data;
      if (res.statusCode === 200 && data.valid) {
        this.licenseKey = cleanKey;
        this.sessionData = data.license || {};
        this.sessionData.is_active = true;
        this.sessionData.status = 'active';

        // Lưu file bản quyền vào AppData
        this.saveSecretFile(LICENSE_FILE, { key: cleanKey });

        // Lưu Offline Grace Token nếu có
        if (data.v2?.graceToken) {
          this.saveSecretFile(GRACE_TOKEN_FILE, { token: data.v2.graceToken });
        }

        // Bắt đầu nhịp tim và kiểm tra khóa nhanh
        this.startHeartbeat();
        this.startFastLockCheck();

        return { success: true, message: 'Kích hoạt bản quyền thành công!' };
      } else {
        const errMsg = data.error || 'License Key không hợp lệ hoặc đã hết hạn!';
        return { success: false, error: errMsg };
      }
    } catch (err) {
      console.warn('[License] Lỗi mạng khi validate online, thử offline mode:', err.message);
      return this.validateOffline(cleanKey);
    }
  }

  validateOffline(licenseKey) {
    try {
      const grace = this.loadSecretFile(GRACE_TOKEN_FILE);
      if (!grace?.token) {
        return { success: false, error: 'Không thể kết nối máy chủ bản quyền và chưa có thẻ bài Offline.' };
      }
      const parts = grace.token.split('.');
      if (parts.length !== 3) return { success: false, error: 'Thẻ bài Offline bị hỏng.' };
      const [headerB64, payloadB64, sigB64] = parts;

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const signature = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (!verifier.verify(RSA_PUBLIC_KEY, signature)) {
        return { success: false, error: 'Thẻ bài Offline không hợp lệ!' };
      }

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      if (payload.machineId && payload.machineId !== this.hwid) {
        return { success: false, error: 'Thẻ bài Offline không dành cho máy này!' };
      }
      if (payload.licenseKey && payload.licenseKey !== licenseKey) {
        return { success: false, error: 'Thẻ bài Offline không khớp License Key!' };
      }

      this.licenseKey = licenseKey;
      this.sessionData = {
        features: payload.features || '',
        expiresAt: payload.expiresAt,
        status: 'offline_grace',
        is_active: true,
      };

      return { success: true, message: 'Đăng nhập Offline thành công (Grace Period)!' };
    } catch (e) {
      return { success: false, error: `Lỗi xác thực Offline: ${e.message}` };
    }
  }

  // -------------------------------------------------------------
  // ACCOUNT AUTHENTICATION & TRIAL
  // -------------------------------------------------------------
  async authAccount(username, password) {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/auth-account`;
    const payload = {
      username,
      password,
      isWebSaaS: true,
      machineId: this.hwid,
      product_id: PRODUCT_ID,
    };
    try {
      const res = await this.postE2EE(url, payload);
      const data = res.data;
      if (res.statusCode === 200 && data.valid) {
        this.username = username;
        this.password = password;
        this.isAccount = true;
        this.sessionData = data;

        // Lưu thông tin account
        this.saveSecretFile(ACCOUNT_FILE, { username, password, session_data: data });

        // Lấy danh sách license sở hữu
        try {
          const licRes = await this.getOwnedLicenses();
          if (licRes.success && Array.isArray(licRes.licenses) && licRes.licenses.length > 0) {
            const activeLic = licRes.licenses.find(l => !l.is_locked && l.status !== 'expired');
            if (activeLic) {
              const key = activeLic.license_key || activeLic.key;
              if (key) {
                this.licenseKey = key;
                this.saveSecretFile(LICENSE_FILE, { key });
              }
            }
          }
        } catch (_) {}

        this.startHeartbeat();
        this.startFastLockCheck();
        return { success: true, message: 'Đăng nhập tài khoản thành công!' };
      } else {
        return { success: false, error: data.error || 'Sai tài khoản hoặc mật khẩu!' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async registerAccount(username, email, phone, fullname, password) {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/register`;
    const payload = {
      username,
      password,
      email,
      phone_number: phone,
      full_name: fullname,
      isWebSaaS: true,
      hwid: this.hwid,
    };
    try {
      const res = await this.postE2EE(url, payload);
      const data = res.data;
      if (res.statusCode === 200 && data.valid) {
        this.username = username;
        this.password = password;
        this.saveSecretFile(ACCOUNT_FILE, { username, password });
        return { success: true, message: 'Đăng ký tài khoản thành công!' };
      } else {
        return { success: false, error: data.error || 'Đăng ký tài khoản thất bại!' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async claimTrial14Days(username) {
    const user = username || this.username;
    if (!user) return { success: false, error: 'Vui lòng đăng ký hoặc nhập tài khoản trước khi nhận dùng thử.' };

    const url = `/api/v2/${LICENSE_API_SEGMENT}/trial`;
    const payload = {
      machineId: this.hwid,
      productName: PRODUCT_ID,
      username: user,
      timestamp: Math.floor(Date.now() / 1000),
    };
    try {
      const res = await this.postE2EE(url, payload);
      const data = res.data;
      if (res.statusCode === 200 && data.valid && data.licenseKey) {
        // Tự động validate key trial vừa cấp
        const valRes = await this.validate(data.licenseKey);
        if (valRes.success) {
          return { success: true, message: 'Đã kích hoạt dùng thử Premium miễn phí 14 ngày!' };
        }
        return valRes;
      }
      return { success: false, error: data.error || 'Thiết bị hoặc tài khoản không đủ điều kiện nhận trial.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async forgotPassword(username, email) {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/forgot-password`;
    const payload = {
      username,
      email,
      machineId: this.hwid,
      clientUrl: 'OTP_MODE',
      appName: PRODUCT_NAME,
      reason: 'khôi phục mật khẩu',
    };
    try {
      const res = await this.postE2EE(url, payload);
      if (res.data?.success) {
        return { success: true, message: res.data.message || 'Đã gửi mã xác nhận qua Email!' };
      }
      return { success: false, error: res.data?.error || 'Lỗi gửi yêu cầu khôi phục' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async verifyOtp(token) {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/verify-otp`;
    try {
      const res = await this.postE2EE(url, { token });
      if (res.data?.success) {
        return { success: true, message: 'Mã xác nhận hợp lệ!' };
      }
      return { success: false, error: res.data?.error || 'Mã xác nhận không đúng' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async resetPassword(token, newPassword) {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/reset-password`;
    try {
      const res = await this.postE2EE(url, { token, newPassword });
      if (res.data?.success) {
        return { success: true, message: 'Đổi mật khẩu thành công!' };
      }
      return { success: false, error: res.data?.error || 'Lỗi đổi mật khẩu' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getOwnedLicenses() {
    const url = `/api/v2/${LICENSE_API_SEGMENT}/account/licenses`;
    const payload = {
      username: this.username || '',
      password: this.password || '',
      isWebSaaS: true,
      machineId: this.hwid,
    };
    try {
      const res = await this.postE2EE(url, payload);
      if (res.statusCode === 200) {
        const lic = res.data.licenses || [];
        return { success: true, licenses: Array.isArray(lic) ? lic : Object.values(lic) };
      }
      return { success: false, licenses: [], error: res.data.error || 'Không lấy được danh sách' };
    } catch (e) {
      return { success: false, licenses: [], error: e.message };
    }
  }

  logout() {
    try {
      if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
      if (fs.existsSync(ACCOUNT_FILE)) fs.unlinkSync(ACCOUNT_FILE);
      if (fs.existsSync(GRACE_TOKEN_FILE)) fs.unlinkSync(GRACE_TOKEN_FILE);
    } catch (_) {}
    this.licenseKey = null;
    this.username = null;
    this.password = null;
    this.sessionData = {};
    this.isAccount = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.fastLockTimer) clearInterval(this.fastLockTimer);
    this.notifyStatusChange('logged_out');
    return { success: true };
  }

  // -------------------------------------------------------------
  // HEARTBEAT & BACKGROUND CHECKS
  // -------------------------------------------------------------
  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 3 * 60 * 1000); // 3 phút
  }

  async heartbeat() {
    if (!this.licenseKey) return;
    const url = `/api/v2/${LICENSE_API_SEGMENT}/heartbeat`;
    try {
      const res = await this.postE2EE(url, this._getPayload(this.licenseKey), 5000);
      const data = res.data;
      if (data) {
        const isLocked = data.is_locked === 1 || data.is_locked === true;
        const isInactive = data.is_active === 0 || data.is_active === false;
        if (data.status === 'locked' || isLocked || isInactive) {
          this.sessionData.is_locked = 1;
          this.sessionData.is_active = false;
          this.notifyStatusChange('locked', data.reason || 'Bản quyền bị khóa');
        }
      }
    } catch (_) {}
  }

  startFastLockCheck() {
    if (this.fastLockTimer) clearInterval(this.fastLockTimer);
    this.fastLockTimer = setInterval(async () => {
      if (!this.licenseKey) return;
      try {
        const query = `licenseKey=${encodeURIComponent(this.licenseKey)}&machineId=${encodeURIComponent(this.hwid)}`;
        const req = https.request({
          hostname: SERVER_HOST,
          port: 443,
          path: `/api/v2/${LICENSE_API_SEGMENT}/status?${query}`,
          method: 'GET',
          headers: this._getHeaders(),
          timeout: 4000,
        }, (res) => {
          let str = '';
          res.on('data', c => str += c);
          res.on('end', () => {
            try {
              const data = JSON.parse(str);
              if (data.status === 'locked' || data.is_locked === 1 || data.valid === false) {
                this.sessionData.is_locked = 1;
                this.sessionData.is_active = false;
                this.notifyStatusChange('locked', data.reason || 'Bản quyền bị khóa');
              }
            } catch (_) {}
          });
        });
        req.on('error', () => {});
        req.end();
      } catch (_) {}
    }, 15000); // 15 giây/lần
  }

  // -------------------------------------------------------------
  // VALIDATE ON STARTUP
  // -------------------------------------------------------------
  async validateOnStartup() {
    await this.fetchAuthConfig().catch(() => {});
    const auth = this.loadSavedAuth();
    if (auth.username && auth.password) {
      const accRes = await this.authAccount(auth.username, auth.password);
      if (accRes.success) return true;
    }
    if (auth.key) {
      const licRes = await this.validate(auth.key);
      if (licRes.success) return true;
    }
    return false;
  }
}

module.exports = LicenseManager;
