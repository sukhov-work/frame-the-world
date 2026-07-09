# Frame the World — Decisions Log

One line per meaningful change: what was decided, files touched, and any number measured. **Append-only,
absolute-dated.** Verification status is explicit — local-tested, wix-VERIFIED (confirmed against the live
Wix platform), or UNVERIFIED. Supersede a past line with a newer dated line; never edit or delete old ones.
Durable design rulings also live as `mem:decisions/*`. Maintained per `mem:decisions/session_workflow`.

The founding architecture decisions (ADR-000, D1–D15) are backfilled below from `PROJECT_SEED.md §4` —
they are **binding** and were research-verified before this repo existed. New work extends this log.

---

- **2026-07-09 — Phase 1 closed (browser-verified).** Rewrote `StylizedTiles.ts` end-to-end: (a) migrated
  to non-deprecated APIs — `CesiumIonAuthPlugin` from `3d-tiles-renderer/core/plugins`, `GlobeControls`
  with `setEllipsoid(WGS84_ELLIPSOID, scene)` (no `tilesRenderer` in the ctor); (b) fixed the
  "empty-from-orbit vanish" (asset 96188 is buildings-only) by adding a stylized ECEF-scale base
  ellipsoid textured with a self-hosted grayscale world topology for navigation cues
  (`public/textures/earth-topology.png`, 378 KB); (c) accent-tinted back-side atmosphere rim, ECEF
  star-field, firmer lat/lon graticule (opacity 0.15); (d) camera framed above Dnipro at 15,000 km via
  `WGS84_ELLIPSOID.getCartographicToPosition`, `up = +Z`, `near/far = 1/1e9`; (e) `zoomSpeed = 5` so
  trackpad pinch is usable; (f) `try/catch` around `controls.update() + tiles.update()` so a single
  bad frame can't freeze the canvas. Files: `src/components/globe/StylizedTiles.ts`,
  `public/textures/earth-topology.png`. astro check 0 errors + wix build green + **browser-VERIFIED**
  by the user. `wix release` deferred pending greenlight → **Phase 2 (EXIF + decode) is next.**
- **2026-07-09 — Phase 1: scaffolded the Wix headless Astro app + "hello globe" island.** `npm create @wix/new` provisioned a live site (`frame-the-a173087b-yevhens.wix-site-host.com`, siteId `f597bcf5-bd38-4941-9dfe-e16d775743a3`, appId `566ce8ce-…`); merged the scaffold into the existing repo (one `.git`, bootstrap layer intact). Added `three@0.185.0` + `3d-tiles-renderer@0.4.28`. Built `GlobeCanvas.tsx` (client:only procedural stylized globe — always renders) + `StylizedTiles.ts` (Cesium OSM Buildings ion 96188 + GlobeControls, **ion-token-gated via dynamic import**) + GL token bridge (`lib/theme/tokens.ts`, seeded palette) + `styles/{tokens,global}.css` + landing overlay. Files: `src/components/globe/**`, `src/lib/theme/tokens.ts`, `src/styles/**`, `src/pages/index.astro`, `src/layouts/Layout.astro`, `astro.config`/`tsconfig` deps. **local-tested:** `npx astro check` 0 errors + `wix build` green. **UNVERIFIED:** actual globe render + OSM buildings (browser-only; buildings need a Cesium ion token in `.env.local` → `PUBLIC_CESIUM_ION_TOKEN`). Not yet `wix release`d (blank site still live).
- **2026-07-09 — Bootstrapped the Claude operating environment.** Laid down `.claude/` (CLAUDE.md,
  conventions incl. the distilled `wix-headless.md`, hooks, `/frame` skill), `.serena/memories/` graph,
  the persistence loop (DECISIONS + NEXT_SESSION), and repo-native `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`.
  Ingested `PROJECT_SEED.md`, `DEEP_RESEARCH.md`, `CLAUDE_DESIGN_MEMO.md` verbatim. Files: `.claude/**`,
  `.serena/**`, `README.md`, `.gitignore`. App **not** scaffolded yet (Phase 1 next). local-tested (hooks `bash -n`).

### ADR-000 backfill (from PROJECT_SEED §4 — research-VERIFIED unless noted)
- **D1 — Globe engine:** three.js + `3d-tiles-renderer@^0.4` + Cesium OSM Buildings (ion 96188) + `GlobeControls`.
  Only combo giving real global 3D buildings + geo-accuracy + unrestricted per-tile material override + custom
  cinematic camera. VERIFIED.
- **D2 — Precision:** re-center tiles group near origin (ReorientationPlugin / CESIUM_RTC) + GlobeControls
  dynamic near/far. Solves float32 jitter without a float64 fork. VERIFIED.
- **D3 — Decode:** `exifr` embedded-JPEG preview → `libraw-wasm` Worker demosaic; single-threaded SIMD default;
  HEIC Safari-native detect + `libheif-js` fallback. VERIFIED (pipeline), UNVERIFIED (threads / COOP-COEP).
- **D4 — Orientation UX:** nudge-to-align is core; `FOV = 2·atan(sensorWidth/(2·focal))` + sensor DB +
  `FocalLengthIn35mmFormat` fallback. ILCs rarely write heading; GPS 3–15m, altitude junk → terrain-snap. VERIFIED.
- **D5 — Projection:** textured plane at frustum far face (v1); projective texturing (v2 stretch). VERIFIED.
- **D6 — Ephemeris:** `astronomy-engine` 2.1.19 (±1 arcmin) + procedural sky + Yale BSC5 stars, one source
  drives sliders + lighting. VERIFIED.
- **D7 — Data:** Wix Data Collections + geohash-prefix `hasSome` + client refine; denormalized `PublicPins`.
  VERIFIED (no geo ops), INFERRED (pattern).
- **D8 — Quota:** Pricing Plans check + `beforeInsert` hook rejecting insert #11 for free members (server-side). INFERRED.
- **D9 — Media:** originals private, derived previews public; resumable TUS upload for >10MB; 30-day download
  links. VERIFIED.
- **D10 — AI:** runtime Claude via Wix AI APIs (~1 credit/call; Opus 4.6 shown); vision gets downsized JPEG;
  premium-gated; doubles as the moderation pass. VERIFIED.
- **D11 — Scheduling:** none in v1; if needed, external cron → token-secured HTTP endpoint. VERIFIED.
- **D12 — Rendering:** WebGL2 primary, WebGPU progressive via `three/webgpu`. VERIFIED.
- **D13 — Cesium ion:** Community (free) for PoC; Commercial ($149/mo) at first sale / >$50K entity; manual
  attribution in UI. VERIFIED (terms), INFERRED (burn rate).
- **D14 — Design workflow:** Claude Design as token/motion factory → tokens.css (source of truth) → GL bridge
  `tokens.ts`; fence the globe; skip Claude Design's Wix connector (we scaffold via CLI for island/worker
  control). VERIFIED (workflow), UNVERIFIED (connector details).
- **D15 — Working title:** "Frame the World". ASSUMPTION (provisional).
