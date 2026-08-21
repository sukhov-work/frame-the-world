# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.
**UI-facing name = PLUX (owner 2026-08-19; supersedes working title SIDERA 2026-08-14), planning-first;
domain `plux.today` (www = primary)** — the repo and every technical identifier stay "frame the world".

## Status (compacted 2026-08-15 — era index + pointers; the old narrative Status lives in DECISIONS.md digests + DECISIONS_ARCHIVE.md)

### Current state (re-dated 2026-08-18 at compaction r3 per policy; narrative below written 2026-08-15 post guide-G1 — the 08-17→18 delta [P7 + U1–U5 + audit-2 + fix slices] lives in the Era index HOT rows + Next step)
- **Phases 1–6.9 SHIPPED + RELEASED**: scaffold + LEO signature globe · WASM decode
  (libraw-wasm@1.0.5 worker) · frustum projection + click-to-place · ephemeris-driven scene
  (sun/moon/stars/terminator/shadows/golden) · members + C6 reduced-precision pins · Phase 5.5
  S1–S7 UX (flight/FPV, pin lifecycle+visuals, Explore/Welcome, night physics, street names,
  vector features) · Dnipro/St Albans enriched bakes on R2 · marketplace-light (Catalog V3
  digital products, quota 100/1000, EUR). Populated globe LIVE since 2026-07-17.
- **Astro engine A–E COMPLETE**: search/track ANY body (1,947-entry fuzzy index — stars,
  constellations, comets, asteroids, full OpenNGC), universal-variable kepler + SIMBAD/SBDB
  long-tail, target trail/markers/windows, planet phase discs.
- **Planning core (Phase 8 ladder)**: 8a twilight/GC/MW shipped · QoL-1..4 (scrubber v2 +
  trace, frameFinder cards, GHOSTS chain, NPF/moon-calendar/size-dist tools) · **FIND v2/v3**
  (dedicated FindPanel frame-as-query per-day scan + in-frame ghost projections + standings) ·
  **§3.5 SUNSETS-IN-FRAME** (sunEventFrame lib; refracted-labels/airless-geometry PINNED) —
  all desktop-first with /m twins.
- **Mobile M0–M3 COMPLETE**: `/m` planning shell (sheets/tab bar/dock conveyor), FPV touch
  (joystick walk, pinch-FOV, wake lock, minimap), PlanSheet twins, TARGET GHOSTS + long-press
  sky menu; mobile-default entry (`/?d=1` escape). Mobile = planning-only PERMANENTLY.
- **Owner UX batches 2026-08-15b/c (×5 + ×9)**: PLAN/FIND one shared resizable window · grown
  sky context menu (TRACKING/MARK/TRAIL/FIND-IN-FRAME + camera-aiming rise/set + moon %) ·
  TRACKING camera lock (`stepSkyTrack`) · /m FIND 4th tab w/ STICKY standings (Pixel fix) ·
  /m login + MY PLACES + SAVE VIEW + SAVED PLACES (place quota dropped) · collapsible mini-map.
- **THE GUIDE G1 + G2-content SHIPPED 2026-08-15 both shells (this session)**: ONE content
  module `lib/guide/guideContent.ts` (11 chapters · ~40 topics · goals router · `[[id|label]]`
  crosslinks) → desktop `panels/Guide.tsx` + /m `GuideSheet.tsx`; **FAQ ABSORBED** (Faq island
  deleted); 12 fresh screenshots `public/guide/*.webp` (warm-list-coupled); slop-lint +
  crosslink/image tests. Same session: DECISIONS round-2 compaction (verbatim 07-11→08-01 →
  DECISIONS_ARCHIVE + era digests), README/ARCHITECTURE refreshed, `mem:core` compacted.
- **Gates: vitest 886/886 · astro check 0 err/5 hints · prod LIVE.** Both shells CDP-verified.
- Standing rulings: Phase 7 (AI) OUT of all plans · desktop frozen additive-only ·
  desktop-first per feature · airless geometry with TRUE almanac label times · backlog =
  `.claude/skills/frame/references/tracked-backlog.md` (T1–T27).
