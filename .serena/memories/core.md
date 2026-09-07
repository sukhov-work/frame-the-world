# mem:core — PLUX graph root

## What this is
Serena memory-graph root for **PLUX** (`plux.today`), a Wix headless Astro 5 app that projects a
photo, from its EXIF, as a camera frustum + image plane at its capture location on a stylized 3D
globe with real OSM buildings under a real ephemeris sky. Client-heavy; Wix is the thin backend.
Owner: Yevhen. Repo `headless-frame-the-world` — that name, and "FTW", are the repo only, never the
product; never rename the `ftw:*` keys or the `uFtw*`/`vFtw*`/`FTW_*` shader ids
(`test/brandFence.test.ts`).
**Search order, first hit wins:** this graph → `.claude/claude-docs/` → `.claude/conventions/` →
the code (Serena → Grep → Read) → Wix MCP for platform APIs.
**One writer per fact:** session narrative lives in the `project/wip-*` leaves and in `DECISIONS.md`
§Per-phase digests; this root only indexes and states the current status.

## Status — 2026-09-08
- **2026-09-08 (`mem:project/wip-2026-09-08-pixel-reads-version-t118`):** **THE PIXEL READS OF LEVER 11 + T115 —
  BOTH HOLD** (`probe-cpu-profile --leg descent --device`: no vector-tile parse symbol in any table, app in the
  hitches 691 → 649 with vector tiles 199 → 0; `probe-vtile-worker --device` 12/12 worker, 0 inline, seat 0.7 ms;
  `probe-load-phase2 --device` treeLocate worst 0.6 ms, T115 CLOSED). What the phone leg shows next:
  `applyFeatureSeats` 427 ms of the 8 s leg, the controls raycast 1.17 s (lever 8, the terrain BVH). **THE APP
  VERSION:** `package.json` **1.36.1**, `src/lib/version.ts` the one writer (a named JSON import, tree-shaken),
  `v1.36.1-dev` under `wix dev` / `v1.36.1` in a release — desktop inside the attribution chip (`.map-version`),
  `/m` `controls/VersionStamp.tsx` at the bottom column's corner; **the ship hook bumps the PATCH on every ship**
  (`npm version patch --no-git-tag-version`, after the gates, before `git add -A`). **T119 FIXED** — the DEBUG
  window's grips: `.tip { position: relative }` outranked the grips' `absolute` by emission order in a BUILD
  (◢ at the top-left, ⠿ a panel-height off-screen) → the compound-selector pin; the drag floor now keeps the tab
  reachable (`GRIP_CLEAR_PX` 22) and a centre-anchored resize stops at it. **T118 FIXED (both shells)** — THE
  READINESS HOLD: a due solve waits while `sceneStreamPending()` > 0 (attached tilesets without a root, `isLoading`,
  queued/downloading/parsing, the two load queues via `loadPending()`), a THUNK read only when a solve is due,
  ceiling `BESTSPOT.holdMaxMs` 20 s; the ONE status chip `LOADING THE SCENE…` / `COMPUTING…` / `✓ DONE`
  (`bestSpotProgress`, both shells). Twin: HEAD refusal at 0.6 s + finest 14.2 s / 2 jobs → held ~8–12 s, first ink
  REAL, finest 9–14 s / **1 job**; the Pixel: held 3.0 s, first ink 3.9 s real, finest 8.1 s, 67/67. Gates: vitest
  2,967/192 · astro 0/0/12 · sweep `post-2026-09-08` draw-count 13/13 vs `post2-2026-09-07j`. Freshest golden:
  `post-2026-09-08`. Open: the owner calls in ONE batch (+ `BESTSPOT.holdMaxMs`).
- **2026-09-07j (`mem:project/wip-2026-09-07-lever11-vtile-worker`):** **BACK ON THE T77 LANE — LEVER 11 BUILT**
  (the vector-tile parse off the main thread): a `structuredClone` of the nested parse costs AS MUCH as the parse
  (60.6 vs 60.8 ms over 25 real Dnipro tiles), so the design is a flat typed-array WIRE (`lib/geo/vtileWire.ts`,
  transferred; the main-thread seat 3.1 ms Σ) + `vtileParseWorker.ts` (shell only) + `vtileParseClient.ts` (inline
  twin on no-Worker / crash, byte-identical); desktop descent A/B: vector tiles in the hitch frames **169 → 0.8 ms**,
  sweep draw-count 13/13 with calls AND tris identical, `vector.*` rows identical per pose. **T115 FIXED** —
  `locateTrees` chunks of 256 through `lib/globe/treeLocate.ts` (bit-identical to three), the first chunk of a frame
  always, then under the later of the reseat deadline and `ENRICHED.treeLocateBudgetMs` 0.5; tree-seating throughput
  unchanged. **T114 CLOSED** (regionless 0 on all 14 poses). **T102 ISOLATED** (`/json/new` activates the composer
  tab → the pose tab hidden → no fly; fixed in the harness) · **T103 FIXED** (CDP `Animation.setPlaybackRate` 0 under
  the freeze) · **T93's FPV half not reproduced** (both probes run under the VPN). Two August remote ship branches
  deleted (backups `refs/backups/ship-*`). **THE PIXEL READS OF LEVER 11 + T115 ARE OWED** (no phone on adb this
  session). Gates: vitest 2,948/189 · astro 0/0/12 · knip 0 · freshest golden `post2-2026-09-07j`.
