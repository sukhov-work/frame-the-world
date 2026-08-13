# wip 2026-08-13 (session 2) — audit slice 7 + owner rulings + PHASE 8a SHIPPED (desktop)

Mode: implement (investigate-design-v3, Standard tier). Gates at exit: **vitest 733/733 (+23)**
· astro check **0/0/6 hints (= baseline)** · wix build **Complete 26 routes** · dist **32.2 MB**
(was 33). Desktop surfaces **browser-VERIFIED** (headed Chrome CDP :9222 + wix dev;
shots `verify-shots/phase8a-01..15`). DECISIONS 2026-08-13 Phase-8a line = twin.

## Owner rulings recorded (tracked-backlog.md)
- T26 upload-url caps → ACCEPTED RISK, stays unbounded (re-open on abuse/commercial).
- NEW T27 = B2 tail (frame-p5-tester password in git history) → WON'T-FIX.
- T4 (purchase loop + plan rename) → DEFERRED long past M6.

## Slice 7 (audit B10 + A5)
- B10: public/enriched-sample (2.8MB) → `bakes/enriched/sample/{dnipro,dnipro-o2w}` — served at
  `/enriched/sample/*` by the EXISTING astro.config middleware (zero code). Generator OUT_DIR +
  serve-note updated; .gitignore block dropped (covered by /bakes/); dist has 0 sample files.
- A5: 42 de-exports (17 src values, 2 bake-lib, 23 types) + DELETED true orphans
  QualityTierSettings / ThemeTokens / SENSOR_FORMAT_WIDTH_MM (comment-only "usage" — the new
  ts(6133) hint caught it) + upload.ts:23 re-export narrowed to AdjustableParams/AdjustableKey.
  knip now clean except 2 documented FPs: DEFAULT_EXCLUDE_TAGS (test-imported),
  fetchOsmXml (imported by bake entry script knip calls an "unused file").

## Phase 8a — what shipped (files)
- **P1** `lib/ephemeris/twilight.ts` (TWILIGHT_DEG 0/−6/−12/−18 · twilightPhaseAt ·
  twilightSegments 5-min coarse + ≤1s bisection, tile the window exactly · darkWindows) +
  `test/lib/ephemeris/twilight.test.ts` (10 — analytic solstice lower-culmination vectors:
  70°N midnight sun single segment · 60°N solstice civil-only · equator equinox civil 20–29 min).
  UI: TimeScrubber `.ts-twilight` layer — FIRST child of .ts-rail, abs + pointer-events:none +
  aria-hidden (zero layout/behavior change); eye = planAnchor ?? camera focus, memo keys
  [anchorMs, lat*20, lon*20] (NEVER scene time — pinnedMs re-renders per scrub move).
  CSS steps = color-mix(moonlight 12/24/38/55%).
- **P2** `targets.ts`: SGR_A_STAR_J2000 (266.41684/−29.00781 SIMBAD) + GALACTIC_CENTRE_ID
  **"dso:gc"** (targetShortName slices "dso:" → chip "GC") + galacticCentreTarget() —
  kind "galaxy", facts dso variant, vmag null → POINT treatment. catalog.ts: gcEntry() in
  skyIndex + `id === GALACTIC_CENTRE_ID` branch in targetById (BEFORE dso:M). Band:
  `stars.ts milkyWayBandSegments(stepDeg, latitudesDeg)` (asterismSegments layout contract) →
  scene/stars.ts two children (b=0 core + ±12° edges, tokens.milkyWay additive lines) gated by
  `mwBand` update flag; StylizedTiles passes `visible && target.id === GALACTIC_CENTRE_ID`
  (tracked-constellation precedent). Tuning: MILKYWAY.bandStepDeg 3 / bandEdgeDeg 12 /
  bandAlpha 0.5 / bandEdgeAlpha 0.2.
- **P3** `lib/ephemeris/mwSeason.ts`: mwSeason(fromMs, observer, target) — per LOCAL night
  (noon→noon scan via localDayWindow), targetWindows(days:1, darkSunDeg −18, minAlt 5), longest
  window; moonInterference = moon-up ? K&S moonPhaseIntensity(phaseAngle) : 0 (NO altitude
  scaling — documented; deliberately ≠ planner finishWindow's 0.8·illum·√sin convention);
  score = usableMinutes × (1 − interference). + mwArcTiltDeg (galactic-equator tangent vs
  horizon; **literature anchor test: at lat 89.9 the tilt at the node l≈32.93° = the 62.87°
  galactic inclination** — passed first run). UI: PlanPanel MwCard after .pp-chips — 8 night
  rows (compact "9:15p–1:15a · 240m · ☾12%", score bar, click = setTime(peak)), ARC TILT NOW
  readout; memo [dayKey, lat*20, lon*20]; GC built at module scope (stateless closure).

## Browser-verified (shots verify-shots/phase8a-*)
02 twilight rail ladder · 03/04 GC tracked: TargetPanel RA 17h45.7m DEC −29°00′, windows,
❍ GC chip · 06 band b=0 + ±12° edges through the real MW haze bulge, trail OFF isolation ·
08 FPV SKYLINE CLEAR verdict for GC · **09 T25 POINT: GC point + broken-hairline ring + band
line THROUGH the reticle** · **10 T25 ELLIPSE: M31 at real 178′×70′ + widened ring** ·
13/14/15 PlanPanel MW card (fixed a meta-overflow — compact hhmm + minmax(0,1fr) col;
scrollWidth == clientWidth, no phantom h-scroll). Band gating proven: M31 tracked →
band LineSegments visible:false (240/480 verts), GC → true.

## Gotchas learned this session
- **Orbit view tilt clamps ~74°** → sky targets above ~alt 25° sit off-frame from orbit; the
  FPV path (temp pin → LOOK FROM HERE) is how you frame them (that's why asterisms are
  FPV-gated). The FPV auto-aim centres a tracked target dead-on.
- Synthetic dblclick on the globe needs a real mouse down/up pair first (known trap, held).
- zsh `set -- $pair` doesn't word-split; `echo ===`/`====` breaks zsh (globs) — use '--8<--'.
- GC constants: target = Sgr A*, band basis = frame GALACTIC_CENTER (≈4.3′ apart) — the
  "close but NOT merged" test locks 0.04° < sep < 0.1°. Star sphere is unprecessed (~0.3° vs
  the precessed reticle) — accepted, invisible at ±12° band width.
- MwCard meta: `.pp` card fits ~200px content — compact time format + minmax(0,1fr) or it
  drags the score bars past the card edge.

## Open / next
- 8a mobile twins M1 (rides P1) + M3 (rides P2/P3) now UNBLOCKED; next core = 8b (P4 Find ·
  P5 NPF/500 · P6 moon calendar).
- MILKYWAY.band* alphas + twilight CSS mixes + MwCard styling = owner-taste pass material.
- Release canary (T2/T3) still rides next `wix release`.
- Working tree UNCOMMITTED (owner drives #pr commits).
Related: [[project/wip-2026-08-13-full-audit-1]] [[patterns/sky-bodies-terrain]]
