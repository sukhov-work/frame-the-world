# wip 2026-08-18 — U6 foveated loading SHIPPED + U7 terrain audit DONE (2026-08-18o)

## U6 — what shipped (DECISIONS 2026-08-18o; /frame + investigate-design-v3 implement mode)
LoadRegionPlugin foveation per buildings/enriched/ground: range-capped `RangedRayRegion`
(subclass of RayRegion — stock ray is INFINITE, pierces the globe) along the FPV look +
eye `SphereRegion`; regions mutated in place per frame in `stepViewFocus` beside the U5 aim
(one seam, epoch-fresh `_camFwd`). Tier lever `QUALITY.tiers[tier].foveation` — null on high
(byte-identical invariant = desktop unchanged), mid {1400,160,×1.5}, low {900,110,×1.6}.
`FOVEATION.regionErrorTargetM` {buildings 8, enriched 4, ground 2} — GEOMETRIC-ERROR METRES.

## Library facts (0.4.28 installed-source — reuse, don't re-scout; twin in globe-tuning §Traps)
- Region ET semantics: `calculateError = tile.geometricError − regionET + baseET` ⇒ refine while
  geometricError > regionET — distance-independent, NOT screen-space.
- Merge: `max(cameraError, regionError)`; out-of-frustum region tiles get inView=true forced
  (downloaded + scene-graphed; GPU-culled). Regions only TIGHTEN ⇒ periphery softening must
  ride the BASE errorTarget (`quality.peripheryErrorTarget`, pure, tested). GROUND base never
  relaxes (heightAt seats buildings/frustum/FPV on it) — ground = additive regions only.
- Regions evaluate in the tiles-GROUP frame, NO matrixWorld fold-in — convert world pose via
  `group.matrixWorldInverse` (TilesGroup maintains it; enriched seat lift handled).
- Constructors CLONE geometry args — mutate `region.ray/.sphere`, never re-construct; addRegion
  dedups; `clearRegions()` == plugin-off (empty loop). Never set `region.mask`.
- `registerPlugin` calls `plugin.init(tiles)` SYNCHRONOUSLY (listener-swap guards are safe
  right after registration).
- Region `calculateDistance` default = Infinity ⇒ region-only tiles sort LAST in our U5
  comparator; RangedRayRegion overrides it with distanceToPoint (fovea queues near-first).
- UpdateOnChangePlugin (ground) re-tiles only on camera motion — region flips with a parked
  camera need `tiles.dispatchEvent({type:'needs-update'})` (the adapter does).
- **UPSTREAM BUG (T33):** ImageOverlayPlugin `_onTileVisibilityChange` reads
  `tileInfo.get(tile).range` UNGUARDED (:230; all other consumers check .has) — tile disposed
  mid-fade TypeErrors on fade-complete. Guarded listener swap in imageryGround.ts; re-verify on
  ANY version bump.

## Files
`lib/globe/quality.ts` (+FoveationTierCfg, peripheryErrorTarget) · `tuning.ts` (FOVEATION block
after LOADING + tiers.foveation) · NEW `scene/tileFoveation.ts` (adapter: plugin + 2 regions +
configure/setActive/setPose/snapshot; world→group-local inside) · buildings/enrichedBuildings
(setFoveation/setFoveaActive/setFoveaPose/foveaSnapshot + ONE-WRITER base-ET recompute
`applyErrorTarget()` from (tierET, fovCfg, fovOn) — tier flips mid-FPV compose) ·
imageryGround (same handle, regions-only + the T33 guard) · StylizedTiles (applyQualityTier
fan-out, `foveaOn` mirror flip + pose ×3 in stepViewFocus, DEV `__globe.u6()`) ·
quality.test.ts (+9: periphery rule, tier invariants incl. high.foveation null, monotonic).

