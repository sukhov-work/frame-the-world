# Frame the World — Decisions Log

One line per meaningful change: what was decided, files touched, and any number measured. **Append-only,
absolute-dated.** Verification status is explicit — local-tested, wix-VERIFIED (confirmed against the live
Wix platform), or UNVERIFIED. Supersede a past line with a newer dated line; never edit or delete old ones.
Durable design rulings also live as `mem:decisions/*`. Maintained per `mem:decisions/session_workflow`.

The founding architecture decisions (ADR-000, D1–D15) are backfilled below from `PROJECT_SEED.md §4` —
they are **binding** and were research-verified before this repo existed. New work extends this log.

---

- **2026-07-10 — Claude Design round-trip CONFIRMED + token reconciliation imported (local-VERIFIED).**
  Post-restart, `/design consent` granted and `mcp__claude-design__list_projects` now returns "Frame the World"
  (`fb0d7afa-…`) — the killswitch fix is proven end-to-end (this was the reason for the restart). Read the design
  project: `Frame the World.dc.html` (1234 lines, canvas mode) + `globe-scene.js`/`image-slot.js`/`support.js`.
  Board "00 · DESIGN SYSTEM" defines: dark space-neutral base, one luminous cyan-teal accent, **Space Grotesk (UI)
  + IBM Plex Mono (readouts)**, 4px spacing base, motion (micro 180ms · panels 400ms · flight desktop 2200ms /
  mobile 1600ms · easing cubic(.65,0,.35,1) · idle drift 0.035°/frame, pause-on-interaction, resume after 8s),
  pin/quota/control states. Screen boards: 01 Landing, 02 Explore (pin hover), 03 Pin→Detail cinematic zoom,
  04 Photo Detail (live EXIF sliders, double-click resets to EXIF). Reconciled into `src/styles/tokens.css`:
  ADDED chrome tokens `--color-bg-raise #0B0F14`, `--color-surface-2 #1A1F27`, `--color-accent-600 #2FD1C4`,
  `--color-danger #E8756A`, `--color-warn #E8A268`; switched `--font-ui`→Space Grotesk, `--font-mono`→IBM Plex Mono;
  loaded both via Google Fonts `<link>` in `Layout.astro` (exact family/weights from the canvas). Regenerated the GL
  bridge `src/lib/theme/tokens.ts` (added `accent600`). **DIVERGENCE (deliberate, D14 fence):** the design board's
  `globe/land #7A8E84` + `globe/water #0A1118` were NOT adopted — the globe palette is browser-VERIFIED (`land
  #38495B`/`water #0F2233` + land-hi/peak/atmosphere/graticule/star, which the board doesn't even list), and design
  imports never own `globe/**`; kept the verified render values, flagged the swatch mismatch for a future call.
  Canvas push-back (step 4) DEFERRED until an actual panel/screen is implemented (snapshot-after-build semantics).
  Files: `src/styles/tokens.css`, `src/lib/theme/tokens.ts`, `src/layouts/Layout.astro`. `astro check` 0 errors +
  `npm test` 35 green. **UNVERIFIED:** font render + chrome-token appearance in the browser (no panel consumes the
  new tokens yet); Google-Fonts CDN reachability under `wix release` (swappable to self-hosted @fontsource if blocked).
- **2026-07-10 — Claude Design MCP unblocked: removed the nonessential-traffic killswitch (config-VERIFIED; round-trip pending restart).**
  Prior sessions couldn't reach the "Frame the World" design project (`fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c`) —
  MCP tools loaded but every call errored "hasn't granted this — run /design consent", and `/design consent`
  itself silently no-op'd; user reported "/design-login non-existent". Root cause (found by grepping the v2.1.205
  CLI binary + `~/.claude.json` + `~/.claude/settings.json`): it was NEVER a consent/login bug — the entire Claude
  Design Projects surface (`list_projects`/`read_file`/`write_files`) and `/design-sync` are HARD-GATED off by
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (binary string: "Projects is unavailable while nonessential network
  traffic is restricted"; the consent POST to `/v1/design/consent` is itself classed nonessential → blocked, so
  consent can't even be recorded). That flag was set in the `env` block of GLOBAL `~/.claude/settings.json`. Fix:
  removed the flag (user chose full removal over granular DISABLE_TELEMETRY/ERROR_REPORTING/AUTOUPDATER/BUG_COMMAND).
  JSON re-validated. **REQUIRES a full Claude Code quit+relaunch** (env read only at process start — this session
  still carries the flag). Post-restart: run `/design consent` (real cmds `/design consent|login|revoke`; the web
  app's hyphenated `/design-login` is not a CLI command), then MCP round-trip works. Files: `~/.claude/settings.json`
  (global, one line removed). Memory: `mem:project/dev_environment` (new "Claude Design MCP" section). Design
  round-trip + token reconciliation to the design space still **UNVERIFIED** until restart + consent + first import.
- **2026-07-10 — Globe detail pass: refining dark-map ground + normal-mapped terrain (browser-VERIFIED).**
  User: "upon zoom it looks like a mess, no details, no buildings — should be a proper map that gains clarity
  gradually; subtler atmosphere; more detailed terrain; more stars." Root cause (reproduced via Playwright):
  the 2048² base texture is featureless at city scale and asset 96188 is buildings-ONLY, so close zoom = flat
  blank ground + sparse same-colour buildings. Fix (research workflow, 3 agents; the `sources` agent failed
  schema + one glitched, but the `terrain` agent's R1–R7 + my own package verification covered it): (a) a
  SECOND `TilesRenderer` with **`GeneratedSurfacePlugin({shape:'ellipsoid',applyOverlayTexture:true})`** +
  `XYZTilesOverlay` (Carto `dark_all` {z}/{x}/{y}, user chose "dark vector map") + `TilesFadePlugin` +
  `UpdateOnChangePlugin` — a self-refining dark map draped on WGS84, revealed only below 300 km altitude so
  orbit stays stylized + cheap; Carto tiles LOD + fade in as you descend = "clarity gradually". (b)
  `GeneratedSurfacePlugin` ships WITHOUT a `.d.ts` in 0.4.28 (runtime-present via plugins index.js) → imported
  with `@ts-expect-error`. (c) base shrunk to WGS84×0.9997 so the imagery (at exact WGS84) sits in front (no
  z-fight); imagery meshes get `polygonOffset` on `load-model` so building footprints win. (d) building
  `styleMat` → `tokens.peak` + `flatShading` + `emissive tokens.land ×0.15` + `DoubleSide` so buildings POP
  over the dark map (they were the same slate as blank ground = invisible). (e) **normal-mapped relief**:
  added `public/textures/earth-normal.jpg` (2048², 329 KB) + a tangent-frame half-lambert in the base shader
  (`uRelief 0.75`, land-masked, pole-guarded) → orbit terrain now reads as lit 3D (Alps/Caucasus/Himalaya/
  Andes). (f) atmosphere subtler (`uIntensity 0.9→0.5`, `uPower 3.0→3.6`). (g) stars 2500→5000 + altitude
  fade 2000→800 km (fixes bleed over the near surface). (h) map attribution `© OpenStreetMap © CARTO` added
  to `index.astro` (Carto/OSM ToS). Files: `src/components/globe/StylizedTiles.ts`, `src/pages/index.astro`,
  `public/textures/earth-normal.jpg`. `astro check` 0 errors + **browser-VERIFIED** (Playwright): orbit relief
  + subtle rim + dense stars; city = dark Carto map with real Dnipro-area labels/roads + OSM buildings reading
  as light extrusions, no float/z-fight. **UNVERIFIED:** crossfade smoothness on a fast dive, mobile tile
  memory (2 TilesRenderers), CORS on `wix release`. **Claude Design MCP consent still not granted** (project
  "Frame the World" `fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c` exists but unreadable) → tokens NOT yet reconciled
  to the design space; run `/design consent` so it actually lands. zoomSpeed=5 kept (fine for a gradual pinch).
- **2026-07-09 — Phase 2 started: math core + vitest (local-tested, 35 green).** Built the load-bearing,
  fully-local-verifiable half of Phase 2 ahead of the WASM/browser parts: `src/lib/decode/sensors.ts`
  (FOV = `2·atan(sensorW/(2·focal))`; D4 fallback order `FocalLengthIn35mmFormat` → curated Make+Model
  sensor-width DB → flagged APS-C default; `estimated` flag drives the nudge UI), `src/lib/geo/geohash.ts`
  (base-32 encode/decode + adjacency + `geohashesForViewport` prefix set for the D7 `hasSome` query),
  `src/lib/geo/projection.ts` (WGS84 `geodeticToEcef` matching three's `WGS84_ELLIPSOID`, ENU basis,
  heading/pitch→`cameraForward`, `frustumPose`; three-free so it unit-tests fast). Added `vitest@^4` +
  `test`/`test:watch` scripts. Tests: `test/lib/**` — canonical geohash vectors (`ezs42`, `u4pruydqqvj`),
  exact ECEF axis points (equator→+X@a, pole→+Z@b), FOV textbook values, all fallbacks. `npm test` → **35
  passed**; `astro check` 0 errors. **Remaining Phase 2 (browser/WASM, next session):** `exifr` metadata +
  embedded-JPEG preview, `libraw-wasm` Worker decode, HEIC detect + `libheif-js` fallback, `UploadFlow`
  panel + zustand store — all need real RAW/HEIC fixtures + a browser to verify. Files: `src/lib/decode/sensors.ts`,
  `src/lib/geo/geohash.ts`, `src/lib/geo/projection.ts`, `test/lib/**`, `package.json`.
- **2026-07-09 — Phase 1 globe polish, take 2 (browser-VERIFIED via Playwright).** The prior "Phase 1 closed"
  globe rendered **near-black** — root cause found empirically (5-agent research workflow, 327k tok): the
  base used `earth-topology.png` (a grayscale **elevation** map — 66.5% of pixels exactly #000, mean 0.059)
  as an albedo **multiplier** against slate `landHi`, so `slate × ~0 = ~0`; only high peaks + Antarctica
  survived. Also: the graticule was a sphere **wireframe** (drew triangulation diagonals, not a grid),
  the atmosphere a flat back-side disc, the starfield **frustum-clipped** by GlobeControls' dynamic far
  plane (~2.04e7 at orbit) so it never rendered, and the base ellipsoid at `0.9995R` sat **3,189 m under**
  the WGS84 surface the OSM buildings extrude from. Fixes (all in `StylizedTiles.ts` + `GlobeCanvas.tsx`):
  (a) shipped a derived land/ocean mask `public/textures/earth-landmask.png` (`magick -threshold 0`, 43 KB,
  land 33.5% — interiors verified solid: C.Australia/Sahara/Siberia = 1.0; the texture-agent's "53% holes"
  was a bbox-includes-ocean artifact); (b) replaced the multiply material with a **ShaderMaterial** that
  `mix()`es water→land→landHi→peak from mask+elevation with half-lambert shading + `uNightFloor=0.5` (map
  readable on the dark side); both data textures now `NoColorSpace` (the `SRGBColorSpace` tag was itself a
  decode-darkening bug); (c) real lat/lon `LineSegments` graticule + hemisphere-discard shader (vanishes when
  inside); (d) fresnel limb-glow atmosphere (cyan-teal per brief); (e) camera-following, scaled starfield
  (`radius=1.05·alt`, centred on camera) so it stays inside the far plane; (f) `NeutralToneMapping` + explicit
  `outputColorSpace` (ACES/AgX rejected — desaturate the accent); (g) `HemisphereLight` fill + key 2.2→1.5 so
  night-side building tiles aren't black; (h) base at **exact WGS84** + `polygonOffset` + 384 segs; buildings
  now sit on the surface; (i) `setEllipsoid(tiles.ellipsoid, tiles.group)`, `enableDamping`, `maxAltitude=π/2`,
  `cameraRadius=8`, `zoomSpeed=5` (kept — fine for a gradual pinch); (j) dispose original tile materials on
  swap; raycast-disabled decorations; **150 km altitude gate** hides graticule/atmosphere/stars at city zoom.
  New GL tokens (css + bridge, ADR D14): `peak #7C8EA0`, `atmosphere #38E1D0` (swappable to Rayleigh blue
  `#4A93D4`), `graticule #2A3E4E`, `star #DDE6F2`; retuned `water #0F2233`, `land #38495B`, `landHi #4E6072`.
  Files: `src/components/globe/StylizedTiles.ts`, `src/components/globe/GlobeCanvas.tsx`,
  `src/styles/tokens.css`, `src/lib/theme/tokens.ts`, `public/textures/earth-landmask.png`. `astro check` 0
  errors + **browser-VERIFIED** (Playwright): orbit hero reads (continents geo-correct over Dnipro, cyan rim,
  stars, graticule); decorations gate off at low alt; OSM `.b3dm` tiles 200 OK refining to L4 over Dnipro.
  **UNVERIFIED:** the close-up oblique cityscape aesthetic (buildings load + are grounded by construction, but
  no polished street-level shot was captured). Claude Design MCP was unreachable (no consent) → palette is
  expert-judged, not from an approved design source. `wix release` still deferred → **Phase 2 (EXIF + decode) next.**
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
