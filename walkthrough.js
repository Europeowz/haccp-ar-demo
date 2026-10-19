/** Local, markerless SLAM. The preview component never launches a native AR app. */
export function setupWalkthrough({ panel, viewer, openButton, closeButton, startButton, retryButton,
  status, dimensions, progress, canvas, session, placeButton, resetButton, exitButton, hudStatus,
  title, onOpen = () => {}, onClose = () => {}, secure = () => window.isSecureContext,
  supported = () => /Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1,
  loadMetadata = () => fetch('assets/line-lifesize.json?v=9').then((r) => { if (!r.ok) { const error = new Error('Metadata unavailable'); error.status = r.status; throw error; } return r.json(); }),
  whenDefined = () => customElements.whenDefined('model-viewer'),
  engineFactory = async (options) => (await import('./spatial-engine.js?v=10')).createSpatialEngine(options),
  factoryTimeout = 15000, engineStartTimeout = 60000, permissionTimeout = 20000, stopTimeout = 3000,
  setTimer = (callback, delay) => globalThis.setTimeout?.(callback, delay), clearTimer = (id) => globalThis.clearTimeout?.(id),
}) {
  let phase = 'closed', metadata = null, prepared = false, preparing = null;
  let active = false, engine = null, revision = 0, lastFocus = null, mode = 'lifesize', stopping = null;
  let previewRevision = 0, sourceAttempt = 0, automaticRetries = 0, expectedSource = null, previewLoading = false;
  let engineLease = null, engineFailure = false;
  const pendingLaunchWaits = new Set();
  const isOpen = () => phase !== 'closed';
  const text = (message) => { status.textContent = message; hudStatus.textContent = message; };
  function bounded(operation, milliseconds, message, {cancellable = true, onLate} = {}) {
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (callback, result) => {
        if (settled) return false;
        settled = true; clearTimer(timer); pendingLaunchWaits.delete(cancel); callback(result); return true;
      };
      const cancel = () => { const error = new Error('Spatial launch cancelled'); error.cancelled = true; finish(reject, error); };
      if (cancellable) pendingLaunchWaits.add(cancel);
      timer = setTimer(() => { const error = new Error(message); error.stageTimeout = true; finish(reject, error); }, milliseconds);
      Promise.resolve(operation).then((value) => {
        if (!finish(resolve, value)) { try { void onLate?.(value); } catch (_) { /* Late cleanup must not reopen the view. */ } }
      }, (error) => { finish(reject, error); });
    });
  }
  function stopLease(lease) {
    if (!lease) return Promise.resolve();
    if (lease.cleanup) return lease.cleanup;
    let operation;
    try { operation = lease.instance?.stop?.(); } catch (_) { operation = undefined; }
    lease.cleanup = bounded(operation, stopTimeout, '空间定位结束等待超时。', {cancellable: false}).catch(() => {});
    return lease.cleanup;
  }
  const sameSource = (source) => {
    if (!source || !expectedSource) return !source;
    try { return new URL(source, document.baseURI).href === new URL(expectedSource, document.baseURI).href; }
    catch (_) { return String(source) === String(expectedSource); }
  };
  function errorInfo(detail = {}) {
    const error = detail.sourceError || detail;
    const statusCode = Number(error.response?.status ?? error.target?.status ?? error.status);
    const http = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null;
    const message = String(error.message || '');
    const contextLost = detail.type === 'webglcontextlost';
    const network = !contextLost && (error.name === 'NetworkError' || /failed to fetch|network\s*(?:error|request|failure)|load failed|fetch failed/i.test(message)
      || http === 408 || http === 429 || http >= 500);
    return {contextLost, network, http, type: detail.type || 'loadfailure'};
  }
  function cancelPreview() {
    const wasLoading = previewLoading || !!preparing;
    previewRevision += 1; preparing = null; previewLoading = false;
    if (wasLoading) { prepared = false; expectedSource = null; viewer.src = null; }
  }
  function render() {
    panel.hidden = !isOpen(); panel.dataset.phase = phase;
    session.hidden = !active; viewer.hidden = active;
    startButton.disabled = !prepared || !viewer.loaded || !secure() || !supported() || active || !!stopping;
    startButton.textContent = mode === 'tabletop' ? '开始桌面 AR' : '开始等身参观';
    retryButton.hidden = phase !== 'error' || engineFailure; progress.hidden = phase !== 'loading';
    placeButton.disabled = !engine?.getState?.().placementReady || phase === 'placed';
    resetButton.disabled = !['placed', 'lost'].includes(phase);
    title.textContent = mode === 'tabletop' ? '桌面上的饮料产线' : '走进饮料产线';
    if (metadata) {
      const scale = mode === 'tabletop' ? .05 : 1;
      dimensions.textContent = `${(metadata.footprint.width * scale).toFixed(1)} × ${(metadata.footprint.depth * scale).toFixed(1)} m 占地 · 模型高 ${(metadata.height * scale).toFixed(2)} m`;
    }
  }
  function showReady() {
    if (!isOpen() || active) return;
    if (!secure()) { phase = 'unsupported'; text('空间参观需要 HTTPS，请使用发布后的 HTTPS 地址。'); }
    else if (!supported()) { phase = 'unsupported'; text('请用手机浏览器进入地面参观；电脑上可先旋转查看模型。无需安装 Google 应用。'); }
    else { phase = 'preview'; text('点击开始后，缓慢扫描普通地面；出现可放置提示后，再放置产线。无需定位图或 Google 服务。'); }
    render();
  }
  async function prepare({fresh = false, automatic = false} = {}) {
    if (prepared) { if (viewer.loaded) showReady(); return; }
    if (preparing) return preparing;
    const token = ++previewRevision;
    const current = () => token === previewRevision && isOpen() && !document.hidden;
    phase = 'loading'; previewLoading = true; progress.value = 0;
    text(automatic ? '模型下载中断，正在自动重试（1/1）…' : '正在准备等身产线模型…'); render();
    const operation = Promise.resolve().then(async () => {
      try {
        if (fresh) { viewer.src = null; await viewer.updateComplete; }
        if (!current()) return;
        const [data] = await Promise.all([loadMetadata(), whenDefined()]);
        if (!current()) return;
        if (!data.src || !data.footprint || !Number.isFinite(data.height)) throw new Error('Invalid metadata');
        metadata = data;
        viewer.removeAttribute('ar'); viewer.removeAttribute('ios-src'); viewer.removeAttribute('ar-modes');
        viewer.setAttribute('min-camera-orbit', 'auto 0deg 0.15m');
        viewer.setAttribute('max-camera-orbit', 'auto 90deg auto');
        viewer.cameraTarget = data.cameraTarget; viewer.cameraOrbit = data.cameraOrbit;
        viewer.animationName = data.animation || 'LineCycle';
        if (data.poster) viewer.poster = data.poster;
        // model-viewer caches failed GLTF loads by URL. A new URL is required to
        // perform a real request after a failed transfer; assigning the same src is insufficient.
        let source = data.src;
        if (fresh) {
          const [base, fragment] = source.split('#');
          source = `${base}${base.includes('?') ? '&' : '?'}model-retry=${++sourceAttempt}${fragment === undefined ? '' : `#${fragment}`}`;
        }
        prepared = true; expectedSource = source; viewer.src = source; render();
        await viewer.updateComplete;
        if (current() && viewer.loaded) { previewLoading = false; showReady(); }
      } catch (error) {
        if (current()) {
          previewLoading = false; prepared = false; phase = 'error';
          const {http} = errorInfo({sourceError: error});
          text(`模型准备失败：清单或显示组件未就绪${http ? `（HTTP ${http}）` : ''}，请重新加载。`); render();
        }
      } finally { if (preparing === operation) preparing = null; }
    });
    preparing = operation;
    return operation;
  }
  async function open(selectedMode = 'lifesize') {
    if (isOpen()) return;
    mode = selectedMode === 'tabletop' ? 'tabletop' : 'lifesize';
    revision += 1; automaticRetries = 0; engineFailure = false; lastFocus = document.activeElement;
    phase = prepared && viewer.loaded ? 'preview' : 'loading';
    onOpen(); render(); closeButton.focus?.(); await prepare();
  }
  async function stopSession(message = '空间参观已结束，可重新扫描地面或返回展台。', {failure = false} = {}) {
    if (stopping) return stopping;
    revision += 1;
    for (const cancel of [...pendingLaunchWaits]) cancel();
    const previous = engineLease; engine = null; engineLease = null;
    active = false; engineFailure = failure;
    phase = failure ? 'error' : 'stopping'; text(message); render();
    // Invoke stop synchronously to release camera tracks before the host resumes.
    const cleanup = stopLease(previous);
    const operation = Promise.resolve().then(async () => {
      try { await cleanup; }
      finally {
        if (stopping === operation) stopping = null;
        if (isOpen()) {
          showReady();
          if (failure) { phase = 'error'; engineFailure = true; }
          text(message); render();
        }
      }
    });
    stopping = operation;
    render();
    return operation;
  }
  async function close() {
    if (!isOpen()) return true;
    cancelPreview();
    const cleanup = stopSession();
    revision += 1; phase = 'closed'; viewer.pause?.(); render(); onClose(); lastFocus?.focus?.();
    await cleanup;
    return true;
  }
  async function launch() {
    if (startButton.disabled || !prepared || !viewer.loaded || !secure() || !supported()) return;
    // Keep iOS permission requests in the actual button click, before dynamic imports.
    const permissionRequests = [];
    for (const EventType of [globalThis.DeviceMotionEvent, globalThis.DeviceOrientationEvent]) {
      if (typeof EventType?.requestPermission !== 'function') continue;
      try { permissionRequests.push(Promise.resolve(EventType.requestPermission())); }
      catch (_) { permissionRequests.push(Promise.resolve('denied')); }
    }
    const token = ++revision; engineFailure = false;
    active = true; phase = 'engine-loading'; panel.dataset.engineStage = 'permission'; text('正在加载本站空间定位引擎，请允许相机和所需运动权限。'); render();
    let created, lease, stage = 'permission', originalError = '';
    try {
      const permissions = await bounded(Promise.all(permissionRequests), permissionTimeout,
        '运动与方向权限等待超时，请完成权限选择后重新开始。');
      if (revision !== token || !isOpen()) return;
      if (permissions.some(value => value !== 'granted')) {
        await stopSession('请允许运动与方向权限后重新开始空间参观。'); return;
      }
      stage = 'import'; panel.dataset.engineStage = stage;
      text('正在下载空间定位启动模块…');
      created = await bounded(engineFactory({ canvas, modelUrl: metadata.src, scale: mode === 'tabletop' ? .05 : 1,
        onState: (state) => {
          if (revision !== token || !isOpen()) return;
          if (state.stage) panel.dataset.engineStage = state.stage;
          phase = state.phase; text(state.message); render();
          if (state.phase === 'error') {
            originalError = state.message || '空间定位启动失败，请重新开始。';
            void stopSession(originalError, {failure: true});
          }
        },
      }), factoryTimeout, '空间定位启动模块下载超时，请检查网络后重新开始。',
      {onLate: (value) => stopLease({instance: value})});
      lease = {instance: created};
      if (revision !== token || !isOpen()) { void stopLease(lease); return; }
      engine = created; engineLease = lease; stage = 'start'; panel.dataset.engineStage = stage;
      const startup = engine.start();
      if (revision !== token || !isOpen()) {
        Promise.resolve(startup).catch(() => {}); void stopLease(lease); return;
      }
      const started = await bounded(startup, engineStartTimeout,
        '空间定位启动超时，请重新开始；仍未能启动时可返回实景展示。');
      if (revision !== token || !isOpen()) { void stopLease(lease); return; }
      if (started === false || phase === 'error') {
        await stopSession(originalError || engine.getState?.().message || '空间定位未能启动，请重新开始。', {failure: true}); return;
      }
      render();
    } catch (error) {
      if (revision !== token || !isOpen()) { void stopLease(lease); return; }
      const detail = errorInfo({sourceError: error});
      const stageMessage = stage === 'import' ? '空间定位未能启动：启动模块加载失败' : stage === 'permission' ? '运动与方向权限未就绪' : '空间定位暂未能启动';
      const message = originalError || (error.stageTimeout ? error.message : `${stageMessage}${detail.http ? `（HTTP ${detail.http}）` : ''}，请重试或返回实景展示。`);
      await stopSession(message, {failure: true});
    }
  }
  openButton.addEventListener('click', () => void open());
  closeButton.addEventListener('click', () => void close());
  startButton.addEventListener('click', () => void launch());
  retryButton.addEventListener('click', () => {
    if (!isOpen() || active || document.hidden) return;
    cancelPreview(); prepared = false; automaticRetries = 0;
    void prepare({fresh: true});
  });
  exitButton.addEventListener('click', () => void stopSession());
  placeButton.addEventListener('click', () => { engine?.place(); render(); });
  resetButton.addEventListener('click', () => { engine?.recenter(); render(); });
  viewer.addEventListener('load', (event) => {
    if (isOpen() && !document.hidden && prepared && expectedSource && sameSource(event.detail?.url)) {
      previewLoading = false; automaticRetries = 0; showReady();
    }
  });
  viewer.addEventListener('error', (event) => {
    if (!isOpen() || active || document.hidden || !expectedSource) return;
    const detail = event.detail || {};
    const source = detail.url || detail.src || detail.sourceError?.response?.url || detail.sourceError?.target?.responseURL;
    if (source && !sameSource(source)) return;
    const info = errorInfo(detail);
    previewLoading = false; prepared = false; engineFailure = false;
    panel.dataset.modelError = info.type;
    panel.dataset.modelHttp = info.http ? String(info.http) : '';
    if (info.network && automaticRetries < 1) {
      automaticRetries += 1; preparing = null;
      void prepare({fresh: true, automatic: true}); return;
    }
    phase = 'error';
    if (info.contextLost) text('设备图形显示已中断（WebGL），请关闭其他占用图形的页面后重新加载。');
    else if (info.http) text(`模型下载失败（HTTP ${info.http}），请检查网络后重新加载。`);
    else if (info.network) text('模型下载失败：网络连接中断，请检查网络后重新加载。');
    else text('模型显示失败：文件未完整加载或图形处理失败，请重新加载。');
    render();
  });
  viewer.addEventListener('progress', (event) => {
    if (isOpen() && !document.hidden && previewLoading && expectedSource && sameSource(event.detail?.url)) progress.value = event.detail?.totalProgress || 0;
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); if (active) void stopSession(); else void close(); }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('button:not(:disabled), a[href]')].filter((el) => !el.hidden && el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) void stopSession('页面已暂停，返回后请重新识别地面。');
    else if (document.hidden && isOpen() && previewLoading) {
      cancelPreview(); phase = 'error'; text('模型加载已暂停，返回页面后请重新加载。'); render();
    }
  });
  window.addEventListener('pagehide', () => { cancelPreview(); if (active) void stopSession(); });
  return { open, close, launch, stopSession, resize: () => engine?.resize?.(),
    getState: () => ({ phase, active, prepared, metadata, mode }) };
}
