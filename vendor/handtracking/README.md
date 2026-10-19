# Local hand tracking runtime

- Package: `@mediapipe/tasks-vision`, fixed version **0.10.21**.
- Package source: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz
- `vision_bundle.js` is the unmodified package's `vision_bundle.mjs`, renamed to work with the existing preview server's JavaScript MIME mapping.
- Model: Google's Hand Landmarker, `hand_landmarker/float16/1`.
- Model source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- Official guide: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Package license: Apache 2.0; see `LICENSE.txt`.
- File sizes, SHA-256 hashes and source URLs: `manifest.json`.

The JavaScript, both SIMD/non-SIMD WASM runtimes, and the trained model are hosted locally. The application does not upload camera images, record video, or request audio. It loads these assets only when the user enables hand controls. Inference uses the CPU, with at most 18 inference attempts per second; actual recognition speed varies by device.

Camera controls require HTTPS or localhost and browser permission. A denied permission, unavailable camera or initialization failure leaves the touch controls available.
