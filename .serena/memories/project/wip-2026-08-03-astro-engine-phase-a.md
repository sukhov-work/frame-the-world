# mem:project/wip-2026-08-03-astro-engine-phase-a — ASTRO ENGINE phase A (SkyTarget seam)

Phase A of `ASTRO_ENGINE_PLAN.md` shipped 2026-08-03. Gates: **vitest 669/669 (+30) · astro check
0/0 · browser state+UI VERIFIED on wix dev** (marker treatments visually UNVERIFIED — see tails).
The 10P comet tracer (2026-08-02) is now ONE instance of a generic "search and track any object in
the sky" engine.

## The seam (what phase B–E build on)
- **`lib/ephemeris/targets.ts`** — `SkyTarget` interface: `id/name/kind/aliases`,
  `stateAt(utcMs) → TargetState {dir(ECEF unit), raDeg/decDeg(J2000), distanceAu|null,
  sunDistanceAu|null, magnitude|null + magnitudeModel("observed"|"jpl"|"engine"|"catalog") +
  magnitudeUncertainty|null, elongationDeg, phaseFraction|null, angularDiamArcsec|null,
  tailDir|null}`, typed `facts` union (planet|comet|dso), optional `apparent{major/minorArcmin,
  paDeg}`, `source` line. Providers:
  - **fixed** `fixedTarget(spec)` — J2000 RA/Dec → EQJ unit vec → `ecefFrameAt` (precession+
    nutation+GAST — the ONE frame conversion). Stars/DSOs. No parallax (distance null).
  - **engine** `planetTarget(id)` — `GeoVector(body,t,true)`+`Illumination` (8 planets + Pluto;
    runtime-probed: Pluto works, Saturn mag includes ring_tilt, NO built-in angular diameter ⇒
    own `PLANETS` radii table; `angularRadiusRad` from bodies.ts).
  - **kepler** `cometTarget(profile)` — wraps `cometStateAt` (already profile-parameterized).
    **10P = `cometTarget(TEMPEL2)`, default target in store/sky — no longer a special case.**
  - `targetAzAlt(target,t,lat,lon,altM)` — shared topocentric face (ECEF-subtract parallax only
    when distanceAu real; fixed targets project the geocentric dir).
- **planner.ts** — internal `scanWindows(from,o,opts,sampler)`; `targetWindows(from,o,target,opts)`
  is the generic face; `cometWindows` = thin wrapper, output test-locked EQUAL. `CometWindow` is
  now an alias of `TargetWindow` (magnitude widened to number|null).
- **`store/sky.ts`** (replaces store/comet.ts) — `{open, visible, highlight, target, setTarget}`.
  Prefs keep the ORIGINAL `cometVisible`/`cometHighlight` key names (rename = drop saved chips).
  DEV seam `window.__skyStore` (replaces `__cometStore`; global.d.ts updated).
- **`scene/skyTarget.ts`** (replaces scene/comet.ts) — same impostor machinery (far×0.5 clamp,
  HORIZON_FADE_GLSL, star-grammar night gate, hairline broken-ring marker), THREE treatments by
  `uMode` uniform: 0 comet (coma+tail verbatim), 1 point (gain = LINEAR mag ramp
  `clamp(1.05−0.07·mag, .12, 1.5)` — overlay grammar, NOT flux), 2 ellipse (REAL major/minor
  arcmin + PA, billboard +Y rolled onto projected celestial north; ring auto-widens
  `max(1.5°, major/2·1.35)` capped by SPAN 3.4°). Ring radius/tick uniforms (per-target), comet
  fractions still glf-baked. Orchestrator: `stepSkyTarget` (was stepComet) — **re-samples
  immediately on target-id change** (else 1 s cadence shows old dir under new treatment).
- **Search**: `lib/sky/searchIndex.ts` (pure; normalize incl. greek→latin + diacritics; tier
  ladder exact 100 / prefix 82 / compact-prefix 78 / token 62 / substring 50 / OSA edit≤2 40−8d;
  + boost·10 fame/brightness) · `lib/sky/catalog.ts` (entries + `targetById` memoized resolver)
  · `lib/sky/messier.ts` (GENERATED — do not hand-edit; re-run the bake). **LAZY BY CONTRACT**:
  catalog+messier only via `await import()` (first SKY interaction); static import from any
  boot module = regression.
- **LocationFinder**: EARTH|SKY segmented toggle (`.lf-mode`, in `.lf-row` — the drag transform
  stays single on `.lf`). SKY: minLen 2, no debounce (local), rows = glyph+name+detail, action =
  track (setTarget+setVisible+setOpen). Credit line swaps to "OpenNGC (CC-BY-SA-4.0) ·
  astronomy-engine · JPL".
- **`panels/TargetPanel.tsx`** (replaces CometPanel; `styles/target-panel.css`, cp-→tp-): generic
  live block + per-kind cards (comet keeps perihelion/closest chips + object card + staleness
  warning via facts.profile; planet blurb/phase/disc″; DSO type/const/extents/names + contested-
  M102 note) + per-model magnitude honesty footnote + NEXT SESSIONS for ANY target.
- **`pages/api/sbdb.ts`** — GET-only relay to ssd-api.jpl.nasa.gov/sbdb.api (JPL sends NO CORS);
  allowlist `sstr`,`full-prec`; 8 s timeout; relays SBDB 200/300(ambiguity list)/404 as payloads.
  First outbound-fetch route in the repo. dev-VERIFIED via curl; Wix-cloud UNVERIFIED.

