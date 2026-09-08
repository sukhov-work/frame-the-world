# wip 2026-09-08d — regressions (T125/T127/T128) + the Pixel reads + T77 LEVER 8

Mode: implement, Deep (`/frame` under investigate-design-v3). Session after PR #116 (master `913ce5f`, package.json 1.36.3).
Order (owner 2026-09-08c): regressions → Pixel reads of the 2026-09-08b batch → lever 8 → [T126/T129/T130 next].

## T125 — edited buildings not highlighted (REGRESSION) — FIXED, both shells
- The suspects (reseatIdleSkip, two-phase load-model, positionsF32) were ALL innocent. The `_ftw_override`
  byte + `setOverrideTint` write the GPU correctly at every hour (probe read `tintByte` 255 at 22:30).
- CAUSE: the committed tint was ONE albedo pull at `<color_fragment>` (`mix(diffuseColor, uFtwAccent, K)`),
  a DIFFUSE term. The city's night identity is a DARK MASS (no night emissive, R3) → 24 % of ~0 ≈ 0.
- FIX (`scene/buildingMaterial.ts`): one `ftwOverrideK()` in `<common>` read TWICE — the albedo pull by day
  AND a per-channel FLOOR in LINEAR light after `<opaque_fragment>` (before the aerial haze; after tone
  mapping it is wrong in the direct-to-backbuffer pass) at `uFtwAccent × K × ENRICHED.overrideTintGlow`.
  `overrideTintGlow` = **0.22** (0.5 read as a neon slab at the dusk/night exposure, S11). Edge material
  untouched (edges carry no override attr).
- `featureState` gained `tintByte` (the GPU byte, not the `f.ov` cache — the old verify-meshedit read only
  the cache, so it could not catch a broken upload). Tests: `test/components/globe/buildingMaterial.test.ts`
  (4, the generated GLSL through the real onBeforeCompile); `verify-bldg-override.mjs` §8 (night leg: byte 255
  + the RENDERED building separates from a neighbour, PNG decoded in-page, Δ 41).

## T127 — a stray touch on /m clears the FPV pin — FIXED, /m-only
- The only tap-path clear was `StylizedTiles.onPointerUp`'s empty-map branch (≤ `ORCH.clickDragPx` release,
  no pin/model/marker), SHARED by both shells. NEW `lib/globe/emptyMapClick.ts`:
  `emptyMapClickAction({isMobileShell, hasTempPin, viewingSavedPin})` → `clear-pin|keep-pin|deselect|none`.
  `/m` + a set pin ⇒ keep-pin (still shadows deselect, as the desktop clear did); desktop unchanged.
- Double-tap-sets untouched (native dblclick → `dropTempPinAt`, lands after both pointerups); ✕ CLEAR PIN
  (`mobile/SceneActions.tsx`) is the one clear. `test/lib/globe/emptyMapClick.test.ts` (4) + a source fence.

## T128 — user-mesh single-axis scale was uniform — FIXED, both shells (owner overruled MS5 uniform design)
- `ModelTransform.scale: number` → `sx/sy/sz`; `clampModelEdit` rails each axis on its own per-edit band
  (`clampEditK(start.sx, raw.sx)` …); `uniformScaleFrom` deleted; `scene/userModels.ts` `body.scale.set(sx,sy,sz)`
  + three eases; `formatModelScale`/`scaledSizeM3` = the one writer of the per-axis chip/label copy.
- DB: `scale` becomes the HEIGHT (sy) factor; NEW `scaleX`/`scaleZ` columns PROVISIONED LIVE
  (`node scripts/provision-collections.mjs` → `+ UserModels.scaleX/scaleZ`). Legacy uniform rows read (k,k,k);
  the PATCH keeps a `scale` uniform alias. 19 files; done by a sub-agent in an isolated worktree under the
  RESOURCE BUDGET (focused vitest only), patch `git apply`ed to master's tree; the worktree removed.
- Twin (real gizmo drag, `verify-usermodels` 21 legs): the X box → sx 7.35, sy/sz 1, rig body scale [7.35,1,1],
  row "22.0 × 3.00 × 5.00 m (7.35 × 1.00 × 1.00)".

## THE PIXEL READS OF THE 2026-09-08b BATCH — PASSED (real glass, 105/105)
- `node scripts/verify-mobile-batch-2026-09-08.mjs 9444 --device`. The AR bubble with real sensors, the ◎ SAVE
  cell + hint, LIVE tabs + long-press, the encoder under a thumb, FIND live in FPV — all green.
