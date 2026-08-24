# PLUX — Architecture (repo-native)  *(repo: `headless-frame-the-world`)*

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
- **Planner engines as built (2026-08-18):** the ladder's pure-lib layer now spans
  `lib/ephemeris/{frameFinder, sunEventFrame, twilight, mwSeason, moonCalendar, targets, topo,
  comet, showers, azSector}` (frame-as-query day scans + sunsets-in-frame, twilight bands, MW
  season/darkness, moon quarters/apsides, the SkyTarget provider registry, topocentric
  corrections, the universal-variable comet/asteroid propagator, P7 meteor showers — IMO cal2026
  + λ☉ anchor + Jenniskens activity profile — and the U4 rise→set azimuth-sector sampler feeding
  the aim cones) alongside the original `planner`/`golden`/`moonlight`/`dayArc`.
- **Eclipses (shipped 2026-08-22k) — the ONE derivation that cannot ride the shared sample.**
  `lib/ephemeris/eclipse.ts` is pure and three-free: `discCoverage` (circle-circle lens area),
  `solarEclipseFromDiscs`/`solarEclipseAt`, `lunarEclipseFromState`/`lunarEclipseAt` (Meeus ch.54
  shadow cone, `SHADOW_ENLARGEMENT` 1.02), the forward walks `nextSolarEclipses` (LOCAL
  circumstances at this observer) and `nextLunarEclipses` (a global event plus "is the moon up
  here"), and `eclipseDaylightK`. **The solar geometry must be TOPOCENTRIC**, so it cannot ride
  `SKY.sampleIntervalMs`: at the 2026-08-12 Burgos totality the GEOCENTRIC separation is 1.006°
  against radii of 0.263°/0.272° — the discs do not touch — where the true topocentric separation
  is 0.062° and 88% of the sun is gone. The orchestrator therefore derives it EVERY FRAME in
  `stepEclipse()`, seated after `stepEphemerisResample` and BEFORE `stepKeyLightAndShadow`, from
  geocentric `sunDirW` against topocentric `moonPosW − camera.position`. Its single output
  `eclipseK` (daylight REMAINING, exactly 1 when nothing is happening, so every downstream
  multiply is a provable no-op) is the second global light scalar after the ULTRA sample: key-light
  intensity · ground shadow strength · ground `uFtwEclipse` (ALTITUDE-GATED — the umbra is a
  street-level truth, and `baseEarth` is deliberately not wired; backlog T46) · atmosphere
  `uEclipse` · the star reveal. LUNAR dimming instead multiplies `moonKs` at the sample — the one
  write that moves every moonlight consumer together. Not an ULTRA lever: an eclipse is physics,
  not a fidelity chip. Tunables `tuning.ECLIPSE`; DEV seam `__globe.eclipse()`; browser gate
  `scripts/verify-eclipse.mjs` (37 checks).

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

## 7. Component responsibilities (`src/`, as built 2026-08-24)
- `components/globe/` (`client:only`, **design imports never write here**): `GlobeCanvas` (renderer/composer/
  bloom/GTAO seam + quality tier), `StylizedTiles` (orchestrator: camera, controls, the ~40-step per-frame
  loop, FPV, glides, pins/sky/plan sync — the `load-model` material override lives in
  `scene/imageryGround`+`scene/buildings`), `PhotoFrustum` (EXIF→camera + image plane), `flight`/`explore`
  (camera controllers), `Pins` (instanced camera-anchored public pins), `tuning.ts` (every tunable —
  contract in `conventions/globe-tuning.md`), and `scene/*` (baseEarth, atmosphere, stars, sky, dayArcs,
  skyTarget, skyTrail, skyGhosts, skyNames, findGhosts (FIND v2 in-frame standings — rings +
  phase-lit body pictures + per-hit day-arc paths, 2026-08-14), buildings, buildingMaterial,
  enrichedBuildings, imageryGround, vectorTiles, vectorFeatures, streetNames,
  geoLabels, minimapFeed, planFeed, bestSpotFeed + bestSpotSheet (BEST SPOT, 2026-08-24 — the
  feed drives the long-lived solver worker off four streaming epochs and publishes an RG8 score
  field; the sheet is the GL veil/ink surface at **`renderOrder` 4/5**, depth-TESTED, and
  deliberately not the depth-free 9/10 band), graticule, glsl, aimCones (U4 direction lines → since batch #4
  S2 **concentric annular BANDS**: `AIMCONES.bandMoon/bandSun/bandTarget` innermost-outward with
  `*Mobile` variants + `mobileRadiusK`, an `N` rim marker via `northOffsetK/northSizeK`, always-on
  `fillAlphaRest` washes, and **skyline occlusion GAPS** — `azSector.fractureRunsBySkyline` honoured
  only within `skylineGuardM` of the profile anchor), focalCone (the planned-shot cone, seeded from
  boot out of `camera.plannedView`; maths in `lib/geo/plannedView.ts`), tangentOverlay (the
  grammar aimCones and focalCone SHARE — the flat overlay material, the tangent-plane root and
  its ECEF/ENU seat, the altitude presence ramp and the fade step; extracted 2026-08-22, audit
  #3 A1-8/T35, ≈47 duplicated lines incl. a byte-identical material factory), tileFoveation (U6),
  bldgEditLabel + placeMarkers, tilePriority (U5 closest-first download
  comparator adapter + queue caps, 2026-08-18), terrainPatch (U7b GLO-30 composite — createChild
  wrap + fetchData claimer on the ONE ground renderer, 2026-08-18; domain doc
  `BAKED_ASSETS.md`)).
  **ONE geometry model, THREE surfaces:** the band/cone model above is read by the GL fan
  (`scene/aimCones`+`scene/focalCone`), the `MapWindow` canvas twin and the `MiniMap` radar —
  a band edit that lands in only one of them is a bug (`AIMCONES.mapRadiusHK` sizes the two
  canvas twins as a fraction of canvas HEIGHT, the GL fan's rule). Since audit #3 (2026-08-22)
  the "one model" claim is STRUCTURAL, not a convention: the band allocation lives in
  `lib/geo/radarBands`, the ANCHOR ladder in `lib/geo/aimAnchor` (T36 — the chart's private copy
  had lost the placed-photo rung and reached the camera NADIR before the view focus), the canvas
  painting in `panels/radarCanvas` (T35), and the skyline-gap gate — including the NEW
  `PLAN.minCoverageForGaps` evidence floor (A1-16) — in `lib/geo/horizonProfile.skylineBinsFor`.
  **Sticky overlay resolution:** `stepGroundUpdate` is the ONE caller of
  `ground.setOverlayResolution`, and the effective px only ever RATCHETS UP
  (`lib/globe/quality.stickyOverlayPx`) — never lowered by a 2D↔FPV flip or a governor demote.
  Lowering it rebuilds every resident composite (the 2026-08-21h white-chart storm); the assert
  is the DEV probe `window.__overlayRebuilds`, never raw tile-GET counts.
- `components/panels/` (design imports allowed): `UploadFlow` (dropzone→worker), `PhotoDetailPanel` (EXIF
  sliders/encoders + save/update/delete), `TimeScrubber`+`TimeReadout` (scrub + playback + light bands),
  `LocationFinder` (geocode + sky-object search → fly-to/track), `CameraTiltPanel` (compass/2D-3D/
  encoders/SAT/BLD chips), `MyPins` (+SALES tab), `MyLocation` (my-location→FPV jump), `MemberBadge`, `Welcome`,
  `ExploreMode`, `FpvHud`, `PinHoverCard`, `PlanPanel` (skyline verdicts + jump chips + MW season +
  planner cards), `PlanFindToggle` (PLAN/FIND one resizable toggle window, 2026-08-15),
  `FindPanel` (FIND v2/v3 — frame-as-query day scan + ghost projections + SUNSETS tab; replaced the
  FindCard deck row 2026-08-14), `FrameCard` (shoot-this-frame suggestions), `TodayCard` (daily
  chronology + ICS export), `MoonCalCard` (quarters/apsides/supermoons), `SpotStarsCard` (NPF),
  `TargetPanel` (tracked sky target + PREDICTED ECLIPSES — `EclipseFacts`, gated on `target.kind`
  sun/moon and NEVER on `facts.kind`, which is "planet" for both; `/m` twin in `TargetSheet`),
  `SkyContextMenu` (right-click/long-press sky menu),
  `MiniMap` (FPV), `Marketplace` (browse panel), `Guide` (the in-app guide, G1 2026-08-15 —
  absorbed the former `Faq.tsx`/`faqContent.ts`/`faq.css`, now DELETED), `MeteorsCard` (P7
  shower windows + ZHR cards, 2026-08-17), `MapWindow` (U3 fullscreen slippy 2D map twin over
  `lib/geo/slippy.ts` + `styles/map-window.css`, 2026-08-18), `BestSpotPanel` (BEST SPOT — the
  THIRD `planfind` segment beside PLAN and FIND: kind/radius/lift instruments, the top-K standings,
  the honesty block and `REFINE THIS SPOT`, 2026-08-24).
  `components/ui/`: `Slider`, `Encoder`, `InfoDot`, `DragGrip`. *(`AiPanel` = Phase 7, PARKED — out of all plans per owner 2026-08-11.)*
- **`components/controls/` — the THIRD shared tier (batch #4 S2, 2026-08-21b):** input instruments
  whose FEEL must never fork between the shells. THREE files: `Joystick.tsx` exports `Joystick`
  (the walk pad) and `AimJoystick` (heading + focal for the planned shot, with an mm focal
  footer); `InstrumentSlider.tsx` + `ChipRow.tsx` (added 2026-08-24 by BEST SPOT — the panel's
  radius/lift/kind instruments, put here so a future `/m` sheet cannot fork their feel). Mounted by
  BOTH shells — `MiniMap` (desktop mini-map footer) and `MobileShell`
  (`variant={fpvOn ? "fpv" : "map"}`). Fenced by `test/components/mobileFence.test.ts` rule 3:
  `controls/` is a PURE LEAF — react + stores + `lib/**` + `globe/tuning` + styles only, never a
  panel or a mobile import. Design imports MAY write here (it is chrome, not the canvas globe).
- `components/mobile/` (M0–M3 shipped, planning-first shell — owner 2026-08-11/13; **U1
  2026-08-17: /m boots 2D-first** — the 3D globe is opt-in per session, buildings detach in 2D
  map mode): thin consumers of
  the SAME stores/libs mounted by `src/pages/m.astro` + `layouts/MobileLayout.astro`: `MobileShell`,
  `TabBar`, `Sheet`, `PlanSheet`, `FindSheet`, `TargetSheet`, `TargetPeek`, `GuideSheet` (G1),
  `MobileTimeDock` (conveyor dock v2), `FpvControls` (touch pads), `SceneActions`, `MobileSearch`,
  `MobilePlaces`, `MobileAccount`. Never imports desktop panels; desktop never imports from it; all
  shared logic lives in `lib/**` + `store/**` + **`components/controls/**`** — THREE shared tiers
  since 2026-08-21b (the two-shell drift guard; the third was undocumented until audit #3 D1/D6).
- `lib/`: `decode/`, `geo/` (projection, frustum, geohash, precision, geocode, offscreen, terrain, screen,
  heading, coerce, urlPose, horizonProfile, occlusion, sizeDistance, **plannedView** — the
  planned-shot heading+hFov math behind "focal cone everywhere" incl. the FOV inverse pair and
  the range contract, 2026-08-21b; and the audit-#3 hoists of 2026-08-22: **aimAnchor** — THE
  radar anchor ladder, ONE function for all three surfaces (T36), **radarBands** — THE band
  allocation + future-ink rule, previously hand-copied ×3 with no fence (T35); and the BEST SPOT
  stack of 2026-08-24: **bestSpotTypes / bestSpotTrack / bestSpotMetric / bestSpotScoring /
  bestSpotSolver / bestSpotWorker / bestSpotWorkerClient**, plus the three height/landcover
  sources they consume — **horizonSweep** (the per-azimuth upper-convex-hull sweep),
  **localDsm** (the disc's height field, flattened out of the terrain TIN + building meshes) and
  **landcoverRaster** (standability/accessibility classes)), `ephemeris/` (bodies, stars,
  asterisms, dayArc, golden, moonlight, captureTime, planner, twilight, mwSeason, frameFinder,
  sunEventFrame, moonCalendar, targets, topo, comet, eclipse — see §4), `sky/` (catalog, searchIndex, messier,
  openngc, ngcNames, constellations, starNames, hoverNames, asteroids, comets, simbad, sbdb, ttlCache),
  `globe/` (quality, drift, buildingNight, enrichedMask, enrichedVariant — best-variant
  selection, rewritten 2026-08-18p, regions — the baked-region REGISTRY: bboxes/variants/
  terrain patches, the ONE source (2026-08-18p, `BAKED_ASSETS.md` §4), loadPriority — the U5
  pure download comparator, 0.4.28-parity, 2026-08-18), `geo/` also carries `slippy` (U3 tile
  math for the 2D map twins) + `terrainTiles` (terrain-patch serve-set math, bake-twin
  parity-tested, 2026-08-18p), `photo/` (npf), `market/`
  (listing), `guide/` (guideContent, inline — the guide content model, G1 2026-08-15), `export/` (ics),
  `pins/`, `save/`, `wix/` (pinRecords, placeRecords, photosData, planUpgrade), `api/`, `format/`,
  `textures/`, `theme/` (GL token bridge **`tokens.ts`** + **`cssInk.ts`** — the memoised
  resolved-token cache the two CANVAS radars paint from; a 2D canvas cannot take a `var()`, and
  resolving per paint forced ~320 style recalcs/s, T38 — plus **`findPalette.ts`** and
  **`heatPalette.ts`**, the BEST SPOT score→ink ramps with GL and DOM twins), `prefs.ts`.
- `pages/`: `index.astro` (desktop) + `m.astro` (mobile shell) + `guide.astro` (standalone server-rendered
  guide page over the same `guideContent`, 2026-08-15e) + `api/` (**9 routes**: photos, places,
  listings, market, upload-url, sbdb, ping, dev-seed, `building-overrides` (U8 LWW height-override
  bulkSave, 2026-08-19) — full route inventory in `conventions/contracts.md §7`; §6 above keeps
  the original endpoint contracts). Also under `public/`: **`sw.js`** — the iOS-ONLY, dev-gated,
  7-day-TTL tile cache (#15, batch #4 S3); registered dynamically at runtime, never imported, and
  policy-fenced by `test/swTileCache.test.ts`.
- `components/panels/` also carries **`radarCanvas.ts`** — THE canvas radar painter shared by the
  expanded chart and the FPV mini-map (≈95 duplicated lines before audit #3 A1-8/T35). It is a
  plain module, not a component: the two surfaces own their transforms and hand it a centre, a
  twist, a unit radius and their bodies.
- `components/mobile/` also carries **`useSheetInputFocus.ts`** — the ONE way an input inside a
  sliding sheet may take focus on iOS (same-commit focus + `preventScroll` + a layout-viewport
  pin across the 400 ms slide and the keyboard settle). Fenced by `mobileFence` rule 4: no
  React `autoFocus` and no bare `.focus()` anywhere in the shell (audit #3 A1-9).
- `store/` (zustand `use*Store`): `camera`, `upload`, `pins`, `save`, `time`, `member`, `plan`, `sky`,
  `skyAim` (rise/set camera aim), `find` (FIND v2 panel⇆globe ghost mirror + two-way hover), `market`,
  `minimap`, `places` (MY PLACES on-map mirror), `bldgEdit` (U8 height-override drag), `bestSpot`
  (BEST SPOT — kind/radius/lift + the scoring patch + the top-K mirror, 2026-08-24) — **14 stores
  in 15 files** (`skyAim.ts` is a helper module, not a store),
  the reactive spine + the globe⇆React seam/mirror contract (see
  `conventions/architecture-and-patterns.md`).
- `scripts/bake/` (offline, Node-only): `bake.mjs` (OSM footprints → C6 exclusion → roof-shaped extrusion →
  gridded 3D-Tiles + instanced trees), `bake-osm2world.mjs` (OSM2World variant), `terrain/`
  (GLO-30 → quantized-mesh patch: fetch → mago-3d-terrainer EGM2008 → 3 km CWT rim blend →
  self-verifying probes, 2026-08-18p), `upload-r2.mjs` (`--terrain` mode) / `r2-worker.mjs` /
  `deploy-worker.mjs` (R2 hosting), `cities/*.json` (per-city config; bbox must equal the
  region's `lib/globe/regions.ts` entry — regen BOTH building bakes on change). Script detail:
  `scripts/bake/README.md`; the domain doc (rulings + registry contract + ops runbooks + aux
  data): **`BAKED_ASSETS.md`**.

## 7b. ULTRA — the desktop opt-in fidelity mode (as built 2026-08-22j) [BROWSER-VERIFIED]
**Full architecture: `rendering/ULTRA_ARCHITECTURE.md`.** Charter: `ULTRA_PLAN.md` (+ its AS BUILT
block). Tunables: `conventions/globe-tuning.md` §ULTRA. Decisions: `DECISIONS.md` 2026-08-22j.

One desktop-only, **off-by-default** chip (`ULT`) turning on nine rendering levers — a photographic
ground de-grade in 3D, anisotropic drape filtering, a twilight-band day curve, an exposure ramp,
aerial perspective, an ephemeris-tracked hemisphere light, soft shadows, an 8192² shadow map, and
**terrain that casts shadows**. Owner cost ruling: sub-15 fps is acceptable in ULTRA — frame time is
measured and reported, never a veto (measured +18% frame time at a city).

Three architectural facts that constrain anything touching it:
- **The gate is on the READ, not the UI.** `ftw:view-prefs:v1` is ONE localStorage blob shared by
  both shells, so a desktop-set flag IS present on `/m`. Two readers exist — `hqAllowed` in
  `StylizedTiles` (runtime) and `lib/globe/ultraBoot.ts` (boot, for three's construction-time shadow
  levers). `test/components/globe/fences.test.ts` pins which files may name the flag and that every
  read the engine ACTS on is gated (one sanctioned DEV-probe exemption — see the full doc).
- **Exactly three lever paths, no fourth**: edge-applied on the chip flip (`stepUltraGate`, plus a
  DEFERRED tier pin in GlobeCanvas that parks while FPV owns the camera) · frame-applied by
  `stepUltraLook` (the look: photo3d, dayK mix, haze + tint, exposure, hemisphere) **and**
  `stepKeyLightAndShadow` (the shadow rig: light distance, ortho bounds, near/far, the DERIVED
  metric bias, terrain cast) · boot-read. Anything construction-time MUST take the boot path — three latches
  `shadow.mapSize` on first render and recompiles every material on a `shadowMap.enabled` flip.
- **OFF is EXACT, not approximate**: identity arithmetic in the shaders (`mix(a,b,0.0)`,
  `max(x,0.0)`, an early return at `hazeK<=0`), eased uniforms that SNAP to zero under an epsilon,
  and a browser assertion on literal zeros (`scripts/verify-ultra.mjs`, 28 checks).

New modules: `lib/globe/lightBands.ts` (pure band curves + **the emitted GLSL twin** — the shader and
its JS twin are generated from one table and unit-tested against each other), `lib/globe/ultraBoot.ts`,
`tuning.ULTRA`, `scene/glsl.FTW_AERIAL_GLSL` (ONE aerial-perspective function compiled into both the
ground and the buildings, so the air over a city cannot diverge from the air over its ground).
DEV seam: `__globe.ultraLook()` — reads terrain casting and anisotropy off the LIVE scene graph and
LIVE textures, never off our own flags.

## 7c. BEST SPOT — the observability heatmap (as built 2026-08-24) [BROWSER-VERIFIED]
**Charter: `BESTSPOT_PLAN.md` (read its AS BUILT appendix BEFORE the body) + `BESTSPOT_SPEC_V2.md`.**
Tunables: `conventions/globe-tuning.md` §BESTSPOT. Decisions: `DECISIONS.md` 2026-08-23 / 2026-08-24b /
2026-08-24c. Proof obligations: `FORMAL_VERIFICATION.md`.

PLAN answers *when* the sun clears that rooftop **from here**; BEST SPOT answers ***from where***.
For every cell of a disc around the `look from here` pin it decides whether SUNRISE / SUNSET /
MOONRISE / MOONSET will actually be visible and how good the shot is, and paints the result as a
translucent sheet over the map with top-K markers. Desktop only, at the READ (the `/m` twin S8 and
the DOM-canvas twin S9 are deferred by owner ruling).

Four architectural facts that constrain anything touching it:
- **All-CPU, in ONE long-lived module worker — the inverse of the decode worker.** The GPU path was
  proposed and **REFUTED** on three breakers, and reusing the shadow map on seven; do not
  re-propose. `bestSpotWorkerClient` spawns lazily and terminates only in `dispose()`, because the
  resident state between jobs *is* the optimization. **Cancellation is cooperative, never
  `terminate()`** — a `postMessage` cannot interrupt a running 680 ms rung, and terminating discards
  exactly the state the next job needs.
- **The per-ray UPPER CONVEX HULL is invariant in BOTH scene time AND eye height.** This is the
  keystone: it is why the time scrubber and the altitude slider re-rank without re-solving. Measured:
  a within-day scrub and a 2→400 m lift drag each build **ZERO** hulls. The hull cache is keyed on
  DSM-source identity (`sourcesEpoch`), and S6 shipped RED because `solveRung` called `buildDsm`
  unconditionally — a 2→400 m drag paid 39 hulls against a pinned 0.
- **A ladder, not a solve**: 24 → 12 → 6 → 3 m rungs (1 m reserved for ULTRA), a 90-frame refinement
  debounce, six residency tiers, and a 75 B/cell TERM buffer — never the composed score — so a
  weights patch is a **recompose** (0.3–3 ms, exactly one job) rather than a rebuild.
- **The honesty layer REFUSES rather than paints.** The single most dangerous failure mode of this
  feature is a warm, confident, uniform field, and it fired on the owner's hero location with every
  unit gate green: the first browser run measured `rMin === rMax === 187` across all 31,417 cells
  because no building geometry ever reached the DSM. A disc with dense MVT and zero building meshes
  now returns `"no-built-geometry"`. The built-density prior is an **evidence gate, never a score
  penalty** — it withholds open-sky credit instead of subtracting from the score.

New modules: `lib/geo/bestSpot{Types,Track,Metric,Scoring,Solver,Worker,WorkerClient}.ts` +
`horizonSweep` / `localDsm` / `landcoverRaster`; `scene/bestSpotFeed` + `scene/bestSpotSheet`;
`panels/BestSpotPanel`; `store/bestSpot`; `lib/theme/heatPalette`; `controls/{InstrumentSlider,ChipRow}`.
DEV seams: `__globe.bestSpot()` · `bestSpotSheet()` (the LIVE material) · **`bestSpotField()` (the
published RG8 — read its DISTRIBUTION, never a flag)** · `bestSpotTuning` + `.ab()` + `.export()`.

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
