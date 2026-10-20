import { setupOrientation } from './orientation.js?v=13';

const stage = document.getElementById('analysis-shell');
const button = document.getElementById('analysis-orientation');
if (stage && button) {
  setupOrientation({ stage, button, fullscreenTarget: document.documentElement });
}
