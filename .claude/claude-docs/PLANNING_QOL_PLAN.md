# PLANNING_QOL_PLAN — PhotoPills deep review → the sun/moon/MW QoL pass

**Status: DESIGNED 2026-08-14 · QoL-1 SHIPPED same day (desktop, minus §3.1.D — see the decision
log tail) (owner orders 2026-08-14, `mem:project/owner-orders-2026-08-14-qol-batch`).**
This doc is the SPEC + research provenance for the QoL pass; the canonical SCHEDULE stays
`IMPLEMENTATION_PLAN.md §Phase 8` (re-ruled the same day to point here). Standing rule on every
adoption: **beat PhotoPills, never blindly copy** — only intuitive shot-planning value, nothing
that overburdens the app. Priority re-ruling (binding): **sun/moon/Milky-Way planning first**;
all astro/DSO work only after mobile is fully solved AND this QoL pass is done.

---

## 1. Research — PhotoPills user-guide deep review (feature-level, 2026-08-14)

**Method + provenance.** photopills.com is Cloudflare-challenged (403 to fetchers); the guide was
obtained via Wayback snapshots of 2026-07-07 (guide states "Updated to iOS v2.12, Android v1.7"):
`web.archive.org/web/20260707112100/https://www.photopills.com/user-guide` (Part I, planner) and
`…/20260707112124/https://www.photopills.com/user-guide-2` (Part II, pills). Two parallel
evidence-cited agents read 100% of both extracts; a third mapped the FTW seams. Verdicts below
were re-judged at synthesis against the codebase map. Screenshots/figures are lost to text
extraction — visual styling claims are marked UNVERIFIED. Memory twin:
`mem:project/wip-2026-08-14-qol-batch`.

### 1.1 What PhotoPills has that we lack — adoption table

