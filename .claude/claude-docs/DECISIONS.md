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

---

## Recent sessions (verbatim, newest first)

New work appends a dated line here — immediately below this note, above every dated entry.
*(Moved to the top 2026-08-13 after drifting mid-list since 2026-08-03; it drifted AGAIN and
was re-seated here 2026-08-22 during compaction round 4 — audit #3 D13, which also records the
root cause: appends go to the top and nobody re-seats the marker. A move is not an edit.
THIRD DRIFT re-seated 2026-08-24d, from below four dated entries: the marker cannot survive a
top-append convention by sitting in the list. It now lives directly under the heading, where an
append physically cannot get above it — backlog T40.
FOURTH DRIFT re-seated 2026-09-06g (compaction round 5): it had sunk below 14 dated entries
again — every session appended above it. Rule restated: APPEND DIRECTLY UNDER THIS NOTE.)*

### 2026-09-07e — T106 FIXED: the TWO-PHASE `load-model` handler (slice b) — phase 1 synchronous, phase 2 one unit per mesh on a deferred queue under a per-frame ms budget, every long loop RESUMABLE (edges, attribution, fingerprints, the footprint locate); worst drain desktop 30.3 → 8.5 ms, phone twin 85.9 → 8.0 ms · the flip bank MEASURED under the phone caps (670 cold / 177 warm) · the stranded ship pushed (implement, Deep; `/frame` under investigate-design-v3; owner order 2026-09-07e: proceed with the brief, the Android device away; `mem:project/wip-2026-09-07-t106-two-phase`). **Boot:** the 13:06 ship hook's push failed on a transient SSH outage (`ABORT: push failed`, commit `2d55a33` stranded on `claude/ship-20260907-130645`, a clean child of `d375d39`) — pushed by hand, PR #110 automerged (`44743d3`, tree-identical), checkout re-seated, mirror synced, the branch deleted; the hook has no retry (brief updated). VPN FI, ion 401, house Chrome :9333, `wix dev` with `.vite` aside, pre sweep `pre-2026-09-07e` 13/14 (legacy-m = T103). **1 · T106 slice (b) (MEASUREMENTS §24).** `load-model` now does PHASE 1 only — the cell record, the material swap, the F1 fill birth, the trees (`handlerMaxMs` 0.4 desktop / 0.8 twin) — and pushes one unit per mesh onto `lib/globe/loadQueue` (new, pure, 6 tests: ≥ 1 step per drain always, then the deadline; lowest `priority()` = `lookBiasedDistance` per pick; a mid-flight unit STICKY so one builder's tables are live; `cancel(scene)` on `dispose-model`, `clear()` on dispose). `update()` drains it after the T94 freeze check and before the seat passes under `ENRICHED.loadBudgetMs` **6** / `loadBudgetMsLean` **3** (keyed on `lean` by the orchestrator like the caches and the plan sweep; `__globe.enrichedLoadBudget(ms)` live). `makeMeshLoadUnit` phases, in the §4a order (nothing writes a mesh's buffers before 5 — the seat passes walk only registered parts): **0** the crease edges through `createEdgesBuilder` — `fastEdges.createFastEdgesBuilder` is the SAME algorithm as a state machine (vertex keying, the triangle walk, the tail emission; `step(deadline, checkEvery=256)` always completes one chunk; `buildFastEdges` = the builder stepped once) and the `LineSegments` lands with ITS OWN `frameNow()` birth; **1** the attribution through `enrichedMask.createSegmentRunAttributor` (resumable the same way; `segmentRunsFromSources` = stepped once); **2** CSR + edge spans + the bounds pad (atomic); **3** the feature fingerprints by run (checked every 1,024 verts); **4** the part object + `locateFeature` for every feature if the cell got located while the unit waited (by 256 — `ensureLocated` is one-shot per cell and walks only registered parts, so a late part MUST locate itself; footprints at lat/lon 0 would sample the Gulf of Guinea); **5** the registration (atomic: RC9 banked seats, `cell.parts.push`, `partByMesh.set`, `applyCellOverrides`, `touchCell`; a locate left over the 4/5 frame boundary finished here). Tests: `fastEdges.test` +10 (one item per step ≡ one-shot ≡ three's `EdgesGeometry`, the attributor likewise, a live-deadline resume), `loadQueue.test` 6. Seams: `__globe.enrichedLoad()` extended (`edgesMaxMs` / `maskMaxMs` / `registerMaxMs` per step, `deferredMaxMs` per drain, `pending`, `unitsDone/Cancelled`, `budgetMs`), DBG rows `buildings.loadPending` / `buildings.loadMaxMs`. **Measured (`scripts/probe-load-phase2.mjs [--lean] [--budget ms]`, the descent leg; `--budget 1e6` = the one-frame shape, the honest B since several `load-model` events also landed in one frame): worst drain desktop 30.3 → 8.5 ms (172 units, 82 drains), the phone twin 85.9 → 8.0 ms (52 units, 254 drains); >33 ms frames on the descent 20 → 10 desktop, twin p95 71.6 → 50.8; the rest of the tail is the streaming's other work (§20). Identity `enrichedBench(50)` mismatch 0/0 on every run; registry 80,771 features / 180 cells desktop, ~22k / 56 twin.** Two intermediate cuts each named the next atomic cost — the attribution atomic → twin 18.0, the locate atomic → 15.2 (13.7 ms of `ecefToGeodetic` × ~2,000) — the trap: "atomic per part" is not enough on a 4× phone; measure the per-PHASE max. **The cost (§24.2):** the twin's whole-city landing drains over ~4.4 s at 3 ms/frame (desktop ~1 s behind the last tile) — unregistered cells sit on the cell plane without per-feature seats or edges, nearest first; `loadBudgetMsLean` is the owner's knob (4 ms ≈ 3 s). **2 · The post sweep (§24.3):** 13/14 self-checks (T103), identical tri/call counts per pose; the `--compare` diffs (cityscape 19.4 %, descent 10.2 %) classified as the BOOT-TO-BOOT noise floor with an old-code pair — `post2-2026-09-07d` vs `pre-2026-09-07e` (both `44743d3`) differ by the same cells at the same magnitude (Δ > 24: 3.98 % vs 4.15 % cityscape — the vector water overlay + per-tile tone seeds in load order; 0.07 vs 0.17 % descent). **3 · The flip bank under the phone caps (§24.4, `scripts/probe-flip-bank.mjs`, new):** `/m` phone twin (lean, tier `mid`, bank ON), two 2D→FPV→2D cycles — cold cycle 566 → FPV / **670** → 2D requests (the FPV set alone fills the 112 MB cap: 112 items at rest, so the 2D set is evicted whole), warm cycle **172 / 177** with the bank's floor at 96 MB (`minHeadroomBytes` binds, not `bankFrac`); 1 overlay rebuild (the boot raise). The RC20 prediction ("churn falls but does not vanish") holds under T83's cap; the lever is the cap-vs-jetsam trade — owner call, nothing built. **Gates:** vitest **2,845/2,845** (180 files; +16) · `astro check` 0/0/11 · knip 0 · pre/post sweeps 13/14 (T103). Records: MEASUREMENTS §24 · backlog T106 FIXED · NEXT_SESSION_PROMPT refreshed (the ship-hook trap first) · `mem:core` status.

