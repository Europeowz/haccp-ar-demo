/** Local 8th Wall SLAM integration. The proprietary runtime is shipped unchanged with its license. */
let runtimePromise;
let currentOwner = null;
let instanceCount = 0;

async function localRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const [THREE, {GLTFLoader}, {MeshoptDecoder}] = await Promise.all([
      import('./vendor/spatial/three/three.module.js'),
      import('./vendor/spatial/three/GLTFLoader.js'),
      import('./vendor/meshopt/meshopt_decoder.module.js'),
    ]);
    // The official Threejs pipeline reads this global. Supplying the loader avoids its CDN fallback.
    window.THREE = {...THREE, GLTFLoader};
    if (!window.XR8) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); script.remove(); reject(new Error('Local spatial runtime unavailable')); };
      const timer = setTimeout(fail, 45000);
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('xrloaded', done); };
      window.addEventListener('xrloaded', done, {once: true});
      script.src = new URL('./vendor/spatial/xr/xr.js', import.meta.url).href;
      script.async = true;
      script.setAttribute('data-preload-chunks', 'slam');
      script.onerror = fail;
      document.head.appendChild(script);
    });
    const XR8 = window.XR8;
    if (XR8?.loadChunk && !XR8.XrController) await XR8.loadChunk('slam');
    if (!XR8?.XrController || !XR8?.Threejs) throw new Error('Spatial SLAM modules unavailable');
    return {THREE, GLTFLoader, MeshoptDecoder, XR8};
  })().catch(error => { runtimePromise = null; throw error; });
  return runtimePromise;
}

function disposeTree(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse?.(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const geometry of geometries) geometry.dispose?.();
  root?.removeFromParent?.();
}

function floorHit(hit) {
  if (!hit || !['DETECTED_SURFACE', 'ESTIMATED_SURFACE'].includes(hit.type)) return false;
  if (!['x', 'y', 'z'].every(key => Number.isFinite(hit.position?.[key]))) return false;
  const q = hit.rotation;
  if (!q || !['x', 'y', 'z', 'w'].every(key => Number.isFinite(q[key]))) return false;
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 0.9 || length > 1.1) return false;
  // The transformed local Y axis must point up: reject walls and upside-down estimates.
  return 1 - 2 * ((q.x / length) ** 2 + (q.z / length) ** 2) >= 0.85;
}

