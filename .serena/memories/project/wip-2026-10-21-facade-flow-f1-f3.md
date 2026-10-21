# wip 2026-10-21b — THE FULL DESKTOP FACADE FLOW: F1 the gizmo · F2 persist · F3 residency + T171 K slots (IN PROGRESS)

Mode: implement · Tier: deep · Memory: serena. Owner order 2026-10-21 (DECISIONS 2026-10-21; plan
`rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md`): research fan-out (plan §5), then F1 + F2 + F3 built, gated,
browser-verified and SHIPPED (landed on master) in one session; subagents per slice; the main session owns the
shared files (`scene/buildingMaterial.ts` K-slot change, `StylizedTiles.ts`, `scene/photoProjector.ts`).
Release HOLDS until F2's save / edit / remove are verified live-safe (`verify-live-deletes.mjs`).

## Boot state (2026-10-21 23:26)
- The 2026-10-18 prototype ship PR #145 LANDED on master `b644ecd` (tree-identical to the ship tip `f7a2cd1`); the
  hook restored the checkout to master and deleted the ship branch. Clean tree. package.json 1.36.32 (the ship bump).
- Live: v1.36.30 (2026-10-14). The facade prototype is NOT live.

## Research rulings (5 Opus tracks, 23:30–23:45)
- K slots: PLAIN `sampler2D[K]` (K=4; 4 + 2K texture units of the WebGL2 minimum 16 under ULTRA's cascades → K ≤ 6),
  K UNROLLED blocks (`#pragma unroll_loop_start` — three's regex wants a LITERAL bound, no `continue`/`break`), per-slot
  early-out, derivatives once on `-vViewPosition` before the loop, front-to-back "under" compositing in feed order.
  `DataArrayTexture` + per-layer `copyTextureToTexture` from an ImageBitmap exists on 0.185 (the F4 lever, UNVERIFIED in
  a browser); depth stays K separate 2D targets (no depth-array attachment in three).
- KTX2/Basis: NO-GO for v1 — measured on the M3 (ktx2-encoder 0.6.0, 3.3 MB WASM, single-threaded): ETC1S 5.5–7.6 s,
  UASTC 12.5 s (36 s with RDO) for 2048×1536. JPEG q0.82 at 2048 px = 457–669 KB measured. v1 = the JPEG derivative made
  by repeated halving with `imageSmoothingQuality: "high"` (the existing `downscaleToJpeg` defaulted to LOW).
- Persist: `FacadePhotos` (ADMIN everything; JSON-in-TEXT for `targetFeatureIds` / `alignment` / `exifPose`; `gh5` for the
  residency `hasSome`; owner-only world read in v1 — C6), upload-url kind `facade` (image/jpeg, ≤ 6 MB, public,
  `/plux/facades`), the server copies URLs off verified descriptors (the models' posture), no quota (a 5000 rail).
- Gizmo: rotDeg = −heading · pitch +→+ · roll +→+ (derived from source, pinned by tests); TransformControls is absolute
  from the drag start → a GAINED re-place never fights it; no `showXYZ` flag → every scale box is UNIFORM; the orbit trap
  (GlobeControls raycasts the whole scene twice a frame) → `guardRaycast` on the helper + capture-phase listeners on the
  canvas's PARENT; the FOV must be an explicit H-FOV OVERRIDE (a focal write jumps off the focal35 path on the first drag).

## Progress log (fill as slices land)
- [x] research fan-out (5 tracks) — rulings above
- [x] main session: `buildingMaterial.ts` K slots (`PhotoProjectorSlot[]` feed, `uFtwProjSlot[K]`, `ftwProjOwn`), its test
  20/20 · `photoProjector.ts` the K-record pool (`request/release/setGeometry/setPriority/tick`, one depth render per frame,
  the draft = record 0) 22/22 · `PhotoFrustum.ts` (`hFovDeg` override + `onGeometry` + `apexHeights()`) ·
  `lib/decode/params.ts` `effectiveHFovDeg` · the journal facade domain · `tuning.ts` PHOTO_PROJECT F1–F3 knobs ·
  `StylizedTiles.ts` wired against the contracts (the flight gate `facadeFlyArmed`, `_syncApex`, residency step, the
  capture-phase gizmo listeners, the journal branch, DEV seams `facadeGizmo()` / `facades()`).
- [x] agents: A1 server+wrappers (42 tests) · A2 store+panel (81) · B gizmo module (63) · C residency store+markers (40) · D the flow
  harness · E the live verifier — all DONE; the `FacadePhotos` collection provisioned LIVE (36 fields).
- [x] gates: vitest 3,626 / 236 · astro 0/0 · `verify-facade-flow-2026-10-21 --skip-save` 9/9 · `verify-photo-projection-2026-10-18` 10/10.
- [x] DECISIONS 2026-10-22 line · NEXT_SESSION_PROMPT · backlog T169 BUILT / T171 BUILT / T173 new.
- [ ] ship → release behind the flag → `verify-facades-live.mjs` + `verify-live-deletes.mjs` → the RELEASE RECORDS line.

## The numbers (browser, dev, the house Chrome 2026-10-22)
- F1: MOVE −46.55 m west for a +120 px drag on the −X arrow at gain 0.5 (the camera 0.000 m); UNDO exact to 1e-9°; ROTATE 25° → 30.23°
  for 80 px on the Y ring (pitch / roll untouched, forward·up 0 → 0); SCALE 69.39° → 92.43° for 60 px outward on the X box (aspect 1.333333
  constant); the H-FOV override tan ratio 0.673556 exact; apex seated 87.55 m (1.7 m above ground) 63–73 ms after place().
- K slots: the close pose +86,717 saturated px ON vs OFF (the prototype measured +3,804 at a farther pose), ON/ON control 0.005 mean;
  frame cost p95 16.7 vs 16.7 ms (vsync); depth renders ×20 during the landing's tile stream, then one per change.

## Traps (new, 2026-10-22)
- The landing corrector's "lifted" test must be RADIAL (heights), never a distance — a close pose was yanked back to the arrival pose
  within 250 ms; any gizmo op / drag disarms the corrector; the arrival flight fires only on the phase transition into placed.
- `handlePx("X")` is often the NEGATIVE-side arrow (three's first picker part) → a harness reads the drag's expected sign off the
  screen-projected east; the rotate rings overlap on screen → search ring points with the module's own hover (`hoverAt`); three hides
  the XYZ scale picker in this configuration (`XY/YZ/XZ/XYZ` invisible) → the X box (uniform anyway).
- `wix dev` cannot elevate (T173): the client-credentials token for this app has `permissions: ""` (`ps: "<uuid>:dev"`), 403 on every
  ADMIN collection via REST too; live elevates through the adapter's `Authorization` header (`strip_bound_session`). Persistence is
  verified LIVE after a release (`verify-facades-live.mjs`). `npx @wix/cli@latest` refuses Node < 24.18 — use `node_modules/.bin/wix`;
  `wix token --site` glues its update box onto the token line.
- The first `wix dev` boot after new imports → `504 Outdated Optimize Dep` on every module: kill, move `node_modules/.vite` aside, restart.
- [ ] F1 the gizmo (T169)
- [ ] F2 persist (T169) — `FacadePhotos` + `/api/facades` + MY FACADES
- [ ] F3 residency + T171 K slots
- [ ] gates: vitest · astro check · harness `verify-facade-flow-2026-10-21.mjs`
- [ ] DECISIONS line + NEXT_SESSION_PROMPT + mem:core

Related: `mem:project/wip-2026-10-18-photo-projection-prototype` · `mem:core`.