- Open tails: owner taste pass (guide chapters/copy + UX-batch knobs) · real-device
  iPhone/Pixel pass · release canaries T2/T3 ride the next `wix release`.
- Freshest detail always: `NEXT_SESSION_PROMPT.md` + DECISIONS §Recent sessions (top entry
  2026-08-15d-guide-g1).
- Live site: `frame-the-a173087b-yevhens.wix-site-host.com` (siteId
  `f597bcf5-bd38-4941-9dfe-e16d775743a3`, appId `566ce8ce-d18c-4950-88ac-5d2c53311cd6`;
  `mem:project/wix-site`).

### Era index (DECISIONS.md §Per-phase digests for eras through 2026-08-15e after compaction r3 2026-08-18; verbatim logs in DECISIONS_ARCHIVE §Moved dividers; only the UPLIFT era 2026-08-17→ stays verbatim in DECISIONS §Recent sessions. Policy: every compaction round adds its era rows HERE and re-dates the Status block.)
- **Phases 1–4 — scaffold · globe · decode · projection · ephemeris (2026-07-09→10)** —
  digests "Bootstrap"→"Phase 4" (+ design-system import) ·
  `mem:patterns/globe-rendering` · `mem:patterns/upload-flow` · `mem:patterns/photo-frustum` ·
  `mem:patterns/sky-bodies-terrain` · `mem:patterns/design-system` ·
  `mem:project/wip-2026-07-10-phase4-scrubber` · `wip-2026-07-10-prephase5-fixbatch` ·
  `wip-2026-07-10-ui-fixes`.
- **Phase 5 + 5.5 S1–S7 + pre-S7 refactor (2026-07-10→12)** — digests "Phase 5", "Phase 5.5
  S1–S6", "Pre-S7 architecture review", "S7 tail + interlude" · `mem:patterns/members-pins` ·
  `mem:project/wip-2026-07-10-phase5-members-pins` · `wip-2026-07-11-phase5.5-ux-batch` ·
  `wip-2026-07-11-phase5.5-s2`…`s7` · `wip-2026-07-11-s7-feedback-batch` ·
  `wip-2026-07-11-pre-s7-refactor{,-s2}` · `wip-2026-07-11-b19-split` ·
  `wip-2026-07-12-readme-rewrite` · `mem:bugs/pin-arrival-reframe`.
- **Rendering passes + Dnipro enrichment slices 0–3 + illumination (2026-07-12→14)** — digest
  of the same title · `mem:project/wip-2026-07-12-rendering-quality-pass` ·
  `wip-2026-07-12-rendering-pass1-tiling-fluidity` · `wip-2026-07-12-rendering-pass2-dnipro-identity` ·
  `wip-2026-07-13-illumination-pass` · `wip-2026-07-13-terrain-reseat` ·
  `wip-2026-07-13-dnipro-enrichment-research` · `wip-2026-07-13-dnipro-slice0-spike` ·
  `wip-2026-07-13-dnipro-slice1-bake` · `wip-2026-07-13-dnipro-slice2` ·
  `wip-2026-07-13-dnipro-slice3-trees` · `mem:bugs/gallery-thumbnail-stale`.
- **OSM2World variant + R2 hosting + obstruction moat + owner seating/UI batches (2026-07-14)**
  — digest of the same title · `mem:project/wip-2026-07-14-osm2world-adapter` ·
  `wip-2026-07-14-osm2world-slice1.5-spike` · `wip-2026-07-14-r2-hosting-osm2world-prep` ·
  `wip-2026-07-14-pass3-obstruction-moat` · `wip-2026-07-14-owner-batch-seating-ui` ·
  `wip-2026-07-14-uiux-qol-batch`.
- **Docs reorg → Phase 6 marketplace → 6.9 + release week + St Albans (2026-07-15→18)** —
  digest of the same title · `mem:project/wip-2026-07-15-docs-reorg-phase6-prep` ·
  `wip-2026-07-15-prephase6-uiux` · `wip-2026-07-16-phase6-marketplace-research` ·
  `wip-2026-07-16-prod-asset-outage` · `wip-2026-07-17-phase69-marketplace-batch` ·
  `wip-2026-07-17-demo-seed-curation` · `wip-2026-07-17-seed-orbital-faq-batch` ·
  `wip-2026-07-18-st-albans-city2` · `mem:bugs/ground-checkerboard-flicker`.
