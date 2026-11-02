const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');

const openEpisode = async (options = {}) => {
  const ui = mount({
    ...options,
    props: { setEpisodesOpen() {}, target: { seriesId: 'A', vidIndex: 1, ts: 1 }, ...(options.props || {}) },
  });
  await ui.flush();
  ui.metadata();
  await ui.flush();
  return ui;
};
const prefetches = ui => ui.prepares.filter(item => item.prefetch === true);
const tick = (ui, time) => {
  ui.media.currentTime = time;
  ui.find(node => node.type === 'video').props.onTimeUpdate?.({ currentTarget: ui.media });
};
const messageMap = {
  '正在连接片源…': 'Đang kết nối nguồn phim…',
  '正在加载视频…': 'Đang tải video…',
  '正在缓冲在线播放…': 'Đang tải đệm phát trực tuyến…',
};
const paragraph = (ui, message) => {
  const vn = messageMap[message];
  return ui.find(node => node.type === 'p'
    && (node.children?.join('') === message || (vn && node.children?.join('') === vn)));
};
const renderWithoutBuffering = ui => {
  ui.render();
  for (const message of ['正在加载视频…', '正在缓冲在线播放…']) {
    assert.equal(paragraph(ui, message), undefined, `unexpected buffering overlay: ${message}`);
  }
};
const flushWithoutBuffering = async ui => {
  // Observe the synchronous handoff and every microtask render, matching the fixture's flush cadence.
  renderWithoutBuffering(ui);
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    renderWithoutBuffering(ui);
  }
};

