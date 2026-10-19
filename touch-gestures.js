/** Local structure-view gestures; callbacks are deliberately independent of any 3D library. */
const ROTATION_PER_PIXEL = 0.007;
const EXPLODE_TRAVEL = 240;
const EXPLODE_DEAD_ZONE = 8;
const ZOOM_DEAD_ZONE = 0.008;
const INTERACTIVE_START = 'button,a[href],input,select,textarea,summary,label,[role="button"],[role="slider"],[contenteditable]:not([contenteditable="false"]),[data-no-structure-gesture],.hotspot,.part-hotspot';

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function pointerGeometry(points) {
  if (points.length !== 2) return null;
  const [first, second] = points;
  if (![first.x, first.y, second.x, second.y].every(Number.isFinite)) return null;
  return {
    centerX: (first.x + second.x) / 2,
    centerY: (first.y + second.y) / 2,
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

export function rotationDelta(previous, current, sensitivity = ROTATION_PER_PIXEL) {
  return {
    azimuthDelta: (current.x - previous.x) * sensitivity,
    polarDelta: (current.y - previous.y) * sensitivity,
  };
}

/** A ratio above one means zoom in; a single event cannot jump by more than 40%. */
export function pinchZoomFactor(previousDistance, currentDistance) {
  if (!Number.isFinite(previousDistance) || !Number.isFinite(currentDistance) || previousDistance < 1 || currentDistance < 1) return 1;
  return clamp(currentDistance / previousDistance, 1 / 1.4, 1.4);
}

/** Upward movement increases the exploded state, with an eight-pixel dead zone. */
export function explodeFromCenter(startValue, startY, currentY, travel = EXPLODE_TRAVEL, deadZone = EXPLODE_DEAD_ZONE) {
  const initial = clamp(startValue, 0, 1);
  if (![startY, currentY, travel, deadZone].every(Number.isFinite) || travel <= 0) return initial;
  const delta = startY - currentY;
  const activeDelta = Math.sign(delta) * Math.max(0, Math.abs(delta) - Math.max(0, deadZone));
  return clamp(initial + activeDelta / travel, 0, 1);
}

export function wheelZoomFactor(deltaY, deltaMode = 0, pageHeight = 800) {
  if (!Number.isFinite(deltaY)) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  return clamp(Math.exp(-deltaY * unit * 0.0015), 1 / 1.4, 1.4);
}

export class TouchStructureController {
  constructor({ element, onZoom = () => {}, onRotate = () => {}, onExplode = () => {}, getExplode = () => 0, mapPoint = (event) => ({ x: event.clientX, y: event.clientY }) } = {}) {
    if (!element?.addEventListener || !element?.removeEventListener || !element?.style) {
      throw new TypeError('TouchStructureController needs an element with event listeners and a style object.');
    }
    this.element = element;
    this.onZoom = onZoom;
    this.onRotate = onRotate;
    this.onExplode = onExplode;
    this.getExplode = getExplode;
    this.mapPoint = mapPoint;
    this.enabled = false;
    this.destroyed = false;
    this.pointers = new Map();
    this.baseline = null;
    this.previousTouchAction = null;
    this.handlers = {
      pointerdown: (event) => this.handlePointerDown(event),
      pointermove: (event) => this.handlePointerMove(event),
      pointerup: (event) => this.handlePointerUp(event),
      pointercancel: (event) => { if (this.pointers.has(event.pointerId)) this.clearPointers(); },
      lostpointercapture: (event) => { if (this.pointers.has(event.pointerId)) this.clearPointers(); },
      wheel: (event) => this.handleWheel(event),
    };
  }

  enable() {
    if (this.enabled || this.destroyed) return;
    this.enabled = true;
    this.previousTouchAction = {
      value: this.element.style.getPropertyValue('touch-action'),
      priority: this.element.style.getPropertyPriority('touch-action'),
    };
    this.element.style.setProperty('touch-action', 'none');
    Object.entries(this.handlers).forEach(([name, handler]) => {
      this.element.addEventListener(name, handler, { passive: false });
    });
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    Object.entries(this.handlers).forEach(([name, handler]) => this.element.removeEventListener(name, handler));
    this.clearPointers();
    if (this.previousTouchAction?.value) {
      this.element.style.setProperty('touch-action', this.previousTouchAction.value, this.previousTouchAction.priority);
    } else {
      this.element.style.removeProperty('touch-action');
    }
    this.previousTouchAction = null;
  }

  destroy() {
    this.disable();
    this.destroyed = true;
  }

  ignoresStart(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node === this.element) break;
      if (node?.matches?.(INTERACTIVE_START)) return true;
    }
    return false;
  }

  resetBaseline() {
    const points = [...this.pointers.values()];
    if (points.length === 1) {
      this.baseline = { type: 'single', point: { ...points[0] } };
    } else if (points.length === 2) {
      const geometry = pointerGeometry(points);
      const explode = clamp(this.getExplode(), 0, 1);
      this.baseline = geometry ? {
        type: 'pair',
        distance: geometry.distance,
        startY: geometry.centerY,
        startExplode: explode,
        lastExplode: explode,
      } : null;
    } else {
      // Three or more fingers pause transformations until the count returns to one or two.
      this.baseline = null;
    }
  }

  handlePointerDown(event) {
    if (!this.enabled || this.ignoresStart(event)) return;
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const point = this.mapPoint(event);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.pointers.set(event.pointerId, point);
    try { this.element.setPointerCapture?.(event.pointerId); } catch { /* Capture may fail for a pointer already released by the browser. */ }
    this.resetBaseline();
    // Do not cancel down/up: a stationary pointer retains its normal click behavior.
  }

  handlePointerMove(event) {
    if (!this.enabled || !this.pointers.has(event.pointerId)) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    // Mouse release outside the window may arrive without a pointerup.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      this.clearPointers();
      return;
    }
    const point = this.mapPoint(event);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.pointers.set(event.pointerId, point);
    event.preventDefault();
    const baseline = this.baseline;
    if (!baseline) return;
    if (this.pointers.size === 1 && baseline.type === 'single') {
      const rotation = rotationDelta(baseline.point, point);
      baseline.point = point;
      if (rotation.azimuthDelta || rotation.polarDelta) this.onRotate(rotation);
      return;
    }
    if (this.pointers.size !== 2 || baseline.type !== 'pair') return;
    const geometry = pointerGeometry([...this.pointers.values()]);
    if (!geometry) return;
    const ratio = pinchZoomFactor(baseline.distance, geometry.distance);
    const zoomChanged = Math.abs(ratio - 1) >= ZOOM_DEAD_ZONE;
    // Accumulate tiny distance changes until they cross the jitter threshold.
    if (zoomChanged || baseline.distance < 1) baseline.distance = geometry.distance;
    const exploded = explodeFromCenter(baseline.startExplode, baseline.startY, geometry.centerY);
    const explodeChanged = Math.abs(exploded - baseline.lastExplode) >= 0.0005;
    if (explodeChanged) baseline.lastExplode = exploded;
    if (zoomChanged) this.onZoom(ratio);
    if (explodeChanged) this.onExplode(exploded);
  }

  handlePointerUp(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    // Delete first, so the ordinary lostpointercapture emitted by release is ignored.
    try { this.element.releasePointerCapture?.(event.pointerId); } catch { /* Already released. */ }
    this.resetBaseline();
  }

  handleWheel(event) {
    if (!this.enabled || this.ignoresStart(event)) return;
    const factor = wheelZoomFactor(event.deltaY, event.deltaMode, this.element.clientHeight || 800);
    if (factor === 1) return;
    event.preventDefault();
    this.onZoom(factor);
  }

  clearPointers() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.baseline = null;
    ids.forEach((id) => {
      try { this.element.releasePointerCapture?.(id); } catch { /* Pointer may have been canceled already. */ }
    });
  }
}

