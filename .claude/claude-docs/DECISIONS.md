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
(2026-08-17 →, ladder parked mid-run) stays verbatim in Recent sessions.

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

### Wix platform / backend (gate Phase 6 — never archive silently)
- **App-defined POST routes** were feared to 403 through the cloud adapter → the released-URL `/api/ping`
  canary confirmed 200; the risk is dead but the canary STAYS as the pre-release gate. (Phase 5 release)
- **Login builds an `http://` callback** repaired from the Referer header; `http` is tolerated only for
  localhost → referer-less (curl) auth fails "Invalid redirect URI". (Phase 5 release)
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

---

## Recent sessions (verbatim, newest first)

- **2026-08-21e · OWNER BATCH #6 — four fixes on batch #5 (same session; owner screenshot arrived intact this time).** (1) **placed point OWNS the map radar** — MapWindow `aimAnchorNow` reordered to `tempPin ?? camGeo ?? focus` (the walking-FPV camGeo used to outrank the pin, so after a place the radar kept a "buggy offset" glued to the viewer; GL orchestrator was already pin-first). Side discovery, judged GOOD and kept: a STANDING temp FPV re-derives its camera from `tempPinPoint()` every frame, so placing a point also relocates the under-map FPV → the PiP previews the NEW standpoint → tap = you are there (fills the no-jump-affordance gap flagged in batch #5; a walked FPV keeps its walk track). (2) **band stack REORDERED + COMPACTED** (supersedes the batch-#4 "sun inner, moon outer" sketch): moon INNERMOST, sun directly above, target a small gap above the sun at 3× the band width — desktop `bandMoon [0.3,0.38] · bandSun [0.42,0.5] · bandTarget [0.55,0.79]`, mobile `[0.24,0.32] · [0.34,0.42] · NEW bandTargetMobile [0.46,0.7]` (the rim-clipped [0.55,1] zone read "too far out and huge"); `bandFor(key,mobile)` returns the target variant now; the N marker rides `bandTarget[1]×northOffsetK` on GL + MapWindow (a fixed unit-1.09 seat would float off the compacted ink; minimap keeps DOM `.mm-n`). The "lost moon band" = the old silver ring reading invisibly on bright ground (+ possibly a session-dismissed MOON direction) — it draws innermost now, brightness taste rides T1. (3) **focal cone FROM BOOT** — `stepPlannedView` seeds a null plan eagerly (live view heading + `horizontalFovDeg(FPV.tempFovDeg, camera.aspect)` — the stick's first-touch seed done at boot; later photo/jump/FPV-exit/stick seeds overwrite); **aim stick mm readout** — NEW pure `focalMmFromHFov()` (lib/geo/plannedView, 36 mm full-frame width, unit-tested ×2) + `Joystick` grew a `footer` prop; AimJoystick subscribes `fpvHud → horizontalFovDeg(live)` else `plannedView.hFovDeg` and renders `formatFocal(mm)` on the pad's lower body (`.m-joy__footer`, focal-cone ink). (4) **/m aim stick re-seated** — OFF the minimap corner (`.m-joy--aim-minimap` is desktop-only now; MiniMap gates on `!mobileShell`), ONE /m instance in MobileShell: `variant={fpvOn ? "fpv" : "map"}` — `.m-joy--aim-fpv` sits just above the WALK stick (same left rail, 108 px pad + 12 px gap) and rides the existing `body.mw-open` z-24 rung, which un-loses the stick in the /m fullscreen-map view (batch #5 had hidden the `.mm` card that carried it). Gates **vitest 1,109/1,109** (+2 focalMm; band tests rewritten to the new order incl. 3×-width + off-rim invariants) · astro 0 err/5 hints · verify: S1 23/23 + s2 **16/16** (2 SUPERSEDED checks: plannedView now SEEDS at boot; /m stick above walk, corner retired) + s3 18/18 + uxb5 17/17 (press point moved off the new stick rail — it landed on the z-24 aim pad) + NEW `scripts/verify-uxbatch6.mjs` **12/12** (boot plan desktop hFov 79.6°/m 27.1° → "75 MM" footer; aim y+h ≤ walk y same rail; corner gone; stick visible over the map; pin moved w/ map open; shots `uxb6-01..05` incl. a dedicated low-alt /m band-stack close-up — moon innermost CONFIRMED drawn). **TRAPS (new):** the /m left rail is now TWO stacked z-24 pads — synthetic map long-presses below x≈126 land on the sticks, not the chart; `wix dev` on :4321 DIED mid-session (curl 000) — restarted, the "engine booted" waitFor guard is now in uxb6 for cold rebundles. **UNVERIFIED (rides T1):** moon-silver band readability on bright ground (bump candidate: moon rim/wash alpha), 108 px aim-pad size taste (owner's "keep current size" read as the standard pad, not the 72 px corner), place-point-relocates-standing-FPV feel. Memory: `mem:project/wip-2026-08-21-owner-uxbatch6`.

- **2026-08-21d · OWNER BATCH #5 — six post-batch-#4 fixes (/frame 4-scout cited fan-out; owner's screenshots arrived as broken placeholder icons — worked from the written descriptions + own browser repro).** (1) **radar band RESTING fills** — root cause: fill alpha was ×`emphEased` on ALL THREE surfaces, so only the focused body (default target) ever filled — sun/moon strips read EMPTY; NEW `AIMCONES.fillAlphaRest 0.05` (above the 0.003 shader discard gate, below fillAlpha 0.08): GL `aimCones.ts` uAlpha = `(rest + (fill−rest)·emphEased)·overlayA`, MapWindow + minimap twins always fill (`emphasized ? fillAlpha : fillAlphaRest`, minimap keeps its ×2 patch scale) — body-ink future / grey past now always visible, emphasis just breathes. **Focal-cone edge de-fattened** — the GL half-width lives in RAY-EXTENDED units (×rayLenK 6): old `edgeHalfWidthK 0.0015` ⇒ 3.0× the radar direction line; now **0.000625** ⇒ 1.25× ("a bit more distinct"), `edgeAlpha 0.55→0.7` (brightness carries the reading); canvas twins stroke 1.5·dpr; minimap cone stroked the whole CLOSED wedge (far arc incl.) — now boundary LEGS only like GL/MapWindow. (2) **/m radar shrink** — NEW `AIMCONES.mobileRadiusK 0.8` (GL radius + focalCone reach + MapWindow `rBase`, orchestrator-pushed `mobile: isMobileShell` into both scene updates — the fence forbids scene store/DOM reads; MapWindow hit-test rBase mirrored or tap-promote desyncs) + NEW `bandSunMobile [0.24,0.32]` / `bandMoonMobile [0.34,0.42]` (sun/moon ~20% closer to centre, same 0.08 widths, non-overlap invariants hold; `bandFor(key, mobile)` + both panel twins; minimap gets bands but NOT the radius shrink — its card is already CSS-shrunk to 124px on /m). (3) **/m PiP = true miniature** — the S3 punched hole showed a 1:1 screen CROP and the z-10 MiniMap card (fully inside the hole, between GL z-0 and map z-20) bled through ("minimap inside minimap"). Now: `.mw-pip` sized **32vw × 32dvh** (EQUAL viewport fractions ⇒ box aspect ≡ screen aspect — the trick that lets the engine reuse the live camera untouched), MapWindow publishes the measured box (deadbanded) to NEW `minimap.pipRect`/`setPipRect` (cleared in the open-effect cleanup), `TilesHandle.pipRect()` mirrors it (orchestrator owns store facts — GlobeCanvas stays store-free), GlobeCanvas ticks ONE scissored `renderer.render(scene, camera)` into the rect after `composer.render()` (setViewport/setScissor take CSS px — three applies DPR itself; Y-flip vs innerHeight; viewport restored after — the composer reads it next frame; tone map + sRGB apply natively on the backbuffer and bloom is already off on /m [leanMobile], so the look matches); mid-stack chrome hidden while the /m map is up (`body.m.mw-open .mm/.m-fpvhud/.fh-chip { visibility: hidden }` — mounted, subscriptions warm). (4) **/m place-point stays on the map** — `viewFromHere` was `requestFpvJump` (= `setTempPin` + `setTempFpv(true)`) + close; on /m it now ONLY `setTempPin` and returns (window stays; `wantKind === fpvKind` so the live FPV under the PiP never re-enters; the document-capture click swallow now guards the trailing click from radar tap-promote instead of the unmount retarget); hint → "LONG-PRESS — PLACE POINT"; desktop unchanged. (5) **/m dock date+time = desktop twins** — root cause found in the S1 #12 diff: deleting the `.md-rate` CSS block took `.md-date`'s entire rule body, leaving `.md-date,` dangling onto `::-webkit-calendar-picker-indicator { filter: invert(0.7) }` — the WHOLE input was inverted, unstyled, light-scheme; rule rebuilt as the `.ts-date` twin (font inherit / 11px / border / radius 6 / `color-scheme: dark` / indicator-scoped invert + `:focus-visible` accent) AND the read-only `.md-clock` span replaced by a native `<input type="time" class="md-date md-time">` with `onTimeChange` = the desktop `withLocalTime` null-guarded handler (time PICKING existed on desktop only; tint classes dropped — desktop's time input is untinted, offset chip + cursor carry the signal); `verify-uxbatch4.mjs` check updated `.md-clock`→`input.md-time`. (6) **shell-switch pose carry** — /m always honored `#p=`/`#f=` at boot but every desktop→/m link was a bare `href="/m"` (hash dropped ⇒ `MOBILE2D.boot*` 1100 km default), and a carried oblique tilt ≥`twoDMaxTiltDeg 10` would land 3D; NEW pure `mobileShellHash()` (urlPose.ts, unit-tested): `#p=` re-formats with **tilt 0** (2D door; alt/coords/heading/`&t=` preserved), `#f=` passes EXACT, garbage → ""; wired at click time via an index.astro PROCESSED module script (both `a[href="/m"]`: topnav + coarse banner) + Welcome CTA onClick (mirror is welcome-suppressed → usually plain /m, correct) + the /m DESKTOP chip carries `location.hash` raw onto `/?d=1` (desktop honors both forms; the MobileAccount click-time returnTo idiom). Gates **vitest 1,107/1,107** (+6: mobileShellHash ×4, mobile bands, fillAlphaRest) · astro 0 err/5 hints · regressions S1 23/23 + S2 15/15 + S3 18/18 ALL PASS + NEW `scripts/verify-uxbatch5.mjs` **17/17** (shell-switch probe landed `mapMode 2d` lat 48.464 lon 35.046 alt 2494 m from a 2495 m desktop pose — no 1100 km; PiP box 124.8×270.1 @390×844 = exact 32vw/32dvh; hole alpha 0/chart 255; `.mm` visibility hidden; place-point pin moved with map still open; DESKTOP chip carried `#f=` verbatim; shots `verify-shots/uxb5-01..05`). **TRAP (new):** /m re-mirrors the LIVE camera into `location.hash` within ~1.6 s of boot (`urlPoseEveryFrames`) — a verify script can NOT assert the transformed link hash post-boot, assert the boot RESULT (store probe) instead. **UNVERIFIED (rides T1):** real-device PiP scaled-pass perf/feel, band-wash taste (fillAlphaRest 0.05, ×2 minimap), mobile radar 0.8 taste, iOS native time-input popover look. Memory: `mem:project/wip-2026-08-21-owner-uxbatch5`.

