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

### 2026-09-06g — DOCS + MEMORY HYGIENE SWEEP DONE (owner order 2026-09-06f; `/frame` Audit Tracks D + E + the guide gap under the investigate-design-v3 review spine; ten opus subagents; report `audits/audit-docs-hygiene-2026-09-06.md`; `mem:project/wip-2026-09-06-docs-hygiene`). **(1) DECISIONS compaction round 5 (T40):** verbatim sessions 2026-08-21 → 2026-09-05 (through MESH SUITE MS8) moved byte-identical to `DECISIONS_ARCHIVE.md` §Moved 2026-09-06 — **md5 `4260321dc13ba45b11c3de0bb5c8856e`, 865 lines / 410,237 B** (two spans of the old file, lines 365–1185 and 1195–1238, because the append-marker sat between them); 12 era digests appended to §Per-phase digests (OWNER BATCHES #4–#6 + QA · AUDIT #3 + F1–F10 · GUIDE FINAL · ULTRA + eclipses + dusk · BEST SPOT → PARKED · FORMAL VERIFICATION · BRAND · RENDERING CHARTER CLOSED · REGION #4 Chernobyl built → deleted · DBG chip · MESH SUITE MS0–MS3 · MESH SUITE MS4–MS8 + T77 lead-in); the marker re-seated directly under this heading (fourth drift); this file 466,847 → 69,668 B, §Recent 437.0 → 27.0 KB; the T77 era (2026-09-05b →) stays verbatim. Proof: `git diff -U0` — every removed dated line is in the archive block (63 headings out, 0 in); the archive's appended bytes hash to the md5 above. **(2) Memory graph:** `mem:core` 93,859 → 12,259 B (status re-dated, a 25-line T77 resume, 29 era rows reaching all 126 `project/wip-*` leaves — machine-checked; a 67-fact orphan sweep found nothing that lives only in the old narrative); 16 over-cap wip leaves compacted to ≤ 10,240 B with `compacted 2026-09-06 from N B` first lines; `patterns/sky-bodies-terrain` 19,337 → 15,338 B; ten dated SUPERSEDED / NOTE blocks in the always-offered memories (5 collections with 30/26/17/29/9 fields and 11 routes, not 3 and 8; `StylizedTiles.ts` 7,495 lines; `TERRAIN_SINK_M` gone; `zoomMinAltM` 2; moon 0.5/2.9/0.12; the checkerboard bug's `age<1` suspect no longer exists in `imageryGround.ts`); `memrefs.sh` 221 references / 0 unresolved (probe proven to fail). **(3) Backlog:** T59–T70 had shipped 2026-08-27 with 3 of 5 columns — Pointer + State reconstructed and dated; 22 dated state edits (T77 PARKED, T78 CLOSED, T80 blocked on the owner, T56/T57 superseded by T75, nine PARKED notes); rows T88 (RC7 convergence 50.3 % vs 0.9), T89 (RC9 warm-restore never run in a browser), T90 (`readiness` never advances after POST), T91 (RC16 residual straddler duplicate, from the 2026-08-26d entry); T40's compaction sub-item CLOSED; header T1–T91. **(4) Docs:** new entry points `rendering/README.md` (13-file status table + the T77 read order), `audits/README.md`, `archive/README.md`, `dnipro-enrichment/README.md`; five dated status banners in `rendering/` (WEB_RESEARCH_PROMPT DONE, RENDERING_QUALITY_PASS SUPERSEDED, IPHONE checklist §A/§B DONE, charter CLOSED, FPV audit PARTLY SUPERSEDED); `ARCHITECTURE.md` §7d (MESH SUITE as shipped) + §7e (DBG window, T77 slice 0, phone harnesses) + a §5 data-model note; `IMPLEMENTATION_PLAN.md` "Tracks after Phase 8" with DECISIONS-verified states + the second GOTO disambiguation; 13 stale pending-tags re-dated; `RENDERING_ARCHITECTURE.md` named a seam `__globe.debugSeats()` that never existed — corrected to `__globe.enrichedSeats()`; BEST SPOT spec + plan got "read README first" banners; `conventions/architecture-and-patterns.md` rule-4 note; four real dangling references fixed (`tech_stack:25` `public/wasm/`, the comet leaf's `scene/comet.ts`, `track5-numbers.md:31`, `OSM2WORLD_EXPERIMENT_PREP.md:323`). Conventions `globe-tuning.md` + `contracts.md` verified: every cited path and identifier exists; the 28-seam `__globe` count holds. **(5) The guide gap (D5):** small and real — `guideContent.ts` +2 topics `model-limits` (15 MB / 8 MB / 2048→1024→512 / 100k tris; refusals > 25 meshes, > 8 textures, rigged, DRACO/KTX2 — all grepped from `modelCaps.ts`) and `edit-handles` (G/R/S/E, ⇧ snap 1 m / 15° / 0.1×, lift caps 25 m / 50 m, who may arm what); `trust-accuracy` said building edits "apply only in your browser" — false since MS3's SYNC — now "until you press SYNC"; four topics cross-linked; 12 chapters / 84 → 86 topics (the brief's "126 topics" was never true); +2 golden search rows; guide + brand + parity + astro-shape tests 104/104. Checklist 13: 2 delegated-affordance hits, one (`bldgOverrides.ts:89`, the building lift) had no guide text — now covered. **Gates end:** vitest **2,465/2,465 (164 files)** · astro **0/0/9** · knip **0** · link probe 0 real dangling. **Audit purity:** the only `src/` diff is `src/lib/guide/guideContent.ts` (+ `test/lib/guide/guideSearchGolden.test.ts`); `scripts/`, `tools/` untouched. **Left for later** (report §Fix-session slicing): the two `pluxGlobeControls.ts:50,115` docstrings name `__globe.belowCameraGate` where the seam is `__globe.controls.belowCameraGate` (first T77 session); `globe-tuning.md` §ULTRA lacks the 2026-08-27 tunables; `README.md` test count 1,902 → 2,465; the core cap has 29 B of slack under 12 KB (raise to 16 KB or split the Era index — owner call). Next: T77 resumes at T80 (`NEXT_SESSION_PROMPT.md`, rewritten).