### 2026-09-07d — THE OCCLUSION RULINGS EXECUTED: T110 the FINE profile (0.25°, both shells, time-budgeted) · T112 BEST EFFORT per bin (the A1-16 coverage floor retired, the six raw consumers fenced) · T111 the skyline FOLD (HUD badge + chips, dashed sun/moon curves, meteor / eclipse / session badges, the day arcs dimmed behind the skyline) · T106 RE-SHAPED: `EdgesGeometry` + the string-keyed mask rewritten on integer keys, element-identical, 9–14× (implement, Deep; `/frame` under investigate-design-v3; owner order 2026-09-07d: proceed with the brief, T110 + T111 per the recommendation, T112 "best effort even below 50 %" — precise occlusion for long lenses, desktop at least, mobile unless it costs frames; `mem:project/wip-2026-09-07-occlusion-rulings-t106`). Boot: PR #109 landed (master `d375d39`), VPN FI, ion 401, house Chrome :9333, `wix dev` with `.vite` aside, pre sweep `pre-2026-09-07d` 12/14 (legacy-fpv-eye Δ1, T103), sheets read; four read-only finders (T110 / T111 / T112 / T106), every claim cited. **1 · T110 (MEASUREMENTS §23.1).** `PLAN.azBins` 120 → **1440** (0.25° — sixteen bins across a 500 mm frame; `azBinsLean` 1440 too), terrain still marched at `PLAN.terrainAzBins` 120 and folded in by `horizonProfile.foldCoarseProfile` (the known-aware interpolation); `occlusion.sweepMeshEdges` projects each vertex ONCE into a module cache (eye-relative float32 + az/alt/dist + the prism verdict; the allocating `azAltOfEcef` → `azAltOfRelInto` scratch), fills the bins between consecutive samples (`raiseSpan`, ≤ 45°), scales the subdivision cap with the bin count (64 → 768), and gained a resumable form `sweepMeshEdgesSliced(startTri, deadlineMs)` with a 64-triangle deadline check; `planFeed` bounds the mesh phase by TIME (`PLAN.sweepBudgetMs` 3 desktop / 1.5 lean, `meshesPerFrame` 4 as the ceiling, at least one chunk per frame, `triCursor`) and exposes the cost (`debug().sweep`, DBG rows `planning.sweepMs/sweepTotalMs`); the orchestrator keys both on `lean`. Measured (`scripts/probe-skyline-fine.mjs`, new): desktop 200 mm pose — 60 meshes, 56 ms over 22 frames, worst 3.2 ms; the phone twin (lean + 4× CPU throttle) ~250 ms over ~130 frames, worst 3.2 ms (10.2 before the 64-tri check) → **mobile keeps the full 0.25°**; 14 % of the horizon read > 0.5° lower than the 3° box-max. **2 · T112 (§23.2).** `store/plan.profileKnown` (identity-stable beside `profileBins`); `sampleBinsKnown` — both neighbours known → lerp, one known → its value over ITS OWN span (no sag toward the floor, no claim over the unknown span), none → `null`; `sampleProfile` = that or the floor; `skylineSamplerFor(gate) → SkylineView {altAt, coverage, partial}` is THE gate (real eye + `withinGuard`; the A1-16 coverage clause removed — a half-swept profile keeps its true gaps instead of being withheld whole; `skylineBinsFor` deleted); `fractureRunsBySkyline` keeps `null` samples in the run (a plain band there); `mirrorSampler` for the six consumers whose eye IS the anchor (TimeScrubber, MobileTimeDock, FindPanel, FindSheet, PlanSheet, FrameCard — fenced by `test/components/skylineConsumers.test.ts`: reads `profileKnown`, never `sampleBins`); `ProfileFn` returns `number | null`, `skylineVerdict` / `horizonVerdict` / `traceStates` classify per SAMPLE ("unknown" only where no sample had evidence; the rail's dotted `trace-unknown` path); `PlanBodyState.skylineKnown`; the store signature carries a `mirrorSerial` so a re-sweep that moved only away from the bodies still republishes (the T112 side finding). `PLAN.minCoverageForGaps` stays for BEST SPOT's own patch gate (its tests pin it). `horizonProfile.test` "THE FINDING" rewritten as "THE RULING". Seen live: a 0.49-coverage first build published, 1.00 after the T109 re-sweep. **3 · T111 (§23.3).** `FpvHud` rows: `BEHIND SKYLINE` badge from `store/plan.sun/moon` (`marker.up` stays the geometric gate — GOTO's rise scan, `skyAim.test`; the badge needs `skylineKnown` AND `skylineAltDeg > 0`, a real obstruction, not the bare dip); `SkyGotoChips` `fh-chip--behind` (dim + warn border, aria "up but behind the skyline"); the scrubber's sun/moon CURVES dash where hidden on both shells (`AltSample.azDeg`, `curvePathsByState`, `.ts/.md-curves__body--blocked`); `MeteorsCard` `✕ SKYLINE`, `EclipseRow.peakAzDeg` (solar via the topocentric `Horizon` chain) + `· BEHIND SKYLINE` on eclipse rows AND the NEXT SESSIONS rows on both shells (`useSkylineAt` / `peakBehind`, parity-fenced); the day arcs + target trail multiply `aFade` by **`DAYARC.skylineBehindAlpha` 0.35** behind the skyline at rebuild (re-folded on the profile's identity; the orchestrator passes `planFeed.profileSample()` only for a real eye within `skylineGuardM`) — the 2026-07 "reads THROUGH the skyline" ruling is SUPERSEDED for the alpha, not the depth test (the path still reads, dimmer); DEV seam `__globe.dayArcsFold()`. Verified at the street eye: sun 102/145, moon 137/145 vertices folded; `verify-shots/t111/03-street-sun-behind-hud.jpeg` (both badges, both chips, the dashed rail) and the `/m` twin `04-`. **4 · T106 RE-SHAPED (§23.4).** The saved Pixel profile by LEAF: three's `EdgesGeometry` 1,832 ms + `vertexKeyToRunWithCollisions`/`mapSegmentsToRuns` 873 ms of the 6.73 s hitch window (the "fingerprint pass / U8 recovery" ~0.3 s; the glTF parse 1.4 %). Built: `lib/globe/fastEdges.buildFastEdges` — three r0.185's algorithm with its quirks (0.1 mm rounded keys, degenerate skip, DIRECTED edges, the current triangle's floats on a sibling match, nulled records kept as keys, boundary edges last in insertion order, the same normal math) on open-addressed integer ids and `ua·N+ub` edge keys, plus the SOURCE vertex per endpoint; `enrichedMask.segmentRunsFromSources` — the party-wall rules verbatim on exact-bit keys (−0 folded); `scene/edgesGeometry.buildEdgesGeometry` (falls back to three for a non-plain attribute, `srcIndex: null` → the string path) in BOTH `load-model` handlers; a handler ledger `__globe.enrichedLoad()` and the in-page A/B + identity seam `__globe.enrichedBench(n)`. `test/lib/globe/fastEdges.test.ts` (13): element-identity vs the real `EdgesGeometry` and the string mask on prisms, party walls, gables, a degenerate sliver, indexed and soup, −0; the bench. In the page on the resident cells: desktop 33 cells / 353,897 tris — edges **527 → 57 ms**, mask **240 → 17 ms**; the phone twin 17 cells — **865 → 114**, **455 → 33**; mismatch 0 / 0. What is left of T106: the biggest cell's whole handler in one frame (65 ms on the twin) → the two-phase slice (b). A hash-mixer trap on the way: float-bit keys with zero low bits and a multiply-xor hash put every vertex in slot 0 (350 ms quadratic probing) — a murmur-style finalizer fixed it (3 ms). **Gates:** vitest **2,829/2,829** (179 files; +47) · `astro check` 0/0/11 · knip 0 · post sweep `post2-2026-09-07d` 12/14 (the same two; the first post run overlapped `src/` edits — HMR — and was discarded); the `--compare pre` diffs are the streaming/LOD noise floor (a whole imagery tile on `legacy-everest`) plus the intended radar/arc changes — the edges' identity is proven in-page. Records: MEASUREMENTS §23 · backlog T106 re-shaped, T110/T111/T112 FIXED · `audits/audit-occlusion-2026-09-07.md` addendum · NEXT_SESSION_PROMPT refreshed.

