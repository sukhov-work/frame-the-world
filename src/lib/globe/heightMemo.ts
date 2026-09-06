/**
 * RC11 (audit slice S16) — the terrain-height memo that funds every seat budget in the app.
 *
 * `heightAt` is a down-ray raycast through the whole loaded terrain group. Measured on a warm
 * Dnipro FPV frame (RC0's M6): **0.018–0.067 ms per sample**, at a derived 30–45 samples per
 * frame steady state across the enriched seat sweep, the tree sweep, the frustum, PLAN, BEST SPOT
 * and `tempPinPoint` — so between 0.5 and 3 ms of every frame is spent re-answering questions the
 * renderer already answered.
 *
 * And it re-answers the SAME ones: the seat sweep is a round-robin over a fixed set of building
 * footprints, so once the cursor wraps it re-samples identical coordinates forever. The correct
 * cache is therefore not a spatial approximation but an EXACT memo — no quantisation, no
 * interpolation, no new error term anywhere near the one-vertical-authority contract.
 *
 * `null` (no tile covers this spot yet) is deliberately NOT memoised: it is the answer that most
 * wants retrying, and caching it would freeze a seat until the next tile load.
 *
 * ── T77 lever 6 (2026-09-06): invalidate PER TILE, not city-wide ─────────────────────────────
 * The first version keyed the memo on `(terrainEpoch, lat, lon)` and dropped the WHOLE map every
 * time the epoch moved. `terrainEpoch` counts finished terrain tile loads city-wide, and the
 * browser measurement (`rendering/MEASUREMENTS_2026-09-05.md` §9) put those at **1.9–4.8 per
 * second** during ordinary streaming, with 406 in a single leg. So the memo was being emptied
 * several times a second and the seat sweep re-raycast the entire city forever — the memo was
 * paying for itself only in the gaps between tile arrivals.
 *
 * The fix is spatial. A terrain tile changes the ground under ITS OWN region and nowhere else, so
 * only the entries inside that region are stale. Entries are additionally indexed into a coarse
 * bucket grid (`bucketDeg`), and `invalidateRegionRad` drops the buckets a tile's region covers.
 * The KEY is unchanged — still the exact `"lat,lon"` string — so the memo's defining property (no
 * quantisation, a hit is exactly a raycast) survives untouched; the grid is an INDEX over those
 * keys, not a re-keying of them, and it is deliberately coarser than the tiles that drive it
 * because over-invalidation costs one raycast while under-invalidation is a wrong seat.
 *
 * Two backstops guard the honesty of that trade:
 *  • a region wider than `maxBuckets` falls back to a whole-map drop (a ROOT tile's region is a
 *    hemisphere — walking its buckets would be ~10^10 iterations to delete a few thousand keys);
 *  • `maxAgeMs` drops the whole map periodically regardless, so a terrain-removal path we failed
 *    to hook degrades into a once-a-minute refill sweep rather than a permanently wrong height.
 *
 * `epoch` is still tracked and published (`noteEpoch`) because the DBG HUD and
 * `verify-rendering-charter.mjs` report it — but it no longer INVALIDATES anything.
 */

export interface HeightMemoStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
  epoch: number;
  /** Every drop event, whatever its cause: `regionInvalidations + fullDrops`. Kept as the total
   *  so existing readers (HUD row, charter note) keep meaning "how often did the memo lose work". */
  invalidations: number;
  /** T77 lever 6 — spatial (per-tile) invalidations that dropped at least one bucket. */
  regionInvalidations: number;
  /** T77 lever 6 — buckets removed by those, i.e. how narrow the spatial path actually is. */
  bucketsDropped: number;
  /** T77 lever 6 — whole-map drops NOT caused by capacity: a region too wide for the bucket walk,
   *  or the `maxAgeMs` backstop. A number climbing here says the spatial path is not engaging. */
  fullDrops: number;
  /** Times the memo was dropped because it hit its capacity. */
  overflows: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * An exact (lat, lon) → height memo with a coarse bucket index for per-tile invalidation. Not an
 * LRU: on overflow the whole map is dropped, which costs one refill sweep and keeps the hot path
 * to a single `Map.get` with no bookkeeping. The working set is a city's footprints — tens of
 * thousands, not millions — so overflow is the unusual case, and `overflows` is published so a
 * wrong capacity shows up as a number rather than as a mysterious frame cost.
 */
