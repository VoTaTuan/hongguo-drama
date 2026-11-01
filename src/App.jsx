import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Film, Download, Settings, Play, Home, Search, Clock, User } from './components/icons';
import HongguoDownload from './components/HongguoDownload';
import DownloadManager from './components/DownloadManager';
import SettingsPage from './components/Settings';
import Player from './components/Player';
import Browse from './components/Browse';
import PageMenu from './components/PageMenu';
import WatchHistory from './components/WatchHistory';
import { initializeTheme } from './theme';
import useStealthWindow from './components/useStealthWindow';
import './components/StealthWindow.css';
import AppUpdateNotice from './components/AppUpdateNotice';
import AnnouncementNotice from './components/AnnouncementNotice';
import DramaFeed from './components/DramaFeed';
import ReleaseCalendar from './components/ReleaseCalendar';
import AccountManagement from './components/AccountManagement';

const MENU = [
  { id: 'browse', label: 'Khám phá phim', icon: Home },
  { id: 'feed', label: 'Thịnh hành đề xuất', icon: Film },
  { id: 'download', label: 'Tìm kiếm & Tải về', icon: Search },
  { id: 'player', label: 'Kho phim của tôi', icon: Play },
  { id: 'history', label: 'Lịch sử xem', icon: Clock },
  { id: 'calendar', label: 'Yêu thích & Cập nhật', icon: Clock },
  { id: 'manager', label: 'Quản lý tải về', icon: Download },
  { id: 'account', label: 'Tài khoản Hồng Quả', icon: User },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export default function App() {
  const { stealthMode, toggleStealth, stealthError } = useStealthWindow();
  useLayoutEffect(() => initializeTheme(), []);
  const [layout, setLayout] = useState('landscape');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [actionsHidden, setActionsHidden] = useState(false);
  const [borderless, setBorderless] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const layoutLock = useRef(false);
  const [page, setPage] = useState('browse');
  const pageRef = useRef('browse');
  const calendarRequest = useRef(0);
  const calendarOpeningRef = useRef(false);
  const [calendarOpening, setCalendarOpening] = useState('');
  const [visited, setVisited] = useState(['browse']);
  const [storageError, setStorageError] = useState('');
  const [appInfo, setAppInfo] = useState(null); // { version, brand, appName }
  const [playerMounted, setPlayerMounted] = useState(false);
  const floatingPlayer = useRef(false);
  const setFloatingPlayer = useCallback(value => { floatingPlayer.current = value; }, []);
  const [playerTarget, setPlayerTarget] = useState(null); // Từ trang khám phá chọn phát -> chuyển sang trình phát
  const rememberPlayerSeries = useCallback((seriesId) => {
    // Giữ timestamp lệnh để tránh lặp khởi tạo; khi mount lại chỉ khôi phục theo điểm dừng mới nhất của series hiện tại.
    setPlayerTarget(target => ({ seriesId, resume: true, autoplay: false, ts: target?.ts }));
  }, []);

  useEffect(() => {
    window.electronAPI.getWindowLayout?.().then(setLayout);
    window.electronAPI.getAlwaysOnTop?.().then(setAlwaysOnTop);
    window.electronAPI.getAppInfo().then((info) => {
      setAppInfo(info);
    });
  }, []);

  useEffect(() => window.electronAPI.onStorageError?.((data) => {
    setStorageError(data === null ? '' : data?.error || 'Lưu dữ liệu thất bại, vui lòng kiểm tra dung lượng ổ đĩa và quyền thư mục rồi thử lại.');
  }), []);

  // Lệnh điều hướng từ tiến trình chính (ví dụ: bấm "Phát ngay" trên trang duyệt)
  useEffect(() => {
    if (!window.electronAPI.onNavigate) return undefined;
    return window.electronAPI.onNavigate((data) => {
      if (!data || !data.page) return;
      if (data.payload) setPlayerTarget({ ...data.payload, ts: Date.now() });
      navigate(data.page);
    });
  }, []);

  const navigate = (nextPage) => {
    if (nextPage !== pageRef.current) {
      calendarRequest.current++;
      calendarOpeningRef.current = false;
      setCalendarOpening('');
      pageRef.current = nextPage;
    }
    if (nextPage === 'player' || (nextPage === 'feed' && !floatingPlayer.current)) setPlayerMounted(nextPage === 'player');
    setVisited((pages) => pages.includes(nextPage) ? pages : [...pages, nextPage]);
    setPage(nextPage);
  };

  const renderPage = (id) => {
    switch (id) {
      case 'browse':
        return <Browse active={page === id} onNavigate={navigate} />;
      case 'player':
        return playerMounted ? <Player portrait={layout === 'portrait'} episodesOpen={episodesOpen} setEpisodesOpen={setEpisodesOpen} actionsHidden={actionsHidden || (borderless && layout === 'portrait')} active={page === id} target={playerTarget} onSeriesSelected={rememberPlayerSeries} onFloatingChange={setFloatingPlayer} onNavigate={navigate} /> : null;
      case 'feed':
        return page === 'feed' ? <DramaFeed onNavigate={navigate} /> : null;
      case 'calendar':
        return <ReleaseCalendar opening={calendarOpening} active={page === id} onPlay={async ({ seriesId }) => {
          if (pageRef.current !== 'calendar' || calendarOpeningRef.current) return;
          const version = ++calendarRequest.current;
          calendarOpeningRef.current = true;
          setCalendarOpening(seriesId);
          try {
            const payload = { seriesId, resume: true };
            let result = await window.electronAPI.playSeries(payload);
            if (version !== calendarRequest.current) return;
            if (!result?.success && result?.code === 'SERIES_NOT_FOUND') {
              const resolved = await window.electronAPI.searchResolve(seriesId);
              if (version !== calendarRequest.current) return;
              if (!resolved?.success) throw new Error(resolved?.error || 'Tải danh sách tập thất bại, vui lòng thử lại');
              result = await window.electronAPI.playSeries(payload);
            }
            if (!result?.success) throw new Error(result?.error || 'Mở phát video thất bại, vui lòng thử lại');
          } catch (error) {
            if (version === calendarRequest.current) setStorageError(error.message);
          } finally {
            if (version === calendarRequest.current) { calendarOpeningRef.current = false; setCalendarOpening(''); }
          }
        }} />;
      case 'history':
        return <WatchHistory active={page === id} onNavigate={navigate} />;
      case 'account':
        return <AccountManagement active={page === id} />;
      case 'manager':
        return <DownloadManager active={page === id} onNavigate={navigate} />;
      case 'settings':
        return <SettingsPage active={page === id} preview={appInfo?.preview} appInfo={appInfo} />;
      case 'download':
      default:
        return <HongguoDownload active={page === id} onNavigate={navigate} />;
    }
  };

  const toggleLayout = async () => {
    if (layoutLock.current) return;
    layoutLock.current = true;
    setLayoutBusy(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      const mode = layout === 'portrait' ? 'landscape' : 'portrait';
      const result = await window.electronAPI.setWindowLayout(mode);
      if (!result.success) throw new Error(result.error);
      setLayout(result.mode);
    } catch (error) {
      setStorageError(error.message || 'Chuyển đổi thất bại, vui lòng thử lại.');
    } finally {
      layoutLock.current = false;
      setLayoutBusy(false);
    }
  };

  const isMac = appInfo?.platform === 'darwin' || (!appInfo?.platform && /Mac/.test(navigator.platform));
  const currentPage = MENU.find((item) => item.id === page);

  return (
    <div className={`app-layout ${stealthMode ? 'stealth-mode' : ''} ${isMac ? 'platform-mac' : ''} layout-${layout} ${page === 'player' ? 'player-focused' : ''} ${borderless && page === 'player' && layout === 'portrait' ? 'player-borderless' : ''}`}>
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="sidebar-window-drag" aria-hidden="true" />
        <div className="sidebar-brand">
          <div className="logo"><Play size={21} /></div>
          <div><div className="brand-text">{appInfo?.appName || 'Phim Ngắn Hồng Quả'}</div><div className="brand-sub">{appInfo?.preview ? 'Trải nghiệm độc lập · Lưu trên máy' : 'Mỗi tập phim, đều đáng mong chờ'}</div></div>
        </div>
        <nav className="sidebar-menu">
          <div className="sidebar-group-label">Nội dung</div>
          {MENU.filter((item) => item.id !== 'settings').map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
                <Icon size={19} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className={`sidebar-item ${page === 'settings' ? 'active' : ''}`}
            aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}>
            <Settings size={19} /><span>Cài đặt</span>
          </button>
          <div className="footer-note"><span>{appInfo?.preview ? 'Bản xem trước tính năng' : 'Phim Ngắn Hồng Quả'}</span><span>{appInfo?.version ? `v${appInfo.version.replace(/^(\d+\.\d+)\.0$/, '$1')}` : ''}</span></div>
        </div>
      </aside>
      <div className="main-wrapper">
        <header className="window-toolbar">
          <span className="toolbar-location">{currentPage?.label}</span>
          {page === 'player' && layout === 'portrait' && <PageMenu items={MENU} page={page} onNavigate={navigate} />}
          <div className="toolbar-actions">
            <span className="toolbar-caption">{appInfo?.preview ? 'Bản xem trước tính năng' : 'Phim Ngắn Hồng Quả'}</span>
            {page === 'player' && <button className="btn btn-outline btn-sm" onClick={() => { setEpisodesOpen(false); toggleStealth(true); }} title="Cửa sổ nổi ghim trên cùng; rê chuột ra ngoài để tạm dừng và ẩn, rê lại để tiếp tục; nhấn Esc để thoát">Cửa sổ thu nhỏ</button>}
            {page === 'player' && layout === 'portrait' && <button className="btn btn-outline btn-sm portrait-episodes-toggle" aria-expanded={episodesOpen}
              aria-controls="player-episode-panel" onClick={() => setEpisodesOpen(open => !open)}>{episodesOpen ? 'Thu gọn tập' : 'Danh sách tập'}</button>}
            {page === 'player' && <button className="btn btn-outline btn-sm player-actions-toggle" aria-pressed={actionsHidden || borderless && layout === 'portrait'}
              onClick={() => {
                if (borderless && layout === 'portrait') { setBorderless(false); setActionsHidden(false); }
                else setActionsHidden(hidden => !hidden);
              }}>{actionsHidden || borderless && layout === 'portrait' ? 'Hiện nút' : 'Ẩn nút'}</button>}
            {page === 'player' && layout === 'portrait' && <button className="btn btn-outline btn-sm borderless-toggle" aria-pressed={borderless}
              onClick={() => setBorderless(value => !value)}>{borderless ? 'Hiện viền' : 'Ẩn viền'}</button>}
            <button className="btn btn-outline btn-sm pin-toggle" aria-pressed={alwaysOnTop} disabled={pinBusy}
              aria-label={alwaysOnTop ? 'Bỏ ghim' : 'Ghim trên cùng'} title={alwaysOnTop ? 'Bỏ ghim' : 'Ghim trên cùng'}
              onClick={async () => {
                setPinBusy(true);
                try { setAlwaysOnTop(await window.electronAPI.setAlwaysOnTop(!alwaysOnTop)); }
                catch { setStorageError('Chuyển trạng thái ghim thất bại, vui lòng thử lại.'); }
                finally { setPinBusy(false); }
              }}><svg width="17" height="17" viewBox="0 0 24 24" fill={alwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg></button>
            <button className="btn btn-outline btn-sm layout-toggle" onClick={toggleLayout}
              disabled={layoutBusy} aria-pressed={layout === 'portrait'}
              aria-label={layout === 'portrait' ? 'Chuyển sang màn hình ngang' : 'Chuyển sang màn hình dọc'}
              title={layout === 'portrait' ? 'Khôi phục cửa sổ và bố cục ngang' : 'Chuyển sang cửa sổ dọc, phóng to video dọc'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                {layout === 'portrait' ? <rect x="3" y="6" width="18" height="12" rx="2" /> : <rect x="6" y="3" width="12" height="18" rx="2" />}
              </svg>
              {layoutBusy ? 'Đang chuyển…' : layout === 'portrait' ? 'Bản ngang' : 'Bản dọc'}
            </button>
          </div>
        </header>
        <nav className="compact-navigation" aria-label="Điều hướng dọc">
          {MENU.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)} title={item.label}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        {!appInfo?.preview && <AppUpdateNotice />}
        {!appInfo?.preview && <AnnouncementNotice />}
        {stealthMode && <div className="stealth-toolbar"><span>Rê ra ngoài để tạm dừng/ẩn · Rê lại để tiếp tục</span><button className="btn btn-outline btn-sm" onClick={() => toggleStealth(false)}>Thoát cửa sổ nhỏ</button></div>}
        {stealthError && <div className="app-storage-error" role="alert">{stealthError}</div>}
        {storageError && <div className="app-storage-error" role="alert"><span>{storageError}</span><button className="btn btn-outline btn-sm" onClick={() => setStorageError('')}>Đóng thông báo</button></div>}
        {visited.map((id) => <main className="main-content" data-page={id} hidden={page !== id} key={id}>{renderPage(id)}</main>)}
      </div>
    </div>
  );
}