| # | PhotoPills feature (guide section) | Verdict | Lands in |
|---|---|---|---|
| R1 | **Time Bar**: ALL light bands (night/astro/nautical/civil→blue/golden/day) as the bar's colour geometry | ADOPT (owner order) | QoL-1 scrubber v2 |
| R2 | **Sun/Moon elevation curves drawn ON the Time Bar** — bands + body altitude on one time axis | ADOPT | QoL-1 scrubber v2 |
| R3 | **Event-step tap zones** — tap right/left of the bar = jump next/previous almanac event (sunset, GH, BH, twilights, rise/sets) | ADOPT (cheap: `dayEvents` exists) | QoL-1 scrubber v2 |
| R4 | Long-press bar = 24 h ↔ fine zoom; double-tap = now | ADAPT (we keep dblclick=NOW; zoom = stretch goal) | QoL-1 |
| R5 | **Daily surface**: midnight→midnight cross-body event chronology (sun+moon+MW in ONE list), light-period colour-coded glyphs, "sun elevation at moonrise/set" quality signal, angular-diameter/transit/time-to-rise rows | ADOPT | QoL-2 daily panel |
| R6 | Elevation-vs-time **chart as input device** (swipe the chart = scrub time) | ADOPT (rail drag already is this; keep for daily panel) | QoL-1/2 |
| R7 | Tap-to-jump **next moon phase / next New Moon** (Panel 4/8 picture taps) | ADOPT (moonPhaseEvents exists) | QoL-2 |
| R8 | **Find** at az(±tol)+el over a date range; results sortable, rows carry light-type + as-seen phase pictures; row tap loads the moment. Craft constants: az+el modes ONLY (they shipped azimuth-only on iOS and found it dead weight), tol ≈3° az / 0.5° el, ranges 1 y sun / 2+ y moon, duration presets | ADOPT constants into P4 Find (planned) — FTW beat: skyline-filtered results + GC as a findable target (PhotoPills = sun/moon only) | QoL-3 (P4) |
| R9 | **Sun/Moon size→distance tool** (desired apparent size → distance ring around subject; inverse too) + angular-diameter readouts everywhere | ADOPT — telephoto-alignment essence; FTW renders the ring on real terrain + previews in FPV at real focal | QoL-3 |
| R10 | **Moon Distances**: year list of supermoons ("full moon near perigee")/perigees/apogees, each row glyph-coded by light period + as-seen phase; Moon Calendar month grid w/ supermoon rings | ADOPT into P6 (planned) | QoL-3 (P6) |
| R11 | **Extended azimuth lines** ("where can I STAND for this alignment") | ADAPT later — becomes a skyline-filtered stand-locus on real terrain (category-first) | Find+ (post QoL) |
| R12 | Meteors/h intensity graph ON the Time Bar (meteor layer) | precedent for R2/traces; meteor data itself | 8-events (post QoL) |
| R13 | Night AR per-direction **star-trail pattern preview** (blue curved lines per framing) | fold into star-trail sim spec (FPV-composed, real skyline) | 8-tools (post QoL) |
| R14 | Spot Stars: NPF + 500 both shown, NPF primary; min-declination-in-frame input | ADOPT into P5 — FTW beat: declination comes FREE from the FPV frustum corners (their UX tax deleted) | QoL-3 (P5) |
| R15 | **ICS calendar alert** for a planned moment ("send to calendar") | ADOPT — client-generated .ics, no cron needed | QoL-2 |
| R16 | Plan/POI save shelf (named list; moment vs place distinction) + per-plan notes | ADAPT — URL poses are plans-without-a-shelf; SavedPlaces exist | post QoL (owner call) |
| R17 | Timezone provenance colour (red=unverified/yellow=manual/white=auto) | NOTE — our date/time inputs are browser-local (store/time.ts:115–155); label the convention, don't clone the colours | QoL-1 (label) |
| R18 | Pain→pill router ("tell us your pain") + goal-first onboarding | ADAPT someday (FAQ copy) | out of pass |
| R19 | Widgets (offline glanceables) | SKIP (web app; PWA later ladder) | — |
| R20 | DoF/FoV/hyperfocal calculator suite, subject distance, focal match | SKIP as pills — FTW's FPV at real focal IS the viewfinder; hyperfocal/DoF numbers ride the lens HUD someday | — |

### 1.2 What we already beat (per the guide's own workarounds — marketing/positioning list)

Every one of these exists in PhotoPills only because it has NO 3D scene; FTW deletes the whole class:
- "Show real azimuth lines" (flat-map great-circle correction) — a 3D globe never had the error.
- Dashed-line-behind-obstacle + Panel-2 manual elevation comparison — FTW: real 3D skyline verdicts
  with named obstructions (`targetSkylineState`).
- More>Horizon manual "Blue Pin" horizon correction — FTW: the terrain IS the horizon.
- More>Altitudes building-top offsets — FTW has the actual buildings.
- The entire AR calibration apparatus (8-figure gesture, magnetometer hard requirement, visual
  calibration, device-height assumption) — FTW's FPV is deterministic and works for REMOTE spots.
- GC/MW "visibility times" astronomy-only — ours are skyline-filtered.
- Google-Elevation-API escape hatch for "Moonhunters" — our terrain+buildings answer natively.

### 1.3 Craft constants adopted (evidence: guide Part I Find section; Part II Spot Stars)

Find: az+el search only · default tolerances 3° azimuth / 0.5° elevation · date-range presets
1 d/1 w/6 m/1 y/2 y · recommended 1 y (sun), 2+ y (moon). Spot Stars: NPF primary, 500-rule as
ghost/legacy. Light-band partition (their academy convention, ADOPTED as `LIGHT_DEG`): day >+6°,
golden +6…−4°, blue −4…−6°, nautical −6…−12°, astro −12…−18°, night <−18°. The render
`GOLDEN` bell was measured at −6.5°…+15.4° (goldenElevationsDeg, 2026-08-14) — a deliberately
WIDENED scene-grading device; painting it as a band would label most of a summer day "golden",
so the bands use the photographic constants and the bell stays render+chips-only (the small
chip↔band divergence is documented in twilight.ts).