### 2026-09-06f — OWNER ORDER: PARK T77 FOR ONE DOCS-HYGIENE SESSION, THEN RESUME (the owner, verbatim intent: "a quick sweep over decisions log, memories and architecture and plan docs to dedupe, archive and optimize (use audit mode) and also go through the guide and see what is missing in terms of the features and add it, with no-slop applied to everything; fit it in one session; then we continue with the rendering/performance main plan"). **The park:** a dated WHERE-WE-ARE pointer block at the top of `rendering/T77_AUDIT_PLAN_2026-09-05.md` (step 1 done · 1b done on both phones, iOS ramp/soak unclassified = T83 · slice 0: T79 CLOSED, **T80 blocked on the owner's pixels-at-`high` ruling** · slices A–E not started · owner calls T80 / T85 / the unused rooftop lever); the tree at the park is the 2026-09-06e ship, nothing half-edited. **The charter** lives in `NEXT_SESSION_PROMPT.md` §"THE NEXT SESSION": `/frame` Audit mode (Tracks D + E + the guide gap; `checklists/docs.md`) with the owner-authorized write set (docs, memories, conventions, skill references, and the ONE `src/` exception `src/lib/guide/guideContent.ts` + its tests); measured baseline — DECISIONS §Recent **418 KB / 895 lines** (compaction round 5 = T40, 3× overdue; boundary 2026-08-21 → 2026-09-05 through MS8, the T77 era stays verbatim), `mem:core` **90 KB vs the 12 KB cap**, 130 wip leaves / 1.4 MB, `rendering/` 12 files with no README, the backlog 94 KB; Track D5 = the guide gap by inventory (features shipped since 2026-08-22g vs the 126 topic ids) — the MS7/MS8 copy already landed, so a small gap is the honest expectation; `no-slop` PASS on every string written. Backlog: T40 dated edit, **T87 new** (the hygiene debt row). After it: T80 (owner call first) → slice A. Files this line touches: the plan pointer, the brief, the backlog, `mem:core` Next step, the session memory.

