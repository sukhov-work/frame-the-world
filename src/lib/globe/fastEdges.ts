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
 *
 * T106 slice (b) (2026-09-07e): the builder is RESUMABLE. `createFastEdgesBuilder` holds the
 * whole state (the vertex keying, the edge table, the output cursor) and `step(deadlineMs)`
 * advances it in chunks until the deadline, so the deferred `load-model` queue can spread the
 * biggest cell's build across frames under a ms budget. The one-shot `buildFastEdges` is the
 * same builder stepped to completion — one algorithm, one identity proof (the test drives the
 * builder one iteration per step and demands the same floats as the one-shot).
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

export interface FastEdgesBuilder {
  /**
   * Work until done or `deadlineMs` (a `performance.now()` instant), checking the clock every
   * `checkEvery` iterations (vertices in the keying stage, triangles in the edge stage). ALWAYS
   * completes at least one chunk of `checkEvery` iterations, so a deadline already in the past
   * still makes progress. Returns true when the build is finished (`result()` is then valid).
   */
  step(deadlineMs: number, checkEvery?: number): boolean;
  /** The finished edges — only after `step` returned true (throws otherwise). */
  result(): FastEdges;
  /** True once finished. */
  done(): boolean;
}

/**
 * Integer vertex keys: each source vertex → a compact id shared by every vertex whose
 * `round(p·1e4)` triple matches (three's `hashes[]` equality). Open addressing over a power-of-
 * two table keyed on a mix of the three ints; the triple is compared exactly.
 */
class VertexKeyer {
  readonly uid: Int32Array;
  uidCount = 0;
  private readonly rx: Int32Array;
  private readonly ry: Int32Array;
  private readonly rz: Int32Array;
  private readonly table: Int32Array;
  private readonly rep: Int32Array;
  private readonly mask: number;
  /** Next vertex to key. */
  cursor = 0;

  constructor(
    private readonly positions: ArrayLike<number>,
    readonly vertexCount: number,
  ) {
    this.uid = new Int32Array(vertexCount);
    this.rx = new Int32Array(vertexCount);
    this.ry = new Int32Array(vertexCount);
    this.rz = new Int32Array(vertexCount);
    let cap = 1;
    while (cap < vertexCount * 2) cap <<= 1;
    this.mask = cap - 1;
    this.table = new Int32Array(cap).fill(-1); // slot → uid (a representative's ints live in rx/ry/rz[rep])
    this.rep = new Int32Array(vertexCount); // uid → representative vertex index
  }

  /** Key vertices [cursor, end). */
  run(end: number): void {
    const { positions, rx, ry, rz, table, rep, uid, mask } = this;
    for (let i = this.cursor; i < end; i++) {
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
          table[h] = this.uidCount;
          rep[this.uidCount] = i;
          uid[i] = this.uidCount++;
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
    this.cursor = end;
  }
}

/**
 * Build the crease edges of a triangle mesh, resumably. `positions` are the geometry's own
 * floats (local space), `index` its index array or null for a soup. `thresholdAngle` in
 * degrees (the `EdgesGeometry` argument — `ENRICHED.edgeAngleDeg` / `BUILDINGS.edgeAngleDeg`).
 */
export function createFastEdgesBuilder(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  thresholdAngle: number,
): FastEdgesBuilder {
  const vertexCount = Math.floor(positions.length / 3);
  const indexCount = index ? index.length : vertexCount;
  const thresholdDot = Math.cos(DEG2RAD * thresholdAngle);
  const keyer = new VertexKeyer(positions, vertexCount);

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

  // stage 0 = keying vertices · 1 = walking triangles · 2 = finished
  let stage = 0;
  let triCursor = 0; // next index-array position (multiple of 3)
  let N = 1; // uidCount || 1, fixed when stage 0 completes
  let result: FastEdges | null = null;

  const tri = [0, 0, 0];
  const keys = [0, 0, 0];
  const uid = keyer.uid;

  const emit = (v: number): void => {
    outPos[outN * 3] = positions[v * 3];
    outPos[outN * 3 + 1] = positions[v * 3 + 1];
    outPos[outN * 3 + 2] = positions[v * 3 + 2];
    outSrc[outN] = v;
    outN++;
  };

  /** Walk triangles [triCursor, end) — index positions, multiples of 3. */
  const walk = (end: number): void => {
    for (let i = triCursor; i < end; i += 3) {
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
            emit(v0);
            emit(v1);
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
    triCursor = end;
  };

  const finish = (): void => {
    // every remaining, unmatched edge — insertion order, from the stored indices
    for (let s = 0; s < slots; s++) {
      if (eState[s] !== 1) continue;
      emit(eI0[s]);
      emit(eI1[s]);
    }
    result = {
      positions: outPos.slice(0, outN * 3),
      srcIndex: outSrc.slice(0, outN),
      segmentCount: outN / 2,
    };
    stage = 2;
  };

  return {
    step(deadlineMs, checkEvery = 256) {
      const chunk = Math.max(1, Math.floor(checkEvery));
      if (stage === 0) {
        for (;;) {
          const end = Math.min(vertexCount, keyer.cursor + chunk);
          keyer.run(end);
          if (keyer.cursor >= vertexCount) {
            N = keyer.uidCount || 1;
            stage = 1;
            break;
          }
          if (performance.now() >= deadlineMs) return false;
        }
        // stage 0 just completed: give stage 1 its turn only when time remains
        if (performance.now() >= deadlineMs) return false;
      }
      if (stage === 1) {
        for (;;) {
          const end = Math.min(indexCount, triCursor + chunk * 3);
          walk(end);
          if (triCursor >= indexCount) {
            finish();
            break;
          }
          if (performance.now() >= deadlineMs) return false;
        }
      }
      return stage === 2;
    },
    result() {
      if (!result) throw new Error("fastEdges: result() before the build finished");
      return result;
    },
    done: () => stage === 2,
  };
}

/** The one-shot build — the resumable builder stepped to completion. */
export function buildFastEdges(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  thresholdAngle: number,
): FastEdges {
  const b = createFastEdgesBuilder(positions, index, thresholdAngle);
  b.step(Infinity, 1 << 30);
  return b.result();
}
