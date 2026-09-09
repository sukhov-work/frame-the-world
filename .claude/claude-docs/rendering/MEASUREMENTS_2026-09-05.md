# MEASUREMENTS 2026-09-05 — T77 step 1: the rendering baseline (desktop)

**Status:** step 1 of `T77_AUDIT_PLAN_2026-09-05.md` §3 executed on the owner's M3 Pro (headed
Chrome 152 on :9222, the owner's persistent warm profile, `wix dev` DEV build, 1600×950 logical
at deviceScaleFactor 2 unless stated — 120 Hz ProMotion display, so a `dt` of 8.3 ms is the vsync
floor, not a measurement of headroom). Every number below was READ by a script off a seam that
exists; nothing is transcribed from a screenshot or a memory. The raw artefacts are gitignored
(`verify-shots/perf/baseline-warm-dsf2-<stamp>.{json,md}`, `temporal-warm-<stamp>.json`,
`cpu-<pose>-<stamp>.cpuprofile`); this file is their reading. **The phone (step 1b) did NOT run —
§11 says what was prepared and what stays UNKNOWN.**

The verdict is in §0; the ESTIMATED → MEASURED ledger in §10; the slice order in §12.

## 0. Verdict

Nine readings, none of which existed yesterday, and three of them reorder the plan:

1. **Every `#p=` (orbit) pose is CPU-bound in the CONTROLS, not in rendering.** `frame.cpu` (the
   orchestrator bracket) is 31–47 ms per frame at a STATIC orbit pose at every tier — `low` with
   88 draw calls reads 39 ms, the same as `high` — while the FPV pose reads 2 ms. The V8 profile
   attributes 84 % of the main thread to one call chain: `stepControlsUpdate → GlobeControls.update
   → adjustCamera → _getPointBelowCamera → _raycast → raycaster.intersectObject(scene, recursive)`
   (`3d-tiles-renderer` 0.4.28 `EnvironmentControls.js:995/1059/1461/1739`; three's brute-force
   `Mesh.raycast` — `getVertexPosition` 32 %, `checkGeometryIntersection` 24 %, `intersectTriangle`
   24 %). The controls were constructed with the WHOLE scene as their raycast target
   (`StylizedTiles.ts:1086` `new GlobeControls(scene, camera, …)`), and `adjustHeight` fires that
   full-scene down-raycast every frame — through the 7.7 M-vertex enriched soup, 39k stock prisms,
   trees and models — with no BVH. This is a lever the plan did not have (its nearest is #8,
   `three-mesh-bvh`, ranked for `heightAt`); it is the largest measured cost in the engine.
2. **Bloom is the largest GPU consumer, by a wide margin.** `UnrealBloomPass` off: −13.3 ms GPU at
   the Dnipro FPV eye (25.1 → 11.8), −21 ms at the orbit pose, −22 ms at Everest, −14 ms at the
   city, −25 ms under ULTRA — one third to two thirds of the GPU frame at DPR 2. The plan ranked
   "half-res, fewer-mip bloom" 16th (S). The numbers rank it first among GPU levers.
3. **Shadows are cheap everywhere except the city pose.** The depth pass (skipped via
   `autoUpdate=false`) costs 0.5 ms GPU / 1.7 ms frame at the FPV eye on the base rig, 6 ms GPU
   under ULTRA (8192² + two cascades), and 14 ms GPU at the 26-km city view (718 draw calls and
   6.7 M triangles go into the map). Everything the shadow slice A exists for (the shimmer, §8) is
   a QUALITY defect, not a frame-time one — the slice's budget is real but its motivation is stability.
4. **The shimmer is measured and it is not the sun.** With the camera frozen and the sun stepped an
   exact 0.0083°/frame, 18.5 % of the shadow-mask pixels FLIP every frame at the FPV eye (city
   ULTRA 11.6 %, Everest ULTRA 7.7 %), 53–75 % of the flips are isolated pixels, and a 4× sun rate
   raises the churn only ×1.24–1.64 — the change is dominated by a rate-independent
   re-rasterisation component, exactly the "no texel snap / per-frame re-fit" mechanism ENGINE_STATE
   §2.4 argued. The frozen control leg is EXACTLY zero at two poses (the frame is deterministic) and
   catches the ULTRA cascade refresh at the city pose (`cascadeMaxStaleMs` 1500: 18 pop frames in
   239). These are the baselines slice A must beat.
5. **Seats never settle, and the ease STALLS 8.3 cm off target by construction.** The apply pass
   writes a seat delta only when `|next − applied| ≥ 0.01` and eases at `reseatEaseK` 0.12 per
   frame, so any residual below 0.01 / 0.12 = **0.0833 m is never written again** — the near-cell
   residual reads exactly 0.083 m at the end of every leg, and a 1 cm settle bar is unreachable by
   design (`enrichedBuildings.ts` `applyFeatureSeats`; `seatStep`). Around that floor: at the orbit
   arrival 130 terrain-epoch bumps (1.9/s) in the first 430 frames each re-armed every target; the
   city-wide residual peaked at 119 m (104 poisoned-pair rejections); after the last bump the writes
   stopped within ~50 frames. At the FPV eye the sweep never rests: seat writes in **98 % of
   frames for 70 s**, 41 features per frame, 1,210 rejections, city-wide residual p95 30 m at the
   end — the round-robin and the plausibility gate fight indefinitely. "Reseat off-cone takes tens
   of seconds" (§12 CONTESTED) is refuted in one direction and confirmed in the other: the look-cone
   is quiet ~50 frames after streaming quiets, but the CITY never converges at the FPV pose.
