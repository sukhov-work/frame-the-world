import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildFastEdges, createFastEdgesBuilder } from "../../../src/lib/globe/fastEdges";
import {
  createSegmentRunAttributor,
  csrFromRunIds,
  featureRunsOf,
  mapSegmentsToRuns,
  segmentRunsFromSources,
  vertexKeyToRunWithCollisions,
} from "../../../src/lib/globe/enrichedMask";

/**
 * T106 (2026-09-07d) — the fast crease-edge builder and the integer edge attribution.
 *
 * The contract is IDENTITY, not similarity: `buildFastEdges` must emit the same floats in the
 * same order as `new THREE.EdgesGeometry(geometry, angle)` (the visual sweep compares at
 * tolerance 0 and the per-building seat CSR indexes into this array), and
 * `segmentRunsFromSources` must attribute every segment exactly as the string-keyed
 * `mapSegmentsToRuns(vertexKeyToRunWithCollisions(...))` did — party walls included.
 */

/** A closed box (12 triangles, soup) with its base at y=0 — one building. */
function box(x0: number, z0: number, w: number, d: number, h: number, id: number) {
  const x1 = x0 + w;
  const z1 = z0 + d;
  const P = [
    [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], // bottom 0..3
    [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], // top 4..7
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom
    [4, 5, 6], [4, 6, 7], // top
    [0, 1, 5], [0, 5, 4], // front (z0)
    [1, 2, 6], [1, 6, 5], // right (x1)
    [2, 3, 7], [2, 7, 6], // back (z1)
    [3, 0, 4], [3, 4, 7], // left (x0)
  ];
  const pos: number[] = [];
  const fid: number[] = [];
  for (const f of faces) for (const v of f) { pos.push(...P[v]); fid.push(id); }
  return { pos, fid };
}

/** A gable roof (two sloped quads + two triangular gables) on top of a box footprint. */
function gable(x0: number, z0: number, w: number, d: number, h: number, ridge: number, id: number) {
  const x1 = x0 + w;
  const z1 = z0 + d;
  const zm = z0 + d / 2;
  const P = [
    [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], // eaves 0..3
    [x0, h + ridge, zm], [x1, h + ridge, zm], // ridge 4,5
  ];
  const faces = [
    [0, 1, 5], [0, 5, 4], // front slope
    [2, 3, 4], [2, 4, 5], // back slope
    [3, 0, 4], // left gable
    [1, 2, 5], // right gable
  ];
  const pos: number[] = [];
  const fid: number[] = [];
  for (const f of faces) for (const v of f) { pos.push(...P[v]); fid.push(id); }
  return { pos, fid };
}

function cell(parts: { pos: number[]; fid: number[] }[]) {
  const pos = new Float32Array(parts.flatMap((p) => p.pos));
  const fid = new Float32Array(parts.flatMap((p) => p.fid));
  return { pos, fid };
}

function threeEdges(pos: Float32Array, index: number[] | null, angle: number): Float32Array {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (index) g.setIndex(index);
  const e = new THREE.EdgesGeometry(g, angle);
  return (e.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
}

/** Fixtures: a lone box · two party-wall boxes (shared wall, identical floats) · a gable house
 *  · a box with a slightly rotated neighbour (a 20° crease under the 30° threshold) · a
 *  degenerate sliver. */
const FIXTURES: { name: string; pos: Float32Array; fid: Float32Array }[] = [
  { name: "one box", ...cell([box(0, 0, 10, 8, 12, 1)]) },
  { name: "party wall (two boxes sharing x=10)", ...cell([box(0, 0, 10, 8, 12, 1), box(10, 0, 6, 8, 9, 2)]) },
  { name: "box + gable house + a taller neighbour behind", ...cell([box(0, 0, 10, 8, 6, 1), gable(0, 0, 10, 8, 6, 3, 1), box(0, 8, 10, 5, 15, 2)]) },
  {
    name: "degenerate sliver + a box",
    ...cell([
      { pos: [0, 0, 0, 1e-5, 0, 0, 2e-5, 0, 0], fid: [9, 9, 9] }, // all three key to the same 0.1 mm cell
      box(20, 20, 4, 4, 4, 3),
    ]),
  },
];

describe("buildFastEdges ≡ THREE.EdgesGeometry (T106)", () => {
  it.each(FIXTURES.map((f) => [f.name, f]))("%s — soup: identical floats, identical order", (_n, f) => {
    for (const angle of [30, 1, 89]) {
      const want = threeEdges(f.pos, null, angle);
      const got = buildFastEdges(f.pos, null, angle);
      expect(got.positions.length).toBe(want.length);
      expect(Array.from(got.positions)).toEqual(Array.from(want));
      expect(got.srcIndex.length).toBe(got.positions.length / 3);
      // every emitted endpoint IS a copy of its source vertex
      for (let v = 0; v < got.srcIndex.length; v++) {
        const s = got.srcIndex[v];
        expect(got.positions[v * 3]).toBe(f.pos[s * 3]);
        expect(got.positions[v * 3 + 1]).toBe(f.pos[s * 3 + 1]);
        expect(got.positions[v * 3 + 2]).toBe(f.pos[s * 3 + 2]);
      }
    }
  });

  it("indexed geometry (a welded box) — identical to three, boundary-free", () => {
    const g = new THREE.BoxGeometry(4, 6, 3); // indexed, 24 verts / 36 indices
    const pos = (g.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const idx = Array.from(g.getIndex()!.array as ArrayLike<number>);
    const want = threeEdges(pos, idx, 30);
    const got = buildFastEdges(pos, idx, 30);
    expect(Array.from(got.positions)).toEqual(Array.from(want));
    expect(got.segmentCount).toBe(12); // a box has 12 crease edges
  });

  it("a soft crease under the threshold emits nothing; a hard one emits", () => {
    // two triangles sharing an edge, folded by 20° then by 40° (threshold 30°)
    const fold = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 0, 1, // flat
        1, 0, 0, 0, 0, 0, 0.5, Math.sin(a), -Math.cos(a) * 0.5, // the fold (reverse-shared edge 1→0)
      ]);
    };
    for (const deg of [20, 40]) {
      const p = fold(deg);
      const want = threeEdges(p, null, 30);
      const got = buildFastEdges(p, null, 30);
      expect(Array.from(got.positions)).toEqual(Array.from(want));
    }
  });
});

