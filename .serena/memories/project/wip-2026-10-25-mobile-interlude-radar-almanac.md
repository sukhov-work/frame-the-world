# wip 2026-10-25 — the mobile interlude: EVERY /m RADAR SURFACE WEARS THE MAIN MAP'S STROKES · THE PEEK ROW'S ALMANAC · THE DAY'S RISE / SET

Mode: fix/implement, small (`/frame` + the ecom-pilot core: quick tier, measure-first, one Opus review of the first diff; no research
fan-out). Three owner asks in one session: (1) the mini-map's radar strokes = the main map's; (2) ☀ ☾ rise / set permanently on the
/m target row; then **"make sure the chart is consistently thick and stylised, as the main map — a consistent look and usability
across all mobile surfaces — then ship and deploy everything"**; then **(3) "you calculate rises / sets for the NEXT calendar day —
until 00:00 keep calculating all pairs for the CURRENT day; a micro (+1) where an event falls tomorrow; write the reason you had
picked that behaviour."** Records: DECISIONS 2026-10-25 · 10-25b · 10-25c (+ the release lines) · ARCHITECTURE (the `radarCanvas`
bullet) · `conventions/globe-tuning.md` §AIMCONES · backlog T199 BUILT · NSP. Harness `scripts/verify-mobile-interlude-2026-10-25.mjs`
(`--baseline` prints the "before"); shots `verify-shots/mobile-interlude-2026-10-25/`. **Gates on the final tree: vitest 3,892 / 256 ·
`astro check` 0 / 0 / 29; browser ALL PASS (legs 1 + 2 · the 2026-10-10 harness legs 1,2 · a dated +1 probe). Two ships + two releases.**

## 1. EVERY /m RADAR SURFACE = THE MAIN MAP'S
**Which "main map" — measured, not assumed.** On the twins' GLASS (a device-scale PNG through `sharp`, a ring between the sun and
target bands): iPhone fan ray **2.67** css px — mini-map **1.68** — chart **1.67**; Pixel 3.43 / 1.41 / 1.71. The chart ≈ the mini-map;
the FAN was ~2×: its quads are RADIUS fractions (`lineHalfWidthK` 0.003 · `rimHalfWidthK` 0.0015 · the cone's `edgeHalfWidthK` 0.000625
over the ray-extended reach × `rayLenK` 6, × `widthK` 1.4) at R ≈ 0.4 × the view height; both canvases drew `strokePx` 1 × widthK.
**The fix — the fan's own rule, mirrored.** `lib/geo/radarBands.fanStrokeCssPx(viewH, mobile)` → `{ line, rim, cone }` CSS px at the
chart's radius rule (`mapRadiusHK` 0.5 × `mobileRadiusK` 0.8 × viewH; on 874 px **2.94 / 1.47 / 3.67**). `panels/radarCanvas` takes an
optional `strokeCssPx { line, rim }` (absent → the one 2026-10-10 weight — desktop byte-identical). `MiniMap.draw`: `mobileShell ?
fanStrokeCssPx(window.innerHeight, true) : null`, the legs at `fan.cone`, **the radar block ends its strokes SQUARE** (the roads' round
caps leaked in — a 1.5 px nub past every dial's end at the fan's weights; the sun dial's cap sat over the target ray's start).
`MapWindow.draw` (10-25b): `fanStrokeCssPx(h / dpr, true)` (its `rBase` IS the same rule), the legs at `fan.cone` under the shell's ink
lift. After, on glass (iPhone / Pixel): fan 2.67 / 3.43 line · 3.75 / 3.79 legs — mini **3.04 / 3.14 · 3.67 / 3.51** — chart **3.33 /
3.43 · 3.25 / 3.36**; desktop store 2.02 / 3.02 unchanged. The match is the NOMINAL fan (nadir, well above the ground, inside the
150 m – 12 km clamp; a street-zoom fan on its floor reads ~25 % heavier). Tests `minimapFanStroke2026-10-25.test.ts`; the 10-10
harness reads `expectMiniWidth` (leg 1) and pins the chart at 5.9 store px (leg 2c).

