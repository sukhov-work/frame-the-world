/**
 * T77 LEVER 8 (owner ruling 2026-09-08c: "the terrain BVH — build next") — a bounding-volume tree
 * over ONE terrain tile's triangles so a height lookup (`rawHeightAt`'s down ray) and the controls'
 * pivot / tilt raycasts cost a few triangle tests instead of every triangle of every tile under the
 * ray. On the Pixel's descent leg the controls raycast was the biggest bucket — `rawHeightAt` 315 ms
 * + `stepTiltGlide` 138 ms inside the hitch frames, three's `intersectTriangle` / `getX` / `getZ`
 * 620 ms over the whole 8 s leg (MEASUREMENTS §27.2) — because three's `Mesh.raycast` walks the
 * WHOLE index of a tile once its bounding sphere is hit, and a vertical ray from 12 km hits the
 * spheres of every LOD ancestor still in the group.
 *
 * WHY IN-HOUSE. `three-mesh-bvh` is the standard tool, but the lockfile pins the Wix registry
 * (`npm.dev.wixpress.com`, unreachable off the corporate VPN — 2026-09-08c) and a mixed-registry
 * lockfile is a trap for the release path. The claim this module rests on is small: the SAME
 * triangles, tested with three's own `Ray.intersectTriangle` under the SAME side rule, in an order
 * the raycaster sorts anyway — so the hit list is identical to `Mesh.raycast`'s (unit-pinned:
 * `test/lib/globe/terrainBvh.test.ts` compares the two on random TINs, indexed and not,
 * interleaved and not, FrontSide and DoubleSide, with a drawRange).
 *
 * SHAPE. A flat, static, median-split tree: `bounds` (6 floats per node, the LOCAL-space AABB),
 * `nodes` (2 ints per node: an inner node's two children, a leaf's `−(offset + 1)` and count),
 * `tris` (triangle numbers in build order). The geometry is NEVER touched — no index reorder, so
 * the render is byte-identical (the `high` contract). Built LAZILY on a tile's first raycast that
 * passes its bounding sphere (a tile no ray ever asks about costs nothing) and dropped with the
 * tile; ~55 KB for an 8k-triangle tile.
 *
 * `raycastWithBvh` is installed as the MESH's own `raycast` (`installTerrainBvh`), so every
 * caller — `intersectObject(tiles.group, true)`, the controls' `_raycaster` on the whole scene —
 * takes it without knowing. The three-lookalike hit carries `distance / point / object / face /
 * faceIndex / normal / uv / uv1 / barycoord` exactly as three builds them.
 */
import * as THREE from "three";

export interface TerrainBvh {
  /** 6 floats per node: minX minY minZ maxX maxY maxZ (local space). */
  bounds: Float32Array;
  /** 2 ints per node: inner → [left, right]; leaf → [−(offset + 1), count] into `tris`. */
  nodes: Int32Array;
  /** Triangle numbers (the `faceIndex` three reports) in tree order. */
  tris: Uint32Array;
  nodeCount: number;
  triCount: number;
  buildMs: number;
}

/** Where the tree hangs on the geometry (never enumerated by three; dropped with the geometry). */
export const TERRAIN_BVH_KEY = "ftwTerrainBvh";

const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _point = new THREE.Vector3();
const _pointWorld = new THREE.Vector3();
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _sphereHit = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

/** The triangle range three would iterate: honours `drawRange`; a material array (groups) is not
 *  a terrain shape and falls back to three's own walk (`installTerrainBvh` refuses it). */
function triangleRange(geometry: THREE.BufferGeometry): { start: number; end: number; indexed: boolean } {
  const index = geometry.index;
  const position = geometry.attributes.position;
  const drawRange = geometry.drawRange;
  if (index !== null) {
    const start = Math.max(0, drawRange.start);
    const end = Math.min(index.count, drawRange.start + drawRange.count);
    return { start, end, indexed: true };
  }
  const start = Math.max(0, drawRange.start);
  const end = Math.min(position.count, drawRange.start + drawRange.count);
  return { start, end, indexed: false };
}

/**
 * Build the tree over a geometry's triangles. `leafTris` = the leaf size (8: a down ray then
 * tests ≤ 8 triangles per leaf it reaches, ~2 leaves for a TIN). Returns null for a geometry with
 * no triangles. O(n log n): a midpoint partition of the centroids along the longest axis of the
 * node's centroid bounds; a degenerate split (all centroids alike) halves the range.
 */
