import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  TERRAIN_BVH_KEY,
  buildTerrainBvh,
  dropTerrainBvh,
  installTerrainBvh,
  raycastWithBvh,
  type TerrainBvhStats,
} from "../../../src/lib/globe/terrainBvh";

/**
 * T77 lever 8 (2026-09-08c): the terrain BVH must answer EXACTLY what three's `Mesh.raycast`
 * answers — the same hits (faceIndex set), the same distances and points, the same face / normal /
 * uv payload — on the shapes a terrain tile takes: an indexed TIN with a world transform at ECEF
 * scale, a non-indexed one, INTERLEAVED positions (the Cesium b3dm shape), FrontSide vs DoubleSide
 * vs BackSide, a drawRange, and rays that miss. The raycaster sorts by distance, so the order of
 * the unsorted pushes is not part of the contract.
 */

/** A seeded PRNG so a failure is reproducible. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** An n×n grid TIN with noisy heights, ±jitter in the plane so the triangles are not axis-aligned. */
function makeTin(n: number, seed: number, { indexed = true, interleaved = false, size = 1000 } = {}) {
  const r = rng(seed);
  const verts: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size + (r() - 0.5) * (size / n) * 0.4;
      const z = (j / n - 0.5) * size + (r() - 0.5) * (size / n) * 0.4;
      const y = Math.sin(i * 0.7) * 30 + Math.cos(j * 0.5) * 20 + (r() - 0.5) * 8;
      verts.push(x, y, z);
    }
  const idx: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      // alternate the diagonal, and flip the odd quads' winding so both sides are exercised
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, d, b, a, c, d);
    }
  const g = new THREE.BufferGeometry();
  const pos = indexed ? verts : idx.flatMap((k) => [verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]]);
  const uvs = Array.from({ length: pos.length / 3 }, (_, k) => [(k % 7) / 7, (k % 11) / 11]).flat();
  if (interleaved) {
    // position + uv in one buffer: x y z u v (stride 5)
    const count = pos.length / 3;
    const buf = new Float32Array(count * 5);
    for (let k = 0; k < count; k++) {
      buf[k * 5] = pos[k * 3];
      buf[k * 5 + 1] = pos[k * 3 + 1];
      buf[k * 5 + 2] = pos[k * 3 + 2];
      buf[k * 5 + 3] = uvs[k * 2];
      buf[k * 5 + 4] = uvs[k * 2 + 1];
    }
    const ib = new THREE.InterleavedBuffer(buf, 5);
    g.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute("uv", new THREE.InterleavedBufferAttribute(ib, 2, 3));
  } else {
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }
  if (indexed) g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const mkMesh = (g: THREE.BufferGeometry, side: THREE.Side = THREE.FrontSide) => {
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side }));
  // an ECEF-scale placement: a big translation + a rotation, like a 3D Tiles terrain tile
  m.position.set(3_500_000, 2_900_000, 4_100_000);
  m.rotation.set(0.3, -1.1, 0.7);
  m.updateMatrixWorld(true);
  return m;
};

const sameHits = (a: THREE.Intersection[], b: THREE.Intersection[]) => {
  expect(b.length).toBe(a.length);
  const key = (h: THREE.Intersection) => `${h.faceIndex}`;
  const A = new Map(a.map((h) => [key(h), h]));
  for (const h of b) {
    const t = A.get(key(h));
    expect(t, `faceIndex ${h.faceIndex} hit by three but not the BVH`).toBeDefined();
    if (!t) continue;
    expect(Math.abs(h.distance - t.distance)).toBeLessThan(1e-6 * Math.max(1, t.distance));
    expect(h.point.distanceTo(t.point)).toBeLessThan(1e-6 * Math.max(1, t.distance));
    expect(h.object).toBe(t.object);
    expect(h.face!.a).toBe(t.face!.a);
    expect(h.face!.b).toBe(t.face!.b);
    expect(h.face!.c).toBe(t.face!.c);
    expect(h.face!.normal.distanceTo(t.face!.normal)).toBeLessThan(1e-6);
    if (t.uv) expect(h.uv!.distanceTo(t.uv)).toBeLessThan(1e-6);
    if (t.normal) expect(h.normal!.distanceTo(t.normal)).toBeLessThan(1e-6);
  }
};