---

## 2. The re-prioritized ladder (folds §1 + old Phase 8 P1–P10 + MOBILE_PLAN §5/§6)

Owner re-ruling 2026-08-14: sun/moon/MW planning FIRST; astro/DSO only after mobile is fully
solved AND the QoL pass is done. Schedule lives in `IMPLEMENTATION_PLAN.md §Phase 8` (this table
is its spec source). Desktop-first per feature; mobile surfaces ride the M-twin after.

| Rung | Contents | Old-ladder mapping |
|---|---|---|
| **QoL-1 — Scrubber v2 + instant wins** (§3.1, §3.3, §3.4) | full light bands (R1) · infinite conveyor drag + real hour labels · sun/moon elevation curves on the rail (R2) · event-step tap zones (R3) · tracked-target visibility trace in frame context (§3.1.D) · my-location→FPV both shells · Space hold-ascend | P1 upgrade + owner batch |
| **QoL-2 — This-frame + daily surface** (§3.2) | FPV shoot-this-frame suggestions (frame crossings of sun/moon/GC, skyline-aware, light-tagged) · "when is body nearest az/el" single-target find (P4 core, seeded) · TODAY daily panel (R5: cross-body chronology, light glyphs, sun-el-at-moonrise) · next-phase/new-moon jump chips (R7) · ICS export (R15) | P4 seed + new |
| **QoL-3 — Find + moon/exposure toolkit** | P4 Find FULL (date-range az±tol/el search, skyline-filtered results, sortable, R8 constants) · P6 moon phase calendar + apogee/perigee/supermoon (R10) · P5 Spot Stars NPF (declination from frustum, R14) · sun/moon size→distance tool (R9) | P4 · P5 · P6 |
| **8-events** *(after QoL + mobile twins)* | P7 meteors (+ rail intensity trace R12) · P8 conjunctions · P9 lunar eclipses | old 8c |
| **8-tools/ambience** | P10 sensor-frame (DSO — explicitly slid behind) · star-trail sim (R13) · long-exposure/ND + timelapse calcs · What's-Up-Tonight · light pollution · ISS · umbra flagship | old 8d/8e |
| **M3+** | mobile surfaces of each rung above, in the same order, after its desktop DoD | MOBILE_PLAN M3–M6 |

Backlog rows folded: T8 (dayArcs skyline fold) partially lands via the §3.1.D trace; T9 (shadow
timeline) stays 8-tools; T11 taste knobs unchanged.

---

## 3. Feature-batch design (owner batch, desktop-first)

### 3.1 Time-scrubber v2 (desktop rail; mobile dock = M-twin after)

Current state (evidence: TimeScrubber.tsx:48,83,153–157,171–179,302–349; store/time.ts:96–108;
twilight.ts:71–96; time-scrubber.css:136–147): fixed 24 h window on a component-local anchor,
clamped `timeToFraction`/`fractionToTime`, twilight bands only (moonlight-alpha ramp — the owner's
"reads night-only" complaint), 25 unlabeled ticks, `−12h/+12h` static labels.

**A. Light bands (all colours).** New pure `lightSegments(startMs, endMs, lat, lon)` in
`lib/ephemeris/twilight.ts` — same coarse-scan+bisection engine as `twilightSegments` (crossed
boundaries refined in ORDER so the 2°-tall blue sliver is never skipped), thresholds `LIGHT_DEG`
{+6, −4, −6, −12, −18} → phases `day|golden|blue|nautical|astro|night`. Painted as spans with
distinct hues per phase (new tokens `--color-blue-hour`/`--color-night-band`; golden/day/naut/
astro reuse golden-hour/sun-glow/moonlight). Day gets a faint warm wash (not empty) so the band
strip reads as a complete 24 h light story; night genuinely darkens.
`twilightSegments` stays (mobile dock P1, darkness math consumers) until the dock's M-twin.

