# wip 2026-09-07f — T106's Pixel read · the OSM handler's slow path + two-phase · the GC in the builders · T114 half · worktrees retired — DONE (post sweep + the owed device profile noted below)

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-07f: proceed with
`NEXT_SESSION_PROMPT.md`; the Pixel 6 Pro (1C111FDEE006SD) attached over adb. Records: DECISIONS
2026-09-07f · MEASUREMENTS §25 · backlog T106 (Pixel read + OSM), T114 (half) · README §B traps · this leaf.
Gates: vitest 2,855/181 (+10) · astro 0/0/11 · knip 0 · pre sweep `pre-2026-09-07f` 12/14 · post2 sweep
`post2-2026-09-07f` 12/14 (T103 family), the draw-count gate PASS on 14/14 (calls = golden), pixel diffs the
§24.3 noise band; `post-2026-09-07f` is the VOID run that caught the late-child trap.

## Boot
- Ship log clean (PR #111 landed, master `7d5d925`); VPN IE; ion 401 on the Mac AND from the phone's page
  (the phone read country UA yet ion answered 401 — the T98 gate is the ion status, not the country).
- House Chrome :9333, `wix dev` with `.vite` aside, phone wired (`adb reverse 4321`, `adb forward 9444`).

## The Pixel read of T106 (§25.1) — a+b HOLD on the device
- `probe-cpu-profile --leg descent --device` vs §21.3: dt p95 316.7 → **50.0**, max 848 → 400, hitch main
  thread **6.73 → 3.93 s**; the enriched `load-model` gone from the callers. Left: the OSM `buildings.ts`
  handler **410 ms in the hitches via three's `EdgesGeometry`** (361 ms self), vector tiles 262, controls 519
  (`rawHeightAt` 294, `stepTiltGlide` 194), seats 138, compile 68 (0.7 %), parse 122 (1.2 %).
- `probe-load-phase2 --device` (NEW flag: attach to the phone tab, no emulation, asserts `gnd > 0`; also reads
  `__globe.buildingsLoad()`): 70 units, worst drain **13.5 ms** at budget 3 = ONE builder step.

## The OSM slow path (§25.2) — FIXED
- Phone-side read: 11/11 resident OSM meshes `Float32Array/interleaved` (pos·normal·`_batchid`, stride 8).
  `edgesGeometry.ts`'s `plainF32` gate rejected them → three's path since slice (d), desktop too. The doc
  comment ("every … Cesium's OSM b3dm") was an assumption; no OSM counter existed.
- `positionsF32(geometry)`: plain → in place; interleaved Float32 → de-interleaved copy (the floats three's
  `toNonIndexed` reads); normalized/non-F32 → null (three's path). `test/components/globe/edgesGeometry.test.ts`
  (4): identity vs `EdgesGeometry` on a real `InterleavedBuffer` with padding noise, stepped ≡ one-shot,
  the Int16-normalized fallback.

## The OSM handler two-phase (§25.2) — `scene/buildings.ts`
- PHASE 1 sync (material swap, fill birth, tone seed, shadows; `handlerMaxMs` 0.1–0.4 phone). PHASE 2 one
  `makeEdgeUnit` per mesh on its own `createLoadQueue()`, drained in `update()` AFTER `tiles.update()` (under
  the T94 hold) under `BUILDINGS.loadBudgetMs` 3 / `loadBudgetMsLean` 1.5 (orchestrator keys on `lean`) —
  SEPARATE from the enriched budget (both drain in one frame, OSM then enriched → up to the sum).
  Priority `lookBiasedDistance(tileCenter, loadAim)` via `makeTileCenterReader` on `e.tile`. Strokes get
  their own `frameNow()` birth. `dispose-model` → `loadQueue.cancel(e.scene)` first. `dispose` → `clear()`.
- Seams: `__globe.buildingsLoad()` (ledger: tiles, meshes, handlerMs/Max, allocMs/Max, edgesMs/Max,
  slowPathMeshes, `allocTop[3]` {ms,verts,tris,nth}, scratchReuses/Growths, deferred*, pending, units*,
  budgetMs) · `__globe.buildingsLoadBudget(ms)` · DBG `buildings.osmLoadPending` / `osmLoadMaxMs`
  (the older `buildings.loadPending/loadMaxMs` rows relabelled "enriched").

## The GC behind the steps (§25.3) — six Pixel runs
- `allocTop`: 19.3 ms for a 43k-vertex mesh vs 1.3 for 31k in the SAME run; enriched `allocMax` 1.5 while its
  drain read 12.5 → V8's external-memory GC in whichever step allocated (per unit: a `Map` of ≤ 3×tris heap
  entries + ~9 MB typed arrays; ~600 MB churn per descent).
- Built (pure, identity-pinned): `fastEdges` edge map → open-addressed typed table (`hK0/hK1/hSlot`, the
  keyer's mixer; `N`/`slotOf` gone). `createFastEdgesScratch()` + `createAttributorScratch()` — ONE scratch
  per queue (sticky units ⇒ one live builder), arrays grow to the max seen, reset over the build's range
  (`vTable.fill(-1,0,cap)`, `hSlot`, `eState`, `runOf`, `table`, `firstRun`); output always sliced fresh
  (WebGL rejects views on resizable/pooled buffers anyway). `fastEdges.test` +3.
- Pixel worst drain: enriched **13.5 → 6.7** (edgesMax 4.0 · maskMax 6.7 · registerMax 3.1 · allocMax 2.3;
  reuses 86 / growths 14), OSM **→ 3.1** (budget 1.5). Desktop `high`: enriched 8.5 → 7.0, OSM 3.3, frames
  p95 24.4, >33 11; lean twin: enriched 9.2 (maskMax 9.1 = the attributor's construction at 4×), OSM 3.3,
  p95 50.8 → 42.8, max 255 → 174. `enrichedBench(50)` 0/0 every run.
- Enriched ledger new fields: `allocMs/allocMaxMs`, `locateCalls/locateMs/locateMaxMs/locateFeatures/
  locateMaxFeatures` (the one-shot `ensureLocated` — TIMED for the parts-first order; not sliced).

## Two phone traps (§25.4, README §B) — and the OWED profile
- **Thermal:** the 9th back-to-back descent read dt p50 33 / max 1,897 ms, compile 312 — `dumpsys
  thermalservice` status **4**, CPU 72/80 °C, big cores 984 MHz. Read the status before EVERY timed phone
  run; wait ≤ 1.
- **Keyguard:** `KEYCODE_SLEEP` LOCKS the owner's phone (secure; `wm dismiss-keyguard` refused); behind it
  the tab is `hidden`, rAF 0 → a `--device` run records 0 frames. Cool with the tab on `about:blank`, screen ON.
- **TAKEN (§25.5)** once the owner unlocked the phone (thermal 0; `adb forward` had dropped on the
  reconnect — re-wire): hitch frames 66 → 55, their main thread 3.93 → **2.78 s**, max 400 → 283; three's
  `EdgesGeometry` 361 → 0 (gone from the callers and the self-time table); app in the hitches 1,304 → 691
  (vector tiles 199 now lead — lever 11); gc 178 unchanged over the leg. Ledgers: enriched worst drain 8.6,
  OSM 12.2 (a GC in a growth — 3.1 the run before): the residue is GC timing, 3–12 ms run to run.
- `ensureLocated`: 58 calls, 0 FEATURES (the parts-first order never occurred), max 7.5 ms = the
  tree-instance loop → **T115** (S). `terrain.memo.regionless` 0 over 64 invalidations (T114's CWT half).

## T114 (half) · worktrees · compileAsync
- `HeightMemoStats.regionless` + DBG `terrain.memo.regionless` (warn > 0) + test; browser half = read 0.
- Eight `../ftw-wt-*` worktrees: dirt checked vs master (`git apply --check -R` LANDED; T96 fence on master in
  a later form) → snapshots at `refs/backups/wt-2026-09-07f-<name>`, worktrees removed, nine local
  `claude/*` branches deleted, `fetch --prune`. Remote leftovers for the owner: `claude/ship-20260814-003854`
  (PR #35 closed) · `claude/ship-20260822-002057` (no PR).
- `compileAsync`: desktop 0.9 % / Pixel 0.7 % of the leg (312 ms only cold+throttled); no per-material
  attribution; NOT built — owner call (close like lever 10 or a first-load prewarm in `GlobeCanvas.tsx:800`).

## THE LATE-CHILD TRAP (§25.6) — a regression the post sweep's DRAW CALLS caught
- Post sweep: same tris per pose, FEWER calls on every pose (zoom-sweep 437 → 400). At rest: HEAD lines
  220,721 vs the tree 38,087, same 41 OSM edge objects — all 41 at the IDENTITY matrixWorld (ECEF origin,
  culled). `TilesRenderer.setTileVisible` updates a tile scene ONCE; `TilesGroup.updateMatrixWorld`
  recurses only when the group's matrix changed → a child added later is never seated. The enriched
  deferral (07e) had the same exposure, hidden by the seat passes (28/28 OK at arrival).
- Fix: `edges.updateMatrixWorld(true)` after `c.add(edges)` in BOTH handlers → 437 / 220,721 again.
- Fences: `fences.test` "deferred crease edges seat their own world matrix" · the sweep's DRAW-COUNT GATE
  (`--compare`: tris within 0.5 % of the golden's `report.json` row AND calls down > 3 and > 2 % ⇒ FAIL).
- The A/B idiom: `git stash push -- src/` → HMR serves HEAD → measure at rest → `git stash pop`.

## Traps learned
- A late child of a tile mesh must seat its own world matrix (above). Pixel diffs at tolerance 0 cannot
  gate thin strokes over the streaming noise floor — the renderer's counters can.
- A gate with no counter on one of its two consumers is an assumption: the OSM path had no `slowPath` tell.
- "One step took 13 ms" with sub-ms chunks = a GC in the allocation; measure `allocMax` per unit and record
  WHICH unit (`allocTop`) — size vs incident tells them apart in one run.
- Never sleep the phone; never run a timed phone leg above thermal status 1.

## Owner order at session end (2026-09-07g) — recorded, not started
Two MOBILE features first, in order; the T77 lane + every open call PARKED behind them:
1. BEST SPOT on `/m`: fifth bottom-row item right of SEARCH (`mobile/TabBar.tsx` — SCENE·PLAN·FIND·SEARCH
   today); desktop behaviour WITHOUT ULTRA (`BestSpotPanel.tsx:459,537-539`); a mobile-adapted sheet;
   store/scene sheet/worker shared; the iPhone's performance is the gate (Device Farm README §A, T83 caps,
   the 2 GB jetsam line); `bestspot/README.md` is the entry; `verify-bestspot` stays 96/101.
2. AR look-around in mobile FPV: a toggle with an icon on the aiming-joystick UI (`mobile/FpvControls.tsx`);
   the phone's orientation aims `fpvYaw/fpvPitch`; permission from the toggle's tap; a degradation ladder to
   VERIFY in research (iOS `DeviceOrientationEvent.requestPermission` + `webkitCompassHeading` magnetic →
   true · Android `deviceorientationabsolute` / `AbsoluteOrientationSensor` · relative gyro + one-tap align ·
   none); the math a three-free `lib/` module with pose tests; CDP `DeviceOrientation.setDeviceOrientationOverride`
   drives the desktop harness; a real iPhone (owner's, via the tunnel) verifies the flow + compass.
No sensor code exists in `src/` today (grep 2026-09-07: zero hits for deviceorientation / requestPermission).
Recorded: DECISIONS 2026-09-07g · `NEXT_SESSION_PROMPT.md` (rewritten) · `mem:core` Next step.

