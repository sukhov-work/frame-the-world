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
| **0. The orbit frame (NEW)** | NEW-1 the controls' raycast target (terrain-only / layers / memoised `heightAt`) · NEW-2 bloom (plan 13, promoted): half-res, fewer mips, or a cheaper pass · plan 4 `compileAsync` | orbit `frame.cpu` 31–47 → < 5 ms; GPU −13…−25 ms at DPR 2 everywhere | `verify-perf-baseline` re-run: orbit dt ≤ 20 ms at high; FPV GPU ≤ 15 ms; byte-identical `high` look where the lever is a pass RESOLUTION change is an owner call (bloom at half-res is a pixel change) |
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
