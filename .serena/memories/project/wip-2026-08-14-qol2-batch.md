# WIP 2026-08-14 evening — QoL-2 SHIPPED + owner 7-ask batch (ghosts · sun/moon targets · sky menu · WASD/⇧␣ · moon fix · widths · compact deck)

Twin: DECISIONS 2026-08-14 evening line. Gates: **vitest 784/784 (+21) · astro 0 err/5 hints**;
desktop browser-VERIFIED (headed Chrome CDP :9222 + wix dev; shots `verify-shots/qol2-01..08`).
Owner-device taste tier OPEN. Working tree UNCOMMITTED (session-end auto-ship; `.ship-title` set).

## New seams (QoL-3 / M3b will lean on these)
- `lib/ephemeris/frameFinder.ts` — `frameCrossings(sampler, pose{lat,lon,heading,pitch,vFov,aspect},
  fromMs, days, {profileFn, stepMin=5, maxWindows})` → windows {startMs,endMs,peakMs,peakSepDeg,
  skyline clear|blocked|mixed|unknown, light, moonUp/moonIllum/moonGlare}; `nearestFrameCentre`
  (P4 seed — global sep minimum, requireUp opt); `angularSepDeg`. Sampler INJECTED
  (`(utcMs)→AzAlt` — wrap `horizontal(body,…)` / `targetAzAlt(target,…)`); skyline via
  `(az)=>sampleBins(plan.profileBins, az)`. Bisection: 22-iter/1 s (planner.bisectCrossing form).
- `lib/export/ics.ts` — pure `buildIcs(events, nowMs)` (RFC 5545: CRLF, 74-char folding, escaping,
  deterministic djb2 UIDs → re-download updates not duplicates) + `downloadIcs` (client Blob).
- `twilight.ts lightPhaseAt(utcMs, lat, lon)` — point query twin of lightSegments.
- `targets.ts bodyTarget("sun"|"moon")` (`body:*` ids; TargetKind += "sun"; facts reuse the
  planet arm; sun mag −26.74 "catalog"/elong 0/phase null — Illumination() undefined for Sun).
  Search rows boost 2 in catalog.skyIndex; `targetById` branch; kindGlyph ☀.
- `store/sky`: `ghosts/ghostCount/ghostStepMin` (+setters, prefs-persisted skyGhost*).
- `store/camera`: `skyMenu: SkyMenuInfo|null` + `setSkyMenu` (right-click mirror).
- `globe/scene/skyGhosts.ts` — InstancedMesh ghost chain (see below). Tunables `GHOSTS` group.
- `ORCH.skyMenuMinHitDeg 1.2 / skyMenuMinAltDeg −0.5`; `SKY.moonDayAlphaGain 1.35 /
  moonAlphaDiscard 0.03`.

## UI surfaces
- **FrameCard** (PlanPanel section, FPV-only via quantized-pose-key sub; memo on poseKey +
  5-min time quantum + bins identity + target): ☀/☾/target next-crossing rows + NOW→ state +
  jump chips + per-row ⤓ .ics + ◎ CENTRE chip. Tracked body:sun/moon dedupes the target row.
- **TodayCard** REPLACED PlanPanel's flat `.pp-chips` (CHIP_LABEL moved in): midnight→midnight
  chronology, light dots (`.pp-day__dot--{phase}` = scrubber band colours), ☀-el-at-moonrise
  tag, dated phase chips, ⤓ .ics per row. BOTH cards self-compute (MwCard precedent) — immune
  to the planFeed panel-open mirror trap.
- **SkyContextMenu** island (index.astro; `.skymenu`, sky-menu.css, .ct-pinpop discipline):
  TRACK/TARGET PANEL · AIM · GHOSTS (auto-tracks) · RISE/SET chips (dayEvents today+tomorrow).
  Orchestrator `contextmenu` angular hit test (trySkyMarkerClick idiom over sun/moon/target).
- TargetPanel: GHOSTS toggle + `± N EVERY ⟨min⟩` row (`.tp-ghostrow`).

