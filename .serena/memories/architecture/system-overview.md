# mem:architecture/system-overview
The engine + pipelines in one place. Full detail: `.claude/claude-docs/ARCHITECTURE.md` + `provenance/DEEP_RESEARCH.md`. (Referred by `mem:core`.)

## Load split (C1)
Client does: metadata extraction, RAW decode, projection math, ephemeris, all rendering. Wix does: auth,
Data Collections, Media, Pricing Plans, eCommerce, AI proxy — via a few thin HTTP endpoints. Heavy compute on
an endpoint = wrong (move to client).

## Globe (D1/D2)
`three.js` (WebGL2, WebGPU progressive) + `3d-tiles-renderer` `TilesRenderer` + `CesiumIonAuthPlugin(96188)` +
`GlobeControls`. Stylize: `load-model` event → traverse tile scene → swap materials; `dispose-model` cleanup.
**Not** `BatchedTilesPlugin` (incompatible w/ per-mesh override). Precision: re-center tiles group near origin.

## Decode (D3)
main thread: `exifr` embedded-JPEG preview (<100ms). Worker: `libraw-wasm` demosaic (OffscreenCanvas, transfer
ArrayBuffer). HEIC: Safari-native `createImageBitmap` try/catch → `libheif-js` fallback. Free buffers immediately
(26MP≈80–104MB, 60MP≈180–240MB). Mobile: half-size, 1 concurrent.

## Projection (D4/D5)
frustum: position=GPS (terrain-snap junk altitude), orientation=heading/pitch/roll, `FOV=2·atan(sensorW/(2·focal))`
(sensor DB + `FocalLengthIn35mmFormat` fallback). Render photo as textured plane at frustum far face. EXIF params
live in **zustand** → scene subscribes → re-project each frame, fully client-side (no server round-trip). This
real-time what-if is the product's emotional core.

## Ephemeris (D6)
`astronomy-engine` → sun/moon/planet az-alt + scene lighting + Yale BSC5 star points, all from one time+observer.

## Data (D7) + endpoints
Collections: `Photos` (private working record), `PublicPins` (denormalized, reduced-precision, **no exact GPS**),
`Listings`. Query viewport by geohash-prefix `hasSome` + client refine (no geo operator). Endpoints:
`/api/upload-url` (resumable), `/api/photos` (quota+insert), `/api/analyze` (Claude, JPEG), `/api/moderate`.

## Design/GL bridge (D14)
`src/styles/tokens.css` (source of truth) → `src/lib/theme/tokens.ts` (GL bridge): accent→pin emissive/frustum,
bg→fog/space, golden-hour→sky grade. Regenerate bridge after any token change. Fence the globe from design imports.
