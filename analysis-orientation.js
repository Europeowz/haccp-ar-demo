import { setupOrientation } from './orientation.js?v=6';
import { TouchStructureController } from './touch-gestures.js?v=3';

const stage = document.getElementById('analysis-shell');
const button = document.getElementById('analysis-orientation');
const viewer = document.getElementById('viewer');
if (stage && button) {
  const touch = viewer && new TouchStructureController({
    element: viewer,
    mapPoint: event => {
      const rect = viewer.getBoundingClientRect();
      return { x: event.clientY - rect.top, y: rect.right - event.clientX };
    },
    onRotate: ({ azimuthDelta, polarDelta }) => {
      if (!viewer.loaded) return;
      const orbit = viewer.getCameraOrbit();
      const phi = Math.max(Math.PI / 12, Math.min(88 * Math.PI / 180, orbit.phi - polarDelta));
      viewer.cameraOrbit = `${orbit.theta - azimuthDelta}rad ${phi}rad ${orbit.radius}m`;
      viewer.jumpCameraToGoal?.();
    },
    onZoom: factor => {
      if (!viewer.loaded) return;
      const orbit = viewer.getCameraOrbit();
      const radius = Math.max(0.6, Math.min(8, orbit.radius / factor));
      viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${radius}m`;
      viewer.jumpCameraToGoal?.();
    },
  });
  function updateControls() {
    if (!viewer) return;
    touch.disable();
    if (stage.classList.contains('force-landscape') && matchMedia('(orientation: portrait)').matches) {
      // Native model-viewer gestures read screen axes. Map them back to the
      // rotated report's axes, as on the AR stage, while report margins scroll.
      viewer.removeAttribute('camera-controls');
      touch.enable();
    } else viewer.setAttribute('camera-controls', '');
  }
  setupOrientation({ stage, button, fullscreenTarget: document.documentElement, onChange: () => requestAnimationFrame(updateControls) });
  viewer?.addEventListener('load', updateControls);
  window.addEventListener('resize', updateControls);
}