describe("createFastEdgesBuilder — the resumable form is the SAME build (T106 slice b)", () => {
  // The deferred load queue steps the builder under a frame deadline; the identity must hold no
  // matter where the resume boundaries fall. A deadline already in the past forces exactly one
  // chunk per step, and a chunk of 1 puts a boundary after EVERY vertex and EVERY triangle.
  it.each(FIXTURES.map((f) => [f.name, f]))("%s — one iteration per step ≡ one-shot ≡ three", (_n, f) => {
    for (const angle of [30, 1, 89]) {
      const want = threeEdges(f.pos, null, angle);
      const oneShot = buildFastEdges(f.pos, null, angle);
      for (const chunk of [1, 7]) {
        const b = createFastEdgesBuilder(f.pos, null, angle);
        let steps = 0;
        expect(b.done()).toBe(false);
        expect(() => b.result()).toThrow();
        while (!b.step(-Infinity, chunk)) steps++;
        expect(b.done()).toBe(true);
        const got = b.result();
        expect(Array.from(got.positions)).toEqual(Array.from(want));
        expect(Array.from(got.srcIndex)).toEqual(Array.from(oneShot.srcIndex));
        expect(got.segmentCount).toBe(oneShot.segmentCount);
        // a chunk of 1 really did resume: at least one boundary per vertex and per triangle
        if (chunk === 1) expect(steps).toBeGreaterThanOrEqual(f.pos.length / 3 + f.pos.length / 9 - 1);
        expect(b.step(-Infinity, chunk)).toBe(true); // idempotent once done
      }
    }
  });

  it("indexed geometry, resumed every triangle — identical to three", () => {
    const g = new THREE.BoxGeometry(4, 6, 3);
    const pos = (g.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const idx = Array.from(g.getIndex()!.array as ArrayLike<number>);
    const want = threeEdges(pos, idx, 30);
    const b = createFastEdgesBuilder(pos, idx, 30);
    while (!b.step(-Infinity, 1)) {
      /* one vertex / one triangle per step */
    }
    expect(Array.from(b.result().positions)).toEqual(Array.from(want));
  });

  it("a live deadline: a step that runs out of time returns false and the next one resumes", () => {
    const parts = [];
    for (let i = 0; i < 400; i++) parts.push(box((i % 20) * 12.3, Math.floor(i / 20) * 12.9, 8.2, 7.1, 6.5, i + 1));
    const f = cell(parts);
    const want = buildFastEdges(f.pos, null, 30);
    const b = createFastEdgesBuilder(f.pos, null, 30);
    let steps = 0;
    // a 0.02 ms budget per step against ~14k vertices + ~4.8k triangles: many resumes
    while (!b.step(performance.now() + 0.02, 64)) steps++;
    expect(steps).toBeGreaterThan(1);
    expect(Array.from(b.result().positions)).toEqual(Array.from(want.positions));
  });
});

describe("segmentRunsFromSources ≡ mapSegmentsToRuns over vertexKeyToRunWithCollisions (T106)", () => {
  it.each(FIXTURES.map((f) => [f.name, f]))("%s — every segment attributed identically", (_n, f) => {
    const runs = featureRunsOf(f.fid);
    const edges = buildFastEdges(f.pos, null, 30);
    const { map, collisions } = vertexKeyToRunWithCollisions(f.pos, runs);
    const want = mapSegmentsToRuns(edges.positions, map, collisions);
    const got = segmentRunsFromSources(edges.srcIndex, f.pos, runs);
    expect(Array.from(got)).toEqual(Array.from(want));
    // and the CSR built from either is the same object shape
    const a = csrFromRunIds(want, runs.length);
    const b = csrFromRunIds(got, runs.length);
    expect(Array.from(b.offsets)).toEqual(Array.from(a.offsets));
    expect(Array.from(b.verts)).toEqual(Array.from(a.verts));
  });

  it("a party wall's own edge goes to the LOWEST claimant, as before", () => {
    const f = cell([box(0, 0, 10, 8, 12, 1), box(10, 0, 6, 8, 12, 2)]); // same height: the wall's top edge is shared
    const runs = featureRunsOf(f.fid);
    const edges = buildFastEdges(f.pos, null, 30);
    const got = segmentRunsFromSources(edges.srcIndex, f.pos, runs);
    // find the segment along x=10, y=12 (the shared top edge of the party wall)
    let found = false;
    for (let s = 0; s < edges.segmentCount; s++) {
      const a = s * 2;
      const b = a + 1;
      const onWall = (v: number) => edges.positions[v * 3] === 10 && edges.positions[v * 3 + 1] === 12;
      if (onWall(a) && onWall(b)) {
        found = true;
        expect(got[a]).toBe(0);
        expect(got[b]).toBe(0);
      }
    }
    expect(found).toBe(true);
  });

  it("−0 and 0 key together (the decimal string read both as \"0\")", () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -0, 0, 0, 0, 1, 0, 0, 0, 1]);
    const fid = new Float32Array([1, 1, 1, 2, 2, 2]);
    const runs = featureRunsOf(fid);
    const edges = buildFastEdges(pos, null, 30);
    const { map, collisions } = vertexKeyToRunWithCollisions(pos, runs);
    const want = mapSegmentsToRuns(edges.positions, map, collisions);
    const got = segmentRunsFromSources(edges.srcIndex, pos, runs);
    expect(Array.from(got)).toEqual(Array.from(want));
  });
});

