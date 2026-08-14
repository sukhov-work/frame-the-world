# Frame the World — Architecture (repo-native)

Distilled working reference (refreshed 2026-07-15). **Provenance:** `provenance/DEEP_RESEARCH.md`
Part 1–2 (research + ASCII diagram + stack table + cost table) and `PROJECT_SEED.md` §4–5. Those are
canonical; this doc is the fast map plus the repo-native additions (data model, endpoint contracts,
component responsibilities). Evidence tags carried from research: [VERIFIED] / [INFERRED] / [UNVERIFIED].

## 1. One-paragraph system
An Astro-5 Wix-managed-headless app. A `client:only` island runs the whole instrument in the browser:
upload → Web Worker decode (`exifr` preview + `libraw-wasm` demosaic) → reactive EXIF state (`zustand`) →
three.js scene (`3d-tiles-renderer` + Cesium OSM Buildings + real Cesium World Terrain + a self-hosted
**enriched Dnipro buildings+trees tileset** streamed from Cloudflare R2, stylized via `load-model` material
override, `GlobeControls` navigation, camera frustum + image-plane per pin, procedural sky +
`astronomy-engine` sun/moon/stars + a skyline-aware shot **planner**). Wix (via `@wix/astro` auto-auth +
a few HTTP endpoints) provides auth, Data Collections, Media, Pricing Plans, eCommerce digital products,
and the Claude AI proxy. Camera/FPV/time state is shareable via URL hashes (`#p=`/`#f=`, `&t=`). See the
ASCII diagram in `provenance/DEEP_RESEARCH.md § "Final architecture"`.

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
`EdgesGeometry` strokes). *(2026-07-10 the buildings were sunk 90 m as a terrain-clamp offset; Phase 4 landed real Cesium World Terrain and REMOVED the sink.)*
Default camera = LEO oblique + idle orbital drift (the seed's signature scene). Mechanics:
`mem:patterns/globe-rendering`.
**2026-07-13/14 additions (all browser-VERIFIED):** (4) **real terrain** = Cesium World Terrain (ion asset 1,
QuantizedMeshPlugin) with Esri draped via ImageOverlayPlugin, plus a CARTO dark drape crossfading in below
~7 km (satellite = opt-in `groundMode`); (5) a **third `TilesRenderer`** streams the offline-baked
**enriched Dnipro tileset** (127k buildings + 161k instanced trees, per-building `_feature_id_0`) from a
Cloudflare R2 Worker, with Cesium OSM Buildings **masked inside the bbox** (`bboxClipPrismEcef` clipping
prism) and per-cell + per-building clamp-to-CWT seating — bake pipeline in `scripts/bake/` (`bake.mjs`
footprint extruder = default; `bake-osm2world.mjs` = higher-fidelity parallel variant behind `?enriched=`;
in dev, tiles serve from local `bakes/` via a Vite middleware, never R2); (6) a **vector web** (OpenFreeMap
MVT: road ribbons, water/green fills, GL street names, city labels/boundaries) + FPV mini-map fed off one
shared MVT cache; (7) **adaptive quality tiers** (`lib/globe/quality.ts` device tier + frame governor;
shadows follow the DEVICE tier, never the governor). Plan/provenance: `dnipro-enrichment/
DNIPRO_3D_ENRICHMENT_PLAN.md` · `rendering/RENDERING_QUALITY_PASS.md`; mechanics:
`mem:project/wip-2026-07-13-*` / `wip-2026-07-14-*`.

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
- **Ephemeris:** `astronomy-engine` (±1 arcmin, VSOP87/NOVAS) → sun/moon az-alt + scene lighting +
  Yale BSC5 (~9,100 stars, rotated by −GAST) point rendering, all from one time+observer input (scene time =
  `store/time.ts` LIVE/PINNED + playback). Procedural sky shader; K&S-1991 phase-scaled moonlight.
- **Planner (the obstruction moat, shipped 2026-07-14):** pure `lib/ephemeris/planner.ts` (rise/set,
  golden windows derived from `tuning.GOLDEN`, culminations, skyline clear/block crossings) over
  `lib/geo/horizonProfile.ts` (az-binned max-elevation, 3 km trust) + `lib/geo/occlusion.ts`
  (**no-Raycaster** building triangle-edge sweeps + tree canopy spheres), fed by `scene/planFeed.ts` →
  `PlanPanel`. Mechanics: `mem:project/wip-2026-07-14-pass3-obstruction-moat`.
- **Planning-instrument ladder (CORE, desktop-first — owner 2026-08-13):** the PhotoPills/Stellarium
  feature set (twilight bands · MW band/Galactic-Centre target + season calendar · az/el **Find**
  filtered by the real skyline · NPF/500 · moon calendar · meteors/conjunctions/lunar eclipses ·
  session calculators · light pollution/ISS/alerts/solar-eclipse umbra) is core architecture, not a
  mobile add-on. Invariant per feature: pure lib (`lib/ephemeris/*`, `lib/geo/*`) + vitest →
  store mirror → **desktop panel first** → mobile sheet second (a mobile surface never precedes its
  desktop twin). Schedule: `IMPLEMENTATION_PLAN.md §Phase 8` (8a–8e); feature spec + evidence:
  `MOBILE_PLAN.md §5`; mobile twins: M1/M3–M6.

## 5. Data model — Wix Data Collections (ADR D7) [as-built; rewritten 2026-08-13, audit D7]
> No geospatial operator → geohash-prefix `hasSome` + client refine. Denormalize hot fields into `PublicPins`.

**Schema source of truth = [`scripts/provision-collections.mjs`](../../scripts/provision-collections.mjs)**
(the REST provisioner — the CLI `dataCollections` extension does NOT provision from wix dev); the full
field-by-field inventory lives in [`conventions/contracts.md §4`](../conventions/contracts.md). Summary:

- **Photos** (ADMIN read/write — owner-private working record): title/owner + **exact lat/lon
  (ONLY here)** + full camera pose/optics + `geohash9` + media file ids/preview + `isPublic`,
  `publicPrecision`, `publicPinId` + the marketplace linkage (`productId/productVariantId/
  priceAmount/currency`).
- **PublicPins** (read ANYONE, write ADMIN — denormalized for the globe/viewport query):
  `photoRef/authorName` + **`latReduced/lonReduced` + `geohash/gh4/gh6` + `precision`** + preview +
  pose/optics + the same marketplace linkage. ← **never exact GPS** (C6; the published point is the
  geohash CELL CENTRE — 1 km default, exact = opt-in; `publicPinRecord` is the only builder).
- **SavedPlaces** (member camera bookmarks): title/owner + the `#f=`-grammar pose fields.
- **There is NO Listings collection** — listing state rides Photos/PublicPins product fields
  (the marketplace is Stores products + these links; see §6 `/api/listings`).

## 6. Endpoint contracts (Astro backend — thin; heavy compute stays client-side per C1)
| Endpoint | Does | Notes |
|---|---|---|
| `POST /api/upload-url` | `elevate()` → `generateFileResumableUploadUrl` for RAW >10MB → url/token | TUS; async. **BUILT** |
| `/api/photos` GET·POST·PATCH·DELETE | `elevate()` → owner-gate → **endpoint-enforced quota** → CRUD `Photos` (+`PublicPins` if public, C6-reduced) | #11 → 402 (SUPERSEDES D8's hook). **BUILT** |
| `GET·POST /api/ping` | released-URL POST-403 canary / pre-release health gate | **BUILT** |
| `POST /api/analyze` | premium-gate → Wix AI (Claude) + **downsized JPEG** + desired-condition prompt → suggestions | ~1 credit; never RAW. **PLANNED — Phase 7** |
| `POST /api/moderate` | Claude moderation pass on a preview before publishing a public pin | C6 gate. **PLANNED — Phase 7** |

## 7. Component responsibilities (`src/`, as built 2026-07-15)
- `components/globe/` (`client:only`, **design imports never write here**): `GlobeCanvas` (renderer/composer/
  bloom/GTAO seam + quality tier), `StylizedTiles` (orchestrator: camera, controls, the ~40-step per-frame
  loop, FPV, glides, pins/sky/plan sync — the `load-model` material override lives in
  `scene/imageryGround`+`scene/buildings`), `PhotoFrustum` (EXIF→camera + image plane), `flight`/`explore`
  (camera controllers), `Pins` (instanced camera-anchored public pins), `tuning.ts` (every tunable —
  contract in `conventions/globe-tuning.md`), and `scene/*` (baseEarth, atmosphere, stars, sky, dayArcs,
  skyTarget, skyTrail, skyGhosts, skyNames, findGhosts (FIND v2 in-frame standings — rings +
  phase-lit body pictures + per-hit day-arc paths, 2026-08-14), buildings, buildingMaterial,
  enrichedBuildings, imageryGround, vectorTiles, vectorFeatures, streetNames,
  geoLabels, minimapFeed, planFeed, graticule, glsl).
- `components/panels/` (design imports allowed): `UploadFlow` (dropzone→worker), `PhotoDetailPanel` (EXIF
  sliders/encoders + save/update/delete), `TimeScrubber`+`TimeReadout` (scrub + playback), `LocationFinder`
  (geocode→fly-to), `CameraTiltPanel` (compass/2D-3D/encoders/SAT/BLD chips), `MyPins`, `MemberBadge`,
  `Welcome`, `ExploreMode`, `FpvHud`, `PinHoverCard`, `PlanPanel` (skyline verdicts + jump chips),
  `FindPanel` (FIND v2 — frame-as-query day scan + ghost projections; replaced the FindCard deck
  row 2026-08-14), `TargetPanel` (tracked sky target), `SkyContextMenu` (right-click sky),
  `MiniMap` (FPV). `components/ui/`: `Slider`, `Encoder`, `InfoDot`, `DragGrip`. *(`AiPanel` = Phase 7, PARKED — out of all plans per owner 2026-08-11.)*
- `components/mobile/` (M0+, planning-only shell — owner 2026-08-11/13): thin consumers of the SAME
  stores/libs (`MobileShell`, tab bar, sheets, time dock, FPV touch controls) mounted by
  `src/pages/m.astro` + `layouts/MobileLayout.astro`. Never imports desktop panels; desktop never
  imports from it; all shared logic lives in `lib/**`+`store/**` (the two-shell drift guard).
- `lib/`: `decode/`, `geo/` (projection, frustum, geohash, precision, geocode, offscreen, terrain, screen,
  heading, coerce, urlPose, horizonProfile, occlusion), `ephemeris/` (bodies, stars, asterisms, dayArc,
  golden, moonlight, captureTime, planner), `globe/` (quality, drift, buildingNight, enrichedMask,
  enrichedVariant), `pins/`, `save/`, `wix/` (`pinRecords`), `api/`, `format/`, `textures/`, `theme/`
  (GL token bridge).
- `store/` (zustand `use*Store`): `camera`, `upload`, `pins`, `save`, `time`, `member`, `plan`, `sky`,
  `find` (FIND v2 panel⇆globe ghost mirror + two-way hover), `minimap` —
  the reactive spine + the globe⇆React seam/mirror contract (see `conventions/architecture-and-patterns.md`).
- `scripts/bake/` (offline, Node-only): `bake.mjs` (OSM footprints → C6 exclusion → roof-shaped extrusion →
  gridded 3D-Tiles + instanced trees), `bake-osm2world.mjs` (OSM2World variant), `upload-r2.mjs` /
  `r2-worker.mjs` / `deploy-worker.mjs` (R2 hosting), `cities/*.json` (per-city config; bbox must equal
  `tuning.ts ENRICHED.bbox` — regen BOTH bakes on change). See `scripts/bake/README.md`.

## 8. Cost posture (PoC = $0) [VERIFIED terms; INFERRED burn]
Wix free tier + Cesium ion **Community** (5GB storage / 15GB-mo streaming, non-commercial). Switch ion to
Commercial ($149/mo) at first real sale or under a >$50K entity. Early-commercial ≈ $178/mo (Wix Premium +
ion Commercial). Cap dev to 2–3 test cities + OPFS/tile cache from day one.

## 9. Risk register (full matrix in `provenance/DEEP_RESEARCH.md § H`)
Mobile decode memory → half-size + 1 concurrent + immediate free. GPS/heading imprecision → nudge controls +
terrain-snap. ion streaming burn → cache + city cap. Esri/CARTO imagery ToS = accepted POC risks (re-check
before commercial release). R2/Workers free-tier budget → browser cache + per-city buckets. **Wartime
geo-sensitivity (C6) → reduced-precision public pins (cell-centre published), bake-time military/critical-infra
exclusion, moderation gate, never expose exact GPS.**
