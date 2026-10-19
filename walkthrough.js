/** Local, markerless SLAM. The preview component never launches a native AR app. */
export function setupWalkthrough({ panel, viewer, openButton, closeButton, startButton, retryButton,
  status, dimensions, progress, canvas, session, placeButton, resetButton, exitButton, hudStatus,
  title, onOpen = () => {}, onClose = () => {}, secure = () => window.isSecureContext,
  supported = () => /Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1,
  loadMetadata = () => fetch('assets/line-lifesize.json').then((r) => { if (!r.ok) throw new Error('Metadata unavailable'); return r.json(); }),
  whenDefined = () => customElements.whenDefined('model-viewer'),
  engineFactory = async (options) => (await import('./spatial-engine.js?v=6')).createSpatialEngine(options),
}) {
  let phase = 'closed', metadata = null, prepared = false, preparing = null;
  let active = false, engine = null, revision = 0, lastFocus = null, mode = 'lifesize', stopping = null;
  const isOpen = () => phase !== 'closed';
  const text = (message) => { status.textContent = message; hudStatus.textContent = message; };
  function render() {
    panel.hidden = !isOpen(); panel.dataset.phase = phase;
    session.hidden = !active; viewer.hidden = active;
    startButton.disabled = !prepared || !viewer.loaded || !secure() || !supported() || active || !!stopping;
    startButton.textContent = mode === 'tabletop' ? '开始桌面 AR' : '开始等身参观';
    retryButton.hidden = phase !== 'error'; progress.hidden = phase !== 'loading';
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
  async function prepare() {
    if (prepared) { if (viewer.loaded) showReady(); return; }
    if (preparing) return preparing;
    phase = 'loading'; text('正在准备等身产线模型…'); render();
    preparing = (async () => {
      try {
        const [data] = await Promise.all([loadMetadata(), whenDefined()]);
        if (!data.src || !data.footprint || !Number.isFinite(data.height)) throw new Error('Invalid metadata');
        metadata = data;
        viewer.removeAttribute('ar'); viewer.removeAttribute('ios-src'); viewer.removeAttribute('ar-modes');
        viewer.setAttribute('min-camera-orbit', 'auto 0deg 0.15m');
        viewer.setAttribute('max-camera-orbit', 'auto 90deg auto');
        viewer.cameraTarget = data.cameraTarget; viewer.cameraOrbit = data.cameraOrbit;
        viewer.animationName = data.animation || 'LineCycle';
        if (data.poster) viewer.poster = data.poster;
        prepared = true; viewer.src = data.src; render();
        await viewer.updateComplete;
        if (viewer.loaded) showReady();
      } catch (error) {
        if (isOpen()) { phase = 'error'; text('等身模型未能加载，可以重试或返回展台。'); render(); }
      } finally { preparing = null; }
    })();
    return preparing;
  }
  async function open(selectedMode = 'lifesize') {
    if (isOpen()) return;
    mode = selectedMode === 'tabletop' ? 'tabletop' : 'lifesize';
    revision += 1; lastFocus = document.activeElement;
    phase = prepared && viewer.loaded ? 'preview' : 'loading';
    onOpen(); render(); closeButton.focus?.(); await prepare();
  }
  async function stopSession(message = '空间参观已结束，可重新扫描地面或返回展台。') {
    if (stopping) return stopping;
    revision += 1;
    const previous = engine; engine = null;
    phase = 'stopping'; render();
    stopping = (async () => {
      try { await previous?.stop?.(); }
      catch (_) { /* Host camera restoration still belongs to explicit close. */ }
      finally { active = false; stopping = null; if (isOpen()) { showReady(); text(message); } }
    })();
    return stopping;
  }
  async function close() {
    if (!isOpen()) return true;
    await stopSession();
    if (!isOpen()) return true;
    revision += 1; phase = 'closed'; viewer.pause?.(); render(); onClose(); lastFocus?.focus?.();
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
    const token = ++revision;
    active = true; phase = 'engine-loading'; text('正在加载本站空间定位引擎，请允许相机和所需运动权限。'); render();
    let created;
    try {
      const permissions = await Promise.all(permissionRequests);
      if (revision !== token || !isOpen()) return;
      if (permissions.some(value => value !== 'granted')) {
        await stopSession('请允许运动与方向权限后重新开始空间参观。'); return;
      }
      created = await engineFactory({ canvas, modelUrl: metadata.src, scale: mode === 'tabletop' ? .05 : 1,
        onState: (state) => {
          if (revision !== token || !isOpen()) return;
          phase = state.phase; text(state.message); render();
        },
      });
      if (revision !== token || !isOpen()) { await created.stop(); return; }
      engine = created;
      await engine.start();
      if (revision !== token || !isOpen()) { await created.stop(); return; }
      render();
    } catch (error) {
      if (revision !== token || !isOpen()) { await created?.stop?.(); return; }
      await stopSession('空间定位暂未能启动，请重试或返回实景展示。');
    }
  }
  openButton.addEventListener('click', () => void open());
  closeButton.addEventListener('click', () => void close());
  startButton.addEventListener('click', () => void launch());
  retryButton.addEventListener('click', () => { prepared = false; viewer.src = null; void prepare(); });
  exitButton.addEventListener('click', () => void stopSession());
  placeButton.addEventListener('click', () => { engine?.place(); render(); });
  resetButton.addEventListener('click', () => { engine?.recenter(); render(); });
  viewer.addEventListener('load', () => { if (isOpen()) showReady(); });
  viewer.addEventListener('error', () => { if (isOpen() && !active) { prepared = false; phase = 'error'; text('模型未能加载，可重新加载。'); render(); } });
  viewer.addEventListener('progress', (event) => { progress.value = event.detail?.totalProgress || 0; });
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
  });
  window.addEventListener('pagehide', () => { if (active) void stopSession(); });
  return { open, close, launch, stopSession, resize: () => engine?.resize?.(),
    getState: () => ({ phase, active, prepared, metadata, mode }) };
}
