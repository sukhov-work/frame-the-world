# Frame the World — Architecture (repo-native)

Distilled working reference. **Provenance:** `DEEP_RESEARCH.md` Part 1–2 (research + ASCII diagram +
stack table + cost table) and `PROJECT_SEED.md` §4–5. Those are canonical; this doc is the fast map plus
the repo-native additions (data model, endpoint contracts, component responsibilities). Evidence tags
carried from research: [VERIFIED] / [INFERRED] / [UNVERIFIED].

## 1. One-paragraph system
An Astro-5 Wix-managed-headless app. A `client:only` island runs the whole instrument in the browser:
upload → Web Worker decode (`exifr` preview + `libraw-wasm` demosaic) → reactive EXIF state (`zustand`) →
three.js scene (`3d-tiles-renderer` + Cesium OSM Buildings, stylized via `load-model` material override,
`GlobeControls` navigation, camera frustum + image-plane per pin, procedural sky + `astronomy-engine`
sun/moon/stars). Wix (via `@wix/astro` auto-auth + a few HTTP endpoints) provides auth, Data Collections,
Media, Pricing Plans, eCommerce digital products, and the Claude AI proxy. See the ASCII diagram in
`DEEP_RESEARCH.md § "Final architecture"`.

## 2. Engine hybrid (the core decision — ADR D1) [VERIFIED]
`three.js` (WebGL2 primary, WebGPU progressive via `three/webgpu`) + `3d-tiles-renderer@^0.4` (NASA-AMMOS,
Apache-2.0) + **Cesium OSM Buildings (ion asset 96188)** via `CesiumIonAuthPlugin({ apiToken, assetId: 96188 })`
+ `GlobeControls`. Stylization = `load-model` traverse + material swap (`dispose-model` cleanup); **not**
`BatchedTilesPlugin`. Precision = re-center tiles group near origin (ReorientationPlugin / CESIUM_RTC) +
`GlobeControls` dynamic near/far. Google Photorealistic 3D Tiles = optional unmodified "realistic mode" only (C5).
**2026-07-10 addition (browser-VERIFIED):** the visual layer is three co-registered elements on WGS84 —
(1) a self-lit base-earth ShaderMaterial (NASA Blue Marble July + VIIRS night lights + relief, graded via GL
tokens), (2) a **second `TilesRenderer`** draping palette-graded **Esri World Imagery** (z19) via
`GeneratedSurfacePlugin` + `XYZTilesOverlay`, screen-door-dissolved in by altitude (progressive detail, no
LOD switch; Esri production ToS = TODO-VERIFY before release), (3) the OSM building tiles (dark slate +
`EdgesGeometry` strokes), sunk 90 m to cancel their Cesium-World-Terrain clamp until real terrain lands.
Default camera = LEO oblique + idle orbital drift (the seed's signature scene). Mechanics:
`mem:patterns/globe-rendering`.

## 3. Decode pipeline (ADR D3) [VERIFIED pipeline; UNVERIFIED threads]
`exifr` embedded-JPEG instant preview (<100ms target) → `libraw-wasm` full demosaic in a **Web Worker**
(OffscreenCanvas, transfer ArrayBuffer). HEIC: Safari-native `createImageBitmap` detect (17–39× faster) →
`libheif-js` dynamic-import fallback. **Single-threaded SIMD by default** (COOP/COEP unverified). Heap:
26MP ≈ 80–104MB, 60MP ≈ 180–240MB → free buffers immediately; mobile half-size, 1 concurrent decode.

## 4. Projection + ephemeris (ADR D4/D5/D6) [VERIFIED]
- **Frustum from EXIF:** position = GPS (terrain-snap junk altitude); orientation = heading (yaw) / pitch /
  roll; `FOV = 2·atan(sensorWidth / (2·focal))` with sensor DB + `FocalLengthIn35mmFormat` fallback.
- **Projection v1:** textured plane at frustum far face (occlusion-safe). Projective texturing = v2 stretch.
- **Nudge-to-align is core, not fallback** — ILCs rarely write heading/pitch; GPS is 3–15m, altitude unreliable.
- **Ephemeris:** `astronomy-engine` (±1 arcmin, VSOP87/NOVAS) → sun/moon/planet az-alt + scene lighting +
  Yale BSC5 (~9,100 stars) point rendering, all from one time+observer input. Procedural sky shader.

## 5. Data model — Wix Data Collections (ADR D7) [VERIFIED no-geo; INFERRED schema]
> No geospatial operator → geohash-prefix `hasSome` + client refine. Denormalize hot fields into `PublicPins`.

**Photos** (owner-private working record)
`_id, ownerMemberId(ref), title, mediaFileIdOriginal(private), previewUrl(public), lat(num), lon(num),
alt(num), geohash(str), headingDeg(num), pitchDeg(num), rollDeg(num), focalMm(num), focal35(num),
sensorWidthMm(num), lensModel(str), captureTime(datetime), tzOffset(str), isPublic(bool),
publicPrecision(str: exact|1km|city), forSale(bool), price(num), createdAt`

**PublicPins** (denormalized for fast globe/viewport query)
`_id, photoRef, geohash, latReduced, lonReduced, previewUrlLowRes, title`  ← **never** exact GPS (C6)

**Listings** (marketplace)
`_id, photoRef, sellerMemberId, price, status, digitalProductId`

## 6. Endpoint contracts (Astro backend — thin; heavy compute stays client-side per C1)
| Endpoint | Does | Notes |
|---|---|---|
| `POST /api/upload-url` | `elevate()` → `generateFileResumableUploadUrl` for RAW >10MB → return url/token | TUS; async ready |
| `POST /api/photos` | `elevate()` → validate → **enforce quota** → insert `Photos` (+`PublicPins` if public) | quota hook rejects #11 free |
| `POST /api/analyze` | premium-gate → Wix AI (Claude) with **downsized JPEG** + desired-condition prompt → suggestions | ~1 credit; never RAW |
| `POST /api/moderate` | Claude moderation pass on a preview before publishing a public pin | C6 gate |

## 7. Component responsibilities (target `src/`)
- `components/globe/` (`client:only`): `GlobeCanvas` (scene lifecycle), `StylizedTiles` (load-model override),
  `Frustum` (EXIF→camera proxy + image plane), `Sky` (procedural + ephemeris), `Pins` (public pins, cluster, hover).
  **Design imports never write here.**
- `components/panels/`: `ExifTweakPanel` (sliders → zustand), `TimeScrubber` (time → ephemeris), `UploadFlow`
  (dropzone → worker), `LocationFinder` (free geocode → fly-to, Phase 5.5), `AiPanel` (premium). Design imports allowed.
- `lib/`: `decode/`, `geo/`, `ephemeris/`, `theme/` (GL token bridge), `wix/` (SDK clients, quota, media, ai).
- `store/`: zustand reactive EXIF params — the spine of real-time re-projection.

## 8. Cost posture (PoC = $0) [VERIFIED terms; INFERRED burn]
Wix free tier + Cesium ion **Community** (5GB storage / 15GB-mo streaming, non-commercial). Switch ion to
Commercial ($149/mo) at first real sale or under a >$50K entity. Early-commercial ≈ $178/mo (Wix Premium +
ion Commercial). Cap dev to 2–3 test cities + OPFS/tile cache from day one.

## 9. Risk register (full matrix in `DEEP_RESEARCH.md § H`)
Mobile decode memory → half-size + 1 concurrent + immediate free. GPS/heading imprecision → nudge controls +
terrain-snap. ion streaming burn → cache + city cap. **Wartime geo-sensitivity (C6) → reduced-precision public
pins, moderation gate, never expose exact GPS.**
