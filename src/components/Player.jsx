import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useFloatingPlayer from './useFloatingPlayer';
import useDialogKeyboard from './useDialogKeyboard';
import PlayerControls from './PlayerControls';
import CommentDanmaku, { useCommentDanmaku } from './CommentDanmaku';
import OfficialDanmaku, { useOfficialDanmaku } from './OfficialDanmaku';
import { useDanmakuSource, writeDanmakuSource } from './danmakuSource.mjs';
import { SHORTCUT_ACTIONS, formatShortcut, ignoresPlaybackShortcut, readShortcuts, shortcutKey, subscribeShortcuts } from '../shortcuts';
import CommunityPanel from './CommunityPanel';
import SequelFinder from './SequelFinder';
import NasDownload from './NasDownload';
import VideoEnhancement, { useVideoEnhancement } from './VideoEnhancement';
import './Player.css';
import { Play, Film, Download, Check, RefreshCw, Layers, X, Trash2, ChevronDown, Zap } from './icons';

const localMediaKey = (seriesId, episode) => JSON.stringify([seriesId, episode?.vid, episode?.fileUrl, episode?.fileSize, episode?.taskId]);
// Tạm lùi lại sau khi nạp trước thất bại, tránh timeupdate 4Hz va chạm lặp đi lặp lại cùng một node lỗi.
const PREFETCH_RETRY_MS = 15 * 1000;
// Trong thời gian phát nạp trước tối đa 2 tập tiếp theo; khi nhảy xa hơn sẽ bổ sung theo vị trí mới.
const PREFETCH_AHEAD = 2;
const AUTO_ONLINE_QUALITIES = ['1080p', '720p', 'auto'];

const prefetchKey = (seriesId, vid, quality) => JSON.stringify([String(seriesId || ''), String(vid || ''), quality || 'auto']);

/**
 * Player —— Trình phát tích hợp sẵn
 *
 * Điểm thiết kế chính:
 *  - Phát trực tiếp tệp file:// cục bộ (thực tế hỗ trợ tua), không cần máy chủ phát trực tuyến
 *  - "Vừa tải vừa xem": Tập tiếp theo nếu đang tải, hiển thị trạng thái chờ và thăm dò, tải xong tự động nối tiếp
 *  - Tiếp tục từ điểm dừng: Ghi nhớ tập và giây đã xem theo series_id
 */
