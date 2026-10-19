/** On-device hand control. Camera starts only when start() is called by the UI. */
const ASSET_ROOT = new URL('./vendor/handtracking/', import.meta.url);
const FRAME_INTERVAL = 1000 / 18;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let libraryPromise;
let importAttempts = 0;

function notify(callback, value) {
  try { callback?.(value); } catch (error) { console.warn('Hand-control UI callback failed:', error?.message || error); }
}

/** Pure, exported helpers: tests never need a camera, DOM, or the MediaPipe runtime. */
export function measureHand(landmarks, aspect = 1) {
  if (!Array.isArray(landmarks) || landmarks.length < 21 || !Number.isFinite(aspect) || aspect <= 0) return null;
  const points = landmarks.map(point => ({ x: Number(point?.x) * aspect, y: Number(point?.y) }));
  if (!points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const width = distance(points[5], points[17]);
  // Ignore tiny/degenerate detections, where pinch ratios amplify landmark noise.
  if (width < 0.035 || width > 1.25 * aspect) return null;
  const center = [0, 5, 9, 13, 17].reduce((sum, index) => ({ x: sum.x + points[index].x / 5, y: sum.y + points[index].y / 5 }), { x: 0, y: 0 });
  return { center, width, pinch: clamp(distance(points[4], points[8]) / width, 0.08, 2.5) };
}

export function createGestureState(explode = 0) {
  return { mode: 'none', samples: 0, smooth: null, applied: null, anchor: null, anchorExplode: clamp(Number(explode) || 0, 0, 1), explode: clamp(Number(explode) || 0, 0, 1), center: null };
}

/**
 * A frame reducer: single-hand pinch opens/closes to zoom; two palms separate to
 * explode. Mode changes require three stable samples and never issue an action.
 * Missing hands preserve the last model state rather than resetting the model.
 */
export function stepHandGestures(previous, landmarks, { aspect = 1 } = {}) {
  const prior = previous || createGestureState();
  const hands = (Array.isArray(landmarks) ? landmarks : []).map(hand => measureHand(hand, aspect)).filter(Boolean).slice(0, 2);
  const mode = hands.length === 2 ? 'explode' : hands.length === 1 ? 'zoom' : 'none';
  const base = { mode, hands: hands.length, zoomFactor: null, explode: null };
  if (mode === 'none') return { ...base, state: createGestureState(prior.explode) };
  const center = hands[0].center;
  const handChanged = mode === 'zoom' && prior.center && distance(center, prior.center) > Math.max(hands[0].width * 1.8, 0.22);
  const metric = mode === 'zoom' ? hands[0].pinch : distance(hands[0].center, hands[1].center) / ((hands[0].width + hands[1].width) / 2);
  const restarted = prior.mode !== mode || handChanged || !Number.isFinite(prior.smooth);
  const smooth = restarted ? metric : prior.smooth + (metric - prior.smooth) * 0.32;
  const state = restarted
    ? { ...createGestureState(prior.explode), mode, samples: 1, smooth, center }
    : { ...prior, samples: prior.samples + 1, smooth, center };
  if (state.samples <= 3) {
    state.anchor = smooth;
    state.applied = smooth;
    state.anchorExplode = state.explode;
    return { ...base, state };
  }
  if (mode === 'zoom') {
    const ratio = smooth / state.applied;
    if (Math.abs(Math.log(ratio)) >= 0.018) {
      base.zoomFactor = clamp(Math.pow(ratio, 0.72), 0.94, 1.06);
      state.applied = smooth;
    }
  } else {
    const measuredTarget = clamp(state.anchorExplode + (smooth - state.anchor) * 0.25, 0, 1);
    const target = measuredTarget < 0.006 ? 0 : measuredTarget > 0.994 ? 1 : measuredTarget;
    const delta = target - state.explode;
    if (Math.abs(delta) >= 0.012 || ((target === 0 || target === 1) && delta !== 0)) {
      state.explode = clamp(state.explode + clamp(delta, -0.055, 0.055), 0, 1);
      base.explode = state.explode;
    }
  }
  return { ...base, state };
}

function loadLibrary() {
  if (!libraryPromise) {
    const url = new URL('vision_bundle.js', ASSET_ROOT);
    if (importAttempts++) url.searchParams.set('retry', String(importAttempts));
    libraryPromise = import(url.href).catch(error => { libraryPromise = null; throw error; });
  }
  return libraryPromise;
}

function waitForVideo(video, signal) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
      error ? reject(error) : resolve();
    };
    const ready = () => video.videoWidth && done();
    const failed = () => done(new Error('Camera video unavailable'));
    const cancelled = () => done(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(failed, 10000);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

function stopTracks(stream) {
  for (const track of new Set(stream?.getTracks?.() || [])) {
    try { track?.stop?.(); } catch { /* Release other owned tracks as well. */ }
  }
}

function videoTracks(stream) {
  return [...new Set(stream?.getVideoTracks?.() || stream?.getTracks?.().filter(track => track?.kind !== 'audio') || [])];
}

/** Stop must settle even when a browser leaves video.play() pending. */
function waitForPlayback(play, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancelled);
      error ? reject(error) : resolve(value);
    };
    const cancelled = () => done(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(play).then(value => done(null, value), error => done(error));
    if (signal.aborted) cancelled();
  });
}

