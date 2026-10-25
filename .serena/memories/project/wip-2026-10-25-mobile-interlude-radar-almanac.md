# wip 2026-10-25 — the mobile interlude: EVERY /m RADAR SURFACE WEARS THE MAIN MAP'S STROKES · THE PEEK ROW'S ALMANAC

Mode: fix/implement, small (`/frame` + the ecom-pilot core: quick tier, measure-first, one Opus review of the diff; no research
fan-out — the code was read directly). Owner: "a small unrelated interlude with a couple of mobile UX changes; be very careful
not to introduce regression; iPhone first, Android consistent" (they were still reviewing 2026-10-24c live) — then, on the
report that the fullscreen chart was left thin: **"make sure the chart is consistently thick and stylised, as the main map; it is
not about thick or thin, it is about a consistent look and usability across all mobile surfaces — then ship and deploy everything."**
Records: DECISIONS 2026-10-25 + 2026-10-25b (+ the release line) · ARCHITECTURE (the `radarCanvas` bullet) · `conventions/globe-tuning.md`
§AIMCONES (the `fanStrokeCssPx` bullet) · backlog **T199 BUILT** · NSP. Harness `scripts/verify-mobile-interlude-2026-10-25.mjs`
(`--baseline` prints the "before"); shots `verify-shots/mobile-interlude-2026-10-25/`. **Gated: vitest 3,881 / 255 · `astro check`
0 / 0 / 29 on the final src tree; browser ALL PASS (the new harness legs 1 + 2 · the 2026-10-10 harness legs 1,2).**