- **2026-08-21c · OWNER BATCH #4 S3 — BATCH COMPLETE (addendum-#2 items 17+18 + #15 network + #5 iOS resilience + #1 /m PiP; /frame 4-scout cited fan-out).** (17) **radar sun/moon body-tinted future** — NEW `bandFutureInk()` exported from `scene/aimCones.ts` (sun→sunGlow, moon→moonDial, target keeps timeFuture; unit-locked); `makeSectorMaterial(futureHex)` sets per-body `uFuture` at creation (fill+rim; rise/set spokes untouched; the `step(uNow01,vT)` split unchanged); MapWindow twin + minimap radar pick future ink per body via their existing `b.color` (minimap reads the tokens bridge — NO `--color-moon-dial` CSS var exists, deliberate). (18) **TargetPanel GOTO before SHOW** — the chip's aim handler EXTRACTED to `store/skyAim.gotoSkyBody(kind)` (skyMarkers mirror when present, else live `targetAzAlt` fallback at `camGeo ?? focus` so the button works with SHOW off; below-horizon → `nextRiseAzimuth` at the horizon; pure decision twin `gotoAimSolution` tested in NEW `test/store/skyAim.test.ts`); SkyGotoChips delegates to it; the pill is NOT gated on `visible` (the TRACK precedent). (#5) **iOS resilience** — GlobeCanvas: `webglcontextlost/restored` handlers (three already preventDefault()s + re-inits GL — the app half is a `ctxLost` render gate + composer realloc on restore) and the tick now SKIPS hidden pages (iOS delivers throttled hidden rAF = heat) while re-seating the governor clock (no giant-frame tier shed on return); StylizedTiles: `visibilitychange`/`pagehide`/`pageshow` freeze ALL NINE tile queues (3 renderers × download/parse/processNode via `PriorityQueue.autoUpdate` — the library's one scheduling gate, orthogonal to the tier `maxJobs` caps) with `scheduleJobRun()` re-kick on return; NEW **`QUALITY.leanMobile {dprCap 1.25, bloom false, shadowMapSize 1024}`** applied as coarse-pointer renderer-lever OVERRIDES on top of whatever tier the governor runs (tile knobs stay per-tier; shadows stay ON at 1024 — the mid look survives, unlike tier `low`; `high` byte-identical untouched, test-locked). (#15) **network** — (a) NEW **`public/sw.js`** iOS-DIRECTED tile cache (registered from BOTH layouts ONLY for iOS-like devices [iPhone/iPod/iPad UA, or Macintosh UA + maxTouchPoints>1 = iPadOS] and NEVER on localhost): cache-first Cache-Storage over Esri/CARTO/assets.ion.cesium.com/tiles.openfreemap.org/*.workers.dev, FIFO cap 6000 entries ≈300 MB + 7-day per-entry max-age (**Esri ToS posture: a performance cache, never an offline extract** — the TILESETS UNVERIFIED-for-prod note stands, flagged for the owner), NEVER caches tileset.json/layer.json/the `/planet` TileJSON/api.cesium.com (token endpoint — not allowlisted); policy fenced by NEW `test/swTileCache.test.ts` against the tuning source of truth. (b) **demand shrink**: per-tier `overlayResolutionPx` (512 high / 256 mid+low — the REAL network lever: calculateLevel picks the Esri source zoom from resolution, ≈4× fewer GETs) — `imageryGround` gains the **`setOverlayResolution` rebuild path** (plugin.resolution + FRESH overlay instances via the plugin's own delete→add idiom — re-adding the SAME instance NESTS the download-queue fetch wrapper; the U6 visibility-guard patch + load-error retry closure ride the plugin instance and survive), construction now takes the tier resolution so the attach-time fan-out no-ops; NEW `TILESETS.esriMaxLevelCoarse 17` (coarse-pointer Esri depth cap; desktop keeps z19); ground-ONLY LRU raise `groundLruBytesMB` 320 mid / 192 low (high 400 = lruBytesMB, byte-identical; buildings/enriched stay at the shared cap — blanket raise worsens jetsam). (c) **per-URL force-cache** (immutable binaries only): Esri/CARTO overlay images (`overlay.fetchOptions` — an overlay fetches only tile images, kills the measured ~60/reload revalidations), terrainPatch `.terrain`, NEW `FTW_ENRICHED_FORCE_CACHE` `.glb` claimer on the enriched renderer (tileset.json declines → keeps revalidating), openfreemap `.pbf` (dated build path; the TileJSON keeps the default mode). (#1) **/m PiP** — NEW `.mw-pip`: a transparent 200 px button top-right of the fullscreen map (draw() `clearRect`s the canvas under its exact DOM box — CSS owns placement so ring+hole can't drift; `body.m .mw` drops its panel background so cleared pixels reach the GL canvas rendering the LIVE FPV view beneath — chrome included, a true PiP); REPLACES ✕ MINI-MAP on /m only (desktop MapWindow untouched); tap → close → back to FPV (FPV persists under the window the whole time). **TRAPS (new):** the dev bundle renames three's pass classes (`_UnrealBloomPass`) — CDP pass probes must match by SUBSTRING; a hash-only `Page.navigate` does NOT reload (the `#p=` pose applies at load) — go `about:blank` first; the city chart pose sits under the mapFlat bloom gate (`mapFlatMaxAltM` 120 km) — assert bloom at a LEO pose, off-on-the-chart is BY DESIGN (2026-08-18e). Gates **vitest 1,101/1,101** (+13: bandFutureInk, gotoAimSolution, leanMobile + #15 tier invariants, SW policy fence) · astro 0 err/5 hints · S1 **23/23** + S2 **15/15** regression ALL PASS + NEW `scripts/verify-uxbatch4-s3.mjs` **18/18** (GOTO steers targetHeadingDeg null→143.06°; /m lean DPR 1.25 + bloom pass off; PiP hole insideAlpha 0 / chart outsideAlpha 255; shots `verify-shots/uxb4-s3-01..04`). **UNVERIFIED (rides T1 + the first prod release):** /sw.js actually served by Wix hosting (Content-Type/scope unprobed — the one #15a risk), real-iOS jetsam/contextlost/heat behaviour, Esri-z17 + 256-composite look on a phone, governor-flip overlay rebuild flash. **Batch #4 CLOSED — 18/18 items** (T1 real-device rider open). Memory: `mem:project/wip-2026-08-21-owner-uxbatch4`.
- **2026-08-21b · OWNER BATCH #4 S2 — radar unify + focal cone everywhere + aim joystick + MapWindow twist + item 16 (/frame + investigate-design-v3 design mode; 3-scout cited fan-out; design locked in `UXBATCH4_PLAN.md` §S2 DESIGN).** (16) **street labels ×0.5** — `STREETS.textPxTarget [15,13,11]→[8,7,6]` AND `textHeightM [22,15,11]→[11,7.5,5.5]` (tuning.ts:1439/1449): the owner's giant riverfront label WAS the world-size floor branch (screen size = max(world-px, pxTarget) via `labelScaleFor` floor-at-1 — halving only the px targets changes nothing at street level). (9) **radar → concentric annular bands** — NEW `AIMCONES.bandSun [0.3,0.38] / bandMoon [0.42,0.5] / bandTarget [0.55,1]` (unit [inner,outer]) consumed by all three surfaces from the SAME tunables: GL fan rebuilt as annular quad strips + inner→outer spokes (`bandFor()` exported+tested), MapWindow twin as outer-arc+reversed-inner paths, and the **minimap GAINS the radar** (in-component `sampleAimDay` memo — the MapWindow idiom; pose channel untouched). **compactK + lineLenK RETIRED** (bands non-overlapping by construction; `radiusTauMs`→`emphTauMs`, emphasis gates FILL only); sun/moon dials cap at their OWN band outer radius; target ray keeps rayLenK 6. **`N` rim marker all surfaces** (GL 64px canvas-raster quad at `northOffsetK 1.09`; MapWindow fillText riding the rotation; minimap keeps DOM `.mm-n`). (state) **planned view** — camera store `plannedView {headingDeg, hFovDeg}` + `plannedRates` (hFov stored HORIZONTAL — no surface ever needs an aspect), session-only; seeds last-writer-wins: photo placement (param-key watch), long-press-jump consume, **FPV exit** (both hud-null branches — the framed shot survives to the planning surfaces), joystick first touch; pure math in NEW `lib/geo/plannedView.ts` (stickRate expo γ / integratePlanned low-pass+wrap+log-clamp / plannedAtRest / `horizontalFovDeg` moved here as canonical — minimapFeed re-exports) + orchestrator `stepPlannedView` (zero store churn at rest). (cone) **focal cone everywhere** — NEW token `--color-focal-cone` **#E08FC6 orchid-rose** (tokens.css + GL bridge; timeFuture/pinIce/cometTail sit too close to the radar's future-blue, lavender = places) + `FOCALCONE` tunables (fill 0.05 / edge 0.55 / hFov clamp 3–120° / rate ceilings 45°/s + 0.9/s log): NEW GL `scene/focalCone.ts` (unit ENU wedge, rebuild only on hFov Δ>0.1°, heading=rotation.z, reach = radar radius × rayLenK, rides the aimCones anchor/band/RADAR-master, hidden in FPV), MapWindow's hardcoded-0.22 block REPLACED (fpvHud live at the eye > plannedView at the radar anchor), minimap cone re-inked. (11) **AimJoystick** — `Joystick` parameterized (raw unit-disc `onVector`); NEW SHARED TIER **`src/components/controls/`** (the mobile fence forbids panels↔mobile; instruments whose FEEL must not fork live in a leaf both shells import — **fence rule 3 added** to `mobileFence.test.ts`: controls/ may import ONLY react+store+lib+globe/tuning+styles). In FPV writes the real `setHeadingRate/setFovRate`; outside seeds+steers the planned view. Mounts: /m 2D/3D map bottom-left (MobileShell) + minimap card bottom-right both shells (72px, knob wears the cone ink). (4b) **MapWindow twist** — `view.rot` + ONE rotation-aware transform `xformNow()` (fwd/inv) replacing the FOUR duplicated zDraw stacks; tiles blit under ctx.rotate with half-diagonal AABB range (+1px overdraw seam guard; texel-snap round kept at rot 0); tap-promote de-rotates; pinch composes twist (1:1) + midpoint pan; north-up reset per open; desktop stays rot 0. **S1 BUG found+fixed:** the long-press trailing click RETARGETS after the pressed chip unmounts (tempFpv flips the chrome within a frame) — it landed on member-gated SAVE VIEW and navigated to the LOGIN page mid-jump (read as a white "crash" in shots); fix = one-shot document-capture click swallow, 900 ms fuse (`SceneActions.jumpHere` + `MapWindow.viewFromHere`). **TRAP: an element-level click-swallow dies with its element.** **Side quest (owner ask): rendering-pipeline audit + cache measurement** — scout-verified ALL UPLIFT optimizations IN-PLACE-WIRED (U5 closest-first incl. queue caps/fpvBias gating, U6 foveation all 3 renderers, mobile tier coarse→mid + DPR 1.5 + 3×256MB LRU + 2k textures; confirmed negatives w/ positive controls: zero contextlost/pagehide handlers). **S3 note: `GROUND.overlayResolution` is a construction-time ImageOverlayPlugin arg — the planned 256-on-mid/low shrink needs a plugin rebuild path.** NEW `scripts/measure-tile-cache.mjs` (cache ENABLED, LOAD→WANDER→RELOAD, both views): Chrome disk cache **HOLDS** (reload ≈95% fromDiskCache, only ~60 ~0-byte metadata revalidations repeat; zero in-session re-fetches over a 6-pan wander) → **request-level cache-busting REFUTED; the owner's desktop-Chrome storm observation ≈ the DevTools disable-cache checkbox; the iOS-small-cache ranking STANDS and the SW mitigation stays iOS-directed** (gap: mobile-view WANDER gesture didn't take on the emulated tab — device re-measure rides T1). Dev-env trap: a `wix dev` predating new module files serves **504 "Outdated Optimize Dep"** → black canvas; restart after adding modules. Gates **vitest 1,088/1,088** (+14: plannedView math, band contract, fence rule 3) · astro 0 err/5 hints · S1 regression suite ALL PASS · NEW `scripts/verify-uxbatch4-s2.mjs` **15/15** both shells (Δheading 16° via minimap stick; FPV-exit seed Δ0.00°; twist pixel-diff; /m stick seeds+zooms plan 27.1°→22.9°; shots `verify-shots/uxb4-s2-01..07`). **UNVERIFIED:** real-device twist/stick feel + band-radii taste (rides T1). **Remaining: S3 = #15 SW tile cache (iOS-directed) + demand shrink (needs the plugin-rebuild lever) + #5 iOS contextlost/pagehide/lean profile + #1 minimap PiP.** Memory: `mem:project/wip-2026-08-21-owner-uxbatch4`.

New work appends a dated line here. *(Marker moved to the top 2026-08-13 — it had drifted mid-list
since 2026-08-03; a move is not an edit (compaction precedent). Audit finding D2.)*

- **2026-08-21 · OWNER BATCH #4 S1 — 10/15 items (touch correctness + overlay/chrome quick wins; /frame + investigate-design-v3 implement/Deep, 4-scout cited fan-out; plan `UXBATCH4_PLAN.md`).** Owner's post-real-device list (iPhone 17 Pro Safari) organized into 6 tracks / 3 sessions; S1 shipped: (2) **selection tint killed** — global `user-select/-webkit-user-select: none` + `-webkit-touch-callout: none` + `-webkit-tap-highlight-color: transparent` on body (repo had ZERO tap-highlight rules), inputs/textarea/select/contenteditable opt back in (`global.css`, both layouts). (3) **2D-map gesture rework** — tilt-into-3D door REMOVED (`MOBILE2D.enter3dTiltDeg` retired; ▲ 3D chip = only door), two-finger parallel drag now ROTATES the chart: tilt re-locks nadir EVERY frame (kk=1 mid-gesture — same-frame kill, no ease wobble), heading lock stands down during touch-ROTATE and a `mobile2dFreeHeading` latch keeps the user's heading until 2D re-entry / heading glide re-arms north (`stepMobile2dLocks`). (4) **MapWindow pinch CONTINUOUS** — fractional z (tiles at `Math.round(z)+boost`, canvas scaled `2^(z−zDraw)`; the old `Math.round(log2)` integer snap was the owner's "chaotic steps"), damping `PINCH_SENS 0.8`, wheel/chips re-seat integer levels, FPV open z 17→**18**. (6) **target tracking RAY** — `AIMCONES.rayLenK 6` (GL dial, emphasis-independent) + window-edge length on the canvas twin + full-ray tap-promote reach (aimCones.ts / MapWindow.tsx). (7) **vector ink** — fillOpacity 0.5→**0.25** · lineOpacity 0.85→**0.55** · flatLineK 0.55→**0.32** + NEW pref `vectorsVisible` (camera store, rev-2 blob) → desktop **VEC** chip (grid row 3) + /m **▤ VECTOR** in LAYERS; gates `vectorFeatures.update enabled` only (street names stay — content, not wash). (8) **⌖ FIND IN FRAME toggle** seated above UNFOLLOW both shells (`.tp-findframe`/`.m-findframe`; sky-menu body mapping + composite `find.open && bodies[b]` read; desktop closes PLAN first). (10) **long-press ▲ 3D** → `requestFpvJump` at the map centre, current heading, last-FPV focal (session `lastFpvFovDeg` tracker; ORCH 500 ms/6 px shape; click-swallow guard). (12) **/m time dock rework** — PLAY + speed selector REMOVED on /m (desktop scrubber untouched), status-strip TimeChip removed, dock gains `.md-clock` time-only readout (amber past / blue future). (13) **MapWindow desktop** — `usePanelDrag("map-window")` + grip, −10% (`min(57.6rem,84.6vw) × min(72vh,43.2rem)`); **`.mw` overflow:hidden REMOVED** (it clipped the DragGrip tab — the documented inner-wrapper trap; corner clip moved to `.mw-canvas` border-radius). (14) **Guide resizable** — `usePanelResize("guide")` + ResizeGrip, `--win-w/--win-h` reads (supersedes the 2026-08-15e "not resizable" ruling); guide search was ALREADY shipped 2026-08-19d — owner tested a pre-ship build. Guide topics updated (mobile-map/layout/chips/gestures). Gates **vitest 1,074/1,074** (+1 prefs) · astro 0 err/5 hints · browser-verified BOTH shells via NEW `scripts/verify-uxbatch4.mjs` (raw-CDP; **23/23 PASS** — incl. compass −69° after synthetic two-finger drag, no 3D flip; long-press → FPV; VEC pixel-diff 53k px; shots `verify-shots/uxb4-01..11`). **TRAP for the record:** synthetic CDP two-finger gestures need ≤3 px steps — the library classifies ROTATE-vs-ZOOM on the FIRST move past ~6 px and CDP delivers the two pointers in separate tasks, so a coarse step reads as a pinch (state 3) mid-frame. **UNVERIFIED:** real-device gesture feel + iOS Safari behaviour (rides T1). **Remaining: S2 = radar rework (9) + focal cone everywhere + focal joystick (11) + MapWindow twist rotation (4b); S3 = tile-request storm (15: SW cache — headers PROBED FINE on every host, the storm is LRU-eviction re-fetch vs iOS's small HTTP cache; Esri is HTTP/1.1-only) + iOS reload/heat (5: zero contextlost/pagehide handling today) + minimap PiP (1).** Memory: `mem:project/wip-2026-08-21-owner-uxbatch4`.
- **2026-08-19d · PLUX LAUNCH GROOMING (brand + domain + guide G2-refresh + guide search; /frame 3-agent cited fan-out).** (1) **BRAND = PLUX** (owner, supersedes working title "Sidera" 2026-08-14): master art `public/logo/PLUX_MASTER_LOGO.png`/`PLUX_FAVICON.png` → derived `logo/plux-wordmark.webp` (trim+1200w, 36 KB) + `logo/plux-mark.png` (square-padded 96px) + `favicon.png` 48px + `apple-touch-icon.png` 180px on `#05070b` (ImageMagick; favicon.svg DELETED); hero headline replaced by the wordmark img (`Welcome.tsx` + `.wl-logo` clamp(16rem,34vw,29rem)); nav = mark+Plux (index.astro `.logo-mark` 18px), same for `/guide` `.g-brand__mark`; /m strip mark 14px (`.m-title__mark`); UploadFlow bordered-dot placeholder → mark img + PLUX; every UI/title/og/ICS "(Sidera)"→"(Plux)" (Layout/MobileLayout/m/guide.astro, FindPanel/FrameCard/TodayCard/MoonCalCard, Guide tip, guideContent ×5, README). (2) **DOMAIN plux.today** — measured live: Wix ALREADY primary-flipped to `www.plux.today` (old wix-site-host **301s site-wide**, `x-meta-site-id` = our siteId) but registry delegation still lists GoDaddy ns31/ns32 + wixdns ns8/ns9 (owner added NS records in the zone editor, not the Nameservers setting) and www has NO TLS cert yet → **prod effectively dark until the owner completes the GoDaddy nameserver replacement** (full fix sequence in NEXT_SESSION §1); repo scan (agent, cited): R2 CORS `*` (unaffected), auth redirects origin-derived (unaffected — but the OAuth-app allowlist in the dashboard MUST gain plux.today), siteId-bound release (unaffected), localStorage 6 `ftw:*` keys + wixSession reset once by the origin change (bldg-overrides genuinely lost — sync phase would save them); `SITE_URL` (og:image) + warm/verify/seed script defaults flipped to `https://www.plux.today` (+ `FTW_SITE_URL` env override, scripts ×7). (3) **GUIDE G2-REFRESH** (everything since G1 2026-08-15e; gap analysis agent, all labels file:line-cited): 16 stale topics corrected (2D-first /m, SKY-default search, 2×4 deck + AIM/PLC, minimap→MAP window, MY LOC rework, GOTO chips + below-horizon, DISABLE menu labels + ∠ DIRECTION, FIND sun/moon-covers-target, SAVE VIEW name sheet, nearest-first, METEORS card in plan caption, day steppers, meteor rate trace, /m chip inventory + ▲3D, 6-step gestures, trust override clause) + **7 NEW topics** `fpv-map`·`fpv-height`·`target-radar`·`target-unfollow`·`plan-meteors`·`save-onmap`·`mobile-map` + 3 new goals; `shell-m.webp` RE-SHOT (the 2D-first chart + radar bearings, 360×783 cwebp q82). (4) **GUIDE SEARCH** (owner "efficient + fuzzy"): `lib/guide/search.ts` — BM25 (k1 1.4 · b 0.6, field weights title 3.5/where 2/tip 1.5/steps·body 1, goals folded onto targets) over topic+chapter docs, query tokens expand exact→prefix→Damerau-Levenshtein ≤2 (reuses `normalizeSky`/`editDistance` from sky searchIndex), coverage-weighted scoring, ~90-char snippets; rail UI in `Guide.tsx` (.gd-search/.gd-hit, Esc clears query first) + index-view UI in `GuideSheet.tsx` (.m-gsearch/.m-ghit); "metor shwoer"→METEORS №1, "unfolow"→UNFOLLOW browser-proven. Gates **vitest 1,073/1,073** (+11 `guideSearch.test.ts`) · astro 0 err/5 hints · both shells + /guide CDP-verified (shots plux-01..03). **Tails:** stale desktop guide shots orbit/plan/skymenu/target/fpv need a warm-cache re-shoot (dev Esri stream too cold this session); social-cover.jpg still pre-Plux; release BLOCKED on the domain fix. Memory: `mem:project/wip-2026-08-19-plux-launch-grooming`.