6. **24 realistic user models cost nothing measurable on desktop.** 24 resident DamagedHelmets
   (15,452 tris, five 2048² textures each): frame 23.1 → 22.7 ms, GPU 25.1 → 24.3, +19 draw calls,
   +17 textures (the loader shares a URL's textures), +17 MB heap at the FPV eye; at the orbit pose
   +5 ms of CPU — the controls' raycast now walks 24 more meshes. MESH_SUITE_PLAN §12's "texture
   VRAM is the first cliff, then draw calls × the shadow pass" is REFUTED at the 24-model count cap.
7. **ULTRA costs 5–12 ms of GPU** on top of the base rig (FPV 25.1 → 31.2; orbit 36 → 44; city 61
   → 66; Everest 35 → 42), of which the depth pass is 6–7 ms and the rest is the 8192² sampling.
8. **The ground LRU sits at its cap (410 MB) at every Dnipro pose**, the enriched LRU at 73–207 MB,
   the imagery composite count at 254–452; the city pose streams **3,300 ground tiles** through the
   download queue and needs 63–68 s to quiet at DPR 2. JS heap: 400–490 MB at the FPV eye, 840–920
   MB at the city view, 100 MB on `/m`. These are the device-free memory proxies for the phone.
9. **The `/m` chart at a phone-like tier is ALSO controls-bound**: 9 draw calls, 1.4 ms GPU, and 36–39
   ms of orchestrator per frame — the same full-scene raycast, on a 2D chart.

**Slice order:** the numbers supersede §1's ranking (recorded in §12): a new slice **0 — the orbit
frame** (the controls' raycast target, then bloom) ships before shadows; slice A (shadows) keeps its
place as the FIRST QUALITY slice with the shimmer baseline as its gate; slice B (seats) gains the
stall floor and the epoch churn as measured defects with numbers to beat.

## 1. Instruments (built this session; READ-ONLY on the engine — two DEV read seams, no behaviour)

| Instrument | What it reads | Where |
|---|---|---|
| `scripts/verify-perf-baseline.mjs` | the §3 matrix: per BOOT (pose × ULTRA pref × device tier × resident models) → per SAMPLE (shadows on / depth pass skipped / shadows off; with `--post-ab` GTAO off / bloom off): a 10 s in-page rAF window with the HUD CLOSED (frame dt p50/p95/max, `__renderer.info` calls + triangles per frame — whole-frame truth, `autoReset` off, one reset per frame — governor EMA + hitches, RC21 gate draws/skips, JS heap, `renderer.info.memory` geometries/textures/programs) then a 6 s window with the DBG FEED ACTIVE but NO panel mounted (`frame.cpu` = the orchestrator bracket, `frame.draw` = the submit bracket, `frame.gpu` = `EXT_disjoint_timer_query`, every provider snapshot: tiles lruMB/inCache/visible/queues, composites, terrain epoch + memo, buildings deferred/rejected/seatEpoch, models, ultra.shadow.*). Cumulative counters are differenced over the window. Structural asserts per cell: ≥ 60 frames · gate off + zero skips · the tier held for the whole window · N models resident + none skipped. | `scripts/verify-perf-baseline.mjs` (fenced by `test/verifyHarness.test.ts`) |
| `window.__debugFeed` | the DBG feed's READ seam: `snapshot()` flattens every provider + the six series' statistics; `read(id)`, `series(id)`, `setActive(on)`. DEV always; runtime-gated (the `debugHud` pref at boot) everywhere else — the phone's console read. | `lib/globe/debugFeed.ts` `publishDebugFeedSeam` · `lib/globe/debugBoot.ts` · `GlobeCanvas.tsx` · `src/global.d.ts` · contracts §3 |
| `__globe.seatSettle()` | the reseat-settle seam: this frame's seat residuals from `applyFeatureSeats()` (`maxResidualM`, `movedFeatures`, the look-cone `near*` twins, epoch, quietFrames, deferred, rejected) + `frameCount` + `terrainEpoch`. Two compares per feature inside the pass that already visits every feature; allocation-free. | `scene/enrichedBuildings.ts` · `StylizedTiles.ts` |
| `scripts/verify-temporal-stability.mjs` | the two metrics ENGINE_STATE §8 lacked: **shimmer** (a screen-space shadow mask by `shadow.intensity` A/B inside one rAF, XORed frame to frame under a `setTime` sun scrub at an exact °/frame; a frozen control leg; a 4× rate leg) and **reseat-settle** (frames from arrival / drag / model load until the near seats are < 1 cm and quiet for `PLAN.reseatQuietFrames`; the city-wide curve reported). | `scripts/verify-temporal-stability.mjs` |
| `scripts/probe-cpu-profile.mjs` | V8 sampling profile (250 µs) of a settled pose → self time by file and by function, inclusive time of the named roots; writes a `.cpuprofile` for DevTools. | `scripts/probe-cpu-profile.mjs` |
| `scripts/t77-model-ramp.mjs` | the phone kill ramp's seeding tool (`to N` / `clear`, journaled). | `scripts/t77-model-ramp.mjs` |

**How the matrix's axes were realised (each an existing seam, cited):**
- ULTRA on/off — the persisted pref `ftw:view-prefs:v1`.ultraQuality written by a `Page.addScriptToEvaluateOnNewDocument` before boot (the 8192² map and the cascade ladder are construction-time, `GlobeCanvas.tsx:141-154, 278-283`).
- Device tier — `navigator.hardwareConcurrency` overridden before boot (2 → `low`, 4 → `mid`; `quality.ts detectDeviceTier`): shadow map size and `shadowMap.enabled` are boot-latched from the DEVICE tier; the governor was then PINNED in-page (its `step` re-forces the tier) right after the seams appeared, so a boot stream's EMA (100–160 ms in the first seconds at a heavy pose) cannot demote the tier and a later re-force cannot replay the tier's renderer half (a DPR realloc + a fresh-instance rebuild of every composite) inside the window. `tierLog` deltas are asserted 0 per window.
- Shadows — `on` as booted · `noUpdate` (`renderer.shadowMap.autoUpdate=false`: the depth pass is skipped, the stale map still sampled → the PASS cost) · `off` (`renderer.shadowMap.enabled=false`: one recompile, then no shadow work → the WHOLE shadow cost). `__quality.force("low")` does NOT turn shadows off (device-tier latch) — the plan's "tiers forced" alone could not have produced this axis.
- Models — `/api/dev-seed kind:"model"` rows (DEV-gated, row-only, no member session) at the Khronos **DamagedHelmet** GLB (3,773,916 B, 15,452 tris, one mesh, five 2048² JPEG textures — under every `MODEL_CAPS` rail), placed on a ring 20–60 m around the FPV eye, seeded BEFORE the boot; N is the TOTAL resident count (the world already held **3 real member models** resident near the eye, so N=6 seeded 3 and N=24 seeded 21); every row removed in `finally` (journal `verify-shots/perf/seeds-<stamp>.json`). `dev-seed` accepts any https URL (`dev-seed.ts:147-157`), so the one-time upload the plan asked for was unnecessary for the baseline; a stored `static.wixstatic.com` URL is one `--glb` away when the CDN path itself is the question.
- Poses — cited verbatim from their owning harnesses. **The `verify-ultra` Dnipro pose `#p=48.464,35.046,900,74,300` is, by the hash grammar (`urlPose.ts`: lat,lon,alt,HEADING,TILT), heading 74°, tilt 300° → clamped 88°: a near-horizontal view of the city from 900 m with the camera ~26 km back.** It is kept as written (the plan says cite, do not invent) and named `city`; because `MODELS.loadRadiusM` is 3 km from the CAMERA, no user model is resident there, so the model ramp runs at the `verify-usermodels` ORBIT pose `#p=48.4647,35.0462,700,25,40` (`orbit`, camera ~0.9 km from the eye) as well as at the FPV eye.

## 2. The matrix (warm profile, dsf 2; `verify-shots/perf/baseline-warm-dsf2-2026-09-05T19-56-33.md`)

Cell id = `pose.u<ULTRA pref>.<device tier>.m<resident models>.<shadow mode>`; shadow modes: `on`
(as booted) · `bloomOff` (bloom pass trapped off) · `noUpdate` (depth pass skipped, stale map
sampled) · `off` (`shadowMap.enabled=false`, recompiled) · `offBoot` (tier `low`: no shadows at
boot). Columns: `dt` = rAF-to-rAF; `cpu` = the orchestrator bracket (`tilesHandle.update()`);
`draw` = the submit bracket (`composer.render()` + PiP, wall-clock); `gpu` = `EXT_disjoint_timer_query`
over the draw block (a few frames late); `calls`/`tris` = whole frame (shadow + composer + PiP);
`hitches` = raw frames > 50 ms inside the 10 s window; rates are per second over the window. The
display is 120 Hz — `dt` 8.3 ms is the vsync floor. Settle = time to two quiet seconds on the u5()
queues (`!` = capped). 81 + 12 cells, 46 min of wall time.

| cell | tier (dev) | dpr | shadow px | models res/world | settle s | fps | dt p50 / p95 ms | cpu p50 | draw p50 | gpu p50 | calls | tris | heap MB | geom / tex / prog | bld/gnd/enr lruMB | visible bld/gnd/enr | composites | terrain epoch/s | memo hit·miss /s | deferred/rej /s | seatEpoch/s | hitches |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fpv.u0.high.m0.on | high (high) | 2 | 4096·cast | 3/3 | 2.0 | 43 | 23.1 / 24.8 | 2.1 | 4.9 | 25.1 | 820 | 3,051,216 | 472 | 544 / 228 / 31 | 9/411/73 | 31/239/101 | 409 | 0.00 | 4187·730 | 0.0/0.0 | 43.4 | 0 |
| fpv.u0.high.m0.bloomOff | high (high) | 2 | 4096·cast·bloom off | 3/3 | 2.0 | 66 | 15.1 / 16.8 | 2.0 | 4.4 | 11.8 | 807 | 3,051,203 | 430 | 544 / 228 / 31 | 9/411/73 | 31/239/101 | 409 | 0.00 | 6749·752 | 0.0/0.0 | 66.1 | 0 |
| fpv.u0.high.m0.noUpdate | high (high) | 2 | 4096·cast·noUpd | 3/3 | 2.0 | 47 | 21.4 / 23.6 | 2.5 | 3.8 | 24.5 | 615 | 1,686,994 | 414 | 544 / 228 / 31 | 9/411/73 | 31/239/101 | 409 | 0.00 | 4986·328 | 0.0/0.0 | 45.7 | 0 |
| fpv.u0.high.m0.off | high (high) | 2 | 4096·cast·OFF | 3/3 | 2.0 | 47 | 21.1 / 22.8 | 2.5 | 3.7 | 24.5 | 615 | 1,686,994 | 411 | 544 / 228 / 31 | 9/411/73 | 31/239/101 | 409 | 0.00 | 5120·262 | 0.0/0.0 | 45.7 | 0 |
| fpv.u0.mid.m0.on | mid (mid) | 1.5 | 2048·cast | 3/3 | 9.4 | 66 | 15.1 / 16.1 | 1.8 | 4.4 | 15.0 | 942 | 2,950,605 | 467 | 636 / 339 / 31 | 6/112/73 | 21/329/101 | 442 | 0.00 | 6370·1149 | 0.0/0.0 | 66.3 | 0 |
| fpv.u0.mid.m0.bloomOff | mid (mid) | 1.5 | 2048·cast·bloom off | 3/3 | 2.0 | 90 | 11.2 / 11.9 | 1.7 | 4.2 | 7.3 | 929 | 2,950,592 | 499 | 636 / 339 / 31 | 6/112/73 | 21/329/101 | 442 | 0.00 | 9371·825 | 0.0/0.0 | 87.9 | 0 |
| fpv.u0.mid.m0.noUpdate | mid (mid) | 1.5 | 2048·cast·noUpd | 3/3 | 2.0 | 71 | 14.0 / 15.4 | 1.9 | 3.4 | 14.8 | 747 | 1,638,322 | 536 | 636 / 339 / 31 | 6/112/73 | 21/329/101 | 442 | 0.00 | 7685·426 | 0.0/0.0 | 67.2 | 0 |
| fpv.u0.mid.m0.off | mid (mid) | 1.5 | 2048·cast·OFF | 3/3 | 2.0 | 72 | 13.9 / 15.0 | 2.0 | 3.4 | 14.8 | 747 | 1,638,322 | 403 | 636 / 339 / 31 | 6/112/73 | 21/329/101 | 442 | 0.00 | 7989·220 | 0.0/0.0 | 52.8 | 0 |
| fpv.u0.low.m0.offBoot | low (low) | 1.25 | 1024·cast·OFF | 3/3 | 6.4 | 120 | 8.3 / 9.1 | 2.4 | 1.5 | 5.2 | 515 | 1,609,831 | 414 | 473 / 175 / 20 | 5/66/69 | 18/191/101 | 258 | 0.00 | 11858·1762 | 0.0/0.0 | 120.1 | 0 |
| fpv.u1.high.m0.on | high (high) | 2 | 8192·cast | 3/3 | 17.9 | 35 | 28.4 / 30.6 | 2.1 | 6.0 | 31.2 | 1,087 | 3,113,969 | 453 | 613 / 286 / 36 | 10/454/73 | 36/293/101 | 452 | 0.00 | 3353·652 | 0.0/0.0 | 35.3 | 0 |
| fpv.u1.high.m0.bloomOff | high (high) | 2 | 8192·cast·bloom off | 3/3 | 2.0 | 49 | 20.7 / 22.7 | 2.0 | 5.3 | 16.6 | 1,074 | 3,113,956 | 412 | 613 / 286 / 36 | 10/454/73 | 36/293/101 | 452 | 0.00 | 4872·641 | 0.0/0.0 | 48.6 | 0 |
| fpv.u1.high.m0.noUpdate | high (high) | 2 | 8192·cast·noUpd | 3/3 | 2.0 | 46 | 21.5 / 23.2 | 2.4 | 3.8 | 25.0 | 701 | 1,714,544 | 413 | 613 / 286 / 36 | 10/454/73 | 36/293/101 | 452 | 0.00 | 4885·391 | 0.0/0.0 | 43.5 | 0 |
| fpv.u1.high.m0.off | high (high) | 2 | 8192·cast·OFF | 3/3 | 2.1 | 47 | 21.4 / 23.0 | 2.5 | 3.9 | 25.4 | 701 | 1,714,544 | 429 | 613 / 286 / 36 | 10/454/73 | 36/293/101 | 452 | 0.00 | 5010·285 | 0.0/0.0 | 46.0 | 0 |
| orbit.u0.high.m0.on | high (high) | 2 | 4096·cast | 3/3 | 18.4 | 23 | 43.3 / 44.4 | 42.0 | 0.8 | 36.2 | 244 | 736,744 | 216 | 189 / 184 / 31 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2407·155 | 0.0/0.0 | 3.7 | 0 |
| orbit.u0.high.m0.bloomOff | high (high) | 2 | 4096·cast·bloom off | 3/3 | 2.2 | 24 | 42.2 / 43.5 | 41.4 | 0.8 | 15.0 | 231 | 736,731 | 197 | 189 / 184 / 31 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2630·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.high.m0.noUpdate | high (high) | 2 | 4096·cast·noUpd | 3/3 | 2.3 | 24 | 42.1 / 43.1 | 41.3 | 0.7 | 34.2 | 221 | 517,052 | 204 | 189 / 184 / 31 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2640·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.high.m0.off | high (high) | 2 | 4096·cast·OFF | 3/3 | 2.2 | 24 | 42.3 / 43.0 | 41.3 | 0.7 | 35.2 | 221 | 517,052 | 209 | 189 / 184 / 31 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2629·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.mid.m0.on | mid (mid) | 1.5 | 2048·cast | 3/3 | 11.8 | 26 | 38.8 / 39.8 | 38.1 | 0.6 | 20.9 | 192 | 736,276 | 216 | 138 / 133 / 31 | 5/48/6 | 12/131/5 | 190 | 0.00 | 2742·113 | 0.0/0.0 | 3.3 | 0 |
| orbit.u0.mid.m0.bloomOff | mid (mid) | 1.5 | 2048·cast·bloom off | 3/3 | 2.2 | 26 | 38.8 / 39.8 | 38.2 | 0.6 | 9.3 | 179 | 736,263 | 228 | 138 / 133 / 31 | 5/48/6 | 12/131/5 | 190 | 0.00 | 2858·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.mid.m0.noUpdate | mid (mid) | 1.5 | 2048·cast·noUpd | 3/3 | 2.2 | 26 | 38.7 / 39.6 | 38.1 | 0.5 | 20.6 | 169 | 516,584 | 224 | 138 / 133 / 31 | 5/48/6 | 12/131/5 | 190 | 0.00 | 2869·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.mid.m0.off | mid (mid) | 1.5 | 2048·cast·OFF | 3/3 | 2.2 | 26 | 38.6 / 39.3 | 38.1 | 0.5 | 21.0 | 169 | 516,584 | 210 | 138 / 133 / 31 | 5/48/6 | 12/131/5 | 190 | 0.00 | 2880·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.low.m0.offBoot | low (low) | 1.25 | 1024·cast·OFF | 3/3 | 11.6 | 25 | 39.7 / 40.5 | 39.1 | 0.3 | 5.4 | 88 | 515,951 | 220 | 88 / 63 / 20 | 5/31/6 | 12/80/5 | 122 | 0.00 | 2683·114 | 0.0/0.0 | 7.6 | 0 |
| orbit.u1.high.m0.on | high (high) | 2 | 8192·cast | 3/3 | 18.0 | 23 | 42.5 / 43.4 | 41.3 | 0.8 | 44.3 | 319 | 737,864 | 223 | 189 / 184 / 32 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2463·155 | 0.0/0.0 | 16.7 | 0 |
| orbit.u1.high.m0.bloomOff | high (high) | 2 | 8192·cast·bloom off | 3/3 | 2.1 | 24 | 42.3 / 43.3 | 41.3 | 0.8 | 19.1 | 306 | 737,851 | 229 | 189 / 184 / 32 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2627·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u1.high.m0.noUpdate | high (high) | 2 | 8192·cast·noUpd | 3/3 | 2.1 | 24 | 42.3 / 43.7 | 41.3 | 0.7 | 36.8 | 221 | 517,052 | 212 | 189 / 184 / 32 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2627·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u1.high.m0.off | high (high) | 2 | 8192·cast·OFF | 3/3 | 2.1 | 23 | 42.5 / 43.4 | 41.4 | 0.7 | 36.9 | 221 | 517,052 | 197 | 189 / 184 / 32 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2618·0 | 0.0/0.0 | 0.0 | 1 |
| city.u0.high.m0.on | high (high) | 2 | 4096·cast | 0/3 | 62.6 | 19 | 51.7 / 52.5 | 42.5 | 9.1 | 61.2 | 2,236 | 13,674,516 | 841 | 1,385 / 308 / 31 | 11/412/207 | 26/278/389 | 410 | 0.00 | 1726·448 | 0.0/0.0 | 19.4 | 192 |
| city.u0.high.m0.bloomOff | high (high) | 2 | 4096·cast·bloom off | 0/3 | 2.1 | 20 | 49.9 / 51.6 | 41.7 | 8.8 | 47.0 | 2,223 | 13,674,503 | 841 | 1,385 / 308 / 31 | 11/412/207 | 26/278/389 | 410 | 0.00 | 1813·435 | 0.0/0.3 | 20.0 | 82 |
| city.u0.high.m0.noUpdate | high (high) | 2 | 4096·cast·noUpd | 0/3 | 2.3 | 21 | 46.3 / 48.1 | 41.6 | 4.9 | 46.9 | 1,518 | 7,018,965 | 816 | 1,385 / 308 / 31 | 11/412/207 | 26/278/389 | 410 | 0.00 | 2004·413 | 0.0/0.3 | 21.4 | 0 |
| city.u0.high.m0.off | high (high) | 2 | 4096·cast·OFF | 0/3 | 2.3 | 21 | 46.6 / 48.6 | 42.3 | 4.1 | 57.6 | 1,518 | 7,018,965 | 855 | 1,385 / 308 / 31 | 11/412/207 | 26/278/389 | 410 | 0.00 | 1992·415 | 0.0/0.0 | 21.3 | 0 |
| city.u0.mid.m0.on | mid (mid) | 1.5 | 2048·cast | 0/3 | 24.6 | 20 | 50.3 / 52.6 | 42.4 | 9.1 | 60.2 | 2,210 | 13,641,570 | 858 | 1,373 / 293 / 31 | 10/91/207 | 24/266/389 | 354 | 0.00 | 1696·522 | 0.0/0.0 | 19.8 | 123 |
| city.u0.mid.m0.bloomOff | mid (mid) | 1.5 | 2048·cast·bloom off | 0/3 | 2.2 | 20 | 50.1 / 51.3 | 41.6 | 8.8 | 46.4 | 2,197 | 13,641,557 | 886 | 1,373 / 293 / 31 | 10/91/207 | 24/266/389 | 354 | 0.00 | 1766·477 | 0.0/0.0 | 19.9 | 98 |
| city.u0.mid.m0.noUpdate | mid (mid) | 1.5 | 2048·cast·noUpd | 0/3 | 2.3 | 21 | 46.3 / 48.1 | 41.5 | 5.0 | 46.7 | 1,494 | 7,002,614 | 910 | 1,373 / 293 / 31 | 10/91/207 | 24/266/389 | 354 | 0.00 | 1964·452 | 0.0/0.2 | 21.2 | 0 |
| city.u0.mid.m0.off | mid (mid) | 1.5 | 2048·cast·OFF | 0/3 | 2.3 | 21 | 46.7 / 48.8 | 42.2 | 4.2 | 56.9 | 1,494 | 7,002,614 | 917 | 1,373 / 293 / 31 | 10/91/207 | 24/266/389 | 354 | 0.00 | 1979·418 | 0.0/0.0 | 21.0 | 2 |
| city.u0.low.m0.offBoot | low (low) | 1.25 | 1024·cast·OFF | 0/3 | 18.4 | 23 | 42.9 / 43.9 | 40.6 | 2.1 | 33.2 | 886 | 5,404,060 | 672 | 850 / 123 / 20 | 7/44/163 | 17/128/254 | 170 | 0.00 | 2025·585 | 0.0/0.0 | 23.3 | 0 |
| city.u1.high.m0.on | high (high) | 2 | 8192·cast | 0/3 | 67.9 | 18 | 54.8 / 57.4 | 44.1 | 10.4 | 65.5 | 2,527 | 13,819,384 | 859 | 1,432 / 358 / 32 | 14/454/207 | 35/302/389 | 451 | 0.00 | 1618·429 | 0.0/0.0 | 18.2 | 183 |
| city.u1.high.m0.bloomOff | high (high) | 2 | 8192·cast·bloom off | 0/3 | 2.2 | 19 | 53.1 / 57.2 | 43.5 | 9.9 | 49.4 | 2,514 | 13,819,371 | 820 | 1,432 / 358 / 32 | 14/454/207 | 35/302/389 | 451 | 0.00 | 1690·413 | 0.0/0.0 | 18.7 | 188 |
| city.u1.high.m0.noUpdate | high (high) | 2 | 8192·cast·noUpd | 0/3 | 2.1 | 20 | 49.7 / 51.4 | 44.0 | 8.3 | 49.2 | 1,603 | 7,082,530 | 853 | 1,432 / 358 / 32 | 14/454/207 | 35/302/389 | 451 | 0.00 | 1851·412 | 0.0/0.3 | 20.1 | 78 |
| city.u1.high.m0.off | high (high) | 2 | 8192·cast·OFF | 0/3 | 2.3 | 20 | 49.9 / 51.5 | 45.0 | 4.6 | 63.3 | 1,603 | 7,082,530 | 824 | 1,432 / 358 / 32 | 14/454/207 | 35/302/389 | 451 | 0.00 | 1877·374 | 0.0/0.2 | 20.0 | 93 |
| everest.u0.high.m0.on | high (high) | 2 | 4096·cast | 0/0 | 37.9 | 31 | 31.6 / 32.3 | 30.8 | 0.6 | 34.8 | 192 | 419,558 | 186 | 145 / 141 / 25 | 1/238/0 | 12/146/0 | 226 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.high.m0.bloomOff | high (high) | 2 | 4096·cast·bloom off | 0/0 | 2.2 | 31 | 31.6 / 32.9 | 30.8 | 0.6 | 12.9 | 179 | 419,545 | 177 | 145 / 141 / 25 | 1/238/0 | 12/146/0 | 226 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.high.m0.noUpdate | high (high) | 2 | 4096·cast·noUpd | 0/0 | 2.1 | 31 | 31.6 / 32.5 | 30.8 | 0.6 | 33.4 | 181 | 409,096 | 180 | 145 / 141 / 25 | 1/238/0 | 12/146/0 | 226 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.high.m0.off | high (high) | 2 | 4096·cast·OFF | 0/0 | 2.1 | 31 | 31.7 / 33.0 | 30.8 | 0.6 | 33.6 | 181 | 409,096 | 181 | 145 / 141 / 25 | 1/238/0 | 12/146/0 | 226 | 0.00 | 65·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.mid.m0.on | mid (mid) | 1.5 | 2048·cast | 0/0 | 8.7 | 32 | 31.2 / 31.9 | 30.8 | 0.4 | 19.4 | 96 | 415,886 | 168 | 84 / 84 / 25 | 0/48/0 | 10/89/0 | 150 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.mid.m0.bloomOff | mid (mid) | 1.5 | 2048·cast·bloom off | 0/0 | 2.3 | 32 | 31.4 / 32.4 | 30.9 | 0.3 | 7.2 | 83 | 415,873 | 191 | 84 / 84 / 25 | 0/48/0 | 10/89/0 | 150 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.mid.m0.noUpdate | mid (mid) | 1.5 | 2048·cast·noUpd | 0/0 | 2.2 | 32 | 31.5 / 32.1 | 30.9 | 0.3 | 19.1 | 87 | 408,887 | 170 | 84 / 84 / 25 | 0/48/0 | 10/89/0 | 150 | 0.00 | 66·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.mid.m0.off | mid (mid) | 1.5 | 2048·cast·OFF | 0/0 | 2.2 | 32 | 31.0 / 31.6 | 30.6 | 0.3 | 19.1 | 87 | 408,887 | 169 | 84 / 84 / 25 | 0/48/0 | 10/89/0 | 150 | 0.00 | 67·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u0.low.m0.offBoot | low (low) | 1.25 | 1024·cast·OFF | 0/0 | 7.8 | 40 | 24.6 / 25.3 | 24.2 | 0.2 | 3.3 | 43 | 399,075 | 160 | 54 / 44 / 16 | 0/35/0 | 8/59/0 | 106 | 0.00 | 84·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u1.high.m0.on | high (high) | 2 | 8192·cast | 0/0 | 12.0 | 31 | 32.5 / 33.3 | 31.6 | 0.7 | 41.8 | 265 | 460,419 | 181 | 156 / 152 / 26 | 1/238/0 | 12/146/0 | 226 | 0.00 | 64·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u1.high.m0.bloomOff | high (high) | 2 | 8192·cast·bloom off | 0/0 | 2.1 | 31 | 32.5 / 33.6 | 31.6 | 0.7 | 16.8 | 252 | 460,406 | 197 | 156 / 152 / 26 | 1/238/0 | 12/146/0 | 226 | 0.00 | 64·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u1.high.m0.noUpdate | high (high) | 2 | 8192·cast·noUpd | 0/0 | 2.1 | 31 | 32.5 / 33.5 | 31.7 | 0.6 | 35.3 | 181 | 409,096 | 172 | 156 / 152 / 26 | 1/238/0 | 12/146/0 | 226 | 0.00 | 64·0 | 0.0/0.0 | 0.0 | 0 |
| everest.u1.high.m0.off | high (high) | 2 | 8192·cast·OFF | 0/0 | 2.1 | 31 | 32.6 / 33.8 | 31.8 | 0.6 | 35.4 | 181 | 409,096 | 172 | 156 / 152 / 26 | 1/238/0 | 12/146/0 | 226 | 0.00 | 64·0 | 0.0/0.0 | 0.0 | 0 |
| m.u0.mid.m0.on | mid (mid) | 1.5 | 1024 | 0/3 | 9.9 | 28 | 35.9 / 37.0 | 35.5 | 0.1 | 1.4 | 9 | 316,917 | 100 | 22 / 20 / 14 | 0/66/0 | 0/50/0 | 66 | 0.00 | 30·0 | 0.0/0.0 | 0.0 | 0 |
| m.u0.low.m0.offBoot | low (low) | 1.25 | 1024·OFF | 0/3 | 13.1 | 26 | 38.8 / 39.7 | 38.7 | 0.1 | 1.1 | 9 | 316,917 | 98 | 17 / 15 / 14 | 0/66/0 | 0/50/0 | 66 | 0.00 | 28·0 | 0.0/0.0 | 0.0 | 0 |
| fpv.u0.high.m6.on | high (high) | 2 | 4096·cast | 6/6 | 14.7 | 44 | 22.5 / 24.1 | 1.9 | 4.7 | 24.3 | 824 | 3,113,024 | 432 | 550 / 233 / 33 | 9/411/73 | 31/239/101 | 409 | 0.00 | 4272·779 | 0.0/0.0 | 44.5 | 0 |
| fpv.u0.high.m6.bloomOff | high (high) | 2 | 4096·cast·bloom off | 6/6 | 2.0 | 68 | 14.9 / 16.1 | 1.9 | 4.6 | 12.0 | 811 | 3,113,011 | 491 | 550 / 233 / 33 | 9/411/73 | 31/239/101 | 409 | 0.00 | 6870·807 | 0.0/0.0 | 67.7 | 0 |
| fpv.u0.high.m6.noUpdate | high (high) | 2 | 4096·cast·noUpd | 6/6 | 2.0 | 48 | 20.7 / 22.6 | 2.4 | 3.5 | 24.4 | 616 | 1,702,446 | 425 | 550 / 233 / 33 | 9/411/73 | 31/239/101 | 409 | 0.00 | 5160·334 | 0.0/0.0 | 45.8 | 0 |
| fpv.u0.high.m6.off | high (high) | 2 | 4096·cast·OFF | 6/6 | 2.0 | 48 | 20.7 / 22.6 | 2.5 | 3.4 | 24.6 | 616 | 1,702,446 | 420 | 550 / 233 / 33 | 9/411/73 | 31/239/101 | 409 | 0.00 | 5237·264 | 0.0/0.0 | 47.7 | 0 |
| fpv.u1.high.m6.on | high (high) | 2 | 8192·cast | 6/6 | 16.5 | 35 | 28.5 / 30.6 | 2.1 | 5.8 | 30.7 | 1,091 | 3,175,777 | 461 | 614 / 292 / 38 | 10/455/73 | 36/293/101 | 453 | 0.00 | 3328·665 | 0.0/0.0 | 35.2 | 0 |
| fpv.u1.high.m6.bloomOff | high (high) | 2 | 8192·cast·bloom off | 6/6 | 2.0 | 48 | 21.1 / 23.3 | 2.0 | 5.4 | 16.7 | 1,078 | 3,175,764 | 420 | 614 / 292 / 38 | 10/455/73 | 36/293/101 | 453 | 0.00 | 4757·650 | 0.0/0.0 | 47.7 | 0 |
| fpv.u1.high.m6.noUpdate | high (high) | 2 | 8192·cast·noUpd | 6/6 | 2.1 | 46 | 21.8 / 23.5 | 2.4 | 4.0 | 25.0 | 702 | 1,729,996 | 439 | 614 / 292 / 38 | 10/455/73 | 36/293/101 | 453 | 0.00 | 4807·396 | 0.0/0.0 | 43.0 | 0 |
| fpv.u1.high.m6.off | high (high) | 2 | 8192·cast·OFF | 6/6 | 2.1 | 46 | 21.8 / 23.6 | 2.6 | 3.8 | 25.3 | 702 | 1,729,996 | 418 | 614 / 292 / 38 | 10/455/73 | 36/293/101 | 453 | 0.00 | 4945·278 | 0.0/0.0 | 45.6 | 0 |
| orbit.u0.high.m6.on | high (high) | 2 | 4096·cast | 6/6 | 18.2 | 23 | 42.7 / 43.8 | 41.5 | 0.8 | 35.4 | 250 | 829,456 | 230 | 192 / 199 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2443·161 | 0.0/0.0 | 0.0 | 0 |
| orbit.u1.high.m6.on | high (high) | 2 | 8192·cast | 6/6 | 18.5 | 25 | 39.3 / 40.4 | 38.5 | 0.9 | 45.4 | 325 | 830,576 | 196 | 192 / 199 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2668·156 | 0.0/0.0 | 0.0 | 0 |
| orbit.u1.high.m6.bloomOff | high (high) | 2 | 8192·cast·bloom off | 6/6 | 19.9 | 26 | 38.6 / 39.5 | 37.7 | 1.5 | 23.6 | 546 | 1,111,218 | 259 | 288 / 302 / 35 | 5/343/14 | 12/248/10 | 342 | 0.00 | 2537·370 | 0.0/0.0 | 4.2 | 0 |
| fpv.u0.high.m24.on | high (high) | 2 | 4096·cast | 24/24 | 15.1 | 44 | 22.7 / 24.4 | 1.9 | 5.0 | 24.3 | 839 | 3,437,388 | 489 | 561 / 245 / 33 | 9/410/73 | 31/236/101 | 408 | 0.00 | 4266·781 | 0.0/0.0 | 44.4 | 0 |
| fpv.u0.high.m24.bloomOff | high (high) | 2 | 4096·cast·bloom off | 24/24 | 2.0 | 64 | 15.6 / 17.1 | 2.0 | 5.2 | 11.9 | 826 | 3,437,375 | 427 | 561 / 245 / 33 | 9/410/73 | 31/236/101 | 408 | 0.00 | 6549·780 | 0.0/0.0 | 64.4 | 0 |
| fpv.u0.high.m24.noUpdate | high (high) | 2 | 4096·cast·noUpd | 24/24 | 2.0 | 48 | 20.7 / 22.7 | 2.6 | 3.7 | 25.0 | 613 | 1,748,674 | 433 | 561 / 245 / 33 | 9/410/73 | 31/236/101 | 408 | 0.00 | 5142·344 | 0.0/0.0 | 45.6 | 0 |
| fpv.u0.high.m24.off | high (high) | 2 | 4096·cast·OFF | 24/24 | 2.0 | 49 | 20.5 / 22.1 | 2.6 | 3.6 | 24.6 | 613 | 1,748,674 | 420 | 561 / 245 / 33 | 9/410/73 | 31/236/101 | 408 | 0.00 | 5285·281 | 0.0/0.0 | 48.1 | 0 |
| fpv.u1.high.m24.on | high (high) | 2 | 8192·cast | 24/24 | 17.2 | 36 | 27.6 / 29.8 | 1.9 | 6.2 | 30.3 | 1,103 | 3,500,173 | 491 | 627 / 302 / 38 | 10/453/73 | 36/290/101 | 451 | 0.00 | 3450·682 | 0.0/0.0 | 36.3 | 0 |
| fpv.u1.high.m24.bloomOff | high (high) | 2 | 8192·cast·bloom off | 24/24 | 2.0 | 48 | 20.9 / 23.1 | 2.0 | 6.3 | 16.6 | 1,090 | 3,500,160 | 429 | 627 / 302 / 38 | 10/453/73 | 36/290/101 | 451 | 0.00 | 4776·649 | 0.0/0.0 | 47.7 | 1 |
| fpv.u1.high.m24.noUpdate | high (high) | 2 | 8192·cast·noUpd | 24/24 | 2.0 | 47 | 21.4 / 23.1 | 2.2 | 4.1 | 25.0 | 699 | 1,776,288 | 429 | 627 / 302 / 38 | 10/453/73 | 36/290/101 | 451 | 0.00 | 4921·390 | 0.0/0.0 | 44.2 | 0 |
| fpv.u1.high.m24.off | high (high) | 2 | 8192·cast·OFF | 24/24 | 2.0 | 47 | 21.4 / 23.3 | 2.2 | 4.1 | 25.1 | 699 | 1,776,288 | 440 | 627 / 302 / 38 | 10/453/73 | 36/290/101 | 451 | 0.00 | 5041·279 | 0.0/0.0 | 44.0 | 0 |
| orbit.u0.high.m24.on | high (high) | 2 | 4096·cast | 24/24 | 21.5 | 21 | 48.4 / 49.8 | 47.1 | 1.1 | 35.5 | 286 | 1,385,728 | 208 | 212 / 291 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2172·161 | 0.0/0.0 | 0.0 | 6 |
| orbit.u0.high.m24.bloomOff | high (high) | 2 | 4096·cast·bloom off | 24/24 | 2.1 | 21 | 48.4 / 49.4 | 47.1 | 1.0 | 15.1 | 273 | 1,385,715 | 210 | 212 / 291 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2318·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u0.high.m24.noUpdate | high (high) | 2 | 4096·cast·noUpd | 24/24 | 2.1 | 21 | 48.3 / 49.2 | 47.0 | 0.9 | 24.2 | 242 | 841,544 | 217 | 212 / 291 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2347·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u0.high.m24.off | high (high) | 2 | 4096·cast·OFF | 24/24 | 2.3 | 21 | 46.8 / 48.9 | 46.6 | 0.9 | 35.0 | 242 | 841,544 | 214 | 212 / 291 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2389·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u1.high.m24.on | high (high) | 2 | 8192·cast | 24/24 | 21.2 | 22 | 45.3 / 47.5 | 43.6 | 1.2 | 43.3 | 361 | 1,386,848 | 209 | 210 / 289 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2315·155 | 0.0/0.0 | 0.0 | 1 |
| orbit.u1.high.m24.bloomOff | high (high) | 2 | 8192·cast·bloom off | 24/24 | 2.3 | 22 | 45.6 / 47.3 | 44.1 | 1.1 | 19.3 | 348 | 1,386,835 | 214 | 210 / 289 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2464·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u1.high.m24.noUpdate | high (high) | 2 | 8192·cast·noUpd | 24/24 | 2.3 | 22 | 46.0 / 47.9 | 44.4 | 1.0 | 25.9 | 242 | 841,544 | 219 | 210 / 289 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2427·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u1.high.m24.off | high (high) | 2 | 8192·cast·OFF | 24/24 | 2.2 | 22 | 45.5 / 47.1 | 44.3 | 0.9 | 37.9 | 242 | 841,544 | 210 | 210 / 289 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2450·0 | 0.0/0.0 | 0.0 | 1 |
| *(re-run of the two boots that stalled in the main run — same profile, 5 min later)* | | | | | | | | | | | | | | | | | | | | | | |
| orbit.u0.high.m6.on | high (high) | 2 | 4096·cast | 6/6 | 19.3 | 22 | 45.9 / 47.1 | 44.2 | 0.9 | 35.3 | 250 | 829,456 | 196 | 192 / 199 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2285·155 | 0.0/0.0 | 0.0 | 1 |
| orbit.u0.high.m6.bloomOff | high (high) | 2 | 4096·cast·bloom off | 6/6 | 2.3 | 22 | 45.7 / 47.0 | 44.1 | 0.9 | 14.2 | 237 | 829,443 | 201 | 192 / 199 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2445·0 | 0.0/0.0 | 0.0 | 0 |
| orbit.u0.high.m6.noUpdate | high (high) | 2 | 4096·cast·noUpd | 6/6 | 2.3 | 22 | 45.9 / 47.5 | 44.5 | 0.8 | 24.1 | 224 | 563,408 | 207 | 192 / 199 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2420·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u0.high.m6.off | high (high) | 2 | 4096·cast·OFF | 6/6 | 2.3 | 22 | 46.3 / 48.3 | 45.4 | 0.8 | 34.4 | 224 | 563,408 | 198 | 192 / 199 / 33 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2414·0 | 0.0/0.0 | 0.0 | 1 |
| orbit.u1.high.m6.on | high (high) | 2 | 8192·cast | 6/6 | 19.8 | 20 | 49.5 / 51.0 | 48.0 | 1.0 | 44.2 | 325 | 830,576 | 197 | 192 / 199 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2109·155 | 0.0/0.0 | 5.1 | 64 |
| orbit.u1.high.m6.bloomOff | high (high) | 2 | 8192·cast·bloom off | 6/6 | 2.1 | 21 | 49.0 / 50.8 | 47.9 | 1.0 | 19.3 | 312 | 830,563 | 202 | 192 / 199 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2292·0 | 0.0/0.0 | 0.0 | 44 |
| orbit.u1.high.m6.noUpdate | high (high) | 2 | 8192·cast·noUpd | 6/6 | 2.3 | 20 | 49.2 / 50.6 | 47.8 | 0.9 | 25.1 | 224 | 563,408 | 206 | 192 / 199 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2275·0 | 0.0/0.0 | 0.0 | 27 |
| orbit.u1.high.m6.off | high (high) | 2 | 8192·cast·OFF | 6/6 | 2.1 | 21 | 48.4 / 50.0 | 47.7 | 0.8 | 37.1 | 224 | 563,408 | 214 | 192 / 199 / 34 | 5/255/6 | 12/167/5 | 254 | 0.00 | 2318·0 | 0.0/0.0 | 0.0 | 10 |

The one anomaly in the table: at the `city` and the model-bearing `orbit` boots the GPU timer reads
LOWER with the depth pass skipped (`noUpdate`) than with shadows compiled out (`off`) — 46.9 vs 57.6
ms at the city, 24.1 vs 34.4 at orbit m6 — while at the FPV eye and Everest the two agree. The p95s
overlap (`on` 68 / `noUpdate` 62 / `off` 63 at the city), so the depth-pass GPU cost at those poses
is read from calls/tris and from `frame.draw`/`dt`, never from the GPU delta alone. UNRESOLVED.

## 3. The shadow cost (per pose; `on` minus the mode; base rig unless u1)

| pose | mode | Δ GPU ms | Δ frame ms | Δ calls | Δ triangles | reading |
|---|---|---|---|---|---|---|
| fpv high | noUpdate / off | −0.5 / −0.5 | −1.7 / −2.0 | −205 | −1.36 M | the depth pass is 205 calls and 1.4 M tris; ~2 ms of frame, ~0.5 ms of GPU |
| fpv mid (2048²) | noUpdate / off | −0.3 / −0.2 | −1.1 / −1.2 | −195 | −1.31 M | same shape, smaller map |
| fpv ULTRA (8192² + cascades) | noUpdate / off | −6.2 / −5.8 | −6.9 / −7.0 | −386 | −1.40 M | the ULTRA rig's shadow work is 6–7 ms of both |
| orbit high | noUpdate / off | −2.1 / −1.0 | −1.2 / −1.0 | −23 | −0.22 M | negligible; the frame is CPU-bound anyway (§7) |
| orbit ULTRA | noUpdate / off | −7.5 / −7.4 | −0.2 / 0.0 | −98 | −0.22 M | 7.5 ms of GPU hidden behind 42 ms of CPU |
| city high | noUpdate / off | −14.3 / −3.6 (anomaly) | −5.4 / −5.1 | −718 | −6.66 M | the one pose where the depth pass is heavy: 718 calls, 6.7 M tris |
| city ULTRA | noUpdate / off | −16.2 / −2.2 (anomaly) | −5.1 / −4.9 | −924 | −6.74 M | |
| everest high | noUpdate / off | −1.4 / −1.2 | 0.0 / +0.1 | −11 | −10 k | terrain does not cast on the base rig |
| everest ULTRA | noUpdate / off | −6.5 / −6.4 | 0.0 / +0.1 | −84 | −51 k | terrain casting: 6.5 ms of GPU, invisible behind 31 ms of CPU |

Shadow-rig census at the sampled instants (from `ultraLook()` / the `ultra` provider): sun elevation
54.3° (Dnipro) / 39.9° (Everest); base map 4096² at 2.44 m/texel (5 km box) at the FPV eye and the
city, 0.78 m/texel (1.6 km box) at the orbit pose; ULTRA 8192² at 4.3 / 3.4 / 3.1 / 0.4 m/texel
(FPV / city / Everest / orbit) with cascade 1 at 17.6 (FPV) / 13.7 (city) m/texel and cascade 2 at 0
(not fitted at 54° — `cas2.mPerTexel` 0); `shadow.coverM` 9.2 km base → 36 km (FPV) / 28 km (city)
/ 16.8 km (Everest) under ULTRA.

## 4. The tier ladder, bloom, and what the GPU is doing

GTAO is OFF in this build (`AO.enabled: false` — no `aoOff` cell exists; the plan's "GTAO cost never
measured" row stays moot). The GPU frame is therefore: the main pass (MSAA ×4 HalfFloat) + the
UnrealBloomPass + the OutputPass (+ the PiP when the chart is open, not in these cells).

| pose | tier (dpr, shadow px, bloom) | dt p50 | GPU | GPU bloom off | bloom share | calls |
|---|---|---|---|---|---|---|
| fpv | high (2, 4096, on) | 23.1 | 25.1 | 11.8 | 53 % | 820 |
| fpv | mid (1.5, 2048, on) | 15.1 | 15.0 | 7.3 | 51 % | 942 |
| fpv | low (1.25, off, off) | 8.3 (vsync) | 5.2 | — | — | 515 |
| fpv | ULTRA (2, 8192, on) | 28.4 | 31.2 | 16.6 | 47 % | 1,087 |
| orbit | high | 43.3 (CPU) | 36.2 | 15.0 | 59 % | 244 |
| orbit | mid | 38.8 (CPU) | 20.9 | 9.3 | 55 % | 192 |
| orbit | low | 39.7 (CPU) | 5.4 | — | — | 88 |
| city | high | 51.7 (CPU + GPU) | 61.2 | 47.0 | 23 % | 2,236 |
| city | low | 42.9 (CPU) | 33.2 | — | — | 886 |
| everest | high | 31.6 (CPU) | 34.8 | 12.9 | 63 % | 192 |
| everest | low | 24.6 (CPU) | 3.3 | — | — | 43 |
| /m chart | mid (1.5 lean) | 35.9 (CPU) | 1.4 | — | — | 9 |
| /m chart | low | 38.8 (CPU) | 1.1 | — | — | 9 |

Readings: (a) the GPU frame scales with pixels — `high` → `mid` (DPR 2 → 1.5, 0.56× the pixels)
cuts GPU 25.1 → 15.0 at the FPV eye and 36 → 21 at orbit — the engine is FILL-bound on the GPU, not
geometry-bound (the city's 13.7 M triangles cost 61 ms only with 2,236 calls; Everest's 0.42 M cost
35); (b) bloom is 13–25 ms of that at DPR 2 (`UnrealBloomPass` on a 3200×1900 target: 5 mips,
separable blurs, the composite — plus the MSAA resolve it forces); (c) at the FPV eye the frame IS
the GPU (dt ≈ gpu, cpu 2 ms) — the desktop FPV frame rate is a bloom + fill question; (d) at every
orbit pose the frame is the CPU (§7) and the GPU hides behind it — fixing one without the other
moves nothing at orbit.

## 5. The model ramp (N = TOTAL resident; the world held 3 real member models near the eye)

| pose | N resident (model tris) | dt | cpu | draw | GPU | calls | frame tris | heap MB | textures | geometries |
|---|---|---|---|---|---|---|---|---|---|---|
| fpv high | 3 (24 k) | 23.1 | 2.1 | 4.9 | 25.1 | 820 | 3.05 M | 472 | 228 | 544 |
| fpv high | 6 (71 k) | 22.5 | 1.9 | 4.7 | 24.3 | 824 | 3.11 M | 432 | 233 | 550 |
| fpv high | 24 (349 k) | 22.7 | 1.9 | 5.0 | 24.3 | 839 | 3.44 M | 489 | 245 | 561 |
| fpv ULTRA | 3 / 6 / 24 | 28.4 / 28.5 / 27.6 | 2.1 / 2.1 / 1.9 | 6.0 / 5.8 / 6.2 | 31.2 / 30.7 / 30.3 | 1,087 / 1,091 / 1,103 | 3.11 / 3.18 / 3.50 M | 453 / 461 / 491 | 286 / 292 / 302 | 613 / 614 / 627 |
| orbit high | 3 / 6 / 24 | 43.3 / 42.7 (45.9) / 48.4 | 42.0 / 41.5 (44.2) / 47.1 | 0.8 / 0.8 / 1.1 | 36.2 / 35.4 / 35.5 | 244 / 250 / 286 | 0.74 / 0.83 / 1.39 M | 216 / 230 / 208 | 184 / 199 / 291 | 189 / 192 / 212 |
| orbit ULTRA | 3 / 6 / 24 | 42.5 / 39.3 (49.5) / 45.3 | 41.3 / 38.5 (48.0) / 43.6 | 0.8 / 0.9 / 1.2 | 44.3 / 45.4 / 43.3 | 319 / 325 / 361 | 0.74 / 0.83 / 1.39 M | 223 / 196 / 209 | 184 / 199 / 289 | 189 / 192 / 210 |

(parenthesised = the re-run of the two boots that stalled in the main run.) Per resident realistic
model at the FPV eye: ~0.8 draw calls (one mesh + its shadow-pass twin), 15.5 k triangles, < 1
texture (the loader shares one URL's five textures across instances — +17 textures for +21 models,
so the "five 2048² textures per model" VRAM cliff MESH_SUITE_PLAN §12 estimated does not exist for
repeated URLs; it would for 24 DISTINCT models), no measurable frame time. At orbit the 24 models add
~5 ms of CPU — to the controls' raycast (§7), not to rendering. `models.skipped` stayed 0 at N = 24
(the `maxResident` cap binds at 25). `models.tris` read 348,662 at N = 24 (24 × 15,452 − the three
real models' 24,170 accounted separately by the store).

## 6. ULTRA (pref at boot: 8192² map, two cascades, the ULTRA tile levers)

| pose | GPU off → on | frame off → on | calls off → on | settle off → on |
|---|---|---|---|---|
| fpv | 25.1 → 31.2 (+6.1) | 23.1 → 28.4 (+5.3) | 820 → 1,087 (+267) | 2 → 18 s |
| orbit | 36.2 → 44.3 (+8.1) | 43.3 → 42.5 (CPU-bound) | 244 → 319 | 18 → 18 s |
| city | 61.2 → 65.5 (+4.3) | 51.7 → 54.8 | 2,236 → 2,527 | 63 → 68 s |
| everest | 34.8 → 41.8 (+7.0) | 31.6 → 32.5 (CPU-bound) | 192 → 265 | 38 → 12 s |

ULTRA's cost is 4–8 ms of GPU and +75–290 draw calls; on the CPU-bound orbit poses it is invisible.
The 2026-08-22 ship numbers (city OFF 30.7 → ON 36.1 ms) were taken at a different city pose and
before the cascade ladder; the pose cited by the plan reads 52 → 55 ms today because it is
controls-bound (§7), not because ULTRA grew.

## 7. The CPU profile — where the orchestrator's frame goes (`probe-cpu-profile.mjs`, 250 µs sampling)

| pose | frame.cpu p50 | dt p50 | self time by file | top functions (self) | inclusive |
|---|---|---|---|---|---|
| orbit (6.3 s, 18,701 samples) | 43.5 ms | 44.7 ms | three 91.7 % · native 5.8 % · 3d-tiles-renderer 1.1 % · enrichedBuildings 0.3 % | `getVertexPosition` 31.7 % · `checkGeometryIntersection` 23.9 % · `intersectTriangle` 23.7 % · `_computeIntersections` 10.3 % · (program) 5.4 % · `applyFeatureSeats` 0.3 % | `tick` 88 % → `StylizedTiles.update` 86 % → `stepControlsUpdate` 84 % → `GlobeControls.adjustCamera` 84 % → `_getPointBelowCamera` 84 % → `intersectObject` 84 % |
| everest (5.4 s, 15,735 samples) | 35.3 ms | 36.1 ms | three 91.6 % · native 6.8 % | `fromBufferAttribute` 38.9 % · `checkGeometryIntersection` 17.5 % · `intersectTriangle` 17.1 % | the same chain, against the 210 MB Everest TIN |
| fpv (5.4 s, 15,568 samples) | 1.9 ms | 21.7 ms | (idle) 58.9 % · (program) 8.2 % · three 19.5 % · enrichedBuildings 4.0 % | `applyFeatureSeats` 3.8 % (≈ 0.7 ms per frame — ENGINE_STATE's "~0.2 ms" was low) | FPV never calls `controls.update()` with `adjustHeight` (`StylizedTiles.ts:4431/4485` turn it off) |

**The mechanism, cited.** `stepControlsUpdate` (`StylizedTiles.ts:4231-4235`) calls
`controls.update()` every frame; the library (`node_modules/3d-tiles-renderer/src/three/renderer/controls/EnvironmentControls.js`)
calls `_getPointBelowCamera()` at `:995` (the up-direction refresh) and again inside `adjustCamera`
at `:1059` when `adjustHeight` is true; `_getPointBelowCamera` (`:1461-1476`) builds a down-ray from
1e5 m above the camera and `_raycast` (`:1736-1740`) does `raycaster.intersectObject(scene)[0]` —
**recursive over the object the controls were given, which is the whole `scene`**
(`StylizedTiles.ts:1086` `new GlobeControls(scene, camera, renderer.domElement)`). Every fill mesh
keeps three's default `Mesh.raycast` (the U8 pick needs it — `enrichedBuildings.ts pickBuilding`:
"Fill meshes keep default raycast; edges/trees/ghost are noop'd"), and the enriched fills are
non-indexed vertex soups (`getVertexPosition` dominates), so the ray is tested against every
triangle of every resident cell, every frame. The cost scales with what is resident, not with the
view: 31 ms at Everest (terrain TIN only), 39–47 ms at Dnipro (city + terrain), +5 ms per 24 models.

**Levers this opens (for the fix session; none built here):** the controls' raycast target
(`controls.setScene(<terrain-only group>)`, or a `raycaster.layers` mask that excludes buildings /
trees / models — the pick raycaster keeps its own), `three-mesh-bvh` on the terrain tiles (the plan's
lever 8 aimed at `heightAt`; this is the bigger consumer), or replacing `_getPointBelowCamera` with
the engine's own memoised `heightAt` (the vertical authority, D4). The expected gain is the whole
30–47 ms: the orbit frame would become GPU-bound at ~36 ms (high) / 21 (mid) / 5 (low), and then
bloom (§4) is the next 15–25 ms.

**2026-09-06 CORRECTION (T77 slice 0, `scripts/probe-below-camera.mjs` — the down-ray timed per
scene object, 5 reps, desktop):** the culprit above is mis-attributed. The enriched cells cost 3.1 ms
per call at the orbit pose (85 k tris / 11 tile scenes under the ray), the OSM building tiles 2.1 ms
(79 k / 10), the terrain traversal 0.02 ms — and **the stylized BASE EARTH costs 15.9 ms per call:
`baseEarth.ts:183` `SphereGeometry(1, EARTH.segments = 384, 384)`, 294,144 triangles, sunk 1.9 km
under the terrain as a backdrop, with a LIVE default `Mesh.raycast`** (every other backdrop noops it).
Its bounding sphere and box are the whole planet, so three's early-outs never fire and every vertical
ray tests all 294 k triangles. Per pose: orbit 21.0 ms/call (15.9 base earth), `/m` 12.1 (12.1),
Everest 15.0 (14.8 — the "210 MB TIN" costs 0.06), city 18.7 (15.2 + 3.6 OSM tiles). Two calls a
frame = the 31–47 ms above. `MEASUREMENTS` §12's slice 0 lever NEW-1 is built as the below-camera
GATE (`lib/globe/belowCameraGate.ts`, `scene/pluxGlobeControls.ts` — see `T77_SLICE0_ORBIT_FRAME_2026-09-06.md`).

## 8. Shimmer — baseline (`verify-temporal-stability.mjs --shimmer`, 640×360 mask, 480 frames)

The mask is the screen-space shadow term (A/B on `shadow.intensity` inside one rAF — §1); churn is
the fraction of the union mask that flipped between adjacent frames; the sun is stepped 2,000
scene-ms per frame (0.0083° of sun motion; the ephemeris resamples every frame — 478/479 confirmed).

| pose (rig) | mask share of frame | CONTROL (frozen sun): max churn | SCRUB 1×: churn p50 / p95 / max · speckle | SCRUB 4×: churn p50 | 4×/1× ratio |
|---|---|---|---|---|---|
| Dnipro FPV, base 4096² | 0.5 % | **0.00000** over 239 frames | **0.185** / 0.264 / 0.310 · 0.62 | 0.303 | 1.64 |
| Dnipro city, ULTRA 8192² + cascades | 31 % | 0.00003 — 18 pop frames of 239, all-speckle (the 1.5 s cascade refresh) | **0.116** / 0.201 / 0.292 · 0.75 | 0.166 | 1.43 |
| Everest, ULTRA, terrain casting | 72–80 % | **0.00000** over 239 frames | **0.077** / 0.110 / 0.131 · 0.74 | 0.095 | 1.24 |

Readings: (a) the frame is deterministic — a frozen camera and sun produce bit-identical shadow
masks (the metric has no noise floor), except the ULTRA cascade refresh, which the control leg
catches as isolated-pixel pops every ~1.5 s (mechanism 5, now observed, not argued); (b) under a
sun rate the true edge motion cannot produce (0.0083° moves a 100 m shadow ~1.5 cm, far below one
2.4 m texel), 8–19 % of the mask flips EVERY frame, 62–75 % of the flips are isolated pixels — the
re-fit / re-rasterisation crawl and the coarse-texel acne ENGINE_STATE §2.4 argued as mechanisms 1,
2 and 7, observed; (c) the churn is sub-linear in the sun rate (×1.24–1.64 for ×4) — most of it is
rate-independent, so it is the RIG that moves, not the sun. **The gates slice A inherits:** churn p50
at the 1× step ≤ 0.05 at the FPV eye (a quarter of today), control legs exactly 0 including the
cascade refresh (a refresh may not pop), speckle share ≤ 0.3, and the 4×/1× ratio ≥ 3 (the churn
must track the sun). The probe costs 48–103 ms per sampled frame (two extra composer renders) — the
scrub is frame-denominated, so that is fine.

## 9. Reseat-settle — baseline (`verify-temporal-stability.mjs --reseat`, 1,440 frames per leg)

`__globe.seatSettle()` per frame; "near" = the RC7 look-cone priority cells (4 at these poses);
`PLAN.reseatQuietFrames` = 90; `ENRICHED.reseatEaseK` 0.12, 64 feature / 40 tree / 6 cell samples
per frame (ENGINE_STATE's "16/frame" is stale), `MODELS.seatEaseK` 0.18 with a 5 mm snap.

| leg | streaming quiet at frame | terrain-epoch bumps (rate) | near: frames with a write · last write | near residual at the end | city-wide residual p50 / p95 / max · at the end | writes/frame p50 (max) | rejections | settled by the 1 cm bar |
|---|---|---|---|---|---|---|---|---|
| arrival (orbit `#p=`) | 0 (warm) but bumps until frame 429 | 130 (1.9/s) | 20 % · none in the last 300 | **0.083 m** | 0.083 / 30.7 / **119.2** m · 0.083 | 0 (1,974) | +104 | NEVER (see the stall) |
| orbit DRAG (meshedit press / 8 moves / release) | 186 | 28 (0.43/s) | 8 % · none in the last 300 | **0.083 m** | 0.083 / 0.51 / 1.42 · 0.083 | 0 (172) | 0 | NEVER |
| FPV eye + 6 seeded models | 327 | 166 (4.8/s) | 21 % · 1 % in the last 300 | **0.083 m** | **4.96 / 39.4 / 73.4 · 3.4 / 30.8 (last 300)** | **41 (2,951)**; writes in **98 %** of frames | **+1,210** | NEVER; models < 1 cm at frame 6 (from the 120 m fallback seat) |

Readings: (a) **the stall** — every leg ends with the near residual at exactly 0.083 m and no writes:
`seatStep` eases 12 % of the residual per frame and the write gate is 1 cm, so once the residual is
under 0.01 / 0.12 = 0.0833 m the step is never written; every eased seat parks up to 8.3 cm off its
own terrain. A 1 cm bar cannot be met by this engine; the metric reports it rather than gate on it
(the hypothesis IS the finding). (b) **the epoch churn** — the terrain epoch bumped 130 times during
the orbit arrival and 166 times at the FPV boot, every bump dumping the memo city-wide and re-arming
every target (`imageryGround.ts:907-911`); after the last bump the look-cone quiets in ~50 frames.
(c) **the city never converges at the FPV eye** — 103 cells resident, the round-robin writes 41
features a frame for the whole 70 s, the plausibility gate rejects 17 samples a second, and the
city-wide residual p95 is still 30 m at the end: the "poisoned pair" loop ENGINE_STATE §2.5
described is a steady state, not a transient. (d) User models seat in 6 frames (the 5 mm snap) —
they are not the problem. **The gates slice B inherits:** near residual → 0 (no stall floor — the
write gate and the ease must agree), no seat write in the 90 frames after streaming quiets, the
city-wide residual p95 < 0.1 m within 600 frames of streaming quiet at the FPV eye, rejections/s → 0
at a static pose, and the epoch bump count during a static settle → the number of NEW tiles, never
the LRU churn.

## 10. ESTIMATED → MEASURED ledger (ENGINE_STATE §4 "never measured", §12; MESH_SUITE_PLAN §12)

| was | now (this session, desktop) |
|---|---|
| no draw-call / triangle reading for any pose | FPV 820 / 3.05 M · orbit 244 / 0.74 M · city 2,236 / 13.7 M · Everest 192 / 0.42 M · `/m` 9 / 0.32 M (whole frame, shadow pass included) |
| no `frame.cpu` vs `frame.gpu` split | FPV 2 / 25 ms (GPU-bound) · orbit 42 / 36 (CPU-bound) · city 42 / 61 (both) · Everest 31 / 35 (CPU) · `/m` 36 / 1.4 (CPU) |
| the shadow pass in isolation | §3: 0.5–2 ms at the FPV eye, 6–7 ms under ULTRA, 14 ms GPU at the city; the ENTIRE shadow rig is a minor frame-time term outside the city view |
| baseline stage breakdown (fill vs raycast vs parse) | the orbit frame is 84 % raycast (the controls'), 2 % render submit; the FPV frame is 59 % idle CPU and GPU fill-bound with bloom at 53 % of the GPU |
| GTAO cost | moot — `AO.enabled: false` |
| RC21 skip ratio | the gate ships off: 0 skips in every window |
| "reseat off-cone takes tens of seconds" (CONTESTED) | the look-cone quiets ~50 frames after the last epoch bump; the city never converges at the FPV eye in 70 s (writes in 98 % of frames); every seat stalls 8.3 cm short |
| "1 Hz ephemeris sampling steps the sun ~1 texel/s (ESTIMATED)" | the mask churn is 8–19 % per frame at 0.0083°/frame and rate-independent — the rig's re-fit dominates the sun's own motion by ~3:1 |
| MESH_SUITE §12 "texture VRAM is the first cliff, then draw calls × the shadow pass" | at 24 resident models of one URL: +17 textures, +19 calls, no frame-time change — refuted at the count cap for repeated URLs (24 distinct GLBs untested) |
| `applyFeatureSeats` "~0.2 ms" | 0.7 ms per frame at the FPV eye (3.8 % of a 21.7 ms frame) |
| `reseatFeatureSamplesPerFrame` "16" (§2.5) | 64 features + 40 trees + 6 cells per frame (`tuning.ts`) |
| ground LRU "109.8 MB at rest" (T34, 2026-08-26) | 410 MB (the cap) at every Dnipro pose at DPR 2 high; 65–112 MB at `low`/`mid`; 66 MB on `/m` |
| any real-device number | STILL NONE — §11 |
| `mid`/`low` on real weak hardware | STILL NONE — the tier ladder here is the tier's WORK on an M3 Pro, not a weak GPU's frame |
| total VRAM · a dense-metro pose · prod render performance · `EdgesGeometry` per stock tile · the RC22 knobs | STILL NONE |

## 11. The phone (step 1b) — BOTH DEVICES RUN 2026-09-06 (rewritten from the device JSONs; the 2026-09-05 text is superseded)

Two real phones read the same seam the desktop harness reads (`window.__debugFeed.snapshot()`), so
the columns are §2's. **iPhone 17 Pro** (AWS Device Farm Remote Access session, Safari 26.3.1,
`tools/devicefarm/ios-baseline.mjs`, JSON `verify-shots/perf/devicefarm-farm1-2026-09-05T22-32-34.json`;
CSS viewport 402×714, `devicePixelRatio` 3, `hardwareConcurrency` 4, coarse pointer → deviceTier
`mid`, lean, DPR 1.25, shadow 1024 px, bloom off, `Apple GPU`; no `performance.memory`, no GPU timer).
**Pixel 6 Pro** (adb + `verify-perf-baseline.mjs 9444 --device --quick`, Android 16, Chrome 152,
Mali-G78, `deviceMemory` 8, CSS 411×794 @ 3.5, `hardwareConcurrency` 8 → deviceTier `mid`, lean, DPR
1.25; JSON `baseline-pixel6pro-dsf2-2026-09-05T23-13-05.{json,md}`; `performance.memory` present but
QUANTIZED — every cell reads 202 MB — no GPU timer). Desktop columns from §2 (`high`, DPR 2, M3 Pro)
beside them:

| pose | device | tier (governor) | dt p50 / p95 ms | fps | cpu p50 | draw | calls | tris | tex / geo | LRU bld/gnd/enr MB | models |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fpv | iPhone 17 Pro | mid | 17 / 17 (60 Hz cap) | 60 | 2 | 2 | 390 | 1.65 M | 119 / 284 | 4 / 47 / 37 | 3 |
| fpv | Pixel 6 Pro | mid | 27.5 / 81.9 | 30 | 1.3 | 2.8 | 223 | 1.47 M | 12 / 149 | – / – / 37 | 3 |
| fpv | desktop high | high | 23 / – | 43 | 2 | – | – | – | – | – | 3 |
| orbit | iPhone 17 Pro | low (demoted) | 91 / 112 | 11 | **84** | 1 | 109 | 740 k | 65 / 117 | 5 / 27 / 6 | 3 |
| orbit | Pixel 6 Pro | low (demoted) | 80.6 / 85.6 | 12 | **78** | 1.3 | 59 | 565 k | 20 / 45 | – / – / 6 | 3 |
| orbit | desktop high | high | 43 / – | 23 | **42** | – | – | – | – | – | 3 |
| city | iPhone 17 Pro | low | 97 / 200 | 10 | **91** | 1 | 158 | 602 k | 77 / 673 | 7 / 49 / 121 | 0 |
| city | Pixel 6 Pro | low | 79.8 / 97.8 | 12 | **78** | 0.9 | 40 | 317 k | 21 / 588 | – / – / 121 | 0 |
| everest | iPhone 17 Pro | low | 79 / 99 | 13 | **74** | 0 | 49 | 370 k | 36 / 65 | 0 / 31 / 0 | 0 |
| everest | Pixel 6 Pro | low | 88.2 / 91.9 | 11 | **86** | 1.0 | 24 | 317 k | 12 / 27 | – | 0 |
| /m | iPhone 17 Pro | low | 111 / 130 | 9 | **105** | 0 | 28 | 324 k | 16 / 37 | 0 / 78 / 0 | 0 |
| /m | Pixel 6 Pro | low | 100.6 / 112.6 | 10 | **109** | 0.9 | 25 | 317 k | 11 / 28 | – | 0 |
| /m | desktop mid | mid | 37 / – | 27 | **37** | – | – | – | – | – | 0 |

(Pixel bld/gnd LRU columns read 0 — a feed read the `--device` path does not resolve yet; recorded, not
interpreted. The Pixel's shadow legs at the FPV eye: `noUpdate` dt 22.8, `off` 22.1 → the shadow
pass is ~5 ms of the 27.5 ms Mali frame; the OSM/enriched arrival adds the rest.)

**The verdict the phones deliver.** The FPV eye is fine on both (the 17 Pro pinned at its 60 Hz
cap with 2 ms of CPU; the Pixel GPU-bound at 30 fps). **Every orbit pose is 9–13 fps on BOTH
phones and CPU-bound in the controls' down-raycast — 74–109 ms of main thread per frame** — and
the governor's demotion to `low` did nothing for it (a controls-bound frame ignores DPR). T79 is the
mobile lever; §7's correction below says where those milliseconds actually go.

**What did not classify — the iPhone kill ramp and the soak.** Three sessions (`19deb1e4-67fe-435e-8ad1-cecddd6a8d78`,
`c90c3fd4-e386-47bc-9b30-539bd7cb1d09`, farm3's): every `#f=` FPV page on the 17 Pro answered the
seams, took the boot marker, was READ at ~40 s — and then, 40–60 s after load, Safari's remote
debugger stopped answering for good (every later Appium command stalls 120 s). It happened with 6
seeded + 3 world helmets (the ramp's first step, twice), and with 0 seeds during the soak's
look-around; a SECOND plain `#f=` boot in one Safari session was read fine, so neither the reload
nor the models is the trigger — the page's own life at the FPV eye is ~40–60 s. Kill (jetsam) vs
JS hang is [OPEN]: the Device Farm console keeps each session's video and device syslog. Hypothesis
to test first: a late background load landing (the base earth's S5 8k texture swap ≈ +250 MB GPU;
the streaming LRU). The Pixel (Chrome, `performance.memory` quantized to 202 MB) did NOT die in six
boots of ~2.5 min each. Boots on the 17 Pro 7–11 s, settle 13–27 s. Device minutes spent ≈ 78 of
the 1,000-minute trial (a session bills 8–10 minutes even when stopped within a minute of RUNNING).

**Harness facts learned (all encoded in the tools):** `cloudflared` must run `--protocol http2` on
this network (QUIC to the edge is blocked → HTTP 530); the tunnel host changes per restart and
`wix dev --allowed-hosts` must follow it; JavaScriptCore rejects a statement list inside `return (…)`
("Expected ')' to end a compound expression") — probes are expressions; WebdriverIO's 3 retries turn
one dead page into eight device minutes (`connectionRetryCount: 0` + a stall classifier); Android
Chrome refuses `PUT /json/new` over adb ("Could not create new page") — the harness drives the tab
the recipe opened; the Pixel dozes with its screen off — `stay_on_while_plugged_in 7` before a run.
NOT run on the Pixel this session: `verify-temporal-stability --shimmer` (slice A material) and
`probe-cpu-profile --pose orbit` (moot — §7's correction attributes the frame without it).

## 12. Slice order after MEASURE — a dated SUPERSESSION of `T77_AUDIT_PLAN_2026-09-05.md` §1 / §4

The plan's ranking assumed the frame was shadow- and stream-bound. The numbers say the orbit frame
is controls-bound and the GPU frame is bloom-bound, and neither lever was in the ledger. The order
this session hands to the fix sessions (each READ-ONLY audit → sliced fix under the §8 harness list):

| slice | levers (plan # or NEW) | measured gain to claim | gate |
|---|---|---|---|
| **0. The orbit frame (NEW)** | NEW-1 the controls' raycast target (terrain-only / layers / memoised `heightAt`) · NEW-2 bloom (plan 13, promoted): half-res, fewer mips, or a cheaper pass · plan 4 `compileAsync` | orbit `frame.cpu` 31–47 → < 5 ms; GPU −13…−25 ms at DPR 2 everywhere | `verify-perf-baseline` re-run: orbit dt ≤ 20 ms at high; FPV GPU ≤ 15 ms **(SUPERSEDED 2026-09-06n by ruling T104: read as FPV FRAME TIME dt p50 ≤ 15 ms — met at 14.2, §17.1)**; byte-identical `high` look where the lever is a pass RESOLUTION change is an owner call (bloom at half-res is a pixel change) |
| **A. Shadows (quality)** | 1, 2, 3, then 12 | the shimmer §8: churn p50 0.185 → ≤ 0.05, control 0 incl. cascade refreshes, 4×/1× ≥ 3 | `verify-temporal-stability --shimmer` + the plan's harness list |
| **B. Seats** | 5 (dt eases), 6 (per-tile invalidation), NEW-3 the 8.3 cm stall (write gate vs ease), 7, 8 | §9: no stall floor, no writes 90 frames after quiet, city p95 < 0.1 m within 600 frames at the FPV eye, rejections → 0 | `verify-temporal-stability --reseat` |
| C. Streaming + workers | 9, 10, 11 | the city pose's 3,300-tile boot (63–68 s), the 1.9–4.8 epoch bumps/s, `frame.draw` 9 ms at the city | the model numbers here are the "before" |
| D. Mobile | 14, 15, 16 | gated by 1b (§11) | the phone |
| E. Later | 17–23 | unchanged | |

Owner calls this ordering does not make: whether bloom may change pixels at `high` (a half-res bloom
is visible), whether the controls' terrain-only raycast may change the orbit camera's rooftop
clearance behaviour (`cameraRadius` keeps the camera above whatever it raycasts — buildings today,
terrain after), and whether slice 0 ships before or after the owner's first look at these numbers.

## 13. Traps found this session (each cost time)

- **A boot-time governor demotion + a later `force()` = a mass composite rebuild inside the window.**
  At a heavy pose the boot stream's EMA is 100–160 ms; the governor demotes within ~10 s; a harness
  that pins the tier AFTER settling replays the tier's renderer half (DPR realloc + every composite
  rebuilt). Pin right after the seams appear.
- **`pgrep -f <pattern>` matches the shell that runs it** — a monitor loop `while pgrep -f x` never
  ends. Use a bracket in the pattern (`x[y]`).
- **Write artefacts after every cell.** The first full run lost eight boots to one stalled evaluate.
- **A rAF-driven in-page promise can stall for > 90 s while the page answers other evaluates in 50
  ms** — 3 of 27 boots; not reproduced by a 2.4-minute heartbeat at the same pose; a renderer crash
  was ruled out (`Inspector.targetCrashed` never fired). The sampler now has a watchdog and records
  `rafStalled`; a stalled boot is recorded and the target replaced. Cause UNVERIFIED.
- **The ProMotion display is 120 Hz** — a `dt` of 8.3 ms is the vsync floor, not headroom.
- **The `verify-ultra` Dnipro pose is heading 74° / tilt 88°** (`#p=` is lat,lon,alt,HEADING,TILT;
  its own struct names them the other way round): a near-horizontal 26-km view, 3,300 ground tiles,
  60+ s to quiet at DPR 2. Cited verbatim as the plan asked; do not read it as the 2026-08-22 city pose.
- **`__quality.force()` cannot produce a tier's shadow profile** (device-tier boot latch) —
  override `hardwareConcurrency` before boot instead.
- **Bloom's `enabled` is rewritten every frame; AO's on every tier apply** — a plain assignment lasts
  one frame; trap the getter for an A/B.
- **`dev-seed` accepts any https GLB URL** — the "upload once" step is unnecessary for a baseline; a
  hand-copied geohash for the eye cell was wrong (`u8vx7` → the encoder says `ub8gt`): import the
  app's encoder (Node 22.6+ strips the types).
- **The Node 24 PATH** is needed for `WebSocket` and for importing `.ts` from a script.

## 14. After the slices — 2026-09-06h (T80 built · slice A A0–A3 · slice B NEW-3, 5, 6, 4a–4e, 5c · the sunset fix; all on the owner's pose catalogue)

Everything below was run on the integrated tree of 2026-09-06h against `wix dev`, on the two
headless verify Chromes (:9333 / :9334, tier-V/D runs in parallel) and the owner's headed :9222
(tier-T runs alone). The poses are the catalogue's (`scripts/lib/poses.mjs`); the legacy five are
still in every table as `legacy-*`.

### 14.1 Shimmer (`verify-temporal-stability --shimmer`, the slice-A gate) — three findings that reframe §8

1. **The shimmer is the light FRAME, not the box.** At a frozen camera `fitShadowBox` is constant
   (`boundsSteps 0` in every stored leg); what moves is `sunLight.position`, so three's `lookAt`
   rotates the light-space basis with the sun and the whole texel grid re-projects: 0.29 texel/frame
   at the box edge for the harness's 0.0082°/frame step, against 0.0009 texel of true shadow-edge
   motion. Every flipped pixel in §8 was re-rasterisation. The base rig also re-rendered its depth
   map EVERY frame (`renderer.shadowMap.autoUpdate` never false in the loop) — the `noUpdate` cells
   in §3 (−1.7 ms fpv high, −6.9 ULTRA fpv, −5.4 city, −7.5 orbit ULTRA) were that prize.
2. **A demand-driven cascade 0 (A2: per-light `autoUpdate=false`, a key-swing quantum, a float64
   centre snap) cannot register at the harness's 2000 ms/frame step** — a 1-texel quantum at 8192²
   is 0.0099° of key swing ≈ 1.2 harness frames, so the rig refreshes almost every frame with a
   full-texel jump and reads WORSE (city.u1 0.116 → 0.189, everest.u1 0.077 → 0.147). At a
   realistic timelapse (`--step 200`, ×12 real time) it does exactly what it is for:

   | leg (ULTRA, rig quanta 1/1) | churn p50 | churn mean | frames with flips | 4×/1× (mean) |
   |---|---|---|---|---|
   | everest.u1 scrub | **0.0000** (§8: 0.077) | 0.0076 | 102 / 599 | **4.41** — tracks the sun |
   | city.u1 scrub | **0.0014** (§8: 0.116) | 0.0283 | 599 / 599 (seats still draining, see 14.2) | 1.93 |
   | fpv.u0 (base, identity) | 0.184 (unchanged) | 0.190 | 599 / 599 | 1.59 |

   Between refreshes the frame is deterministic; at a refresh the map moves by one texel (2.6 m at
   the Everest 8192² box, sub-pixel at those ranges). Real-time viewing (×1) refreshes every ~1.2 s.
   The metric's own gate ("p50 ≤ 0.05 at 2000 ms/frame") is inconsistent with ANY quantised rig —
   the slice's `churnMean` + `rateLinearity` on the mean are the honest numbers (A0).
3. **The metric bias (A1) made it worse at these values.** With the rig every-frame (`--rig 0,0`) and
   `ULTRA.shadowNormalBiasTexels 1.5 / shadowBiasTexels 0.6` the Everest scrub read 0.141 (§8: 0.077).
   PARKED at 0 (the 2026-08-27 pair `normalBias 0.45 / bias 0.6 m` ships); the tunables stay.
   Frozen controls: everest.u1 one popped frame in 239 (62 flips of 41 M); city.u1 ~0.001 p50 with
   the seat drain writing buildings every frame (14.2) — not the rig.

### 14.2 Seats (`--reseat`, the slice-B gate) — before → after

| leg | near residual at the end | collapses (4a, new) | sample rejections | city p95 / at the end | writes/frames |
|---|---|---|---|---|---|
| arrival (orbit) | **0.083 → 0.000 m** | (unmeasured) → **0** | +104 → 0 | 30.7 → 34.3 m (streaming transients; the leg's epoch bumps vary 30–72 run to run, T95) | 20 % → 60 % |
| drag (meshedit) | 0.083 → **0.000 m** | → **0** | 0 → 0 | 0.51 → 5.0 m | 8 % → 54 % |
| FPV eye + 6 models | 0.083 → **0.000 m**, near settled @1179 (was NEVER) | **4,277 → 1,779 (4b/4c) → 0 (4e)** | +1,210 → +1,324 (boot-only: 0 after quiet) | 39.4 / 3.4 → 25.1 / 4.1 m | 98 % → 100 % (the drain, then the 5c budget) |

The mechanism, browser-attributed (`scripts/probe-seat-loop.mjs`, `__globe.enrichedCellSeats()`):
at the FPV boot the terrain refines depth 7 → 8 → 9 → 15 → 17 → 18 and the cell plane goes
0 → 45 → 86 m; every plane move over the 45 m gate collapsed every feature of that cell to the
plane and re-drained it (889 + 968 collapses in two seconds), forever while tiles arrived. **4e**
carries a plane move into every held seat (`shiftCellSeats`) so the pair stays continuous; **4c**
holds during the plane's settle window; **4b** freezes-and-requeues instead of dropping to the
plane. The depth guard (4d) was built, measured (orbit arrival p95 0.00 → 33.5 m: a settled
traversal is COARSER than the finest tile it streamed through, and the seat must follow what is
drawn) and parked OFF. What remains is throughput: the one-time refinement of shifted seats drains
at the 5c budget; the city-wide "p95 < 0.1 m within 600 frames" gate is not met while tiles keep
arriving (4.8/s for ~70 s at DPR 2) — slice C material (streaming quiet), not a seat defect.

### 14.3 The sunset release (`verify-ultra-dusk.mjs --ladder`, the owner's Everest FPV pose)

Twelve rungs solved to geometric elevation with `SearchAltitude` (the +1.3° and −0.14° rungs land
within 0.7 s / 0.14 s of the owner's two frames). With the fix (ULTRA-only, byte-identical off):
the field is full at +0.9°, `shadow.intensity` fades on the shadow-length guard, the rig still
casts at −0.5° and stands down at −0.9° (gate −0.833°, the true upper-limb sunset), the ground
overlay retires 0.53 → 0.34 → 0.21 → 0.16 → 0 with the direct sun instead of holding 0.855 until a
cliff. The in-shadow ground's A→B brightening went **× 5.22 → × 1.16**. The luma band (a real CDP
screenshot — the in-page canvas read returned zeros, a fail-open probe now fixed) still shows a
×1.16 bump between +0.5° (67.0) and 0° (78.0): the overlay's last retirement plus the AUTHORED
rises in `ULTRA.exposureCurve` (1.116 → 1.150), `hazeCurve` (peaks at 0°) and `afterglowCurve`
(0.27 → 0.72) — the T66 taste knobs, the owner's to turn. 32/32 harness checks when run ALONE;
run alongside two other GPU-bound harnesses the ULTRA chip was demoted mid-run (the ULTRA gate is
frame-time-sensitive), which is the one tier-V harness that is NOT parallel-safe.

### 14.4 T80 — see the `t80` cells appended below by the timed run.

### 14.4 T80 — the half-resolution bloom is NOT the lever (timed, :9222 alone, `--post-ab --bloom-scale 0.5`)

| cell (`high`, DPR 2, 3200×1900) | dt p50 | GPU | bloom cost vs off |
|---|---|---|---|
| fpv on (stock, scale 1) | 23.0 ms | **25.2** | 13.1 ms |
| fpv `bloomCheap` — the mip chain at 0.5 (bright target 800×475, verified off the pass's own target) | 22.0 | **23.6** | 11.5 ms |
| fpv bloomOff | 15.6 | 12.1 | — |
| orbit on | 18.7 | 23.2 | 13.8 ms |
| orbit `bloomCheap` | 18.2 | 21.7 | 12.3 ms |
| orbit bloomOff | 11.3 | 9.4 | — |

Halving every mip target — 12 of the pass's 13 draws and all 12 clears — recovers **1.6 ms of 13**.
The bloom's cost is the one draw the scale cannot touch: the full-resolution additive blend INTO the
4× MSAA HalfFloat read buffer, and the second MSAA resolve it forces (`UnrealBloomPass.js:351-368`,
`RenderPass.needsSwap === false`). So the owner's "may bloom change pixels at `high`" ruling is moot
for THIS lever: a visible pixel change for 1.6 ms is not worth asking for. T80 stays OPEN with a new
direction — the composer's buffer contract (blend after the resolve / a non-MSAA bloom source, the
research's option g), which is a structural change to `GlobeCanvas.tsx`'s composer and touches the
`/m` PiP blit. `bloomScale` ships as a no-op at `high` (exact identity, unit-fenced) and 0.5 on
`mid` / `low` / lean; the `__quality.bloomScale(s?)` seam and the `bloomCheap` cell stay as the
instrument. Side reading: `frame.cpu` at the FPV eye is **4.4 ms (was 2.1)** and 1.3 at orbit
(was 42 → 1.2 after T79) — the slice-B drain budget and memo work are on the main thread now;
profile it in slice C (`probe-cpu-profile --pose fpv`).

## 15. Session 2026-09-06j+k — the six-worktree integration, the crash, and the numbers that survived it

**What was measured and what was not.** Session j crashed the machine before any measurement
(six worktrees × `wix dev` + headless Chrome on a 36 GB M3 → 120 GB swap). Session k integrated all
six slices on master under the resource budget (`conventions/verify.md` §THE RESOURCE BUDGET) and ran
the unit gates on the full stack; the browser gates ran on BASE alone and were then **blocked by a
CloudFront WAF 403 on `api.cesium.com`** (no Cesium terrain / OSM buildings from this IP — see the
DECISIONS line). Everything below is therefore either unit-level, model-level on a terrain-less
earth, or an implied number waiting for its timed run.

### 15.1 Unit gates on the integrated master (BASE + C-1 + T80-g + A-rest + T94 + sheets)

| Gate | 2026-09-06h | 2026-09-06k |
|---|---|---|
| vitest | 2,584 / 167 files | **2,692 / 172 files** (+108 tests, +5 files: `seatQuiet`, `resolvedComposer`, `frameFreeze`, `shadowArms`, `shadowRigOverride`) |
| `astro check` | 0 / 0 / 9 | **0 / 0 / 9** |
| knip | 0 | **0** (`memory_pressure` → `ignoreBinaries`) |

### 15.2 The sunset ladder on BASE, both rigs (Everest FPV, `verify-ultra-dusk --ladder`, headless :9333, **no terrain**)

| Rung (° geometric) | +3 | +2 | +1.3 | +1.06 | +0.9 | +0.5 | +0.2 | 0 | −0.14 | −0.5 | −0.9 | −1.5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ground luma, ULTRA on | 71.06 | 69.64 | 68.46 | 68.01 | 67.71 | 66.9 | 66.3 | 65.8 | 65.5 | 64.7 | 63.8 | — |
| ground luma, ULTRA off | 70.99 | 69.57 | 68.39 | 67.95 | 67.64 | 66.8 | 66.2 | 65.8 | 65.5 | 64.7 | 63.8 | — |
| field intensity, ULTRA on | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.657 | 0 | 0 |
| field intensity, ULTRA off | 1.000 | 0.790 | 0.594 | 0.527 | 0.482 | 0.370 | 0.286 | 0.230 | 0.191 | 0.059 | 0 | 0 |
| directK (both) | 0.620 | 0.479 | 0.356 | 0.341 | 0.335 | 0.258 | 0.195 | 0.180 | 0.141 | 0 | 0 | 0 |
| casting (both) | — | — | — | — | — | — | — | — | — | true | false | false |

- **T66 gate: worst rung-to-rung luma RISE 0.00 codes on both rigs** (the owner's "monotone
  non-increasing +3° → −1.5° within 2 codes"); worst brightening ×1.00 (the shipped rig measured
  ×5.22). The two rigs' luma series agree within 0.1 code — the LOOK is one model now (T96).
- **The base rig's field ramps from ~+2.5°** where ULTRA holds 1.000 to −0.14°: the length guard's
  reach on the base rig is its own 5 km box (`shadowBoundsM`), not the cascade ladder's 260 km, and
  an 8 km peak's sunset shadow leaves a 5 km box early. A ramp on geometry, in place of the old cliff
  (1.000 at +1.06° → 0.014 at +0.5°). The ladder's "still FULL at +0.9°" check is ULTRA-only; the base
  rig asserts "FULL at +3°, ≥ 0.4 at +0.9°". Mountain poses only — at Dnipro a +2° shadow is ~3 km.
- Both ladders: 12/12 rungs, chip state held for the whole ladder, LOOK on every rung, no console
  errors. ULTRA on 18/18 · ULTRA off 17/18 → 18/18 after the re-point (unrun).
- **Caveat:** these frames are a flat plain — the ion block starved the terrain. The light-model
  curves run on the base earth exactly as on terrain, so the luma gate stands; the casting rungs
  measured the rig without casters. Re-run with terrain before quoting the field series.

### 15.3 Implied, not measured (the timed runs are next session's first hour)

| Slice | Implied number | The run that decides |
|---|---|---|
| T80-g | post-geometry bandwidth ~873 → ~194 MB/frame at 3200×1900 ⇒ fpv GPU ≈ 14–18 ms (was 25.2; gate ≤ 15 — **re-stated on dt p50 2026-09-06n, T104/§17.1**) · rt1 ~243 → ~49 MB VRAM | `verify-perf-baseline 9222 --quick --only "^fpv" --post-ab` (the new `bloomMsaa` cell − `on` IS the lever) · `probe-bloom-path 9333` (signal vs noise floor at threshold 0) |
| C-1 | `frame.cpu` at the FPV eye 4.4 → ≤ 2.5 ms; `bufferSubData` off 56.7 % of self time; `rejectedDelta` ≪ +1,324; city p95 < 0.1 m within 600 frames of quiet | `probe-cpu-profile --pose fpv` · `verify-temporal-stability --reseat` (+ the `frozen/idleCells/deepResamples` counters) |
| BASE ruling 3 | base `fpv.u0` churn p50 0.184 → ~0, rate-linearity ≥ 3 | `verify-temporal-stability --shimmer --step 200` |
| T94 | `n/m poses re-shot BYTE-IDENTICAL` under `--freeze`; a `--compare --tolerance 0` that gates | `verify-visual-sweep --golden` then `--compare` in one boot |
| A-rest E3 / E1 / E2 | lever 12 close/keep by refresh attribution · lever 2 build/close by churn on `cascades:false` · A1 bias adopt/close | `probe-shadow-rig … --settle 0 --live` (3 min) · `--arms '{"ladderOff":{"cascades":false}}'` (25 min) · `--rig 0,0 --arms …` (30 min) |

### 15.4 The machine, measured while it worked

`resource-watchdog.log`: one dev server ≈ 1.1 GB (astro 943 MB + wix 166 MB); one headless Chrome
rendering the globe through the ladder ≈ 2.3–2.6 GB all-Chrome RSS (IntelliJ's CEF helpers
included); free memory 60–84 % throughout session k with IntelliJ at ≈ 20 GB RSS. Six of each — the
session-j shape — is 6 × (1.1 + 2.5) ≈ 22 GB on top of that, which is the freeze.

### 15.5 The block lifted (17:55) — the browser gates on the integrated tree, WITH terrain

> **k3 correction (owner):** the block lifted because the owner connected Proton VPN (Finland) at 17:55 — a
> block on the Dnipro ISP address, not a rate limit. The VPN is a precondition for every row below.

One house headless Chrome (:9333), strictly sequential; timed cells on a headed :9222 alone.

| Gate | 2026-09-06h | 2026-09-06k2 | Reading |
|---|---|---|---|
| ladder `--ultra 0` (BASE rig) | (no dusk model) | **18/18**; luma 108.9→98.7→89.2→86.9→85.5→81.1→78.8→78.3→77.5→74.9→72.9→68.4 | T66 worst rise 0.00 codes; field 1.000 to +0.5°, then 0.887/0.712/0.590/0.175/0 |
| ladder `--ultra 1` (ULTRA) | 32/32 (+0.5° 67.0 → 0° 78.0, ×1.16) | **17/18** solo; luma 73.8→73.1→70.6→68.9→67.8→67.4→68.4→68.6→70.1→**75.0**→73.0→68.4 | the 0° bump is GONE (68.6); the +4.9-code rise at −0.5° is the ULTRA field's release band 1.000→0.636→0 (T100) |
| charter | 85/85 | 84/85 → 83/85 → re-pointed (moon gate, RC7, pref precondition) | RC2 fade step 0.0248 / 0.0508 vs 0.05 (T100 again) |
| ultra | 29/29 | **30/30** solo | queued run's §1b = warm tile cache |
| shimmer `--step 200`, base `fpv.u0` | churn 0.184 | **p50 0.0000, control max 0.00000/239 frames**, rate-linearity 2.64 | ruling 3 landed |
| reseat, FPV eye | rejected +1,324, collapsed 0, end 0.000 | **rejected +0**, collapsed 0, end 0.000, city p95 34.4 / end 6.0 m (streaming) | C-1 at the eye as designed |
| reseat, orbit arrival | rejected 0, city p95 34.3 | **rejected +39,629**, city p95 29.7, end 0.000 | deep-answer deferrals thrash (T101) |
| sweep `--golden` (T94) | 30 % of pixels differ two rAF apart | **14/14 BYTE-IDENTICAL** | the byte gate exists; 3 harness defects fixed (measure-first, two-phase freeze, leg re-boot) |
| `probe-bloom-path`, west-sunset FPV | — | signal 0.16–0.32 % vs noise 0.41–0.49 % (threshold 0) | T80-g = the same picture |
| E3 lever 12, streaming city, 240 frames | — | 122 refreshes: **122 by EPOCH**, 0 extent, 0 swing/drift | lever 12 CLOSED |
| `frame.cpu` at the FPV eye (headed) | 4.4 ms | **0.7 ms** p50 | C-1 gate ≤ 2.5 MET |
| fpv GPU `high` DPR 2 (headed, one boot) | on 25.2 · off 12.1 · cheap 23.6 | **on 19.8 · `bloomMsaa` 22.5 · off 9.8 · cheap 18.4** | T80-g −2.7 ms (12 %); gate ≤ 15 NOT met; the blur chain is the remaining 8 ms |
| `fpv.u1` (ULTRA) GPU | — | on 21.4 · off 20.6 | — |

T92: the focal cone's fill (cone-off removes the wedge). T93: the base earth's limb shading between the
terrain's loaded reach and the horizon (ground-off keeps the band; far-plane ×8, skirt, earth toggles
do not move it). Both classified, neither fixed.

## 16. Session 2026-09-06l — E1 / E2 (the last A-rest calls), T80-h (the fused bloom), and what the GPU timer is actually measuring

Same tree as §15.5 plus T80-h (`scene/fusedOutput.ts`, `ScaledBloomPass.deferBlend`, `BLOOM.path`).
One house headless Chrome (:9333) for the shimmer runs, the sweep and the pixel probe; the timed
cells ran on the owner's headed :9222 (present mid-session; the harness opens its own tab). VPN on
(FI), ion 401.

### 16.1 E1 — lever 2 (the cascade ladder as the churn source): CLOSED

`verify-temporal-stability --shimmer --step 200 --only 'city\.u1|everest\.u1' --legs control,scrub,scrub4x --arms '{"ladderOff":{"cascades":false}}'`.
Sanity held: the arm log reads `cascadesCasting 0`; the mask did not shrink (city 0.308 → 0.308,
Everest 0.725 → 0.748).

| pose / leg | stock churnMean | ladderOff churnMean | Δ | speckle wtd stock → arm |
|---|---|---|---|---|
| city.u1 scrub | 0.0239 | 0.0296 | **+24 %** | 0.56 → 0.45 |
| city.u1 scrub4x | 0.0543 | 0.0553 | +2 % | 0.51 → 0.50 |
| everest.u1 scrub | 0.0075 | 0.0074 | −1 % | 0.60 → 0.59 |
| everest.u1 scrub4x | 0.0332 | 0.0316 | −5 % | 0.60 → 0.61 |

Rule (arest report): ≥ 50 % down ⇒ build the dispatch; within ±20 % ⇒ close. Nothing moved, the
city got worse. **The cascade ladder is not the churn's source; lever 2's `ShaderChunk` dispatch
is not built.** The 12 "structural failures" the run prints are the pre-existing `--step 200` shapes
(the sun moves 0.004° over 599 frames so "resample every frame" reads 100/599; the streaming ULTRA
city's control churn max is 0.003–0.006, not 0) — identical on both arms, so the A/B stands.

### 16.2 E2 — A1 (a metric texel bias with the rig every-frame): CLOSED, stays parked at 0

`… --rig 0,0 --legs control,scrub --arms '{"a1-05":{…0.5},"a1-03":{…0.3}}'`. Both writes landed
(`bias −1.9e-5 / −1.2e-5`, `normalBiasM 1.500 (clamped) / 1.008`).

| pose / leg | stock | a1-05 | a1-03 |
|---|---|---|---|
| city.u1 scrub churnMean | 0.0197 | **0.0417** (+112 %) | **0.0291** (+48 %) |
| city.u1 scrub speckle wtd | 0.73 | 0.86 | 0.71 |
| city.u1 **mask fraction** | 0.308 | **0.093** | **0.206** |
| everest.u1 scrub churnMean | 0.0122 | 0.0196 (+61 %) | 0.0162 (+33 %) |
| everest.u1 **mask fraction** | 0.721 | **0.380** | **0.578** |

Neither arm lowers `speckleWeighted` AND `churnMean` at either pose, and the shadow MASK collapses
(the bias eats contact — the peter-panning the rule warned about). **A1 stays at 0.** With E3 last
session, all three A-rest experiments are decided: levers 2 and 12 closed, A1 closed.

### 16.3 T80-h — the fused bloom path, timed (owner's headed :9222, `high`, DPR 2, 3200×1900; `--post-ab`, all cells in ONE boot)

The brief's premise was wrong and the source says so (`UnrealBloomPass.js:102-103,252-253`): the
bright target is `round(w/2) × round(h/2)`, so **no blur level ever ran at full resolution**; the
only full-resolution draws after geometry were the final additive blend (stock) and, since T80-g,
the copy into the single-sample buffer. T80-h removes BOTH: `ScaledBloomPass.deferBlend` stops after
the twelve chain draws and `FusedOutputPass` adds the mip-0 composite inside the output draw, before
the tone map. `resolvedTarget` is never bound (three never allocates it — another −49 MB at DPR 2).

Two instruments, and they disagree about the bloom:

| cell (base rig `fpv.u0`) | `frame.gpu` p50 | **dt p50** (frame time) | fps |
|---|---|---|---|
| bloomOff | 10.0 | **12.1** | 84 |
| **bloomFused** (ship default; `on` read 17.6 at boot) | 18.3 | **14.2** | 71 |
| bloomResolved (T80-g) | 19.8 | 15.4 | 66 |
| bloomMsaa (pre-T80g) | 22.4 | 19.2 | 52 |
| bloomCheap (fused + mip chain ×0.5) | 15.9 | 13.0 | 79 |
| **bloomMips** (fused, `nMips` 5 → 2: six tiny draws dropped, 3.5 % of chain pixels; second boot) | **12.0** (on 18.6) | **15.2** (on 15.0) | 66 (67) |

| cell (ULTRA `fpv.u1`) | `frame.gpu` p50 | dt p50 |
|---|---|---|
| bloomOff | 11.2 | 14.4 |
| bloomFused (on 19.0) | 19.3 | 15.9 |
| bloomResolved | 21.4 | 18.0 |
| bloomMsaa | 23.7 | 21.0 |

Readings:
- **T80-h = −1.5 ms `frame.gpu` / −1.2 ms dt on the base rig, −2.1 / −2.1 under ULTRA**, on top of
  T80-g's −2.6 / −3.8. From the pre-T80g chain the fpv frame time is **19.2 → 14.2 ms** (ULTRA
  21.0 → 15.9); bloom now costs **2.1 ms of frame time** (ULTRA 1.5).
- **The `frame.gpu` timer over-counts multi-pass chains on this stack (ANGLE/Metal, M3).** The
  `bloomMips` cell drops six draws that hold 3.5 % of the chain's pixels: `frame.gpu` falls 6.6 ms,
  frame time does not move (15.2 vs 15.0, fps 66 vs 67). A per-frame GPU duration cannot exceed
  the frame interval at 67 fps unless the timer brackets queueing/overlap between command
  buffers, which is what many small render passes produce. So `frame.gpu` remains a fine
  RELATIVE instrument for big single-pass changes (T80-g and T80-h read the same direction on
  both) and a wrong ABSOLUTE one for pass-heavy post chains; **the T77 gate "fpv GPU ≤ 15 ms" must be
  read on dt p50 for the bloom** — where it is MET (14.2 base, 15.9 ULTRA) — or re-stated. New
  backlog row T104.
- The picture: `probe-bloom-path --paths msaa,resolved,fused` under a T94 frozen frame (noise
  floor 0): west-sunset FPV **0 px on every pair** (byte-identical); cityscape rep 0 **fused vs
  msaa/resolved 8,004 / 7,957 px (0.13 %) at Δ ≤ 2, none > 3** — the half-float rounding the
  fused path no longer performs, no structure. (Cityscape rep 1 caught a 17.8 % frame change
  mid-ladder — a tile that landed under the freeze, the T102 shape — and the probe's verdict
  correctly read PROBE BLIND for that rep; the positive-control rung was added after this run.)
- What is left in bloom's 2.1 ms of frame time is the twelve chain draws (≈1.2 ms by the
  `bloomCheap` delta) plus the bright pass's full-res read. The remaining picture-preserving lever
  is pass COUNT (fewer render passes: a merged H+V, or dropping the redundant per-mip clears if the
  driver turns them into loads); anything else (fewer mips, half-res at `high`) changes pixels and
  is an owner ruling. T80 is worth closing as a frame-time lever.

### 16.4 The sweep before and after (T94 golden)

Pre (`pre-2026-09-07`, this tree before T80-h): **13/14 byte-identical** under the freeze; the one
red is `legacy-m` (the `/m` shell, 490 px = 0.091 %, max Δ 140) on a tree identical to k2's 14/14 —
a DOM animation escaping the canvas freeze, nondeterministic; backlog T103.

Post (`post-2026-09-06l --golden --compare pre-2026-09-07`, 7.5 min): **11/14 byte-identical** under
the freeze. The three reds: `legacy-fpv-eye` 1,148 px at Δ1 (the ease-step transient the probe also
saw, path-independent), `legacy-everest` 28,407 px (13 %) at Δ26 (a tile landing under the freeze —
T102's shape), `legacy-m` (T103). The golden compare fails on all 14 at tolerance 0 and is dominated
by the PRE run's own captures: the pre sheet shows the halftone half-revealed ground at
everest-orbit-52 (99.96 % differ), everest-fpv-sunset (85 %) and the zoom sweep (61 %) — those
poses had hit the `--quiet-s 8` cap (`quiet 8.1s!`) and were frozen mid-reveal, byte-identical AND
wrong; the post sheet shows the real terrain at all three. The self-check proves reproducibility,
not completeness (T95's boot-to-boot residual, plus the quiet cap). By eye the two sheets agree
everywhere else; the bloom's glow at everest-fpv-sunset and the west-sunset FPV reads the same.

### 16.5 The regression suites on the T80-h tree (house :9333, one after another)

| suite | result | note |
|---|---|---|
| `verify-rendering-charter` | **84/85** | the red is RC2 "and it FADES", step 0.0508 vs the 0.05 bar — T100's band, exactly as k2 |
| `verify-uxbatch4-s3` | **16/16** | both bloom-pass reads pass (desktop LEO on, `/m` lean off) |
| `verify-temporal-stability --shimmer --step 200 --only fpv.u0` | control churn p50 0.0000 · mean 0.0000 · **max 0.00075 (one pixel, one frame of 239; k2 read 0.00000)** · scrub p50 0.0000 | the base rig at the FPV eye still reads zero; the single flip is the Δ1 rounding class |
| `probe-bloom-path --paths msaa,resolved,fused` (2 runs) | cityscape: fused vs the others 0.13 % / 0.79 % at Δ ≤ 2, **0 px > 3**; msaa vs resolved 1,378 px Δ1 | the rounding residual; west-sunset uninformative (control 0 px — no visible bloom there) |

## 17. Session 2026-09-06n — the five owner rulings (2026-09-06m) executed

Same tree as §16 (master 71af0b7, the l session landed as PR #106). House headless Chrome :9333,
`wix dev` restarted with `.vite` aside, VPN on (FI), ion 401. Pre sweep `pre-2026-09-06n` at
`--quiet-s 25` (the §16.4 lesson: a golden shot under the 8 s cap can be byte-identical AND
mid-reveal).

### 17.1 T80 CLOSED as a frame-time lever · T104 — every T77 GPU cell re-read on dt p50

Ruling (2026-09-06m, option a): bloom is **2.1 ms of frame time** on the fused path (§16.3,
`bloomFused` 14.2 vs `bloomOff` 12.1 base; ULTRA 15.9 vs 14.4); the remaining pass-count lever
changes pixels and is NOT taken. `verify-perf-baseline` now prints a `dt−gpu (T104)` column in the
console line and the markdown table — `dt p50 − frame.gpu p50` in ms, flagged `!` when the timer
exceeds the frame interval, which a real per-frame GPU duration cannot do.

The §15.5 (k2) and §16.3 (l) fpv cells, re-read with that column (headed :9222, `high`, DPR 2):

| cell | `frame.gpu` p50 | dt p50 | dt−gpu | reading |
|---|---|---|---|---|
| k2 base `on` (T80-g) | 19.8 | 15.9 | **−3.9!** | over-count |
| k2 base `bloomOff` | 9.8 | 12.6 | +2.8 | sane (single big passes) |
| k2 base `bloomCheap` | 18.4 | 15.0 | **−3.4!** | over-count |
| k2 base `bloomMsaa` | 22.5 | 19.9 | **−2.6!** | over-count |
| k2 ULTRA `on` | 21.4 | 17.6 | **−3.8!** | over-count |
| k2 ULTRA `bloomOff` | 10.7 | 13.6 | +2.9 | sane |
| l base `bloomFused` | 18.3 | 14.2 | **−4.1!** | over-count |
| l base `bloomResolved` | 19.8 | 15.4 | **−4.4!** | over-count |
| l base `bloomMsaa` | 22.4 | 19.2 | **−3.2!** | over-count |
| l base `bloomOff` | 10.0 | 12.1 | +2.1 | sane |
| l base `bloomMips` (nMips 2) | 12.0 | 15.2 | +3.2 | the six dropped passes were TIMER, not frame |
| l ULTRA `bloomFused` | 19.3 | 15.9 | **−3.4!** | over-count |
| l ULTRA `bloomOff` | 11.2 | 14.4 | +3.2 | sane |

Every cell with the bloom chain ON reads `gpu > dt` by 2.6–4.4 ms; every bloom-OFF cell reads
`gpu < dt` by 2–3 ms (the CPU share). The pattern is the §16.3 diagnosis, now visible at a glance:
`EXT_disjoint_timer_query` on ANGLE/Metal brackets command-buffer queueing between the many small
post passes. **The T77 GPU gates are re-stated on dt p50** (`T77_AUDIT_PLAN` §12 row 0 and the
T80-g row, by supersession): "fpv frame time ≤ 15 ms at `high` DPR 2" — **MET**, 14.2 base (§16.3);
ULTRA 15.9 (the ULTRA rig has its own budget and no gate was ever written for it). `frame.gpu`
stays in the table as a RELATIVE instrument for single big passes (the shadow and geometry cells,
where it agrees with dt) and is never read alone for a pass-count lever.

### 17.2 T100 — the slid release band (ruling b), and what the ladder actually measures

**Frame challenge, found in the k2 ladder logs before the first edit.** At the failing rung (−0.5°)
the ULTRA field still read 0.636, but `groundOpacity`, `directShareK` and `directK` were ALL 0 —
the ground overlay had already retired with the key's extinction (`keyExtinctCurve` → 0 at −0.5°;
overlay 0.164 → 0 between the −0.14° and −0.5° rungs). The base rig retires the same overlay
(0.164 → 0, same digits) and reads a 0.00-code rise only because the base LOOK darkens ~40 codes
across the ladder (108.9 → 68.4) while the ULTRA look is nearly flat (73.8 → 68.4): a release of any
kind shows under the chip. The charter's RC2 fade step (0.0508) is measured with the chip OFF (the
charter's pref precondition), so an ULTRA-only band cannot move it.

**Built (as ruled):** `ULTRA.shadowReleaseStartSin` (sin +0.2° = 0.00349) and
`ULTRA.shadowReleaseBandSin` (0.0093 = `shadowFadeBandSin`, the width kept) → a fourth profile
`ULTRA_FIELD_RELEASE` in `StylizedTiles`, read by `fieldProfile()` on the CHIP's reach condition
(`ultraOn && shadowCascades.length > 0`, the T96 allow-list twin of the length guard's reach —
the slide replaces the geometric guard the ladder's 260 km reach makes inert); clamped so the band
can never end below the gate; published as `ultraLook().shadow.fieldBandTopSin`; the ladder gained a
T100 check on both rigs (19 checks now). Unit: `keyHandoff.test.ts` "T100 — the chip's slid
release band" (5 tests, computed from the same expression).

**Ladder `--ultra 1`, alone (house :9333, 5.3 min):** the band landed — `bandTop` 0.200°, field
1.000 (+0.5°) → 0.997 (+0.2°) → 0.637 (0°) → 0.254 (−0.14°) → 0 (−0.5°). **T66 still FAILS: worst
rise 4.23 codes**, series `… 0.5:67.4 0.2:68.4 0:69.3 −0.14:73.5 −0.5:75.0 −0.9:73.0`. The rise
moved from the −0.5° rung (4.94, k2/l) to the −0.14° rung (4.23): a field released while the key
still delivers `directK` 0.14–0.19 brightens the shadowed terrain by returning its direct arm, and a
0.53° band lands most of that in one rung; the endpoint (75.0 at −0.5°, overlay 0 and directK 0) is
the same number on both bands. **Ladder `--ultra 0`: 19/19, luma series identical to k2's digit for
digit** — the base rig is byte-identical, as the ruling required.

**A/B for the owner (same ladder, the tunables only; the ruled default is restored after):**

| arm | band top | band bottom | T66 worst rise | series 0.5 → −0.9 |
|---|---|---|---|---|
| k2/l (gate-anchored, −0.30° → −0.83°) | −0.30° | −0.83° | **4.94** at −0.5° | 67.4 68.4 68.6 70.1 75.0 73.0 |
| **ruled (b)**: +0.2°, width kept (→ −0.33°) | +0.2° | −0.33° | **4.23** at −0.14° | 67.4 68.4 69.3 73.5 75.0 73.0 |
| E-a: +0.2°, run down to the gate (width 1.03°) | +0.2° | −0.83° | **4.67** at −0.5° | 67.4 68.4 68.7 70.3 75.0 73.0 |
| E-b: +0.5°, run down to the gate (width 1.33°) | +0.5° | −0.83° | **3.82** at −0.5° | 67.4 68.5 69.2 71.2 75.0 73.0 |

**Reading.** The in-shadow band reads 67.4 at +0.5° and **75.0 at −0.5° on every arm** — the
endpoint is fixed by the overlay and the key both being 0 there — so the ~7 codes between them
have to be spread over the four rungs +0.5 / +0.2 / 0 / −0.14 / −0.5°; even a perfectly even spread
is 1.9 per rung, and every arm's worst step is the −0.14° → −0.5° rung, where the OVERLAY retires
(0.164 → 0 with `directShareK`) whatever the field does. The field band is not the lever T66 needs
at this pose; the overlay's retirement (`shadowDirectShareK` following `keyExtinctCurve`'s last
step, 0.138 → 0 over 0.36°) is — an owner call, since it is the F1 bound / the look's extinction
tail. **Shipped: the ruled (b) default** (start +0.2°, width 0.0093) — T66 4.94 → 4.23, base rig
byte-identical, the tunables carry the A/B. The ULTRA ladder reads 18/19 (T66) as k2/l read
17/18.

### 17.3 T101 — the per-cell `deepPending` hold (ruling a)

Built in `enrichedBuildings.ts` + the pure `deepAnswerVerdict()` in `lib/globe/seatQuiet.ts` (the
C-1 leaf; +8 tests, +6 wiring fences); `ENRICHED.reseatDeepPendingHold: true` (`false` = the k2
per-frame re-rejection, exactly). A deep answer the per-frame cap cannot resample this frame parks
its CELL (`deepPending`), the sampling passes skip parked cells, `refreshCellPlane` re-opens the
cell ON ENTRY and `touchCell`s it once; nothing is re-queued because nothing left its queue.
Counters `deepHeld` / `deepPendingCells` on `seatSettle().enriched`, `debugCounts()` and the
`__debugFeed` "buildings" provider; the reseat harness prints `deepHeld +N pendingCells@end N`.

`verify-temporal-stability --reseat` (house :9333):

| leg | k2 (C-1) | 2026-09-06n |
|---|---|---|
| orbit ARRIVAL `rejected` | **+39,629** | **+2** (`deepHeld` +2, `pendingCells@end` 0, collapsed 0, end 0.000 m) |
| arrival city p95 (streaming) | 29.7 m | 42.3 m (run 1) · **35.0 m** (run 2: rejected +1, `deepHeld` +1) — the streaming spread (h read 34.3) |
| FPV eye (models leg) | rejected +0, collapsed 0, end 0.000 | rejected +2, `deepHeld` +2, collapsed 0, near end 0.000 m, city end 6.8 m (streaming; k2 6.0) |
| drag leg | — | rejected +0, city p95 0.71 m, end 0.000 m |

### 17.4 T92 — the focal cone's FILL fades with the orbit tilt (ruling a)

`FOCALCONE.fillTiltFadeStartDeg` 50 → `fillTiltFadeEndDeg` 70, the pure `focalConeFillTiltK()`
(exactly 1 at/below the start, smoothstep to 0, NaN ⇒ 1, start ≥ end disables), the live orbit
tilt computed in `stepAimCones` with the `#p=` hash writer's own expression (never the 0.25°
deadband readout mirror), published as `aim().focalTiltDeg` / `focalFillTiltK`. 8 tests.
`probe-focalcone 9333 dnipro-cityscape`: tilt **74.904°**, multiplier **0**, fill mesh alpha **0**,
edge mesh alpha **0.700** — the wedge is two rays. The catalogue's orbit tilts: descent 29.3° → 54.9°
(0.85 on arrival), `legacy-orbit` 40° (1, exact), cityscape 74.9° (0).

### 17.5 T93 — the horizon band: RE-CLASSIFIED, then the aerial LIMB (ruling a, transposed)

**The k2 classification was wrong, and the toggles say so** (`probe-sheets 9333 everest-orbit-73`,
luma profile down the frame's centre third, rows as % of height):

| rows | base | ground-off | earth-off (7 spheres) | atmo-off (the dome) | far ×4 | overlay-off |
|---|---|---|---|---|---|---|
| 17–19 % (sky) | 205 | 186–197 | **88–92** | **88–92** | 92–97 | 205 |
| 22–28 % (THE BAND) | **84–89** | 52–64 (the earth's brown) | 84–89 | 84–89 | 84–89 | 84–89 |
| 29–45 % (near terrain) | 112–135 | 36–64 | 112–135 | 112–135 | 112–135 | 112–135 |

Hiding every sphere (the earth included) leaves the band; hiding the atmosphere dome alone leaves
it (and turns the SKY rows into the same grey — the dome is what paints 205 over far terrain that is
itself grey); the far plane ×4 leaves it; only hiding the GROUND replaces it, with the base earth's
brown. **The band is far terrain, drawn, at RGB ≈ (78, 90, 102).** Mechanism: `ftwAerial` hazes far
terrain toward `tint × ftwAirLevel(cosG)`; the lobe is normalised to 1 looking INTO the sun and
reads ~0.25–0.5 for a horizontal ray under a high sun (the pose is 14:56 local), so by ~100 km
(`hazeDistM` 55 km, `hazeMaxK` 0.72) the terrain has converged on an in-scatter DARKER than
itself. Since T96 the LOOK is on at `high`, so the band shows on both rigs — as the row said.

**The fix, the ruling transposed onto the surface that actually draws the band:** in the ONE shared
aerial function the LEVEL lobe relaxes toward 1 (isotropic — the sky's own brightness) past
`ULTRA.limbStartM`, fully by `limbEndM`; the tint keeps its cool/warm swing and every dusk term
is untouched; `mix(lobe, 1, 0)` is exactly the lobe, so everything nearer than the start is
byte-identical. First try 150/350 km lifted only the far third (rows 22–25 %: 88 → 92–105; rows
26–28 % stayed 84–89 — the darkening is complete by ~100 km); **shipped 40/120 km**: rows 22–28 %
**84–89 → 149–153**, rows 29–45 % 112–135 → 138–164 (the ramp, 40–120 km), the bottom fifth of the
frame (< 40 km) unchanged but for boot-to-boot Δ1 noise. Same-boot byte-identity for the near
field is by construction (`aerialLimb.test.ts` pins the geometry at `POSE.fovDeg` 38: the FPV
horizon 35 km, the descent 36 km, `legacy-everest` 16 km — none reaches the start; `everest-orbit-52`
at 21.8 km reaches ~63 km at sea level at the top of its frame = the ramp's foot, and the post
sweep measured Δ ≤ 6 on its top decile; the cityscape's horizon is 84 km, so its far field is on
the ruled surface too). By eye:
the dark slab with its hard edge is a blue-grey haze meeting the sky. The "halftone" at the
boundary is the far tiles' reveal, a separate shape; the zoom sweep's "black polygon wedge" is
FPV (< 40 km) and is NOT addressed by this term.

### 17.6 The regression suites on the n tree (house :9333, one after another)

| suite | result | note |
|---|---|---|
| `verify-ultra-dusk --ladder --ultra 0` | **19/19** | luma series identical to k2 digit for digit — the base rig untouched by T100 |
| `verify-ultra-dusk --ladder --ultra 1` | **18/19** | T66 4.23 (T100, §17.2) |
| `verify-rendering-charter` | **84/85** | RC2's fade 0.0508 (chip off; T100's tail, unchanged); the T93 limb moved none of the 85 sites |
| `verify-ultra` (alone) | **30/30** | the limb term does not move the ULTRA composites |
| `verify-temporal-stability --reseat` ×2 | arrival rejected +2 / +1, `deepHeld` +2 / +1, pendingCells@end 0, end 0.000 m; FPV eye rejected +2 / +0 | T101 |
| `verify-uxbatch4-s3` | **16/16** | |
| `probe-focalcone dnipro-cityscape` | 7/7 | tilt 74.904°, fill alpha 0, edge 0.700 |
| `probe-horizonband everest-orbit-73` | PASS (mechanical) | the far-plane geometry unchanged (reach untouched, as ruled) |
| post sweep `post-2026-09-06n --golden --compare pre-2026-09-06n --quiet-s 25` | **12/14** byte-identical (`legacy-city` Δ1 ease step, `legacy-m` T103) | the compare fails all 14 at tolerance 0: the ruled changes (73's far field, the cityscape wedge, orbit-52's top decile Δ ≤ 6) + boot-to-boot loading states (the descent's building layer, the cityscape's vector water fill, `legacy-everest` tiles) — T95's class |


## 18. Session 2026-09-07 — T100 (a): the ground overlay's own extinction tail (ruling 2026-09-06o)

### 18.1 What the four §17.2 arms actually said (re-read before the first edit)

The rung table of every arm carries `intensity` (the field), `groundOpacity` (the overlay), `directShareK`, `directK` and the band luma. Laid side by side at the rungs where the arms differ ONLY in the field:

| rung | k2/l field → luma | (b) field → luma | E-a field → luma | E-b field → luma |
|---|---|---|---|---|
| 0° | 1.000 → 68.59 | 0.637 → 69.29 | 0.886 → 68.65 | 0.666 → 69.17 |
| −0.14° | 1.000 → 70.07 | 0.254 → 73.52 | 0.724 → 70.34 | 0.511 → 71.19 |
| −0.5° | 0.636 → 75.01 | 0 → 75.00 | 0.223 → 75.01 | 0.142 → 75.01 |

At 0° the field falls 1.000 → 0.637 and the luma moves 0.7 codes; a single-light overlay scaled by the field would have moved ~6. The ground twins are a stock `ShadowMaterial`, whose mask is `mix(1, shadow, intensity)` PER LIGHT, and the ULTRA rig has three nested cascade lights over the band — so the delivered darkening of a texel under all three is `opacity × (1 − (1 − field)³)`: 0.952 of the opacity at field 0.637, 0.585 at 0.254, and exactly 0 wherever the field is 0. That predicts E-a's −0.14° rung at 70.3 (measured 70.34) and says two things the ruling needed: (1) the field band is nearly irrelevant to T66 until it is below ~0.5, and (2) **no field band that reaches 0 at −0.33° can let any overlay survive to the −0.5° rung** — which is why every arm read 75.0 there. The lever really is the overlay's own opacity, i.e. F1's bound on the key's authored tail, and the field band has to be non-zero at −0.5° for that lever to reach the rung at all.

### 18.2 Built

- `lib/globe/duskLight.overlayReleaseK(sinElev, startSin, gateSin, pow, levelAtStart)` — `levelAtStart × x^pow`, `x` the sun's position in the `[gate, start]` band (1 at the start, 0 at the gate), 0 at/below the gate, identity (0 everywhere) when `start ≤ gate`. `StylizedTiles` reads `shadowDirectShareK(max(ultraDirectK, tail))` under the chip's cascade REACH condition (`ultraOn && shadowCascades.length > 0`, the fence's third entry on that condition); `levelAtStart` is `keyExtinctCurve` read at the start once at boot, so the tail meets the key exactly where it begins and is clamped BELOW the key above it — the raking hour, the daytime overlay and the off-state are byte-identical. Published as `ultraLook().shadow.overlayTailK` and `ultra.shadow.overlayTailK` on the DBG chip.
- `ULTRA.overlayReleaseStartSin` sin(+0.2°) · `ULTRA.overlayReleasePow` 0.9 · **`ULTRA.shadowReleaseStartSin` back at its identity** (`shadowGateSin + shadowFadeBandSin` = sin −0.30°): ruling (b)'s slid field band is SUPERSEDED — the band is on the disc again on both rigs (full while the disc is whole, 0.636 at −0.5°, 0 at the gate). The knob and its clamp stay; `keyHandoff.test.ts` pins both the identity and the (b) shape.
- Tests: `duskLight.test.ts` +7 (the tail's contract) · `keyHandoff.test.ts` T100 block rewritten (5) · `duskShadeRatio.test.ts` +5 (a CHIP arm of the twin: the cascade mask product, the length guard with the gate as its horizon, the tail) · `fences.test.ts` +1 allow-list entry · `debugCatalog` +1 row. `verify-ultra-dusk`: the T100 check re-pointed (disc band on both rigs) + a T100 (a) check (tail under the key above +0.2°, under the key at −0.14°, > 0 at −0.5° with `directK` 0, 0 at −0.9°; base rig: 0 at every rung); its two positionals are now option-safe (T105).

### 18.3 The ladder, three exponents (house :9333, `--ladder --ultra 1`, alone, ~5 min each)

| `overlayReleasePow` | tail / overlay at −0.5° | series +0.5 → −0.9 | steps | T66 worst rise |
|---|---|---|---|---|
| (b), no tail (§17.2) | 0 / 0 | 67.4 68.4 69.3 73.5 75.0 73.0 | 0.9 0.9 **4.2** 1.5 −2.0 | 4.23 FAIL |
| 1.4 | 0.037 / 0.047 | 67.4 68.4 68.6 70.1 73.1 73.0 | 0.9 0.2 1.5 **3.0** −0.1 | 3.01 FAIL |
| 1.0 | 0.060 / 0.075 | 67.4 68.4 68.6 70.1 71.9 73.0 | 0.9 0.2 1.5 **1.85** 1.0 | 1.85 PASS |
| **0.9 (shipped)** | 0.068 / 0.084 | 67.4 68.4 68.6 70.1 **71.5** 73.0 | 0.9 0.2 1.5 1.4 1.4 | **1.48 PASS** |

Every rung above −0.3° is the l/n digit (the key rules there: tail 0.134 < `directK` 0.138 at −0.14°). The −0.5° rung is the only one the tail moves, and it moves it by only ~55 % of the opacity it adds (a 0.084 overlay reads −3.5 codes on a 75.0 composite, not −6.3): the band T66 samples is not fully under the cascade masks. That is why the model's 1.4 (chosen for a −0.5° rung near 71.6) landed at 73.1 and the value was walked down on the ladder. **19/19 on the ULTRA rig.** By eye (the ladder's own −0.5° shots, n vs now): indistinguishable — no shadow shape, no edge, the far ridges a shade deeper.

### 18.4 The regression suites on the (a) tree (house :9333, one after another)

| suite | result | note |
|---|---|---|
| `verify-ultra-dusk --ladder --ultra 1` | **19/19** | T66 1.48 (above) |
| `verify-ultra-dusk --ladder --ultra 0` | **19/19** | luma series identical to §17.6 digit for digit; `overlayTailK` 0 at every rung — the base rig untouched |
| `verify-rendering-charter` | **84/85** | RC2's fade 0.0508, chip off, unchanged since k2 (the tail is chip-gated and cannot move it) |
| `verify-ultra` (alone) | **30/30** | |
| post sweep `post-2026-09-07-t100a --golden --compare post-2026-09-06n --quiet-s 25` | see DECISIONS 2026-09-07 | the sweep runs the chip OFF, where the tail is inert |

Reversal: `ULTRA.overlayReleaseStartSin ≤ shadowGateSin` (the tail is 0 everywhere; the l/n overlay digit for digit).

## 19. The phone RE-MEASURE on the T79 / T80-g/h / C-1 / T101 tree — iPhone 17 Pro, Device Farm, 2026-09-07 (§11's iPhone column, re-read)

Same harness, same seam, same poses (`tools/devicefarm/ios-baseline.mjs --label t100a-remeasure`; JSON
`verify-shots/perf/devicefarm-t100a-remeasure-2026-09-06T21-25-38.json` + PNGs; session ARN
`…:session:69e9a004-b773-4e76-87d5-259381e752df/ed840495-122f-4465-82a0-cb803fc13d7a/00000`, ~10 device
minutes). Safari 26.3.1, CSS 402×714 @ 3, 4 cores, coarse pointer → deviceTier `mid`, lean, DPR 1.25,
shadow 1024 px, bloom off, `Apple GPU`. The Pixel 6 Pro was NOT attached over adb this session (its
half of the re-measure is still owed). §11's iPhone row beside today's:

| pose | §11 (2026-09-06) tier · dt p50/p95 · cpu | **today** tier · dt p50/p95/max · cpu p50/p95 | calls · tris · LRU bld/gnd/enr MB | read |
|---|---|---|---|---|
| fpv | mid · 17 / 17 · 2 | **mid · 17 / 19 / 36 · 3 / 5** | 287 · 0.98 M · 4 / 47 / 37 | the 60 Hz cap, unchanged; 25 hitches during the 15 s settle |
| orbit | **low (demoted) · 91 / 112 · 84** | **mid · 17 / 17 / — · 4 / —** | 101 · 0.54 M · 5 / 27 / 6 | **9–13 fps → the 60 Hz cap; T79 reached the phone** (the controls' raycast was the 84 ms) |
| city | **low · 97 / 200 · 91** | **mid · 20 / 49 / — · 4 / —** | 823 · 4.59 M · 7 / 49 / 134 | 10 → 50 fps at `mid`, drawing 7.6× the triangles the demoted `low` frame drew |
| everest | **low · 79 / 99 · 74** | **mid · 17 / 17 / — · 3 / —** | 81 · 0.39 M · 0 / 31 / 0 | 13 fps → the cap |
| /m | **low · 111 / 130 · 105** | **mid · 29 / 32 / — · 26 / —** | 31 · 0.33 M · 0 / 78 / 0 | 9 → 34 fps, and STILL CPU-bound at 26 ms — the `/m` shell has a main-thread cost of its own (T103's animations are the first suspect; `probe-cpu-profile` on `/m` decides) |

**Verdict.** The desktop slices reached the phone: every orbit pose that read 9–13 fps CPU-bound is
at (or, for the city, near) the 60 Hz cap with 3–4 ms of main thread, and the governor no longer
demotes. What is left on the iPhone is `/m` (26 ms CPU) and **T83, reproduced on this tree**: the
kill ramp's first step (6 seeded rows, reload the `#f=` FPV eye) took the boot marker and then
Safari's remote debugger stopped answering inside the 120 s window, twice — the same shape as §11's
three sessions. T80-g/h's −245 MB of VRAM did not change it, so "a late GPU texture landing" is
weakened as the hypothesis; kill (jetsam) vs JS hang is still [OPEN] and the session's video +
device syslog on the Device Farm console page are the next read (the API lists no artifacts for a
remote-access session while it is STOPPING). Boot 12.3 s, settle 15.1 s at the FPV eye.

## 20. The streaming measurement (T77 slice C, levers 9–11) — the descent leg's per-frame streaming columns, 2026-09-07

`verify-visual-sweep --ids dnipro-descent` now records per rAF frame, next to dt / busy / visible:
the three tilesets' download queue (items + jobs in flight), parse queue (items + jobs), LRU MB per
tileset, `inCache`, and the DBG feed's `frame.cpu` (the orchestrator's `update()` bracket) —
`leg.csv`, and a `streaming.json` read-out (busy / download-bound / parse-bound frames, the queue
peaks, the LRU peaks, `frame.cpu` and dt on parse frames vs quiet). Desktop `high`, chip off, house
:9333, `--quiet-s 25` (`verify-shots/sweep/streaming-2026-09-07/dnipro-descent/`):

| phase (per frame) | frames | dt p50 / p95 / max ms | `frame.cpu` p50 / p95 / max ms |
|---|---|---|---|
| quiet (no queue work) | 447 | 16.7 / 19.9 / 26.1 | 6.0 / 7.7 / 9.0 |
| download only (items or jobs, no parse) | 5 | 19.9 / 27.6 / 27.6 | 6.1 / 7.1 / 7.1 |
| parse (parse items or jobs in flight) | 164 | 17.8 / **37.6 / 78.4** | 6.8 / 27.5 / 28.4 |

Peaks: queue 749 (download 550 / parse 159) at 7–13 km on the way down; `inCache` 805 tiles; LRU
bld 8.8 / **gnd 308.0** / enr 207.3 MB. The streaming span runs 0.64 → 4.35 s of the leg; the
flight itself ends at 2.27 s, so the tiles trail the arrival by ~2 s. **Every one of the 22 hitches
(dt > 33 ms) is a parse-phase frame — none is download-only, none is quiet** — and in the eight worst
frames (dt 40–78 ms) `frame.cpu` reads 5–11 ms: the hitch is main-thread work OUTSIDE the
orchestrator's bracket, i.e. the tile parse landing (glTF parse in the loader callback) and/or the
first-draw GPU upload of the landed geometry and imagery. The download side keeps up (5 frames).

**What this decides.** Lever 10 (worker tile decode) is aimed at exactly the frames that hitch —
but only if the time is the PARSE and not the UPLOAD, which this column set cannot split; the one
measurement left before building it is `probe-cpu-profile` over the descent leg (the main-thread
profile attributes `GLTFLoader.parse` vs `WebGLRenderer` `texImage2D` / buffer uploads in the
parse-phase frames). Lever 9 (KTX2 user textures) is a memory lever — the ground imagery LRU at
308 MB is the big number here, and it is the imagery tiles, not the user models — so it is
re-aimed at the imagery path or parked. Lever 11 (instanced models) does not appear in this leg
(3 models). The Pixel's read of the same leg is owed with its re-measure.

## 21. Session 2026-09-07b — T83 classified (a jetsam kill), the Pixel re-measured WITH terrain, the descent and `/m` CPU profiles on both a phone and the desktop (lever 10 closed; T107 fixed; T106 opened)

Instruments new this session: `scripts/probe-cpu-profile.mjs --leg descent [--device]` (the profiler over the
owner's descent, every sample bucketed leaf → root into parse / compile / upload / seats / app / orchestrator /
render / controls / gc / program / idle, frames delimited by in-profile MARKERS — 16 rotating named 0.7 ms
spins the sampler sees in its own clock, alignment ±0.2 ms; the first version aligned by bracketing
`Profiler.start` and was off by 165 ms–3.3 s because the CDP command runs on the busy main thread) ·
`scripts/probe-memory-footprint.mjs` (the renderer's and the GPU process's physical footprint via
`/usr/bin/footprint`, V8's heap + ArrayBuffer backing store, an in-page walk of the three LRU caches and the
scene for geometry bytes and DECODED-IMAGE bytes, one tab, a pose sequence or a soak, the 17 Pro's profile) ·
`verify-perf-baseline --device` asks Cesium ion from the PHONE's page before the first boot (exit 3 on 403)
and FAILs a non-FPV cell that settles with `visible gnd 0`.

### 21.1 T83 — the iPhone 17 Pro `#f=` page: a JETSAM KILL at the WebContent per-process limit

The Device Farm API lists the artifacts once a session is COMPLETED (not while STOPPING). All four sessions'
device syslogs carry the same kernel line (device-local PDT; `…/ed840495…` is 2026-09-07a's run):

```
memorystatus: com.apple.WebKit.WebContent [556] exceeded mem limit: ActiveHard 2048 MB (fatal)
memorystatus: killing process 556 [com.apple.WebKit.WebContent] in high band FOREGROUND (100) - memorystatus_available_pages: 184783
memorystatus: killing_specific_process pid 556 [com.apple.WebKit.WebContent] (per-process-limit 100 176s rf:- type:app) 2097154KB
ReportSystemMemory: Process com.apple.WebKit.WebContent [556] killed by jetsam reason per-process-limit
```

| session | run shape (same-origin loads in ONE WebContent) | process age at the kill | kill relative to the last load |
|---|---|---|---|
| `19deb1e4…` (2026-09-05 farm1) | fpv · orbit · city · everest · /m · ramp fpv | 198 s | the ramp's fpv |
| `c90c3fd4…` (farm2) | fpv · fpv · ramp fpv | 88 s | the third load |
| `34f083b4…` (farm3) | fpv · soak fpv | 70 s | ~20 s into the soak |
| `ed840495…` (2026-09-07a) | fpv · orbit · city · everest · /m · ramp fpv | 176 s | **14 s** after the ramp's fpv navigation (21:30:28Z → 21:30:42Z) |
| `9b042dcb…` (this session, `--poses fpv --ramp 0 --soak-min 3`) | fpv (34 s) · soak fpv (the soak RE-BOOTS the eye) | **99 s** (pid 683, born at the first fpv 23:12:50Z) | **63 s** after the second load (23:13:26Z → the kill 23:14:29Z; 2,097,170 KB; 194,716 pages free) — the log's last row was 0.5 min at 23:14:23Z |

Facts the lines settle (five sessions, five identical lines): (1) a KILL, not a hang — `type:app`, `per-process-limit`, `2,097,154 KB`; (2) the
PER-PROCESS cap, not system pressure — 184,783 free 16 KB pages ≈ 2.9 GB free; (3) the Appium log shows every
pose navigation (about:blank → pose) went through the SAME WebContent (pid 556 was born at the FIRST pose,
21:27:46Z, and lived 176 s); (4) the kill came 14–25 s after the SECOND `#f=` load in that process, every time.

**The desktop twin** (`probe-memory-footprint`, house Chrome, the 17 Pro's profile — 402×714 @ 3, touch, 4 cores):

| run | rows (renderer footprint MB → · GPU process MB) | read |
|---|---|---|
| ONE fpv page, 3-min soak | 290 (boot) → **592** at 15 s (streaming) → 507–558 flat to 190 s → 424 after a forced GC · GPU 835 → 1030 → 916 | one FPV document is ~½ GB and does NOT grow; the JS heap is 60–140 MB, ArrayBuffers 130–137 MB, decoded images kept in `texture.image` 146 MB (16 textures — the 8k earth set), tile geometry 74 MB (405 geometries, 253 LRU tiles 4.4 / 46.5 / 36.9 MB) |
| fpv → orbit → city → everest → /m → fpv, DIRECT navigations | 557 (fpv) → the `#p=` hashes did not reload → **609 → 752** (/m) → **801 → 1,196** (fpv#2) → **926 after a forced GC**, ArrayBuffers 130 → 260 · GPU 820 → 1,686 | two earlier documents stay resident in the renderer after direct same-origin navigations (Chrome's back/forward cache holds them); the GPU process stacks ~470 MB per page load |
| fpv → /m → fpv WITH an about:blank hop (the farm tool's shape) | 527 → 410 → 568 → 473 after GC, ArrayBuffers back to 26 MB at each boot · **GPU 838 → 1,025 → 1,265 → 1,450 → 1,747 → 1,781** | the renderer frees the previous document, the GPU process does NOT: each destroyed page's WebGL context keeps its textures and buffers until the canvas is collected (Chrome loses the oldest context only at 16) — +940 MB over two extra loads |

**Reading.** On iOS the 2 GB is charged to ONE process. A single FPV page is ~½ GB of renderer-side memory on
Chrome; the second load in the same process is what dies on the phone, and on Chrome the GPU-side resources of
the destroyed document (≈ 470 MB per load) are exactly what lingers. Whether WebKit 26 keeps WebGL memory in
WebContent or its GPU process, the lever is the same and cheap: **release on `pagehide`** — `renderer.dispose()`
+ `forceContextLoss()`, `lruCache.unloadAll()` on the three tilesets, drop the 8k `texture.image`s — so a document
leaving the screen holds little; `Cache-Control: no-store` on the HTML disables the page cache outright (a
blunter tool). For users: a reload or a route change (`/` ↔ `/m` ↔ `/guide`) is the trigger, not time in the
FPV. The fifth session (stopped by hand at 23:16Z when the log went quiet — the tool's six `LOOK` calls each stall
120 s on a dead page, 12 min of billing per soak row; 13.2 device minutes) is the cleanest point: ONE prior FPV
page of 34 s, then the soak's second load, killed 63 s in at a process age of 99 s. **What is still
unmeasured: a SINGLE FPV page's survival on iOS** — in every session the first page was navigated away at
34–45 s (the tool's soak re-boots the eye before soaking), so "one page ≈ 1 GB, two ≈ the cap" and "one page
grows to 2 GB in ~100 s" are both still open; a `--soak-no-reboot` (soak the page already up) decides it in
one ~8-minute session. T83 stays OPEN with its lever named.

### 21.2 The Pixel 6 Pro re-measured — WITH terrain (the first run of the session was a bare sphere)

The owner caught it: `adb reverse` carries only `localhost:4321`, so the Pixel fetches ion over its OWN
network, and the Dnipro mobile address is blocked (T98 on the phone lane). The first run of the session AND
§11's 2026-09-05 Pixel run read `visible gnd 0` at every pose but the FPV eye — city and everest at 317,323 /
317,359 tris = the base sphere (294,144) plus chrome. Both are void for city / everest / `/m`. With the phone's
VPN on (exit FI, ion 401 from the page; `verify-perf-baseline-pixel6pro-t100b-vpn-…`, 19 cells / 7.7 min):

| pose | §11 (2026-09-05, bare sphere for 3 of 5) | **today, terrain on** — dt p50/p95 · cpu · tier | gate OFF (T79 A/B) | read |
|---|---|---|---|---|
| fpv | 27.5 / 81.9 · cpu 1.3 · GPU-bound | **21.5 / 40.6 · 3.5 · mid** (42 fps) | — | GPU-bound on the Mali-G78 (shadows on / noUpdate / off: 21.5 / 20.5 / 21.2 — the shadow pass is not the cost); 995k tris, enr 47 visible |
| orbit | 80.6 · cpu 77.9 | **16.7 / 18.6 · 2.4 · mid** (60 fps) | 119.4 (8 fps) | T79 is worth ~100 ms per frame on this phone |
| city | (bare) 79.8 | **16.8 / 20.6 · 15.2 · low** (58 fps) | 126.9 (8 fps) | at the cap; `frame.cpu` 15 ms while the city streams (settle 21 s); the governor demoted to `low` during the stream |
| everest | (bare) 88.2 | **16.7 / 20.4 · 2.5 · mid** (58 fps) | 154.8 (6 fps) | at the cap |
| `/m` | (bare) 100.6 | **59.3 / 63.4 · cpu 57.6 · low (16 fps)** → after T107 **16.6 / 18.7 · 1.1 · mid (60 fps)** | 171.9 (6 fps) | the terrain-less first run read 16.7 — the cost only appears WITH terrain: §21.4 |

### 21.3 The descent CPU profile — desktop `high` and the Pixel (lever 10's decision)

Desktop, house :9333, `--leg descent`, three runs (the ledgers agree within 2 %); the run before T107:

| bucket | whole leg (10.3 s of main thread, 471–541 frames) | HITCH frames (86 frames > 33 ms, 3.08 s) | the app frame above the library leaf (hitch frames) |
|---|---|---|---|
| **seats** | 2,488–2,871 ms · **27–28 %** | 493–511 ms · 16 % | `applyFeatureSeats` 424 · `update` 41 · `sampleAt` 18 |
| **controls** (raycasts) | 1,308–1,474 ms · 14 % | **670–748 ms · 24 %** | **`stepTiltGlide` 497** (the per-frame `getPivotPoint`, 27–33 ms in every arrival frame) · `rawHeightAt` 156 · the gated `_getPointBelowCamera` 14 |
| render | 1,008–1,140 · 11 % | 377–383 · 12 % | `resolvedComposer.render` |
| **upload** | 462–481 · 4.5–5.2 % | **373–384 · 12 %** | `bufferSubData` under `resolvedComposer.render` — the seat pass's rewritten attributes uploading at draw |
| orchestrator (`frame.cpu`) | 942–977 · 9.5–10 % | 200–223 · 7 % | traversal, `calculateTileViewError` |
| **app** | 857–872 · 8.4–9.3 % | **398–418 · 13 %** | `buildings.ts:110` (the OSM `load-model` handler: `EdgesGeometry` 109) 143 · `ringsOfFeature` 66 + `parseVectorTile` 24 (vector tiles parse on the main thread) · esri fetch 16 · `heightMemo` 14 |
| program / gc / idle | 869–919 / 81–113 / 164–689 | 181 / 63 / 24 | |
| compile | 90–94 · 0.9 % | 78–94 · 2.6–4 % | two frames near the start (57 + 16 ms `getProgramInfoLog`) — `compileAsync`, plan lever 4 |
| **parse (glTF, images)** | **104–122 ms · 1.0–1.3 %** | **16–21 ms · 0.7 %** | `createImageBitmap` (already async), `parseTile` 1.6 ms |

**Lever 10 (worker tile decode) is CLOSED, not built**: the glTF parse is 0.7 % of the hitch frames'
main-thread time. §20's "every hitch is parse-phase" was a correlation — the tiles landing TRIGGER the seat pass,
the height raycasts, the edge geometry and the uploads; those are the hitch. After T107 (the tilt glide's pivot at
a 500 ms cadence): hitches **86 → 64 frames**, hitch-window main thread **3.08 → 2.31 s**, `stepTiltGlide`
**497 → 74 ms**, controls 670 → 209 ms; dt p50 / p95 unchanged at 16.7 / 33.4.

The Pixel 6 Pro, same leg, terrain on (`--device`, 146 frames, 8.1 s of main thread): dt p50 / p95 / max
**16.7 / 316.7 / 848.5 ms**, 57 hitch frames carrying 6.73 s — **seats 2,460 ms (37 %): `enrichedBuildings.ts`
`load-model` 2,261** (the per-cell traverse, fingerprint pass, U8 recovery — served line 423 → source 1187+) ·
**app 1,857 ms (28 %): `enrichedMask` `vertexKeyToRunWithCollisions` 522 + `mapSegmentsToRuns` 282, `buildings.ts`
load handler 325, vector tiles 202** · controls 715 (`stepTiltGlide` 394 — at ~100 ms per raycast on this CPU
the 500 ms cadence still costs 3–4 hitches per glide; `rawHeightAt` 291) · orchestrator 316 · render 276 · gc 240 ·
**parse 91 ms (1.4 %)**. → **T106**: the enriched cell's landing work is the phone's descent hitch — bake the mask
runs / fingerprints into the sidecar (lever 7's shape), or slice the handler across frames, or both.

### 21.4 `/m` — the 26 ms (iPhone) / 58 ms (Pixel) was one call

`probe-cpu-profile --pose m --device` on the Pixel, terrain on, 8 s: **87 % of the main thread under
`controls.getPivotPoint`** — `stepMobile2dLocks` (StylizedTiles.ts) measured the live tilt with a centre-screen
raycast EVERY frame, before its own deadband; the ray walks the terrain TIN's triangles (`intersectTriangle`,
`getVertexPosition`, `checkGeometryIntersection` — no BVH; the T79 gate arms only inside `_getPointBelowCamera`).
On a terrain-less page the ray hit nothing, which is why the bare-sphere runs read 16.7 ms. Fixed (**T107**): the
deadband is judged from the ellipsoid normal under the camera (≤ 0.003° from the pivot's; the deadband is 0.2°),
the raycast runs only in frames that rotate. Pixel `/m`: **59.3 / 63.4 ms, cpu 57.6, tier low → 16.6 / 18.7,
cpu 1.1, tier mid** (16 → 60 fps). The iPhone's 26 ms (§19) is the same call; unmeasured after the fix.

**Gates for the session:** vitest 2,767/2,767 (176 files) · `astro check` 0/0/11 · knip 0 · post sweep
`post-2026-09-07b` 10/14 byte-identical under the freeze (Δ1 ease steps + T103), sheets read; the descent's
arrival pose identical to 0.02° pre vs post (the tilt glide lands where it did), its worst frame 99 → 82 ms.

## 22. Session 2026-09-07c — T83 re-shaped: ONE page dies on its own; the desktop look-around twin; the lean tile-cache caps + the `pagehide` release

### 22.1 The one-page soak — the page RELOADED at page age 129 s with no second load

`ios-baseline.mjs --poses fpv --ramp 0 --soak-min 3 --soak-no-reboot` (new flag: soak the fpv page ALREADY UP;
the soak now bails on the first dead SNAP instead of six blind 120 s `LOOK`s). Session
`…/7a86c553-dd48-4f99-8aaf-1a95a70c032e/00000`, iPhone 17 Pro 26.3.1, tier mid, DPR 1.25, lean:

| page age | soak min | booted | dt p50/p95 | LRU bld/gnd/enr MB | tex/geo | visible bld/gnd/enr |
|---|---|---|---|---|---|---|
| 38 s | 0 (read) | true | 17.0 / 17.0 | 4 / 47 / 37 | 117 / 283 | — |
| 68 s | 0.5 | true | 17 / 25 (max 126) | 6.7 / 80 / 125 | 269 / 781 | 14 / 134 / 45 |
| 99 s | 1.0 | true | — (no frames) | — | **2 / 5** | — |
| 129 s | 1.5 | **false** | — | 5 / 77 / 55 | 243 / 700 | 16 / 167 / 55 |

The 99 s row is a WebGL context LOST and RESTORED (`renderer.info` re-created; the tick skips while
`ctxLost`, so the frame series is empty) — iOS evicts the GPU side first; 30 s later the WebContent went
(the boot marker gone = Safari reloaded the page). So §21.1's "the kill comes 14–25 s after the SECOND
load" was the shape of a harness that navigated every first page away at 34–45 s: **a single FPV page
reaches the cap in ~2 min under look-around streaming.** The `pagehide` release stays right for the
multi-document shape (route changes, reloads) but cannot be THE lever.

### 22.2 The desktop twin under the same gesture — the caches drive it

`probe-memory-footprint.mjs 9333 --sequence fpv --soak 180 --every 4 --look --phone` (new `--look`: the farm
tool's synthetic 108 px touch drag every 4 s; the 17 Pro profile → tier mid, lean, DPR 3 → cap 1.25):

| t | renderer footprint | JS heap used/total | ArrayBuffers | geometry MB (count) | LRU bld/gnd/enr MB | tiles |
|---|---|---|---|---|---|---|
| 8 s (settled) | 661 MB | 92 / 177 | 173 | 96 (456) | 4.5 / 47.5 / 54.6 | 277 |
| 33 s | 1,090 | 275 / 330 | 390 | 196 (864) | 6.7 / 76 / 125 | 498 |
| 58 s | 1,318 | 307 / 357 | 525 | 264 (1,356) | 8.5 / 113 / 174 | 770 |
| 83 s | **1,540** | 319 / 388 | 639 | 292 (1,664) | 8.6 / 131 / 196 | 931 |

Still climbing at 83 s (the run was then contaminated by HMR reloads — src edits landed in the served
checkout; the standing trap, re-learned). ~3.9 MB of renderer footprint per cached tile-MB (the CPU
attribute arrays + the parse buffers + three's objects, GC-lagged). At `mid` the three caches may hold
256 + 256 + 320 = 832 MB of tiles and REST at 624 (the 0.75 floor): the cache design alone crosses
WebContent's 2,048 MB cap. A static page (§21.1's 510 MB flat) never fills them — that is why the first
twin read flat.

### 22.3 The lever built — `QUALITY.leanMobile` tile caps (T83, `lruCapBytesForLean`)

`lruBytesMB 48 · enrichedLruBytesMB 128 · groundLruBytesMB 112`, `min`-ed against the running tier's cap on
EVERY tier (including `high`'s null — the library's 0.4 GiB default is not a phone number); desktop
untouched (`lean === false` is the argument cap by definition; `quality.test.ts` +3). Sized above the FPV
working set (4.5 / 47.5 / 54.6 MB at the Dnipro eye) so the U2/A9 parse → full → discard loop cannot start.
Same twin, same gesture, 100 s:

| t | footprint | geometry MB | LRU bld/gnd/enr MB | tiles |
|---|---|---|---|---|
| 9 s | 692 | 96 | 4.3 / 46.5 / 54.6 | 271 |
| 39 s | 1,056 | 160 | 6.9 / 84.2 / 96.8 | 514 |
| 59 s | 1,164 | 163 | 8.3 / 84.2 / 96.2 | 548 |
| 89 s (peak) | **1,178** | 164 | 8.6 / 84.2 / 96.5 | 573 |
| 109 s | 1,109 | 165 | 8.6 / 84.2 / 96.3 | 518 |

The caches REST at 84 / 96 MB (= 0.75 × 112 / 128) from ~35 s; geometry plateaus at 163 MB (was 292 and
rising); the footprint oscillates 1.0–1.18 GB with the GC (802 MB after a forced collect) instead of climbing
through 1.54. The phone's base is lower still (no 8k earth set, −120 MB of images; a 1.25-DPR canvas).
No thrash signature (busy counts stay small, the tile count hovers 505–594).

### 22.4 The `pagehide` release (the multi-document half, `RENDERER.releaseOnPageHide`)

`GlobeCanvas`'s React cleanup is now a named idempotent `teardown()`; on `pagehide` it runs, then
`renderer.forceContextLoss()`; a bfcache `pageshow` (`persisted`) reloads. Same-document hash navigations
(`#p=` / `#f=`) never fire `pagehide`, so the pose/photo flows are untouched. Farm read: §22.5.

### 22.5 The farm reads — the A/B on the iPhone 17 Pro (Device Farm, 26.3.1, tier mid, lean, DPR 1.25)

**Caps ON + the `pagehide` release** (`--poses m,fpv --ramp 0 --soak-min 4 --soak-no-reboot`, session
`…/7db7216e-42c0-4687-bc29-909373823608/00000`; no `src/` edit landed while it ran):

| read | dt p50/p95/max | cpu p50/p95 | LRU bld/gnd/enr MB | visible | tex/geo | note |
|---|---|---|---|---|---|---|
| `/m` (boot 9.4 s) | 17 / 17 / 18 | **2 / 3** | 0 / 78.5 / 0 | 0 / 59 / 0 | 28 / 50 | **T107 on the iPhone: 26 ms (§19) → 2 ms** |
| `#f=` — the SECOND load in the process (boot 7.5 s) | 17 / 17 / 21 | 3 / 4 | 4.4 / 46.5 / 36.9 | 15 / 137 / 48 | 117 / 283 | alive (the b session's four kills came 14–25 s after this load) |
| soak 0.5 min (page age 55 s) | 18 / 33 / 55 | 9 / 15 | 6.7 / 80.1 / 96.2 | 14 / 134 / 45 | 269 / 707 | |
| 1.0 (86 s) | 18 / 38 / 90 | 9 / 12 | 8.6 / 84.1 / 96.9 | 16 / 155 / 65 | 295 / 894 | the caches REST at the lean floors |
| 2.0 (147 s) | 23 / 41 / 99 | 11 / 18 | 8.6 / 84.1 / 96.9 | 12 / 131 / 47 | 297 / 759 | |
| 3.0 (208 s) | 21 / 43 / 310 | 11 / 16 | 8.6 / 84.0 / 96.6 | 14 / 137 / 40 | 314 / 909 | |
| **4.0 (269 s)** | 26 / 47 / 156 | 15 / 22 | 8.6 / 84.2 / 97.0 | 15 / 155 / 57 | 302 / 975 | **alive, no tier change, 296 hitches** |

**Caps OFF** (the same tree with `leanMobile.*LruBytesMB` = 100,000 for the run, `--poses fpv`, session
`…` labelled `t83-nocaps`, 00:19–00:29Z; no `src/` edit during the run):

| read | dt | cpu | LRU bld/gnd/enr MB | visible | tex/geo |
|---|---|---|---|---|---|
| `#f=` (boot) | 17 / 19 | 3 | 4 / 47 / 37 | — | 119 / 285 |
| soak 0.5 (61 s) | 17 / 21 / 54 | 4 / 8 | 6.7 / 80.1 / **124.6** | 14 / 134 / 45 | 271 / 783 |
| 1.0 (92 s) | 19 / 30 / 96 | 5 / 8 | 8.6 / **123.9 / 187.1** | 16 / 155 / 65 | **458 / 1,407** |
| next LOOK | — | — | — | — | **the remote debugger stopped answering (page age ≈ 95–115 s)** |

Same phone, same pose, same gesture, same tree: **with the lean caps the page lives 269 s+ at the
floor (84 / 97 MB); without them it holds 124 / 187 MB and climbing at 92 s and is dead before 115 s.**
The b session's "kill 14–25 s after the second load" reads, in this light, as the second document's
cache filling on top of the first's — the `pagehide` release (§22.4) is the right thing for that shape
but was not isolated by its own A/B here (the m → fpv row above ran with both levers). Watch: dt p50
rose 18 → 26 ms (cpu 9 → 15) over the 4-min look-around with hitches at ~1 /s — the streaming cost
(T106's family), not memory.

The first one-page soak of the session (§22.1's 129 s) is now known to have overlapped `src/` edits
on the served checkout (Vite HMR reaches the phone through the tunnel); its context-loss row may be
a Fast Refresh remount. The A/B above is the clean pair.

**Session gates:** vitest 2,782/2,782 (177 files; +15 tests) · `astro check` 0/0/11 · knip 0 · pre sweep
`pre-2026-09-07c` 12/14 (cityscape Δ1 ease, T103), sheets read.

## 23. Session 2026-09-07d — the occlusion rulings executed (T110 fine bins · T112 best effort · T111 the skyline fold) and T106's two hot loops rewritten on integer keys

Owner rulings (2026-09-07d): T110 and T111 per the audit's recommendation; T112 "best effort even
below 50 %" — precise occlusion for long lenses on desktop, on mobile too unless it costs frames
(the mobile call left to the session). Instruments: `scripts/probe-skyline-fine.mjs` (new — the
fine profile's cost seams at the 200 mm zoom pose, `--lean` = the 17 Pro twin + a 4× CPU throttle),
`__globe.plan().sweep` (new ledger), `__globe.enrichedLoad()` + `__globe.enrichedBench(n)` (new —
the `load-model` handler's ledger and the in-page A/B + identity proof on the resident cells).

### 23.1 T110 — the FINE profile (0.25°, 1440 bins) at `dnipro-fpv-zoom-sweep` (fov 7.2° ≈ 200 mm)

Terrain is still marched at 120 bins (3 per frame, 40 frames) and folded into the fine profile;
meshes and trees write at 0.25°. The mesh phase is bounded by TIME (`PLAN.sweepBudgetMs` 3 desktop
/ 1.5 lean), resumable mid-mesh every 64 triangles, at least one chunk per frame.

| twin | build | meshes | sweep total ms | sweep frames | worst sweep frame ms | budget | coverage |
|---|---|---|---|---|---|---|---|
| desktop `high` | first | 23 | 39.9 | 16 | 3.3 | 3 | 1.00 |
| desktop `high` | after the streaming re-sweep | 60 | 55.8 | 22 | 3.2 | 3 | 1.00 |
| phone twin (lean, 4× throttle) | first | 30 | 251.5 | 139 | 3.2 | 1.5 | 1.00 (a second run: 0.49 first, 1.00 settled) |
| phone twin (lean, 4× throttle) | settled | 47–49 | 210–256 | 117–132 | 2.8–3.3 | 1.5 | 1.00 |

The whole mesh phase is 56 ms of desktop main thread spread over 22 frames; on the twin ~250 ms
over ~130 frames (≈ 2 s at 60 Hz) with the worst frame at the budget plus one 64-triangle window.
Before the 64-triangle check (256) the twin's worst frame was 10.2 ms. **Mobile keeps the full
0.25° (`PLAN.azBinsLean` 1440)** — the same precision, more frames, no hitch; the carry policy
keeps the previous profile published meanwhile.

The payoff, read off the mirror at the pose: **199 of 1,440 fine bins (14 % of the horizon) read
more than 0.5° lower than the 3° box-max around them** — azimuths the old profile over-blocked
(a mast or a tree raising a whole 3° bin). Frame-time p50/p95 during the build window: 16.6 / 19.6
ms desktop (the > 33 ms frames are the boot's own compile frames, not the sweep).

### 23.2 T112 — best effort, seen in the wild

The `--lean` run's FIRST build read coverage **0.488** (terrain tiles still landing west of the
eye) and was PUBLISHED — under the old A1-16 floor it would have been withheld whole; the streaming
re-sweep (T109) brought it to 1.00 six seconds later. Every consumer now answers per bin: exact
where swept, `null` (a "—" row, a dotted trace, a plain radar span) where not.

### 23.3 T111 — the skyline fold, verified at the seams

`legacy-fpv-eye` (a street at 1.7 m, skyline > 3° in 1,425 of 1,440 bins, max 78° at az 207):
`__globe.dayArcsFold()` → sun 102 / 145 vertices folded, moon 137 / 145. HUD rows at
`t=1787136050000` looking 196°: `☀ SUN 203° SW · +52.3° BEHIND SKYLINE` · `☾ MOON 125° SE · −0.8°
BEHIND SKYLINE`, both edge chips `fh-chip--behind`; the rail's sun curve dashed over 11:00–13:00 and
after 15:00 (`verify-shots/t111/03-street-sun-behind-hud.jpeg`); the `/m` dock the same
(`04-m-street-dock.jpeg`). At the zoom pose's sunset instant the badge does NOT fire for a sun under
the bare −0.13° dip (the `skylineAltDeg > 0` refinement: "set", not "behind a building").

### 23.4 T106 — the enriched cell's `load-model` handler: EdgesGeometry + the string-keyed mask, replaced

The Pixel profile (§21.3, re-read by leaf): three's `EdgesGeometry` 1,832 ms + the string-keyed
`vertexKeyToRunWithCollisions` / `mapSegmentsToRuns` 873 ms of the 6.73 s hitch window — both
pure functions of the cell's floats. `lib/globe/fastEdges.buildFastEdges` replicates three's
algorithm on integer keys (0.1 mm rounded triples → open-addressed ids; directed edge keys
`ua·N+ub`; the same normal math, the same emission order) and reports the SOURCE vertex per
endpoint; `enrichedMask.segmentRunsFromSources` attributes segments from those indices with the
same party-wall rules on exact-bit keys. `test/lib/globe/fastEdges.test.ts` pins element-identity
against the real `EdgesGeometry` and the string mask (prisms, party walls, gables, degenerate
slivers, indexed and soup, −0). Node bench (20,400 tris, full-precision metres): edges 42 → 13.6 ms,
mask 25 → 13.4 ms.

**In the page, on the resident cells at the descent's arrival pose (`__globe.enrichedBench`):**

| twin | cells | tris | `EdgesGeometry` ms | fast ms | string mask ms | int mask ms | mismatch |
|---|---|---|---|---|---|---|---|
| desktop `high` | 33 | 353,897 | **526.9** | **56.5** | **239.5** | **17.1** | 0 / 0 |
| phone twin (lean, 4×) | 17 | 178,812 | **865.2** | **113.7** | **455.5** | **32.7** | 0 / 0 |

9× and 14× on the desktop, 7.6× and 14× on the twin, with zero element mismatches across 50 real
cells. The handler ledger (`__globe.enrichedLoad()`) for the same landings: desktop 33 cells →
edges 61 ms · mask 26 ms · handler total 112 ms · worst cell 10.6 ms; twin 17 cells → 141 · 96 ·
287 · **worst cell 65 ms**. Projected on the Pixel's 2,705 ms of the two items: ~270 ms. What is
left of T106 is the biggest cell's WHOLE handler in one frame (the 65 ms above under 4×) — the
two-phase slice (b) is the next lever, with the fingerprint pass (~0.3 s Pixel) inside it.

**Session gates:** vitest 2,829/2,829 (179 files; +47) · `astro check` 0/0/11 · knip 0 · pre sweep
`pre-2026-09-07d` 12/14 (legacy-fpv-eye Δ1, T103) · post sweep `post2-2026-09-07d` 12/14 (same
two), sheets read: identical tile counts per pose (descent 6,846,298 tris both runs, cityscape
3,736,108, zoom-sweep 674,596). The `--compare pre` diffs are the streaming/LOD noise floor (a
whole imagery tile on `legacy-everest`, 13 %; the descent's end state, 12 %) plus the intended
radar-fan and day-arc changes; the first post run was contaminated by `src/` edits (HMR) and was
discarded. The edges' byte-identity is proven in-page, not by the sweep.

## 24. Session 2026-09-07e — T106's tail: the two-phase `load-model` handler (slice b), measured through the descent on both twins

The last of T106 was the biggest cell's WHOLE handler in one frame (§23.4: 65 ms on the phone
twin under 4×, 10.6 ms on the desktop). The handler is now two phases. Phase 1, synchronous in
`load-model`: the cell record, the material swap, the F1 fill birth, the trees — µs. Phase 2,
one unit per mesh on a deferred queue (`lib/globe/loadQueue`), drained by `update()` under
`ENRICHED.loadBudgetMs` per frame (6 desktop / 3 lean, keyed on `lean` like the tile caches and
the plan sweep; live seam `__globe.enrichedLoadBudget(ms)`), NEAREST cell first (the download
queue's own look-biased law), a mid-flight unit sticky so one builder's tables are live at a
time. The unit's phases, in the order the §4a pristine contract needs: **0** the crease edges
(`createEdgesBuilder` — `fastEdges` made RESUMABLE: vertex keying and the triangle walk in
256-item chunks against the deadline; `buildFastEdges` is the same builder stepped once, and
`fastEdges.test` drives it one item per step and demands the one-shot's floats) — on
completion the `LineSegments` is added with ITS OWN F1 birth stamp (`frameNow()`, T94's
clock); **1** the per-building attribution (`createSegmentRunAttributor` — `segmentRunsFromSources`
made RESUMABLE the same way); **2** CSR + edge spans + the bounds pad (atomic, small); **3** the
feature fingerprints from the pristine floats (resumable by run); **4** the part object + the
footprint locate if the cell got located while the unit waited (resumable by feature; a locate
on the phase-4/5 frame boundary is finished atomically in 5); **5** the registration (atomic):
RC9 banked seats, `cell.parts.push` + `partByMesh.set`, the override re-apply, `touchCell`.
`dispose-model` cancels by scene. Nothing writes a mesh's buffers before 5 — the seat passes
walk only registered parts — so the pristine capture is still a straight copy.

**The instrument:** `scripts/probe-load-phase2.mjs [--lean] [--budget ms]` — boots the
catalogue's `dnipro-descent` start, drives the owner's descent (`requestFly` → the arrival
targets → quiet), records every rAF dt, samples the queue every 250 ms, then reads
`__globe.enrichedLoad()` (the ledger: phase-1 `handlerMaxMs`, per-unit `edgesMaxMs` /
`maskMaxMs` / `registerMaxMs`, the per-DRAIN `deferredMaxMs`, totals, units done/cancelled),
`__globe.enrichedBench(50)` (the identity proof) and `__globe.enrichedSeats()`. `--budget 1e6`
drains the whole queue in one frame — the pre-slice shape, the A/B's B (several cells' handlers
batch in one frame exactly as several `load-model` events did).

### 24.1 The A/B — the same leg, the budget vs the one-frame shape

| twin | units (cells) | budget | phase-1 `handlerMaxMs` | worst edges step | worst attribution | worst registry | **worst DRAIN** | drains | drain total | frames p50 / p95 / p99 / max | >33 ms | >50 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop `high` | 154 | 1e6 (one frame) | 0.4 | 8.8 | 4.3 | 2.8 | **30.3** | 33 | 460 | 16.8 / 29.0 / 53.3 / 101.4 | 20 | 5 |
| desktop `high` | 172 | **6** | 0.4 | 4.8 | 2.3 | 4.6 | **8.5** | 82 | 495 | 16.8 / 24.7 / 50.4 / 68.1 | 10 | 5 |
| phone twin (lean, 4×) | 45 | 1e6 (one frame) | 0.9 | — | — | — | **85.9** | 17 | — | 17.8 / 71.6 / 176.5 / 418 | 38 | 20 |
| phone twin (lean, 4×) | 52 | **3** | 0.8 | 3.9 | 7.0 | 3.8 | **8.0** | 254 | 853 | 18.5 / 50.8 / 152.1 / 254.5 | 49 | 17 |

The number the slice exists to bound: the worst drain 30.3 → **8.5 ms** on the desktop and
85.9 → **8.0 ms** on the twin (the brief's bar was < 16). The drain's overshoot over the budget
is one atomic phase (2 or 5, a few ms) plus one 256-item chunk. The descent's remaining frame
tail (twin p95 51, max 255) is the streaming's OTHER work — §20's parse-phase frames, the seat
drain, the ground composites — not this handler: with the budget the >33 ms count fell 20 → 10 on
the desktop and the p95 71.6 → 50.8 on the twin, and what is left does not move with the budget.
Identity: `enrichedBench(50)` **mismatch 0 / 0** on every run (desktop 539,906 tris, twin
509,774–532,239). The registry populated as before: desktop 80,771 features over 180 cells,
twin 21,144–23,093 over 55–56, seats sampled on both. Two intermediate cuts are on record because
they named the next atomic cost each time: attribution atomic → twin worst drain **18.0** (the
biggest cell's 18 ms attribution); the locate atomic → **15.2** (13.7 ms of `ecefToGeodetic` for
~2,000 footprints of a cell located while its unit waited); both resumable → 7.6–8.0.

### 24.2 The cost of the budget — how long a landing's edges and seats take to arrive

The queue drains BEHIND the landing: on the desktop the descent's 172 units peak at 109 pending
at +2.1 s and reach 0 at +2.9 s (~1 s behind the last tile); on the twin the 52 units peak at
+3.0 s and reach 0 at **+7.4 s** — ~4.4 s of drain at 3 ms a frame for a whole-city landing
(853 ms of work over 254 frames). During that window an unregistered cell's buildings sit on the
CELL plane (the per-cell seat is phase 1 and applies at once) without per-feature seats or crease
edges, nearest cells first. That is the trade the slice makes on purpose — a 4 s wave of edges
across the far city against 86 ms hitches — and `loadBudgetMsLean` is the knob: 4 ms would cut
the twin's drain to ~3 s. Owner taste call; the seam is live.

### 24.3 The post sweep — the compare diffs classified with an OLD-code pair

Post sweep `post-2026-09-07e`: 13/14 self-checks (the same `legacy-m` row, T103), identical
triangle and draw-call counts per pose (cityscape 3,736,108 / 855, the descent 6,846,298 /
1,142, legacy-city 7,068,885 / 1,553 — pre and post to the triangle). `--compare pre-2026-09-07e`
at tolerance 0 reports diffs on every pose (cityscape 19.4 %, descent 10.2 %, legacy-m 7.0 %,
legacy-city 4.5 %), so the noise floor was measured instead of assumed: at a JPEG-honest
threshold (Δ > 24 on the 1600-px capture, per 8 × 5 screen cell) the pair of two OLD-code boots
`post2-2026-09-07d` vs `pre-2026-09-07e` (both the `44743d3` tree) differs by the SAME cells at
the SAME magnitude as this session's pre vs post — cityscape 3.98 % vs 4.15 % (the vector water
overlay at the right 39–49 %, the city band 8–10 % of per-tile tone seeds that follow load
order), the descent 0.07 % vs 0.17 %, legacy-city 0.03 % vs 0.05 %. The crease edges' identity
is proven in-page (`enrichedBench(50)` mismatch 0 / 0), never by the sweep.

### 24.4 The flip bank under the phone caps (RC20 / T34 / T83's open watch)

`scripts/probe-flip-bank.mjs` (new): `/m` as the phone twin (touch + 402×714 @3 + 4 cores ⇒
`lean` true, tile tier `mid`, the bank ON), satellite ground, the cab leg's street pose at noon;
two 2D → FPV → 2D cycles, Esri `World_Imagery` REQUESTS per leg through CDP Network (the SW
cache answers some of them — request count, not bytes) and `__globe.u2().lru.ground`:

| stage | cached MB | floor MB | cap MB | items | bankMsLeft | requests |
|---|---|---|---|---|---|---|
| 2D boot, settled | 78.5 | 84 | 112 | 78 | 0 | 550 (boot) |
| cycle 1 → FPV | 112.7 | **96** (bank armed) | 112 | 112 | 37,768 | **566** |
| cycle 1 → 2D | 96.5 | 96 | 112 | 96 | 39,499 | **670** |
| cycle 2 → FPV | 112.6 | 96 | 112 | 112 | 38,766 | **172** |
| cycle 2 → 2D | 94.5 | 96 | 112 | 94 | 39,499 | **177** |

Overlay rebuilds 1 (the one legitimate boot raise), never again. The reading: under T83's
112 MB phone cap the FPV working set ALONE fills the cap (112 items at rest), so the first flip
evicts the whole 2D set and the way back re-fetches it (670 — more than the boot, the sticky
512 composite is dearer); the bank's raised floor binds on `minHeadroomBytes` (112 − 16 = 96 MB,
not `bankFrac`'s 103) and retains enough of each set that the SECOND cycle costs 172 / 177 —
the "churn falls but does not vanish" shape the RC20 note predicted, 3.8× down on the cold
cycle. The remaining lever is capacity (`QUALITY.leanMobile.groundLruBytesMB` 112 ↔ the
jetsam headroom T83 bought) or a mode-aware victim choice; both are the T34-vs-T83 trade
(network vs memory) and an owner call, not built here. On the desktop (`high`) the bank is
OFF by design and the cache never rests at its floor (M13).

## 25. Session 2026-09-07f — T106 read on the Pixel 6 Pro; the OSM handler's edges were on three's slow path; the two-phase OSM handler; the GC in the builders; the thermal trap

The device is back (Pixel 6 Pro, Android 16, Chrome 152, Mali-G78, tier `mid`, lean, DPR
1.25, the phone's VPN exits FI; ion 401 asked from the phone's page, terrain visible
`gnd 65/83` at start/end — the T98 gate, now asserted by `probe-load-phase2 --device` itself).
Every number below is the owner's `dnipro-descent` (`scripts/lib/poses.mjs`) on the real phone
over adb (`tools/devicefarm/README.md` §B), the desktop twins only where named.

### 25.1 T106 as shipped (slice b, 2026-09-07e) — the Pixel's read, before this session's edits

`probe-cpu-profile --leg descent --device` (483 frames, 10.5 s of main thread), against §21.3's
pre-T106 profile of the same leg on the same phone:

| | §21.3 (2026-09-07b, pre-T106) | 2026-09-07f boot (T106 a+b shipped) |
|---|---|---|
| dt p50 / p95 / max | 16.7 / **316.7** / 848.5 | 16.7 / **50.0** / 399.7 |
| hitch frames (> 33 ms) · main thread inside them | 57 · **6.73 s** | 66 · **3.93 s** |
| `enrichedBuildings.ts` `load-model` in the hitches | **2,261 ms** | gone from the callers (phase 1 = 0.6 ms max; the units drain budgeted: `fastEdges` `walk`+`run` 268 ms over the WHOLE leg, `keyVertices` 90) |
| `enrichedMask` string keying | 522 + 282 | 0 (integer keys) |
| **the OSM `buildings.ts` handler** | 325 | **410 ms in the hitches — three's `EdgesGeometry`, 361 ms self over the leg** |
| vector tiles (`ringsOfFeature` + `parseVectorTile` + `tileLocalToLonLat`) | 202 | 262 |
| controls (`rawHeightAt` · `stepTiltGlide`) | 715 (291 · 394) | 519 (294 · 194) |
| seats (`applyFeatureSeats`) | — | 138 in the hitches (486 whole leg) |
| compile · parse · gc (whole leg) | — · 91 · 240 | 68 (0.7 %) · 122 (1.2 %) · 178 |

The phase-2 ledger on the device (`probe-load-phase2 --device`, new flag: attaches to the
phone's tab, no emulation, asserts `gnd > 0`): 70 units, `handlerMaxMs` 0.6, the worst DRAIN
**13.5 ms** against the 3 ms lean budget — and `edgesMaxMs` 13.5, i.e. ONE builder step,
not the chunk work (the twin's was 3.9). Identity `enrichedBench(50)` 0/0. So on the real
phone the budget bounded the work but not the frame: something inside a step cost 4× the
budget, and the OSM handler — never sliced, never measured on its own — was the biggest
app item left in the hitch frames.

### 25.2 The OSM handler: every b3dm had been taking the slow path

`edgesGeometry.ts`'s fast-path gate demanded a PLAIN Float32 position attribute; the phone's
resident OSM meshes read **11 of 11 `Float32Array/interleaved`** (position · normal ·
`_batchid` in one stride-8 buffer — how three's GLTFLoader loads Cesium's b3dm), so every OSM
tile went to `new THREE.EdgesGeometry` — on the desktop too, since slice (d). The doc comment
("every baked cell and Cesium's OSM b3dm") was an assumption; no OSM counter existed to say
otherwise. Fixed: `positionsF32` de-interleaves an interleaved Float32 attribute into the same
floats three's `toNonIndexed` / `fromBufferAttribute` read (identity pinned in
`test/components/globe/edgesGeometry.test.ts` against a real `InterleavedBuffer` with padding
noise in the stride; a normalized Int16 attribute still takes three's path and says so).

Then the OSM handler got the enriched handler's shape: PHASE 1 synchronous (material swap, F1
fill birth, tone seed, shadow flags — `handlerMaxMs` 0.1–0.4 ms on the phone), PHASE 2 one unit
per mesh on its own `loadQueue`, drained in `buildings.update()` after `tiles.update()` under
`BUILDINGS.loadBudgetMs` **3** / `loadBudgetMsLean` **1.5** (a SEPARATE budget from the enriched
queue's — the two drain in the same frame, one after the other, so a frame that drains both
spends up to their sum), nearest tile first (`lookBiasedDistance` on the tile's bounding-sphere
centre through `makeTileCenterReader`), the strokes born with their own `frameNow()` when they
land, `dispose-model` cancelling by scene. Seams: `__globe.buildingsLoad()` /
`buildingsLoadBudget(ms)`, DBG `buildings.osmLoadPending` / `osmLoadMaxMs` (the two existing
`buildings.load*` rows were relabelled "enriched" — they always were).

### 25.3 What the ledgers then said — and the GC behind the "steps" (the Pixel, six runs)

| tree | enriched worst drain · `edgesMax` · `maskMax` · `allocMax` | OSM worst drain · `allocMax` · `edgesMax` |
|---|---|---|
| boot (shipped T106 b) | **13.5** · 13.5 · 3.3 · — | atomic in `load-model` (410 ms in hitches) |
| + fast path for interleaved + two-phase OSM | 13.4 · 11.9 · 8.6 · — | **3.2** · 2.1 · 2.6 |
| the same tree, the next run | 12.5 · 7.8 · 10.1 · 1.5 | **16.7** · **15.5** · 3.5 |
| + `slotOf` `Map` → typed open-addressed table | **7.5** · 4.6 · 5.7 · 3.1 | 11.8 · 11.0 · 2.3 |
| the same, `allocTop` recorded | 21 (a 21 ms `registerMax`) · 4.7 · 12.4 · 2.4 | 19.5 · **19.3 (43k verts) vs 1.3 (31k verts)** · 3.3 |
| + the edge builder's tables POOLED per queue | 10.0 · 3.8 · 7.2 · 2.4 | **4.1** · 4.0 (a growth) · 3.3 |
| + the attributor's tables pooled too | **6.7** · 4.0 · 6.7 · 2.3 | **3.1** · 2.4 · 3.0 |

The read, step by step. The 13.5 ms "step" of the shipped tree was not chunk work (256
vertices or triangles per deadline check — well under a millisecond on this CPU) and not the
constructor's size (a 43k-vertex OSM mesh cost 19.3 ms in one run and a 31k one 1.3 ms in the
same run; the biggest enriched cell, 126k vertices, allocated in 1.5). It was V8's
external-memory GC landing in whichever step allocated when the threshold was crossed: every
unit built a fresh `Map` of up to 3 × its triangle count (heap entries, ~10 MB per big cell)
plus ~9 MB of typed arrays, ~600 MB of churn over one descent. Two changes, both pure and
pinned by the identity tests: the edge map is an open-addressed typed table (`hK0/hK1/hSlot`,
the keyer's own mixer — zero heap garbage in the walk), and both builders take a SCRATCH
(`createFastEdgesScratch` / `createAttributorScratch`, one per queue — a queue steps one unit
at a time, so one builder is live) whose tables grow to the biggest mesh seen and stay
(`reuses` 86 / `growths` 14 on the enriched queue over a descent, 11 / 4 on the OSM); a build
allocates only its output. The enriched worst drain on the Pixel 13.5 → **6.7 ms** at budget 3;
the OSM 410 ms atomic → **3.1 ms** at budget 1.5. `enrichedBench(50)` mismatch 0/0 on every run;
`fastEdges.test` +3 (a scratch across falling and rising sizes ≡ fresh builds, stale entries
never leak, the attributor likewise), `edgesGeometry.test` new (4).

The desktop twins on the final tree (`probe-load-phase2`): `high` — enriched worst drain
**7.0** (8.5 in §24.1), OSM 3.3, frames p50 / p95 / max 16.8 / 24.4 / 69.4, > 33 ms 11 (10),
identity 0/0; the lean twin — enriched 9.2 (`maskMax` 9.1), OSM 3.3, frames 17.3 / **42.8**
(50.8) / 174 (255), > 33 ms 53 (49). The residue on the twin is the attributor's construction
(`runOf` + the table reset + the runs loop over 126k vertices, atomic, ~2 ms at 4×) plus a
GC now and then — no longer a lever of this handler.

### 25.4 The thermal trap — a `--device` profile is void above thermal status 1

The like-for-like post profile (`probe-cpu-profile --leg descent --device`, run ninth in a row)
read 163 frames in 8.2 s, dt p50 **33.3**, max **1,897 ms**, 103 hitches, compile 312 ms — with
`dumpsys thermalservice` at **Thermal Status 4** (critical; the VIRTUAL-SKIN sensor), CPU
sensors 72 / 80 °C, the big cores at 984 MHz. The phone had been throttled by the eight
back-to-back descents, on charge, screen on. That run is VOID; the recipe now reads the status
before any timed phone run and waits below 2 (`tools/devicefarm/README.md` §B). The second
trap, learned cooling it: `KEYCODE_SLEEP` LOCKS the owner's phone (a secure keyguard —
`deviceLocked=1`, `wm dismiss-keyguard` refused), and behind the keyguard the tab reads
`visibilityState hidden`, rAF 0 — the next `--device` run recorded 0 frames and "flew" nowhere.
Cool the phone with the tab parked on `about:blank` and the screen ON, never by sleeping it.

### 25.5 The valid post profile — taken once the owner unlocked the phone (thermal status 0)

`probe-cpu-profile --leg descent --device` on the final tree (the pools, the seated strokes),
529 frames / 10.6 s of main thread, against §25.1's boot run of the same leg on the same phone:

| | boot (T106 a+b as shipped) | final tree |
|---|---|---|
| dt p50 / p95 / max | 16.7 / 50.0 / 399.7 | 16.7 / **49.5** / **283.1** |
| hitch frames · main thread inside them | 66 · 3.93 s | **55 · 2.78 s** |
| app in the hitches | 1,304 (`buildEdgesGeometry` **410**, vector tiles 262, `fastEdges` 50) | **691** (vector tiles 199, `fastEdges` `slotOfKey` + `run` 64 — budgeted; `buildEdgesGeometry` / `EdgesGeometry` GONE from the callers and from the self-time table, where three's `EdgesGeometry` had 361 ms) |
| controls in the hitches | 519 (`rawHeightAt` 294, `stepTiltGlide` 194) | 333 (213, 100) |
| seats · compile · gc in the hitches | 138 · 51 · 136 | 133 · 108 · 88 |
| gc, whole leg | 178 | 178 |

The phone's ledgers after the leg: enriched worst drain 8.6 ms (54 units; scratch reuses 94 /
growths 14), OSM 12.2 (15 units, `allocMax` 12.1 — one GC landed in a growth again; 3.1 the run
before), `enrichedBench` identity 0/0. So the worst drain on this phone is now the budget plus
one chunk plus whatever GC lands in an allocation — 3–12 ms, run to run — where it was 13.5 ms
every run plus a 410 ms atomic build. Two more reads rode along: **`ensureLocated`** fired 58×
with **0 features** located (every cell was located BEFORE its parts registered, so the parts
located themselves in phase 4 — the parts-first order did not occur once on this leg); its
7.5 ms max is the TREE-instance loop (an `ecefToGeodetic` per tree, atomic) — the remaining
unbudgeted locate, T115. **`terrain.memo.regionless` read 0** over 64 region invalidations —
T114's browser half on the CWT path; the ESRI placeholder path was not on this leg.

### 25.6 The late-child trap — the post sweep's draw calls caught what its pixels did not

The first post sweep read the same triangles per pose as the pre golden and **fewer draw calls
on every pose** (zoom-sweep 437 → 400, cityscape 855 → 838, everest-orbit-52 146 → 142 …), with
the pixel diffs inside the streaming noise band (1–10 %). At rest, in the house Chrome, the
zoom-sweep pose read calls 437 / lines **220,721** on the HEAD source and 400 / **38,087** on
the working tree — the same 41 OSM and 11 enriched edge objects present in both. All 41 OSM
`LineSegments` had the IDENTITY world matrix (their meshes at ECEF ~(3.4e6, 2.6e6, 4.7e6), the
strokes at (0,0,0) — inside the planet, frustum-culled). The mechanism: `TilesRenderer.setTileVisible`
gives a tile scene ONE `scene.updateMatrixWorld(true)` when it becomes visible, and
`TilesGroup.updateMatrixWorld` recurses into its children only when the group's own matrix
changed — a child added to a tile mesh after that moment is never reached. The deferred OSM
edges land frames later, so none was ever seated. The enriched deferral of 2026-09-07e had the
same exposure and was hidden by the cells' seat passes re-running `updateMatrixWorld` on the
cell scene (28/28 correct at the arrival pose) — a cell that never re-seats after its edges
land would have drawn them inside the planet.

Fix: every deferred stroke calls `edges.updateMatrixWorld(true)` after `c.add(edges)` (both
handlers). At rest the zoom-sweep pose reads **437 / 220,721** again — the pre numbers exactly,
41/41 and 11/11 seated. Two fences: `fences.test` pins the seating call after each `c.add(edges)`
(and that three still leaves a late child at the identity until forced); the visual sweep now
carries a **draw-count gate** — with `--compare`, a pose whose triangles match the golden run's
within 0.5 % and whose draw calls fall by more than 3 and 2 % FAILS (the golden's counters come
from its `report.json`). The pixel diff at tolerance 0 could not gate this: thin strokes over a
noise floor of whole tiles.

## 26. Session 2026-09-07j — lever 11 (the vector-tile parse off the main thread) and T115 (the tree locate, resumable) — desktop reads; the Pixel read is OWED

The phone was not attached this session (`adb devices` empty at boot). Every number below is the
desktop house Chrome (:9333) on the same dev server, A/B by the stash idiom (§25.6) minutes apart;
the Pixel's `probe-cpu-profile --leg descent --device` for both items is the first thing to run
when the owner plugs the phone in (thermal ≤ 1, unlocked, `adb reverse`/`adb forward` re-wired).

### 26.1 Why the obvious lever buys nothing — the wire is the design

`parseVectorTile` was 199–262 ms of the Pixel's descent hitch frames (§25.1/§25.5), leading the
app's share after T106. The parser is pure and `bestSpotWorker` already runs it in a worker, so
the shape "parse in a worker, `postMessage` the `ParsedVtile`" was the obvious one — and it is
worthless. Measured in node on the committed fixture and then on the 25 real z14 tiles of the
5×5 ring around the owner's `dnipro-descent` arrival (fetched 2026-09-07, build
`20260830_080001_pt`, 79–202 KB each; the fixture is a light 21 KB tile):

| | fixture (263 feats · 4,781 coords) | 25 real tiles (Σ) | heaviest (`9787/5663`: 794 feats · 209 buildings · 19.7k coords) |
|---|---|---|---|
| `parseVectorTile` | 1.48 ms | **60.8 ms** | 5.18 ms |
| `structuredClone` of the nested `ParsedVtile` | 1.28 ms | **60.6 ms** | 5.29 ms |
| v8 `deserialize` alone (the receive side) | 0.86 ms | — | — |
| serialised bytes | 150 KB (7× the PBF) | — | — |
| **`unpackVtile` of the flat wire** (the main-thread seat) | 0.08 ms | **3.1 ms** | 0.26 ms (worst tile 0.54) |

The parse's cost IS the allocation of ~100k two-element arrays; any transport that re-allocates
them on the main thread keeps the bill there. So the wire (`lib/geo/vtileWire.ts`) is ONE
`Float64Array` of coordinates + ONE `Uint32Array` shape stream (ring lengths, polygon and ring
counts) + the per-feature scalars as plain data, both typed arrays TRANSFERRED; the main thread
rehydrates the consumer-facing nested arrays — one twentieth of the parse, ≤ 0.54 ms desktop
(≈ 2 ms Pixel) for the heaviest tile, a one-shot seat that cannot make a hitch on its own. The
contract is identity: `unpackVtile(packVtile(p))` is `toStrictEqual` + key-order-equal + JSON-
equal to `p`, through `structuredClone`, on the fixture and on synthetic holes / multi-polygons /
empty features / `undefined` optional keys (`vtileWire.test.ts`, 10). The fetch stays on the
main thread (network attribution, `force-cache`, the attach-scoped abort unchanged); the worker
(`lib/geo/vtileParseWorker.ts`) gets the buffer and posts the wire; the client
(`lib/geo/vtileParseClient.ts`) seats, and falls back INLINE through the same handler when no
`Worker` exists, spawning throws, or the worker crashes (in-flight tiles re-issued inline; a
tile never becomes `"failed"` because of the worker — `vtileParseClient.test.ts`, 9). The worker
module is never imported by value on the main thread (its `self.onmessage` shell would land on
`window`) — a fence walks `src/` for it; the parser is handed to the client by
`scene/vectorTiles.ts` so the module graph is a straight line with no cycle.

### 26.2 Lever 11 on the desktop — the descent A/B (`probe-cpu-profile --leg descent`, HEAD vs tree, same boot conditions)

| | HEAD (`0a3042b`, parse on main) | the tree (lever 11) |
|---|---|---|
| frames · dt p50 / p95 / max | 455 · 16.7 / 33.3 / 249.9 | 586 · 16.7 / 33.3 / 233.2 |
| hitch frames (> 33 ms) · main thread inside them | 45 · 1,644.8 ms | 44 · 1,565.1 ms |
| app in the hitches | **230.2 ms** | **139.7 ms** |
| — of which vector tiles (callers' view) | `ringsOfFeature` 63.6 + `parseVectorTile` 27.2 + `clipHalfPlane` 8.4 = **99.2**; self-time `readSVarint` 48.2 + `loadGeometry` 16.1 + `readVarint` 5.6 under them | `vtileParseClient.parse` **0.8** — `ringsOfFeature` / `parseVectorTile` / pbf GONE from every table |
| app, whole leg | 831.5 ms (`readSVarint` 48.2 in the top six) | 800.3 ms (no MVT symbol in the top forty) |

The gate as written ("the vector-tile self time in the hitch frames → ~0") holds on the desktop:
169 → 0.8 ms. `probe-vtile-worker.mjs` (new) reads the DBG `vector` provider at the cityscape:
**12/12 tiles parsed by the worker, 0 inline, 0 failed, worst seat 0.5 ms, worst worker parse
10.3 ms** (the time the main thread no longer pays), 40 street labels up; its `--inline`
negative control (`window.Worker` deleted pre-boot) reads worker 0 / inline 12 / seat 0.4 — the
probe can tell the paths apart. Post sweep `post-2026-09-07j` vs the golden `post-2026-09-07h`:
draw-count gate **13/13** (calls AND triangles identical on every pose, the feature web's line
objects included), the `vector.*` rows identical per pose (parsed / version / labels), pixel
diffs the boot-to-boot band (legacy-m 49 → 56 %, the 2D map's residual tilt 0.35° → 0.44° at
capture; cityscape 15 → 34 %, the water fills' lattice-refresh state at capture — both the T103
family, same objects drawn).

### 26.3 T115 on the desktop — the tree locate, resumable

`ensureLocated`'s tree loop (an `ecefToGeodetic` per instance, atomic in the first `sampleTrees`
visit — 7.5 ms max on the Pixel, §25.5) is now `locateTrees`: chunks of 256 through the pure
`lib/globe/treeLocate.ts` (`Vector3.applyMatrix4` written out in three's operation order, the `w`
divide included, then the shipped `ecefToGeodetic` — pinned bit-for-bit against three on a
1,000-instance Dnipro-shaped fixture, chunk-split-exact), the first chunk of a frame always
running, further chunks while the LATER of the reseat deadline and `treeLocateBudgetMs` 0.5 ms
after the frame's first chunk is unspent. `ensureLocated` keeps the features (its `locateMaxMs`
is features-only now). The cursor's first cut shared only the reseat deadline and crawled at one
chunk per frame behind a spent budget (113 sets still unlocated at the end of a desktop descent);
the own budget fixed it. `probe-load-phase2` (desktop `high`, descent): 106 calls · 219 chunks ·
39,971 instances · 10.9 ms total · **worst call 0.5 ms** (was 2.3 before the own budget; the
atomic loop's desktop worst was in the `locateMaxMs` 7.5 Pixel / ~2 desktop band), identity
`enrichedBench(50)` 0/0. At the cityscape pose the ledger drains to `treeLocatePending` 0 over
~17 s for 85,519 instances at 21 ms total CPU — and the TREE SEATING throughput is unchanged
(HEAD vs tree, `enrichedSeats().treesSampled` at 4 / 10 / 19 s: 2,459 / 15,146 / 36,794 vs
3,238 / 15,354 / 36,454): the locate rides the drain's own visit schedule, as the one-shot did,
and a cell samples its whole sets while its others still locate. DBG rows
`buildings.treeLocateMaxMs` (warn > 4) and `buildings.treeLocatePending`.

## 27. Session 2026-09-08 — THE PIXEL READS of lever 11 and T115 (both hold); T118's readiness hold measured on the twin and on the Pixel

Pixel 6 Pro (Android 16, Chrome 152, Mali-G78, tier `mid`, lean), the phone's own VPN, ion 401, thermal
status 1 at both timed runs, the tab fronted; `adb reverse 4321` / `adb forward 9444`. The tree is
master `fb3fa83` (lever 11 + T115 as shipped) plus this session's non-rendering edits.

### 27.1 Lever 11 on the Pixel — `probe-vtile-worker --device` (new flag) at the cityscape, 20 s

| row | value |
|---|---|
| `mvt.parsed` / `mvt.worker` / `mvt.inline` / `mvt.failed` | 12 / **12** / **0** / 0 |
| `mvt.seatMaxMs` (the only vector-tile work left on the main thread) | **0.7 ms** (desktop 0.5; the brief's ceiling ~2, the slice line 4) |
| `mvt.workerMaxMs` (the time the phone's main thread no longer pays) | **41.4 ms** (desktop 10.3 — the same tile, the phone's CPU) |
| `labels.entries` | 31 → 16 over the window (the visible web) |

PASS. The seat is well under the slice line — the wire's feature cursor stays unbuilt.

### 27.2 Lever 11 + T115 on the Pixel — `probe-cpu-profile --leg descent --device` (367 frames / 8.1 s, 22,431 samples)

The gate as written: the vector-tile self time in the hitch frames → ~0. **`ringsOfFeature`,
`parseVectorTile`, `tileLocalToLonLat`, `readSVarint`, `loadGeometry` — absent from every table of
the profile** (the whole leg, the parse-phase frames, the hitch frames, the callers' view, the
top-30 self-time list); `scene/vectorFeatures.ts` (the web's line objects, not the parse) carries
51 ms of self time over the whole leg and none of it is a parse. §25.5's "vector tiles 199 leading
the app bucket in the hitches" is gone.

| | §25.5 (final tree 09-07f) | this read (lever 11 + T115) |
|---|---|---|
| dt p50 / p95 / max | 16.7 / 49.5 / 283.1 | 16.7 / 50.3 / 333.0 (the 333 ms frame is the profiler's first, at the 31.8 km start pose, `dl 0/0` — the boot, not the descent) |
| hitch frames · main thread inside them | 55 · 2.78 s | 77 · 3.37 s (NOT like-for-like — a different boot: the tab came from `/m`, thermal 1 not 0, the leg 8.1 s not 10.6; the per-frame buckets below are the comparison) |
| app in the hitches | 691 (vector tiles 199) | **649 (vector tiles 0)** — `fastEdges` `slotOfKey` + `run` + `walk` 103 (budgeted), `keyVertices` 28, **ephemeris 86** (`VsopFormula` 25.6 + `horizontal` 34.2 + `stateAt` 26.1 — the sky's per-frame ephemeris landing in hitch frames; not in §25.5's list, a lane item), `stepStreetNames` 16, `heightMemo.set` 16.5 |
| controls in the hitches | 333 (`rawHeightAt` 213, `stepTiltGlide` 100) | 480 (`rawHeightAt` 315, `stepTiltGlide` 138) — the terrain raycast (slice B lever 8, the owner call) |
| seats · compile · gc · program · other | 133 · 108 · 88 · — · — | 203 (`applyFeatureSeats` 96) · 85 · 125 · 371 · 334 (`Blob` 60 = the glTF parse's own blob) |
| whole leg, top self time | — | `applyFeatureSeats` **427 ms** (5 % of the leg), the raycast's `intersectTriangle`/`getX`/`getZ` 620, `fastEdges` 341, gc 218 |

What the whole-leg table says next for the lane: `applyFeatureSeats` at 427 ms over 8 s (§26.2's
200 ms desktop row, ×2 on the phone) is now the biggest app item on the leg, and the controls
raycast (`rawHeightAt` + `stepTiltGlide` → three's `intersectTriangle` over the terrain mesh,
1.17 s of the leg) the biggest bucket — the terrain BVH (lever 8) and the seat pass are what is
left; the ephemeris in the hitch frames (86 ms) is a new, small row.

### 27.3 T115 on the Pixel — `probe-load-phase2 --device` (label `lever11-t115-device`)

| ledger | value |
|---|---|
| `treeLocateCalls` / `Chunks` / `Instances` | 89 / 177 / 34,578 |
| `treeLocateMs` / **`treeLocateMaxMs`** | 21 ms / **0.6 ms** (the atomic loop's 7.5 ms in §25.5; the gate is "< the frame budget") |
| `treeLocatePending` at the leg's end | 5 (drains at rest on the visit schedule, as the desktop's did) |
| `locateCalls` / `locateFeatures` / `locateMaxMs` | 85 / 0 / 0 (the parts-first order did not occur once — every cell located before its parts, as in §25.5) |
| enriched: cells · worst drain · budget · edgesMax · maskMax · allocMax · scratch reuses/growths | 82 · **11.4 ms** · 3 · 10.3 · 9.9 · 2.3 · 152 / 12 |
| OSM: tiles · meshes · worst drain · budget · edgesMax · allocMax · slow path | 16 · 15 · **2.7 ms** · 1.5 · 2.4 · 2.7 · 0 |
| frames n · p50 / p95 / p99 / max · > 33 / > 50 | 367 · 17.5 / 47.5 / 116.8 / 183 · 41 / 16 |
| `enrichedBench(50)` identity | 0 / 0 mismatches (556,836 tris) |

T115 holds on the device: worst tree-locate call 0.6 ms (was 7.5 atomic), 34.6k instances in 21 ms
of CPU across the leg. The enriched worst drain (11.4) is the budget plus one chunk plus a GC
landing in a growth (§25.3's band, 3–12 ms run to run; `edgesMax` 10.3 says this run's big cell's
edge step was the one) — unchanged by this session.

### 27.4 T118 — the readiness hold (owner ruling 2026-09-08: hold the first solve until the scene has loaded, both shells)

`verify-bestspot-mobile.mjs` on the phone twin (house Chrome, 402×714 @3, 4 cores, 4× CPU), then
on the Pixel (`--device`, new flag; thermal 3 — a functional run, not a timed leg):

| | HEAD (`fb3fa83`, 1 run) | the tree, twin (3 runs) | the tree, Pixel |
|---|---|---|---|
| first post | a `no-built-geometry` REFUSAL at 600 ms (ink at 24 m, `hp` 0/0) | HELD 7.9 / 12.0 / 10.3 s (202 / 324 / 288 frames), then a REAL solve (`hp` 1 surveyed + 4 OSM) | held **3.0 s** (116 frames), then real (1 + 4) |
| first ink (wall, from the switch) | 600 ms (the refusal's rung 0) | 8.7 / 12.5 / 11.2 s | **3.9 s** |
| finest rung (3 m) | 14.2 s (refusal + 90 quiet frames + a second ladder) | 9.2 / 13.9 / 11.6 s | **8.1 s** |
| jobs to the finest rung | 2 | **1** | **1** |
| the chip | — | LOADING THE SCENE… → COMPUTING… → ✓ DONE (never DONE before first ink) | same |
| checks | 60/60 | 66/67 (below) | **67/67** |

The one twin FAIL is the harness's 5 s frame-count proxy at its floor (117–119 sampled vs the 120
floor; its own note: "a functional proxy, never a timing source"): HEAD read **128 / 120 / 119**
across three runs on the same machine this session (one FAIL on HEAD too), the tree 117 / 119 /
119 / 117 — the floor, not a regression. The first cut of the readiness term DID cost the twin
~3.5 ms per frame at 4× throttle (it read the two `debugLoad()` ledger COPIES every frame) — the
term is a THUNK the feed evaluates only while a solve is due, and the two handles gained a
`loadPending()` integer read; at rest the feed does no readiness work at all.

## 28. Session 2026-09-08d — LEVER 8 (the terrain BVH), desktop descent A/B

`probe-cpu-profile.mjs 9333 --leg descent --top 20`, the house Chrome at `high`, the stash idiom
for the A/B (`git stash push -- src/` serves HEAD = no BVH; pop restores the tree). Same
`dnipro-descent` leg both runs (8.2 s / ~440 frames), thermal-free desktop.

The lever: three's `Mesh.raycast` tests the WHOLE index of a tile once its bounding sphere is hit,
and a vertical `rawHeightAt` ray from 12 km hits the sphere of every LOD ancestor still crossfading
in the group — so the sampler + the controls' pivot / tilt rays walked thousands of triangles per
call. `lib/globe/terrainBvh.ts` gives each tile a lazy bounds tree (built on first raycast, dropped
with the tile), so a ray tests a few leaves.

| whole descent leg (self time) | BVH OFF (HEAD) | BVH ON |
|---|---|---|
| `controls` bucket total | **799.6 ms** (10.1 %) | **246.0 ms** (3.1 %) |
| `intersectTriangle` | **197.7 ms** | **29.6 ms** |
| the BVH's own node cost (`intersectBox`) | 0 | 87 ms |
| `frame.cpu` p50 (settled) | 7.7 ms | 7.1 ms |

| the 45 HITCH frames (dt > 33 ms) — the frames the lever is judged on | OFF | ON |
|---|---|---|
| `controls` inside them | **116.6 ms** | **65.0 ms** |

The hitches themselves stayed compile-bound (shader compile 56–72 ms on the worst frames, the
descent's real tail) — lever 8 is a controls-bucket win, not a hitch-count win on the desktop;
the phone leg (§27.2: `rawHeightAt` 315 + `stepTiltGlide` 138 ms IN the hitch frames) is where it
should move the frames, and that read is OWED (`--leg descent --device`).

**No-regression:** the tree is unit-pinned bit-identical to three's `Mesh.raycast` (same hit list,
distances, points, face/normal/uv) on six tile shapes, so the terrain height and every seat are
identical; the render is byte-identical (`GROUND.terrainBvh` never touches geometry) — the pose
sweep's draw-count gate read 14/14 vs `post-2026-09-08b` and the everest-orbit-52 frozen diff was
confined to UI chrome (nav pills, scrubber, version stamp), the terrain byte-matched.

## 29. Session 2026-09-09 — LEVER 8 (the terrain BVH) READ ON THE PIXEL — HOLDS

`probe-cpu-profile.mjs 9444 --leg descent --device --top 30`, the Pixel 6 Pro on adb (thermal 0, the
tab fresh from `am start`, VPN on the phone — ion 401 from the Mac), the same `dnipro-descent` leg as
§27.2 (409 frames / 8.1 s, 22,368 samples, clock alignment ±0.2 ms via markers). Profile:
`verify-shots/perf/cpu-descent-device-2026-09-08T21-27-23.cpuprofile`.

| | §27.2 (lever 11 + T115, before lever 8) | this read (lever 8) |
|---|---|---|
| dt p50 / p95 / max | 16.7 / 50.3 / 333.0 | 16.7 / 50.0 / 300.1 (the 300 = the profiler's first frame at 31.8 km, the boot) |
| hitch frames · main thread inside them | 77 · 3.37 s | **56 · 2.36 s** |
| **controls in the hitches** | **480** (`rawHeightAt` 315, `stepTiltGlide` 138) | **141** (`stepTiltGlide` 95, the BVH's `raycastWithBvh` 20 + `mesh.raycast` 5, `stepControlsUpdate` 16, `rawHeightAt` **2.6**) |
| whole-leg controls | 1.17 s (`intersectTriangle` / `getX` / `getZ` 620) | **393 ms** (`intersect` 52, `getVertexPosition` 47, `setFromBufferAttribute` 40, the tiles `raycast` 32, `getX` 27, `raycastWithBvh` 21) |
| `intersectTriangle` in the hitches | (the top symbol) | 11.7 ms |
| app in the hitches | 649 | 499 (`fastEdges` slotOfKey/walk/run 86, `stateAt` 32.6, `acquireTexture` 26, `keyVertices` 16, `VsopFormula` 12.4, `AddSol` 11.8) |
| seats in the hitches | 203 (`applyFeatureSeats` 96) | 146 (`applyFeatureSeats` 62) |
| compile in the hitches | 85 | 170 (`getProgramInfoLog` 156 — one 166 ms frame at 1.75 km carried 130 ms of compile; lever 4 is CLOSED by owner ruling, not re-opened) |
| whole leg, top self time | `applyFeatureSeats` 427 · the raycast 620 · `fastEdges` 341 | `applyFeatureSeats` **461** (5.4 %) · `fastEdges` ~310 · gc 146 |

**The BVH's own numbers, read off the page after the leg** (`__globe.terrainBvhStats()`): builds **83**
(18 ms total, worst **8 ms**), raycasts **369,646**, triangles tested **3.88 M → ~10.5 per mesh-raycast**
(was thousands: three's `Mesh.raycast` walked the whole index once the bounding sphere was hit). What is
left in the controls bucket is per-MESH overhead — ~900 mesh-raycast calls per FRAME, every LOD ancestor
whose sphere the vertical ray crosses — a later lane item (a tile-level cull before the per-mesh call),
not lever 8's.

**Verdict:** lever 8 HOLDS on the phone — controls inside the hitch frames −71 %, `rawHeightAt` gone
from the callers' table, hitch frames 77 → 56 and their main thread 3.37 → 2.36 s on the same leg.
The lane's next rows, unchanged in rank: `applyFeatureSeats` 461 ms whole-leg (the biggest app item),
the ephemeris in the hitches (~57 ms: `stateAt` + `VsopFormula` + `AddSol`), `stepStreetNames` /
`acquireTexture` 56 + 26, `fastEdges` (budgeted) ~310.

## 30. Session 2026-09-09 — T130 THE DEVICE CAMPAIGN: T123 classified (GROWTH by cache residency → the 2 GB ceiling), T124 not reproduced

Two AWS Device Farm sessions on the fleet's iPhone 17 Pro (iOS 26.3.1) through a cloudflared tunnel to this
Mac's `wix dev` (`tools/devicefarm/ios-baseline.mjs`, two new legs), 17.9 + 11.2 device minutes; the Pixel 6 Pro
over adb for the feature legs; the desktop twin (mobile emulation) for the census that names the mechanism.

### 30.1 T123 — the stress leg (`--legs stress --stress-cycles 8`, one `/m` page, never re-navigated)
The owner's sequence: FPV in at a Dnipro spot → a look-around → FPV out → the heatmap armed at the spot → off;
spots eye · west-sunset · south · altanka; a `__debugFeed` SNAP after every stage. **The page died in cycle 4
at `fpv-in`, page age ~250 s** — the device syslog (session `…/fa47a133-…`, the second DEVICE_LOG artifact):

```
memorystatus: com.apple.WebKit.WebContent [557] exceeded mem limit: ActiveHard 2048 MB (fatal)
memorystatus: killing process 557 [com.apple.WebKit.WebContent] in high band FOREGROUND (100)
memorystatus: killing_specific_process pid 557 (per-process-limit 100 290s rf:- type:app) 2097283KB
```

The `fpv-out` rows (the resting state between spots), the tool's GROWTH-vs-CEILING series:

| cycle · spot | page age | dt p50/p95 | tile LRU bld/gnd/enr MB | textures | geometries | programs |
|---|---|---|---|---|---|---|
| c0 eye | 42 s | 17 / 17 | 9 / 97 / 83 | 60 | **395** | 37 |
| c1 west-sunset | 84 s | 17 / 17 | 10 / 97 / 97 | 82 | **581** | 40 |
| c2 south | 153 s | 17 / 17 | 11 / 97 / 96 | 65 | **620** | 41 |
| c3 altanka | 197 s | 17 / 17 | 11 / 97 / 96 | 87 | **795** | 42 |
| c4 eye `fpv-in` | ~250 s | — | — | — | — | KILLED |

Frame time flat, the tile LRUs FLAT under their lean caps (48 / 112 / 128 MB of content bytes), `renderer.info.memory.geometries`
climbing ~150 per spot → the tool's verdict **"GROWTH then death: geometries 395→581→620→795"**.

### 30.2 The mechanism — named on the twin (`scripts/probe-fpv-cycle-leak.mjs` + two scratch probes)
The same cycle on the desktop twin (402×714 @3, touch) with a scene-graph CENSUS after every stage:
- After every `fpv-out` the geometries ATTACHED to the scene return to ~150–190; the renderer's total keeps climbing
  (detached-but-alive 237 → 431 → 477 → 617). The per-`fpv-in` adds are the ENRICHED CELLS — `mesh_0` (+52/+73/+75/+62),
  their edge `LineSegments` (the same counts) and `ftw-trees` (+28/+52/+60/+44) — and they stay alive after FPV
  exits because `/m` 2D DETACHES the enriched tileset (`setActive(false)`): a detached TilesRenderer is never
  `update()`d, so its LRU never evicts — the cache is FROZEN with every cell of every spot visited, under a cap
  (134 / 101 MB) it never reaches.
- **Not a leak:** force-evicting the detached enriched cache (`lruCache.markAllUnused()` + caps → 0 +
  `unloadUnusedContent()`) dropped the renderer's geometries **283 → 137** (56 → 1 items, 59 → 3.5 MB); the OSM
  buildings cache another −29. Everything the cache held was disposable and was disposed (the 2026-07-13
  `dispose-model` handler holds). `setTempPin` ×6: 43 → 43 geometries (innocent).
- The enriched cache's byte accounting is honest for GEOMETRY (its 47–59 MB ≈ the summed attribute bytes in the
  group, 48–60 MB). What the 2 GB counts and the caps do not: the decoded imagery TEXTURES behind the ground
  LRU's 97 MB of compressed tiles (×4–8 decoded RGBA), the enriched cells' parse-side copies + edge tables, the JS
  heap (+25 MB per spot resident on the twin: 300 → 355 MB over three spots), the FPV working set per spot.

**Classification (the owner's question):** GROWTH by CACHE RESIDENCY up to caps that the phone cannot afford,
then the CEILING — no leak. **Lever candidates (owner call; "no overfitting that regresses the app"):**
(a) when `/m` drops to 2D, RELEASE or trim the detached enriched + buildings caches (nothing reads them until
the next FPV, which re-streams — mostly from the browser cache); (b) size the lean ground cap by DECODED texture
bytes, not compressed tile bytes; (c) a `/m`-only `enrichedLruBytesMB` floor well under 128.

### 30.3 T124 — the altanka pose (`--legs t124`, `/m#f=48.463651,35.039833,1.7,304.9,1.7,10.8&t=1788874369380`)
**NOT REPRODUCED on a fresh page.** The scene's own row for "altanka": `ready`, `seatReal true`, applied 91.1 m,
11,826 tris at 5 / 15 / 30 / 60 / 90 s; `models r/w/s/l` 3/3/0/0 throughout; the 30 s and 90 s screenshots show
the gazebo dome centre-right in the frame (`verify-shots/perf/devicefarm-t124-2026-09-08T22-57-08-t124-90s.png`).
The stress rows corroborate: `models 3/3` resident at every FPV stage incl. the altanka spot. The owner's
"sometimes" therefore most likely rides the T123 death spiral (a page near the cap failing a GLB / texture
load, or the post-kill reload) rather than the pose, the near plane or the residency plan — re-check T124 once
a T123 lever is in.

### 30.4 The Pixel legs (`verify-mobile-batch-2026-09-08 9444 --device`, three runs)
112 PASS · 2 FAIL on the last run: **T126 §7 on real glass PASS** (a building armed through the seam after a
re-stand at the map focus; `↶ UNDO` 63×19 px and `DROP SESSION` 100×18 px TAPPED through `adb shell input`:
UNDO → no row; two edits → DROP → no row, journaled "drop"; UNDO → sy 1.6 back). The two FAILs are not
changes: the AR "sensors dying" line (the REAL sensors kept the bubble on the rung line — a leg written for the
twin's synthetic pump) and the encoder's "frame-rate writes deferred (9 frames)" timing line (passed in the two
earlier runs; the phone at thermal 1–2). **Trap:** on the Pixel the LOOK FROM HERE stand of the earlier legs
faced a band with no building; `pickBuildingAt` itself hits 18 grid points along the horizon from a centre stand.

## 31. Session 2026-09-10 — T123 LEVER (a) BUILT: the detached tile caches released on the `/m` 2D drop — the twin A/B

The owner's ruling 2026-09-09b executed (`lib/globe/detachedRelease.ts` + `MOBILE2D.releaseDetachedTiles` /
`releaseDetachedGraceMs` 2500; `BuildingsHandle.releaseCache()` / `EnrichedHandle.releaseCache()`; the orchestrator's
`stepMobileBuildingsGate` drains both caches once per detach period, `/m`-only; DBG `buildings.detachedRelease*`).
Measured on the desktop twin (mobile emulation 402×714 @3, touch; the house headless Chrome :9333; `wix dev` plain
with `.vite` aside; VPN on) with `scripts/probe-fpv-cycle-leak.mjs` — the SAME cycle as the farm stress leg (FPV in
at a Dnipro spot → look → FPV out → heatmap armed → off; a census per stage), the A/B by the stash idiom (HEAD served
through HMR for BEFORE). The probe now carries the two caches' item counts + MB and the drain receipt per row, and
rests 3 s after `heatmap-off` like the farm leg.

### 31.1 The A/B — 4 cycles, the `fpv-out` rows (the resting state between spots)

| cycle · spot | BEFORE (HEAD `9fc4fe8`): renderer geometries · enriched cache items / MB · OSM items / MB | AFTER (lever): geometries · enriched · OSM · drains so far (items / MB / worst ms) |
|---|---|---|
| boot map | 43 · 0 / 0 · 0 / 0 | 43 · 0 / 0 · 0 / 0 · 0 |
| c0 eye | **404** · 103 / 82.9 · 29 / 9.1 | **94** · 0 / 0 · 0 / 0 · 1 (132 / 92.0 / 6.7) |
| c1 west-sunset | **592** · 152 / 96.8 · 34 / 9.7 | **132** · 0 / 0 · 0 / 0 · 3 (323 / 203.2 / 8.4) |
| c2 south | **648** · 158 / 96.1 · 37 / 10.8 | **132** · 0 / 0 · 0 / 0 · 4 (523 / 310.4 / 9.1) |
| c3 altanka | **774** · 190 / 96.1 · 41 / 11.0 | **198** · 0 / 0 · 0 / 0 · 6 (753 / 414.0 / 10.8) |
| final | 774 · detached-undisposed **579** | 212 · detached-undisposed 17 |

The ATTACHED geometry count is the same at every stage in both runs (167 / 165 / 172 / 195 before, 167 / 165 / 162 /
195 after — the scene is otherwise identical); what the lever removed is exactly the detached-but-alive set the
2026-09-09 census named (§30.2). `left` read 0 after every drain (the whole cache goes in one call). The c3 step
(132 → 198) is the altanka spot's USER MODEL (the gazebo's 28 + 14 sub-meshes, resident by the MS6 residency plan) —
not tiles; the 8-cycle run below shows it does not compound.

### 31.2 The lever over 8 cycles (the farm gate's length) — flat

`fpv-out` geometries **98 → 134 → 135 → 209 → 197 → 177 → 171 → 175** (c4–c7 revisit the same four spots and land
where c0–c3 did); `heatmap-off` rows identical to their `fpv-out` rows; both caches at 0 items on every resting row;
16 drains (two per cycle: the FPV exit and the heatmap disarm), **1,368 items / 737 MB evicted, worst drain 9.6 ms,
`left` 0 every time**; textures 63–93 (the ground imagery LRU at its lean cap, moving with the spot, not climbing);
programs 37 → 42 then flat. Before the lever the same twin climbed 404 → 774 in four cycles with the enriched cache
FROZEN at 96 MB (§31.1) and the iPhone died in cycle 4 (§30.1).

### 31.3 What the drain costs and where it lands

One synchronous whole-cache `unloadUnusedContent()` under zeroed caps: 6.7–10.8 ms on the desktop twin for 130–215
items (the enriched cells' geometry + edge LineSegments + tree instances, their materials and textures, the seat
banking in `dispose-model`). It fires `releaseDetachedGraceMs` 2500 ms after the detach — past `FLIGHT.durationMs`
2200, so it lands on the RESTING 2D map, never inside the FPV-exit flight's frames. The re-attach cost is the ordinary
FPV-entry stream (the enriched cells came back at the same counts on every revisit: `enr 38 → 103` items at the eye,
`76 → 148` at west-sunset, cycle after cycle); the seat cache kept the banked seats (`seatCacheHits` climbing, the
cells landing at their previous heights — the re-stream lands where it left).

### 31.4 The desktop — byte-identical by construction, checked by the sweep

The lever runs only under `isMobileShell`; the desktop's BLD-off detach keeps its cache as before. Pose sweep
`post-2026-09-10 --compare post-2026-09-09`: see DECISIONS 2026-09-10 for the gate line (draw-count + the per-pose
DBG rows).

### 31.5 The farm re-run with lever (a) — the residency growth is GONE; the page still meets the ceiling in cycle 8

`ios-baseline.mjs --host <tunnel> --poses m --legs stress --ramp 0 --soak-min 0 --stress-cycles 8 --label t123a`,
the fleet's iPhone 17 Pro (iOS 26.3.1), session `…:session:69e9a004-b773-4e76-87d5-259381e752df/a720c00e-d910-4145-8ec1-74c69175e0fc/00000`,
the same eight-cycle sequence as §30.1. The `fpv-out` rows:

| cycle · spot | page age | dt p50 / p95 / max | tile LRU bld / gnd / enr MB | textures | geometries | programs |
|---|---|---|---|---|---|---|
| c0 eye | 38 s | 17 / 17 / 46 | **0 / 97 / 0** | 60 | **91** | 37 |
| c1 west-sunset | 166 s | 17 / 17 / 42 | 0 / 97 / 0 | 85 | **131** | 40 |
| c2 south | 234 s | 17 / 17 / 59 | 0 / 94 / 0 | 70 | **128** | 41 |
| c3 altanka | 273 s | 17 / 49 / 87 | 0 / 97 / 0 | 87 | **189** | 41 |
| c4 eye | 311 s | 17 / 17 / 58 | 0 / 97 / 0 | 87 | **186** | 42 |
| c5 west-sunset | 349 s | 17 / 49 / 62 | 0 / 97 / 0 | 85 | **159** | 42 |
| c6 south | 383 s | 17 / 45 / 66 | 0 / 97 / 0 | 86 | **162** | 42 |
| c7 altanka `look` | 412 s | 17 / 17 / 32 | 8 / 113 / 86 | 76 | 467 | 43 |
| c7 altanka `fpv-out` | — | — | — | — | — | **KILLED** |

The tool's verdict: **`CEILING: died with flat resources (lru 97/97/94/97/97/97/97 tex 60/85/70/87/87/85/86 geo
91/131/128/189/186/159/162)`**. The syslog (the second `DEVICE_LOG`, `verify-shots/perf/t123a-syslog/`):
`memorystatus: com.apple.WebKit.WebContent [674] exceeded mem limit: ActiveHard 2048 MB (fatal) … killing_specific_process
pid 674 … (per-process-limit 100 448s …) 2101779KB` at device time 03:17:49 — one second after the c7 `look` row, i.e.
at the START of the eighth FPV exit, page age ~413 s, process age 448 s. Before the lever (§30.1) the same leg died in
**cycle 4 at ~250 s** with geometries 395 → 795 and the enriched cache frozen at 96 MB. **Lever (a)'s own contract
holds on the device** — both detached caches at 0 items on every rest row, the geometry series flat (91 → 162, the
altanka spot's user model the only step), the tile LRUs flat — and **the gate "8 cycles alive" is missed by the last
exit**: seven complete cycles, the eighth's FPV entry and look-around fine, the kill inside its exit. Something the
byte-accounted caches do not count still reaches 2 GB. The `dt` max in the resting rows (46–87 ms) is the
look-around's streaming and, past the grace, the drain — one frame each, at rest.

### 31.6 What the plateau IS — Chrome's memory-infra on the twin (`scripts/probe-memory-dump.mjs`, NEW)

The renderer process's own allocator breakdown (CDP tracing, `disabled-by-default-memory-infra`, a detailed dump
per rest), the same `/m` cycle, lever (a) in the tree. The page's renderer at each rest (effective MB):

| allocator | boot, 2D map | c0 FPV (looked around) | c0 fpv-out, drained | c1 fpv-out, drained |
|---|---|---|---|---|
| **cc/image_memory** (the compositor's GPU image-decode cache) | 137.5 | 458.8 | **500.0** | **500.0** |
| malloc/allocated_objects | 208 | 324 | 258 | 244 |
| partition_alloc (ArrayBuffers, the parse-side copies) | 56 | 337 | 114 | 125 |
| canvas (2D canvas backing stores) | 78 | 120 | 107 | 127 |
| v8/main/heap | 34 | 74 | 56 | 67 |
| webgl (client-side GL state) | 25 | 142 | 25.5 | 24 |
| gpu (transfer + mapped buffers) | 28 | 30 | 44 | 44 |
| the app's tile caches (`tiles.*.lruMB`) | 0 / 78 / 0 | 9 / 113 / 83 | 0 / 96 / 0 | 0 / 97 / 0 |

Read: after the first FPV the app's accounted caches hold ~100 MB and the renderer holds ~1.2–1.4 GB, of which
**the browser's own IMAGE machinery is ~630 MB** — `cc/image_memory` pinned at exactly 500.0 (a cap: Chrome's GPU
image-decode cache budget, filled by the overlay's `drawImage(imageBitmap)` composites and kept until Chrome's own
LRU says otherwise) plus ~100–127 MB of 2D-canvas backing stores. Over eight cycles (`probe-fpv-cycle-leak.mjs`'s new
process read) the renderer's RSS drifts 1,424 → 1,668 MB on the `heatmap-off` rows (~35 MB per cycle, ~10 of it the
main JS heap 157 → 226 MB total) around that plateau. **Frame-challenge — lever (b) as framed is VOID:** the
library already accounts textures at their DECODED size (`three/renderer/utils/MemoryUtils.getTextureByteLength` =
`TextureUtils.getByteLength(width, height, format, type) × 4/3` with mipmaps; the overlay plugin's
`calculateBytesUsed` adds its composite `target`s), so the ground LRU's 97 MB IS decoded bytes and a "decoded-byte
cap" changes nothing. Lever (c) (a lower `/m` enriched floor) is moot at rest after (a) — the cache is EMPTY there —
and would trim only the FPV-time peak (97 → ~64 MB) against a 1.4 GB plateau.

### 31.7 Lever (d) — the composite canvases' backing stores, released at the library's own dispose

The overlay composites every ground tile's imagery into ITS OWN `<canvas>` (`RegionImageSource.fetchItem`:
`document.createElement('canvas')` at the overlay resolution — 256² lean / 512² high — a `CanvasTexture` over it,
`drawImage(imageBitmap)` per source tile); when the region's lock count hits 0, `disposeItem(target)` calls
`target.dispose()` (the GL texture) and leaves the canvas's PIXELS to the element's garbage collection, which nothing
hurries. The twin counted **~450 composites born per stress cycle** (`--canvas-zero`: 901 in two cycles, 901 MB of
backing store at 512²). On iOS an accelerated 2D canvas is an IOSurface in the process's physical footprint — the
number jetsam reads against WebContent's 2 GB — and JSC's collector runs on JS-heap pressure, which a canvas wrapper
never exerts. NEW `lib/globe/compositeCanvasRelease.ts` (+ 7 tests pinning the library shapes): every overlay's
region source is wrapped at construction (through `_init`, where the library creates it) so `disposeItem` also drops
the canvas's store (`width = height = 0`, the canvas-memory idiom); the fast-path `ImageBitmap` clones are skipped
(the tiled source closes its own bitmaps). `GROUND.releaseCompositeCanvas` (kill switch), DBG `tiles.gnd.canvasReleased`
/ `canvasReleasedMB` / `canvasSkipped`, handle `ground.compositeCanvasStats()`. On the twin: 204 composites (204 MB at
512²) released over ONE FPV cycle; the `canvas` allocator at rest 107 → 97 (c0) and 127 → 97 MB (c1) — Chrome was
collecting them anyway; `cc/image_memory` stays at its 500 cap (Chrome's budget, not a leak). Both shells (a disposed
composite can never draw again); the sweep `post-2026-09-10b --compare post-2026-09-09`: calls + tris identical on
11/14 poses and IDENTICAL to this session's first sweep on all 14 (the three non-identical are the documented
ground-tile boot band: gnd visible 293 → 290 / 263 → 266, −2 tris at legacy-orbit), 537 composites released across
the zoom sweep with a 0.37 % pixel diff. **The device tier decides** — §31.8.

### 31.8 The farm re-run with levers (a) + (d) — **ALIVE 8 CYCLES, FLAT** — the T123 gate holds

`ios-baseline.mjs --host <tunnel> --poses m --legs stress --ramp 0 --soak-min 0 --stress-cycles 8 --label t123ad`, the
same fleet iPhone 17 Pro (iOS 26.3.1), session
`…:session:69e9a004-b773-4e76-87d5-259381e752df/03d315b0-41c2-4c8c-a05b-4c50010a5bc8/00000`, the same sequence as §30.1 /
§31.5. Every cycle completed; the page ended the leg at age **450 s**, no reload, no kill. The tool's verdict:
**`alive 8 cycles, flat (lru 97/97/94/97/97/97/97/97 tex 60/87/71/84/88/93/77/87 geo 92/135/131/164/167/171/153/166)`**.

| cycle · spot | `fpv-out` page age · dt p50 / p95 / max · geo | `heatmap-off` page age · dt · geo | tile LRU bld / gnd / enr |
|---|---|---|---|
| c0 eye | 34 s · 17 / 44 / 73 · 92 | 130 s · 17 / 17 / 17 · 96 | 0 / 97 / 0 |
| c1 west-sunset | 160 s · 17 / 17 / 52 · 135 | 198 s · 17 / 17 / 26 · 133 | 0 / 97 / 0 |
| c2 south | 225 s · 17 / 18 / 61 · 131 | 235 s · 17 / 17 / 17 · 129 | 0 / 94 / 0 |
| c3 altanka | 265 s · 17 / 17 / 59 · 164 | 301 s · 17 / 17 / 17 · 160 | 0 / 97 / 0 |
| c4 eye | 329 s · 17 / 17 / 56 · 167 | 339 s · 17 / 17 / 19 · 163 | 0 / 97 / 0 |
| c5 west-sunset | 367 s · 17 / 17 / 58 · 171 | 377 s · 17 / 17 / 17 · 171 | 0 / 97 / 0 |
| c6 south | 403 s · 17 / 17 / 55 · 153 | 412 s · 17 / 17 / 20 · 150 | 0 / 97 / 0 |
| c7 altanka | 439 s · 17 / 17 / 61 · 166 | **450 s · 17 / 17 / 19 · 164 — ALIVE** | 0 / 97 / 0 |

The three runs side by side: **before (§30.1)** dead in cycle 4 at ~250 s, geometries 395 → 795, the enriched cache
frozen at 96 MB · **lever (a) (§31.5)** dead in cycle 8 at ~413 s, caches 0 / 97 / 0, geometries 91 → 162 flat ·
**levers (a) + (d)** alive through cycle 8 at 450 s, caches 0 / 97 / 0, geometries 92 → 166 flat, `dt` p95 17 ms on
every resting row (the (a)-only run read 45–49 ms p95 on four of its rests — the phone was already paging near the
cap). The frame-time max on the `fpv-out` rows (52–73 ms) is the ONE frame of the drain plus the exit's streaming,
at rest on the 2D map, as designed. **T123: FIXED to the owner's gate**; the ceiling class it exposed — memory the
app's own accounting cannot see, in the browser's image machinery — is recorded in §31.6 for the next lever if the
owner's own phone still shows a death on longer sessions (the twin's ~35 MB/cycle renderer creep is the remaining
watch item, §31.6).