## 1. THE MINI-MAP'S + THE CHART'S RADAR = THE MAIN MAP'S
**Which "main map" — measured, not assumed.** Three radar surfaces on /m: the GL fan (the map), the FPV mini-map, the fullscreen
chart. On the twins' GLASS (a device-scale PNG through `sharp`, a ring between the sun and target bands where only the direction
lines cross): iPhone fan ray **2.67** css px · cone legs ~3.8–4.2 — mini-map **1.68 / 2.15** — chart **1.67 / 1.92**; Pixel fan
3.43 — mini 1.41 / 1.89 — chart 1.71. The chart ≈ the mini-map (the 2026-10-10 parity held); the FAN was ~2×: its quads are RADIUS
fractions (`lineHalfWidthK` 0.003 · `rimHalfWidthK` 0.0015 · the cone's `edgeHalfWidthK` 0.000625 over the ray-extended reach ×
`rayLenK` 6, × `widthK` 1.4) at R ≈ 0.4 × the view height, while both canvases drew `strokePx` 1 × widthK.
**The fix — the fan's own rule, mirrored on both canvases.** `lib/geo/radarBands.fanStrokeCssPx(viewH, mobile)` → `{ line, rim,
cone }` CSS px = the fan's geometry at the chart's radius rule (`mapRadiusHK` 0.5 × `mobileRadiusK` 0.8 × viewH): on 874 px
**2.94 / 1.47 / 3.67**. `panels/radarCanvas` takes an optional `strokeCssPx { line, rim }` (rim arcs + spokes at `rim`, direction
lines at `line`; absent → the one 2026-10-10 weight — desktop byte-identical). `panels/MiniMap.draw`: `fan = mobileShell ?
fanStrokeCssPx(window.innerHeight, true) : null`, the cone legs at `fan.cone`, **the radar block ends its strokes SQUARE** (`lineCap
butt` / `lineJoin miter` — the roads' round caps leaked in: invisible at 1.4 px, a 1.5 px nub past every dial's end at the fan's
weights; the sun dial's cap sat over the target ray's start). `panels/MapWindow.draw` (2026-10-25b): `fanStrokeCssPx(h / dpr, true)`
— its `rBase` IS the same radius rule, so the mirror is exact by construction — + the legs at `fan.cone` under the shell's ink lift
(`min(1, edgeAlpha × lineAlphaK)`; the chart's legs had none). After, on glass (iPhone / Pixel): fan 2.67 / 3.43 line · 3.75 / 3.79
legs — mini **3.04 / 3.14 · 3.67 / 3.51** — chart **3.33 / 3.43 · 3.25 / 3.36** (the chart's 2× store is upscaled 1.5–1.75× onto the
glass, hence its slightly broader line read); desktop store 2.02 / 3.02 unchanged. The glass reader's threshold noise is ±0.4 css
px. **The match is the NOMINAL fan** (nadir, well above the ground, inside the 150 m – 12 km clamp; a street-zoom fan on its floor
reads ~25 % heavier — the fan is hidden in FPV, there is no live fan to copy). Tests: `minimapFanStroke2026-10-25.test.ts` (the
geometry, the painter's per-kind weights, the fences: the mini-map's + the chart's calls, the caps). The 10-10 harness's leg 1 reads
`expectMiniWidth` and its leg 2c pins the chart at 5.9 store px (the 2× cap).

## 2. THE PEEK ROW'S ALMANAC (owner: "add sun and moon rise and set times permanently, in addition to the current object's,
with icons, same style, compact, readable, tell the 3 pairs apart, do not make the bar taller; no duplicate when the object IS
the sun or the moon — so you always have essential info at hand and don't have to go to PLAN")
`mobile/TargetPeek.tsx`: `SUN_TARGET` / `MOON_TARGET` module constants (`bodyTarget`), `useNextRiseSet` ×3 unconditionally; cells
[☀][☾] always + [the object's kind glyph] when `target.kind` is neither sun nor moon; one ↑/↓ legend column, each cell = glyph
(spanning both rows, + U+FE0E text presentation and `font-variant-emoji: text` — iOS WebKit may swap ☀ / ☄ for a colour emoji
otherwise; the leading `.m-peek__glyph` got the same) + the rise over the set; the button's label "Tracked target: 10P/Tempel 2.
Sun rise 05:42, set 19:43; Moon …; 10P …. Open details …" ("none", never an em dash, for a reader). The bearings `.m-peek__pos`
STACK (altitude over azimuth + cardinal) in the same 0.56rem grammar behind a hairline — the one-line "12° · 245° SW" at 0.68rem
took 86–93 px, the width three pairs need (41.5 px stacked) — THE one existing element changed. chrome.css: `.m-peek__alm*`
(0.56rem / 1.15, the legend 0.5rem / 1.288 so its rows sit on the clocks' rows; glyph inks `--color-sun-glow` · `--color-moonlight` ·
`--color-accent`), the row `overflow: hidden` (Android large-text: clip at the edge), a ≤ 375 px rule tightening the gaps (7 / 4 px).
Measured: the row **38.59 px** on the iPhone / Pixel / 360 twins against the **38.56** baseline (+0.03 css px = 0.09 device px —
nothing visible); overflow 0; the name's budget **89 / 99 / 62 px**; 3 cells → 2 with the sun or the moon tracked. The ☀ pair vs the
dock's sunrise: 2 s apart (the row's 1.6 m eye vs the dock's 2 m). Test `mobileTargetPeekAlmanac.test.ts` (the zustand
`getInitialState` mirror). Scope calls: the row still leaves with a dismissed object (owner 2026-08-19); "next rise" sits above
"next set" whatever their order in time (inherited from 2026-09-16; for the owner).

## Traps learned
- zustand v5 serves `getInitialState()` as the SERVER snapshot — a `renderToStaticMarkup` test must `Object.assign(store.getInitialState(),
  store.getState())` first (the findThisOne / bestSpotPanel idiom) or every store write is invisible.
- The house Chrome profile keeps the LAST TRACKED BODY across harness runs (prefs) — set the target explicitly.
- A glass ring reader measures the ray + the legs (±0.4 css px of threshold noise) but not a 1.5 px rim beside a glassy fill.
  Its PINK test must be MAGENTA (`b > 140 && b − g > 25`): the 10-10 test counted the chart's warm satellite imagery (a brick strip +
  a red kiosk, 170 / 130 / 120) as a 28 px "leg"; the chart's lower-left holds the aim stick's knob and its top the PiP box, both in
  the focal-cone ink — the pink search is the ring's upper half outside the PiP.
- A thick canvas stroke with round caps bulges half its width past its end — a sun dial can cover the start of the target ray.
- `node_modules/.bin/wix dev` on Node 24.10 booted clean on the first try, twice this session (no `.vite` churn).

Related: `mem:project/wip-2026-10-10-mobile-fixes-radar-find-keyboard` (the radar on glass — the 1.4× profile this builds on) ·
`mem:project/wip-2026-09-25-mobile-ux-pass` (the /m seats) · `mem:project/wip-2026-08-18-u4-aim-cones` (the fan's birth).
