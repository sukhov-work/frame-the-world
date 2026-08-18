# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.
**UI-facing name = SIDERA (owner 2026-08-14), planning-first** — the repo and every technical identifier
stay "frame the world".

## Status (compacted 2026-08-15 — era index + pointers; the old narrative Status lives in DECISIONS.md digests + DECISIONS_ARCHIVE.md)

### Current state (2026-08-15, post guide-G1 session)
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

### Era index (DECISIONS.md §Per-phase digests for eras through 2026-07-21; later eras are verbatim in DECISIONS §Recent sessions)
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
- **Guide track G1 (2026-08-15d)** — DECISIONS §Recent 2026-08-15d-guide-g1 + `GUIDE_PLAN.md` ·
  `mem:project/wip-2026-08-15-guide-g1`.

## Next step
**AUDIT #2 NEXT (owner order 2026-08-18j): whole-project expansion-readiness — docs /
organization / architecture / code quality; /frame Audit mode, Deep, READ-ONLY; charter =
`mem:project/audit2-2026-08-18-charter` + NEXT_SESSION_PROMPT. The UPLIFT ladder is PARKED
until the audit/refactor phase ends (resume U6 foveation → U7 → U8 → P8/P9 → M4; parked-state
twin in UPLIFT_PLAN status).** U5 closest-first + U4 owner rounds 1+2 shipped 2026-08-18g/h/i. U5 closest-first loading SHIPPED 2026-08-18g (loadAncestors=false + FPV look-bias
download comparator on buildings/enriched, ground keeps ancestors; per-tier queue caps
null-on-high; governor emaMs/hitchCount + latency probes + `__globe.u5()` seam; gates 989/989,
at-rest A/B tile-identical, browser-verified both shells; 0.4.28 library-facts crib in
`mem:project/wip-2026-08-18-u5-loading`). U4 direction lines + visibility cones SHIPPED
2026-08-18f (`mem:project/wip-2026-08-18-u4-aim-cones`). U3 + the owner's 5-issue 2D-map batch SHIPPED
2026-08-18b (`mem:project/wip-2026-08-18-u3-2dmap-batch`). U2 FPV stability SHIPPED 2026-08-18
(`mem:project/wip-2026-08-17-u2-fpv-stability`). U1 2D-first mobile SHIPPED 2026-08-17b. P7
meteors SHIPPED 2026-08-17. REAL-DEVICE pass (U1 gestures + U2 governor + U4 cone feel) rides
T1 — still OPEN. P8 conjunctions + P9 lunar eclipses + M4 resume AFTER the uplift ladder. See
`NEXT_SESSION_PROMPT.md`.

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
- `mem:patterns/sky-bodies-terrain` — ephemeris sun/moon, scene time, bloom, shadows, REAL terrain (current ground pipeline)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:decisions/session-end-autoship` — the SessionEnd auto-ship hook contract
- `mem:memory_maintenance` — how to maintain this graph
