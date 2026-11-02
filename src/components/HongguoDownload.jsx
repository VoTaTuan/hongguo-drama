import React, { useState, useRef, useEffect } from 'react';
import './HongguoDownload.css';
import { Film, Download, CheckSquare, Square, RefreshCw, Folder, Link2, Search, Play } from './icons';
import SearchPanel from './SearchPanel';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { isSubmitKey, parseEpisodeRange } from './episodeRange';
import { getTranslationConfig, getCachedTranslation, translateText } from '../services/translator';
import { DramaTitle } from './TranslatedText';


function HongguoDownload({ onNavigate, active = true }) {
  const { sources: mediaSources, revision: sourceRevision } = useMediaSources();
  const [tab, setTab] = useState('search'); // 'search' | 'input'
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Kết quả phân tích phim ngắn
  const [seriesData, setSeriesData] = useState(null); // { series_id, series_title, cover, total, episodes: [...] }
  const [selectedVids, setSelectedVids] = useState(new Set());
  const [rangeInput, setRangeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exportKinds, setExportKinds] = useState({ danmaku: false, comments: false, reviews: false });
  const [exportNote, setExportNote] = useState('');
  const [exportSettingsNote, setExportSettingsNote] = useState('');
  const exportInitialized = useRef(false);
  const textExportRequest = useRef(null);
  const seriesIdRef = useRef(null);
  seriesIdRef.current = seriesData?.series_id;
  const [downloadQuality, setDownloadQuality] = useState('auto');
  const [qualityLoading, setQualityLoading] = useState(true);
  const [openingPlayer, setOpeningPlayer] = useState(false);
  const playPending = useRef(false);
  const firstPlayable = seriesData?.episodes.find((ep) => !ep.locked);
  // Bình luận/danmaku/đánh giá phim chỉ nguồn Hồng Quả mới hỗ trợ (hàm lấy dữ liệu dùng ID toàn số để kiểm tra trước); các nguồn khác ẩn tùy chọn xuất.
  const isHongguoSource = /^\d{6,30}$/.test(String(seriesData?.series_id || ''));
  const resolveRequest = useRef(0);
  const pendingResolve = useRef(null);
  const searchVersion = resolveRequest.current;

  useEffect(() => () => { resolveRequest.current++; }, []);
  useEffect(() => {
    resolveRequest.current++; pendingResolve.current = null; setLoading(false);
    setSeriesData(current => current?.series_id?.startsWith('custom:') ? null : current);
  }, [sourceRevision]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setQualityLoading(true);
    window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) setDownloadQuality(['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto');
      if (!cancelled && !exportInitialized.current) {
        const et = settings?.export_text || {};
        setExportKinds({ danmaku: et.danmaku === true, comments: et.comments === true, reviews: et.reviews === true });
        exportInitialized.current = true;
      }
    }).catch(() => {
      if (!cancelled) setErrorMsg('Đọc độ phân giải tải về mặc định thất bại, vui lòng xác nhận độ phân giải trước khi tải');
    }).finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  // Xuất văn bản chuyển thành tác vụ nền, sau khi hoàn thành sẽ thông báo qua sự kiện text-export-done; phần đăng ký này chỉ cập nhật thông báo, không chặn tải xuống.
  useEffect(() => {
    const off = window.electronAPI?.onTextExportDone?.((data) => {
      const request = textExportRequest.current;
      if (!data || !request || request.done || data.requestId !== request.requestId
        || String(data.seriesId) !== String(request.seriesId)
        || String(data.seriesId) !== String(seriesIdRef.current)) return;
      request.done = true;
      const k = request.kinds;
      const part = (key, label) => k[key] && data[key]
        ? `${label} ${data[key].ok} bản${Number.isFinite(data[key].items) ? `, ${data[key].items} mục` : ''}${data[key].empty ? ` (dữ liệu trống ${data[key].empty} bản)` : ''}${data[key].skipped ? ` (bỏ qua ${data[key].skipped})` : ''}${data[key].unavailable ? `, nguồn chưa mở ${data[key].unavailable} tập (chưa tạo tệp)` : ''}${data[key].fail ? `, thất bại ${data[key].fail}` : ''}${data[key].partial ? `, một phần ${data[key].partial} (chỉ lưu dữ liệu đã lấy được)` : ''}` : null;
      const bits = [part('danmaku', 'Danmaku'), part('comments', 'Bình luận'), part('reviews', 'Đánh giá')].filter(Boolean);
      setExportNote(data.failed
        ? `Xuất văn bản chưa hoàn thành: ${data.error || 'Lỗi không xác định'}`
        : `Kết quả xuất văn bản: ${bits.join(', ') || 'Không có'}${(k.comments || k.reviews) ? ' (Bình luận/Đánh giá bị giới hạn bởi trang chủ, chỉ lấy phần công khai)' : ''}`);
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const clearTextExport = () => {
    textExportRequest.current = null;
    setExportNote('');
    setExportSettingsNote('');
  };

  const switchTab = (next) => {
    if (next === tab) return;
    resolveRequest.current++;
    pendingResolve.current = null;
    setLoading(false);
    setTab(next);
  };

  // Sau khi chọn một bộ phim từ tìm kiếm: Tái sử dụng giao diện chọn tập tải xuống hiện có
  const handleSeriesFromSearch = (data) => {
    if (searchVersion !== resolveRequest.current) return;
    resolveRequest.current++;
    setLoading(false);
    setRangeInput('');
    setErrorMsg('');
    setTab('input');
    setSeriesData(data);
    clearTextExport();
    if (data?.series_title) translateText(data.series_title).catch(() => {});
    setSelectedVids(new Set(data.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid)));
    setSuccessMsg(`Đã chọn《${data.series_title}》tổng cộng ${data.total} tập, có thể phát trực tiếp hoặc gửi tải về`);
    document.querySelector('.main-content:not([hidden])')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phân tích phim ngắn Hồng Quả
  const handleResolve = async () => {
    if (!inputUrl.trim()) {
      setErrorMsg('Vui lòng nhập liên kết chia sẻ phim ngắn Hồng Quả hoặc ID phim');
      return;
    }
    const value = inputUrl.trim();
    if (pendingResolve.current?.value === value) return;
    const request = ++resolveRequest.current;
    pendingResolve.current = { value, request };
    setRangeInput('');
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setSeriesData(null);
    clearTextExport();
    setSelectedVids(new Set());

    try {
      const res = await window.electronAPI.hongguoResolve(value);
      if (request !== resolveRequest.current) return;
      if (res?.success && res.data) {
        setSeriesData(res.data);
        if (res.data.series_title) translateText(res.data.series_title).catch(() => {});
        // Mặc định chọn tất cả, các tập mà trang web chưa cung cấp sẽ tự động thử nguồn App.
        const allVids = new Set(res.data.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid));
        setSelectedVids(allVids);
        setSuccessMsg(`Phân tích thành công! Tìm thấy《${res.data.series_title}》tổng cộng ${res.data.total} tập`);
      } else {
        setErrorMsg(res?.error || 'Phân tích thất bại, vui lòng kiểm tra liên kết hoặc mạng');
      }
    } catch (err) {
      if (request === resolveRequest.current) setErrorMsg('Lỗi trong quá trình phân tích: ' + err.message);
    } finally {
      if (pendingResolve.current?.request === request) pendingResolve.current = null;
      if (request === resolveRequest.current) setLoading(false);
    }
  };

  // Chọn / Bỏ chọn tập đơn
  const toggleVid = (vid) => {
    if (!seriesData?.episodes.some((ep) => ep.vid === vid && !ep.locked)) return;
    const next = new Set(selectedVids);
    if (next.has(vid)) {
      next.delete(vid);
    } else {
      next.add(vid);
    }
    setSelectedVids(next);
  };

  // Chọn tất cả
  const handleSelectAll = () => {
    if (!seriesData) return;
    setSelectedVids(new Set(seriesData.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid)));
  };

  // Đảo chọn
  const handleInvertSelect = () => {
    if (!seriesData) return;
    const next = new Set();
    for (const ep of seriesData.episodes) {
      if (!ep.locked && !selectedVids.has(ep.vid)) {
        next.add(ep.vid);
      }
    }
    setSelectedVids(next);
  };

  // Xóa lựa chọn
  const handleDeselectAll = () => {
    setSelectedVids(new Set());
  };

  // Chọn tập nhanh
  const handleQuickSelect = (type) => {
    if (!seriesData || !seriesData.episodes) return;
    const eps = seriesData.episodes;
    const total = eps.length;
    let targetEps = [];
    if (type === 'first10') {
      targetEps = eps.slice(0, 10);
    } else if (type === 'first30') {
      targetEps = eps.slice(0, 30);
    } else if (type === 'last30') {
      targetEps = eps.slice(Math.max(0, total - 30));
    }
    setSelectedVids(new Set(targetEps.filter((ep) => !ep.locked).map((ep) => ep.vid)));
  };

  // Áp dụng bộ lọc theo chuỗi khoảng (ví dụ: "1-30" hoặc "1,5,10-20")
  const handleApplyRange = () => {
    if (!seriesData?.episodes) return;
    try {
      const nums = parseEpisodeRange(rangeInput, seriesData.episodes.length);
      setSelectedVids(new Set(seriesData.episodes.filter((ep) => !ep.locked && nums.has(ep.vid_index)).map((ep) => ep.vid)));
      setErrorMsg('');
    } catch (error) { setErrorMsg(error.message); }
  };

  const handlePlay = async () => {
    if (!seriesData || !firstPlayable || playPending.current) return;
    const request = resolveRequest.current;
    playPending.current = true;
    setOpeningPlayer(true);
    setErrorMsg('');
    try {
      const res = await window.electronAPI.playSeries({ seriesId: seriesData.series_id, vidIndex: firstPlayable.vid_index });
      if (!res?.success && request === resolveRequest.current) setErrorMsg(res?.error || 'Mở trình phát thất bại, vui lòng thử lại');
    } catch (error) {
      if (request === resolveRequest.current) setErrorMsg('Mở trình phát thất bại: ' + error.message);
    } finally {
      playPending.current = false;
      setOpeningPlayer(false);
    }
  };

  // Gửi tải xuống hàng loạt
  const handleBatchDownload = async () => {
    if (!seriesData || selectedVids.size === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một tập phim ngắn cần tải về');
      return;
    }
    const kinds = isHongguoSource ? { ...exportKinds } : { danmaku: false, comments: false, reviews: false };
    const wantExport = kinds.danmaku || kinds.comments || kinds.reviews;
    const request = { requestId: crypto.randomUUID(), seriesId: seriesData.series_id, kinds, done: !wantExport };
    textExportRequest.current = request;
    setExportNote(wantExport ? 'Đang xuất dữ liệu văn bản trong nền…' : '');
    setExportSettingsNote('');
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const selectedEps = seriesData.episodes.filter((ep) => !ep.locked && selectedVids.has(ep.vid));
      const transConfig = getTranslationConfig();
      let targetTitle = seriesData.series_title;
      if (transConfig.vietnamese_filenames) {
        const viTitle = getCachedTranslation(seriesData.series_title);
        if (viTitle && viTitle !== seriesData.series_title) {
          targetTitle = viTitle;
        }
      }
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: seriesData.series_id,
        seriesTitle: targetTitle,
        episodes: selectedEps,
        quality: downloadQuality,
        export: kinds,
        requestId: request.requestId,
      });
      const isCurrent = () => textExportRequest.current === request && seriesIdRef.current === request.seriesId;
      if (res.success) {
        if (isHongguoSource) {
          // Lưu tùy chọn thất bại không làm thay đổi tác vụ video đã gửi hoặc kết quả xuất nền.
          Promise.resolve().then(() => window.electronAPI.saveSettings({ export_text: kinds })).then(saved => {
            if (!saved?.success) throw new Error(saved?.error || 'Vui lòng thử lại sau');
          }).catch(error => {
            if (isCurrent()) setExportSettingsNote(`Tùy chọn xuất chưa được lưu: ${error.message || 'Vui lòng thử lại sau'}; tác vụ video lần này đã gửi, xuất văn bản không bị ảnh hưởng.`);
          });
        }
        if (isCurrent()) setSuccessMsg(`Đã gửi thành công ${res.count} tập vào hàng đợi tải về! Nhấn nút bên dưới để chuyển sang "Quản lý tải về" xem tiến độ theo thời gian thực.`);
      } else if (isCurrent()) {
        textExportRequest.current = null;
        setExportNote('');
        setErrorMsg(res.error || 'Gửi tải về thất bại');
      }
    } catch (err) {
      if (textExportRequest.current === request && seriesIdRef.current === request.seriesId) {
        textExportRequest.current = null;
        setExportNote('');
        setErrorMsg('Lỗi khi gửi tải về: ' + err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hongguo-container">
      {/* Khu vực Banner đầu trang */}
      <div className="hongguo-hero">
        <div className="hero-icon">
          <Film size={32} />
        </div>
        <div className="hero-text">
          <h2>Tìm câu chuyện hay tiếp theo</h2>
          <p>Tìm theo tên phim hoặc dán liên kết chia sẻ. Chọn các tập yêu thích và lưu về máy để thưởng thức từ từ.</p>
        </div>
      </div>

      {/* Chuyển đổi phương thức */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => switchTab('search')}
        >
          <Search size={16} />
          <span>Tìm kiếm phim</span>
        </button>
        <button
          className={`mode-tab ${tab === 'input' ? 'active' : ''}`}
          onClick={() => switchTab('input')}
        >
          <Link2 size={16} />
          <span>Dán liên kết / ID</span>
        </button>
      </div>

      <div hidden={tab !== 'search'}>
        <SearchPanel
          active={active && tab === 'search'}
          onSelectSeries={handleSeriesFromSearch}
          onSwitchToInput={() => switchTab('input')}
        />
      </div>
      {tab === 'input' && (
        /* Thẻ nhập phân tích */
        <div className="hongguo-card">
          <div className="card-header-title">
            <Link2 size={18} />
            <span>Nhập liên kết phim ngắn hoặc ID</span>
          </div>
          <div className="input-group">
            <input
              type="text"
              className="input-field"
              aria-label="Liên kết chia sẻ phim ngắn hoặc ID phim"
              placeholder="Dán liên kết chia sẻ phim ngắn, hoặc nhập ID phim"
              value={inputUrl}
              onChange={(e) => { resolveRequest.current++; pendingResolve.current = null; setLoading(false); setInputUrl(e.target.value); }}
              onKeyDown={(e) => isSubmitKey(e) && handleResolve()}
            />
            <button className="btn btn-outline" disabled={loading} onClick={async () => {
              try {
                const text = (await navigator.clipboard.readText()).trim();
                if (!text || text.length > 4096) throw new Error('Bộ nhớ tạm trống hoặc nội dung quá dài, vui lòng tự dán liên kết phim ngắn');
                resolveRequest.current++;
                pendingResolve.current = null;
                setInputUrl(text);
                setErrorMsg('');
                setSuccessMsg('Đã dán, vui lòng xác nhận liên kết rồi lấy danh sách tập');
              } catch (error) { setErrorMsg(error.message || 'Đọc bộ nhớ tạm thất bại, vui lòng tự dán'); }
            }}>Dán liên kết</button>
            <button className="btn btn-primary" onClick={handleResolve} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>Đang phân tích...</span>
                </>
              ) : (
                <>
                  <Film size={16} />
                  <span>Lấy danh sách tập</span>
                </>
              )}
            </button>
          </div>

          {errorMsg && <div className="alert alert-error" role="alert">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success" role="status">{successMsg}</div>}
        </div>
      )}

      {/* Thông báo trong chế độ tìm kiếm (thẻ phân tích đã được thay thế, hiển thị riêng ở đây) */}
      {tab === 'search' && (errorMsg || successMsg) && (
        <div className="hongguo-card" style={{ marginTop: 0 }}>
          {errorMsg && <div className="alert alert-error" role="alert">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success" role="status">{successMsg}</div>}
        </div>
      )}

      {/* Danh sách tập và điều khiển lựa chọn */}
      {seriesData && (
        <div className="hongguo-card episode-section">
          {/* Siêu dữ liệu phim ngắn */}
          <div className="series-header">
            <div className="series-info">
              {seriesData.cover ? (
                <img src={seriesData.cover} alt={seriesData.series_title} className="series-cover" />
              ) : (
                <div className="series-cover-placeholder">
                  <Film size={28} />
                </div>
              )}
              <div className="series-meta">
                <DramaTitle title={seriesData.series_title} as="h3" className="series-title">{seriesData.series_title}</DramaTitle>
                <div className="series-tags">
                  <span className="badge">{mediaSourceLabel(seriesData.series_id, mediaSources)}</span>
                  <span className="badge">Tổng cộng {seriesData.total} tập</span>
                  <span className="badge badge-secondary">Đã chọn {selectedVids.size} tập</span>
                </div>
              </div>
            </div>

            <div className="batch-action-bar">
              <div className="batch-action-row">
                <button className="btn btn-outline" onClick={handlePlay}
                  disabled={openingPlayer || !firstPlayable}
                  title={firstPlayable ? 'Phát trong Kho phim của tôi, các tập chưa tải sẽ được phát trực tuyến' : 'Phim hiện tại không có tập nào phát được'}>
                  {openingPlayer ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
                  <span>{openingPlayer ? 'Đang mở…' : 'Phát ngay'}</span>
                </button>
                <label className="batch-quality-control">
                  <span>Độ phân giải tải về</span>
                  <select className="input-field" value={downloadQuality}
                    aria-describedby="batch-quality-hint" disabled={qualityLoading || submitting}
                    onChange={(event) => setDownloadQuality(event.target.value)}>
                    <option value="auto">Tự động (Ưu tiên tương thích)</option>
                    <option value="1080p">1080P</option>
                    <option value="720p">720P</option>
                  </select>
                </label>
                <button
                  className="btn btn-primary"
                  onClick={handleBatchDownload}
                  disabled={qualityLoading || submitting || selectedVids.size === 0}
                >
                  <Download size={16} />
                  <span>Tải về các tập đã chọn ({selectedVids.size}/{seriesData.total})</span>
                </button>
                {onNavigate && (
                  <button className="btn btn-outline" onClick={() => onNavigate('manager')}>
                    <Folder size={16} />
                    <span>Xem Quản lý tải về</span>
                  </button>
                )}
              </div>
              {isHongguoSource && (
                <div className="batch-export-controls" role="group" aria-label="Dữ liệu văn bản xuất cùng khi tải về">
                  <span className="batch-export-title">Xuất kèm khi tải</span>
                  {[['danmaku', 'Danmaku'], ['comments', 'Bình luận'], ['reviews', 'Đánh giá']].map(([key, label]) => (
                    <label key={key} className="batch-export-check">
                      <input type="checkbox" aria-label={label} checked={exportKinds[key]}
                        disabled={qualityLoading || submitting}
                        onChange={(event) => setExportKinds(prev => ({ ...prev, [key]: event.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                  {exportNote && <span className="batch-export-note" role="status">{exportNote}</span>}
                  {exportSettingsNote && <span className="batch-export-note" role="alert">{exportSettingsNote}</span>}
                </div>
              )}
            </div>
          </div>

          <p className="settings-hint batch-quality-hint" id="batch-quality-hint">Áp dụng cho các tác vụ tải về mới; khi độ phân giải nguồn Hồng Quả đã chọn không khả dụng hoặc tải thất bại, sẽ tự động thử độ phân giải thấp hơn và thông báo trong quản lý tải về. Các tệp đã có sẵn sẽ không bị tự động xóa hoặc ghi đè.</p>

          {seriesData.web_accessible_episodes != null && seriesData.web_accessible_episodes < seriesData.total && (
            <p className="settings-hint">Nguồn web cung cấp {seriesData.web_accessible_episodes} tập đầu, các tập sau tự động thử nguồn App.</p>
          )}

          {seriesData.episodes.some((ep) => ep.locked) && <p className="settings-hint">Tập bị khóa cần mở khóa trên nền tảng gốc, ứng dụng không cung cấp tính năng mở khóa; chọn tất cả và chọn phạm vi sẽ tự động bỏ qua.</p>}

          {/* Thanh lọc và thao tác */}
          <div className="controls-row">
            <div className="select-buttons">
              <button className="btn-chip" onClick={handleSelectAll}>Chọn tất cả</button>
              <button className="btn-chip" onClick={handleInvertSelect}>Đảo lựa chọn</button>
              <button className="btn-chip" onClick={handleDeselectAll}>Hủy chọn tất cả</button>
              <span className="divider"></span>
              <button className="btn-chip" onClick={() => handleQuickSelect('first10')}>10 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('first30')}>30 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('last30')}>30 tập cuối</button>
            </div>

            <div className="range-filter">
              <span className="range-label">Lọc phạm vi:</span>
              <input
                type="text"
                className="range-input"
                aria-label="Chọn phạm vi số tập"
                placeholder="Ví dụ 1-30 hoặc 1,5,10"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                onKeyDown={(e) => isSubmitKey(e) && handleApplyRange()}
              />
              <button className="btn-chip btn-chip-primary" onClick={handleApplyRange}>Áp dụng</button>
            </div>
          </div>

          {/* Danh sách lưới tập phim */}
          <div className="episode-grid">
            {seriesData.episodes.map((ep) => {
              const isChecked = selectedVids.has(ep.vid);
              return (
                <button
                  type="button"
                  disabled={ep.locked === true}
                  title={ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : undefined}
                  aria-pressed={isChecked}
                  key={ep.vid}
                  className={`episode-card ${isChecked ? 'selected' : ''}`}
                  onClick={() => toggleVid(ep.vid)}
                >
                  <div className="checkbox-icon">
                    {isChecked ? <CheckSquare size={18} className="icon-checked" /> : <Square size={18} className="icon-unchecked" />}
                  </div>
                  <div className="episode-info">
                    <span className="episode-num">Tập {String(ep.vid_index).padStart(2, '0')}</span>
                    {ep.locked ? <span className="episode-title">Khóa · Cần mở khóa ở nguồn</span> : ep.title && <span className="episode-title">{ep.title}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default HongguoDownload;
