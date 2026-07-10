# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.

## Status
**Phase 1 DONE + globe OVERHAUL (2026-07-10, browser-VERIFIED via Playwright at LEO/orbit/night/mid/city).**
The globe is now the seed's signature scene: **default POV = spacecraft in LEO** (1,100 km oblique over
Dnipro, limb + halo in top quarter, ISS-pace idle drift w/ pause-on-interaction resume-8s), base earth =
**NASA Blue Marble July (organic geology) graded into the sage duotone** + **VIIRS night-side city lights**
+ normal relief, atmosphere = **ray-based exp-falloff limb glow** (near-hemisphere shell — the dynamic far
plane clips the far one), ground = **Esri World Imagery z19** palette-graded + sun-shaded + water-darkened,
screen-door-dissolving in 2600→1400 km so detail grows organically (no hard switch) under the OSM buildings.
Four owner fixes same day (browser-VERIFIED): buildings = dark `surface` slate + per-tile EdgesGeometry lit
strokes (design idiom); halo altitude-adaptive (`uOrbit`: outer orbit 1/10 width + bluer); `tiles.group` sunk
90 m (OSM buildings are Cesium-World-Terrain-clamped → floated above the ellipsoid drape; Dnipro-specific
interim); night floors 0.32/0.45.
Textures: `earth-color.jpg` (5400², July topo+bathy) + `earth-night.jpg` (VIIRS) — colour maps sRGB, data
maps NoColorSpace. New tokens `atmosphereDeep`/`cityLights`. Full mechanics + traps (far-plane clip, chained
onBeforeCompile, geodetic-vs-spherical altitude): **`mem:patterns/globe-rendering`**. `astro check` 0 ·
35 tests green. UNVERIFIED: Esri ToS for production, mobile memory, live-dive crossfade feel, `wix release` CORS.
**Design system imported (2026-07-10)** — chrome tokens + fonts in `tokens.css` + GL bridge
(`mem:patterns/design-system`). **UploadFlow UI SHIPPED (2026-07-10, browser-VERIFIED)** — board-05 overlay
(`panels/UploadFlow.tsx` + `ui/Slider.tsx` + `store/upload.ts` zustand ingest spine + `lib/decode/extract.ts`
STUB contract + `lib/format/readout.ts`), D4 provenance badges, double-click-reset sliders, derived H-FOV;
canvas push-back done (`Shipped - Upload Flow.dc.html`); 61 tests green; `mem:patterns/upload-flow`.
**Phase 2 decode SHIPPED (2026-07-10, browser-VERIFIED)** — exifr metadata (2 ms, TZ-naive dates) +
embedded-thumb instant preview + **libraw-wasm@1.0.5 EXACT-pinned** (1.1.2+ = pthreads/SAB = COOP/COEP —
unusable on unverified Wix hosting) in a disposable per-file Worker (halfSize decode 26 MP ≈ 4.8 s →
3136×2084 texture; worker terminated = memory freed) + libheif-js HEIC fallback. 76 tests · build green.
Mechanics + Vite traps: `mem:patterns/upload-flow`.
**Globe REFACTORED + Phase 3 SHIPPED (2026-07-10, browser-VERIFIED via Playwright on wix dev).**
Refactor: every tunable → `globe/tuning.ts` (documented groups); scene split into
`globe/scene/{baseEarth,graticule,atmosphere,stars,buildings,imageryGround}.ts` attach-modules +
`scene/glsl.ts` (`glf` GLSL-literal injection); StylizedTiles = ~230-line orchestrator; new
convention `.claude/conventions/globe-tuning.md`; WGS84 + SUN constants deduped. Phase 3:
`lib/geo/frustum.ts` (pure, 20 tests) + `ecefToGeodetic`/`rayEllipsoidIntersect` in projection.ts;
`globe/PhotoFrustum.ts` (apex-relative float32-safe geometry, vanilla zustand) + `globe/flight.ts`
(2.2 s bezier flight, reduced-motion cut) + click-to-place (crosshair + ray-pick); store placement
machine (review→placed | placing→placed) + `derivedFov` (ONE H-FOV derivation for UI + frustum);
`panels/PhotoDetailPanel.tsx` docked tweak panel (light board-04; full design import deferred).
Verified: fixture heading 214°/H-FOV 73.7° at Dnipro; re-projection 0.018 ms/update; ARW
click-to-place with decoded texture; Escape/placing; **104 vitest · astro check 0 · wix build
green**. Mechanics: `mem:patterns/photo-frustum`.
**Pre-Phase-4 sky+terrain SHIPPED (2026-07-10, browser-VERIFIED via Playwright).** Ephemeris
(astronomy-engine 2.1.19 EXACT, JPL-Horizons-tested ±0.05°) now drives EVERYTHING from scene time
(`store/time.ts` LIVE/PINNED + `panels/TimeReadout` HUD): real sun/moon ECEF directions →
terminator + building key light + atmosphere + moonlight (phase-scaled); sun + moon render as
camera-anchored true-angular-size impostors (`scene/sky.ts` — impostor dist MUST clamp ≥1.2·near);
soft bloom (EffectComposer HalfFloat+MSAA4 → UnrealBloom 0.4/0.5/0.9 → OutputPass; night floors
0.22/0.38); sun shadows at city zoom (PCF 2048², ortho follows view focus, buildings cast+receive,
terrain gets ShadowMaterial twins — shadow contrast, not the pipeline, is the usual "bug");
**real 3D terrain** = Cesium World Terrain (ion asset 1, QuantizedMeshPlugin via assetTypeHandler)
+ Esri via ImageOverlayPlugin — 90 m building sink REMOVED, `terrainHeightAt()` raycast + frustum
`resnap()` (EXIF altitude = absolute, clamped above ground; manual = above rendered ground).
Rule: browser screenshots → `verify-shots/` (git-ignored). 113 vitest · astro check 0.
Mechanics + traps: `mem:patterns/sky-bodies-terrain`.
**Owner UX pass SHIPPED (2026-07-10, browser-VERIFIED via scripted Chrome — Playwright MCP was
wedged):** gradual zoom verticality (zoomTiltKeep 0.35 counter-rotation) + banked/eased zoomDelta
+ altitude zoom braking + dampingFactor 0.28 inertia + POSE 38° depression (more horizon) + NEW
declination slider (`store/camera.ts` + `panels/CameraTiltPanel.tsx`); moon/sun per-fragment
analytic horizon-occlusion fade (was clipping through the planet) + moonBrightness 1.8; soft
adaptive tile loading (fadeRootTiles/700 ms/300 cap + loadProgress-gated reveal + adaptive
errorTarget 2↔12 + overlay retry). Camera mechanics: `mem:patterns/globe-rendering`; sky/loading:
`mem:patterns/sky-bodies-terrain`. **Next step: Phase 4 remainder — time
scrubber UI + golden-hour grade + BSC5 stars** (see `NEXT_SESSION_PROMPT.md`). `wix release`
still pending user greenlight.
Live site: `frame-the-a173087b-yevhens.wix-site-host.com` (siteId `f597bcf5-bd38-4941-9dfe-e16d775743a3`,
appId `566ce8ce-d18c-4950-88ac-5d2c53311cd6`; see `mem:project/wix-site`).