## 2. THE PEEK ROW'S ALMANAC
`mobile/TargetPeek.tsx`: `SUN_TARGET` / `MOON_TARGET` module constants; cells [☀][☾] always + [the object's kind glyph] unless it IS
one; one ↑/↓ legend column; each cell = glyph (+ U+FE0E and `font-variant-emoji: text` — iOS WebKit may swap ☀ / ☄ for a colour
emoji) + the rise over the set; the label "Tracked target: 10P/Tempel 2. Sun rise 05:41, set 19:43; Moon …; 10P …. Open details …".
The bearings `.m-peek__pos` STACK (altitude over azimuth) in the same 0.56rem grammar behind a hairline — the one existing element
changed (the one-liner took 86–93 px, the width three pairs need; 41.5 px stacked). chrome.css `.m-peek__alm*` (0.56rem / 1.15, the
legend 0.5rem / 1.288), the row `overflow: hidden`, a ≤ 375 px gap rule. The row **38.59 px** on every twin vs the 38.56 baseline
(+0.03 css px = 0.09 device px); the name's budget 89 / 99 / 62 px (iPhone / Pixel / 360). The row still leaves with a dismissed
object (owner 2026-08-19).

## 3. THE DAY'S RISE / SET (10-25c)
**Why it printed tomorrow's:** the row was built on `nextRiseSet` — the 2026-09-16 almanac "NEXT event" semantics (a watch's next
alarm, strictly after scene time): at 15:00 the sun's next rise is tomorrow's; once the moon is up its next rise is tomorrow's.
**Now:** `lib/ephemeris/riseSet.dayRiseSet(target, nowMs, lat, lon)` → `{ rise, set: { ms, dayOffset } | null, dayStartMs, dayEndMs }`;
the clock day is `clockDayWindow(ms)` — BROWSER-LOCAL midnight to midnight, DST-safe, deliberately NOT the planner's `localDayWindow`
(the whole-hour SOLAR day at the longitude: Dnipro's starts at 01:00 on a summer clock; the owner's rule is the clock's midnight, the
clock the row prints — the dock's event list still uses the solar day: an hour apart in summer, unraised); each side = the first event
at or after the day's start within 48 h (`nextRiseSet(target, startMs − 1)`), a past-the-end event carries the clock-day offset (`+1`;
≤ 1 for the moon). `useDayRiseSet` memoised on (target · 0.01° observer · the clock day — `sameDay`), rolling at midnight. The cell:
the clock + `<span class="m-peek__alm-d">+1</span>` (0.42rem, `line-height: 0`, a relative lift — out of the line box); the label says
"next day" / "in N days". Measured: the row 38.59 px with and without the marker (the almanac block 21.59); the harness pose: sun
05:41 / 19:43 · moon 15:53 / 23:16 · the comet 21:46 / 04:02 — all today's; 2026-09-06 (no moonrise that clock day): "00:48+1" on the
rise, the set 16:55 (shot `07-iphone-peek-plus1.png`). Tests `test/lib/ephemeris/dayRiseSet.test.ts` (+11) + the almanac test (+1).

## 4. RECORDED for the next session — T200 the moon's perceived visibility (owner 2026-10-25e)
The verbatim ask sits in the backlog row; the gist: realistic brightness / colour / contrast / other curves for the moon against the CURRENT sky
(the sun above the horizon or not, twilight state), with Rayleigh scattering and atmospheric thickness — "is it optically worth it" for a dusk or
early-morning shot. Hard lines: re-read every prior moon ruling first (T131 · T133 · T47 parked · the eras 08-22 / 08-26 / 08-27 / 09-10 / 10-13);
build the safest, most efficient rungs first (a pure `lib/sky/moonVisibility.ts` + a verdict → existing uniforms → shader last), measured on the
phone twins between rungs; never degrade mobile; desktop / ULTRA may go richer. Nothing built.

## Traps learned
- zustand v5 serves `getInitialState()` as the SERVER snapshot — a `renderToStaticMarkup` test mirrors the live stores onto it first.
- The house Chrome profile keeps the LAST TRACKED BODY across harness runs (prefs) — set the target explicitly.
- A glass ring reader measures the ray + the legs (±0.4 css px of threshold noise) but not a 1.5 px rim beside a glassy fill. Its PINK
  test must be MAGENTA (`b > 140 && b − g > 25`): the 10-10 test counted the chart's warm satellite imagery as a 28 px "leg"; the
  chart's lower-left holds the aim stick's knob and its top the PiP box, both in the focal-cone ink.
- A thick canvas stroke with round caps bulges half its width past its end — a sun dial can cover the start of the target ray.
- astronomy-engine's `SearchRiseSet` converges within ~15 ms from different start times — compare instants with a tolerance.
- `node_modules/.bin/wix dev` on Node 24.10 booted clean on the first try, three times this session.

Related: `mem:project/wip-2026-10-10-mobile-fixes-radar-find-keyboard` (the radar on glass) · `mem:project/wip-2026-09-25-mobile-ux-pass`
(the /m seats) · `mem:project/wip-2026-08-18-u4-aim-cones` (the fan's birth) · the 2026-09-16 session (the single stacked pair).
