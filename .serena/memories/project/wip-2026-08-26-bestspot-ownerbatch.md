# WIP 2026-08-26 — BEST SPOT owner QA batch (5 items) SHIPPED + BROWSER-VERIFIED

Owner order (mid-QA of the heatmap): five immediate findings, "main batch of asks/fixes will come
in next sessions". Twin: DECISIONS §Recent **2026-08-26e**. Predecessors:
[[project/wip-2026-08-24-bestspot-s3-s7]] · [[project/wip-2026-08-23-bestspot-heatmap]].

## GATES
**vitest 2,119/2,119 (141 files, +21 over 2,098)** · `astro check` 0 err / 0 warn / 6 hints ·
`npx knip` exit-0 · **`scripts/verify-bestspot-ownerbatch.mjs` 45 PASS / 0 FAIL** (NEW harness) ·
`scripts/verify-bestspot.mjs` re-run — see CARRIED #1, its D8 block is RED **on clean master too**.
Tier: LOCAL + BROWSER. Shots `verify-shots/ownerbatch-0826-01/02`.

## THE ONE STRUCTURAL PROBLEM — R2 MAKES FPV A CENTRE SOURCE
Item 3 asks to stand at a shortlisted cell in FPV *without* re-solving. But `aimAnchorFor` puts the
walked eye at **rung 1** (`aimAnchor.ts:56-58`), so entering FPV re-keys the feed's T0, bumps
`sourcesEpoch`, and then **keeps re-solving on every step of the walk** (`camGeo` mirrors past a
~0.11 m deadband; `client.cancel` makes it "one in flight", not "no work").

**The fix is a CENTRE LOCK, not a second FPV anchor.** Three facts made that the cheap repair:
the disc's centre is read in exactly ONE place (`stepBestSpotFeed`), so freezing it is one
expression rather than a carve-out in the shared ladder that `MapWindow`/radar/focal-cone also read
and `aimAnchor.test.ts` pins; the frozen value is `store.centreLatDeg` — the centre the engine
ACTUALLY SOLVED, echoed from the request verbatim — so `t0` is byte-identical; and the borrowed
temp pin is restored on exit, so the unlock lands where it locked. **R2 is not amended**: the sheet
still renders nothing in FPV.
MEASURED: **jobs 5 → 5 across the whole preview, `t0` and `sourcesEpoch` unchanged, pin restored
verbatim, and still no re-solve after ESC.**

## WHAT SHIPPED, BY ITEM
- **1 · select ≠ travel.** Row click was `setTempPin` → moved the centre → re-solved → destroyed the
  list it came from. Now: click SELECTS (`store.selectedKey`, looked up not cached, so a re-solve
  needs no clean-up), and `GO →` / `◎ LOOK` / `◠ REFINE` appear on that row. Selected marker gets a
  BRIGHT accent rim (the halo flips `tokens.bg → accent`) + `selectRadiusK 1.6`; own eased channel,
  no crosstalk with hover.
- **2 · marker colour = quality.** SUPERSEDES the shipped "colour is IDENTITY" rule. New
  `HEAT_SPOTS` (lavender→ice→mint→sunGlow→sunCore; monotone OKLab L 0.761→0.967, minΔL 0.0292; no
  accent, no heat token). Re-using INFERNO was refuted twice: a marker painted its own cell's colour
  is invisible, and the top-K lives in INFERNO's near-black foot. HUE = `shortlistQuality`,
  VIVIDNESS = `displayT(absolute)` so an all-bad disc reads faint (§3.5 survives).
