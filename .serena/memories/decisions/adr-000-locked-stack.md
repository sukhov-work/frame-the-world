# mem:decisions/adr-000-locked-stack
The 15 **binding** founding decisions (PROJECT_SEED §4). Research-VERIFIED before the repo existed. To change
one, supersede via a new dated `DECISIONS.md` line — don't silently deviate. (Referred by `mem:core`.)

- **D1** Globe = three.js + `3d-tiles-renderer@^0.4` + Cesium OSM Buildings (ion **96188**) + `GlobeControls`. VERIFIED.
- **D2** Precision = re-center tiles group near origin (ReorientationPlugin/CESIUM_RTC) + dynamic near/far. VERIFIED.
- **D3** Decode = `exifr` preview → `libraw-wasm` Worker; single-thread SIMD default; HEIC Safari-native + `libheif-js`. VERIFIED pipeline / UNVERIFIED threads.
- **D4** Orientation = nudge-to-align is CORE; `FOV=2·atan(sensorW/(2·focal))` + sensor DB + `FocalLengthIn35mmFormat`. VERIFIED.
- **D5** Projection = textured plane at frustum far face (v1); projective texturing = v2. VERIFIED.
- **D6** Ephemeris = `astronomy-engine` (±1 arcmin) + procedural sky + Yale BSC5 stars; one source. VERIFIED.
- **D7** Data = Wix Data + geohash-prefix `hasSome` + client refine; denormalized `PublicPins`. VERIFIED(no-geo)/INFERRED.
- **D8** Quota = Pricing Plans + `beforeInsert` hook rejects insert #11 for free members (server-side). INFERRED.
- **D9** Media = originals private, previews public; resumable TUS >10MB; 30-day download links. VERIFIED.
- **D10** AI = runtime Claude via Wix AI (~1 credit; Opus 4.6); vision gets downsized JPEG; premium-gated; = moderation. VERIFIED.
- **D11** Scheduling = none v1; else external cron → token-secured HTTP endpoint. VERIFIED.
- **D12** Rendering = WebGL2 primary, WebGPU progressive (`three/webgpu`). VERIFIED.
- **D13** Cesium ion = Community (free PoC) → Commercial $149/mo at first sale / >$50K entity; manual attribution. VERIFIED.
- **D14** Design = Claude Design tokens → `tokens.css` (source of truth) → GL bridge `tokens.ts`; fence the globe; skip Wix connector. VERIFIED(workflow).
- **D15** Working title = "Frame the World". ASSUMPTION (provisional — rename freely).