### 2026-09-06e — SLICE 0 / T79 HARNESS LIST GREEN (the §8 list re-run against the gated build): `verify-rendering-charter` 85/85 — its first run read 80/85 with all five FAILs in the RC3/RC4 pitch sweep, which drives bare `#f=` hashes and therefore the REAL clock: at 02:45 Dnipro local the sun is down and the rig is (correctly) not casting — a time-of-day dependency in the harness, not the gate; the sweep now pins `&t=1787133600000` (Dnipro midday, the perf baseline's `T_FPV`) and re-ran 85/85 · `verify-ultra` 28/28 · `verify-meshedit` PASS · `verify-usermodels` PASS 21 legs · `verify-qaslice-cab` 65/65 · `verify-pin-reframe` RED with the exact pre-existing T76 signature (`heightAt(pin) = −2047` from the 976 km start — environment-shaped, unchanged). With the 2026-09-06d receipt (vitest 2,463 · astro 0/0/9 · knip 0 · perf `--quick` 32/32 with the gate A/B) **T79 CLOSES** (backlog dated edit). Files this line adds: `scripts/verify-rendering-charter.mjs` (the pinned sweep). Next session: T80 bloom needs the owner's ruling on pixels at `high` first; then slice A (shadows, the shimmer gate).

### 2026-09-06d — T77 STEP 1b THE PHONE RUNS DONE + SLICE 0 / T79 BUILT (implement, Deep; `/frame` under investigate-design-v3): **(1) both phones read.** iPhone 17 Pro over AWS Device Farm (`tools/devicefarm/ios-baseline.mjs`; the flow classified: tunnel ✓ Safari caps ✓ seam read ✓ boot marker ✓; `cloudflared` needs `--protocol http2` here — QUIC is blocked; two tool bugs fixed: a statement-list probe JavaScriptCore rejects inside `return (…)`, and a cwd-relative `OUT_DIR` that wrote outside the repo; hardened against a dead page — `connectionRetryCount 0`, a stall classifier, `fpv,fpv`, `--ramp 0`) and Pixel 6 Pro over adb (`verify-perf-baseline.mjs 9444 --device --quick`, 15 cells / 0 failures; Android Chrome refuses `PUT /json/new` → the harness drives the recipe's tab). **Verdict (`MEASUREMENTS` §11 rewritten):** FPV fine on both (17 Pro at its 60 Hz cap with 2 ms CPU; Pixel GPU-bound at 30 fps), **every orbit pose 9–13 fps on BOTH, 74–109 ms of main thread in the controls' down-raycast**, the governor's demotion to `low` useless against it. The iPhone kill ramp + soak did NOT classify: the FPV page dies 40–60 s after load with or without seeded models (3 sessions; kill vs hang → the console videos; **T83**). ≈ 78 of 1,000 trial minutes spent. **(2) T79 re-attributed and BUILT.** `scripts/probe-below-camera.mjs` (new) times the down-ray per scene object: **15.9 of 21 ms per call is the BASE EARTH** — `baseEarth.ts:183` `SphereGeometry(1, 384, 384)`, 294 k tris, sunk 1.9 km, the one backdrop with a live default `raycast` — 3.1 ms the enriched cells, 2.1 the OSM tiles, 0.02 terrain (MEASURE §7's "7.7 M-vertex soup" was wrong; dated correction appended to §7). Fix = **the below-camera GATE**: `src/lib/globe/belowCameraGate.ts` wraps `THREE.Mesh.prototype.raycast` once; armed only inside `scene/pluxGlobeControls.ts` (`PluxGlobeControls extends GlobeControls`, overriding `_getPointBelowCamera` + `_updateZoom`) a mesh proven to top out below `cameraRadius + actionHeightOffset + CONTROLS.belowCameraGateMarginM (0.5)` skips its triangle loop — three exact upper bounds (position-attribute AABB corners; the O(1) ellipsoid support for `SphereGeometry`; a cached vertex-support scan) — EXACT by construction (the callers consume one bit, `dist < cameraRadius`; the ellipsoid pre-check keeps the fallback corner exact; the zoom path runs untouched), so the orbit camera's rooftop clearance is byte-for-byte what it was and NO owner call was needed. `StylizedTiles.ts:1089` constructs the subclass; DEV seam `__globe.controls.belowCameraGate(enabled?)` (contracts §3). **Tests:** `test/lib/globe/belowCameraGate.test.ts` (a 400-random-scene property: gated vs ungated push decision identical, same hit when it pushes; all three bounds exercised; the real base-earth shape skipped at 700 m over 48° N with zero scans) + `test/components/globe/pluxGlobeControls.test.ts` (source pins on the 0.4.28 private names; a Dnipro rig). **Receipt:** vitest 2,463/2,463 (164 files) · astro 0/0/9 · knip 0 · `verify-perf-baseline --quick --label t79` 32 cells / 0 failures with the new `gateOff` A/B cells: orbit dt 44.5 → **18.1** ms, cpu 43.3 → **1.2** (fps 22 → 55); ULTRA orbit 44.3 → 21.0; Everest 32.2 → **17.9** (cpu 31.4 → 0.9); `/m` 35.8 → **12.1** (a 12 ms residual on that route — **T84**); city 49.0 → 37.0 (GPU-bound); FPV cells unchanged (the gate never arms there) — the slice-0 gate passes. Harness list (`ENGINE_STATE` §8) re-run this session: see the 2026-09-06e line. Docs: `rendering/T77_SLICE0_ORBIT_FRAME_2026-09-06.md` (as-built + receipt + owner calls), `MEASUREMENTS` §7 correction + §11 rewrite, backlog T79 BUILT · T77 pointer · **T83–T86 new** (T85 = the owner call `baseEarth` `raycast = () => {}` — optional hygiene, changes pointer picks through tile gaps). Next: T80 bloom (owner call on pixels at `high`), then slice A.

