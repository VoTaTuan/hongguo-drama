import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './DownloadManager.css';
import { Download, Trash2, RefreshCw, X, Film, Square, Folder, Zap, CheckSquare, Play, Pause, Layers, ChevronDown, ChevronUp } from './icons';
import { DownloadTaskTitle, DramaTitle } from './TranslatedText';
import { getCachedTranslation } from '../services/translator';

const TaskTitleComponent = typeof DownloadTaskTitle === 'function' ? DownloadTaskTitle : ({ task, className }) => <div className={className}>{task?.title || task?.filename}</div>;
const DramaTitleComponent = typeof DramaTitle === 'function' ? DramaTitle : ({ children, title }) => <span>{title || children}</span>;
const safeGetCachedTranslation = typeof getCachedTranslation === 'function' ? getCachedTranslation : () => null;

const STATUS_TEXT = {
  pending: 'Đang chờ',
  downloading: 'Đang tải',
  completed: 'Đã hoàn thành',
  failed: 'Thất bại',
  stopped: 'Đã dừng',
};

const STATUS_ORDER = {
  downloading: 0,
  pending: 1,
  failed: 2,
  stopped: 3,
  completed: 4,
};

const isWaitingRetry = task => task.status === 'failed' && !!task.retryAt;
const needsManualRetry = task => task.status === 'stopped' || task.status === 'failed' && !isWaitingRetry(task);

function sortTasks(list) {
  const key = task => task.hongguoInfo?.series_id != null ? `series:${task.hongguoInfo.series_id}` : `task:${task.id}`;
  const groups = new Map();
  for (const task of list) {
    const group = groups.get(key(task)) || { rank: 99, time: 0 };
    group.rank = Math.min(group.rank, STATUS_ORDER[task.status] ?? 99);
    group.time = Math.max(group.time, task.startTime || 0);
    groups.set(key(task), group);
  }
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b), ga = groups.get(ka), gb = groups.get(kb);
    if (ka !== kb) return ga.rank - gb.rank || gb.time - ga.time || ka.localeCompare(kb, 'zh-CN', { numeric: true });
    return (Number(a.hongguoInfo?.vid_index) || 0) - (Number(b.hongguoInfo?.vid_index) || 0) || (a.startTime || 0) - (b.startTime || 0);
  });
}

function fmtElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return value < 60 ? `${value} giây` : value < 3600 ? `${Math.floor(value / 60)} phút ${value % 60} giây` : `${Math.floor(value / 3600)} giờ ${Math.floor(value % 3600 / 60)} phút`;
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}

const PAGE_SIZE = 100;