- **2026-08-19c · OWNER UX BATCH #3 SHIPPED (all 9 announced items + 2 batch-#2 tails; investigate-design-v3 implement/Deep, 4-agent cited fan-out).** (1) desktop toggles → **2 rows × 4** (camera-tilt.css `.ct-row` flex→grid `repeat(4, minmax(0,1fr))`, compass = cell 1 `justify-self:center`; supersedes the 2026-08-14 qol3 single-row rule; zero JSX change). (2) desktop radar **<10 km only**: AIMCONES gains `desktopFullAltM 8_000/desktopTopAltM 10_000`; aimCones.update ctx gains `band` and stepAimCones passes it shell-aware (`isMobileShell` keeps 25/50 km — /m's fullscreen 2D map is the planning surface). (3) **MY-PLACES-ON-MAP DESKTOP BUG — root-caused + fixed**: the camera-tilt lit rule never listed `.ct-aim.is-on/.ct-places.is-on` → PLC/AIM always LOOKED off → the owner's "enable" click actually persisted `savedPlacesOnMap:false` (CSS rule extended); + markers existed on the 2D MapWindow ONLY → new GL scene module **`scene/placeMarkers.ts`** (instanced camera-facing lavender ring-dot, PLACEMARKS tunables, Pins camera-anchor precision + resnap idiom, CPU far-hemisphere cull because depthTest:false, no picking) wired in StylizedTiles (attach + pins-slot step + idle-kicked `ensureLoaded` at `PLACEMARKS.fetchIdleMs` 3.5 s so the MAIN view loads places without the map window); + batch-#2 tail closed: `places.addLocal/removeLocal` — both save paths push the just-saved place (POST `{placeId}` + client-built row), MyPins delete drops it live. (4) **UNFOLLOW also stands down its FIND body**: `sky.stopFollowing` calls `find.setBody(body:sun→"sun"/body:moon→"moon"/else "target", false)` (the targetIsBody mapping; `find.open` untouched — other bodies keep scanning). (5) /m **⊞ LAYERS expands LEFT**: LayersChip wrapped in `.m-layersrow` (`flex-flow: row-reverse wrap-reverse`, anchor DOM-first so it never moves; overflow wraps ABOVE; max-width 100vw−1.5rem). (6) **RADAR BEARINGS REGRESSION root-caused** (owner: only moon line, sun + cyan target gone): TWO persistence traps from 2026-08-19b — (a) `stopFollowing` PERSISTED `skyTargetVisible:false` (boot restored SHOW-off; the new `&&visible` aim gate then killed the cyan line "tracked or not") → dismissal now **SESSION-ONLY** (mirrors `track`); (b) the un-labelled "DISABLE DIRECTION" row could flip the WRONG body's aim flag while that body was tracked (pickSkyBody coincident-candidate tie) → row now NAMES the body ("DISABLE SUN DIRECTION"); + **one-time prefs re-arm**: `prefsRev` stamp (saveViewPref writes rev 2; sanitize drops persisted FALSE for aimSun/aimMoon/aimTarget/skyTargetVisible from un-stamped blobs — deliberate offs re-persist stamped; comet-era `cometVisible:false` blobs lose SHOW-off once, accepted). (7) places lists **nearest-first**: new pure `lib/geo/proximity.ts` (`roughDistDeg2` equirectangular deg², wrap + cos-mid-lat; stable `sortByProximity`) applied at BOTH fetch sites (MyPins PLACES tab + MobilePlaces), position = `camGeo ?? focus`, sorted once per fetch (no reshuffle under the reader). (8) /m SAVE VIEW **optional name ask**: SavePlaceChip idle→naming→busy 3-state (desktop parity); naming = a small `Sheet` **portaled to `<body>`** (the `.m-actions` z-10 stacking context sits exactly where the soft keyboard lands — the sheet idiom is the shell's one keyboard-safe input home); empty submit keeps the `View · <stamp>` auto title; supersedes the 2026-08-15 auto-title-only ruling. (9) **GOTO tracked-target chip both shells**: BodyChip strip extracted FpvHud→**`panels/SkyGotoChips.tsx`** (desktop renders it from FpvHud unchanged — every-mode S6 rule; /m mounts the island in m.astro per the MiniMap fence-exemption precedent, self-gated to FPV — the 2D map has no sky; `body.m` thumb-size CSS + bottom-clamp 190px clears joystick/peek); **below-horizon** (tracked target ONLY — ☀/☾ keep hiding): chip stays dimmed `.fh-chip--down`, click aims at the **next-rise azimuth** via new pure `nextRiseAzimuth` (lib/ephemeris/dayArc: first ≤0→>0 crossing over targetElevationSeries 48 h, wrap-aware az lerp; null → current az at horizon; computed ON CLICK, never per frame); /m target-chip tap = aim only (no sheet — it would cover the view just asked for). DEV seams added: `__placesStore` (+ global.d.ts). Gates **1,062/1,062 vitest (97 files; +2: proximity ×5, dayArc nextRise ×3, prefs re-arm reworked) · astro 0 err/5 hints**; browser-VERIFIED BOTH shells over the owner's CDP Chrome (attach note: foreign :9222 lacks occlusion flags — `page.bringToFront()` un-throttles rAF; shots verify-shots/uxb3-01..07: desktop 2×4 grid + lit PLC/AIM + GL place dots · 6.5 km radar with ALL THREE lines (amber sun/white moon/cyan PER) · 29.8 km radar-gone · /m LAYERS-left wrap · /m FPV goto chips · goto tap → heading 181→313° pitch→48° `inFrame:true` · /m SAVE VIEW naming sheet; desktop goto click heading 48→313° tilt 88° raise-cap). UNVERIFIED-browser (unit-tested/low-risk): below-horizon chip click path end-to-end (PER is circumpolar from Dnipro — no settable down-target in the harness) · member-server save success (fake client member → server 401 by design). Open tails: FPV mini-map saved-place markers (GL globe + 2D map now covered) · bright-target FIND visibility refinement · owner taste pass (LAYERS toggle order, chip glyphs, savename sheet height) · batch rides the standing production canary.