export function buildTerrainBvh(geometry: THREE.BufferGeometry, leafTris = 8): TerrainBvh | null {
  const t0 = performance.now();
  const position = geometry.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!position) return null;
  const index = geometry.index;
  const { start, end, indexed } = triangleRange(geometry);
  const triCount = Math.floor((end - start) / 3);
  if (triCount <= 0) return null;
  // Per-triangle centroid + AABB (the attribute accessors read interleaved buffers too).
  const cen = new Float32Array(triCount * 3);
  const tmin = new Float32Array(triCount * 3);
  const tmax = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = start + t * 3;
    const a = indexed ? (index as THREE.BufferAttribute).getX(i0) : i0;
    const b = indexed ? (index as THREE.BufferAttribute).getX(i0 + 1) : i0 + 1;
    const c = indexed ? (index as THREE.BufferAttribute).getX(i0 + 2) : i0 + 2;
    const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
    const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
    const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);
    const o = t * 3;
    tmin[o] = Math.min(ax, bx, cx); tmin[o + 1] = Math.min(ay, by, cy); tmin[o + 2] = Math.min(az, bz, cz);
    tmax[o] = Math.max(ax, bx, cx); tmax[o + 1] = Math.max(ay, by, cy); tmax[o + 2] = Math.max(az, bz, cz);
    cen[o] = (ax + bx + cx) / 3; cen[o + 1] = (ay + by + cy) / 3; cen[o + 2] = (az + bz + cz) / 3;
  }
  const tris = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) tris[t] = t;
  // Upper bound on nodes for a binary tree whose leaves hold ≥ 1 triangle: 2·ceil(n / 1) − 1 —
  // the midpoint split can produce leaves smaller than leafTris, so size for the worst case.
  const maxNodes = 2 * triCount + 1;
  const bounds = new Float32Array(maxNodes * 6);
  const nodes = new Int32Array(maxNodes * 2);
  let nodeCount = 0;
  // An explicit stack instead of recursion (a 100k-triangle tile must not blow the JS stack).
  const stack: number[] = [];
  const pushNode = (lo: number, hi: number): number => {
    const id = nodeCount++;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = lo; k < hi; k++) {
      const o = tris[k] * 3;
      if (tmin[o] < minX) minX = tmin[o];
      if (tmin[o + 1] < minY) minY = tmin[o + 1];
      if (tmin[o + 2] < minZ) minZ = tmin[o + 2];
      if (tmax[o] > maxX) maxX = tmax[o];
      if (tmax[o + 1] > maxY) maxY = tmax[o + 1];
      if (tmax[o + 2] > maxZ) maxZ = tmax[o + 2];
    }
    const b = id * 6;
    bounds[b] = minX; bounds[b + 1] = minY; bounds[b + 2] = minZ;
    bounds[b + 3] = maxX; bounds[b + 4] = maxY; bounds[b + 5] = maxZ;
    stack.push(id, lo, hi);
    return id;
  };
  pushNode(0, triCount);
  while (stack.length > 0) {
    const hi = stack.pop() as number;
    const lo = stack.pop() as number;
    const id = stack.pop() as number;
    const n = hi - lo;
    if (n <= leafTris) {
      nodes[id * 2] = -(lo + 1);
      nodes[id * 2 + 1] = n;
      continue;
    }
    // The longest axis of the CENTROID bounds, split at its midpoint.
    let cminX = Infinity, cminY = Infinity, cminZ = Infinity, cmaxX = -Infinity, cmaxY = -Infinity, cmaxZ = -Infinity;
    for (let k = lo; k < hi; k++) {
      const o = tris[k] * 3;
      const x = cen[o], y = cen[o + 1], z = cen[o + 2];
      if (x < cminX) cminX = x; if (x > cmaxX) cmaxX = x;
      if (y < cminY) cminY = y; if (y > cmaxY) cmaxY = y;
      if (z < cminZ) cminZ = z; if (z > cmaxZ) cmaxZ = z;
    }
    const ex = cmaxX - cminX, ey = cmaxY - cminY, ez = cmaxZ - cminZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = axis === 0 ? (cminX + cmaxX) / 2 : axis === 1 ? (cminY + cmaxY) / 2 : (cminZ + cmaxZ) / 2;
    // In-place partition of tris[lo, hi) by centroid < mid.
    let i = lo, j = hi - 1;
    while (i <= j) {
      if (cen[tris[i] * 3 + axis] < mid) i++;
      else {
        const tmp = tris[i]; tris[i] = tris[j]; tris[j] = tmp;
        j--;
      }
    }
    let split = i;
    if (split === lo || split === hi) split = lo + (n >> 1); // degenerate → halve
    const left = pushNode(lo, split);
    const right = pushNode(split, hi);
    nodes[id * 2] = left;
    nodes[id * 2 + 1] = right;
  }
  return {
    bounds: bounds.slice(0, nodeCount * 6),
    nodes: nodes.slice(0, nodeCount * 2),
    tris,
    nodeCount,
    triCount,
    buildMs: performance.now() - t0,
  };
}

