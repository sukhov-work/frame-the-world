# wip 2026-07-12 — Rendering Pass 1 COMPLETED: tile-knob tiering + fluidity F1/F3/F5/F7 + GTAO wired

Mode: implement (investigate-design-v3) · Tier: Deep · Owner calls this session: **GTAO wired but
DEFAULT-OFF**, **land + local gates** (no browser this session — this machine is `high` tier; the
mid/low degradation needs a non-M3 box). Follows the keystone: `mem:project/wip-2026-07-12-rendering-quality-pass`.

## Gates (all green, LOCAL tier only)
`astro check` 0 errors / 0 warnings (2 pre-existing script hints) · **vitest 408** (401 baseline
+4 drift +3 lruCapBytesForTier) · **wix build** complete. Runtime perf/visual = BROWSER-UNVERIFIED
(needs `wix dev`, ideally non-M3). `window.__quality.force('low'|'mid'|'high')` A/Bs a tier.

## SHIPPED (all of rendering/RENDERING_QUALITY_PASS.md remaining Pass 1)
### Tile-knob tiering (the explicit "do next #2") — SAFE without a browser (high == byte-identical)
- NEW pure helper `lib/globe/quality.ts lruCapBytesForTier(tier, mb)`: **`null` on high**
  (restore each renderer's captured library default → byte-identical) · mid/low → `round(mb*1024*1024)`
  RAW BYTES (3d-tiles-renderer `LRUCache.maxBytesSize` is raw bytes, default `0.4*2**30`≈410 MiB,
  VERIFIED in node_modules). Locked by 3 new tests + monotonic-degrade asserts.
- Each renderer captures `lruDefaultBytes = tiles.lruCache.maxBytesSize` at construction (before
  plugins) and applies `maxBytesSize = cap ?? default`. Takes effect on next `tiles.update()`.
- Module setters (all take PRIMITIVES, decoupled from QUALITY): `buildings.setQualityTier(errorTarget,
  lruCapBytes)` sets `tiles.errorTarget`+LRU · `imageryGround.setQualityTier(errorNear, lruCapBytes)`
  → mutable `errorNearOverride` feeds the update() error-ramp NEAR endpoint · `streetNames.setMaxVisible(n)`
  → `maxVisibleOverride` · `vectorFeatures.setLatticeBudget(n)` → `latticeBudgetOverride`.
- Orchestrator: `StylizedTiles` handle gained `setQualityTier(tier)` → `applyQualityTier` fans out
  `QUALITY.tiers[tier]`; opts gained `qualityTier` (applied ONCE at attach so a weak device isn't
  briefly over-committed). GlobeCanvas.applyTier calls `tilesHandle?.setQualityTier(t)` each governor change.
- TRAP (hit): `let x = TUNING.field` infers the `as const` LITERAL type (`40`/`8`) → annotate
  `let maxVisibleOverride: number = STREETS.maxVisible`.

### Fluidity
- **F1 building screen-door reveal** (buildings.ts, the #1 street pop): per-tile birth stamped on
  `load-model` (`const birthMs = performance.now()`), written to a SHARED-material uniform by each
  mesh's/edge's `onBeforeRender` right before its draw (fill + edge are SEPARATE render-list items →
  own birth holders `uFillBirthMs`/`uEdgeBirthMs`; `uNowMs` advanced in `buildings.update()`). The ONE
  shared fill material's CHAINED onBeforeCompile + a NEW edgeMat onBeforeCompile inject the SAME 4×4
  bayer as imageryGround.ts:280 and `discard` at `<dithering_fragment>` when `age<1`. Opaque, O(1)/draw,
  no per-tile material (TilesFadePlugin can't ride the one-material invariant). `BUILDINGS.fadeInMs`=600.
  VERIFIED in node_modules: `LineBasicMaterial: 'basic'` → meshbasic frag HAS `<common>`+`<dithering_fragment>`
  so the edge `.replace` anchors exist. Aged tiles (age>=1) render byte-identical (the `if(age<1)` guard).
  Shadow/GBuffer passes use override materials → no discard there (building casts full shadow ~0.6 s early — cosmetic).
- **F3 street-name opacity ease** (streetNames.ts): LabelEntry gained `opacity`+`dying`; new labels
  fade IN from 0, de-selected labels marked `dying` (not dropped) → ease to 0 → `dropEntry` when <0.01;
  a dying label re-selected is REVIVED (`dying=false`). `STREETS.labelFadeLerp`=0.15/frame.
- **F5 dt-normalize idle drift**: NEW pure `lib/globe/drift.ts driftRadiansForDt(degPerSec, dtMs)`
  (+4 tests) · `DRIFT.degPerFrame 0.0011 -> degPerSec 0.066` (== 0.0011/frame @60 Hz, behavior-identical;
  correct pace at 30/120 Hz). StylizedTiles stepIdleDrift uses the CLAMPED `dtMs` (ORCH.maxFrameDtMs).
- **F7 graticule opacity fade**: `graticule.setPresence(k)` scales `uOpacity` + hides at 0; StylizedTiles
  ramps `(alt-fadeBottom)/(fadeTop-fadeBottom)` across `GRATICULE.fadeBottom/TopAltM` 150k->250k instead
  of the hard `visible = alt > GATES.decorMinAlt` toggle. (GATES became unused in StylizedTiles -> removed
  from its import.)

### R1 GTAOPass — WIRED but DEFAULT-OFF (owner call)
- NEW `AO` tuning group, `enabled: false` = **never constructed** (zero VRAM/cost). When true:
  GlobeCanvas builds `new GTAOPass(scene,camera,w,h)` -> `composer.insertPass(gtao, 1)` (after
  RenderPass(0), before UnrealBloom); gated by **tier (high) AND altitude** (`aoControl.setAltActive`
  called from StylizedTiles' graticule step, `alt < AO.maxAltM` 12 km). `window.__quality.ao` = the live
  pass for tuning. `screenSpaceRadius:false` -> `radiusM` is WORLD/view metres (needs scene-scale tuning).
- Horizon tint = a GUARDED monkey-patch of `GTAOBlendShader` (three ships NO AO-colour setter): both
  `.replace` targets VERIFIED present in node_modules (`GTAOShader.js:19` `uniform float intensity;` +
  `:343` the composite line, byte-exact) -> compiles clean when enabled; guard skips if source drifts.
  Multiply-blend can only DARKEN toward `tokens.skyHorizon`.
- To enable+tune: set `AO.enabled=true`, reload, A/B `window.__quality.ao.blendIntensity` /
  `.updateGtaoMaterial({radius,scale,samples})`. GBuffer prepass = 1 extra full scene render -> high+city only.
- Bundle note: GTAOPass is STATICALLY imported into the base GlobeCanvas chunk (~few KB) even when off.

## Files
tuning.ts (DRIFT.degPerSec · BUILDINGS.fadeInMs · GRATICULE.fade{Top,Bottom}AltM · STREETS.labelFadeLerp
· NEW AO group) · lib/globe/quality.ts (lruCapBytesForTier) · NEW lib/globe/drift.ts · scene/buildings.ts
· scene/imageryGround.ts · scene/streetNames.ts · scene/vectorFeatures.ts · scene/graticule.ts ·
StylizedTiles.ts · GlobeCanvas.tsx · NEW test/lib/globe/drift.test.ts · test/lib/globe/quality.test.ts.

## DO NEXT
1. **BROWSER-VERIFY in `wix dev`** (ideally a non-M3 box): `window.__quality.force('low')` measurably
   smoother + no jarring DPR pop; F1 stipple reads as intentional (not a pop); F3/F7 eases; high tier
   unchanged. 2. **Tune + enable GTAO** (`AO.enabled=true`, radius/intensity/tint). 3. **Pass 2 (Dnipro
   identity R2/R3/R4)** then **Pass 3 (moat)** — see rendering/RENDERING_QUALITY_PASS.md WS3/WS4. Phase 6 marketplace
   still deferred. Live URL still serves Phase 5 (pre-release `/api/ping` canary gate).

Related: mem:core · mem:project/wip-2026-07-12-rendering-quality-pass (keystone) ·
mem:patterns/globe-rendering · rendering/RENDERING_QUALITY_PASS.md · DECISIONS 2026-07-12.