- **2026-09-07h (`mem:project/wip-2026-09-07-mobile-bestspot-ar`):** **THE TWO MOBILE FEATURES LANDED** (owner
  order 2026-09-07g). **BEST SPOT on `/m`** — the fifth tab `◎ SPOT` → `mobile/BestSpotSheet.tsx` (FIND idiom,
  no ULTRA, the honesty copy ONE shared copy in `controls/bestSpotCopy.ts`); the engine's desktop-only gate is
  GONE on both shells (`bestSpotAllowed` TRUE, fence rewritten), an ARMED disc keeps the building tilesets
  attached in either `/m` map mode (`bestSpotArmed()`). **Device Farm iPhone 17 Pro: finest rung 6 s after
  arming, 60 fps flat with the sheet up, CPU 6/7 ms, LRU 3/78/2 MB — the gate PASSED.** **AR LOOK-AROUND**
  in mobile FPV — `🧭 AR` chip (`mobile/FpvControls.tsx`) → `store/camera.arLook` → `scene/arLook.ts` →
  `lib/sensors/{deviceOrientation,orientationLadder}.ts` (rungs android-absolute · ios-compass ·
  relative-aligned · relative-unaligned) → `lib/geo/wmm.ts` (WMM2025 in-house; Dnipro +8.58° E); while the
  aim is live the look-drag + aim-stick heading stand down; 39/39 on the phone twin. **The farm iPhone cannot
  pass the permission sheet (Appium's click ≠ a WebKit gesture) — the device tier is the owner's iPhone
  (T117).** **T116 FOUND + FIXED**: the enriched TREE seats "landed" every frame forever (a Float32Array vs
  float64 target loop, a T77 C-1 regression since 09-06k) — one instance-matrix GPU upload per frame per
  cell and a seat epoch never quiet, which had silently broken BEST SPOT's streaming re-solve; `seatLandF32`.
  Open: T117 (AR on a real iPhone) · T118 (the first `/m` solve is a refusal until the buildings stream —
  owner call) · T116's Pixel FPV re-read. Gates: vitest 2,917/186 · astro 0/0/11 · knip 0 · sweep draw-count
  13/13 vs `post2-2026-09-07f`. **iOS 13+ has NO "Motion & Orientation Access" setting** — the denied copy
  says quit-and-reopen Safari.
- **2026-09-07f (`mem:project/wip-2026-09-07-t106-pixel-read`):** **T106 READ ON THE PIXEL** — a+b hold on
  the device (descent dt p95 316.7 → 50.0 ms, hitch main thread 6.73 → 3.93 s, the enriched handler gone
  from the callers). What was left: **the OSM handler on three's SLOW path** — every Cesium b3dm position is
  INTERLEAVED and `edgesGeometry.ts`'s gate rejected it (410 ms of the Pixel's hitches, desktop too since
  slice d) → `positionsF32` de-interleaves (identity pinned) and **the OSM handler is two-phase** on its own
  `loadQueue` under `BUILDINGS.loadBudgetMs` 3 / 1.5 (`__globe.buildingsLoad()`, DBG `buildings.osmLoad*`).
  **The GC behind the "13.5 ms step":** the edge `Map` → a typed table, both builders POOLED per queue
  (`createFastEdgesScratch` / `createAttributorScratch`); Pixel worst drain enriched 13.5 → **6.7 ms**, OSM
  → **3.1**; desktop `high` 8.5 → 7.0; identity 0/0. T114 half (the `regionless` counter). The eight stale
  worktrees + nine `claude/*` branches retired (snapshots `refs/backups/wt-2026-09-07f-*`). **Two phone
  traps:** thermal status ≤ 1 before any timed phone run (status 4 voided a profile); NEVER `KEYCODE_SLEEP`
  the phone (secure keyguard — it locked itself; the post profile was taken once unlocked, §25.5: hitch main thread 3.93 → 2.78 s, three's `EdgesGeometry` 361 → 0; T115 opened — the tree locate). **THE LATE-CHILD
  TRAP (§25.6):** the post sweep read fewer DRAW CALLS per pose — all 41 deferred OSM edges at the identity
  world matrix (`TilesGroup` never seats a late child) → `updateMatrixWorld(true)` in both handlers, a
  fence, and the sweep's draw-count gate. vitest 2,855/181 · astro 0/0/11 · knip 0.
- **2026-09-07e (`mem:project/wip-2026-09-07-t106-two-phase`):** **T106 FIXED** — the two-phase `load-model`
  handler: phase 1 synchronous (cell record, material swap, F1 birth, trees; 0.4/0.8 ms), phase 2 one unit per
  mesh on `lib/globe/loadQueue` drained by `update()` under `ENRICHED.loadBudgetMs` 6 / `loadBudgetMsLean` 3 per
  frame, nearest first, sticky mid-flight; the unit's long loops all RESUMABLE (`createFastEdgesBuilder`,
  `createSegmentRunAttributor`, fingerprints by run, the footprint locate by feature), registration atomic.
  Worst drain desktop 30.3 → **8.5 ms**, phone twin 85.9 → **8.0 ms** (`probe-load-phase2.mjs`, `--budget 1e6`
  = the old shape); identity 0/0; the twin's whole-city landing drains over ~4.4 s (owner knob). The flip bank
  measured under the phone caps (`probe-flip-bank.mjs`): 670 requests on the cold 2D return, 177 warm — owner
  call (cap vs jetsam). Boot trap: the ship hook has NO retry — a transient SSH outage stranded `2d55a33`;
  pushed by hand → PR #110. vitest 2,845/180 · astro 0/0/11 · knip 0. The Pixel read of T106 is still owed.