/** loadRuntime/now/startTimeout are optional injection points for isolated lifecycle tests. */
export async function createSpatialEngine({canvas, modelUrl, scale = 1, onState = () => {},
  loadRuntime = localRuntime, now = () => performance.now(), startTimeout = 45000,
}) {
  if (!canvas || !modelUrl || !Number.isFinite(scale) || scale <= 0) throw new Error('Invalid spatial engine options');
  const name = `haccp-spatial-${++instanceCount}`;
  let state = {phase: 'stopped', message: '', placementReady: false, placed: false, tracking: false};
  let generation = 0, wanted = false, starting = null, deps = null, modules = [];
  let root = null, model = null, reticle = null, mixer = null, xrScene = null, observer = null;
  let latestHit = null, hitAt = 0, lastUpdate = 0, startTimer = 0, settleStart = null;
  let currentStream = null, load = null, viewport = '', pendingScene = null;
  const resources = [];
  const emit = (phase, message, patch = {}) => {
    state = {...state, ...patch, phase, message};
    try { onState({...state}); } catch (error) { console.error('Spatial state subscriber failed', error); }
  };
  const live = token => wanted && token === generation;

  function resize() {
    if (!canvas) return;
    const width = Math.max(1, canvas.clientWidth || 1), height = Math.max(1, canvas.clientHeight || 1);
    const ratio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    const key = `${width}:${height}:${ratio}`;
    if (key === viewport) return;
    viewport = key;
    // Local client dimensions remain correct when an ancestor rotates the whole surface for landscape.
    if (xrScene?.renderer) {
      xrScene.renderer.setPixelRatio?.(ratio);
      xrScene.renderer.setSize?.(width, height, false);
    } else { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  }
  function clearScene() {
    mixer?.stopAllAction?.();
    if (mixer && model) mixer.uncacheRoot?.(model);
    mixer = null;
    if (pendingScene && pendingScene !== model) disposeTree(pendingScene);
    pendingScene = null;
    disposeTree(root); disposeTree(reticle);
    for (const item of resources.splice(0)) item.removeFromParent?.();
    root = model = reticle = null;
    xrScene?.renderer?.renderLists?.dispose?.();
    xrScene?.renderer?.dispose?.();
    xrScene = null; latestHit = null; hitAt = 0; viewport = '';
  }
  function releaseEngine() {
    observer?.disconnect?.(); observer = null;
    if (currentOwner === api) {
      try { deps?.XR8?.stop?.(); } catch (error) { console.warn('Spatial runtime stop failed', error); }
      for (const module of modules) {
        try { deps?.XR8?.removeCameraPipelineModule?.(module.name); } catch (_) { /* Continue releasing owned modules. */ }
      }
      currentOwner = null;
    }
    modules = [];
    for (const track of currentStream?.getTracks?.() || []) { try { track.stop(); } catch (_) { /* Release remaining tracks. */ } }
    currentStream = null;
    clearScene();
  }
  function fail(message) {
    if (!wanted) return;
    wanted = false; generation++;
    clearTimeout(startTimer); startTimer = 0;
    settleStart?.(false); settleStart = null;
    releaseEngine();
    emit('error', message, {placementReady: false, placed: false, tracking: false});
  }
  function tracked(reality) {
    return reality?.trackingStatus === 'NORMAL' && ['x', 'y', 'z'].every(key => Number.isFinite(reality.position?.[key]));
  }
  function pickFloor() {
    try {
      const hits = deps.XR8.XrController.hitTest(0.5, 0.5, []);
      return hits?.filter(floorHit).sort((a, b) => (a.distance || 0) - (b.distance || 0))[0] || null;
    } catch (_) { return null; }
  }
  function update({processCpuResult} = {}) {
    if (!wanted || !root) return;
    const reality = processCpuResult?.reality;
    resize();
    if (!tracked(reality)) {
      root.visible = false;
      if (reticle) reticle.visible = false;
      latestHit = null;
      const wasTracked = state.tracking;
      if (wasTracked || state.placementReady) emit('lost', '空间定位暂时丢失，请对准有纹理的地面缓慢移动。', {tracking: false, placementReady: false});
      return;
    }
    const time = now();
    const delta = lastUpdate ? Math.min(0.1, Math.max(0, (time - lastUpdate) / 1000)) : 0;
    lastUpdate = time;
    if (state.placed) {
      root.visible = true;
      if (reticle) reticle.visible = false;
      if (!state.tracking || state.phase !== 'placed') emit('placed', '产线已放置，可以走近、绕行查看设备。', {tracking: true, placementReady: false});
      mixer?.update?.(delta);
      return;
    }
    latestHit = pickFloor(); hitAt = time;
    if (reticle) {
      reticle.visible = !!latestHit;
      if (latestHit) reticle.position.set(latestHit.position.x, latestHit.position.y + 0.005, latestHit.position.z);
    }
    if (latestHit) {
      if (state.phase !== 'ready' || !state.tracking) emit('ready', '已找到水平地面，点“放置产线”后开始参观。', {placementReady: true, tracking: true});
    } else if (state.phase !== 'scanning' || !state.tracking) {
      emit('scanning', '前后缓慢移动手机估计真实尺度，并将取景中心对准地面。', {placementReady: false, tracking: true});
    }
  }
  async function start() {
    if (wanted) return starting || true;
    wanted = true;
    const token = ++generation;
    emit('loading', '正在加载本地空间定位引擎和等身产线…', {placed: false, placementReady: false, tracking: false});
    // iOS requires these calls inside the user's click, before runtime/model loading awaits.
    const sensorPermissions = [];
    for (const EventType of [globalThis.DeviceMotionEvent, globalThis.DeviceOrientationEvent]) {
      if (typeof EventType?.requestPermission !== 'function') continue;
      try { sensorPermissions.push(Promise.resolve(EventType.requestPermission())); }
      catch (_) { sensorPermissions.push(Promise.resolve('denied')); }
    }
    const operation = (async () => {
      let gltf;
      try {
        const permissions = await Promise.all(sensorPermissions);
        if (!live(token)) return false;
        if (permissions.some(value => value !== 'granted')) {
          fail('空间参观需要运动与方向权限，请允许后重新开始。'); return false;
        }
        deps = await loadRuntime();
        if (!live(token)) return false;
        if (currentOwner && currentOwner !== api) throw new Error('Another spatial view is active');
        load = new deps.GLTFLoader();
        if (deps.MeshoptDecoder) load.setMeshoptDecoder(deps.MeshoptDecoder);
        gltf = await load.loadAsync(modelUrl);
        if (!live(token)) { disposeTree(gltf.scene); return false; }
        pendingScene = gltf.scene;
        if (currentOwner && currentOwner !== api) throw new Error('Another spatial view is active');
        const XR8 = deps.XR8, THREE = deps.THREE;
        const began = new Promise(resolve => { settleStart = resolve; });
        const custom = {
          name,
          onStart: () => {
            if (!live(token)) return;
            try {
              xrScene = XR8.Threejs.xrScene();
              if (!xrScene?.scene || !xrScene.camera) throw new Error('Spatial scene was not created');
              root = new THREE.Group(); root.visible = false;
              model = gltf.scene; model.scale.setScalar(scale); root.add(model); xrScene.scene.add(root);
              const sky = new THREE.HemisphereLight(0xe8f5ff, 0x7b8179, 2.3);
              const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(4, 8, 3);
              xrScene.scene.add(sky, sun); resources.push(sky, sun);
              reticle = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 32), new THREE.MeshBasicMaterial({color: 0x278fa7, side: THREE.DoubleSide}));
              reticle.rotation.x = -Math.PI / 2; reticle.visible = false; xrScene.scene.add(reticle);
              const clip = THREE.AnimationClip.findByName(gltf.animations || [], 'LineCycle');
              if (clip && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                mixer = new THREE.AnimationMixer(model); mixer.clipAction(clip).play();
              }
              lastUpdate = 0; viewport = ''; resize();
              emit('scanning', '前后缓慢移动手机估计真实尺度，并将取景中心对准地面。', {tracking: false});
              clearTimeout(startTimer); startTimer = 0; settleStart?.(true); settleStart = null;
            } catch (_) { fail('空间场景初始化失败，请返回后重新尝试。'); }
          },
          onUpdate: args => { if (live(token)) update(args); },
          onCameraStatusChange: ({status, stream} = {}) => {
            if (!live(token)) { for (const track of stream?.getTracks?.() || []) track.stop(); return; }
            if (stream) currentStream = stream;
            if (status === 'failed') fail('空间参观无法使用后置相机，请检查权限或关闭占用相机的应用。');
          },
          onException: () => { if (live(token)) fail('空间定位引擎运行失败，请返回后重试。'); },
        };
        XR8.XrController.configure({disableWorldTracking: false, scale: 'absolute', enableWorldPoints: false, enableLighting: false});
        modules = [XR8.GlTextureRenderer.pipelineModule(), XR8.Threejs.pipelineModule(), XR8.XrController.pipelineModule(), custom];
        currentOwner = api;
        XR8.addCameraPipelineModules(modules);
        if (globalThis.ResizeObserver) { observer = new ResizeObserver(resize); observer.observe(canvas); }
        resize();
        startTimer = setTimeout(() => { if (live(token)) fail('空间定位启动超时，请检查浏览器权限后重试。'); }, startTimeout);
        const runResult = XR8.run({canvas, allowedDevices: XR8.XrConfig.device().MOBILE,
          cameraConfig: {direction: XR8.XrConfig.camera().BACK}, sessionConfiguration: {defaultEnvironment: {disabled: true}}});
        Promise.resolve(runResult).catch(() => { if (live(token)) fail('此设备暂时无法启动空间定位，可以返回桌面展示。'); });
        return await began;
      } catch (_) {
        if (!live(token)) { if (gltf?.scene && gltf.scene !== model) disposeTree(gltf.scene); return false; }
        fail('本地空间引擎或模型加载失败，请返回后重试。'); return false;
      }
    })();
    starting = operation;
    try { return await operation; } finally { if (starting === operation) starting = null; }
  }
  function stop() {
    wanted = false; generation++;
    clearTimeout(startTimer); startTimer = 0;
    settleStart?.(false); settleStart = null;
    releaseEngine();
    emit('stopped', '空间参观已停止。', {placed: false, placementReady: false, tracking: false});
  }
  function place() {
    if (!wanted || !root || !state.tracking || !state.placementReady || now() - hitAt > 500) return false;
    const hit = pickFloor();
    if (!hit) { latestHit = null; if (reticle) reticle.visible = false; emit('scanning', '请重新将取景中心对准水平地面。', {placementReady: false}); return false; }
    root.position.set(hit.position.x, hit.position.y, hit.position.z);
    root.rotation.y = Math.atan2(xrScene.camera.position.x - hit.position.x, xrScene.camera.position.z - hit.position.z);
    root.visible = true; reticle.visible = false; latestHit = null;
    emit('placed', '产线已放置，可以走近、绕行查看设备。', {placed: true, placementReady: false});
    return true;
  }
  function recenter() {
    if (!wanted || !deps || !root) return;
    root.visible = false; reticle.visible = false; latestHit = null; hitAt = 0;
    deps.XR8.XrController.recenter();
    emit('scanning', '定位已重置，请重新扫描地面并放置产线。', {placed: false, placementReady: false, tracking: false});
  }
  const api = {start, stop, place, recenter, resize, getState: () => ({...state})};
  return api;
}
