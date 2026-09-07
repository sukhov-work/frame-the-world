import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildEdgesGeometry, createEdgesBuilder, positionsF32 } from "../../../src/components/globe/scene/edgesGeometry";

/**
 * 2026-09-07f — the three-side wrapper's INPUT gate. Cesium's OSM b3dm meshes arrive with an
 * INTERLEAVED Float32 position (position · normal · `_batchid` in one stride-8 buffer; read on
 * the Pixel: 11 of 11 resident OSM meshes), and the gate used to send every one of them to
 * three's `EdgesGeometry` — 361 ms of the Pixel's descent after slice (d) had made the fast
 * builder element-identical. The contract here is the same IDENTITY as `fastEdges.test`:
 * the interleaved path must emit exactly what `new THREE.EdgesGeometry(geometry, angle)` emits
 * (three de-interleaves through `toNonIndexed` / `fromBufferAttribute` — the same floats).
 */

/** A closed box (8 vertices, 12 indexed triangles) with its base at y=0. */
function box(x0: number, z0: number, w: number, d: number, h: number) {
  const x1 = x0 + w;
  const z1 = z0 + d;
  const P = [
    [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],
    [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return { P, faces };
}

/** Several boxes as ONE indexed mesh (a b3dm tile): distinct vertices per box, Uint16 index. */
function tile(boxes: { P: number[][]; faces: number[][] }[]) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    const base = pos.length / 3;
    for (const p of b.P) pos.push(...p);
    for (const f of b.faces) idx.push(base + f[0], base + f[1], base + f[2]);
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}

/** The b3dm layout: position(3) + normal(3) + _batchid(1) + pad(1) interleaved, stride 8. */
function interleaved(pos: Float32Array, idx: Uint16Array): THREE.BufferGeometry {
  const n = pos.length / 3;
  const STRIDE = 8;
  const data = new Float32Array(n * STRIDE);
  for (let i = 0; i < n; i++) {
    data[i * STRIDE] = pos[i * 3];
    data[i * STRIDE + 1] = pos[i * 3 + 1];
    data[i * STRIDE + 2] = pos[i * 3 + 2];
    data[i * STRIDE + 3] = 0; // normal (unused by the edges)
    data[i * STRIDE + 4] = 1;
    data[i * STRIDE + 5] = 0;
    data[i * STRIDE + 6] = Math.floor(i / 8); // batch id
    data[i * STRIDE + 7] = 12345.678; // padding noise — must never leak into a position
  }
  const buf = new THREE.InterleavedBuffer(data, STRIDE);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 3, 0, false));
  g.setAttribute("normal", new THREE.InterleavedBufferAttribute(buf, 3, 3, false));
  g.setAttribute("_batchid", new THREE.InterleavedBufferAttribute(buf, 1, 6, false));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function plain(pos: Float32Array, idx: Uint16Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const positionsOf = (g: THREE.BufferGeometry): Float32Array => (g.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;

const TILE = tile([box(0, 0, 10, 8, 12), box(10, 0, 6, 8, 9), box(30.25, -4.5, 3, 3, 40)]);
const ANGLE = 30;

describe("edgesGeometry — the interleaved (OSM b3dm) input", () => {
  it("positionsF32 de-interleaves the exact floats (and reads a plain attribute in place)", () => {
    const g = interleaved(TILE.pos, TILE.idx);
    const out = positionsF32(g);
    expect(out).not.toBeNull();
    expect(out).toEqual(TILE.pos);
    const p = plain(TILE.pos, TILE.idx);
    expect(positionsF32(p)).toBe(TILE.pos); // same array object — no copy for the baked cells
  });

  it("takes the FAST path on an interleaved Float32 position and is element-identical to three", () => {
    const g = interleaved(TILE.pos, TILE.idx);
    const ref = positionsOf(new THREE.EdgesGeometry(interleaved(TILE.pos, TILE.idx), ANGLE));
    const b = buildEdgesGeometry(g, ANGLE);
    expect(b.fast).toBe(true);
    expect(b.srcIndex).not.toBeNull();
    expect(ref.length).toBeGreaterThan(0);
    expect(positionsOf(b.geometry)).toEqual(ref);
    // and the same as the plain-attribute build of the same floats
    const p = buildEdgesGeometry(plain(TILE.pos, TILE.idx), ANGLE);
    expect(positionsOf(b.geometry)).toEqual(positionsOf(p.geometry));
    expect(b.allocMs).toBeGreaterThanOrEqual(0);
  });

  it("the resumable builder, one step at a time, emits the same edges for the interleaved input", () => {
    const g = interleaved(TILE.pos, TILE.idx);
    const ref = positionsOf(new THREE.EdgesGeometry(interleaved(TILE.pos, TILE.idx), ANGLE));
    const builder = createEdgesBuilder(g, ANGLE);
    let steps = 0;
    while (!builder.step(-Infinity)) steps++; // a deadline already past: one chunk per step
    const r = builder.result();
    expect(r.fast).toBe(true);
    expect(positionsOf(r.geometry)).toEqual(ref);
    expect(steps).toBeGreaterThanOrEqual(0);
  });

  it("a normalized (quantized) position still takes three's own path and says so", () => {
    const n = TILE.pos.length / 3;
    const q = new Int16Array(n * 3);
    for (let i = 0; i < q.length; i++) q[i] = Math.round((TILE.pos[i] / 64) * 32767);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q, 3, true));
    g.setIndex(new THREE.BufferAttribute(TILE.idx, 1));
    expect(positionsF32(g)).toBeNull();
    const b = buildEdgesGeometry(g, ANGLE);
    expect(b.fast).toBe(false);
    expect(b.srcIndex).toBeNull();
    const ref = positionsOf(new THREE.EdgesGeometry(g, ANGLE));
    expect(positionsOf(b.geometry)).toEqual(ref);
  });
});
