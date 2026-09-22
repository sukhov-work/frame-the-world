import { describe, expect, it } from "vitest";
import { fpvClearance, solidsFromColumn, type ColumnHit } from "../../../src/lib/globe/fpvClearance";

const top = (hM: number): ColumnHit => ({ hM, up: true });
const under = (hM: number): ColumnHit => ({ hM, up: false });
const BODY = 1.7;
const STEP = 0.35;
const onGround = (eyeM: number, hits: ColumnHit[]) => fpvClearance(hits, { eyeM, bodyM: BODY, standingOnM: null, stepM: STEP });
const onMesh = (eyeM: number, standingOnM: number, hits: ColumnHit[]) =>
  fpvClearance(hits, { eyeM, bodyM: BODY, standingOnM, stepM: STEP });

describe("solidsFromColumn — the crossings fold into solids, highest first (owner 2026-09-22 FPV item 3)", () => {
  it("an extruded building (a roof, no floor) is a solid standing on the ground", () => {
    expect(solidsFromColumn([top(130)])).toEqual([{ loM: -Infinity, hiM: 130 }]);
  });
  it("a bridge deck is a thin slab: top + underside", () => {
    expect(solidsFromColumn([under(105), top(105.4)])).toEqual([{ loM: 105, hiM: 105.4 }]);
  });
  it("a three-storey car park is three slabs; a floor's up-face inside a solid does not split it", () => {
    const s = solidsFromColumn([top(110), under(109.7), top(107), under(106.7), top(104), under(103.7), top(100.2)]);
    expect(s).toEqual([
      { loM: 109.7, hiM: 110 },
      { loM: 106.7, hiM: 107 },
      { loM: 103.7, hiM: 104 },
      { loM: -Infinity, hiM: 100.2 },
    ]);
    // a second top INSIDE a solid (a mezzanine floor) is absorbed
    expect(solidsFromColumn([top(130), top(115), under(100)])).toEqual([{ loM: 100, hiM: 130 }]);
  });
  it("order of arrival does not matter; junk heights are dropped; a stray underside is ignored", () => {
    expect(solidsFromColumn([under(105), top(105.4)])).toEqual(solidsFromColumn([top(105.4), under(105)]));
    expect(solidsFromColumn([top(NaN), under(Infinity), top(120)])).toEqual([{ loM: -Infinity, hiM: 120 }]);
    expect(solidsFromColumn([under(90)])).toEqual([]);
  });
});

describe("fpvClearance — inside a mesh → lift the feet onto its top; otherwise the surface under the feet", () => {
  it("walking into a building at street level: inside — stand on the roof", () => {
    const v = onGround(101.7, [top(130)]);
    expect(v).toEqual({ inside: true, standOnM: 130 });
  });
  it("a pin dropped inside a building: the same verdict on the entry frame", () => {
    expect(onGround(100 + BODY, [top(124.5)])).toEqual({ inside: true, standOnM: 124.5 });
  });
  it("under a bridge deck: NOT inside (the slab is above the head), on the ground", () => {
    expect(onGround(101.7, [top(105.4), under(105)])).toEqual({ inside: false, standOnM: null });
  });
  it("wading into a parked car (a closed body): inside — stand on its bonnet", () => {
    expect(onGround(101.7, [top(101.5), under(100.3)])).toEqual({ inside: true, standOnM: 101.5 });
  });
  it("hovering 50 m over a roof is not inside the building below (the body is the 1.7 m under the eye)", () => {
    expect(onGround(150, [top(130)])).toEqual({ inside: false, standOnM: null });
  });
  it("standing on the roof: the roof is under the feet, not inside", () => {
    expect(onMesh(131.7, 130, [top(130)])).toEqual({ inside: false, standOnM: 130 });
  });
  it("moving UP through a car park: the eye inside a slab → the next layer; above the slab → standing on it", () => {
    const park = [top(110), under(109.7), top(107), under(106.7), top(104), under(103.7)];
    // the body [104.3, 106] crosses the 106.7–107 slab? no — first the slab must be reached
    expect(onMesh(106, 104, park)).toEqual({ inside: false, standOnM: 104 });
    // the eye rose to 108: the body [106.3, 108] overlaps the 106.7–107 slab → onto its top
    expect(onMesh(108, 104, park)).toEqual({ inside: true, standOnM: 107 });
    // standing on 107, rising again to 111: overlaps the 109.7–110 slab → its top
    expect(onMesh(111, 107, park)).toEqual({ inside: true, standOnM: 110 });
    // on the top deck nothing is above
    expect(onMesh(111.7, 110, park)).toEqual({ inside: false, standOnM: 110 });
  });
  it("walking off a roof edge: the top under the feet is now the lower roof, then the ground", () => {
    expect(onMesh(131.7, 130, [top(112)])).toEqual({ inside: false, standOnM: 112 });
    expect(onMesh(131.7, 130, [])).toEqual({ inside: false, standOnM: null });
  });
  it("on the terrain a kerb the feet are IN is stepped onto; one just under the feet is stood on; a roof far below is not", () => {
    expect(onGround(101.7, [top(100.2)])).toEqual({ inside: true, standOnM: 100.2 }); // the body overlaps it
    expect(onGround(101.7, [top(99.8)])).toEqual({ inside: false, standOnM: 99.8 }); // within stepM under the feet
    expect(onGround(101.7, [top(95)])).toEqual({ inside: false, standOnM: null });
  });
  it("two overlapping solids: the highest top wins (the next frame's column finds the next layer)", () => {
    expect(onGround(101.7, [top(101.2), under(100.5), top(130)])).toEqual({ inside: true, standOnM: 130 });
  });
});