function DownloadManager({ onNavigate, active = true }) {
  const [subTab, setSubTab] = useState('downloads');
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [queue, setQueue] = useState({ active: 0, queued: 0, maxConcurrent: 3 });
  const [seriesList, setSeriesList] = useState([]);
  const [mergeSeriesId, setMergeSeriesId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeTasks, setMergeTasks] = useState([]);
  const [confirmAsk, setConfirmAsk] = useState(null); // Xác nhận xóa (có thể chọn xóa kèm tệp cục bộ)
  const [mergeAsk, setMergeAsk] = useState(false);    // Lựa chọn định dạng ghép
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('all');
  const [viewMode, setViewMode] = useState('series');
  const [collapsedSeries, setCollapsedSeries] = useState(new Set());
  const [systemStats, setSystemStats] = useState({ totalSpeed: 0, activeDownloads: 0, queuedCount: 0, freeBytes: null });
  const [orderVersion, setOrderVersion] = useState(0);
  const [loadError, setLoadError] = useState('');
  const toastTimerRef = useRef(null);
  const moreActionsRef = useRef(null);
  const mergeRequestRef = useRef(false);
  const mergeDialogGenerationRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requests = useRef({ tasks: 0, queue: 0, series: 0, merges: 0 });
  const taskIndex = useRef(new Map());
  const downloadedSeries = useRef(new Set());

  useEffect(() => {
    const menu = moreActionsRef.current;
    const close = () => { if (menu) menu.open = false; };
    if (!active) { close(); return; }
    const outside = event => { if (!menu?.contains(event.target)) close(); };
    const escape = event => {
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault(); event.stopPropagation();
      close(); menu.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', close);
    };
  }, [active]);

  const refresh = useCallback(async () => {
    const request = ++requests.current.tasks;
    try {
      const list = await window.electronAPI.getDownloadTasks();
      if (!activeRef.current || request !== requests.current.tasks) return;
      if (!Array.isArray(list)) throw new Error('Đọc tác vụ tải về thất bại, vui lòng thử lại');
      for (const task of list) if (task.status === 'completed' && task.hongguoInfo?.series_id) downloadedSeries.current.add(String(task.hongguoInfo.series_id));
      setTasks(list);
      setOrderVersion(value => value + 1);
      const ids = new Set(list.map(task => task.id));
      setSelected(previous => new Set([...previous].filter(id => ids.has(id))));
      setLoadError('');
    } catch (error) {
      if (activeRef.current && request === requests.current.tasks) setLoadError(error.message || 'Đọc tác vụ tải về thất bại, vui lòng thử lại');
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const request = ++requests.current.queue;
    try {
      const q = await window.electronAPI.getQueueStatus();
      if (q && activeRef.current && request === requests.current.queue) setQueue(q);
    } catch (_) {}
  }, []);

  const loadSystemStats = useCallback(async () => {
    try {
      const stats = await window.electronAPI.getDownloadSystemStats?.();
      if (stats && activeRef.current) setSystemStats(stats);
    } catch (_) {}
  }, []);

  const loadSeriesList = useCallback(async (verifyFiles = true) => {
    const request = ++requests.current.series;
    try {
      let list = (await window.electronAPI.getSeriesList(verifyFiles ? { downloadedOnly: true } : undefined)) || [];
      if (!activeRef.current || request !== requests.current.series) return;
      if (verifyFiles) downloadedSeries.current = new Set(list.map(series => String(series.series_id)));
      else list = list.filter(series => downloadedSeries.current.has(String(series.series_id)));
      setSeriesList(list);
      setMergeSeriesId((prev) => list.some(item => String(item.series_id) === prev) ? prev : (list[0] ? String(list[0].series_id) : ''));
    } catch (_) {}
  }, []);

  // Khi làm mới danh sách chuyển sang chọn phim khác, hộp thoại xác nhận cũ không thể tiếp tục gửi.
  useEffect(() => {
    mergeDialogGenerationRef.current += 1;
    setMergeAsk(false);
    setMergeError('');
  }, [mergeSeriesId]);

  const loadMergeTasks = useCallback(async () => {
    const request = ++requests.current.merges;
    try {
      const list = (await window.electronAPI.getMergeTasks()) || [];
      if (activeRef.current && request === requests.current.merges) setMergeTasks(list);
    } catch (_) {}
  }, []);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    loadQueue();
    loadSeriesList();
    loadMergeTasks();
    loadSystemStats();
    const patches = new Map();
    let batchTimer = null, fullRefresh = false, reorder = false, seriesDirty = false, queueDirty = false;
    const schedule = () => {
      if (batchTimer !== null) return;
      batchTimer = setTimeout(() => {
        batchTimer = null;
        if (fullRefresh) refresh();
        else if (patches.size) {
          const updates = new Map(patches);
          setTasks(previous => previous.map(task => updates.has(task.id) ? { ...task, ...updates.get(task.id) } : task));
          if (reorder) setOrderVersion(value => value + 1);
        }
        if (seriesDirty) loadSeriesList(false);
        if (queueDirty) loadQueue();
        patches.clear();
        fullRefresh = reorder = seriesDirty = queueDirty = false;
      }, 200);
    };
    const patchTask = (data, status, affectsOrder = false) => {
      if (!data?.id) return;
      patches.set(data.id, { ...patches.get(data.id), ...data, status });
      reorder ||= affectsOrder || taskIndex.current.get(data.id)?.status !== status;
      schedule();
    };
    const cleanups = [
      window.electronAPI.onDownloadProgress((data) => {
        patchTask(data, 'downloading');
      }),
      window.electronAPI.onDownloadTaskAdded(() => { fullRefresh = seriesDirty = true; schedule(); }),
      window.electronAPI.onDownloadCompleted((data) => {
        const sid = data?.hongguoInfo?.series_id ?? taskIndex.current.get(data?.id)?.hongguoInfo?.series_id;
        if (sid) downloadedSeries.current.add(String(sid));
        seriesDirty = true;
        patchTask({ ...data, progress: 100 }, 'completed', true);
      }),
      window.electronAPI.onDownloadFailed((data) => {
        patchTask(data, 'failed', true);
      }),
      window.electronAPI.onDownloadStopped((data) => {
        patchTask(data, 'stopped', true);
      }),
      window.electronAPI.onDownloadQueueChanged(() => {
        fullRefresh = queueDirty = seriesDirty = true;
        schedule();
      }),
      window.electronAPI.onMergeTaskAdded(() => loadMergeTasks()),
      window.electronAPI.onMergeProgress((data) => {
        setMergeTasks((prev) =>
          prev.map((t) => (t.id === data.id ? { ...t, ...data } : t))
        );
      }),
      window.electronAPI.onMergeCompleted((data) => {
        loadMergeTasks();
        showToast(data.storageWarning || ('Ghép hoàn tất: ' + (data.path ? data.path.split(/[\\/]/).pop() : '')), data.storageWarning ? 'error' : 'success');
      }),
      window.electronAPI.onMergeFailed((data) => {
        loadMergeTasks();
        showToast('Ghép thất bại: ' + (data.error || 'Lỗi không xác định'), 'error');
      }),
    ];
    const timer = setInterval(() => {
      loadQueue();
      refresh();
      loadMergeTasks();
      loadSystemStats();
    }, 15000);
    return () => {
      cleanups.forEach(cleanup => cleanup());
      clearInterval(timer);
      clearTimeout(batchTimer);
      for (const key of Object.keys(requests.current)) requests.current[key]++;
    };
  }, [active, refresh, loadQueue, loadSeriesList, loadMergeTasks, showToast]);

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(tasks.map((task) => task.id)));
  const allSelected = tasks.length > 0 && tasks.every((task) => selected.has(task.id));

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  /** Hiện xác nhận xóa: Mặc định chỉ xóa bản ghi, có thể chọn đồng thời xóa tệp cục bộ */
  const askDelete = (list, label) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    // Ước tính dung lượng có thể giải phóng bằng số byte đã tải (chỉ có ý nghĩa khi tác vụ hoàn thành)
    const estBytes = items.reduce((s, t) => s + (t.totalBytes || t.receivedBytes || 0), 0);
    const withFile = items.filter((t) => t.status === 'completed').length;
    setConfirmAsk({
      title: label,
      count: items.length,
      withFile,
      estBytes,
      onOk: async (deleteFiles) => {
        try {
          const ids = items.map((t) => t.id);
          const res = await window.electronAPI.deleteTasksWithFiles(ids, deleteFiles);
          await Promise.all([refresh(), loadSeriesList()]);
          if (!res?.success) {
            const progress = Number.isFinite(res?.count) && Number.isFinite(res?.freed)
              ? `Đã xóa ${res.count} bản ghi tác vụ, đã giải phóng ${fmtSize(res.freed)}; ` : '';
            throw new Error(progress + (res?.error || 'Xóa thất bại, vui lòng thử lại'));
          }
          showToast(deleteFiles
            ? `Đã xóa ${res.count} tác vụ, giải phóng ${fmtSize(res.freed)}`
            : `Đã xóa ${res.count} bản ghi tác vụ (đã giữ lại tệp trên máy)`);
        } catch (error) { showToast(error.message || 'Xóa thất bại, vui lòng thử lại', 'error'); }
      },
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    askDelete(tasks.filter((t) => selected.has(t.id)), 'Xóa các tác vụ đã chọn');
  };
  const retrySelected = async () => {
    if (selected.size === 0) return;
    const res = await window.electronAPI.retryTasks(Array.from(selected));
    setSelected(new Set());
    await refresh();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã thêm lại vào hàng đợi: ${res.count} mục` : 'Trong các mục đã chọn không có tác vụ nào có thể thử lại');
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Ghép một chạm các phim ngắn đã chọn
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

  const doMerge = async (compatible, require1080 = false) => {
    if (mergeRequestRef.current) return;
    if (!mergeSeriesId) {
      showToast('Vui lòng chọn phim ngắn cần ghép trước', 'error');
      return;
    }
    mergeRequestRef.current = true;
    const dialogGeneration = mergeDialogGenerationRef.current;
    setMerging(true);
    setMergeError('');
    try {
      const options = require1080 ? { compatible: false, require1080: true } : { compatible };
      const res = await window.electronAPI.mergeSeries(mergeSeriesId, '', options);
      if (dialogGeneration !== mergeDialogGenerationRef.current) return;
      if (!res || !res.success) {
        setMergeError((res && res.error) || 'Ghép thất bại');
        return;
      }
      closeMergeDialog();
      await loadMergeTasks();
      const sizeGb = (res.totalBytes / 1073741824).toFixed(2);
      const duration = res.totalDuration > 0 ? ` / ${fmtElapsed(res.totalDuration)}` : ' / Thời lượng chờ xác định';
      showToast(compatible
        ? `Bắt đầu ghép định dạng tương thích ${res.count} tập (H.264, mất nhiều thời gian hơn)`
        : require1080
        ? `Bắt đầu ghép chất lượng độ phân giải cao ${res.count} tập`
        : `Bắt đầu ghép ${res.count} tập (khoảng ${sizeGb} GB${duration})`);
      if (res.codecWarning) showToast(res.codecWarning, 'error');
    } catch (e) {
      if (dialogGeneration === mergeDialogGenerationRef.current) setMergeError('Lỗi khi ghép: ' + e.message);
    } finally {
      mergeRequestRef.current = false;
      setMerging(false);
    }
  };

  const cancelMerge = async (id) => {
    try {
      const result = await window.electronAPI.cancelMerge(id);
      if (!result?.success) throw new Error(result?.error || 'Yêu cầu hủy thất bại, vui lòng thử lại');
      showToast('Yêu cầu hủy đã được gửi, đang chờ dừng ghép.');
      await loadMergeTasks();
    } catch (error) { showToast(error.message || 'Yêu cầu hủy thất bại, vui lòng thử lại', 'error'); }
  };

  const openMergedFile = async (path) => {
    if (!path) return;
    await window.electronAPI.showInFolder(path);
  };

  // Tạm dừng một chạm: Hủy tác vụ đang tiến hành + làm rỗng hàng đợi đang chờ
  const pauseAll = async () => {
    const res = await window.electronAPI.pauseAll();
    await refresh();
    await loadQueue();
    showToast(res && res.success ? `Đã tạm dừng ${res.count} tác vụ` : 'Tạm dừng thất bại', res && res.success ? 'success' : 'error');
  };

  // Khởi động một chạm: Đưa tất cả tác vụ đã dừng/thất bại/đang chờ xếp hàng chạy lại
  const resumeAll = async () => {
    const res = await window.electronAPI.resumeAll();
    await refresh();
    await loadQueue();
    if (res && res.success && res.count > 0) {
      setPage(1);
    }
    showToast(res && res.success ? `Đã khởi chạy ${res.count} tác vụ` : 'Khởi chạy thất bại', res && res.success ? 'success' : 'error');
  };

  // Thử lại các tác vụ thất bại/đã dừng
  const retryAllFailed = async () => {
    const ids = tasks.filter(needsManualRetry).map((t) => t.id);
    if (ids.length === 0) return;
    const res = await window.electronAPI.retryTasks(ids);
    await refresh();
    if (res && res.success) {
      showToast(`Đã thêm lại vào hàng đợi: ${res.count} mục`);
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Chọn tất cả tác vụ thất bại/đã dừng bằng một chạm (sau khi chọn có thể nhấn "Thử lại mục đã chọn")
  const selectAllFailed = () => {
    const ids = tasks.filter(needsManualRetry).map((t) => t.id);
    if (ids.length === 0) {
      showToast('Không có tác vụ nào thất bại hoặc đã dừng');
      return;
    }
    setSelected(new Set(ids));
    showToast(`Đã chọn ${ids.length} mục, có thể nhấn "Thử lại mục đã chọn" để tải lại`);
  };

  const clearCompleted = async () => {
    const done = tasks.filter((t) => t.status === 'completed');
    if (done.length === 0) return;
    askDelete(done, 'Xóa sạch các tác vụ đã hoàn thành');
  };

  const activeCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const retryingCount = tasks.filter(isWaitingRetry).length;
  const failedTasks = useMemo(
    () => tasks.filter(needsManualRetry),
    [tasks]
  );
  const failedCount = failedTasks.length;

  const displayTasks = useMemo(() => {
    if (filterStatus === 'active') return tasks.filter(t => t.status === 'downloading' || t.status === 'pending');
    if (filterStatus === 'failed') return failedTasks;
    if (filterStatus === 'retrying') return tasks.filter(isWaitingRetry);
    if (filterStatus === 'completed') return tasks.filter(t => t.status === 'completed');
    return tasks;
  }, [tasks, filterStatus, failedTasks]);

  // Progress updates change row values, not the established series/episode order.
  const sortedIds = useMemo(() => sortTasks(displayTasks).map(task => task.id), [displayTasks, orderVersion]);
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  taskIndex.current = taskById;
  const pageCount = Math.max(1, Math.ceil(sortedIds.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleTasks = sortedIds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(id => taskById.get(id)).filter(Boolean);

  // Các tác vụ có thể tạm dừng: Đang tải xuống, đang chờ, đã dừng (tất cả các tác vụ chưa chạy xong)
  const pausableCount = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').length,
    [tasks]
  );

  // Số lượng thực sự có thể thử lại trong các mục đã chọn
  const retryableSelectedCount = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const t = taskById.get(id);
        return t && (t.status === 'failed' || t.status === 'stopped');
      }).length,
    [selected, taskById]
  );

  const seriesGroups = useMemo(() => {
    const map = new Map();
    for (const task of visibleTasks) {
      const sid = String(task.hongguoInfo?.series_id || task.batchId || 'unknown');
      if (!map.has(sid)) {
        map.set(sid, {
          seriesId: sid,
          seriesTitle: task.hongguoInfo?.series_title || task.videoInfo?.author || task.title || 'Phim ngắn',
          cover: task.videoInfo?.cover || task.batchInfo?.avatar || '',
          tasks: [],
          totalBytes: 0,
          receivedBytes: 0,
          completedCount: 0,
          downloadingCount: 0,
          stoppedCount: 0,
          failedCount: 0,
          speed: 0,
        });
      }
      const group = map.get(sid);
      group.tasks.push(task);
      group.totalBytes += (task.totalBytes || 0);
      group.receivedBytes += (task.receivedBytes || 0);
      if (task.status === 'completed') group.completedCount++;
      else if (task.status === 'downloading') {
        group.downloadingCount++;
        if (task.speed) group.speed += task.speed;
      }
      else if (task.status === 'stopped') group.stoppedCount++;
      else if (task.status === 'failed') group.failedCount++;
    }
    return Array.from(map.values());
  }, [visibleTasks]);

  const toggleCollapseSeries = (sid) => {
    setCollapsedSeries(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const resumeSeries = async (group) => {
    const ids = group.tasks.filter(needsManualRetry).map(t => t.id);
    if (!ids.length) return;
    const res = await window.electronAPI.retryTasks(ids);
    await refresh();
    if (res?.success) showToast(`Đã thêm lại vào hàng đợi: ${res.count} tập`);
    else showToast(res?.error || 'Thử lại thất bại', 'error');
  };

  const pauseSeries = async (group) => {
    const activeTasks = group.tasks.filter(t => t.status === 'downloading' || t.status === 'pending');
    for (const t of activeTasks) {
      try { await window.electronAPI.pauseTask(t.id); } catch (_) {}
    }
    await refresh();
    showToast(`Đã tạm dừng các tập của «${group.seriesTitle}»`);
  };

  const toggleSelectSeries = (group) => {
    const ids = group.tasks.map(t => t.id);
    const allSelectedInGroup = ids.every(id => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (allSelectedInGroup) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  };

  const openSeriesFolder = async (group) => {
    const firstTask = group.tasks[0];
    if (!firstTask) return;
    const res = await window.electronAPI.openFolder(firstTask.id);
    if (!res?.success) showToast(res?.error || 'Mở thư mục thất bại', 'error');
  };

  const quickMergeSeries = (group) => {
    setSubTab('merges');
    if (group.seriesId) setMergeSeriesId(String(group.seriesId));
  };

  const handleCleanTempFiles = async () => {
    try {
      showToast('Đang quét và dọn dẹp tệp tạm mồ côi…', 'info');
      const res = await window.electronAPI.cleanDownloadTempFiles?.();
      if (res?.success) {
        if (res.count > 0) {
          showToast(`Đã giải phóng ${fmtBytes(res.freed)} (${res.count} tệp tạm .tmp)!`, 'success');
        } else {
          showToast('Thư mục tải về sạch sẽ, không có tệp tạm thừa.', 'info');
        }
      } else {
        showToast(res?.error || 'Dọn dẹp thất bại', 'error');
      }
    } catch (err) {
      showToast('Lỗi khi dọn dẹp: ' + err.message, 'error');
    }
  };

  const renderTaskRow = (task) => {
    const selectedThis = selected.has(task.id);
    const progressPct = task.progress || 0;
    const isDone = task.status === 'completed';
    const isFailed = task.status === 'failed';
    const isDownloading = task.status === 'downloading';
    const isStopped = task.status === 'stopped';
    const waitingRetry = isWaitingRetry(task);
    const canRetry = isFailed || isStopped;
    const canPause = isDownloading || task.status === 'pending';

    return (
      <div
        key={task.id}
        className={`dm-task ${task.status} ${selectedThis ? 'selected' : ''}`}
        onClick={() => toggleSelect(task.id)}
      >
        <button
          type="button"
          className="dm-checkbox-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(task.id);
          }}
          aria-label={`Chọn tác vụ tập ${task.hongguoInfo ? task.hongguoInfo.vid_index : ''}`}
        >
          {selectedThis ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>

        <div className="dm-info">
          <TaskTitleComponent task={task} className="dm-task-title" />
          <div className="dm-meta">
            <span className={`status-badge status-${task.status}`}>
              {STATUS_TEXT[task.status] || task.status}
            </span>
            {task.hongguoInfo && (
              <span>
                Tập {task.hongguoInfo.vid_index} /{' '}
                {task.hongguoInfo.total_episodes ? `${task.hongguoInfo.total_episodes} tập` : ''}
              </span>
            )}
            {task.downloadQuality && (
              <span className="dm-badge-quality">{task.downloadQuality.toUpperCase()}</span>
            )}
            {task.duration && (
              <span>{Math.floor(task.duration / 60)}:{(task.duration % 60).toString().padStart(2, '0')}</span>
            )}
            {isDone && task.totalBytes ? <span>{fmtBytes(task.totalBytes)}</span> : null}
            {isDownloading && task.speed ? <span>{fmtBytes(task.speed)}/s</span> : null}
          </div>

          {isDownloading && (
            <div className="dm-progress">
              <div
                className="dm-progress-bar"
                role="progressbar"
                aria-label="Tiến độ tải xuống"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <div className="dm-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="dm-pct">{progressPct}%</span>
            </div>
          )}

          {waitingRetry && (
            <div className="dm-retry-hint" role="status">
              Tự động thử lại {task.sourceRetries || 1}/3 sau {fmtElapsed((task.retryAt - Date.now()) / 1000)}: {task.error}
            </div>
          )}
          {isFailed && !waitingRetry && task.error && (
            <div className="dm-error" role="alert">{task.error}</div>
          )}
        </div>

        <div className="dm-actions" onClick={(e) => e.stopPropagation()}>
          {canPause && (
            <button className="icon-btn" title="Tạm dừng" onClick={async () => {
              try {
                const result = await window.electronAPI.pauseTask(task.id);
                if (!result?.success) throw new Error(result?.error || 'Tạm dừng thất bại');
              } catch (error) { showToast(error.message || 'Tạm dừng thất bại', 'error'); }
            }}>
              <Pause size={16} />
            </button>
          )}
          {waitingRetry && (
            <button className="icon-btn" title="Dừng tự động thử lại" onClick={async () => {
              try {
                const result = await window.electronAPI.stopDownload(task.id);
                if (!result?.success) throw new Error(result?.error || 'Dừng thất bại');
              } catch (error) { showToast(error.message || 'Dừng thất bại', 'error'); }
            }}>
              <Pause size={16} />
            </button>
          )}
          {canRetry && (
            <button className="icon-btn" title={waitingRetry ? 'Thử lại ngay' : 'Thử lại'} onClick={async () => {
              try {
                const result = await window.electronAPI.retryTask(task.id);
                if (!result?.success) throw new Error(result?.error || 'Thử lại thất bại');
              } catch (error) { showToast(error.message || 'Thử lại thất bại', 'error'); }
            }}>
              <RefreshCw size={16} />
            </button>
          )}
          <button className="icon-btn" title="Mở thư mục" onClick={() => window.electronAPI.openFolder(task.id)}>
            <Folder size={16} />
          </button>
          <button
            className="icon-btn icon-btn-danger"
            title="Xóa tác vụ (tùy chọn xóa kèm tệp trên máy hay không)"
            onClick={() => {
              askDelete([task], `Xóa tác vụ tập ${task.hongguoInfo ? task.hongguoInfo.vid_index : ''} của《${task.hongguoInfo && task.hongguoInfo.series_title ? task.hongguoInfo.series_title : ''}》`);
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    );
  };

  useDialogKeyboard(active && !!(confirmAsk || mergeAsk), () => { setConfirmAsk(null); closeMergeDialog(); }, '.dm-container .player-confirm');

  return (
    <div className="dm-container">
      <div className="dm-header">
        <div className="dm-title">
          <h2>Quản lý tải về</h2>
        </div>
        <div className="dm-stats">
          <span
            className={`stat stat-active clickable ${filterStatus === 'active' ? 'active-filter' : ''}`}
            onClick={() => { setFilterStatus('active'); setPage(1); }}
            title="Nhấn để xem các tác vụ đang tải và đang chờ"
          >
            Đang xử lý {activeCount}
          </span>
          {retryingCount > 0 && (
            <span
              className={`stat stat-active clickable ${filterStatus === 'retrying' ? 'active-filter' : ''}`}
              onClick={() => { setFilterStatus('retrying'); setPage(1); }}
              title="Nhấn để xem các tác vụ đang chờ thử lại"
            >
              Chờ thử lại {retryingCount}
            </span>
          )}
          <span
            className={`stat stat-done clickable ${filterStatus === 'completed' ? 'active-filter' : ''}`}
            onClick={() => { setFilterStatus('completed'); setPage(1); }}
            title="Nhấn để xem các tác vụ đã tải xong"
          >
            Đã hoàn thành {completedCount}
          </span>
          <span
            className={`stat stat-fail clickable ${filterStatus === 'failed' ? 'active-filter' : ''}`}
            onClick={() => { setFilterStatus('failed'); setPage(1); }}
            title="Nhấn để xem các tác vụ thất bại hoặc đã dừng"
          >
            Thất bại/Dừng {failedCount}
          </span>
        </div>
      </div>

      <div className="dm-usage-notice" role="note" aria-label="Rủi ro tải về và khuyến cáo sử dụng">
        <p><strong>Sự cố tạm thời sẽ tự động thử lại.</strong> Khi tải phim nguồn Hồng Quả gặp mất mạng, hết thời gian hoặc truyền tải không đầy đủ, sẽ tự động thử lại tối đa 3 lần với khoảng cách 10, 30, 60 giây; khi nguồn tạm thời không khả dụng sẽ chờ 3, 8, 15 phút. Trong thời gian chờ có thể dừng hoặc thử lại ngay. Lỗi quyền truy cập, lỗi ổ đĩa cần xử lý thủ công; các tác vụ vẫn thất bại sau khi thử lại sẽ được giữ nguyên.</p>
        <p>Phần mềm này phục vụ mục đích học tập và nghiên cứu, khuyến nghị tự xóa trong vòng 24 giờ sau khi trải nghiệm; vui lòng không mạo danh chính thức hoặc thu phí dưới danh nghĩa ủy quyền giả. Quyền và nghĩa vụ mã nguồn mở tuân theo GPLv3. Các khuyến cáo trên không đại diện cho việc được nền tảng hoặc chủ sở hữu bản quyền cấp phép, cũng như không tạo thành cam kết miễn trừ trách nhiệm.</p>
      </div>

      <div className="dm-subtabs" role="tablist" aria-label="Nhóm tác vụ">
        <button
          role="tab"
          type="button"
          id="dm-tab-downloads"
          aria-selected={subTab === 'downloads'}
          aria-controls="dm-panel-downloads"
          className={`dm-subtab-btn ${subTab === 'downloads' ? 'active' : ''}`}
          onClick={() => setSubTab('downloads')}
        >
          <Download size={15} />
          <span>Danh sách tải về</span>
          {tasks.length > 0 && <span className="dm-subtab-badge">{tasks.length}</span>}
        </button>
        <button
          role="tab"
          type="button"
          id="dm-tab-merges"
          aria-selected={subTab === 'merges'}
          aria-controls="dm-panel-merges"
          className={`dm-subtab-btn ${subTab === 'merges' ? 'active' : ''}`}
          onClick={() => setSubTab('merges')}
        >
          <Layers size={15} />
          <span>Ghép phim (Merge)</span>
          {mergeTasks.length > 0 && <span className="dm-subtab-badge">{mergeTasks.length}</span>}
        </button>
      </div>

      {/* 1. Danh sách tải về */}
      <div
        className="dm-tab-panel"
        role="tabpanel"
        id="dm-panel-downloads"
        aria-labelledby="dm-tab-downloads"
        style={{ display: subTab === 'downloads' ? undefined : 'none' }}
      >
        <div className="dm-toolbar">
          <button
            className="btn btn-primary"
            onClick={resumeAll}
            disabled={!tasks.some(task => ['stopped', 'failed', 'pending'].includes(task.status))}
            title="Xếp hàng và khởi chạy lại tất cả tác vụ đang chờ / đã dừng / thất bại"
          >
            <Play size={15} />
            Bắt đầu tất cả
          </button>
          <button
            className="btn btn-outline"
            onClick={pauseAll}
            disabled={pausableCount === 0}
            title="Tạm dừng tất cả: Hủy các tác vụ đang tải và làm trống hàng đợi chờ"
          >
            <Pause size={15} />
            Tạm dừng tất cả
          </button>
          <button
            className="btn btn-outline"
            onClick={retryAllFailed}
            disabled={failedCount === 0}
            title="Thêm lại tất cả tác vụ thất bại/đã dừng vào hàng đợi tải về"
          >
            <Zap size={15} />
            {failedCount > 0 ? `Thử lại thất bại (${failedCount})` : 'Thử lại thất bại'}
          </button>
          <details className="dm-more-actions" ref={moreActionsRef}><summary>Thao tác khác</summary><div className="dm-more-menu" onClick={event => { const button = event.target.closest('button'); if (button && !button.disabled) moreActionsRef.current.open = false; }}>
          <button
            className="btn btn-outline"
            onClick={selectAllFailed}
            disabled={failedCount === 0}
            title="Chọn tất cả tác vụ thất bại/đã dừng chỉ bằng một cú nhấp chuột"
          >
            <CheckSquare size={15} />
            {failedCount > 0 ? `Chọn các mục lỗi (${failedCount})` : 'Chọn các mục lỗi'}
          </button>
          <button className="btn btn-outline" onClick={retrySelected} disabled={retryableSelectedCount === 0}>
            <RefreshCw size={15} />
            Thử lại mục đã chọn ({retryableSelectedCount})
          </button>
          <button className="btn btn-outline" onClick={clearCompleted} disabled={completedCount === 0}>
            <X size={15} />
            Xóa sạch đã hoàn thành
          </button>
          <button className="btn btn-outline" onClick={clearSelection} disabled={selected.size === 0}>
            Bỏ chọn
          </button>
          <button
            className="btn btn-outline"
            onClick={async () => {
              const r = await window.electronAPI.rescanDownloads();
              await refresh();
              await loadSeriesList();
              showToast(r && r.success
                ? (r.count > 0 ? `Đã bổ sung ${r.count} bản ghi tải về từ ổ đĩa` : 'Không phát hiện tệp nào chưa đăng ký')
                : 'Quét thất bại');
            }}
            title="Quét thư mục tải về, bổ sung lại các tệp đã có trên đĩa nhưng chưa có trong danh sách"
          >
            <RefreshCw size={15} />
            Quét thư mục tải về
          </button>
          </div></details>
          {onNavigate && (
            <button className="btn btn-primary dm-toolbar-end" onClick={() => onNavigate('download')}>
              <Film size={15} />
              Thêm lượt tải
            </button>
          )}
        </div>

        <div className="dm-filter-tabs" role="tablist" aria-label="Bộ lọc tác vụ">
          <button
            type="button"
            className={`dm-filter-tab ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => { setFilterStatus('all'); setPage(1); }}
          >
            Tất cả ({tasks.length})
          </button>
          <button
            type="button"
            className={`dm-filter-tab ${filterStatus === 'active' ? 'active' : ''}`}
            onClick={() => { setFilterStatus('active'); setPage(1); }}
          >
            Đang xử lý ({activeCount})
          </button>
          {retryingCount > 0 && (
            <button
              type="button"
              className={`dm-filter-tab ${filterStatus === 'retrying' ? 'active' : ''}`}
              onClick={() => { setFilterStatus('retrying'); setPage(1); }}
            >
              Chờ thử lại ({retryingCount})
            </button>
          )}
          <button
            type="button"
            className={`dm-filter-tab ${filterStatus === 'failed' ? 'active' : ''}`}
            onClick={() => { setFilterStatus('failed'); setPage(1); }}
          >
            Thất bại / Dừng ({failedCount})
          </button>
          <button
            type="button"
            className={`dm-filter-tab ${filterStatus === 'completed' ? 'active' : ''}`}
            onClick={() => { setFilterStatus('completed'); setPage(1); }}
          >
            Đã hoàn thành ({completedCount})
          </button>
        </div>

        {failedCount > 0 && activeCount === 0 && (
          <div className="dm-status-notice dm-status-notice-warning" role="alert">
            <div className="dm-notice-body">
              <span>⚠️ Có <b>{failedCount}</b> tập phim đang tạm dừng hoặc chưa hoàn thành.</span>
            </div>
            <div className="dm-notice-actions">
              <button className="btn btn-primary btn-sm" onClick={resumeAll} title="Tiếp tục tải tất cả các tập đang dừng/lỗi">
                <Play size={13} /> Tiếp tục tải tất cả
              </button>
              {filterStatus !== 'failed' && (
                <button className="btn btn-outline btn-sm" onClick={() => { setFilterStatus('failed'); setPage(1); }}>
                  Xem {failedCount} tập này
                </button>
              )}
            </div>
          </div>
        )}

        {activeCount > 0 && filterStatus === 'all' && !visibleTasks.some(t => t.status === 'downloading' || t.status === 'pending') && (
          <div className="dm-status-notice dm-status-notice-info">
            <div className="dm-notice-body">
              <span>⚡ Đang tải và xử lý <b>{activeCount}</b> tập phim ở trang khác.</span>
            </div>
            <div className="dm-notice-actions">
              <button className="btn btn-primary btn-sm" onClick={() => { setFilterStatus('active'); setPage(1); }}>
                👉 Xem ngay các tập đang tải
              </button>
            </div>
          </div>
        )}

        {/* Dashboard thông số hệ thống */}
        <div className="dm-system-dashboard">
          <div className="dm-dash-item">
            <span className="dm-dash-icon pulse"><Zap size={15} /></span>
            <div className="dm-dash-info">
              <span className="dm-dash-label">Tốc độ mạng</span>
              <span className="dm-dash-value">{systemStats.totalSpeed > 0 ? `${fmtBytes(systemStats.totalSpeed)}/s` : (activeCount > 0 ? 'Đang tải…' : '0 B/s')}</span>
            </div>
          </div>
          <div className="dm-dash-item">
            <span className="dm-dash-icon"><Layers size={15} /></span>
            <div className="dm-dash-info">
              <span className="dm-dash-label">Tiến trình</span>
              <span className="dm-dash-value">{queue.active} / {queue.maxConcurrent} luồng {queue.queued > 0 ? `(${queue.queued} chờ)` : ''}</span>
            </div>
          </div>
          <div className="dm-dash-item">
            <span className="dm-dash-icon"><Folder size={15} /></span>
            <div className="dm-dash-info">
              <span className="dm-dash-label">Ổ đĩa tải về</span>
              <span className="dm-dash-value">{systemStats.freeBytes ? `Còn trống ${fmtBytes(systemStats.freeBytes)}` : 'Sẵn sàng'}</span>
            </div>
          </div>
          <div className="dm-dash-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleCleanTempFiles}
              title="Quét và xóa sạch các tệp tạm .tmp mồ côi bị lỗi/gián đoạn để giải phóng dung lượng ổ cứng"
            >
              <Trash2 size={13} /> Dọn tệp tạm (.tmp)
            </button>
            <div className="dm-view-toggle">
              <button
                type="button"
                className={`btn btn-sm ${viewMode === 'series' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('series')}
                title="Gom nhóm các tập theo từng bộ phim"
              >
                🗂️ Theo phim
              </button>
              <button
                type="button"
                className={`btn btn-sm ${viewMode === 'episodes' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('episodes')}
                title="Hiển thị danh sách chi tiết từng tập"
              >
                📋 Từng tập
              </button>
            </div>
          </div>
        </div>

        {queue.active > 0 && (
          <div className="dm-queue-bar">
            <span className="dm-queue-running">
              <span className="dm-queue-pulse" />
              Đang tải đồng thời <b>{queue.active}</b> / {queue.maxConcurrent}
              {queue.queued > 0 ? <> · Đang chờ trong hàng đợi <b>{queue.queued}</b></> : null}
            </span>
            <span className="dm-queue-hint">
              Số luồng đồng thời có thể điều chỉnh tại "Cài đặt → Tải về → Số lượt tải đồng thời tối đa"
            </span>
          </div>
        )}

        {retryableSelectedCount > 0 && (
          <div className="dm-hint">
            Đã chọn <b>{retryableSelectedCount}</b> mục thất bại, nhấn
            <b>「Thử lại mục đã chọn」</b> để tải lại (không cần phân tích lại).
          </div>
        )}

        {loadError && <div className="alert alert-error" role="alert">{loadError}<button className="btn btn-outline btn-sm" onClick={refresh}>Tải lại</button></div>}
        {tasks.length > 0 && <div className="dm-pagination">
          <div className="dm-selection-summary">
            <button className="btn btn-outline btn-sm" onClick={allSelected ? clearSelection : selectAll}
              title={allSelected ? 'Bỏ chọn ở tất cả các trang' : `Chọn tất cả ${tasks.length} mục, bao gồm cả các trang khác`}>
              <CheckSquare size={15} />{allSelected ? 'Hủy chọn tất cả' : 'Chọn tất cả'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={deleteSelected} disabled={selected.size === 0}
              title="Xóa các tác vụ đã chọn ở tất cả các trang, khi xác nhận có thể chọn xóa kèm tệp trên máy hay không">
              <Trash2 size={15} />Xóa mục đã chọn ({selected.size} mục)
            </button>
          <span>Tổng cộng {tasks.length} mục{filterStatus !== 'all' ? ` (đang lọc ${displayTasks.length})` : ''} · Hiện tại {sortedIds.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, sortedIds.length)} mục{selected.size > 0 ? ` · Đã chọn ${selected.size} mục (giữ qua các trang)` : ''}</span>
          </div>
          <nav aria-label="Phân trang tác vụ tải về">
            <button className="btn btn-outline btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
            <span>Trang {currentPage} / {pageCount}</span>
            <button className="btn btn-outline btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
          </nav>
        </div>}

        {tasks.length === 0 ? (
          <div className="dm-empty">
            <Download size={40} />
            <p>Chưa có tác vụ tải về</p>
            <p className="dm-empty-sub">Tìm kiếm tên phim hoặc dán liên kết chia sẻ, chọn các tập bạn muốn lưu.</p>
            {onNavigate && <button className="btn btn-primary" onClick={() => onNavigate('download')}>Thêm bộ phim đầu tiên</button>}
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="dm-empty">
            <p>Không có tác vụ nào ở mục này</p>
            <button className="btn btn-outline btn-sm" onClick={() => { setFilterStatus('all'); setPage(1); }}>
              Xem tất cả ({tasks.length} mục)
            </button>
          </div>
        ) : viewMode === 'series' ? (
          <div className="dm-series-grid">
            {seriesGroups.map((group) => {
              const isCollapsed = collapsedSeries.has(group.seriesId);
              const allSelectedInSeries = group.tasks.length > 0 && group.tasks.every((t) => selected.has(t.id));
              const hasErrorOrStopped = group.tasks.some(needsManualRetry);
              const isSeriesActive = group.tasks.some((t) => t.status === 'downloading' || t.status === 'pending');
              const percent = group.tasks.length ? Math.round((group.completedCount / group.tasks.length) * 100) : 0;

              return (
                <div key={group.seriesId} className={`dm-series-card ${hasErrorOrStopped ? 'has-stopped' : ''} ${isSeriesActive ? 'is-active' : ''} ${percent === 100 ? 'is-completed' : ''}`}>
                  {/* Header Thẻ Phim */}
                  <div className="dm-series-header">
                    <div className="dm-series-cover-wrapper" onClick={() => toggleCollapseSeries(group.seriesId)}>
                      {group.cover ? (
                        <img src={group.cover} alt={group.seriesTitle} className="dm-series-cover" />
                      ) : (
                        <div className="dm-series-cover cover-placeholder"><Film size={24} /></div>
                      )}
                      {percent === 100 && <span className="dm-series-done-badge">✓ Xong</span>}
                    </div>

                    <div className="dm-series-meta">
                      <div className="dm-series-title-row">
                        <h3 className="dm-series-title" onClick={() => toggleCollapseSeries(group.seriesId)}>
                          <DramaTitle title={group.seriesTitle} showOriginal={false} />
                        </h3>
                        {group.tasks[0]?.downloadQuality && (
                          <span className="dm-badge-quality">{group.tasks[0].downloadQuality.toUpperCase()}</span>
                        )}
                      </div>

                      {/* Progress Bar & Stats */}
                      <div className="dm-series-progress-box">
                        <div className="dm-series-progress-info">
                          <span className="dm-series-count-text">
                            Tiến độ: <b>{group.completedCount}</b> / {group.tasks.length} tập ({percent}%)
                          </span>
                          {group.speed > 0 && (
                            <span className="dm-series-speed-text">⚡ {fmtBytes(group.speed)}/s</span>
                          )}
                          {group.totalBytes > 0 && (
                            <span className="dm-series-size-text">{fmtBytes(group.totalBytes)}</span>
                          )}
                        </div>
                        <div className="dm-series-progress-bar">
                          <div className="dm-series-progress-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </div>

                      {/* Status Badges & Quick Action Controls */}
                      <div className="dm-series-actions-row">
                        <div className="dm-series-badges">
                          {isSeriesActive && <span className="status-badge status-downloading">Đang tải ({group.downloadingCount})</span>}
                          {hasErrorOrStopped && <span className="status-badge status-stopped">Dừng/Lỗi ({group.stoppedCount + group.failedCount})</span>}
                          {percent === 100 && <span className="status-badge status-completed">Hoàn tất cả bộ</span>}
                        </div>

                        <div className="dm-series-btn-group">
                          {hasErrorOrStopped && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => resumeSeries(group)}
                              title="Tiếp tục tải các tập đang dừng/lỗi của bộ phim này"
                            >
                              <Play size={13} /> Tiếp tục tải
                            </button>
                          )}
                          {isSeriesActive && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => pauseSeries(group)}
                              title="Tạm dừng tải các tập của bộ phim này"
                            >
                              <Pause size={13} /> Tạm dừng
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => openSeriesFolder(group)}
                            title="Mở thư mục chứa video trên máy tính"
                          >
                            <Folder size={13} /> Mở thư mục
                          </button>
                          {group.completedCount > 1 && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => quickMergeSeries(group)}
                              title="Ghép các tập phim đã tải thành 1 video duy nhất"
                            >
                              <Layers size={13} /> Ghép phim
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-outline btn-sm btn-collapse-toggle"
                            onClick={() => toggleCollapseSeries(group.seriesId)}
                            title={isCollapsed ? 'Mở rộng danh sách tập' : 'Thu gọn danh sách tập'}
                          >
                            <span>{isCollapsed ? `Xem ${group.tasks.length} tập` : 'Thu gọn'}</span>
                            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Body: Danh sách tập bên trong Series Card */}
                  {!isCollapsed && (
                    <div className="dm-series-episodes-list">
                      <div className="dm-series-episodes-toolbar">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => toggleSelectSeries(group)}
                        >
                          <CheckSquare size={13} /> {allSelectedInSeries ? 'Bỏ chọn cả phim' : 'Chọn cả phim'}
                        </button>
                        <span className="dm-series-episodes-hint">Danh sách các tập của bộ phim:</span>
                      </div>
                      <div className="dm-list">
                        {group.tasks.map((task) => renderTaskRow(task))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dm-list">
            {visibleTasks.map((task) => renderTaskRow(task))}
          </div>
        )}
      </div>

      {/* 2. Ghép phim (Merge) */}
      <div
        className="dm-tab-panel"
        role="tabpanel"
        id="dm-panel-merges"
        aria-labelledby="dm-tab-merges"
        style={{ display: subTab === 'merges' ? undefined : 'none' }}
      >
        <div className="dm-merge-control-box">
          <h3>Ghép nhiều tập thành một phim hoàn chỉnh</h3>
          <p className="settings-hint dm-merge-hint">Chọn tên phim rồi nhấn "Ghép toàn bộ phim" để xuất tất cả tập đã tải của phim đó mà không cần tích chọn từng tác vụ.</p>
          {seriesList.length > 0 ? (
            <div className="merge-inline">
              <select
                className="input-field merge-select"
                value={mergeSeriesId}
                onFocus={() => loadSeriesList()}
                onChange={(e) => setMergeSeriesId(e.target.value)}
                title="Chọn phim ngắn cần ghép"
              >
                {seriesList.map((s) => {
                  const vi = safeGetCachedTranslation(s.series_title);
                  return (
                    <option key={s.series_id} value={String(s.series_id)}>
                      {vi && vi !== s.series_title ? `${vi} (${s.series_title})` : s.series_title}
                    </option>
                  );
                })}
              </select>
              <button className="btn btn-primary" onClick={openMergeDialog} disabled={merging} title="Ghép các tập đã tải của phim này thành một tệp mp4 duy nhất">
                <Layers size={15} />
                {merging ? 'Đang ghép...' : 'Ghép toàn bộ phim'}
              </button>
            </div>
          ) : (
            <p className="settings-hint">Chưa có phim nào hoàn thành tải về để ghép nối. Hãy tải về các tập phim trước.</p>
          )}
        </div>

        {mergeTasks.length > 0 ? (
          <div className="merge-list">
            {mergeTasks.map((m) => (
              <div key={m.id} className={`merge-card merge-${m.status}`}>
                <Layers size={16} />
                <div className="merge-body">
                  <div className="merge-title">
                    Ghép《<DramaTitleComponent title={m.seriesTitle}>{m.seriesTitle}</DramaTitleComponent>》· {m.done || 0}/{m.total} tập
                  </div>
                  <div className="merge-sub">
                    {m.status === 'running' && <>{m.stageText || 'Đang ghép'}{m.method && m.method !== m.stageText ? ` · ${m.method}` : ''}</>}
                    {m.status === 'completed' && (
                      <>
                        Đã hoàn thành · {m.outputName}
                        {m.outputBytes ? ` · ${fmtBytes(m.outputBytes)}` : ''}
                      </>
                    )}
                    {m.status === 'failed' && <>Thất bại: {m.error}</>}
                    {m.status === 'stopped' && <>{m.error || 'Đã hủy'}</>}
                  </div>
                  <div className="merge-metrics">
                    <span>{m.stage === 'checking' ? `Đã kiểm tra ${m.checked || 0}` : `Đã xử lý ${m.done || 0}`} / {m.total} tập</span>
                    <span>Thời gian {fmtElapsed(m.status === 'running' ? (Date.now() - m.startTime) / 1000 : m.elapsedSeconds || ((m.endTime || m.startTime) - m.startTime) / 1000)}</span>
                    {m.status === 'running' && m.speed > 0 && <span>{m.speed.toFixed(1)}x</span>}
                    {m.status === 'running' && Number.isFinite(m.etaSeconds) && <span>Giai đoạn này còn khoảng {fmtElapsed(m.etaSeconds)}</span>}
                  </div>
                  {(m.codecWarning || m.storageWarning || m.cleanupWarning) && <div className="merge-note">{m.storageWarning || m.cleanupWarning || m.codecWarning}</div>}
                  {(m.status === 'running') && (
                    <div className="dm-progress">
                      <div className="dm-progress-bar" role="progressbar" aria-label="Tiến độ ghép" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.progress || 0}>
                        <div className="dm-progress-fill" style={{ width: `${m.progress || 0}%` }} />
                      </div>
                      <span className="dm-pct">{m.progress || 0}%</span>
                    </div>
                  )}
                </div>
                <div className="merge-actions">
                  {m.status === 'running' && (
                    <button className="icon-btn" title="Hủy ghép" onClick={() => cancelMerge(m.id)}>
                      <X size={16} />
                    </button>
                  )}
                  {m.status === 'completed' && (
                    <button className="icon-btn" title="Mở thư mục chứa" onClick={() => openMergedFile(m.output)}>
                      <Folder size={16} />
                    </button>
                  )}
                  {m.status !== 'running' && (
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Xóa bản ghi"
                      onClick={async () => {
                        try {
                          const result = await window.electronAPI.deleteMergeTask(m.id);
                          if (!result?.success) throw new Error(result?.error || 'Xóa bản ghi thất bại');
                          await loadMergeTasks();
                        } catch (error) { showToast(error.message || 'Xóa bản ghi thất bại, vui lòng thử lại', 'error'); }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dm-empty">
            <Layers size={40} />
            <p>Chưa có tác vụ ghép phim nào</p>
            <p className="dm-empty-sub">Khi bắt đầu ghép, tiến độ và tệp đầu ra hoàn thành sẽ hiển thị tại đây.</p>
          </div>
        )}
      </div>

      {queue.active > 0 && (
        <div className="dm-queue-bar">
          <span className="dm-queue-running">
            <span className="dm-queue-pulse" />
            Đang tải đồng thời <b>{queue.active}</b> / {queue.maxConcurrent}
            {queue.queued > 0 ? <> · Đang chờ trong hàng đợi <b>{queue.queued}</b></> : null}
          </span>
          <span className="dm-queue-hint">
            Số luồng đồng thời có thể điều chỉnh tại "Cài đặt → Số lượt tải đồng thời tối đa"
          </span>
        </div>
      )}

      {retryableSelectedCount > 0 && (
        <div className="dm-hint">
          Đã chọn <b>{retryableSelectedCount}</b> mục thất bại, nhấn
          <b>「Thử lại mục đã chọn」</b> để tải lại (không cần phân tích lại).
        </div>
      )}

      {loadError && <div className="alert alert-error" role="alert">{loadError}<button className="btn btn-outline btn-sm" onClick={refresh}>Tải lại</button></div>}
      {tasks.length > 0 && <div className="dm-pagination">
        <div className="dm-selection-summary">
          <button className="btn btn-outline btn-sm" onClick={allSelected ? clearSelection : selectAll}
            title={allSelected ? 'Bỏ chọn ở tất cả các trang' : `Chọn tất cả ${tasks.length} mục, bao gồm cả các trang khác`}>
            <CheckSquare size={15} />{allSelected ? 'Hủy chọn tất cả' : 'Chọn tất cả'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={deleteSelected} disabled={selected.size === 0}
            title="Xóa các tác vụ đã chọn ở tất cả các trang, khi xác nhận có thể chọn xóa kèm tệp trên máy hay không">
            <Trash2 size={15} />Xóa mục đã chọn ({selected.size} mục)
          </button>
        <span>Tổng cộng {tasks.length} mục · Hiện tại {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, tasks.length)} mục{selected.size > 0 ? ` · Đã chọn ${selected.size} mục (giữ qua các trang)` : ''}</span>
        </div>
        <nav aria-label="Phân trang tác vụ tải về">
          <button className="btn btn-outline btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
          <span>Trang {currentPage} / {pageCount}</span>
          <button className="btn btn-outline btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
        </nav>
      </div>}

      {tasks.length === 0 ? (
        <div className="dm-empty">
          <Download size={40} />
          <p>Chưa có tác vụ tải về</p>
          <p className="dm-empty-sub">Tìm kiếm tên phim hoặc dán liên kết chia sẻ, chọn các tập bạn muốn lưu.</p>
          {onNavigate && <button className="btn btn-primary" onClick={() => onNavigate('download')}>Thêm bộ phim đầu tiên</button>}
        </div>
      ) : (
        <div className="dm-list">
          {visibleTasks.map((task) => {

            const isSel = selected.has(task.id);
            const waitingRetry = isWaitingRetry(task);
            const canStop = task.status === 'downloading' || task.status === 'pending' || waitingRetry;
            const canRetry = task.status === 'failed' || task.status === 'stopped';
            const pct = task.progress || 0;
            return (
              <div key={task.id} className={`dm-task ${isSel ? 'selected' : ''}`} onClick={() => toggleSelect(task.id)}>
                <input className="dm-task-select" type="checkbox" aria-label={`Chọn ${task.title || task.filename}`} checked={isSel} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(task.id)} />
                <div className="dm-task-cover">
                  {task.videoInfo && task.videoInfo.cover ? (
                    <img src={task.videoInfo.cover} alt="" />
                  ) : (
                    <div className="cover-placeholder"><Film size={18} /></div>
                  )}
                </div>
                <div className="dm-task-body">
                  <TaskTitleComponent task={task} className="dm-task-title" />
                  <div className="dm-task-meta">
                    <span className={`status-tag status-${waitingRetry ? 'pending' : task.status}`}>{waitingRetry ? 'Chờ thử lại' : STATUS_TEXT[task.status] || task.status}</span>
                    {waitingRetry && <span className="dm-size">Tự động thử lại {task.sourceRetries}/3 · Xếp hàng sau {new Date(task.retryAt).toLocaleTimeString('vi-VN', { hour12: false })}</span>}
                    {task.status === 'downloading' && task.totalBytes > 0 && (
                      <span className="dm-size">{fmtBytes(task.receivedBytes)} / {fmtBytes(task.totalBytes)}</span>
                    )}
                    {task.status === 'failed' && task.error && <span className="dm-error">{task.error}</span>}
                  </div>
                  {['downloading', 'completed'].includes(task.status) && task.qualityNotice && <div className="dm-quality-notice">{task.qualityNotice}</div>}
                  {task.nasWarning && <div className="dm-error">{task.nasWarning}</div>}
                  {(task.status === 'downloading' || task.status === 'pending') && (
                    <div className="dm-progress">
                      <div className="dm-progress-bar">
                        <div className="dm-progress-fill" style={{ width: pct + '%' }}></div>
                      </div>
                      <span className="dm-pct">{pct}%</span>
                    </div>
                  )}
                </div>
                <div className="dm-task-actions" onClick={(e) => e.stopPropagation()}>
                  {canStop && (
                    <button className="icon-btn" title={waitingRetry ? 'Dừng tự động thử lại' : 'Dừng'} onClick={async () => {
                      try {
                        const result = await window.electronAPI.stopDownload(task.id);
                        if (!result?.success) throw new Error(result?.error || 'Dừng thất bại');
                        await refresh();
                      } catch (error) { showToast(error.message || 'Dừng thất bại', 'error'); }
                    }}>
                      <Square size={16} />
                    </button>
                  )}
                  {canRetry && (
                    <button className="icon-btn" title={waitingRetry ? 'Thử lại ngay' : 'Thử lại'} onClick={async () => {
                      try {
                        const result = await window.electronAPI.retryTask(task.id);
                        if (!result?.success) throw new Error(result?.error || 'Thử lại thất bại');
                      } catch (error) { showToast(error.message || 'Thử lại thất bại', 'error'); }
                    }}>
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button className="icon-btn" title="Mở thư mục" onClick={() => window.electronAPI.openFolder(task.id)}>
                    <Folder size={16} />
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Xóa tác vụ (tùy chọn xóa kèm tệp trên máy hay không)"
                    onClick={() => {
                      askDelete([task], `Xóa tác vụ tập ${task.hongguoInfo ? task.hongguoInfo.vid_index : ''} của《${task.hongguoInfo && task.hongguoInfo.series_title ? task.hongguoInfo.series_title : ''}》`);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      {/* Lựa chọn định dạng ghép */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={closeMergeDialog}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Xuất ghép video'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Ghép toàn bộ phim
            </div>
            <div className="player-confirm-msg">
              <p>Ghép tất cả các tập đã tải của《{seriesList.find((series) => String(series.series_id) === mergeSeriesId)?.series_title || 'phim đã chọn'}》thành một tệp mp4 duy nhất. Các tập chưa tải sẽ không tự động tải bù.</p>
              <p><b>Ghép chất lượng độ phân giải cao</b>: Kiểm tra từng tập tệp thực tế, tất cả phải đạt 1080P mới bắt đầu; nếu có tập độ phân giải thấp vui lòng chọn ghép nhanh hoặc tương thích.</p>
              <p><b>Ghép nhanh</b>: Ưu tiên ghép nối không giảm chất lượng, giữ nguyên độ phân giải gốc của từng đoạn, một số thiết bị có thể không tương thích.</p>
              <p><b>Ghép tương thích</b>: Khi cần sẽ chuyển mã sang H.264/AAC, vẫn giữ độ phân giải gốc từng đoạn, xử lý chậm hơn.</p>
              <p>Cả ba cách đều giữ lại tệp gốc, chỉ ghép các tập đã tải, không tự động tải bù, và cũng không biến tập độ nét thấp thành độ nét cao thật sự.</p>
              {mergeError && <p className="alert-error" role="alert">{mergeError}</p>}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => doMerge(false, true)} disabled={merging}>
                Ghép chất lượng cao
              </button>
              <button className="btn btn-outline" onClick={closeMergeDialog}>Hủy</button>
              <button className="btn btn-outline" onClick={() => doMerge(true)} disabled={merging}>
                Ghép tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => doMerge(false)} disabled={merging}>
                Ghép nhanh thông minh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa (tùy chọn có xóa kèm tệp cục bộ hay không) */}
      {confirmAsk && (
        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Xuất ghép video'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              <p>Tổng cộng {confirmAsk.count} tác vụ, trong đó có {confirmAsk.withFile} tác vụ đã tải xong
                {confirmAsk.estBytes > 0 ? ` (khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}.</p>
              <label className="dm-confirm-check">
                <input
                  type="checkbox"
                  checked={!!confirmAsk._del}
                  onChange={(e) => setConfirmAsk({ ...confirmAsk, _del: e.target.checked })}
                />
                <span>
                  Đồng thời xóa tệp trên máy
                  {confirmAsk.estBytes > 0 ? ` (giải phóng khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}
                </span>
              </label>
              <p className="dm-confirm-hint">
                Nếu không chọn, chỉ xóa bản ghi tác vụ, tệp video trên ổ đĩa sẽ được giữ lại (bạn có thể tự quản lý trong trình quản lý tệp).
              </p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk._del ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  const del = !!confirmAsk._del;
                  setConfirmAsk(null);
                  await fn(del);
                }}
              >
                {confirmAsk._del ? 'Xóa tác vụ và tệp' : 'Chỉ xóa bản ghi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DownloadManager;
