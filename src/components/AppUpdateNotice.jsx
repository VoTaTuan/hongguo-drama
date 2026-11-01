import React, { useEffect, useRef, useState } from 'react';
import { X } from './icons';
import './AppUpdateNotice.css';

export default function AppUpdateNotice() {
  const [release, setRelease] = useState(null);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState({ supported: false, reason: 'Đang đọc phương thức cập nhật…', status: 'idle', percent: 0 });
  const currentState = useRef(state);
  const enabled = useRef(true);
  const actionPending = useRef(false);
  const actionGeneration = useRef(0);
  const openingRelease = useRef(false);
  const checkPending = useRef(false);
  const requestedManually = useRef(false);
  const dismissed = useRef(new Set());
  const checkNow = useRef(null);
  const closedAt = useRef(0);

  useEffect(() => {
    let generation = 0, stateRevision = 0, active = true;
    checkPending.current = false;
    const receiveState = next => {
      if (!active || !next) return;
      stateRevision++;
      currentState.current = next;
      setState(next);
    };
    const check = async (manual = false) => {
      if (manual) { requestedManually.current = true; setVisible(true); setError(''); dismissed.current.clear(); }
      if (checkPending.current || ['checking', 'downloading', 'downloaded', 'installing'].includes(currentState.current.status)) return;
      checkPending.current = true;
      requestedManually.current = manual;
      const request = ++generation;
      const closure = closedAt.current;
      setChecking(true);
      try {
        const result = await window.electronAPI.checkAppUpdate();
        if (!active || request !== generation) return;
        enabled.current = result?.enabled === true;
        if (!enabled.current) {
          setRelease(null);
          if (requestedManually.current) setError(result?.error || 'Tính năng kiểm tra cập nhật đang tắt, vui lòng bật trong Cài đặt rồi thử lại.');
          else setVisible(false);
          return;
        }
        if (result.error) {
          setRelease(null);
          setError(result.error);
          return;
        }
        setError('');
        setRelease(result.release || null);
        if (result.release) {
          if (closure !== closedAt.current) dismissed.current.add(result.release.version);
          else if (!dismissed.current.has(result.release.version)) setVisible(true);
        }
      } catch {
        if (active && request === generation) { setRelease(null); setError('Kiểm tra cập nhật thất bại, vui lòng kiểm tra kết nối mạng rồi thử lại.'); }
      } finally {
        if (active && request === generation) { checkPending.current = false; setChecking(false); }
      }
    };
    checkNow.current = check;
    const manualCheck = () => check(true);
    window.addEventListener('hongguo-check-app-update', manualCheck);
    const unsubscribeState = window.electronAPI.onAppUpdateState(receiveState);
    const unsubscribePreference = window.electronAPI.onAppUpdatePreference(value => {
      generation++;
      checkPending.current = false;
      setChecking(false);
      enabled.current = value;
      if (value) check();
      else { actionGeneration.current++; actionPending.current = false; setPending(false); setVisible(false); setError(''); }
    });
    const revision = stateRevision;
    window.electronAPI.getAppUpdateState().then(next => {
      if (revision === stateRevision) receiveState(next);
    }).catch(() => {
      if (revision === stateRevision) receiveState({ supported: false, reason: 'Không thể đọc trạng thái cập nhật trong ứng dụng, bạn có thể tải thủ công từ GitHub.', status: 'idle', percent: 0 });
    });
    check();
    const timer = setInterval(() => check(), 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      generation++;
      checkNow.current = null;
      clearInterval(timer);
      window.removeEventListener('hongguo-check-app-update', manualCheck);
      unsubscribeState();
      unsubscribePreference();
    };
  }, []);

  const close = () => {
    closedAt.current++;
    if (release) dismissed.current.add(release.version);
    setVisible(false);
    setError('');
  };
  const act = async kind => {
    if (kind === 'openAppUpdate') {
      if (!enabled.current || openingRelease.current) return;
      openingRelease.current = true;
      try {
        const result = await window.electronAPI.openAppUpdate();
        if (!result?.success && enabled.current) setError(result?.error || 'Không thể mở trang phát hành, vui lòng thử lại sau.');
      } catch { if (enabled.current) setError('Không thể mở trang phát hành, vui lòng thử lại sau.'); }
      finally { openingRelease.current = false; }
      return;
    }
    const cancelling = kind === 'cancelAppUpdate';
    if (!enabled.current) return;
    if (cancelling) {
      if (actionPending.current === 'cancelAppUpdate' || !['checking', 'downloading'].includes(currentState.current.status) && actionPending.current !== 'downloadAppUpdate') return;
    } else if (actionPending.current || checkPending.current || ['checking', 'downloading', 'installing'].includes(currentState.current.status)) return;
    const request = ++actionGeneration.current;
    actionPending.current = kind;
    setPending(true);
    setError('');
    try {
      const result = await window.electronAPI[kind]();
      if (request !== actionGeneration.current) return;
      if (result?.state) { currentState.current = result.state; setState(result.state); }
      if (!result?.success && enabled.current) setError(result?.error || 'Thao tác cập nhật thất bại, vui lòng thử lại sau.');
    } catch {
      if (request === actionGeneration.current && enabled.current) setError('Thao tác cập nhật thất bại, vui lòng kiểm tra kết nối mạng rồi thử lại.');
    } finally { if (request === actionGeneration.current) { actionPending.current = false; setPending(false); } }
  };

  if (!visible) return null;
  const downloading = state.status === 'downloading';
  const downloaded = state.status === 'downloaded' || state.status === 'error' && state.downloaded === true;
  const installing = state.status === 'installing';
  const busy = pending || checking || downloading || installing || state.status === 'checking';
  const version = (downloading || downloaded || installing || state.status === 'error') ? state.version || release?.version : release?.version;
  const updateError = error || state.error;
  const percent = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
  const title = checking ? 'Đang kiểm tra cập nhật…' : installing ? 'Đang khởi động lại để cài đặt…' : downloaded ? `Phiên bản mới v${version} đã tải xong` : downloading ? `Đang tải v${version}` : version ? `Đã có phiên bản mới v${version}` : 'Kiểm tra cập nhật';
  return <section className="app-update-notice" role="dialog" aria-label="Cập nhật phần mềm" aria-describedby="app-update-description" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-btn app-update-close" aria-label="Đóng thông báo cập nhật" title="Đóng thông báo cập nhật" onClick={close}><X size={18} /></button>
    <h2 aria-live="polite">{title}</h2>
    <p id="app-update-description">{checking ? 'Đang kiểm tra phiên bản mới chính thức, vui lòng đợi…' : installing ? 'Ứng dụng sắp thoát và cài đặt phiên bản mới.' : downloaded ? 'Nhấp để thoát ứng dụng và cài đặt phiên bản mới. Vui lòng hoàn thành tải video trước; bạn cũng có thể mở lại thông báo này trong Cài đặt.' : downloading ? 'Đóng thông báo sẽ tiếp tục tải nền. Tải xong sẽ không tự động cài đặt, bạn có thể kiểm tra tiến trình trong Cài đặt.' : version ? (state.supported ? 'Tải phiên bản mới trực tiếp trong ứng dụng, tải xong bạn có thể quyết định thời điểm cài đặt. Đóng thông báo để tiếp tục dùng bản hiện tại.' : state.reason) : updateError ? 'Bạn có thể kiểm tra lại sau.' : 'Đang là phiên bản mới nhất.'}</p>
    {downloading && <div className="app-update-progress"><progress max="100" value={percent} aria-label="Tiến trình tải cập nhật" /><span>{percent}%</span></div>}
    <div className="app-update-actions">
    {(version || downloaded) && <button type="button" className="btn btn-primary" disabled={busy || !enabled.current} onClick={() => act(downloaded ? 'installAppUpdate' : state.supported ? 'downloadAppUpdate' : 'openAppUpdate')}>
      {installing ? 'Đang khởi động lại…' : downloading ? 'Đang tải…' : pending ? 'Vui lòng đợi…' : downloaded ? 'Khởi động lại & Cài đặt' : state.supported ? 'Tải bản cập nhật' : 'Đến GitHub để tải'}
    </button>}
    {(!version || updateError) && !busy && <button type="button" className="btn btn-outline" onClick={() => checkNow.current?.(true)}>Kiểm tra lại</button>}
    {(downloading || state.status === 'checking' || pending && actionPending.current === 'downloadAppUpdate') && <button type="button" className="btn btn-outline" disabled={actionPending.current === 'cancelAppUpdate' || !enabled.current} onClick={() => act('cancelAppUpdate')}>Hủy tải</button>}
    {(state.supported || !version) && <button type="button" className="btn btn-outline" disabled={!enabled.current} onClick={() => act('openAppUpdate')}>Đến trang phát hành để tải thủ công</button>}
    </div>
    {updateError && <p role="alert">{updateError}</p>}
  </section>;
}
