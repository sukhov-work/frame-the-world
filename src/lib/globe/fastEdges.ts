/**
 * T106 (2026-09-07d) — the enriched / OSM cell's crease edges, built the way three's
 * `EdgesGeometry` builds them but WITHOUT the string hashing that made it the phone's descent
 * hitch: on the Pixel 6 Pro (MEASUREMENTS §21.3) `new THREE.EdgesGeometry(geom, 30)` cost
 * 1,832 ms of the 6.73 s hitch window — per triangle three template-string vertex hashes, two
 * template-string edge keys into a plain object, a `for…in` sweep and a JS-array push, feeding
 * the 240 ms gc bucket on top. Everything here is typed arrays and integer keys.
 *
 * THE CONTRACT: the emitted vertex array is ELEMENT-FOR-ELEMENT IDENTICAL to what
 * `new THREE.EdgesGeometry(geometry, thresholdAngle)` produces for the same geometry (the
 * `MESH_SUITE_PLAN` §4a byte-identity rule — the visual sweep compares at tolerance 0, the
 * per-building seat CSR indexes into this array). Every semantic of three r0.185's algorithm
 * is kept on purpose, including its quirks:
 *   · vertices are keyed on `Math.round(x·1e4)` (0.1 mm) for the edge pairing;
 *   · a triangle with two equal keyed vertices is skipped whole (degenerate);
 *   · an edge is DIRECTED (a→b); its sibling is the reverse (b→a). Meeting the sibling emits the
 *     CURRENT triangle's two positions when the face normals' dot ≤ cos(threshold), and nulls
 *     the stored record (a third face on the same edge finds neither);
 *   · a forward key already present (stored OR nulled) is skipped;
 *   · every edge still stored at the end (one face — an open boundary) is emitted afterwards,
 *     in insertion order, from the STORED indices.
 * `test/lib/globe/fastEdges.test.ts` pins the identity against the real `EdgesGeometry` on
 * prisms, party walls, gable roofs, degenerate triangles, indexed and soup geometry.
 *
 * WHAT IT ADDS: `srcIndex` — the source vertex index behind every emitted endpoint. The
 * per-building edge attribution (`enrichedMask.segmentRunsFromSources`) reads it instead of
 * re-deriving the endpoint's owner from an exact-position string key (the other 0.8 s).
 */

/** Three's `precisionPoints = 4`. */
const PRECISION = 1e4;
const DEG2RAD = Math.PI / 180;

export interface FastEdges {
  /** The line-segment positions — `EdgesGeometry`'s `position` attribute, element-identical. */
  positions: Float32Array;
  /** Per emitted VERTEX (positions.length / 3 entries): the source vertex index it copies. */
  srcIndex: Int32Array;
  /** Segments emitted. */
  segmentCount: number;
}

/**
 * Integer vertex keys: each source vertex → a compact id shared by every vertex whose
 * `round(p·1e4)` triple matches (three's `hashes[]` equality). Open addressing over a power-of-
 * two table keyed on a mix of the three ints; the triple is compared exactly.
 */