export class HeightMemo {
  private map = new Map<string, number>();
  /** T77 slice B 4d — the tile DEPTH that answered each memoised height (the 3D-Tiles traversal
   *  depth `terrainPick.stampTileDepth` writes on every terrain mesh). Kept beside the height so a
   *  seat consumer can refuse a SHALLOWER answer than the one it holds: under LRU churn at a
   *  Dnipro FPV eye the fine tile is evicted and re-fetched all day, and every eviction used to
   *  hand the sweep the coarse parent's height — tens of metres off — as if it were news. */
  private depths = new Map<string, number>();
  /** `"row|col"` → the exact keys living in that bucket. The ONLY reason this exists is so a
   *  region invalidation can find the keys to delete without scanning the whole map. */
  private buckets = new Map<string, Set<string>>();
  private epoch = -1;
  private hits = 0;
  private misses = 0;
  private regionInvalidations = 0;
  private bucketsDropped = 0;
  private fullDrops = 0;
  private overflows = 0;
  private lastFullDropMs: number;

  /**
   * @param capacity     entries held before a wholesale drop (`GROUND.heightMemoCapacity`).
   * @param bucketDeg    bucket size in degrees for the spatial index (`heightMemoBucketDeg`).
   * @param maxAgeMs     whole-map staleness backstop (`heightMemoMaxAgeMs`); ≤ 0 disables it.
   * @param now          injectable clock — the backstop is the one thing here that is not a pure
   *                     function of the calls made to it, so tests drive it explicitly rather than
   *                     sleeping.
   */
  constructor(
    private readonly capacity: number,
    private readonly bucketDeg: number,
    private readonly maxAgeMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.lastFullDropMs = now();
  }

  private static key(latDeg: number, lonDeg: number): string {
    // Full float64 identity: the seat sweep asks for the exact same footprint coordinates every
    // time round, so nothing needs rounding — and rounding would import an error the seat
    // contract has no budget for.
    return `${latDeg},${lonDeg}`;
  }

  /** The bucket a coordinate falls in. `Math.floor` puts a value exactly ON a boundary in the
   *  UPPER bucket, and `invalidateRegionRad` uses the same floor on both region edges — so an
   *  entry on a boundary is dropped by the tile on whose side the floor puts it, and by the
   *  neighbour too whenever that neighbour's edge floors onto the same row/col. Erring toward
   *  dropping MORE is the safe direction. */
  private bucketKey(latDeg: number, lonDeg: number): string {
    return `${Math.floor(latDeg / this.bucketDeg)}|${Math.floor(lonDeg / this.bucketDeg)}`;
  }

  /** Look up. Returns `undefined` on a miss. */
  get(latDeg: number, lonDeg: number): number | undefined {
    const v = this.map.get(HeightMemo.key(latDeg, lonDeg));
    if (v === undefined) this.misses++;
    else this.hits++;
    return v;
  }

  /** T77 4d — the tile depth stored beside a memoised height; `-1` when unknown or on a miss. */
  getDepth(latDeg: number, lonDeg: number): number {
    return this.depths.get(HeightMemo.key(latDeg, lonDeg)) ?? -1;
  }

  /** Record a REAL height. `null` answers are never stored — see the header. */
  set(latDeg: number, lonDeg: number, value: number, depth = -1): void {
    this.expireIfStale();
    if (this.map.size >= this.capacity) {
      this.dropAll();
      this.overflows++;
    }
    const key = HeightMemo.key(latDeg, lonDeg);
    this.map.set(key, value);
    if (depth >= 0) this.depths.set(key, depth);
    else this.depths.delete(key);
    const bk = this.bucketKey(latDeg, lonDeg);
    const set = this.buckets.get(bk);
    if (set) set.add(key);
    else this.buckets.set(bk, new Set([key]));
  }

