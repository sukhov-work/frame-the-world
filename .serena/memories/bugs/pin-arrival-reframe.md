# bug: high-altitude pin-selection jump lands SHIFTED — arrival re-framing fix (2026-07-11, browser-VERIFIED)

**Symptom (owner):** selecting a public pin from HIGH camera altitude / oblique tilt → the auto-flight
("jump") frames the photo OFF-CENTRE; shift grows with the *original* altitude AND tilt. City-scale
selection is precise. Pressing "camera view" (FPV) afterwards lands correctly.

## Root cause (adversarial-workflow CONFIRMED 85-92%, then browser-reproduced)
A public pin carries no altitude (C6), so the frustum rides on TERRAIN (`PhotoFrustum.rebuild`:
`altM = terrainH + eyeHeight`). From high/oblique selection the pin's tiles are unloaded/coarse, so
`ground.heightAt(pin)` returns **null or NEGATIVE garbage** -> `terrainH` captured wrong (~0). `onPlaced`
(StylizedTiles) fires the flight to a **static** arrival pose whose `lookAt` = the low plane-centre;
`flight.finalPose` is EXACT so it lands precisely on that stale point. As the camera descends and tiles
refine, `frustum.resnap()` lifts the frustum to the true height (~90-150 m in Dnipro) but the committed
flight target stayed low -> the photo lands shifted. **FPV works because FPV entry/exit + the orbit
focus-lock re-read `frustum.current()` LIVE** — only the initial jump used a snapshot. The altitude/tilt
correlation is a proxy for tile-load state at selection (nothing geometric in the arrival tilt itself).

Browser repro (scripted CDP, 697 km oblique over Dnipro): `heightAt(pin)` at selection = **-2047 m**
(negative garbage); the stale plane-centre projects to NDC y = **-0.134** vs the corrected NDC ~ (0,0).

## Fix (orchestrator-local re-framing + a clamp; NO change to the cinematic descent)
1. **`PhotoFrustum.ts`** — `terrainH` now goes through `clampGroundM` (import from `lib/geo/terrain`) at
   all 3 sites (new-key, refine, resnap compare). Coarse/unloaded tiles return NEGATIVE garbage; every
   OTHER terrain consumer already clamped — this seated the apex 2 km underground and enlarged the shift.
2. **`flight.ts`** — `FlightStartOpts.durationMs?` + per-flight `durationMs` (default `FLIGHT.durationMs`;
   annotate `let durationMs: number = ...` — `as const` narrows the literal to `2200`). Used only for the
   short corrective glide; all other callers (explore/FPV/search) unaffected.
3. **`StylizedTiles.ts`** — arrival re-framing state (`framingActive`/`framingLookAt`/`framingParams`/
   `framingStableFrames`/`framingReframes`/`framingDeadlineMs` + scratch `_reframeLook`/`_reframePrevLook`/
   `_reframeFwd`) + `beginFraming(pose)` helper (declared BEFORE `attachPhotoFrustum` so `onPlaced` closes
   over it). Armed by `onPlaced` AND the placed-photo FPV-exit. Per-frame step after the resnap line:
   while framing (and `!fpvActive`, phase `placed`), `frustum.resnap()` EVERY frame; once the live
   plane-centre (`apex + forward*planeDistM`) has been STILL for `reframeSettleFrames` (terrain done
   refining) AND diverged from `framingLookAt` by > `reframeMinMoveM`, re-fly a `reframeDurationMs` glide
   to `frameArrivalPose(live)` and update `framingLookAt` (bounded by `reframeMaxCount`/`reframeDeadlineMs`).
   **Disarm gates (critical — else it fights the user):** `noteInteract` (grab/wheel), `fpvActive`,
   phase!=placed, ANY manual glide/rate target (tilt/heading/zoom/heading-rate/zoom-rate), `exploreActive`,
   and — the fix-critic's catch — **a photo-param edit** (`upNow.params !== framingParams`: the
   PhotoDetailPanel heading/pitch/altitude encoders call `setParam` directly, firing neither `noteInteract`
   nor a camera target; without this gate the reframe chases the frustum on every slider nudge).

Tunables (`FLIGHT`): `reframeDurationMs 800 · reframeMinMoveM 10 · reframeSettleEpsM 1 ·
reframeSettleFrames 12 · reframeMaxCount 3 · reframeDeadlineMs 6500`.

## Why the `!flight.active()` gate is correct
The reframe never interrupts the initial cinematic descent; it fires only AFTER landing. `framingLookAt`
holds the ORIGINAL target, so a resnap that happened DURING the descent is still caught post-landing.
At CITY scale terrain settles during the short descent, so the correction MERGES into the landing frame
(sub-frame active-flag flip -> a transition counter reads "0 reframes" but the outcome is centred) —
seamless. From HIGH altitude terrain settles a bit after landing -> one visible ~800 ms corrective glide.

## Verification (all tiers)
- 325 vitest (added `createFlight durationMs` tests — short vs default landing; exact target landing) ·
  `astro check` 0 · `wix build` green.
- **Browser (scripted CDP, `scripts/verify-pin-reframe.mjs`, Node >=22 for global WebSocket — node20 lacks
  it; `~/.nvm/versions/node/v24.10.0/bin/node`):** HIGH 697 km -> NDC (0,0), 1 reframe, apex rose 54-69 m,
  -2047 garbage clamped -> 94 m. CITY 3.5 km -> NDC (0,-0.012), seamless. PARAM-GATE probe: `setParam(heading)`
  after landing -> camera moved 0.00 m, no flight -> NO chase. Shots `verify-shots/pin-reframe-01/02`.

Files: `PhotoFrustum.ts` · `flight.ts` · `tuning.ts` (FLIGHT reframe group) · `StylizedTiles.ts`
(framing state + beginFraming + onPlaced/FPV-exit arm + noteInteract disarm + per-frame step after the
resnap line) · `test/components/globe/flight.test.ts` · `scripts/verify-pin-reframe.mjs`.

Related: [[patterns/photo-frustum]] · [[project/wip-2026-07-11-phase5.5-s2]] (flight/arrivalPose/heightAt
traps) · [[patterns/members-pins]] (openSavedPin) · DECISIONS 2026-07-11 pin-reframe line. B19 will split
`update()` — the framing step is one self-contained block ready to become a step-fn.