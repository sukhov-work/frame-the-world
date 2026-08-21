# wip 2026-08-21e — OWNER BATCH #6 (4 fixes on batch #5, same session) — COMPLETE

DECISIONS 2026-08-21e. Gates: vitest 1,109/1,109 · astro 0 err/5 hints · verify S1 23/23 +
s2 16/16 (2 superseded) + s3 18/18 + uxb5 17/17 + NEW verify-uxbatch6.mjs 12/12
(shots uxb6-01..05; 05 = dedicated /m low-alt band-stack close-up).

## What shipped
1. **Placed point owns the map radar** — MapWindow `aimAnchorNow` → `tempPin ?? camGeo ??
   focus` (camGeo-first kept the radar glued to the walking viewer after a place = the
   "buggy offset"). KEPT side effect (judged good): a STANDING temp FPV re-derives its camera
   from tempPinPoint() each frame → placing a point relocates the under-map FPV → the PiP
   previews the NEW standpoint → tap = you're there (fills batch #5's no-jump-affordance
   gap; a WALKED FPV keeps its walk track — mixed but sane).
2. **Band stack reorder + compaction** (supersedes batch-#4 "sun inner / moon outer" sketch):
   moon INNERMOST · sun above · target small-gap above sun at 3× band width.
   Desktop bandMoon [0.3,0.38] / bandSun [0.42,0.5] / bandTarget [0.55,0.79];
   mobile [0.24,0.32] / [0.34,0.42] / NEW bandTargetMobile [0.46,0.7].
   N marker rides bandTarget[1]×northOffsetK on GL (per-frame position.y) + MapWindow;
   minimap keeps DOM .mm-n. "Lost moon" diagnosis: the silver ring reads near-invisibly on
   bright imagery (+ possibly a session-dismissed MOON direction) — drawn + innermost now;
   silver-alpha bump is a T1 taste candidate.
3. **Focal cone from boot + mm readout** — stepPlannedView seeds a null plan eagerly (live
   heading + horizontalFovDeg(FPV.tempFovDeg, camera.aspect)); NEW pure focalMmFromHFov()
   (lib/geo/plannedView, 18/tan(hFov/2), 36mm frame) + Joystick `footer` prop; AimJoystick
   footer = formatFocal(fpvHud→live hFov, else plannedView.hFovDeg) — `.m-joy__footer`.
4. **/m aim stick re-seated** — minimap-corner instance DESKTOP-ONLY (MiniMap gates
   !mobileShell); MobileShell renders ONE always-mounted AimJoystick
   `variant={fpvOn ? "fpv" : "map"}`; `.m-joy--aim-fpv` = walk rail, bottom+120px (108px pad
   + 12 gap); rides body.mw-open z-24 → the stick survives the fullscreen-map view (batch #5
   hid the .mm card that used to carry it).

## Files
tuning.ts (band reorder/compact + bandTargetMobile) · scene/aimCones.ts (bandFor target
variant, N per-frame seat) · panels/MapWindow.tsx (anchor order, bandFor variant, N seat) ·
panels/MiniMap.tsx (bandFor variant, !mobileShell joystick gate) · mobile/MobileShell.tsx
(always-mounted stick, fpv variant) · controls/Joystick.tsx (footer prop, variant "fpv",
focal readout) · lib/geo/plannedView.ts (focalMmFromHFov) · StylizedTiles.ts (boot plan
seed) · styles/mobile/fpv.css (.m-joy--aim-fpv seat, .m-joy__footer) · tests: aimCones.test
(band order/3×-width/off-rim invariants), plannedView.test (+2) · scripts: verify-uxbatch6
NEW · verify-uxbatch4-s2 (2 superseded checks) · verify-uxbatch5 (press point off the rail).

## Traps (new)
- The /m left rail is TWO stacked z-24 pads now (walk + aim) — synthetic long-presses on the
  fullscreen map below x≈126 CSS px land on the sticks, not the chart (bit uxb5's 110,480
  press; moved to 230,520).
- `wix dev` on :4321 DIED mid-session (curl 000, no listener) — restart + the uxb6
  "engine booted" waitFor guard for cold-rebundle slow first loads.
- GL widths anchored to aimCones groups: measure in the OUTERMOST-band frame after the
  compaction (unit 1.0 no longer carries ink).

## Open tails (T1)
- Moon-band silver readability on bright ground (alpha bump candidate).
- 108px aim-pad size taste (owner's "keep current size" read as the standard pad, not the
  72px corner one).
- Place-point-relocates-standing-FPV feel (PiP preview of the new point).
