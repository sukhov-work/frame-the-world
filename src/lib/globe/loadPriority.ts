/**
 * UPLIFT U5 — closest-first progressive loading: the pure download-priority core.
 *
 * 3d-tiles-renderer 0.4.28 sorts each renderer's download/parse queues with a COMPARATOR
 * (`priorityCallback(a, b)` — "returning 1 means tile a is loaded first", TilesRendererBase.js:37).
 * With `loadAncestors = false` the library's own `unifiedPriorityCallback` already routes a
 * renderer's tiles onto its `distancePriorityCallback` (used → inFrustum → hasUnrenderableContent
 * → nearest → shallowest, TilesRendererBase.js:81-112) — closest-first at rest for free. What it
 * cannot do is know WHERE THE USER IS LOOKING: in FPV the streaming front should advance along
 * the look vector, not ring the eye. `makeClosestFirstComparator` reproduces the library ordering
 * exactly and replaces the raw distance term with an effective distance
 *
 *     effDist = distanceFromCamera / (1 + k · max(0, look · toTile))
 *
 * so a tile straight ahead outranks an equally-near tile behind (k = LOADING.fpvBiasK; with the
 * aim inactive the division is skipped and the ordering is byte-identical to the library's).
 * Everything three-dependent is INJECTED (`getCenter` reads the tile bounding-sphere centre;
 * `now()` clocks the latency probe) so this module stays pure math + state — vitest twins run
 * without a GL context. Scene-side wiring: scene/tilePriority.ts (adapter) + StylizedTiles
 * (per-frame aim refresh in stepLoadAim; probes on tile-download-start → load-model).
 */

/** Mutable aim state shared between the per-frame update loop (writer) and the queue
 *  comparators (readers). Plain fields — no three types — refreshed once per frame; `epoch`
 *  stamps the per-tile effective-distance cache so each tile pays the dot product at most once
 *  per frame no matter how many comparisons the sort makes. */
export interface LoadAim {
  /** Bias on? (fpvActive && k > 0 — orbit/2D keep pure library ordering.) */
  active: boolean;
  /** Bias strength: effDist divides by (1 + k·dot). 0 = pure distance. */
  k: number;
  /** Camera eye (world/ECEF metres). */
  eye: { x: number; y: number; z: number };
  /** Camera look direction (unit, world). */
  fwd: { x: number; y: number; z: number };
  /** Bumped once per frame — invalidates every tile's cached effDist. */
  epoch: number;
}

export function makeLoadAim(): LoadAim {
  return {
    active: false,
    k: 0,
    eye: { x: 0, y: 0, z: 0 },
    fwd: { x: 0, y: 0, z: 1 },
    epoch: 0,
  };
}

/** Duck-typed 3d-tiles-renderer Tile — the exact fields the 0.4.28 comparators read
 *  (traversal/internal split; the pre-0.4 `__dunder` fields no longer exist). `priority` is the
 *  library's own escape hatch: non-tile queue items (plugin work) carry it and must win/lose on
 *  it alone (unifiedPriorityCallback:155-166). The cache fields are ours, stamped by epoch. */
export interface PriorityTile {
  priority?: number;
  traversal?: {
    used: boolean;
    inFrustum: boolean;
    distanceFromCamera: number;
  };
  internal?: {
    hasUnrenderableContent: boolean;
    depthFromRenderedParent: number;
  };
  __ftwEffDist?: number;
  __ftwEffEpoch?: number;
}

/** Reads a tile's bounding-sphere centre into `out` (world metres); false = no volume yet
 *  (external-tileset stubs) → the comparator falls back to the raw distance for that tile. */
export type TileCenterReader = (tile: PriorityTile, out: { x: number; y: number; z: number }) => boolean;

const _center = { x: 0, y: 0, z: 0 };

/** The biased distance term, cached per (tile, epoch). Falls back to the raw library distance
 *  whenever the aim is inactive, the tile has no readable centre, or the tile IS the eye. */
export function effectiveDistance(tile: PriorityTile, aim: LoadAim, getCenter: TileCenterReader): number {
  const raw = tile.traversal ? tile.traversal.distanceFromCamera : Infinity;
  if (!aim.active || aim.k <= 0) return raw;
  if (tile.__ftwEffEpoch === aim.epoch && tile.__ftwEffDist !== undefined) return tile.__ftwEffDist;

  let eff = raw;
  if (getCenter(tile, _center)) {
    const dx = _center.x - aim.eye.x;
    const dy = _center.y - aim.eye.y;
    const dz = _center.z - aim.eye.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0) {
      const dot = (dx * aim.fwd.x + dy * aim.fwd.y + dz * aim.fwd.z) / len;
      if (dot > 0) eff = raw / (1 + aim.k * dot);
    }
  }
  tile.__ftwEffDist = eff;
  tile.__ftwEffEpoch = aim.epoch;
  return eff;
}