describe("createSegmentRunAttributor — the resumable attribution is the SAME answer (T106 slice b)", () => {
  it.each(FIXTURES.map((f) => [f.name, f]))("%s — one item per step ≡ one-shot ≡ the string path", (_n, f) => {
    const runs = featureRunsOf(f.fid);
    const edges = buildFastEdges(f.pos, null, 30);
    const { map, collisions } = vertexKeyToRunWithCollisions(f.pos, runs);
    const want = mapSegmentsToRuns(edges.positions, map, collisions);
    const oneShot = segmentRunsFromSources(edges.srcIndex, f.pos, runs);
    expect(Array.from(oneShot)).toEqual(Array.from(want));
    for (const chunk of [1, 5]) {
      const a = createSegmentRunAttributor(edges.srcIndex, f.pos, runs);
      expect(a.done()).toBe(false);
      expect(() => a.result()).toThrow();
      let steps = 0;
      while (!a.step(-Infinity, chunk)) steps++;
      expect(Array.from(a.result())).toEqual(Array.from(want));
      if (chunk === 1) expect(steps).toBeGreaterThanOrEqual(f.pos.length / 3 + runs.length + edges.segmentCount - 2);
      expect(a.step(-Infinity, chunk)).toBe(true);
    }
  });
});

describe("buildFastEdges — the cost that justified it", () => {
  it("a synthetic 20k-triangle cell: faster than THREE.EdgesGeometry (informational)", () => {
    const parts = [];
    // real cells carry full-precision metres (the baker's local frame) — not round numbers
    for (let i = 0; i < 1700; i++) {
      const x = (i % 40) * 12.3457 + Math.sin(i) * 0.731;
      const z = Math.floor(i / 40) * 12.9113 + Math.cos(i) * 0.517;
      parts.push(box(x, z, 8.217 + (i % 3) * 0.37, 7.05 + (i % 2) * 0.93, 6.5 + (i % 9) * 1.13, i + 1));
    }
    const f = cell(parts);
    const t0 = performance.now();
    const want = threeEdges(f.pos, null, 30);
    const t1 = performance.now();
    const got = buildFastEdges(f.pos, null, 30);
    const t2 = performance.now();
    expect(Array.from(got.positions)).toEqual(Array.from(want));
    const runs = featureRunsOf(f.fid);
    const t3 = performance.now();
    const { map, collisions } = vertexKeyToRunWithCollisions(f.pos, runs);
    const wantRuns = mapSegmentsToRuns(got.positions, map, collisions);
    const t4 = performance.now();
    const gotRuns = segmentRunsFromSources(got.srcIndex, f.pos, runs);
    const t5 = performance.now();
    expect(Array.from(gotRuns)).toEqual(Array.from(wantRuns));
    // eslint-disable-next-line no-console
    console.log(
      `T106 bench (${f.pos.length / 9} tris): EdgesGeometry ${(t1 - t0).toFixed(1)} ms → fast ${(t2 - t1).toFixed(1)} ms · ` +
        `string mask ${(t4 - t3).toFixed(1)} ms → int ${(t5 - t4).toFixed(1)} ms`,
    );
    expect(t2 - t1).toBeLessThan(t1 - t0);
  });
});
