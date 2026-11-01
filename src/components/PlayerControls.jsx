import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Settings as SettingsIcon, PictureInPicture } from './icons';
import './PlayerControls.css';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, formatShortcut, ignoresPlaybackShortcut, shortcutKey } from '../shortcuts';
import { VideoEnhancementControls } from './VideoEnhancement';
import { DanmakuSettings } from './CommentDanmaku';
import { formatClock, formatQualityMeta } from '../playerDisplay.mjs';

const formatTime = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
const Icon = ({ children }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export default function PlayerControls({ danmaku, enhancement, shortcuts = DEFAULT_SHORTCUTS, onToggleFullscreen, videoRef, stageRef, source, available, floating = false, onToggleFloating, continuing = false, autoContinue = false, rate, onRateChange, onError, pictureMode = 'fit', onPictureModeChange, portrait = false, windowFill = false, onWindowFill, seriesTitle = '', episodes = [], currentIndex, onEpisodeChange, onlineQuality = 'auto', supportsOnlineQuality = false, onQualityChange, onOpenSettings }) {
  const [media, setMedia] = useState({ paused: true, ended: false, time: 0, duration: 0, muted: false, volume: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() => formatClock());
  const [menuOpen, setMenuOpen] = useState(false);
  const [danmakuOpen, setDanmakuOpen] = useState(false);
  const [selectionPanel, setSelectionPanel] = useState(null);
  const selectionRef = useRef(null);
  const episodeButtonRef = useRef(null);
  const qualityButtonRef = useRef(null);
  const [selectionHeight, setSelectionHeight] = useState(360);
  const danmakuPanelRef = useRef(null);
  const danmakuButtonRef = useRef(null);
  const [danmakuHeight, setDanmakuHeight] = useState(300);
  const [menuHeight, setMenuHeight] = useState(240);
  const [controlsHidden, setControlsHidden] = useState(false);
  const controlsRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const speedRef = useRef(null);
  const navigationKeysRef = useRef(new Set());
  const pointerRef = useRef(null);
  const idleDeadlineRef = useRef(0);
  const expanded = fullscreen || windowFill;

  useEffect(() => {
    if (!menuOpen) return;
    const stageWindow = stageRef.current?.ownerDocument?.defaultView || window;
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect?.();
      const button = menuButtonRef.current?.getBoundingClientRect?.();
      if (stage && button) setMenuHeight(Math.max(96, button.top - Math.max(8, stage.top) - 16));
    };
    measure();
    const Observer = stageWindow.ResizeObserver;
    const observer = typeof Observer === 'function' ? new Observer(measure) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    stageWindow.addEventListener('resize', measure);
    return () => { observer?.disconnect(); stageWindow.removeEventListener('resize', measure); };
  }, [menuOpen, fullscreen, windowFill, floating, stageRef]);

  useEffect(() => {
    if (!windowFill) return;
    const stageWindow = stageRef.current?.ownerDocument?.defaultView || window;
    const escape = event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest?.('.danmaku-settings')) onWindowFill(false); };
    stageWindow.addEventListener('keydown', escape);
    return () => stageWindow.removeEventListener('keydown', escape);
  }, [windowFill, onWindowFill, floating, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    const stageDocument = stage?.ownerDocument || document;
    const stageWindow = stageDocument.defaultView || window;
    let timer;
    let pauseTimer;
    let dragging = false;
    const hide = () => {
      if (available && !media.paused && !menuOpen && !danmakuOpen && !selectionPanel && !dragging && !controlsRef.current?.querySelector(':focus-visible')) {
        // Clear pointer focus so the next playback key cannot highlight a hidden button.
        if (controlsRef.current?.contains(stageDocument.activeElement)) stageDocument.activeElement.blur();
        setControlsHidden(true);
      }
    };
    const scheduleHide = () => {
      clearTimeout(timer);
      if (available && !media.paused && !menuOpen && !danmakuOpen && !selectionPanel && !dragging) {
        // Fullscreen and source changes keep the deadline set by actual user activity.
        if (!idleDeadlineRef.current) idleDeadlineRef.current = Date.now() + 1000;
        timer = setTimeout(hide, Math.max(0, idleDeadlineRef.current - Date.now()));
      }
    };
    const reveal = () => { clearTimeout(pauseTimer); idleDeadlineRef.current = Date.now() + 1000; setControlsHidden(false); scheduleHide(); };
    const onPointerLeave = () => { pointerRef.current = null; clearTimeout(timer); hide(); };
    const onKey = event => {
      const physicalKey = event.code || event.key;
      // Keep the release paired across source/effect changes, even if Shift is released first.
      if (event.type === 'keyup' && navigationKeysRef.current.delete(physicalKey)) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      if (event.key === 'Tab') { reveal(); return; }
      if (menuOpen || danmakuOpen || selectionPanel || ignoresPlaybackShortcut(event.target, event.key)) return;
      const key = shortcutKey(event);
      const action = key && SHORTCUT_ACTIONS.find(item => shortcuts[item.id] === key);
      if (!action) return;
      if (action.id === 'play') { reveal(); return; }
      if (event.type === 'keydown') {
        navigationKeysRef.current.add(physicalKey);
        // Keyboard-only playback actions must not extend pointer inactivity.
      }
    };
    const onPointerMove = event => {
      const previous = pointerRef.current;
      pointerRef.current = { x: event.screenX, y: event.screenY };
      // Native fullscreen/source changes can dispatch a move without moving the pointer.
      if (previous ? previous.x === event.screenX && previous.y === event.screenY : !event.movementX && !event.movementY) return;
      reveal();
    };
    const startDrag = event => { dragging = !!event.target.closest?.('input[type="range"]'); reveal(); };
    const stopDrag = () => { if (dragging) { dragging = false; reveal(); } };
    const onFocus = event => {
      // Tab and pointerdown reveal immediately; media focus churn is not user activity.
      if (controlsRef.current?.contains(event.target)) reveal();
      else scheduleHide();
    };
    stage?.addEventListener('pointermove', onPointerMove);
    stage?.addEventListener('pointerleave', onPointerLeave);
    stage?.addEventListener('pointerdown', startDrag);
    stage?.addEventListener('focusin', onFocus);
    stage?.addEventListener('focusout', scheduleHide);
    stageWindow.addEventListener('keydown', onKey, true);
    stageWindow.addEventListener('keyup', onKey, true);
    stageWindow.addEventListener('pointerup', stopDrag);
    stageWindow.addEventListener('pointercancel', stopDrag);
    const onBlur = () => { navigationKeysRef.current.clear(); stopDrag(); onPointerLeave(); };
    stageWindow.addEventListener('blur', onBlur);
    // Source changes and automatic handoffs are not user activity.
    if (menuOpen || danmakuOpen || selectionPanel || (!continuing && !available)) reveal();
    else if (!continuing && media.paused && !(media.ended && autoContinue)) {
      // A native pause can precede ended; explicit key/click pauses already reveal immediately.
      if (autoContinue && controlsHidden) pauseTimer = setTimeout(() => {
        if (videoRef.current?.paused && !videoRef.current.ended) reveal();
      }, 120);
      else reveal();
    } else scheduleHide();
    return () => {
      clearTimeout(timer);
      clearTimeout(pauseTimer);
      stage?.removeEventListener('pointermove', onPointerMove);
      stage?.removeEventListener('pointerleave', onPointerLeave);
      stage?.removeEventListener('pointerdown', startDrag);
      stage?.removeEventListener('focusin', onFocus);
      stage?.removeEventListener('focusout', scheduleHide);
      stageWindow.removeEventListener('keydown', onKey, true);
      stageWindow.removeEventListener('keyup', onKey, true);
      stageWindow.removeEventListener('pointerup', stopDrag);
      stageWindow.removeEventListener('pointercancel', stopDrag);
      stageWindow.removeEventListener('blur', onBlur);
    };
  }, [portrait, expanded, available, media.paused, media.ended, continuing, autoContinue, menuOpen, danmakuOpen, selectionPanel, source, floating, stageRef, shortcuts]);

  useEffect(() => {
    setMenuOpen(false);
    setDanmakuOpen(false);
    setSelectionPanel(null);
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setMedia({ paused: video.paused, ended: video.ended, time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0, muted: video.muted, volume: video.volume,
      width: available ? video.videoWidth : 0, height: available ? video.videoHeight : 0 });
    const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'emptied', 'resize'];
    events.forEach(name => video.addEventListener(name, sync));
    sync();
    return () => events.forEach(name => video.removeEventListener(name, sync));
  }, [videoRef, source, available]);

  useEffect(() => {
    const stageDocument = stageRef.current?.ownerDocument || document;
    const sync = () => setFullscreen(stageDocument.fullscreenElement === stageRef.current);
    stageDocument.addEventListener('fullscreenchange', sync);
    sync();
    return () => stageDocument.removeEventListener('fullscreenchange', sync);
  }, [floating, stageRef]);

  useEffect(() => {
    if (!expanded) return;
    setClock(formatClock());
    // Chỉ đến phút, làm mới 15 giây một lần là đủ, không render lại theo tiến độ phát.
    const timer = setInterval(() => setClock(formatClock()), 15000);
    return () => clearInterval(timer);
  }, [expanded]);

  useEffect(() => {
    if (!menuOpen) return;
    const stageDocument = stageRef.current?.ownerDocument || document;
    speedRef.current?.focus();
    const outside = event => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setMenuOpen(false); menuButtonRef.current?.focus();
    };
    stageDocument.addEventListener('pointerdown', outside);
    stageDocument.addEventListener('keydown', escape);
    return () => { stageDocument.removeEventListener('pointerdown', outside); stageDocument.removeEventListener('keydown', escape); };
  }, [menuOpen, floating, stageRef]);

  useEffect(() => {
    if (!danmakuOpen) return;
    const stageDocument = stageRef.current?.ownerDocument || document;
    const stageWindow = stageDocument.defaultView || window;
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect();
      const controls = controlsRef.current?.getBoundingClientRect();
      if (stage && controls) setDanmakuHeight(Math.max(60, controls.top - stage.top - 12));
    };
    const outside = event => {
      if (!danmakuPanelRef.current?.contains(event.target) && !danmakuButtonRef.current?.contains(event.target)) setDanmakuOpen(false);
    };
    measure();
    const observer = new stageWindow.ResizeObserver(measure);
    if (stageRef.current) observer.observe(stageRef.current);
    if (controlsRef.current) observer.observe(controlsRef.current);
    stageDocument.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); stageDocument.removeEventListener('pointerdown', outside); };
  }, [danmakuOpen, floating, stageRef]);

  useEffect(() => {
    if (!selectionPanel) return;
    const stageDocument = stageRef.current?.ownerDocument || document;
    const stageWindow = stageDocument.defaultView || window;
    const selected = selectionRef.current?.querySelector('[aria-current="true"], [aria-pressed="true"]');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: 'nearest' });
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect?.();
      const controls = controlsRef.current?.getBoundingClientRect?.();
      if (stage && controls) setSelectionHeight(Math.max(60, Math.min(440, controls.top - stage.top - 16)));
    };
    const outside = event => { if (!selectionRef.current?.contains(event.target)) setSelectionPanel(null); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setSelectionPanel(null);
      (selectionPanel === 'episodes' ? episodeButtonRef : qualityButtonRef).current?.focus();
    };
    measure();
    const Observer = stageWindow.ResizeObserver;
    const observer = typeof Observer === 'function' ? new Observer(measure) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    if (controlsRef.current) observer?.observe(controlsRef.current);
    stageDocument.addEventListener('pointerdown', outside);
    stageDocument.addEventListener('keydown', escape);
    stageWindow.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      stageDocument.removeEventListener('pointerdown', outside);
      stageDocument.removeEventListener('keydown', escape);
      stageWindow.removeEventListener('resize', measure);
    };
  }, [selectionPanel, expanded, floating, stageRef]);

  const toggleSelection = panel => {
    setMenuOpen(false); setDanmakuOpen(false);
    setSelectionPanel(open => open === panel ? null : panel);
  };

  const closeDanmaku = () => { setDanmakuOpen(false); danmakuButtonRef.current?.focus(); };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!available || !video) return;
    try { if (video.paused) await video.play(); else video.pause(); }
    catch { onError?.('Tạm thời không thể phát, vui lòng thử lại tập này'); }
  };
  const toggleFloating = async () => {
    const video = videoRef.current;
    if (!available || !video) return;
    try { await onToggleFloating?.(); }
    catch (error) { onError?.(error?.message || 'Không thể chuyển đổi cửa sổ nổi, vui lòng thử lại'); }
  };
  const seek = event => {
    const video = videoRef.current;
    if (!available || !video || !media.duration) return;
    try { video.currentTime = Math.max(0, Math.min(media.duration, Number(event.target.value))); }
    catch { onError?.('Tạm thời không thể tua, vui lòng thử lại sau'); }
  };
  const changeVolume = event => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Number(event.target.value);
    video.muted = video.volume === 0;
  };

  return (
    <div className={`player-controls ${controlsHidden ? 'controls-hidden' : ''}`} role="group" aria-label="Điều khiển phát video">
      {expanded && <div className="player-now-playing" aria-label="Thông tin đang phát">
        <div className="player-now-title"><strong title={seriesTitle}>{seriesTitle || 'Đang phát'}</strong><span>Tập {currentIndex}</span></div>
        <div className="player-now-meta">{formatQualityMeta(media.width, media.height)}</div>
        <time className="player-clock" dateTime={clock} aria-label={`Thời gian hiện tại ${clock}`}>{clock}</time>
      </div>}
      <div ref={controlsRef} className="player-controls-bar">
      <input className="player-controls-seek" type="range" aria-label="Tiến độ phát" aria-valuetext={`${formatTime(media.time)} / ${formatTime(media.duration)}`} min="0" max={media.duration || 0} step="0.1" value={Math.min(media.time, media.duration)} disabled={!available || !media.duration} onChange={seek} />
      <div className="player-controls-row">
        <button type="button" data-player-control aria-label={media.paused ? 'Phát' : 'Tạm dừng'} title={`Phát/Tạm dừng (${formatShortcut(shortcuts.play)})`} disabled={!available} onClick={togglePlay}>{media.paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <span className="player-controls-time">{formatTime(media.time)} / {formatTime(media.duration)}</span>
        {danmaku && <div className="player-controls-danmaku">
          <button type="button" data-player-menu className={`danmaku-icon-button ${danmaku.enabled ? 'danmaku-enabled' : ''}`} aria-label={`${danmaku.enabled ? 'Tắt' : 'Bật'}${danmaku.sourceKind === 'official' ? 'Danmaku theo dòng thời gian' : 'Bình luận tập này'}`} aria-pressed={danmaku.enabled}
            title={danmaku.supported ? (danmaku.sourceKind === 'official' ? 'Hiển thị danmaku theo mốc thời gian video' : 'Hiển thị bình luận tập này theo thứ tự, không tương ứng với mốc thời gian video') : 'Chỉ tập hiện tại nguồn Hồng Quả mới hỗ trợ danmaku'} disabled={!danmaku.supported} onClick={danmaku.toggle}><span className="danmaku-symbol" aria-hidden="true">Dan<span className="danmaku-state-mark" /></span></button>
          <button type="button" data-player-menu className="danmaku-icon-button" ref={danmakuButtonRef} aria-label="Cài đặt Danmaku" title="Nguồn Danmaku và cài đặt hiển thị" aria-haspopup="dialog" aria-expanded={danmakuOpen}
            onClick={() => { setMenuOpen(false); setSelectionPanel(null); setDanmakuOpen(open => !open); }}>
            <span className="danmaku-symbol" aria-hidden="true">Dan<span className="danmaku-settings-mark"><SettingsIcon size={10} /></span></span>
          </button>
          {danmakuOpen && <DanmakuSettings danmaku={danmaku} onClose={closeDanmaku} panelRef={danmakuPanelRef} maxHeight={danmakuHeight} />}
        </div>}
        <div className="player-controls-selection" data-player-menu ref={selectionRef}>
          {!!episodes.length && <button type="button" ref={episodeButtonRef} aria-label="Chọn tập" aria-haspopup="dialog" aria-expanded={selectionPanel === 'episodes'}
            onClick={() => toggleSelection('episodes')}>Chọn tập</button>}
          {onQualityChange && <button type="button" ref={qualityButtonRef} aria-label="Độ phân giải" aria-haspopup="dialog" aria-expanded={selectionPanel === 'quality'}
            onClick={() => toggleSelection('quality')}>{onlineQuality === 'compat' ? 'Máy cũ' : onlineQuality === 'auto' ? (media.width > 0 && media.height > 0 ? `${Math.min(media.width, media.height)}P` : 'Tự động') : onlineQuality.toUpperCase()}</button>}
          {selectionPanel === 'episodes' && <div className="player-controls-popover player-episode-popover" role="dialog" aria-label="Bảng chọn tập" style={{ maxHeight: selectionHeight }}>
            <div className="player-popover-heading"><strong>Chọn tập</strong><span>Tập {currentIndex} / Tổng {episodes.length} tập</span></div>
            <div className="player-episode-grid">
              {episodes.map(episode => <button type="button" key={episode.vid_index} aria-label={`Phát tập ${episode.vid_index}`} aria-current={episode.vid_index === currentIndex ? 'true' : undefined}
                disabled={episode.locked} title={episode.locked ? 'Nguồn chưa mở tập này' : `Phát tập ${episode.vid_index}`}
                onClick={() => { setSelectionPanel(null); episodeButtonRef.current?.focus(); onEpisodeChange(episode.vid_index); }}>
                {episode.vid_index}{episode.locked && <small>Chưa mở</small>}
              </button>)}
            </div>
          </div>}
          {selectionPanel === 'quality' && <div className="player-controls-popover player-quality-popover" role="dialog" aria-label="Bảng chọn độ phân giải" style={{ maxHeight: selectionHeight }}>
            <div className="player-popover-heading"><strong>Độ phân giải</strong></div>
            <p className="player-quality-current">Hình ảnh hiện tại: {media.width > 0 && media.height > 0 ? `${Math.min(media.width, media.height)}P (${media.width} × ${media.height})` : 'Đang chờ thông tin video'}</p>
            <div role="group" aria-label="Chọn độ phân giải phát">
              {(supportsOnlineQuality ? ['auto', 'compat', '720p', '1080p'] : ['auto']).map(quality => <button type="button" key={quality} aria-label={`Chọn ${quality === 'compat' ? 'Máy cũ' : quality === 'auto' ? 'Tự động' : quality.toUpperCase()}`}
                aria-pressed={onlineQuality === quality} onClick={() => { setSelectionPanel(null); qualityButtonRef.current?.focus(); if (quality !== onlineQuality) onQualityChange(quality); }}>
                <span>{quality === 'compat' ? 'Máy cũ (Ưu tiên H.264)' : quality === 'auto' ? (supportsOnlineQuality ? 'Tự động (Ưu tiên 1080P)' : 'Do nguồn quyết định') : quality.toUpperCase()}</span><span aria-hidden="true">{onlineQuality === quality ? '✓' : ''}</span>
              </button>)}
            </div>
            <p className="player-quality-hint">{supportsOnlineQuality ? 'Tự động ưu tiên 1080P, nếu thất bại sẽ thử 720P và nguồn tương thích. Máy cũ ưu tiên H.264, chất lượng hình ảnh có thể giảm; khi bật chế độ tương thích, nguồn H.265 đã biết sẽ được chuyển mã trước, CPU chậm vẫn cần chờ. Chọn thủ công 720P / 1080P giữ cố định chất lượng; chuyển đổi giữ nguyên tiến độ và trạng thái tạm dừng.' : 'Độ phân giải nguồn này do tệp gốc quyết định, tạm thời không hỗ trợ chỉ định chất lượng. Độ phân giải hiện tại không đại diện cho chất lượng cao nhất của nguồn.'}</p>
          </div>}
        </div>
        <div className="player-controls-volume">
          <button type="button" data-player-control aria-label={media.muted ? 'Bật âm thanh' : 'Tắt tiếng'} onClick={() => { const video = videoRef.current; if (video) video.muted = !video.muted; }}>
            <Icon><path d="M11 5 6 9H3v6h3l5 4Z" />{media.muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}</Icon>
          </button>
          <input type="range" aria-label="Âm lượng" aria-valuetext={`${Math.round((media.muted ? 0 : media.volume) * 100)}%`} min="0" max="1" step="0.05" value={media.muted ? 0 : media.volume} onChange={changeVolume} />
        </div>
        <button type="button" data-player-control aria-label={expanded ? 'Thoát toàn màn hình' : 'Toàn màn hình'} title={`${expanded ? 'Thoát toàn màn hình' : portrait ? 'Lấp đầy cửa sổ hiện tại' : 'Toàn màn hình'} (${formatShortcut(shortcuts.fullscreen)})`} onClick={onToggleFullscreen}>
          <Icon><path d={expanded ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'} /></Icon>
        </button>
        <button type="button" data-player-control aria-label={floating ? 'Thoát hình trong hình' : 'Hình trong hình'} aria-pressed={floating}
          title={floating ? 'Quay lại cửa sổ chính' : 'Hình trong hình: Chọn cửa sổ nhỏ của hệ thống hoặc ứng dụng trong cài đặt'}
          disabled={!available} onClick={toggleFloating}>
          <PictureInPicture size={18} />
        </button>
        <button type="button" data-player-control className="player-controls-rate" aria-label="Tăng tốc độ phát" title={`Tốc độ phát ${rate}×, nhấn để tăng thêm 0.25x, sau 4x quay lại 1x`} onClick={() => onRateChange(rate >= 4 ? 1 : Math.min(4, rate + 0.25))}>{rate}×</button>
        <div className="player-controls-options" data-player-menu ref={menuRef}>
          <button type="button" ref={menuButtonRef} aria-label="Tùy chọn phát khác" title="Tùy chọn phát khác" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => { setDanmakuOpen(false); setSelectionPanel(null); setMenuOpen(open => !open); }}>
            <Icon><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Icon>
          </button>
          {menuOpen && <div className="player-controls-menu" style={{ maxHeight: menuHeight }} role="dialog" aria-label="Tùy chọn phát">
            <label>Tốc độ phát<select ref={speedRef} aria-label="Tốc độ phát" value={rate} onChange={event => onRateChange(Number(event.target.value))}>
              {Array.from({ length: 16 }, (_, index) => (index + 1) / 4).map(value => <option key={value} value={value}>{value}×</option>)}
            </select></label>
            <label className="player-picture-mode">Chế độ khung hình<select aria-label="Chế độ khung hình" aria-describedby="picture-mode-hint" value={pictureMode} onChange={event => onPictureModeChange(event.target.value)}>
              <option value="fit">Vừa cửa sổ</option>
              <option value="width">Giữ chiều rộng</option>
            </select></label>
            <span id="picture-mode-hint">{pictureMode === 'width' ? 'Hiển thị theo chiều rộng, trên dưới có thể bị cắt. Ghi nhớ riêng theo từng phim.' : 'Hiển thị đầy đủ, co giãn theo cửa sổ. Ghi nhớ riêng theo từng phim.'}</span>
            {enhancement && <VideoEnhancementControls enhancement={enhancement} available={available} />}
            {onOpenSettings && <button type="button" aria-label="Cài đặt phát" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>Cài đặt phát</button>}
            {SHORTCUT_ACTIONS.map(action => <span key={action.id}>{formatShortcut(shortcuts[action.id])}: {action.label}</span>)}
          </div>}
        </div>
      </div>
      </div>
    </div>
  );
}
