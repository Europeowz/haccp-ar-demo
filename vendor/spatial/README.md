# Local spatial runtime

- `xr/`: complete original `dist/` of `@8thwall/engine-binary@1.0.0` (13 files, byte-for-byte verified).
- `XR-ENGINE-LICENSE`: original package license. This is a restricted binary distribution, not MIT.
- `three/`: Three.js `0.164.1`, its MIT license, GLTFLoader and BufferGeometryUtils. Only the two
  add-on modules' import specifiers were rewritten to local paths; the engine binary is untouched.
- `dependency-manifest.json`: original package archive hashes, runtime file hashes, Three.js hashes.

The approved use is a free customer demonstration as part of the broader HACCP exhibit.
Keep the notice, original runtime files, license, and copyright notices when distributing it.

`spatial-engine.js` imports its Three.js modules locally, exposes the loader on `window.THREE`,
then loads local `xr/xr.js` and its `slam` chunk. It does not configure VPS, maps, face effects,
hand tracking, native Google AR, image markers, or remote model resources. It does not upload
camera images through application code. The binary contains URLs for dormant optional features;
actual runtime network traffic must be checked during device QA before claiming network isolation.

The adapter starts only on explicit `start()`. It uses the back camera and absolute meter scale,
requires a valid horizontal estimated/detected surface to permit `place()`, hides the model on
tracking loss, and requires explicit placement again after `recenter()`. `stop()` stops XR8 and
owned media tracks, removes the owned pipeline, and disposes the scene and renderer resources.

The adapter's `resize()` uses `canvas.clientWidth/clientHeight`, with DPR capped at 2. If an
ancestor is rotated for landscape, do not apply another rotation to the Three.js camera: video
and rendered scene must be transformed together. Hit-testing uses the local feed center.

Official API references:
- https://8thwall.org/docs/engine/overview
- https://8thwall.org/docs/api/engine/xrcontroller/configure
- https://8thwall.org/docs/api/engine/xrcontroller/hittest
- https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule
- https://8thwall.org/docs/api/engine/xr8/stop