### 2026-09-07c — COMPACTION ROUND 6 · T83 RE-SHAPED AND FIXED (ONE page dies on its own → the LEAN TILE-CACHE CAPS, farm A/B) · the `pagehide` release · the iPhone's `/m` 26 → 2 ms · THE VISIBILITY / OCCLUSION AUDIT (no T77 regression; user models occluded NOTHING and a tile landing after the sweep never re-profiled — both FIXED, with the carry policy) (implement + research/review, Deep; `/frame` under investigate-design-v3; owner order 2026-09-07c: proceed with the brief, no Android, the iPhone farm allowed, plus the adjacent audit "radar, scrubber, heat map and every other seeing mechanism must account for ALL meshes … in all modes … desktop and mobile"; `mem:project/wip-2026-09-07-t83-pagehide-occlusion-audit`). Boot: PR #108 had landed (master `6ff6c4b`), VPN FI, ion 401, house Chrome :9333, `wix dev` behind a cloudflared tunnel with `.vite` aside, pre sweep `pre-2026-09-07c` 12/14 (cityscape Δ1 ease + T103), sheets read. **1 · COMPACTION ROUND 6 (T40):** verbatim 2026-09-05b → 2026-09-06n (34 lines / 80,273 B, md5 `2137d0be57d10eccd791b4738c52e411`) → `DECISIONS_ARCHIVE.md` §Moved 2026-09-07, three era digests in §Per-phase digests (opus-written from the moved lines, every number sourced), the sentinel + header updated; the T77 tail the handover points at (09-06o → 09-07b) stays verbatim; DECISIONS 140.7 → 66.5 KB. **2 · T83 — the one-page soak (`ios-baseline.mjs --soak-no-reboot`, new: soak the fpv page ALREADY UP; bail on the first dead read — the old soak's six blind 120 s `LOOK`s were 12 min of billing per row).** The single `#f=` page RELOADED at page age 129 s with no second load — §21.1's "the kill comes 14–25 s after the second load" was the shape of a harness that navigated every first page away at 34–45 s. (That first run overlapped `src/` edits on the served checkout — Vite HMR reaches the phone through the tunnel — so its context-loss row may be a Fast Refresh remount; the clean pair is item 4.) **3 · The desktop twin under the phone's gesture** (`probe-memory-footprint.mjs --look`, new: the farm tool's 108 px touch drag every 4 s; a STATIC page never fills the caches — that is why §21.1's twin read 510 MB flat): the renderer footprint grew **661 → 1,540 MB in 83 s** and was still climbing, tracking the tile caches (107 → 335 MB; geometry 96 → 292 MB, ArrayBuffers 173 → 639) — ~3.9 MB of footprint per cached tile-MB; at `mid` the three caches may hold 832 MB of tiles and REST at 624 (the 0.75 floor): the cache design alone crosses WebContent's 2,048 MB cap. **THE LEVER: `QUALITY.leanMobile.{lruBytesMB 48, enrichedLruBytesMB 128, groundLruBytesMB 112}` through the pure `lruCapBytesForLean`** (`min` against the tier's cap on EVERY tier, `high`'s null included — the library's 0.4 GiB default is not a phone number; `lean === false` is the argument cap by definition, desktop byte-identical; `StylizedTiles` gains a `lean` opt from `deviceCaps.coarsePointer`), sized above the Dnipro FPV working set (4.5 / 47.5 / 54.6 MB) so the U2/A9 parse → full → discard loop cannot start. Twin, same gesture: the caches rest at 8.6 / 84 / 96 MB from ~35 s, geometry plateaus at 163 MB, footprint 1.0–1.18 GB (802 after a forced GC) instead of climbing through 1.54. **Also built — `RENDERER.releaseOnPageHide`:** `GlobeCanvas`'s cleanup is a named idempotent `teardown()` that also runs on `pagehide` followed by `renderer.forceContextLoss()`; a bfcache `pageshow` reloads; hash navigations never fire it. (Note: this library's `LRUCache` has no `unloadAll` — §21.1's lever sketch named one; `TilesRenderer.dispose()` is the release.) **4 · THE FARM A/B (MEASUREMENTS §22.5), clean — no `src/` edit during either run.** Caps ON (`--poses m,fpv --ramp 0 --soak-min 4 --soak-no-reboot`): **`/m` dt 17/17, cpu 2 ms (was 26, §19 — T107 confirmed on the iPhone)**; `#f=` as the SECOND load in the process alive (boot 7.5 s, cpu 3); the in-place soak **alive at page age 269 s**, caches resting at 8.6 / 84 / 97 MB, no tier change. Caps OFF (the same tree, the lean caps at 100,000 for the run): 124 / 187 MB and climbing at 92 s, **dead before page age 115 s**. **T83 FIXED.** Watch: dt p50 18 → 26 ms over the 4-min look-around (hitches ~1 /s — T106's family); the flip bank under the smaller phone caps unmeasured. **5 · THE VISIBILITY / OCCLUSION AUDIT** (`audits/audit-occlusion-2026-09-07.md`; three read-only opus finders — occluder side, consumer side, T77 regression risk — then the main agent verified in code). Verdict: **no T77 regression** (zero files under `src/lib/geo/**` touched since 09-04; no hot-path module imported there; `heightMemo`'s re-architecture errs toward over-invalidation; `frameFreeze` DEV-gated; C-1's seat freeze ≤ 0.5 px / 1 % relief; 693/693 focused tests). ONE occluder pipeline feeds every radar / scrubber / plan / FIND / TARGET surface (`planFeed` → `store/plan.profileBins`, desktop and `/m` byte-identical); BEST SPOT has its own. Terrain, OSM, enriched, height overrides (through the seated position arrays) and trees were in both. **Two real gaps, both pre-existing, both FIXED:** (A1, T108) **user models occluded nothing** — `collectMeshes` walked the two tile groups only, `flattenTin` the three, `attachUserModels` adds to `scene`; now `userModels.occluderRoot()` + `occluderEpoch()` (bumped on resident/unload, the MDL chip, committed seats, rebase, every drag frame), both feeds visit the group (no OSM-mask rejection, instanced meshes inside a GLB skipped; BEST SPOT flattens it into SOLID outside the surveyed/extruded provenance count) and watch the epoch. (A2, T109) **a tile landing after the sweep never re-profiled** — `planFeed`'s one invalidation was the enriched re-seat epoch (Dnipro-only; outside Dnipro nothing past the 25 m eye deadband) while `builtEpochN` / `ground.terrainEpoch()` were computed two lines below for bestSpotFeed alone (its D1, fixed there 2026-08-24); now `PlanFeedCtx` carries `terrainEpoch · builtEpoch · modelsEpoch` and a change after the build started re-sweeps the SAME anchor after `PLAN.streamQuietFrames` 90 quiet frames (one burst = one rebuild). (A3, T109) That fix would have blanked the radar on every arrival — `startBuild` nulled the mirror for the 40 + meshes/2 frames of a sliced rebuild — so **the carry policy**: the last complete profile (`shown`) stays published while the new eye is within `PLAN.carryProfileDistM` 60 m (= `AIMCONES.skylineGuardM`, test-locked ≤), null beyond as before; `debug().carried`. Design tails for the owner: **T110** 3° bins under a 600 mm lens (a fine mesh-only bin array recommended) · **T111** the HUD chips / day arcs / showers / eclipse rows use the geometric horizon only (`profileSample()` has one caller — a null check) · **T112** six consumers skip `skylineBinsFor`'s honesty gate · **T113** BEST SPOT's mask asymmetry + dead `addFloatingSolid` · **T114** `heightMemo` region-less tiles. Tests: `test/components/globe/planFeed.test.ts` NEW (9), bestSpotFeed +2, userModels +1, quality +3; two source-pin tests re-pointed at the named `teardown()`. **Gates: vitest 2,782/2,782 (177 files) · `astro check` 0/0/11 · knip 0 · post sweep `post-2026-09-07c` 13/14 (only `legacy-m` = T103), sheets read: identical to the pre run at every pose.** Backlog T1–T114 (T108–T114 new; T83 FIXED). Traps: HMR reaches the phone through the tunnel — a `src/` edit during a farm run is a second document on the phone; the soak's `LOOK` must bail on the FIRST stall (each is 120 s of device time).

