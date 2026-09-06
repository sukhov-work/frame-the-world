# wip 2026-09-07b — T83 classified · the Pixel WITH terrain · lever 10 closed · T107 fixed · T106 opened

Mode: implement (`/frame` under investigate-design-v3). Owner order: proceed with `NEXT_SESSION_PROMPT.md`;
the Pixel 6 Pro (serial 1C111FDEE006SD) attached over adb. 2026-09-07 01:10 → ~03:00 local (UTC+3). DONE.
Records: DECISIONS 2026-09-07b · MEASUREMENTS §21 · backlog T83/T98 amended, T106–T107 added · T77 plan pointer.

## Boot
- The a session's tree shipped at boot as PR #107 → master `c5dcd3a` (the hook fires on `/clear`; gates green).
- VPN IE · ion 401 · house Chrome :9333 · `wix dev` with `.vite` aside · pre sweep 13/14 (T103), sheets read.

## T83 — CLASSIFIED: a jetsam kill at WebContent's 2,048 MB per-process cap (MEASUREMENTS §21.1)
- `aws devicefarm list-artifacts --type FILE` works once a session is COMPLETED (STOPPING can take 10+ min).
  All four syslogs: `memorystatus: com.apple.WebKit.WebContent [pid] exceeded mem limit: ActiveHard 2048 MB
  (fatal) … killed by jetsam reason per-process-limit` — 2.9 GB of pages FREE (the cap, not pressure).
- The Appium log: every pose navigation (about:blank → pose) stayed in ONE WebContent, born at the first pose;
  ages at the kill 176 / 198 / 88 / 70 s; the kill 14–25 s after the SECOND `#f=` load, every time.
- Desktop twin `scripts/probe-memory-footprint.mjs` (new; `footprint <pid>`, `Runtime.getHeapUsage`, an
  in-page LRU + scene walk for geometry / decoded-image bytes; `--phone` = 17 Pro profile): one FPV page
  ~510 MB FLAT for 3 min (peak 592; images 146 MB = the 8k earth set, geometry 74, ArrayBuffers 137);
  DIRECT navigations fpv → /m → fpv stack the renderer 557 → 752 → 1,196 MB (926 after a forced GC,
  ArrayBuffers 130 → 260); with about:blank hops the renderer frees each document but the GPU process
  stacks ~470 MB per page load (838 → 1,781 MB) — destroyed pages' WebGL contexts linger.
- LEVER (not built): release on `pagehide` — `renderer.dispose()` + `forceContextLoss()`, `lruCache.unloadAll()`
  ×3, drop the 8k `texture.image`s; `Cache-Control: no-store` the blunt alternative. Users hit it on reload /
  route change, not on time in the FPV.
- Fifth session `9b042dcb-e2af-4631-9fa2-609747b0d27b` (`--poses fpv --ramp 0 --soak-min 3`): the SOAK
  RE-BOOTS the eye (a second load) — died 60–85 s in; stopped by hand at 23:16Z (a dead page stalls each of
  the soak's six `LOOK` calls 120 s → 12 min of billing per row). Syslog pending at session end.

## The Pixel — the owner caught the first run reading a bare sphere (§21.2)
- `adb reverse` carries only `localhost:4321`; the phone fetches ion over ITS network (Dnipro mobile →
  403). `visible gnd 0`, city/everest 317k tris = the base sphere (294k) — §11's 2026-09-05 Pixel
  city/everest/`/m` rows have the same signature: VOID. Fix in `verify-perf-baseline --device`: ion asked
  from the phone's page before the first boot (403 → exit 3) + a FAIL on any non-FPV cell with `gnd 0`.
- With the phone's VPN (exit FI): orbit 16.7 ms (gate off 119), city 16.8 (gate off 127; `frame.cpu` 15
  while streaming), everest 16.7 (gate off 155), fpv 21.5 (42 fps, GPU-bound; shadows on/off ±1 ms),
  `/m` 59.3 / cpu 57.6 (16 fps) → after T107 16.6 / 1.1 / tier mid.

## T107 — `controls.getPivotPoint` every frame (§21.4; FIXED)
- `probe-cpu-profile --pose m --device`: 87 % of the `/m` main thread under `stepMobile2dLocks` →
  `getPivotPoint` → `GlobeControls._raycast` → the terrain TIN's triangle loop (no BVH; the T79 gate arms only
  inside `_getPointBelowCamera`). Measured the live tilt BEFORE its own 0.2° deadband. The iPhone's 26 ms (§19)
  is the same call (unmeasured after the fix).
- Fix: deadband from `zc.getUpDirection(camera.position, _pivotUp)` (≤ 0.003° from the pivot's normal 300 m
  away); raycast only inside the correcting branch. `stepTiltGlide` had the same per-frame call (27–33 ms in
  every arrival frame of the desktop descent): pivot found once per glide into `_tiltGlidePivot`, refreshed
  every `CONTROLS.tiltGlidePivotRefreshMs` 500 (~100 ms per raycast on the Pixel — the cheaper pivot is a
  terrain BVH / DEM, lever 8). Desktop descent hitches 86 → 64, hitch main thread 3.08 → 2.31 s,
  `stepTiltGlide` 497 → 74 ms. `test/components/globe/mobile2dLocks.test.ts` (6 source pins + curvature bound).

## Lever 10 — CLOSED, not built (§21.3)
- `probe-cpu-profile --leg descent` (rewritten: buckets parse/compile/upload/seats/app/orchestrator/render/
  controls/gc/program/idle by a leaf→root walk; frames from in-profile MARKERS — 16 rotating named 0.7 ms
  spins, detect leaf-or-parent (`performance.now()` is the leaf), residue matcher with limited lookahead;
  bracket alignment was off by 165 ms–3.3 s; `--device`; nearest-app-caller tally).
- Desktop `high` hitch frames (86, 3.08 s): controls 24 % (`stepTiltGlide` 497, `rawHeightAt` 156) · seats
  16 % (`applyFeatureSeats` 424) + upload 12 % (`bufferSubData` 384 at draw — the seats' rewrites) · app 13 %
  (`buildings.ts:110` load handler / `EdgesGeometry` 143, vector tiles 90) · render 12 % · orchestrator 7 % ·
  compile 2.6 % (two frames, 57 + 16 ms) · **glTF parse 0.7 %** (whole leg 1.0–1.3 %, mostly async
  `createImageBitmap`). §20's "every hitch is parse-phase" = the trigger, not the time.
- Pixel, same leg: dt p95 317 / max 849; 57 hitch frames, 6.73 s: `enrichedBuildings.ts` `load-model`
  (served line 423 → source 1187+) **2,261 ms**, `enrichedMask` `vertexKeyToRunWithCollisions` 522 +
  `mapSegmentsToRuns` 282, OSM load handler 325, vector tiles 202, `stepTiltGlide` 394 (3–4 × ~100 ms),
  `rawHeightAt` 291, parse 91 (1.4 %) → **T106**: bake the runs/fingerprints into the sidecar or slice the
  handler per frame; `parseVectorTile` to a worker.

## Gates: vitest 2,767/2,767 (176) · astro 0/0/11 · knip 0 · post sweep post-2026-09-07b (see DECISIONS).
## Traps learned
- A hash-only `Page.navigate` does not reload (the first memory sequence had 3 documents, not 6).
- `Page.backForwardCacheNotUsed` fires only for HISTORY navigations.
- The perf harness's gateOff cell demotes the governor for the rest of the boot on a phone (noUpdate/off cells
  then read at `low`) — read the `.on` cell.
- DECISIONS §Recent is 137 KB → compaction round 6 FIRST next session.
