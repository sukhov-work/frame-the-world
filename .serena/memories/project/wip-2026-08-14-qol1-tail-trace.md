# WIP 2026-08-14 late — QoL-1 tail: §3.1.D tracked-target trace + playhead cursor SHIPPED

Session: NEXT_SESSION item 1 + owner ask (replace the scrubber's circle knob with a vertical
bar+handle, screenshot-ruled). Twin: DECISIONS 2026-08-14 late line.
Gates: vitest 763/763 (+11) · astro 0/0/5 hints · desktop browser-VERIFIED (qol1t-01..03).

## Design deviation (recorded)
PLANNING_QOL_PLAN §3.1.D says "planFeed computes+mirrors the trace polyline". SHIPPED instead:
- **planFeed mirrors the skyline BINS** (`store/plan.profileBins`, 120 per-azimuth elevations,
  copied ONCE per completed build; `binsMirror` cache nulled in startBuild + focus-fallback
  branch + dispose — the focus-branch null was a caught in-session leak).
- **The RAIL computes the trace** with its existing span-memo idiom (scene-HOUR span anchor +
  0.05° eye + target id) — one idiom for sun/moon/target curves; planFeed stays lean; the bins
  mirror IS the QoL-2 frameFinder profileFn seam (and T8's rail-context half).

## New pure faces
- `dayArc.ts`: `targetElevationSeries(target, startMs, endMs, lat, lon, stepMin)` →
  `{utcMs, azDeg, altDeg}[]` (sea-level observer — jumpEvent granularity discipline) ·
  `traceStates(samples, skylineFn|null)` → `down|blocked|clear` (null fn → horizon-only clear).
- `horizonProfile.ts`: `sampleBins(altDeg[], azDeg)` — interpolation core of `sampleProfile`
  (which now delegates); works on the mirrored plain array.
- `offscreen.ts`: `azAltFrameMarker(azDeg, altDeg, {headingDeg,pitchDeg,fovDeg,aspect})` —
  roll-free ENU camera basis → `frameMarker`. QoL-2 frameFinder seed.
- `store/camera.FpvHud.aspect` NEW (orchestrator writes `camera.aspect`; single producer).
- `SCRUB.traceStepMin 8` (~90 samples/12 h — Kepler-grade target sampler gets its own knob).

## Rail render (TimeScrubber.tsx)
- `tracePaths(samples, states, windowStartMs, frameTest)` → per-class SVG paths; below-horizon
  = pen up; class transitions bridge FROM the previous point (no gaps); classes: blocked (dim
  dashed) / clear (accent 1.3px) / **frame (FPV-only, 2.4px + glow)** = clear ∧
  `azAltFrameMarker(...).inFrame`.
- FPV pose subscription = **QUANTIZED key selector** (`Math.round(h)|p|fov*2|aspect.toFixed(2)`)
  → re-render only on ~1° moves, then `getState().fpvHud` for the actual pose. Idiom worth
  reusing for any rail/HUD coupling.
- Trace rides the TARGET panel SHOW gate (`useSkyStore.visible`) like marker/trail.
- Playhead: `.ts-knob` (12px circle) → `.ts-cursor` (2px bar top −4px..bottom 11px, pennant
  handle via clip-path `polygon(0 0,100% 0,100% 55%,50% 100%,0 55%)`, `background: inherit`
  on ::before; accent=LIVE / warn=pinned unchanged).

## Verified (browser, headed Chrome CDP :9222 + wix dev)
- Orbit no-anchor: clear-only trace, `profileBins` null (honest fallback) — qol1t-01.
- FPV `#f=48.4647,35.0462,1.7,180,10,60`: bins 120, coverage 1.00, blocked+clear both render;
  `requestSkyLook` at Perseus (az 61.4/alt 37.5) → ONE contiguous emphasized segment — qol1t-02;
  +3 h pin → amber playhead, emphasis stays at its clock window (doesn't follow cursor) — qol1t-03.
- Console errors = standing dev noise only (members/my 403 anon + frog.wix.com refused).

## Traps touched
- Stale `binsMirror` on FPV-exit-to-focus with PLAN panel open (fixed in-session). The
  frozen-mirror-while-panel-CLOSED behaviour is pre-existing and internally consistent
  (frozen eye + frozen skyline) — rail sun/moon curves behave the same; do not "fix" one-sided.
- fixedTarget test specs: `facts.dsoType` is non-nullable — use "**" for star-ish test targets.

## Next (unchanged ladder)
1. Mobile dock v2 (M3a twin — MobileTimeDock still on the old clamped model).
2. QoL-2 (frameFinder + THIS FRAME card + TODAY daily surface + ICS) — `profileBins` +
   `azAltFrameMarker` + `FpvHud.aspect` are its ready seams.
3. Owner taste-pass knobs now also: trace strokes (`.ts-curves__trace-*`), playhead size/hues,
   `SCRUB.traceStepMin`.

## Ship-pipeline unblock (new autoship trap)
PRs #35/#36 sat OPEN-CONFLICTING: squash-merge divergence (#34 squashed to `47f081e`; session
branches kept the pre-squash `692a5ab` in history → every subsequent ship PR conflicted, the
queued automerge never fired, TWO sessions of work stuck). Fix: prove twin trees identical
(`git diff 692a5ab 47f081e` = empty) → `git rebase --onto origin/master 692a5ab` (conflict-free
by construction) → force-push → #36 automerged instantly (master `4447ea2` = M1+M2+QoL-1);
#35 closed superseded; local re-seated on master (session work stash-carried, stale ship
branches deleted). **RULE: on session boot, if the previous ship PR hasn't landed — re-seat
onto origin/master FIRST (tree-identity check → rebase --onto); never build on a pre-squash
ship branch.**

FOLLOW-UP same session (owner order): FULL AUDIT — all 35 branches tree-verified contained in
master (M1/M2 "missing commits" proven via the replay chain; two script artifacts resolved:
rev/path collision on `codeowners`, title-prefix false match on `refactoring-2`); TRUE root
cause = hook v1's SHA-ancestor automerge-wait (never true under SQUASH merges → always timed
out → checkout left on ship branch → divergence cascade); **hook v2 shipped** (squash-aware
landing, divergence-preflight self-heal, refs/backups snapshots, tree-proof-gated branch
deletion, superseded-PR auto-close, mirror sync on every path, SHIP_ATTENTION.md anomaly
handoff + SessionStart boot duty). private/master fast-forwarded ≡ origin/master. Full detail:
`mem:decisions/session-end-autoship` + DECISIONS 2026-08-14 late-2.

Related: [[project/wip-2026-08-14-qol-batch]] [[project/owner-orders-2026-08-14-qol-batch]]