### 2026-09-07b — THE PHONES AND THE DESCENT, MEASURED WHERE THE TIME IS: T83 CLASSIFIED (a jetsam kill at WebContent's 2,048 MB per-process cap), the Pixel re-measured WITH terrain (the first run was a bare sphere — the owner caught it), lever 10 CLOSED on a real CPU profile (glTF parse 0.7 %), T107 FIXED (`getPivotPoint` every frame — the `/m` 26/58 ms and the descent's arrival hitches), T106 OPENED (the enriched cell's `load-model` work is the phone's descent hitch). Boot: the a session's ship hook fired on `/clear` and LANDED (PR #107, master c5dcd3a — gates green this time); VPN IE, ion 401, house Chrome :9333, `wix dev` with `.vite` aside, the Pixel 6 Pro attached over adb; pre sweep `pre-2026-09-07b --quiet-s 25` 13/14 (`legacy-m` = T103), sheets read: real terrain at every pose. **1 · T83 CLASSIFIED (MEASUREMENTS §21.1).** The Device Farm API lists a session's artifacts once COMPLETED; all four sessions' device syslogs carry `memorystatus: com.apple.WebKit.WebContent [pid] exceeded mem limit: ActiveHard 2048 MB (fatal) … killed by jetsam reason per-process-limit` (2,097,154 KB; 2.9 GB of pages FREE — the per-process cap, not pressure; `type:app`, not a hang). The Appium log puts every pose navigation in ONE WebContent (born at the first pose; ages at the kill 176 / 198 / 88 / 70 s) and the kill 14–25 s after the SECOND `#f=` load in that process, every time. Desktop twin (`scripts/probe-memory-footprint.mjs`, new: `/usr/bin/footprint` of the renderer and GPU processes, V8 heap + ArrayBuffer backing, an in-page walk of the LRU caches and the scene for geometry and DECODED-IMAGE bytes; the 17 Pro's profile): one FPV page ~510 MB flat for 3 min (peak 592 streaming; images 146 MB — the 8k earth set, geometry 74, ArrayBuffers 137); the same tab fpv → /m → fpv by DIRECT navigation stacks 557 → 752 → **1,196 MB** (926 after a forced GC, ArrayBuffers 130 → 260 — the previous documents stay resident); with the farm tool's about:blank hop the renderer frees each document but **the GPU process stacks ~470 MB per page load** (838 → 1,781 over three) — the destroyed pages' WebGL contexts keep their textures and buffers until the canvas is collected. Lever named, not built: **release on `pagehide`** (`renderer.dispose()` + `forceContextLoss()`, `lruCache.unloadAll()` ×3, drop the 8k `texture.image`s); `Cache-Control: no-store` is the blunt alternative. The fifth session (`9b042dcb…`, `--poses fpv --ramp 0 --soak-min 3`): the soak re-boots the eye (a second load); its log stopped at 0.5 min (23:14:23Z) — killed by hand at 23:16Z when the next row was 90 s late (the tool's six `LOOK` calls stall 120 s each on a dead page: 12 min of billing per soak row — README-worthy); 13.2 device minutes; its syslog (COMPLETED 15 min later): the same line, pid 683 **99 s old** (born at the first fpv), the kill **63 s after the second load** — five for five. Still unmeasured: a SINGLE page's survival (every first page was navigated away at 34–45 s) — a `--soak-no-reboot` decides it. **2 · The Pixel (MEASUREMENTS §21.2).** The first quick run read `visible gnd 0`, city / everest 317k tris (the base sphere) — `adb reverse` carries only `localhost:4321`, the phone fetches ion over ITS network and the Dnipro mobile address is blocked (T98's phone lane); the owner spotted it mid-run and enabled the phone's VPN. §11's 2026-09-05 Pixel city / everest / `/m` rows have the same signature and are VOID. `verify-perf-baseline --device` now asks ion from the phone's page before the first boot (403 → exit 3) and FAILs a non-FPV cell that settles with no ground tiles. Re-run, terrain on (exit FI, 19 cells / 7.7 min): orbit **80.6 → 16.7 ms** (60 fps; gate off 119), city **16.8** (58 fps; gate off 127; `frame.cpu` 15 while streaming), everest **16.7** (gate off 155), fpv **27.5 → 21.5** (42 fps, GPU-bound, shadows on/off within 1 ms), `/m` **59.3 / cpu 57.6 — 16 fps, CPU-bound** (the terrain-less run read 16.7: the cost needs terrain to hit). **3 · `/m` profiled on the Pixel (`probe-cpu-profile --pose m --device`, §21.4): 87 % of the main thread under `controls.getPivotPoint`** — `stepMobile2dLocks` measured the live tilt with a centre-screen raycast EVERY frame, before its own deadband; the ray walks the terrain TIN's triangles (no BVH; the T79 gate arms only inside `_getPointBelowCamera`). **T107 FIXED:** the deadband is judged from the ellipsoid normal under the camera (≤ 0.003° from the pivot's against a 0.2° deadband) and the raycast runs only in frames that rotate; `stepTiltGlide` had the same shape (27–33 ms in every arrival frame of the descent on desktop `high`, the leg's largest single hitch source) → its pivot is found once per glide and refreshed every `CONTROLS.tiltGlidePivotRefreshMs` 500 (a landing tile still moves it; `_tiltGlidePivot` is its own vector — `_pivot` is shared scratch). Pixel `/m` **59.3 / cpu 57.6 / low → 16.6 / cpu 1.1 / mid** (60 fps, no demotion). The iPhone's 26 ms (§19) is the same call. `test/components/globe/mobile2dLocks.test.ts` (new, 6): the order pins + the curvature bound. **4 · Lever 10 decided (§21.3).** `probe-cpu-profile --leg descent` (new: the profiler over the owner's descent, every sample bucketed leaf → root — parse / compile / upload / seats / app / orchestrator / render / controls / gc / program / idle — frames delimited by in-profile MARKERS, 16 rotating named 0.7 ms spins the sampler sees in its own clock, alignment ±0.2 ms; the bracket method was off by 165 ms–3.3 s because `Profiler.start` runs on the busy main thread; a `--device` mode; the nearest app caller above each library leaf). Desktop `high`, hitch frames (86 of ~500, 3.08 s of main thread): controls 24 % (`stepTiltGlide` 497 ms · `rawHeightAt` 156), seats 16 % (`applyFeatureSeats` 424) + upload 12 % (their `bufferSubData` at draw, 384), app 13 % (the OSM `load-model` handler / `EdgesGeometry` 143, vector-tile parse 90), render 12 %, orchestrator 7 %, compile 2.6 % (two frames), **glTF parse 0.7 %** (whole leg 1.0–1.3 %, mostly the async `createImageBitmap`). **Lever 10 is CLOSED, not built** — §20's "every hitch is parse-phase" was the trigger, not the time. After T107: hitches **86 → 64 frames**, hitch-window main thread **3.08 → 2.31 s**. The Pixel, same leg, terrain on: dt p95 **317 ms**, max 849, 57 hitch frames carrying 6.73 s — **`enrichedBuildings.ts` `load-model` 2,261 ms + `enrichedMask` run builders 804 + the OSM load handler 325 + vector tiles 202; parse 1.4 %** → **T106** (bake the mask runs / fingerprints into the sidecar, or slice the handler across frames; measure with the same probe). **Gates:** vitest **2,767/2,767 (176 files)** · `astro check` **0/0/11** · knip 0 · Pixel `/m` re-measured after the fix (above) · desktop descent profile before/after (above) · post sweep `post-2026-09-07b --golden --compare pre-2026-09-07b --quiet-s 25`: **10/14 byte-identical** under the freeze (the reds: descent / `legacy-fpv-eye` / `legacy-city` at Δ1 on 0.5–0.7 % = the ease-step class; `legacy-m` = T103), the golden compare fails all 14 at tolerance 0 as every session (loading states — `legacy-m`'s 7.7 % is imagery detail + a vector fill landing + T103, its composition unchanged; `legacy-everest` 13 % = tiles), sheets read: real terrain at every pose; **the descent ARRIVES on the same pose to 0.02°** (pre heading 35.80° / tilt 54.82° / 1,530 m, post 35.82° / 54.82° / 1,531 m — the pivot cadence does not move the glide's landing), its worst frame 99.3 → 82.1 ms, parse-frame dt p50 18.4 → 16.8; every other pose identical in calls and triangles. Files: `src/components/globe/StylizedTiles.ts` (`stepMobile2dLocks`, `stepTiltGlide`, `_tiltGlidePivot`), `tuning.ts` (`CONTROLS.tiltGlidePivotRefreshMs`), `test/components/globe/mobile2dLocks.test.ts` (new), `scripts/probe-cpu-profile.mjs` (rewritten: `--leg descent`, `--device`, `--pose m`, the bucket ledger, markers, callers), `scripts/probe-memory-footprint.mjs` (new), `scripts/verify-perf-baseline.mjs` (the phone-side ion gate + the terrain-visible check). Records: MEASUREMENTS **§21** · T77 plan pointer + lever 10's row · backlog T83 / T98 amended, **T106–T107** added (T1–T107) · `mem:core` · `mem:project/wip-2026-09-07-t77-phones-lever10` · `NEXT_SESSION_PROMPT.md`. Device Farm artifacts for the five sessions: `~/.claude/ftw-wt-patches-2026-09-07b/devicefarm-*/` (syslogs, the Appium log, the video).

