import React, { useState, useEffect } from 'react';
import './LicenseAuthModal.css';
import { Key, User, Shield, Copy, Check, AlertCircle, RefreshCw, Sparkles, X } from './icons';

export default function LicenseAuthModal({
  isOpen,
  onClose,
  onSuccess,
  canClose = true,
  initialTab = 'license',
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'license' | 'account'
  const [accountMode, setAccountMode] = useState('login'); // 'login' | 'register' | 'forgot' | 'verify' | 'reset'
  const [authModes, setAuthModes] = useState(['LICENSE']); // 'LICENSE' | 'ACCOUNT'

  // Input states
  const [licenseKey, setLicenseKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fullname, setFullname] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // UI status states
  const [hwid, setHwid] = useState('');
  const [copiedHwid, setCopiedHwid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (isOpen && window.electronAPI?.getLicenseInfo) {
      window.electronAPI.getLicenseInfo().then((info) => {
        if (info?.hwid) setHwid(info.hwid);
        if (info?.license_key) setLicenseKey(info.license_key);
        if (info?.username) setUsername(info.username);
        if (info?.auth_modes) {
          let modes = ['LICENSE'];
          if (Array.isArray(info.auth_modes)) {
            modes = info.auth_modes;
          } else if (typeof info.auth_modes === 'string' && info.auth_modes.startsWith('[')) {
            try { modes = JSON.parse(info.auth_modes); } catch (_) { modes = ['LICENSE']; }
          } else if (info.auth_modes === 'ACCOUNT_ONLY') {
            modes = ['ACCOUNT'];
          } else if (info.auth_modes === 'ACCOUNT_AND_LICENSE') {
            modes = ['ACCOUNT', 'LICENSE'];
          }
          setAuthModes(modes);
          const hasAcc = modes.some(m => String(m).toUpperCase() === 'ACCOUNT');
          const hasLic = modes.some(m => String(m).toUpperCase() === 'LICENSE');
          if (hasAcc && !hasLic) {
            setActiveTab('account');
          } else if (hasLic && !hasAcc) {
            setActiveTab('license');
          }
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyHwid = () => {
    if (!hwid) return;
    navigator.clipboard?.writeText(hwid).then(() => {
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2000);
    }).catch(() => {});
  };

  const handleValidateKey = async (e) => {
    e?.preventDefault();
    if (!licenseKey.trim()) {
      setErrorMessage('Vui lòng nhập License Key!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.validateLicenseKey(licenseKey.trim());
      if (res?.success) {
        setSuccessMessage('Kích hoạt bản quyền thành công!');
        setTimeout(() => {
          onSuccess?.();
          onClose?.();
        }, 800);
      } else {
        setErrorMessage(res?.error || 'License Key không hợp lệ!');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi kết nối máy chủ bản quyền');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginAccount = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Vui lòng điền đủ Tên tài khoản và Mật khẩu!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.loginLicenseAccount(username.trim(), password.trim());
      if (res?.success) {
        setSuccessMessage('Đăng nhập tài khoản thành công!');
        setTimeout(() => {
          onSuccess?.();
          onClose?.();
        }, 800);
      } else {
        setErrorMessage(res?.error || 'Sai tài khoản hoặc mật khẩu!');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterAccount = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password.trim() || !email.trim()) {
      setErrorMessage('Vui lòng nhập Tài khoản, Mật khẩu và Email!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.registerLicenseAccount({
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        fullname: fullname.trim(),
        password: password.trim(),
      });
      if (res?.success) {
        setSuccessMessage('Đăng ký thành công! Vui lòng đăng nhập.');
        setAccountMode('login');
      } else {
        setErrorMessage(res?.error || 'Đăng ký tài khoản thất bại!');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  const handleClaimTrial = async () => {
    const userToClaim = username.trim() || 'trial_user';
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.claimLicenseTrial(userToClaim);
      if (res?.success) {
        setSuccessMessage(res.message || 'Đã kích hoạt dùng thử 14 ngày thành công!');
        setTimeout(() => {
          onSuccess?.();
          onClose?.();
        }, 1000);
      } else {
        setErrorMessage(res?.error || 'Không đủ điều kiện nhận dùng thử trial trên máy này.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Không thể kết nối máy chủ trial');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !email.trim()) {
      setErrorMessage('Vui lòng nhập Tên tài khoản và Email đăng ký!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.forgotLicensePassword({
        username: username.trim(),
        email: email.trim(),
      });
      if (res?.success) {
        setSuccessMessage(res.message || 'Đã gửi mã xác nhận qua Email!');
        setAccountMode('verify');
      } else {
        setErrorMessage(res?.error || 'Lỗi gửi yêu cầu khôi phục');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi kết nối');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (!otpToken.trim()) {
      setErrorMessage('Vui lòng nhập mã OTP!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.verifyLicenseOtp(otpToken.trim());
      if (res?.success) {
        setSuccessMessage('Mã xác nhận hợp lệ!');
        setAccountMode('reset');
      } else {
        setErrorMessage(res?.error || 'Mã xác nhận không đúng');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi xác nhận');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (!newPassword.trim()) {
      setErrorMessage('Vui lòng nhập Mật khẩu mới!');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await window.electronAPI.resetLicensePassword({
        token: otpToken.trim(),
        newPassword: newPassword.trim(),
      });
      if (res?.success) {
        setSuccessMessage('Đổi mật khẩu thành công! Vui lòng đăng nhập.');
        setPassword(newPassword);
        setAccountMode('login');
      } else {
        setErrorMessage(res?.error || 'Đổi mật khẩu thất bại');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi đổi mật khẩu');
    } finally {
      setLoading(false);
    }
  };

  const hasLicense = authModes.some(m => String(m).toUpperCase() === 'LICENSE');
  const hasAccount = authModes.some(m => String(m).toUpperCase() === 'ACCOUNT');
  const showBothTabs = hasLicense && hasAccount;
  const currentTab = showBothTabs ? activeTab : (hasAccount && !hasLicense ? 'account' : 'license');

  return (
    <div className="license-modal-overlay">
      <div className="license-modal-card">
        {canClose && (
          <button type="button" className="license-close-btn" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        )}

        {/* Tab Header or Single Title */}
        {showBothTabs ? (
          <div className="license-tabs">
            <button
              type="button"
              className={`license-tab ${currentTab === 'license' ? 'active' : ''}`}
              onClick={() => { setActiveTab('license'); setErrorMessage(''); setSuccessMessage(''); }}
            >
              <Key size={15} />
              <span>Kích hoạt Bản quyền</span>
            </button>
            <button
              type="button"
              className={`license-tab ${currentTab === 'account' ? 'active' : ''}`}
              onClick={() => { setActiveTab('account'); setErrorMessage(''); setSuccessMessage(''); }}
            >
              <User size={15} />
              <span>Tài khoản Hệ thống</span>
            </button>
          </div>
        ) : (
          <div className="license-single-header">
            {hasAccount && !hasLicense ? (
              <>
                <User size={18} className="license-header-icon" />
                <span>Đăng nhập Tài khoản Hệ thống</span>
              </>
            ) : (
              <>
                <Key size={18} className="license-header-icon" />
                <span>Kích hoạt Bản quyền</span>
              </>
            )}
          </div>
        )}

        {/* HWID Badge */}
        <div className="license-hwid-box" title="Mã định danh phần cứng máy tính này">
          <div className="license-hwid-text">
            <span>HWID:</span>
            <strong>{hwid ? (hwid.length > 20 ? hwid.slice(0, 18) + '...' : hwid) : 'Đang đọc...'}</strong>
          </div>
          <button type="button" className="license-hwid-copy" onClick={copyHwid}>
            {copiedHwid ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            <span>{copiedHwid ? 'Đã chép' : 'Sao chép'}</span>
          </button>
        </div>

        {/* Alert Messages */}
        {errorMessage && (
          <div className="license-alert error">
            <AlertCircle size={14} />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="license-alert success">
            <Check size={14} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* TAB 1: LICENSE KEY */}
        {currentTab === 'license' && hasLicense && (
          <form onSubmit={handleValidateKey} className="license-form">
            <div className="license-field">
              <label>License Key:</label>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                className="license-input key-input"
                autoFocus
              />
            </div>

            <button type="submit" className="license-submit-btn green" disabled={loading}>
              {loading ? <RefreshCw size={15} className="spin" /> : <Shield size={15} />}
              <span>{loading ? 'Đang kiểm tra...' : 'Xác nhận Kích hoạt'}</span>
            </button>

            {/* Trial Button */}
            <button
              type="button"
              className="license-trial-btn"
              onClick={handleClaimTrial}
              disabled={loading}
            >
              <Sparkles size={15} />
              <span>Dùng thử Premium miễn phí 14 ngày</span>
            </button>
          </form>
        )}

        {/* TAB 2: ACCOUNT MANAGEMENT */}
        {currentTab === 'account' && hasAccount && (
          <div>
            {accountMode === 'login' && (
              <form onSubmit={handleLoginAccount} className="license-form">
                <div className="license-field">
                  <label>Tên đăng nhập:</label>
                  <input
                    type="text"
                    placeholder="Nhập tài khoản..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="license-input"
                    autoFocus
                  />
                </div>
                <div className="license-field">
                  <label>Mật khẩu:</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="license-input"
                  />
                </div>
                <button type="submit" className="license-submit-btn purple" disabled={loading}>
                  {loading ? <RefreshCw size={15} className="spin" /> : <User size={15} />}
                  <span>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
                </button>
                <div className="license-links">
                  <span onClick={() => { setAccountMode('register'); setErrorMessage(''); }}>Chưa có tài khoản? <strong>Đăng ký</strong></span>
                  <span onClick={() => { setAccountMode('forgot'); setErrorMessage(''); }}><strong>Quên mật khẩu?</strong></span>
                </div>
              </form>
            )}

            {accountMode === 'register' && (
              <form onSubmit={handleRegisterAccount} className="license-form">
                <div className="license-field">
                  <label>Tên tài khoản:</label>
                  <input
                    type="text"
                    placeholder="Tên đăng nhập..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="license-input"
                    autoFocus
                  />
                </div>
                <div className="license-field">
                  <label>Mật khẩu:</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="license-input"
                  />
                </div>
                <div className="license-field">
                  <label>Email liên hệ:</label>
                  <input
                    type="email"
                    placeholder="Email để nhận mã khôi phục..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="license-input"
                  />
                </div>
                <div className="license-field-row">
                  <div className="license-field">
                    <label>Họ tên:</label>
                    <input
                      type="text"
                      placeholder="Họ và tên..."
                      value={fullname}
                      onChange={(e) => setFullname(e.target.value)}
                      className="license-input"
                    />
                  </div>
                  <div className="license-field">
                    <label>SĐT:</label>
                    <input
                      type="text"
                      placeholder="Số điện thoại..."
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="license-input"
                    />
                  </div>
                </div>
                <button type="submit" className="license-submit-btn purple" disabled={loading}>
                  {loading ? <RefreshCw size={15} className="spin" /> : <Sparkles size={15} />}
                  <span>{loading ? 'Đang đăng ký...' : 'Tạo tài khoản'}</span>
                </button>
                <div className="license-links">
                  <span onClick={() => { setAccountMode('login'); setErrorMessage(''); }}>&larr; Quay lại Đăng nhập</span>
                </div>
              </form>
            )}

            {accountMode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="license-form">
                <div className="license-field">
                  <label>Tên tài khoản:</label>
                  <input
                    type="text"
                    placeholder="Tên tài khoản đã đăng ký..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="license-input"
                    autoFocus
                  />
                </div>
                <div className="license-field">
                  <label>Email:</label>
                  <input
                    type="email"
                    placeholder="Email đăng ký..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="license-input"
                  />
                </div>
                <button type="submit" className="license-submit-btn purple" disabled={loading}>
                  {loading ? <RefreshCw size={15} className="spin" /> : <Shield size={15} />}
                  <span>{loading ? 'Đang gửi mã...' : 'Gửi mã khôi phục'}</span>
                </button>
                <div className="license-links">
                  <span onClick={() => { setAccountMode('login'); setErrorMessage(''); }}>&larr; Quay lại Đăng nhập</span>
                </div>
              </form>
            )}

            {accountMode === 'verify' && (
              <form onSubmit={handleVerifyOtp} className="license-form">
                <div className="license-field">
                  <label>Mã OTP đã gửi về Email:</label>
                  <input
                    type="text"
                    placeholder="XXXXXX"
                    value={otpToken}
                    onChange={(e) => setOtpToken(e.target.value)}
                    className="license-input key-input"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                <button type="submit" className="license-submit-btn purple" disabled={loading}>
                  {loading ? <RefreshCw size={15} className="spin" /> : <Check size={15} />}
                  <span>{loading ? 'Đang xác minh...' : 'Xác nhận OTP'}</span>
                </button>
                <div className="license-links">
                  <span onClick={() => { setAccountMode('login'); setErrorMessage(''); }}>&larr; Quay lại Đăng nhập</span>
                </div>
              </form>
            )}

            {accountMode === 'reset' && (
              <form onSubmit={handleResetPassword} className="license-form">
                <div className="license-field">
                  <label>Mật khẩu mới:</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="license-input"
                    autoFocus
                  />
                </div>
                <button type="submit" className="license-submit-btn purple" disabled={loading}>
                  {loading ? <RefreshCw size={15} className="spin" /> : <Key size={15} />}
                  <span>{loading ? 'Đang lưu...' : 'Lưu mật khẩu mới'}</span>
                </button>
                <div className="license-links">
                  <span onClick={() => { setAccountMode('login'); setErrorMessage(''); }}>&larr; Quay lại Đăng nhập</span>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Footer Support */}
        <div className="license-modal-footer">
          <span>💬 Hỗ trợ Telegram: <strong onClick={() => window.open?.('https://t.me/+ohYhI2gzHq02OTE1')}>@Hỗ Trợ</strong></span>
          <span>•</span>
          <span>Phiên bản v2.1.0</span>
        </div>
      </div>
    </div>
  );
}