function Player({ target, onNavigate, onSeriesSelected, onFloatingChange, active = true, portrait = false, actionsHidden = false, episodesOpen = false, setEpisodesOpen }) {
  const enhancement = useVideoEnhancement();
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [showDanmakuControls, setShowDanmakuControls] = useState(false);
  useEffect(() => subscribeShortcuts(setShortcuts), []);
  const [playbackSettingSaving, setPlaybackSettingSaving] = useState(false);
  const playbackSettingPending = useRef(false);
  const [windowFill, setWindowFill] = useState(false);
  useEffect(() => { if (!portrait || !active) setWindowFill(false); }, [portrait, active]);
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesId, setActiveSeriesId] = useState('');
  const [pictureChoice, setPictureChoice] = useState(null);
  const savedPictureMode = useMemo(() => {
    try { return window.localStorage.getItem(`hongguo:picture-mode:${activeSeriesId}`) === 'width' ? 'width' : 'fit'; }
    catch { return 'fit'; }
  }, [activeSeriesId]);
  const pictureMode = pictureChoice?.seriesId === activeSeriesId ? pictureChoice.mode : savedPictureMode;
  const changePictureMode = mode => {
    if (!activeSeriesId || !['fit', 'width'].includes(mode)) return;
    setPictureChoice({ seriesId: activeSeriesId, mode });
    try { window.localStorage.setItem(`hongguo:picture-mode:${activeSeriesId}`, mode); }
    catch { showToast('Đã đổi chế độ hình ảnh nhưng chưa lưu được; lần mở sau có thể về mặc định'); }
  };
  const [detail, setDetail] = useState(null); // { series_title, episodes: [...], total, completedCount }
  const [detailError, setDetailError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(1);
  const [nativePictureInPicture, setNativePictureInPicture] = useState(false);
  const floatingPlayer = useFloatingPlayer(`${detail?.series_title || 'Phim Ngắn Hồng Quả'} · Tập ${currentIndex}`, onFloatingChange, snapshot => {
    pendingSeekRef.current = snapshot.currentTime;
    pendingAutoplayRef.current = !snapshot.paused;
  });
  const playbackActive = active || floatingPlayer.floating || nativePictureInPicture;
  const [autoNext, setAutoNext] = useState(true);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const [cacheNext, setCacheNext] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [downloadQuality, setDownloadQuality] = useState('auto');
  const [onlineQualityChoice, setOnlineQualityChoice] = useState(() => {
    try { const value = window.localStorage.getItem('hongguo:online-quality'); return ['720p', '1080p', 'compat'].includes(value) ? value : 'auto'; }
    catch { return 'auto'; }
  });
  const supportsOnlineQuality = !/^(xifan|hema|custom):/.test(activeSeriesId);
  const onlineQuality = supportsOnlineQuality ? onlineQualityChoice : 'auto';
  const [qualityLoading, setQualityLoading] = useState(true);
  const [waitingFor, setWaitingFor] = useState(null); // Số tập đang chờ tải về
  const [toast, setToast] = useState(null);
  const [rateNotice, setRateNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // Bảng chọn phim
  const [pickerQuery, setPickerQuery] = useState('');

  // Phát trực tuyến (truyền phát theo nhu cầu hoặc lưu đệm sau khi chuẩn bị tạm thời)
  const [onlineVid, setOnlineVid] = useState(null);
  const [onlineUrl, setOnlineUrl] = useState('');
  const [mediaBuffering, setMediaBuffering] = useState(false);
  const [onlineProgress, setOnlineProgress] = useState(null); // {percent, phase}
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const [downloadedRevision, setDownloadedRevision] = useState(0);
  const [downloadedMap, setDownloadedMap] = useState({}); // series_id -> {completed,total}
  const [storageMap, setStorageMap] = useState({});       // series_id -> {files,bytes}
  const [storageTotal, setStorageTotal] = useState({ files: 0, bytes: 0 });
  const [autoDelete, setAutoDelete] = useState(false);    // Tự động xóa tệp cục bộ sau khi xem xong
  const [confirmAsk, setConfirmAsk] = useState(null);     // {title, message, danger, onOk}

  // Chế độ tương thích: Chuyển mã sang H.264 khi máy cục bộ không giải mã được HEVC
  const [autoCompat, setAutoCompat] = useState(true);
  const [compatMap, setCompatMap] = useState({});         // vidIndex -> url sau khi chuyển mã
  const [compatProgress, setCompatProgress] = useState(null); // {vidIndex, percent}
  const [compatError, setCompatError] = useState('');
  const [decodeFailed, setDecodeFailed] = useState(false);    // Không giải mã được hình ảnh tập hiện tại
  const [playbackError, setPlaybackError] = useState('');
  const [playbackVersion, setPlaybackVersion] = useState(0);
  const [playbackRequested, setPlaybackRequested] = useState(false);
  const [compatCache, setCompatCache] = useState({ files: 0, bytes: 0 });
  const [mergeAsk, setMergeAsk] = useState(false);            // Chọn định dạng ghép nối
  const [mergeError, setMergeError] = useState('');

  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const downloadToolsRef = useRef(null);
  const fullscreenScrollRef = useRef(null);
  const playbackRateRef = useRef(1);
  const toastTimer = useRef(null);
  const rateNoticeTimer = useRef(null);
  const mergeRequestRef = useRef(false);
  const mergeDialogGenerationRef = useRef(0);
  const pendingSeekRef = useRef(0); // Số giây cần tua sau khi chuyển tập
  const pendingAutoplayRef = useRef(false);
  const bossHiddenRef = useRef(false);
  useEffect(() => window.electronAPI.onBossKeyState?.(state => {
    bossHiddenRef.current = state.hidden === true;
    pendingAutoplayRef.current = false;
    const video = videoRef.current;
    video?.pause();
    const owner = video?.ownerDocument || document;
    if (owner.pictureInPictureElement) owner.exitPictureInPicture?.().catch(() => {});
  }), []);
  const activeRef = useRef(playbackActive);
  activeRef.current = playbackActive;
  const navigationVersion = useRef(0);
  const storageDirtyRef = useRef(true);
  const lastActiveRef = useRef(active);
  const lastSavedRef = useRef(0);
  const stateRef = useRef({ currentIndex, autoNext, activeSeriesId });
  stateRef.current = { currentIndex, autoNext, activeSeriesId, waitingFor, downloadQuality, onlineQuality, qualityLoading, detail };
  const selectedSeriesRef = useRef('');
  const selectionVersion = useRef(0);
  const onlineRequestRef = useRef(null);
  const prefetchRef = useRef([]);
  const prefetchFailureRef = useRef(new Map());
  const mediaVersion = useRef(0);
  const compatRequestRef = useRef(null);
  const decodeTimer = useRef(null);
  const pendingTargetRef = useRef(null);
  const loadedMediaRef = useRef(null);
  const autoCompatAttemptRef = useRef(null);
  const reconnectAttemptRef = useRef(null);
  const onlineSourceRef = useRef(null);
  const lastVideoSrcRef = useRef('');
  const lastLoadRef = useRef(null);
  const fallbackRef = useRef(null);
  const fallbackAttemptRef = useRef(null);
  const rejectedLocalRef = useRef(null);

  // Chỉ lưu sau khi nhận được metadata của nguồn phim hiện tại, tránh pause của phần tử cũ ghi đè điểm dừng tập mới.
  const persistPosition = useCallback((force = false, ended = false) => {
    const media = loadedMediaRef.current;
    if (!media?.played || media.version !== mediaVersion.current) return;
    const seconds = media.element.currentTime;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    if (!force && Math.abs(seconds - lastSavedRef.current) < 3) return;
    lastSavedRef.current = seconds;
    window.electronAPI.savePlaybackPosition(media.seriesId, media.vidIndex, seconds,
      { duration: media.element.duration, ended: ended || media.element.ended === true }).catch(() => {});
  }, []);

  useEffect(() => window.electronAPI.onWatchHistoryUpdated?.(payload => {
    const media = loadedMediaRef.current;
    // A retained hidden player must not recreate a record removed on the history page.
    if (media && String(media.seriesId) === payload?.removedSeriesId) media.played = false;
  }), []);

  const currentPosition = useCallback(() => {
    const media = loadedMediaRef.current;
    return media?.version === mediaVersion.current && Number.isFinite(media.element.currentTime)
      ? media.element.currentTime : pendingSeekRef.current;
  }, []);

  const releaseOnline = useCallback(() => {
    const request = onlineRequestRef.current;
    onlineRequestRef.current = null;
    if (request) return window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: request.streamId }).catch(() => {});
  }, []);

  const releasePrefetchRequest = useCallback((request) => {
    if (request == null) return;
    window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: request.streamId }).catch(() => {});
  }, []);

  const releasePrefetch = useCallback(() => {
    const requests = prefetchRef.current;
    prefetchRef.current = [];
    prefetchFailureRef.current.clear();
    for (const request of requests) releasePrefetchRequest(request);
  }, [releasePrefetchRequest]);

  const prunePrefetchAfter = useCallback((seriesId, vidIndex, quality, consumed = null) => {
    const kept = [];
    for (const request of prefetchRef.current) {
      if (request === consumed) continue;
      if (request.seriesId !== seriesId || request.quality !== quality
        || Number(request.vidIndex) <= Number(vidIndex)) {
        releasePrefetchRequest(request);
      } else {
        kept.push(request);
      }
    }
    prefetchRef.current = kept;
  }, [releasePrefetchRequest]);

  const cancelCompat = useCallback(() => {
    const request = compatRequestRef.current;
    compatRequestRef.current = null;
    if (request && window.electronAPI.cancelTranscodeForPlayback) {
      window.electronAPI.cancelTranscodeForPlayback({ ...request }).catch(() => {});
    }
  }, []);

  const resetPlayback = useCallback((autoplay = true, preservePrefetch = false) => {
    fallbackRef.current = null;
    setPlaybackRequested(true);
    pendingAutoplayRef.current = autoplay && activeRef.current && !bossHiddenRef.current;
    setAutoAdvancing(false);
    persistPosition(true);
    const previous = loadedMediaRef.current;
    loadedMediaRef.current = null;
    previous?.element.pause();
    mediaVersion.current++;
    setPlaybackVersion(mediaVersion.current);
    autoCompatAttemptRef.current = null;
    clearTimeout(decodeTimer.current);
    cancelCompat();
    releaseOnline();
    if (preservePrefetch === false) releasePrefetch();
    setOnlineVid(null);
    setOnlineUrl('');
    setOnlineProgress(null);
    setMediaBuffering(false);
    setCompatProgress(null);
    setDecodeFailed(false);
    setCompatError('');
    setPlaybackError('');
    lastSavedRef.current = 0;
  }, [persistPosition, releaseOnline, cancelCompat, releasePrefetch]);

  const stopPlayback = (message = 'Phát video đã dừng, có thể thử lại tập này để tiếp tục xem') => {
    const seekTo = currentPosition();
    resetPlayback();
    pendingSeekRef.current = seekTo;
    setWaitingFor(null);
    setPlaybackError(message);
  };

  useEffect(() => () => {
    persistPosition(true);
    selectionVersion.current++;
    mediaVersion.current++;
    selectedSeriesRef.current = '';
    cancelCompat();
    releaseOnline();
    releasePrefetch();
    clearTimeout(decodeTimer.current);
    clearTimeout(toastTimer.current);
    clearTimeout(rateNoticeTimer.current);
  }, [persistPosition, releaseOnline, cancelCompat, releasePrefetch]);

  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const changePlaybackRate = useCallback((value, notify = true) => {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return;
    const next = Math.max(0.25, Math.min(4, rate));
    playbackRateRef.current = next;
    setPlaybackRate(next);
    const v = videoRef.current;
    if (v) {
      v.defaultPlaybackRate = next;
      v.playbackRate = next;
    }
    if (notify) {
      setRateNotice(next);
      clearTimeout(rateNoticeTimer.current);
      rateNoticeTimer.current = setTimeout(() => setRateNotice(null), 1800);
    }
  }, []);

  // Tải danh sách phim đã đăng ký
  const loadSeriesList = useCallback(async () => {
    const list = (await window.electronAPI.getSeriesList()) || [];
    setSeriesList(list);
    return list;
  }, []);

  // Tải trạng thái các tập của một bộ phim
  const loadDetail = useCallback(async (seriesId) => {
    if (!seriesId) return null;
    const version = selectionVersion.current;
    const res = await window.electronAPI.getSeriesEpisodes(seriesId)
      .catch(error => ({ success: false, error: error.message }));
    if (version !== selectionVersion.current || String(seriesId) !== selectedSeriesRef.current) return null;
    if (!res?.success) {
      setDetailError(res?.error || 'Không thể lấy thông tin danh sách tập, vui lòng thử lại');
      return null;
    }
    setDetailError('');
    setDetail(res.data);
    return res.data;
  }, []);

  const usableLocal = useCallback((ep, seriesId) => ep && !ep.locked && ep.status === 'completed' && ep.fileUrl
    && localMediaKey(seriesId, ep) !== rejectedLocalRef.current
    && (['auto', 'compat'].includes(stateRef.current.onlineQuality) || /^(xifan|hema|custom):/.test(seriesId)
      || Number.parseInt(ep.actualQuality, 10) >= Number.parseInt(stateRef.current.onlineQuality, 10)), []);

  const resumeLocal = useCallback((ep, seekTo, autoplay = true) => {
    resetPlayback(autoplay);
    onlineSourceRef.current = null;
    setCompatMap(prev => { const next = { ...prev }; delete next[ep.vid_index]; return next; });
    pendingSeekRef.current = seekTo;
    setCurrentIndex(ep.vid_index);
    setWaitingFor(null);
  }, [resetPlayback]);

  const isCurrentFallback = useCallback(intent => fallbackRef.current === intent
    && intent.selection === selectionVersion.current && intent.media === mediaVersion.current
    && intent.seriesId === selectedSeriesRef.current && intent.vidIndex === stateRef.current.currentIndex, []);

  const recoverOnlineFailure = useCallback(async (ep, message) => {
    const seekTo = currentPosition();
    const autoplay = loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current;
    resetPlayback(autoplay);
    pendingSeekRef.current = seekTo;
    const intent = { seriesId: selectedSeriesRef.current, vidIndex: ep.vid_index, vid: ep.vid,
      selection: selectionVersion.current, media: mediaVersion.current, seekTo, autoplay, submitting: true };
    fallbackRef.current = intent;
    setPlaybackError(message);
    try {
      const data = await loadDetail(intent.seriesId);
      if (!isCurrentFallback(intent)) return;
      const latest = data?.episodes.find(item => item.vid_index === intent.vidIndex && item.vid === intent.vid);
      if (!latest || latest.locked) throw new Error(latest?.locked ? 'Tập này đã bị khóa, vui lòng kiểm tra trên nền tảng nguồn' : 'Không thể làm mới trạng thái tập này, vui lòng thử lại');
      if (usableLocal(latest, intent.seriesId)) { resumeLocal(latest, intent.seekTo, intent.autoplay); return; }
      const key = `${intent.selection}:${intent.seriesId}:${intent.vid}`;
      if (latest.taskId && ['pending', 'downloading'].includes(latest.status)) {
        intent.submitting = false;
        setPlaybackError(''); setWaitingFor(intent.vidIndex);
        return;
      }
      if (fallbackAttemptRef.current === key) throw new Error(latest.taskId
        ? 'Tập này đã có tác vụ tải, vui lòng kiểm tra trong Quản lý tải về hoặc thử tải lại thủ công'
        : 'Không thể thêm tập này vào danh sách tải, vui lòng nhấn "Thử lại tập này" hoặc "Tải tập này" để thử lại');
      const settings = stateRef.current.qualityLoading ? await window.electronAPI.getSettings() : null;
      if (!isCurrentFallback(intent)) return;
      let quality = stateRef.current.onlineQuality === 'compat' ? 'auto' : stateRef.current.onlineQuality !== 'auto' ? stateRef.current.onlineQuality : stateRef.current.qualityLoading
        ? (['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto') : stateRef.current.downloadQuality;
      if (quality === 'auto' && stateRef.current.onlineQuality !== 'compat' && !/^(xifan|hema|custom):/.test(intent.seriesId)) quality = '1080p';
      fallbackAttemptRef.current = key;
      setPlaybackError(''); setWaitingFor(intent.vidIndex);
      // Enqueue validates quality and reuses an existing task; cancelling playback never stops that shared download.
      const result = await window.electronAPI.downloadSingleEpisode(intent.seriesId, intent.vidIndex, quality);
      if (!isCurrentFallback(intent)) return;
      if (!result?.success) throw new Error(result?.error || 'Thêm vào danh sách tải thất bại');
      intent.submitting = false;
    } catch (error) {
      if (!isCurrentFallback(intent)) return;
      intent.submitting = false;
      fallbackRef.current = null;
      setWaitingFor(null); setPlaybackError(`${message}；${error.message}`);
    }
  }, [currentPosition, resetPlayback, loadDetail, isCurrentFallback, usableLocal, resumeLocal]);

  const refreshOnlineCacheInfo = useCallback(async () => {
    try {
      const res = await window.electronAPI.onlineCacheStatus();
      if (res && res.success) setCacheInfo({ count: res.count, bytes: res.bytes });
    } catch (_) {}
  }, []);

  const refreshCacheInfo = useCallback(async () => {
    storageDirtyRef.current = false;
    await refreshOnlineCacheInfo();
    try {
      const st = await window.electronAPI.getStorageUsage();
      if (st && st.success) {
        const map = {};
        for (const s of st.series) map[String(s.series_id)] = { files: s.files, bytes: s.bytes, merged: s.merged };
        setStorageMap(map);
        setStorageTotal({ files: st.totalFiles, bytes: st.totalBytes });
      } else storageDirtyRef.current = true;
    } catch (_) { storageDirtyRef.current = true; }
  }, [refreshOnlineCacheInfo]);

  useEffect(() => {
    const off = ['onDownloadCompleted', 'onDownloadQueueChanged', 'onMergeCompleted', 'onWatchHistoryUpdated']
      .map(name => window.electronAPI[name]?.(() => { storageDirtyRef.current = true; }));
    return () => off.forEach(unsubscribe => unsubscribe?.());
  }, []);

  useEffect(() => {
    if (!active) { storageDirtyRef.current = true; return; }
    if (pickerOpen && storageDirtyRef.current) refreshCacheInfo();
  }, [active, pickerOpen, refreshCacheInfo]);

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  const deleteDownloadedFiles = async (remove) => {
    try {
      const result = await remove();
      let message;
      if (result?.success) message = `Đã xóa ${result.count} tệp, giải phóng ${fmtSize(result.freed)}`;
      else if (Number.isFinite(result?.count) && Number.isFinite(result?.failed)) {
        message = `Đã xóa ${result.count} tệp, ${result.failed} tệp xóa thất bại${result.error ? `: ${result.error}` : ''}`;
      } else message = result?.error || 'Xóa thất bại';
      showToast(message + (result?.warning ? `；${result.warning}` : ''));
    } catch (error) {
      showToast(error.message || 'Xóa thất bại, vui lòng thử lại');
    } finally {
      setDownloadedRevision(revision => revision + 1);
      await Promise.all([loadDetail(activeSeriesId), refreshCacheInfo()]);
    }
  };

  useEffect(() => {
    refreshCacheInfo();
    window.electronAPI.getSettings().then((s) => {
      if (s) {
        setAutoDelete(s.auto_delete_watched === true);
        setCacheNext(s.cache_next_episode !== false);
        setAutoCompat(s.compat_mode !== false); // Mặc định bật
      }
    });
    window.electronAPI.compatCacheStatus().then((r) => {
      if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
    });
  }, [refreshCacheInfo]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setQualityLoading(true);
    window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) {
        setDownloadQuality(['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto');
        setShowDanmakuControls(settings?.show_danmaku_controls !== false);
        setAutoDelete(settings?.auto_delete_watched === true);
        setCacheNext(settings?.cache_next_episode !== false);
        setAutoCompat(settings?.compat_mode !== false);
      }
    }).catch(() => {
      if (!cancelled) showToast('Đọc độ phân giải tải về mặc định thất bại, vui lòng kiểm tra lại độ phân giải trước khi tải');
    }).finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    if (!cacheNext) releasePrefetch();
  }, [cacheNext, releasePrefetch]);

  useEffect(() => {
    if (!window.electronAPI.onTranscodeProgress) return undefined;
    return window.electronAPI.onTranscodeProgress((d) => {
      const request = compatRequestRef.current;
      if (!request || d.requestId !== request.requestId || request.version !== mediaVersion.current || String(d.seriesId) !== request.seriesId || d.vidIndex !== request.vidIndex || d.done) return;
      setCompatProgress({ vidIndex: d.vidIndex, percent: d.percent || 0 });
    });
  }, []);

  const savePlaybackSetting = async (key, value, setValue) => {
    if (playbackSettingPending.current) return;
    playbackSettingPending.current = true;
    setPlaybackSettingSaving(true);
    try {
      const result = await window.electronAPI.saveSettings({ [key]: value });
      if (!result?.success) throw new Error(result?.error || 'Lưu cài đặt thất bại');
      setValue(value);
    } catch (error) {
      showToast(`Cài đặt chưa thay đổi: ${error.message}`);
    } finally {
      playbackSettingPending.current = false;
      setPlaybackSettingSaving(false);
    }
  };

  // Sau khi mở bảng phim hoặc xóa tệp, bổ sung tiến độ tải về của từng phim.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const s of seriesList) {
        try {
          const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
          if (res && res.success) map[String(s.series_id)] = { completed: res.data.completedCount, total: res.data.total };
        } catch (_) {}
        if (cancelled) return;
      }
      if (!cancelled) setDownloadedMap(map);
    })();
    return () => { cancelled = true; };
  }, [pickerOpen, seriesList, downloadedRevision]);

  useEffect(() => {
    if (!window.electronAPI.onOnlinePlayProgress) return undefined;
    return window.electronAPI.onOnlinePlayProgress((d) => {
      const request = onlineRequestRef.current;
      if (!request || d.requestId !== request.requestId) return;
      if (d.code === 'MEDIA_TOO_LARGE') { showToast(d.error); return; }
      if (request.prepared) return;
      setOnlineProgress({
        vid: d.vid,
        percent: d.percent || 0,
        phase: d.phase || 'downloading',
        received: d.received,
        total: d.total,
      });
    });
  }, []);

  // Chỉ kiểm tra tệp sau khi gộp sự kiện; việc chờ tải về không tự kích hoạt quét ổ đĩa.
  useEffect(() => {
    if (!activeSeriesId || !playbackActive) return;
    let busy = false, dirty = true;
    const unsubscribe = ['onDownloadTaskAdded', 'onDownloadCompleted', 'onDownloadFailed', 'onDownloadStopped', 'onDownloadQueueChanged', 'onWatchHistoryUpdated']
      .map(name => window.electronAPI[name]?.(() => { dirty = true; }));
    unsubscribe.push(window.electronAPI.onDownloadProgress?.(data => {
      setDetail(previous => {
        if (!previous?.episodes.some(ep => ep.taskId === data?.id)) return previous;
        return { ...previous, episodes: previous.episodes.map(ep => ep.taskId === data.id
          ? { ...ep, status: 'downloading', progress: data.progress, retryAt: null } : ep) };
      });
    }));
    const timer = setInterval(async () => {
      if (busy || !dirty) return;
      dirty = false;
      busy = true;
      const version = mediaVersion.current;
      const submitting = fallbackRef.current?.submitting;
      let d;
      try { d = await loadDetail(activeSeriesId); } catch (_) {} finally { busy = false; }
      if (!d) dirty = true;
      if (!d || !activeRef.current || version !== mediaVersion.current) return;
      const intent = fallbackRef.current;
      const recovery = intent && isCurrentFallback(intent) ? intent : null;
      const wf = stateRef.current.waitingFor ?? recovery?.vidIndex;
      if (wf != null) {
        const ep = d.episodes.find((e) => e.vid_index === wf);
        if (usableLocal(ep, String(activeSeriesId)) && (!recovery || ep.vid === recovery.vid)) {
          // Tập tiếp theo đang chờ đã tải xong -> Tự động chuyển sang
          setWaitingFor(null);
          const sameEpisode = wf === stateRef.current.currentIndex;
          const seekTo = recovery ? recovery.seekTo : sameEpisode ? currentPosition() : 0;
          resumeLocal(ep, seekTo, recovery ? recovery.autoplay : !sameEpisode || !loadedMediaRef.current?.element.paused);
        } else if (stateRef.current.waitingFor != null && !submitting && !recovery?.submitting
          && (!ep || ep.locked || (ep.status === 'failed' && !ep.retryAt) || ['stopped', 'cancelled', 'missing', 'completed'].includes(ep.status))) {
          setWaitingFor(null);
          fallbackRef.current = null;
          setPlaybackError(ep?.error || (ep?.status === 'stopped' || ep?.status === 'cancelled' ? 'Tải tập này đã dừng, có thể thử lại trong Quản lý tải về'
            : ep?.status === 'completed' ? 'Tệp cục bộ hiện có không thể phát, vui lòng kiểm tra tệp trong Quản lý tải về' : 'Tải tập này thất bại hoặc tác vụ đã bị xóa, vui lòng kiểm tra trong Quản lý tải về rồi thử lại'));
        }
      }
    }, 2000);
    return () => { clearInterval(timer); unsubscribe.forEach(off => off?.()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackActive, activeSeriesId, waitingFor, loadDetail, currentPosition, isCurrentFallback, usableLocal, resumeLocal]);

  const episodes = detail ? detail.episodes : [];
  const current = useMemo(
    () => episodes.find((e) => e.vid_index === currentIndex) || null,
    [episodes, currentIndex]
  );

  const compatUrl = current ? compatMap[current.vid_index] : null;
  const isOnlinePlaying = onlineVid && current && current.vid === onlineVid && onlineUrl;
  const needsCompat = autoCompat && onlineQuality === 'compat' && isOnlinePlaying && !compatUrl
    && /^(hevc|h265|h265_hvc1|hvc1|hev1|bytevc1)$/i.test(onlineRequestRef.current?.codec || '');
  const canPlay = !!(playbackRequested && !playbackError && !onlineProgress && !needsCompat && current && !current.locked && (compatUrl || usableLocal(current, String(activeSeriesId)) || isOnlinePlaying));
  const playableSource = compatUrl || (isOnlinePlaying ? onlineUrl : current?.fileUrl) || '';
  // Toàn màn hình gốc phụ thuộc vào thẻ video. Giữ khung hình kết thúc khi chuẩn bị tập tiếp theo, đổi nguồn chứ không đổi thẻ DOM.
  if (canPlay) lastVideoSrcRef.current = playableSource;
  const videoSrc = !playbackRequested || compatProgress ? '' : lastVideoSrcRef.current;
  const danmakuSource = useDanmakuSource();
  const visualActive = canPlay && (active || floatingPlayer.floating);
  const danmakuActive = visualActive && showDanmakuControls;
  const commentDanmaku = useCommentDanmaku({ seriesId: activeSeriesId, episodeId: current?.vid, active: danmakuActive && danmakuSource === 'comments' });
  const officialDanmaku = useOfficialDanmaku({ seriesId: activeSeriesId, vid: current?.vid, active: danmakuActive && danmakuSource === 'official', preferences: commentDanmaku });
  const danmaku = { ...(danmakuSource === 'official' ? officialDanmaku : commentDanmaku), sourceKind: danmakuSource, setSource: writeDanmakuSource };

  useEffect(() => {
    const v = videoRef.current;
    if (loading || !canPlay || !v) return;
    const previous = lastLoadRef.current;
    lastLoadRef.current = { source: videoSrc, version: playbackVersion };
    v.defaultPlaybackRate = playbackRateRef.current;
    // Thử lại rõ ràng với cùng một địa chỉ sẽ không kích hoạt đổi src, chỉ cần dùng load gốc để đặt lại media.
    if (previous?.source === videoSrc && previous.version !== playbackVersion) { v.src = videoSrc; v.load(); }
    v.playbackRate = playbackRateRef.current;
  }, [loading, canPlay, videoSrc, playbackVersion]);

  const playableCount = episodes.filter((e) => e.status === 'completed').length;

  /** Chuyển mã tập hiện tại sang H.264 rồi phát (giải quyết màn hình đen khi máy không giải mã được HEVC) */
  const startCompatPlay = useCallback(
    async (vidIndex, force = false) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      const request = { requestId: crypto.randomUUID(), seriesId: String(activeSeriesId), vidIndex,
        quality: onlineRequestRef.current?.playbackQuality || (onlineQuality === 'compat' ? 'auto' : onlineQuality), version: mediaVersion.current };
      if (compatRequestRef.current?.version === request.version && compatRequestRef.current?.vidIndex === vidIndex) return;
      autoCompatAttemptRef.current = { version: request.version, force };
      pendingSeekRef.current = currentPosition();
      if (loadedMediaRef.current) pendingAutoplayRef.current = !loadedMediaRef.current.element.paused;
      fallbackRef.current = null;
      setWaitingFor(null);
      setPlaybackError('');
      persistPosition(true);
      videoRef.current?.pause();
      loadedMediaRef.current = null;
      // Windows must release the failed cache before FFmpeg replaces it. Keep the fullscreen node.
      videoRef.current?.removeAttribute('src');
      videoRef.current?.load();
      compatRequestRef.current = request;
      setCompatError('');
      setCompatProgress({ vidIndex, percent: 0 });
      try {
        const res = await window.electronAPI.transcodeForPlayback({
          requestId: request.requestId,
          seriesId: activeSeriesId,
          vidIndex,
          vid: ep.vid,
          quality: request.quality,
          filePath: onlineSourceRef.current === `${activeSeriesId}:${vidIndex}` ? null : ep.savePath || null,
          force,
        });
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        if (res && res.success) {
          loadedMediaRef.current = null;
          // A fast same-URL result can be batched with the loading state; restore the DOM source explicitly.
          if (videoRef.current) { videoRef.current.src = res.url; videoRef.current.load(); }
          setCompatMap((prev) => ({ ...prev, [vidIndex]: res.url }));
          setDecodeFailed(false);
          setCompatProgress(null);
          showToast(res.cached ? 'Đã chuyển sang định dạng tương thích để phát' : `Đã chuyển mã sang định dạng tương thích (mất ${res.elapsed}s), bắt đầu phát`);
          window.electronAPI.compatCacheStatus().then((r) => {
            if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
          });
        } else {
          setCompatProgress(null);
          if (res?.code === 'MEDIA_TOO_LARGE') showToast(res.error);
          if (autoCompat && !res?.cancelled && reconnectOnce()) return;
          const message = (res && res.error) || 'Chuyển mã thất bại';
          if (!res?.cancelled && onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
            await recoverOnlineFailure(ep, message);
            return;
          }
          setDecodeFailed(true);
          setCompatError(message);
          showToast(message);
        }
      } catch (e) {
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        setCompatProgress(null);
        if (autoCompat && reconnectOnce()) return;
        if (onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
          await recoverOnlineFailure(ep, 'Lỗi chuyển mã: ' + e.message);
          return;
        }
        setDecodeFailed(true);
        setCompatError('Lỗi chuyển mã: ' + e.message);
        showToast('Lỗi chuyển mã: ' + e.message);
      }
    },
    [episodes, activeSeriesId, onlineQuality, autoCompat, reconnectOnce, showToast, currentPosition, persistPosition, recoverOnlineFailure]
  );

  const tryAutoCompat = useCallback((vidIndex) => {
    if (!autoCompat) return;
    const force = !!compatMap[vidIndex];
    const attempt = autoCompatAttemptRef.current;
    if (attempt?.version === mediaVersion.current && (!force || attempt.force)) {
      if (stateRef.current.onlineQuality === 'auto') reconnectOnce();
      return;
    }
    startCompatPlay(vidIndex, force);
  }, [autoCompat, compatMap, startCompatPlay, reconnectOnce]);

  useEffect(() => {
    if (needsCompat && playbackRequested && !playbackError && !onlineProgress) tryAutoCompat(currentIndex);
  }, [needsCompat, playbackRequested, playbackError, onlineProgress, currentIndex, tryAutoCompat]);

  const clearCompatCache = async () => {
    const affected = !!compatMap[currentIndex] || !!compatRequestRef.current;
    if (affected) stopPlayback('Phát tương thích đã dừng, có thể thử lại tập này để tiếp tục xem');
    try {
      const r = await window.electronAPI.clearCompatCache();
      if (!r?.success) { showToast(r?.error || 'Xóa bộ nhớ đệm chuyển mã thất bại'); return; }
      setCompatMap({});
      setCompatCache({ files: 0, bytes: 0 });
      showToast(r.count > 0 ? `Đã dọn sạch bộ nhớ đệm chuyển mã, giải phóng ${fmtSize(r.freed)}` : 'Bộ nhớ đệm chuyển mã đã trống');
    } catch (e) { showToast('Xóa bộ nhớ đệm chuyển mã thất bại: ' + e.message); }
  };

  // Trong khi phát nếu luôn không hiển thị được hình ảnh (videoWidth luôn là 0), xác định là không tương thích giải mã.
  // Phải định nghĩa trước return sớm —— hooks không được xuất hiện sau nhánh điều kiện.
  const handlePlaying = useCallback((event) => {
    const media = loadedMediaRef.current;
    const element = event.currentTarget;
    if (!activeRef.current || element.paused || media?.version !== mediaVersion.current || media.element !== element) return;
    // Ghi nhận trước "tập này thực sự đã phát", không để trạng thái React của canPlay/playbackVersion chậm một nhịp
    // mà bỏ qua vĩnh viễn việc nạp trước và lưu điểm dừng; phán đoán giải mã bên dưới vẫn yêu cầu trạng thái khớp.
    if (!media.played) {
      media.played = true;
      persistPosition(true);
    }
    if (playbackVersion !== mediaVersion.current || !canPlay) return;
    if (element.currentSrc && videoSrc && element.currentSrc !== videoSrc) return;
    setAutoAdvancing(false);
    setDecodeFailed(false);
    setMediaBuffering(false);
    const idx = currentIndex;
    const version = mediaVersion.current;
    clearTimeout(decodeTimer.current);
    decodeTimer.current = setTimeout(() => {
      if (version !== mediaVersion.current) return;
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth === 0 && !v.paused && v.currentTime > 0.3) {
        setDecodeFailed(true);
        tryAutoCompat(idx);
      }
    }, 2600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, tryAutoCompat, playbackVersion, canPlay, videoSrc, persistPosition]);

  /**
   * Phát trực tuyến: Tải nguồn rõ theo nhu cầu, nguồn mã hóa sau khi chuẩn bị sẽ trả về địa chỉ phát.
   * Không chiếm dụng thư mục tải về; tệp chuẩn bị của nguồn mã hóa sẽ tự động dọn dẹp.
   */
  const startOnlinePlay = useCallback(
    async (vidIndex, resumeAt, force = false, autoplay = true, qualityIndex = 0) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (ep?.locked) { showToast('Tập này cần mở khóa trên nền tảng nguồn'); return; }
      if (!ep || !ep.vid) {
        showToast('Tập này tạm thời không thể phát, vui lòng tải lại thông tin phim rồi thử lại');
        return;
      }
      const quality = stateRef.current.onlineQuality;
      const qualities = quality === 'auto' && !/^(xifan|hema|custom):/.test(activeSeriesId)
        ? AUTO_ONLINE_QUALITIES : [quality === 'compat' ? 'auto' : quality];
      onlineSourceRef.current = `${activeSeriesId}:${vidIndex}`;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      const prefetched = force === false
        ? prefetchRef.current.find(item => item.vid === ep.vid && item.seriesId === activeSeriesId && item.quality === quality) || null
        : null;
      if (prefetched) prefetchFailureRef.current.delete(prefetchKey(activeSeriesId, prefetched.vid, prefetched.quality));
      if (force) {
        releasePrefetch();
      } else {
        // Khi nhảy đến tập xa hơn, các bản nạp trước cũ trước tập đích hoặc khác độ phân giải sẽ được giải phóng ngay;
        // nạp trước sau tập đích và cùng phim/độ phân giải được giữ lại, chuyển sang có thể tái sử dụng ngay.
        prunePrefetchAfter(activeSeriesId, vidIndex, quality, prefetched);
      }
      resetPlayback(autoplay, force === false);
      setCompatMap(prev => { const next = { ...prev }; delete next[vidIndex]; return next; });
      const request = prefetched || { requestId: crypto.randomUUID(), vid: ep.vid };
      request.qualityIndex = qualityIndex;
      request.playbackQuality = qualities[qualityIndex];
      onlineRequestRef.current = request;
      pendingSeekRef.current = seekTo;
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      const prefetchedReady = prefetched?.ready === true;
      let usedPrefetch = !!prefetched;
      setOnlineProgress(prefetchedReady ? null : { vid: ep.vid, percent: 0, phase: 'preparing' });
      setOnlineVid(ep.vid);
      setOnlineUrl('');
      try {
        let res = prefetched ? await prefetched.promise : null;
        if (onlineRequestRef.current !== request) return;
        for (let index = qualityIndex; !res?.success && index < qualities.length; index++) {
          usedPrefetch = false;
          request.qualityIndex = index;
          request.playbackQuality = qualities[index];
          setOnlineProgress({ vid: ep.vid, percent: 0, phase: 'preparing' });
          try {
            res = await window.electronAPI.prepareOnlinePlay({
              requestId: request.requestId, vid: ep.vid, seriesId: activeSeriesId, vidIndex,
              quality: qualities[index], force,
            });
          } catch (error) { res = { success: false, error: error.message }; }
          if (onlineRequestRef.current !== request) break;
          if (!res?.success && index + 1 < qualities.length) {
            showToast(`${qualities[index].toUpperCase()} tạm thời không khả dụng, đang thử ${qualities[index + 1] === 'auto' ? 'nguồn tương thích' : qualities[index + 1].toUpperCase()}`);
          }
        }
        if (onlineRequestRef.current !== request) {
          window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: res?.streamId }).catch(() => {});
          return;
        }
        if (!res || !res.success) {
          if (res?.code === 'MEDIA_TOO_LARGE') showToast(res.error);
          await recoverOnlineFailure(ep, (res && res.error) || 'Chuẩn bị phát trực tuyến thất bại');
          return;
        }
        request.streamId = res.streamId;
        request.codec = res.codec;
        request.prepared = true;
        if (!usedPrefetch && !res.cached) setMediaBuffering(true);
        setOnlineUrl(res.url);
        setOnlineProgress(null);
        // Playback cache changes do not need a synchronous scan of all download directories.
        refreshOnlineCacheInfo();
      } catch (e) {
        if (onlineRequestRef.current !== request) return;
        await recoverOnlineFailure(ep, 'Phát trực tuyến thất bại: ' + e.message);
      }
    },
    [episodes, activeSeriesId, showToast, refreshOnlineCacheInfo, resetPlayback, releaseOnline, currentPosition, recoverOnlineFailure, prunePrefetchAfter]
  );

  function reconnectOnce() {
    const key = `${activeSeriesId}:${currentIndex}`;
    if (stateRef.current.onlineQuality === 'auto' && !/^(xifan|hema|custom):/.test(activeSeriesId)
      && onlineSourceRef.current === key) {
      const next = (onlineRequestRef.current?.qualityIndex ?? 0) + 1;
      if (!current?.vid || current.locked || next >= AUTO_ONLINE_QUALITIES.length) return false;
      showToast(`Đang tự động chuyển sang ${AUTO_ONLINE_QUALITIES[next] === 'auto' ? 'nguồn tương thích' : AUTO_ONLINE_QUALITIES[next].toUpperCase()}…`);
      startOnlinePlay(currentIndex, currentPosition(), true,
        loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current, next);
      return true;
    }
    if (!current?.vid || current.locked || reconnectAttemptRef.current === key) return false;
    reconnectAttemptRef.current = key;
    if (onlineSourceRef.current !== key && current.status === 'completed') rejectedLocalRef.current = localMediaKey(String(activeSeriesId), current);
    showToast('Đang lấy lại nguồn phim cho tập này…');
    startOnlinePlay(currentIndex, currentPosition(), true, loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current);
    return true;
  }

  // Chuyển tập
  const goToEpisode = useCallback(
    (vidIndex, resumeAt) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      fallbackAttemptRef.current = null;
      reconnectAttemptRef.current = null;
      if (!usableLocal(ep, String(activeSeriesId))) {
        startOnlinePlay(vidIndex, resumeAt);
        return;
      }
      onlineSourceRef.current = null;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      resetPlayback(true, true);
      prunePrefetchAfter(activeSeriesId, vidIndex, onlineQuality);
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      pendingSeekRef.current = seekTo;
    },
    [episodes, activeSeriesId, resetPlayback, startOnlinePlay, currentPosition, usableLocal, prunePrefetchAfter, onlineQuality]
  );

  const retryPlayback = async () => {
    const version = mediaVersion.current, selection = selectionVersion.current, navigation = navigationVersion.current;
    let data;
    try { data = await loadDetail(activeSeriesId); } catch (_) {}
    if (!activeRef.current || navigation !== navigationVersion.current || version !== mediaVersion.current || selection !== selectionVersion.current) return;
    const latest = data?.episodes.find(ep => ep.vid_index === currentIndex && ep.vid === current?.vid);
    if (usableLocal(latest, String(activeSeriesId))) { resumeLocal(latest, currentPosition()); return; }
    setCompatMap(prev => { const next = { ...prev }; delete next[currentIndex]; return next; });
    if (onlineSourceRef.current === `${activeSeriesId}:${currentIndex}` || current?.status !== 'completed') {
      fallbackAttemptRef.current = null;
      reconnectAttemptRef.current = null;
      startOnlinePlay(currentIndex, currentPosition(), true);
    } else goToEpisode(currentIndex, currentPosition());
  };

  const changeOnlineQuality = (quality) => {
    if (!['auto', '720p', '1080p', 'compat'].includes(quality) || !supportsOnlineQuality) return;
    const seekTo = currentPosition();
    const autoplay = loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current;
    setOnlineQualityChoice(quality);
    stateRef.current.onlineQuality = quality;
    try { window.localStorage.setItem('hongguo:online-quality', quality); } catch { showToast('Độ phân giải lần này đã chuyển đổi, nhưng chưa lưu được'); }
    fallbackAttemptRef.current = null;
    reconnectAttemptRef.current = null;
    setCompatMap({});
    if (playbackRequested && current && !current.locked) startOnlinePlay(currentIndex, seekTo, true, autoplay);
  };

  // Tìm tập tiếp theo (theo thứ tự số tập)
  const findNext = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx === -1 || idx + 1 >= episodes.length) return null;
      return episodes.slice(idx + 1).find((ep) => !ep.locked) || null;
    },
    [episodes]
  );
  const findPrev = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx <= 0) return null;
      return episodes.slice(0, idx).reverse().find((ep) => !ep.locked) || null;
    },
    [episodes]
  );

  // Chỉ nạp trước các tập có thể phát trực tuyến phía sau, chưa bị khóa và chưa có tệp cục bộ, tối đa 2 tập.
  const prefetchCandidates = useCallback((fromIndex, count = PREFETCH_AHEAD) => {
    const start = episodes.findIndex((episode) => episode.vid_index === fromIndex);
    if (start === -1) return [];
    const result = [];
    for (let index = start + 1; index < episodes.length && result.length < count; index += 1) {
      const episode = episodes[index];
      if (episode?.locked || String(episode?.vid || '') === '' || usableLocal(episode, String(activeSeriesId))) continue;
      result.push(episode);
    }
    return result;
  }, [episodes, activeSeriesId, usableLocal]);

  const prepareNextEpisode = (event) => {
    const video = event.currentTarget;
    const media = loadedMediaRef.current;
    // Ở đây chỉ phụ thuộc vào phần tử hiện tại và phiên bản; media.played có thể chậm một nhịp do trạng thái React của playing
    // chưa được gán cờ, không thể để nó chặn vĩnh viễn việc nạp trước các tập tiếp theo.
    if (cacheNext === false || canPlay === false || video.paused || media?.version !== mediaVersion.current || media.element !== video) return;
    const targets = prefetchCandidates(currentIndex);
    const desired = new Set(targets.map(episode => prefetchKey(activeSeriesId, episode.vid, onlineQuality)));
    const kept = [];
    for (const request of prefetchRef.current) {
      if (desired.has(prefetchKey(request.seriesId, request.vid, request.quality))) kept.push(request);
      else releasePrefetchRequest(request);
    }
    prefetchRef.current = kept;
    for (const episode of targets) {
      const key = prefetchKey(activeSeriesId, episode.vid, onlineQuality);
      if (kept.some(request => prefetchKey(request.seriesId, request.vid, request.quality) === key)) continue;
      const failedAt = prefetchFailureRef.current.get(key);
      if (failedAt && Date.now() - failedAt < PREFETCH_RETRY_MS) continue;
      const request = { requestId: crypto.randomUUID(), vid: episode.vid, seriesId: activeSeriesId,
        vidIndex: episode.vid_index, quality: onlineQuality, ready: false };
      prefetchRef.current = [...prefetchRef.current, request];
      request.promise = window.electronAPI.prepareOnlinePlay({ ...request,
        quality: onlineQuality === 'compat' ? 'auto' : onlineQuality === 'auto' && supportsOnlineQuality ? '1080p' : onlineQuality, prefetch: true })
        .catch(error => ({ success: false, error: error?.message || String(error) }))
        .then(result => {
          request.ready = result?.success === true;
          if (prefetchRef.current.includes(request)) {
            if (result?.success) {
              prefetchFailureRef.current.delete(key);
              refreshOnlineCacheInfo();
            } else {
              const index = prefetchRef.current.indexOf(request);
              if (index >= 0) prefetchRef.current.splice(index, 1);
              prefetchFailureRef.current.set(key, Date.now());
              if (result?.streamId) request.streamId = result.streamId;
              releasePrefetchRequest(request);
            }
          } else if (onlineRequestRef.current === request) {
            // Đã được quy trình chuyển tập tiếp quản, phiên phát hiện tại chịu trách nhiệm giải phóng sau.
          } else {
            if (result?.streamId) request.streamId = result.streamId;
            releasePrefetchRequest(request);
          }
          return result;
        });
    }
  };

  // Bàn giao tập tiếp theo hoặc giải phóng media hiện tại trước, rồi mới dọn dẹp tệp và bộ nhớ đệm vừa xem xong.
  const handleEnded = useCallback(async () => {
    const { currentIndex: ci, autoNext: an, activeSeriesId: sid } = stateRef.current;
    const next = an ? findNext(ci) : null;
    persistPosition(true, true);
    const released = autoDelete && sid ? releaseOnline() : null;
    if (autoDelete && sid) {
      loadedMediaRef.current = null;
      videoRef.current?.pause();
      videoRef.current?.removeAttribute('src');
      videoRef.current?.load();
      lastVideoSrcRef.current = '';
      setCompatMap(previous => { const result = { ...previous }; delete result[ci]; return result; });
    }
    if (next) {
      goToEpisode(next.vid_index, 0);
      setAutoAdvancing(true);
    } else {
      if (autoDelete && sid) {
        resetPlayback(false);
        setPlaybackRequested(false);
        pendingSeekRef.current = 0;
      }
      if (an) showToast(episodes.some(ep => ep.locked) ? 'Đã phát hết các tập có thể xem, các tập còn lại cần mở khóa trên nền tảng nguồn' : 'Đã là tập cuối cùng');
    }
    if (autoDelete && sid) {
      await released;
      window.electronAPI.cleanupWatchedEpisode(sid, ci).then(async result => {
        if (!result?.success) throw new Error(result?.error || 'Dọn dẹp thất bại, vui lòng thử lại trong kho phim');
        if (result.count > 0) showToast(`Tập ${ci} đã xem xong, dọn dẹp tệp và bộ nhớ đệm (giải phóng ${fmtSize(result.freed)})`);
        refreshCacheInfo();
        loadDetail(sid);
        const cache = await window.electronAPI.compatCacheStatus();
        if (cache?.success) setCompatCache({ files: cache.files, bytes: cache.bytes });
      }).catch(error => showToast(`Tự động dọn dẹp tập ${ci} thất bại: ${error.message}`));
    }
  }, [findNext, goToEpisode, showToast, autoDelete, episodes, refreshCacheInfo, loadDetail, persistPosition, resetPlayback, releaseOnline]);

  // Rời trang, tạm dừng và đóng cửa sổ bắt buộc lưu giây cuối cùng.
  useEffect(() => {
    const timer = setInterval(persistPosition, 5000);
    const save = () => persistPosition(true);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [persistPosition]);

  useEffect(() => {
    const video = videoRef.current;
    const sync = () => {
      const native = !!video && document.pictureInPictureElement === video;
      setNativePictureInPicture(native);
      onFloatingChange?.(native || floatingPlayer.floating);
    };
    sync();
    if (!video) return;
    video.addEventListener('enterpictureinpicture', sync);
    video.addEventListener('leavepictureinpicture', sync);
    return () => {
      video.removeEventListener('enterpictureinpicture', sync);
      video.removeEventListener('leavepictureinpicture', sync);
    };
  }, [loading, videoSrc, floatingPlayer.floating, onFloatingChange]);

  useEffect(() => {
    if (playbackActive) return;
    navigationVersion.current++;
    persistPosition(true);
    pendingAutoplayRef.current = false;
    pendingTargetRef.current = null;
    fallbackRef.current = null;
    setWaitingFor(null);
    setAutoAdvancing(false);
    const video = videoRef.current;
    video?.pause();
  }, [playbackActive, persistPosition]);

  const handleMetadata = (event) => {
    const v = event.currentTarget;
    if (!canPlay || playbackVersion !== mediaVersion.current || v !== videoRef.current || !current || current.locked) return;
    if (v.currentSrc && v.currentSrc !== videoSrc) return;
    loadedMediaRef.current = { element: v, seriesId: activeSeriesId, vidIndex: currentIndex, version: mediaVersion.current, played: false };
    v.defaultPlaybackRate = playbackRateRef.current;
    v.playbackRate = playbackRateRef.current;
    const seekTo = Math.max(0, Number(pendingSeekRef.current) || 0);
    if (seekTo > 0 && (!Number.isFinite(v.duration) || seekTo < v.duration - 3)) {
      v.currentTime = seekTo;
      showToast(`Tiếp tục phát từ ${Math.floor(seekTo / 60)}:${String(Math.floor(seekTo % 60)).padStart(2, '0')}`);
    }
    pendingSeekRef.current = 0;
    if (compatMap[currentIndex]) releaseOnline();
    if (activeRef.current && pendingAutoplayRef.current) v.play().catch(() => { if (playbackVersion === mediaVersion.current) setAutoAdvancing(false); });
  };

  const restoreFullscreenScroll = useCallback(() => {
    const saved = fullscreenScrollRef.current;
    if (!saved || document.fullscreenElement) return;
    saved.element.scrollTop = saved.top;
    fullscreenScrollRef.current = null;
  }, []);

  useEffect(() => {
    let frame = 0;
    const restore = () => {
      if (!document.fullscreenElement) frame = requestAnimationFrame(restoreFullscreenScroll);
    };
    document.addEventListener('fullscreenchange', restore);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('fullscreenchange', restore); };
  }, [restoreFullscreenScroll]);

  const toggleFullscreen = useCallback(async () => {
    if (document.querySelector('.stealth-mode')) { showToast('Vui lòng thoát chế độ cửa sổ nhỏ trước'); return; }
    try {
      const stageDocument = stageRef.current?.ownerDocument || document;
      if (portrait && !floatingPlayer.floating) { setWindowFill(fill => !fill); return; }
      if (stageDocument.fullscreenElement === stageRef.current) await stageDocument.exitFullscreen();
      else {
        const element = stageRef.current?.closest('.main-content');
        // Fullscreen takes the player out of flow and can clamp the page's scrollTop to zero.
        if (element && !fullscreenScrollRef.current) fullscreenScrollRef.current = { element, top: element.scrollTop };
        await stageRef.current?.requestFullscreen();
      }
    } catch { restoreFullscreenScroll(); showToast('Không thể vào hoặc thoát toàn màn hình, vui lòng thử lại'); }
  }, [portrait, floatingPlayer.floating, showToast, restoreFullscreenScroll]);

  // Capture handled keys before media controls; cancel keyup too so focused buttons cannot toggle twice.
  useEffect(() => {
    if ((!active && !floatingPlayer.floating) || confirmAsk || mergeAsk || pickerOpen) return;
    const keyboardWindow = stageRef.current?.ownerDocument?.defaultView || window;
    const held = new Set();
    const onKey = (event) => {
      const video = videoRef.current;
      if (!video || event.defaultPrevented || ignoresPlaybackShortcut(event.target, event.key)) return;
      const key = shortcutKey(event);
      const action = SHORTCUT_ACTIONS.find(item => shortcuts[item.id] === key);
      if (!action) return;
      event.preventDefault(); event.stopPropagation?.();
      held.add(event.code || event.key);
      if (event.repeat && !action.repeat) return;
      const { currentIndex: index, autoNext: nextEnabled } = stateRef.current;
      if (action.id === 'play') {
        if (video.paused) video.play().catch(() => showToast('Tạm thời không thể phát, vui lòng thử lại tập này'));
        else video.pause();
      } else if (action.id === 'forward' || action.id === 'backward') {
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        try { video.currentTime = Math.max(0, Math.min(limit, video.currentTime + (action.id === 'forward' ? 5 : -5))); }
        catch { showToast('Tạm thời không thể tua, vui lòng thử lại sau'); }
      } else if (action.id === 'previous' || action.id === 'next') {
        const episode = action.id === 'previous' ? findPrev(index) : findNext(index);
        if (episode) { goToEpisode(episode.vid_index); setAutoAdvancing(true); }
        else showToast(action.id === 'previous' ? 'Đã là tập đầu tiên' : 'Đã là tập cuối cùng');
      } else if (action.id === 'autoNext') setAutoNext(!nextEnabled);
      else if (action.id === 'fullscreen') toggleFullscreen();
      else changePlaybackRate(playbackRateRef.current + (action.id === 'slower' ? -0.25 : 0.25));
    };
    const onKeyUp = event => {
      if (!held.delete(event.code || event.key)) return;
      event.preventDefault(); event.stopPropagation?.();
    };
    const onBlur = () => held.clear();
    keyboardWindow.addEventListener('keydown', onKey, true);
    keyboardWindow.addEventListener('keyup', onKeyUp, true);
    keyboardWindow.addEventListener('blur', onBlur);
    return () => {
      keyboardWindow.removeEventListener('keydown', onKey, true);
      keyboardWindow.removeEventListener('keyup', onKeyUp, true);
      keyboardWindow.removeEventListener('blur', onBlur);
    };
  }, [active, floatingPlayer.floating, confirmAsk, mergeAsk, pickerOpen, findNext, findPrev, goToEpisode, changePlaybackRate, showToast, shortcuts, toggleFullscreen]);

  const switchSeries = useCallback(async (sid, requestedIndex = 0, resume = false, autoplay = true) => {
    persistPosition(true);
    const version = ++selectionVersion.current;
    selectedSeriesRef.current = String(sid);
    fallbackAttemptRef.current = null;
    rejectedLocalRef.current = null;
    onSeriesSelected?.(String(sid));
    pendingTargetRef.current = null;
    reconnectAttemptRef.current = null;
    onlineSourceRef.current = null;
    resetPlayback(autoplay);
    setPlaybackRequested(autoplay);
    setCompatMap({});
    mergeDialogGenerationRef.current += 1;
    setMergeAsk(false);
    setMergeError('');
    setActiveSeriesId(String(sid));
    setDetail(null);
    setDetailError('');
    setWaitingFor(null);
    setLoading(true);
    try {
      const d = await loadDetail(sid);
      if (!d || version !== selectionVersion.current) return;
      const saved = requestedIndex && !resume ? null : await window.electronAPI.getPlaybackPosition(sid);
      if (version !== selectionVersion.current) return;
      const wantedIndex = requestedIndex || saved?.vid_index;
      const selected = d.episodes.find(e => e.vid_index === wantedIndex && !e.locked) || d.episodes.find(e => !e.locked);
      setCurrentIndex(selected?.vid_index || 1);
      pendingSeekRef.current = selected?.vid_index === saved?.vid_index ? saved.currentTime || 0 : 0;
      if (autoplay && selected && !usableLocal(selected, String(sid))) {
        pendingTargetRef.current = { seriesId: String(sid), vidIndex: selected.vid_index, seekTo: pendingSeekRef.current, autoplay: pendingAutoplayRef.current };
      }
    } catch (e) {
      if (version === selectionVersion.current) showToast('Tải danh sách tập thất bại: ' + e.message);
    } finally {
      if (version === selectionVersion.current) setLoading(false);
    }
  }, [persistPosition, resetPlayback, loadDetail, showToast, onSeriesSelected, usableLocal]);

  // Lần đầu vào và duyệt theo yêu cầu dùng chung một lần tải, tránh hai yêu cầu khởi tạo ghi đè lẫn nhau.
  useEffect(() => {
    let cancelled = false;
    const navigation = navigationVersion.current;
    setLoading(true);
    (async () => {
      try {
        const list = await loadSeriesList();
        if (cancelled) return;
        const wanted = target?.seriesId && list.find(s => String(s.series_id) === String(target.seriesId));
        const selected = wanted || [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (selected) await switchSeries(selected.series_id, wanted ? target.vidIndex : 0, !!(wanted && target.resume), !!wanted && target.autoplay !== false && navigation === navigationVersion.current);
        else setLoading(false);
      } catch (e) {
        if (!cancelled) { setLoading(false); showToast('Tải kho phim thất bại: ' + e.message); }
      }
    })();
    return () => { cancelled = true; };
  }, [target?.ts, loadSeriesList, switchSeries, showToast]);

  useEffect(() => {
    const returned = active && !lastActiveRef.current;
    lastActiveRef.current = active;
    if (!active || (!returned && !pickerOpen)) return;
    let cancelled = false;
    loadSeriesList().then(list => {
      if (!cancelled && !selectedSeriesRef.current && list[0]) switchSeries(list[0].series_id, 0, true, false);
    }).catch(() => { if (!cancelled) showToast('Làm mới kho phim thất bại, vui lòng mở lại bảng danh sách phim'); });
    return () => { cancelled = true; };
  }, [active, pickerOpen, loadSeriesList, switchSeries, showToast]);

  useEffect(() => {
    const pending = pendingTargetRef.current;
    if (loading || !pending || pending.seriesId !== String(activeSeriesId) || String(detail?.series_id) !== pending.seriesId) return;
    pendingTargetRef.current = null;
    startOnlinePlay(pending.vidIndex, pending.seekTo, false, pending.autoplay);
  }, [loading, detail, activeSeriesId, startOnlinePlay]);

  // Xóa một bộ phim ngắn khỏi danh sách (chỉ hủy đăng ký, không xóa tệp cục bộ)
  const removeSeries = async (sid, title) => {
    const res = await window.electronAPI.forgetSeries(sid).catch(error => ({ success: false, error: error.message }));
    if (!res || !res.success) {
      showToast((res && res.error) || 'Xóa thất bại');
      return;
    }
    showToast(`Đã xóa vĩnh viễn bản ghi của 《${title}》 trong kho phim (tệp cục bộ được giữ lại)`);
    const list = await loadSeriesList();
    refreshCacheInfo();
    if (String(sid) === String(activeSeriesId)) {
      const next = list[0];
      if (next) await switchSeries(next.series_id, 0, true, false);
      else {
        selectionVersion.current++;
        selectedSeriesRef.current = '';
        resetPlayback();
        setActiveSeriesId('');
        setDetail(null);
      }
    }
  };

  const clearCache = async () => {
    releasePrefetch();
    if (onlineRequestRef.current && !compatMap[currentIndex]) {
      stopPlayback('Phát trực tuyến đã dừng, có thể thử lại tập này để tiếp tục xem');
    }
    try {
      const r = await window.electronAPI.clearOnlineCache();
      if (!r?.success) { showToast(r?.error || 'Xóa bộ nhớ đệm phát thất bại'); return; }
      refreshCacheInfo();
      showToast('Đã xóa sạch bộ nhớ đệm phát trực tuyến');
    } catch (e) { showToast('Xóa bộ nhớ đệm phát thất bại: ' + e.message); }
  };

  const downloadEpisode = async (vidIndex) => {
    if (qualityLoading || !episodes.some((ep) => ep.vid_index === vidIndex && !ep.locked)) return;
    const selection = selectionVersion.current;
    const media = mediaVersion.current;
    const navigation = navigationVersion.current;
    try {
      const res = await window.electronAPI.downloadSingleEpisode(activeSeriesId, vidIndex, downloadQuality);
      if (res && res.success) {
        showToast(res.count > 0 ? `Tập ${vidIndex} đã được thêm vào hàng đợi tải` : `Tập ${vidIndex} đã có trong hàng đợi`);
        if (activeRef.current && navigation === navigationVersion.current && selection === selectionVersion.current && media === mediaVersion.current
          && String(activeSeriesId) === selectedSeriesRef.current && stateRef.current.currentIndex === vidIndex) setWaitingFor(vidIndex);
      } else {
        showToast((res && res.error) || 'Thêm vào tải về thất bại');
      }
    } catch (error) { showToast(error.message || 'Thêm vào tải về thất bại, vui lòng thử lại'); }
  };

  const downloadMissing = async (nextCount = null) => {
    if (qualityLoading || (nextCount !== null && !current)) return;
    const missing = episodes.filter((e) => !e.locked && e.status !== 'completed'
      && (nextCount === null || (e.vid_index > current.vid_index && e.vid_index <= current.vid_index + nextCount)));
    if (!missing.length) {
      showToast(nextCount === null ? 'Tất cả các tập có thể tải đã được tải xong' : 'Không có tập nào cần tải trong phạm vi đã chọn');
      return;
    }
    let ok = 0;
    let firstError = '';
    for (const ep of missing) {
      try {
        const r = await window.electronAPI.downloadSingleEpisode(activeSeriesId, ep.vid_index, downloadQuality);
        if (r?.success) ok++;
        else if (!firstError) firstError = r?.error || 'Thêm vào tải về thất bại';
      } catch (error) { if (!firstError) firstError = error.message || 'Thêm vào tải về thất bại'; }
    }
    showToast(firstError ? `${ok} tập gửi thành công, ${missing.length - ok} tập thất bại: ${firstError}` : `Đã thêm ${ok} tập vào hàng đợi tải`);
  };

  // Ghép nối một chạm cho bộ phim hiện tại (bật chọn định dạng)
  const openMergeDialog = () => {
    mergeDialogGenerationRef.current += 1;
    setMergeError('');
    setMergeAsk(true);
  };

  const closeMergeDialog = () => {
    mergeDialogGenerationRef.current += 1;
    setMergeError('');
    setMergeAsk(false);
  };

  const mergeThisSeries = async (compatible, require1080 = false) => {
    if (mergeRequestRef.current) return;
    mergeRequestRef.current = true;
    const dialogGeneration = mergeDialogGenerationRef.current;
    setMerging(true);
    setMergeError('');
    try {
      const options = require1080 ? { compatible: false, require1080: true } : { compatible };
      const res = await window.electronAPI.mergeSeries(activeSeriesId, '', options);
      if (dialogGeneration !== mergeDialogGenerationRef.current) return;
      if (!res || !res.success) {
        setMergeError((res && res.error) || 'Ghép tệp thất bại');
        return;
      }
      closeMergeDialog();
      const tip = compatible
        ? `Bắt đầu ghép định dạng tương thích ${res.count} tập (H.264, mất nhiều thời gian hơn)`
        : require1080
        ? `Bắt đầu ghép độ phân giải chất lượng cao ${res.count} tập`
        : `Bắt đầu ghép ${res.count} tập, khoảng ${(res.totalBytes / 1073741824).toFixed(2)} GB`;
      showToast(`${tip}, có thể theo dõi tiến độ trong 「Quản lý tải về」`);
      if (res.codecWarning) showToast(res.codecWarning);
    } catch (e) {
      if (dialogGeneration === mergeDialogGenerationRef.current) setMergeError('Lỗi ghép tệp: ' + e.message);
    } finally {
      mergeRequestRef.current = false;
      setMerging(false);
    }
  };

  useDialogKeyboard(active && !!(confirmAsk || mergeAsk), () => { setConfirmAsk(null); closeMergeDialog(); }, '.player-confirm');

  useEffect(() => {
    if (actionsHidden || !active || !portrait) {
      setEpisodesOpen(false);
    }
    if (actionsHidden || !active) setPickerOpen(false);
  }, [actionsHidden, active, portrait]);

  useEffect(() => {
    window.electronAPI.setEpisodePanelOpen?.(active && portrait && episodesOpen && !loading).catch(() => {
      setEpisodesOpen(false);
      showToast('Không thể mở rộng danh sách tập, vui lòng thử lại');
    });
  }, [active, portrait, episodesOpen, loading, showToast]);
  useEffect(() => () => { window.electronAPI.setEpisodePanelOpen?.(false).catch(() => {}); }, []);

  // ===== Render =====
  if (loading) {
    return <div className="player-container"><div className="player-empty">Đang tải…</div></div>;
  }

  if (!detail && detailError) {
    return (
      <div className="player-container">
        <div className="player-empty" role="alert">
          <p>Tải phim thất bại: {detailError}</p>
          <button className="btn btn-primary" onClick={() => switchSeries(activeSeriesId,
            String(target?.seriesId) === activeSeriesId ? target.vidIndex : 0,
            String(target?.seriesId) === activeSeriesId && !!target.resume)}>
            <RefreshCw size={16} /> Thử tải lại
          </button>
        </div>
      </div>
    );
  }

  if (!seriesList.length) {
    return (
      <div className="player-container">
        <div className="player-header">
          <div className="player-title"><Play size={22} /><h2>Kho phim của tôi</h2></div>
        </div>
        <div className="player-empty">
          <Film size={40} />
          <p>Chưa có phim ngắn nào để phát</p>
          <p className="player-empty-sub">Hãy khám phá hoặc tìm kiếm một bộ phim ngắn trước, rồi chọn tập, xem và quản lý tại đây.</p>
          <div className="player-empty-actions">
            {onNavigate && (
              <button className="btn btn-primary" onClick={() => onNavigate('browse')}>
                Khám phá phim ngắn
              </button>
            )}
            {onNavigate && (
              <button className="btn btn-outline" onClick={() => onNavigate('download')}>
                Tìm kiếm phim
              </button>
            )}
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className={`player-container ${episodesOpen ? '' : 'episodes-collapsed'}`}>
      {/* Chọn phim: Phim hiện tại + Bảng quản lý thả xuống (thay thế thanh ngang trước đây ngày càng dài) */}
      <div className="player-series-row" hidden={actionsHidden}>
        <div className="player-series-current">
          <span className="player-series-name" title={detail ? detail.series_title : ''}>
            {detail ? detail.series_title : '—'}
          </span>
          <span className="player-stat">Đã tải {playableCount} / {episodes.length || 0} tập</span>
        </div>
      </div>

      <div className="player-online-quality-row" hidden={actionsHidden}>
          <label className="player-download-quality">
            <span>Độ phân giải phát trực tuyến</span>
            <select className="input-field" aria-label="Độ phân giải phát trực tuyến" value={onlineQuality}
              disabled={!supportsOnlineQuality} title="Tự động ưu tiên 1080P; máy tính cũ ưu tiên nguồn H.264, chuyển mã trước khi cần; độ phân giải chỉ định thủ công sẽ giữ cố định."

              onChange={event => changeOnlineQuality(event.target.value)}>
              <option value="auto">{supportsOnlineQuality ? 'Tự động (Ưu tiên 1080P)' : 'Do nguồn phim quyết định'}</option>
              <option value="compat">Máy tính cũ (Ưu tiên H.264)</option>
              <option value="720p">720P</option>
              <option value="1080p">1080P</option>
            </select>
          </label>
      </div>

      <div className="player-header" hidden={actionsHidden}>
        <div className="player-header-right">
          <button aria-pressed={cacheNext} className={`btn btn-outline ${cacheNext ? 'btn-autonext-on' : ''}`}
            disabled={qualityLoading || playbackSettingSaving}
            onClick={() => savePlaybackSetting('cache_next_episode', !cacheNext, setCacheNext)}
            style={{ whiteSpace: 'nowrap' }}
            title="Sau khi bắt đầu phát, lưu trước tối đa 2 tập tiếp theo để giảm thời gian chờ khi chuyển tập; sẽ tiêu tốn dung lượng mạng">
            <Download size={15} />Lưu đệm 2 tập kế tiếp {cacheNext ? 'Bật' : 'Tắt'}
          </button>
          <button
            aria-pressed={autoNext}
            className={`btn btn-outline ${autoNext ? 'btn-autonext-on' : ''}`}
            onClick={() => setAutoNext(!autoNext)}
            title={`Tự động phát tập tiếp theo khi hết tập (${formatShortcut(shortcuts.autoNext)})`}
          >
            <Layers size={15} />
            Phát liên tục {autoNext ? 'Bật' : 'Tắt'}
          </button>
          <button aria-pressed={autoCompat} className={`btn btn-outline ${autoCompat ? 'btn-autonext-on' : ''}`}
            disabled={qualityLoading || playbackSettingSaving}
            onClick={() => savePlaybackSetting('compat_mode', !autoCompat, setAutoCompat)}
            title="Tự động chuyển mã sang H.264 khi không thể giải mã">
            <Zap size={15} />Chế độ tương thích {autoCompat ? 'Bật' : 'Tắt'}
          </button>
          <button aria-pressed={autoDelete} className={`btn btn-outline ${autoDelete ? 'btn-autonext-on' : ''}`}
            disabled={qualityLoading || playbackSettingSaving}
            title="Xóa tệp tải về và bộ nhớ đệm phát của tập đó sau khi xem xong; cần xác nhận trước khi bật"
            onClick={() => autoDelete ? savePlaybackSetting('auto_delete_watched', false, setAutoDelete) : setConfirmAsk({
              title: 'Bật tự động xóa sau khi xem',
              message: 'Sau khi xem xong một tập, video đã tải, bộ nhớ đệm phát trực tuyến và bộ nhớ đệm chuyển mã của tập đó sẽ bị xóa vĩnh viễn. Có thể tải lại khi cần.',
              okText: 'Bật tự động xóa', danger: true,
              onOk: () => savePlaybackSetting('auto_delete_watched', true, setAutoDelete),
            })}>
            <Trash2 size={15} />Tự xóa khi xem xong {autoDelete ? 'Bật' : 'Tắt'}
          </button>
        <div className="player-series-actions">
        <button
          aria-expanded={pickerOpen}
          className={`btn btn-outline series-picker-btn ${pickerOpen ? 'open' : ''}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          Đổi phim
          <span className="series-count">{seriesList.length}</span>
          <ChevronDown size={15} />
        </button>
          <button className="btn btn-outline player-download-jump" aria-controls="player-management"
            onClick={() => {
              if (portrait) setEpisodesOpen(true);
              requestAnimationFrame(() => downloadToolsRef.current?.scrollIntoView({
                behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'instant' : 'smooth', block: 'center',
              }));
            }}><Download size={15} />Quản lý tải về</button>
        </div>
        </div>
      </div>

      {pickerOpen && !actionsHidden && (
        <div className="series-picker">
          <div className="series-picker-head">
            <input
              type="text"
              className="input-field"
              aria-label="Tìm kiếm trong kho phim của tôi"
              placeholder="Tìm tên phim…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <button className="icon-btn" title="Đóng" onClick={() => setPickerOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="series-picker-list">
            {seriesList.length === 0 && <div className="series-picker-empty">Chưa có phim nào</div>}
            {seriesList
              .filter((s) => !pickerQuery.trim() || (s.series_title || '').includes(pickerQuery.trim()))
              .map((s) => {
                const isActive = String(s.series_id) === String(activeSeriesId);
                const dl = downloadedMap[String(s.series_id)];
                return (
                  <div
                    key={s.series_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Chọn phim ${s.series_title}`}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || !['Enter', ' '].includes(e.key)) return;
                      e.preventDefault();
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                    className={`series-row ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                  >
                    <div className="series-row-cover">
                      {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <Film size={14} />}
                    </div>
                    <div className="series-row-body">
                      <div className="series-row-title">{s.series_title}</div>
                      <div className="series-row-sub">
                        {dl && dl.completed > 0 ? `Đã tải ${dl.completed}/${dl.total} tập` : `Tổng ${(s.episodes || []).length} tập · Chưa tải`}
                      </div>
                    </div>
                    {isActive && <span className="series-row-cur">Hiện tại</span>}
                    {(() => {
                      const st = storageMap[String(s.series_id)];
                      const hasFiles = st && st.files > 0;
                      return (
                        <>
                          {hasFiles && (
                            <button
                              className="icon-btn icon-btn-danger series-row-del"
                              title={`Xóa tệp cục bộ (${st.files} tệp · ${fmtSize(st.bytes)})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmAsk({
                                  title: 'Xóa tệp cục bộ',
                                  message: `Sẽ xóa ${st.files} tệp đã tải của《${s.series_title}》, giải phóng ${fmtSize(st.bytes)}.\nPhim vẫn được giữ lại trong danh sách, sau này có thể phát trực tuyến hoặc tải lại bất cứ lúc nào.`,
                                  okText: 'Xóa tệp',
                                  danger: true,
                                  onOk: async () => {
                                    if (String(s.series_id) === selectedSeriesRef.current && !onlineUrl && !compatMap[currentIndex]) stopPlayback('Phát cục bộ đã dừng, có thể kết nối lại nguồn phim để xem');
                                    await deleteDownloadedFiles(() => window.electronAPI.deleteSeriesFiles(s.series_id));
                                  },
                                });
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn series-row-del"
                            title="Xóa vĩnh viễn bản ghi kho phim (không xóa tệp cục bộ)"
                            aria-label={`Xóa vĩnh viễn bản ghi kho phim của ${s.series_title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmAsk({ title: 'Xóa vĩnh viễn bản ghi kho phim', message: `Sẽ xóa vĩnh viễn bản ghi kho phim của《${s.series_title}》, không thể tìm lại qua danh sách khôi phục. Tệp video cục bộ sẽ không bị xóa; sau này có thể tìm kiếm để thêm lại.`, okText: 'Xóa vĩnh viễn', danger: true, onOk: () => removeSeries(s.series_id, s.series_title) });
                            }}
                          >
                            <X size={15} />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
          </div>

          <div className="series-picker-foot">
            {storageTotal.files > 0 && (
              <span className="series-picker-usage">
                Cục bộ đã chiếm <b>{fmtSize(storageTotal.bytes)}</b> / {storageTotal.files} tệp
              </span>
            )}
            {storageTotal.files > 0 && (
              <button
                className="btn btn-outline btn-sm btn-danger-text"
                title="Xóa tất cả các tệp cục bộ đã tải về"
                onClick={() => {
                  setConfirmAsk({
                    title: 'Xóa tất cả tệp cục bộ',
                    message: `Sẽ xóa tất cả các tệp tập phim đã tải (bao gồm cả video của phim đã xóa khỏi kho nhưng còn lưu tệp), tổng cộng ${storageTotal.files} tệp, ${fmtSize(storageTotal.bytes)}.\nDanh sách phim và thông tin tập sẽ được giữ lại, sau này vẫn có thể phát trực tuyến hoặc tải lại.`,
                    okText: 'Xóa toàn bộ',
                    danger: true,
                    onOk: async () => {
                      if (current?.fileUrl && !onlineUrl && !compatMap[currentIndex]) stopPlayback('Phát cục bộ đã dừng, có thể kết nối lại nguồn phim để xem');
                      await deleteDownloadedFiles(() => window.electronAPI.deleteAllDownloaded());
                    },
                  });
                }}
              >
                Xóa toàn bộ đã tải
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={clearCache} title="Giải phóng bộ nhớ do phát trực tuyến chiếm dụng">
              <Zap size={14} />
              Xóa bộ nhớ đệm phát{cacheInfo.count > 0 ? ` (${cacheInfo.count})` : ''}
            </button>
            {compatCache.files > 0 && (
              <button className="btn btn-outline btn-sm" onClick={clearCompatCache} title="Xóa các tệp định dạng tương thích do chuyển mã tạo ra">
                <Trash2 size={14} />
                Xóa bộ nhớ đệm chuyển mã ({fmtSize(compatCache.bytes)})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="player-viewing-layout">
      {/* Khu vực phát */}
      <div className="player-floating-slot" ref={floatingPlayer.attachSlot}>
        {floatingPlayer.floating && <div className="player-floating-placeholder" role="status">
          <p>Đang phát《{detail?.series_title}》trong cửa sổ nổi</p>
          <button className="btn btn-outline" onClick={floatingPlayer.toggle}>Trở về cửa sổ chính</button>
        </div>}
      </div>
      {createPortal(
      <div className={`player-stage ${windowFill ? 'player-window-fill' : ''}`} data-picture-mode={pictureMode} ref={stageRef}>
          {rateNotice !== null && <div className="player-rate-notice" role="status" aria-live="polite">{rateNotice}×</div>}
          <video
            ref={videoRef}
            crossOrigin="anonymous"
            src={videoSrc || undefined}
            className="player-video"
            aria-busy={!canPlay || mediaBuffering}
            tabIndex={0}
            aria-label={`Màn hình video, ${formatShortcut(shortcuts.play)} phát hoặc tạm dừng`}
            onClick={() => {
              const video = videoRef.current;
              if (!canPlay || !video) return;
              video.focus({ preventScroll: true });
              if (video.paused) video.play().catch(() => showToast('Tạm thời không thể phát, vui lòng thử lại tập này'));
              else video.pause();
            }}
            onLoadedMetadata={handleMetadata}
            onTimeUpdate={prepareNextEpisode}
            onPlay={(event) => {
              const media = loadedMediaRef.current;
              if (bossHiddenRef.current || !activeRef.current || !canPlay || playbackVersion !== mediaVersion.current || !media || media.version !== mediaVersion.current || media.element !== event.currentTarget) {
                event.currentTarget.pause();
                return;
              }
            }}
            onRateChange={(event) => {
              const v = event.currentTarget;
              if (!canPlay || v !== videoRef.current || v.readyState === 0 || loadedMediaRef.current?.version !== mediaVersion.current) return;
              if (v.currentSrc && v.currentSrc !== videoSrc) return;
              if (v.playbackRate !== playbackRateRef.current) changePlaybackRate(v.playbackRate);
            }}
            onEnded={() => { if (activeRef.current && canPlay && playbackVersion === mediaVersion.current && (!videoRef.current || loadedMediaRef.current?.version === mediaVersion.current)) handleEnded(); }}
            onPause={() => persistPosition(true)}
            onPlaying={(event) => { handlePlaying(event); prepareNextEpisode(event); }}
            onWaiting={() => { if (canPlay && playbackVersion === mediaVersion.current) setMediaBuffering(true); }}
            onCanPlay={() => { if (canPlay && playbackVersion === mediaVersion.current) setMediaBuffering(false); }}
            onError={(event) => {
              if (!canPlay || compatRequestRef.current || playbackVersion !== mediaVersion.current) return;
              if (videoRef.current && event.currentTarget !== videoRef.current) return;
              if (event.currentTarget.currentSrc && event.currentTarget.currentSrc !== videoSrc) return;
              const errorCode = event.currentTarget.error?.code;
              // Chromium also reports an unavailable HTTP stream as unsupported source (4).
              const unavailableOnline = errorCode === 4 && videoSrc === onlineUrl;
              if (unavailableOnline && reconnectOnce()) return;
              const failedDecode = [3, 4].includes(errorCode);
              if (isOnlinePlaying && failedDecode && onlineQuality === 'auto' && !autoCompat && reconnectOnce()) return;
              if (!failedDecode && errorCode === 2 && reconnectOnce()) return;
              if (isOnlinePlaying && (errorCode === 2 || unavailableOnline)) {
                recoverOnlineFailure(current, 'Phát trực tuyến thất bại, đang thử tệp cục bộ hoặc tải về');
                return;
              }
              if (!failedDecode) {
                const seekTo = currentPosition(); resetPlayback(); pendingSeekRef.current = seekTo;
                setPlaybackError('Tải video thất bại, vui lòng thử lại tập này hoặc kiểm tra mạng');
              }
              setMediaBuffering(false);
              setDecodeFailed(failedDecode);
              showToast(failedDecode ? 'Nguồn phim tạm thời không thể phát, vui lòng kết nối lại nguồn phim trước' : 'Tải video thất bại, vui lòng thử lại tập này hoặc kiểm tra mạng');
              if (failedDecode && !unavailableOnline) tryAutoCompat(currentIndex);
            }}
          />
        <VideoEnhancement videoRef={videoRef} source={videoSrc} available={visualActive} enhancement={enhancement} />
        {danmakuSource === 'official'
          ? <OfficialDanmaku videoRef={videoRef} source={videoSrc} available={visualActive} danmaku={danmaku} />
          : <CommentDanmaku videoRef={videoRef} source={videoSrc} available={visualActive} danmaku={danmaku} />}
      <PlayerControls floating={floatingPlayer.floating || nativePictureInPicture} onToggleFloating={async () => {
          if (document.querySelector('.stealth-mode')) throw new Error('Vui lòng thoát chế độ cửa sổ nhỏ trước');
          const video = videoRef.current;
          if (floatingPlayer.floating) { floatingPlayer.toggle(); return; }
          if (document.pictureInPictureElement === video) { await document.exitPictureInPicture(); return; }
          const settings = await window.electronAPI.getSettings();
          if (settings?.picture_in_picture_mode === 'native') {
            if (!document.pictureInPictureEnabled || !video?.requestPictureInPicture) throw new Error('Hệ thống hiện tại không hỗ trợ Picture-in-Picture gốc');
            await video.requestPictureInPicture();
            return;
          }
          const owner = stageRef.current?.ownerDocument || document;
          if (owner.fullscreenElement) await owner.exitFullscreen();
          floatingPlayer.toggle();
        }} onOpenSettings={onNavigate ? () => onNavigate('settings') : undefined} danmaku={showDanmakuControls ? danmaku : null} enhancement={enhancement} continuing={autoAdvancing && !playbackError && !decodeFailed} autoContinue={autoNext && !!findNext(currentIndex)} shortcuts={shortcuts} onToggleFullscreen={toggleFullscreen} portrait={portrait} windowFill={windowFill} onWindowFill={setWindowFill} videoRef={videoRef} stageRef={stageRef} source={videoSrc} available={canPlay}
          seriesTitle={detail?.series_title} episodes={episodes} currentIndex={currentIndex} onEpisodeChange={goToEpisode}
          onlineQuality={onlineQuality} supportsOnlineQuality={supportsOnlineQuality} onQualityChange={changeOnlineQuality}
          pictureMode={pictureMode} onPictureModeChange={changePictureMode} rate={playbackRate} onRateChange={changePlaybackRate} onError={showToast} />
        {!canPlay && (
          <div className="player-placeholder" style={{ position: 'absolute', inset: 0 }}>
            {playbackError ? (
              <><Film size={34} /><p role="alert">{playbackError}</p><div className="player-placeholder-actions">
                <button className="btn btn-primary" onClick={retryPlayback}>{current?.status === 'completed' ? 'Thử lại tập này' : 'Thử lại tập này (Phát trực tuyến)'}</button>
                {current?.vid && <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>Kết nối lại nguồn phim</button>}
                {current?.vid && !current.locked && !fallbackRef.current?.submitting && <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>Phát sau khi chuyển mã</button>}
              </div></>
            ) : onlineProgress && onlineProgress.vid && (!current || current.vid === onlineProgress.vid) ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>{onlineProgress.phase === 'preparing' ? 'Đang kết nối nguồn phim…' : onlineProgress.phase === 'decrypting' ? 'Đang chuẩn bị phát…' : 'Đang tải đệm phát trực tuyến…'}</p>
                {onlineProgress.phase !== 'preparing' && <div className="player-wait-bar">
                  <div className="player-wait-fill" style={{ width: `${onlineProgress.percent || 0}%` }} />
                </div>}
                <span className="player-placeholder-sub">
                  {onlineProgress.phase === 'preparing' ? 'Lấy địa chỉ phát' : `${onlineProgress.percent || 0}%`}
                  {onlineProgress.total ? ` · ${(onlineProgress.received / 1048576).toFixed(1)} / ${(onlineProgress.total / 1048576).toFixed(1)} MB` : ''}
                  {' · Không ghi vào thư mục tải về'}
                </span>
                <button className="btn btn-outline" onClick={() => stopPlayback()}>Hủy phát</button>
              </>
            ) : waitingFor != null ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>Tập {waitingFor} đang tải, tự động phát sau khi hoàn thành…</p>
                {(() => {
                  const ep = episodes.find((e) => e.vid_index === waitingFor);
                  return ep && ep.status === 'downloading' ? (
                    <div className="player-wait-bar">
                      <div className="player-wait-fill" style={{ width: `${ep.progress || 0}%` }} />
                    </div>
                  ) : null;
                })()}
                <span className="player-placeholder-sub">Tiếp tục tập này sau khi tải xong; hủy chờ sẽ không dừng tải</span>
                <button className="btn btn-outline" onClick={() => stopPlayback('Đã hủy chờ, việc tải sẽ tiếp tục; có thể xem trong Quản lý tải về')}>Hủy chờ</button>
              </>
            ) : current?.locked || (episodes.length > 0 && episodes.every((ep) => ep.locked)) ? (
              <><Film size={34} /><p>Cần mở khóa trên nền tảng nguồn để xem</p><span className="player-placeholder-sub">Ứng dụng này không cung cấp mở khóa</span></>
            ) : !playbackRequested && current ? (
              <><Film size={34} /><p>Tập {current.vid_index} · Đang chờ phát</p>
                <button className="btn btn-primary" onClick={() => goToEpisode(current.vid_index, pendingSeekRef.current)}>
                  <Play size={15} />Phát tập này
                </button>
                <span className="player-placeholder-sub">Nhấn để tiếp tục xem, hoặc chọn các tập khác</span>
              </>
            ) : current ? (
              <>
                <Film size={34} />
                <p>
                  Tập {current.vid_index} {current.status === 'downloading' ? '· Đang tải' : current.status === 'pending' ? '· Đang xếp hàng' : '· Chưa tải'}
                </p>
                {current.status === 'downloading' && (
                  <div className="player-wait-bar">
                    <div className="player-wait-fill" style={{ width: `${current.progress || 0}%` }} />
                  </div>
                )}
                <div className="player-placeholder-actions">
                  <button className="btn btn-primary" onClick={() => startOnlinePlay(current.vid_index)}>
                    <Play size={15} />
                    Phát trực tuyến (không tải)
                  </button>
                  <button className="btn btn-outline" disabled={qualityLoading} onClick={() => downloadEpisode(current.vid_index)}>
                    <Download size={15} />
                    Tải tập này
                  </button>
                </div>
                <span className="player-placeholder-sub">Phát trực tuyến không lưu vào thư mục tải về, tệp tạm tạo ra khi chuẩn bị sẽ tự động được dọn dẹp</span>
              </>
            ) : (
              <>
                <Film size={34} />
                <p>Vui lòng chọn một tập để bắt đầu phát</p>
              </>
            )}
          </div>
        )}

        {canPlay && mediaBuffering && !compatProgress && (
          <div className="compat-overlay" role="status">
            <RefreshCw size={26} className="spin" /><p>Đang tải video…</p>
            <button className="btn btn-outline" onClick={() => stopPlayback()}>Hủy phát</button>
          </div>
        )}

        {/* Lớp phủ chế độ tương thích: Thông báo lỗi giải mã / Tiến độ chuyển mã */}
        {compatProgress && compatProgress.vidIndex === currentIndex && (
          <div className="compat-overlay">
            <RefreshCw size={26} className="spin" />
            <p>Đang chuyển mã sang định dạng tương thích (H.264)…</p>
            <div className="player-wait-bar">
              <div className="player-wait-fill" style={{ width: `${compatProgress.percent || 0}%` }} />
            </div>
            <span className="compat-overlay-sub">
              {compatProgress.percent || 0}% · Đang xử lý video hiện tại, sau khi hoàn tất sẽ chuyển sang nguồn tương thích
            </span>
            <button className="btn btn-outline" onClick={() => stopPlayback('Đã hủy chuyển mã, có thể thử lại tập này để tiếp tục xem')}>Hủy chuyển mã</button>
          </div>
        )}

        {!compatProgress && decodeFailed && canPlay && (
          <div className="compat-overlay">
            <Film size={30} />
            <p>Nguồn phim hiện tại tạm thời không thể phát</p>
            <span className="compat-overlay-sub" role={compatError ? 'alert' : undefined}>
              {compatError || 'Vui lòng kết nối lại nguồn phim trước; nếu vẫn gặp vấn đề về hình ảnh hoặc định dạng, có thể thử chuyển mã sang định dạng tương thích H.264.'}
            </span>
            <div className="player-placeholder-actions">
              <button className="btn btn-primary" onClick={retryPlayback}>Thử lại tập này</button>
              <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>Kết nối lại nguồn phim</button>
              <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>
                <Zap size={15} />
                Phát lại sau khi chuyển mã
              </button>
              <button className="btn btn-outline" onClick={() => onNavigate?.('settings')}>
                Cài đặt phát
              </button>
            </div>
          </div>
        )}
      </div>, floatingPlayer.host)}

      <section className="player-episode-panel" id="player-episode-panel" aria-label="Danh sách tập">
      <h3 className="portrait-episode-heading">Danh sách tập</h3>
      {/* Thông tin tập đang phát */}
      {current && (
        <div className="player-now">
          <span className="player-now-title">
            《{detail ? detail.series_title : ''}》Tập {current.vid_index}
          </span>
          {current.title && <span className="player-now-sub">{current.title}</span>}
          <span className={`player-now-status status-${current.status}`}>
            {current.locked ? 'Đã khóa' : current.status === 'completed' ? 'Có thể phát' : current.status === 'downloading' ? `Đang tải ${current.progress || 0}%` : current.status === 'pending' ? 'Đang xếp hàng' : 'Chưa tải'}
          </span>
        </div>
      )}

      {detail?.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
        <p className="player-tips">Trang web đánh dấu {detail.web_accessible_episodes} tập đầu có thể truy cập; khi chỉ có bản xem trước hoặc không có nguồn đầy đủ, tự động thử nguồn App.</p>
      )}

      {episodes.some((ep) => ep.locked) && <p className="player-tips">Các tập bị khóa cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa; phát liên tục sẽ bỏ qua các tập bị khóa.</p>}

      {/* Danh sách tập */}
      <div className="player-episodes">
        {episodes.map((ep) => {
          const isCurrent = ep.vid_index === currentIndex;
          return (
            <button
              key={ep.vid_index}
              disabled={ep.locked === true}
              aria-label={`Tập ${ep.vid_index}`}
              aria-pressed={isCurrent}
              className={`ep-chip ep-${ep.status} ${isCurrent ? 'ep-current' : ''}`}
              onClick={() => goToEpisode(ep.vid_index)}
              title={
                ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : ep.status === 'completed'
                  ? 'Nhấn để phát (cục bộ)'
                  : ep.status === 'downloading' || ep.status === 'pending'
                  ? 'Tiếp tục tải, nhấn để phát trực tuyến'
                  : 'Nhấn để phát trực tuyến (không tải) · Nhấp đúp để thêm vào tải về'
              }
              onDoubleClick={() => ep.status !== 'completed' && downloadEpisode(ep.vid_index)}
            >
              <span className="ep-num">{ep.vid_index}</span>{ep.locked && <span className="ep-lock-label">Đã khóa</span>}
              {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
              {ep.status === 'downloading' && (
                <span className="ep-progress" style={{ width: `${ep.progress || 0}%` }} />
              )}
              {onlineVid === ep.vid && <span className="ep-online-dot" />}
            </button>
          );
        })}
      </div>

      <div className="player-tips">
        Phím tắt: {SHORTCUT_ACTIONS.map(action => `${formatShortcut(shortcuts[action.id])} ${action.label}`).join(' · ')}. Có thể đổi trong cài đặt.
        <br />
        <b>Nhấn một lần vào tập màu xám chưa khóa để phát trực tuyến ngay</b> (không lưu vào thư mục tải về); nhấp đúp mới thêm vào hàng đợi tải.
        Khi phát liên tục gặp tập chưa tải sẽ tự động chuyển sang phát trực tuyến.
      </div>

      <div className="player-management" id="player-management" ref={downloadToolsRef} hidden={actionsHidden}>
        <h3 id="player-download-heading">Độ phân giải tải về</h3>
        <div className="player-management-actions">
            <select className="input-field" aria-labelledby="player-download-heading" value={downloadQuality} disabled={qualityLoading}
              title="Tải thủ công và hạ cấp tải về tự động sẽ sử dụng mục này. Khi độ phân giải đã chọn của nguồn Hồng Quả không khả dụng hoặc tải thất bại, tự động thử độ phân giải thấp hơn và thông báo trong quản lý tải về; các tệp đã có được giữ nguyên."

              onChange={(event) => setDownloadQuality(event.target.value)}>
              <option value="auto">Tự động (Ưu tiên tương thích)</option>
              <option value="1080p">1080P</option>
              <option value="720p">720P</option>
            </select>
          <button className="btn btn-outline" onClick={() => downloadMissing()} disabled={qualityLoading}>
            <Download size={15} />
            Tải các tập chưa hoàn thành
          </button>
          <button
            className="btn btn-primary"
            onClick={openMergeDialog}
            disabled={merging || playableCount === 0}
            title="Ghép các tập đã tải thành một tệp mp4 duy nhất, tiện xem một lần"
          >
            <Layers size={15} />
            {merging ? 'Đang gửi...' : 'Ghép & xuất toàn bộ'}
          </button>
          <button className="btn btn-outline" onClick={() => downloadEpisode(current.vid_index)}
            disabled={qualityLoading || !current || current.locked || current.status === 'completed'}>
            <Download size={15} />Tải tập này
          </button>
          {[5, 10].map(count => (
            <button key={count} className="btn btn-outline" onClick={() => downloadMissing(count)}
              disabled={qualityLoading || !current || !episodes.some(ep => ep.vid_index > current.vid_index)}
              title={`Bắt đầu từ tập tiếp theo của tập hiện tại, tải tối đa ${count} tập; bỏ qua các tập đã hoàn thành và bị khóa`}>
              <Download size={15} />Tải {count} tập tiếp theo
            </button>
          ))}
        </div>
      </div>

      </section>
      </div>

      <div className="player-footer" hidden={actionsHidden}>
        {/^[0-9]{6,30}$/.test(String(activeSeriesId)) ? (
          <CommunityPanel seriesId={activeSeriesId} episodeId={current?.vid} title={detail?.series_title || ''} cover={detail?.cover || ''}
            trailingAction={<NasDownload seriesId={activeSeriesId} quality={downloadQuality} disabled={qualityLoading} />}>
            <SequelFinder seriesId={activeSeriesId} active={active && !actionsHidden} />
          </CommunityPanel>
        ) : <div className="player-footer-tools">
          <SequelFinder seriesId={activeSeriesId} active={active && !actionsHidden} />
          <NasDownload seriesId={activeSeriesId} quality={downloadQuality} disabled={qualityLoading} />
        </div>}
      </div>
      {toast && <div className="dm-toast dm-toast-success" onClick={() => setToast(null)}>{toast}</div>}

      {/* Chọn định dạng ghép nối */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={closeMergeDialog}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Ghép & xuất'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Ghép & xuất toàn bộ
            </div>
            <div className="player-confirm-msg">
              <p>Ghép {playableCount} tập đã tải của《{detail ? detail.series_title : ''}》thành một tệp mp4. Các tập chưa tải sẽ không tự động bổ sung.</p>
              <p><b>Ghép độ phân giải chất lượng cao</b>: Kiểm tra từng tệp thực tế, tất cả phải đạt 1080P mới có thể bắt đầu; nếu có tập chất lượng thấp vui lòng chọn ghép nhanh hoặc ghép tương thích.</p>
              <p><b>Ghép nhanh</b>: Ưu tiên nối không nén (lossless), giữ nguyên độ phân giải từng đoạn, một số thiết bị có thể không tương thích.</p>
              <p><b>Ghép tương thích</b>: Chuyển sang H.264/AAC khi cần, vẫn giữ nguyên độ phân giải từng đoạn, xử lý chậm hơn.</p>
              <p>Cả ba cách đều giữ nguyên tệp gốc, chỉ ghép các tập đã tải, không tự động bổ sung và không biến chất lượng thấp thành độ nét cao thật.</p>
              {mergeError && <p className="alert-error" role="alert">{mergeError}</p>}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => mergeThisSeries(false, true)} disabled={merging}>
                Ghép độ phân giải chất lượng cao
              </button>
              <button className="btn btn-outline" onClick={closeMergeDialog}>Hủy</button>
              <button className="btn btn-outline" onClick={() => mergeThisSeries(true)} disabled={merging}>
                Ghép tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => mergeThisSeries(false)} disabled={merging}>
                Ghép nhanh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa */}
      {confirmAsk && (        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Xác nhận'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              {String(confirmAsk.message).split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  setConfirmAsk(null);
                  await fn();
                }}
              >
                {confirmAsk.okText || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Player;
