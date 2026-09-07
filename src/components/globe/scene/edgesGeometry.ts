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
 */
import * as THREE from "three";
import { buildFastEdges } from "../../../lib/globe/fastEdges";

export interface EdgesBuild {
  geometry: THREE.BufferGeometry;
  /** Per edge vertex, the source vertex index — null when three's own path was taken. */
  srcIndex: Int32Array | null;
  /** DEV ledger: which path ran and how long it took (ms). */
  fast: boolean;
  ms: number;
}

export function buildEdgesGeometry(geometry: THREE.BufferGeometry, thresholdAngle: number): EdgesBuild {
  const t0 = performance.now();
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const plain =
    !!attr &&
    !(attr as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    !attr.normalized &&
    attr.array instanceof Float32Array;
  if (!plain) {
    const g = new THREE.EdgesGeometry(geometry, thresholdAngle);
    return { geometry: g, srcIndex: null, fast: false, ms: performance.now() - t0 };
  }
  const index = geometry.getIndex();
  const edges = buildFastEdges(attr.array as Float32Array, index ? (index.array as ArrayLike<number>) : null, thresholdAngle);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(edges.positions, 3));
  return { geometry: g, srcIndex: edges.srcIndex, fast: true, ms: performance.now() - t0 };
}
