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
 * The invalidation signal already exists: `terrainEpoch` counts finished terrain tile loads and
 * was added next to `heightAt` for BEST SPOT. A memo keyed on (epoch, lat, lon) is exactly as
 * fresh as a raw sample — when the ground under you gets four times finer, the epoch moves and
 * every entry is dropped in one assignment.
 *
 * `null` (no tile covers this spot yet) is deliberately NOT memoised: it is the answer that most
 * wants retrying, and caching it would freeze a seat until the next tile load.
 */

export interface HeightMemoStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
  epoch: number;
  /** Times the whole memo was dropped because the terrain refined under it. */
  invalidations: number;
  /** Times the memo was dropped because it hit its capacity. */
  overflows: number;
}

/**
 * An exact (epoch, lat, lon) → height memo. Not an LRU: on overflow the whole map is dropped,
 * which costs one refill sweep and keeps the hot path to a single `Map.get` with no bookkeeping.
 * The working set is a city's footprints — thousands, not millions — so overflow is the unusual
 * case, and `overflows` is published so a wrong capacity shows up as a number rather than as a
 * mysterious frame cost.
 */
export class HeightMemo {
  private map = new Map<string, number>();
  private epoch = -1;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private overflows = 0;

  constructor(private readonly capacity: number) {}

  private static key(latDeg: number, lonDeg: number): string {
    // Full float64 identity: the seat sweep asks for the exact same footprint coordinates every
    // time round, so nothing needs rounding — and rounding would import an error the seat
    // contract has no budget for.
    return `${latDeg},${lonDeg}`;
  }

  /** Look up, honouring the terrain epoch. Returns `undefined` on a miss. */
  get(latDeg: number, lonDeg: number, epoch: number): number | undefined {
    if (epoch !== this.epoch) {
      if (this.map.size > 0) this.invalidations++;
      this.map.clear();
      this.epoch = epoch;
      this.misses++;
      return undefined;
    }
    const v = this.map.get(HeightMemo.key(latDeg, lonDeg));
    if (v === undefined) this.misses++;
    else this.hits++;
    return v;
  }

  /** Record a REAL height. `null` answers are never stored — see the header. */
  set(latDeg: number, lonDeg: number, epoch: number, value: number): void {
    if (epoch !== this.epoch) {
      if (this.map.size > 0) this.invalidations++;
      this.map.clear();
      this.epoch = epoch;
    }
    if (this.map.size >= this.capacity) {
      this.map.clear();
      this.overflows++;
    }
    this.map.set(HeightMemo.key(latDeg, lonDeg), value);
  }

  stats(): HeightMemoStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(4) : 0,
      entries: this.map.size,
      epoch: this.epoch,
      invalidations: this.invalidations,
      overflows: this.overflows,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    this.overflows = 0;
  }

  clear(): void {
    this.map.clear();
    this.epoch = -1;
  }
}
