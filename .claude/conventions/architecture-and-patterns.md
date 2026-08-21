# Convention — Architecture & Patterns

Canonical architecture: `.claude/claude-docs/ARCHITECTURE.md` (distilled) + `provenance/DEEP_RESEARCH.md` (provenance).
This file is the day-to-day *how we structure code* contract.

## The load split (C1)
The **client** does metadata extraction, RAW decode, projection math, ephemeris, and all rendering.
**Wix** is a thin backend: auth, Data Collections, Media, Pricing Plans, eCommerce, AI proxy — reached
through a handful of HTTP endpoints. If you find yourself doing heavy compute on an endpoint, stop — it
belongs on the client.

## Repo layout (actual, 2026-08-15 — regenerate from `git ls-files src` if it drifts)
```
src/
  pages/
    index.astro            # the desktop app page: globe island + every panel (+ the /m redirect gate)
    m.astro                # the mobile shell page — planning-first /m, SAME engine/stores/libs
    api/                   # thin Astro endpoints — photos, places, listings, market, upload-url,
                           #   sbdb (JPL relay), ping (release canary), dev-seed (DEV-gated)
  components/
    globe/                 # client:only three.js  ← design imports NEVER touch
      GlobeCanvas.tsx      # renderer/composer/bloom + procedural fallback + dynamic-imports StylizedTiles
      StylizedTiles.ts     # orchestrator: camera, GlobeControls, per-frame loop, FPV, glides, pins/sky/plan sync
      tuning.ts            # THE single source for every globe tunable (documented groups)
      PhotoFrustum.ts      # EXIF → camera frustum + image plane
      flight.ts explore.ts # camera controllers (createX → handle; pure math exported for tests)
      Pins.ts              # public-pin instanced markers (camera-anchored)
      scene/               # one visual concern per file: baseEarth atmosphere stars sky dayArcs
                           #   skyTarget skyTrail skyGhosts skyNames findGhosts buildings
                           #   buildingMaterial enrichedBuildings imageryGround vectorTiles
                           #   vectorFeatures streetNames geoLabels minimapFeed planFeed graticule
                           #   + glsl (GLSL-literal injection)
    panels/                # React islands  ← design imports allowed (UploadFlow, PhotoDetailPanel,
                           #   TimeScrubber, TimeReadout, LocationFinder, CameraTiltPanel, MyPins,
                           #   MyLocation, MemberBadge, Welcome, ExploreMode, FpvHud, PinHoverCard,
                           #   PlanPanel, PlanFindToggle, FindPanel, FrameCard, TodayCard, MoonCalCard,
                           #   SpotStarsCard, TargetPanel, SkyContextMenu, MiniMap, Marketplace, Guide)
    mobile/                # the /m shell — thin consumers of the SAME stores/libs (MobileShell, TabBar,
                           #   Sheet, PlanSheet, FindSheet, TargetSheet, TargetPeek, GuideSheet,
                           #   MobileTimeDock, FpvControls, SceneActions, MobileSearch, MobilePlaces,
                           #   MobileAccount) — never imports desktop panels, and vice versa
    ui/                    # shared primitives  ← design imports allowed (Slider, Encoder, InfoDot, DragGrip)
  lib/                     # pure/logic  ← design imports NEVER touch
    decode/                # extract, exif, convert (HEIC), params, sensors (FOV), worker, workerClient
    geo/                   # projection (ECEF/geodetic/ENU + ray-ellipsoid), frustum, geohash, precision,
                           #   geocode, offscreen, terrain, screen, heading, coerce, urlPose,
                           #   horizonProfile, occlusion, sizeDistance
    ephemeris/             # bodies, stars, asterisms, captureTime, dayArc, golden, moonlight, planner,
                           #   twilight, mwSeason, frameFinder, sunEventFrame, moonCalendar, targets,
                           #   topo, comet (astronomy-engine + universal-variable kepler propagation)
    sky/                   # the search/catalog layer: catalog, searchIndex, messier, openngc, ngcNames,
                           #   constellations, starNames, hoverNames, asteroids, comets, simbad, sbdb, ttlCache
    globe/                 # quality (device tier + frame governor), drift, buildingNight, enrichedMask, enrichedVariant
    photo/ market/ guide/  # npf (spot-stars exposure) · listing (marketplace) · guideContent+inline (the GUIDE)
    export/                # ics (calendar export)
    pins/ save/ wix/       # appearance+fields · pinBody+uploadMedia · pinRecords, placeRecords, photosData, planUpgrade
    api/ format/ textures/ # http · readout (formatters) · redChannel (R8 data-texture extraction)
    theme/                 # tokens.ts (GL bridge — regenerate from styles/tokens.css after a design import)
    prefs.ts               # the ftw:view-prefs:v1 versioned blob
  store/                   # zustand (use*Store): camera, upload, pins, save, time, member, plan, sky,
                           #   skyAim, find, market, minimap — the reactive spine
  styles/                  # tokens.css (design source of truth) + per-component CSS + mobile/ (plain CSS — no Tailwind)
  layouts/                 # Layout.astro + MobileLayout.astro
test/                      # vitest (lib math + store seams), mirroring src/lib/**
scripts/                   # provision-collections, build-* catalog bakes, verify-*.mjs, bake/ (city tilesets)
```
Endpoints live in `src/pages/api/`, **not** a `backend/` folder. WASM ships as hashed Vite build assets
(libraw) / inlined (libheif) — there is **no `public/wasm/`**.

## Core patterns
- **Reactive projection.** EXIF params (focal, heading, pitch, position, time) live in a **zustand** store.
  The three.js scene reads them each frame and re-projects — no server round-trip. This is the emotional
  core of the product; keep the path pure and client-side.
