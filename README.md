# HACCP beverage line AR demonstration

Public static customer demonstration, version 10. Files in this repository are the assets served by the demo.

The app displays a preconfigured illustrative beverage line and HACCP example. It does not parse submitted files or generate engineering geometry using AI.

## Third party notices

The original 8th Wall XR Engine binary 1.0.0 is included unchanged under its limited-use agreement, retained at `vendor/spatial/XR-ENGINE-LICENSE` and `vendor/spatial/xr/LICENSE`. Its copyrights, attribution and disclaimer are retained. See `vendor/spatial/NOTICE` and the in-app license page. This demonstration is provided free of charge. The proprietary binary is not MIT licensed.

Three.js and other bundled libraries retain their original notices. No repository-wide license grants rights that override those third party licenses.

Camera frames are processed on device. Physical dual-camera operation and ground tracking depend on the phone and browser.

Version 7 improves hand-runtime loading, viewport-aware framing, landscape controls and WeChat permission guidance. Browser simulation is not physical-phone acceptance.

Version 8 preloads the selected compact model, bundles local Meshopt decoders and recovers failed life-size preview loads using a fresh request URL. Geometry is quantized with small measured error; original assets are retained.

Version 9 shares the compact model between the entry and analysis pages, merges bitwise-identical vertices and retains the v8 appearance, topology and animations. It does not claim a major new cold-load speedup.

Version 10 starts the entry camera request before model modules, waits for XR core initialization explicitly, bounds and cancels every startup stage, restores previews after failure, and fixes spatial control contrast. Physical phone AR acceptance remains pending.
