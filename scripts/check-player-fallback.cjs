// In-memory Player behavior only; no real media, network, or user files.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = ui => ui.find(n => n.type === 'video').props.src;
const alert = ui => ui.find(n => n.props.role === 'alert');
const poll = async ui => { ui.changed(); await [...ui.timers.values()].find(t => t.delay === 2000).fn(); await ui.flush(); };
function fixture({ prepare, transcode, enqueue, quality = '720p', initial = 'missing' } = {}) {
  const states = new Map([['A:1', initial]]), downloads = [], stops = [];
  let changed;
  const props = { target: { seriesId: 'A', vidIndex: 1, ts: 1 } };
  const ui = mount({ props, transcode, prepare: prepare || (async () => ({ success: false, error: '本集取源失败' })),
    settings: { download_quality: quality, cache_next_episode: false },
    apiOverrides: {
      onDownloadQueueChanged: fn => { changed = fn; return () => {}; },
      getSeriesList: async () => [{ series_id: 'A' }, { series_id: 'B' }],
      getSeriesEpisodes: async sid => ({ success: true, data: { series_id: sid, total: 2,
        episodes: [1, 2].map(index => { const status = states.get(`${sid}:${index}`) || 'missing'; return {
          vid: `${sid}-${index}`, vid_index: index, status, taskId: status === 'missing' ? null : `task-${sid}-${index}`,
          ...(status === 'completed' ? { fileUrl: `file:///${sid}-${index}.mp4`, savePath: `/${sid}-${index}.mp4` } : {}),
        }; }),
      } }),
      downloadSingleEpisode: async (sid, index, quality) => {
        downloads.push({ sid, index, quality });
        if (enqueue) return enqueue(sid, index, quality);
        const existed = ['pending', 'downloading'].includes(states.get(`${sid}:${index}`));
        states.set(`${sid}:${index}`, 'pending'); return { success: true, count: existed ? 0 : 1 };
      },
      stopDownload: async id => { stops.push(id); return { success: true }; },
    },
  });
  ui.changed = () => changed?.();
  return { ui, states, downloads, stops };
}

(async () => {
  let failures = 0;
  const test = async (name, fn) => { if (process.argv[2] && !name.includes(process.argv[2])) return;
    try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${e.stack}`); } };
  await test('failed prepare refreshes and chooses an already completed local file', async () => {
    const pending = defer(), f = fixture({ prepare: () => pending.promise }); await f.ui.flush();
    f.states.set('A:1', 'completed'); pending.resolve({ success: false, error: '本集取源失败' }); await f.ui.flush();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.downloads.length, 0); assert.equal(alert(f.ui), undefined);
    f.ui.metadata(); assert.equal(f.ui.media.paused, false); f.ui.unmount();
  });
  // Quy tắc: phát trực tuyến lỗi không bao giờ tự đưa tập vào hàng đợi tải; chỉ người dùng mới được quyết định tải.
  await test('online failure reports the error and never queues a download by itself', async () => {
    const f = fixture(); await f.ui.flush(); await poll(f.ui);
    assert.equal(f.downloads.length, 0, 'no download may start without the user');
    assert.equal(f.states.get('A:1'), 'missing'); assert.equal(f.ui.button('取消等待'), undefined);
    assert(alert(f.ui)); f.ui.unmount();
  });
  await test('explicit retry replays the online quality ladder but still never downloads', async () => {
    const f = fixture(); await f.ui.flush();
    const before = f.ui.prepares.length;
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush(); await poll(f.ui);
    assert.ok(f.ui.prepares.length > before, 'retry tries online playback again');
    assert.equal(f.downloads.length, 0); assert(alert(f.ui)); f.ui.unmount();
  });
  await test('retry uses refreshed local instead of a stale online choice', async () => {
    const f = fixture(); await f.ui.flush();
    const attempts = f.ui.prepares.length;
    f.states.set('A:1', 'completed'); await f.ui.button('重试本集').props.onClick(); await f.ui.flush();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.ui.prepares.length, attempts); assert.equal(f.downloads.length, 0); f.ui.unmount();
  });
  await test('a download the user already started is awaited and plays when it completes', async () => {
    const f = fixture({ initial: 'pending' }); await f.ui.flush();
    assert.equal(f.downloads.length, 0); assert(f.ui.button('取消等待'));
    f.states.set('A:1', 'completed'); await poll(f.ui); f.ui.metadata();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(alert(f.ui), undefined); f.ui.unmount();
  });
  await test('cancel only revokes playback intent and leaves shared downloads alone', async () => {
    const f = fixture({ initial: 'downloading' }); await f.ui.flush();
    assert(f.ui.button('取消等待')); f.ui.button('取消等待').props.onClick(); await f.ui.flush();
    f.states.set('A:1', 'completed'); await poll(f.ui);
    assert.notEqual(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.stops.length, 0); assert(alert(f.ui)); f.ui.unmount();
  });
  for (const status of ['failed', 'stopped']) await test(`a ${status} download the user started ends waiting and is not requeued`, async () => {
    const f = fixture({ initial: 'pending' }); await f.ui.flush();
    f.states.set('A:1', status); await poll(f.ui);
    assert(alert(f.ui)); assert.equal(f.ui.button('取消等待'), undefined);
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush(); await poll(f.ui);
    assert.equal(f.downloads.length, 0, 'the app must not requeue failed downloads'); f.ui.unmount();
  });
  await test('exhausted media error recovery keeps position and paused intent without downloading', async () => {
    for (const code of [2, 4]) {
      const f = fixture({ prepare: async () => ({ success: true, url: 'hongguo-stream://unavailable' }) });
      await f.ui.flush(); f.ui.metadata(); f.ui.media.currentTime = 29; f.ui.media.pause();
      for (let attempt = 0; attempt < 3; attempt++) { f.ui.error(code); await f.ui.flush(); f.ui.metadata(); }
      assert.equal(f.downloads.length, 0, 'media error ' + code); assert.equal(f.ui.button('取消等待'), undefined); assert(alert(f.ui));
      assert.equal(f.ui.media.paused, true); f.ui.unmount();
    }
  });
  await test('failed online decode conversion does not turn into a download either', async () => {
    const f = fixture({ prepare: async () => ({ success: true, url: 'hongguo-stream://bad-codec' }),
      transcode: async () => ({ success: false, error: '无法转换片源' }) });
    await f.ui.flush(); f.ui.metadata(); f.ui.media.currentTime = 16; f.ui.media.pause();
    for (let attempt = 0; attempt < 3; attempt++) { f.ui.error(3); await f.ui.flush(); f.ui.metadata(); }
    assert.equal(f.downloads.length, 0); assert(alert(f.ui)); f.ui.unmount();
  });
  process.exitCode = failures ? 1 : 0;
})();