- **3 · hover tip + FPV preview.** `bestSpotSheet.pickMarker(ndc)` reproduces the vertex shader's own
  billboard projection (a Raycaster CANNOT answer it — `raycast = () => {}` on every child, and the
  billboard happens in the shader). `sceneHoverKey` had **no writer anywhere in src/** before this.
- **4 · the heatmap switch.** `◎ HEATMAP` was a `<span>` printing ON whenever a centre existed;
  arming was "the window is open". Now `store.heatmapOn`, forced OFF by `setOpen` in BOTH
  directions, and the feed's third `armed` term.
- **5 · REFINE names its target and reports its effect.** Was `topK.find(hoverKey) ?? topK[0]`.
  Now on the selected row, and `refinedFromScore` (stamped in `onRefined`, the one moment both
  numbers exist) drives `1 m: +0.19` / `1 m: NO CHANGE` on the ROW.

## TWO BROWSER FINDINGS THAT CHANGED THE DESIGN
1. **Snapping to the nearest of 5 stops gave 2 colours for 8 markers.** Real Dnipro shortlist
   `score ÷ best` = 1.000→0.824 → six markers one colour, two another. Fixed with CONTINUOUS
   interpolation (`spotQualityStops`/`spotQualityCss` via `color-mix(in srgb, …)`, `spotQualityGl`
   via a byte lerp — **both in sRGB**; lerping two `THREE.Color`s blends in LINEAR space and misses
   the swatch beside it).
2. **…and even continuous, a RATIO uses only the top fifth of the ramp** — a top-K is by definition
   drawn from the top of the field, so the lower stops are unreachable by construction. Fixed with
   `shortlistQuality(score, scores)` = span-normalised **(score−min)/(max−min)**, exported from
   `store/bestSpot` so the panel swatch and the GL marker share ONE formula (the panel may not
   import `scene/**`). Legend says `HUE SPREADS THE EIGHT · BRIGHTNESS IS ABSOLUTE`.
   Degenerate span → 1, never NaN (a NaN in a vertex attribute is a silently BLACK marker).
3. **A 4-row marker legend pushed row #1 below the fold** at the default window height. Compressed
   to 2 rows + an inline `.bsp-legend__cap`. The scarcest thing on this panel is the space ABOVE the
   shortlist, and the shortlist is the product.
4. `.bsp-tip` at `max-width: 21rem` ellipsised its longest line — and the clause it dropped was the
   RESOLUTION qualifier. 25rem, measured.

## FILES
`store/bestSpot.ts` (+`heatmapOn`/`selectedKey`/`sceneHoverScreen`/`previewKey`/`previewSpot`/
`shortlistQuality`/`BestSpotSpot.refinedFromScore`) · `lib/theme/heatPalette.ts` (+`HEAT_SPOTS`,
`spotQualityStops/Css/Gl`) · `scene/bestSpotSheet.ts` (marker material rewrite: `aTint`/`aVivid`/
`aSelect`; `pickMarker`; `viewportWPx`/`selectedKey` on the ctx; digit atlas → `textPrimary`) ·
`scene/bestSpotFeed.ts` (`armed` third term, `rebuildMarkers`, `refinedFromScore` stamp) ·
`StylizedTiles.ts` (preview lifecycle + centre lock + `tryBestSpotMarkerClick` + the hover step) ·
`BestSpotPanel.tsx` (`BestSpotHoverTip`, `SpotRow` rewrite, `refineDeltaLabel`, `spotWhyLines`) ·
`tuning.ts` (`selectRadiusK`/`markerDimK`/`markerPickPadPx`/`previewArmFrames`) ·
`styles/bestspot-panel.css` · `scripts/verify-bestspot-ownerbatch.mjs` (NEW).

## TRAPS PAID FOR THIS SESSION
- **`verify-bestspot.mjs`'s `openDiscAt` had to learn `setHeatmapOn(true)`** — and the ORDER matters,
  because `setOpen` forces the switch off.
- **Node 20 has no global `WebSocket`.** Every CDP harness needs `~/.nvm/versions/node/v24.10.0/bin`
  on PATH (or `--experimental-websocket`). The repo's default `node` is v20.19.2.
- **`test/verifyHarness.test.ts` (C11) fences every `scripts/verify-*.mjs`**: `trackTarget` at
  `/json/new`, exit through `finishVerify`, never a bare `process.exit`.
- A verify script that only sets the pin proves NOTHING — the disc solves from what has STREAMED, so
  it must `#p=` fly there AND pin the time, then `armSession()`.
- A full-canvas pointer sweep blew the 90 s CDP cap. Project the marker from its live INSTANCE
  MATRIX and dispatch ONE `pointermove`.
- `fences.test.ts` only inspects lines matching `/^\s*(allowed|enabled):/` inside
  `stepBestSpotFeed` — new gate terms belong ON those lines.

## OPEN / CARRIED
1. **`verify-bestspot.mjs`'s D8 cross-model block is RED, and it is NOT this batch.** Verified by
   stashing: clean master measures hero rank-1 **S 0.3159** where the fixture (recorded 2026-08-24)
   expects **0.065**, and the hero skyline **0.97°** where it expects 40.31°. Consistent with RC16's
   straddler recovery + RC17's pick-height removal landing on 2026-08-26 — both change the BUILDING
   geometry that reaches BOTH models. The fixture needs re-deriving; the rest of that harness (96 of
   101 checks) is green.
2. The FPV preview's heading is `bestSpotFeed.contactAzDeg()` and its eye is `store.sheetAltM` — the
   eye the SOLVER scored from. Untuned taste: a lifted sheet previews from a drone height.
3. `previewArmFrames` (240) is a rail against a permanently frozen centre lock; it has never fired.
4. Only the DESKTOP panel changed. `/m` is untouched (S8/S9 twins remain deferred).

Related: [[project/wip-2026-08-24-bestspot-s3-s7]] · [[patterns/globe-rendering]] ·
[[decisions/session_workflow]] · [[project/dev_environment]]
