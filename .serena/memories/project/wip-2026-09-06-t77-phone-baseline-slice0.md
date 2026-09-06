# T77 step 1b (PHONE BASELINE RUNS) + slice 0 (THE ORBIT FRAME, T79) — 2026-09-06 — DONE

Mode: implement (`/frame` Fix/Implement under investigate-design-v3 governance). Status: DONE (T79 CLOSED; T80 next, owner call first).
Plan source: `.claude/claude-docs/NEXT_SESSION_PROMPT.md` (STEP 1 phone runs → STEP 2 slice 0 T79/T80).

## Established at boot
- Previous session's ship landed as PR #101 (`e7331a6`) while this session booted; checkout back on master.
- Pixel 6 Pro attached over adb (serial `1C111FDEE006SD`, Android 16, Chrome 152.0.7977.75; CDP answers on
  :9444 after `adb forward tcp:9444 localabstract:chrome_devtools_remote`; `adb reverse tcp:4321 tcp:4321` done).
  The phone was DOZING (screen off) at boot — wake + keep awake before the harness.
- AWS profile `plux` present (names only read). Chrome CDP :9222 up (owner's instance — never kill).

## The Device Farm iPhone 17 Pro runs (2026-09-06, all via `tools/devicefarm/ios-baseline.mjs`)
- **Tunnel trap:** `cloudflared tunnel --url` defaults to QUIC, which this network blocks ("failed to
  dial to edge with quic") → HTTP 530 through the tunnel. `--protocol http2` fixes it. Host changes per
  restart → `wix dev --allowed-hosts <new host>` must be restarted (Vite answers 403 for a foreign Host).
  `astro check` ran BEFORE `wix dev` (0 errors / 0 warnings / 9 hints).
- **Two tool bugs found and fixed:** (1) `BOOT_MARK` was a statement list wrapped in `return (…)` →
  JavaScriptCore "Expected ')' to end a compound expression" → now a comma expression; (2) `OUT_DIR`
  was cwd-relative `../../verify-shots/perf` → wrote OUTSIDE the repo → now `fileURLToPath(new URL(…,
  import.meta.url))`. Plus hardening: `connectionRetryCount: 0`, a stalled-debugger classifier in
  `boot()` (`pageUnresponsive`), repeated pose keys (`fpv,fpv` → `fpv#2`), the ramp records an
  unresponsive boot as its kill-class event, no `deleteSession` on a dead page.
- **Session billing:** sessions bill from allocation, ~8–10 device minutes even when stopped within a
  minute of RUNNING (attempt 1: 8.46 min, attempt 2: 9.75 min). Budget used so far ≈ 18 min + farm1
  attempt 3 (~25 min) + farm2.
- **farm1 (session `19deb1e4-67fe-435e-8ad1-cecddd6a8d78`) — the five poses READ on the device**
  (JSON `verify-shots/perf/devicefarm-farm1-2026-09-05T22-32-34.json`): classifications (1) tunnel
  served wix dev ✓ (2) Safari accepted `{platformName iOS, appium:automationName XCUITest, browserName
  Safari}` ✓ (3) `__debugFeed.snapshot()` read ✓ (4) boot marker survived every pose read ✓ (7)
  `gpu` absent, no `performance.memory` (WebKit facts) ✓. `screen 414×896` css px, `inner 402×714`,
  `devicePixelRatio 3`, `hardwareConcurrency 4`, coarse pointer → deviceTier `mid`, lean, DPR 1.25,
  shadow 1024 px, bloom off, `Apple GPU`.

  | pose | tier (gov.) | dt p50/p95/max ms | cpu p50 | draw | calls | tris | tex/geo | LRU bld/gnd/enr MB | models |
  |---|---|---|---|---|---|---|---|---|---|
  | fpv | mid | 17 / 17 / 17 (60 Hz cap) | 2 | 2 | 390 | 1.65 M | 119/284 | 4/47/37 | 3 resident |
  | orbit | low (demoted) | 91 / 112 / 207 | **84** | 1 | 109 | 740 k | 65/117 | 5/27/6 | 3 |
  | city | low | 97 / 200 / 278 | **91** | 1 | 158 | 602 k | 77/673 | 7/49/121 | 0 |
  | everest | low | 79 / 99 / 230 | **74** | 0 | 49 | 370 k | 36/65 | 0/31/0 | 0 |
  | /m | low | 111 / 130 / 264 | **105** | 0 | 28 | 324 k | 16/37 | 0/78/0 | 0 |

  **Verdict:** the FPV eye is fine (60 fps cap, 2 ms CPU); EVERY orbit pose is 9–12 fps and
  CPU-bound in the controls' down-raycast (T79) — 74–105 ms per frame on the A19, and the governor's
  demotion to `low` did nothing for it (a controls-bound frame ignores DPR). T79 is THE mobile lever.
  Boots 7–11 s, settle 13–27 s.
- **The kill ramp did not classify:** at N=6 seeded (+3 world = 9 helmets) the FPV reload made
  Safari's remote debugger stop responding (120 s × WebdriverIO's 3 retries, then the same on
  `deleteSession`) — kill vs JS hang UNKNOWN; the console session video decides. The tool was killed
  by hand; the 6 seeds were removed via the journal (`seeds-farm-2026-09-05T22-32-34.json`, all
  `deleted:true`) and the session stopped by hand.
- **farm2** (`--poses fpv,fpv --ramp 6 --soak-min 8`) launched 22:51 UTC to separate "second `#f=`
  boot in one Safari session" from "models" as the stall trigger, then the soak. Result: (pending)

## T79 design (dependency-free, EXACT — no owner call needed; drafted in the scratchpad, not yet in src)
- The callers of `_getPointBelowCamera` (3d-tiles-renderer 0.4.28 `EnvironmentControls.js`): `update`
  :995 and `adjustCamera` :1059 consume ONE bit — `hit.distance − 1e5 (− actionHeightOffset) <
  cameraRadius` (then push by the difference); `_updateZoom` :1371 scales by the exact distance.
  `GlobeControls._raycast` falls back to the ELLIPSOID (`useFallbackPlane = false`). `TilesGroup.raycast`
  routes into `raycastTraverseFirstHit` (tile bounding volumes) — the cost is the TRIANGLE loop of the
  tiles under the ray (enriched soups, the Everest TIN, terrain TINs), not the traversal.
- The fix: `lib/globe/belowCameraGate.ts` wraps `THREE.Mesh.prototype.raycast` once; while ARMED
  (only inside the subclass's `_getPointBelowCamera`) a mesh whose position-attribute AABB (cached
  per geometry by `(version,count)` in a WeakMap — never `geometry.boundingBox`, seats rewrite
  positions) tops out below `camera − (cameraRadius + actionHeightOffset + margin)` returns before
  the triangle loop. `scene/pluxGlobeControls.ts extends GlobeControls`: arms the gate for the two
  per-frame calls, routes `_updateZoom` (flag) and any pose where the ellipsoid itself is inside the
  band to the untouched library path. Skinned/morphed meshes never skipped. DEV seam
  `__globe.belowCameraGate(enabled?)` → counters (gated/exact/seen/skipped/boxesBuilt/lastMs).
- Tests drafted: a 400-scene property test (gated vs ungated push decision + identical hit), the
  pieces, install/uninstall; library source pins (the private names) + routing tests with a Dnipro rig.
- Alternatives rejected for THIS slice: terrain-only `setScene` / layers mask (changes rooftop
  clearance — owner call), memoised `heightAt` (not the rendered mesh), `three-mesh-bvh` (new dep,
  worker build, arrival hitches — plan lever 8 stays for seats/streaming).

## THE T79 ATTRIBUTION CORRECTED (`scripts/probe-below-camera.mjs`, desktop M3 Pro, 2026-09-06)
Per scene object, the controls' down-ray (`intersectObject(child, true)`, 5 reps), ms per call:
| pose | whole call | base-earth sphere (294,144 tris, 384 segs, 1.9 km sunk) | enriched TilesGroup | OSM bld TilesGroup | terrain TilesGroup |
|---|---|---|---|---|---|
| orbit | 21.0 | **15.9** | 3.1 (85 k tris / 11 meshes) | 2.1 (79 k / 10) | 0.02 (hit) |
| /m | 12.1 | **12.1** | — | — | 0.02 (hit 133 m) |
| everest | 15.0 | **14.8** | — | 0.14 | 0.06 (hit 7.6 km) |
| city | 18.7 | **15.2** | 0.04 (2.59 M tris culled by the tile traversal) | 3.6 (174 k / 23) | 0.06 |
× 2 calls/frame = the 31–47 ms MEASURE saw. **MEASUREMENTS §7's "7.7 M-vertex enriched soup" was
the wrong culprit: ~75 % is `baseEarth.ts:183` `SphereGeometry(1, EARTH.segments=384, 384)` with a
LIVE default raycast** (every other backdrop sets `raycast = () => {}`); the tile traversal
(`raycastTraverseFirstHit`) already culls terrain well; the OSM/enriched tile scenes under the ray
are the remaining 3–6 ms. The gate's box bound kills the tile scenes; the sphere's AABB and bounding
sphere both reach 9–11 km ABOVE the camera at 48° N (diagonal `up`, equatorial radius), so the gate
grew an O(1) ellipsoid-support bound for `SphereGeometry` and a cached vertex-support scan as the
general third bound. Owner-call alternative: `baseEarth` `raycast = () => {}` (changes pointer picks
through tile gaps and the controls' floor over unloaded areas from "1.9 km deep" to the ellipsoid —
a correction, but a behaviour change).

## farm2 / farm3 (iPhone): the FPV page dies 40–60 s after load regardless of models
farm2 (`fpv,fpv --ramp 6`): the second `#f=` boot in one Safari session read fine (dt 17, cpu 2);
the ramp boot with 6 seeded + 3 world helmets booted (seams answered, marker set) then went silent
inside the 20 s wait. farm3 (`fpv --soak-min 8`, 0 seeds): the pose read fine at 41 s, the soak's
re-boot settled, then the page went silent during the synthetic look-around (~50 s after load).
Every later Appium command stalls 120 s. So: NOT the models, NOT the second boot — the FPV page on
the 17 Pro lives ~40–60 s. Hypothesis [OPEN]: a jetsam kill when a late background load lands
(`baseEarth.ts` S5 8k texture swap ≈ +250 MB GPU; or the streaming LRU) — the Device Farm console
session video + device syslog (sessions `19deb1e4-…`, `c90c3fd4-…`, and farm3's) decide; the Pixel's
`performance.memory` curve is the cross-check. Device minutes used ≈ 78 of the 1,000 trial.

## Pixel 6 Pro (adb) — RUNNING `verify-perf-baseline.mjs 9444 --device --quick`
Trap: Android Chrome answers `PUT /json/new` with "Could not create new page" → the harness now
attaches to the phone's existing `localhost:4321` tab in `--device` mode (never closes phone tabs).
First cells: fpv dt 27.5/81.9 (30 fps, cpu 1.3, draw 2.8, heap 202 MB, Mali-G78, 223 calls, 1.47 M
tris — GPU-bound); orbit dt 80.6 (12 fps, cpu 77.9 — controls-bound, the same T79).

## Pixel 6 Pro quick run DONE (15 cells / 0 failures, 6 min; `verify-shots/perf/baseline-pixel6pro-dsf2-2026-09-05T23-13-05.{json,md}`)
fpv 27.5/81.9 ms (30 fps, cpu 1.3, GPU-bound; shadows off → 22.1) · orbit 80.6 (12 fps, cpu 77.9) ·
city 79.8 (cpu 78.4) · everest 88.2 (cpu 85.9) · /m 100.6 (cpu 108.8). `performance.memory` QUANTIZED
(202 MB every cell). bld/gnd LRU columns read 0 on the device path (T86). Governor mid→low everywhere
but FPV. NOT run: `--shimmer`, cpu profile on the phone.

## T79 BUILT + RECEIPTED (2026-09-06d)
Files: `src/lib/globe/belowCameraGate.ts` (new) · `src/components/globe/scene/pluxGlobeControls.ts`
(new) · `tuning.ts` `CONTROLS.belowCameraGateMarginM 0.5` · `StylizedTiles.ts:1089` `new
PluxGlobeControls(...)` (+ import; `GlobeControls` import dropped) · tests `test/lib/globe/belowCameraGate.test.ts`
(9) + `test/components/globe/pluxGlobeControls.test.ts` (6) · harness `verify-perf-baseline.mjs`
(`gate` field on `on` cells + `gateOff` A/B cell, `--no-gate-ab`; DEVICE attach drives the phone's
tab) · `scripts/probe-below-camera.mjs` (new) · `verify-rendering-charter.mjs` RC3/4 sweep pinned to
`&t=1787133600000` (a bare `#f=` reads the real clock — at 02:45 local the rig is off → 5 FAILs on
time of day, not the gate). Docs: `rendering/T77_SLICE0_ORBIT_FRAME_2026-09-06.md`, MEASUREMENTS §7
correction + §11 rewrite, contracts §3 seam, backlog T79 BUILT / T77 pointer / T83–T86, DECISIONS
2026-09-06d, NEXT_SESSION_PROMPT head rewritten, `.claude/.ship-title`.
Gates: vitest 2,463/2,463 (164) · astro 0/0/9 · knip 0 · perf `--quick --label t79` 32 cells / 0
failures: orbit dt 44.5→18.1 cpu 43.3→1.2 · ULTRA orbit 44.3→21.0 · everest 32.2→17.9 · /m
35.8→12.1 (T84 residual) · city 49→37 (GPU-bound) · fpv unchanged. Gate counters: skipped == seen at
every pose, exact 0. Property test: 400 scenes, all three bounds exercised.
Design facts worth keeping: the callers consume ONE bit (`dist < cameraRadius`); the ellipsoid
pre-check keeps the fallback corner exact; `_updateZoom` needs the exact distance (flag); a
SphereGeometry's AABB/bounding sphere are useless against a diagonal `up` → the analytic ellipsoid
support; the vertex scan is a TIGHTER bound than the analytic support (a 64-seg sphere sags ~1 km at
Dnipro; 384 segs ~200 m); `baseScale` is (A, B, A) with `rotation.x = π/2`.

## Where things stand (end of session 2026-09-06e)
DONE. Harness list green against the gated build: charter 85/85 (RC3/4 sweep now pins `&t=1787133600000`
— it read the real clock and failed at night) · ultra 28/28 · meshedit PASS · usermodels 21 · cab 65/65 ·
pin-reframe RED = T76 pre-existing. Final gates vitest 2,463/2,463 · astro 0/0/9 · knip 0. T79 CLOSED
(backlog dated edit), T83–T86 opened, DECISIONS 2026-09-06d + e, `rendering/T77_SLICE0_ORBIT_FRAME_2026-09-06.md`,
MEASUREMENTS §7 correction + §11 rewrite, checklist §B0, devicefarm README status, contracts §3 seam, core
Next step + era index row. `wix dev` and the tunnel stopped; the Pixel's stay-awake restored to 0;
no Device Farm session left RUNNING (verified via `list-remote-access-sessions`). `.claude/.ship-title` written.
NEXT (owner order 2026-09-06f): a ONE-SESSION docs + memory hygiene sweep + the guide gap FIRST (charter in NEXT_SESSION_PROMPT §"THE NEXT SESSION"; T87), THEN T80 bloom — the owner's ruling on pixels at `high` first (ULTRA-first otherwise) — then slice A. T77 is PARKED via the dated pointer atop `rendering/T77_AUDIT_PLAN_2026-09-05.md`.
Open owner calls: T80 pixels · T85 `baseEarth` raycast noop · (unused) the rooftop-clearance lever.