- **2026-08-19b · OWNER UX BATCH #2 SHIPPED (all 11 announced items, quick-wins→big).** (1) `bldgOverrides.ts` OVERRIDES_CAP 200→**1000** (== SYNC_MAX platform bulk cap — never past; comment twinned in overrideRecords.ts). (2) /m collapsed mini-map puck: the `▣` glyph (read as a blank white square) → inline folded-map SVG + accent "you" dot (`MiniMap.tsx` + mini-map.css `.mm-glyph*`; NavChip SVG idiom). (3) `MobileTimeDock` compact ◀ ▶ day steppers flanking the calendar (desktop `.ts-day` parity, same 86_400_000 literal; `.md-day` in dock.css). (4) fullscreen-map walk controls: `MapWindow` sets `body.mw-open` while open → `.m-joy`+`.m-altcol` z 10→**24** (map 20, sheets 30 — fpv.css rung documented; joystick store path was NEVER gated, pure paint/pointer occlusion; elementFromPoint-proven). (5) desktop Esc ladder: new rung in StylizedTiles `onFpvKey` after bldgArmed — `mapWindowOpen` consumes the Esc (MapWindow's own bubble listener double-closes, idempotent; browser-proven Esc1 closes map only/Esc2 exits FPV). (6) search default EARTH→**SKY** both shells (LocationFinder/MobileSearch `useState("sky")`; catalog stays lazy — desktop warms on input FOCUS, /m on sheet mount). (7) sky-menu labels: ALL "X OFF" action labels → "DISABLE X" (6 items) + the FIND IN FRAME state bug FIXED — `findOn` was `bodies[b]` alone while `bodies.moon` defaults TRUE with the surface closed (nothing scans/renders → fresh-session menu read "OFF" = the owner's "inverted" report); now `find.open && bodies[b]` (SkyContextMenu.tsx:122). (8) **UNFOLLOW verb** (owner "stop following"): `sky.stopFollowing()` = SHOW off + camera-lock off, target KEPT (non-nullable contract; +test/store/sky.test.ts); warn-tinted ✕ UNFOLLOW row in both target surfaces; TargetPeek + tp-root pill now GATE on `visible` (`!visible && !open` desktop — SHOW-off inside the open panel is never a one-way door) and the U4 aim TARGET line gates on `visible` too (StylizedTiles + MapWindow) — dismissed = gone everywhere; peek pull-up hint: the bare "▲" → own `.m-peek__more` accent element w/ nudge loop (reduced-motion opt-out) + "— open details" aria. (9) SECTION REORDER both shells: SHOW/MARK/TRAIL/GHOSTS/TRACK pills + ghost row + UNFOLLOW moved to RIGHT AFTER the live essentials, BEFORE next-sessions (TargetSheet + TargetPanel; pills before the per-kind fact cards — the literal "first essential details" reading; `.tp-toggles` margin-top 6px). (10) FIND-IN-FRAME GENERIC TARGET: `FindBody` "gc"→**"target"** = the LIVE tracked target (engine was already sampler-injected — frameFinder type + the gc visibility branch now covers ANY target [dark-sky simplification: bright planets read conservative — known tail]; store default `{sun:false, moon:true, target:false}`; both panels sample `targetAzAlt(sky.target,…)` w/ target in the memo deps, chips resolve glyph/name live via kindGlyph/targetShortName, `targetIsBody` guard skips the dup when sun/moon IS tracked; jumps/ghost-clicks no-op the setTarget for "target"; SkyContextMenu offers FIND for ANY tracked target — `dso:gc` de-specialised; findGhosts kind-2 diamond + no-day-arc + `gcMarkDeg` keep historic names; findPalette/tests/guide renamed). (11) **⊞ LAYERS /m + desktop parity + MY-PLACES-ON-MAP (new feature)**: SceneActions LayersChip absorbs the standalone ▦ 3D DETAIL chip and expands {▦ 3D DETAIL (2D-disabled) · ◎ MY PLACES · ⌖ PHOTO PINS · ∠ RADAR}; new prefs `aimVisible` (RADAR master over the WHOLE U4 overlay — `enabled && aimVisible` in stepAimCones + aimBodiesNow early-return; desktop AIM chip) + `savedPlacesOnMap` (new `store/places.ts`: lazy single-flight fetch of /api/places on map open, 401=final-empty — anonymous never hammers; markers drawn in MapWindow as the temp-pin ring at `tokens.pinLavender`, +store subscribe for async repaint; desktop PLC chip in the ct-row); `pinsVisible` /m default OFF via shell-aware default in store/camera (location.pathname === "/m"; the shared key still wins once set anywhere). Guide: FIND chips prose + mobile scene-chips topic refreshed. Gates **1,052/1,052 vitest (96 files; +4: sky store ×3, prefs ×1) · astro 0 err/5 hints**; browser-VERIFIED BOTH shells via verify-chrome headless + Playwright-over-CDP (store seams; shots verify-shots/uxb2-01..05: desktop panel reorder+chips, /m LAYERS+steppers, /m sheet reorder+UNFOLLOW, /m map glyph, joystick-over-fullscreen-map; probes: fresh-session menu labels, DISABLE forms, generic-target menu row, find target-chip publish, Esc1/Esc2 ladder, UNFOLLOW state+DOM, +1d stepper, /m pins default OFF). TRAP (harness): piping `wix dev` through `head` SIGPIPE-kills it minutes later — run it unpiped in background. Open tails: GL-globe + minimap saved-place markers (2D MapWindow only this round) · a just-saved place appears on the map after reload only (no push into placesMap) · bright-target FIND visibility refinement · owner taste pass (glyph/labels/UNFOLLOW wording, day-stepper ▶ sits next to play's ▶) · this batch rides the standing production canary.
- **2026-08-19 · U8 PER-BUILDING HEIGHT OVERRIDE SHIPPED (owner point 10 + same-day additions: solid-original + semi-transparent ghost juxtaposition, mesh-pinned dual-height indicator, 0.5×/3× per-edit band, backend prepared for the batch-sync phase).** (1) STORE `src/lib/globe/bldgOverrides.ts` (+37-test twin): capped map under NEW key `ftw:bldg-overrides:v1` (cap 200, oldest-`t` trim; NOT the prefs blob — sanitize would destroy it), key `variant|cellUri|featureId` + pristine X/Z-centroid checksum (0.5 m grid, ±1.5 m tolerance + vert count; tilesetVersion deliberately excluded), value = height SCALE vs baked; owner band `clampEditK` = per-edit [0.5×, 3×] of the edit-start height ∩ absolute rail [0.1, 10]; `dragScaleK` px→scale (gain ∝ camera distance); `unsyncedEntries`/`markSynced` pre-wired for the sync phase. (2) ENGINE `scene/enrichedBuildings.ts`: pristine per-run capture at load-model (baseY/topY/centroid — BEFORE any seat write), `pickBuilding` (non-indexed `face.a` = direct vertex index, three-source-verified; binary search `runIndexOfVertex` added to enrichedMask + tests; height floor 2.5 m skips o2w fences), override = SCALE ABOUT THE LIVE BASE folded INTO `applyFeatureSeats` (commutes with the seat's `+= dy`; edge CSR co-mutated; epoch bump → skyline/occlusion re-profile free; LRU reload re-applies via opts.overrides w/ checksum invalidation), ghost = run geometry rebased to base-at-0 so the whole drag is `scale.y` (MeshBasicMaterial accent 0.45, depthTest OFF, XZ inflate 1.015; **TRAP: ghost children need their OWN `updateMatrixWorld(true)` on show AND every scale write — the TilesGroup no-recurse trap struck again; browser-caught invisible ghost, label was right**), armed tint = raw `_feature_id_0` varying vs `uFtwArmedId` (vFtwBId is seed-polluted — never compare it) + committed tint via lazy `_ftw_override` Uint8 attr (three zero-fills absent attrs — the `_batchid` precedent; OSM instance untouched). (3) GESTURES StylizedTiles: desktop FPV dblclick was a FREE SLOT (dropTempPinAt FPV-inert) → arms; glass double-tap detector in the FPV tap path (ORCH.doubleTapMs 320/32 px — browser dblclick never synthesizes on the canvas); drag = claimed-pointer branch BEFORE the look math (pinch precedent; yaw browser-proven pinned); Esc slots after skyMenu/before FPV unwind; tap-away/FPV-exit/BLD-off disarm; second fingers ignored while armed (explicit no-pinch-mid-edit). (4) CHROME: `store/bldgEdit` (deadband armed mirror + RESET one-shot), `scene/bldgEditLabel.ts` mesh-pinned dual-height label (geoLabels pooled-DOM discipline, per-frame), `panels/BuildingEditChip` ONE island both shells (SkyContextMenu precedent) + `styles/building-edit.css` (desktop bottom 11rem — scrubber overlap browser-caught; /m 10rem compact, hints dropped); stepBldgEdit in the scenery band. (5) BAKER: `overpass.mjs` carries `w<id>`/`r<id>#<ring>`, both bakers emit `cell-*.meta.json` sidecars (featureId→osmId+heights/cls; NEVER in `_FEATURE_ID_0` — float32 tops at 2^24, way ids ~10^9; o2w reads its own `extras.osmId`) — next re-bake upgrades override keys to stable OSM ids. (6) BACKEND PREP (next phase = "sync all local changes" button; persisted rows apply for ALL users, any member may override): `lib/wix/overrideRecords.ts` (+15-test twin) — LWW ONE row per building, `_id` = FNV-1a-128 of the key (bulkSave upserts by `_id`, d.ts-verified; 1000 cap mirrored; server re-clamps; variant validated vs regions registry), NO coordinates stored (bake-local checksum only) + memberId never public (C6); thin `/api/building-overrides` (GET public per-variant / POST member bulkSave+bulkRemove); `BuildingOverrides` entry in provision-collections.mjs (ADMIN-all; run it when the sync phase starts). Gates **1,048/1,048 vitest (+21) · astro 0 err/5 hints**; browser-VERIFIED both shells via NEW `scripts/verify-bldg-override.mjs` (arm→drag(ghost, yaw pinned)→commit 3.00× clamped exactly→RESET→Esc-keeps-FPV→reload re-apply→/m double-tap+touch-drag; shots verify-shots/u8-01..06). C6: overrides local-only this phase, zero coordinates in rows.
- **2026-08-18r · OWNER IN-SCENE VERDICT on U7b: POSITIVE** ("looks and feels really good, new height is really accurate and amazing in Dnipro") — the terrain taste-pass tail CLOSES; Appendix A #2 (WorldDEM Neo 5 m) now has its judged-in-scene input but stays DEFER (no purchase order). Owner orders: ship now (manual invoke of the session-end pipeline), next session = U8 per-building height override, and AFTER U8 a new owner batch of minor-to-medium improvements + UX fixes is incoming (planning heads-up recorded in NEXT_SESSION_PROMPT).
- **2026-08-18q · BAKED_ASSETS.md authored (owner ask)** — the canonical baked-assets domain doc: the three bake families (extruder / o2w / terrain) + final rulings ledger (buildings best-variant-by-default + the 8 terrain rulings, all dated), the terrain pipeline stage-by-stage with receipts, the runtime composite mechanics, the `regions.ts` registry contract + add-a-city runbook, ops (env/caching/budgets/canary/traps), the GLO-30 aux-layer table (WBM water mask ~140 KB/tile cached — future river flattening via the splice idiom, exact water styling, across-water planning hints; HEM/EDM/FLM), and upgrade paths (WorldDEM Neo gate, dormant L14 clause, cross-region live attach tail). ARCHITECTURE §7 refreshed (terrainPatch/regions/terrainTiles/scripts-bake-terrain rows + doc pointers; the stale "bbox must equal tuning.ts ENRICHED.bbox" coupling now points at regions.ts). Docs-only — gates unchanged.
- **2026-08-18p · U7b GLO-30 TERRAIN PATCH SHIPPED (owner approved Appendix A #1, pulled ahead of U8) + BEST-VARIANT-BY-DEFAULT buildings rule.** (1) BAKE: new `scripts/bake/terrain/` (tiling/qmesh/glo30/geoid/cwt/blend + `bake-terrain.mjs`; `npm run bake:terrain -- --city dnipro`): GLO-30 COGs fetched anonymous from AWS Open Data (2×1° N48/E034+E035, WBM water masks cached alongside for later) → mago-3d-terrainer 1.14.2 jar (Java 21, sha256-pinned, `--geoid EGM2008` built-in shift → ELLIPSOIDAL heights = CWT datum; NEVER rewrite rasters in Node — geotiff.js's writer emitted geo-tags mago ignored, landing the mosaic at −180/90: run-1 failure) → POST-BAKE RIM BLEND (blend.mjs: verts within 3 km of the extent edge pulled onto the DECODED CWT surface, w=smoothstep — 19,045 verts/535 tiles; splice rewrites ONLY h-stream+header min/max) → layer.json post (Copernicus attribution + serve-set⊆availability assert) → probe verify (city-centre Δ 0.2 m, extent-mid Δ −0.7 m vs COG+geoid-grid twin; rim Δ −0.5 m vs CWT). mago SILENTLY CLAMPS maxDepth to its 30 m heuristic → L13 shipped (64-seg posting 38×25 m ≈ GLO-30 native 31×21 m; asked-14 ruling recorded in cities/dnipro.json). Output 7,329 files · 10.97 MB → R2 `terrain/dnipro/` (upload-r2.mjs `--terrain` mode: recursive walk + `.terrain` content-type application/vnd.quantized-mesh in s3sign; Worker needed ZERO changes — path-agnostic). (2) RUNTIME COMPOSITE (single-renderer, NO second terrain renderer): new `scene/terrainPatch.ts` wraps the QuantizedMeshPlugin instance's `createChild` (0.4.28 source-verified: `available` = ranges ARRAY passed through untouched; expandChildren counts forced `content.uri` as real children → quadtree descends past CWT's L13 over UA for free; out-of-set siblings stay virtual-clipped from the shared parent = the library's own seam machinery + skirts) + a `fetchData` claimer at priority −500 (between QMP −1000 and ion 0: plain fetch, ion Bearer never reaches R2; ion's ?v= append harmless — Worker keys on pathname). Serve-set rule PURE + TWINNED: `lib/geo/terrainTiles.ts` ⇄ `scripts/bake/terrain/tiling.mjs`, pinned by test/lib/geo/terrainTiles.test.ts parity; z≤extentMaxDepth → fully-inside extent (straddlers keep CWT — the rim blend makes same-level neighbours meet), z>extentMaxDepth → city-bbox intersect (dormant at 13==13), z>maxDepth → virtual upsampling. Missing tile → dead leaf, parent renders (no retry) — graceful by construction; the bake assert makes it unreachable. heightAt/imagery drape/grade/fades/foveation/seat-easing ALL untouched (one renderer). Env `PUBLIC_TERRAIN_TILES_URL` (R2 /terrain base; dev `/terrain` via the extended astro.config middleware) — unset = pure CWT byte-identical. NO user control (owner: "he should not have a choice"); C6: 30 m native per the standing ruling. (3) BEST-VARIANT RULE: new registry `lib/globe/regions.ts` (bundled pure data — zero fetch, O(1) point-in-bbox; dnipro [o2w best, classic fallback, terrain patch] + st-albans [o2w]; invariants tested) replaces tuning ENRICHED.bbox/variantBboxes; `resolveEnrichedSelection` (rewritten enrichedVariant.ts) returns URL+bbox+region from ONE call (the two-resolver sync trap closed), defaults to the BOOT-POINT region's best variant (a #p/#f share into St Albans boots ITS o2w — upgrade over the old param-only path), `?enriched=` stays as the dev seam (off/name/verbatim). BLD (desktop) + ▦ 3D DETAIL (/m) are now a plain LIVE on/off — new pref+store `buildings3d` (default ON) composed into the U1 gate (`stepMobileBuildingsGate`, now both shells; desktop pref-ON = byte-identical); `enrichedVariant` pref RETIRED (sanitize drops stale keys); reload mechanic GONE from the chips. Guide copy updated both shells; Copernicus attribution added to index.astro credit line + baked layer.json (licence: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA"). (4) EXTRAS memo: horizon profiles/planFeed upgrade AUTOMATICALLY (they march rendered heightAt — no code change); WBM cached for future river-flattening; HEM/hillshade/contours derivable from the same cached COGs at bake time — all deferred. MEASURED (browser, refined-state gated — v1 of the verify script asserted while only coarse ancestors were parsed, a vacuous pass; scripts/verify-terrain-patch.mjs now gates on deep-tile URLs + stable city sample): city heightAt 120.4 (CWT fiction) → **85.9 m**, river transect min 88–94 (CWT) → **68.9 m** (GLO-30 band, the U7 +33 m river error GONE), 66 patch tiles/0 failures, o2w tileset streamed with NO param, BLD live toggle scene 33→31→33, /m twin flips, 34.0°E seam shot clean (no step/wall, daytime). Files: scripts/bake/terrain/* (7 new) + upload-r2/s3sign/astro.config/package.json + scene/terrainPatch.ts + imageryGround (hook + fetch plugin wiring) + StylizedTiles (regions boot + terrainPatch attach + gate) + regions.ts/terrainTiles.ts/enrichedVariant.ts/prefs/camera-store + CameraTiltPanel/SceneActions/guideContent/index.astro + scripts/verify-terrain-patch.mjs; tests: terrainTiles (parity+serve-set) + regions + enrichedVariant rewrite + prefs. Gates **vitest 1,027/1,027 · astro 0 err/5 hints**; browser-verified BOTH shells (shots verify-shots/u7b-01..04). Env files updated local+prod values; R2 upload curl-verified (7,329 files, layer.json + tiles 200, correct content-type). Open: production canary rides the next `wix release` (with B1) — R2 CORS already proven for enriched, same Worker; owner taste pass on the patch in-scene; U8 next.

- **2026-08-18o-u6-foveation+u7-terrain-audit:** **U6 SHIPPED** (owner point 8, mobile-first) —
  LoadRegionPlugin foveation per buildings/enriched/ground renderer: range-capped
  `RangedRayRegion` along the FPV look + eye `SphereRegion`, updated in `stepViewFocus` beside
  the U5 aim (one seam); tier lever `QUALITY.tiers[tier].foveation` (null on high = the
  byte-identical invariant carries "desktop unchanged"; mid 1400/160 m ×1.5, low 900/110 m ×1.6);
  region errorTargets are GEOMETRIC-ERROR METRES (`FOVEATION.regionErrorTargetM` 8/4/2 —
  0.4.28 source: refine while geometricError > regionET, distance-independent, max-merge with
  camera error ⇒ regions only TIGHTEN, so the periphery win rides the BASE errorTarget via pure
  `quality.peripheryErrorTarget`; GROUND's base NEVER relaxes — it seats heightAt — ground gets
  additive regions only); regions authored group-local via `group.matrixWorldInverse` (enriched
  seat lift handled). Files: `lib/globe/quality.ts` (+FoveationTierCfg/peripheryErrorTarget) ·
  `tuning.ts` (FOVEATION + tiers.foveation) · NEW `scene/tileFoveation.ts` ·
  buildings/enrichedBuildings/imageryGround (setFoveation/setFoveaActive/setFoveaPose/
  foveaSnapshot; base-ET one-writer recompute) · StylizedTiles (fan-out + boundary flip + pose +
  DEV `__globe.u6()`) · quality.test.ts (+9). **Found en route:** upstream 0.4.28
  ImageOverlayPlugin `tile-visibility-change` reads `tileInfo.get(tile).range` UNGUARDED
  (:230) — tile disposed mid-fade TypeErrors on fade-complete; U6 region flips hit it reliably;
  guarded listener swap shipped in imageryGround.ts (T33, re-verify on bump) · pre-existing
  planner.ts:76 Observer elevation has no ceiling (astronomy-engine throws >100 km; /m
  browser-caught, non-fatal via B26 logger) → T32 · T29 extraction trigger FIRED (all three
  modules touched + a 4th repeated pattern) — deferred to its own slice. **Verified:** gates
  1,022/1,022 vitest (+9) · astro 0 err/5 hints · browser BOTH shells (CDP-attach to the
  owner's :9222 Chrome; OS-occlusion rAF-freeze twice defeated via CDP window raise + in-page
  rAF assertions): high orbit byte-identical (cfg null, base 16) · mid FPV engaged ×3 (base
  24→36, ground base untouched at ramp, aim k=1.5 composing) · boundary matrix enter/exit/
  tier-flap ×4 mid-FPV clean, zero overlay TypeErrors post-guard · steady-state foveated FPV
  0 hitches/8 s, EMA 16.7 ms, 60 fps, queues drained · /m 2D boot off → FPV engaged → exit
  lands 2D disengaged (parked governor step applied at exit, correct) · warm-cache
  firstAfterMark at mid-FPV entry: enriched ~185–221 ms, ground ~528–624 ms, buildings
  ~1,129–1,268 ms (local saturates — cold-network/weak-device feel rides T1, incl. periphery
  softness taste §4 Q3). Shots `verify-shots/u6-01..03`. **U7 AUDIT DONE** (owner point 9) —
  measured: CWT over Dnipro = max L13, leaf meshes 4-VERTEX QUADS city-wide (9/9 tiles; L10=9v;
  Interlaken 1,250v / Warsaw 489 / Berlin 668 / Rotterdam 451 vs Kyiv/Kharkiv/Lviv/Odesa/
  Rostov/Minsk ALL 4v — the fine source ends at the EU-DEM/EEA39 border) ⇒ ≈2 km effective
  posting, +13…58 m landmark errors vs SRTM30, R6's "SRTM 30 m ceiling" optimistic by ~50×;
  app `heightAt` 120.4 m == a decoded quad corner (exact — rendered terrain IS these quads).
  Source scan (web scout, cited): GLO-30 free+commercial = the step-change; FABDEM
  licence-blocked; WorldDEM Neo 5 m ≈$3.5–5.5k/400 km² archive; Maxar ≈$16k; UA state geodata
  closed under martial law (C6). **Decision memo → UPLIFT_PLAN Appendix A**; owner calls OPEN
  non-blocking (GLO-30 bake approval [default yes, after U8] · Neo purchase [defer] · C6 patch
  precision [30 m native] · Esri imagery licence rider [carried]). Next slice: U8 height
  overrides. Memory `mem:project/wip-2026-08-18-u6-foveation`; globe-tuning.md +LoadRegion/
  overlay traps; backlog +T32/T33, T29 re-dated.
- **2026-08-18n-unpark-uplift (owner ruling):** *"fully ready to unpark main uplift plan and
  proceed with U6 and U7"* — the audit-2 fix phase is CLOSED (slice 8's phase-done call answered;
  remaining slice-8 riders stay open as ordinary tails: B1 canary on next release · T28/T29 ·
  B4/T30 · T1 device pass). UPLIFT_PLAN status → ACTIVE, order U6 foveation (LoadRegionPlugin
  RayRegion + SphereRegion, compose with U5 `loadAim`, tier radii in QUALITY.tiers — §1.4 APIs)
  → U7 terrain audit (CWT measure · source scan incl. UA/C6-sensitive options · possible R2
  patch; Esri licensed-source decision rides it) → U8 → P8/P9 → M4. NSP rewritten as the U6+U7
  build brief. Files: UPLIFT_PLAN.md status · NEXT_SESSION_PROMPT.md · mem:core Next step.
- **2026-08-18m-harness-hooks (owner orders ×3, same session as 18l):** **(a) CDP Chrome is
  session-START state, never session-end cleanup** — the owner keeps a PERSISTENT Chrome on
  :9222 via the zsh alias `chrome-playwright` (`--user-data-dir=~/Playwright_Chrome_data`, no
  occlusion flags). `activate-serena.sh` now probes :9222 at boot and emits step 7: attach
  (Playwright MCP `--cdp-endpoint`) / foreign-owner warning / not-running guidance — and the
  standing rule **NEVER kill it** (killing it disconnects the Playwright MCP irrecoverably —
  learned live 2026-08-18l). `scripts/verify-chrome.mjs` flipped to REUSE-by-default on the
  verify profile (unflagged instance → attach + bringToFront/rAF-tick caveat; `--kill-stale`
  demoted to explicit override). **(b) session-end dev-server reap** — `session-end-ship.sh`
  `kill_dev_servers()`: TERM→KILL every `wix dev`/`astro dev`/npm-wrapper process whose **cwd
  is this repo** (other projects' servers untouched), runs BEFORE the ship gates so it fires
  even on an aborted ship; DRY_RUN logs only. Rationale: leftover dev trees squat :4321 and
  confuse the next session (the 18l checkOrigin trial initially hit a stale pre-config server).
  **(c) ship-now** — this commit itself pushed via the ship pipeline on owner order rather than
  waiting for SessionEnd. Files: `.claude/hooks/activate-serena.sh` · `.claude/hooks/
  session-end-ship.sh` · `scripts/verify-chrome.mjs`. Gates re-run green (1,013/1,013 · astro
  0 err/5 hints); hook dry-run + boot-hook demo verified. Memory: dev_environment +
  session-end-autoship updated.
- **2026-08-18l-audit2-fixslices (AUDIT #2 FIX SLICES 1–7 ALL WORKED in one session; /frame +
  investigate-design-v3 implement mode. Gates 1,013/1,013 vitest (86→91 files, +24 tests) ·
  astro 0 err/5 hints · browser tier via NEW scripts/verify-chrome.mjs + raw-CDP.)**
  **S1 · A1 MAJOR:** aim-cone terrain seat clamped — the seat ease extracted to pure exported
  `easeSeatM` (scene/aimCones.ts) with `clampGroundM` INSIDE it (null keeps seat · first CLAMPED
  sample snaps · ease can't be steered below 0); 6-test twin `test/components/globe/aimCones.test.ts`;
  browser-proven: numeric probe seat +11.2 m / clamped probe +19.5 m at street-level Dnipro +
  shot `verify-shots/audit2-s1-aimcone-seat.jpeg` (NEW regression script
  `scripts/verify-aimcone-seat.mjs`). C3 ride-alongs: dayArcs (horizonFade/pointDirs) + glsl
  (glf/glf3 incl. 1e-7 exponent pin) twins; C7 streetNames comment → textPxTarget.
  **S2 · B1 MAJOR RULING — `checkOrigin: true` KEPT (astro.config.mjs):** the planned dev trial
  is STRUCTURALLY INERT — Astro 5.18 dev composes the injected @wix/astro middleware directly and
  bypasses the origin-check wrapper (render-context.js:101; empirically confirmed: cross-site form
  POST → 200 in dev). Prod-side compatibility proven by construction: own writes = same-origin
  JSON (exempt), auth = GET-only OAuth redirects, checkout returns = GET, TUS = Wix-domain. Real
  defence gained: blocks the text/plain-enctype JSON-body CSRF that `request.json()` parses.
  LANDMINE documented (wix-headless.md §12b): webhook/service-plugin extensions would be 403'd —
  zero registered today; revisit if one ships. Canary rides the next release (T2/T3).
  **S3 · docs core:** DECISIONS **compaction round 3** — 2026-08-02→08-15e (147,274 B) moved
  byte-identical to ARCHIVE §Moved 2026-08-18 (md5-proven both sides), 7 era digests + sentinel;
  hot file 206→66 KB (a naive boot Read now spans it — F1's real fix). F1 boot-hook text: NSP +
  mem:core first, DECISIONS read PAGED. D3 README (1,004/89 dated + U1–U5/P7 status clause).
  D1 ARCHITECTURE §4/§7 as-built 2026-08-18 (all 9 missing files + U1 2D-first + guide.astro
  2026-08-15e git-dated). D12 PLANNING_QOL_PLAN + GUIDE_PLAN → archive/ (G3 folded into T28;
  refs repointed). D8 UPLIFT:22 pointer fixed. D9 memories: system-overview (no Listings; 8
  routes; Phase-7-out), sky-bodies-terrain in-place PARTIALLY-SUPERSEDED header, core era-index
  (+uplift/audit-2 rows, r3 header) · graph-health policy → mem:memory_maintenance (era rows per
  round · size caps 12/10/15 KB · keep wip leaves · SUPERSEDED headers).
  **S4 · conventions:** D4 naming ×3 (11 stores + skyAim helper · real EXIF fields per contracts
  §4 · SavedPlaces, no Listings) · C1+D5 testing-standards (real test/ dir map · **scene-test
  twin rule codified** · 402-wall supersession · seam list → contracts §3 · 9222-ownership trap ·
  verify-chrome/verify.md pointers) · D6 contracts §3 **sub-seam table** (8 rows, owner file:line:
  `__globe.fpv/plan/tempPin/explore/bodies/enrichedSeats/map2d/u2/u5/u5Mark`,
  `__quality.governor.emaMs/hitchCount`, `__quality.ao`) · D7 trap promotions (a-and-p:
  mirror-never-seats + panel-published-feed pattern; globe-tuning: raw-focusHit + 0.4.28
  internals + far-shell-ECEF note; DECISIONS §Traps +4 dated lines GL×2/Verification×2) · A6
  globe-tuning orchestrator note now COUNT-FREE (structure only) · **A3 RULING: rename** —
  `find._syncGhosts` → `publishGhosts` (4 files; `_` prefix stays orchestrator-only; code.md
  item 9 probe exception-free) · F4 CLAUDE.md (Phase-1 conditional dropped; AI clause annotated
  PARKED).
  **S5 · dead-code:** A4 de-exported 7 single-file types (AimDayKind/LatencySnapshot/GuideShell/
  GuideWhere/GuideTextRun/GuideLinkRun/SkyMenuInfo — knip re-run clean) + `@wix/dashboard`
  dropped from package.json (zero source refs; still hoisted via @wix/astro — resolution safe) ·
  A5 `dirAzAltDeg(dir, basis)` in lib/geo/projection.ts (three-free {x,y,z} shape), 4
  orchestrator sites folded incl. `dirToAzAltAtCamera`, 3-test round-trip twin vs cameraForward ·
  A2 ORDER header rewritten to producer→consumer BANDS + named cross-band constraints, ZERO
  counts (the twice-staled-counts lesson).
  **S6 · fences (audit-2 C2):** NEW test/components/globe/fences.test.ts — scene→store
  value-import fence (sanctioned: planFeed/minimapFeed; type-only allowed) · setClearColor
  zero-call fence · InstancedMesh.boundingSphere caching THREE regression (pins the trap that
  makes Pins.invalidateBounds necessary) — + test/styles/hiddenPairs.test.ts ([hidden]
  display-pair lint, pinchHardening idiom). C4 lazyContract comment (hoverNames = 2nd boot-safe
  module) · C5 azSector Dnipro-solstice vector cited (timeanddate.com). Backlog: T24 formula
  extended (set:html + server-islands route) · T1 scope-grew edit (U1–U5 device items) · NEW
  T28 (U-era + guide taste tails) T29 (tile-tier idiom seam) T30 (B7 GET/DELETE quota display)
  T31 (trap→test tail incl. the heightAt CONSUMER fence).
  **S7 · harness:** F2 NEW `scripts/verify-chrome.mjs` (foreign-owner error / stale-verify
  `--kill-stale` / 3 occlusion flags / CDP attach print; live-demoed this session) + NEW
  `conventions/verify.md` one-pager (recipe + 7 traps) + /frame Phase-3 pointer · F3
  session-end-ship.sh v3: `prune_stale_ship_branches` (containment proofs SHA-ancestor /
  tree==tip / tree@history; proof-failers ≥3 d REPORTED with evidence, never deleted —
  dry-run correctly flagged the known 08-13 M1-era branch) + `attention()` DEDUP + timeout
  entry re-verifies `ship_landed` first (the boot-rm race, observed 2×) + boot-hook
  late-re-check text · B3 bake stamps: 3 consumer modules hand-stamped git-dated
  (constellations 08-10 / bsc5 07-10 / openngc 08-10), 2 generators now EMIT `// Baked:` on
  regen, ne-labels 07-12 + landmask 07-11 header stamps, milkyway sharp note (deliberate
  non-dep). **Open (slice 8 = owner):** B1 canary ride · plan-archive ratify · T28/T29
  acceptance · B4/T30 display call · phase-done? → un-park U6 foveation. Memory:
  `mem:project/wip-2026-08-18-audit2-fixslices`.

- **2026-08-18k-audit2 (AUDIT #2 SHIPPED — whole-project expansion-readiness per owner order
  2026-08-18j; /frame Audit mode, tier Deep, READ-ONLY on src/+docs; report =
  `audits/audit-full-2026-08-18.md`.)** 4 parallel track finders (A code · B platform · C tests ·
  D docs/memory) + main-agent Tracks E (mechanical) and NEW F (harness, charter dim 4);
  verification pass **34 findings confirmed / 0 deleted** (FP ratchet 0%; B-4 reclassified as
  audit-1-B7 partial-fix status check). Gates: vitest 989/989 · astro 0 err/5 hints (= baseline) ·
  bundle 30 MB (= 33 − enriched-sample move) · prod npm-audit 9 (= baseline) · jscpd src 1.89% ·
  public/ 0 unreferenced. **TWO MAJORS: A1** — `scene/aimCones.ts:293` U4 terrain seat is the ONE
  unclamped `heightAt` consumer repo-wide (snap-then-ease retains coarse-LOD garbage; the audit-1
  Pins class again) · **B1** — `astro.config.mjs:39` `checkOrigin:false` has disabled Astro's CSRF
  origin check on all cookie-authed write routes since the Phase-1 scaffold with NO documented
  sanction (exploitability UNVERIFIED — Wix cookie SameSite unreachable locally; fix = trial
  `checkOrigin:true` + a dated ruling either way). 22 MINOR — dominated by doc/memory currency
  debt from the 31-entry burst: DECISIONS compaction **round 3 DUE** (hot file 206 KB, 71%
  closed-era verbatim; density now DEFEATS the boot hook's read instruction = harness finding F1) ·
  ARCHITECTURE §4/§7 nine files behind · PLANNING_QOL + GUIDE plans era-closed → archive ·
  conventions stale ×4 files (naming "real six"/phantom Listings, testing beforeInsert,
  globe-tuning counts) · contracts §3 misses the u5/u5Mark/emaMs/hitchCount/map2d/fpv sub-seams ·
  3 stale always-offered memories (system-overview Listings, core:178 ground-pipeline claim) ·
  verify recipe not runnable anywhere (F2 → propose `scripts/verify-chrome.mjs` +
  `conventions/verify.md`) · ship-hook stale-branch leak + SHIP_ATTENTION write race observed
  LIVE this session (F3). Clean: **C6 hop-trace PASS ×2 audits running** (incl. U3–U5 surfaces,
  zero egress probes) · T24 re-verified with formula extension (`set:html` in guide.astro is
  static+escaped; `/_server-islands/` route registered but zero components) · append-only ledger
  PROVEN (per-commit deleted-line probe; r2 byte-identical 162/163) · orchestrator
  HOLDING-MARGINAL (3,833 ln / 49 steps, +570 ln in 3 days; extraction ladder named:
  DEV-introspection ~200 ln + quality fan-out ~90 ln LOW-risk first → zoom-bank → FocusFrame →
  FPV controller ≈950 ln/25%; strangler = the attach-module idiom, one family per session) · U5
  lru/caps idiom ×3 = restraint-now with named seam `captureTileDefaults/applyTileTier` (T29) ·
  scene-test ruling RE-AFFIRMED narrowed: "pure islands exported/extracted + tested; attach/GL
  structure = browser tier" (to be codified in testing-standards, C1 — both owner-caught U4 bugs
  sat in that layer; the cheap guard is the C2 static-fence family). Step-2 re-mine applied
  PRE-tracks (dated): code.md items 20–22 (mirror-never-seats · raw-focusHit · 0.4.28 internals) +
  tests.md item 9 (CDP 9222/evaluate) + item-7 suite baseline re-dated (1.93–2.73 s @989,
  2026-08-18). 8 fix slices ordered in the report §Fix-session (1 = A1, 2 = B1 trial, 3 =
  compaction r3 + docs, 4 = conventions, 5 = dead-code, 6 = test fences + backlog rows T28–T31,
  7 = harness scripts/hooks, 8 = owner calls). Ship diff = checklists + report + this record only
  (audit purity PASS). Boot note: resolved SHIP_ATTENTION ×2 (the 12:58 file at boot; its 15:32
  race-recreation mid-session), deleted the tree-proven 08-13 ship branch, left the
  proof-failing M1-era one for F3's prune mechanism. Memory: `mem:project/wip-2026-08-18-audit2`.

- **2026-08-18j-park-audit2 (owner order: PARK the ladder, schedule AUDIT #2 — whole-project
  expansion-readiness).** Before any further UX/features/rendering/height/meshes work the
  owner wants the project verified ready for expansion on four dimensions — documentation,
  organization, architecture, code quality — explicitly NOT refactoring for its own sake:
  optimize/change/prune what the evidence supports; update conventions/tips/gotchas; refactor
  the memory graph; propose new session hooks + guardrails (skill/docs/CLAUDE.md). UPLIFT
  PARKED before U6 (durable note in UPLIFT_PLAN status; resume order U6→U7→U8→P8/P9→M4; T1
  unchanged). Next session = the /frame AUDIT mode, Deep, READ-ONLY, baseline = audit #1
  2026-08-13, deliverable `audits/audit-full-2026-08-18.md` + sliced fix plan. Charter with
  owner-dimension→track mapping + the seed inventory in NEXT_SESSION_PROMPT +
  `mem:project/audit2-2026-08-18-charter`. Seed numbers (2026-08-18): src 43,810 lines
  (StylizedTiles 3,833/41 steps · tuning 2,287 · comets 991 · guideContent 833 · enriched 740);
  100 memories (75 project/, mostly wip-*); DECISIONS 660 lines, 31 entries in the 5 days
  since audit #1; ARCHITECTURE §7 stale at 2026-08-15; 7 convention docs / 553 lines; tests
  86 files / 989; astro hints baseline 5; bundle baseline 33 MB (2026-08-13).

- **2026-08-18i-u4-round2 (owner: spoke colours + silver moon + the search-select camera jerk.
  Gates 989/989 · astro 0 err; browser-verified, shots `verify-shots/u4fix-03..04`.)**
  (a) The sector's rise/set RADIAL SPOKES now wear the BODY identity colour — sun sunGlow
  orange, moon silver, target accent — own `edges` LineSegments in the GL module (they left
  the past/future-split rim geometry: a visibility boundary is the body's claim, not the
  scrubber's) + separate arc-vs-spoke strokes in the MapWindow twin (`arcPath` no longer
  closes through the centre — also kills the old ring day-boundary seam). NEW globe token
  `tokens.moonDial` #DDE3EA — the moon's aim dial/spokes SILVER (moonlight's #BFD0E8 blue-grey
  sat too close to the textSecondary past grey); scene moonlight untouched. (b) SKY-search
  select no longer steers the camera: new `aimAtSkyFromSearch` policy (store/skyAim) — FPV
  keeps the look glide; otherwise NO re-aim ever (the old auto-aim raised tilt toward the
  horizon and the 2D locks visibly fought it back — the owner's "tilts to 3d, rotates, snaps
  back"). With a temp pin set it re-centres the PIN via a new `centerOnly` FlyRequest: a RIGID
  pose-preserving pan (position += target − rayHit, lookAt target; FLIGHT.reframeDurationMs).
  PROBE-CAUGHT during verify: the pan must subtract the RAW `focusHit`, NOT `_focus` — the
  temp-pin focus-lock overrides _focus to the pin, zeroing the delta (the flight degenerated
  to a rotate-in-place, tilt +19.7°). Verified: pin re-centre = 757 m translation with 0.01°
  quaternion change, tilt/heading mirrors exact; real-UI Vega select (SKY tab) = target swaps,
  0 m / 0.00° camera; /m MapWindow twin renders arcs+spokes correctly. Edge chips + sky-menu
  AIM CAMERA keep the explicit aimAtSky (a "look at it" button is an aim order; search isn't).

- **2026-08-18h-u4-aim-feedback (owner 4-issue U4 batch: aim-circle lag + styling + past colour
  + stuck FPV anchor. Gates 989/989 · astro 0 err; browser-verified both shells, shots
  `verify-shots/u4fix-01..02`.)** ROOT CAUSE of the lag AND the stuck anchor was ONE seam:
  stepAimCones/MapWindow consumed the PLAN-STORE anchor — a low-cadence panel mirror
  (`PLAN.mirrorEveryFrames` 12 ≈ 5 Hz, focus quantized 0.05° ≈ 5.5 km, FPV anchor chunked by
  `rebuildDistM` 25 m) whose lifecycle gate (`!build && !open → return`) STRANDS the last FPV
  anchor after exit with the panel closed. A mirror built for panel readouts must never be a
  per-frame geometric seat. Fix: resolve the eye-rule LIVE each frame at orchestrator level —
  photo placement > tempPin > THIS-frame `_focus` via one `ecefToGeodetic` (GL), and in
  MapWindow walking-viewer `camGeo` (fpvHud) > tempPin > camGeo > focus mirror — plan-store
  read DELETED from both. Zoom: the aim radius no longer eases (`radiusTauMs` now
  emphasis-swap-only) — `clamp(alt×0.35)` is continuous in alt, raw = lockstep with the wheel.
  Styling (owner): past sector amber → **tokens.textSecondary NEUTRAL grey** both surfaces
  (amber read as a day/night claim); `fillAlpha` 0.12 → 0.08; `lineHalfWidthK` 0.006 → 0.003
  (GL) / 2 dpr → 1 dpr (canvas); direction lines end EXACTLY at their circle rim except the
  FOCUSED body (`line.scale.y = 1 + (lineLenK−1)·emphK` — rides the emphasis ease, no pop).
  Line quad is now UNIT-length (tip at rim), stretched per-frame. Verified: 44-frame wheel
  zoom 1935→565 m radius glued to clamp (0/44 off), pin A→B moves 4.3 km (the stuck case),
  clear→live-focus 2.6 km, 30-step drag → anchor moved on every input event (was ≥12-frame
  stale); /m MapWindow circle centred ON the viewer marker. Tap-promote reach untouched
  (generous gate still covers ×1.0 lines).

- **2026-08-18g-u5-loading (UPLIFT U5 SHIPPED: closest-first progressive loading, owner point 7.
  Gates vitest 989/989 (+27) · astro 0 err/5 hints; browser-VERIFIED both shells, shots
  `verify-shots/u5-01..04`.)** Order + concurrency ONLY — every errorTarget untouched; browser
  proof: leg A/B at-rest scene is TILE-IDENTICAL (31 vis/39 cached buildings · 107/107 enriched ·
  314 ground; pixel-equivalent shots). Library facts source-verified on installed 0.4.28:
  `loadAncestors=false` ALONE flips a renderer onto `distancePriorityCallback`
  (optimizedLoadStrategy defaults true; TilesRendererBase.js:172-182), comparator contract
  "return 1 ⇒ a runs first" (items.sort then pop), tile fields live on `traversal.*`/`internal.*`
  (the old `__dunder`s are GONE in 0.4.28), queues are PER-INSTANCE (caps independent),
  `maxJobs`/`priorityCallback` are plain post-construction writes (ImageOverlayPlugin itself
  mutates maxJobs at runtime). Wiring: BUILDINGS + ENRICHED get `loadAncestors=false` + a custom
  download comparator (NEW pure `lib/globe/loadPriority.ts`, 21-test twin) that mirrors
  distancePriorityCallback term-for-term with the distance term swapped for
  `effDist = d/(1+k·max(0,look·toTile))` — k=`LOADING.fpvBiasK` 1.5, gated on fpvActive (orbit/2D
  = byte-identical library ordering; k=0 degenerates to it), per-tile per-frame memo via
  `aim.epoch` stamps; GROUND excluded BY CONSTRUCTION (heightAt seating + the reveal need the
  coarse ancestor stand-in). Aim state (`makeLoadAim`) refreshes inside stepViewFocus (fresh
  `_camFwd`, no new step). Queue caps ride the tier fan-out (`queueCapsForTier`, null-on-high
  like the LRU rule): high restores captured 25 dl/5 parse, mid 12/3, low 8/2 — live-verified
  via `__quality.force()` round-trip incl. U2 LRU pair intact. Instrumentation: governor grew
  `emaMs()`+`hitchCount()` (raw dt > `QUALITY.governor.hitchMs` 50; was closure-private) +
  per-renderer download→model latency probes (`makeTileLatencyProbe`; `tile-download-start` →
  `load-model`, `load-error` cancels; injected clock) + DEV seam `__globe.u5()`/`u5Mark()`
  (flags/aim/queue depths/stats/latency + time-to-first window). A/B numbers (M3 Pro, dev-local
  WARM cache — weak evidence, saturates in ~2 s): buildings initial-stream mean 376 ms max 540
  (leg A 428/677, ~-15%), enriched tail ~1.9 s (A ~2.17 s), ground statistically unchanged (by
  design); scripted 4 s FPV walk: 0 hitches BOTH legs, ~46-48 fps, EMA ~21 ms; /m: 2D boot
  detached-buildings intact, FPV aim active, EMA 8.3 ms. HONEST GAPS: the dev pipe never holds
  ≥3 items in a download queue → queue-ORDER observable unreachable locally (locked by the
  27 unit tests instead); real cold-network + weak-device (mid/low caps + parse-hitch relief)
  ride T1. FPV exit → aim inactive verified. TRAP (cost ~20 min): a STALE Playwright Chrome
  from a prior session held port 9222 WITHOUT the occlusion flags — my flagged launch silently
  didn't bind, the MCP attached to the buried stale window, rAF froze (the U2 trap wearing a
  new coat). Check `ps` for who OWNS 9222 before trusting the launch.

- **2026-08-18f-u4-aim-cones (UPLIFT U4 SHIPPED: direction lines + visibility cones on the 2D
  map, owner point 3 — PhotoPills-style. Gates vitest 962/962 (+12) · astro 0 err; browser-
  VERIFIED both shells, shots `verify-shots/u4-01..08`.)** From the plan anchor (the TargetPanel
  eye), three azimuth systems — tracked target (accent) / sun (sunGlow) / moon (moonlight) —
  each a current-azimuth direction line + a rise→set ground sector, split at scene time:
  swept = amber, to-come = blue (the scrubber convention, **tokens.warn/timeFuture BRIDGED to
  GL** — supersedes the tokens.css "chrome-only" note, comment updated). NEW pure
  `lib/ephemeris/azSector.ts` (time-ordered az runs off `targetElevationSeries`; wrap-aware
  lerp; horizon-crossing + now-split interpolation; circumpolar → ring, never-up → none;
  `wrap180` HOISTED here from frameFinder/sunEventFrame; 11-test twin) → consumed by NEW
  `scene/aimCones.ts` (unit-circle fan/rim/line in the anchor ENU tangent plane, ECEF+radius
  in the matrix — zoom rescales, never rebuilds; per-vertex aT01 vs uNow01 COLOUR split in
  shader — scrub never rebuilds; depth-free renderOrder 9 like dayArcs, a flat sector cannot
  follow relief; ~145 ephemeris calls/body only on anchor-deadband/day-cross/target-swap;
  AIMCONES tuning block; presence band 25→50 km — LEO flagship byte-identical, probe-verified
  at 1.09 Mm) AND the `MapWindow` canvas twin (memoised aim-day + per-paint `splitAimRuns`,
  chart-fixed radius, sky/time subscribe→redraw, tap-on-line PROMOTES). Emphasis: ONE body full
  (fill 0.12 after browser pass), others compact rim-only ×0.55 — eased, fill rides the same
  ease. Toggles: `aim{Target,Sun,Moon}` prefs + session `aimFocus` (store/sky), ONE `∠
  DIRECTION` row in the shared SkyContextMenu (turn-on promotes; per-body flags, deliberately
  no ensureTracked for sun/moon). Sun/moon ride `bodyTarget()` — one `targetAzAlt` path, D6.
  **Browser-caught bug:** the seat initially rode the ephemeris anchor deadband (0.02° ≈ 2 km
  visible offset off a boot-flight capture) — the seat now tracks the LIVE anchor every frame;
  only the az curves quantize. **Hardening:** MapWindow `setPointerCapture` wrapped (throws
  NotFoundError on same-frame-released pointers). v1 horizon-only (skyline `traceStates`
  sub-bands = v2); GL sector labels deferred (taste tail).

- **2026-08-18e-desktop-flat (owner round 4: the flat-map treatment lands on DESKTOP at nadir.
  Gates 950/950 · astro 0 err; browser-VERIFIED, shot `verify-shots/u3e-01`.)** The ink fixes
  (depth-off, night-dim stand-down, fill/ribbon attenuation, names v4.1) were already
  shell-shared via the tilt latch; the ENGINE treatment was /m-gated. New unified
  `flatGroundNow()` = ink latch AND (mobile mapMode-2d OR desktop `alt <
  CONTROLS.mapFlatMaxAltM` 120 km): drives the deep imagery error target, the `uFtwFlat2d` day
  grade, the shadow rig (now the WHOLE rig off in flat — the day-graded photo carries the real
  capture shadows; was receiver-twins-only), the zoom-brake relaxation, and (via a new
  `tilesHandle.mapFlat()` seam) the GlobeCanvas bloom gate. **The altitude bound is
  load-bearing:** the flagship LEO view is also tilt≈0 — verified at 1.09 Mm nadir the
  treatment stays OFF (terminator/night-lights/atmosphere bloom byte-identical); at 1.5 km
  nadir it is fully ON (errorTarget 0.45, day grade 1.0) and any inclination (tilt > 15°,
  hysteresis) reverts to normal 3D. Deliberate desktop/mobile DIFFERENCE kept: buildings stay
  ATTACHED on desktop nadir (high-tier budget carries them; the deck's BLD chip hides them
  manually) — /m detaches for phone perf. Files: tuning.ts (CONTROLS.mapFlatMaxAltM) ·
  StylizedTiles.ts (flatGroundNow + shadowEligible + zoom brake + handle.mapFlat) ·
  GlobeCanvas.tsx (bloom via the handle seam; store import dropped).

- **2026-08-18d-labels-v4.1 (owner round 3: label size/sync + fills 8%. Gates 950/950 · astro
  0 err; browser-VERIFIED, shots `verify-shots/u3c-01..02`.)** The v4 legibility scale had two
  defects the owner nailed: (a) ONE global scale multiplied the majors' already-2× world size —
  26 px text "sticking out of its lane" at altitude; (b) the scale EASED toward its target
  (~270 ms lag) — pinch shrank the map while the text stayed big, then caught up. v4.1:
  per-tier screen targets `STREETS.textPxTarget` [15,13,11] (replaces minTextPx 13; each tier
  lands on its OWN px at altitude — `labelScaleFor(hWorld, pxTarget, wpp)` per entry inside
  applyMatrix), applied DIRECTLY per frame (no ease — scale is continuous in altitude, so
  pinch tracks exactly; matrices refresh when wpp moves >0.3%); same-name spacing rides the
  major tier's scale. Below the floor (majors ≤ ~1.5 km, minors ≤ ~700 m) the v3 world-metre
  "road paint" reading is unchanged. Also `VECTOR.flatFillK` 0.15 → **0.08** (owner).
  Files: tuning.ts · streetNames.ts · streetNames.test.ts (+3).

- **2026-08-18c-2dmap-crispness (owner follow-up round: "why is the live 2D map still blurry
  when the MapWindow is crisp" + subtler vectors + chip renames. Gates 947/947 · astro 0 err;
  browser-VERIFIED, shots `verify-shots/u3b-01..02`.)**
  **The REAL blur root found by live probing** (the 18b composite/DPR/level fixes were
  necessary but not sufficient): per-region imagery level selection showed visible regions
  capping at **z16 ≈ 1.6 m/px** with only 4 virtual splits — because **CWT leaves over Dnipro
  report GE ≈ 1.1 m on ~800 m tiles**, so at errorTarget 2 the GEOMETRY converges after one
  split and refinement stops. SSE measures mesh error, not texel density — the imagery
  composite is slaved to a number that says "the terrain is accurate enough". Probe: freezing
  errorTarget at 0.35 drove the overlay's (already-built) virtual split tree to **z17–18
  (0.4–0.8 m/px)** for only ~+5 visible tiles at street nadir. Fix: `GROUND.errorTarget2dDeep`
  0.35 applied in flat2d below `error2dDeepAltM` 1.2 km, blended back to the tier near-target
  by `error2dBlendAltM` 6 km (mid-altitude views never carry the deep-region count; measured:
  600 m → target 0.35/z17–18/16 virtual splits · 1.8 km → 0.55/z16 ≈ exactly screen density).
  Desktop + 3D orbit untouched (flat2d-gated). **Vector subtlety** (owner: "obscures the actual
  streets and landscape"): flat-map fills ×`VECTOR.flatFillK` 0.15 (the imagery already shows
  parks/water — the park fill blanketed a whole district) and ribbons ×`flatLineK` 0.55 on top
  of the existing near-ground fade — light ink over a readable photo. **Chip renames** (owner):
  `▲ 3D VIEW`/`▼ 2D MAP` → `▲ 3D`/`▼ 2D` · `🧭 MY LOCATION` → `🧭 MY LOC` (guide prose
  updated). Files: tuning.ts (GROUND.errorTarget2dDeep/error2dDeepAltM/error2dBlendAltM ·
  VECTOR.flatFillK/flatLineK) · imageryGround.ts (blended near target) · vectorFeatures.ts ·
  SceneActions.tsx · guideContent.ts. TRAP for the record: **a "converged" SSE does not mean
  sharp imagery** — ImageOverlayPlugin's virtual-split depth (and thus texel density) is
  bounded by errorTarget vs the SOURCE tileset's leaf geometricError; CWT's tiny leaf GE makes
  the default target freeze imagery at ~1.6 m/px no matter the composite resolution.

- **2026-08-18b-u3-2dmap-batch (UPLIFT U3 SHIPPED + the owner's 5-issue 2D-map batch. Gates
  vitest 947/947 (+21) · astro 0 err/5 hints; browser-VERIFIED desktop 1440×900 + phone 402×874
  (wix dev + Playwright CDP, shots `verify-shots/u3-01..07` + `u3-repro-01..02` before-shots);
  real-device pass rides T1.)**
  **(1) 3D→2D multi-rotation FIXED (owner issue 1)** — browser-reproduced first: heading
  wandered 170→9.7→308.6→207→359.7° AT NADIR (tilt 0.2°, sweep 323°, three direction
  reversals). Root: `stepHeadingGlide` steered the FORWARD-derived bearing, which is degenerate
  at nadir (any residual-tilt sliver defines it) while the 2D lock used `mapUpHeadingDeg` — two
  heading definitions across one handoff. Fix: below new `CONTROLS.headingUpRefMaxTiltDeg` (60°)
  the glide measures the SCREEN-UP bearing (the lock's reference; the two agree for an unrolled
  camera at oblique tilt). Post-fix: sweep 166.9° (ideal arc 170°), ZERO reversals, lands 0.2°/
  tilt 0. Related fixes: temp-pin focus lock is SKIPPED in mobile-2D (`stepViewFocus` — heading/
  zoom corrections orbiting an off-centre pin read as the map whirling; H3), and a 2D-mode
  search/`requestFly` arrival now lands `mapArrivalPose` (nadir north-up, altAboveGroundM param
  added) instead of the oblique 52° search pose the locks then visibly re-rotated.
  **(2) roads-clip + street names v4 (owner issue 2)** — clipping root (scout-cited): ribbons
  seat on a 6×6 per-tile lattice with mean-filled out-of-frustum knots + 1.5 m lift vs a 3 m
  refresh eps — terrain LOD slices mid-segment by construction. Ruling: at nadir the web is MAP
  INK — new `mapFlat` latch (mobile: mapMode 2d; desktop: mirrored tilt < twoDMaxTiltDeg with
  +5° hysteresis) turns OFF depthTest on ribbons/fills/labels (renderOrder already layers them)
  and stands the night dim down. Street names v4 (`streetNames.ts` + `vectorTiles.ts`): the v3
  selection was WORLD-space over the whole ~130 km² cache with no camera test — at street zoom
  the entire 40-label budget sat off-screen (why names "never appeared"). Now: viewport-filtered
  selection (project → |NDC| ≤ `STREETS.viewMarginNdc` 1.15), Google-style repeat anchors along
  long streets (`sampleLineAnchors`, every `repeatEveryM` 450 m arc-length, ≤6/feat, half-step
  end margins; same-name separation 650 m×scale), refcounted texture cache (repeats share one
  canvas per name), band raised 2500/2100 → **5000/4000 m**, and a legibility scale
  (`labelScaleFor`: world size grows until the smallest tier subtends `minTextPx` 13 px, floor 1
  at street level — the v3 "road paint" reading unchanged there, cap ×9; per-frame eased).
  **(3) imagery sharpness (owner issue 3)** — scout-diagnosed chain: per-region 256-px composite
  slaved to geometry SSE at errorTarget 2–3 CSS px ⇒ ~1–4.5 px/texel; DPR-blind
  `setResolutionFromRenderer`; and a `levels`-is-a-COUNT off-by-one capping Esri at z18/CARTO
  z19. Fixes: `GROUND.overlayResolution` 256→**512** · ground renderer alone gets DEVICE-px SSE
  (`refreshResolution()` = size×pixelRatio via `setResolution`; wired into resize + tier apply) ·
  `levels: max+1` (real z19/z20) · `GROUND.errorTargetNear2d` 2 claws the /m mid-tier near
  target back down in 2D (buildings detached → budget free) · **the 2D map is day-graded around
  the clock** (new eased `uFtwFlat2d` uniform forces the grade's dayK — a planning chart reads
  at 02:00; vectors likewise skip night dim in mapFlat) · flat-mode near-ground ink fade
  (`flatNearFade`, 900→300 m → ×0.35 floor: at street zoom the sharpened imagery IS the map and
  full ribbons covered exactly the kerbs/parking the owner reads). Also NEW `.m-actrow` chip
  row: micro compass (SVG needle off the heading mirror, tap-to-face-north in 3D) + live
  altitude readout (`formatAltM`) exactly right of the 2D/3D chip (owner ask, both modes).
  **(4) 2D speed (owner issue 4)** — CARTO dark overlay now attaches ONLY in dark ground mode
  (it was registered at opacity 0 and fetched/composited a full second tile chain for zero
  pixels in the default satellite mode; delete→add is the plugin's own re-order idiom) · shadow
  twins off in 2D (`flat2d` param — buildings, the only casters, are detached) · bloom pass off
  while /m shows the map (FPV keeps it) · the near-ground zoom brake stands mostly down in 2D
  (`MOBILE2D.zoomSlowFrac` 0.85 vs 0.35 — chart pinch stays fast).
  **(5) MY LOCATION lands the MAP (owner issue 5, supersedes the 2026-08-14 straight-into-FPV
  ruling)** — `SceneActions.locate()` now: `setMapMode("2d")` + `setTempPin` + `requestFly` at
  `MOBILE2D.locateAltAboveGroundM` 600 → the 2D-aware fly-to lands nadir/north-up over the fix
  (verified 718 m over ~117 m terrain) with ◎ LOOK FROM HERE armed — one more tap enters FPV.
  Desktop MyLocation island unchanged (no 2D map there).
  **(6) U3 fullscreen map + view cone SHIPPED (UPLIFT §2/U3)** — minimap pose mirror gains
  `coneDeg` (pure `horizontalFovDeg` off the fpvHud vertical FOV + aspect; verified 26.9° phone
  / 83.1° desktop, tracks pinch-FOV live) and MiniMap draws a translucent sector instead of the
  fixed wedge; the minimap patch is now a tap target (`.mm-open` button) opening the NEW
  top-level `MapWindow` island (both pages): desktop = large centred window (GUIDE precedent,
  z 42), /m = true fullscreen (body.m, z 20 between chrome and sheets); raw Esri/CARTO XYZ
  canvas (retina fetches one level deeper + draws half-size), drag-pan / wheel / pinch / ±
  chips, double-click (desktop) / 500 ms long-press (touch) = VIEW FROM HERE via
  `requestFpvJump` (verified: relocates a live FPV session and closes), Esc/✕ back, DOM
  attribution line. New pure lib `lib/geo/slippy.ts` (lonLatToTileF/tileFToLonLat/
  metersPerTilePx/zoomForMetersPerPx — cross-tested against the vectorTiles integer tiler).
  Esri ToS stance unchanged (dev reuse; licensed-source decision rides U7). `touch-action:none`
  on `.mw-canvas` added to the U1 pinch-lint leak list.
  Files: `tuning.ts` (CONTROLS.headingUpRefMaxTiltDeg · MOBILE2D.locateAltAboveGroundM/
  zoomSlowFrac · STREETS band+v4 knobs · GROUND.overlayResolution/errorTargetNear2d ·
  VECTOR.flatNearFade*) · `StylizedTiles.ts` · `imageryGround.ts` · `vectorFeatures.ts` ·
  `streetNames.ts` (v4) · `vectorTiles.ts` · `minimapFeed.ts` · `GlobeCanvas.tsx` ·
  `store/minimap.ts` · `panels/MiniMap.tsx` · NEW `panels/MapWindow.tsx` + `styles/map-window.css`
  · NEW `lib/geo/slippy.ts` · `mobile/SceneActions.tsx` · `styles/mobile/chrome.css` ·
  `mini-map.css` · `index.astro`/`m.astro` · tests (+21: slippy, sampleLineAnchors,
  labelScaleFor/worldPerPx, flatNearFade, horizontalFovDeg, pinch-lint row).
  Open tails: ribbon width/opacity taste pass at street zoom · Esri source LOD varies across
  Dnipro (some blocks stay soft — source-bound) · desktop 2D chip keeps the cinematic night
  ground (flat day-grade is /m-only by design) · real-device pass (T1).

- **2026-08-18-u2-fpv-stability (UPLIFT U2 SHIPPED — the point-6 FPV re-render/jerk bug: all 8
  cited mechanisms fixed + instrumented. Gates vitest 926/926 (+4) · astro 0 err/5 hints;
  browser-VERIFIED desktop + phone viewport (wix dev + Playwright soak, shots
  `verify-shots/u2-01..04`); real-device pass rides T1.)**
  **(a) A9 LRU floor** — the root of the "full re-render": mid/low caps (256/160 MB) sat UNDER
  the library's untouched `minBytesSize` default (0.3 GiB), inverting the eviction band; worse,
  `TilesRendererBase` DISCARDS a freshly parsed tile when `isFull()` ("it will be loaded again
  later", TilesRendererBase.js:1789) → parse→discard→re-download loop whenever the FPV working
  set reached the cap. Fix: pure `lruFloorBytesForCap` (cap×0.75 — the library's own 0.3/0.4
  ratio; null→null) applied beside every `maxBytesSize` write in buildings/imageryGround/
  enrichedBuildings (each captures BOTH library defaults; `high` restores both). Soak-verified
  pairs: mid 192/256 · low 120/160 · high restored 307/410 MB. **(b) A9 governor gate** —
  GlobeCanvas parks a governor tier change in `pendingTier` while `tilesHandle.fpvActive()`
  (new handle method) and lands it on the first non-FPV frame; DEV `force()` stays immediate
  and clears the pending. `applyTier` also SKIPS the renderer/composer realloc when the
  effective DPR is unchanged (tier flips between caps resolving to the same DPR paid a full
  render-target realloc for nothing). NOTE: the natural-governor deferral path is
  logic-reviewed but browser-UNVERIFIED (this M3 Pro never governs down; force() bypasses the
  gate by design) — a weak-device run rides T1. **(c) A2 zoom bank** — `resetState()` never
  clears `zoomDelta` and disabled `update()` never consumes it; stepZoomBrakeAndEase SLOSHES
  the bank between `pendingZoom` and `zc.zoomDelta`, so the sum is CONSERVED across an FPV
  session of any length and discharged at exit (the "violent jerk to orbit"). Fix:
  `zeroZoomBank()` at FPV entry (both kinds) AND exit. Soak: bank {0,0} at every boundary,
  exit-alt drift 0.00 m over 2 s. (/m tilt gesture never disables controls — no bank path
  there, nothing to clear.) **(d) A1 entry-frame gate** — the controls flip to disabled one
  step late (transitions run AFTER controls.update), so the entry frame's update could
  discharge bank/drag into the camera before the entry code zeroed it: `fpvEntryPending()`
  (same store-derived wantKind + the fpvJumpRequest one-shot) gates `stepControlsUpdate` on
  the entry frame. **(e) A4 eased pin ground** — `tempPinPoint()` re-samples `heightAt` every
  frame; a terrain-LOD refine TELEPORTED the temp-FPV eye by the LOD delta. Fix: eased applied
  ground (`seatStep`, new `TEMPPIN.groundEaseK` 0.12 — first real sample snaps, refinements
  slide; frame-stamped, the fn runs ×4/frame). Measured: the old double-teleport (0→28.9→76.4 m
  as LODs landed) is now a ~3 s glide with per-frame steps = (raw−applied)×0.12 exactly; zero
  steps after settle. **(f) A5 eased enriched group seat** — the group lift was the ONE
  unsmoothed layer (cells/features already eased): `seatAppliedM` now rides the same seatStep;
  per-cell targets reference the APPLIED seat, so a sampled cell's sum stays exactly on its own
  terrain mid-slide and unsampled cells glide. **(g) A4-photo resnap gate** — the 120-frame
  cadence `frustum.resnap()` is a >0.5 m SNAP rebuild; skipped while photo-FPV (the camera
  stands on the apex) — deferred to the next cadence tick after exit. `frameCount` still ticks
  (the cadence-split contract). **(h) A8 noteInteract FPV guard** — wheel/pointer during FPV
  fired the full noteInteract: `flight.cancel()` KILLED the entry flight mid-air and stepFpvPose
  snapped to the eye (browser-real teleport). Now FPV keeps only the `lastInteract` drift guard;
  exit fly-out still cancels on grab (fpvActive already false — user takes over, as designed).
  Soak: a 6-tick wheel burst at t+400 ms into the entry flight left it flying (alt 530 m
  mid-arc, landed 78 m; pre-fix = instant snap). **(i) A7 stale floor** — `lastGroundM` (street-
  floor guard memory, frozen during FPV) invalidated at exit; the guard re-samples at the fresh
  focus before clamping. **(j) A11 resolution refresh** — `setResolutionFromRenderer` was a
  one-shot per tile renderer (stale SSE denominator after any resize/orientation → phantom
  load/unload burst): a window resize listener now refreshes all three; stars gain `setDpr`
  (uDpr was captured once) refreshed on every tier change via applyQualityTier. **(k) U2
  instrumentation (DEV)** — `__globe.u2()`: zoom bank, raw+applied pin ground, lastGroundM,
  enriched seat epoch, per-renderer LRU min/max, and a 50-ring of single-frame eye jumps
  (>0.5 m, walk-attributed — sprint walk is ~1.15 m/frame by design — + monotonic total);
  `__quality.pendingTier` + `tierLog`. Soak protocol result: zero non-walk jumps through
  4 s analog walk + 20-step look-drag + ±6 h scrub + high→mid→low→high flap, on BOTH shells;
  /m exit still lands 2D nadir @679 m (U1 contract intact). TRAP (cost a full soak restart):
  headful CDP Chrome goes `visibilityState:hidden` when OCCLUDED — rAF stops COMPLETELY and
  every "zero jumps" assert passes vacuously; relaunch with
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding` and embed an
  rAF-tick counter in every probe (zero-result validation). Files: lib/globe/quality.ts
  (+lruFloorBytesForCap), scene/{buildings,imageryGround,enrichedBuildings,stars}.ts,
  StylizedTiles.ts, GlobeCanvas.tsx, tuning.ts (TEMPPIN.groundEaseK),
  test/lib/globe/quality.test.ts. Memory: `mem:project/wip-2026-08-17-u2-fpv-stability`.
- **2026-08-17b-u1-2d-mobile (UPLIFT U1 SHIPPED — /m 2D-first navigation + pinch hardening,
  owner points 1+5. Gates vitest 922/922 (+14) · astro 0 err/5 hints; phone-viewport
  browser-VERIFIED (wix dev + Playwright, shots `verify-shots/u1-01..04`); REAL-DEVICE pass =
  the exit gate, OPEN — rides the next owner session.)**
  **(a) `camera.mapMode` seam** — `"2d" | "3d"` in store/camera (default `"3d"`, NOT persisted —
  owner rule "/m always boots the 2D map"; desktop never writes it → every U1 seam desktop-inert;
  survives `clearAllTargets`, a mode is a place not a glide). **(b) Building detach** —
  `setActive(on)` on BOTH tileset handles (buildings.ts + enrichedBuildings.ts): scene-graph
  remove (render + GlobeControls' whole-scene raycast — three's Raycaster does NOT skip
  invisible objects, so `visible=false` alone was wrong) + frozen `update()` (no traversal/
  download/parse); LRU stays warm → instant re-attach. Orchestrator gate `stepMobileBuildingsGate`
  = `fpvActive || mapMode==="3d"` per frame (handle identity-guards make it free). **(c) 2D boot**
  — body.m class (server-rendered, race-free) detects the shell; no-hash boot = EXACT nadir
  north-up over MOBILE2D.bootLat/Lon@1100km (constructed directly — `arrivalPose` clamps tilt
  ≥5°); `#p=` with tilt≥`twoDMaxTiltDeg` boots 3D (respect an oblique share), nadir `#p=`
  re-lands 2D (the /m mirror writes tilt≈0 hashes — a reload must not silently flip to 3D);
  `#f=` enters FPV, exit lands 2D. **(d) 2D locks** (`stepMobile2dLocks`, after the manual
  glides they defer to) — tilt→nadir + heading→north re-lock, τ=MOBILE2D.lockEaseTauMs;
  heading measured off SCREEN-UP (`mapUpHeadingDeg` — forward-heading is DEGENERATE at nadir:
  it printed 180.5° on a north-up chart; the pose mirror + `#p=` hash use it too while 2D).
  **(e) Two-finger tilt = the library's own touch-ROTATE** (EnvironmentControls.js:562-585
  pinch/parallel classifier — no custom gesture layer): while it is live the tilt lock stands
  down, the heading lock keeps running (gesture reads as pure tilt), crossing
  MOBILE2D.enter3dTiltDeg=15° flips to 3D mid-gesture (buildings attach). Verified synthetic:
  tilt 0.06°→80°, heading pinned 0, ROTATE state 2 throughout; pinch stays ZOOM (1100 km→25 km,
  tilt 0.03° — chart behaviour). **(f) Idle drift OFF in 2D** — the LEO drift slid the chart
  ~3° lon in the first browser pass; a drifting map reads as broken, not cinematic. **(g) FPV
  exit on /m** — sets 2D + flies `mapArrivalPose` (south approach ⇒ north-up, tilt 0→5° clamp,
  MOBILE2D.exitAltAboveGroundM=600 — 200 was a frame view, too tight for a map; measured 602 m,
  heading 359.87°); skips `beginFraming` (it would re-fly the OBLIQUE photo arrival). **(h) /m
  chrome** — SceneActions `▼ 2D MAP / ▲ 3D VIEW` chip (writes mode + reuses the tilt/heading
  glides); ▦ 3D DETAIL hidden in 2D (dead reload chip). **(i) Pinch hardening (point 5)** —
  MobileLayout `maximum-scale=1, user-scalable=no` + iOS `gesturestart` preventDefault guard
  (iOS ≥10 ignores user-scalable; pointer events unaffected); `touch-action` closed on the
  audited §1.2 leak list (desktop `.globe-canvas` none — touch laptops; `.m-bottom`/`.m-actions`/
  `.m-scrim`/`.mm`/`.skymenu`/status chips none; `.m-sheet__body` pan-y); desktop + /guide stay
  browser-zoomable (a11y). `test/styles/pinchHardening.test.ts` pins the leak list file-by-file
  (the declarations are silently droppable — guide-image-cross-check style). DEV seam
  `__globe.map2d()` (mode + group-membership truth). Files: tuning.ts (MOBILE2D block),
  store/camera.ts, scene/buildings.ts, scene/enrichedBuildings.ts, StylizedTiles.ts,
  SceneActions.tsx, MobileLayout.astro, global/chrome/mobile/mini-map/sky-menu css,
  test/store/camera.test.ts, test/styles/pinchHardening.test.ts. UNVERIFIED (real device only):
  actual browser-pinch suppression on iPhone 17 Pro/Pixel 6 Pro (synthetic pointers can't prove
  viewport/touch-action), gesture feel (enter3dTiltDeg/lockEaseTauMs tuning), 3D chip's 55°
  glide landing at ~48° (released early — cosmetic, taste-tune). Next: U2 FPV stability.

- **2026-08-17-p7-meteors+uplift-plan (Phase 8c P7 METEOR SHOWERS SHIPPED desktop + R12 rail layer; UPLIFT_PLAN.md AUTHORED — the owner's 10-point mobile/desktop uplift ladder U1–U8. Gates vitest 908/908 (+22) · astro 0 err/5 hints; desktop surfaces browser-VERIFIED (wix dev + Playwright, shots verify-shots/p7-01/02).)** **(a) `lib/ephemeris/showers.ts` (NEW)** — 21-row IMO-working-list bake (hand-curated 2026-08-17; IMO cal2026 Table 5/6 + IAU MDC streamfulldata + Jenniskens 1994 B slopes — NOT GPL showers.json; provenance in header): λ☉ activity windows/peaks, radiant + deg/day drift, ZHR (null for Var outburst rows JBO/AMO), r, Vg, parent, per-side B slopes (GEM 0.39/0.72 asym, QUA 1.4/2.2; default 0.19 — research corrected the plan's assumed 0.9, no such general value). Model: **λ☉ referred to EQUINOX J2000** (IMO/MDC standard; `SunPosition()` is of-date and runs ~0.37° ≈ 9 h early in 2026 — computed via `Rotation_EQJ_ECL` on the EQJ sun vector, equinox-2000 anchor 0.001°, research-validated 2026-01-03 anchor 283.048°); `lambdaToMs` Newton peak solver; `zhrAt` = Jenniskens 10^(−B·|Δλ|) clipped to the window; `visibleRateAt` = ZHR×sin(radiant alt) γ=1 (IMO practice); `showerNights` = mwSeason-convention moon scoring at the night peak, **score = peak RATE × (1 − interference)** (rate-shaped, deliberately ≠ mwSeason's minutes-shaped score — convention firewall in both headers); `upcomingShowerPeaks` (120 d card feed). **(b) Radiant = tracked target:** `showerTarget` factory in targets.ts (id `shower:PER`, kind "shower" — the type layer was pre-seeded; per-call drifted stateAt, magnitude null by the documented contract) + TargetFacts `shower` member + `targetShortName` → code; catalog three-touch (showerEntry ☄ rows boost 0.9, skyIndex spread → 1,971 sync entries, `shower:` resolver branch) — search "perseids" → track → reticle/trail/windows/edge-chips ALL inherited, prefs persistence free (id carries ":"). **(c) Surfaces:** TargetPanel `ShowerFacts` (ZHR/r/Vg/parent · peak + apparition dates solved from λ☉ · drift + off-centre framing hint); PlanPanel `MeteorsCard` after MoonCal (MwCard grammar, upcoming peaks w/ score bars + ☾%, row = setTime(best-night peak) + setTarget(radiant) — the FindPanel jump idiom); TimeScrubber **meteor intensity layer (R12)** — star-coloured filled area from the rail floor (y 39→22, normalized to the shower's own ZHR; `--color-star`: meteors ARE shooting stars), only when the tracked target IS a shower, Var rows honestly flat; CSS `path.`-qualified over the `.ts-curves path` fill:none. Tests `test/lib/ephemeris/showers.test.ts` (22): equinox/precession anchors, PER-2026 = Aug 12–13, GEM asymmetry re-derived from REAL λ☉ (December runs ~3% over the mean rate — mean-rate test shortcuts were the bug, lib was right), night-scan invariants re-derived from primitives, two-path targetAzAlt agreement, 21-row coherence sweep. Browser-verified chain: SKY search ☄ row → track → THE SHOWER facts (drifted RA 06h21m ORI) → METEORS card 8 autumn rows (AUR ☾31% … LEO Nov 18) → row click pins 2026-10-22 06:00 + tracks shower:ORI → rail area peaks at the cursor. **(d) UPLIFT_PLAN.md (NEW)** — owner 10-point order (2D-first mobile · fullscreen map · direction cones · minimap FOV cone · pinch hardening · FPV stability · closest-first loading · foveation · terrain precision · per-building height overrides) → slices U1–U8 with file:line evidence from 3 parallel scouts. Load-bearing findings recorded there: **the FPV "full re-render + jerk" bug has named mechanisms** (governor tier-down hits the library LRU `minBytesSize` 0.3 GB floor above our mid/low caps → mass evict/re-stream + enriched re-seat; banked `zoomDelta` discharges on FPV exit; per-frame unsmoothed `heightAt` for temp-pin eye + enriched group seat; one-shot `setResolutionFromRenderer` stale after resize) — all source-cited, browser-UNVERIFIED; foveation has REAL library hooks (`LoadRegionPlugin` RayRegion/SphereRegion, `loadAncestors=false` = distance-first); pinch-zoom leak audit (viewport metas unrestricted + bare touch-action list); per-building identity exists in the enriched bake but featureId is NOT re-bake-stable (OSM id dropped by the extractor — baker fix queued in U8). P8 conjunctions + P9 lunar eclipses REMAIN in 8-events; the uplift ladder takes the next sessions per owner order. Files: `lib/ephemeris/{showers.ts(NEW),targets.ts}` · `lib/sky/catalog.ts` · `panels/{MeteorsCard.tsx(NEW),PlanPanel.tsx,TargetPanel.tsx,TimeScrubber.tsx}` · `styles/time-scrubber.css` · `test/lib/ephemeris/showers.test.ts(NEW)` · `claude-docs/UPLIFT_PLAN.md(NEW)`. Open tails: owner taste (METEORS card copy/row cap · meteor-layer colour/height · an "ACTIVE NOW" chip for in-window showers whose peak passed — PER tracked today shows no card row) · /m twin rides M4 · real-device pass unchanged (T1). Memory: `mem:project/wip-2026-08-17-p7-meteors-uplift-plan`.**

*(Sentinel — older sessions, 2026-08-02 → 2026-08-15e, moved byte-identical to
`DECISIONS_ARCHIVE.md` §Moved 2026-08-18 in compaction round 3; their era digests live in
§Per-phase digests above. Entries above this line are the hot UPLIFT era, 2026-08-17 →.)*

