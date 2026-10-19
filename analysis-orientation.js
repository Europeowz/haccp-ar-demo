import { setupOrientation } from './orientation.js?v=6';

const stage = document.getElementById('analysis-shell');
const button = document.getElementById('analysis-orientation');
if (stage && button) {
  setupOrientation({ stage, button, fullscreenTarget: document.documentElement, onChange: () => {
    // Notify model-viewer after its actual container has rotated.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  } });
}
