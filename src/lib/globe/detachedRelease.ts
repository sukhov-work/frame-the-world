/**
 * T123 lever (a) (owner ruling 2026-09-09b) — RELEASE the tile caches of a DETACHED tileset.
 *
 * The mechanism (MEASUREMENTS §30.2): on `/m` the 2D map DETACHES the enriched + OSM-buildings
 * tilesets (`setActive(false)` removes the group from the scene and `update()` returns early),
 * and a TilesRenderer that is never `update()`d never runs its LRU — every cell of every FPV spot
 * visited stays resident under a byte cap (128 / 48 MB lean) the phone cannot afford to reach:
 * the stress leg's `renderer.info.memory.geometries` climbed 395 → 795 across four spots with the
 * caches FLAT under their caps, and WebContent died at the 2 GB per-process ceiling in cycle 4.
 * Nothing reads a detached cache until the next FPV / 3D attach, which re-streams (the browser's
 * HTTP cache serves most of it; the enriched seat cache keeps the banked seats, so the re-stream
 * lands where it left).
 *
 * Two pure pieces, so vitest pins them without a renderer:
 *
 *   · `drainLruCache(cache)` — the recipe the twin's forced eviction used (283 → 137 geometries):
 *     mark everything unused, drop the four caps to ZERO for one synchronous
 *     `unloadUnusedContent()` (with all caps at zero its first loop evicts EVERY item — bytes or
 *     not, loaded or in flight; an in-flight tile's abort controller fires inside the unload
 *     callback and the library's own post-download / post-parse `signal.aborted` checks keep it
 *     from ever re-entering), then restore the caps VERBATIM so the running quality tier's band
 *     is untouched. Whole-cache drains never schedule the library's rerun frame (nothing is left
 *     to evict), so the restore cannot race a deferred eviction.
 *
 *   · `stepDetachedRelease(state, attached, nowMs, cacheItems, policy)` — the once-per-detach
 *     decision the orchestrator's gate step asks every frame: a release fires only while
 *     detached, only after `graceMs` (past the 2.2 s FPV-exit flight — the disposal lands on the
 *     resting map, never inside the flight's frames), only while the caches hold something, and
 *     at most `maxPerPeriod` times per detach (a guard against a pathological every-frame drain
 *     should a cache ever refuse to empty). Re-attaching resets the period.
 *
 * `/m`-only by construction: the orchestrator gates the call on `isMobileShell`; the desktop never
 * detaches through this path (BLD off keeps its cache, as before) and stays byte-identical.
 */

/** The structural slice of 3d-tiles-renderer's `LRUCache` (0.4.28) the drain touches. */
export interface DrainableLruCache {
  minSize: number;
  maxSize: number;
  minBytesSize: number;
  maxBytesSize: number;
  cachedBytes: number;
  itemSet: { size: number };
  markAllUnused(): void;
  unloadUnusedContent(): void;
}

export interface DrainResult {
  /** Items in the cache before the drain (loaded, loading and queued alike). */
  items: number;
  /** Byte-accounted content before the drain. */
  bytes: number;
  /** Items still held after the drain — 0 on every drain the unit tier has seen. */
  left: number;
}

/**
 * Evict EVERYTHING the cache holds in one synchronous call and put its caps back exactly as
 * they were. Safe on an empty cache (a no-op that still reports zeros).
 */
export function drainLruCache(cache: DrainableLruCache): DrainResult {
  const items = cache.itemSet.size;
  const bytes = cache.cachedBytes;
  if (items === 0) return { items: 0, bytes, left: 0 };
  const { minSize, maxSize, minBytesSize, maxBytesSize } = cache;
  cache.markAllUnused();
  cache.minSize = 0;
  cache.maxSize = 0;
  cache.minBytesSize = 0;
  cache.maxBytesSize = 0;
  try {
    cache.unloadUnusedContent();
  } finally {
    cache.minSize = minSize;
    cache.maxSize = maxSize;
    cache.minBytesSize = minBytesSize;
    cache.maxBytesSize = maxBytesSize;
  }
  return { items, bytes, left: cache.itemSet.size };
}

export interface DetachedReleasePolicy {
  /** The kill switch (`MOBILE2D.releaseDetachedTiles`). */
  enabled: boolean;
  /** Frames after the detach wait this long before the first drain (`MOBILE2D.releaseDetachedGraceMs`). */
  graceMs: number;
  /** Drains allowed per detach period — the every-frame guard. */
  maxPerPeriod: number;
}

export interface DetachedReleaseState {
  /** `performance.now()` of the frame the tilesets detached; null while attached. */
  detachedAtMs: number | null;
  /** Drains fired in the current detach period. */
  releases: number;
}

export const createDetachedReleaseState = (): DetachedReleaseState => ({
  detachedAtMs: null,
  releases: 0,
});

/**
 * One frame of the decision. Returns true when the caller must drain NOW (and counts it).
 * `cacheItems` is the summed item count of the detached caches — a drain with nothing to drain
 * is never asked for, so the boot-time detach (empty caches) costs nothing.
 */
export function stepDetachedRelease(
  state: DetachedReleaseState,
  attached: boolean,
  nowMs: number,
  cacheItems: number,
  policy: DetachedReleasePolicy,
): boolean {
  if (attached) {
    state.detachedAtMs = null;
    state.releases = 0;
    return false;
  }
  if (state.detachedAtMs === null) {
    state.detachedAtMs = nowMs;
    state.releases = 0;
  }
  if (!policy.enabled) return false;
  if (nowMs - state.detachedAtMs < policy.graceMs) return false;
  if (cacheItems <= 0) return false;
  if (state.releases >= policy.maxPerPeriod) return false;
  state.releases++;
  return true;
}