### 2026-09-06c — OWNER SETUP DONE + DRY RUN VERIFIED (T1 / T77 step 1b): the owner installed `awscli` (2.36) + `cloudflared` (2026.8.3) via brew and configured the AWS profile **`plux`** (region `us-west-2`, output `json`) with the account's **ROOT access key** — flagged "be careful". Rules adopted: the tools call only Device Farm's List / Get / CreateRemoteAccessSession / StopRemoteAccessSession, never print or store a credential, nothing in the repo reads `~/.aws`; recommended follow-up — an IAM user with `AWSDeviceFarmFullAccess` instead of the root key. **Dry run (read-only, no session, no minutes):** `sts get-caller-identity` = the account root; project `…:project:69e9a004-b773-4e76-87d5-259381e752df`; the owner's private pool "Iphone 17pro" names device `…:device:6200F380A4874FEB9C72EED72B863B67` = **Apple iPhone 17 Pro, iOS 26.3.1, 1206×2622, HIGHLY_AVAILABLE, remote access enabled** (a 17 Pro Max is in the public fleet too). `ios-baseline.mjs` now prefers the pool's device over a MODEL match, lists the pools + fleet in `--dry-run`, and no longer needs `wix dev` for a dry run. Docs: `tools/devicefarm/README.md` (profile, root-key posture, status), checklist §D (owner setup → DONE with the dry-run evidence), MEASUREMENTS §11 (status line), NEXT_SESSION_PROMPT rewritten — **next session = STEP 1 the phone baseline runs (Device Farm iPhone 17 Pro → the Pixel 6 Pro over adb), with the safety rules and the classification list, THEN STEP 2 slice 0 (T79 / T80)**. Verification: `node --check`; the dry run against the real account; `knip 0` (tools/ is outside its globs by design); the harness fence green. No device has run yet.

### 2026-09-06b — OWNER RULINGS + THE PHONE FLOW BUILT (design + implement, Standard; T1 / T77 step 1b): the owner created an AWS Device Farm project with an **iPhone 17 Pro single-device pool** (1,000 free trial minutes; a BrowserStack paid account is the fallback if they run out) and offers **their own Pixel 6 Pro over adb** for Android "as much as you wish". Researched against the Device Farm developer guide (read 2026-09-06): a REMOTE ACCESS session exposes an **Appium endpoint** (`GetRemoteAccessSession → endpoints.remoteDriverEndpoint`), web apps are tested by `browserName: "Safari"` on iOS, 150-min hard cap, 5-min idle timeout, 4-min per-command limit, XCUITest only, metered per device minute, video + syslog kept per session; the free trial is a one-time 1,000 minutes. **Built:** `tools/devicefarm/ios-baseline.mjs` (+ its OWN `package.json` — `webdriverio` + `@aws-sdk/client-device-farm`, kept out of the app's package.json so knip and the Wix build never see it; node_modules gitignored) — creates the session (`appium:version 3`, fleet MODEL "iPhone 17 Pro"), waits RUNNING, drives Safari through a tunnel to `wix dev` (`cloudflared` — ngrok's free interstitial blocks a scripted Safari), reads `window.__debugFeed.snapshot()` at the five poses, runs the kill ramp (seed from the Mac → reload → 20 s → a vanished boot marker = the jetsam reload), the 8-min soak with a synthetic look-around, `finally` unseeds + STOPS the session; `--dry-run` resolves project + device without a session; README with the recipe. **`verify-perf-baseline.mjs --device`** — a real phone's Chrome over adb: no emulation, no tier override (the device's own detection; the ULTRA pref REFUSED on a coarse pointer is asserted), env records screen/DPR/renderer; recipe `adb reverse tcp:4321 tcp:4321` + `adb forward tcp:9444 localabstract:chrome_devtools_remote` → `node scripts/verify-perf-baseline.mjs 9444 --device` (the temporal harness and the CPU profile probe run the same way). Checklist §D rewritten (the farm recipe + the owner's setup list), §D2 added (Android). **What the owner still sets up:** AWS credentials on this Mac (`~/.aws/credentials` profile or `AWS_*` env; `devicefarm:List*/CreateRemoteAccessSession/GetRemoteAccessSession/StopRemoteAccessSession` on the project — `AWSDeviceFarmFullAccess` is the simple form), the project ARN (optional), `brew install cloudflared`, the Pixel with USB debugging on. **Verification:** local only — `node --check` both scripts, the devicefarm deps import, `--dry-run` fails clearly with `wix dev` down; `verifyHarness.test.ts` green; NOTHING has run on a device (no credentials, no phone attached) — the first farm run and the first adb run are the next mobile session's first steps and will classify both paths. knip: `tools/` is outside its `project` globs by design.