- **Web Worker decode.** `exifr` embedded-JPEG preview (<100ms target) on the main thread → `libraw-wasm`
  full demosaic in a disposable per-file Worker → transfer the display `ArrayBuffer` back. Free RAW buffers
  immediately (26MP ≈ 80–104MB heap). Mobile: half-size decode, one concurrent decode.
- **Tiles stylization** via the `3d-tiles-renderer` `load-model` event (traverse + swap materials),
  `dispose-model` for cleanup. **Never** combine with `BatchedTilesPlugin`. **OSM buildings share ONE
  `MeshStandardMaterial`** — per-tile material swaps are forbidden; per-frame visual effects are O(1)
  global-uniform writes through a chained `onBeforeCompile` (see `globe-tuning.md`).
- **Tiles precision** via `GlobeControls` dynamic near/far + the renderer's re-centering. **Our own
  instanced/large-coordinate meshes (pins, frustum) render CAMERA-ANCHORED** — ECEF ~6.4e6 m in float32
  cancels catastrophically, so `mesh.position = camera.position`, instance translations are camera-relative,
  and shaders use `modelViewMatrix` only. TRAP: `hoverAnchor` must add `mesh.position` back (see the ECEF
  trap in `DECISIONS.md § Traps`). No float64 three.js fork.
- **Projection v1** = textured plane at the frustum far face (robust, occlusion-safe). Projective texturing
  is a v2 stretch.
- **One ephemeris source.** `astronomy-engine` drives sun/moon positions AND scene lighting AND star
  visibility from one `bodyStatesAt(time)` sample per frame.
- **Design/GL bridge.** DOM chrome and the WebGL scene read the **same tokens**: `src/styles/tokens.css`
  (source of truth) → `src/lib/theme/tokens.ts` (GL bridge). Regenerate the bridge after any token change.
  **The design-fence rule is defined once in `.claude/CLAUDE.md`** — design imports write only under
  `components/panels|ui|controls/**` + `styles/**`, never `globe/**` or `lib/**`.
- **The two-shell fences (`test/components/mobileFence.test.ts` — the ONLY place they were stated
  until audit #3 D6).** Three rules: (1) `components/mobile/**` never imports a desktop panel;
  (2) `components/panels|ui/**` never imports from `components/mobile/**`; (3) **`components/controls/**`
  is a PURE LEAF** — react + stores + `lib/**` + `globe/tuning` + styles only. That third tier
  (shipped 2026-08-21b, `Joystick.tsx` → `Joystick` + `AimJoystick`) exists so an input instrument's
  FEEL cannot fork between the shells; both `MiniMap` and `MobileShell` mount the same component.
  Shared logic therefore lives in **three** places, not two: `lib/**` + `store/**` + `controls/**`.

## Store pattern — seam + mirror (the globe ⇆ React contract)
The globe orchestrator (`StylizedTiles.ts`, not React) drives the scene each frame, while the panels are
React islands. They communicate ONLY through the zustand stores, in two directions:
- **Seam (React → globe):** an imperative one-shot or continuous *request* the orchestrator consumes each
  frame — e.g. `camera.flyRequest` (+ `_consumeFlyRequest`), `camera.targetTiltDeg`, `camera.headingRateDegPerS`,
  `upload.viewMode`. The panel sets it; the orchestrator reads `useX.getState()` in the RAF loop and clears it.
- **Mirror (globe → React):** an orchestrator-written *snapshot* of live scene state at LOW cadence (never
  60 fps — same discipline as `store/time`), read by panels for readouts — e.g. `camera._syncHeading`,
  `camera._syncTilt`, `camera.fpvHud`, `pins._syncHover`. Mirror setters are **`_`-prefixed** (orchestrator-only).
- **Panel-published feed (the inverse seam, sanctioned 2026-08-14 FIND v2):** when a PANEL is the
  producer and the globe the reader (`find.publishGhosts`), the setter is a plain un-prefixed
  verb — the `_` prefix stays reserved for orchestrator-written mirrors (audit-2 A3 rename,
  2026-08-18; `_syncGhosts` was the contradiction).
- Rule: a per-frame globe read must NEVER trigger a React re-render (use `getState()`, not the hook);
  mirrors are throttled so the idle LEO drift never spams React or the Wix Data viewport query.
- **Mirrors never SEAT geometry (trap, browser-caught 2026-08-18h):** a deadband-quantized store
  mirror is for READOUTS; anything that positions scene geometry (a seat, an anchor, a cone
  centre) must resolve LIVE in the orchestrator frame — a 0.02° stale mirror seat is ~2 km of
  visible offset. Static fence: `test/components/globe/fences.test.ts` (scene→store imports).

## DEV-seam global registry (deliberate — do not "clean up")
In `import.meta.env.DEV` only, the orchestrator/stores expose typed globals for browser verification
(Playwright / CDP scripts read them): `window.__globe` (camera/controls/tiles/uniforms/bodies/fpv/...),
`__composer`, `__renderer`, `__quality`, and the raw stores `__cameraStore __timeStore __uploadStore
__pinsStore __saveStore __memberStore __planStore __skyStore __findStore __marketStore
__minimapStore` (canonical inventory: `contracts.md §3`). They carry no secrets and change no behaviour. Standardize new seams on the
`declare global { interface Window { … } }` pattern (see `store/member.ts`). Keep them all.

## Feature flags
Add a flag for the optional **"realistic mode"** (Google Photorealistic 3D Tiles, UNMODIFIED, mandatory
attribution) — off by default (C5). Never restyle Google tiles.
