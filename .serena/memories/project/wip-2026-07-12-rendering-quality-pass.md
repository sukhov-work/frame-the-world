# wip 2026-07-12 — Rendering quality pass (DESIGN done + Pass 1 KEYSTONE shipped)

Mode: design→implement (investigate-design-v3) · Tier: Deep
Status: **design complete; Pass 1 keystone shipped & locally verified; rest of Pass 1 awaits wix-dev.**
Docs: `.claude/claude-docs/RENDERING_QUALITY_PASS.md` (full plan/backlog). DECISIONS 2026-07-12 (latest).

## Owner mandate + decisions
Hard pass on PERF + FLUIDITY + AESTHETICS of all 3D rendering, esp. STREET LEVEL + FPV; must run
below an M3 Pro. Dnipro detail = 2/5. Unmet moat: predict astro events/lighting + fit photo vs
ACTUAL cityscape/obstructions. Owner picked: **(1) Pass 1 first, queue Pass 2 immediately after;
(2) drop Google/photoreal realistic-mode (verified dead over Dnipro), go all-in stylized — existing
Esri SAT `groundMode` toggle stays opt-in/off-by-default (already the default).**

## Synthesis thesis (load-bearing)
ONE keystone (adaptive quality-tier + runtime frame governor — NONE existed: DPR static min(DPR,2)
GlobeCanvas.tsx:31, composer renders full every frame :228) resolves BOTH "runs below M3 Pro" AND
C2 "beauty not sacrificed" by making every realism add sheddable per device. + 3 payloads: fluidity
fixes, Dnipro DEFAULT-stylized upgrades, the obstruction/astro moat.

## SHIPPED this session (Pass 1 keystone — 401 vitest +24, astro check 0/0)
- NEW `src/lib/globe/quality.ts` (pure, three/DOM-free): `detectDeviceTier(caps)`
  (WEBGL_debug_renderer_info GPU family + deviceMemory/cores/maxTextureSize → low/mid/high;
  conservative, unknown→mid) + `makeGovernor(initial,cfg,ceiling)` (EMA frame-time steps the tier,
  asymmetric hysteresis + cooldown; no-op under budget). 24 tests `test/lib/globe/quality.test.ts`.
- NEW `QUALITY` tuning block (governor cfg + low/mid/high records: dprCap/bloom/shadowsEnabled/
  shadowMapSize/lruBytesMB/groundErrorNear/buildingErrorTarget/vectorLatticeBudget/maxStreetNames).
  **HARD INVARIANT: tiers.high == the pre-pass constants, test-locked vs RENDERER/SHADOWS/GROUND/
  VECTOR/STREETS** → capable machine byte-identical, only weak HW degrades → SAFE without a browser.
- GlobeCanvas: `antialias:false` (P1 — composer MSAA owns AA) + `powerPreference:'high-performance'`
  (P2) + device-tier → initial DPR/shadowMap.enabled/shadow mapSize/bloom.enabled + governor in the
  rAF tick (`applyTier` on change: DPR realloc + bloom.enabled + shadowMap.enabled + shadow-map
  realloc) + `window.__quality` DEV seam. Ceiling: low→capped (memory pressure invisible to frame
  time); mid/high→may climb to high (hidden GPU string on a real M3 Pro won't stick at mid).
- `src/global.d.ts` +__quality.
- VERIFICATION: local logic/types ONLY. Runtime perf/visual = BROWSER-tier UNVERIFIED → `wix dev`
  on a NON-M3 machine. DEV: `window.__quality.force('low'|'mid'|'high')` to A/B a tier.

## REMAINING Pass 1 (deferred — needs the wix-dev loop / owner eyeball; DO NEXT)
- Tile-knob tiering via the orchestrator (pass tier into attachStylizedTiles + a handle
  `setQualityTier`; GlobeCanvas already computes the tier): building `errorTarget`; both
  TilesRenderers' LRU byte cap (**CONFIRM the exact `lruCache.maxBytesSize` API in node_modules
  first — don't fabricate**); ground error-ramp endpoints; vector/street budgets.
- Fluidity: **F1 building screen-door fade** — per-tile "age" DISCARD via the EXISTING chained
  onBeforeCompile (buildings.ts:85), opaque, O(1)/draw, reuses the imageryGround.ts:280 dither;
  stamp birth on load-model (per-vertex aBirth attr = robust, or mesh.onBeforeRender uniform =
  cheaper but smoke-test draw order) + stamp the edge geometry. F3 street-name opacity ease. F5
  dt-normalize idle drift (StylizedTiles ~535/1120; add DRIFT.degPerSec + a pure tested helper).
  F7 graticule opacity fade (StylizedTiles:1836 boolean → ramp).
- **R1 GTAOPass tier-gated** — `three/examples/jsm/postprocessing/GTAOPass.js` is BUILT INTO three
  0.185 (NO new dep; N8AO not installed). Insert after RenderPass, before bloom; **altitude-gate
  (city/street only — pointless + possibly wrong on the self-lit earth at orbit) AND tier-gate
  (high only)**; tint AO toward tokens.skyHorizon. Highest-ROI aesthetic item; needs browser tuning.

## THEN Pass 2 (Dnipro identity) — owner "roadmap immediately after"
R2 per-building variation from OSM batch metadata (PROBE GLTFStructuralMetadata readable batch
table first — UNVERIFIED it's exposed here) · R3 night facade emissive · R4 client-side S3DB roof
reconstruction for the ~2–4k roof:shape/building:part Dnipro landmark subset (Overpass: 85,802
bldgs / 2,568 roof:shape / 1,766 building:part / 1,195 named) + optional hero glb. See WS3.

## THEN Pass 3 (the moat) — feasible; finder engine already ships
astronomy-engine `Search`/`SearchRiseSet`(eye-height dip)/`SearchAltitude`/`SearchHourAngle`/
`Seasons` verified astronomy.d.ts:1241-1894. Buildings ARE raycastable (only edges disable it).
QUICK WIN = pure lib/ephemeris/planner.ts + terrain-only horizonProfile.ts + jump-to-time PlanPanel
(NO LOD risk). STRUCTURAL = lib/geo/occlusion.ts raycaster, 2–4 km trust radius, low cadence. WS4.

## Key verified findings (self-checked)
- Google P3DT VERIFIED ABSENT over Ukraine → useless for Dnipro. 2/5→4/5 is a DEFAULT-stylized
  problem; GTAO is the highest-ROI first realism move.
- Building hard-pop is STRUCTURAL (TilesFadePlugin per-material WeakMap incompatible with the ONE-
  material invariant) → F1 screen-door discard is the fix.

Related: mem:core · mem:patterns/globe-rendering · mem:patterns/sky-bodies-terrain ·
mem:patterns/photo-frustum · RENDERING_QUALITY_PASS.md · DECISIONS 2026-07-12 (latest).