## Verified (browser, both shells, CDP-attach :9222)
High orbit: cfg null/base 16 (byte-identical) · mid FPV: engaged ×3, base 24→36, ground base
at ramp (3), aim k=1.5 composing · boundary matrix (enter/exit/tier-flap ×4 mid-FPV) clean,
ZERO overlay TypeErrors post-guard · steady-state foveated FPV 0 hitches/8 s, EMA 16.7 ms,
60 fps, queues drained · /m: 2D boot off → FPV engaged → exit lands 2D disengaged (parked
governor step applies at exit — base may land at the RESTORED tier, correct) · warm-cache
firstAfterMark mid-FPV entry: enriched ~185–221 ms, ground ~528–624 ms, buildings ~1.1–1.3 s
(local saturates; cold-network + periphery-softness taste ride T1). Shots verify-shots/u6-01..03.

## U7 — terrain audit DONE (memo = UPLIFT_PLAN Appendix A; owner calls open, defaults attached)
Method (repeatable): ion asset-1 endpoint via PUBLIC_CESIUM_ION_TOKEN (.env.local) →
layer.json (curl --compressed! gzip) → per-level available[] vs Dnipro x/y (geodetic TMS,
2^(L+1)×2^L) → direct tile GETs (Accept: application/vnd.quantized-mesh;extensions=…, ?v=1.2.0)
→ header decode (88 B header, u32 vcount, zigzag-delta verts) → L10 metadata extension (ext id
4, 4-byte length prefix!) for the deep availability subtree → AWS terrarium z13 PNGs as the
SRTM30 reference.
**Findings:** max L13 over Dnipro (200 at L12/13, 404 at 14/15; metadata subtree ends L13) ·
leaf meshes 4-VERTEX QUADS city-wide (9/9; L12 8v; L10 9v+64KB watermask) ⇒ ~2 km effective
posting · landmark errors vs SRTM30 +13…58 m (river +33…37!) · Kyiv/Kharkiv/Lviv/Odesa/
Rostov/Minsk ALL 4v while Warsaw 489/Berlin 668/Rotterdam 451/Interlaken 1250 ⇒ the fine
source ends at the EU-DEM/EEA39 border; over UA the source is km-class (R6 "SRTM 30 m ceiling"
~50× optimistic) · app heightAt 120.4 == decoded quad corner EXACTLY (rendered terrain IS
these quads — U6 verify pin cross-check).
**Sources:** GLO-30 free+commercial (the step-change; EGM2008→ellipsoid shift needed; AWS S3) ·
FABDEM CC BY-NC-SA blocked · WorldDEM Neo 5 m ≈$3.5–5.5k/400 km² pre-war archive · Maxar ≈$16k
feasibility-gated · UA state geodata CLOSED under martial law (Res. 564/263; C6: archive-only,
never task new collection; public 5 m patch = explicit owner republication call).
**Recommendation:** GLO-30 quantized-mesh patch on R2 (mago-3d-terrainer, active 2026; or
ctb-quantized-mesh/CTOD), composite over CWT in layer.json; judge 5 m only after. Esri imagery
licence rider carried (terrain-scoped audit).

## TRAPS (harness)
- The owner's :9222 Chrome froze rAF under OS WINDOW occlusion even after bringToFront — fix:
  CDP `Browser.setWindowBounds {windowState:'normal'} + on-screen bounds` + Page.bringToFront;
  embed rAF-tick counters in every timed probe. Store FPV jumps are NOT consumed while frozen.
- Welcome overlay eats screenshot #1 — canvas pointerdown dispatch dismisses.
- eyeM 1.7 inside a city block = black screen (inside building mass, BLD solid) — verify FPV
  visuals at eyeM ~40 or on a street.
- curl'ing ion: responses are gzip (--compressed); metadata ext payload has a 4-byte length
  prefix before the JSON.

## Open tails
U8 next (UPLIFT §2/U8) · T29 trigger FIRED — extraction slice (now incl. fovea glue ×3) ·
T32 planner Observer ceiling one-liner · owner: GLO-30 bake approval + Neo/C6/Esri calls.

Related: [[project/wip-2026-08-18-u5-loading]] (compose base) ·
[[project/wip-2026-08-17-u2-fpv-stability]] (governor park/LRU prerequisites) ·
UPLIFT_PLAN.md §2/U6+§2/U7+Appendix A.