### 2026-09-06 — T77 STEP 1 MEASURE DONE (implement, Deep, investigate-design-v3 spine on `/frame` Audit rules — READ-ONLY on `src/` except two DEV read seams; backlog T77 + new T79–T82; `mem:project/wip-2026-09-05-t77-measure`). Owner order 2026-09-05 ("prepare next session for a full blown audit"): the plan's step 1 — MEASURE before anything is optimized. **Built (instruments, no behaviour):** `scripts/verify-perf-baseline.mjs` (the §3 matrix on the owner's HEADED Chrome 152 / M3 Pro / 120 Hz / warm profile: one BOOT per pose × ULTRA pref (pre-boot localStorage via `Page.addScriptToEvaluateOnNewDocument`) × DEVICE tier (pre-boot `navigator.hardwareConcurrency` override 2 → `low`, 4 → `mid`; the governor PINNED in-page right after the seams appear — a later `force()` replays the tier's renderer half) × resident models (`/api/dev-seed kind:"model"` rows at the Khronos DamagedHelmet — 15,452 tris, five 2048² textures, 3.6 MiB; `dev-seed` accepts any https URL so the plan's one-time upload was unnecessary; N = TOTAL resident, the world held 3 real member models; every row removed in `finally`, journaled); per boot the samples `on` / `bloomOff` / `noUpdate` (`shadowMap.autoUpdate=false`: the depth pass alone) / `off` (`shadowMap.enabled=false`); a 10 s HUD-closed rAF sampler (dt, `__renderer.info` whole-frame calls/tris, governor EMA + hitches, RC21 gate draws/skips, heap) then a 6 s window with the feed ACTIVE but no panel (frame.cpu / draw / gpu + every provider); artefacts written after EVERY cell; a boot failure replaces the target and continues; a rAF watchdog records `rafStalled`) · `scripts/verify-temporal-stability.mjs` (the two metrics ENGINE_STATE §8 lacked: SHIMMER = a screen-space shadow mask by `shadow.intensity` A/B inside one rAF, XORed frame-to-frame under a `setTime` scrub of exactly 2,000 scene-ms/frame, a frozen control leg and a 4× leg; RESEAT-SETTLE = per-frame seat residuals until near < 1 cm for `PLAN.reseatQuietFrames`, the city-wide curve reported) · `scripts/probe-cpu-profile.mjs` (V8 sampling profile of a settled pose, self time by file / function, `.cpuprofile` for DevTools) · `scripts/t77-model-ramp.mjs` (the phone kill ramp's seeding tool, journaled; imports the app's geohash encoder — a hand-copied cell was wrong). **Two DEV read seams in `src/`:** `window.__debugFeed` (`lib/globe/debugFeed.ts` `publishDebugFeedSeam` — `snapshot()` flattens every provider + the six series' statistics, `read` / `series` / `action` / `setActive`; DEV always, RUNTIME-gated everywhere else via the `debugHud` pref at boot — `lib/globe/debugBoot.ts` → `GlobeCanvas`, which also ACTIVATES the feed on a shell that never mounts the panel: the phone's console read; typed in `global.d.ts`, contracts §3 → 28 seams, 4 unit tests incl. a source-pinned series-id list) and `__globe.seatSettle()` (`enrichedBuildings.ts applyFeatureSeats` accumulates `maxResidualM` / `movedFeatures` + the look-cone `near*` twins — two compares per feature, allocation-free). **MEASURED (`rendering/MEASUREMENTS_2026-09-05.md`, 81 + 12 cells, 3 profiles, 3 shimmer + 3 reseat legs; verdict §0, ledger §10, slice order §12):** (1) **every `#p=` orbit pose is CPU-bound in the CONTROLS** — `frame.cpu` 31–47 ms per frame at a static pose at every tier (`low` with 88 calls = 39 ms; the `/m` chart 36–39 ms with 9 calls) vs 2 ms at the FPV eye; the profile puts 84 % of the frame in `GlobeControls.update → adjustCamera → _getPointBelowCamera → raycaster.intersectObject(scene)` (3d-tiles-renderer 0.4.28 `EnvironmentControls.js:995/1059/1461/1739`; three's brute-force `Mesh.raycast` over the 7.7 M-vertex enriched soup — `getVertexPosition` 32 %), the controls having been given the WHOLE scene (`StylizedTiles.ts:1086`); (2) **bloom is the largest GPU consumer** — off = −13.3 ms GPU at the FPV eye (25.1 → 11.8; 53 %), −21 orbit, −22 Everest, −14 city, −25 ULTRA; the FPV frame is GPU-fill-bound (dt ≈ gpu, `high` → `mid` DPR cuts GPU 25 → 15); GTAO is off in the build (`AO.enabled:false`); (3) **shadows are cheap** — the depth pass 0.5 ms GPU / 1.7 ms frame at the FPV eye, 6–7 ms under ULTRA (8192² + cascades), 14 ms GPU only at the 26-km city view (718 calls / 6.7 M tris in the map); a GPU-timer asymmetry between `noUpdate` and `off` at the city / model-bearing orbit boots is UNRESOLVED (p95s overlap); (4) **the shimmer, measured**: frozen camera + 0.0083°/frame sun → 18.5 % of the shadow-mask pixels FLIP every frame at the FPV eye (city ULTRA 11.6 %, Everest 7.7 %), 62–75 % isolated pixels, and a 4× sun rate raises churn only ×1.24–1.64 → the rig's re-fit dominates the sun's motion ~3:1; the frozen control is EXACTLY 0 at two poses and catches the ULTRA cascade refresh (18 pop frames / 239 at `cascadeMaxStaleMs` 1500) — the frame is deterministic, the metric has no noise floor; (5) **seats never settle and the ease STALLS 8.3 cm short by construction** — `seatStep` eases 12 %/frame behind a 1 cm write gate, so residuals < 0.01/0.12 = 0.0833 m are never written (every leg ends at exactly 0.083 m); 130 terrain-epoch bumps (1.9/s) during the orbit arrival (city-wide residual peak 119 m, 104 rejections), 166 (4.8/s) at the FPV boot where the round-robin writes 41 features a frame in 98 % of frames for 70 s with 1,210 rejections and a city-wide p95 of 30 m at the end — the poisoned-pair loop is a steady state; the look-cone quiets ~50 frames after the last bump; user models seat in 6 frames; (6) **24 realistic models cost nothing measurable** — FPV 23.1 → 22.7 ms, +19 calls, +17 textures (one URL's textures are shared), +17 MB heap; MESH_SUITE §12's texture-VRAM cliff is REFUTED at the count cap for repeated URLs; +5 ms CPU at orbit (the controls' raycast walks them); (7) ULTRA = +4–8 ms GPU, +75–290 calls; (8) memory proxies for the phone: heap 400–490 MB at the FPV eye, 840–920 MB at the city view, 100 MB on `/m`; the ground LRU at its 410 MB cap at every Dnipro pose; the city pose streams 3,300 ground tiles and needs 63–68 s to quiet at DPR 2; (9) the `verify-ultra` Dnipro pose `#p=48.464,35.046,900,74,300` is heading 74° / tilt 88° (the grammar is lat,lon,alt,HEADING,TILT; its own struct names them the other way) — cited verbatim, named `city`, and NOT a pose where user models are resident (26 km back; `loadRadiusM` is camera-distance) — the model ramp used the `verify-usermodels` ORBIT pose. **Slice order SUPERSEDED (MEASUREMENTS §12; the plan's §1/§4 kept as written with a dated status line):** NEW slice 0 — the orbit frame (T79 the controls' raycast target, then T80 bloom) → A shadows (quality; gate = the shimmer baseline: churn p50 0.185 → ≤ 0.05, control 0 incl. cascade refreshes, 4×/1× ≥ 3) → B seats (T81: no stall floor, no writes 90 frames after quiet, city p95 < 0.1 m within 600 frames, rejections → 0) → C → D → E. Owner calls left open: may bloom change pixels at `high` (half-res is visible); may the controls' terrain-only raycast change the rooftop clearance `cameraRadius` gives today; slice 0 before the owner's look at the numbers. **The phone (1b):** part A DONE (the tunnel recipe verified — `ngrok` 3.22 + `wix dev --allowed-hosts`; the pose URLs; the runtime read seam + console recipe; the ramp tool; checklist §A rewritten); part B NOT run — the jetsam kill point, the soak, A19 frame times stay UNKNOWN; desktop Safari not run. **Verification:** vitest **2,448/2,448 (162 files)** (baseline 2,444; +4 seam tests) · astro **0/0/8** (run BEFORE the dev server) · knip **0** · `test/verifyHarness.test.ts` green for the two new verify scripts · the matrix ran 40.6 + 5.2 min with 2 boot stalls isolated and re-run green (T82); the temporal harness 10 min (7 "structural failures" of which 6 are the harness's own sign check on a descending sun — fixed in the file, the data valid — and the city control's 0.00003 churn is the cascade-refresh finding, not a fault). Traps recorded (MEASUREMENTS §13): the boot-demotion + late-pin composite rebuild; `pgrep -f` matching its own shell; artefacts per cell; the 120 Hz vsync floor; bloom/AO enables rewritten per frame (getter traps); `force()` cannot produce a tier's shadow profile; Node 24 PATH for `WebSocket` + `.ts` imports. Session facts: PR #100 (T77 PREP) landed at boot; the ship watcher re-seated the checkout on master; no `src/` edit while a harness ran; the world is clean (all seeds removed, `t77-model-ramp status` = the 1 pre-existing row in the eye cell).