- **2026-09-07d (`mem:project/wip-2026-09-07-occlusion-rulings-t106`):** the occlusion rulings executed.
  **T110 FIXED** — the horizon profile is 0.25° (`PLAN.azBins` 1440) on BOTH shells; terrain marched at 120
  and folded in; the edge walker caches vertices, span-fills, and is resumable under a TIME budget
  (`PLAN.sweepBudgetMs` 3 / 1.5 lean): desktop 56 ms over 22 frames, the phone twin ~250 ms over ~130,
  worst frame 3.2 ms either way. **T112 FIXED** (owner: "best effort even below 50 %") — honesty per BIN:
  `profileKnown`, `sampleBinsKnown`, `skylineSamplerFor` the one gate (the A1-16 coverage floor GONE),
  `mirrorSampler` for the six consumers (fenced by `test/components/skylineConsumers.test.ts`), per-sample
  "unknown". **T111 FIXED** — HUD `BEHIND SKYLINE` badge + chip state, dashed sun/moon curves on both rails,
  meteor/eclipse/session badges, day arcs + trail dimmed to `DAYARC.skylineBehindAlpha` 0.35 behind the
  skyline. **T106 RE-SHAPED** — three's `EdgesGeometry` + the string-keyed mask rewritten on integer keys
  (`lib/globe/fastEdges`, `enrichedMask.segmentRunsFromSources`), element-identical: desktop 527 → 57 ms /
  240 → 17 ms, the twin 865 → 114 / 455 → 33 on real cells (`__globe.enrichedBench`); the tail is the
  biggest cell's whole handler in one frame (slice b). vitest 2,829/179 · astro 0/0/11 · knip 0.