**B. Infinite conveyor drag + real hour labels.** Visible window **12 h** (SCRUB.windowHours
24→12), scene time pinned to the **rail centre cursor**; dragging the rail slides TIME under the
fixed cursor (PhotoPills direction: drag left = future), unbounded past/future; releasing near an
edge never clamps (edge-recenter logic deleted — the window is always centred). Hour ticks carry
REAL browser-local hour labels (the store's existing local-clock convention, store/time.ts:115–155)
every 2 h with midnight showing the date; bands/curves/ticks all render from the same
`windowStart = t − 6 h` so everything stays aligned while sliding. Keep intact: PLAY/rates/FF,
date input, time input, day steppers, hour/min steppers, NOW, dblclick=NOW, keyboard arrows,
EXIF seeding. [ASSUMPTION owner-check: centre-cursor conveyor replaces the travelling knob — the
knob WAS the old mental model; the conveyor is PhotoPills-proven and is what "infinite drag both
directions" implies.]

**C. Elevation curves on the rail.** New pure `elevationSeries(body, startMs, endMs, lat, lon,
stepMin)` (lib/ephemeris/dayArc.ts) → one `<svg>` overlay above the band strip: sun curve
(golden token) + moon curve (moonlight token, thinner), horizon = the strip's vertical midline;
memoized on quantized (windowStartQuantum, lat×20, lon×20) — never per-frame (the TimeScrubber.tsx:86–93
discipline). Curves recompute as the window slides on a 10-min anchor quantum.

**D. Tracked-target visibility trace in frame context.** The tracked SkyTarget's altitude trace
over the same window, segment-classified: below-horizon (absent) / up-but-skyline-BLOCKED (dim
dashed) / CLEAR (accent) — skyline via the planFeed profile; **in FPV additionally**: samples
whose az/alt fall inside the current frame (heading/pitch/fov from `camera.fpvHud`, the
offscreen.ts frameMarker math, pure port) render emphasized — "the object crosses MY frame
19:40–20:25". Scene-side planFeed computes+mirrors the trace polyline (~90 samples/12 h) into
`store/plan` at its existing low cadence (globe-writes-mirrors rule, planFeed.ts:358–440); the
rail only renders. Orbit mode: trace shows horizon+skyline classification only (no frame test).

**E. Event-step tap zones (R3).** Tap in the outer 12% of the rail = `setTime(next/prev
dayEvents edge)` (the existing `dayEvents` chip source, planner.ts:100–138); drag still scrubs
(tap = pointerup within `clickDragPx`). Beats PhotoPills: our event set already includes tracked-
target skyline crossings, not just sun/moon almanac events.

Tests: `lightSegments` partition invariants (contiguous, ordered, equinox/solstice vectors, polar
edge cases) · window math (unclamped mapping, centre-pin, label formatter incl. DST boundary) ·
`elevationSeries` sanity vs `horizontal()` · trace classification (mock profileFn). Component
tests stay out (repo convention: lib/store tests only).

### 3.2 FPV "shoot-this-frame" suggestions (QoL-2 — spec now, build next)

Pure `lib/ephemeris/frameFinder.ts`: `frameCrossings(bodyOrTarget, pose{latDeg,lonDeg,headingDeg,
pitchDeg,fovDeg,aspect}, fromMs, horizonDays, profileFn?)` → windows the body is inside the frame
rectangle (frameMarker math on az/alt→camera space) ∧ alt>0, each annotated {skyline CLEAR/BLOCKED,
light phase (lightSegments), moon interference (moonlight.ts)}. Coarse 5-min scan + bisection
(the twilight.ts engine idiom). Surface: a THIS FRAME card (FPV-only, PlanPanel section or HUD
flyout): "☀ enters frame TODAY 17:04 (golden) · ☾ 21:12 (78% moon) · GC crosses 00:40–02:10
CLEAR" — every row a jump chip; plus "when is ⟨target⟩ nearest frame centre" (single-target Find
inversion — GC closed-form ~3m56s/day drift, sun/moon root-find on the dayArc sampler; P4 seed).
Beats PhotoPills: their Find needs the user to enter az/el numbers; our frame IS the query.

### 3.3 My-location → FPV (both shells; QoL-1)

Geolocation (`navigator.geolocation.getCurrentPosition`, the platform-idiomatic API — no
permissions dance beyond the browser prompt) → `requestFpvJump({latDeg, lonDeg, eyeM: 1.7,
headingDeg: 0, pitchDeg: 0, fovDeg: FPV default})` (camera.ts:165–172 — the proven share-link
path drops the temp pin AND enters FPV). Desktop: new small `client:only` nav island (◎ MY SPOT)
in the index.astro topnav (:160–187). Mobile: `SceneActions.tsx` 🧭 upgraded from
pin+fly (:35–57) to the same `requestFpvJump`. C6: fix stays client-side, never published
(existing SceneActions discipline). Errors → existing flash-note pattern. HTTPS-only API — fine
(wix dev + prod are https; localhost exempt).

### 3.4 Space = FPV ascend with hold-acceleration (QoL-1)

Scope ruling [ASSUMPTION, recorded]: FPV eye-lift only (pairs the ⤒ nudge / vertical-encoder
identity; orbit zoom untouched — it has wheel+encoders and Space there would fight button focus).
Implementation: `Space` joins the orchestrator's `fpvKeysDown` path (StylizedTiles.ts:823,925–953)
— NOT a store rate, so a simultaneous canvas pointerdown's `clearAllTargets` can't null it (the
M2 fpvWalkInput lesson, camera.ts:137–141). Per-frame integration: hold time t → gain
`min(1, t/rampS)²` (quadratic — precision at tap, speed on hold) × `max(eye, FPV.vertEncoderBaseM)`
× `FPV.spaceLiftRate`; same clamps as the vertical encoder (temp: eyeHeightM…tempEyeMaxM 400;
photo: lift 0…400, StylizedTiles.ts:1797–1819). Tunables in `FPV` (rampS ≈ 2.5, spaceLiftRate).
Guards: only when FPV active; skip when `document.activeElement` is interactive (button/input/
select/textarea/contenteditable) — the rail is tabIndex=0 (TimeScrubber.tsx:305) and Space
activates focused buttons; `preventDefault()` to kill page-scroll; keyup + window blur both end
the hold (stuck-key safety).

---

## 4. Verification

- **Local (every slice):** vitest (new: lightSegments, window math, elevationSeries, trace
  classification, frameFinder later; baseline 738) + `npx astro check` (baseline 0/0/6 hints).
- **Browser (wix dev, headed Chrome CDP :9222, occlusion flags + tab selected — the 2026-08-14
  trap list):** rail bands show ALL colours at a Dnipro summer day · infinite drag crosses ≥3 days
  each direction with correct hour labels + band/curve alignment · curves match TimeReadout
  sun/moon alt signs · event-step taps land on chip times · Space ramp (tap ≈ cm-scale, 3 s hold
  ≈ fast) + no scroll/button side-effects · MY SPOT on both shells enters FPV at the fix (geo
  permission granted once per origin) · desktop smoke: frozen chrome untouched.
  Shots → `verify-shots/qol1-*`.
- **Real device / prod:** rides T1 + the release canaries (T2) as usual.

## 5. Decision log (append-only)

- 2026-08-14 · Deep review sourced from Wayback 2026-07-07 snapshots (site is Cloudflare-gated);
  feature-level verdicts re-judged against the codebase map; §1.1 R1–R20 is the adoption record.
- 2026-08-14 · Ladder re-prioritized per owner re-ruling (sun/moon/MW first): QoL-1/2/3 replace
  the old 8b content ordering; events/DSO slide behind; every rung desktop-first then M-twin.
- 2026-08-14 · Scrubber v2 = centre-cursor conveyor, 12 h window, browser-local hour labels
  (consistency with the existing date/time inputs).
- 2026-08-14 · Band edges = the photographic `LIGHT_DEG` constants (+6/−4/−6/−12/−18), NOT
  `goldenElevationsDeg(GOLDEN)` — the render bell measured −6.5°…+15.4° (a widened scene-grading
  device); one source per PURPOSE: bell = grade + chips, LIGHT_DEG = bands. Supersedes this
  doc's earlier same-day "one golden source" line.
- 2026-08-14 · Space-ascend scoped to FPV via fpvKeysDown (clearAllTargets-immune), quadratic
  hold ramp; orbit Space deliberately unbound.
- 2026-08-14 · My-location enters FPV through requestFpvJump on BOTH shells (mobile 🧭 upgraded
  from pin+fly); C6 client-side-only discipline carried.
- 2026-08-14 · Event-step taps: planFeed mirror when warm, else pure `dayEvents`+`moonPhaseEvents`
  computed AT TAP TIME (the mirror only runs with the PLAN panel open / a photo-FPV anchor —
  planFeed.ts:358–363; a rail tap must work regardless).
- 2026-08-14 · **QoL-1 SHIPPED (desktop + my-location both shells) except §3.1.D** (the tracked-
  target trace on the rail — next session with the planFeed mirror extension). Mobile dock
  deliberately inherits the 12 h `SCRUB.windowHours` (product consistency); its full v2 rides
  the M-twin. Verified 2026-08-14: infinite drag +25.2 h/−42 h exact, labels/bands/curves aligned,
  event-step both directions, Space ramp 1.71→16.70 m over 3 s hold + 1 cm tap + zero drift after
  release, MY SPOT/🧭 → temp-pin FPV at the stubbed fix on both shells (real geolocation prompt =
  owner-device tier). Gates 752/752 · astro 0 err. Shots verify-shots/qol1-01..08.
- 2026-08-14 evening · **§3.2 SHIPPED — QoL-2 desktop COMPLETE** (+ owner batch: GHOSTS temporal
  chain of the tracked body with count/step knobs · sun/moon as first-class `body:*` targets
  (searchable/trackable — the §3.2 "GC as findable" beat now covers EVERYTHING) · right-click
  sky context menu · WASD + ⇧␣ descend · daytime-moon dark-disc shader fix · HUD/minimap 210 px
  width match · compact FPV deck). frameFinder ships with an INJECTED sampler (any body/target,
  the planner idiom) + `nearestFrameCentre` as the P4 seed; TODAY replaced the flat chip row
  (self-computing, light-dotted, ☀-el-at-moonrise, per-row .ics); ICS = pure RFC 5545 builder +
  client Blob (no cron, C1). Gates 784/784 · astro 0 err; browser-verified qol2-01..08.
  Twin: DECISIONS 2026-08-14 evening + `mem:project/wip-2026-08-14-qol2-batch`.
- 2026-08-14 late · **§3.1.D SHIPPED — QoL-1 desktop COMPLETE** (playhead cursor rework rode
  along, owner screenshot order). Recorded deviation from the letter of §3.1.D: planFeed mirrors
  the ready profile's **skyline bins** (`store/plan.profileBins`) instead of a trace polyline;
  the RAIL computes the trace via new pure `targetElevationSeries`+`traceStates` (dayArc.ts)
  with its existing span-memo idiom, FPV in-frame emphasis via new `azAltFrameMarker`
  (offscreen.ts, roll-free pose from `FpvHud` + new `aspect` field). The bins mirror doubles as
  the §3.2 frameFinder profileFn seam. Gates 763/763 · astro 0 err. Browser-verified: orbit
  clear-only fallback · FPV blocked+clear vs the Dnipro skyline (bins 120, coverage 1.00) ·
  aim-at-Perseus → one contiguous emphasized frame window · pinned +3 h keeps the emphasis at
  its clock window. Shots verify-shots/qol1t-01..03.