### 2026-09-05c — OWNER RULINGS on the phone baseline (after the question "what is the remote-inspector baseline and can we check without the device?"): the iPhone 17 Pro is NOT the owner's (a short borrowed window may come later); the owner is "ok with everything above" — the desktop MEASURE session as planned, the device-free proxies (`renderer.info.memory` bytes per pose on the Mac judged against the published iOS ceilings; desktop Safari on the M3 Pro for WebKit correctness — HalfFloat MSAA, missing extensions, shader compile), a prepared short-window checklist, and **a cloud device farm (BrowserStack / LambdaTest / AWS Device Farm) is APPROVED for the real-phone stages, paying / subscribing is fine.** Honest limits stated and accepted: nothing on the Mac stands in for the jetsam KILL POINT, the THERMAL SOAK or A19 FRAME TIMES; Chrome/Playwright emulation is layout + touch only; the iOS Simulator (Xcode, not installed) is real WebKit but the Mac's GPU and no jetsam. Written: `rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` — part A on the Mac (the tunnel: `wix dev` binds `127.0.0.1:4321` only (measured), so `ngrok http 4321` (installed) + `wix dev --allowed-hosts <host>`; sign-in not needed over the tunnel; the pose URLs; a runtime-gated read snapshot behind the `debugHud` pref because the DBG window refuses coarse pointers and `window.__globe` is DEV-gated; the model-ramp script with `finally` cleanup), part B the ~35-minute phone table (inspector on, renderer string, 30 s timelines per pose, the kill ramp 6 → 12 → 24 → 36 … until Safari's "problem repeatedly occurred" reload, an 8–10 min soak, the /m pose), part C what each number gates (levers 4, 9, 10, 14, 15, 16), part D the farm variant (vendor tunnel or `wix preview`; sessions cut the soak; [UNVERIFIED] which vendor lists the 17 Pro; a 16 Pro is a stricter stand-in), part E what stays unknown. Plan §3 1b + §5 and the NEXT_SESSION READ FIRST block amended; backlog T77. Docs-only.

