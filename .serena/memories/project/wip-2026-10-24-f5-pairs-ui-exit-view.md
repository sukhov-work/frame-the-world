# wip 2026-10-24c — F5's PAIRS UI + SOLVED storage (T172's UI half) · the /m EXIT VIEW over the open map — BUILT + BROWSER-PROVEN on dev

Mode: implement · Tier: deep · Memory: serena · Model: claude-fable-5-1 (main) + 3 Opus 5.5 subagents (the /m EXIT VIEW slice · the server's SOLVED stamp + the bodies · the panel section).
Status: **BUILT, GATED (vitest 3,859 / 253 · `astro check` 0 / 0 / 29), BROWSER 13/13 on dev (`verify-facade-align-2026-10-24.mjs`), RECORDED (DECISIONS 2026-10-24c · backlog T172 / T197 · the ADR §3.1 · ARCHITECTURE §7g · contracts · the guide). The ship + the release follow (see the DECISIONS line after 2026-10-24c / NEXT_SESSION).**
Authority: `NEXT_SESSION_PROMPT.md` (2026-10-24) step 2 · the owner's micro-ask (verbatim): "on mobile in FPV minimap also add same button (in the same bottom place) `exit view` that we have in normal FPV screen (for ease of navigation, otherwise you need everytime to close minimap first and only then you can exist to global map)". No owner live read of T195 arrived (step 1 skipped).
Boot: master `e748d31` == origin, clean; no SHIP_ATTENTION; live v1.36.43.

## The design (the advisor's confirmations folded in)
- The record `alignment = { pairs: [{ uv, enu, target? }] ≤ 24, origin: { lat, lon, altM }, solved?: { pose, rmsPx, n, fovSolved, planar, at } }` (`lib/geo/facadeAlign.ts`, pure): the ENU ORIGIN is the apex at the FIRST pick and NEVER moves (a building point is absolute); `solved.pose` is the EXACT snapshot `restorePose` wrote — never rounded (pairs are: uv 6 dp, enu 3 dp).
- The SOLVED stamp stays SERVER-side: `derivePoseSource(pose, exifPose, solvedPose?)` → SOLVED while the six camera numbers equal `alignment.solved.pose` within `FACADE_POSE_EPS`, else EXIF, else MANUAL; POST (`facadeRecord`) + PATCH (`applyFacadeUpdate` re-stamps on a pose OR an `alignment` key against the EFFECTIVE alignment). The bodies carry `alignment` only when it holds pairs (the `targetFeatureIds` idiom).
- The altitude law: a MANUAL `altitudeM` = metres above the RENDERED ground (`PhotoFrustum.ts:173-177`) → the snapshot's `altitudeM` = the solved ellipsoidal apex − (apexAltM − apexAboveGroundM). On a slope the re-seated apex is off by the terrain delta over the move; the LIVE readout (`draftReprojection` of the seated pose) shows it; a second SOLVE converges.
- Escape has ONE owner — the orchestrator (`pairPick !== "none"` → `cancelPairPick()` + return, before FPV unwinds); the panel adds NO Escape listener (two listeners race: the second sees "none" and exits FPV).
- `startPairPick` drops the gizmo op to "none" so `onFacadeGizmoDown` (capture) cannot steal the globe click.

## The build (files)
- `src/lib/geo/facadeAlign.ts` (NEW, pure): the types, `parseFacadeAlignment` / `parseFacadeSolvedPose` / `solvedPoseOfAlignment` / `alignmentRecordOf`, the bridge `enuOfEcef / ecefOfEnu / enuOfGeodetic / geodeticOfEnu`, `rayThroughUv`, `uvOfClick`, `enuPoseOfDraft / intrinsicsOfDraft / draftReprojection`, `solveFacadeDraft(pairs, origin, draft, { solveFov, rails, now })`. `pnp.ts` +`facadePairsPlanar`.
- `src/store/facadePhoto.ts`: `pairs · pairOrigin · pairPick · pendingUv · solved`; `startPairPick / setPendingUv / completePair / cancelPairPick / removePair / clearPairs / _setSolved`; `openSaved` hydrates; `loadFile / ingest / clear` reset; `backToReview` drops a pick, keeps the pairs. `store/facadeSave.ts` `snapshotOf` → `alignment: alignmentRecordOf(…)`.
- `src/lib/wix/facadeRecords.ts` (the stamp) · `src/lib/save/facadeBody.ts` (`FacadeSnapshot.alignment`; the update body carries it when non-null).
- `src/components/globe/StylizedTiles.ts`: `castFacadeRaySet` / `castFacadeRay` (the probe's two FILL layers → `{ ecef, target }`; `castFacadeTarget` = `.target`), `castFacadePoint(ndc)` (+ `pickGround` fallback), `tryFacadePairClick` first in the orbit `onPointerUp` and the FPV tap path, the crosshair subscription, the Escape rung, `__globe.facadeAlign()` (`pick · pairs · origin · castAt · castUv · screenOf · enuOf`).
- `src/components/panels/FacadeAlignSection.tsx` (NEW, 470 lines; `FacadeAlignView` + `FacadePickOverlayView` + `FacadeGlobeHintView` + `solveFacadeDraftNow` + pure helpers), `FacadePhotoFlow.tsx` (the mount + SOLVED badges), `styles/facade-photo.css` (`.ff-align*`, `.ff-pick*`). Hooks: `data-facade-pair-add / -pair-row / -pair-remove / -solve / -solve-fov / -pairs-clear / -pick-img / -pick-cancel / -align / -pair-thumb / -pick / -pick-globe`.
- `/m`: `mobile/SceneActions.tsx` (`m-act--exit`; the tap closes the map window THEN `setTempFpv(false)`), `styles/mobile/fpv.css` (`body.m.mw-open .m-actions { z-index: 24; pointer-events: none }`, the other cells `visibility: hidden`, the exit cell `pointer-events: auto`).
- Docs: `contracts.md` (the record, the SOLVED rule, the seam), the guide `facade-align` (+ the pairs paragraph; the voice lint: bodies ≤ 5 sentences, keys ≤ 3 words), the ADR §3.1 / §5 / §12 / §13, ARCHITECTURE §7g, backlog T172 + T197.
- Tests (+~70): `test/lib/geo/facadeAlign.test.ts` 10 · `facadeAlignRecord.test.ts` 12 · `test/components/facadeAlignSection.test.ts` 14 · `facadePanel` +3 · `store/facadePhoto` +7 · `facadeRecords` +4 · `facadeBody` +3 · `facadeSave` +1 · `mobileFpvRail` +3.

## Measured (dev, the house Chrome, `verify-facade-align-2026-10-24.mjs` 13/13)
- d2 the apex 87.55 m over the 85.85 m street; d3 the truth = `castUv` 6 × 4 → 7 building points on 4 OSM ways; d4 the perturbation 4.47 m / +3° / +0.97 m.
- d5 six pairs through the UI: the ORBIT click lands **0.17–0.28 m** off the truth point (one screen pixel from a camera ~60 m back; 3 of 6 points visible from orbit, 3 by the seam); d9 the FPV tap **0.032 m**.
- d6 the UI-picked solve: **0.44 m / 0.20° (pitch 0.29°)** off the truth, RMS 4.3 px — the click noise, not the solver; **d6b six EXACT pairs: 0 m / 0° / RMS 0.0 px** against the real frustum + terrain (the live readout after the re-seat 0.8 px).
- d7 UNDO → the perturbed pose, 0 badges, the pairs kept; d8 Escape cancels both halves, the crosshair + `.pd-hint` while armed; d9 Escape inside FPV cancels the pick, FPV holds.
- m2 the exit cell's seat identical with the map open (333.5, 703.6 · 113 × 34), `elementFromPoint` = the cell, a tap 60 px beside it → `mw-canvas`; m3 one tap → `{ mapOpen false, tempFpv false }`.
- The unit twin: a FRONTO-PARALLEL wall cannot pin the FOV (zoom ↔ distance, the dolly-zoom) — `planar` + the note; two points on a nearer wall recover a 6° error to 1e-2°.

## Traps (new this session)
- A dev boot after moving `.vite` aside CHURNS: "Failed to fetch dynamically imported module", 504 on `.vite/deps/*`, a null `useState` (two Reacts) — restart ONCE MORE keeping `.vite`; curl 200s mean nothing, probe `import()` in-page.
- A facade-panel button below the aside's fold has a rect, but a CDP click lands under it — `scrollIntoView({ block: "center" })` first.
- Read the truth AFTER the ground tile under the apex streams in (`apexAltM − apexAboveGroundM > 20` in Dnipro); an apex at 1.7 m is the ellipsoid seat.
- The guide voice lint: bodies ≤ 5 sentences, aliases ≤ 3 words.

## The advisor's two catches (fixed before the ship)
- A re-opened SOLVED row's raw `poseSnapshot()` holds null roll / H-FOV overrides → `sameFacadePose` never matched → EXIF badges while the server said SOLVED. Now `facadePoseIsSolved` (FacadeAlignSection.tsx) compares the six numbers RESOLVED through the EXIF seeds (`facadeResolvedPoses`), the server's own compare; 3 tests pin the re-open.
- "Carry `alignment` only when non-null" + a null from the save store = a CLEAR + UPDATE kept the stored pairs (they came back on the next open). The save store now always provides it (`{}` with no pairs); the body rule stays for callers that never knew the row's pairs.
- Noted, not fixed: `mem:core` is ~16.9 KB against its 12 KB cap (pre-existing; a maintenance pass) · live leg 8b PATCHes right after leg 8 — a `lon` / SOLVED miss there means a stale read-modify-write, rerun once before blaming the stamp.

## Open for the owner
The live read of the pairs flow + the /m EXIT VIEW · T197 (the loupe · real-photo accuracy · lever 3 · the slope settle) · the ADR's §3.2–3.6.
