// Isolated main-process checks for delayed source retries. No network, GUI or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const source = path.resolve(__dirname, '../main.js');
const req = createRequire(source);
const dirs = [];
const unavailable = (sources) => ({ url: null, code: 'SOURCE_UNAVAILABLE', sources,
  error: '本集取源失败：网页：请求失败（HTTP 404）；App：接口暂时拒绝本次请求；旧接口：片源数据无法解析。请重试或在官方 App 确认可播情况。' });
const webGone = [{ source: 'web', code: 'HTTP_404' }, { source: 'app', code: 'BUSINESS_REJECTED' }, { source: 'api', code: 'INVALID_RESPONSE' }];
function fixture(initialTasks) {
  const now = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-source-retry-'));
  dirs.push(root);
  const handlers = {}, timers = [], app = new EventEmitter(), state = { result: unavailable(webGone), calls: 0, qualities: [] };
  let settings = { root }, saved = initialTasks, ready, reportStorageError;
  Object.assign(app, { getVersion: () => 'test', getPath: () => root,
    commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then(fn) { ready = fn; } }) });
  // Scheduled retries are fired manually; immediate recovery still uses short timers.
  const fakeSetTimeout = (fn, ms, ...args) => {
    if (ms < 10000) return setTimeout(fn, Math.min(ms, 5), ...args);
    const timer = { fn, ms, cleared: false, unref() { this.background = true; return this; } }; timers.push(timer); return timer;
  };
  const fakeClearTimeout = timer => { if (timer && 'cleared' in timer) timer.cleared = true; else clearTimeout(timer); };
  const context = vm.createContext({ require: n => n === 'electron'
    ? { app, ipcMain: { handle: (n, f) => handlers[n] = f }, protocol: { registerSchemesAsPrivileged() {} },
      Menu: { buildFromTemplate: items => items, setApplicationMenu() {} } }
    : n === 'axios' ? Object.assign((...args) => state.transportError ? Promise.reject(state.transportError) : req(n)(...args), req(n))
    : n === './src/native/hongguo' ? { fetchPlayUrlSingle: async (_vid, _sid, options) => { state.calls++; state.qualities.push(options.quality); return state.result; }, markWebMediaFailure() {} }
    : n === './src/store' ? { getSettings: () => settings, saveSettings: s => settings = s,
      init() {}, getTasks: () => JSON.parse(JSON.stringify(saved || [])), getSeries: () => [], getMergeTasks: () => [],
      setErrorHandler: fn => reportStorageError = fn,
      saveTasks: tasks => {
        if (state.saveError) { reportStorageError({ error: '保存失败，请检查磁盘空间或目录权限；本次变更未能保存。' }); throw state.saveError; }
        saved = JSON.parse(JSON.stringify(tasks));
      } } : req(n),
    __dirname: path.dirname(source), Date: class extends Date { static now() { return now; } }, console: { log() {}, warn() {}, error() {} },
    process, Buffer, URL, Response, Request, Headers, AbortController, setInterval: () => ({ unref() {} }), setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    testReadStream: () => Readable.from([Buffer.alloc(200000)]) });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  require('./fixtures/trusted-ipc.cjs')(context, handlers);
  const run = text => vm.runInContext(text, context);
  run(`const originalPumpQueue = pumpQueue, originalRequestMedia = requestMedia; pumpQueue = () => {}; resolveFfmpeg = () => '/test/ffprobe';
    verifyDownloadDecode = async () => {};
    probeVideoInfo = async () => ({ w: 1080, h: 1920, duration: 12, codec: 'h264' });
    requestMedia = async () => ({headers: {'content-length': '200000'}, data: testReadStream()});
    downloadTasks = [{ id: 't1', type: 'hongguo', status: 'pending', filename: 'ep13.mp4', downloadQuality: 'auto',
      hongguoInfo: { vid: '7688671683959327768', series_id: '1', series_title: '测试剧', vid_index: 13 } }];`);
  const task = () => run('downloadTasks[0]');
  const live = () => timers.filter(timer => !timer.cleared && !timer.background);
  return { run, handlers, state, timers, live, task, saved: () => saved,
    start: async () => {
      // Keep the actual app.whenReady callback, loadDownloadTasks and retry scheduling.
      run(`rebuildSeriesRegistryFromTasks = () => {}; rescanDownloadsFromDisk = () => {};
        registerStreamProtocol = () => {}; registerLocalProtocol = () => {};
        applyProxySettings = async () => {}; createWindow = () => {}; refreshWatchHistory = async () => {};`);
      await ready();
    },
    download: () => run('executeHongguoDownload(downloadTasks[0])'),
    fire: () => { const timer = live().at(-1); timer.cleared = true; timer.fn(); } };
}
const checks = [
  ['real media error wrapping preserves a security block without any retry', async () => {
    const h = fixture();
    h.state.result = {url:'https://media.example/video.mp4',source:'app'};
    h.state.transportError = Object.assign(new Error('blocked'), {cause:{code:'ERR_WEB_MEDIA_ADDRESS'}});
    h.run('requestMedia = originalRequestMedia');
    await h.download();
    assert.equal(h.task().status,'failed');
    assert.equal(h.live().length,0,'security rejection must not schedule anything');
  }],
  ['a failed download never schedules or starts an automatic retry', async () => {
    for (const code of ['ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ERR_NETWORK', 'incomplete', 'unavailable']) {
      const h = fixture();
      h.state.result = code === 'unavailable' ? unavailable(webGone) : { url: 'https://media.example/video.mp4', source: 'app' };
      h.run(code === 'incomplete'
        ? `requestMedia = async () => ({headers: {'content-length': '300000'}, data: testReadStream()});`
        : `requestMedia = async () => { throw Object.assign(new Error('offline'), { code: '${code}' }); };`);
      h.run('var __pumps = 0; pumpQueue = () => { __pumps++; };');
      await h.download();
      assert.equal(h.task().status, 'failed', code);
      assert.equal(h.live().length, 0, `${code}: no timer may be scheduled`);
      assert.equal(h.task().retryAt, undefined, code);
      assert.equal(h.task().sourceRetries, undefined, code);
      assert.ok(!/tự động thử lại|自动重试/i.test(h.task().error), `${code}: message must not promise a retry`);
      assert.equal(h.run('downloadQueue.length'), 0, code);
      assert.equal(h.run('__pumps'), 0, `${code}: the queue must not be pumped after a failure`);
      assert.equal(fs.existsSync(h.task().savePath), false, 'never publish partial media');
    }
  }],
  ['restarting never resumes: pending, stopped and legacy retry tasks stay held until the user acts', async () => {
    const base = (id, status, extra = {}) => ({ id, type: 'hongguo', status, filename: id + '.mp4', downloadQuality: 'auto',
      hongguoInfo: { vid: '7688671683959327768', series_id: '1', series_title: 'T', vid_index: 1 }, ...extra });
    const h = fixture([
      base('pending', 'pending'),
      base('paused', 'stopped', { error: 'Đã tạm dừng thủ công' }),
      base('interrupted', 'stopped'),
      base('legacy', 'failed', { retryAt: Date.now() + 60000, sourceRetries: 1, error: 'offline' }),
      base('active', 'downloading'),
    ]);
    h.run('var __pumps = 0');
    await h.start();
    h.run('var __pumpsAfterStart = 0');
    const rows = Object.fromEntries(h.run('downloadTasks').map(task => [task.id, task]));
    for (const id of Object.keys(rows)) assert.notEqual(rows[id].status, 'pending', id + ' must not be queued at startup');
    assert.equal(rows.paused.status, 'stopped');
    assert.equal(rows.interrupted.status, 'stopped');
    assert.equal(rows.legacy.status, 'failed');
    assert.equal(rows.legacy.retryAt, undefined, 'legacy retry plans are cancelled');
    assert.equal(h.live().length, 0, 'startup must not arm any timer');
    assert.equal(h.run('downloadQueue.length'), 0);
    assert.equal(h.run('activeDownloads'), 0);
    assert.ok(h.saved().every(task => task.status !== 'pending' && !task.retryAt), 'the held state is persisted');
  }],
  ['an explicit user retry is still the way to download again', async () => {
    const h = fixture();
    h.run('var __pumps = 0; pumpQueue = () => { __pumps++; };');
    h.run("downloadTasks[0].status = 'failed'");
    const result = await h.handlers['retry-task']({}, 't1');
    assert.equal(result.success, true);
    assert.equal(h.run('__pumps') > 0, true, 'a user retry starts the queue');
  }],
];
(async () => {
  let failed = 0;
  for (const [name, check] of checks) {
    try { await check(); console.log(`ok - ${name}`); }
    catch (error) { failed++; console.error(`not ok - ${name}\n${error.stack}`); }
  }
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})();