(async () => {
  let failures = 0;
  const test = async (name, fn) => {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error.stack || error.message)); }
  };

  await test('playback prefetches at most the next two online episodes', async () => {
    const ui = await openEpisode({ episodeCount: 6 });
    try {
      assert.deepEqual(prefetches(ui).map(item => item.vidIndex), [2, 3]);
      tick(ui, 1); tick(ui, 2); await ui.flush();
      assert.deepEqual(prefetches(ui).map(item => item.vidIndex), [2, 3], 'timeupdate must not enqueue a third episode');
    } finally { ui.unmount(); }
  });

  await test('locked and local episodes are skipped without shrinking the two-ahead window', async () => {
    const ui = await openEpisode({ episodeCount: 5, lockedIndexes: [2, 4] });
    try {
      assert.deepEqual(prefetches(ui).map(item => item.vidIndex), [3, 5]);
    } finally { ui.unmount(); }
  });

  await test('switching to the next episode consumes its preparation and keeps the following one', async () => {
    const ui = await openEpisode({ episodeCount: 4 });
    try {
      const following = prefetches(ui).find(item => item.vidIndex === 3);
      assert.ok(following, 'episode three must already be preparing');
      ui.episode(2);
      await ui.flush();
      ui.metadata();
      await ui.flush();
      assert.equal(ui.releases.some(item => item.requestId === following.requestId), false,
        'the next-next prefetch must survive the handoff');
      assert.equal(prefetches(ui).filter(item => item.vidIndex === 3).length, 1,
        'the retained episode three preparation must not be duplicated');
      assert.ok(prefetches(ui).some(item => item.vidIndex === 4),
        'after switching, the queue must refill with the new next-next episode');
    } finally { ui.unmount(); }
  });

  await test('switching to a completed prefetch has no buffering overlay in any observed render', async () => {
    let finishPrefetch;
    const ui = await openEpisode({
      episodeCount: 2,
      prepare: payload => payload.prefetch === true
        ? new Promise(resolve => { finishPrefetch = resolve; })
        : { success: true, url: 'hongguo-stream://first' },
    });
    try {
      assert.equal(typeof finishPrefetch, 'function', 'the next episode must start prefetching before the switch');
      finishPrefetch({ success: true, url: 'hongguo-stream://prefetched-second' });
      await ui.flush();
      ui.episode(2);
      await flushWithoutBuffering(ui);
      assert.equal(ui.find(node => node.type === 'video').props.src, 'hongguo-stream://prefetched-second');
      assert.equal(paragraph(ui, '正在连接片源…'), undefined);
      assert.equal(ui.prepares.filter(item => item.vidIndex === 2).length, 1, 'switching must reuse the completed prefetch');
      ui.metadata();
      await flushWithoutBuffering(ui);
      assert.equal(ui.media.paused, false, 'the prefetched episode must start playing after metadata');
    } finally { ui.unmount(); }
  });

  await test('switching to a still-preparing prefetch keeps the preparation state visible', async () => {
    const pending = [];
    const ui = await openEpisode({
      episodeCount: 3,
      prepare: payload => payload.prefetch === true
        ? new Promise(resolve => { pending.push({ vidIndex: payload.vidIndex, resolve }); })
        : { success: true, url: 'hongguo-stream://first' },
    });
    try {
      ui.episode(2);
      renderWithoutBuffering(ui);
      assert.ok(paragraph(ui, '正在连接片源…'), 'the pending prefetch must show preparation immediately');
      await flushWithoutBuffering(ui);
      assert.ok(paragraph(ui, '正在连接片源…'), 'a pending prefetch must keep its preparation state visible');
      const next = pending.find(item => item.vidIndex === 2);
      assert.ok(next, 'the next episode must already be prefetching');
      next.resolve({ success: true, url: 'hongguo-stream://prefetched-second' });
      await flushWithoutBuffering(ui);
      assert.equal(paragraph(ui, '正在连接片源…'), undefined);
      assert.equal(ui.find(node => node.type === 'video').props.src, 'hongguo-stream://prefetched-second');
      ui.metadata();
      await flushWithoutBuffering(ui);
      assert.equal(ui.media.paused, false);
    } finally { ui.unmount(); }
  });

  await test('switching to a downloaded episode preserves prefetches after it', async () => {
    const ui = await openEpisode({
      episodeCount: 4,
      localIndexes: [2],
      prepare: payload => payload.prefetch === true ? new Promise(() => {}) : { success: true, url: 'hongguo-stream://first' },
    });
    try {
      const queued = prefetches(ui).filter(item => item.vidIndex === 3 || item.vidIndex === 4);
      assert.deepEqual(queued.map(item => item.vidIndex), [3, 4]);
      ui.episode(2);
      await ui.flush();
      assert.equal(ui.releases.some(item => queued.some(request => request.requestId === item.requestId)), false,
        'switching to a local episode must not release later prefetches');
      ui.metadata();
      ui.find(node => node.type === 'video').props.onPlaying?.({ currentTarget: ui.media });
      await ui.flush();
      assert.equal(prefetches(ui).filter(item => item.vidIndex === 3).length, 1);
      assert.equal(prefetches(ui).filter(item => item.vidIndex === 4).length, 1);
    } finally { ui.unmount(); }
  });

  await test('one failed target retries after cooldown without duplicating the other target', async () => {
    let now = Date.now();
    let targetTwoAttempts = 0;
    const ui = await openEpisode({
      episodeCount: 4,
      now: () => now,
      prepare: async payload => {
        if (payload.prefetch === true && payload.vidIndex === 2) {
          targetTwoAttempts += 1;
          return { success: false, error: 'network' };
        }
        return { success: true, url: `hongguo-stream://${payload.vidIndex}` };
      },
    });
    try {
      assert.equal(targetTwoAttempts, 1);
      assert.equal(prefetches(ui).filter(item => item.vidIndex === 3).length, 1);
      tick(ui, 1); await ui.flush();
      assert.equal(targetTwoAttempts, 1, 'retry must wait for the cooldown');
      now += 16000;
      tick(ui, 2); await ui.flush();
      assert.equal(targetTwoAttempts, 2, 'failed target must retry after the cooldown');
      assert.equal(prefetches(ui).filter(item => item.vidIndex === 3).length, 1,
        'successful next-next target must not be retried');
    } finally { ui.unmount(); }
  });

  await test('disabling cache releases every queued prefetch request', async () => {
    const ui = mount({
      props: { setEpisodesOpen() {}, target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      episodeCount: 4,
      prepare: async payload => payload.prefetch === true
        ? new Promise(() => {})
        : { success: true, url: 'hongguo-stream://first' },
    });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      const toggle = ui.button('缓存后续 2 集');
      toggle.props.onClick();
      await ui.flush();
      await ui.flush();
      const queued = prefetches(ui).filter(item => item.vidIndex === 2 || item.vidIndex === 3);
      assert.equal(queued.length, 2);
      for (const request of queued) {
        assert.ok(ui.releases.some(item => item.requestId === request.requestId),
          'queued request ' + request.vidIndex + ' must be released when cache is disabled');
      }
    } finally { ui.unmount(); }
  });

  if (failures) process.exitCode = 1;
})();
