# Frame the World — Decisions Log

One line per meaningful change: what was decided, files touched, and any number measured. **Append-only,
absolute-dated.** Verification status is explicit — local-tested, wix-VERIFIED (confirmed against the live
Wix platform), or UNVERIFIED. Supersede a past line with a newer dated line; never edit or delete old ones.
Durable design rulings also live as `mem:decisions/*`. Maintained per `mem:decisions/session_workflow`.

**Structure (compacted 2026-07-11).** Top-to-bottom: binding **ADR-000** decisions · a durable
**Traps & Gotchas** section (the load-bearing gotchas that keep resurfacing) · **Per-phase digests** ·
**Recent sessions** verbatim (newest first — new work appends here). Older verbatim session logs
(2026-07-09 → 2026-07-10) were **moved byte-identical** into [`DECISIONS_ARCHIVE.md`](./DECISIONS_ARCHIVE.md)
— the append-only invariant holds (a move is not an edit; superseded rulings are annotated only in the new
digest/ADR/Traps sections, never in the archived text). **Compaction round 2 (2026-08-15):** verbatim
sessions **2026-07-11 → 2026-08-01** were likewise moved byte-identical into the archive (its
§Moved 2026-08-15 divider) with new per-era digests appended below. **Compaction round 3
(2026-08-18, audit-2 D2):** verbatim sessions **2026-08-02 → 2026-08-15e** moved byte-identical
(archive §Moved 2026-08-18; checksum-proven 147,274 B) with 7 era digests below; the UPLIFT era
(2026-08-17 →, ladder parked mid-run) stayed verbatim. **Compaction round 4 (2026-08-22, audit-3
D16):** that carve-out EXPIRED when U8 completed the ladder (2026-08-19) and §Recent had reached
135 KB, so verbatim sessions **2026-08-17 → 2026-08-19d** moved byte-identical (archive §Moved
2026-08-22; **md5 `5ed47c51b9d44a754964771ffe418330`, 556 lines / 79,306 B**) with 3 era digests
below; the OWNER-BATCH era (2026-08-21 →) stays verbatim because it all rides the un-shipped
release gate. §Recent went 141.7 KB → 62.6 KB.
**Compaction round 5 (2026-09-06g, T40):** the OWNER-BATCH carve-out expired once the MESH SUITE closed
(2026-09-05b) and §Recent had reached 437 KB (3× the 135 KB trigger), so verbatim sessions **2026-08-21 →
2026-09-05** (through MESH SUITE MS8) moved byte-identical (archive §Moved 2026-09-06; **md5
`4260321dc13ba45b11c3de0bb5c8856e`, 865 lines / 410,237 B**) with 12 era digests below; the T77 era (2026-09-05b →,
live work) stays verbatim. The moved bytes are two spans of the old file (lines 365–1185 and
1195–1238) because the append-marker sat between them; the marker was re-seated under the heading.
§Recent went 437.0 KB → 27.0 KB (decimal KB).
**Compaction round 6 (2026-09-07c, T40):** §Recent had reached 137 KB again (nine T77 sessions in one
day), so verbatim sessions **2026-09-05b → 2026-09-06n** (MESH SUITE close → the five rulings executed)
moved byte-identical (archive §Moved 2026-09-07; **md5 `2137d0be57d10eccd791b4738c52e411`, 34 lines /
80,273 B**, one contiguous span, lines 498–531) with 3 era digests below; the T77 tail the handover
points at (2026-09-06o → 2026-09-07b) stays verbatim. File 140.7 KB → 60.4 KB.
**Compaction round 7 (2026-09-17, audit-4 D1/T141):** §Recent had reached 144.9 KB, so verbatim sessions
**2026-09-06o → 2026-09-10f** (the T77 lane's tail through the rendering interlude and the cache ruling)
moved byte-identical (archive §Moved 2026-09-17; **md5 `bb447cf172bb7dd1d2d7da2e89a644f7`, 45 lines /
133,576 B**, one contiguous span, lines 652–696) with 5 era digests below; the audit-#4 era (2026-09-11 →)
stays verbatim. File 144.9 KB → 60.2 KB.

---

## Binding decisions — ADR-000 (D1–D15)

From `PROJECT_SEED.md §4`, research-VERIFIED unless noted. **Binding** — change only by an explicit,
dated supersession line under Recent sessions.

> **D8 superseded 2026-07-10:** the `beforeInsert` quota hook was replaced by **endpoint-enforced quota**
> in the elevated `POST /api/photos` — the headless CLI provisions no Wix Data hooks (a member-session
> insert is platform-refused). See the Phase 5 digest. The 10-free / unlimited-paid intent is unchanged.
> **Quota numbers re-ruled 2026-07-17 (owner):** free **100** · premium **1000** (was 10/unlimited);
> enforcement mechanism unchanged. See the 2026-07-17 owner-rulings line; ships in Phase 6.9.

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

---

## Traps & Gotchas (durable)

The hard-won gotchas that keep resurfacing. Violating one is a bug. Referenced by
`NEXT_SESSION_PROMPT.md`; the originating session (date/phase) is named for the full story in the
Recent sessions block or `DECISIONS_ARCHIVE.md`.

### GL / rendering
- **Navy night-sky floor.** `renderer.setClearColor` encodes the colour to the renderer's OUTPUT space
  (sRGB) when no render target is bound, and EffectComposer runs autoClear-off → sRGB-encoded values land
  in the LINEAR HalfFloat buffer and OutputPass re-encodes them to (8,26,45) navy on every empty sky pixel.
  Fix = `scene.background = Color(bg)` (three converts per-target + force-clears). (S5)
- **Negative `heightAt` garbage.** Quantized-mesh terrain tiles return NEGATIVE elevations while loading /
  on coarse LOD → **clamp every consumer to `[0, 9000]`** (clamp-only-upward). Unclamped, an arrival sinks
  to its lookAt floor and an underground camera unloads the whole tileset. (S2)
- **Additive overlays vanish on a bright sky.** Additive blending adds only ~10–30/255 against the day sky.
  Planning overlays (day-arcs) are alpha-blended solid strokes, `depthTest` off (analytic horizon owns
  occlusion). (S6)
- **Mirrors never SEAT geometry.** A deadband-quantized store mirror is for readouts; anything that
  positions scene geometry (seat/anchor/cone centre) resolves LIVE in the orchestrator frame — a 0.02°
  stale mirror seat is ~2 km of visible offset. Pan/centring likewise consumes the RAW per-frame
  `focusHit`, never the deadband copy. (2026-08-18h U4 owner round; promoted audit-2 D7)
- **3d-tiles-renderer 0.4.28 internals are load-bearing but undocumented.** Comparator = sort-then-POP
  (return 1 ⇒ first); fields at `tile.traversal.*`/`tile.internal.*` (`__dunder` fields GONE); custom
  `priorityCallback` stays total on non-tile items; `loadAncestors=false` always pairs with an explicit
  comparator. Re-verify ALL of these on any version bump. (2026-08-18g U5; promoted audit-2 D7)
- **`GlobeControls.update()` skips the near/far fit when `controls.enabled === false`** → a disabled-controls
  mode (FPV) must call `controls.adjustCamera(camera)` every frame or the frozen planes black-screen at
  street level. (S2)
- **Stale `InstancedMesh.boundingSphere`.** three caches the EMPTY sphere from count=0 and GlobeControls
  raycasts before pins load → every later pick early-outs forever. Set `mesh.boundingSphere = null` on
  every instance change. (Phase 5.1)
- **ECEF float32 cancellation.** ECEF ~6.4e6 m in float32 GPU matrices quantises at ~0.5 m and CRAWLS as the
  camera moves. Render instanced / large-coordinate meshes **camera-anchored**: `mesh.position =
  camera.position`, camera-relative instance translations, modelViewMatrix-only shaders. TRAP: `hoverAnchor`
  must add `mesh.position` back. (S4; same lesson as PhotoFrustum.)
- **`backdrop-filter` creates a containing block** → `position:fixed` descendants become panel-relative.
  Render fixed popups OUTSIDE any backdrop-filtered ancestor. (S3)
- **Dynamic far-plane clips the far hemisphere.** GlobeControls' far plane hides the starfield + atmosphere
  far shell → render near-hemisphere, clamp camera-anchored impostor distance ≥ 1.2·near. (Phase 1)
- **Descending zoom outruns tile load.** The manual zoom targets ellipsoid altitude, so a street request
  dives under a high city; once underground the ground tileset fully unloads (0 meshes) and live `heightAt`
  never recovers. Sticky `lastGroundM` sampled at the VIEW FOCUS + a street-floor clamp BEFORE the crossing.
  Tiles exist only inside the frustum — sample the focus, not the camera footprint. (S2)
- **Typed-array texture uploads ignore `UNPACK_FLIP_Y`** → flip in the DATA. No single-channel sRGB format
  exists in WebGL2 → linearise a data texture with a `uNightGamma` uniform. (S5)
- **`Group.renderOrder` does NOT propagate to children** — set renderOrder per object. **Sub-pixel points
  render nothing** — point sizes ≥ 2 px. **`getPivotPoint` returns null on horizon views** and leaves the
  out-arg STALE — fall back to the view focus. (Phase 4 / S6)
- **A `let` declared BELOW its first use in `StylizedTiles.ts` is a TDZ ReferenceError that reads
  as "the globe is gone".** `sampleEphemeris` runs at MODULE INIT, so any orchestrator state it
  writes must be declared ABOVE it — not with the look state ~1,300 lines down. When it is not,
  `attachStylizedTiles` throws `Cannot access 'x' before initialization`, the dynamic import's own
  `.catch()` swallows it as a one-line `[globe] tiles disabled` warning, and the ENTIRE real-Earth
  globe silently falls back to the procedural placeholder. **Invisible to vitest AND `astro
  check`** — only a browser load catches it. Twice now: `ultraOn` (2026-08-22j) and `lunarEcl`
  (2026-08-22k).

### Wix platform / backend (gate Phase 6 — never archive silently)
- **App-defined POST routes** were feared to 403 through the cloud adapter → the released-URL `/api/ping`
  canary confirmed 200; the risk is dead but the canary STAYS as the pre-release gate. (Phase 5 release)
- **Login builds an `http://` callback** repaired from the Referer header; `http` is tolerated only for
  localhost → referer-less (curl) auth fails "Invalid redirect URI". (Phase 5 release)
- **EVERY real `<form method=post>` 403s on the live host** ("Cross-site POST form submissions are forbidden"): the
  cloud adapter hands Astro an `http:` request URL, so `checkOrigin` sees a browser's `https:` Origin as cross-site — the
  same mismatch as the `http://` callback line above. Writes are JSON fetches (exempt); sign-out is `POST /api/signout`
  (JSON) + `location.assign(logoutUrl)`. Dev never runs the check, so only production shows it. (2026-09-18)
- **A BODY-LESS `/api` WRITE 403s on the live host too** — `fetch(url, { method: "DELETE" })` sends NO content type, and
  `checkOrigin` passes a non-safe method only with a non-form content type OR a matching origin (never, on the live
  `http:` URL). Every delete (models / photos / listings / places) was dead in production while dev passed every
  harness. Writes go through `lib/api/dataFetch.jsonWriteInit` (header always); `jsonWrites.test.ts` fences it. (2026-09-19)
- **Elevated inserts run as the APP identity** → set `ownerMemberId` explicitly or ownership is wrong. (Phase 5)
- **`extensions.dataCollections` does NOT provision from `wix dev`** → the REST
  `scripts/provision-collections.mjs` is the schema source of truth. (Phase 5)
- **A stale member cookie is silently replaced by a visitor cookie** on the next HTML response → re-mint
  tokens before verifying member flows. (Phase 5)
- **OAuth allowlist is PORT-EXACT** — 4321 and 4322 must both be registered. (Phase 5)
- **Viewport pin query must THROTTLE, not debounce** — the perpetual LEO idle drift starves a debounce
  timer so it never fires. (Phase 5)
- **Media >10 MB must use `generateFileResumableUploadUrl` (TUS)** → async `onFileDescriptorFileReady`. (CLAUDE.md)

### Verification / tooling
- Occluded Chrome throttles rAF to ~1 frame/several-s → `page.bringToFront()` before timing-sensitive
  browser verification.
- Hiding the tiles groups crashes the rAF tick → the canvas presents the last good frame and every "hidden"
  measurement reads stale (guard with a `renderer.info.render.frame` advance check).
- `document.elementsFromPoint` SKIPS `pointer-events:none` nodes; `stars.update()` re-sets `points.visible`
  every frame (hide via `material.visible`); synthetic dblclicks need a preceding pointerdown/up pair.
- Verify tiers, in order: Playwright MCP → Chrome-extension bridge → scripted headless-Chrome CDP
  (`scripts/verify-s5-night.mjs` idiom). DEV seams: canonical inventory = `contracts.md §3`
  (top-level + sub-seams). Screenshots → `verify-shots/` only.
- **Check who owns the CDP port FIRST** (`lsof -nP -iTCP:9222 -sTCP:LISTEN`). A stale verify Chrome
  without the occlusion flags keeps the port; the fresh flagged launch silently fails to bind and the
  client attaches to the buried stale window where rAF is frozen (~20 min lost in U5). Managed launch:
  `scripts/verify-chrome.mjs`. (2026-08-18g; promoted audit-2 D7)
- **CDP `Runtime.evaluate` attaches only POST-load** — the dev-local initial tile stream (~2 s) is over
  before any sampler attaches; construction-relative metrics must come from IN-PAGE probes
  (`__globe.u5Mark()` idiom), never from evaluate-side timing. (2026-08-18g; promoted audit-2 D7)

---

## Per-phase digests

One line per phase; full mechanics in the linked memory, verbatim session logs in `DECISIONS_ARCHIVE.md`.

- **Bootstrap (2026-07-09)** — `.claude/` operating environment + Serena memory graph + the persistence
  loop (DECISIONS + NEXT_SESSION). `mem:decisions/session_workflow`.
- **Phase 1 — scaffold + globe (2026-07-09/10)** — Wix headless Astro scaffolded onto the existing repo;
  the globe rebuilt into the LEO "signature scene": NASA Blue Marble July graded into the palette + VIIRS
  night lights + relief, ray-based atmosphere, a second TilesRenderer draping palette-graded Esri imagery
  that dissolves in by altitude, dark edge-stroked OSM buildings. `mem:patterns/globe-rendering`. RELEASED
  to the live URL 2026-07-10.
- **Design system import (2026-07-10)** — chrome tokens + fonts → `tokens.css` + the GL bridge
  `lib/theme/tokens.ts` (ADR D14). `mem:patterns/design-system`.
- **Phase 2 — decode (2026-07-10)** — `exifr` metadata + embedded-thumb preview + **`libraw-wasm@1.0.5`
  EXACT-pinned** (1.1.2+ needs pthreads/SAB = COOP/COEP, unusable on unverified Wix hosting) in a disposable
  per-file Worker + `libheif-js` HEIC fallback. `mem:patterns/upload-flow`.
- **Phase 3 — projection (2026-07-10)** — camera frustum + image plane from EXIF; reactive zustand
  re-projection; click-to-place for missing GPS; 2.2 s bezier flight (reduced-motion cut).
  `mem:patterns/photo-frustum`.
- **Phase 4 — ephemeris (2026-07-10)** — `astronomy-engine` drives sun/moon/terminator/shadows/atmosphere
  from scene time; TimeScrubber ±12 h + multiday; golden-hour bell grade; real BSC5 star field (−GAST); real
  Cesium World Terrain (90 m building sink removed). `mem:patterns/sky-bodies-terrain`.
- **Phase 5 — members + pins (2026-07-10)** — managed member auth (`@wix/astro`); Photos/PublicPins
  provisioned via REST; **endpoint-enforced 10-pin quota** (supersedes D8's hook); C6 reduced-precision
  public pins (cell-centre published); viewport geohash query + click→fly. First Wix-load-bearing phase.
  `mem:patterns/members-pins`.
- **Phase 5.5 S1–S6 — pre-marketplace UX (2026-07-11)** — location finder, flight/FPV core, pin lifecycle,
  pin visuals + Explore journey + Welcome landing, night-sky physics, FPV planning overlays. Canonical
  design `archive/PHASE_5_5_UX_BATCH.md`; full mechanics in the Recent sessions block below + `mem:project/wip-2026-07-11-*`.
- **Pre-S7 architecture review + refactor (2026-07-11)** — this compaction, doc-drift fixes, new
  conventions, and the safe cleanup tier. See `archive/ARCHITECTURE_REVIEW.md` + the Recent sessions block.
- **Phase 5.5 S7 tail + interlude (2026-07-11→12)** — S7 street names went GL: one canvas-textured quad
  per name LYING ON the terrain (DOM labels structurally lag a 60 Hz mesh), sourced from OpenFreeMap
  planet MVT (keyless; **maxzoom 14 — z15 returns empty 200s, probe first**; `pbf@5` exports `PbfReader`,
  no default export); vector road/water web with tile-exact clipping (Sutherland–Hodgman rings ·
  Liang–Barsky lines with re-entry splitting) killed the river-tile z-fight flicker; camera pose became
  shareable/reload-safe via the `#p=` URL hash. High-altitude pin selection landed SHIFTED — root cause:
  `ground.heightAt` returns null/NEGATIVE garbage on unloaded tiles (live: −2047 m at 697 km) so the
  committed arrival pose kept a stale low lookAt; fix = live re-frame + `clampGroundM`
  (`mem:bugs/pin-arrival-reframe`). Pre-S7 safe-refactor tier finished (B6–B15/B26: `lib/geo/{terrain,
  screen,heading}` extracted, the one lib→store violation killed, net −68 LOC); README rewritten for the
  internal Wix contest (headless-stress-test framing, 100% agent-built stated openly).
  Verbatim: `DECISIONS_ARCHIVE.md` §Moved 2026-08-15. `mem:project/wip-2026-07-11-phase5.5-s7` ·
  `wip-2026-07-11-s7-feedback-batch` · `wip-2026-07-11-pre-s7-refactor{,-s2}` ·
  `wip-2026-07-11-b19-split` · `wip-2026-07-12-readme-rewrite`.
- **Rendering-quality passes + Dnipro enrichment slices 0–3 + illumination (2026-07-12→14)** — Pass 1:
  NEW pure `lib/globe/quality.ts` (`detectDeviceTier` + `makeGovernor` EMA frame governor); **HARD
  INVARIANT: `QUALITY.tiers.high` == the pre-pass constants**; shadows later DECOUPLED from the governor
  (they follow the DEVICE tier; capable machines floor at `mid`) after the M3 Pro was degraded to `low`
  and lost the entire shadow pass. Pass 2: per-building tonal variation keyed on `_batchid`/`_feature_id_0`
  (GLTFLoader lowercases non-standard attributes); **ROOT LESSON: no FLAT per-building emissive ever reads
  as lit windows** — R3 night emissive OFF (`nightWindowGain 0`), window grid removed on owner order.
  Illumination pass owner-VERIFIED: `DRAPE.shadowOpacity 0.80` · `minSunElevSin 0.008` (~0.46°, keeps the
  golden-hour raking shadows) · altitude-adaptive shadow bounds. Enrichment: bake-and-mask REPLACES Cesium
  OSM Buildings in-bbox, self-hosted on R2 (extends D1/D13/C6); **vertical datum = bake relative geometry
  + runtime clamp-to-CWT** (EGM2008 undulation over Dnipro +20.42 m — a naive absolute-Z bake sinks ~20 m);
  Slice 2 = per-cell terrain re-seat (offsets match terrain within ~0.2 m; spread −20.6 m riverbank→hill)
  + a pixel-exact 4-plane ECEF `clipIntersection` mask hole; Slice 3 = 24,714 hash-seeded trees, ONE
  `EXT_mesh_gpu_instancing` node per cell (re-bakes byte-identical). Blank gallery preview fixed = SSR
  boot poster + OG meta — the Wix `site-snapshotter` captures SSR HTML only, never `client:only` islands
  (`mem:bugs/gallery-thumbnail-stale` RESOLVED). Verbatim: `DECISIONS_ARCHIVE.md` §Moved 2026-08-15.
  `mem:project/wip-2026-07-12-rendering-{quality-pass,pass1-tiling-fluidity,pass2-dnipro-identity}` ·
  `wip-2026-07-13-illumination-pass` · `wip-2026-07-13-dnipro-slice{0-spike,1-bake,2,3-trees}` ·
  `wip-2026-07-13-terrain-reseat` · `wip-2026-07-13-dnipro-enrichment-research`.
- **OSM2World variant + R2 hosting + obstruction moat + owner seating/UI batches (2026-07-14)** —
  `bake-osm2world.mjs` shipped as a PARALLEL VARIANT (`cities/dnipro-o2w.json` `extends` dnipro; the
  `?enriched=` A/B seam; the classic pipeline stayed byte-identical); the 1-cell spike settled the o2w
  axis: `(east,up,−north)` == our `gv(e,u,−n)` (1362/1362 buildings in-bbox). R2 hosting LIVE: a
  Cloudflare **Worker over a private bucket** (free-tier CORS/Range control; r2.dev serves no CORS) at
  `frame-the-world.ievgen-sukhov.workers.dev`; dev NEVER reads R2 — tiles moved out of `public/` into
  git-ignored `bakes/` + a serve-only Vite middleware `ftwLocalTiles` (client bundle 372 MB dead weight →
  24 MB). Both bakes expanded to Greater Dnipro ~20×20 km (grid 20 ≈ 1 km cells; 127,890 bldgs · 161,823
  trees) + the `BLD` chip CLASSIC⇄OSM2WORLD toggle. PER-BUILDING/PER-TREE terrain re-seat done on the
  CPU (position attribute / instanceMatrix) **deliberately** so planFeed occlusion sweeps, shadow maps and
  picks read the same arrays — a shader displacement would desync the planner. Pass 3 = the astro moat:
  pure `lib/ephemeris/planner.ts` (rise/set with eye-height dip; golden windows DERIVED from tuning.GOLDEN)
  + `lib/geo/horizonProfile.ts` + `skylineState` clear/block crossings (12-min scan + bisection ±0.5 s).
  FPV solidity became the screen-door Bayer dissolve — opaque + depth-writing at every k (the binary
  `depthWrite` flip was the 55→56 solid jump); `#f=` shareable FPV URLs; UI QoL batch (uniform
  hover-reveal DragGrip, time playback, shareable custom time in the URL, PLAN top-left, ☀/☾ edge chips).
  Verbatim: `DECISIONS_ARCHIVE.md` §Moved 2026-08-15. `mem:project/wip-2026-07-14-osm2world-adapter` ·
  `wip-2026-07-14-osm2world-slice1.5-spike` · `wip-2026-07-14-r2-hosting-osm2world-prep` ·
  `wip-2026-07-14-pass3-obstruction-moat` · `wip-2026-07-14-owner-batch-seating-ui` ·
  `wip-2026-07-14-uiux-qol-batch`.
- **Docs reorg → Phase 6 marketplace → 6.9 + release week + St Albans (2026-07-15→18)** — claude-docs
  reorganized into `provenance/ · dnipro-enrichment/ · rendering/ · archive/` subfolders (37 files
  repointed); Milky Way rebaked at 8K (**SVS star maps are flux-per-pixel** — 8k needs ×4 linear gain;
  gaussian pre-blur σ=1 texel in LINEAR space, else mip-less point sampling skips the sub-texel star
  speckle and the band goes near-black). Phase 6 marketplace-light: **Catalog V1 is IMPOSSIBLE on this
  site** (gateway 428 `CATALOG_V3_CALLING_CATALOG_V1_API`) → built on V3 — `POST /stores/v3/products
  {productType:"DIGITAL", …digitalProperties.digitalFile._id}` wix-VERIFIED; the preinstalled Stores
  automation delivers the 30-day link. PROD OUTAGE root-caused: the Wix asset origin cold-serves each
  chunk in 15–30 s and 500s at the ~30 s gateway cutoff → dead islands/black globe after every release
  resets hashes; recovery = SERIAL `warm-prod-assets.mjs` retry-until-200, and **the asset edge cache is
  SHARDED** (a warmed shard ≠ the browser's — reload until clean). Owner rulings: quota free **100** /
  premium **1000** (supersedes D8's numbers) · demo pins owned by yevhens@wix.com and ALL for sale ·
  MARKETPLACE as its own topnav button. 6.9 batch: two-tier quota · EUR fix (`SITE_CURRENCY` — no SDK
  exposes site currency) · SALES tab · `redirects.createRedirectSession` REJECTS relative postFlowUrl
  (absolutize) · Catalog-V3 `createProduct` defaults variants to tracked-quantity-0 (blocks checkout) →
  `createProductWithInventory {inStock:true}`. Demo seed ×27 listed + FAQ panel + orbital-grade pass
  RELEASED live; ground checkerboard parked (`mem:bugs/ground-checkerboard-flicker`). City #2 St Albans
  baked + live on R2 — **the o2w work-cache was sub-grid-INDEX-keyed and collides across cities** →
  per-city `.cache/o2w/<city>/`. Verbatim: `DECISIONS_ARCHIVE.md` §Moved 2026-08-15.
  `mem:project/wip-2026-07-15-docs-reorg-phase6-prep` · `wip-2026-07-16-phase6-marketplace-research` ·
  `wip-2026-07-16-prod-asset-outage` ·
  `wip-2026-07-17-{phase69-marketplace-batch,demo-seed-curation,seed-orbital-faq-batch}` ·
  `wip-2026-07-18-st-albans-city2`.
- **View-prefs persistence + default flips (2026-07-21)** — defaults flipped: SAT ground on, FPV
  buildings fully solid (slider double-click resets to 100). NEW seam `lib/prefs.ts` (`ftw:view-prefs:v1`
  localStorage; `sanitizeViewPrefs` clamps/drops junk; SSR/node-safe no-throw): SAT/☀☾/BUILDINGS persist
  inside their store setters; **PIN persists at the CHIP only** — the orchestrator's FPV declutter shares
  `setPinsVisible` and must never write the pref (a mid-FPV reload would freeze pins-off as if chosen);
  BLD variant reload-survives via pure `applyStoredVariant` (an explicit `?enriched=` ALWAYS wins
  verbatim). Detail-panel close ask included.
  Verbatim: `DECISIONS_ARCHIVE.md` §Moved 2026-08-15. `mem:project/wip-2026-07-21-viewprefs-uiux`.
- **Astro engine A–E + comet 10P (2026-08-02→10)** — search/track ANY body: 1,947-entry fuzzy
  index (stars/constellations/comets/asteroids/full OpenNGC), universal-variable kepler +
  SIMBAD/SBDB long-tail with TTL caches, target trail/markers/rise-set windows, planet phase
  discs; comet 10P tracer + magnitude-model fix. Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-03-astro-engine-phase-a` · `-c` · `wip-2026-08-10-astro-engine-phase-bde` ·
  `wip-2026-08-02-comet-10p-tracer` · `mem:bugs/comet-magnitude-model`.
- **Mobile design trio (2026-08-11)** — the /m planning-shell design memo + M-ladder plan +
  device matrix; mobile = planning-only ruled PERMANENT. Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-11-mobile-design` · `MOBILE_PLAN.md`.
- **Full audit #1 + fix slices 0–7 + Phase 8a + planning-core restructure (2026-08-13)** —
  first whole-repo audit (report `audits/audit-full-2026-08-13.md`), 8 fix slices same-day,
  twilight/GC/MW planning core, FPV walk-orbit bug. Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-13-full-audit-1` · `wip-2026-08-13-planning-core-restructure` ·
  `wip-2026-08-13-slice7-phase8a` · `mem:bugs/fpv-walk-orbit`.
- **Mobile M0–M3 (2026-08-13→14)** — /m shell (sheets/tab bar/dock conveyor), FPV touch
  (joystick walk, pinch-FOV, wake lock, minimap), PlanSheet twins, TARGET GHOSTS + long-press
  sky menu, mobile-default entry (`?d=1` escape). Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-13-m1-mobile-planning` · `-m2-fpv-touch` ·
  `wip-2026-08-14-mobile-m3ab` · `-m3c` · `MOBILE_PLAN.md`.
- **Planning QoL 1–4 + FIND v2/v3 + §3.5 sunsets (2026-08-14→15)** — scrubber v2 + tail trace,
  frameFinder cards, GHOSTS chain, NPF/moon-calendar/size-dist tools, FindPanel frame-as-query
  per-day scan + in-frame ghosts + standings, sunEventFrame (refracted labels / airless
  geometry PINNED). Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-14-qol-batch`…`-qol4-batch` · `-find-rework` ·
  `-find-accuracy-labels` · `-night6-hover-floor` · `wip-2026-08-15-sunsets-in-frame` ·
  `mem:project/owner-orders-2026-08-14-qol-batch`.
- **Owner UX batches ×5 + ×9 (2026-08-15b/c)** — PLAN/FIND one shared resizable window, grown
  sky context menu (TRACKING/MARK/TRAIL/FIND-IN-FRAME + camera-aiming rise/set), TRACKING
  camera lock, /m FIND 4th tab + login + MY PLACES + SAVE VIEW, collapsible mini-map.
  Verbatim: archive §Moved 2026-08-18. `mem:project/wip-2026-08-15-ux-batch` · `-uxbatch2`.
- **Guide G1 + polish (2026-08-15d/e)** — ONE content module `lib/guide/guideContent.ts`
  (11 chapters · ~40 topics · goals router · `[[id|label]]` crosslinks) → desktop Guide panel +
  /m GuideSheet; FAQ ABSORBED (island deleted); 12 warm-list-coupled screenshots; slop-lint
  tests; DECISIONS compaction round 2 same session. Verbatim: archive §Moved 2026-08-18.
  `mem:project/wip-2026-08-15-guide-g1` · `GUIDE_PLAN.md`.
- **UPLIFT ladder U1–U8 + audit #2 + fix slices (2026-08-17 → 2026-08-19).** P7 meteor showers
  (21-row IMO bake, radiant-as-target, R12 rail layer) + `UPLIFT_PLAN.md` authored → U1 /m
  2D-first · U2 FPV stability ×8 · U3 fullscreen MapWindow + 2D-map batch + desktop flat map ·
  U4 direction lines + aim cones · U5 closest-first loading → PARKED for AUDIT #2 (report
  `audits/audit-full-2026-08-18.md`) + its fix slices → UN-PARKED: U6 foveation · U7 terrain
  audit · U7b GLO-30 terrain patch + best-variant buildings rule · **U8 per-building height
  override (2026-08-19) — the 10-point ladder COMPLETE**, backend prepared but dormant for the
  batch-sync phase. Verbatim: archive §Moved 2026-08-22.
  `mem:project/wip-2026-08-17-p7-meteors-uplift-plan` · `wip-2026-08-17-u1-2d-mobile` ·
  `wip-2026-08-17-u2-fpv-stability` · `wip-2026-08-18-u3-2dmap-batch` · `wip-2026-08-18-u4-aim-cones` ·
  `wip-2026-08-18-u5-loading` · `wip-2026-08-18-audit2` · `wip-2026-08-18-audit2-fixslices` ·
  `wip-2026-08-18-u6-foveation` · `wip-2026-08-18-u7b-glo30-terrain-buildings-rule` ·
  `wip-2026-08-18-u8-height-override` · `UPLIFT_PLAN.md` · `BAKED_ASSETS.md`.
- **Owner UX batches #2 + #3 (2026-08-19b/c).** #2 (11 items): override cap 1000 · /m map glyph
  + day steppers + joystick-over-fullscreen-map · Esc-closes-map-first · SKY search default ·
  DISABLE menu labels + find-in-frame composite-state fix · the UNFOLLOW verb
  (`sky.stopFollowing`) + peek hint + target-section reorder both shells · FIND generalised
  `gc`→`target` (ANY tracked target) · /m ⊞ LAYERS chip + MY-PLACES-ON-MAP (`store/places`) +
  `aimVisible` RADAR master + `pinsVisible` /m-default-off. #3 (9 items + 2 tails): desktop 2×4
  toggle grid · desktop radar <10 km band · my-places-on-map desktop FIXED (missing lit CSS +
  new GL `scene/placeMarkers.ts`) · UNFOLLOW also disables its FIND body · /m LAYERS expands
  LEFT · radar-bearings regression fixed (session-only dismissal + body-named DIRECTION labels
  + one-time `prefsRev` re-arm) · places nearest-first (`lib/geo/proximity.ts`) · /m SAVE VIEW
  optional-name Sheet · GOTO tracked-target chips both shells (`panels/SkyGotoChips.tsx`).
  Verbatim: archive §Moved 2026-08-22. `mem:project/wip-2026-08-19-owner-uxbatch2` ·
  `wip-2026-08-19-owner-uxbatch3`.
- **PLUX launch grooming — brand + domain + guide G2-refresh + guide search (2026-08-19d).**
  Brand Sidera→**PLUX** everywhere (wordmark hero, nav/strip/upload marks, favicon set,
  favicon.svg deleted) · domain assessed and the repo flipped to `https://www.plux.today`
  (`SITE_URL` + 7 script defaults + `FTW_SITE_URL` override) — **prod DARK until the owner's
  GoDaddy nameserver replacement → Wix www TLS → OAuth allowlist**, the release gate every
  later batch still rides · guide G2-refresh (16 topics corrected + 7 new + 3 goals;
  `shell-m.webp` re-shot) · guide BM25+fuzzy search both shells (`lib/guide/search.ts`).
  Verbatim: archive §Moved 2026-08-22. `mem:project/wip-2026-08-19-plux-launch-grooming`.
- **OWNER BATCHES #4–#6 + QA BATCH + QA-7 + PRE-AUDIT SLICE C→A→B + MICRO-SLICE (2026-08-21→22b)** —
  batch #4 shipped 18/18 over S1–S3: 2D-map gestures reworked (the tilt-into-3D door retired),
  continuous pinch, VEC chip (`vectorsVisible`), ⌖ FIND IN FRAME, /m PiP, iOS-only `public/sw.js`
  tile cache, `QUALITY.leanMobile`, radar annular bands + focal cone + AimJoystick in the NEW shared
  tier `src/components/controls/` (mobile-fence rule 3). Binding owner rulings: bands run moon → sun
  → target; a manual pan on the expanded chart never auto-recentres, and ◉ RE-CENTRE is the exit;
  the flat 2D chart is photographic (`GROUND.flat2dPhotoK 1`). REFUTED: tile cache-busting (Chrome's
  disk cache holds ≈95 % of a reload) and the radar's lost occlusion gaps — they never existed, and
  gaps shipped here as a new capability. Gates 1,074 → 1,144 vitest, 7 verify suites. Trap: an
  injected-GLSL uniform silently no-ops unless the fragment header declares it. Verbatim: archive
  §Moved 2026-09-06. `mem:project/wip-2026-08-21-owner-uxbatch{4,5,6}` · `-owner-qabatch7` ·
  `wip-2026-08-21-qaslice-cab` · `wip-2026-08-22-owner-microslice`.
- **AUDIT #3 + FIX SLICES F1–F10 + POST-SHIP PREP (2026-08-22c/d/e)** — report
  `audits/audit-batchseams-2026-08-22.md`: 4 tracks in two waves, 46 findings, none refuted in
  verification. Headline: five verify checks that COULD NOT FAIL were found and fixed; C7 refuted
  the 2026-08-21h claim that the FOV inverse pair was transitively pinned. All ten fix slices then
  shipped: one anchor ladder `lib/geo/aimAnchor.ts` (the camera nadir sat 4,341 m off the focus),
  extractions to `lib/geo/radarBands.ts` · `scene/tangentOverlay.ts` · `panels/radarCanvas.ts`,
  `lib/theme/cssInk.ts` (0 `getComputedStyle` calls left in either canvas paint),
  `PLAN.minCoverageForGaps 0.5`, mobile-fence rule 4, `verify-cdp-cleanup.mjs` in all 20 scripts,
  and 4 new guide topics. RULE: a verify script never re-derives a shipped decision. T32/T35–T40
  CLOSED, T41/T42 opened. Gates 1,217/1,217 vitest (107 files), `knip` exit-0; compaction round 4
  cut DECISIONS 167 → 92 KB. Verbatim: archive §Moved 2026-09-06.
  `mem:project/wip-2026-08-22-audit3{,-fixslices}`.
- **GUIDE FINALIZATION G-A…G-J + OWNER SLICES 22h/22i (2026-08-22f/g/h/i)** — all ten charter slices
  of `GUIDE_FINALIZATION_PLAN.md` (732 lines) shipped in one session, after a 12-agent copy re-audit
  raised 44 findings of which 38 survived: 3 new topics; a six-tier search identity ladder (id-exact
  ×2.5, fuzzy floor 5, prefix minLen 3) that puts all 70 topics, 11 chapters and 14 goals first;
  `?guide=<id>` deep links; search on `/guide`, which supersedes that page's "zero client JS"
  invariant. Anti-slop shipped as 4 banned regex groups at 0 current hits, a regression guard; the
  em-dash, -ly and "never" bans were REJECTED on counts (4,647 em dashes in `src/**`; "never" is the
  C6 guarantee). T41 ruled ACCEPTED AS-IS → CLOSED. 22h/22i: scrubber chrome restored (a 2026-08-21f
  regression); Everest GLO-30 terrain-only bake (210 MB, Kala Patthar 5,550 m vs 5,545 published);
  FPV ceiling 400 → 2,000 m; ULTRA HQ on the `ULT` chip; the HQ 3D map built, measured inert and
  removed. 1,305/1,305 vitest. `ULTRA_PLAN.md` · `rendering/FPV_FIDELITY_AUDIT_2026-08-22.md`.
  Verbatim: archive §Moved 2026-09-06. `mem:project/wip-2026-08-22-{guide-final,owner-3slice}`.
- **ULTRA + eclipses + dusk (2026-08-22j/k, 27b/c)** — desktop-only `ULT` chip, off by default: T44
  textures (`uFtwPhoto3d`, anisotropy 16) + T45's S9 twilight bands (36° of sun elevation) → S3
  terrain casts. Owner ruling: sub-15 fps is worth the fidelity (supersedes `ULTRA_PLAN` §2); 30.7
  → 36.1 ms. Eclipses (22k, `ephemeris/eclipse.ts`): the sun shader now carves the moon's disc out of
  itself, because the daytime moon mesh was discarded under `SKY.moonAlphaDiscard` and could
  never occlude anything; the alignment needs topocentric geometry (1.006° vs 0.062°). 27b: the shadow
  box covered 8–35 % of a mountain frame, now 100 % (`shadowCascade.ts`) · the air-light had no
  LEVEL term, so dusk's far field outshone the foreground (`duskLight.ts`) · the dark tile grid was
  the terrain SKIRT (`terrainSkirt.ts`). 27c: contrast is `direct/(direct+flat)`, so a dimmer key
  light left anti-sunward slopes at 0.969 of sunward at +2°, now 0.685. CSM/PCSS/VSM/GI rejected.
  Gates 2,210/2,210; `rendering/ULTRA_ARCHITECTURE.md`. Verbatim: archive §Moved 2026-09-06.
  `mem:project/wip-2026-08-22-ultra-track` · `wip-2026-08-22-eclipses` ·
  `wip-2026-08-27-ultra-render-batch` · `wip-2026-08-27-dusk-taste-pass`.
- **BEST SPOT — the observability heatmap (2026-08-23 → 2026-08-27d)** — S1→S7 shipped and
  browser-verified: ten pure `lib/geo` modules and the desktop `◎ BEST SPOT` panel — disc · top-8
  shortlist · FPV preview · honesty lines; no `/m` twin (T51). The S6 residency contract held: 39
  hull builds/drag frame → 0 on scrub and lift. 2026-08-26e→j then measured the metric answering a
  different question than the owner asked. The gate zeroes his cell; `access.soft.unknown` = 0.45
  caps it at S_max 0.345 < the 0.378 entry price (T59). NOT built: sweep mode (cut 2026-08-26i) and
  `F_peak` (T60). PARKED 2026-08-27 → `bestspot/README.md` + `TRAPS.md`; owner ruled it SUFFICIENT
  2026-09-01. 2026-08-27d added a guide BEST SPOT chapter + eclipse/ULT topics. `verify-bestspot`
  96/101 BY DESIGN (T61); vitest 2,210/2,210 (146 files). Verbatim: archive §Moved 2026-09-06.
  `mem:project/wip-2026-08-{23-bestspot-heatmap,24-bestspot-s3-s7}` ·
  `wip-2026-08-26-{bestspot-ownerbatch,bestspot-taste,sweep-mode,sweep-schedule,gate-star-floor}` ·
  `wip-2026-08-27-{bestspot-park,guide-bestspot-eclipses}`.
- **Formal verification + the heatmap docs reconcile (2026-08-24d)** — `formal/` (Lean 4.33.1 +
  Mathlib): `Hull.lean` proves the upper hull is eye-independent (`hullBuilds === 0`), `Score.lean`
  bounds the preference blend. Gate `npm run proofs`: 25 theorems, 0 `sorry`, axiom-audited, 25
  PASS (2026-08-24d); the build is NOT the gate, a `sorry` still builds. Writing the hypotheses
  down exposed two defects 1,902 tests missed: `sanitizeScoringPatch` let `conf` exceed 1
  (`CellScore.f = 1.6`) and a weight go negative (sum −0.3, score falling as its term improved);
  fixed by `BESTSPOT_SAFETY.confMax 1`/`.weightMin 0`. Formalize the claim, not the implementation:
  an hour against weeks. Limits in `claude-docs/FORMAL_VERIFICATION.md`: no Lean→JS path, ℝ vs
  float64. Lake's root is the REPO root, so `cd formal && lake build` fails. Verbatim: archive
  §Moved 2026-09-06. `mem:project/wip-2026-08-24-formal-verification`.
- **BRAND — PLUX is the product, "Frame the World" is the repo (2026-08-25)** — a real leak
  shipped: `src/lib/export/ics.ts` put `PRODID:-//Frame the World//…` in every exported .ics (now
  PLUX). The rename stops at what a user can SEE: the `ftw:*` keys, `uFtw*`/`vFtw*`/`FTW_*` shader
  ids and the `Ftw` Lean namespace are never renamed; `test/brandFence.test.ts` fences both ways.
  Verbatim: archive §Moved 2026-09-06. No wip leaf; ruling in `mem:core` + `CLAUDE.md` §The name.
- **RENDERING CHARTER — RC0–RC30, groups B/C/F/E/D, CLOSED (2026-08-25b → 2026-08-26d)** — 4
  owner bugs fixed (RC1 eclipse square, RC2 sunset shadow snap, RC3/RC4 FPV shadows, RC5 Esri
  placeholders), then RC6–RC11 seats/height memo, RC13 skirt at +0 verts, RC16 straddlers, RC17
  sidecar schema 2, RC18–RC20+RC25 governor split, /m PiP, LRU bank, mip chain, RC23/24/26 ULTRA
  seams + reload dot. **ULTRA off-state exactness (`=== 0`, not `< ε`) and byte-identical `high`
  stay machine-checked; relaxing either needs an owner ruling.** vitest 1,970 → **2,098/2,098**.
  Refuted: RC12 curvature (0.568 m vs 14.20 m relief), M7 (0 parent wins/47k), RC15 buildings
  (+0.34 m → canopy T58), plus RC28, S10, T34-desktop, RC16's margin bake. RC21 shipped OFF (no
  cheap predicate over 40+ per-frame change sources). BEST SPOT T49/T50/T52 parked. Docs
  `rendering/RENDERING_ARCHITECTURE.md` (RC30) + `RENDERING_CHARTER_2026-08-25.md`. Verbatim:
  archive §Moved 2026-09-06. `mem:project/wip-2026-08-25-rendering-charter{,-groupBC,-groupF}` ·
  `wip-2026-08-26-{rendering-charter-groupE,group-d-rc13-rc17,rc16-rc21}`.
- **REGION #4 Chernobyl / Pripyat — built then deleted (2026-08-26b → 2026-09-02e)** — a 10 km box
  on Pripyat + ChNPP: two building bakes + a GLO-30 L12 patch, live on R2; it produced the
  `roof:height` fix (OSM `height` includes the roof — the reactor arch doubled to 220 m). Owner
  2026-09-02c: no support, **Dnipro is the priority slice in any feature**; 2026-09-02e deleted its
  `regions.ts` entry, configs, geoid grid and 1,785 R2 objects (0 left); only local gitignored
  bakes remain. Verbatim: archive §Moved 2026-09-06. `mem:project/wip-2026-08-26-chernobyl-region`.
- **DBG chip — the debug window (2026-09-01)** — a desktop-only `DBG` chip (off by default, pref
  `debugHud`) opens a floating, filterable window of 151 metrics + 3 actions served by the
  always-compiled seam `lib/globe/debugFeed.ts` (DEV `window.__*` seams do not ship): per-frame
  SERIES rings · PROVIDERS polled at 250 ms/1 s · ACTIONS for scene walks · an
  `EXT_disjoint_timer_query_webgl2` GPU ring (7.3 ms). Owner: BEST SPOT is sufficient (T59); the
  2026-08-27b/c shadow work did NOT close the shadow issue. vitest 2,231/2,231 (148 files) ·
  `verify-debughud` 17/17. Tails T73: imagery-z histogram, geoLabels census, /m-negative leg.
  `DEBUG_HUD_PLAN.md`. Verbatim: archive §Moved 2026-09-06. `mem:project/wip-2026-09-01-dbg-hud`.
- **MESH SUITE MS0–MS3 — gizmos + world-shared building edits (2026-09-01b → 2026-09-02g)** —
  `MESH_SUITE_PLAN.md` (T74): D1 gizmos on buildings · D2 world-shared overrides · D3 user models;
  §4a's no-regression contract is BINDING. Owner: no model quota — a density warning + a
  default-ON custom-models chip; DNIPRO first in every feature. MS0: public GLB URLs never expire
  and PRIVATE 3D is refused; `osm` covers every feature in all five bakes. MS1 §6: the v2 row
  `{sy,sx,sz,rotDeg,tE,tN,tU}` on `ftw:bldg-overrides:v1`. MS2 §7: MOVE / ROTATE / SCALE + the
  byte-identical U8 EXTRUDE on TransformControls fed by the FPV gesture table, so /m gets the
  gizmo free. MS3 §8 activated D2: `BuildingOverrides` (17 fields), OSM-keyed LWW, a boot fetch, a
  tombstone for RESET, sign-in-gated SYNC; 18/18 legs live. Chernobyl deleted (region, bakes,
  1,785 R2 objects; T75 closed). End: vitest 2,312/2,312 (153 files) · the §4a-4 sweep green on
  seven suites. Verbatim: archive §Moved 2026-09-06. `mem:project/wip-2026-09-01-mesh-suite-plan`
  · `wip-2026-09-02-mesh-suite-{ms0-ms1,ms2,ms3}` · `wip-2026-08-26-chernobyl-region`.
- **MESH SUITE MS4–MS8 — user models + the T77 order (2026-09-02h → 2026-09-05)** — MS4 §9:
  glb/gltf/obj/fbx normalized to GLB in the browser, stored as public Wix MODEL3D media. MS5 §10
  stands them on the terrain, ≤ 24 resident; the amber MDL chip carries the density warning. MS5b
  §11.5 re-ruled the rails PER EDIT: move ≤ 100 m, scale 0.1×–10× per drag, under a 5 km sanity
  rail (was 60 m + 0.5×/3×). MS6 §13 opens re-placement to any signed-in member (LWW) and adds MY
  PINS · MODELS; MS7 §14's lift and MS8 §15's tilt ride a height- then tilt-aware floor
  (`UserModels` 29 fields), so a model never fully sinks. T77 standing order: a rendering +
  scene-management audit, prepared by `rendering/{ENGINE_STATE,WEB_RESEARCH_PROMPT}_2026-09-02.md`
  — the three visible defects are architectural. vitest 2,444/2,444 (162 files). MESH SUITE closed
  2026-09-05b (see §Recent); open taste calls PARKED with the track (§11.5/§13.4/§14.4/§15.4).
  Verbatim: archive §Moved 2026-09-06. `mem:project/wip-2026-09-02-mesh-suite-{ms4,ms5,ms5b,ms6}`
  · `wip-2026-09-{02-t77-engine-state-report,03-model-lift-goto-reset,05-model-pitch-roll-ms8}`.
- **T77 MEASURE, the phone baseline, slice 0 (2026-09-05b → 2026-09-06e)** — MESH SUITE closed
  (owner: "this concludes all mesh-related work at the moment"); his web-research result (24 levers)
  merged into `rendering/T77_AUDIT_PLAN_2026-09-05.md` — 23 levers, slices A shadows → B seats → C
  streaming → D mobile → E later, MEASURE first. Instruments only (`verify-perf-baseline`,
  `verify-temporal-stability`, `probe-cpu-profile`), 81 + 12 cells into
  `rendering/MEASUREMENTS_2026-09-05.md`: every `#p=` orbit pose is CPU-bound in the CONTROLS
  (`frame.cpu` 31–47 ms vs 2 ms at the FPV eye; 84 % of the frame in `_getPointBelowCamera`'s
  raycast) · bloom is the largest GPU cost (−13.3 ms at the FPV eye, 25.1 → 11.8) · shadows are
  cheap (0.5 ms depth pass) · 18.5 % of shadow-mask pixels flip per frame · the seat ease STALLS
  8.3 cm short by construction. Owner 2026-09-05c approved a cloud device farm →
  `tools/devicefarm/ios-baseline.mjs` on an iPhone 17 Pro pool (≈78 of 1,000 trial minutes) and a
  Pixel 6 Pro over adb: FPV fine on both, **every orbit pose 9–13 fps on BOTH**, 74–109 ms of main
  thread in the down-raycast; the iOS kill ramp never classified (T83). T79 re-attributed — 15.9 of
  21 ms is the BASE EARTH's 294 k-tri sphere — and fixed by `lib/globe/belowCameraGate.ts`, exact by
  construction, no owner call needed: orbit dt 44.5 → **18.1 ms**, cpu 43.3 → 1.2 (22 → 55 fps),
  Everest 32.2 → 17.9, `/m` 35.8 → 12.1. vitest 2,463/2,463 · charter 85/85 once the pitch sweep
  pinned `&t=` (a real-clock dependency). `rendering/T77_SLICE0_ORBIT_FRAME_2026-09-06.md`.
  Verbatim: archive §Moved 2026-09-07. `mem:project/wip-2026-09-05-t77-{audit-plan,measure}` ·
  `wip-2026-09-06-t77-phone-baseline-slice0`.
- **Docs hygiene + T77 resumed: poses, T80 moot, slices A/B, the sunset fix (2026-09-06f →
  2026-09-06i)** — the owner parked T77 for a hygiene session: round-5 compaction moved
  2026-08-21 → 2026-09-05 byte-identical to the archive (865 lines / 410,237 B) — DECISIONS 466,847
  → 69,668 B, `mem:core` 93,859 → 12,259 B with 29 era rows reaching all 126 wip leaves; the guide
  gained two topics, the only `src/` diff; vitest 2,465/2,465. 09-06h made the owner's REAL views
  permanent — `scripts/lib/poses.mjs` (14 poses, nine his) + `verify-visual-sweep` contact sheets;
  its first sheets exposed T92 (cityscape wedge), T93 (Everest horizon band), T95 and **T94: the
  canvas is not frame-deterministic** (30 % of pixels differ two rAF apart). The sunset was NOT a
  regression (`SUNSET_LIGHTPATH_2026-09-06.md`): the field released at +0.46° with 25 % of direct
  sun left while the ground overlay darkened the whole composite → in-shadow terrain **×5.22**
  brighter; fixed ULTRA-only by `shadowDirectShareK`, a gate at sin −0.833° (upper-limb sunset) +
  a length guard → ×1.16. T80 measured MOOT (bloom already half-res, off on phones; 1.6 of 13 ms) →
  g. Slice A A0–A3 gave a demand-driven rig (ULTRA scrub churn p50 0.000/0.001); slice B killed the
  8.3 cm stall (0.000 m) and 4,277 apply-time collapses → 0. vitest 2,584/2,584. **Owner ruling
  2026-09-06i, all YES:** the BASE rig takes the ULTRA light/shadow model (T96 —
  byte-identical-`high` superseded for light+shadow, ULTRA keeps its COST), T66's authored rises
  through 0° are flattened (ladder luma monotone within 2 codes), and A2's one-texel cadence is
  accepted as the look. Verbatim: archive §Moved 2026-09-07.
  `mem:project/wip-2026-09-06-{docs-hygiene,t77-resume-harness-sunset}`.
- **T77 six worktrees: the crash, the RESOURCE BUDGET, fused bloom, the rulings (2026-09-06j →
  2026-09-06n)** — session j ran the plan literally — six worktrees, each with its own `wix dev`,
  Chrome and agent on a 36 GB M3 — swap passed 120 GB, the machine froze, ≈2 h lost. **THE RESOURCE
  BUDGET (owner order 2026-09-06j, standing, machine-checked):** `verify-chrome.mjs` exits 3 unless
  ONE house Chrome, ONE dev server, ≥20 % free memory; agents launch neither browser nor dev server
  nor the full gates; worktrees are EDIT isolation only. Session k retraced with six edit-only
  agents and integrated all six slices. Browser gates were blocked by an `api.cesium.com` 403 —
  lifted only by the owner's Proton VPN through Finland, a WAF block on the Dnipro ISP, so **T98 is
  a PRECONDITION: check `ipinfo.io/country` + the ion curl before any browser session.** Then: sweep
  14/14 BYTE-IDENTICAL, shimmer p50 0.184 → 0.0000, `frame.cpu` 4.4 → 0.7 ms. 09-06l closed E1/E2
  and shipped T80-h FUSED BLOOM (the full-res parts were the resolve COPY and the BLEND, not the
  chain): fpv dt p50 **19.2 → 14.2 ms**; T104 — the GPU timer over-counts on ANGLE/Metal, so the
  gate reads frame time. Owner 09-06m ("i am ok with all your reccomended options"); 09-06n executed
  all five: T80/T104 closed at dt 14.2 ≤ 15, T101 (arrival rejects +39,629 → +2), T92, T93
  re-classified as far-terrain aerial perspective, fixed (luma 84–89 → 149–153); T100 shipped as
  ruled, gate UNMET (T66 4.94 → 4.23) — the diagnosis was wrong (the ground overlay retiring), back
  to the owner. vitest 2,748/2,748. Verbatim: archive §Moved 2026-09-07.
  `mem:project/wip-2026-09-06-t77-{six-worktrees,five-rulings}` · `wip-2026-09-07-t77-e1-e2-t80h` ·
  `dev_environment`.
- **T77 tail: T100 (a) · the phones with terrain · T83 classified · T107 (2026-09-06o → 2026-09-07b)** —
  owner ruling (a) on T100: the ground OVERLAY's own extinction tail, ladder 19/19, T66 4.23 → 1.48; the
  (b) field band superseded; T105. The iPhone re-measured (orbit/city/everest 9–13 → 50–60 fps at `mid`).
  T83 CLASSIFIED: a jetsam kill at WebContent's 2,048 MB `ActiveHard` cap (four farm syslogs; always the
  SECOND `#f=` load in one process; ~½ GB per FPV page, ~470 MB of GPU memory lingering per destroyed page).
  The Pixel re-measured WITH terrain (the first run read a bare sphere — T98 on the phone lane;
  `verify-perf-baseline --device` now FAILs a terrain-less cell). Lever 10 CLOSED unbuilt (glTF parse 0.7 % /
  1.4 % of the hitch frames). **T107 FIXED** — `controls.getPivotPoint` every frame in `stepMobile2dLocks`
  and `stepTiltGlide`: Pixel `/m` 16 → 60 fps. T106 OPENED (the enriched `load-model` work, 2.26 s + 0.8 s
  in 57 hitch frames). Verbatim: archive §Moved 2026-09-17. `mem:project/wip-2026-09-07-t100a-overlay-tail`
  · `wip-2026-09-07-t77-phones-lever10`.
- **T83 FIXED · the occlusion audit + rulings · T106 two-phase, read on the Pixel (2026-09-07c → 2026-09-07f)** —
  compaction r6. **T83**: `QUALITY.leanMobile.{lruBytesMB 48, enrichedLruBytesMB 128, groundLruBytesMB 112}`
  + `RENDERER.releaseOnPageHide`; farm A/B caps ON alive at 269 s (8.6/84/97 MB), OFF dead before 115 s.
  `audits/audit-occlusion-2026-09-07.md`: **T108** user models occlude in both feeds, **T109** the plan feed
  re-sweeps on `terrainEpoch·builtEpoch·modelsEpoch`. Rulings executed: **T110** the 0.25° profile
  (`PLAN.azBins` 1440, time-budgeted `sweepBudgetMs` 3/1.5), **T112** honesty per BIN (`profileKnown`,
  `sampleBinsKnown`, the coverage floor GONE), **T111** the skyline fold (BEHIND SKYLINE badge, dashed curves,
  `DAYARC.skylineBehindAlpha` 0.35). **T106 re-shaped** on integer keys (`lib/globe/fastEdges`; 527 → 57 ms)
  then **FIXED** as the two-phase handler (`lib/globe/loadQueue`, `ENRICHED.loadBudgetMs` 6/3; worst drain
  30.3 → 8.5 ms desktop, 85.9 → 8.0 twin); read on the Pixel (dt p95 316.7 → 50.0 ms) — the OSM handler had
  sat on three's SLOW path (interleaved b3dm positions; `positionsF32` + its own two-phase queue), the builders
  POOLED (Pixel worst drain 13.5 → 6.7 ms). THE LATE-CHILD TRAP: deferred OSM edges at the identity matrix →
  `updateMatrixWorld(true)` in both handlers + the sweep's draw-count gate. Phone traps: thermal ≤ 1 before a
  timed leg; never `KEYCODE_SLEEP`. Verbatim: archive §Moved 2026-09-17.
  `mem:project/wip-2026-09-07-{t83-pagehide-occlusion-audit,occlusion-rulings-t106,t106-two-phase,t106-pixel-read}`.
- **The two mobile features · lever 11 + T115 · the app version · T118/T119 (2026-09-07g → 2026-09-08)** —
  owner order 09-07g: mobile first. **BEST SPOT on `/m`** (the ◎ SPOT tab, `mobile/BestSpotSheet.tsx`, no
  ULTRA; the farm iPhone: finest rung 6 s, 60 fps with the sheet up) and **AR LOOK-AROUND** in mobile FPV
  (`lib/sensors/*` — the orientation ladder, WMM2025 in-house; the device tier = the owner's iPhone, T117).
  **T116** the tree seats re-landed every frame (a Float32Array vs float64 loop). Owner verdict 09-07i on the
  Pixel: both features good. **Lever 11**: the vector-tile parse off the main thread on a flat typed-array WIRE
  (`lib/geo/vtileWire.ts`; a structuredClone cost as much as the parse); hitch-frame vector tiles 169 → 0.8 ms.
  **T115** `locateTrees` resumable in chunks of 256. T114 closed, T102 isolated (`/json/new`), T103 fixed.
  The Pixel reads of lever 11 + T115 HOLD. **The app version** (`package.json` 1.36.1 → `src/lib/version.ts`,
  the ship hook bumps the patch per ship). **T119** the DBG window's grips. **T118** the readiness hold
  (`sceneStreamPending`, `BESTSPOT.holdMaxMs`, the ONE status chip). Verbatim: archive §Moved 2026-09-17.
  `mem:project/wip-2026-09-07-{mobile-bestspot-ar,lever11-vtile-worker}` · `wip-2026-09-08-pixel-reads-version-t118`.
- **The mobile UX batch · the owner calls · three regressions + lever 8 · T126/T129/T130 (2026-09-08b → 2026-09-09b)** —
  **09-08b**: 🧭 AR as the first 44 px cell with a transient bubble, 💾 SAVE as a cell, LIVE tabs + long press,
  BEST SPOT hygiene (`liftDebounceMs` 220, `workerIdleDisposeMs`), the shared `controls/RateEncoder`, **T120 the
  two-finger TWIST** (`lib/globe/twistTracker.ts`; the library has no twist), T122. **09-08c** the owner calls in
  one batch (lever 8 BUILD, `holdMaxMs` 30 s, the 2D drag-rotation RETIRE, T113 parked). **09-08d**: **T125** the
  edited-building tint was a diffuse term invisible at night → a per-channel FLOOR (`ENRICHED.overrideTintGlow`);
  **T127** a stray `/m` tap kept clearing the pin; **T128** per-axis user-mesh scale (`scaleX`/`scaleZ` columns
  provisioned live); the Pixel reads of the batch PASSED (105/105; CDP touch is a MIRAGE on Android Chrome —
  `adb shell input` is the only real touch); **lever 8** the terrain BVH (`lib/globe/terrainBvh.ts`, hit-list
  identical to three; descent controls 800 → 246 ms). **09-09**: the lever-8 Pixel read (controls in the hitches
  480 → 141 ms); **T126** UNDO + DROP SESSION (`lib/edit/editJournal.ts`, one entry per commit, both shells,
  Ctrl/Cmd+Z); **T129** the 2D two-finger PAN (`MOBILE2D.twoFingerPan`); **T130** the device campaign: **T123 =
  growth by cache RESIDENCY to the 2 GB ceiling** (a detached TilesRenderer never evicts), T124 not reproduced.
  Ruling 09-09b: build lever (a). Verbatim: archive §Moved 2026-09-17.
  `mem:project/wip-2026-09-08-{mobile-uxbatch-heatmap-gestures,regressions-pixel-lever8}` ·
  `wip-2026-09-09-t126-t129-t130-lever8-pixel`.
- **T123 fixed · THE RELEASE GATE LIFTED · the rendering interlude · the cache ruling (2026-09-10 → 2026-09-10f)** —
  **T123**: lever (a) `lib/globe/detachedRelease.ts` (the `/m` 2D drop drains the detached enriched + OSM caches
  once per detach) + lever (d) `lib/globe/compositeCanvasRelease.ts` (the overlay's composite `<canvas>` loses
  its store at the library's dispose, ~450 born per stress cycle); the memory-infra dump named the plateau
  (`cc/image_memory` at Chrome's 500 MB cap, canvas stores 100–127 MB; RSS +35 MB/cycle) and VOIDED lever (b);
  farm `alive 8 cycles, flat`; T124 resident. **09-10b**: `www.plux.today` LIVE (owner: the host works);
  **09-10c**: the release is ONE command `npm run release:full -- -c "…"` (`scripts/release.sh`) and the house
  Chrome must be CLOSED after the last suite, never the owner's `:9222`; **09-10d** shipped + released.
  **09-10e THE RENDERING INTERLUDE**: **T131** the moon drew in front of Fuji → both sky vertex shaders pin depth
  to the far plane (`z = w`); **T132** the horizon white band → `uDome` depth-pin + a far-plane fog in `ftwAerial`
  (`uFtwFarM`, `ULTRA.farFogStartFrac/EndFrac`); **T133** moonlight milky → `nightFloorSkyMin` 0.15, `moonFillK`
  0.05, `moonSheenK` 0.45, twin `moonlightTerrain.test.ts`; **T134** the tile-stream stalls, four mechanisms
  (`lib/globe/overlayFetchPriority.ts`, `fullCacheKickMs`, `LOADING.groundDesktopCaps` 32/12,
  `lib/globe/virtualSplitGuard.ts`, `revealMaxHoldMs`); T135 parked. **09-10f** the ground caches settled: ULTRA
  1400 MB, regular desktop 600 MB (`QUALITY.desktopGroundLruBytesMB`), phones untouched. Gates: vitest 3,061 →
  3,093 · astro 0/0/12 · knip 0. Verbatim: archive §Moved 2026-09-17.
  `mem:project/wip-2026-09-10-{t123-lever-a-detached-release,interlude-render-quirks}`.

---

## Recent sessions (verbatim, newest first)

New work appends a dated line here — immediately below this note, above every dated entry.

- **2026-09-20 · RELEASED — the 2026-09-19 batch is LIVE as v1.36.17** (owner: "deploy and release everything, and actualize guide, architecture and other relevant docs, I will test on real devices"). **Docs first:** `ARCHITECTURE.md` — §6 "the write wire" (no form POST + `jsonWriteInit`), the `controls/useLongPress` and `ArCameraOverlay` bullets, the sticky-overlay paragraph ("RAISING it is the same rebuild"; T146), the §7d addendum (lift 300 · primitives · delete) and a NEW **§7f — AR on `/m`** (the gyro-led ladder, the camera view, the calibration record); `MOBILE_PLAN.md` + `MESH_SUITE_PLAN.md` + `IMPLEMENTATION_PLAN.md` dated addenda / rows; `conventions/globe-tuning.md` §"The 2026-09-19 families" (the trim, `arCam*`, the lift rails, the /m overlay rule); README (the mobile bullet, the models bullet, platform edge #7 — the body-less write, the gate numbers); the GUIDE — `mobile-ar-camera` (NEW), `mobile-ar` (hold to calibrate, "the gyro carries the turns"), the mobile chips + gestures lists (CAM, hold AR), the box step, lift 300. Guide lint learned: steps ONE sentence, bodies ≤ 5, tips one; a new body's WORDS move the curated search ranking ("compass" broke the `comp` golden → reworded). **Ship:** the hook in the foreground → `claude/ship-20260920-012356` squash-landed as **`f4ab36c`** (PR #130) after 60 s, tree-proven, mirror synced, `package.json` 1.36.16 → 1.36.17, no SHIP_ATTENTION. **`release:full`** (247-char comment): gates green → `wix build` → `wix release` → canary **GET 200 · POST 200** → warm **169 assets, 0 failed, 0 cold** → step 7 `verify-prod-globe` ABORTED with `TypeError: fetch failed` at its own line 23 — NOT the site: the script spawns Chrome and slept a FIXED 2.5 s before attaching; after a build + a 169-asset warm the machine was busy and Chrome was not listening yet (and the crash ORPHANED that Chrome on :9333 — a temp `ftw-cdp-*` profile under `$TMPDIR`, which `close-verify-chrome.mjs` does not match; ended by hand). FIXED: the attach POLLS the CDP port (≤ 20 s) and kills its spawn before throwing. Re-run by hand: **canvas 1728×993 gl=true** (`verify-shots/release-20260920-live.jpeg`), the only console lines the library's tiles-1.1 notice ×2 and the anonymous 403/401 pair — the same as every release since 2026-09-17c. **THE LIVE PROOF OF THE DELETE FIX — NEW `scripts/verify-live-deletes.mjs`, ALL PASS (16):** as the test member (the `wixSession` cookie, the verify-places-member recipe) a BARE `DELETE` is still refused `403 Cross-site DELETE form submissions are forbidden` on all four routes (the cause — the middleware is unchanged by design) while `DELETE` + `Content-Type: application/json` REACHES the route on `/api/models`, `/api/photos`, `/api/listings`, `/api/places` (404 "no such … of yours"); then a throw-away saved place is created and deleted with the REAL MY PINS · PLACES ✕ → SURE? in a browser on `www.plux.today` — the DEPLOYED client's DELETE carried `content-type: application/json`, no body, **HTTP 200**, the row left the list with no error note, and the API no longer lists it (nothing left behind; a title-prefix sweep in `finally` guards a run that loses its id — run 1 misread the POST answer's `{ placeId }` shape, so its "gone" check was vacuous; fixed before the verdict). **Live UI smoke (DOM signals — prod has no DEV seams), ALL PASS (7):** `/m` shows **v1.36.17**; AR off → no CAM; AR on → CAM appears; CAM lays a synthetic 720×1280 stream out at 418 × 743.1 px (aspect-true) with "CAMERA ≈ 30 mm · NOT CALIBRATED — HOLD AR"; a long press on AR opens the pad with CONFIRM / RESET / CANCEL; desktop UPLOAD offers ▣ ADD A BOX and it walks the real pipeline in production (12 triangles · 5.00 × 5.00 m · 5.00 m tall · a thumbnail). House Chrome closed, no dev server. **What only the owner's phones can say (T147):** the real camera's FOV against the 62° default, the roll's sign, iOS's one-press motion grant + camera, `CLHeading` past vertical, the trim under a real swing, `aim.fused` on Chrome Android.
- **2026-09-19 · AR CALIBRATION + CAMERA VIEW + THE GYRO-LED LADDER · THE 5 m BOX · THREE MESH BUGS (two were root causes)** (owner: "intermediate session with serious feature request and couple of potential bug fixes"; `/frame` under investigate-design-v3, implement · Deep; four parallel research agents, every claim cited; leaf `mem:project/wip-2026-09-19-ar-calibration-box-meshbugs`). **(1a) SENSORS — "the image drifts each time you move the phone from side to side".** Research verdict (Chromium + WebKit source, W3C spec, AOSP sensor docs, LaValle/Oculus, Madgwick): until today the iOS rung tracked the compass with a **0.8 s EMA** (compass-led in all but name) and the Android rung took `deviceorientationabsolute` (`TYPE_ROTATION_VECTOR`, magnetometer-fused) as it came — every compass lag / steel railing reached the view. NEW `lib/sensors/yawTrim.ts` (pure): the RELATIVE, gyro-led attitude DRIVES (iOS `xArbitraryZVertical`; Android `deviceorientation` = `TYPE_GAME_ROTATION_VECTOR`, "must not use the magnetometer") and the absolute source only OBSERVES the one yaw offset between the two gravity-aligned frames — first fix exact → 1.5 s fast refine (τ 800) → slow trim τ **8 s**, capped **1.5°/s**; FROZEN above 30°/s and for 400 ms after (the compass lags a turn), FROZEN while the window's spread > 4° or its median slides > 2°/s (the quasi-static-field test: `compass − gyro` moving with the phone still = the FIELD moved); an innovation > 20° must persist 3 s and is slewed 6°/s down to 2° (hysteresis); a sensor gap > 1 s re-acquires exactly (Core Motion re-seeds its frame when the page sleeps). `orientationLadder.ts` rebuilt around it, public API unchanged (+ `setUserBias` / `commitCalibration` / `trimDebug`; `ArAim.fused` / `.trim`): rung 1 is gyro-led whenever Chromium's relative stream pairs within 50 ms, DIRECT exactly as before without one (Firefox, no game-RV); iOS compass also gated on `screenUp ≥ 0.2` (tipped back past vertical "top-edge heading" and "camera heading" are 180° apart and it is UNVERIFIED which Core Location reports — below vertical they are the same number; `FPV.arCompassMinScreenUp` −1 disables). `FPV.arCompassOffsetTauMs` 800 → 8000 (+ `arTrimMaxRateDegPerS` 1.5, `arTrimFreezeRateDegPerS` 30). **Measured:** unit SWING (±60°, 2.4 s/cycle, peak 157°/s, compass lagging 400 ms): direct rung worst **> 15°**, gyro-led **< 1°**, back within 0.5° of the start; browser twin: direct **42.0°** vs gyro-led **0.00°**; a 12°-bent compass for 1 s moves the view ≤ 1.5° (was ~8.6°). **(1b) VISUAL CALIBRATION (long press on AR) + CAM (the chip above AR, only while AR is on).** `mobile/ArCameraOverlay.tsx`: the rear camera (`getUserMedia` 720p/30 ideals — memory beside WebGL on iOS; Android re-acquires `camera2 0, facing back` by deviceId, iOS labels are localized and never matched — `lib/sensors/arCamera.ts`) in a `<video playsinline muted autoplay>` at z 1 ABOVE the opaque canvas with a CSS opacity (the 3D ↔ CAM slider, default 0.55): the whole 3D frame reads THROUGH the feed — the renderer stays opaque (`alpha`, `.setClearColor` fenced; holes in the screen-door dissolve would show the GL sky, not the video). **"The same focal number" is one equation** (`arCalibration.videoLayout`): two pinhole pictures agree at EVERY pixel iff they share a focal length in pixels, so the video is drawn `2·f·tan(camLong/2)` long with `f = (H/2)/tan(vFov/2)` and follows a pinch per frame; it is counter-rotated by the phone's smoothed roll (the FPV camera has no roll seam — 2026-09-07h). A page cannot read a camera's FOV (`MediaTrackSettings` has no focal length) → default long-side 62° [ASSUMPTION: 26 mm-eq main camera ≈ 67° less a ~10 % video crop], and the calibration PINCH is how the real one is learned. Per-frame values ride `lib/sensors/arFrame.ts` (a plain mutable record the orchestrator writes in `stepArLook` — the `skyTrackAim` posture, never a 60 fps store write). Calibration = a full-screen pad at z 5 (under the FPV instruments at z 10): DRAG = yaw/pitch, grab-the-world, one pixel of drag = one pixel of scene (`atan(dx/f)/cos pitch`); TWIST = roll; PINCH = camera FOV; ✓ CONFIRM / ↺ RESET / ✕ CANCEL; a centre cross ("a far landmark on the cross" — a wrong FOV cannot leak into Δyaw at the centre). **The stored YAW is a measured COMPASS BIAS and lives INSIDE the trim** (target = observation + bias): it never touches the relative rungs (there CONFIRM folds the drag into the ALIGN and answers null = keep the stored yaw), `setBias` moves the offset at once (RESET), and CONFIRM sets `bias = offset − median(observations)` — NOT `bias + drag` — so a trim that had not converged cannot pull the calibrated view afterwards; a calibration confirmed this session slows the trim again (τ 40 s, 0.3°/s). The engine answers the bias through a pushed `calibrated` writer (scene modules never import stores); the seed and ⌖ ALIGN subtract the live drag from the camera heading they are given. Persisted as `ftw:ar-calib:v1` (a SEPARATE key: `mobileArLook.test` pins that `prefs.ts` never names AR); the AR chip carries `data-cal`. Long press = NEW `controls/useLongPress.ts` (T145's hook, the TargetPeek shape; `onLongPress(source)` may DECLINE the timer's call — with AR off the sensors need a user activation, so the RELEASE takes it through the ONE `requestPermission()` call site; a finger's verdict is `touchend`'s). Column: `--m-altcol-h` 148 → 200 px while `.m-cambtn` exists (`:has()`). **A screenshot caught what no DOM check could:** the first panel seat ran under the mini-map — re-seated left of it, asserted on RENDERED geometry. **(2) ▣ ADD A BOX — 5 × 5 × 5 m** (`lib/models/primitives.ts`, a `PRIMITIVES` registry; `store/modelUpload.beginPrimitive`): a pure 1.5 KB GLB writer (24 vertices with true face normals + one matte material — no `NORMAL` = flat-by-derivative, no material = glTF's metallic 1 = near-black) handed as a synthetic `File` to the SAME `begin()` an upload walks — audit, re-export, thumbnail, Media PUT, `UserModels` row, MY MODELS, placement, gizmo, lift, delete are the uploaded model's path byte for byte; `sourceFormat` stays `glb`; no server / scene / schema change. The button sits OUTSIDE the dropzone (its click opens the file picker). **(3a) LIFT 25 / 50 m → 300 m** (`LIFT_MAX_M`, `MODEL_LIFT_MAX_M`; the server clamps read the same constants; `growBoundsFor` already pads by the lift). **(3b) "COULDN'T DELETE SOME USER MODEL" — ROOT CAUSE, LIVE-PROVEN:** the sign-out bug's sibling. A body-less `fetch(url, { method: "DELETE" })` sends NO content type; `checkOrigin` passes a non-safe method only with a non-form content type OR a matching origin, and the live adapter's `http:` URL never matches → **403 before the route ran** (live probe: bare DELETE → 403, + `Content-Type: application/json` → the route answers). **Model, photo, listing AND saved-place deletes had never worked in production**; dev never runs the check, so `verify-usermodels` leg 17 passed. Fix: `lib/api/dataFetch.jsonWriteInit` (the header ALWAYS) under `requestJson` + the places delete; fence `test/lib/api/jsonWrites.test.ts` (a source scan — it caught my own doc comment quoting the bad pattern). Amplifiers fixed on the same path: a failed action REPLACED the whole list with a sticky "COULD NOT LOAD" (every control that clears it lives in the list) → a note ABOVE the list; DELETE is idempotent (404 = already gone = success); `loadMine` honours the tombstone inside the read-lag grace (reopening the panel resurrected the row); the orchestrator releases the arm when its model leaves the world. **(3c) "ALL GROUND TILES RESET TO WHITE after … exit FPV" — REPRODUCED AND FIXED on /m; NOT reproduced on a `high` desktop.** `scripts/probe-white-ground.mjs` on the lean /m twin: at the FPV exit **57/57 tiles (100 %) lost their imagery at +184 ms, `overlayRebuilds` 0 → 1, healed +4.2 s** (a phone's network: far longer). Not the mesh flow — the FIRST FPV exit of a `mid`/`low` session: `stickyOverlayPx` ratchets 256 → 512 on the first flat-chart frame and `setOverlayResolution` is a fresh-instance rebuild that destroys every composite on screen (the QA-7b "white chart", accepted in 2026-08 as "≤ 1 per rung per session"; the owner meets it after the mesh flow because that is when he is in FPV for minutes and then leaves). Fix: on the MOBILE SHELL the raise is certain, so the orchestrator passes `flatGround || isMobileShell` — the session's one rebuild lands on FRAME 1 (empty cache, nothing on screen); re-measured **0/22 white, rebuilds 1 → 1**. Refuted by code + runtime: model dispose reach, shared renderer state, the edit highlight, the thumbnail's second GL context, a missing context-restore path (ctxLost 0), `compositeCanvasRelease` (dispose-only). OPEN (T146): a desktop that BOOTS `mid` and is promoted during a long FPV edit gets the same rebuild on FPV exit by RC18's own design — PLAUSIBLE for the owner's desktop sightings, not proven (the twin boots `high`: 0/308 → 0/393, rebuilds 0 → 0); the real cure is a seamless handover (keep the outgoing overlay under the new one until its composites land), a rendering slice with sweeps. **Verification.** vitest **3,239 / 218 files** (was 3,153 / 212: +86 tests, +6 files) · astro **0/0/12** · knip **0** · browser (dev, house Chrome): `verify-ar-look` **39/39** (the 2026-09-07 flow intact on the new ladder) · NEW `verify-ar-calibration` **52/52** (fused rung, the swing, CAM + the shared-focal layout through the component's real `getUserMedia` path with a synthetic stream, long press → pad → CONFIRM persists + HOLDS → reload → CANCEL → RESET, rendered geometry, every track stopped) · `verify-mobile-batch-2026-09-08` **127/127** (its "the bubble never grows the column" check now reads the published token: 200 px with AR on) · `verify-modelupload` PASS (+ leg 1b the box: 12 tris · 5 × 5 × 5 m · metres · "BOX 5 m" · thumbnail) · `verify-usermodels` 21 legs PASS (+ the ground watch) · `verify-meshedit` PASS (lift 300; its legacy-`{k}` leg flaked once on a third-reload streaming race, passed on re-run) · the A/B sweep (HEAD stashed = `pre-2026-09-19`): draw-count gate 3/3, pixel diffs the boot-to-boot band (desktop is a no-op by construction; /m = texel speckle, max Δ 44), no golden promoted. **DEVICE TIER — the owner's phones, UNVERIFIED here (T147):** the real camera's FOV and crop, the roll's sign on hardware, Safari's `getUserMedia` + the motion grant from one long press, `CLHeading` past vertical, and what real sensors do under a real swing; dev on a phone needs HTTPS (the tunnel) — a LAN `http:` page gets "THE CAMERA NEEDS HTTPS". **Owner question (T148, not blocking):** "both desktop and mobile" for the box — `/m` has NO upload dialog by the 2026-08-11 ruling (MOBILE_PLAN "permanently out"); the button ships in the one UPLOAD dialog (which is also what the desktop shell on a phone shows). NOT released — the owner did not ask for a deploy.
- **2026-09-18b · RELEASED — the three /m fixes + the sign-out fix are LIVE as v1.36.14** (owner: "deploy everything after you fix and test"). Ship hook in the foreground → `claude/ship-20260918-030209` squash-landed as **`b3270cd`** (PR #127) after ~60 s, tree-proven, mirror synced, `package.json` 1.36.13 → 1.36.14. `release:full` (248-char comment) run 1 succeeded: gates green → `wix release` "Site published on plux.today" · canary **GET 200 · POST 200** · warm **168 assets, 0 failed, 0 cold** · `verify-prod-globe` canvas 1728×993 gl=true (`verify-shots/release-20260918-031035.jpeg`; the only console lines are the library's tiles-1.1 notice ×2 and the anonymous 403/401 pair — same as 2026-09-17c). **Live twin of the harness** (`FTW_APP_URL=https://www.plux.today scripts/verify-mobile-fixes-2026-09-18.mjs`, member cookie minted + seeded through CDP `Network.setCookie`; every wait a DOM signal because the `window.__*` seams are DEV-ONLY): **ALL PASS, 39 checks** — the bare `/m` boots at `18000 KM` on the 2D map · the anonymous and member FPV rails (no overlaps, seat `calc(16.4rem + 52px)`) · the /m menu SIGN OUT lands back on `https://www.plux.today/m#p=…` with VISITOR tokens and SIGN IN offered, no "Cross-site" page · the desktop badge the same (run 1 of the live twin lost the desktop leg to a floating nav tip + the expanded search bar under the pointer — the harness now names the element under the click and falls back to a DOM click loudly; run 2 hit the badge itself). Verification tier: **wix-VERIFIED (live)**. Records ride the SessionEnd ship (or the foreground one).

- **2026-09-18 · THREE /m FIXES + THE SIGN-OUT ROOT CAUSE** (owner: "very small session with specific mobile fixes … deploy everything after you fix and test"). **(1) The whole-planet boot:** `MOBILE2D.bootAltM` 1,100,000 → **18,000,000** — the bare `/m` 2D boot only (`#p=`/`#f=` hashes bring their own altitude; the desktop `POSE.cam` is untouched); above `GATES.groundActiveAlt`, so nothing streams until the first pinch in; the nav chip reads `18000 KM`. **(2) The FPV rail:** a member's ▤ SAVED PLACES was a text pill rendered BELOW ✕ EXIT VIEW, one pill taller than the altitude column's fixed seat (`--m-altcol-bottom` 16.4rem) allowed, so ⤓ covered ◎ SAVE. `SceneActions` now renders it in FPV as a 44 px icon cell (`m-act--icon m-act--places`) BETWEEN ◎ SAVE and ✕ EXIT VIEW — EXIT VIEW is the LAST cell, always; fpv.css publishes `--m-altcol-bottom-base` and lifts the seat by one cell + gap (52 px) through `body.m:has(.m-actions .m-act--places)`; outside FPV the pill above MY LOC is unchanged (gate `!tempFpv`). **(3) SIGN OUT ("Cross-site POST form submissions are forbidden"):** both shells posted a real `<form>` to the managed `POST /api/auth/logout`. ROOT CAUSE, machine-checked against production: under `@wix/cloud-provider-fetch-adapter` Astro's request URL carries the internal **`http:`** scheme, so `url.origin` is `http://www.plux.today` and a browser's `Origin: https://www.plux.today` never equals it — `checkOrigin` (2026-08-18) refuses EVERY real form POST live (probe: form POST with `Origin: http://…` → 200, `https://…` → 403, JSON → 200) while dev, which never runs the check, looked fine; the 2026-08-18 line's "GET-only auth routes" assumption was wrong for logout. FIX: `store/member.ts signOut()` → NEW `POST /api/signout` (JSON; `auth.getContextualAuth<IOAuthStrategy>().logout()` from `@wix/essentials`, the callback built on the browser's own Origin when its host is ours, a RELATIVE returnTo only, 502 on failure) → `window.location.assign(logoutUrl)` — the same-origin chain `/_api/iam/authentication/v1/logout` → `/api/auth/logout-callback` (member cookie → visitor tokens) → returnTo runs in the browser exactly as the form's redirect did. MobileAccount + MemberBadge are buttons with busy / retry states; `.m-menu__form` + `.mb-form` gone; RULE (CLAUDE.md gotcha + `wix-headless.md` §12b + §Traps): no form POST anywhere in this app. Tests: `test/components/mobileFpvRail.test.ts` (rail order · icon cell · the CSS lift · the 18,000 km pin) · `test/components/signOut.test.ts` (the no-form fence · signOut() client half · the route's origin/returnTo hygiene). Browser: `scripts/verify-mobile-fixes-2026-09-18.mjs` **ALL PASS** on the house Chrome, 5 legs — whole-planet boot (mirror 18000 km, chip `18000 KM`, 2D nadir) · anonymous rail (2 cells, seat 16.4rem, gap 4 px) · member rail (◎ SAVE · ▤ PLACES 44×44 · ✕ EXIT VIEW lowest, five cells one x, EXIT's right edge on the column's, NO rect overlaps, seat `calc(16.4rem + 52px)`, ▤ PLACES opens the sheet) · /m menu SIGN OUT → back on `/m#p=…` ANONYMOUS with a VISITOR cookie, SIGN IN offered · desktop badge Sign out → the same. One transient in four runs: the menu row's `refresh()` read a REJECTED `getCurrentMember` on a valid member cookie and the store flipped to anonymous (pre-existing `store/member` behaviour) — the harness re-resolves once, loudly. Gates: vitest **3,153 / 212** · astro **0/0/12** · knip **0**. The pixel sweep NOT run by reasoning: the only `globe/**` change is the bare-`/m`-boot altitude, which no catalogue pose reaches (every pose carries a hash); the desktop is byte-identical by construction. Also riding this ship: the 2026-09-17c release records + the `release.sh` 250-char guard the SessionEnd hook could not land (its vitest gate tripped on the flaky `bestSpotResidency` timing test). Verification tier: local-tested + browser-verified against `wix dev`; the live sign-out is wix-VERIFIED by the release line that follows.

- **2026-09-17c · SHIPPED + RELEASED — the audit #4 fix session + the re-shot guide figures are LIVE as v1.36.13**
  (owner: "deploy everything and wrap the session"). The ship hook run in the foreground (`FTW_SHIP_DAEMON=1`):
  gates green → `claude/ship-20260917-010649` → squash-landed on origin/master as **`bd17d1e`** (PR #126) after 60 s,
  tree-proven, branch deleted, `private` mirror synced, `package.json` 1.36.12 → 1.36.13. Then
  `npm run release:full`: run 1 FAILED at the vitest gate on the timing-measured `bestSpotResidency` "full solve
  < 1,000 ms" (1,044 ms under load; 8/8 alone — the known flaky class, re-run before believing); runs 2 and 3 FAILED at
  `wix release` AFTER a four-minute build each: **the CLI limits the release comment to 250 characters** (256 and 252
  chars sent) → `scripts/release.sh` now refuses an over-long comment at step 1, before the build. Run 4 (238 chars):
  `wix release` "Site published on plux.today" · canary **GET 200 · POST 200** · warm **168 assets, 0 failed, 0 cold** ·
  `verify-prod-globe` canvas 1728×993 gl=true, `verify-shots/release-20260917-013036.jpeg` (the welcome globe; the
  credit line reads v1.36.13); the only console lines are the library's tiles-1.1 notice ×2 and the anonymous
  403/401 (`members/my`, `/api/places`) — the same two as 2026-09-16b. Live checks: `/` `/m` `/guide` 200,
  `/guide/shell-m.webp` served at its new 45,430 B. Verification tier: wix-VERIFIED (live).

- **2026-09-17b · THE GUIDE FIGURES RE-SHOT** (owner: "update guide screenshots, then deploy everything"). Six of the
  thirteen figures are recipe-driven (`scripts/shoot-guide.mjs`, two passes each, the second kept) and were re-shot
  on the house Chrome against `wix dev`: `shell-m` (NEW recipe — the shipped 2026-08-20 shot predated the PLUX logo
  menu, the strip's scale bar and the target row's rise/set), `fpv-m` (the HUD readout on the strip's right, AR + the
  pads + SAVE on the right rail), `fpv-map` (the scale bar under the MAP/± pills), `orbit`, `fpv`, `target` (the
  recipe now sets the MOON explicitly — the store restores the last-tracked id from the profile's prefs, so a shot on a
  used profile inherited the sun while the caption named the moon). Four captions rewritten to what the frames show
  (`fpv`'s "the moon's day arc" was the sun's in the old shot too). The seven 2026-08-15 panel crops (welcome, time,
  skymenu, plan, find, sunsets, upload) have no recipe and are unchanged. Gates after: guide tests 99/99 ·
  `verify-guide` ALL PASS (13 figures linked) · astro 0/0/12 · vitest 3,138/210. Verification tier: browser-VERIFIED.

- **2026-09-17 · AUDIT #4 TRIAGED + FIXED under the owner's filter** (`/frame` under investigate-design-v3, implement,
  Deep; owner 2026-09-16: "fix only real issues that affect performance, stability or risk to app behaviour and
  codebase/docs maintenance … G1 G2 G3 not relevant … public exposure, load and multiple users not relevant [the app is
  a free beta among trusted people] … must not introduce any regression"). **Triage at HEAD:** 6 MAJOR → 2 fixed
  (T136, T137), 3 DEFERRED by the filter (G1/G2/G3 → T138/T139 rows dated), 1 partly (T142's visible half); 37 MINOR →
  19 fixed, 4 deferred by the filter (B2, B5, F3, F6), 4 deferred as owner taste / invisible (H5-4 stars, J2, J3, A1's
  order probe), 1 NOT REPRODUCED (I1-5: the overlayFetchPriority header's lock order matches `ImageOverlayPlugin.js`
  :220/:389-390/:1033), 1 left as trivia (D8); 13 NIT → 9 fixed, 4 skipped (C5 sinDeg, G6, I2-2 moot under the pin,
  L5 owner call); L1–L7 → L1 re-pinned, L2 already promoted, L3/L6/L7 fixed. **One audit anchor never existed:**
  `mobile/ModelEditChip.tsx` (F2) — `ModelEditChip` mounts on `index.astro` only (an open browser check, NSP).
  **Code (all local-tested + browser-verified):** T136 `package.json` `3d-tiles-renderer` **"0.4.28"** exact +
  `test/lib/globe/libraryPin.test.ts` (declared/locked/installed) + `scene/imageryGround.ts` `console.warn`s an
  un-installed `overlayFetchPriority` / `virtualSplitGuard` · T137 `skyBudget.test.ts` models the base-rig LOOK
  (`uFtwUltraK` 0.225 by day, `domeDirK` 0.9, `ftwAirSun`/`ftwAirLevel` ported from `lib/globe/duskLight.ts`):
  shipped worst case **0.8975** vs 0.9 (the audit's 0.8964 does not reproduce; margin pinned; +0.05 on `domeDirK`
  reads 0.89758 — the knob cannot cross alone; the real bloom gate thresholds on luminance ~0.67) · T142 (half)
  `scene/skyGhosts.ts` + `scene/skyTarget.ts` pin `gl_Position.z = gl_Position.w` (fence; the Fuji-moon pose re-shot
  with ghosts on — `verify-shots/audit4-fix/p1-fuji-moon-ghosts.jpeg`: the reticle and every ghost below the ridge
  clipped, the disc over its ghosts by renderOrder) · H3-1 `store/userModels.remove` → `forgetTarget` +
  `refreshEditJournalMirror` (test) · H2-2 `scene/userModels.ts` retries a failed GLB (`MODELS.loadRetryMs` 20 000 ×
  `loadRetries` 3; `failed` reads "currently failed") · H2-3 `lib/globe/bldgSync.reconcileShared` stamps `s:
  Math.max(nowMs, t)` (a client behind the server read its own synced copy as DIRTY; test) · H2-1
  `applyCellOverrides` pass 2 claims by OSM id too (the in-loop re-key made the row hop to the last duplicate run) ·
  H4-1 `scene/streetNames.releaseTexture` → `releaseCompositeCanvas` (the label canvases) · I1-3
  `releaseCompositeCanvas` also zeroes the RC25 `mipmaps` chain (test) · H4-3 `ENRICHED.seatCacheMaxCells` 320 — the RC9
  `seatCache` is LRU by cell (delete+set on bank and warm hit) · G4/T30 `api/photos` GET `.limit(PIN_QUOTA_PREMIUM)`
  (Wix Data's max 1000 = every pin a member can own; dev.wix.com) · F5 `lib/api/dataFetch.ts` — `AbortSignal.timeout`
  20 s on the five list fetches (MY PINS ×3, marketplace, /m places) + "timed out — check the connection" (test) · F4
  `mobile/MobileAccount.tsx` menu mode renders a SIGN OUT row (the desktop badge's logout form; `.m-menu__form
  {display:contents}`) · L3 `UploadFlow` REVIEW names the missing placement fields ("The heading, the pitch and the
  altitude are not in the file — set them on the globe …") · B1 `session-end-ship.sh` push failure → `attention(…)`
  · B3 `release.sh` POST canary loops 12 × 10 s · B4 `regions.test.ts` reads `scripts/bake/cities/*.json` (resolving
  `extends`) and pins bbox + the terrain block · B6/B7/L7 the provision header, `.env.development`/`.env.production`
  gitignored, the sweep's usage header · C2/C4/H1-2/C3 comments corrected (the TDZ note now says the seam is
  `applyQualityTier` + `sampleEphemeris` ~2,400 lines ABOVE the cascade/dusk state, which is frame-loop-only) ·
  H1-1/H4-2/H5-2 source fences (`fences.test.ts`: lever 8 and lever (d) install ONLY behind their switches; the T133
  `uFtwPhoto3d * (1.0 - night)` gate asserted). **H5-1 correction (append-only):** the 2026-09-10e line's "downloaded
  tiles 2e12 + error" describes the REJECTED first cut; the shipped `overlayFetchPriority` bands are SLOT 3e12 ·
  PARSED 2e12 · PRELOAD −1e12 · GONE −1e15, FIFO within a band, no error term. **Docs:** DECISIONS compaction round 7
  (2026-09-06o → 2026-09-10f moved byte-identical, md5 `bb447cf172bb7dd1d2d7da2e89a644f7`, 45 lines / 133,576 B; 5
  era digests; §Recent 144.9 → 60 KB) · `conventions/globe-tuning.md` gained the 2026-09-07 → 09-10 families + this
  session's two knobs · `conventions/contracts.md` re-diffed (30 top-level seams — `global.d.ts` declares 30, the
  audit's 33 counted comment mentions; the UserModels `scaleX`/`scaleZ` columns; the `__globe` sub-seams since
  2026-09-06) · IMPLEMENTATION_PLAN's T77 row re-dated (D5) · README 3,138/210 (D6) · `mem:core` rewritten ≤ 12 KB (D1;
  it had regrown to 48.9 KB) · NSP rewritten and decluttered (D4) · D8's 3,093-vs-3,094 left as trivia · backlog
  T17/T26/T30/T118/T136–T144 dated. **The GUIDE (T140 + owner ask):** `guideContent.ts` **12 chapters · 89 topics ·
  16 goals** — `mobile-map`/`mobile-gestures` (twist turns, drag slides, pinch follows the fingers), `start-shells`
  (BEST SPOT no longer "left out"; DESKTOP in the PLUX menu), the `bestspot` chapter on both shells (◎ SPOT tab, the
  rate encoder, REFINE desktop-only), NEW `edit-undo` (UNDO · DROP SESSION · DROP ALL · the MESH EDITS pill · Ctrl/Cmd+Z,
  linked from `fpv-height` + the keys map + a goal route), NEW `mobile-ar`, NEW `mobile-menu` (SIGN IN / name → MY
  PLACES / SIGN OUT / GUIDE / DESKTOP), the peek row's ↑rise/↓set + long-press aim, the scale bars, the HUD on the
  strip; `verify-guide.mjs` re-pinned (12 chapters / 16 goals / 16 routes) → **ALL PASS** on clean HEAD (L1 closed).
  Three guide shots are now stale (`shell-m`, `fpv-m`, `fpv-map`) — NSP. **Gates:** vitest **3,138 / 210 files** ·
  `astro check` **0/0/12** · knip **0** · `verify-guide` ALL PASS · `verify-uxbatch-2026-09-16` ALL PASS ·
  `verify-mobile-batch-2026-09-08` **127/127** · `verify-meshedit` PASS · `verify-usermodels` **21 legs PASS** (leg 1
  first fell to the `.vite` lazily-optimized dep chunk — `GLTFLoader` 404 once; a plain `wix dev` restart cleared it:
  the T14 trap now reads "expect to restart TWICE") · sweep `post-2026-09-17 --compare audit4-2026-09-11`: freeze 14/14 byte-identical; draw-count gate 6 PASS / 3 FAIL on the cold first run (the three Dnipro poses read FEWER calls — the cold-cache settle band; 5 poses carry no golden counters), the warm re-run `post-2026-09-17b --ids` of those three: **all 3 PASS** (calls 958/756/437 vs the golden's 716/634/327, tris within +0.4 %); pixel diffs are the convergence TREND the harness itself notes — `everest-orbit-52` 65–95 % because the golden run was CAPPED at 8 s with 74 ground tiles visible and 418 busy while this run settled in 3.4 s with 128 visible and 0 busy (its DBG JSON; the frames show the same scene at a finer imagery level); `legacy-m` 16.6 % is the 2026-09-16 strip (the PLUX menu + the scale bar) against a 2026-09-11 golden. No rendering change is in this session beyond the two depth pins (ghosts / target, off or a small mark in every catalogue pose). Freshest promoted golden stays `audit4-2026-09-11` (this session changed no pixels on purpose; promote after the next pixel-changing session).
  Verification tier: local-tested + browser-VERIFIED (house :9333, `wix dev`, VPN on).

- **2026-09-16b · SHIPPED + RELEASED — the mobile UX batch is LIVE as v1.36.11** (owner: "deploy"). The
  repo's own ship hook run in the foreground: `claude/ship-20260916-232835` → squash-landed on
  origin/master as **`3d42ca1`** after 60 s (tree-proven, branch deleted, `private` mirror synced; the
  hook bumped `package.json` 1.36.10 → 1.36.11). Then `npm run release:full -- -c "MOBILE UX BATCH
  2026-09-16 …"`: clean tree · whoami + env pull · gates green · `wix build` · `wix release` ("Site
  published on plux.today") · canary **GET 200 · POST 200** — then the script's step 6 guard REFUSED
  because this shell's default `node` is **v20.19.2** (`warm-prod-assets` / `verify-prod-globe` need the
  global `WebSocket` of Node ≥ 22); steps 6–7 were run by hand under `~/.nvm/versions/node/v24.10.0/bin/node`:
  **warm 167 assets, 0 failed, 0 cold** · `verify-prod-globe` canvas 1728×993 gl=true, screenshot
  `verify-shots/release-20260916-233738.jpeg`, the only failed requests the anonymous 403/401
  (`members/my`, `/api/places`) · live `/m` 200. TRAP → `scripts/release.sh` now resolves its own Node
  for steps 6–7 (the highest `~/.nvm/versions/node/v2[2-9]*` when `node` < 22) so the ritual completes
  from any shell. Verification tier: wix-VERIFIED (live). **The owner has not yet felt the pinch on
  glass — `CONTROLS.pinchZoomGain` 0.75 is the one knob.**

- **2026-09-16 · THE MOBILE UX BATCH (four owner asks, all `/m`): the finger-proportional PINCH ·
  the peek's ↑rise/↓set + long-press aim · the PLUX logo menu with the FPV HUD on the strip · the two
  scale bars.** **(1) The pinch** (`lib/globe/pinchZoom.ts`, `CONTROLS.pinchZoomGain` **0.75**, the
  same exponent in the MapWindow chart — was a local 0.8): the owner's "multiplier" was two library
  facts in `3d-tiles-renderer@0.4.28` — the touch pinch is a PIXEL delta (`zoomDelta += dist −
  previousDist`, spent as `· dist · zoomSpeed · 0.0025`: 1.25 %/px of the camera→ground distance at
  zoomSpeed 5 whatever the fingers' separation; 120 → 220 px ≈ 2.9× on the 2D map vs 1.83× finger-glued),
  AND `PointerTracker.previousPositions` move once per FRAME (`updateFrame()` at the end of `update()`)
  so k touch events a frame over-count the spread ~(k+1)/2× (a 120 Hz phone at 60 fps pinched ~1.5× faster
  per px). The orchestrator now reads the tracker's two distances pre-update on a touch-ZOOM frame and
  hands the library `(1 − e^{−gain·ln(dNow/dPrev)}) / (zoomSpeed · 0.0025)` — the distance scales by
  `(dPrev/dNow)^gain`, frame factors compose, the wheel keeps its pixel path, the FPV lens pinch is
  untouched, the near-ground brake no longer applies to a touch pinch. TRAP (twin-caught, 0.72 for an
  expected 0.59): never route a pinch through the wheel's eased bank — `_updateZoom` early-returns and
  zeroes `zoomDelta` once `getLatestPoint` is null (the moment the last finger lifts), so the tail is
  DROPPED; direct, same frame. Second twin read through the library's own per-event sum: gain 1.02 for
  0.75 (the frame-copy fact above). Final twin: **0.624 for 0.595** (the ~4 px·DPR classification loss).
  Source pins `test/lib/globe/pinchZoom.test.ts`; `conventions/globe-tuning.md` §The finger-proportional
  PINCH. **(2) The peek** (`mobile/TargetPeek.tsx`): `lib/ephemeris/riseSet.ts` — sun/moon through the
  planner's own `SearchRiseSet` + `planElevationsM` (one sunrise per app), every other target the first
  crossings of the REFRACTED horizon (−34′) of `targetAzAlt` (10-min scan, 16 bisections; null → em dash);
  two stacked clocks `.m-peek__rs` left of the bearings, memoised on (target · 0.01° · 10 min) and re-solved
  as a shown instant passes. LONG PRESS on the NAME → `store/skyAim.aimAtSkyBody("target")`: FPV =
  `gotoSkyBody` (the look glides; twin 25° → 229.5° onto the sun), map = the PLANNED cone's heading (the
  2D north lock would fight a heading glide; twin 229.7 vs az 229.7). The press is judged on RELEASE by
  `e.timeStamp` deltas as well as by the timer (a stalled FPV thread delivers touchStart+touchEnd together
  — the twin's sheet-opened-nothing-aimed read); the two timer-only twins (TabBar, MapModeChip) → **T145**.
  **(3) The menu** (`MobileShell.tsx`, `MobileAccount.tsx menuItem`, `mobile.css`): the wordmark is a
  `<button aria-haspopup="menu">` with a muted `▾`; `.m-menu` (fixed under the strip, z 10) holds SIGN IN /
  member · GUIDE · DESKTOP as `.m-chip.m-menu__item[role=menuitem]` rows with hints; `.m-menu-scrim` (z 9)
  + Escape close; the DESKTOP anchor keeps `href="/?d=1"` + the click-time hash. The FPV HUD pill moved ONTO
  the strip's right (`fpv.css`: top 0.48rem, font 0.58 / keys 0.46, gap 8 — the 0.62 cut was 302 px wide
  and overlapped the 81 px wordmark; keys hidden ≤ 22.5rem); the minimap card 5.6rem → **2.9rem**.
  `verify-guide.mjs` + `verify-uxbatch5.mjs` open the menu before their chip clicks. **(4) The scale bars**
  (`lib/format/scaleBar.ts`: the largest 1/2/5×10ⁿ under 110 px, thin-space thousands): the 2D map's in
  `.m-status__right` (`mobile/ScaleBar.tsx`, `mapMode === "2d" && !fpvOn`) off NEW `camera.mapScaleMPerPx`
  (the pose mirror publishes `|camera − focus| · 2·tan(vFov/2) / viewportH`, 1 % deadband, null past the
  limb — exact at nadir; twin: bar 97.7 px = 200 m / 2.048 m/px); the chart's under the MAP/+/− pills
  (`.mw-scale`, `metersPerTilePx(lat, z)` at the live z inside `draw()`, published only when the rung moves,
  /m only). **Gates:** vitest **3,117 / 208 files** (incl. the three new files pinchZoom · scaleBar · riseSet) · astro
  **0/0/12** · knip 0 · NEW `scripts/verify-uxbatch-2026-09-16.mjs` **31/31** on the house Chrome
  (`verify-shots/uxbatch-2026-09-16/`) · `verify-mobile-batch-2026-09-08` **127/127**. Not run: the desktop
  sweep (no `globe/**` pixel path changed — the orchestrator edits are input + a store mirror). **Traps:** a
  CDP `Page.navigate` after a touch sequence leaves headless Chrome delivering synthesized clicks but NO
  pointer events on the next document (fresh target per gesture page — `conventions/verify.md` §Traps);
  the AIM joystick floats over the fullscreen chart at z 24 and eats a synthetic pinch finger; the chart
  opens at its MAX zoom in FPV. Backlog **T145**. Memory `mem:project/wip-2026-09-16-mobile-uxbatch-menu-pinch-scale`.
  **NEXT (owner's word): the READ-ONLY triage of the audit #4 findings — substantial vs minor vs
  hallucinated — before any slice.** No release cut; the pinch gain is the owner's one knob to feel on glass.

- **2026-09-11 · AUDIT #4 EXECUTED — the charter's full breadth-first adversarial pass (15 finder
  tracks + a main-agent browser tier; READ-ONLY held: the diff = the report + README row + checklist
  amendments + backlog dated edits + the wip leaf).** Report: **`audits/audit-full-2026-09-11.md`**
  (`mem:project/wip-2026-09-11-audit4`). Gates: vitest **3,098/3,098** · astro **0/0/12** (baseline
  holds) · knip 0 · npm audit INFRA (both registries unreachable via the VPN) · wix build **32 MB**
  (< the 33 MB baseline). Browser: sweep `audit4-2026-09-11` 14/14, freeze 14/14 byte-identical,
  draw-count 10/14 EXACT vs `post-2026-09-10b` (the 4 diffs in the documented ground-tile settle band,
  T134's desktop caps the legitimate cause); **T131–T134 verified holding live** (the four owner poses;
  P2 no white band, P3 moonlight mean 23, P4 the stream converges; DBG slotBoosts/growthCapped live);
  **T135a NOT reproduced again** (cold cache, altM 8601 seated on terrain); harnesses: mobile-batch
  **127/127**, meshedit PASS, usermodels 21 legs, debughud ALL, `verify-guide` 3 FAIL = stale pinned
  counts (the guide grew to 12 chapters/86 topics/16 goals; harness asserts 11/14). Live site: all
  canaries 200. **6 MAJOR, all panel- and anchor-verified: the LIVE-SITE GRADUATION class** (no
  moderation gate with `isPublic` defaulting TRUE · T17's ToS trigger fired unrecorded · T26 unbounded
  uploads + unconstrained preview mime · previewUrl length-only onto every visitor's img/texture fetch —
  **T138, an owner batch**) · **the library pin** (caret `^0.4.28` over NINE patch
  seams, `installed:false` drifts SILENT — **T136**) · **C1** the skyBudget twin models the base dome
  only while the T96 LOOK ships on base (0.8964 vs 0.9 — **T137**). 37 MINOR + 13 NIT confirmed + the
  live-tier L-series (L1 guide harness, L2 the interlude golden never promoted, L3 upload copy). **The
  FINAL verification pass (29 MINOR verifiers + 9 NIT batches, completed late-session) CONFIRMED 26 and
  REFUTED 2 — G5 "zero analytics" (the Wix headless EDGE injects site-bi/site-analytics/tag-manager +
  PageView on every served page — live-fetched) and J1 (LRUCache.isFull() is cap-relative; the RC20 bank
  floor leaves ≥16 MiB headroom, so the DBG note stays accurate) — both DELETED per the charter and
  recorded in the report's outcome note so they are never re-discovered.** **Registry repaired:**
  T32/T35/T36/T37/T39 CLOSED (the 2026-08-22e closures that were never edited; HEAD-verified) ·
  **T136–T144 opened** · T135/T17/T26/T30/T50/T71/T88 notes. Checklists grew (code 29–31, tests 13–16,
  platform 14). §Recent measured **135,178 B — compaction round 7 is AT the trigger** (T141). Traps:
  Node 20 needs `--experimental-websocket` for every CDP harness · a sweep label is not a golden
  (promote after pixel changes) · two API usage walls hit the verifier fleet (both resumed; every
  completed verdict refuted NOTHING). **NEXT: the report's fix-session slicing S1–S10 (S3 = the owner
  batch), then the pre-audit main plan (the farm FEATURE legs, the T77 lane).**

*(Moved to the top 2026-08-13 after drifting mid-list since 2026-08-03; it drifted AGAIN and
was re-seated here 2026-08-22 during compaction round 4 — audit #3 D13, which also records the
root cause: appends go to the top and nobody re-seats the marker. A move is not an edit.
THIRD DRIFT re-seated 2026-08-24d, from below four dated entries: the marker cannot survive a
top-append convention by sitting in the list. It now lives directly under the heading, where an
append physically cannot get above it — backlog T40.
FOURTH DRIFT re-seated 2026-09-06g (compaction round 5): it had sunk below 14 dated entries
again — every session appended above it. Rule restated: APPEND DIRECTLY UNDER THIS NOTE.)*

*(Sentinel — older sessions moved byte-identical to `DECISIONS_ARCHIVE.md`: 2026-08-02 →
2026-08-15e in §Moved 2026-08-18 (round 3), 2026-08-17 → 2026-08-19d in §Moved 2026-08-22
(round 4, md5 5ed47c51b9d44a754964771ffe418330, 556 lines / 79,306 B), 2026-08-21 →
2026-09-05 in §Moved 2026-09-06 (round 5, md5 4260321dc13ba45b11c3de0bb5c8856e, 865 lines / 410,237 B),
2026-09-05b → 2026-09-06n in §Moved 2026-09-07 (round 6, md5 2137d0be57d10eccd791b4738c52e411,
34 lines / 80,273 B), and 2026-09-06o → 2026-09-10f in §Moved 2026-09-17 (round 7, md5 bb447cf172bb7dd1d2d7da2e89a644f7,
45 lines / 133,576 B — the T77 lane's tail: T100 (a), the phones, T83, the occlusion rulings, T106,
the two mobile features, lever 11, the app version, the mobile UX batch, the regressions + lever 8, T126/T129/T130,
T123 levers (a)+(d), the release gate, the rendering interlude, the cache ruling). Their era digests live in
§Per-phase digests above. Entries above this line are the audit-#4 era's live tail, 2026-09-11 →, kept verbatim
while that work is live.)*
