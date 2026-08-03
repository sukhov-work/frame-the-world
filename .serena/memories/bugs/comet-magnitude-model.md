# mem:bugs/comet-magnitude-model — JPL M1/k1 is ~4 mag too faint for a big coma (FIXED 2026-08-03)

**Owner caught it:** the panel said 10P/Tempel 2 was mag **12.8 / "TELESCOPIC ≈150 mm"**. He said it
should be ~8 and binocular-visible. He was right. The position math was never wrong (≤3″ vs
Horizons); the BRIGHTNESS MODEL was.

## Root cause
JPL SBDB/Horizons `M1`/`k1` come from an automated fit ("autocmod 3.0g", 2-parameter, 3377 obs) to
the magnitudes attached to **ASTROMETRIC submissions** — overwhelmingly CCD frames measured through
a TIGHT photometric aperture. That aperture misses most of an extended coma. It is a fine model
while the coma is small and a systematically FAINT one once the comet is active.

## Ground truth (COBS, cobs.si — real observer reports, ICQ format)
Same nights, late July 2026: **8.2 / 8.6 / 8.9 / 9.0** from 5–11 cm wide-field instruments vs
**10.3 / 10.9 / 11.3 / 11.5** from 28–50 cm with tight apertures. Median of the last 14 d = **8.4**.
The aperture effect IS the story — it is not observer error.

## The fix (`lib/ephemeris/comet.ts`)
Two labelled models + a validity window, never one silent number:
- `CometLightCurve {h, n, rmsMag, nObs, fromIso, toIso, source}` — `m = h + 5·log10Δ + 2.5·n·log10 r`
  fitted to the COBS **wide-field/visual subset** (aperture ≤15 cm OR ICQ method `T`).
  10P 2026: **h −0.76 · n 29.3 · rms 0.80 · N 215 · 2026-05-01…2026-10-31**.
  Monthly residuals vs observed medians: May −0.1 · Jun +0.2 · Jul +0.0 · Aug −0.6.
- `jplMagnitude()` = the SBDB law, kept and labelled, used OUTSIDE the window with a ±2 band.
- `cometBrightness(utcMs, Δ, r)` → `{magnitude, model:"observed"|"jpl", uncertaintyMag}`;
  `CometState` carries `magnitudeModel` + `magnitudeUncertainty`; `visibilityClass(mag)` turns the
  number into the thing a planner wants ("BINOCULARS (10×50)").
- Panel: `MAG 8.4 ±0.8` + the visibility line + a note naming the model in force.
- `scripts/fit-comet-lightcurve.mjs` re-bakes from COBS and prints monthly residuals; **it fails
  loud (>1.5 mag) rather than shipping a bad fit** — that guard is what caught the next item.

## WHERE THE WINDOW STARTS IS PHYSICS, NOT FIT-SHOPPING
A single power law over the FULL approach missed March by 2.4 mag (the guard fired). Fitting only
from April still missed April by 1.8. Reason: **the two models swap places as the coma inflates.**
April 2026 — COBS median 16.0, **JPL 15.9 (good)**, observed-curve 17.0 (bad). June onward — COBS
10.8, JPL 13.8 (3 mag faint), observed-curve 11.0 (good). So the window starts **2026-05-01** and
everything earlier deliberately falls through to JPL, where JPL is the ACCURATE model. Both
behaviours are locked by tests.

## Generalisation for the astro engine (`ASTRO_ENGINE_PLAN.md`)
**Every brightness is a MODEL, not a fact.** Carry `{value, model, uncertainty}` on `SkyTarget`
from day one. n = 29 is not a law of nature — it is this apparition's activity ramp; any fitted
curve needs a validity window and a labelled fallback outside it.

Tests: `test/lib/ephemeris/comet.test.ts` — Horizons rows now assert `jplMagnitude` (the physics
check is unchanged), plus a `cometBrightness` suite anchored on COBS monthly medians, the
model-swap at the window edges, and a guard that JPL−observed > 3 mag at closest approach (the
regression this exists to prevent).

Related: [[project/wip-2026-08-02-comet-10p-tracer]] [[patterns/sky-bodies-terrain]]