- **CDP TOUCH IS A MIRAGE on Android Chrome 152** (measured): `Input.dispatchTouchEvent` never answers while
  another window is focused; when Chrome is focused it delivers only `mousedown`+`click` (no pointerdown/
  touchstart); `synthesizeTapGesture`/`synthesizePinchGesture` hang; `sendevent` on `/dev/input/event3`
  refused by SELinux. **The only real touch on the phone is `adb shell input`** (tap / swipe = long press with
  a duration / motionevent) — SINGLE-POINTER. NEW `scripts/lib/adbInput.mjs` (CSS px in, one-tap calibration
  of the toolbar offset ≈ 97.5 CSS px @ DPR 3.5). The harness routes every single-finger `--device` leg through
  it and REFUSES to start unless `dumpsys window` shows Chrome focused. **Two-finger gestures (twist T120,
  pinch, T129 pan) have NO injection path on the phone — twin is the harness tier, the owner's thumb the
  device tier** (INFO on --device). `tools/devicefarm/README.md` §B records all this. `adbTouch.mjs` (sendevent)
  was TRIED and DELETED — SELinux refuses it.

## T77 LEVER 8 — the terrain BVH — BUILT (Pixel read OWED)
- `lib/globe/terrainBvh.ts` — IN-HOUSE (the lockfile pins `npm.dev.wixpress.com`, unreachable off-VPN; a
  mixed-registry lockfile is a release trap). Flat median-split tree per terrain tile, built LAZILY on first
  raycast that reaches the tile, dropped with it. `GROUND.terrainBvh` kill switch (default true). Geometry
  NEVER touched → render byte-identical. Unit-pinned BIT-IDENTICAL to three's `Mesh.raycast` on six tile
  shapes (`test/lib/globe/terrainBvh.test.ts`, 8). `installTerrainBvh`/`dropTerrainBvh` in `scene/imageryGround.ts`
  on the swapped terrain meshes. DBG `terrain.bvh.{builds,raycasts,trisPerRay,buildMsWorst}` (fmt `float2`/`ms1`);
  `__globe.terrainBvhStats()`.
- Desktop descent A/B (stash idiom, MEASUREMENTS §28): whole-leg controls **800 → 246 ms**, `intersectTriangle`
  **198 → 30 ms**, hitch-frame controls **117 → 65 ms**. Desktop hitches stay compile-bound; the phone leg
  (§27.2, rawHeightAt 315 + stepTiltGlide 138 ms IN the hitches) is where it should move frames → PIXEL READ OWED.

## Gates at session end
vitest **3,021/199** · astro **0/0/12** · knip **0** (`adb` added to `knip.json` ignoreBinaries) ·
verify-mobile-batch **118 twin / 105 Pixel** · verify-usermodels **21** · verify-bldg-override PASS (+ night) ·
verify-meshedit PASS · sweep `post-2026-09-08d --compare post-2026-09-08b` draw-count **14/14**.
App version 1.36.3 (ship bumps to 1.36.4).

## Traps this session
- `verify-usermodels` leg 5 was RED at HEAD since 2026-09-06h (NOT a T128 break) — the SCALE box picker faces
  the camera on the arm OPPOSITE `handlePx`, and the yaw leaves the X axis ~8 px end-on. The leg now SWEEPS the
  gizmo origin for the axis that answers. A `git stash` A/B at HEAD proved it pre-existing.
- A GLSL `//` comment containing a backtick inside a template literal TERMINATES the literal (Vite 500). No
  backticks in injected-GLSL comments.
- After the T128 landing the Vite dep cache 404'd a dynamically imported GLTFLoader → restart `wix dev` with
  `.vite` aside (the standing globe-tuning trap).

## Not done — next session (owner order)
T126 (UNDO + drop-session-edits, both shells; design the per-session journal first, MESH_SUITE_PLAN §4a binding) ·
T129 (retire the 2D two-finger parallel-DRAG rotation → pan; the twist is the one rotation gesture) ·
T130 (the Pixel + AWS Device Farm iPhone campaign, STRESS + FEATURE; decides T123 jetsam + T124 vanishing meshes) ·
the Pixel read of lever 8 · `applyFeatureSeats` 427 ms / the ephemeris 86 ms in the hitches.
See [[core]], [[wip-2026-09-08-mobile-uxbatch-heatmap-gestures]].
