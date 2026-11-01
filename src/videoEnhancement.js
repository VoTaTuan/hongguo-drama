export const ENHANCEMENT_MODES = ['original', 'sharpen', 'anime4k'];

export function normalizeEnhancement(value) {
  const strength = Number(value?.strength);
  return {
    mode: ENHANCEMENT_MODES.includes(value?.mode) ? value.mode : 'original',
    strength: Number.isFinite(strength) ? Math.max(0, Math.min(100, strength)) : 50,
  };
}

export function sharpenKernel(strength) {
  const amount = normalizeEnhancement({ strength }).strength / 100 * 0.7;
  return [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];
}

export function createVideoFrameUploader(video, queue, texture, width, height) {
  let bridge;
  let context;
  return {
    get usesCanvas() { return !!bridge; },
    upload() {
      if (!bridge) {
        try {
          queue.copyExternalImageToTexture({ source: video }, { texture }, [width, height]);
          return;
        } catch (error) {
          // Some HEVC decoders expose drawable frames without an importable GPU backing.
          if (error.name === 'SecurityError' || (error.name !== 'OperationError' && !/back resource/i.test(error.message || ''))) throw error;
          bridge = new OffscreenCanvas(width, height);
          context = bridge.getContext('2d', { alpha: false });
          if (!context) throw new Error('Nguồn phim này tạm thời chưa hỗ trợ tăng cường chất lượng; đã khôi phục gốc, có thể chuyển sang chế độ làm nét');
        }
      }
      context.drawImage(video, 0, 0, width, height);
      queue.copyExternalImageToTexture({ source: bridge }, { texture }, [width, height]);
    },
    dispose() {
      if (bridge) { bridge.width = 0; bridge.height = 0; }
      bridge = context = null;
    },
  };
}

const displayShader = `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  let p = positions[index];
  return Vertex(vec4f(p, 0, 1), vec2f((p.x + 1) * 0.5, (1 - p.y) * 0.5));
}
@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  return vec4f(textureSample(image, imageSampler, input.uv).rgb, 1);
}`;

// Own the device so all library textures are released together on source changes.
export async function createAnime4KRenderer(video, canvas, { signal, onError }) {
  if (!navigator.gpu) throw new Error('Môi trường này chưa hỗ trợ WebGPU; đã khôi phục gốc, có thể dùng chế độ làm nét');
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('Khung hình video chưa sẵn sàng, vui lòng thử lại sau');
  // shortcut: limit input to 1080p to bound GPU memory; expand after device-specific profiling.
  if (width * height > 1920 * 1080) throw new Error('Anime4K hiện chỉ hỗ trợ nguồn phim 1080p trở xuống; đã khôi phục gốc');
  const { CNNx2M } = await import('anime4k-webgpu');
  signal.throwIfAborted();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  signal.throwIfAborted();
  if (!adapter) throw new Error('Card đồ họa hiện tại không thể bật WebGPU; đã khôi phục gốc, có thể dùng chế độ làm nét');
  const device = await adapter.requestDevice();
  let context;
  let uploader;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    uploader?.dispose();
    context?.unconfigure();
    device.destroy();
  };
  if (signal.aborted) { dispose(); signal.throwIfAborted(); }
  signal.addEventListener('abort', dispose, { once: true });
  const report = message => { if (!disposed) onError(new Error(message)); };
  device.lost.then(info => report(`Tăng cường GPU đã dừng (${info.reason}); đã khôi phục gốc`));
  device.addEventListener('uncapturederror', event => {
    event.preventDefault();
    report('Tính toán tăng cường GPU thất bại; đã khôi phục gốc, có thể chuyển sang làm nét');
  });
  try {
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('Không thể tạo khung hình tăng cường; đã khôi phục gốc');
    device.pushErrorScope('validation');
    const input = device.createTexture({
      size: [width, height], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    uploader = createVideoFrameUploader(video, device.queue, input, width, height);
    const anime = new CNNx2M({ device, inputTexture: input });
    const output = anime.getOutputTexture();
    canvas.width = output.width;
    canvas.height = output.height;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: displayShader });
    const pipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const bindings = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
        { binding: 1, resource: output.createView() },
      ],
    });
    const error = await device.popErrorScope();
    signal.throwIfAborted();
    if (error) throw new Error('Card đồ họa hiện tại không hỗ trợ xử lý Anime4K; đã khôi phục gốc');
    let lastFrameAt = -Infinity;
    let slowFrames = 0;
    return {
      dispose,
      async draw() {
        if (disposed || video.readyState < 2 || video.seeking) return false;
        if (video.videoWidth !== width || video.videoHeight !== height) throw new Error('Kích thước nguồn phim đã thay đổi, vui lòng bật lại Anime4K');
        const started = performance.now();
        if (uploader.usesCanvas && !video.paused && started - lastFrameAt < 1000 / 30) return false;
        lastFrameAt = started;
        uploader.upload();
        const encoder = device.createCommandEncoder();
        anime.pass(encoder);
        const pass = encoder.beginRenderPass({ colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
        }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindings);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        slowFrames = performance.now() - started > 150 ? slowFrames + 1 : 0;
        if (slowFrames >= 5) throw new Error('Thiết bị xử lý tăng cường quá chậm; đã khôi phục gốc, có thể chuyển sang làm nét');
        return !disposed;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
