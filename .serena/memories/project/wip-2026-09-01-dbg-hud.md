# WIP 2026-09-01 — DBG debug HUD (desktop-only chip + floating metrics window) — SHIPPED

**Status: DONE.** DECISIONS 2026-09-01 · design+AS BUILT: `.claude/claude-docs/DEBUG_HUD_PLAN.md`.

## Owner rulings recorded this session (2026-09-01)
- **BEST SPOT / heatmap: sufficient as implemented** — UX + algorithm improvements MAYBE later;
  park stands; T59 owner question still open, not urgent.
- **Shadows NOT fully fixed** — the 2026-08-27b/c cascade+dusk work did not close the owner's
  issue; continue in a later session. Do not treat that round as final.

## What shipped
Desktop-only `DBG` chip (off by default, warn-amber, beside ULT in the `hqExperimentsAllowed`
fragment) → floating resizable DebugPanel (Guide window grammar, drag/resize key "dbg", z 42):
**151 metrics + 3 actions across 15 filterable groups**, each with a technical InfoDot note,
sparklines, budget lines, warn thresholds, differenced counter rates.

## Architecture (the reusable knowledge)
- **`lib/globe/debugFeed.ts`** — the ALWAYS-COMPILED twin of the DEV `window.__*` seams (ULT
  precedent: runtime-gated, ships in release where DEV seams are eliminated). Three surfaces by
  cost class: per-frame SERIES (pre-alloc Float32 rings, one boolean while off) · PROVIDERS
  (flat dotted-key snapshots, panel-polled 250 ms/1 s, throw→null) · ACTIONS (scene walks,
  button-only). `makeRateTracker` = the one place cumulative counters become rates (RC11 rule).
- **Panel** re-renders React only on filter/collapse; values + sparklines are imperative ref
  writes at 10 Hz (`DEBUGHUD.uiTickMs`) — the store-mirror discipline holds.
- **`renderer.info`**: `autoReset=false` + ONE reset per rAF just before the draw block, so
  calls/tris cover shadow+composer+PiP. Verified read-by-nothing-else before flipping.
- **GPU ms**: `lib/globe/debugGpuTimer.ts` — query ring 8, disjoint discard, harvested async;
  measured real values (7.3 ms) in the harness. `supported:false` → row shows "—".
- **New engine seams** (all cheap): `imageryGround.overlayRebuilds()` (non-DEV twin of
  `__overlayRebuilds`) · `enrichedBuildings.debugCounts()` + **`deferred`/`rejected` running
  counters** (null-terrain deferral burn — the number that would have shown the RC7 49.7 %
  stall) · `terrainPatchStats()` (GLO-30 rewrites — 0 inside a patched region = patch dead) ·
  `planFeed.debug()` now carries terrainBin/azBins/meshIdx/meshCount/scanAgeMs ·
  `streetNames.census()`. The DEV `ultraLook()` terrain/aniso IIFEs were EXTRACTED to shared
  `terrainCastCensus()`/`anisoCensus()` (used by both the DEV probe and the HUD actions).
- **Fence learnings**: `store/bestSpot` is VALUE-import-fenced to seam owners — DebugPanel may
  NOT import it (worker flags ride the engine `planning` provider; StylizedTiles is an owner).
  `.ct-dbg.is-on` had to be hand-added to camera-tilt.css's lit list (the twice-shipped trap).
  New pref `debugHud` = the ultraQuality recipe verbatim (plain sanitize clause, NO rearm,
  `?? false`).
- **Imagery-z reach**: overlayInfo→tileInfo + `overlay.calculateLevel(info.range)` gives live
  Esri source-z min/max + composite count; the plugin's own `processQueue` is the 10th queue
  (NOT covered by the visibility freeze) — both now displayed.

## Verification receipt
vitest 2,231/2,231 (+21) · astro 0/0/8 · knip 0 · **`scripts/verify-debughud.mjs` 17/17**
(shots `verify-shots/debughud-01..04`). Guide fences 97/97 after "Nine→Ten toggles" +
DBG list line (`move-deck`) + `move-ultra` where-fix — text-only, goldens survived.

## Traps (new, cost real time)
- **The WELCOME overlay covers the chrome**: DOM assertions pass under it while a screenshot
  shows the landing. Dismiss `.wl-btn--primary` first; shoot AFTER data settles.
- **CDP `Runtime.evaluate` needs `awaitPromise:true`** for promise-returning probes, or every
  field reads `undefined` (the async-IIFE-stringify trap's CDP twin).

## Tails (non-blocking)
T73 candidates: imagery z full histogram · geoLabels census (only uninstrumented label layer) ·
an /m-negative harness leg · owner taste pass on the panel (density, group order, default size).