- **2026-09-07c (`mem:project/wip-2026-09-07-t83-pagehide-occlusion-audit`):** DECISIONS compaction r6 done
  (140.7 → 74 KB). **T83 FIXED** — ONE page dies on its own, the tile caches: `QUALITY.leanMobile.{lruBytesMB
  48, enrichedLruBytesMB 128, groundLruBytesMB 112}` via `lruCapBytesForLean`; farm A/B clean: caps ON alive
  at page age 269 s resting at 8.6/84/97 MB, caps OFF dead before 115 s; plus `RENDERER.releaseOnPageHide`.
  The iPhone's `/m`: cpu 26 → **2 ms** (T107). **The visibility/occlusion audit** (`audits/audit-occlusion-
  2026-09-07.md`): no T77 regression; **T108 FIXED** user models now occlude in both feeds; **T109 FIXED**
  the plan feed re-sweeps on `terrainEpoch · builtEpoch · modelsEpoch` and carries the last profile through
  a rebuild within 60 m; T110–T114 open (owner calls T110–T112 in the brief). vitest 2,782/177 · astro
  0/0/11 · knip 0. Backlog T1–T114. Trap: a `src/` edit during a farm run reaches the phone (HMR via tunnel).
- **2026-09-07b (`mem:project/wip-2026-09-07-t77-phones-lever10`):** **T83 CLASSIFIED** — a jetsam kill at
  WebContent's 2,048 MB per-process cap (four Device Farm syslogs, the same line; always the SECOND `#f=`
  load in one process; one FPV page is ~½ GB and flat on the desktop twin `probe-memory-footprint.mjs`;
  the GPU-side memory of a destroyed page lingers ~470 MB per load) → lever named, not built: release on
  `pagehide`. **The Pixel re-measured WITH terrain** (the owner caught the first run reading a bare sphere
  — T98 on the phone lane; §11's Pixel city/everest/`/m` rows VOID; `verify-perf-baseline --device` now asks
  ion from the phone and FAILs a terrain-less cell): orbit/city/everest at the 60 Hz cap (gate off 6–8 fps),
  fpv 42 fps GPU-bound. **Lever 10 CLOSED, not built** — `probe-cpu-profile --leg descent` (exact frame
  markers): glTF parse 0.7 % (desktop) / 1.4 % (Pixel) of the hitch frames' main thread. **T107 FIXED** —
  `controls.getPivotPoint` ran every frame in `stepMobile2dLocks` (87 % of `/m`: the iPhone's 26 ms, the
  Pixel's 58) and `stepTiltGlide` (27–33 ms per arrival frame): Pixel `/m` 16 → 60 fps, descent hitches
  86 → 64. **T106 OPENED** — the Pixel's descent hitch is the enriched cell's `load-model` work (2.26 s +
  0.8 s mask runs in 57 hitch frames). vitest 2,767/176 · astro 0/0/11 · knip 0. Backlog T1–T107.
  **DECISIONS §Recent is 137 KB → compaction round 6 FIRST next session.**
- **2026-09-07a → 2026-09-06h, the T77 lane (compressed; each leaf has the numbers):** 09-07a T100
  CLOSED (a) — the overlay's own extinction tail, ladder 19/19, T66 4.23 → 1.48; the iPhone re-measured
  (orbit/city/everest 9–13 → 50–60 fps at `mid`) · 09-06n the five rulings executed (T80/T104, T101,
  T92, T93 re-classified + fixed) · 09-06l E1/E2 closed, T80-h fused bloom (fpv 19.2 → 14.2 ms), T104
  the GPU timer over-counts · 09-06k the six slices integrated (BASE `baseTakesLook`, C-1 seats, T80-g,
  A-rest, T94 frameFreeze) — after session j FROZE THE MACHINE · 09-06h the pose catalogue
  `scripts/lib/poses.mjs` + sweep sheets (the standing order), slices A/B, the sunset fix. Leaves:
  `mem:project/wip-2026-09-07-t100a-overlay-tail` · `wip-2026-09-06-t77-five-rulings` ·
  `wip-2026-09-07-t77-e1-e2-t80h` · `wip-2026-09-06-t77-six-worktrees` · `wip-2026-09-06-t77-resume-harness-sunset`.
- **THE RESOURCE BUDGET (owner order 2026-09-06j, standing, machine-checked):** ONE house headless
  Chrome, ONE dev server, free ≥ 20 % (`scripts/verify-chrome.mjs` exit 3 · `ensureBrowser()` throws ·
  `scripts/resource-watchdog.mjs`); agents NEVER launch Chrome / a dev server / the full vitest /
  `astro check`; worktrees = edit isolation only. `conventions/verify.md` §THE RESOURCE BUDGET.
  **T98: the VPN is a precondition for every terrain gate** (`mem:project/dev_environment` §NETWORK).
  Trap: after any large landing restart `wix dev` with `node_modules/.vite` moved aside.
- **MESH SUITE CLOSED 2026-09-05b** — MS0–MS8 shipped (gizmos, world-synced building overrides, user
  models); `MESH_SUITE_PLAN.md` §4a, the no-regression contract, stays binding.
- **BEST SPOT's ALGORITHM PARKED 2026-08-27** (owner 2026-09-01: sufficient as implemented; T59 the one
  owner decision) — its MOBILE SURFACE shipped 2026-09-07h (the `/m` `◎ SPOT` tab) · **Phase 7, AI shot
  analysis, PARKED 2026-08-11** — out of every plan, no AI code in `src/`.
- **RELEASE GATE: prod is DARK** until the owner's GoDaddy nameserver fix → Wix www TLS → OAuth
  allowlist gains `plux.today` → `wix release`. T2 canaries and T50 ride it.
- Gates 2026-09-08: vitest **2,967/2,967** (192 files) · `astro check` **0/0/12** (the 12th hint pre-existing:
  `ultraEmisK` unused in two scene files) · knip **0**.
