import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from './icons';
import useDialogKeyboard from './useDialogKeyboard';
import './AnnouncementNotice.css';

const PURCHASE_URL = 'https://vipai.pro/';
const FEEDBACK_URL = 'https://github.com/jackotom/hongguo-drama/issues';
const FEEDBACK_EMAIL = 'jaoktom@outlook.com';

const ANNOUNCEMENT_TRANSLATIONS = [
  [/红果短剧\s*([0-9.]+)\s*已更新/g, 'Phim Ngắn Hồng Quả $1 đã cập nhật'],
  [/红果短剧\s*已更新/g, 'Phim Ngắn Hồng Quả đã cập nhật'],
  [/红果短剧/g, 'Phim Ngắn Hồng Quả'],
  [/已更新/g, 'đã cập nhật'],
  [/紧急公告/g, 'Thông báo khẩn cấp'],
  [/播放提示/g, 'Nhắc nhở phát lại'],
  [/功能建议/g, 'Góp ý tính năng'],
  [/欢迎反馈。?/g, 'Hoan nghênh mọi phản hồi.'],
  [/平台接口、设备校验或网络可能影响播放。?/g, 'Giao diện nền tảng, xác thực thiết bị hoặc mạng có thể ảnh hưởng đến việc phát.'],
  [/恢复播放取源请求签名，改善播放与下载失败。?/g, 'Khôi phục chữ ký yêu cầu lấy nguồn phát, cải thiện sự cố phát và tải về thất bại. '],
  [/增加官网登录备用入口、按剧清理播放缓存、观看记录分组与 DLNA 单集投屏。?/g, 'Bổ sung lối vào đăng nhập dự phòng từ trang web chính thức, dọn dẹp bộ nhớ đệm phát theo từng bộ phim, phân nhóm lịch sử xem và truyền phát DLNA từng tập lên TV. '],
  [/官网提供的登录方式、电视格式支持以实际设备为准；?/g, 'Phương thức đăng nhập và hỗ trợ định dạng TV do trang web cung cấp tùy thuộc vào thiết bị thực tế; '],
  [/上游间歇获取源失败仍可重试本集。?/g, 'khi nguồn upstream chập chờn lấy nguồn thất bại vẫn có thể thử lại tập này.'],
  [/说明和三端下载[：:]/g, 'Thuyết minh và tải về cho cả 3 nền tảng: '],
  [/说明和三端下载/g, 'Thuyết minh và tải về cho cả 3 nền tảng'],
  [/具体产品、价格及开通方式，以网站页面说明为准。?/g, 'Sản phẩm cụ thể, giá cả và phương thức kích hoạt căn cứ theo hướng dẫn trên trang web.'],
  [/邮箱[：:]/g, 'Email: '],
  [/发布/g, 'Phát hành'],
  [/更新/g, 'Cập nhật'],
  [/修复/g, 'Sửa lỗi'],
];

function translateAnnouncementText(text) {
  if (!text || typeof text !== 'string') return text;
  let s = text;
  for (const [regex, rep] of ANNOUNCEMENT_TRANSLATIONS) {
    s = s.replace(regex, rep);
  }
  return s;
}

function translateNotice(item) {
  if (!item) return item;
  return {
    ...item,
    title: translateAnnouncementText(item.title),
    body: translateAnnouncementText(item.body),
  };
}

