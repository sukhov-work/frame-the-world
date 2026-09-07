import { ecefToGeodetic } from "../geo/projection";

/**
 * T115 (2026-09-07j) — the tree-instance locate, RESUMABLE.
 *
 * `ensureLocated` in `scene/enrichedBuildings.ts` used to walk every tree instance of a cell in
 * one shot — an ECEF → geodetic per instance, atomic in whichever `sampleTrees` frame first
 * touched the cell: 7.5 ms max on the Pixel's descent (MEASUREMENTS §25.5), the last unbudgeted
 * locate on the load path. This is that loop as a pure CHUNK: the caller keeps a cursor per tree
 * set and calls it under its own deadline (the reseat drain's `ENRICHED.reseatBudgetMs`), at
 * least one chunk per call so the locate always makes progress.
 *
 * Byte-identical to the one-shot: the world transform is three's `Vector3.applyMatrix4` written
 * out in the same operation order (the `w` divide included — a tile scene's matrixWorld is
 * affine, so `w` is exactly 1), then the shipped `ecefToGeodetic`. `treeLocate.test.ts` pins
 * both against three itself.
 *
 * @param instanceMatrix the InstancedMesh's `instanceMatrix.array` (16 floats per instance,
 *   column-major; the translation is columns 12–14)
 * @param world the mesh's `matrixWorld.elements`
 * @param from first instance index (inclusive) · @param to last (exclusive)
 * @returns `to` — the next cursor
 */
export function locateTreeInstances(
  instanceMatrix: ArrayLike<number>,
  world: ArrayLike<number>,
  from: number,
  to: number,
  latDeg: Float64Array,
  lonDeg: Float64Array,
): number {
  const e = world;
  for (let i = from; i < to; i++) {
    const o = i * 16;
    const x = instanceMatrix[o + 12];
    const y = instanceMatrix[o + 13];
    const z = instanceMatrix[o + 14];
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    const g = ecefToGeodetic([wx, wy, wz]);
    latDeg[i] = g.latDeg;
    lonDeg[i] = g.lonDeg;
  }
  return to;
}

/** Instances per deadline check — ~0.2 ms on the Pixel for a 10k-instance set (§25.5 scaled). */
export const TREE_LOCATE_CHUNK = 256;
