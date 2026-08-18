# wip 2026-08-18 — UPLIFT U5 SHIPPED: closest-first progressive loading (owner point 7)

## What shipped (DECISIONS 2026-08-18g-u5-loading; /frame + investigate-design-v3 implement mode)
Order + concurrency ONLY — errorTargets untouched; at-rest scene browser-proven TILE-IDENTICAL
(A/B legs: 31/39 buildings vis/cache · 107/107 enriched · 314 ground · pixel-equivalent shots).
- **Closest-first**: `loadAncestors=false` on BUILDINGS + ENRICHED (`LOADING.closestFirst`
  per-renderer flags) — 0.4.28 source-verified: that alone flips the renderer onto
  `distancePriorityCallback` (optimizedLoadStrategy defaults true, TilesRendererBase.js:172-182);
  ancestors stop downloading as stand-ins (buildings pop in at target SSE — intended). GROUND
  excluded BY CONSTRUCTION (heightAt seating + reveal need the coarse stand-in).
- **FPV look bias**: custom download comparator (pure `lib/globe/loadPriority.ts`) mirrors
  distancePriorityCallback term-for-term, distance swapped for
  `effDist = d/(1+k·max(0,look·toTile))`; k=`LOADING.fpvBiasK` 1.5 gated on fpvActive; k=0 or
  orbit/2D = byte-identical library ordering; per-tile memo stamped by `aim.epoch` (bumped in
  stepViewFocus where `_camFwd` is fresh — no new step). Scene adapter `scene/tilePriority.ts`
  (scratch THREE.Sphere; `engineData?.boundingVolume ?? cached?.boundingVolume` reach).
- **Queue caps**: `queueCapsForTier` (quality.ts, null-on-high like the LRU rule) → each module's
  `setQualityTier(err, lru, caps)` third arg; captured defaults restored on high (25 dl/5 parse),
  mid 12/3, low 8/2. Parse queue is MAIN-THREAD glb decode — the mobile hitch lever.
- **Instrumentation**: governor `emaMs()` + `hitchCount()` (raw dt > `QUALITY.governor.hitchMs`
  50 ms; EMA was closure-private) · `makeTileLatencyProbe` per renderer (tile-download-start →
  load-model; load-error cancels; MAX_PENDING 512 eviction; injected clock) · DEV
  `__globe.u5()` (flags/aim/queue depth+jobs+maxJobs/stats/lat) + `u5Mark()` time-to-first window.

## Library facts (0.4.28, installed-source-verified — reuse these, don't re-scout)
- Comparator contract: items.sort(cb) then POP — **return 1 ⇒ a runs FIRST**.
- Tile fields: `tile.traversal.{used,inFrustum,distanceFromCamera,error}` +
  `tile.internal.{hasUnrenderableContent,depthFromRenderedParent,renderer}` — the old
  `__dunder` fields DO NOT EXIST in 0.4.28.
- `unifiedPriorityCallback` routes PER-ITEM on `renderer.optimizedLoadStrategy && !loadAncestors`
  → parse queue auto-becomes distance-first once loadAncestors=false (only download gets our cb).
- `processNodeQueue` reads `downloadQueue.priorityCallback` DYNAMICALLY for parent comparisons —
  custom cb must stay total on non-tile items (priority ?? Infinity guard first, like unified).
- Queues are PER-INSTANCE (constructed in TilesRendererBase ctor) — per-renderer caps independent.
- `maxJobs`/`priorityCallback` = plain property writes, runtime-safe (ImageOverlayPlugin precedent).
- Events: `tile-download-start` {tile,url} · `load-model` {scene,tile,url} · `load-error`
  {tile,error,url}. Stats: `stats.{queued,downloading,parsing,inCache,visible,…}`;
  `queue.currJobs`/`queue.items` are UNTYPED (d.ts omits) — narrow-cast in DEV seams only.

## Measured (M3 Pro, dev-local WARM cache — weak evidence; cold-network rides T1)
Buildings initial stream mean 376 ms / max 540 (leg A 428/677); enriched tail ~1.9 s (A ~2.17 s);
ground unchanged (by design). 4 s scripted FPV walk: 0 hitches BOTH legs, ~46-48 fps, EMA ~21 ms.
/m: 2D boot buildings-detached intact, FPV aim active k=1.5, EMA 8.3 ms. Tier round-trip
25/5→12/3→8/2→25/5 live-verified on all three renderers; U2 LRU pair intact (mid 256/192 MB).
FPV exit → aim.active false. Local stream settles in ~2 s → time-to-first/queue-order observables
SATURATE locally; ordering is locked by the 21-test loadPriority twin + 6 quality tests instead.

## Files
`lib/globe/loadPriority.ts` (NEW) · `lib/globe/quality.ts` (QueueCaps/queueCapsForTier/emaMs/
hitchCount/hitchMs) · `components/globe/tuning.ts` (LOADING block + governor.hitchMs) ·
`scene/tilePriority.ts` (NEW) · `scene/{buildings,enrichedBuildings,imageryGround}.ts`
(loadAim opt, flags, caps in setQualityTier) · `StylizedTiles.ts` (loadAim + probes + u5 seam +
applyQualityTier caps) · tests `test/lib/globe/loadPriority.test.ts` (NEW) + quality.test.ts.
GlobeCanvas untouched (governor object already on `__quality`; hitchMs flows via QUALITY.governor).

## TRAPS
- **A STALE Playwright Chrome (profile ~/Playwright_Chrome_data) from a prior session can OWN
  port 9222 without the occlusion flags** — a fresh flagged launch silently fails to bind, the
  MCP attaches to the buried stale window, rAF freezes (U2 trap, new coat). `pkill -f
  Playwright_Chrome_data` + relaunch WITH flags; verify with `ps` who owns 9222.
- The latency probe's `pending` can hold stale entries (signal-aborted downloads dispatch no
  load-error) — bounded by MAX_PENDING 512, harmless, but don't read `pending` as "in flight now".
- Playwright evaluate starts only POST-load — the dev-local initial stream (~2 s) finishes
  before any sampler attaches; construction-relative metrics must come from the in-page probes.

## Open tails
- U6 foveation next (UPLIFT_PLAN §2/U6): LoadRegionPlugin RayRegion along FPV look + SphereRegion
  at eye, per-tier radii/error in QUALITY.tiers, fold with U5's bias.
- T1 real-device: mid/low caps + parse-hitch relief + fpvBiasK feel + cold-network closest-first
  visual (the one thing local verification structurally cannot show).
- Taste: fpvBiasK 1.5 and cap values 12/3 · 8/2 are first-guess knobs — A/B on device.

Related: [[project/wip-2026-08-18-u4-aim-cones]] · [[project/wip-2026-08-17-u2-fpv-stability]]
(LRU floor + governor gate prerequisites) · UPLIFT_PLAN.md §2/U5 + §1.4.
