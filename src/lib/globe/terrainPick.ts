import type * as THREE from "three";

/**
 * RC6 (audit gap #2 / slice S3) — choosing the RIGHT terrain hit, not the nearest one.
 *
 * Both terrain samplers — `imageryGround.heightAt` (which seats buildings, the photo frustum and
 * the FPV eye) and `StylizedTiles.pickGround` (which places pins) — took `intersectObjects(...)[0]`,
 * the hit CLOSEST along the ray. That is the wrong selector while tiles are streaming.
 *
 * `TilesFadePlugin` keeps a coarse parent in the scene, drawn and raycastable, for the whole
 * `GROUND.fadeDurationMs` crossfade after its finer children arrive. A coarse quad interpolates
 * across relief, so over any slope it sits ABOVE or BELOW the fine mesh by metres — and where it
 * sits above, it is nearer the ray origin and `[0]` picks it. The seat is then wrong by the LOD
 * error for as long as the fade lasts, and silently right again afterwards, which is exactly the
 * "heights that settle" symptom the fidelity audit chased.
 *
 * The fix is to select on TILE DEPTH instead: among all hits, take the one from the deepest tile
 * in the hierarchy (finest LOD), breaking ties on distance. Depth is stamped onto each mesh at
 * `load-model` from `tile.internal.depth`; a mesh with no stamp (an unexpected object in the
 * group) sorts as depth −1 and can only win if nothing else hit.
 *
 * `chooseTerrainHit` is pure and unit-tested; `TERRAIN_DEPTH_KEY` is the one name both the stamp
 * and the selector agree on.
 */

/** `userData` key carrying the tile's hierarchy depth. One name, two call sites. */
export const TERRAIN_DEPTH_KEY = "ftwTileDepth";

export interface DepthStamped {
  object: { userData?: Record<string, unknown> };
  distance: number;
}

/** The tile depth stamped on a hit's object, or −1 when it carries none. */
export function hitDepth(hit: DepthStamped): number {
  const v = hit.object?.userData?.[TERRAIN_DEPTH_KEY];
  return typeof v === "number" ? v : -1;
}

/**
 * Pick the hit from the deepest (finest) tile; ties go to the nearest along the ray.
 *
 * Returns `null` for an empty list. Never mutates the input — three reuses its intersection
 * array between raycasts, and sorting it in place would reorder a buffer the caller may still
 * be reading.
 */
export function chooseTerrainHit<T extends DepthStamped>(hits: readonly T[]): T | null {
  let best: T | null = null;
  let bestDepth = -Infinity;
  for (const h of hits) {
    const d = hitDepth(h);
    if (d > bestDepth || (d === bestDepth && best !== null && h.distance < best.distance)) {
      best = h;
      bestDepth = d;
    }
  }
  return best;
}

/**
 * How often the nearest hit and the deepest hit DISAGREE — audit measurement M7 ("how often does
 * the fading parent actually win"), which was mechanism-proven but magnitude-unverified. Counted
 * on the live sampler and published through `__globe.terrainPickStats()`.
 */
export class TerrainPickStats {
  samples = 0;
  /** Samples where the deepest hit was not the nearest one — the parent WOULD have won. */
  parentWins = 0;
  /** Largest height difference (m) between what `[0]` would have returned and what we returned. */
  worstDeltaM = 0;
  /** Total hits examined, so the cost of not stopping at the first one is visible. */
  hits = 0;

  note(hitCount: number, chosenFirst: boolean, deltaM: number): void {
    this.samples++;
    this.hits += hitCount;
    if (!chosenFirst) {
      this.parentWins++;
      this.worstDeltaM = Math.max(this.worstDeltaM, Math.abs(deltaM));
    }
  }

  snapshot() {
    return {
      samples: this.samples,
      parentWins: this.parentWins,
      parentWinRate: this.samples ? +(this.parentWins / this.samples).toFixed(4) : 0,
      worstDeltaM: +this.worstDeltaM.toFixed(3),
      hitsPerSample: this.samples ? +(this.hits / this.samples).toFixed(2) : 0,
    };
  }

  reset(): void {
    this.samples = 0;
    this.parentWins = 0;
    this.worstDeltaM = 0;
    this.hits = 0;
  }
}

/** Stamp a loaded tile scene's meshes with the tile's hierarchy depth (the `load-model` half). */
export function stampTileDepth(scene: THREE.Object3D, depth: number): void {
  scene.traverse((o) => {
    o.userData[TERRAIN_DEPTH_KEY] = depth;
  });
}