- **View-prefs persistence + default flips (2026-07-21)** — digest of the same title ·
  `mem:project/wip-2026-07-21-viewprefs-uiux`.
- **Astro engine A–E + comet 10P (2026-08-02→10)** — DECISIONS §Recent 2026-08-02→10 ·
  `mem:project/wip-2026-08-02-comet-10p-tracer` · `wip-2026-08-03-astro-engine-phase-a` ·
  `wip-2026-08-03-astro-engine-phase-c` · `wip-2026-08-10-astro-engine-phase-bde` ·
  `mem:bugs/comet-magnitude-model`.
- **Full audit #1 + fix slices 0–7 + Phase 8a + planning-core restructure (2026-08-13)** —
  DECISIONS §Recent 2026-08-13 + report `.claude/claude-docs/audits/audit-full-2026-08-13.md` ·
  `mem:project/wip-2026-08-13-full-audit-1` · `wip-2026-08-13-planning-core-restructure` ·
  `wip-2026-08-13-slice7-phase8a` · `mem:bugs/fpv-walk-orbit`.
- **Mobile M0–M3 (2026-08-11 design → 2026-08-14)** — DECISIONS §Recent + `MOBILE_PLAN.md` ·
  `mem:project/wip-2026-08-11-mobile-design` · `wip-2026-08-13-m1-mobile-planning` ·
  `wip-2026-08-13-m2-fpv-touch` · `wip-2026-08-14-mobile-m3ab` · `wip-2026-08-14-mobile-m3c`.
- **Planning QoL 1–4 + FIND v2/v3 + §3.5 sunsets (2026-08-14→15)** — DECISIONS §Recent +
  `PLANNING_QOL_PLAN.md` · `mem:project/wip-2026-08-14-qol-batch` ·
  `wip-2026-08-14-qol1-tail-trace` · `wip-2026-08-14-qol2-batch` · `wip-2026-08-14-qol3-batch` ·
  `wip-2026-08-14-qol4-batch` · `wip-2026-08-14-find-rework` ·
  `wip-2026-08-14-find-accuracy-labels` · `wip-2026-08-14-night6-hover-floor` ·
  `wip-2026-08-15-sunsets-in-frame` · `mem:project/owner-orders-2026-08-14-qol-batch`.
- **Owner UX batches ×5 + ×9 (2026-08-15b/c)** — DECISIONS §Recent 2026-08-15b + 2026-08-15c ·
  `mem:project/wip-2026-08-15-ux-batch` · `wip-2026-08-15-uxbatch2`.
- **Guide track G1 + polish (2026-08-15d/e)** — DECISIONS digest + ARCHIVE §Moved 2026-08-18 ·
  `archive/GUIDE_PLAN.md` · `mem:project/wip-2026-08-15-guide-g1`.
- **P7 meteors + UPLIFT ladder U1–U5 (2026-08-17→18, era still HOT — verbatim in DECISIONS
  §Recent)** — meteor showers (IMO cal2026) + UPLIFT_PLAN authored · U1 2D-first /m · U2 FPV
  stability ×8 · U3 fullscreen MapWindow + 2D-map batch + crispness + desktop flat-map · U4
  direction lines + aim cones (+2 owner rounds) · U5 closest-first loading. Ladder PARKED after
  U5 for AUDIT #2 + fix slices; UN-PARKED 18n → U6 foveation SHIPPED + U7 terrain audit DONE
  18o (`wip-2026-08-18-u6-foveation` + UPLIFT_PLAN Appendix A) → U7b GLO-30 terrain patch +
  best-variant buildings rule SHIPPED 18p (`wip-2026-08-18-u7b-glo30-terrain-buildings-rule`)
  → U8 height override SHIPPED 2026-08-19 (`wip-2026-08-18-u8-height-override`) — the ladder
  is COMPLETE. `mem:project/wip-2026-08-17-p7-meteors-uplift-plan` ·
  `wip-2026-08-17-u1-2d-mobile` · `wip-2026-08-17-u2-fpv-stability` · `wip-2026-08-18-u3-2dmap-batch` ·
  `wip-2026-08-18-u4-aim-cones` · `wip-2026-08-18-u5-loading` · `UPLIFT_PLAN.md`.
