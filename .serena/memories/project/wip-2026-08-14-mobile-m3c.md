# WIP 2026-08-14 night-6 — MOBILE M3c: TARGET-sheet GHOSTS · long-press sky menu · tap-to-reveal [SHIPPED phone-viewport]

Twin: DECISIONS 2026-08-14 night-6 (shared line with the hover-floor fix —
[[project/wip-2026-08-14-night6-hover-floor]]). Gates: **vitest 856/856 · astro 0 err/5 hints**;
phone 402×874 browser-VERIFIED on /m (shots `verify-shots/mobile-m3c-01-target-ghosts.jpeg`,
`-02-longpress-skymenu.jpeg`, `-03-tap-reveal-arcturus.jpeg`, `-04-find-tap-jump.jpeg`);
desktop mouse regression re-verified post-edits. REAL-DEVICE tier open (T1). **M3 COMPLETE**
(M3a/M3b night-5b + M3c night-6) → next M-phase per MOBILE_PLAN is M4; the main track's next
is §3.5 sunsets-in-frame (PLANNING_QOL_PLAN).

## (a) GHOSTS → mobile TARGET sheet
`mobile/TargetSheet.tsx`: 4th `.m-toggle` GHOSTS (disabled !visible) + `{visible && ghosts}`
`.m-ghostrow` = ± steppers (clamps 1..8 mirror the store) + native `<select>` [1,2,5,10,15,20,
30,60] MIN (iOS wheel picker; desktop-parity option list). Pure skyStore writes
(setGhosts/setGhostCount/setGhostStepMin persist prefs) — NO pose-key gate needed. CSS
`.m-ghostrow/.m-ghostbtn/.m-ghostsel` in `styles/mobile/chrome.css` (tp-ghostrow twin, touch
scale — accepted two-shell dup). VERIFIED: prefs round-trip desktop⇄mobile (opened at count 8
from desktop prefs), 8→7 stepper, 1→10 MIN select, ghost chain draws on the /m globe.

## (b) Long-press sky menu on /m
- `SkyContextMenu` island mounted from **`m.astro`** (fence rule: NEVER from MobileShell —
  the MiniMap page-level exemption precedent).
- StylizedTiles: the M1 long-press timer (touch-only, 500 ms, move>clickDragPx cancels) now
  ARMS IN FPV TOO and arbitrates at FIRE time: `pickSkyBody` hit with alt ≥ skyMenuMinAltDeg
  → `setSkyMenu` (menu opens MID-PRESS, finger still down); else `fpvActive` → no-op; else
  orbit `dropTempPinAt` (unchanged). **Flag hand-off:** orbit `onPointerUp` keeps
  `longPressFired` ALIVE when fpvActive so `onFpvPointerEnd` (bound after) can swallow the
  lift — clearing it there caused double-action.
- SkyContextMenu gained a viewport clamp (useLayoutEffect: measure → margin nudge, resets per
  open) — also fixes desktop edge overflow (card floats up-right with no clamp before).
- VERIFIED: long-press on the moon (alt −0.05° ≥ −0.5 floor) opens the menu mid-press, menu
  SURVIVES the lift, full action set, no temp-pin drop in FPV, next canvas tap dismisses.

## (c) Tap-to-reveal — tap IS the mobile hover
Touch never rests a pointer → `hoverX` NaN / `anyPointerDown` gate meant NO hover affordance
ever fired on glass. NEW latch `tapRevealX/Y/Until` (`ORCH.tapRevealMs 2000`): seeded on a
TOUCH tap that missed marker+ghost and points skyward (≥ skyMenuMinAltDeg) — orbit seed in
onPointerUp after tryFindGhostClick miss (reuses the seated _pickRay), FPV seed in
onFpvPointerEnd. `stepSkyHover`: `tapLatch = until > now && !isFinite(hoverX)`; hx/hy feed the
WHOLE cascade (body glow, ghost pulse + sceneHoverKey row mirror, night star names); name
label lifts `tapRevealLiftPx 26` px when latch-driven (out from under the finger). Cleared on
any notePointerDown. VERIFIED: tap on Arcturus patch → "Arcturus · Boötes" @0.85, auto-fade
after expiry; empty-nameless-patch tap = silent (correct).

## Touch hit pads
`ORCH.touchHitPadK 1.7` — `matchMedia("(pointer: coarse)")` at attach → `hitPadK` multiplies
pickSkyBody candidate radii AND `findGhosts.pick(rayDir, padK)` (new optional param, default
1). Desktop ×1 byte-identical. Find-in-frame tap verified: 16.08 standing tap → setTime EXACT
+ moon tracked + camera unmoved (heading 250.6 held).

## Traps (re-confirmed)
- rAF tab-throttle: a deselected window drops the globe loop to ~1 fps — labels vanish +
  hover dies LOOKING like a code bug. `browser_tabs select` first, ALWAYS.
- React buttons on /m sometimes need the full pointer+mouse event train (pointerdown/mousedown/
  pointerup/mouseup/click) from evaluate; playwright real click can hang on "stable" while the
  dock conveyor animates.
- Synthetic touch PointerEvents MUST set `isPrimary: true` (constructor default false) or the
  long-press/FPV paths ignore them.

Files: mobile/TargetSheet.tsx · styles/mobile/chrome.css · pages/m.astro ·
panels/SkyContextMenu.tsx · globe/StylizedTiles.ts · globe/tuning.ts (ORCH ×3) ·
globe/scene/findGhosts.ts (pick padK). Taste knobs NEW: `ORCH.{tapRevealMs 2000,
tapRevealLiftPx 26, touchHitPadK 1.7}` + m-ghostrow sizing.

Related: [[project/wip-2026-08-14-night6-hover-floor]] [[project/wip-2026-08-14-mobile-m3ab]]
[[project/wip-2026-08-13-m2-fpv-touch]]
