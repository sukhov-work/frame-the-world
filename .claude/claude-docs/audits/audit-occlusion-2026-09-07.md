# Audit — visibility / occlusion accuracy — 2026-09-07c — baseline DECISIONS 2026-09-07b (master `6ff6c4b`)

Owner order (2026-09-07c, verbatim): *"Radar (both minimap and 3d), time scrubber visibility graphs
and heat map (aka best spot) (and other seeing activities and mechanisms I might have missed here)
should accurately account for all meshes (building, terrain, customized buildings and user meshes)
when calculating any visibility, predictions and planning. Any occlusions should correctly
attribute to plans, radar bands, visibility predictions, scores etc … affects all modes (fpv (any
zoom, important for long zooms and switching positions, tracking bodies, all visibility should
recalculate realtime for radar, scrubber etc), 3d map, etc), also this is very relevant both for
desktop and mobile."*

Mode: research + review lane inside an implement session (`/frame` under investigate-design-v3,
Deep). Three read-only finder agents (occluder side · consumer side · T77 regression risk), then
the main agent verified the two load-bearing gaps in code and — because the owner's ask was
"make sure we haven't missed or regressed anything" inside a build session — **fixed the three
defects that were unambiguous and contained in the same session** (§Fixes). Everything else is a
backlog row with a recommendation.

## Verdict

**No regression from the T77 era** — zero files under `src/lib/geo/**` and none of the visibility
consumers changed since 2026-09-04; the one live import edge (`heightMemo`) errs toward
over-invalidation; 693/693 focused tests green before any edit. **Two real gaps, both pre-existing
and both now fixed:** (1) **user models occluded nothing** — the horizon profile's collector walked
only the two tile groups and the BEST SPOT DSM likewise, so a placed GLB in front of the eye
changed zero radar bands, zero scrubber samples, zero FIND rows, zero heat-map cells; (2) **a tile
landing after the sweep never re-profiled** — `planFeed` had exactly one invalidation (the enriched
re-seat epoch, Dnipro-only) and outside Dnipro none at all past the 25 m eye deadband, the same
hole `bestSpotFeed` closed for itself on 2026-08-24 (its D1). The fix for (2) would have made every
tile arrival blank the radar for the 1–3 s a sliced rebuild takes, so (3) **the last complete
profile now stays published through a rebuild** while the eye is within the radars' own 60 m
honesty bound. Terrain, OSM buildings, enriched buildings, height overrides (through the seated
position arrays) and trees were already in every pipeline; the design-level tails (3° bins under a
600 mm lens, the geometric-only HUD/day-arc/shower verdicts, the unlocked raw-bin consumers) are
recorded below for the owner.

Scope: every visibility consumer the three agents could name (23 rows); the parked BEST SPOT
included because the owner named it. Permanently out: Phase 7 AI, the Google-tiles realistic mode.

## Gates baseline