/**
 * The download-queue comparator installed on buildings + enriched (scene modules, behind
 * `LOADING.closestFirst`). Mirrors `distancePriorityCallback` term-for-term — used first,
 * in-frustum first, external tilesets first, nearest first, shallowest first — with the
 * distance term swapped for `effectiveDistance`. The parse queue keeps the library's unified
 * callback: with `loadAncestors=false` it already routes these renderers distance-first, its
 * backlog is short (maxJobs 5), and the bias matters most at the network edge. NOTE
 * processNodeQueue reads THIS callback dynamically for parent comparisons
 * (TilesRendererBase.js:473) — the guards keep it total on any item mix.
 */
export function makeClosestFirstComparator(
  aim: LoadAim,
  getCenter: TileCenterReader,
): (a: PriorityTile, b: PriorityTile) => number {
  return (a, b) => {
    // Library contract (unifiedPriorityCallback): explicit numeric priority wins outright —
    // lower value sorts first; a missing priority is Infinity.
    const ap = a.priority ?? Infinity;
    const bp = b.priority ?? Infinity;
    if (ap !== bp) return ap > bp ? 1 : -1;
    if (!a.traversal || !b.traversal || !a.internal || !b.internal) return 0;

    if (a.traversal.used !== b.traversal.used) return a.traversal.used ? 1 : -1;
    if (a.traversal.inFrustum !== b.traversal.inFrustum) return a.traversal.inFrustum ? 1 : -1;
    if (a.internal.hasUnrenderableContent !== b.internal.hasUnrenderableContent) {
      return a.internal.hasUnrenderableContent ? 1 : -1;
    }

    const ad = effectiveDistance(a, aim, getCenter);
    const bd = effectiveDistance(b, aim, getCenter);
    if (ad !== bd) return ad > bd ? -1 : 1; // nearer (biased) loads first

    if (a.internal.depthFromRenderedParent !== b.internal.depthFromRenderedParent) {
      return a.internal.depthFromRenderedParent > b.internal.depthFromRenderedParent ? -1 : 1;
    }
    return 0;
  };
}

/** One tile's in-flight latency record + the aggregate snapshot the DEV seam exposes. */
interface LatencySnapshot {
  /** Completed download→model cycles since attach. */
  n: number;
  meanMs: number;
  maxMs: number;
  /** The most recent completions (ring tail, newest last). */
  recent: number[];
  /** Downloads started but not yet completed/failed. */
  pending: number;
  /** ms from the last `mark()` to the FIRST completion after it (the time-to-first-tile
   *  measurement for a scripted teleport/FPV entry); null until that completion lands. */
  firstAfterMarkMs: number | null;
}

export interface TileLatencyProbe {
  /** 'tile-download-start' — the network fetch was scheduled. */
  start(tile: object): void;
  /** 'load-model' — the tile's scene finished parsing (dt = full download+parse latency). */
  end(tile: object): void;
  /** 'load-error' / dispose — forget the in-flight entry. */
  cancel(tile: object): void;
  /** Reset the time-to-first clock (call, then teleport, then read firstAfterMarkMs). */
  mark(): void;
  snapshot(): LatencySnapshot;
}

/** In-flight entries are capped: a burst of failed/aborted downloads that never see a paired
 *  event must not grow the map unbounded (oldest entry evicted first). */
const MAX_PENDING = 512;

/** Per-renderer download→model latency probe (UPLIFT U5 instrumentation). `now` is injected
 *  (performance.now in the scene; a fake clock in tests). Ring holds the last `ringCap` dts. */
export function makeTileLatencyProbe(now: () => number, ringCap: number): TileLatencyProbe {
  const starts = new Map<object, number>();
  const ring: number[] = [];
  let n = 0;
  let totalMs = 0;
  let maxMs = 0;
  let markT: number | null = null;
  let firstAfterMarkMs: number | null = null;

  return {
    start(tile) {
      if (starts.size >= MAX_PENDING) {
        const oldest = starts.keys().next().value;
        if (oldest !== undefined) starts.delete(oldest);
      }
      starts.set(tile, now());
    },
    end(tile) {
      const t0 = starts.get(tile);
      if (t0 === undefined) return;
      starts.delete(tile);
      const t1 = now();
      const dt = t1 - t0;
      n++;
      totalMs += dt;
      if (dt > maxMs) maxMs = dt;
      ring.push(dt);
      if (ring.length > ringCap) ring.shift();
      if (markT !== null && firstAfterMarkMs === null) firstAfterMarkMs = t1 - markT;
    },
    cancel(tile) {
      starts.delete(tile);
    },
    mark() {
      markT = now();
      firstAfterMarkMs = null;
    },
    snapshot() {
      return {
        n,
        meanMs: n > 0 ? totalMs / n : 0,
        maxMs,
        recent: ring.slice(-8),
        pending: starts.size,
        firstAfterMarkMs,
      };
    },
  };
}
