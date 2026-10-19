/**
 * Fit every corner of an axis-aligned world-space box into a perspective view.
 * theta/phi are radians, matching model-viewer.getCameraOrbit(); fieldOfView is
 * the vertical angle in degrees, matching model-viewer.getFieldOfView().
 * bounds.min/max accept either [x, y, z] or {x, y, z}. No DOM or renderer access.
 */
export function fitCameraToBounds({ bounds, aspect, theta = 28 * Math.PI / 180,
  phi = 60 * Math.PI / 180, fieldOfView = 32, padding = 1.10, minRadius = 0.01 } = {}) {
  const point = (value, label) => {
    const result = Array.isArray(value) ? value.slice(0, 3) : [value?.x, value?.y, value?.z];
    if (result.length !== 3 || result.some(number => !Number.isFinite(number))) {
      throw new TypeError(`${label} must contain three finite coordinates`);
    }
    return result;
  };
  const min = point(bounds?.min, 'bounds.min'), max = point(bounds?.max, 'bounds.max');
  if (min.some((number, axis) => number > max[axis])) throw new RangeError('bounds.min must not exceed bounds.max');
  for (const [label, value] of Object.entries({ aspect, theta, phi, fieldOfView, padding, minRadius })) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  }
  if (aspect <= 0) throw new RangeError('aspect must be positive');
  if (phi <= 0 || phi >= Math.PI) throw new RangeError('phi must be between 0 and PI radians');
  if (fieldOfView <= 0 || fieldOfView >= 180) throw new RangeError('fieldOfView must be between 0 and 180 degrees');
  if (padding < 1) throw new RangeError('padding must be at least 1');
  if (minRadius <= 0) throw new RangeError('minRadius must be positive');

  // Half sums avoid overflow when finite min/max values have the same sign.
  const center = min.map((value, axis) => value / 2 + max[axis] / 2);
  const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  // Three.js Spherical: the camera lies along this direction from its target.
  const backward = [sinPhi * sinTheta, cosPhi, sinPhi * cosTheta];
  const right = [cosTheta, 0, -sinTheta];
  const up = [-cosPhi * sinTheta, sinPhi, -cosPhi * cosTheta];
  const tanVertical = Math.tan(fieldOfView * Math.PI / 360);
  const tanHorizontal = tanVertical * aspect;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let radius = minRadius;
  for (let index = 0; index < 8; index++) {
    const corner = min.map((value, axis) => ((index & (1 << axis)) ? max[axis] : value) - center[axis]);
    const towardCamera = dot(corner, backward);
    // A corner has forward depth (radius - towardCamera). Solve its horizontal
    // and vertical frustum inequalities independently, including screen margin.
    radius = Math.max(radius,
      towardCamera + padding * Math.abs(dot(corner, right)) / tanHorizontal,
      towardCamera + padding * Math.abs(dot(corner, up)) / tanVertical,
      towardCamera + minRadius);
  }
  if (!Number.isFinite(radius)) throw new RangeError('bounds and camera settings exceed the finite range');
  return { target: { x: center[0], y: center[1], z: center[2] }, radius, theta, phi, fieldOfView };
}