/** Slab test of a local-space ray against node `id`'s box (the inverse direction precomputed;
 *  ±Infinity handles axis-aligned rays — a 0 · Infinity NaN is caught by the `!(…)` compares). */
function rayHitsNode(bounds: Float32Array, id: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number): boolean {
  const b = id * 6;
  let t1 = (bounds[b] - ox) * ix, t2 = (bounds[b + 3] - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (bounds[b + 1] - oy) * iy; t2 = (bounds[b + 4] - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (bounds[b + 2] - oz) * iz; t2 = (bounds[b + 5] - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  return tmax >= Math.max(tmin, 0) && !Number.isNaN(tmin) && !Number.isNaN(tmax);
}

const _stack = new Int32Array(256);

/**
 * `Mesh.raycast`'s twin over the tree — the same sphere / box early-outs, the same local ray, the
 * same `intersectTriangle` under the same side rule, the same hit object. `intersects` receives the
 * hits unsorted (the Raycaster sorts by distance after `intersectObject`, exactly as with three's
 * own walk). Returns the number of triangles TESTED (diagnostics).
 */
export function raycastWithBvh(
  mesh: THREE.Mesh,
  bvh: TerrainBvh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): number {
  const geometry = mesh.geometry;
  const material = mesh.material as THREE.Material;
  if (material === undefined) return 0;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  _sphere.copy(geometry.boundingSphere as THREE.Sphere).applyMatrix4(mesh.matrixWorld);
  _ray.copy(raycaster.ray).recast(raycaster.near);
  if (!_sphere.containsPoint(_ray.origin)) {
    if (_ray.intersectSphere(_sphere, _sphereHit) === null) return 0;
    if (_ray.origin.distanceToSquared(_sphereHit) > (raycaster.far - raycaster.near) ** 2) return 0;
  }
  _inverse.copy(mesh.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inverse);
  if (geometry.boundingBox !== null && !_ray.intersectsBox(geometry.boundingBox)) return 0;

  const index = geometry.index;
  const { start, indexed } = triangleRange(geometry);
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const uv1 = geometry.attributes.uv1 as THREE.BufferAttribute | undefined;
  const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const backfaceCulling = material.side === THREE.FrontSide;
  const flip = material.side === THREE.BackSide;
  const ox = _ray.origin.x, oy = _ray.origin.y, oz = _ray.origin.z;
  const ix = 1 / _ray.direction.x, iy = 1 / _ray.direction.y, iz = 1 / _ray.direction.z;
  let tested = 0;
  let sp = 0;
  _stack[sp++] = 0;
  const { bounds, nodes, tris } = bvh;
  while (sp > 0) {
    const id = _stack[--sp];
    if (!rayHitsNode(bounds, id, ox, oy, oz, ix, iy, iz)) continue;
    const n0 = nodes[id * 2];
    if (n0 >= 0) {
      // inner: push both (the stack is sized for a tree depth far past any tile's)
      _stack[sp++] = n0;
      _stack[sp++] = nodes[id * 2 + 1];
      continue;
    }
    const lo = -n0 - 1;
    const count = nodes[id * 2 + 1];
    for (let k = lo; k < lo + count; k++) {
      const t = tris[k];
      const i0 = start + t * 3;
      const a = indexed ? (index as THREE.BufferAttribute).getX(i0) : i0;
      const b = indexed ? (index as THREE.BufferAttribute).getX(i0 + 1) : i0 + 1;
      const c = indexed ? (index as THREE.BufferAttribute).getX(i0 + 2) : i0 + 2;
      mesh.getVertexPosition(a, _vA);
      mesh.getVertexPosition(b, _vB);
      mesh.getVertexPosition(c, _vC);
      tested++;
      const hit = flip
        ? _ray.intersectTriangle(_vC, _vB, _vA, true, _point)
        : _ray.intersectTriangle(_vA, _vB, _vC, backfaceCulling, _point);
      if (hit === null) continue;
      _pointWorld.copy(_point).applyMatrix4(mesh.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(_pointWorld);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      const intersection: THREE.Intersection & { barycoord?: THREE.Vector3; uv1?: THREE.Vector2 } = {
        distance,
        point: _pointWorld.clone(),
        object: mesh,
      };
      const barycoord = new THREE.Vector3();
      THREE.Triangle.getBarycoord(_point, _vA, _vB, _vC, barycoord);
      if (uv) intersection.uv = THREE.Triangle.getInterpolatedAttribute(uv, a, b, c, barycoord, new THREE.Vector2());
      if (uv1) intersection.uv1 = THREE.Triangle.getInterpolatedAttribute(uv1, a, b, c, barycoord, new THREE.Vector2());
      if (normal) {
        const nrm = THREE.Triangle.getInterpolatedAttribute(normal, a, b, c, barycoord, new THREE.Vector3());
        if (nrm.dot(_ray.direction) > 0) nrm.multiplyScalar(-1);
        intersection.normal = nrm;
      }
      const face = { a, b, c, normal: new THREE.Vector3(), materialIndex: 0 };
      THREE.Triangle.getNormal(_vA, _vB, _vC, face.normal);
      intersection.face = face;
      intersection.faceIndex = Math.floor(i0 / 3); // three's numbering: the triangle's slot in the whole buffer
      intersection.barycoord = barycoord;
      intersects.push(intersection);
    }
  }
  return tested;
}

/** Diagnostics for the DBG chip / a probe: how many trees were built and what they cost. */
export interface TerrainBvhStats {
  builds: number;
  buildMsTotal: number;
  buildMsWorst: number;
  triesTested: number;
  raycasts: number;
}

/**
 * Install the lazy BVH raycast on ONE terrain mesh. The tree is built on the first raycast that
 * passes the mesh's bounding sphere and cached on the geometry under `TERRAIN_BVH_KEY`; a
 * geometry three cannot walk in one loop (a material array / groups) keeps three's own raycast.
 * Returns false when the mesh was left alone.
 */
export function installTerrainBvh(mesh: THREE.Mesh, stats: TerrainBvhStats, leafTris = 8): boolean {
  if (Array.isArray(mesh.material)) return false;
  const original = mesh.raycast;
  mesh.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const geometry = this.geometry;
    let bvh = (geometry.userData as Record<string, unknown>)[TERRAIN_BVH_KEY] as TerrainBvh | null | undefined;
    if (bvh === undefined) {
      // Only pay the build for a tile a ray actually reaches: the sphere test first (three's own).
      const material = this.material as THREE.Material;
      if (material === undefined) return;
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      _sphere.copy(geometry.boundingSphere as THREE.Sphere).applyMatrix4(this.matrixWorld);
      _ray.copy(raycaster.ray).recast(raycaster.near);
      if (!_sphere.containsPoint(_ray.origin)) {
        if (_ray.intersectSphere(_sphere, _sphereHit) === null) return;
        if (_ray.origin.distanceToSquared(_sphereHit) > (raycaster.far - raycaster.near) ** 2) return;
      }
      bvh = buildTerrainBvh(geometry, leafTris);
      (geometry.userData as Record<string, unknown>)[TERRAIN_BVH_KEY] = bvh; // null = "no triangles", never retried
      if (bvh) {
        stats.builds++;
        stats.buildMsTotal += bvh.buildMs;
        if (bvh.buildMs > stats.buildMsWorst) stats.buildMsWorst = bvh.buildMs;
      }
    }
    if (!bvh) {
      original.call(this, raycaster, intersects);
      return;
    }
    stats.raycasts++;
    stats.triesTested += raycastWithBvh(this, bvh, raycaster, intersects);
  };
  return true;
}

/** Drop a mesh's tree (a disposed tile) — the geometry goes with the tile; this just unhooks. */
export function dropTerrainBvh(mesh: THREE.Mesh): void {
  const ud = mesh.geometry?.userData as Record<string, unknown> | undefined;
  if (ud && TERRAIN_BVH_KEY in ud) delete ud[TERRAIN_BVH_KEY];
}
