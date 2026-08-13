# WIP 2026-08-14 — PhotoPills deep review → QoL re-ruling → QoL-1 SHIPPED

Session per `mem:project/owner-orders-2026-08-14-qol-batch`, run through investigate-design-v3
(research → design → implement, Deep). DECISIONS 2026-08-14 night line = twin.
Gates: vitest 752/752 (+14) · astro 0/0/5 hints · desktop browser-VERIFIED (qol1-01..08).

## Research (Phase 1)
- photopills.com = Cloudflare-403 to WebFetch/curl; **Wayback 2026-07-07 snapshots** of
  user-guide (Part I) + user-guide-2 (Part II) → /tmp text extracts → 2 parallel deep-read
  agents (100% coverage) + 1 FTW current-system mapper. Adoption record: **PLANNING_QOL_PLAN §1
  (R1–R20)**; beats list §1.2 (their AR-calibration/horizon-pin/altitude-offset/real-azimuth
  apparatus = flat-map workarounds our 3D engine deletes).
- Craft constants adopted: Find az+el ONLY (their az-only modes = dead weight), tol 3°/0.5°,
  ranges 1y sun/2y+ moon; NPF primary + 500 ghost; light partition day>+6/golden −4..+6/blue
  −6..−4/nautical/astro/night.

## Design fold (Phase 2)
- IMPLEMENTATION_PLAN §Phase 8 REWRITTEN: **8-QoL-1** (scrubber v2 + my-location FPV + Space) ·
  **8-QoL-2** (frameFinder shoot-this-frame + TODAY daily surface + ICS) · **8-QoL-3** (P4 Find
  skyline-filtered + P6 moon calendar/distances + P5 NPF + size→distance) · 8-events ·
  8-tools/ambience (DSO slid behind). Spec source: `PLANNING_QOL_PLAN.md` §2/§3.

## Shipped (QoL-1, desktop)
- **TimeScrubber v2** (`panels/TimeScrubber.tsx` full rework): infinite CONVEYOR (scene time =
  fixed centre cursor; drag left = future; verified +25.2 h/−42 h exact) · bands via NEW
  `lightSegments` (`lib/ephemeris/twilight.ts`, LIGHT_DEG +6/−4/−6/−12/−18, multi-boundary
  refinement so the 2° blue sliver never skips) · sun/moon curves via NEW `elevationSeries`
  (`lib/ephemeris/dayArc.ts`) as SVG · REAL hour labels via NEW `hourTicksBetween`
  (`store/time.ts`, browser-local, DST-guarded) · event-step tap zones (outer 12%; planFeed
  mirror else pure dayEvents AT TAP) · perf: span=2×window memo keyed on scene HOUR + 0.05° eye.
  Tokens: `--color-blue-hour` `--color-night-band`. SCRUB.windowHours 24→12 (dock inherits).
- **Space=FPV ascend** (`StylizedTiles.ts` + `FPV.spaceRampS 2.5 / spaceLiftRatePerS 1.1`):
  Space in fpvKeysDown (clearAllTargets-IMMUNE), gain=min(1,held/ramp)² × vertical-encoder step,
  same clamps; guards: interactive/tabIndex≥0 focus skip, preventDefault, keyup + window-blur
  release. Measured 1.71→16.70 m/3 s hold; 150 ms tap = 1 cm; zero drift on release.
- **My-location→FPV both shells**: NEW `panels/MyLocation.tsx` ("My spot" nav island) + mobile
  `SceneActions` 🧭 upgraded pin+fly → `requestFpvJump(lat,lon,1.7,0,0,FPV.tempFovDeg)`. C6
  client-side-only. Verified both shells with stubbed fix → standing FPV at coordinates.
- DEV seams: store/time + store/camera now publish `window.__timeStore`/`__cameraStore`.

## KEPT BACK (next session)
1. **§3.1.D tracked-target visibility trace on the rail** (planFeed mirror extension + FPV
   in-frame emphasis via offscreen.ts frameMarker math) — partially lands T8.
2. Mobile dock v2 (M3a twin — dock currently runs the old clamped model on the 12 h window).
3. QoL-2 (frameFinder + daily surface + ICS).

## Traps (new, also in DECISIONS)
- Page-context `await import("/src/store/X.ts")` can resolve a SECOND zustand instance in dev —
  probe `window.__*` ONLY.
- planFeed chips are PLAN-panel-open-gated (planFeed.ts:358–363) — outside consumers compute
  their own dayEvents fallback.
- `goldenElevationsDeg(GOLDEN)` = −6.5°..+15.4° (widened render bell) — never a photographic band.
- Hash-only #f= navigation doesn't reboot the app — go through about:blank. Welcome: dismiss via
  `.wl-btn--ghost` (the primary opens UploadFlow → file-chooser modal hell in Playwright).

Related: [[project/owner-orders-2026-08-14-qol-batch]] [[project/wip-2026-08-13-m2-fpv-touch]]
[[project/wip-2026-08-13-slice7-phase8a]]