### 2026-09-07a — T100 CLOSED under ruling (a): the ground OVERLAY's own extinction tail, and ruling (b)'s field band SUPERSEDED back to the disc; T105 (the ladder wrote its shots into `./--ladder`). Boot: session n's ship hook had ABORTED at 23:07 (vitest red) — two `bestSpotHonesty` MEASURED tests timed out at the 5 s default under the full suite while another Claude session's `find /` held the load average at 12–18; they pass alone in ~1 s and now carry the 60 s timeout every sibling MEASURED test already had (session n's whole tree was still uncommitted; it ships with this one). VPN IE, ion 401, one house Chrome :9333, `wix dev` with `.vite` aside; the pre state is session n's post sweep. **The frame challenge, from §17.2's own four arms before any edit:** at 0° the field falls 1.000 → 0.637 across the arms and the band luma moves 0.7 codes, where an overlay scaled by a single light's field would move ~6 — the ground twins are a stock `ShadowMaterial` whose mask is `mix(1, shadow, intensity)` PER LIGHT, and the rig has three nested cascade lights over the band, so the delivered darkening is `opacity × (1 − (1 − field)³)`: blind to the field above ~0.5 and exactly 0 wherever the field is 0 (it predicts E-a's −0.14° rung at 70.3; measured 70.34). Hence (1) the field band was nearly irrelevant to T66, and (2) ruling (b)'s band, ending at −0.33°, zeroed the overlay at −0.5° whatever the overlay asked for — every arm's 75.0 there. **Built:** `lib/globe/duskLight.overlayReleaseK` — `keyLevel(start) × x^pow`, `x` the sun's place in the `[gate, start]` band, 0 at/below the gate, identity when `start ≤ gate`; `StylizedTiles` reads `shadowDirectShareK(max(ultraDirectK, tail))` on the chip's cascade REACH condition (`ultraOn && shadowCascades.length > 0`, the fence's third entry on it), the tail's top read off `keyExtinctCurve` at boot so it meets the key exactly where it starts and sits UNDER it above (the raking hour, the daytime overlay and the off-state byte-identical; F1's exactness at `directK` 1 intact); `ultraLook().shadow.overlayTailK` + the DBG row. `ULTRA.overlayReleaseStartSin` sin(+0.2°) · `overlayReleasePow` 0.9 · `shadowReleaseStartSin` at its documented identity (`shadowGateSin + shadowFadeBandSin`, sin −0.30°) — the (b) knob and its clamp stay. **The ladder, walked on the exponent (house :9333, alone):** 1.4 (the model's pick) left an overlay of 0.047 at −0.5° and read 73.1 (T66 3.01 — the band T66 samples takes only ~55 % of the overlay's opacity there); 1.0 → 71.9 (1.85, all of it on the −0.14 → −0.5° step); **0.9 → 71.5: series 67.4 68.4 68.6 70.1 71.5 73.0, steps 0.9 / 0.2 / 1.5 / 1.4 / 1.4, T66 1.48 — 19/19.** Every rung above −0.3° is the l/n digit. `--ultra 0` **19/19**, luma series identical to §17.6 digit for digit, `overlayTailK` 0 at every rung. Charter **84/85** (RC2 0.0508 chip-off, unchanged). `verify-ultra` **30/30**. By eye (the ladder's −0.5° shots, n vs now): indistinguishable — no shadow shape, no edge. Post sweep `post-2026-09-07-t100a --golden --compare post-2026-09-06n --quiet-s 25`: **13/14 byte-identical** under the freeze (`legacy-m` = T103), the golden compare fails all 14 at tolerance 0 as every session (loading states — the sweep runs the chip off, where the tail is inert), sheets read: real terrain at every pose. **T105:** `verify-ultra-dusk.mjs` read its positionals as `argv[2]`/`argv[3]` verbatim, so `9333 --ladder --ultra 1` wrote 24 shots into `./--ladder` — fixed (non-option args in order), shots moved to `verify-shots/t100a/`. Gates: vitest **2,761/2,761 (175)** · astro 0/0/10 · knip 0. Files: `src/lib/globe/duskLight.ts` (+`overlayReleaseK`), `src/components/globe/tuning.ts` (`overlayReleaseStartSin`, `overlayReleasePow`, `shadowReleaseStartSin` identity + docblocks), `StylizedTiles.ts` (`OVERLAY_TAIL_TOP`, the `max()`, the seams), `src/lib/globe/debugCatalog.ts` (+1 row), tests `duskLight` +7 · `keyHandoff` T100 block rewritten (5) · `duskShadeRatio` +5 (a chip arm of the twin) · `fences` +1 · `bestSpotHonesty` timeouts; `scripts/verify-ultra-dusk.mjs` (T100 checks re-pointed + the (a) check; positionals). **Then, the plan's steps 2 and 3 in the same session. THE PHONE RE-MEASURE (iPhone 17 Pro, Device Farm, ~10 device minutes; the Pixel was NOT attached over adb — owed; MEASUREMENTS §19):** the desktop slices reached the phone — orbit / city / everest, which read 9–13 fps CPU-bound (74–91 ms of controls raycast) in §11, read **60 / 50 / 60 fps at `mid` with 3–4 ms of CPU** and the governor no longer demotes; the FPV eye stays at its 60 Hz cap; `/m` 9 → 34 fps but STILL 26 ms of main thread (its own cost — `probe-cpu-profile` on `/m` is the next read). **T83 REPRODUCED on this tree:** the kill ramp's first step (6 seeded rows, reload the `#f=` eye) died inside 120 s twice — T80's −245 MB VRAM did not move it (the late-GPU-landing hypothesis weakened); the session's console video + syslog (`…/ed840495-122f-4465-82a0-cb803fc13d7a/00000`) decide kill vs hang. Tunnel fact re-learned and now in the README's command: `cloudflared --protocol http2` (QUIC → 530). **THE STREAMING MEASUREMENT (slice C, levers 9–11; MEASUREMENTS §20):** `verify-visual-sweep`'s descent leg now records per frame the three tilesets' download / parse queues (items + jobs), LRU MB, `inCache` and the feed's `frame.cpu`, and writes `streaming.json`; one leg at `high`, chip off: 616 frames, busy 169, download-only 5, parse-phase 164; peaks queue 749 (dl 550 / parse 159), `inCache` 805, LRU **gnd 308 MB** / enr 207 / bld 9; **all 22 hitches (dt > 33 ms; p95 37.6, max 78.4) are parse-phase frames and `frame.cpu` reads 5–11 ms in the worst of them** — the hitch is main-thread work OUTSIDE the orchestrator's bracket (glTF parse landing and/or first-draw GPU upload); the download side keeps up. Decision: lever 10 (worker decode) is aimed at exactly those frames IF the time is the parse and not the upload — `probe-cpu-profile` over the descent leg is the one measurement left before building it; lever 9 is re-aimed (the 308 MB is imagery, not user textures) or parked; lever 11 does not appear in this leg. Records: MEASUREMENTS **§18–§20** · backlog T100 CLOSED, T83 amended, **T105** · the T77 plan pointer · `mem:core` · `mem:project/wip-2026-09-07-t100a-overlay-tail` · `NEXT_SESSION_PROMPT.md`.