- **App version 1.36.1 since 2026-09-08** (`src/lib/version.ts`; the ship hook bumps the patch every ship).
- DECISIONS compaction **round 5** ran 2026-09-06g: verbatim 08-21→09-05 → `DECISIONS_ARCHIVE.md`
  §Moved 2026-09-06; digests in DECISIONS §Per-phase digests.
- The one debt registry: `.claude/skills/frame/references/tracked-backlog.md` (T1–T119).

## Next step — the T77 lane continues (owner 2026-09-07i; full brief: `NEXT_SESSION_PROMPT.md`)
Lever 11 + T115 are READ ON THE PIXEL and hold (2026-09-08); the three owner asks of 2026-09-08 (the version
stamp, the DBG grips, T118) shipped; the owner calls are the next thing (ONE batch — the lane's next slice is
the terrain BVH / the seat pass, which the Pixel leg now names as the biggest buckets); T117 an open ear.
1. Boot: the ship log FIRST (an `ABORT: push failed` run = push the stranded branch by hand; a landed PR
   with the checkout still on the ship branch = re-seat), VPN on the Mac (AND the phone), ion curl,
   `--budget`, ONE Chrome, `wix dev` restarted PLAIN with `.vite` aside; the pre sweep if the session touches
   `globe/**` or `lib/globe/**` (freshest golden `post2-2026-09-07j`); the phone UNLOCKED and at thermal
   status ≤ 1 before any timed leg. Never edit a SERVED `src/` module while ANY harness or farm run is up.
