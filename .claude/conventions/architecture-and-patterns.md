# Convention — Architecture & Patterns

Canonical architecture: `.claude/claude-docs/ARCHITECTURE.md` (distilled) + `provenance/DEEP_RESEARCH.md` (provenance).
This file is the day-to-day *how we structure code* contract.

## The load split (C1)
The **client** does metadata extraction, RAW decode, projection math, ephemeris, and all rendering.
**Wix** is a thin backend: auth, Data Collections, Media, Pricing Plans, eCommerce, AI proxy — reached
through a handful of HTTP endpoints. If you find yourself doing heavy compute on an endpoint, stop — it
belongs on the client.

## Repo layout (actual, 2026-07-11 — regenerate from `git ls-files src` if it drifts)
```
src/
  pages/
    index.astro            # the single app page: globe island + every panel
    api/                   # thin Astro endpoints — photos.ts, upload-url.ts, ping.ts (release canary)
  components/
    globe/                 # client:only three.js  ← design imports NEVER touch
      GlobeCanvas.tsx      # renderer/composer/bloom + procedural fallback + dynamic-imports StylizedTiles
      StylizedTiles.ts     # orchestrator: camera, GlobeControls, per-frame loop, FPV, glides, pins/sky sync
      tuning.ts            # THE single source for every globe tunable (documented groups)
      PhotoFrustum.ts      # EXIF → camera frustum + image plane
      flight.ts explore.ts # camera controllers (createX → handle; pure math exported for tests)
      Pins.ts              # public-pin instanced markers (camera-anchored)
      scene/               # one visual concern per file: baseEarth atmosphere stars buildings
                           #   imageryGround sky dayArcs graticule  + glsl (GLSL-literal injection)
    panels/                # React islands  ← design imports allowed (UploadFlow, PhotoDetailPanel,
                           #   TimeScrubber, TimeReadout, LocationFinder, CameraTiltPanel, MyPins,
                           #   MemberBadge, Welcome, ExploreMode, FpvHud, PinHoverCard)
    ui/                    # shared primitives  ← design imports allowed (Slider, Encoder)
  lib/                     # pure/logic  ← design imports NEVER touch
    decode/                # extract, exif, convert (HEIC), sensors (FOV), worker, workerClient, wasm-modules.d.ts
    geo/                   # projection (ECEF/geodetic/ENU + ray-ellipsoid), frustum, geohash, precision, geocode, offscreen
    ephemeris/             # bodies, stars, captureTime, dayArc, golden, moonlight, asterisms (astronomy-engine)
    pins/ save/ wix/       # appearance (author hue) · pinBody+uploadMedia · pinRecords (Data shapes + C6 reduction)
    format/ textures/      # readout (formatters) · redChannel (R8 data-texture extraction)
    theme/                 # tokens.ts (GL bridge — regenerate from styles/tokens.css after a design import)
  store/                   # zustand (use*Store): camera, upload, pins, save, time, member — the reactive spine
  styles/                  # tokens.css (design source of truth) + per-component CSS  (plain CSS — no Tailwind)
  layouts/ Layout.astro
test/                      # vitest (lib math + store seams), mirroring src/lib/**
scripts/                   # provision-collections, build-*, verify-*.mjs (browser-verify harnesses)
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
  `components/panels|ui/**` + `styles/**`, never `globe/**` or `lib/**`.

## Store pattern — seam + mirror (the globe ⇆ React contract)
The globe orchestrator (`StylizedTiles.ts`, not React) drives the scene each frame, while the panels are
React islands. They communicate ONLY through the zustand stores, in two directions:
- **Seam (React → globe):** an imperative one-shot or continuous *request* the orchestrator consumes each
  frame — e.g. `camera.flyRequest` (+ `_consumeFlyRequest`), `camera.targetTiltDeg`, `camera.headingRateDegPerS`,
  `upload.viewMode`. The panel sets it; the orchestrator reads `useX.getState()` in the RAF loop and clears it.
- **Mirror (globe → React):** an orchestrator-written *snapshot* of live scene state at LOW cadence (never
  60 fps — same discipline as `store/time`), read by panels for readouts — e.g. `camera._syncHeading`,
  `camera._syncTilt`, `camera.fpvHud`, `pins._syncHover`. Mirror setters are **`_`-prefixed** (orchestrator-only).
- Rule: a per-frame globe read must NEVER trigger a React re-render (use `getState()`, not the hook);
  mirrors are throttled so the idle LEO drift never spams React or the Wix Data viewport query.

## DEV-seam global registry (deliberate — do not "clean up")
In `import.meta.env.DEV` only, the orchestrator/stores expose typed globals for browser verification
(Playwright / CDP scripts read them): `window.__globe` (camera/controls/tiles/uniforms/bodies/fpv/...),
`__composer`, `__renderer`, and the raw stores `__cameraStore __timeStore __uploadStore __pinsStore
__saveStore __memberStore`. They carry no secrets and change no behaviour. Standardize new seams on the
`declare global { interface Window { … } }` pattern (see `store/member.ts`). Keep them all.

## Feature flags
Add a flag for the optional **"realistic mode"** (Google Photorealistic 3D Tiles, UNMODIFIED, mandatory
attribution) — off by default (C5). Never restyle Google tiles.
