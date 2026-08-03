# mem:project/wip-2026-08-02-comet-10p-tracer — comet 10P/Tempel 2 in the sky (temporal, local)

Owner ask: "enable 10P/Tempel comet visibility in the sky, add its main info, highlight it and render
it with the same mechanisms as sun/moon, so I can trace it and predict the next astro-gazing session.
Keep changes local." Shipped 2026-08-02, browser-VERIFIED (headless Chrome CDP + Playwright MCP on
`wix dev`). 630 vitest (was 609) · `astro check` 0 errors. NO Wix/backend surface touched.

## Why this date matters (the reason the ask exists)
10P/Tempel 2 hit **perihelion 2026-08-02 02:44:45 UTC** (today) and passes **closest to Earth
2026-08-03 ≈21:00 UTC at 0.4145 au = 62.0 M km** — near opposition (elongation 164°), its best
apparition until the 2030s. Peak brightness ≈ **mag 8.4 = BINOCULARS (10×50)** — this line first
said "12.8 / telescopic" and that was WRONG (JPL's CCD-aperture fit); corrected 2026-08-03, see
`mem:bugs/comet-magnitude-model`. From Dnipro
(dec ≈ −25°) it culminates only ~16.6° up, due south, ≈22:40 UTC (01:40 local). Next perihelion
2031-12-14.

## Ephemeris — `src/lib/ephemeris/comet.ts` (pure, three-free)
astronomy-engine has NO small-body support ⇒ own **two-body propagator over JPL-baked osculating
elements**, but NOT a second ephemeris: Earth's heliocentric position comes from
`HelioVector(Body.Earth)` and the EQJ→ECEF landing reuses `bodies.ts`.
- **`bodies.ts` refactor**: the EQJ→EQD→(−GAST)→ECEF recipe extracted to `export function
  ecefFrameAt(time): EcefFrame` — `bodyStatesAt` and the comet now share ONE frame conversion.
- Elements baked from Horizons `DES=10P; CAP`, ecliptic/equinox J2000, **epoch 2461253.5 =
  2026-08-01.0 TDB**, solution JPL#K265/43 (2026-07-28, 6347 obs, arc 2003–2026).
- Pipeline: `M = n·(jd − Tp)` → Newton Kepler → perifocal → ecliptic J2000 (Rz(−Ω)Rx(−i)Rz(−ω)) →
  equatorial J2000 (rotate +X by ε 23.4392911°) → minus Earth → **3 light-time iterations**
  (c = 173.1446 au/d) ⇒ ASTROMETRIC RA/Dec, directly comparable to Horizons quantity 1.
- `cometAzAlt()` = topocentric (subtract observer ECEF, ENU projection). Parallax is only ~21″ at
  Δ 0.41 au but it is free, and it makes the numbers match Horizons to 3 decimals.
- Magnitude law is **`m = M1 + 5·log10(Δ) + k1·log10(r)`** (M1 13.7, k1 6.5) — NOT `2.5·k1`; the
  2.5 form was 1.5 mag off. Matches Horizons T-mag to 0.001. **BUT reproducing Horizons exactly is
  NOT the same as being right for an observer** — that model runs ~4 mag faint for an extended
  coma and was replaced as the displayed number on 2026-08-03: `mem:bugs/comet-magnitude-model`.
- **TDB−UTC = 69.184 s** constant (32.184 + TAI−UTC 37) — negligible but kept honest.

### Measured accuracy vs JPL Horizons (this is the evidence, re-checkable by the script)
| check | result |
|---|---|
| geocentric astrometric RA/Dec, 2026-06 → 2026-11 | **≤ 3.0″** (worst 3.04″) |
| topocentric az/alt @ Dnipro 2026-08-02 00:00Z | az 196.490 vs 196.486 · alt 15.389 vs 15.392 |
| T-mag across the apparition | **0.000 mag** |
| two-body drift from epoch | 0.35′ @ ±1.5 yr · 0.73′ @ +2 yr · 2.12′ @ +3 yr |
`ELEMENTS_TRUST_DAYS = 550`; past that the panel prints an "ORBIT EXTRAPOLATED (arcminute class)" line.

## Re-bake script — `scripts/build-comet-elements.mjs`
`node scripts/build-comet-elements.mjs [designation] [epochISO]` → prints the `elements: {…}` literal
AND re-runs the Horizons residual check (fails loud >1′). **Horizons API traps** (each cost a round
trip): every value must be QUOTED (`QUANTITIES='1,9,20,23'`, `START_TIME='2026-08-01'`,
`SITE_COORD='35.05,48.46,0.1'`, `COMMAND='DES=10P; CAP'`) or it errors "Too many constants"; row
stamps are `2026-Aug-02 00:00` — parse with `Date.parse(when + " UTC")`, ISO-ifying gives NaN.

## Planner — `cometWindows()` in `lib/ephemeris/planner.ts`
Forward scan (no root-finder: the comet isn't an astronomy-engine body and 10-min granularity beats
any real observing plan): sun below `darkSunDeg` (−15) AND comet above `minAltDeg` (5) ⇒ window with
start/end/peak/az/mag + moon alt & illum at the peak. `score = altScore(peak/30°) × moonFactor ×
(0.5 + 0.5·durationScore)`; moonFactor = 1 below the horizon else `1 − 0.8·illum·√sin(alt)`.
Sun evaluated every step, comet only while dark ⇒ an 8-day/15-min scan is ~10–20 ms (panel memoizes
on open + hour + anchor rounded to 0.05°).

## Render — `src/components/globe/scene/comet.ts` (+ `COMET` tuning group)
ONE additive billboard = coma + tail + reticle, camera-anchored at `camera.far × 0.5` clamped into
`[near·1.2, far·0.95]` (the load-bearing sun/moon lesson), rolled in-plane so **local +X = the
anti-sunward direction projected on the view plane** (a real comet's tail always points away from
the sun ⇒ the orientation is真 even though the length is stylized). Rides the shared
`HORIZON_FADE_GLSL` (now exported from `scene/sky.ts`) + `horizonTerms`/`horizonBandSin`.
Night gate = the star-field grammar over sin(sun elev) at the camera; the reticle alone keeps a
`highlightDayFloor`. New tokens `cometComa #9FF3C8` (C2/CN green) + `cometTail #8FD8FF` (ion blue)
in tokens.css AND the tokens.ts bridge; the reticle uses `accent` (marker = signal).
**Honesty contract, stated in code**: mag 12.8 would be sub-pixel and invisible — the marker is an
INSTRUMENT OVERLAY at stylized size; direction, horizon slice and every number are the real ephemeris.

### Look retune (browser)
comaAngRadDeg 0.32→**0.16**, comaIntensity 1.5→**0.85**, comaGlowExtent 5→4, tailIntensity 0.5→**0.75**.
1.5 gain sat over `BLOOM.threshold` 0.9 and UnrealBloom smeared it into a ~2° green ball that ate the
tail — a fake "great comet" for a mag-12.8 object.

### TRAP (cost 4 shots + a red-shader probe) — "the tracer won't render" at street level
At 3.8° elevation from a 2 m eye the quad was invisible even with both fades FORCED to 1. It was
**occluded by the real skyline** (buildings + trees write depth in the opaque pass; the impostor is
depth-tested against them) — i.e. the honest planner behaviour, not a bug. Diagnosed by swapping the
fragment shader for solid red at runtime: the quad was there, sliced by a rooftop.
A wrong hypothesis was tried and REVERTED first: "the camera-anchored sky dome overpaints it" — the
dome is **AdditiveBlending, depthWrite:false**, so it can never paint over anything. Do NOT reach for
`renderOrder`; raise the eye or wait for the comet to climb. (Note left in the `impostorFarFrac` doc.)

## UI — `panels/CometPanel.tsx` + `styles/comet-panel.css` + `store/comet.ts`
Top-RIGHT pill `☄ 10P` under the nav (the free corner) unfolding down; draggable; hidden on the
welcome landing. Observer = `plan.anchor` (photo/FPV eye) else the live camera focus.
Shows: PERIHELION TODAY / T±N d + ABOVE|BELOW HORIZON badges · ALT/AZ · MAG · ELONG · **RA/Dec J2000
(push-to coordinates)** · Δ in au + M km · r · PERIHELION and CLOSEST chips (pin scene time) ·
**NEXT SESSIONS** (up to 5 windows, each button pins scene time to the window's peak → the whole
scene relights at that instant) · the object card (family, period, q/Q/i, nucleus 10.6 km, rotation
8.93 h, discovery 1873-07-03 Wilhelm Tempel Milan, next perihelion) · SKY/MARK toggles (persisted
via `lib/prefs` `cometVisible`/`cometHighlight`, default ON) · the magnitude honesty note + source line.
- **Dense glass** `rgba(11,15,20,0.9)` + `backdrop-filter: blur(8px)` on the CARD (never the root —
  backdrop-filter makes a containing block and the root carries the drag transform): an open card
  overlaps the camera deck's column and a 72% wash interleaved the two panels' text into mush.
- Store read per frame in the orchestrator's `stepComet()` (getState() is a reference read); comet
  state sampled inside `sampleEphemeris` on the SAME 1 s cadence (the comet drifts 0.3°/day).

## Verification (verify-shots/comet-01…12)
FPV standing in Dnipro, scene time pinned to the window peak 2026-08-02 22:50Z, aimed az 180.6 /
+16.4: the tracer sits dead-centre (0.73° off the camera forward) with coma + anti-sunward tail +
reticle · panel numbers match Horizons · 12:00Z day + below horizon = gone · SKY toggle off →
`mesh.visible false` → on → restored · alt tracks the ephemeris across 22Z→04Z (16.1 → −11.1).
UNVERIFIED: orbit/LEO-altitude framing not isolated in a shot; the daylight reticle floor (0.35)
is unverifiable at this site — near opposition, 10P is never both above the skyline and in a lit sky.

## Follow-ups from the 2026-08-03 owner review
- **Magnitude corrected** (12.8 → 8.4 ±0.8, "BINOCULARS 10×50"): `mem:bugs/comet-magnitude-model`.
- **Reticle retuned to a hairline broken ring** (owner: "crude, obscures the view") — stroke 0.012
  of radius, radius 1.5°, gain 0.45, gaps on the axes. TRAP: tick masks must use PERPENDICULAR
  distance to the nearest axis; an angular wedge is constant-arc and drew blobs at that radius.
  This is now the house marker style for every body type.
- **Still missing: the projected sky trajectory** for the comet (`scene/dayArcs.ts` is the renderer
  to generalise) — carried into `ASTRO_ENGINE_PLAN.md` phase C.

Related: [[bugs/comet-magnitude-model]] [[patterns/sky-bodies-terrain]] [[patterns/globe-rendering]]
[[decisions/adr-000-locked-stack]]
