/**
 * VIRTUAL SPLIT GUARD — a fence around `ImageOverlayPlugin.expandVirtualChildren`.
 *
 * The overlay plugin (3d-tiles-renderer 0.4.28) splits every LEAF terrain tile into virtual
 * children down to the imagery's max zoom so a 512² composite can follow the lens: each level
 * clones the tile's scene and runs `GeometryClipper` over it on the MAIN THREAD, synchronously,
 * inside `processTileModel`. Healthy splits are cheap (Everest zoom, 2026-09-10b: depth 0
 * ~2.3 ms avg over 2,564 triangles, depth 4 ~0 ms over 31) and the triangle count QUARTERS per
 * level — the plugin is doing exactly what it should.
 *
 * Twice in five runs at `f=27.989704,86.927075,312.4,217.3,-5.1,6.8` (ULTRA) it did not: after
 * convergence a further wave of splits arrived whose cost DOUBLED per call — rAF gaps of 0.7 s,
 * 2.8, 5.9, 11.7, 23.6, 48, 95 s (`probe-reset.mjs`; the CPU profile of one such window is 50 s
 * of `getClippedData` / `splitTriangle` / `getVertexHash` in 59 s). A split whose child carries
 * more triangles than its parent cannot be a subdivision, and the next level clips that
 * exploded geometry again. The library has no guard; this is it.
 *
 * Three fences, all skipping the split (the tile keeps its own single composite — the look of a
 * `enableTileSplitting: false` leaf, which is the shipped behaviour past Esri's max zoom):
 *   · DEPTH — more than `maxDepth` virtual levels below the real tile;
 *   · GROWTH — the virtual tile carries more triangles than the parent it was cut from AND more
 *     than `growthMinTri` (a cut adds a few triangles along its edge, so tiny tiles legitimately
 *     "grow"; refusing those cost the Dnipro street pose two composite zoom levels, 19 → 17);
 *   · TIME — an ancestor's own split took longer than `maxMs`, so this subtree is already the
 *     expensive kind; nothing below it splits again.
 *
 * Fail-soft: a plugin without the method installs nothing. Both shells (the phones run the same
 * plugin on a slower main thread — a runaway there is a jetsam). No pixel changes unless a fence
 * trips, and a tripped fence changes composite RESOLUTION at that spot, never colour.
 */

export interface SplitGuardOpts {
  /** Virtual levels below a real tile beyond which no split happens. */
  maxDepth: number;
  /** A split slower than this (ms) caps its whole subtree. */
  maxMs: number;
  /** The growth fence only bites above this many triangles: a clip legitimately ADDS a few
   *  triangles along the cut, so a 20-triangle child can outgrow its 12-triangle parent and
   *  still be a subdivision; the runaway starts in the tens of thousands (0.7 s ≈ 100 k). */
  growthMinTri: number;
}

export interface SplitGuardStats {
  calls: number;
  /** Splits refused: by depth, by growth (child > parent triangles), by a slow ancestor. */
  depthCapped: number;
  growthCapped: number;
  timeCapped: number;
  /** The slowest single split seen (ms) and the summed split time. */
  worstMs: number;
  totalMs: number;
}

interface TileLike {
  parent?: TileLike | null;
  internal?: { isVirtual?: boolean };
  __ftwSplitTri?: number;
  __ftwSplitSlow?: boolean;
}

interface SceneLike {
  traverse(cb: (c: { isMesh?: boolean; geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } } }) => void): void;
}

interface PluginLike {
  expandVirtualChildren?: (scene: SceneLike, tile: TileLike) => unknown;
}

/** Triangles across every mesh of a tile scene. Exported for the tests. */
export function sceneTriangles(scene: SceneLike): number {
  let tris = 0;
  scene.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    const g = c.geometry;
    tris += g.index ? g.index.count / 3 : (g.attributes?.position?.count ?? 0) / 3;
  });
  return tris;
}

/** Virtual depth (levels below the nearest real tile) and whether a slow ancestor caps it. */
export function virtualLineage(tile: TileLike): { depth: number; slowAncestor: boolean; parentTri: number | null } {
  let depth = 0;
  let slowAncestor = false;
  let parentTri: number | null = null;
  let p: TileLike | null | undefined = tile.parent;
  let first = true;
  while (p) {
    if (first) {
      parentTri = typeof p.__ftwSplitTri === "number" ? p.__ftwSplitTri : null;
      first = false;
    }
    if (p.__ftwSplitSlow) slowAncestor = true;
    if (!p.internal?.isVirtual) break;
    depth++;
    p = p.parent;
  }
  // `tile` itself is virtual when its parent chain had at least one virtual — count it.
  if (tile.internal?.isVirtual) depth++;
  return { depth, slowAncestor, parentTri };
}

/**
 * The pure verdict: `null` = split, else the fence that refused it. Exported for the tests.
 */
export function splitVerdict(
  lineage: { depth: number; slowAncestor: boolean; parentTri: number | null },
  tris: number,
  opts: SplitGuardOpts,
): "depth" | "growth" | "time" | null {
  if (lineage.slowAncestor) return "time";
  if (lineage.depth > opts.maxDepth) return "depth";
  if (lineage.parentTri !== null && tris > lineage.parentTri && tris > opts.growthMinTri) return "growth";
  return null;
}

export function installVirtualSplitGuard(
  plugin: PluginLike,
  opts: SplitGuardOpts,
): { stats: SplitGuardStats; installed: boolean; dispose(): void } {
  const stats: SplitGuardStats = { calls: 0, depthCapped: 0, growthCapped: 0, timeCapped: 0, worstMs: 0, totalMs: 0 };
  const expand0 = plugin.expandVirtualChildren;
  if (typeof expand0 !== "function") return { stats, installed: false, dispose() {} };
  plugin.expandVirtualChildren = function (this: unknown, scene: SceneLike, tile: TileLike) {
    stats.calls++;
    const tris = sceneTriangles(scene);
    tile.__ftwSplitTri = tris;
    const verdict = splitVerdict(virtualLineage(tile), tris, opts);
    if (verdict === "depth") {
      stats.depthCapped++;
      return undefined;
    }
    if (verdict === "growth") {
      stats.growthCapped++;
      return undefined;
    }
    if (verdict === "time") {
      stats.timeCapped++;
      return undefined;
    }
    const t0 = performance.now();
    try {
      return expand0.call(this, scene, tile);
    } finally {
      const dt = performance.now() - t0;
      stats.totalMs += dt;
      if (dt > stats.worstMs) stats.worstMs = dt;
      if (dt > opts.maxMs) tile.__ftwSplitSlow = true;
    }
  };
  return {
    stats,
    installed: true,
    dispose() {
      plugin.expandVirtualChildren = expand0;
    },
  };
}