function keyVertices(positions: ArrayLike<number>, vertexCount: number): { uid: Int32Array; uidCount: number } {
  const uid = new Int32Array(vertexCount);
  const rx = new Int32Array(vertexCount);
  const ry = new Int32Array(vertexCount);
  const rz = new Int32Array(vertexCount);
  let cap = 1;
  while (cap < vertexCount * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1); // slot → uid (a representative vertex's ints live in rx/ry/rz[rep])
  const rep = new Int32Array(vertexCount); // uid → representative vertex index
  let uidCount = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = Math.round(positions[i * 3] * PRECISION);
    const y = Math.round(positions[i * 3 + 1] * PRECISION);
    const z = Math.round(positions[i * 3 + 2] * PRECISION);
    rx[i] = x;
    ry[i] = y;
    rz[i] = z;
    // Mix ALL the bits down before masking: float bit patterns (and round-metre coordinates)
    // have long runs of zero low bits, and a plain multiply-xor leaves them zero — every
    // vertex would land in slot 0 and the probe would go quadratic (measured: 350 ms on a
    // 61k-vertex cell before this mixer, 3 ms after).
    let h = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    h ^= Math.imul(y ^ (y >>> 13), 0xc2b2ae35);
    h ^= Math.imul(z ^ (z >>> 16), 0x27d4eb2f);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h &= mask;
    for (;;) {
      const u = table[h];
      if (u < 0) {
        table[h] = uidCount;
        rep[uidCount] = i;
        uid[i] = uidCount++;
        break;
      }
      const r = rep[u];
      if (rx[r] === x && ry[r] === y && rz[r] === z) {
        uid[i] = u;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return { uid, uidCount };
}

/**
 * Build the crease edges of a triangle mesh. `positions` are the geometry's own floats (local
 * space), `index` its index array or null for a soup. `thresholdAngle` in degrees (the
 * `EdgesGeometry` argument — `ENRICHED.edgeAngleDeg` / `BUILDINGS.edgeAngleDeg`).
 */
export function buildFastEdges(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  thresholdAngle: number,
): FastEdges {
  const vertexCount = Math.floor(positions.length / 3);
  const indexCount = index ? index.length : vertexCount;
  const thresholdDot = Math.cos(DEG2RAD * thresholdAngle);
  const { uid, uidCount } = keyVertices(positions, vertexCount);
  const N = uidCount || 1;

  // Edge records in parallel typed arrays; the map goes from the directed key ua·N+ub (exact in
  // a double while N < 2^26 — a cell holds tens of thousands of vertices) to the record slot.
  // state: 0 = free · 1 = stored · 2 = nulled (three sets the sibling to null but keeps the key).
  const maxEdges = Math.floor(indexCount / 3) * 3;
  const eI0 = new Int32Array(maxEdges);
  const eI1 = new Int32Array(maxEdges);
  const eN = new Float64Array(maxEdges * 3); // doubles, like three's cloned Vector3 normals
  const eState = new Uint8Array(maxEdges);
  const slotOf = new Map<number, number>();
  let slots = 0;

  // Output, sized at the upper bound (every edge emitted once, two vertices each).
  const outPos = new Float32Array(maxEdges * 6);
  const outSrc = new Int32Array(maxEdges * 2);
  let outN = 0; // emitted vertices

  const tri = [0, 0, 0];
  const keys = [0, 0, 0];
  for (let i = 0; i < indexCount; i += 3) {
    if (index) {
      tri[0] = index[i];
      tri[1] = index[i + 1];
      tri[2] = index[i + 2];
    } else {
      tri[0] = i;
      tri[1] = i + 1;
      tri[2] = i + 2;
    }
    const ia = tri[0];
    const ib = tri[1];
    const ic = tri[2];
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];
    const cz = positions[ic * 3 + 2];
    // Triangle.getNormal: (c − b) × (a − b), then `multiplyScalar(1 / sqrt(lengthSq))` —
    // the same operations in the same order, so the dot against the threshold cannot differ
    // by an ulp from three's.
    const ux = cx - bx;
    const uy = cy - by;
    const uz = cz - bz;
    const vx = ax - bx;
    const vy = ay - by;
    const vz = az - bz;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len2 = nx * nx + ny * ny + nz * nz;
    if (len2 > 0) {
      const inv = 1 / Math.sqrt(len2);
      nx *= inv;
      ny *= inv;
      nz *= inv;
    } else {
      nx = ny = nz = 0;
    }

    keys[0] = uid[ia];
    keys[1] = uid[ib];
    keys[2] = uid[ic];
    // skip degenerate triangles
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[2] === keys[0]) continue;

    for (let j = 0; j < 3; j++) {
      const jNext = j === 2 ? 0 : j + 1;
      const k0 = keys[j];
      const k1 = keys[jNext];
      const v0 = tri[j];
      const v1 = tri[jNext];
      const hash = k0 * N + k1;
      const reverseHash = k1 * N + k0;
      const rs = slotOf.get(reverseHash);
      if (rs !== undefined && eState[rs] === 1) {
        // a sibling edge: emit the CURRENT triangle's endpoints if the crease is sharp enough
        const d = nx * eN[rs * 3] + ny * eN[rs * 3 + 1] + nz * eN[rs * 3 + 2];
        if (d <= thresholdDot) {
          outPos[outN * 3] = positions[v0 * 3];
          outPos[outN * 3 + 1] = positions[v0 * 3 + 1];
          outPos[outN * 3 + 2] = positions[v0 * 3 + 2];
          outSrc[outN] = v0;
          outN++;
          outPos[outN * 3] = positions[v1 * 3];
          outPos[outN * 3 + 1] = positions[v1 * 3 + 1];
          outPos[outN * 3 + 2] = positions[v1 * 3 + 2];
          outSrc[outN] = v1;
          outN++;
        }
        eState[rs] = 2;
      } else if (!slotOf.has(hash)) {
        const s = slots++;
        slotOf.set(hash, s);
        eI0[s] = v0;
        eI1[s] = v1;
        eN[s * 3] = nx;
        eN[s * 3 + 1] = ny;
        eN[s * 3 + 2] = nz;
        eState[s] = 1;
      }
    }
  }

  // every remaining, unmatched edge — insertion order, from the stored indices
  for (let s = 0; s < slots; s++) {
    if (eState[s] !== 1) continue;
    const v0 = eI0[s];
    const v1 = eI1[s];
    outPos[outN * 3] = positions[v0 * 3];
    outPos[outN * 3 + 1] = positions[v0 * 3 + 1];
    outPos[outN * 3 + 2] = positions[v0 * 3 + 2];
    outSrc[outN] = v0;
    outN++;
    outPos[outN * 3] = positions[v1 * 3];
    outPos[outN * 3 + 1] = positions[v1 * 3 + 1];
    outPos[outN * 3 + 2] = positions[v1 * 3 + 2];
    outSrc[outN] = v1;
    outN++;
  }

  return {
    positions: outPos.slice(0, outN * 3),
    srcIndex: outSrc.slice(0, outN),
    segmentCount: outN / 2,
  };
}
