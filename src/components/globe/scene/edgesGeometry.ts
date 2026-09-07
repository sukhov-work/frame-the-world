/**
 * T106 (2026-09-07d) — `EdgesGeometry` without the string hashing: the three-side wrapper of
 * `lib/globe/fastEdges` for the OSM and enriched `load-model` handlers. Returns the crease
 * edges as a `BufferGeometry` whose `position` attribute is element-identical to
 * `new THREE.EdgesGeometry(geometry, angle)`'s, plus the source vertex behind every endpoint
 * (the per-building attribution's input, `enrichedMask.segmentRunsFromSources`).
 *
 * The fast path needs a non-normalized Float32 position attribute: a plain `BufferAttribute`
 * (every baked cell) is read in place; an INTERLEAVED one is de-interleaved into a fresh
 * Float32Array first (2026-09-07f — Cesium's OSM b3dm meshes arrive with position, normal and
 * `_batchid` sharing one stride-8 buffer, so every OSM tile had been taking the fallback: three's
 * `EdgesGeometry` was 361 ms of the Pixel's descent AFTER slice (d)). The copy is the same floats
 * three's `toNonIndexed` / `fromBufferAttribute` read, so the identity proof carries over
 * (`test/components/globe/edgesGeometry.test.ts`). Anything else — a normalized or non-Float32
 * array (quantized meshes) — takes three's own `EdgesGeometry` and reports `srcIndex: null`, so
 * the caller keeps the string-keyed attribution for it.
 *
 * T106 slice (b) (2026-09-07e): `createEdgesBuilder` is the RESUMABLE form for the deferred
 * `load-model` queue — `step(deadlineMs)` advances the fast builder in chunks; the three
 * fallback (never a baked cell) runs whole on the first step. `allocMs` is the constructor's own
 * cost (the de-interleave copy + the builder's typed-array tables), paid synchronously by the
 * caller of `createEdgesBuilder` — the ledgers report it apart from the steps.
 */
import * as THREE from "three";
import { buildFastEdges, createFastEdgesBuilder, type FastEdgesBuilder, type FastEdgesScratch } from "../../../lib/globe/fastEdges";

export interface EdgesBuild {
  geometry: THREE.BufferGeometry;
  /** Per edge vertex, the source vertex index — null when three's own path was taken. */
  srcIndex: Int32Array | null;
  /** DEV ledger: which path ran and how long it took (ms, summed over every step). */
  fast: boolean;
  ms: number;
  /** DEV ledger: the builder's construction (the de-interleave copy + the tables), ms. */
  allocMs: number;
}

export interface EdgesBuilder {
  /** Advance until done or `deadlineMs`; always makes progress. True when finished. */
  step(deadlineMs: number): boolean;
  /** The build — only after `step` returned true. */
  result(): EdgesBuild;
}

/**
 * The fast path's input: the position floats as ONE plain Float32Array (`itemSize` 3), or null
 * when the attribute is not a non-normalized Float32 one. A plain attribute is returned in place;
 * an interleaved one is copied out of its stride — element by element, the exact floats.
 */
export const positionsF32 = (geometry: THREE.BufferGeometry): Float32Array | null => {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!attr || attr.itemSize !== 3 || attr.normalized) return null;
  if ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const ia = attr as THREE.InterleavedBufferAttribute;
    const src = ia.data.array as ArrayLike<number>;
    if (!(src instanceof Float32Array)) return null;
    const stride = ia.data.stride;
    const offset = ia.offset;
    const count = ia.count;
    const out = new Float32Array(count * 3);
    for (let i = 0, j = offset; i < count; i++, j += stride) {
      out[i * 3] = src[j];
      out[i * 3 + 1] = src[j + 1];
      out[i * 3 + 2] = src[j + 2];
    }
    return out;
  }
  const arr = (attr as THREE.BufferAttribute).array;
  return arr instanceof Float32Array ? arr : null;
};

export function buildEdgesGeometry(geometry: THREE.BufferGeometry, thresholdAngle: number): EdgesBuild {
  const t0 = performance.now();
  const positions = positionsF32(geometry);
  if (!positions) {
    const g = new THREE.EdgesGeometry(geometry, thresholdAngle);
    return { geometry: g, srcIndex: null, fast: false, ms: performance.now() - t0, allocMs: 0 };
  }
  const allocMs = performance.now() - t0;
  const index = geometry.getIndex();
  const edges = buildFastEdges(positions, index ? (index.array as ArrayLike<number>) : null, thresholdAngle);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(edges.positions, 3));
  return { geometry: g, srcIndex: edges.srcIndex, fast: true, ms: performance.now() - t0, allocMs };
}

/** `scratch` (2026-09-07f): the queue's reusable tables — one per queue, since a queue steps one
 *  unit at a time; never share one between two builders that can be mid-flight together. */
export function createEdgesBuilder(geometry: THREE.BufferGeometry, thresholdAngle: number, scratch?: FastEdgesScratch): EdgesBuilder {
  const tAlloc = performance.now();
  const positions = positionsF32(geometry);
  let fast: FastEdgesBuilder | null = null;
  if (positions) {
    const index = geometry.getIndex();
    fast = createFastEdgesBuilder(positions, index ? (index.array as ArrayLike<number>) : null, thresholdAngle, scratch);
  }
  const allocMs = performance.now() - tAlloc;
  let ms = 0;
  let out: EdgesBuild | null = null;
  return {
    step(deadlineMs) {
      if (out) return true;
      const t0 = performance.now();
      if (!fast) {
        const g = new THREE.EdgesGeometry(geometry, thresholdAngle);
        ms += performance.now() - t0;
        out = { geometry: g, srcIndex: null, fast: false, ms, allocMs };
        return true;
      }
      const done = fast.step(deadlineMs);
      ms += performance.now() - t0;
      if (!done) return false;
      const edges = fast.result();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(edges.positions, 3));
      out = { geometry: g, srcIndex: edges.srcIndex, fast: true, ms, allocMs };
      return true;
    },
    result() {
      if (!out) throw new Error("edgesGeometry: result() before the build finished");
      return out;
    },
  };
}