## Data bake — `scripts/build-messier-catalog.mjs`
OpenNGC NGC.csv + addendum.csv → all 110 Messier → `lib/sky/messier.ts` (24 KB raw). License
CC-BY-SA-4.0: attribution in generated header + panel source + search credit. TRAPS:
- addendum's M102 row has **M column = 101** (NED duplicate cross-ref) — the `M###` Name must win
  or M101 is silently overwritten. M102 ships as type `Dup`; the panel SAYS the id is contested.
- OpenNGC centers the Pleiades on **Alcyone** (0.25° from SIMBAD's centroid) — wide-cluster spot
  checks need 0.5° tolerance, compact objects 0.05°.
- V-Mag falls back to B-Mag; only M102 has neither. M5 constellation prints "Se1" (OpenNGC's
  Serpens Caput code).

## Tests (new: targets.test.ts 12 · searchIndex.test.ts 17)
- Providers cross-checked against astronomy-engine's OWN `Equator`+`Horizon` (independent path)
  at 3 instants, ≤0.05°; fixed provider vs `DefineStar(Body.Star1,…)` (aberration ~20″ inside
  the tolerance). Engine magnitudes locked to runtime-probe fixtures (Venus −4.35 etc.).
- `targetWindows(cometTarget(TEMPEL2)) toEqual cometWindows(...)` — the refactor cannot drift.
- Search grammar locked: m31 / M 31 / messier 31 / ngc224 / andromeda / andromedia / saturm /
  jupitre / 10p / orion nebula / crab / pleiades; `m1` exact beats the m1x prefix family;
  every catalog id resolves to a working target (dir unit-norm at a probe instant).

## VERIFY TRAPS (cost ~40 min — carry these)
- **A hidden Playwright window fully SUSPENDS rAF** (zero frames — stronger than the documented
  "throttles" trap). `document.hidden` stays true even after `page.bringToFront()` AND CDP
  `Browser.setWindowBounds`/`Page.setWebLifecycleState`. Every `__globe.bodies()` read then shows
  the BOOT ephemeris sample ⇒ "the orchestrator ignores the store" is a FALSE LEAD (I built a
  whole stale-`?t=`-dual-module theory: StylizedTiles served `?t=…`, panels unstamped — plausible,
  WRONG). Fix: `context.addInitScript` shim rerouting rAF→setTimeout(16) when hidden + reload.
  Then Chrome's intensive throttling clamps hidden-tab timers to ~1/min after ~5 min ⇒ long scene
  sequences need a VISIBLE window; state asserts still work with 3–4 s waits early on.
- React-controlled inputs need the native-setter + `dispatchEvent(new Event('input',{bubbles}))`
  dance; welcome-screen buttons never pass Playwright's "stable" gate (continuous animation) —
  click via `element.click()` in evaluate.
- Two `wix dev` trees were running (owner's); kill attempt DENIED — do not touch the owner's dev
  processes; verify through the graph you're given.

## Owner test verdict (2026-08-03, same day): "generally works but" — 5 items = the next batch
(the visual-pass tail is RESOLVED by the owner's own test; full list also in
NEXT_SESSION_PROMPT.md + ASTRO_ENGINE_PLAN.md phase C):
1. **Trajectory missing** (the carried gap) — build `scene/skyTrail.ts`, ON by default, toggle
   beside the panel toggles, and **rename the `SKY` toggle to `SHOW`** (SHOW · MARK · TRAIL).
2. **Marker click** → centre target in view (FPV) + open panel if closed (mesh has
   `raycast=()=>{}`; aim idiom = FpvHud.bringIntoView: FPV requestSkyLook / orbit
   setTargetHeading+tilt).
3. **Post-search auto-aim** when reasonable (above horizon etc.) from LocationFinder.track().
4. **Sun/moon-style EDGE CHIP for the tracked target** (owner screenshot = moon pill + arrow):
   widen camera.ts `skyMarkers` + stepFpvHudAndSkyMarkers + FpvHud from hard {sun,moon} to N.
5. **Cleanup comet-era hardcode** (sweep done): split `SKY_TARGET` tuning group out of `COMET`
   (generic marker/night-gate/impostor — 20 refs in scene/skyTarget.ts; COMET keeps coma/tail
   only) · rename prefs `cometVisible`/`cometHighlight` WITH a read-old-keys migration in
   loadViewPrefs (never drop saved chips) · catalog 10P entry + TargetPanel comet card are
   legitimately comet-specific, keep.

## Tails / next (phase B–E in ASTRO_ENGINE_PLAN.md)
- Phase B: full OpenNGC + IAU star names (IAU-CSN.txt cross-links BSC5 via HR) + MPC comets +
  bright asteroids; SIMBAD TAP fallback (CORS `*` verified) + localStorage cache; kepler provider
  needs an H/G asteroid magnitude law (comet M1/k1 ≠ asteroid H/G).
- Phase C: `scene/skyTrail.ts` (projected trajectory — dayArcs generalisation) + FpvHud N-target
  chips (camera.ts `skyMarkers` is a hard {sun,moon} record — 4-file typed change).
- Phase D: planet phase discs/rings/star colour. Phase E: PLAN-panel skyline verdict for target.
- `/api/sbdb` on Wix cloud UNVERIFIED (first egress route — adapter behaviour unknown).

Related: [[project/wip-2026-08-02-comet-10p-tracer]] [[bugs/comet-magnitude-model]]
[[patterns/sky-bodies-terrain]] [[patterns/globe-rendering]] [[decisions/adr-000-locked-stack]]