  /**
   * T77 lever 6 — drop only what a terrain tile actually changed.
   *
   * `region` is a 3D-Tiles geographic bounding volume `[west, south, east, north, minH, maxH]`
   * with the angles in **RADIANS** (`QuantizedMeshPlugin.js:359` builds it that way, and it is the
   * spec's own unit) — the conversion happens here, once, rather than at every call site.
   * A missing/short region is treated as "unknown extent" and drops nothing: the caller cannot
   * prove staleness, and the `maxAgeMs` backstop is what covers that case.
   *
   * Falls back to a whole-map drop when the region spans more than `maxBuckets` — see the
   * `heightMemoMaxInvalidateBuckets` tunable for why a hemisphere must not be walked.
   */
  invalidateRegionRad(region: readonly number[] | null | undefined, maxBuckets: number): void {
    this.expireIfStale();
    if (!region || region.length < 4) return;
    if (this.map.size === 0) return;
    const west = region[0] * RAD_TO_DEG;
    const south = region[1] * RAD_TO_DEG;
    const east = region[2] * RAD_TO_DEG;
    const north = region[3] * RAD_TO_DEG;
    if (!Number.isFinite(west + south + east + north)) return;
    const rowLo = Math.floor(Math.min(south, north) / this.bucketDeg);
    const rowHi = Math.floor(Math.max(south, north) / this.bucketDeg);
    const colLo = Math.floor(Math.min(west, east) / this.bucketDeg);
    const colHi = Math.floor(Math.max(west, east) / this.bucketDeg);
    const span = (rowHi - rowLo + 1) * (colHi - colLo + 1);
    if (!(span > 0) || span > maxBuckets) {
      this.dropAll();
      this.fullDrops++;
      return;
    }
    let dropped = 0;
    for (let row = rowLo; row <= rowHi; row++) {
      for (let col = colLo; col <= colHi; col++) {
        const bk = `${row}|${col}`;
        const set = this.buckets.get(bk);
        if (!set) continue;
        for (const key of set) {
          this.map.delete(key);
          this.depths.delete(key);
        }
        this.buckets.delete(bk);
        dropped++;
      }
    }
    if (dropped > 0) {
      this.regionInvalidations++;
      this.bucketsDropped += dropped;
    }
  }

  /** Record the streaming epoch for reporting. T77 lever 6: this NO LONGER invalidates — the
   *  epoch is a city-wide counter and dropping on it is exactly the waste the lever removes. It
   *  stays published because the DBG HUD and `verify-rendering-charter.mjs` print it. */
  noteEpoch(n: number): void {
    this.epoch = n;
  }

  /** The `maxAgeMs` backstop. Evaluated on writes and region invalidations only — both ride
   *  terrain churn, which is the only thing that can make an entry stale, and neither is the hot
   *  `get`. See the header for what it is insuring against. */
  private expireIfStale(): void {
    if (!(this.maxAgeMs > 0) || this.map.size === 0) return;
    const t = this.now();
    if (t - this.lastFullDropMs < this.maxAgeMs) return;
    this.dropAll();
    this.fullDrops++;
  }

  private dropAll(): void {
    this.map.clear();
    this.depths.clear();
    this.buckets.clear();
    this.lastFullDropMs = this.now();
  }

  stats(): HeightMemoStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(4) : 0,
      entries: this.map.size,
      epoch: this.epoch,
      invalidations: this.regionInvalidations + this.fullDrops,
      regionInvalidations: this.regionInvalidations,
      bucketsDropped: this.bucketsDropped,
      fullDrops: this.fullDrops,
      overflows: this.overflows,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.regionInvalidations = 0;
    this.bucketsDropped = 0;
    this.fullDrops = 0;
    this.overflows = 0;
  }

  clear(): void {
    this.dropAll();
    this.epoch = -1;
  }
}
