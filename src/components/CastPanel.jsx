import React, { useEffect, useRef, useState } from 'react';
export default function CastPanel({ seriesId, episode, title, videoRef }) {
  const [open,setOpen]=useState(false), [devices,setDevices]=useState([]), [busy,setBusy]=useState(false), [error,setError]=useState(''), [target,setTarget]=useState('');
  const operation = useRef(null);
  const cancel = () => {
    const pending = operation.current;
    if (!pending) return;
    pending.cancelled = true;
    if (pending.requestId) void window.electronAPI.releaseOnlinePlay({ requestId: pending.requestId }).catch(() => {});
    if (pending.connecting) void window.electronAPI.controlCasting('Stop').catch(() => {});
  };
  useEffect(() => () => { if (operation.current?.requestId) cancel(); }, [seriesId, episode?.vid]);
  useEffect(() => () => { cancel(); void window.electronAPI.controlCasting('Stop').catch(() => {}); }, []);
  const run = async action => {
    if (operation.current) return;
    const pending = { cancelled: false };
    operation.current = pending;
    setBusy(true); setError('');
    try { await action(pending); }
    catch (e) { if (!pending.cancelled) setError(e.message); }
    finally { if (operation.current === pending) { operation.current = null; setBusy(false); } }
  };
  const check=result=>{if(!result?.success)throw new Error(result?.error || 'Truyền màn hình thất bại');return result;};
  const syncStatus=result=>{if(typeof result?.active==='boolean')setTarget(result.active ? result.name || '' : '');};
  const scan=()=>run(async pending=>{ const result = check(await window.electronAPI.discoverCastDevices()); if (!pending.cancelled) setDevices(result.devices); });
  const start=id=>run(async pending=>{
    if (!episode || episode.locked) return;
    pending.requestId = crypto.randomUUID();
    let prepared;
    try {
      if (!episode.fileUrl) prepared=check(await window.electronAPI.prepareOnlinePlay({seriesId,vid:episode.vid,vidIndex:episode.vid_index,requestId:pending.requestId,prefetch:true}));
      if (pending.cancelled) return;
      pending.connecting = true;
      const result=await window.electronAPI.startCasting({deviceId:id,source:episode.fileUrl || prepared.url,title:`${title} Tập ${episode.vid_index}`});
      syncStatus(result);check(result);
      if (pending.cancelled) { const stopped=await window.electronAPI.controlCasting('Stop');syncStatus(stopped);return; }
      videoRef.current?.pause();
    } finally {if(prepared?.streamId)await window.electronAPI.releaseOnlinePlay({streamId:prepared.streamId}).catch(() => {});}
  });
  const control=action=>run(async()=>{const result=await window.electronAPI.controlCasting(action);syncStatus(result);check(result);});
  return <div className="cast-panel">
    <button className="btn btn-outline btn-sm" disabled={!episode || episode.locked} onClick={()=>{setOpen(!open);if(!open)scan();}}>Truyền màn hình (Cast){target ? ` · ${target}` : ''}</button>
    {open && <section aria-label="Truyền màn hình TV" style={{padding:12,border:'1px solid var(--border)',borderRadius:8}}>
      <p>Máy tính và TV cần kết nối cùng mạng LAN, TV cần bật DLNA. Trước khi truyền sẽ lưu đệm tập này; hỗ trợ định dạng tùy thuộc vào TV.</p>
      <button className="btn btn-outline btn-sm" disabled={busy} onClick={scan}>{busy?'Đang xử lý…':'Tìm kiếm lại TV'}</button>
      {!busy && !devices.length && <p>Không tìm thấy TV, vui lòng kiểm tra cài đặt truyền màn hình trên TV và tường lửa máy tính.</p>}
      {devices.map(device=><button className="btn btn-outline btn-sm" disabled={busy} key={device.id} onClick={()=>start(device.id)}>{device.name}</button>)}
      {busy && <button className="btn btn-outline btn-sm" onClick={cancel}>Hủy thao tác này</button>}
      {target && <div role="group" aria-label="Điều khiển truyền màn hình">{[['Play','Phát'],['Pause','Tạm dừng'],['Stop','Dừng']].map(([action,label])=><button className="btn btn-outline btn-sm" key={action} disabled={busy} onClick={()=>control(action)}>{label}</button>)}</div>}
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