2. **THE PIXEL READS OF LEVER 11 + T115** the moment the phone is attached: `probe-cpu-profile --leg descent
   --device` vs MEASUREMENTS §25.5 (vector tiles → ~0 in the hitch frames; `buildings.treeLocateMaxMs` < the
   frame budget; DBG `vector.mvt.worker` = `parsed`, `inline` 0, `seatMaxMs` ≤ ~2) + `probe-load-phase2
   --device`. Then the owner calls in ONE batch (lean load budgets, `compileAsync`, the terrain BVH,
   `skylineBehindAlpha`, the flip bank, T113, T118, T116's re-read, `treeLocateBudgetMs`), then what §26.2's
   desktop hitch table still shows (`applyFeatureSeats` 200 ms, `rawHeightAt` 92 ms).
3. (Superseded 2026-09-07a — the streaming measurement's first read is §20.) The streaming measurement (descent-leg per-frame CSV) that gates levers 9–11; then the phones
   — RE-MEASURE first (T79/T80 never read on a phone; §11's orbit poses were 9–13 fps CPU-bound),
   then T83, then slice D (14–16, NOT STARTED). Standing table: `NEXT_SESSION_PROMPT.md` §Where T77
   stands. Tails: T93's FPV wedge, T102, T103.
**Constraints:** no regression of behaviour, accuracy, calculations, plans, predictions or sky
features · `high` byte-identical · ULTRA off-state exact · `ENGINE_STATE_2026-09-02.md` §8 harness
list per slice · DNIPRO slice first (owner 2026-09-02c) · the audit is read-only.
**Instruments** in `scripts/`: `lib/poses.mjs` + `verify-visual-sweep.mjs` (the catalogue + sheets),
`verify-perf-baseline.mjs`, `verify-temporal-stability.mjs` (`--rig`, `--step`), `verify-ultra-dusk.mjs --ladder`,
`probe-seat-loop.mjs`, `probe-shadow-rig.mjs`; DEV seams `__debugFeed`, `__globe.seatSettle()`,
`__globe.shadowRig()`, `__globe.enrichedCellSeats()`, `__quality.bloomScale()`.
**Owner calls open:** T80 · T85 (`baseEarth` `raycast = () => {}`) · the rooftop-clearance lever.
**Phones:** `tools/devicefarm/README.md` + `MEASUREMENTS_2026-09-05.md` §11; first phone item is
**T83**, the iPhone 17 Pro `#f=` FPV page dying 40–60 s after load.

## Era index
One row per era, oldest first. `07-13-terrain-reseat` = `mem:project/wip-2026-07-13-terrain-reseat`;
braces expand, `*` = every leaf on that stem. Docs are under `.claude/claude-docs/`.
Digests: DECISIONS §Per-phase digests; verbatim: `DECISIONS_ARCHIVE.md` §Moved dividers — r3
2026-08-18 · r4 2026-08-22 · **r5 2026-09-06 = 08-21→09-05, OWNER BATCHES #4–#6 to MESH MS4–MS8**.

- **Phases 1–4 scaffold/globe/decode/projection/ephemeris (07-09→10)** · 07-10-{phase4-scrubber,
  prephase5-fixbatch,ui-fixes}
- **Phase 5 members/pins + 5.5 S1–S7 + pre-S7 refactor (07-10→12)** · `archive/PHASE_5_5_UX_BATCH`
  + `ARCHITECTURE_REVIEW` · 07-10-phase5-members-pins · 07-11-* · 07-12-readme-rewrite
- **Rendering passes + Dnipro enrichment 0–3 + illumination (07-12→14)** · 07-12-rendering-* ·
  07-13-* · `dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN` · `rendering/RENDERING_QUALITY_PASS`
- **OSM2World + R2 hosting + obstruction moat + seating/UI (07-14)** · 07-14-* ·
  `dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP`
- **Docs reorg + Phase 6/6.9 marketplace + St Albans (07-15→18)** · `archive/DEMO_CONTENT_SEED` ·
  07-{15,16,17,18}-*
- **View-prefs persistence + default flips (07-21)** · 07-21-viewprefs-uiux
- **Astro engine A–E + comet 10P (08-02→10)** · `archive/ASTRO_ENGINE_PLAN` · 08-{02,03,10}-*
- **AUDIT #1 + slices 0–7 + Phase 8a + planning core (08-13)** · `audits/audit-full-2026-08-13` ·
  08-13-{full-audit-1,planning-core-restructure,slice7-phase8a}
- **Mobile M0–M3 `/m` shell — planning-only, permanently (08-11→14)** · `MOBILE_PLAN` ·
  08-11-mobile-design · 08-13-m{1-mobile-planning,2-fpv-touch} · 08-14-mobile-m3*
- **Planning QoL 1–4 + FIND v2/v3 + sunsets-in-frame (08-14→15)** · `archive/PLANNING_QOL_PLAN` ·
  08-14-{qol*,find-*,night6-hover-floor} · 08-15-sunsets-in-frame
- **Owner UX batches ×5 + ×9 (08-15b/c)** · 08-15-{ux-batch,uxbatch2}
- **Guide G1 + polish (08-15d/e)** · `archive/GUIDE_PLAN` · 08-15-guide-g1
- **P7 meteors + UPLIFT U1–U8, COMPLETE (08-17→19)** · `UPLIFT_PLAN` (App. A = U7 terrain audit)
  · 08-17-* · 08-18-u*
- **AUDIT #2 + fix slices (08-18)** · `audits/audit-full-2026-08-18` · 08-18-audit2*
- **Owner UX #2/#3 + PLUX launch grooming (08-19→19d)** · 08-19-*
- **OWNER BATCHES #4–#6 + QA slices, riding the release gate (08-21→22b)** · `archive/UXBATCH4_PLAN`
  · 08-21-*
- **AUDIT #3 + owner micro-slice + F1–F10 (08-22a→22e)** · `audits/audit-batchseams-2026-08-22` ·
  08-22-{owner-microslice,audit3*}
- **GUIDE FINAL G-A…G-J + owner 3-slice + HQ map (08-22f→22i)** · `GUIDE_FINALIZATION_PLAN` ·
  08-22-{guide-final,owner-3slice} · 08-27-guide-bestspot-eclipses
- **ULTRA fidelity + eclipses + immersion breakers + dusk (08-22j/k, 08-27b/c)** · `ULTRA_PLAN`
  (AS BUILT block first) · `rendering/ULTRA_ARCHITECTURE` §13 · 08-22-{ultra-track,eclipses} ·
  08-27-{ultra-render-batch,dusk-taste-pass}
- **BEST SPOT heatmap S1→S7, then PARKED (08-23→08-27d)** — **start at `bestspot/README.md`**;
  `verify-bestspot.mjs` is **96/101 by design**, D8 red on clean master · 08-23-bestspot-heatmap ·
  08-24-bestspot-s3-s7 · 08-26-{bestspot-*,sweep-*,gate-star-floor} · 08-27-bestspot-park
- **FORMAL VERIFICATION, Lean 4 + Mathlib (08-24d)** · `formal/` · `FORMAL_VERIFICATION` ·
  08-24-formal-verification
- **BRAND: PLUX is the product (08-25)** — a leak had shipped in every exported `.ics`, now fenced
  by `test/brandFence.test.ts`. No leaf; DECISIONS 2026-08-25.
- **RENDERING CHARTER RC0–RC30, CLOSED (08-25b→08-26d)** · `rendering/RENDERING_CHARTER_2026-08-25`
  + `FPV_FIDELITY_AUDIT_2026-08-22` · 08-25-* ·
  08-26-{rendering-charter-groupE,group-d-rc13-rc17,rc16-rc21}
- **REGION #4 Chernobyl built → DELETED (08-26b→09-02e)** — owner 2026-09-02c: Dnipro first; bakes,
  geoid grid and 1,785 R2 objects gone · 08-26-chernobyl-region
- **DBG chip, 151 metrics + 3 actions (09-01)** · `DEBUG_HUD_PLAN` · 09-01-dbg-hud
- **MESH SUITE planned + MS0–MS3 (09-01b→09-02g)** · `MESH_SUITE_PLAN` (§4a = the binding
  no-regression contract) · 09-01-mesh-suite-plan · 09-02-mesh-suite-{ms0-ms1,ms2,ms3}
- **MESH SUITE MS4–MS8 + T77 lead-in (09-02h→09-05)** · `rendering/ENGINE_STATE_2026-09-02` +
  `WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05` · 09-03-* · 09-05-model-pitch-roll-ms8 ·
  09-02-{mesh-suite-ms{4,5,5b,6},t77-engine-state-report}
- **T77 RENDERING PERF — MEASURE → phones → slice 0 (09-05b→09-06f, HOT, verbatim in DECISIONS)** ·
  `rendering/` `T77_AUDIT_PLAN_2026-09-05` · `MEASUREMENTS_2026-09-05`
  (§0 verdict · §7 CPU · §11 phones · §12 slice order) · `T77_SLICE0_ORBIT_FRAME_2026-09-06` ·
  09-05-t77-{audit-plan,measure} · 09-06-t77-phone-baseline-slice0
- **Docs + memory hygiene sweep (09-06g)** · 09-06-docs-hygiene
- **T77 RESUMED: catalogue + sweep, T80, slices A/B, the sunset fix (09-06h, HOT)** ·
  `rendering/SUNSET_LIGHTPATH_2026-09-06` · MEASUREMENTS §14 · 09-06-t77-resume-harness-sunset
- **T77 six worktrees: the crash, the retrace, the gates (09-06j/k/k2)** · MEASUREMENTS §15 ·
  09-06-t77-six-worktrees
- **T77 E1/E2 closed + T80-h fused bloom + T104 GPU-timer finding (09-06l, HOT)** · MEASUREMENTS §16 ·
  `mem:project/wip-2026-09-07-t77-e1-e2-t80h`
- **T77 the five rulings executed: T80/T104, T101, T92 done; T93 re-classified + fixed; T100 built, gate
  unmet → owner call (09-06n, HOT)** · MEASUREMENTS §17 · `mem:project/wip-2026-09-06-t77-five-rulings`
- **T100 CLOSED (a): the overlay's own extinction tail; the (b) band superseded; T105 (09-07a, HOT)** ·
  MEASUREMENTS §18 · `mem:project/wip-2026-09-07-t100a-overlay-tail`
- **T83 classified + the Pixel with terrain + lever 10 closed + T107 (09-07b, HOT)** · MEASUREMENTS §21 ·
  `mem:project/wip-2026-09-07-t77-phones-lever10`
- **T83 FIXED (lean caps, farm A/B) + compaction r6 + THE OCCLUSION AUDIT T108/T109 (09-07c, HOT)** ·
  MEASUREMENTS §22 · `audits/audit-occlusion-2026-09-07` · `mem:project/wip-2026-09-07-t83-pagehide-occlusion-audit`
- **THE OCCLUSION RULINGS: T110 fine bins · T112 best effort · T111 the skyline fold · T106 re-shaped
  (09-07d, HOT)** · MEASUREMENTS §23 · `mem:project/wip-2026-09-07-occlusion-rulings-t106`
- **T106 FIXED — the two-phase `load-model` handler, the flip bank under the phone caps (09-07e, HOT)** ·
  MEASUREMENTS §24 · `mem:project/wip-2026-09-07-t106-two-phase`
- **T106 READ ON THE PIXEL · the OSM handler's slow path + two-phase · the builders pooled · the phone
  traps (09-07f, HOT)** · MEASUREMENTS §25 · `mem:project/wip-2026-09-07-t106-pixel-read`
- **MOBILE ×2: BEST SPOT on `/m` (iPhone gate passed) + AR look-around (built, device tier = the owner's
  iPhone) + T116 the tree-seat float32 loop (09-07h, HOT)** · DECISIONS 2026-09-07h · backlog T116–T118 ·
  `mem:project/wip-2026-09-07-mobile-bestspot-ar`
- **T77 LEVER 11 (the vector-tile wire + parse worker) + T115 (the tree locate, resumable) + the tails
  T93/T102/T103/T114 (09-07j, HOT; the Pixel reads owed)** · MEASUREMENTS §26 · DECISIONS 2026-09-07j ·
  `mem:project/wip-2026-09-07-lever11-vtile-worker`
- **THE PIXEL READS (lever 11 + T115 hold) · the APP VERSION 1.36.1 · T119 the DBG grips · T118 the readiness
  hold + the status chip (09-08, HOT)** · MEASUREMENTS §27 · DECISIONS 2026-09-08 ·
  `mem:project/wip-2026-09-08-pixel-reads-version-t118`

## Graph index — every memory except the era leaves; names are under `.serena/memories/`
- top level: `mem:memory_maintenance` graph rules + caps · `mem:suggested_commands` commands ·
  `mem:task_completion` gate · `mem:tech_stack` deps · `mem:architecture/system-overview` engine
  + pipelines
- `decisions/` — `adr-000-locked-stack` 15 binding ADRs · `session_workflow` the persistence
  loop · `session-end-autoship` the ship hook + gates
- `patterns/` — `globe-rendering` the LEO globe · `photo-frustum` EXIF → frustum · `upload-flow`
  RAW worker · `members-pins` auth, quota, C6 tiers · `design-system` tokens · `sky-bodies-terrain`
  Phase-4 sky (ground half SUPERSEDED → ARCHITECTURE §7)
- `bugs/` — past defects, read before touching that area; all fixed but the last:
  `pin-arrival-reframe` · `fpv-walk-orbit` · `orbit-drag-after-fpv-edit` · `bldg-menu-right-release`
  · `comet-magnitude-model` · `gallery-thumbnail-stale` · `ground-checkerboard-flicker` **OPEN**
- `project/` non-leaf — `wix-platform` mechanics + TODO-VERIFY · `wix-site` URL/siteId/appId ·
  `dev_environment` · `audit2-2026-08-18-charter` ·
  `owner-orders-2026-08-14-qol-batch` · `wip-2026-09-06-docs-hygiene`
- The 126 `project/wip-*` leaves are the era archive, reached through the Era index.

## Source layout (verified 2026-09-06)
- `src/components/globe/` — the `client:only` three.js scene: `tuning.ts` (every tunable) · `scene/`
  35 attach-modules · `StylizedTiles.ts` orchestrator · `PhotoFrustum` · `Pins` · `flight` ·
  `explore` · `GlobeCanvas.tsx`. Design imports NEVER touch it (`conventions/globe-tuning.md`).
- `src/components/` — `panels|ui` desktop chrome · `mobile` the `/m` shell · `controls` shared input
  instruments (a pure leaf: react + stores + `lib/**` + `globe/tuning`).
- `src/lib/` — 19 entries, all real: decode (libraw-wasm worker), geo (+ `wmm.ts` since 09-07h),
  ephemeris, sky, globe, models, guide, pins, photo, export, market, save, wix, theme, format, api,
  textures, `sensors/` (09-07h — device orientation + the AR ladder, three-free), `prefs.ts`.
- `src/store/` 19 zustand stores · `src/pages/` `index.astro`, `m.astro`, `guide.astro`, layouts and
  11 thin `api/*` routes — no `src/backend/` · `public/` textures, data, guide shots · `test/` 164
  vitest files / 2,463 tests.

## Key invariants (violations = bugs)
- The globe is `client:only` — **never SSR WebGL** (C4). Decode runs in a **Web Worker**; free RAW
  buffers immediately. Astro **5** only.
- **Never fabricate a Wix API signature** — verify through Wix MCP. Endpoints stay thin, compute
  client-side (C1); backend admin calls need `elevate()`.
- Stylize tiles by material swap on `load-model`, **not** `BatchedTilesPlugin`
  (`scene/buildings.ts:32`); on ground tiles **chain** `onBeforeCompile` — TilesFadePlugin wrapped
  it.
- Globe and GL colour flow through `lib/theme/tokens.ts` (D14): colour maps sRGB, mask/elevation/
  normal data (`THREE.NoColorSpace`). Design imports write only under
  `src/components/panels|ui|controls/**` + `src/styles/**`.
- **C6 privacy:** a public pin never carries exact GPS — tiers exact / 1km / city, published at the
  geohash cell centre (`lib/geo/precision.ts`).
- Wix mechanics (no geo query → geohash `hasSome` + client refine; `elevate()`; TUS over 10 MB) are
  in `mem:project/wix-platform`. Marketplace + AI rules (C3 payout, JPEG-only vision) are in
  `PROJECT_SEED.md` §3 — no code today, Phase 7 parked.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) and §4 (ADR-000, D1–D15) are **binding**. `ARCHITECTURE.md` +
`IMPLEMENTATION_PLAN.md` are the execution source of truth, distilled from
`provenance/DEEP_RESEARCH.md`. Rules: `.claude/conventions/` (`wix-headless.md` = platform
mechanics). Workflow: the **`/frame`** skill.