- **AUDIT #2 + fix slices (2026-08-18, HOT)** — report `audits/audit-full-2026-08-18.md` ·
  `mem:project/wip-2026-08-18-audit2` · `wip-2026-08-18-audit2-fixslices`.

## Next step
**OWNER BATCH #4 S3 SHIPPED 2026-08-21c — BATCH CLOSED 18/18** (DECISIONS 2026-08-21c; gates
1,101/1,101 · astro 0 err/5 hints; S1 23/23 + S2 15/15 regression + NEW `verify-uxbatch4-s3.mjs`
18/18, shots uxb4-s3-01..04): (17) radar sun/moon band FUTURE halves wear body ink —
`bandFutureInk()` (aimCones, unit-locked), per-body uFuture + both canvas twins via `b.color` ·
(18) TargetPanel GOTO pill before SHOW — chip handler extracted to `store/skyAim.gotoSkyBody`
(marker mirror → live-ephemeris fallback; `gotoAimSolution` pure twin tested) · (#5) iOS
resilience — contextlost render gate + composer realloc on restore; hidden tick skip w/
governor-clock re-seat; visibilitychange/pagehide freeze of ALL NINE tile queues
(PriorityQueue.autoUpdate); NEW `QUALITY.leanMobile` coarse-pointer overrides (DPR 1.25 /
bloom off / shadow 1024 — tile knobs stay per-tier, high test-locked) · (#15) NEW
`public/sw.js` iOS-ONLY tile cache (dev-gated, 7-day-TTL performance cache — Esri ToS posture
flagged; policy fenced by test/swTileCache.test.ts) + per-tier `overlayResolutionPx` 512/256/256
w/ `ground.setOverlayResolution` fresh-instance rebuild path + `esriMaxLevelCoarse 17` +
ground-only `groundLruBytesMB` 320/192 + per-URL force-cache (overlay images / .terrain / .glb
/ .pbf; manifests revalidate) · (#1) /m PiP `.mw-pip` 200px live-3D hole (draw() clearRect
under its DOM box; body.m .mw background dropped) replaces ✕ MINI-MAP, tap → back to FPV.
UNVERIFIED → T1 + first release: /sw.js on Wix hosting (Content-Type unprobed), real-iOS
jetsam/heat, z17/256 look, tint/PiP taste. **NEXT SESSION: release when the owner finishes the
domain fix (batch #4 rides it; NEW rider — probe https://www.plux.today/sw.js after the flip);
T1 device pass (grown: lean heat, SW effect, PiP feel, band tint taste); then P8 conjunctions
+ P9 lunar eclipses + M4 mobile resume · U8 sync-phase ladder.** Log:
`mem:project/wip-2026-08-21-owner-uxbatch4` · plan `UXBATCH4_PLAN.md` (§S3 as-built).
Prior (S2, 2026-08-21b — 14/18 items done, owner addendum #2 post-S2 added 17+18) (DECISIONS 2026-08-21b; gates
1,088/1,088 · astro 0 err; S1 regression ALL PASS + NEW `verify-uxbatch4-s2.mjs` 15/15 both
shells): radar → concentric annular bands (AIMCONES.bandSun/.bandMoon/.bandTarget — ONE model,
three surfaces incl. the NEW minimap radar; compactK/lineLenK RETIRED; N rim marker
everywhere) · focal cone EVERYWHERE (camera-store `plannedView` heading+HORIZONTAL-fov,
session-only, seeds photo/jump/FPV-exit/stick; NEW `scene/focalCone.ts` + `--color-focal-cone`
#E08FC6; MapWindow hardcoded-0.22 replaced; math in `lib/geo/plannedView.ts`) · AIM joystick
both shells (NEW shared `components/controls/` tier — mobileFence rule 3) · MapWindow
two-finger TWIST (`view.rot` + ONE `xformNow()` transform) · street labels ×0.5 BOTH branches
(the world-size floor was the giant-label cause) · S1 long-press login-nav BUG fixed
(document-capture click swallow — element-level swallows die with their element). Side quest:
ALL UPLIFT rendering optimizations audited IN-PLACE-WIRED; cache-ENABLED measurement
(`scripts/measure-tile-cache.mjs`) REFUTES desktop cache-busting — disk cache holds ≈95% on
reload, owner's observation ≈ DevTools disable-cache; iOS-small-cache ranking STANDS (SW
mitigation now iOS-directed). S3 lever warning: GROUND.overlayResolution is construction-time
— the 256 shrink needs a plugin rebuild path. **NEXT SESSION: batch #4 S3 = #15 SW tile cache
(iOS-directed) + demand shrink + #5 iOS contextlost/pagehide/lean profile + #1 minimap PiP
(the S2 xformNow rewrite makes the punched hole easy). Release still GATED on the owner's
domain fix.** Log: `mem:project/wip-2026-08-21-owner-uxbatch4` · plan `UXBATCH4_PLAN.md`.
Prior (S1, 2026-08-21 — 10/15 items) (DECISIONS 2026-08-21; gates
1,074/1,074 · astro 0 err; both shells verified via NEW re-runnable
`scripts/verify-uxbatch4.mjs` 23/23): iOS selection tint killed (global user-select none) ·
2D-map two-finger ROTATE + tilt-into-3D door removed (`mobile2dFreeHeading` latch) ·
MapWindow continuous fractional pinch (PINCH_SENS 0.8, FPV z18) + desktop drag/−10% (DragGrip
overflow-clip trap fixed) · target tracking ray FAR (rayLenK 6 / canvas edge) · vector ink
halved + `vectorsVisible` pref + VEC / ▤ VECTOR toggles · ⌖ FIND IN FRAME above UNFOLLOW both
shells · long-press ▲ 3D → FPV jump at map centre w/ last focal · /m dock time-only clock
(PLAY+rate retired on /m) · Guide resizable (search had already shipped 19d). Plan + specs:
`UXBATCH4_PLAN.md`; log `mem:project/wip-2026-08-21-owner-uxbatch4`. **NEXT SESSION: batch #4
S2 = radar rework #9 (clipped target zone + thin sun/moon concentric bands + capped dials,
unified GL/canvas/minimap) + focal cone everywhere (needs planned-view heading+focal state) +
#11 focal joystick + #4b MapWindow twist — design-first. Then S3 = #15 tile-storm (SW cache;
headers probed fine — cause is LRU re-fetch vs iOS cache) + #5 iOS reload/heat (contextlost/
pagehide/lean profile) + #1 minimap PiP. Release still GATED on the owner's domain fix.**
Prior state (2026-08-19d): **PLUX LAUNCH GROOMING SHIPPED** (DECISIONS 2026-08-19d; gates 1,073/1,073 ·
astro 0 err; both shells + /guide CDP-verified): brand Sidera→PLUX everywhere (wordmark hero,
nav/strip/upload marks, favicon.png + apple-touch, favicon.svg deleted) · domain plux.today
assessed + repo flipped to `https://www.plux.today` (SITE_URL + 7 script defaults;
`FTW_SITE_URL` override) — **PROD IS DARK until the owner finishes the GoDaddy nameserver
replacement (Nameservers → Change → own nameservers = ONLY ns8/ns9.wixdns.net), Wix issues the
www TLS cert, and the headless OAuth allowlist gains plux.today; `wix release` is GATED on
that** · guide G2-refresh (16 topics corrected + 7 new + 3 goals; shell-m.webp re-shot; other
5 desktop shots = warm-cache tail) · guide BM25+fuzzy search both shells
(`lib/guide/search.ts` + rail/sheet UIs, 11 tests). See
`mem:project/wip-2026-08-19-plux-launch-grooming`. **NEXT SESSION: confirm domain live → wix
release (first Plux prod + standing canary) → warm-prod-assets → re-shoot the 5 stale guide
shots on a warm cache → owner taste pass (logo sizes, search placement).**
Prior batch (#3, 2026-08-19c — all 9 announced items + 2 batch-#2 tails)
(DECISIONS 2026-08-19c; gates 1,062/1,062 · astro 0 err/5 hints; browser-verified both
shells over the owner's CDP Chrome, shots uxb3-01..07): desktop 2×4 toggle grid · desktop
radar <10 km band · my-places-on-map desktop FIXED (missing `.ct-places.is-on` lit CSS +
new GL `scene/placeMarkers.ts` lavender dots on the MAIN globe + save/delete local push) ·
UNFOLLOW also disables its FIND body · /m LAYERS expands LEFT · radar-bearings regression
FIXED (UNFOLLOW dismissal now session-only + body-named DIRECTION labels + one-time
`prefsRev` re-arm of corrupted aim/SHOW offs) · places lists nearest-first
(`lib/geo/proximity.ts`) · /m SAVE VIEW optional-name Sheet (portaled) · GOTO tracked-target
chips both shells (`panels/SkyGotoChips.tsx`; below-horizon → `nextRiseAzimuth` aim). See
`mem:project/wip-2026-08-19-owner-uxbatch3` (rulings + traps — incl. the foreign-CDP
rAF-throttle trap + the depthTest:false far-hemisphere cull rule). **NEXT SESSION: batch-#3
tails if the owner flags them (FPV mini-map place markers · bright-target FIND refinement ·
taste pass), then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.**
Prior batch (#2, 2026-08-19b — all 11 items; DECISIONS 2026-08-19b;
gates 1,052/1,052 · astro 0 err/5 hints; browser-verified both shells, shots uxb2-01..05):
cap 1000 · /m map glyph + day steppers + joystick-over-fullscreen-map · Esc-closes-map-first ·
SKY search default · DISABLE menu labels + find-in-frame composite-state fix · UNFOLLOW verb
(`sky.stopFollowing`; visible=false = dismissed everywhere) + peek hint + target-section
reorder both shells · FIND third body generalised `gc`→`target` (ANY tracked target) ·
/m ⊞ LAYERS chip + MY-PLACES-ON-MAP (`store/places.ts`, 2D MapWindow markers, pinLavender) +
`aimVisible` RADAR master + `pinsVisible` /m-default-off. See
`mem:project/wip-2026-08-19-owner-uxbatch2` (rulings, traps — incl. the wix-dev-SIGPIPE
harness trap). **NEXT SESSION: batch tails first if the owner flags them (GL-globe/minimap
saved-place markers · post-save push into placesMap · bright-target FIND visibility · taste
pass), then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.**
Prior milestone (U8, ladder COMPLETE): (DECISIONS top entry 2026-08-19; gates 1,048/1,048 · astro 0 err/5 hints;
browser-verified both shells via `scripts/verify-bldg-override.mjs`, shots u8-01..06).
FPV dblclick/double-tap arms an enriched building → claimed-pointer drag with SOLID original +
ghost preview + mesh-pinned dual-height label → commit persists to `ftw:bldg-overrides:v1`
(per-edit band 0.5×/3×; scale folded into applyFeatureSeats — commutes with seats; checksum
invalidates on re-bake). Bakers now emit `cell-*.meta.json` osmId sidecars; backend PREPARED
but dormant for the batch-sync phase (LWW BuildingOverrides + bulkSave endpoint; activation
ladder in NEXT_SESSION §2 — provision script NOT yet run). **NEXT SESSION = the owner's
announced batch of minor-to-medium improvements + UX fixes (2026-08-18r)** — start from their
list; then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.
Open riders: production canary (U8 + terrain + o2w-default + B1/T2/T3) on next `wix release` ·
T1 owner device pass (now also judges the U8 glass gesture feel) · T29 extraction slice · T32
one-liner · T28 · B4/T30 · Esri imagery rider · cross-region enriched attach mid-session
(named tail). See `NEXT_SESSION_PROMPT.md` + `mem:project/wip-2026-08-18-u8-height-override`
(rulings + traps incl. the TilesGroup ghost-matrix trap) +
`mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` + **`BAKED_ASSETS.md`** (the
baked buildings/terrain/regions domain doc — now incl. the U8 identity sidecars).

## Source layout (as-built; refreshed 2026-08-15)
Fuller map: ARCHITECTURE §7 · contract-strings/field inventory: `conventions/contracts.md`.
- `src/components/globe/` — client:only three.js scene. `tuning.ts` (ALL tunables, documented) ·
  `scene/*` attach-modules (baseEarth/graticule/atmosphere/stars/buildings/enrichedBuildings/
  buildingMaterial/imageryGround/vectorTiles/vectorFeatures/streetNames/geoLabels/sky/skyTarget/
  skyTrail/skyGhosts/skyNames/findGhosts/dayArcs/planFeed/minimapFeed + glsl) ·
  `StylizedTiles.ts` orchestrator (named step-closures) · `PhotoFrustum.ts` · `Pins.ts` ·
  `flight.ts` · `explore.ts` · `GlobeCanvas.tsx`. Design imports NEVER touch.
  Convention: `.claude/conventions/globe-tuning.md`.
- `src/components/panels|ui/` — the full desktop chrome (UploadFlow, PhotoDetailPanel,
  LocationFinder, TimeScrubber, TimeReadout, CameraTiltPanel, FpvHud, TargetPanel, PlanPanel,
  FindPanel, PlanFindToggle, Guide, Frame/Today/MoonCal/SpotStars cards, SkyContextMenu,
  MyPins, MyLocation, Marketplace, Welcome, ExploreMode, MemberBadge, MiniMap, PinHoverCard
  + ui/*). Design imports allowed. `src/components/mobile/` — the full `/m` shell
  (MobileShell, Sheet/TabBar, PlanSheet, FindSheet, GuideSheet, TargetSheet/TargetPeek,
  MobileSearch, MobileAccount, MobilePlaces, MobileTimeDock, FpvControls, SceneActions).
- `src/lib/` — ALL REAL: decode (libraw-wasm@1.0.5 worker) · geo (projection/frustum/geohash/
  terrain/precision/urlPose/occlusion/horizonProfile/…) · ephemeris (bodies/comet/targets/
  planner/stars/asterisms/dayArc/frameFinder/sunEventFrame/moonCalendar/mwSeason/twilight/
  topo/…) · sky (catalog/searchIndex/openngc/simbad/sbdb/hoverNames/ttlCache/…) · globe
  (quality/enrichedVariant/enrichedMask) · guide (guideContent + inline crosslink grammar) ·
  pins (fields = shared row mappers, appearance) · photo (npf) · export (ics) · market+save+wix
  (record builders + SDK clients) · theme (GL token bridge) · format/api/prefs/textures.
- `src/store/` — zustand: upload/camera/time/pins/member/save/market/plan/sky/skyAim/minimap/find.
- `src/pages/` — index.astro + m.astro (+ layouts) + `api/*` thin endpoints (~8 routes: photos,
  places, listings, market, upload-url, sbdb, dev-seed, ping); there is NO `src/backend/`.
- `public/textures|data/` — earth + milky-way sets (8k desktop / 2k mobile) + baked catalogs
  (bsc5.bin, openngc.bin, constellation-lines.json). `public/guide/` — 12 guide screenshots
  (warm-list-coupled). `test/` — vitest twins of every lib (886 tests as of 2026-08-15).

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
are the execution source of truth (distilled from `provenance/DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:project/wix-site` — live URL + siteId/appId
- `mem:architecture/system-overview` — the engine + pipelines
- `mem:patterns/globe-rendering` — how the organic LEO globe is built (bands, atmosphere, ground grade, traps)
- `mem:patterns/sky-bodies-terrain` — ephemeris sun/moon, scene time, bloom, shadows, REAL terrain (Phase-4-era snapshot, frozen 2026-07-10 — the ground pipeline was REBUILT 2026-08-18b/c U3; current truth = ARCHITECTURE §7 + `conventions/globe-tuning.md`)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:decisions/session-end-autoship` — the SessionEnd auto-ship hook contract
- `mem:memory_maintenance` — how to maintain this graph