vitest 2,767/2,767 (176 files) · `astro check` 0/0/11 · knip 0 on the baseline tree (2026-09-07b).
Focused visibility stack before edits: 24 files / 693 tests / 0 failures (agent C's table).

## The two pipelines (what actually exists)

| pipeline | collector | consumers |
|---|---|---|
| **A — horizon profile**: 120 azimuth bins (3°), one eye, time-sliced (3 terrain bins + 2 meshes per frame), terrain marched 60 m → 30 km through `ground.heightAt`, mesh EDGES swept ≤ 3 km, trees as canopy spheres | `scene/planFeed.ts` `collectMeshes` + `sweepSlice` → mirrored to `store/plan.profileBins` | 3D radar fan (`aimCones.ts`), MiniMap, MapWindow, TimeScrubber trace, PlanPanel rows, THIS FRAME card, FIND standings, sunsets-in-frame, FIND ghosts' dim, TARGET blockedNow, `.ics` skyline note, and every `/m` twin (MobileTimeDock, PlanSheet, FindSheet, TargetSheet) |
| **B — BEST SPOT layered DSM**: disc raster + per-ray hulls in a worker | `scene/bestSpotFeed.ts` `flattenTin` × 3 groups + `collectCanopyInstances` → `lib/geo/bestSpotWorker.ts buildDsm` | the heat map only; desktop-only by design |

Desktop and `/m` share pipeline A byte-for-byte (`m.astro` mounts the same island; the mobile
sheets read the same `profileBins`); the only mobile divergence is the radar band radii.

## Findings

| ID | Track | Sev | Conf | Anchor | Finding | Fix | Tier |
|---|---|---|---|---|---|---|---|
| A1 | occluders | **HIGH** | 95 % | `planFeed.ts:195-205` (old), `StylizedTiles.ts:718-723`; `bestSpotFeed.ts:604-607`; `userModels.ts:306-308` | **User models entered no occlusion pipeline.** `attachUserModels` adds its group straight to `scene`; neither collector visited it; nothing invalidated on a model change. `MESH_SUITE_PLAN.md:271`'s §4a contract only required edits not to BREAK the sweep. | **FIXED this session** — `userModels.occluderRoot()` + `occluderEpoch()`; `planFeed` visits the group (no mask rejection, instanced meshes skipped); `bestSpotFeed` flattens it into SOLID outside the provenance count; both feeds watch `modelsEpoch`. `test/components/globe/planFeed.test.ts` (new, 9), `bestSpotFeed.test.ts` +2, `userModels.test.ts` +1 | local-tested |
| A2 | refresh | **HIGH** | 95 % | `StylizedTiles.ts:7944-7952` (old hook), `planFeed.ts:352-356`; the signals at `StylizedTiles.ts:671-678` (`builtEpochN`) and `imageryGround.ts:1261` (`terrainEpoch`) wired to bestSpotFeed only | **Tiles arriving after the sweep never re-profiled.** The only invalidation was the enriched re-seat epoch (Dnipro-only, 90 quiet frames); a terrain tile or an OSM/enriched cell landing after the sweep index passed its azimuth stayed out until the eye moved 25 m. `bestSpotFeed.ts:131-143` names this as its own D1 (fixed there 2026-08-24, never applied here). | **FIXED** — `PlanFeedCtx` carries `terrainEpoch · builtEpoch · modelsEpoch`; a change after the build started re-sweeps the SAME anchor after `PLAN.streamQuietFrames` (90) quiet frames; one burst = one rebuild. | local-tested |
| A3 | refresh | MED | 90 % | `planFeed.ts:189` (old `binsMirror = null` in `startBuild`), `:446-449` | **Every rebuild blanked the published profile** (`profileReady:false, profileBins:null`) for the 40 + meshes/2 frames of the sliced sweep — radars fell back to unfractured bands, the scrubber trace to "unknown". Walking FPV re-crossed 25 m before a 400-mesh sweep finished, so the profile could stay perpetually un-ready. With A2 this would have fired on every tile arrival. | **FIXED** — the carry policy: the last complete profile (`shown`) stays published while the new eye is within `PLAN.carryProfileDistM` (60 m = `AIMCONES.skylineGuardM`, test-locked ≤); beyond it null as before. `debug().carried` on the seam. | local-tested |
| B1 | resolution | MED | 85 % | `tuning.ts` `PLAN.azBins: 120`; `horizonProfile.ts:56` (`raiseBin` takes the max); every frame test keys `Math.round(fovDeg*2)` (`FrameCard.tsx:81`, `FindPanel.tsx:145`, …) | **3° bins under a long lens.** A 600 mm frame is ≈ 3.4° wide: the skyline under the whole frame is 1–2 bins, interpolated; a mast raises a whole bin to its tip (over-block) and a thin gap between two towers is lost (under-block). The tuning comment justifies 3° against a 150 m building at 3 km — a skyline criterion, not a frame one. | Backlog **T110**: a second, FINE bin array for MESH edges only (720 bins = 0.5°) with terrain kept at 120 (the march is the expensive half); `sampleProfile` = max(terrain interp, fine bin). | UNVERIFIED (design) |
| B2 | consumers | MED | 85 % | `FpvHud.tsx:36`, `StylizedTiles.ts:5872` (`altDeg > FPV.bodyMarkerMinAltDeg`), `dayArcs.ts:22-25`, `skyTrail.ts:52`, `showers.ts:627,639`, `eclipse.ts:306-308`, `TimeScrubber.tsx:202-212` | **The FPV HUD's body chips, the day arcs / sky trail, the eclipse rows, the dark-sky windows, the meteor showers and the scrubber's sun/moon CURVES use the geometric horizon only** — a body behind a building reads "up". `planFeed.profileSample()` was built for exactly this ("the dayArcs skyline fold") and has one caller: a null check. The depth-tested GL discs (`skyGhosts.ts:70`, `skyTarget.ts:121`) are the only sky elements a building hides. | Backlog **T111** (owner taste call — dayArcs carries a documented ruling for the analytic fade): fold `profileSample()` into the HUD's up/down and the day-arc alpha; showers/eclipse rows get a "skyline" badge. | UNVERIFIED (design) |
| B3 | honesty | LOW | 85 % | `TimeScrubber.tsx:229`, `MobileTimeDock.tsx:163`, `FindPanel.tsx:214,259`, `FindSheet.tsx:136`, `PlanSheet.tsx:153,346`, `FrameCard.tsx:109` | **Six consumers read `profileBins` raw**, skipping `skylineBinsFor`'s coverage ≥ 0.5 + 60 m eye guard that the three radars honour (`horizonProfile.test.ts:195` pins it for radars only). After A3 a published profile is always complete and ≤ 60 m from the anchor, so the residual is the coverage gate alone (a profile with < 50 % of its terrain bins answered). | Backlog **T112**: route the six through `skylineBinsFor` (a one-line change each) once the owner accepts that a low-coverage profile then shows "unknown" instead of "clear". | UNVERIFIED |
| B4 | best spot | LOW | 80 % | `bestSpotWorker.ts:760 buildDsm` (no `rejectPlanes`); `planFeed.ts:117-119,274` + `occlusion.ts:100-104` apply the enriched-bbox prism | **Mask asymmetry**: coarse OSM ancestor tiles spanning the Dnipro bbox are fragment-clipped on screen and vertex-rejected in pipeline A, but NOT in pipeline B — the heat map's SOLID layer can carry OSM mass the renderer discards, or mass whose enriched twin was edited shorter. | Backlog **T113** (BEST SPOT is PARKED): thread `bboxClipPrismEcef` into `flattenTin` for the OSM group. | UNVERIFIED (impact not browser-measured) |
| B5 | dead code | LOW | 95 % | `localDsm.ts:657 addFloatingSolid`, `bestSpotSolver.ts:923`, `bestSpotWorker.ts:857` | `addFloatingSolid` has zero callers: `dsm.floating` is always empty, `bandCapacity` defaults to 0, `SRC_DECK` / "ON A BRIDGE" can never fire — while `localDsm.ts:22-26` names the owner's hero location as a 29,054 m² deck. | Backlog **T113** rider (parked feature). | local (grep) |
| C1 | refresh | LOW | 80 % | `heightMemo.ts:170` (`invalidateRegionRad` early return), `tuning.ts:3030` `maxAgeMs: 60_000` | A terrain tile whose `boundingVolume.region` is absent leaves only the 60 s backstop to refresh the memo (the CWT path is region-bearing per `QuantizedMeshPlugin.js:359`; the ESRI placeholder path unverified). Pre-existing, from lever 6. | Backlog **T114**: a DEV counter on the early-return branch (the existing `fullDrops` stat is the tell). | UNVERIFIED |
| C2 | tests | LOW | 95 % | `test/` (no `planFeed` test existed; `fences.test.ts:22` fences only its store imports) | No test pinned WHICH groups the collector walks or that an arrival invalidates. | **FIXED** — `planFeed.test.ts` (9 cases: user model raises a bin; without the group it does not; hidden group; builtEpoch / modelsEpoch / terrainEpoch re-sweep after the quiet window; one burst = one rebuild; carry within 60 m, null beyond; `invalidate()` under carry; `carryProfileDistM ≤ skylineGuardM`). | local-tested |

## Verified clean (named probes)

- **T77 regression sweep (agent C):** `git log --since=2026-09-04 --name-only -- src/lib/geo` empty; no T77 hot-path module (`belowCameraGate`, `frameFreeze`, `seatQuiet`, `heightMemo`, `terrainPick`, `tileFoveation`, `loadPriority`) is imported under `src/lib/geo/**`; `enrichedMask.ts` change additive only (`seatLand()`); no `AIMCONES` / `PLAN` / foveation value moved in the era's `tuning.ts` diff. T79's gate arms only inside `_getPointBelowCamera` (`belowCameraGate.ts:30-31`); `getPivotPoint` (T107) has no visibility caller; `frameFreeze` is `import.meta.env.DEV`-gated; C-1's seat freeze is bounded to 0.5 px / 1 % relief — orders under a 3° bin. 24 files / 693 tests green.
- **Occluder sources already present in BOTH pipelines:** terrain (the rendered TIN via `ground.heightAt` → `rawHeightAt` raycast, `imageryGround.ts:1190,1219`), OSM buildings, enriched buildings, **height overrides** (`applyFeatureSeats` is the one writer of the position arrays, `enrichedBuildings.ts:148,2012,2119-2127` — the sweep reads post-edit vertices; the re-seat epoch reaches `planFeed.invalidate()` and bestSpotFeed's `seatEpoch`), trees (`sweepTreeInstances` / `collectCanopyInstances`).
- **FPV eye, not pin:** the profile anchors at the photo apex, else the live FPV `camera.position` with `fpvEyeAboveGroundM` (`planFeed.ts:348-365`, `StylizedTiles.ts:7954-7960`).
- **Desktop / `/m` parity:** same island, same feed, same store; MiniMap + MapWindow are shared files; the sheets consume the identical bins.
- **Tracking bodies:** the tracked target's row and `blockedNow` come from the same `sampleProfile` (`planFeed.ts:330`), refreshed every 12 frames, crossings re-scanned on target swap.

## Pre-existing / out-of-scope

- The GL radar fan never draws in FPV (`StylizedTiles.ts:7580` `enabled: !fpvActive`) — a product decision; the minimap radar is FPV's instrument. Not a staleness bug.
- `PLAN.rebuildDistM` 25 m against close occluders (a wall 50 m away shifts ~27° across the deadband): with A3 the profile no longer blanks between rebuilds, but a smaller deadband would restart the ~200-frame sweep before it completes while walking. The real lever is `meshesPerFrame` (an enriched cell's edge walk is 1–3 ms), which phones cannot afford. Left at 25 m; noted on **T110**.
- The desktop/mobile hand-forks (`TimeScrubber`/`MobileTimeDock`, `FindPanel`/`FindSheet`; `PlanSheet` hard-codes `stepMin 5` / 1.5 days where `FrameCard` reads constants) — inputs match today; a shared hook is hygiene, not accuracy. Not tracked.

## Backlog status changes

- **T108 NEW** (fixed): user models in the occlusion pipelines (A1). **T109 NEW** (fixed): the plan feed's streaming re-sweep + carry policy (A2/A3). **T110–T114 NEW** (open): B1–B5, C1 above.

## Fitness scorecard

- geo-accuracy of occlusion: sources ✔ all five (after A1) in both pipelines; refresh ✔ (after A2) on terrain / built / models / re-seat; angular resolution 3° (B1, unmeasured against a real long-lens frame).
- perf: the re-sweep is the existing sliced build (3 bins + 2 meshes per frame) triggered only after 90 quiet frames; no per-frame cost added. Phone impact unmeasured this session.
- privacy C6: untouched.

## Fixes (this session, `src/`)

`scene/userModels.ts` (+`occluderRoot`, `occluderEpoch`, 7 bump sites) · `scene/planFeed.ts` (the
`shown` profile, `startFrame`, the three epochs, `collectMeshes` + `under()`, `debug().carried/epochs`) ·
`scene/bestSpotFeed.ts` (`userModelsGroup`, `modelsEpoch`, the provenance count excludes models) ·
`StylizedTiles.ts` (wiring) · `tuning.ts` `PLAN.streamQuietFrames` 90 · `PLAN.carryProfileDistM` 60.
Gates: see DECISIONS 2026-09-07c.

## Fix-session slicing (the open rows)

1. **T110** fine mesh bins (M; `horizonProfile` + `occlusion` + `planFeed`; gate: `occlusion.test`
   with a 0.5°-wide gap between two towers at 600 mm) — owner call on the cost/benefit.
2. **T111** the skyline fold for HUD / day arcs / showers (M; taste; gate: sweep sheets at
   `dnipro-fpv-zoom-sweep` with a body behind the skyline).
3. **T112** the honesty gate on the six raw consumers (S; gate: `horizonProfile.test` extended).
4. **T113** BEST SPOT mask + dead deck code (S; parked feature — ride the next BEST SPOT session).
5. **T114** heightMemo region counter (S; DEV only).

## Addendum 2026-09-07d — the rulings executed

Owner rulings (2026-09-07d): T110 and T111 per the recommendations above; T112 **"best effort
even below 50 %"** — not the "unknown" this audit proposed. All three landed the same day
(DECISIONS 2026-09-07d, `rendering/MEASUREMENTS_2026-09-05.md` §23):

- **T110 FIXED** — `PLAN.azBins` 1440 (0.25°) on both shells; terrain marched at 120 and folded
  in; the mesh phase bounded by time (3 / 1.5 ms) and resumable mid-mesh. Desktop: 56 ms over 22
  frames; the phone twin: ~250 ms over ~130 frames, worst frame 3.2 ms. 14 % of the horizon at
  the 200 mm pose read lower than the 3° box-max.
- **T112 FIXED, re-shaped by the ruling** — honesty per BIN: `profileKnown` beside the bins,
  `sampleBinsKnown` (exact where swept, `null` where not, a known bin held over its own span),
  `skylineSamplerFor` the one gate (real eye + guard; the A1-16 coverage floor GONE — the radars
  keep a plain band where evidence is missing, the rows a "—"). The six raw consumers are fenced
  by `test/components/skylineConsumers.test.ts`.
- **T111 FIXED** — HUD badge + chip state, dashed sun/moon curves on both rails, meteor / eclipse
  / session-row badges, the day arcs and trail dimmed to 0.35 behind the skyline (the read-through
  ruling superseded for the alpha only).
- **T106 re-shaped** in the same session: the Pixel's `load-model` cost was three's
  `EdgesGeometry` + the string-keyed mask; both rewritten on integer keys, element-identical,
  9–14× in the page. Open: the biggest cell's whole handler in one frame (slice (b)).
- Open from this audit: **T113** (BEST SPOT, parked) · **T114** (heightMemo region counter).