## Source layout (globe+frustum+upload built; ephemeris/wix/backend still to come)
- `src/components/globe/` — client:only three.js scene. `tuning.ts` (ALL tunables, documented) ·
  `scene/*` attach-modules (baseEarth/graticule/atmosphere/stars/buildings/imageryGround + glsl) ·
  `StylizedTiles.ts` orchestrator · `PhotoFrustum.ts` + `flight.ts` (Phase 3) · GlobeCanvas. Sky,
  Pins TBD. Design imports NEVER touch. Convention: `.claude/conventions/globe-tuning.md`.
- `src/components/panels|ui/` — UploadFlow + PhotoDetailPanel + ui/Slider BUILT; time scrubber, AI TBD. Design imports allowed.
- `src/lib/{decode,geo,format,ephemeris,theme,wix}/` — decode REAL (extract/exif/worker/workerClient/convert + sensors; libraw-wasm@1.0.5 pinned); geo REAL (projection incl. ecefToGeodetic + rayEllipsoidIntersect, frustum, geohash); readout formatters; GL token bridge; ephemeris + SDK clients TBD.
- `src/store/` — zustand reactive EXIF params + placement machine (spine of real-time re-projection); `upload.ts` BUILT. `src/backend/` — thin HTTP endpoints (TBD).
- (no `public/wasm/` — Vite emits `libraw-*.wasm` as a hashed asset; libheif wasm is inlined). `public/textures/` — earth-color (July topo+bathy) + earth-night
  (VIIRS) + earth-topology (elevation) + earth-landmask + earth-normal. `test/` — vitest (FOV/geohash/projection).

## Key invariants (violations = bugs)
- Globe is `client:only` — **never SSR WebGL**. Decode runs in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- Stylize tiles via `load-model` material swap, **not** `BatchedTilesPlugin`. On ground-imagery tiles,
  **chain** onBeforeCompile (TilesFadePlugin already wrapped it). Astro **5** only (not 6).
- Globe/GL colour flows through `lib/theme/tokens.ts` (D14). Colour textures = sRGB; data textures =
  `NoColorSpace`. Fence design imports to panels/ui/styles.
- **C6 privacy:** never expose exact GPS on a public pin (reduced precision: exact/1km/city).
- No split payments → owner-mediated payout. Claude vision → JPEG only, never RAW. Wix Data → geohash, no geo query.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) + §4 (ADR D1–D15) are **binding**. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth (distilled from `DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:project/wix-site` — live URL + siteId/appId
- `mem:architecture/system-overview` — the engine + pipelines
- `mem:patterns/globe-rendering` — how the organic LEO globe is built (bands, atmosphere, ground grade, traps)
- `mem:patterns/sky-bodies-terrain` — ephemeris sun/moon, scene time, bloom, shadows, REAL terrain (current ground pipeline)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:memory_maintenance` — how to maintain this graph
