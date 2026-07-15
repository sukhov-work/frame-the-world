# B19 — Orchestrator `update()` split · Handoff

> ## ✅ DONE 2026-07-11 — provably behavior-identical, all tiers green.
> `update()` is now a flat ordered dispatch of **36 named step-closures** (`stepFrameTiming … stepDayArcs`,
> `stepArrivalReframing` = #29) at factory scope. Frame-locals live in a factory "per-frame hub" of bare
> `let`s (the FrameContext below, realized as bare lets — the optional ctx-object phase-4 skipped for lower
> risk; `zc`→factory const; 14 producers `const/let X=`→`X=`). Verified: line-for-line + order-exact
> partition (extracted step bodies in def order == pre-split body, 771==771; call order == def order) ·
> whole-file multiset diff 0 unexplained · trap-site code counts unchanged (matrix flushes 8/2, `++frameCount`
> 1, adjustCamera 1, `performance.now` 8) · astro check 0 · 325 vitest · wix build · browser Flow-0 CLEAN
> (0 [globe] errors) · `verify-s5-night.mjs` GOLDEN GATE PASS. Mechanics + the reusable verification-proof
> technique: `mem:project/wip-2026-07-11-b19-split`. **The map/traps below are retained as the record of the
> contract that was preserved.** Cosmetic-only follow-up: step bodies kept 8-space indent (no prettier/lint
> in repo → left; S7 may dedent). B20–B25 fold into S7.


> **Provenance.** Built 2026-07-11 (pre-S7 refactor session 2) from a 4-analyst + 1-synthesizer workflow that
> read the CURRENT `StylizedTiles.ts` (post-safe-tier: B6 helpers · B12 `GlobeControlsInternal` · B13 `ORCH`
> constants · B26 throttled catch all already landed). **Line numbers are as-of that session** — expect ±a few
> lines of drift; the *symbol names, order, and traps* are the load-bearing part, not the exact `L####`. This is
> the ONE remaining pre-S7 item; the scaffolding it needs is done (`mem:project/wip-2026-07-11-pre-s7-refactor-s2`).
> Do it unhurried, browser-verified, NOT at a session tail. The verification harness may reuse
> `scripts/verify-s5-night.mjs`'s ASSERTIONS but should write to FRESH shot names (`verify-shots/b19-*`) so it
> doesn't clobber the S5 baseline.

> **⚠ 2026-07-11 drift — one NEW step added after this map was built.** The pin-reframe bugfix added a
> **self-contained arrival re-framing block right AFTER the `frustum.resnap()` step** (`if (framingActive) {…}`)
> plus closure state (`framingActive`/`framingLookAt`/`framingParams`/`framingStableFrames`/`framingReframes`/
> `framingDeadlineMs` + scratch vecs + the `beginFraming(pose)` helper, all declared just before
> `attachPhotoFrustum`) and disarm calls in `noteInteract` + `onPlaced` + the placed-photo FPV-exit. When
> splitting, add a `stepArrivalReframing(ctx)` immediately after the resnap step; the framing state joins the
> "closure-state-that-STAYS-closure" list. See `mem:bugs/pin-arrival-reframe`.

**File:** `src/components/globe/StylizedTiles.ts`
**Target:** the per-frame `update()` loop — one `try` at **L674**, one `catch` at **L1573–1580**, 36 ordered work-steps in between (**L675–1572**) — **+1 new step** (arrival re-framing, after resnap; see the drift note above).
**Nature of B19:** pure readability restructuring — carve the ~900-line frame body into named step-functions with **zero behavioral change**.

---

## 1. Mission & guardrails

Split the monolithic `update()` body into ~35 small, named step-functions **without changing a single observable behavior**. This is a readability/altitude refactor only.

Non-negotiable guardrails:

- **EXACT execution order preserved.** The 36 steps below run in the identical sequence. Several ordering relationships are load-bearing (§4) — the order is not incidental, it is the contract.
- **EXACT closure access preserved.** Every step keeps reading/writing the *same* closure variables it does today. No variable is copied-by-value where it is currently shared-by-reference; no snapshot is hoisted or merged.
- **One try/catch stays whole.** All 35 step calls remain inside the single `try` (L674) guarded by the single throttled `catch` (L1573). No per-step try/catch, no step outside the wrapper.
- **`++frameCount` stays exactly at L1419** (see trap (a)). Do not hoist it, do not precompute all modulo gates against one value.
- **Browser-verified, not just typechecked.** `astro check` + `npm test` are necessary but insufficient. The refactor must pass the browser flows in §6 (order regressions typecheck clean but desync the scene). The scripted CDP night-shadow run (`scripts/verify-s5-night.mjs`) is the golden pass/fail gate.
- **Design-boundary reminder (CLAUDE.md):** `src/components/globe/**` is motion-spec only. Design imports never touch it — but B19 *is* a globe-internal refactor, so it lives here legitimately; just do not pull in panel/token concerns.

**Definition of done:** identical scene behavior across every §6 flow; zero throttled `[globe] … update error` lines; `astro check` clean; `npm test` green; the pre-refactor and post-refactor `verify-shots/phase55-36..40` screenshots match.

---

## 2. The FrameContext

`FrameContext` bundles the values that are **computed once per frame and read by many later steps**. It is allocated fresh (or reset) at the top of each frame and threaded into the step-functions. It is the *last* thing to introduce (see §5) — do not build it until the closure-preserving extraction is green.

```ts
/**
 * Per-frame hub values, computed once and read by many downstream steps.
 * Fields are frame-local: (re)established each frame; NONE persist across frames.
 * Scratch Vector3/Quaternion OBJECTS remain closure-level (zero per-frame alloc);
 * only their per-frame VALUES are conceptually part of the context.
 */
interface FrameContext {
  // --- step 1 · frame-timing (read-only after L677) ---
  readonly now: number;         // performance.now() at frame head; reused as interaction stamp
  readonly dtMs: number;        // min(now - lastFrameMs, ORCH.maxFrameDtMs); every ease divides by it

  // --- step 2 · zoom-brake/ease (read-only after L701) ---
  readonly zc: GlobeControlsInternal; // the B12 `controls as GlobeControlsInternal` shim (shared cast)
  readonly zoomStep: number;    // zc.zoomDelta AFTER easing, captured BEFORE controls.update()
  // _upBefore: VALUE captured pre-controls.update (Vector3 object stays closure scratch)

  // --- step 11 · geodetic-altitude (read-only after L934) ---
  readonly alt: number;         // WGS84 geodetic altitude of the FINAL camera position; ~10 consumers

  // --- step 12 · view-focus + pin-focus-lock (read-only after L972) ---
  // _focus / _focusUp: VALUES written once here (Vector3 objects stay closure scratch)
  readonly focusHit: Vector3 | null; // ray∩ellipsoid; null past the limb (gates shadow eligibility)
  readonly focusLocked: boolean;     // a selected photo apex / temp pin overrode the ray focus
  readonly hasFocus: boolean;        // focusHit !== null || focusLocked

  // --- step 8 / step 14 · store snapshots (read-only references; see traps b, m) ---
  readonly upNow: UploadState;   // useUploadStore.getState() @ L749 — reused all frame
  readonly camNow: CameraState;  // useCameraStore.getState() @ L750  — SNAPSHOT #1 (read-mostly flags)
  readonly camStore: CameraState;// useCameraStore.getState() @ L991  — SNAPSHOT #2 (targets/rates, re-read)

  // --- step 17 · encoder-rates (read-only after L1090) ---
  readonly kRate: number;        // 1 - exp(-dtMs/CONTROLS.rateEaseTauMs); shared by 3 encoder sub-steps
  readonly rateAllowed: boolean; // !flight.active(); zeroes every stick during a flight

  // --- step 25 · ephemeris-resample (read-only after L1365) ---
  readonly tMs: number;          // sceneTimeMs(); also consumed by day-arcs (step 35)

  // --- step 26 → 27 · the ONE mutable field ---
  moonShadows: boolean;          // MUTATED in key-light step (L1379–1383); init false, read by sky-bodies
}
```

**Read-only vs mutated:** every field is read-only after its producer step **except `moonShadows`**, which is initialized `false` and set inside the key-light rig (step 26), then read by sky-bodies (step 27). It must be a real field (init `false`, not `undefined`) because the rig can skip its write when `sunLight` is absent yet sky still reads it.

**Note on `_focus` / `_focusUp` / `_upBefore`:** their per-frame *values* belong to the frame, but the backing `Vector3` objects stay closure-scoped scratch (zero-alloc contract). Pass the references through; never re-`new` them per step.

### Closure state that STAYS closure-level (persists across frames — never hoist into FrameContext)

- **Cross-frame carries:** `lastFrameMs` (L677→676), `lastAlt` (written ~L973 → read L686 next frame), `pendingZoom` (banked zoom), `zoomGlideLastAlt` + `zoomStallCount` (zoom-glide stall detector), `lastGroundM` (sticky street floor), `lastInteract` (12 writers + DOM handler; idle-drift gate — trap c).
- **`frameCount`** — closure var; `++frameCount` embedded at L1419. **Do NOT hoist / do NOT snapshot per step** (trap a); the pre/post-increment split is load-bearing.
- **FPV state:** `fpvActive`, `fpvKind`, `fpvYaw`, `fpvPitch`, `fpvDragId`, `fovTargetDeg`, `fpvEyeM`, `fpvLiftM`, `fpvAnchorGroundM`, `fpvEyeAboveGroundM` (all shared mutable, cross-step & cross-frame — trap h).
- **Temp-FPV entry basis:** `_tempFwd0` / `_tempUp0` / `_tempRight0` — captured at entry, read every later frame (trap i). NOT reusable scratch.
- **Encoder low-pass state:** `appliedHeadingRate`, `appliedZoomRate`, `appliedFovRate`.
- **Pointer state (DOM-written):** `hoverX` / `hoverY`.
- **Temp-pin memo:** `tempPinGroundM`, `tempPinKey`.
- **Error throttle:** `updateErrCount`, `lastUpdateErrLogMs`.
- **Ephemeris globals (one sample drives all lights):** `sunDirW` / `moonDirW` / `moonPosW`, `sunAngRad` / `moonIllum` / `moonKs` / `gastRad`, `lastSampleMs`.
- **All scratch objects:** `_focus` / `_focusUp` / `_upBefore` / `_camFwd` / `_pivot` / `_pivotUp` / `_camBack`; quaternions `_qFull` / `_qCounter` / `_qHead` / `_driftQ` / `_fpvQ` / `_hudQ`; `_east` / `_north` / `_fh`; `_fpvFwd` / `_fpvUp` / `_fpvRight` / `_fpvUpGeo` / `_fpvLook`; `_hudDir` / `_hudDir2`; ray/NDC scratch `_pickRay` / `_pickNdc` / `_pinRay` / `_hoverAnchor` / `_tempPinEcef`; colors `_keyWhite` / `_goldenCol` / `_moonKeyCol`; consts `_Z`, `_driftAxis`, `driftRadPerFrame`.

---

## 3. The ordered step-functions

Keep this EXACT order. Signatures assume each step is a closure over the module state above; `ctx` is the `FrameContext`. "reads/writes closure" lists the load-bearing shared vars each step touches (not exhaustive of pure scratch).

| # | Proposed fn | Lines | Purpose | Signature `(ctx)` + closure |
|---|---|---|---|---|
| 1 | `stepFrameTiming` | 675–677 | `now = performance.now()`, `dtMs = min(now-lastFrameMs, ORCH.maxFrameDtMs)`, advance `lastFrameMs`. | writes `ctx.now`,`ctx.dtMs`; writes closure `lastFrameMs`. **Unconditional, first.** |
| 2 | `stepZoomBrakeAndEase` | 679–701 | Shrink `controls.zoomSpeed` below `zoomSlowAltM` via `lastAlt` smoothstep; build `zc` shim; exp-ease `pendingZoom`→`zc.zoomDelta`; snapshot `zoomStep`+`_upBefore`. | reads `ctx.dtMs`, closure `lastAlt`,`pendingZoom`; writes `ctx.zc`,`ctx.zoomStep`, closure `pendingZoom`,`_upBefore`. |
| 3 | `stepControlsUpdate` | 703 | `controls.update()` — library integrates eased zoom/pan/rotate. | reads `ctx.zc` state. Must sit between steps 2 and 4. |
| 4 | `stepDampedVerticality` | 705–717 | Counter-rotate the library's overhead-walk (slerp `_upBefore`↔`zc.up`, gated by `zoomStep>0`); apply to camera; `camera.updateMatrixWorld()` at L717. | reads `ctx.zoomStep`,`ctx.zc`, closure `_upBefore`,`_qFull`,`_qCounter`. |
| 5 | `stepBuildingsUpdate` | 718 | Advance OSM buildings tileset vs current camera. | reads camera world matrix (committed by L717). |
| 6 | `stepFlightUpdate` | 720–722 | Active cinematic flight overrides pose; refreshes `lastInteract`. | reads `ctx.now`; writes camera + closure `lastInteract`. |
| 7 | `stepExploreJourney` | 724–742 | Read camera store (`camS` @ L728); competing steering exits explore; `explore.setActive` via **fresh** `getState().exploreActive` @ L740; `explore.update`. | reads `ctx.now`,`ctx.dtMs`, closure `fpvActive`; writes camera + `lastInteract`. **Keep L740 re-read (trap m).** |
| 8 | `stepFpvTransitions` | 744–872 | Capture `upNow`/`camNow`; compute `wantKind`; on kind change run enter/exit (start flight, toggle `controls.enabled`/`adjustHeight`, ghost, seed `fpvYaw/Pitch/Lift/Eye`+`fovTargetDeg`, capture temp basis, set `fpvActive`/`fpvKind`). | writes `ctx.upNow`,`ctx.camNow`; mutates all `fpv*`,`fovTargetDeg`,`_tempFwd0/_tempUp0/_tempRight0`,`fpvAnchorGroundM`,`lastInteract`. **Producer of the store snapshots.** |
| 9 | `stepFpvPose` | 873–924 | When `fpvActive`: if `!flight.active()` re-read anchor, apply `fpvYaw`/clamped `fpvPitch`, set `up`/`lookAt`, `updateMatrixWorld()` @ L919, pin `lastInteract`; **then** `controls.adjustCamera(camera)` @ L923 (outside the flight guard). | reads `fpvActive/fpvKind/fpvYaw/fpvPitch/fpvEyeM/fpvLiftM`, temp basis; writes camera, clamps `fpvPitch`. **adjustCamera gated ONLY on `fpvActive` (trap d).** |
| 10 | `stepFovGlide` | 925–930 | Exp-ease `camera.fov`→`fovTargetDeg`, snap within `fovArriveDeg`, `updateProjectionMatrix()` @ L929. | reads `ctx.dtMs`, closure `fovTargetDeg`; writes `camera.fov`. |
| 11 | `stepGeodeticAltitude` | 932–934 | `alt = WGS84_ELLIPSOID.getPositionElevation(camera.position)` — the final camera pos. | writes `ctx.alt`. **Compute once; no downstream recompute (trap g).** |
| 12 | `stepViewFocus` | 936–973 | Cast camera-forward→ellipsoid → `_focus`/`_focusUp`/`focusHit` (sub-camera fallback past limb); pin-focus-lock override when `!fpvActive` + selected pin (`focusLocked`); `hasFocus`; `lastAlt = alt`. | reads `ctx.alt`,`ctx.upNow`,`fpvActive`; writes `_focus`/`_focusUp`,`ctx.focusHit/focusLocked/hasFocus`, closure `lastAlt`. **Frozen-for-frame (trap e).** |
| 13 | `stepIdleDrift` | 975–985 | If motion not reduced, `alt>DRIFT.minAlt`, no interaction within `resumeMs` (**fresh `performance.now()` @ L979**), apply LEO drift quaternion. NO `updateMatrixWorld`. | reads `ctx.alt`, closure `lastInteract`,`_driftQ`,`_driftAxis`. **Fresh clock, no matrix flush (traps c, f, k).** |
| 14 | `stepTiltGlide` | 987–1016 | Capture `camStore` @ L991 (fresh re-read); glide pitch→clamped `targetTiltDeg` about `_focus` pivot via `zc._applyRotation`; `updateMatrixWorld()` @ L1014; clear on arrival. | writes `ctx.camStore`; reads `ctx.dtMs`,`_focus`,`ctx.zc`,`flight.active()`,`fpvActive`. **Producer of SNAPSHOT #2 (trap b).** |
| 15 | `stepHeadingGlide` | 1018–1040 | Rigid-rotate camera about `_focusUp`→`targetHeadingDeg`; `updateMatrixWorld()` @ L1037; clear on arrival / pole-NaN. | reads `ctx.camStore`,`_focusUp`,`ctx.dtMs`,gates. Same `_focusUp` as mirror (readout agreement). |
| 16 | `stepZoomGlide` | 1042–1081 | Log-space ease altitude→terrain-clamped `targetZoomAltM` by dolly along camera→`_focus` (or radial past limb); stall-release; `updateMatrixWorld()` @ L1076. | reads `ctx.camStore`,`ctx.alt`,`_focus`,`ctx.hasFocus`,closure `lastGroundM`,`ctx.dtMs`; writes closure `zoomGlideLastAlt`,`zoomStallCount`. |
| 17 | `stepEncoderRates` | 1083–1152 | Define `kRate`/`rateAllowed`; low-pass heading & zoom sticks; apply heading rate (`fpvYaw` in FPV else rotate about `_focusUp`) + zoom rate (`fpvEyeM`/`fpvLiftM` in FPV else alt dolly); `updateMatrixWorld()` @ L1107/L1148; pin `lastInteract`. | reads `ctx.camStore`,`ctx.dtMs`,`ctx.alt`,`_focus`,`_focusUp`,`ctx.hasFocus`,`fpvActive/fpvKind`; writes `ctx.kRate`,`ctx.rateAllowed`, closure `appliedHeadingRate`,`appliedZoomRate`,`fpv*`,`lastInteract`. |
| 18 | `stepFocalEncoder` | 1154–1165 | FPV-only: low-pass FOV stick, nudge `fovTargetDeg` in `[minFovDeg,maxFovDeg]`, pin `lastInteract`. | reads `ctx.kRate`,`ctx.rateAllowed`,`ctx.camStore`,`ctx.dtMs`,`fpvActive`; writes `fovTargetDeg`,`appliedFovRate`,`lastInteract`. |
| 19 | `stepStreetFloorGuard` | 1167–1191 | Below `groundGuardMaxAltM` (no FPV/flight), sample terrain at `_focus`→`lastGroundM`, push camera radially up to `lastGround+zoomMinAltM`; `updateMatrixWorld()` @ L1188. | reads `ctx.alt`,`_focus`,`ctx.hasFocus`,gates; writes closure `lastGroundM`. |
| 20 | `stepLocationFinderFlyTo` | 1193–1226 | Consume one-shot `flyRequest`: terrain-aware arrival pose, `flight.start`, exit explore, pin `lastInteract`. | reads `ctx.camStore`,`ctx.now`,`fpvActive`; writes flight + `lastInteract`. |
| 21 | `stepFpvSolidity` | 1228–1251 | FPV-only: eye-above-ground (photo: `alt − fpvAnchorGroundM` low-cadence refresh; temp: `fpvEyeM`) → `buildings.setGhostSolid` via smoothstep. **PRE-increment gate @ L1235.** | reads `ctx.alt`,`fpvActive/fpvKind`,`ctx.upNow.placement`, closure `frameCount`; writes `fpvAnchorGroundM`,`fpvEyeAboveGroundM`. |
| 22 | `stepFpvHudAndSkyMarkers` | 1252–1334 | At hud cadence (**PRE-increment @ L1252**): ENU basis, sun/moon frame-markers + az/alt, sync sky chips, in FPV sync HUD; clear stores when no ref. | reads `frameCount`,`ctx.upNow/camNow`,camera+fov,`ctx.fpvEyeAboveGroundM`? (closure),`sunDirW`/`moonPosW`. Runs before `++frameCount`. |
| 23 | `stepPoseMirrorAndViewport` | 1336–1360 | At mirror cadence (**PRE-increment @ L1338**): sync thresholded tilt/heading/alt into camera store; report focus geo+alt to pins viewport (**fresh `getState()` @ L1358**); geocode bias. | reads `frameCount`,`ctx.zc`,`_focusUp`/`_focus`,`ctx.alt`,`ctx.camStore`. Last focus-frame consumer pre-increment (trap m). |
| 24 | `stepGroundUpdate` | 1362 | Advance ground tileset LOD for `alt`. | reads `ctx.alt`. |
| 25 | `stepEphemerisResample` | 1364–1366 | `tMs = sceneTimeMs()`; if moved beyond `SKY.sampleIntervalMs`, `sampleEphemeris(tMs)` (refresh sun/moon globals). | writes `ctx.tMs`, closure `sunDirW/moonDirW/moonPosW/…`,`lastSampleMs`. **Producer for steps 26/27/34/35.** |
| 26 | `stepKeyLightAndShadow` | 1368–1405 | Choose sun vs moon key by focus-relative elevation + alt gate; color/intensity/pos/target; ground shadow strength; `castShadow`; set `moonShadows`. | reads `ctx.alt`,`ctx.focusHit`,`_focus`,`_focusUp`, ephemeris dirs; **writes `ctx.moonShadows`**. |
| 27 | `stepSkyBodies` | 1407–1416 | Camera-anchored sun/moon impostors at true apparent sizes; moon intensity 0 when rig carries the moon key. | reads camera, ephemeris dirs, `ctx.moonShadows`. |
| 28 | `stepFrustumResnapAndTick` | 1418–1419 | **`++frameCount`** and, on resnap cadence, re-raycast placed photo onto refined terrain. | mutates closure `frameCount` **at exactly L1419** (trap a). **Order pin.** |
| 29 | `stepPinsUpdate` | 1421–1425 | Mirror selected pin, distance-scale markers, lazy resnap grounding. **POST-increment gate @ L1425.** | reads `ctx.upNow.viewingPinId`,camera,`frameCount`. |
| 30 | `stepPinHover` | 1427–1471 | On cadence (**POST @ L1440**): raycast under pointer → hover/glow pin, mirror screen anchor (cluster-aware), toggle cursor; stand down in FPV/placing. | reads `fpvActive`,`ctx.upNow.phase`,closure `hoverX/hoverY`,camera,`frameCount`; **fresh `getState()` @ L1433 (trap m)**. |
| 31 | `stepTempPinMarker` | 1473–1513 | Position/scale temp-pin dot at angular-constant size, hide in FPV; on cadence (**POST @ L1489**) mirror on-screen pos or clear. | reads `ctx.camNow.tempPin`,camera,`fpvActive`,`frameCount`; **fresh `getState()` @ L1490 (trap m)**. |
| 32 | `stepPlacementMarker` | 1515–1540 | While `placing` (not FPV), on cadence (**POST @ L1519**) re-pick ground under pointer + scale accent dot; else hide. | reads `ctx.upNow.phase`,`fpvActive`,`hoverX/hoverY`,camera,`frameCount`. |
| 33 | `stepGraticuleAndAtmosphere` | 1542–1547 | Toggle graticule above `GATES.decorMinAlt`; update atmosphere/sky-dome. | reads `ctx.alt`,camera. |
| 34 | `stepStars` | 1549–1559 | Update star field (`alt`/camera/**fresh `performance.now()`-t0** @ L1552/reduceMotion/`gastRad`/`sunDirW`); asterisms only in FPV+skyGuides. | reads `ctx.alt`,camera,closure `t0`,`gastRad`/`sunDirW`,`fpvActive`,`ctx.camNow.skyGuides`. **Fresh clock (trap k).** |
| 35 | `stepDayArcs` | 1561–1572 | FPV sun/moon day-arc overlay for current anchor when FPV+skyGuides, split past/future by scene time. | reads camera,`ctx.tMs`,`ctx.dtMs`,`fpvActive/fpvKind`,`ctx.upNow.placement`/`ctx.camNow.tempPin/skyGuides`. Last real step. |
| — | *(catch, not a step)* | 1573–1580 | Throttled error catch (**fresh `performance.now()` @ L1575**): `++updateErrCount`, log first + ≤1/`ORCH.errorLogThrottleMs`. | closure `updateErrCount`,`lastUpdateErrLogMs`. **All 35 steps stay INSIDE this one try (trap j).** |

---

## 4. Traps & guards

Each subtlety below survives typecheck but breaks the scene if violated.

**(a) `++frameCount` at L1419 splits every cadence gate into pre/post groups.** `frameCount` starts 0 (L578). PRE-increment readers: `stepFpvSolidity` %30 (L1235), `stepFpvHudAndSkyMarkers` %3 (L1252), `stepPoseMirrorAndViewport` %12 (L1338) — all see 0 and fire on frame 0. POST-increment readers: `stepPinsUpdate` (L1425), `stepPinHover` %N (L1440), `stepTempPinMarker` (L1489), `stepPlacementMarker` (L1519) — see 1 on the first frame. The increment also only advances on frames that actually reach L1419.
**Guard:** keep `++frameCount` at its exact site in `stepFrustumResnapAndTick`. `frameCount` stays shared mutable (closure var or by-ref) — never a per-step value copy. If you ever precompute gate booleans, compute the pre-set before step 28 and the post-set after; never all against one value.

**(b) `camNow` (L750) and `camStore` (L991) are two deliberate snapshots with store mutations between them.** Between them the transition block mutates the camera store: `clearAllTargets()` @ L765/L808/L851, `setTempFpv(false)` @ L838/L898, `upNow.setViewMode('orbit')` @ L794. The L991 re-read exists so the glides/encoders/fly-to see targets FPV entry/exit just cleared as `null`.
**Guard:** preserve TWO `getState()` reads in order — `camNow` at the transition boundary, `camStore` fresh after it. The whole glide+encoder+fly-to region (L991–1226) shares the one `camStore`; never feed `camNow` there. Do not hoist a single `const cam = getState()`.

**(c) `lastInteract` is shared mutable, 12 writers, and idle-drift re-reads a fresh clock.** Writers: flight (722), explore (741), FPV exit/entries (790/833/869), FPV pose (920), encoders (1097/1108/1132/1149/1164), fly-to (1225), + DOM `noteInteract`. Idle-drift @ L979 reads `performance.now() - lastInteract` (fresh, not `ctx.now`). Order: drift runs AFTER flight/explore/FPV writes (pause this frame) but BEFORE encoder writes (pause next frame).
**Guard:** `lastInteract` stays closure-level, written in place by every owning step. Keep idle-drift AFTER flight/explore/FPV-pose and BEFORE encoders. Idle-drift keeps its own `performance.now()` — do not substitute `ctx.now`.

**(d) `controls.adjustCamera(camera)` @ L923 must run every `fpvActive` frame, outside the `!flight.active()` pose guard.** FPV sets `controls.enabled=false`, so `controls.update()` @ L703 early-returns and skips the near/far fit; L923 restores it manually — even during FPV entry/exit flights and when posing failed.
**Guard:** gate `adjustCamera` ONLY on `fpvActive`, never on `!flight.active()` / `posed`. Keep it the last statement of the `fpvActive` branch, structurally sibling to (not nested in) the pose block. If `stepFpvPose` is `fpvActive && !flight.active()`, the `adjustCamera` call must live outside that inner gate.

**(e) `_focus`/`_focusUp` are a frozen-within-frame snapshot.** Written once (L946–950 ray/fallback, override L960–967 pin-lock), read by ~8 later steps (tilt L997, heading L1024/1033/1034, zoom L1070, encoders L1101/1104/1143, street-guard L1179, mirror L1343/1357, shadow rig L1377–1396). The mirror deliberately reuses the heading glide's `_focusUp` so knob and readout agree.
**Guard:** compute focus ONCE in `stepViewFocus`; treat immutable for the rest of the frame; pass via `ctx`. Forbid any downstream step from re-deriving focus from the (by-then-mutated) camera.

**(f) `updateMatrixWorld()`/`updateProjectionMatrix()` are bound to specific mutations; idle-drift intentionally omits one.** Flush sites: L717 (post-verticality, unconditional), L919 (FPV pose), L1014/1037/1076/1107/1148 (glides+encoders), L1188 (street clamp); projection @ L929 (FOV). Readers depend on freshness: view-focus `getWorldDirection` @ L940 needs L919; mirror `transformDirection` @ L1340 and `project()` @ L1452/1493 need the last move's flush. **Idle-drift (L982–984) mutates pose but does NOT flush** — so tilt-glide @ L999 reads the pre-drift matrix (L717). Intentional.
**Guard:** preserve every flush exactly where it is — add none, remove none. Keep L717 before view-focus, L919 inside FPV pose, and idle-drift WITHOUT a flush. Any matrix reader stays ordered after the flush it relies on.

**(g) `alt` (L934) is a once-per-frame frozen value reused by ~10 steps after the camera moves.** Consumed without recompute by zoom-glide, encoder-zoom, street-guard (`minAlt - alt`), mirror, `ground.update(alt)`, shadow gate, graticule, atmosphere, stars. `lastAlt = alt` @ L973 feeds next-frame braking; `zoomGlideLastAlt = alt` @ L1078 feeds next-frame stall detection.
**Guard:** compute `alt` once in `stepGeodeticAltitude`; thread via `ctx`; no downstream `getPositionElevation`. Preserve both cross-frame handoffs.

**(h) FPV state + `fovTargetDeg` are shared mutable with pose-BEFORE-encoder order and a read-modify-write clamp.** Pose (L873–921) reads `fpvYaw`/`fpvLiftM`/`fpvEyeM` and RMW-clamps `fpvPitch` @ L911. Encoder (L1089–1165) WRITES `fpvYaw`/`fpvEyeM`/`fpvLiftM`/`fovTargetDeg` — runs AFTER the pose, so steering applies next frame (intended one-frame latency).
**Guard:** keep all `fpv*` + `fovTargetDeg` + `fpvAnchorGroundM` shared. Preserve order pose → FOV-glide → alt → focus → … → encoders → focal-encoder. `fpvPitch`'s clamp stays solely in the pose step (no second clamp).

**(i) `_tempUp0`/`_tempFwd0`/`_tempRight0` are a CROSS-FRAME temp-FPV basis, not scratch.** Captured once at temp entry (L854–862), read every later frame's pose (L891–895); declared at closure scope (L467–469) so they survive between frames.
**Guard:** keep them closure-scoped, written only in the temp-entry branch, read by the temp pose branch. Never reuse as generic scratch, never re-declare inside a step-fn.

**(j) One try/catch wraps the whole frame.** Body L674–1572 is one try; a mid-frame throw aborts remaining steps (including `++frameCount`), next frame restarts from the top. Catch throttles logging.
**Guard:** call every extracted step from within the one existing `try`. Exactly one `catch` with `updateErrCount`/`lastUpdateErrLogMs` + its own `performance.now()`. No per-step try/catch; do not move the increment earlier "for safety."

**(k) Frame-timing is first + unconditional; three fresh `performance.now()` calls must stay fresh.** L675–677 write `now`/`dtMs`/`lastFrameMs` before any work, so dt survives early exits. Three sites intentionally re-call `performance.now()`: idle-drift (L979), stars elapsed (L1552), catch throttle (L1575).
**Guard:** frame-timing stays step #1, unconditional. Do not consolidate the three fresh calls onto `ctx.now`.

**(l) zoom-easing → `zoomStep`/`_upBefore` capture → `controls.update()` → verticality is a tight hand-off around `zc.zoomDelta`/`zc.up`.** `zoomSpeed` from `lastAlt` @ L681–687 (must precede update); easing mutates `zc.zoomDelta` @ L692–699; L700 captures `zoomStep`, L701 `_upBefore.copy(zc.up)` — BEFORE `controls.update()` @ L703 consumes/changes them; verticality @ L708–715 compares `_upBefore` vs new `zc.up` with `zoomStep>0`.
**Guard:** keep the exact chain in order; put `zoomStep`/`_upBefore` in `ctx`; never recompute them after `controls.update()`.

**(m) Several in-step `getState()` re-reads must be preserved verbatim.** Explore re-reads `getState().exploreActive` @ L740 (after its own `setExplore(false)` @ L738); fresh reads also at viewport L1358, hover L1433, temp-pin `st` L1490 — each intentionally after prior same-frame mutations.
**Guard:** keep every in-step `getState()` re-read exactly where it is; do not substitute an earlier snapshot.

---

## 5. Suggested migration recipe

Mechanical, one step at a time. The FrameContext is the *last* thing you introduce — not the first.

1. **Extract one step as a same-scope closure.** Pull a contiguous line range (start at the leaf steps: `stepGroundUpdate` L1362, `stepBuildingsUpdate` L718, `stepSkyBodies`, `stepGraticuleAndAtmosphere`) into a nested `const stepX = () => { … }` declared inside the same closure. It **reads and writes the exact same variables** (`now`, `dtMs`, `alt`, `_focus`, `frameCount`, `fpv*`, …) directly — no parameters yet. Call it in place. This is a copy-paste + wrap, nothing more.
2. **Run the gates after every single extraction:** `npx astro check` then `npm test`. Because the closure still closes over identical vars, both must stay green with zero diff in behavior. If either fails, you moved a line across a boundary — revert that one extraction.
3. **Repeat through all 35 steps, top to bottom, keeping the exact order and all inline flushes/gates.** Do NOT touch `++frameCount` (L1419), the two `getState()` snapshots, the fresh `performance.now()` calls, or any `updateMatrixWorld` while extracting. Every `stepX()` call stays inside the single `try`.
4. **ONLY THEN thread the `FrameContext`.** Once all steps are closures and green, introduce the `interface FrameContext`, build one `ctx` object at frame head (after `stepFrameTiming` populates `now`/`dtMs`), and convert the frame-locals (`now`, `dtMs`, `zc`, `zoomStep`, `alt`, `focusHit`/`focusLocked`/`hasFocus`, `upNow`/`camNow`/`camStore`, `kRate`/`rateAllowed`, `tMs`, `moonShadows`) from bare closure vars to `ctx.` fields, updating readers/writers together. Do this a few fields at a time, re-running `astro check` + `npm test` between batches. `_focus`/`_focusUp`/`_upBefore` objects stay closure scratch; only their values are "in" ctx by reference.
5. **Leave closure-persistent state alone.** Everything in §2's "STAYS closure-level" list keeps living in the outer closure — especially `frameCount`, `lastInteract`, `lastAlt`, all `fpv*`, the temp basis, ephemeris globals, and all scratch objects. Do not move them into `ctx`.
6. **File-header rewrite note.** After the split, replace the current monolithic top-of-`update()` comment with: (i) a one-line index of the 36 steps in order with their line-anchored names, (ii) an explicit "ORDER IS THE CONTRACT" banner citing traps (a)/(c)/(f)/(h) as the load-bearing orderings, and (iii) a "snapshots" note pointing at the `camNow` vs `camStore` split (trap b) and the `++frameCount` pre/post boundary (trap a). Keep the header short; the per-step doc lives on each `stepX` closure.

---

## 6. Browser verification checklist

`astro check` + `npm test` do not catch order regressions. Drive the real scene. All flows run against `wix dev` (`http://localhost:4321/`).

**Harness tiers (in order of preference):**
- **Tier 1** — Playwright MCP, desktop Chrome.
- **Tier 2** — Chrome-extension bridge (if Tier 1 wedges).
- **Tier 3** — scripted CDP via the `scripts/verify-s5-night.mjs` idiom (raw WS → `Runtime.evaluate`/`Input.dispatch`/`Page.captureScreenshot`). **Screenshots → `verify-shots/` only, never repo root.**

**PREAMBLE (run before EVERY flow):**
- Always `page.bringToFront()` (CDP: focus the target) before any timed read — an occluded tab throttles rAF to ~1 frame / several seconds and every ease/glide assertion silently fake-passes.
- Boot-poll up to 60s: `!!(window.__globe && window.__globe.camera && window.__cameraStore && window.__timeStore && window.__uploadStore && window.__pinsStore)`, then sleep ~3s for the first tile wave.
- Dismiss welcome + auto-explore with ONE canvas-center left click. Confirm `document.body.classList.contains('welcome-active')===false` and `window.__globe.explore().active===false`.
- **Live-tick guard:** sample `window.__renderer.info.render.frame` twice ~500ms apart, confirm it advanced. A stalled tick fakes every check.

**Flow 0 — Clean throttled catch (the highest-value B19 signal).** With console captured, run the whole checklist. **Expect ZERO `[globe] … update error (#N):` lines.** Even one means a step reads a `ctx` field its producer no longer wrote in order (TDZ/`undefined` for `_focus`/`alt`/`frameCount`/`fovTargetDeg`) — a B19 regression, not a pass. `__renderer.info.render.frame` keeps advancing throughout (a swallowed throw still ticks but freezes downstream mutations).

| # | Flow (steps proven) | Drive | DEV seams | Expected observable |
|---|---|---|---|---|
| 1 | **Idle drift + pause/resume** (1·13·23) | Sit at LEO > `DRIFT.resumeMs`; sample lon twice ~2s apart; then interact (`setHeadingRate(20)`→null) and re-sample. | `__globe.camera.position`, `__globe.alt()`, `__cameraStore.getState().headingDeg/focusLonDeg` | Untouched: slow lon creep (drift ran, after pose, before mirror). After interaction: static for `resumeMs`. Proves `lastInteract` threaded (trap c). |
| 2 | **Zoom braking + temporal ease + damped verticality** (2·3·4) | Read `controls.zoomSpeed` at LEO; `requestFly` alt≈1500; re-read near ground; wheel-in burst; watch tilt settle. | `__globe.controls.zoomSpeed`, `__globe.alt()`, `__cameraStore.getState().tiltDeg`, `flight.active()` | zoomSpeed shrinks toward `zoomSlowFrac` near ground (braking used last-frame `lastAlt`). Wheel eases over frames, not one snap. **tiltDeg does NOT snap vertical** (trap l/f: `_upBefore`/`zoomStep` captured pre-`controls.update`, counter-rotate after). |
| 3 | **Tilt glide** (12·14) | `setState({targetTiltDeg:80})`; watch ease + self-clear. | `targetTiltDeg`/`tiltDeg`, `flight.active()`, `fpv().active` | Eases to 80° over `tiltEaseTauMs`, clears within `tiltArriveRad`. **No 8→128km fly-away** on a horizon view (proves `_focus` pivot fallback + view-focus-before-glide). Off while flight/FPV. |
| 4 | **Heading glide + pin-focus-lock** (12·15) | `setState({targetHeadingDeg:90})`; repeat with a placed pin selected. | `targetHeadingDeg`/`headingDeg`/`focusLatDeg`/`focusLonDeg`, `frustum.current()` | Glides to 90°, self-clears; readout+knob agree (shared `_focusUp`). With a pin, orbit AROUND the pin (proves pin-lock wrote `_focus`/`_focusUp` before the glide, trap e). Pole/NaN clears target, no spin. |
| 5 | **Zoom glide + street-floor guard** (16·19) | Over a tall city, `setState({targetZoomAltM:2})`; also aim past the limb and zoom. | `targetZoomAltM`/`zoomAltM`, `alt()`, `ground.group`, `terrainHeightAt()` | Log-space glide arrives or STALL-RELEASES (target→null) resting on terrain; **never dives underground**; ground tiles stay loaded. Proves guard runs after zoom paths using `_focus`/`alt`/`hasFocus` (traps e/g). |
| 6 | **Encoder rates** (17) | `setHeadingRate(30)` ~1s→null; `setZoomRate(0.5)`→null. | `headingRateDegPerS`/`zoomRatePerS`/`headingDeg`, `alt()`, `explore().active` | Ramp-in/coast-out (low-pass via `kRate`, dt-first). Zoom within `zoomMin/MaxAltM`. Both set `lastInteract` (drift paused) and flip `explore().active→false`. Pivots on `_focus`/`_focusUp` (selected pin stays centered). |
| 7 | **Location-finder fly-to** (20) | `requestFly({latDeg:48.4647,lonDeg:35.0462,altM:1600})`; poll to completion. | `flyRequest`, `flight.active()`, `alt()`, `camera.position`, `explore().active` | `flyRequest`→null within a frame; `flight.active()` true→false; arrives ~1600m ABOVE rendered ground (terrain-aware, not underground on a plateau); explore cleared, drift paused through flight. |
| 8 | **Click-to-place → placement marker → onPlaced flight** (32·flight) | Drive upload store into `placing` (JPEG w/o GPS); move pointer; click to commit. | `__uploadStore.getState().phase/placement`, `flight.active()`, `frustum.current()` | Placement dot re-picks ground at `PLACING.repickEveryFrames`, angular-constant scale, hides past limb. Click → `placed`, arrival flight, `frustum.current()` non-null. Proves POST-increment gate + `Number.isFinite(hoverX)` threaded. |
| 9 | **Pin hover card + open** (30) | Hover pointer over a pin's screen px; read mirror; click to open. | `__pinsStore.getState().hoverPin/hoverScreen/hoverCount`, cursor, `__uploadStore.getState().viewingPinId` | Hover sets `hoverPin`/`hoverScreen`/`hoverCount`, cursor `pointer`; moving off clears + resets cursor. Click sets `viewingPinId` + flies. Proves POST-increment `%hoverEveryFrames`; stands down in FPV/placing. |
| 10 | **Temp pin dblclick + look-from-here + temp FPV** (31·8·9) | Synthetic dblclick (needs pointerdown/up pair first); confirm marker+popup; `setTempFpv(true)`; exit. | `tempPin`/`tempFpv`/`tempPinScreen`, `__globe.tempPin()`, `__globe.fpv()`, `flight.active()` | Dblclick sets `tempPin`; `markerVisible=true` only while `!fpvActive`; `tempPinScreen` mirrors when on-screen & in front. `setTempFpv(true)` → `active`, `kind='temp'`, `controlsEnabled=false`, `eyeM≈eyeHeightM`, entry flight then eye pose locks. Exit restores marker + clears ghost. Proves transitions-before-pose + POST-increment temp gate. |
| 11 | **Photo FPV entry/exit + ALT & FOCAL encoders + ghost→solid** (8·9·10·17/18·21) | With photo placed, `setViewMode('fpv')`; verify apex+FOV; `setZoomRate(0.5)` (lift), `setFovRate(0.5)`; exit `orbit`. | `__globe.fpv()` {active,kind,yawDeg,pitchDeg,fovDeg,fovTargetDeg,liftM,eyeM,eyeAboveGroundM,controlsEnabled}, `__globe.tiles`, `zoomRatePerS/fovRatePerS` | Entry: `active`,`kind='photo'`,`controlsEnabled=false`, flight seats apex, fov **glides** to photo vFOV (not a snap → FOV-glide after pose, trap h). ALT encoder raises `liftM` vertically (floor 0), `eyeAboveGroundM` grows, buildings ghost→solid via smoothstep (solidity reads `alt`+`fpvAnchorGroundM`+PRE-increment gate after the encoder). FOCAL narrows `fovTargetDeg` in `min/maxFovDeg`. Exit restores controls, clears ghost+targets. |
| 12 | **Day-arcs + sky markers + FPV HUD** (22·34·35) | In FPV with skyGuides ON, read HUD+markers; `setSkyGuides(false)` re-read; scrub time to move arc split. | `fpvHud`/`skyMarkers`/`skyGuides`, `__globe.dayArcs`, `__globe.bodies()` | FPV: `fpvHud` non-null (heading/pitch/fov/eyeAboveGroundM + sun/moon markers) at PRE-increment `%hudSyncEveryFrames`. `skyMarkers` non-null only with skyGuides; arcs+asterisms only when `fpvActive && skyGuides`. Toggling OFF nulls markers/arcs but KEEPS `fpvHud`. Scrub slides past/future split without rebuild. |
| 13 | **Ephemeris relight via scrubber** (25·26·27) | `__timeStore.getState().setTime(...)` day→golden→night; sleep > `SKY.sampleIntervalMs`. | `__globe.bodies()` {sunDir,moonDir,moonIllumination,moonKs,sampleMs}, `__globe.sunLight`, `__globe.sky.moonLight.intensity` | `sampleMs` advances only past the resample gate, then dirs move. Key warms through golden band at the focus (rig reads same-frame ephemeris + `_focus`/`alt`). In moon-shadow mode `sky.moonLight.intensity=0` (rig carries key → sky order held). |
| 14 | **GOLDEN GATE — night/moon shadows (scripted CDP, run LAST)** (26) | Reuse `scripts/verify-s5-night.mjs` verbatim: full-moon city night, quarter night, city day @ ~1600m Dnipro, + LEO. Screenshots → `verify-shots/phase55-36..40`. | `__globe.sunLight` {castShadow, color.getHexString(), intensity, position}, `__globe.sky.moonLight.intensity`, `__globe.alt()`, `__globe.bodies()` | City day (alt<`SHADOWS.maxAltM`, sun up, focusHit truthy): `castShadow=true`, intensity≈`SUN.keyIntensity`(1.5). Full-moon night: `castShadow=true`, color `bfd0e8`, intensity≈`moonKeyIntensity×moonKs`, dedicated moonLight→0. Quarter night: `castShadow=false`, moonLight back. LEO: `castShadow=false` (alt gate). **Byte-for-behavior identical to the pre-refactor run** proves the shadow step still reads `alt`+`focusHit`+`_focus`+ephemeris in order. |