# wip 2026-08-18f — UPLIFT U4 SHIPPED: direction lines + visibility cones on the 2D map

## What shipped (DECISIONS 2026-08-18f-u4-aim-cones; investigate-design-v3 implement mode, 3 evidence-cited scouts)
Owner point 3 (PhotoPills-style): from the plan anchor (the TargetPanel eye — plan-anchor ??
view-focus, the skyTrail rule), three azimuth systems — tracked target (accent) / sun (sunGlow)
/ moon (moonlight) — each a current-azimuth direction line + a rise→set ground sector for the
scene-local solar day, split at scene time: swept = `tokens.warn` amber / to-come =
`tokens.timeFuture` blue (BRIDGED into the GL token bridge; tokens.css comment updated —
supersedes "chrome-only").

### The pieces
1. **`src/lib/ephemeris/azSector.ts`** (pure, three-free) — `sampleAimDay` (target ×
   `targetElevationSeries` over `localDayWindow`; sun/moon via `bodyTarget()` — ONE ephemeris
   path, D6) → `AimDay { runs, kind: arc|ring|none }` with wrap-aware az lerp + horizon-crossing
   interpolation; `splitAimRuns(day, nowMs)` cheap per-paint past/future split; `wrap180`
   HOISTED here (was duplicated in frameFinder + sunEventFrame). 11-test twin
   (wrap/circumpolar/never-up/two-run moon/split/real-Dnipro-solstice).
2. **`scene/aimCones.ts`** — attach-module; UNIT-circle fan (per-wedge centre copies so the
   shader now-split cuts the straddling wedge radially) + rim + radial run edges (skipped for
   ring) + unit dir-line quad (`rotation.z = −az`); anchor ENU tangent frame with ECEF + eased
   radius IN THE MATRIX (zoom rescales, never rebuilds); per-vertex `aT01` vs `uNow01` COLOUR
   split (scrub never rebuilds); depth-free renderOrder 9 (dayArcs reasoning — flat sector
   can't follow relief; MAP-INK behaviour automatic); rebuild only on anchor > `anchorEpsDeg`
   0.02° / day-cross / target-swap (~145 eph calls/body); 3 `targetAzAlt` calls/frame for the
   lines; presence band `fullAltM` 25 km → `topAltM` 50 km; fade/radius/emphasis all eased.
   `AIMCONES` tuning block (registered in the roster). Wired as `stepAimCones` right after
   stepDayArcs (roster prose note added; store reads at orchestrator level — findGhosts idiom).
3. **MapWindow canvas twin** — memoised aim-day per (targetId, 0.001° anchor, day-start) +
   per-paint split; chart-fixed radius `AIM_R_FRAC` 0.3 (FOV-cone idiom); tokens import for
   colours (sunGlow/moonlight have no CSS var); `useSkyStore`/`useTimeStore`
   subscribe→requestRedraw (the `[open]`-effect trap); **tap-on-line PROMOTES** (az ±8°,
   radial [0.15,1.15]×compact reach, drag-cancel guard).
4. **Toggles** — prefs `aimTarget/aimSun/aimMoon` (default ON; sanitize + prefs test) + store
   setters that PROMOTE `aimFocus` on turn-on; `aimFocus` session-only (like `track`). ONE
   `∠ DIRECTION` row in the shared SkyContextMenu (per-body flag — deliberately NO
   ensureTracked for sun/moon; target row applies to the tracked target).
5. **Emphasis** — one body full (fill 0.12 after browser pass — 0.16 blanketed districts),
   others compact ×0.55 rim-only; fill alpha rides the SAME eased scale (no pops).

## Verification
Gates vitest **962/962** (+12: 11 azSector + 1 prefs) · astro 0 err/5 hints. Browser (wix dev +
Playwright CDP 9222, 1724×… desktop + 402×874 /m): u4-01 flat 1.5 km (all three systems, teal
line ON the amber/blue boundary) · u4-02 scrub +4 h (amber GREW, sun line swung S→WSW, moon
line un-paled) · u4-03 focus=sun (fill swaps, PER compact) · u4-04 street 500 m (radius clamp
175 m) · u4-05 district 10 km · LEO 1.09 Mm probe: aim group `visible:false` (flagship guard) ·
u4-06 /m 2D map · u4-07 sky-menu DIRECTION row · menu round-trip (off → on+promote, store-
probed) · u4-08 MapWindow twin + tap-promote (focus sun→target). Shots `verify-shots/u4-01..08`.
**UNVERIFIED:** real-device feel (rides T1) · aim overlay under live PLAY advance outside FPV
(MapWindow quiescent between store writes — known, the 20 Hz FPV mirror covers the live case).

## Traps for the record
- **A deadbanded ephemeris anchor must NOT seat the geometry** — the seat tracks the LIVE
  anchor every frame; only the az curves quantize (0.02° ≈ 2 km visible offset off a
  boot-flight capture — browser-caught).
- **`setPointerCapture` throws NotFoundError for a pointer already released** (fast tap /
  synthetic events) — wrap it; the handler's bookkeeping must still run (MapWindow hardened).
- Sector fan + shader now-split: give each wedge its OWN centre-vertex copy (t01 = wedge
  midpoint) — one shared centre vertex smears the split across the whole fan.
- `wrap180` range is **[−180, 180)** (wrap180(180) = −180) — the pre-existing convention.

## Open tails
- U5 next (closest-first progressive loading — UPLIFT_PLAN §2/U5).
- v2 tails (named): skyline `traceStates` dimmed sub-bands in the sectors · GL sector edge
  labels (rise/set az + times) · MapWindow ring split draws a radial seam at the day-boundary
  az (GL skips it — minor inconsistency).
- Taste: fillAlpha 0.12 / rimAlpha 0.5 / lineAlpha 0.85 on glass · compact line length rides
  the holder scale (shorter than emphasized ×1.18 — intended?).

Related: [[project/wip-2026-08-18-u3-2dmap-batch]] · UPLIFT_PLAN §2/U4 + §5 log ·
DECISIONS 2026-08-18f.
