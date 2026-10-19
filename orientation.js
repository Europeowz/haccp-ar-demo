/** One landscape preference for the AR stage, inspection, tour and report. */
export const ORIENTATION_STORAGE_KEY = 'haccp:orientation:v1';
export const ORIENTATION_CHANGE_EVENT = 'haccp-orientation-change';
const managers = new WeakMap();

function createManager(doc) {
  const win = doc.defaultView || globalThis;
  let storage;
  try { storage = win.sessionStorage; } catch { /* Private browsing may disable storage. */ }
  let requested = false;
  try { requested = storage?.getItem(ORIENTATION_STORAGE_KEY) === 'landscape'; } catch {}
  const surfaces = new Set();
  let revision = 0;
  let ownedFullscreen = null;
  const orientation = () => win.screen?.orientation;
  const render = () => surfaces.forEach(surface => surface.render(requested));
  const persist = () => {
    try { storage?.setItem(ORIENTATION_STORAGE_KEY, requested ? 'landscape' : 'auto'); } catch {}
  };
  function announce() {
    if (!win.dispatchEvent || !win.CustomEvent) return;
    win.dispatchEvent(new win.CustomEvent(ORIENTATION_CHANGE_EVENT, {
      detail: { requested, mode: requested ? 'landscape' : 'auto' },
    }));
  }
  function update(value) {
    requested = Boolean(value);
    persist();
    render();
    announce();
  }
  async function releaseFullscreen(target) {
    if (!target || doc.fullscreenElement !== target) return;
    try { await doc.exitFullscreen(); } catch { /* It may already have closed. */ }
    if (ownedFullscreen === target) ownedFullscreen = null;
  }
  async function enter(target) {
    const version = ++revision;
    // Permission dialogs may leave fullscreen. Apply every surface immediately.
    update(true);
    let openedHere = false;
    if (target?.requestFullscreen && !doc.fullscreenElement) {
      try {
        await target.requestFullscreen({ navigationUI: 'hide' });
        openedHere = doc.fullscreenElement === target;
        if (openedHere) ownedFullscreen = target;
      } catch { /* CSS landscape remains usable without native fullscreen. */ }
    }
    if (version !== revision || !requested || surfaces.size === 0) {
      // A late fullscreen response must never undo an explicit exit.
      if ((!requested || surfaces.size === 0) && openedHere) await releaseFullscreen(target);
      return;
    }
    try { await orientation()?.lock?.('landscape'); } catch { /* Use rotated CSS. */ }
    if (version !== revision || !requested || surfaces.size === 0) {
      if (!requested || surfaces.size === 0) {
        try { orientation()?.unlock?.(); } catch {}
      }
      if (!requested && openedHere) await releaseFullscreen(target);
      return;
    }
    render();
  }
  async function exit() {
    ++revision;
    update(false);
    try { orientation()?.unlock?.(); } catch {}
    const target = ownedFullscreen;
    ownedFullscreen = null;
    await releaseFullscreen(target);
  }
  function fullscreenChanged() {
    if (ownedFullscreen && doc.fullscreenElement !== ownedFullscreen) ownedFullscreen = null;
    // Camera/hand permission and system UI can exit fullscreen. Keep all panels
    // wide until the visitor explicitly chooses to leave landscape mode.
    render();
  }
  function externalChange(event) {
    if (typeof event.detail?.requested !== 'boolean' || event.detail.requested === requested) return;
    if (event.detail.requested) {
      ++revision;
      update(true);
    } else void exit();
  }
  doc.addEventListener('fullscreenchange', fullscreenChanged);
  win.addEventListener?.(ORIENTATION_CHANGE_EVENT, externalChange);
  return {
    surfaces, enter, exit,
    get requested() { return requested; },
    remove(surface) {
      surfaces.delete(surface);
      if (surfaces.size) return;
      ++revision;
      doc.removeEventListener('fullscreenchange', fullscreenChanged);
      win.removeEventListener?.(ORIENTATION_CHANGE_EVENT, externalChange);
      managers.delete(doc);
      // Navigation keeps the preference; remove only this document's lock.
      try { orientation()?.unlock?.(); } catch {}
      const target = ownedFullscreen;
      ownedFullscreen = null;
      void releaseFullscreen(target);
    },
  };
}

/** Backward-compatible API; fullscreenTarget can include modal panels. */
export function setupOrientation({ stage, button, onChange = () => {}, fullscreenTarget = stage }) {
  if (!stage || !button) throw new TypeError('Orientation needs a surface and a button.');
  const doc = stage.ownerDocument || document;
  let manager = managers.get(doc);
  if (!manager) {
    manager = createManager(doc);
    managers.set(doc, manager);
  }
  let destroyed = false;
  const surface = {
    render(requested) {
      stage.classList.toggle('force-landscape', requested);
      button.setAttribute('aria-pressed', String(requested));
      button.textContent = requested ? '退出横屏' : '横屏查看';
      onChange({ requested });
    },
  };
  const enter = () => destroyed ? Promise.resolve() : manager.enter(fullscreenTarget);
  const exit = () => destroyed ? Promise.resolve() : manager.exit();
  const click = () => { if (manager.requested) void exit(); else void enter(); };
  manager.surfaces.add(surface);
  button.addEventListener('click', click);
  // Restore CSS without asking for fullscreen/device permissions on navigation.
  surface.render(manager.requested);
  return { enter, exit, get requested() { return manager.requested; }, destroy() {
    if (destroyed) return;
    destroyed = true;
    button.removeEventListener('click', click);
    stage.classList.toggle('force-landscape', false);
    manager.remove(surface);
  } };
}