### 2026-09-06o — OWNER RULING on T100 (owner, verbatim: "t100 record for next session to go with your reccomendation"): **option (a) — spread the ground OVERLAY's retirement**, the recommended lever. The field band (ruling b, session n) stays as shipped; the next rendering session builds the overlay's release: `shadowDirectShareK` follows `ULTRA.keyExtinctCurve`, whose last step (0.138 → 0 over the 0.36° before −0.5°) is the cliff every ladder arm measured at the −0.14° → −0.5° rung (§17.2) — so either the extinction tail runs to true sunset (−0.833°, where the disc actually sets: the physically honest shape, a LOOK change on every sunset frame) or the overlay's own retirement is eased over the +0.2 → −0.83° band, whichever spreads the ~7 codes over the five rungs with the smaller change to the sunset pair (`everest-fpv-sunset-ab`, `dnipro-fpv-west-sunset`). Gate unchanged: `verify-ultra-dusk --ladder --ultra 1` T66 ≤ 2 codes at every rung, `--ultra 0` still 19/19 byte-identical, charter RC2 ≤ 0.05, `verify-ultra` 30/30, the sunset pair on the sheets by eye. Owner's two questions answered in the same turn (where T77 stands vs the plan; the phones are MEASURED, not fixed — next phone step is the re-measure on this tree, then T83): `NEXT_SESSION_PROMPT.md` §Where T77 stands. Records: backlog T100 · `mem:core` · the n leaf.

*(Sentinel — older sessions moved byte-identical to `DECISIONS_ARCHIVE.md`: 2026-08-02 →
2026-08-15e in §Moved 2026-08-18 (round 3), 2026-08-17 → 2026-08-19d in §Moved 2026-08-22
(round 4, md5 5ed47c51b9d44a754964771ffe418330, 556 lines / 79,306 B), and 2026-08-21 →
2026-09-05 in §Moved 2026-09-06 (round 5, md5 4260321dc13ba45b11c3de0bb5c8856e, 865 lines / 410,237 B),
and 2026-09-05b → 2026-09-06n in §Moved 2026-09-07 (round 6, md5 2137d0be57d10eccd791b4738c52e411,
34 lines / 80,273 B — the T77 MEASURE → phones → slice 0 → six worktrees → five-rulings span).
Their era digests live in §Per-phase digests above. Entries above this line are the T77 era's live
tail, 2026-09-06o →, kept verbatim while that work is live.)*
