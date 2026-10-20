/* AR entry requests permission before the renderer; 3D is an explicit alternative. */
(() => {
  'use strict';
  if (window.ExhibitCamera) return;
  const parameters = new URLSearchParams(location.search);
  const validCase = (parameters.get('case') || 'water') === 'water';
  const inWeChat = /MicroMessenger/i.test(navigator.userAgent || '');
  const subscribers = new Set();
  const cameraWaits = new Set();
  let elements = null, generation = 0, wanted = false, stream = null, pending = null;
  let earlyRequest = null;
  let initialized = false, suspended = false, resumeOnVisible = false, resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  let state = {
    mode: parameters.get('camera') === 'off' || parameters.get('view') === '3d' ? '3d' : 'ar',
    phase: 'off', reason: '', message: '', requestedAt: null, startRequestedBeforeModel: null,
  };
  const snapshot = () => ({ ...state, stream });
  function render() {
    if (!elements) return;
    const opening = state.phase === 'opening', active = state.phase === 'active';
    const gated = validCase && !['off', 'active'].includes(state.phase);
    elements.stage?.classList.toggle('camera-opening', opening);
    elements.stage?.classList.toggle('camera-active', active);
    elements.stage?.classList.toggle('camera-gated', gated);
    if (elements.gate) { elements.gate.hidden = !gated; elements.gate.setAttribute('aria-busy', String(opening)); }
    if (elements.title) elements.title.textContent = state.reason === 'insecure' ? '此链接无法进入 AR'
      : state.phase === 'permission' ? '请允许 AR 权限' : state.reason === 'playback' ? '继续 AR 实景' : 'AR 实景产线';
    if (elements.message) elements.message.textContent = state.message;
    if (elements.context) {
      elements.context.hidden = state.reason !== 'insecure';
      elements.context.textContent = state.reason === 'insecure'
        ? `当前地址：${location.origin || 'HTTP'}。请使用部署后的 HTTPS 链接扫码。` : '';
    }
    if (elements.retry) {
      elements.retry.hidden = opening || ['insecure', 'unsupported', 'policy'].includes(state.reason);
      elements.retry.disabled = false;
      elements.retry.textContent = inWeChat && state.phase === 'permission' ? '继续 AR 体验' : state.reason === 'playback' ? '继续 AR' : '重试 AR';
    }
    if (elements.button) {
      elements.button.setAttribute('aria-pressed', String(state.mode === '3d'));
      elements.button.setAttribute('aria-label', state.mode === 'ar' ? '切换 3D 浏览' : '返回 AR 实景');
    }
    if (elements.label) elements.label.textContent = state.mode === 'ar' ? '切换 3D' : '返回 AR';
    if (elements.mode) elements.mode.textContent = state.reason === 'hands' ? '前摄手势模式' : active ? 'AR 实景预览' : opening ? '正在进入 AR' : '3D 展台';
    if (elements.instruction) elements.instruction.textContent = state.reason === 'hands' ? '后置实景已暂停 · 关闭手势后恢复' : active
      ? '产线已呈现 · 拖动旋转 · 双指缩放' : opening ? '请允许浏览器权限' : '拖动旋转 · 双指缩放';
  }
  function publish(phase, message, reason = '') {
    state = { ...state, phase, message, reason }; render();
    for (const subscriber of subscribers) {
      try { subscriber(snapshot()); } catch (error) { console.error('AR subscriber failed', error); }
    }
  }
  function release(value) {
    for (const track of value?.getTracks() || []) {
      try { track.stop(); } catch (_) { /* Release the remaining tracks too. */ }
    }
  }
  function clearSession() {
    generation += 1; wanted = false; pending = null;
    for (const cancel of [...cameraWaits]) cancel();
    earlyRequest?.retire(); earlyRequest = null;
    const previous = stream; stream = null;
    if (elements?.feed) { elements.feed.pause?.(); elements.feed.srcObject = null; }
    release(previous);
  }
  // Host tools suspend the rear feed without changing the user's AR/3D choice.
  function stop({reason = 'paused', message = 'AR 实景暂时暂停，可继续查看模型。'} = {}) {
    suspended = true; resumeOnVisible = false; clearSession();
    publish('off', message, reason);
  }
  function continue3D() {
    state.mode = '3d'; suspended = false; resumeOnVisible = false; clearSession();
    publish('off', '已切换到 3D 浏览。');
  }
  function resume() {
    if (state.mode !== 'ar') return Promise.resolve(false);
    suspended = false; return start();
  }
  function failed(error, token) {
    if (token !== generation || !wanted) return false;
    clearSession();
    const permission = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    const message = permission ? (inWeChat
      ? '请允许微信中本页面的相机请求，并确认手机设置已允许微信使用相机。仍无授权提示时，可从微信右上角菜单使用系统浏览器打开此链接。'
      : 'AR 需要相机权限。请在地址栏的网站权限中允许相机，再重试 AR。')
      : error?.name === 'TimeoutError'
        ? '相机暂未响应。请先处理浏览器的授权提示，再重试 AR；也可以先切换 3D。'
      : error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError'
        ? '未检测到可用相机，暂时无法呈现实景。可以切换 3D 浏览。'
        : error?.name === 'NotReadableError'
          ? '相机正被其他应用占用。关闭占用后重试 AR，或切换 3D。'
          : 'AR 实景暂时无法呈现。可以重试 AR，或切换 3D 浏览。';
    publish(permission ? 'permission' : 'error', message, permission ? 'permission' : 'device'); return false;
  }
  function waitForCamera(operation, token, milliseconds, onLate) {
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (method, value) => {
        if (settled) return;
        settled = true; if (timer !== undefined) clearTimeout(timer);
        cameraWaits.delete(cancel); method(value);
      };
      const cancel = () => finish(reject, Object.assign(new Error('Camera request cancelled'), { name: 'AbortError' }));
      cameraWaits.add(cancel);
      if (typeof setTimeout === 'function') timer = setTimeout(() => finish(reject,
        Object.assign(new Error('Camera response timed out'), { name: 'TimeoutError' })), milliseconds);
      Promise.resolve(operation).then(value => {
        if (settled || token !== generation || !wanted) { onLate?.(value); if (!settled) cancel(); return; }
        finish(resolve, value);
      }, error => finish(reject, error));
    });
  }
  function primeCameraPermission() {
    if (document.hidden || document.getElementById('camera-feed') || !validCase || state.mode !== 'ar' || !window.isSecureContext
      || !navigator.mediaDevices?.getUserMedia) return;
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature('camera')) return;
    let retained = null, retired = false;
    const requestedAt = performance.now();
    {
      let request;
      try { request = navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
      catch (error) { request = Promise.reject(error); }
      const promise = Promise.resolve(request).then(value => {
        if (retired) { release(value); return null; }
        retained = value; return value;
      });
      promise.catch(() => {}); // The mounted controller reports the permission result.
      earlyRequest = { promise, requestedAt,
        claim() { retained = null; },
        retire() { retired = true; release(retained); retained = null; },
      };
      window.addEventListener('pagehide', () => { earlyRequest?.retire(); earlyRequest = null; }, { once: true });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && earlyRequest) { earlyRequest.retire(); earlyRequest = null; }
      });
    }
  }
  async function start() {
    if (!elements) await ready;
    if (!validCase || !elements?.feed) return false;
    state.mode = 'ar'; suspended = false;
    if (document.hidden) { resumeOnVisible = true; render(); return false; }
    resumeOnVisible = false;
    if (state.phase === 'active' && stream) return true;
    if (pending) return pending;
    if (!window.isSecureContext) {
      clearSession();
      publish('error', '此 HTTP 链接被浏览器禁止申请 AR 相机权限。请改用 HTTPS 地址；反复点击无法解除限制。', 'insecure'); return false;
    }
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature('camera')) {
      clearSession();
      publish('error', '当前嵌入页面禁止相机权限，请在手机浏览器中直接打开此页面的 HTTPS 地址。', 'policy'); return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      clearSession();
      publish('error', inWeChat
        ? '当前微信环境未提供网页相机接口。请从微信右上角菜单使用系统浏览器打开此 HTTPS 链接，或切换 3D。'
        : '当前浏览器未提供 AR 相机接口，请使用支持相机权限的手机浏览器打开 HTTPS 链接。', 'unsupported'); return false;
    }
    const playbackStream = state.reason === 'playback' ? stream : null;
    wanted = true;
    const token = ++generation;
    const early = earlyRequest; earlyRequest = null; early?.claim();
    state = { ...state, requestedAt: early?.requestedAt ?? performance.now(), startRequestedBeforeModel: !!early || !window.customElements?.get('model-viewer') };
    publish('opening', playbackStream ? '正在继续 AR 实景…' : '正在申请 AR 展示所需的相机权限，请在浏览器提示中允许。');
    const operation = (async () => {
      let acquired;
      try {
        acquired = playbackStream || await waitForCamera(early?.promise || navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }), token, 30000, release);
        if (token !== generation || !wanted || document.hidden) { if (acquired !== playbackStream) release(acquired); return false; }
        stream = acquired;
        elements.feed.muted = true; elements.feed.playsInline = true; elements.feed.srcObject = acquired;
        try { await waitForCamera(elements.feed.play(), token, 10000); }
        catch (error) {
          if (token !== generation) return false;
          if (error?.name === 'NotAllowedError') {
            publish('playback', '权限已获准。浏览器需要一次触碰来显示实景，请点“继续 AR”。', 'playback'); return false;
          }
          throw error;
        }
        if (token !== generation || !wanted || document.hidden) {
          if (stream === acquired) { stream = null; elements.feed.srcObject = null; release(acquired); }
          return false;
        }
        for (const track of acquired.getTracks()) {
          track.addEventListener?.('ended', () => {
            if (stream !== acquired || token !== generation) return;
            clearSession(); publish('error', 'AR 实景已中断，可以重试 AR，或切换 3D。', 'device');
          });
        }
        publish('active', '产线模型已进入 AR 实景预览。'); return true;
      } catch (error) { if (token !== generation) return false; return failed(error, token); }
      finally { if (token === generation) pending = null; }
    })();
    if (token === generation) pending = operation;
    return operation;
  }
  function subscribe(subscriber) {
    if (typeof subscriber !== 'function') return () => {};
    subscribers.add(subscriber);
    try { subscriber(snapshot()); } catch (error) { console.error('AR subscriber failed', error); }
    return () => subscribers.delete(subscriber);
  }
  function pauseForBackground() {
    if (state.mode === 'ar' && !suspended && ['opening', 'active', 'playback'].includes(state.phase)) {
      resumeOnVisible = true; clearSession(); publish('off', 'AR 实景已暂停，返回后继续。', 'background');
    }
  }
  function restoreForeground() { if (!document.hidden && resumeOnVisible && !suspended && state.mode === 'ar') void start(); }
  window.ExhibitCamera = Object.freeze({ start, stop, resume, continue3D, getState: snapshot, subscribe });
  function initialize() {
    if (initialized) return;
    initialized = true;
    const byId = (id) => document.getElementById(id);
    elements = {
      stage: byId('stage'), feed: byId('camera-feed'), button: byId('view-mode-toggle'), label: byId('view-mode-label'),
      mode: byId('stage-mode'), instruction: byId('stage-instruction'), gate: byId('camera-gate'), title: byId('ar-entry-title'),
      message: byId('camera-gate-message'), context: byId('ar-entry-context'), retry: byId('camera-retry'), fallback: byId('camera-fallback'),
    };
    elements.button?.addEventListener('click', () => { if (state.mode === 'ar') continue3D(); else void start(); });
    elements.retry?.addEventListener('click', () => { void start(); });
    elements.fallback?.addEventListener('click', continue3D);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseForBackground(); else restoreForeground(); });
    window.addEventListener('pagehide', pauseForBackground); window.addEventListener('pageshow', restoreForeground);
    resolveReady(); render(); if (validCase && state.mode === 'ar' && !suspended) void start();
  }
  primeCameraPermission();
  if (document.readyState === 'loading' && !document.getElementById('camera-feed')) {
    document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') initialize(); });
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else initialize();
})();
