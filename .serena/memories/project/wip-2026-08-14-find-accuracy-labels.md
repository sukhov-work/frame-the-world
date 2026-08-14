# WIP 2026-08-14 night-5 — FIND accuracy audit + in-sky dd.mm labels + sun extinction [SHIPPED desktop]

Twin: DECISIONS 2026-08-14 night-5 line. Gates: **vitest 851/851 (+9) · astro 0 err/5 hints**;
desktop browser-VERIFIED (CDP :9222 + wix dev :4321; shots `verify-shots/find-labels-01/02`,
`sun-extinct-A/B`). Owner-device taste tier OPEN.

## Owner order (this session)
"Verify sun standings on large zoom — predictions seem to jump unnaturally, especially near
horizon" → **VERDICT: math accurate; the caterpillar = two seasonal branches crisscrossing** +
one REAL churn bug found and fixed (row-indexed identity colours). Then: subtle dd.mm labels
(+ moon phase %) near each in-sky standing; sun dims near horizon.

## Accuracy audit numbers (owner pose 48.465542,35.069851 hdg 297.5 pitch 2.1 fov 7.4)
- Ladder over 365 d: smooth 0.13–0.22°/day per branch, monotonic; the "jump" = 269-day gap
  (05.08 → 01.05, sun out of frame at that wall-clock hour all winter). Branches OVERLAP in the
  frame corner (Aug descends fx −0.53→−0.99 fy .98→.19; May climbs fx −0.88→−0.03 fy −0.52→.99).
- Ghost-vs-render agreement: **sun 0.0024°** (sub-pixel at 185 mm). Moon: ghost topocentric
  (`horizontal()` = Equator(observer)+Horizon airless) vs geocentric dir = 0.976° — but the
  RENDER derives per-camera dir from the true position, so both pipelines agree topocentric.
- **Airless convention**: whole scene geometric (impostor renders geometric dir; horizontal()
  refraction-free). Vs REAL sky: horizon standing appears ~0.46° HIGHER (alt 0.157 → apparent
  0.618 measured), real sunset touch ~3–4 min later than render. §3.5 "refracted-labels /
  airless-geometry" convention codifies it. Surfaced to owner, NOT changed.

## The churn fix — identity colours glued to the date
`colorIdx` WAS the row index → any hit entering/leaving (minute scrub, ~1° pose-quantization
step) recoloured every ring downstream = "predictions jumped" without moving. NEW
`findStandingColorIdx(body, utcMs)` (findPalette.ts) = floor(utcMs/DAY) + {sun 0, moon 3, gc 6}.
Adjacent days → adjacent wheel slots (interleave preserved); same-day bodies differ. Panel row
swatch AND ghost mirror both use it. Browser-measured: 24/24 colours held across ±2 min scrub.

## In-sky labels (scene/findGhosts.ts)
- NEW `formatStandingLabel(utcMs, illum?)` in readout.ts → "14.08" / "14.08 · 62%" (LOCAL date).
  `FindGhost.illum` NEW (panel: moonIllum for moon, 0 else).
- Pooled DOM layer (skyNames/geoLabels discipline; class "sky-names" so welcome.css hides it),
  font 500 0.52rem var(--font-ui), identity colour + bg text-shadow; `dataset.k` guards
  text/colour writes; transform-only per frame.
- Opacity = effAlpha[i] (ghost's melt×nowGap×hover×fade) × `labelAlphaK .85`; floor
  `labelMinAlpha .06`; offset right of ring by screen radius (pxPerRad = vh/2/tan(fov/2)) +
  `labelPadPx 6`; NDC 1.02 cull + behind-camera cull (matrixWorldInverse z<0 check).
- De-clutter: `labelMinSepPx 34`, date order, hovered-first (its label never loses). At 185 mm
  the corridor showed 7/24 labels ≈ every-other-day — right density. hideLabelsFrom(0) on
  overlay-hidden, zero-insts, dispose.

## Sun extinction (scene/sky.ts)
- NEW pure `sunExtinctionK(sunAltDeg, skyK)` (moonDiscArms twin discipline, 4 tests):
  smoothstep 1 → `SKY.sunExtinctFloor .4` across `sunExtinctAltHiDeg 10°` → 0°; relaxed to 1 by
  skyK (ATMOSPHERE.skyFullAlt/GoneAlt — orbit has no air). DELIBERATELY not the airmass
  exponential (~10⁻³ at horizon — would erase disc + bloom; C2).
- NEW `uExtinct` uniform multiplies the WHOLE sun impostor colour (core + halo → bloom dims
  too); separate from uIntensity so setHoverGlow's re-derivation never fights it.
- sinSun/skyK derivation HOISTED above the sun anchor, shared with moon uDaySky.

## Verify env notes (NEW)
- `setFovRate(+N)` ZOOMS IN (fov shrinks); negative widens. Aim: `__cameraStore.getState()
  .requestSkyLook({azDeg, altDeg})` (works while FPV active; rewrites hash).
- 3d-tiles-renderer fade-plugin TypeErrors ("reading 'range'") during big look swings —
  library-internal tile-visibility race, PRE-EXISTING, not ours.
- Playwright-current tab ≠ window-selected STILL the #1 trap (rAF suspended until
  `browser_tabs select` — FPV "never engages").

Files: findPalette.ts · readout.ts · store/find.ts · FindPanel.tsx · scene/findGhosts.ts ·
scene/sky.ts · tuning.ts (FINDGHOSTS.label* ×4, SKY.sunExtinct* ×2). Taste knobs NEW:
labelAlphaK/.85 labelMinSepPx/34 labelPadPx/6 · sunExtinctFloor/.4 sunExtinctAltHiDeg/10.

Related: [[project/wip-2026-08-14-find-rework]] [[project/wip-2026-08-14-qol4-batch]]
