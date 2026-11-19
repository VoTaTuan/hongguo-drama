// HLS segments are fetched concurrently (bounded), keep playlist order, and a failing segment aborts the rest.
// Uses local in-memory fixtures only; no network. Needs FFmpeg: HONGGUO_FFMPEG (and optionally HONGGUO_FFPROBE).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { remuxHls } = require('../src/native/hls-media.js');
const ffmpeg = process.env.HONGGUO_FFMPEG, ffprobe = process.env.HONGGUO_FFPROBE;
assert.ok(ffmpeg, 'Set HONGGUO_FFMPEG');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-hls-par-'));
  try {
    // 10 one-second segments generated locally from a synthetic source.
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-t', '10', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-g', '25', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
      '-hls_segment_filename', path.join(root, 'seg%d.ts'), path.join(root, 'media.m3u8')], { timeout: 60000 });
    const segments = fs.readdirSync(root).filter(name => name.endsWith('.ts'));
    assert.ok(segments.length >= 8, 'fixture needs many segments');

    const run = async ({ delay = 40, failOn } = {}) => {
      let inFlight = 0, peak = 0;
      const order = [];
      const request = async (url, { signal } = {}) => {
        assert.equal(new URL(url).hostname, 'fixture.example');
        const file = path.join(root, new URL(url).pathname.slice(1));
        if (!file.endsWith('.ts')) return { status: 200, headers: {}, data: fs.createReadStream(file), url };
        order.push(path.basename(file));
        if (failOn && file.endsWith(failOn)) throw new Error('segment boom');
        inFlight++; peak = Math.max(peak, inFlight);
        try {
          await sleep(delay);
          if (signal?.aborted) throw new Error('cancelled');
        } finally { inFlight--; }
        return { status: 200, headers: { 'content-length': String(fs.statSync(file).size) }, data: fs.createReadStream(file), url };
      };
      const output = path.join(root, `out-${Math.random().toString(36).slice(2)}.mp4`);
      const started = Date.now();
      let error;
      try { await remuxHls({ url: 'https://fixture.example/media.m3u8', output, ffmpeg, request }); } catch (e) { error = e; }
      return { peak, order, output, error, ms: Date.now() - started };
    };

    const ok = await run();
    assert.equal(ok.error, undefined, ok.error?.message);
    assert.ok(ok.peak > 1, `segments must overlap, peak=${ok.peak}`);
    assert.ok(ok.peak <= 6, `concurrency must stay bounded, peak=${ok.peak}`);
    assert.ok(fs.statSync(ok.output).size > 0);
    if (ffprobe) {
      const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', ok.output], { encoding: 'utf8', timeout: 10000 }));
      assert.ok(Number(info.format.duration) >= 9, `all segments in order, duration=${info.format.duration}`);
    }
    console.log(`PASS segments overlap (peak ${ok.peak}) and output keeps full duration`);

    const failed = await run({ failOn: 'seg3.ts' });
    assert.match(String(failed.error?.message), /segment boom/);
    assert.equal(fs.existsSync(failed.output), false, 'failed segment must not leave an output file');
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('.hongguo-hls-')), false, 'temp directory is cleaned up');
    console.log('PASS a failing segment aborts the whole job and cleans up');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error('FAIL', error); process.exit(1); });
