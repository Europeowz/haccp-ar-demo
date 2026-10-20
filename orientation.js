/** Native fullscreen only. Layout always follows the browser's actual viewport. */
export const ORIENTATION_STORAGE_KEY = 'haccp:orientation:v1';
export const ORIENTATION_CHANGE_EVENT = 'haccp-orientation-change';
const managers = new WeakMap();

function createManager(doc) {
  const win = doc.defaultView || globalThis;
  let storage;
  try { storage = win.sessionStorage; } catch { /* Private browsing may disable storage. */ }
  // Retire the old cross-page CSS rotation preference, including existing visits.
  try { storage?.removeItem(ORIENTATION_STORAGE_KEY); } catch {}
  let requested = false;
  let pending = false;
  const surfaces = new Set();
  let revision = 0;
  let ownedFullscreen = null;
  const orientation = () => win.screen?.orientation;
  const render = () => surfaces.forEach(surface => surface.render(requested, pending));
  function announce() {
    if (!win.dispatchEvent || !win.CustomEvent) return;
    win.dispatchEvent(new win.CustomEvent(ORIENTATION_CHANGE_EVENT, {
      detail: { requested, mode: requested ? 'fullscreen' : 'auto' },
    }));
  }
  function update(value) {
    requested = Boolean(value);
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
    pending = true;
    render();
    let openedHere = false;
    if (target?.requestFullscreen && !doc.fullscreenElement) {
      try {
        await target.requestFullscreen({ navigationUI: 'hide' });
        openedHere = doc.fullscreenElement === target;
        if (openedHere) ownedFullscreen = target;
      } catch { /* Unsupported fullscreen keeps the current viewport and layout. */ }
    }
    if (version !== revision || surfaces.size === 0) {
      if ((!requested || surfaces.size === 0) && openedHere) await releaseFullscreen(target);
      return;
    }
    pending = false;
    update(Boolean(ownedFullscreen && doc.fullscreenElement === ownedFullscreen));
    if (!requested) return;
    try { await orientation()?.lock?.('landscape'); } catch { /* Rotation remains a device/browser choice. */ }
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
    pending = false;
    update(false);
    try { orientation()?.unlock?.(); } catch {}
    const target = ownedFullscreen;
    ownedFullscreen = null;
    await releaseFullscreen(target);
  }
  function fullscreenChanged() {
    if (ownedFullscreen && doc.fullscreenElement !== ownedFullscreen) {
      ownedFullscreen = null;
      ++revision;
      pending = false;
      try { orientation()?.unlock?.(); } catch {}
      update(false);
    } else render();
  }
  doc.addEventListener('fullscreenchange', fullscreenChanged);
  return {
    surfaces, enter, exit,
    get requested() { return requested; },
    get pending() { return pending; },
    remove(surface) {
      surfaces.delete(surface);
      if (surfaces.size) return;
      ++revision;
      doc.removeEventListener('fullscreenchange', fullscreenChanged);
      managers.delete(doc);
      pending = false;
      requested = false;
      // Leaving the page releases only fullscreen and locking owned here.
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
    render(requested, pending) {
      stage.classList.toggle('force-landscape', false);
      button.setAttribute('aria-pressed', String(requested));
      button.textContent = pending ? '正在进入全屏' : requested ? '退出全屏' : '全屏查看';
      onChange({ requested });
    },
  };
  const enter = () => destroyed ? Promise.resolve() : manager.enter(fullscreenTarget);
  const exit = () => destroyed ? Promise.resolve() : manager.exit();
  const click = () => { if (manager.requested || manager.pending) void exit(); else void enter(); };
  manager.surfaces.add(surface);
  button.addEventListener('click', click);
  surface.render(manager.requested, manager.pending);
  return { enter, exit, get requested() { return manager.requested; }, destroy() {
    if (destroyed) return;
    destroyed = true;
    button.removeEventListener('click', click);
    stage.classList.toggle('force-landscape', false);
    manager.remove(surface);
  } };
}