### 2026-09-05b — OWNER RULINGS + T77 PREP: MS8 "deployed and tested manually"; **"this concludes all mesh-related work at the moment"** → the MESH SUITE (T74, T78) is CLOSED, its open taste calls (§11.5 / §13.4 / §14.4 / §15.4) parked with it; the owner ran the web-research prompt and stored **`rendering/WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05.md`** (24 levers ranked by gain ÷ risk for PLUX — texel-snapped cascade centre #1, cascade dispatch + blend #2, `compileAsync` prewarm #3, KTX2/UASTC user textures #4, continuous render scale + FSR1 #5 …; Rq-1..17 answered with [VERIFIED]/[INFERRED] tags; the iPhone 17 hard limits — the tile storms and Safari reloads are the WebKit JETSAM kill, not a frame-rate ceiling; three r185 / 3d-tiles-renderer 0.4.x facts; a do-not-do list that doubly confirms ENGINE_STATE §5 and adds two NEW traps — the fixed-per-frame ease has no `dt` term (frame-rate-dependent), and batched per-tile params collide in three's program cache without `customProgramCacheKey`; 8 experiments with pass thresholds). **Prepared this session (docs-only, no `src/` change):** `rendering/T77_AUDIT_PLAN_2026-09-05.md` — the RECONCILIATION of ENGINE_STATE §5/§6/§11 with the web ranking: a merged ordered ledger of 23 levers (each with its slice, cost and gate / experiment), the refuted list merged, the 8 seams between the two reports resolved (terrain shadow-map caching keyed to the epoch DEPENDS on per-tile memo invalidation landing first — today's epoch bumps city-wide on every tile arrival; the 4-cascade `maximumDistance` ladder vs a far cascade / fade band is decided after measuring; MSAA stays the mobile AA (×2 + a smaller HalfFloat target to test) — never SMAA on the phone; bake-time seats + per-feature `dy` before any GPU heightfield seating, `heightAt` stays the vertical authority; alpha-to-coverage ULTRA-first under a pixel-diff gate; the Hillaire LUT sky is the LAST slice, gated by ΔE < 2 against the authored curves + the eclipse / dusk / terminator harnesses; ENGINE_STATE's `__quality.force` is a slip — the window seam is `window.__globeQuality`, the handle's `force(tier)` is `quality.ts:410`; three owner scope calls left open: the slice order after MEASURE, the still path, the atmosphere), the **MEASURE protocol** (the existing harness poses — Dnipro FPV `#f=48.4647,35.0462,1.7,25,8,60`, the ULTRA city `#p=48.464,35.046,900,74,300`, Everest `#p=27.87,86.83,11500,76,35`, the `/m` chart — × 0 / 6 / 24 resident models seeded via `/api/dev-seed kind:"model"` at ONE realistic textured GLB × ULTRA × shadows × forced tiers; the DBG rows to read; two NEW metrics to add — a shadow SHIMMER metric and a RESEAT-SETTLE time — as the gates of slices A / B; the traps: headless governs to `low` → HEADED Chrome on the M3 Pro, warm profile, whole-frame `renderer.info`, late / absent `frame.gpu`; the phone by the owner's hands via the remote inspector, ramping to the jetsam kill), and the slice ladder **A shadows → B seats → C streaming + workers → D mobile → E later (HLOD / occluder · atmosphere · still · opt-ins / batching)**, each a READ-ONLY audit then a sliced fix session under the §8 harness list. NEXT_SESSION_PROMPT rewritten as the MEASURE-session recipe (mesh sections compacted); backlog T74 / T78 closed, T77 pointed at the report + the plan; `mem:core` Next step; `mem:project/wip-2026-09-05-t77-audit-plan`. Verification tier: docs-only — no gate re-run needed beyond the 2026-09-05 ones (vitest 2,444 · astro 0/0/8 · knip 0).

*(Sentinel — older sessions moved byte-identical to `DECISIONS_ARCHIVE.md`: 2026-08-02 →
2026-08-15e in §Moved 2026-08-18 (round 3), 2026-08-17 → 2026-08-19d in §Moved 2026-08-22
(round 4, md5 5ed47c51b9d44a754964771ffe418330, 556 lines / 79,306 B), and 2026-08-21 →
2026-09-05 in §Moved 2026-09-06 (round 5, md5 4260321dc13ba45b11c3de0bb5c8856e, 865 lines / 410,237 B).
Their era digests live in §Per-phase digests above. Entries above this line are the T77
rendering-performance era, 2026-09-05b →, kept verbatim while that work is live.)*
