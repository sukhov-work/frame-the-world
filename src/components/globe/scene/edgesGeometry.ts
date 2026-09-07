/**
 * T106 (2026-09-07d) — `EdgesGeometry` without the string hashing: the three-side wrapper of
 * `lib/globe/fastEdges` for the OSM and enriched `load-model` handlers. Returns the crease
 * edges as a `BufferGeometry` whose `position` attribute is element-identical to
 * `new THREE.EdgesGeometry(geometry, angle)`'s, plus the source vertex behind every endpoint
 * (the per-building attribution's input, `enrichedMask.segmentRunsFromSources`).
 *
 * The fast path needs a plain, non-interleaved, non-normalized Float32 position attribute
 * (every baked cell and Cesium's OSM b3dm); anything else takes three's own `EdgesGeometry`
 * and reports `srcIndex: null`, so the caller keeps the string-keyed attribution for it.
 *
 * T106 slice (b) (2026-09-07e): `createEdgesBuilder` is the RESUMABLE form for the deferred
 * `load-model` queue — `step(deadlineMs)` advances the fast builder in chunks; the three
 * fallback (never a baked cell) runs whole on the first step.
 */
import * as THREE from "three";
import { buildFastEdges, createFastEdgesBuilder, type FastEdgesBuilder } from "../../../lib/globe/fastEdges";

export interface EdgesBuild {
  geometry: THREE.BufferGeometry;
  /** Per edge vertex, the source vertex index — null when three's own path was taken. */
  srcIndex: Int32Array | null;
  /** DEV ledger: which path ran and how long it took (ms, summed over every step). */
  fast: boolean;
  ms: number;
}

export interface EdgesBuilder {
  /** Advance until done or `deadlineMs`; always makes progress. True when finished. */
  step(deadlineMs: number): boolean;
  /** The build — only after `step` returned true. */
  result(): EdgesBuild;
}

const plainF32 = (geometry: THREE.BufferGeometry): THREE.BufferAttribute | null => {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const plain =
    !!attr &&
    !(attr as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    !attr.normalized &&
    attr.array instanceof Float32Array;
  return plain ? attr : null;
};

export function buildEdgesGeometry(geometry: THREE.BufferGeometry, thresholdAngle: number): EdgesBuild {
  const t0 = performance.now();
  const attr = plainF32(geometry);
  if (!attr) {
    const g = new THREE.EdgesGeometry(geometry, thresholdAngle);
    return { geometry: g, srcIndex: null, fast: false, ms: performance.now() - t0 };
  }
  const index = geometry.getIndex();
  const edges = buildFastEdges(attr.array as Float32Array, index ? (index.array as ArrayLike<number>) : null, thresholdAngle);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(edges.positions, 3));
  return { geometry: g, srcIndex: edges.srcIndex, fast: true, ms: performance.now() - t0 };
}

export function createEdgesBuilder(geometry: THREE.BufferGeometry, thresholdAngle: number): EdgesBuilder {
  const attr = plainF32(geometry);
  let fast: FastEdgesBuilder | null = null;
  if (attr) {
    const index = geometry.getIndex();
    fast = createFastEdgesBuilder(attr.array as Float32Array, index ? (index.array as ArrayLike<number>) : null, thresholdAngle);
  }
  let ms = 0;
  let out: EdgesBuild | null = null;
  return {
    step(deadlineMs) {
      if (out) return true;
      const t0 = performance.now();
      if (!fast) {
        const g = new THREE.EdgesGeometry(geometry, thresholdAngle);
        ms += performance.now() - t0;
        out = { geometry: g, srcIndex: null, fast: false, ms };
        return true;
      }
      const done = fast.step(deadlineMs);
      ms += performance.now() - t0;
      if (!done) return false;
      const edges = fast.result();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(edges.positions, 3));
      out = { geometry: g, srcIndex: edges.srcIndex, fast: true, ms };
      return true;
    },
    result() {
      if (!out) throw new Error("edgesGeometry: result() before the build finished");
      return out;
    },
  };
}
