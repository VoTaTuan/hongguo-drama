import React, { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, User } from './icons';
import './AccountManagement.css';

export default function AccountManagement({ active = true }) {
  const [account, setAccount] = useState(null);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const request = useRef(0);
  const historyRequest = useRef(0);
  const generation = useRef(0);
  const pollTimer = useRef(null);
  const visibleRows = rows.filter(row => !query.trim() || row.series_title.includes(query.trim()));

  const loadHistory = async (refresh = false) => {
    const version = ++historyRequest.current;
    setHistoryLoading(true);
    try {
      const result = await window.electronAPI.getAccountHistory?.({ refresh });
      if (version !== historyRequest.current) return;
      if (!result?.success) throw new Error(result?.error || 'Tải lịch sử xem trên ứng dụng thất bại');
      setRows(result.signedIn ? result.results || [] : []);
      if (result.warning) setStatus(`Đã đọc lịch sử ứng dụng; ${result.warning}`);
    } catch (failure) {
      if (version === historyRequest.current) setError(failure.message || 'Tải lịch sử xem trên ứng dụng thất bại, vui lòng thử lại');
    } finally {
      if (version === historyRequest.current) setHistoryLoading(false);
    }
  };

  const load = async () => {
    const version = ++request.current;
    try {
      const result = await window.electronAPI.getAccountStatus?.();
      if (version !== request.current) return;
      if (!result?.success) throw new Error(result?.error || 'Đọc trạng thái tài khoản thất bại');
      setAccount(result.account || null);
      setError(result.error || '');
      setLoading(false);
      if (result.signedIn) {
        await loadHistory();
      } else {
        historyRequest.current++;
        setRows([]);
      }
    } catch (failure) {
      if (version === request.current) setError(failure.message || 'Đọc trạng thái tài khoản thất bại, vui lòng thử lại');
    } finally {
      if (version === request.current) {
        setLoading(false);
      }
    }
  };

  const schedulePoll = (loginId, token) => {
    clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      if (token !== generation.current) return;
      try {
        const result = await window.electronAPI.pollAccountLogin?.(loginId);
        if (token !== generation.current) return;
        if (!result?.success) throw new Error(result?.error || 'Đọc trạng thái quét mã thất bại');
        if (result.status === 'signed-in') {
          generation.current++;
          setBusy(false); setQr(null); setAccount(result.account || null);
          setStatus(result.storageWarning || 'Đăng nhập thành công');
          loadHistory();
          return;
        }
        if (result.status === 'cancelled') { setBusy(false); setQr(null); setStatus('扫码已取消'); return; }
        if (result.status === 'expired') {
          setBusy(false); setQr(null); setError('Mã QR đã hết hạn, vui lòng lấy mã mới.');
          return;
        }
        setStatus('Đang chờ điện thoại xác nhận đăng nhập…');
        schedulePoll(loginId, token);
      } catch (failure) {
        if (token === generation.current) {
          setBusy(false); setQr(null);
          setError(failure.message || 'Đăng nhập quét mã chưa hoàn tất, vui lòng thử lại');
        }
      }
    }, 1000);
  };

  const beginLogin = async () => {
    const token = ++generation.current;
    setBusy(true); setError(''); setStatus('Đang lấy mã QR đăng nhập Hồng Quả…');
    try {
      const result = await window.electronAPI.startAccountLogin?.();
      if (token !== generation.current) return;
      if (!result?.success) throw new Error(result?.error || 'Lấy mã QR thất bại');
      setQr({ id: result.loginId, image: result.image });
      setStatus(`Vui lòng dùng ứng dụng Hồng Quả trên điện thoại để quét mã và xác nhận đăng nhập. Mã QR có hiệu lực trong khoảng ${result.expiresIn} giây.`);
      schedulePoll(result.loginId, token);
    } catch (failure) {
      if (token === generation.current) {
        setBusy(false);
        setError(failure.message || 'Lấy mã QR thất bại, vui lòng thử lại');
      }
    }
  };

  const cancelLogin = async () => {
    generation.current++;
    clearTimeout(pollTimer.current);
    const id = qr?.id;
    setQr(null); setBusy(false); setStatus('Đã hủy đăng nhập quét mã');
    if (id) await window.electronAPI.cancelAccountLogin?.(id).catch(() => {});
  };

  const logout = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await window.electronAPI.logoutAccount?.();
      if (!result?.success) throw new Error(result?.error || 'Đăng xuất tài khoản thất bại');
      historyRequest.current++;
      setAccount(null); setRows([]); setQuery(''); setStatus('Đã đăng xuất tài khoản Hồng Quả, lịch sử trên máy không bị ảnh hưởng.');
    } catch (failure) { setError(failure.message || 'Đăng xuất tài khoản thất bại, vui lòng thử lại'); }
    finally { setBusy(false); }
  };

  const open = async row => {
    if (!active || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.playAccountHistory?.(row.series_id);
      if (!result?.success) throw new Error(result?.error || 'Mở lịch sử xem ứng dụng thất bại');
    } catch (failure) { setError(failure.message || 'Mở lịch sử xem ứng dụng thất bại, vui lòng thử lại'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (active) load();
    return () => { request.current++; historyRequest.current++; };
  }, [active]);
  useEffect(() => window.electronAPI.onAccountUpdated?.(() => { if (active) load(); }), [active]);
  useEffect(() => () => {
    generation.current++;
    clearTimeout(pollTimer.current);
  }, []);

  if (loading) return <div className="account-page"><p role="status">Đang tải tài khoản Hồng Quả…</p></div>;

  return <div className="account-page">
    <div className="account-page-header">
      <User size={22} />
      <div><h2>Tài khoản Hồng Quả</h2><p>Quét mã QR để đăng nhập tài khoản Hồng Quả và đồng bộ lịch sử xem từ ứng dụng.</p></div>
    </div>
    {!account && <div><button className="btn btn-outline" disabled={busy} onClick={async () => { try { const result = await window.electronAPI.openAccountWebLogin(); if (!result?.success) throw new Error(result?.error || 'Mở trang web đăng nhập thất bại'); } catch(e) { setError(e.message); } }}>Đăng nhập qua trang web chính thức</button><p>Khi điện thoại báo mã QR không hợp lệ, bạn có thể mở trang web chính thức và đăng nhập bằng phương thức trang web cung cấp.</p></div>}
    <section className="account-card" aria-label="Trạng thái tài khoản Hồng Quả">
      {account ? <>
        <div className="account-identity">
          <span className="account-avatar"><User size={24} /></span>
          <div><strong>{account.nickname}</strong><p>Đã đăng nhập tài khoản Hồng Quả</p></div>
        </div>
        <div className="account-summary">
          <span>Lịch sử xem ứng dụng</span>
          <strong>{historyLoading && !rows.length ? 'Đang đọc' : `${rows.length} phim`}</strong>
          <small>50 phim gần nhất; không tự động nhập hàng loạt vào máy</small>
        </div>
        <div className="account-page-actions">
          <button className="btn btn-outline" type="button" disabled={busy || historyLoading} onClick={async () => {
            setBusy(true); setError(''); setStatus('');
            try { await loadHistory(true); } finally { setBusy(false); }
          }}><RefreshCw size={15} />Làm mới lịch sử</button>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={logout}>Đăng xuất</button>
        </div>
        <div className="account-history-heading">
          <h3>Lịch sử xem</h3>
          <label>Tìm kiếm<input className="input-field" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nhập tên phim" /></label>
        </div>
        {historyLoading && !rows.length ? <div className="account-history-empty" role="status">Đang đọc lịch sử xem từ ứng dụng…</div>
          : !rows.length ? <div className="account-history-empty">Ứng dụng chưa có lịch sử xem.</div>
          : !visibleRows.length ? <div className="account-history-empty">Không có bản ghi phù hợp.</div>
          : <ul className="account-history-list">{visibleRows.map(row => <li key={row.series_id}>
            <button type="button" disabled={busy} onClick={() => open(row)} aria-label={`Tiếp tục xem ${row.series_title} tập ${row.vid_index}`}>
              <span className="account-history-cover">
                {row.cover && <img src={row.cover} alt="" loading="lazy" onError={event => event.currentTarget.remove()} />}
                <Play size={18} />
              </span>
              <span className="account-history-copy">
                <strong>{row.series_title}</strong>
                <small>Đã xem đến tập {row.vid_index || '?'}{row.total ? ` / Tổng ${row.total} tập` : ''} · {Math.floor(row.currentTime || 0)}:{String(Math.floor((row.currentTime || 0) % 60)).padStart(2, '0')}</small>
                <small>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('vi-VN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Không rõ thời gian'}</small>
              </span>
              <span className="account-history-action"><Play size={14} />Tiếp tục xem</span>
            </button>
          </li>)}</ul>}
      </> : <>
        <div className="account-login-copy">
          <h3>Quét mã đăng nhập</h3>
          <p>Sử dụng ứng dụng Hồng Quả trên điện thoại để quét mã và xác nhận. Thông tin đăng nhập được mã hóa an toàn trên hệ thống.</p>
        </div>
        {qr && <div className="account-qr"><img src={qr.image} alt="Mã QR đăng nhập Hồng Quả" /><span>Ứng dụng Hồng Quả trên điện thoại → Của tôi → Quét mã</span></div>}
        <div className="account-page-actions">
          {qr ? <button className="btn btn-outline" type="button" onClick={cancelLogin}>Hủy quét mã</button>
            : <button className="btn btn-primary" type="button" disabled={busy} onClick={beginLogin}>{busy ? 'Đang lấy mã QR…' : 'Lấy mã QR đăng nhập'}</button>}
        </div>
      </>}
      {status && <p className="account-page-status" role="status">{status}</p>}
      {error && <div className="history-error" role="alert"><span>{error}</span></div>}
    </section>
  </div>;
}