export default function AnnouncementNotice() {
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [emailCopied, setEmailCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [portalTarget, setPortalTarget] = useState(() => document.fullscreenElement || document.body);
  const shown = useRef(new Set());
  const savingRef = useRef(false);
  const copyRequest = useRef(0);
  const close = () => { copyRequest.current++; setEmailCopied(false); setNotice(null); };
  useDialogKeyboard(!!notice, close, '.announcement-dialog', portalTarget);

  useEffect(() => {
    const sync = () => setPortalTarget(document.fullscreenElement || document.body);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.checkAnnouncements) return;
    let active = true, pending = false, recheck = false, timer, queued = null;
    let preferences = null, preferenceRevision = 0;
    const allowed = item => item && preferences?.[item.urgent ? 'emergencyEnabled' : 'normalEnabled'];
    const present = item => {
      if (!active || !item || (!item.manual && !allowed(item))) return;
      if (document.hidden) { queued = item; return; }
      const key = `${item.urgent ? 'urgent' : 'normal'}:${item.id}`;
      if (!item.manual && shown.current.has(key)) return;
      shown.current.add(key);
      queued = null;
      setError('');
      const translated = translateNotice(item);
      setNotice(current => current?.urgent && !translated.urgent && !translated.manual ? current : translated);
    };
    const check = async urgentOnly => {
      if (!active || !preferences || !preferences.normalEnabled && !preferences.emergencyEnabled) return;
      if (pending) { if (!urgentOnly) recheck = true; return; }
      pending = true;
      try {
        const result = await api.checkAnnouncements({ urgentOnly });
        if (active) present(result?.announcement);
      } catch { /* Không thể truy cập thông báo không ảnh hưởng đến phát, cũng không thử lại liên tục ngầm. */ }
      finally {
        pending = false;
        if (active && recheck) { recheck = false; check(false); }
      }
    };
    const applyPreferences = next => {
      const emergencyChanged = preferences?.emergencyEnabled !== (next?.emergencyEnabled !== false);
      preferences = { normalEnabled: next?.normalEnabled !== false, emergencyEnabled: next?.emergencyEnabled !== false };
      setNotice(current => current?.manual || allowed(current) ? current : null);
      if (!queued?.manual && !allowed(queued)) queued = null;
      if (emergencyChanged) {
        clearInterval(timer);
        if (preferences.emergencyEnabled) timer = setInterval(() => check(true), 5 * 60 * 1000);
      }
    };
    const unsubscribe = api.onAnnouncementPreferences(next => {
      preferenceRevision++;
      applyPreferences(next);
      check(false);
    });
    const revision = preferenceRevision;
    api.getAnnouncementPreferences().then(next => {
      if (!active || revision !== preferenceRevision) return;
      applyPreferences(next);
      check(false);
    }).catch(() => {});
    const reveal = () => { if (!document.hidden && queued) present(queued); };
    const showCurrent = event => {
      const item = event.detail;
      if (item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string') present({ ...item, manual: true });
    };
    document.addEventListener('visibilitychange', reveal);
    window.addEventListener('hongguo-show-current-announcement', showCurrent);
    return () => {
      active = false; clearInterval(timer); unsubscribe();
      document.removeEventListener('visibilitychange', reveal);
      window.removeEventListener('hongguo-show-current-announcement', showCurrent);
    };
  }, []);

  useEffect(() => {
    setEmailCopied(false);
    copyRequest.current++;
    if (!notice) return;
    let active = true;
    const timer = setTimeout(close, 30000);
    if (notice.urgent) {
      window.electronAPI.acknowledgeAnnouncement({ id: notice.id }).then(result => {
        if (active && !result?.success) setError(result?.error || 'Không thể lưu trạng thái đã đọc, sau khi khởi động lại có thể sẽ nhắc lại.');
      }).catch(() => { if (active) setError('Không thể lưu trạng thái đã đọc, sau khi khởi động lại có thể sẽ nhắc lại.'); });
    }
    return () => { active = false; copyRequest.current++; clearTimeout(timer); };
  }, [notice]);

  const dismiss = async mode => {
    if (savingRef.current || !notice) return;
    const current = notice;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await window.electronAPI.dismissAnnouncement({ mode });
      if (!result?.success) { setError(result?.error || 'Lưu thất bại, vui lòng thử lại; cài đặt nhắc nhở ban đầu không đổi.'); return; }
      setNotice(next => next === current ? null : next);
    } catch { setError('Lưu thất bại, vui lòng thử lại; cài đặt nhắc nhở ban đầu không đổi.'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const openLink = async (event, url) => {
    event.preventDefault();
    setError('');
    try {
      const result = await window.electronAPI.openExternalUrl(url);
      if (!result?.success) setError(result?.error || 'Mở liên kết thất bại, vui lòng thử lại sau.');
    } catch { setError('Mở liên kết thất bại, vui lòng thử lại sau.'); }
  };

  const copyEmail = async () => {
    const request = ++copyRequest.current;
    setEmailCopied(false);
    setError('');
    try {
      await navigator.clipboard.writeText(FEEDBACK_EMAIL);
      if (request === copyRequest.current) setEmailCopied(true);
    } catch {
      if (request === copyRequest.current) setError(`Sao chép thất bại, vui lòng sao chép email thủ công: ${FEEDBACK_EMAIL}`);
    }
  };

  if (!notice) return null;
  return createPortal(<div className="announcement-mask">
    <section className="announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-title" aria-describedby="announcement-body" tabIndex={-1}>
      <header className="announcement-heading">
        <h2 id="announcement-title">{notice.title}</h2>
        <button type="button" className="icon-btn" aria-label="Đóng thông báo" title="Đóng thông báo" onClick={close}><X size={18} /></button>
      </header>
      {notice.urgent && <p className="announcement-urgent">Thông báo khẩn · {notice.manual ? 'Xem thủ công' : 'Chỉ nhắc nhở một lần'}</p>}
      <div id="announcement-body" className="announcement-body">{notice.body.split(/\r?\n\r?\n/).map((paragraph, index) =>
        <p className="announcement-paragraph" key={index}>{paragraph.includes('vipai.pro')
          ? <a className="announcement-link announcement-purchase-link" href={PURCHASE_URL} title="Mở vipai.pro trong trình duyệt" onClick={event => openLink(event, PURCHASE_URL)}>{paragraph}</a>
          : paragraph.split(/(\r?\n)/).map((line, part) => {
            if (line.includes(FEEDBACK_URL)) return <a className="announcement-link" href={FEEDBACK_URL} key={part} onClick={event => openLink(event, FEEDBACK_URL)}>{line}</a>;
            const releaseMatch = line.match(/https:\/\/github\.com\/jackotom\/hongguo-drama\/releases[^\s]*/);
            if (releaseMatch) return <a className="announcement-link" href={releaseMatch[0]} key={part} onClick={event => openLink(event, releaseMatch[0])}>{line}</a>;
            return line.includes(FEEDBACK_EMAIL) ? <button type="button" className="announcement-link" key={part} onClick={copyEmail}>{line}</button> : line;
          })}</p>
      )}</div>
      <p className="announcement-hint">Tự động đóng sau 30 giây. {notice.urgent ? 'Tùy chọn bên dưới chỉ áp dụng cho thông báo thường, thông báo khẩn mới vẫn sẽ nhắc nhở.' : 'Tùy chọn bên dưới chỉ áp dụng cho thông báo thường.'}</p>
      {emailCopied && <p className="announcement-copy-status" role="status">Đã sao chép email</p>}
      {error && <p className="announcement-error" role="alert">{error}</p>}
      <footer className="announcement-actions">
        <button type="button" className="btn btn-outline" disabled={saving} onClick={() => dismiss('version')}>Không nhắc lại trước khi cập nhật bản mới</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => dismiss('day')}>Hôm nay không nhắc lại</button>
      </footer>
    </section>
  </div>, portalTarget);
}
