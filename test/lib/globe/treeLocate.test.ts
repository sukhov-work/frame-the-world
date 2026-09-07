import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ecefToGeodetic, geodeticToEcef } from "../../../src/lib/geo/projection";
import { locateTreeInstances, TREE_LOCATE_CHUNK } from "../../../src/lib/globe/treeLocate";

/**
 * T115 — the resumable tree locate must be BYTE-IDENTICAL to the one-shot it replaces
 * (`Vector3.applyMatrix4(matrixWorld)` → `ecefToGeodetic`), and chunking must be order- and
 * boundary-exact: locating [0,n) in one call equals locating it in any split.
 */

/** A deterministic LCG so the fixture is stable across runs. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

/** A Dnipro-like cell: a tile scene matrixWorld (ECEF placement with a rotation) and N instances
 *  scattered in the cell's local frame with the baked yaw-about-Y rotations. */
function fixture(n: number, seed = 7) {
  const rnd = lcg(seed);
  const origin = geodeticToEcef(48.4675, 35.04, 92);
  // East-north-up frame at the origin, as a 4×4 (column-major) — an affine matrixWorld.
  const lat = (48.4675 * Math.PI) / 180;
  const lon = (35.04 * Math.PI) / 180;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const world = new Matrix4().set(
    east[0], up[0], -north[0], origin[0],
    east[1], up[1], -north[1], origin[1],
    east[2], up[2], -north[2], origin[2],
    0, 0, 0, 1,
  );
  const instanceMatrix = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const yaw = rnd() * Math.PI * 2;
    const m = new Matrix4().makeRotationY(yaw);
    m.setPosition((rnd() - 0.5) * 2400, (rnd() - 0.5) * 30, (rnd() - 0.5) * 2400);
    m.toArray(instanceMatrix, i * 16);
  }
  return { world, instanceMatrix };
}

/** The shipped one-shot, verbatim (`enrichedBuildings.ts` `ensureLocated`, 2026-09-07f). */
function oneShot(instanceMatrix: Float32Array, world: Matrix4, n: number) {
  const latDeg = new Float64Array(n);
  const lonDeg = new Float64Array(n);
  const _w = new Vector3();
  for (let i = 0; i < n; i++) {
    _w.set(instanceMatrix[i * 16 + 12], instanceMatrix[i * 16 + 13], instanceMatrix[i * 16 + 14]).applyMatrix4(world);
    const g = ecefToGeodetic([_w.x, _w.y, _w.z]);
    latDeg[i] = g.latDeg;
    lonDeg[i] = g.lonDeg;
  }
  return { latDeg, lonDeg };
}

describe("locateTreeInstances — T115", () => {
  const N = 1000;
  const { world, instanceMatrix } = fixture(N);
  const expected = oneShot(instanceMatrix, world, N);

  it("is byte-identical to the one-shot (three's applyMatrix4 + ecefToGeodetic) over a whole set", () => {
    const latDeg = new Float64Array(N);
    const lonDeg = new Float64Array(N);
    const next = locateTreeInstances(instanceMatrix, world.elements, 0, N, latDeg, lonDeg);
    expect(next).toBe(N);
    // Sanity FIRST (toEqual treats NaN as equal to NaN — a broken fixture would pass silently).
    for (let i = 0; i < N; i++) {
      expect(Math.abs(latDeg[i] - 48.4675)).toBeLessThan(0.02);
      expect(Math.abs(lonDeg[i] - 35.04)).toBeLessThan(0.03);
    }
    // Exact doubles, bitwise: `Object.is` per element (NaN would fail here too).
    for (let i = 0; i < N; i++) {
      expect(Object.is(latDeg[i], expected.latDeg[i])).toBe(true);
      expect(Object.is(lonDeg[i], expected.lonDeg[i])).toBe(true);
    }
  });

  it("chunking is exact: any split of [0,n) writes the same values, only its own indices", () => {
    const latDeg = new Float64Array(N).fill(NaN);
    const lonDeg = new Float64Array(N).fill(NaN);
    let cursor = 0;
    const splits = [1, TREE_LOCATE_CHUNK, 3, 511, N]; // odd sizes, the chunk size, past the end
    for (const size of splits) {
      const to = Math.min(N, cursor + size);
      const next = locateTreeInstances(instanceMatrix, world.elements, cursor, to, latDeg, lonDeg);
      expect(next).toBe(to);
      // Everything below the cursor is located; everything above is still untouched.
      for (let i = to; i < Math.min(N, to + 3); i++) expect(Number.isNaN(latDeg[i])).toBe(true);
      cursor = next;
      if (cursor >= N) break;
    }
    expect(cursor).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(Object.is(latDeg[i], expected.latDeg[i])).toBe(true);
      expect(Object.is(lonDeg[i], expected.lonDeg[i])).toBe(true);
    }
  });

  it("an empty range is a no-op that returns its own end", () => {
    const latDeg = new Float64Array(4).fill(1);
    const lonDeg = new Float64Array(4).fill(2);
    expect(locateTreeInstances(instanceMatrix, world.elements, 2, 2, latDeg, lonDeg)).toBe(2);
    expect([...latDeg]).toEqual([1, 1, 1, 1]);
    expect([...lonDeg]).toEqual([2, 2, 2, 2]);
  });

  it("the chunk size is a power-of-two multiple the deadline idiom can mask on", () => {
    expect(TREE_LOCATE_CHUNK).toBe(256);
    expect((TREE_LOCATE_CHUNK & (TREE_LOCATE_CHUNK - 1)) === 0).toBe(true);
  });
});