/** Rays aimed at the tile from random directions + a batch of straight-down rays (the sampler). */
function raysFor(mesh: THREE.Mesh, seed: number, n: number): THREE.Raycaster[] {
  const r = rng(seed);
  const out: THREE.Raycaster[] = [];
  const sphere = mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
  const localUp = new THREE.Vector3(0, 1, 0).transformDirection(mesh.matrixWorld);
  for (let k = 0; k < n; k++) {
    const rc = new THREE.Raycaster();
    // a target inside the sphere; an origin off in some direction (half of them "above", the
    // sampler's shape: origin high along local +Y, direction straight down)
    const target = sphere.center.clone().add(new THREE.Vector3((r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2).multiplyScalar(sphere.radius * 0.8));
    if (k % 2 === 0) {
      const origin = target.clone().addScaledVector(localUp, 12_000);
      rc.set(origin, localUp.clone().negate());
      rc.far = 24_000;
    } else {
      const dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const origin = target.clone().addScaledVector(dir, -(500 + r() * 3000));
      rc.set(origin, dir);
      rc.near = r() < 0.3 ? 100 : 0;
      rc.far = r() < 0.3 ? 2500 : Infinity;
    }
    out.push(rc);
  }
  return out;
}

describe("terrainBvh — the hit list is three's hit list", () => {
  const cases: Array<[string, () => THREE.Mesh]> = [
    ["indexed TIN, FrontSide", () => mkMesh(makeTin(40, 1))],
    ["indexed TIN, DoubleSide", () => mkMesh(makeTin(40, 2), THREE.DoubleSide)],
    ["indexed TIN, BackSide", () => mkMesh(makeTin(24, 3), THREE.BackSide)],
    ["non-indexed TIN, FrontSide", () => mkMesh(makeTin(30, 4, { indexed: false }))],
    ["INTERLEAVED positions, DoubleSide", () => mkMesh(makeTin(30, 5, { interleaved: true }), THREE.DoubleSide)],
    [
      "indexed TIN with a drawRange",
      () => {
        const g = makeTin(30, 6);
        g.setDrawRange(300, 2400);
        return mkMesh(g, THREE.DoubleSide);
      },
    ],
  ];
  for (const [label, make] of cases) {
    it(label, () => {
      const mesh = make();
      const bvh = buildTerrainBvh(mesh.geometry, 8);
      expect(bvh).not.toBeNull();
      const rays = raysFor(mesh, 100, 160);
      let hitsTotal = 0;
      let testedTotal = 0;
      for (const rc of rays) {
        const three: THREE.Intersection[] = [];
        mesh.raycast(rc, three);
        const ours: THREE.Intersection[] = [];
        testedTotal += raycastWithBvh(mesh, bvh!, rc, ours);
        sameHits(three, ours);
        hitsTotal += three.length;
      }
      // the rays are not all misses (BackSide culls the down rays' front faces — far fewer hits)
      expect(hitsTotal).toBeGreaterThan(label.includes("BackSide") ? 4 : 20);
      // the point of the lever: a small fraction of the tile's triangles per ray
      expect(testedTotal / rays.length).toBeLessThan(bvh!.triCount * 0.12);
    });
  }

  it("a tree covers every triangle exactly once, and the leaves are small", () => {
    const g = makeTin(32, 7);
    const bvh = buildTerrainBvh(g, 8)!;
    expect(bvh.triCount).toBe(32 * 32 * 2);
    const seen = new Uint8Array(bvh.triCount);
    let leaves = 0;
    let maxLeaf = 0;
    for (let id = 0; id < bvh.nodeCount; id++) {
      const n0 = bvh.nodes[id * 2];
      if (n0 >= 0) continue;
      leaves++;
      const lo = -n0 - 1;
      const count = bvh.nodes[id * 2 + 1];
      maxLeaf = Math.max(maxLeaf, count);
      for (let k = lo; k < lo + count; k++) seen[bvh.tris[k]]++;
    }
    expect(Array.from(seen).every((v) => v === 1)).toBe(true);
    expect(maxLeaf).toBeLessThanOrEqual(8);
    expect(leaves).toBeGreaterThan(bvh.triCount / 8 - 1);
    // an empty geometry has no tree
    expect(buildTerrainBvh(new THREE.BufferGeometry())).toBeNull();
  });

  it("installTerrainBvh: lazy on the first ray that reaches the sphere, three's walk when it misses, dropped on demand", () => {
    const mesh = mkMesh(makeTin(20, 8));
    const stats: TerrainBvhStats = { builds: 0, buildMsTotal: 0, buildMsWorst: 0, triesTested: 0, raycasts: 0 };
    expect(installTerrainBvh(mesh, stats)).toBe(true);
    // a ray that misses the sphere entirely: no build
    const miss = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    const out0: THREE.Intersection[] = [];
    mesh.raycast(miss, out0);
    expect(stats.builds).toBe(0);
    expect((mesh.geometry.userData as Record<string, unknown>)[TERRAIN_BVH_KEY]).toBeUndefined();
    // a real ray: one build, then hits identical to three's
    const [rc] = raysFor(mesh, 9, 2);
    const three: THREE.Intersection[] = [];
    THREE.Mesh.prototype.raycast.call(mesh, rc, three);
    const ours: THREE.Intersection[] = [];
    mesh.raycast(rc, ours);
    expect(stats.builds).toBe(1);
    expect(stats.raycasts).toBe(1);
    sameHits(three, ours);
    mesh.raycast(rc, []);
    expect(stats.builds).toBe(1); // cached
    expect(stats.raycasts).toBe(2);
    dropTerrainBvh(mesh);
    expect((mesh.geometry.userData as Record<string, unknown>)[TERRAIN_BVH_KEY]).toBeUndefined();
    // a material array is not a terrain shape — left to three
    const multi = new THREE.Mesh(makeTin(4, 10), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    expect(installTerrainBvh(multi, stats)).toBe(false);
  });
});