## Ghost chain (owner ask 1 — the seeing feature)
skyGhosts.ts: 2×count instances (max 8/side), soft discs (glf-baked edge), alpha ramp
alphaNear .5 → alphaFar .14, past ×0.6, per-ghost horizon melt (−1.5..+0.5°), true angular
size for sun/moon else 0.4° floor, colour by kind (sunGlow/moonlight/accent), camera-anchored
at SKY_TARGET.impostorFarFrac (sits ON the trail), resample on 1-s scene-time quantum —
scrubbing slides the chain. Gate: SHOW && GHOSTS + anchor (plan anchor else focus).

## Moon dark-disc fix (ask 4) — the mechanism, for posterity
Moon shader was day-blind (opaque disc, NormalBlending, depthWrite) — daytime pale look owed
ENTIRELY to the additive atmosphere dome drawing after it (dome 0.45·far vs moon 0.5·far,
transparents sorted by distance). Camera motion broke the race (stale dome depth-rejected on
the moon's written depth → black disc), + double tone-mapping crushed earthshine to (7,6,2).
Fix: per-fragment day-sky alpha (`vis = mix(1, clamp(lit·gain), uDaySky)`; uDaySky = atmosphere
dawn ramp (ATMOSPHERE.skyDawnLo/Hi) × sky-altitude fade (skyFullAlt/GoneAlt), CPU per frame),
discard alpha<0.03 (no depth from invisible fragments — dome can never lose), removed
tonemapping_fragment (OutputPass tone-maps once). Night keeps opaque star-occluding disc.
DO NOT re-add tonemapping_fragment or alpha=1 day rendering.

## Input (ask 2)
WASD = arrow aliases via e.code (layout-independent); typing-surface guard for letters; arrows
now ALSO yield to explicit-tabindex owners (`hasAttribute("tabindex")` — the rail owns ◀▶;
buttons keep walking). SHIFT+SPACE descends: sign on the live shift mirror inside the space
integrator (mid-hold reverse keeps the ramp). Escape order: skyMenu consume BEFORE the FPV
unwind stack (caught live: menu-close was exiting FPV).

## Traps touched / env
- Vite dep cache 504-wedged mid-session ("Outdated Optimize Dep", survives cache-disabled
  reloads) — **`touch astro.config.mjs` makes astro/Vite self-restart** (server rebound
  4322→4321). kill of the dev server was permission-denied in this harness.
- Playwright over CDP-attached Chrome does NOT surface download events — verify .ics via a
  `URL.createObjectURL` monkeypatch probe (blob type/size/content).
- `.pp` card scroll fold hides new sections — probe DOM, don't trust the viewport shot.
- Source edits full-reload the page → store state (plan.open etc.) resets; re-open panels.

## Verified (browser)
qol2-01 new-moon noon sky (no dark disc; uDaySky 1.000) · qol2-02 Aug-18 35% crescent pale on
blue · qol2-03/04 ghost chain 4×10 min → 6×30 min live · qol2-05 moon menu (tracked labels,
rise/set chips) · qol2-06 sun menu (⌖ TRACK/✧ GHOSTS) + Escape keeps FPV · qol2-07/08 PLAN
panel FrameCard+Today rows + bins 120 · widths .mm/.fh both 210 px · W/␣/⇧␣ walk-rise-sink
numbers · SKY search "moon" top row → tracked body:moon, prefs-restore works.

## Next
1. Mobile dock v2 (M3a) — unchanged, still first in the plan ladder (deferred behind this
   owner batch). Then M3b (mobile twins of QoL-2 surfaces).
2. QoL-3 (P4 Find full + P6 moon calendar + P5 NPF + size→distance).
3. Owner taste knobs now also: GHOSTS.* (alphas/pastDim/minDiscDeg) · SKY.moonDayAlphaGain ·
   `.skymenu` cut · FrameCard SCAN_DAYS/step · TodayCard density.

Related: [[project/wip-2026-08-14-qol1-tail-trace]] [[project/owner-orders-2026-08-14-qol-batch]]