function cameraErrorMessage(error) {
  if (['FrontCameraUnavailableError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) return '前置相机暂不可用，仍可使用触屏缩放与拆装。';
  if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return '相机权限未开启，仍可使用触屏缩放与拆装。';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return '未找到可用相机，仍可使用触屏操作。';
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return '前置相机暂不可用，可能被占用或当前浏览器无法同时使用双摄。仍可使用触屏操作。';
  return '隔空手势未能启动，请重试或使用触屏缩放与拆装。';
}

export class HandGestureController {
  constructor({ onZoom, onExplode, onStatus, onPreview } = {}) {
    this.onZoom = onZoom;
    this.onExplode = onExplode;
    this.onStatus = onStatus;
    this.onPreview = onPreview;
    this._generation = 0;
    this._running = false;
    this._starting = null;
    this._detector = null;
    this._stream = null;
    this._ownsStream = false;
    this._usingSharedStream = false;
    this._trackListeners = [];
    this._video = null;
    this._raf = 0;
    this._abort = null;
    this._wasmUrls = new Set();
    this._gesture = createGestureState();
    this._statusKey = '';
    this._statusAt = 0;
    this._onVisibility = () => { if (document.hidden) this.stop(); };
    this._onPageHide = () => this.stop();
  }

  get running() { return this._running; }

  /** Sync this when a touch gesture or slider changes the model's explode value. */
  setExplode(value) {
    const explode = clamp(Number(value) || 0, 0, 1);
    // Do not reset the reference on our own onExplode callback's echo.
    if (Math.abs(explode - this._gesture.explode) < 0.001) return;
    this._gesture = createGestureState(explode);
  }

  _status(state, message, hands, force = false) {
    const now = performance.now();
    const key = `${state}:${message}:${hands ?? ''}`;
    if (!force && this._statusKey === key && now - this._statusAt < 1200) return;
    this._statusKey = key;
    this._statusAt = now;
    notify(this.onStatus, { state, message, ...(hands === undefined ? {} : { hands }) });
  }

  start({ stream = null, ownsStream = true, mirrored = true, facingMode = 'user' } = {}) {
    if (this._running) return Promise.resolve(true);
    if (this._starting) return this._starting;
    const generation = ++this._generation;
    const abort = new AbortController();
    this._abort = abort;
    this._usingSharedStream = Boolean(stream && ownsStream === false);
    this._status('loading', '正在加载本地手势模型…', 0, true);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('pagehide', this._onPageHide);
    }
    const operation = this._begin(generation, abort, { stream, ownsStream, mirrored, facingMode });
    this._starting = operation;
    operation.finally(() => { if (this._starting === operation) this._starting = null; });
    return operation;
  }

  async _begin(generation, abort, options) {
    const provided = options.stream !== null;
    let stream = options.stream;
    // A stream opened by this controller always belongs to it.
    const ownsStream = !provided || options.ownsStream !== false;
    const facingMode = options.facingMode === 'environment' ? 'environment' : 'user';
    let streamAdopted = false;
    let detector = null;
    let detectorOwned = false;
    let wasmUrl = null;
    const current = () => generation === this._generation && !abort.signal.aborted;
    const adoptStream = () => {
      const tracks = videoTracks(stream);
      if (!tracks.length || tracks.every(track => track.readyState === 'ended')) throw new Error('Camera video unavailable');
      this._stream = stream;
      this._ownsStream = ownsStream;
      streamAdopted = true;
      for (const track of tracks) {
        const handler = () => {
          if (!current() || this._stream !== stream) return;
          this.stop();
          this._status('error', '手势相机已断开，请重新开启；触屏操作仍可使用。', 0, true);
        };
        this._trackListeners.push({ track, handler });
        track.addEventListener?.('ended', handler, { once: true });
      }
    };
    try {
      if (!provided && (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)) throw new Error('Camera not supported');
      // Attach ownership and ended handling before asynchronous runtime loading.
      // stop() can therefore cancel immediately without harming a shared camera.
      if (provided) adoptStream();
      const [{ FilesetResolver, HandLandmarker }, response] = await Promise.all([
        loadLibrary(), fetch(new URL('hand_landmarker.task', ASSET_ROOT), { signal: abort.signal })
      ]);
      if (!current()) return false;
      if (!response.ok) throw new Error('Hand model unavailable');
      const model = new Uint8Array(await response.arrayBuffer());
      if (!current()) return false;
      const fileset = await FilesetResolver.forVisionTasks(new URL('wasm/', ASSET_ROOT).href.replace(/\/$/, ''));
      if (!current()) return false;
      // Existing local preview servers may serve .wasm as octet-stream. This
      // local Blob provides the required streaming MIME without any CDN request.
      const wasmResponse = await fetch(fileset.wasmBinaryPath, { signal: abort.signal });
      if (!wasmResponse.ok) throw new Error('Hand runtime unavailable');
      const wasm = await wasmResponse.arrayBuffer();
      if (!current()) return false;
      wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
      this._wasmUrls.add(wasmUrl);
      detector = await HandLandmarker.createFromOptions({ ...fileset, wasmBinaryPath: wasmUrl }, {
        baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.65
      });
      URL.revokeObjectURL(wasmUrl);
      this._wasmUrls.delete(wasmUrl);
      wasmUrl = null;
      if (!current()) { detector.close(); detector = null; return false; }
      this._detector = detector;
      detectorOwned = true;
      this._status('requesting', provided ? '正在连接指定的视频源。' : '请允许前置相机，将手放入画面。', 0, true);
      if (!provided) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: facingMode }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 18, max: 20 } }
        });
      }
      if (!current()) return false;
      // Never silently replace the requested front camera with the rear camera.
      if (!provided && facingMode === 'user' && videoTracks(stream).some(track => track.getSettings?.().facingMode === 'environment')) {
        const error = new Error('Front camera unavailable');
        error.name = 'FrontCameraUnavailableError';
        throw error;
      }
      if (!provided) adoptStream();
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', '本机手势识别相机预览');
      video.setAttribute('data-mirrored', String(options.mirrored !== false));
      video.srcObject = stream;
      this._video = video;
      notify(this.onPreview, video);
      await waitForPlayback(video.play(), abort.signal);
      if (!current()) return false;
      await waitForVideo(video, abort.signal);
      if (!current()) return false;
      this._running = true;
      this._gesture = createGestureState(this._gesture.explode);
      this._lastFrame = -Infinity;
      this._lastVideoTime = -1;
      this._status('ready', '单手拇食指开合缩放；双手拉开拆分、合拢复原。', 0, true);
      this._tick(generation);
      return true;
    } catch (error) {
      if (current() && error?.name !== 'AbortError') {
        this._releaseResources();
        this._status('error', cameraErrorMessage(error), 0, true);
      }
      return false;
    } finally {
      if (wasmUrl) { URL.revokeObjectURL(wasmUrl); this._wasmUrls.delete(wasmUrl); }
      if (!streamAdopted && ownsStream) stopTracks(stream);
      if (!current() && detector && !detectorOwned) { try { detector.close(); } catch {} }
    }
  }

  _tick(generation) {
    if (!this._running || generation !== this._generation) return;
    this._raf = requestAnimationFrame(now => {
      if (!this._running || generation !== this._generation) return;
      const video = this._video;
      if (video?.readyState >= 2 && now - this._lastFrame >= FRAME_INTERVAL && video.currentTime !== this._lastVideoTime) {
        this._lastFrame = now;
        this._lastVideoTime = video.currentTime;
        try {
          const result = this._detector.detectForVideo(video, now);
          const gesture = stepHandGestures(this._gesture, result.landmarks, { aspect: video.videoWidth / video.videoHeight });
          this._gesture = gesture.state;
          if (gesture.zoomFactor !== null) notify(this.onZoom, gesture.zoomFactor);
          if (gesture.explode !== null) notify(this.onExplode, gesture.explode);
          if (!gesture.hands) this._status('searching', '把手放入预览框：单手缩放，双手拆装。', 0);
          else if (gesture.state.samples <= 3) this._status('tracking', '已识别，保持片刻建立手势基准…', gesture.hands);
          else this._status('tracking', gesture.mode === 'zoom' ? '单手缩放：拇指与食指张开放大、捏合缩小。' : '双手拆装：向两侧拉开展开，向中间合拢复原。', gesture.hands);
        } catch (error) {
          if (generation === this._generation) {
            this.stop();
            this._status('error', '手势识别暂时中断，请重试。触屏操作仍可使用。', 0, true);
          }
          return;
        }
      }
      this._tick(generation);
    });
  }

  _releaseResources() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const url of this._wasmUrls) URL.revokeObjectURL(url);
    this._wasmUrls.clear();
    for (const { track, handler } of this._trackListeners) track.removeEventListener?.('ended', handler);
    this._trackListeners = [];
    if (this._ownsStream) stopTracks(this._stream);
    this._stream = null;
    this._ownsStream = false;
    this._usingSharedStream = false;
    if (this._video) {
      this._video.pause();
      this._video.srcObject = null;
      this._video.remove();
      this._video = null;
    }
    notify(this.onPreview, null);
    if (this._detector) {
      try { this._detector.close(); } catch {}
      this._detector = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      window.removeEventListener('pagehide', this._onPageHide);
    }
  }

  stop() {
    const sharedStream = this._usingSharedStream;
    ++this._generation;
    this._abort?.abort();
    this._abort = null;
    this._starting = null;
    this._releaseResources();
    this._gesture = createGestureState(this._gesture.explode);
    this._status('stopped', sharedStream ? '隔空手势已关闭，产线实景继续显示。' : '隔空手势已关闭，相机已释放。', 0, true);
  }
}
