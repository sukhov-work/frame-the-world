import { describe, expect, it } from "vitest";
import {
  addCanopy,
  addFloatingSolid,
  cellAtEnu,
  cellEast,
  cellIndexAt,
  cellNorth,
  createLocalDsm,
  discGridSpec,
  dsmBytes,
  enuFrameAt,
  enuOfLonLat,
  groundCoverage,
  insideSolidInterior,
  lonLatOfEnu,
  oddSpanCells,
  rasterizeTinGround,
  sealDsm,
  srcName,
  stampSolid,
  SRC_BUILDING,
  SRC_DECK,
  SRC_NONE,
  SRC_TERRAIN,
  SRC_TREE,
  type EnuFrame,
} from "../../../src/lib/geo/localDsm";
import { R_MEAN_M } from "../../../src/lib/geo/horizonProfile";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";

/** Column-major identity (three `Matrix4.elements`) — the TIN is already in the frame's coords. */
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A FLAT-EARTH frame: ECEF axes are ENU axes. Paired with `earthRadiusM: Infinity` this is the only
 *  setup in which "the barycentric interpolation is EXACT" is a statement about interpolation and not
 *  about the 0.028 m curvature term. */
const FLAT: EnuFrame = {
  originEcef: [0, 0, 0],
  east: [1, 0, 0],
  north: [0, 1, 0],
  up: [0, 0, 1],
};

/** Two triangles covering `[-half, half]²` at heights from `plane`, as a non-indexed position array. */
function planeTin(half: number, plane: (e: number, n: number) => number): Float64Array {
  const c: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, -half],
    [half, half],
    [-half, half],
  ];
  const out = new Float64Array(c.length * 3);
  c.forEach(([e, n], i) => {
    out[i * 3] = e;
    out[i * 3 + 1] = n;
    out[i * 3 + 2] = plane(e, n);
  });
  return out;
}

describe("localDsm — grid geometry", () => {
  it("discGridSpec matches the two grids the plan budgets against (201² @ 3 m, 601² @ 1 m)", () => {
    expect(discGridSpec(300, 3)).toMatchObject({ nx: 201, ny: 201, originE: -300, originN: -300 });
    expect(discGridSpec(300, 1)).toMatchObject({ nx: 601, ny: 601, originE: -300, originN: -300 });
    // ODD counts: the centre pin must land on a cell CENTRE — it is the cell the owner stands on and
    // the one the plumb line is drawn through.
    expect(discGridSpec(300, 3).nx % 2).toBe(1);
    const dsm = createLocalDsm(discGridSpec(300, 3));
    expect(cellIndexAt(dsm, 100, 100)).toBe(100 * 201 + 100);
    expect(dsm.originE + 100 * dsm.cellM).toBe(0);
    // The same claim through the PUBLIC helper, so the assertion above cannot pass while the accessor
    // the solver actually calls disagrees with the field it reads.
    expect(cellEast(dsm, 100)).toBe(0);
  });

  /**
   * The ENU↔cell addressing pair is the solver's only route between the two coordinate systems it
   * straddles: `cellAtEnu` answers "which cell is the owner standing in" (the pin), `cellEast`/
   * `cellNorth` answer "where on the ground is this cell" (the score sheet's texel centres). They are
   * inverses by construction, and this is the ONLY test that says so — the grid test above pins the
   * origin FIELD, which a broken accessor can satisfy while still mirroring the disc.
   *
   * Every assertion here is off-centre on purpose. An axis flip (`originE − ix·cellM`) and a row/column
   * transposition both leave the CENTRE cell exactly where it was, so a centre-only check is one of the
   * checks that cannot fail: it would pass against a disc mirrored east-west.
   */
  it("cellEast/cellNorth/cellAtEnu are exact inverses — a mirrored axis survives a centre-only check", () => {
    const dsm = createLocalDsm(discGridSpec(300, 3));

    // Cell → ENU. +ix is EAST and +iy is NORTH; a sign flip reads −603 here.
    expect(cellEast(dsm, 101)).toBe(3);
    expect(cellNorth(dsm, 99)).toBe(-3);

    // ENU → cell, asserted against the flat index ARITHMETIC rather than against cellIndexAt, so the
    // row-major layout (iy·nx + ix) is pinned too and the pair cannot agree by being wrong together.
    expect(cellAtEnu(dsm, 0, 0)).toBe(100 * 201 + 100);
    expect(cellAtEnu(dsm, 150, -60)).toBe(80 * 201 + 150);

    // The round trip, including all four rim corners — where a half-cell origin slip shows first.
    for (const [ix, iy] of [
      [0, 0],
      [200, 0],
      [0, 200],
      [200, 200],
      [137, 42],
    ] as const) {
      expect(cellAtEnu(dsm, cellEast(dsm, ix), cellNorth(dsm, iy))).toBe(cellIndexAt(dsm, ix, iy));
    }

    // NEAREST cell, not floor: 1.4 m is inside the centre cell's own 3 m footprint (half-cell = 1.5 m).
    // Under `Math.floor` the north index would drop to 99 and every pin would sit a cell south of the
    // owner.
    expect(cellAtEnu(dsm, 1.4, -1.4)).toBe(100 * 201 + 100);

    // Outside the disc is −1, NEVER a clamped rim cell — clamping would smear an off-grid pin onto the
    // edge and score it as if someone had surveyed there.
    expect(cellAtEnu(dsm, 1e4, 0)).toBe(-1);
    expect(cellAtEnu(dsm, 0, -1e4)).toBe(-1);
  });

  it("rejects a degenerate grid rather than allocating a zero-cell DSM", () => {
    expect(() => createLocalDsm({ nx: 0, ny: 4, cellM: 3 })).toThrow();
    expect(() => createLocalDsm({ nx: 4, ny: 4, cellM: 0 })).toThrow();
  });

  /**
   * `oddSpanCells` is the grid-parity rule BOTH rasters of the disc share — this one and
   * `landcoverRaster.makeLandGrid`. Until 2026-08-24 the landcover grid used
   * `ceil(2·halfSpan/cellM)` instead, which is EVEN for every 1 m spec, so the SAME disc centre was a
   * cell centre here and a cell CORNER there. The rule now has one home, and this is its pin.
   */
  it("PIN: oddSpanCells is odd for every rung of §8's ladder, and covers at least the span asked for", () => {
    let shippedEven = 0;
    for (const cellM of [1, 3, 6]) {
      for (const radiusM of [100, 200, 300, 400, 500]) {
        for (const halfSpanM of [radiusM, radiusM + 400]) {
          const n = oddSpanCells(halfSpanM, cellM);
          const label = `${halfSpanM} m @ ${cellM} m`;
          expect(n % 2, label).toBe(1);
          expect(n * cellM, label).toBeGreaterThanOrEqual(2 * halfSpanM);
          // The middle index sits exactly on the frame origin — that IS what odd buys.
          const spec = discGridSpec(halfSpanM, cellM);
          expect(spec.nx, label).toBe(n);
          expect(cellEast(createLocalDsm(spec), (n - 1) / 2), label).toBe(0);
          // NEGATIVE CONTROL — the count the landcover grid used to compute.
          if (Math.ceil((2 * halfSpanM) / cellM) % 2 === 0) shippedEven++;
        }
      }
    }
    expect(shippedEven).toBe(23); // 23 of 30 canonical specs came out even ⇒ centre on a corner
  });
});

/**
 * ONE FRAME PER SITE. `enuFrameAt` / `enuOfLonLat` / `lonLatOfEnu` exist so the landcover raster can
 * project MVT rings into the SAME frame this module puts every TIN vertex in. Before 2026-08-24 it
 * used the equirectangular idiom (`Δlon·111_320·cos φ`) — a systematically different frame, off by
 * ~1 m at 500 m and ~1.4 m at the 700 m collar at Dnipro, against a mask the plan advertises at 1 m.
 */
describe("localDsm — the geodetic ↔ ENU pair the landcover raster borrows", () => {
  const LAT = 48.4647;
  const LON = 35.0462;
  const frame = enuFrameAt(LAT, LON);

  it("enuFrameAt IS geodeticToEcef + enuBasis — the frame is never re-derived", () => {
    const b = enuBasis(LAT, LON);
    expect(frame.originEcef).toEqual(geodeticToEcef(LAT, LON, 0));
    expect(frame.east).toEqual(b.east);
    expect(frame.north).toEqual(b.north);
    expect(frame.up).toEqual(b.up);
    // The optional altitude lifts the ORIGIN along `up` and leaves the basis alone.
    const lifted = enuFrameAt(LAT, LON, 50);
    const d = [0, 1, 2].map((i) => lifted.originEcef[i] - frame.originEcef[i]);
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(50, 6);
    expect(lifted.east).toEqual(frame.east);
  });

  it("PIN: the round trip is exact to ≪ 1 mm at the 700 m collar, where 111_320 misses by metres", () => {
    const M_PER_DEG_LAT = 111_320; // the shipped constant, reproduced as a NEGATIVE CONTROL
    const kLon = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);
    let worst = 0;
    let worstShipped = 0;
    for (const [e, n] of [
      [500, 0],
      [0, 500],
      [-500, -500],
      [1000, 0],
      [700, 700],
      [0, 700],
    ] as const) {
      const g = lonLatOfEnu(frame, e, n);
      const [be, bn] = enuOfLonLat(frame, g.lonDeg, g.latDeg);
      worst = Math.max(worst, Math.hypot(be - e, bn - n));
      const se = (g.lonDeg - LON) * kLon;
      const sn = (g.latDeg - LAT) * M_PER_DEG_LAT;
      worstShipped = Math.max(worstShipped, Math.hypot(se - e, sn - n));
    }
    expect(worst).toBeLessThan(1e-3);
    // 111_320 vs the true 111_199 m/deg lat and 73_810 vs 73_952 m/deg lon at this latitude: a scale
    // bias, so it grows with range — 0.94 m at 500 m east, 1.87 m at 1 km.
    expect(worstShipped).toBeGreaterThan(1.8);
  });

  it("PIN: the projection is ANTIMERIDIAN-safe by construction — there is no Δlon to forget to wrap", () => {
    const seam = enuFrameAt(66, 179.999);
    const g = lonLatOfEnu(seam, 222, 0);
    expect(g.lonDeg).toBeLessThan(-179.9); // the other side of ±180
    const [e, n] = enuOfLonLat(seam, g.lonDeg, g.latDeg);
    expect(e).toBeCloseTo(222, 6);
    expect(n).toBeCloseTo(0, 6);
    // NEGATIVE CONTROL — differencing raw longitudes, which is what the subtracted form did.
    expect((g.lonDeg - 179.999) * 111_320 * Math.cos((66 * Math.PI) / 180)).toBeLessThan(-16_000_000);
  });

  it("PIN: a geodetic point lands in the cell a rasterized TIN vertex lands in — ONE lattice", () => {
    // The registration claim in its strongest form: `enuOfLonLat` (the landcover raster's route into
    // the frame) and `rasterizeTinGround`'s ECEF→ENU dots (the terrain raster's route) must resolve
    // the same geodetic point to the same cell, or the mask and the obstruction field disagree about
    // which square metre the owner is standing on.
    const ALT = 137; // a nonzero height, so the sphere-datum rebase (pin 5) is exercised too
    const dsm = createLocalDsm(discGridSpec(300, 3));
    const tri: number[] = [];
    for (const [de, dn] of [
      [-25, -25],
      [25, -25],
      [0, 25],
    ] as const) {
      const g = lonLatOfEnu(frame, 150 + de, -60 + dn);
      tri.push(...geodeticToEcef(g.latDeg, g.lonDeg, ALT));
    }
    expect(rasterizeTinGround(dsm, Float64Array.from(tri), null, I4, frame, {})).toBeGreaterThan(0);

    const g = lonLatOfEnu(frame, 150, -60);
    const [e, n] = enuOfLonLat(frame, g.lonDeg, g.latDeg);
    const cell = cellAtEnu(dsm, e, n);
    expect(cell).toBe(cellAtEnu(dsm, 150, -60));
    expect(cell).toBe(cellIndexAt(dsm, 100 + 50, 100 - 20)); // 150 m east, 60 m south at 3 m pitch
    expect(dsm.groundKnown[cell]).toBe(1);
    expect(dsm.ground[cell]).toBeCloseTo(ALT, 2);
    // …and nothing far away was touched: this is a 50 m triangle, not a smear.
    expect(dsm.groundKnown[cellAtEnu(dsm, 0, 0)]).toBe(0);
    expect(groundCoverage(dsm)).toBeLessThan(0.01);
  });
});

/**
 * PIN 6a — the barycentric ground.
 *
 * `planFeed` gets terrain from `ground.heightAt`, a full `three.Raycaster.intersectObjects` measured at
 * 18–58 µs/ray (F1); a 300 m disc at 1 m is 282,743 cells, i.e. 7.4–16.4 s of raycasting for a field
 * that has to re-solve under a slider. This test fails if the interpolation is ever replaced by
 * nearest-vertex sampling, by a raster of triangle centroids, or by a raycast stub.
 */
describe("localDsm — TIN by barycentric interpolation, not raycasts (F1)", () => {
  it("PIN: a synthetic TIN of a known PLANE interpolates EXACTLY at every covered cell", () => {
    const plane = (e: number, n: number) => 0.3 * e - 0.2 * n + 12;
    const dsm = createLocalDsm({ nx: 41, ny: 41, cellM: 5, originE: -100, originN: -100 });
    const writes = rasterizeTinGround(dsm, planeTin(150, plane), null, I4, FLAT, {
      earthRadiusM: Infinity,
    });
    expect(writes).toBeGreaterThan(0);
    expect(groundCoverage(dsm)).toBe(1);
    for (let iy = 0; iy < 41; iy++) {
      for (let ix = 0; ix < 41; ix++) {
        const c = iy * 41 + ix;
        const want = plane(-100 + ix * 5, -100 + iy * 5);
        expect(dsm.ground[c]).toBeCloseTo(want, 4);
      }
    }
    // Nearest-vertex sampling would quantise to the 6 TIN vertex heights; a centroid raster would be
    // constant per triangle. Both give ≤ 6 distinct values; a true interpolation gives hundreds.
    expect(new Set(Array.from(dsm.ground)).size).toBeGreaterThan(100);
  });

  it("PIN: a cell outside every triangle reports NO GROUND — NaN and known=0, never 0 m", () => {
    const dsm = createLocalDsm({ nx: 21, ny: 21, cellM: 10, originE: -100, originN: -100 });
    // One triangle covering only the south-west quadrant.
    const tri = new Float64Array([-100, -100, 7, 0, -100, 7, -100, 0, 7]);
    rasterizeTinGround(dsm, tri, null, I4, FLAT, { earthRadiusM: Infinity });

    const inside = cellIndexAt(dsm, 2, 2); // (-80,-80): inside the triangle
    expect(dsm.groundKnown[inside]).toBe(1);
    expect(dsm.ground[inside]).toBeCloseTo(7, 5);

    const outside = cellIndexAt(dsm, 18, 18); // (+80,+80): covered by nothing
    expect(dsm.groundKnown[outside]).toBe(0);
    expect(Number.isNaN(dsm.ground[outside])).toBe(true);
    // The whole point: 0 is a PLAUSIBLE height (it is the Dnipro's own water level), so a zero-filled
    // grid launders "never surveyed" into "flat ground at river level".
    expect(dsm.ground[outside]).not.toBe(0);

    sealDsm(dsm);
    expect(Number.isNaN(dsm.surfaceTop[outside])).toBe(true);
    expect(dsm.surfaceSrc[outside]).toBe(SRC_NONE);
    expect(groundCoverage(dsm)).toBeGreaterThan(0);
    expect(groundCoverage(dsm)).toBeLessThan(0.5);
  });

  it("skips near-vertical SKIRT triangles instead of smearing a tile edge across the grid", () => {
    const dsm = createLocalDsm({ nx: 11, ny: 11, cellM: 10, originE: -50, originN: -50 });
    // A vertical skirt: three vertices sharing one plan-view line ⇒ zero plan area.
    const skirt = new Float64Array([-50, 0, 0, 50, 0, 0, 0, 0, -30]);
    expect(rasterizeTinGround(dsm, skirt, null, I4, FLAT, { earthRadiusM: Infinity })).toBe(0);
    expect(groundCoverage(dsm)).toBe(0);
  });

  it("merges overlapping TIN LODs by MAX, so tile arrival order cannot change the bytes", () => {
    const lo = planeTin(60, () => 10);
    const hi = planeTin(60, () => 25);
    const a = createLocalDsm({ nx: 9, ny: 9, cellM: 10, originE: -40, originN: -40 });
    rasterizeTinGround(a, lo, null, I4, FLAT, { earthRadiusM: Infinity });
    rasterizeTinGround(a, hi, null, I4, FLAT, { earthRadiusM: Infinity });
    const b = createLocalDsm({ nx: 9, ny: 9, cellM: 10, originE: -40, originN: -40 });
    rasterizeTinGround(b, hi, null, I4, FLAT, { earthRadiusM: Infinity });
    rasterizeTinGround(b, lo, null, I4, FLAT, { earthRadiusM: Infinity });
    expect(Array.from(a.ground)).toEqual(Array.from(b.ground));
    expect(a.ground[40]).toBeCloseTo(25, 5); // max, not last-wins
  });

  it("reads INDEXED geometry the same way it reads non-indexed", () => {
    const verts = new Float64Array([-50, -50, 3, 50, -50, 3, 50, 50, 3, -50, 50, 3]);
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const dsm = createLocalDsm({ nx: 11, ny: 11, cellM: 10, originE: -50, originN: -50 });
    rasterizeTinGround(dsm, verts, idx, I4, FLAT, { earthRadiusM: Infinity });
    expect(groundCoverage(dsm)).toBe(1);
    expect(dsm.ground[60]).toBeCloseTo(3, 5);
  });
});

/**
 * The trap nobody would see: ENU `up` ALREADY carries the earth's fall-away, and the sweep subtracts
 * `d²(1−k)/2R` on top of it. At 600 m the two terms are 0.0283 m and 0.0246 m — the same size. If
 * `ground` were stored as raw ENU `u`, every distant cell would be pushed down by very nearly a second
 * full curvature drop and the far skyline would read systematically low. `azAltOfEcef` records the twin
 * of this rule from the other side ("ECEF→ENU is EXACT geometry … only the refraction lift is added").
 */
describe("localDsm — ENU up is not height above the sphere (do not count curvature twice)", () => {
  const LAT = 48.4647;
  const LON = 35.0462;
  const ALT = 50;

  function shellTin(halfM: number, steps: number): Float64Array {
    const degLat = (180 / Math.PI / R_MEAN_M) * (halfM / steps);
    const degLon = degLat / Math.cos((LAT * Math.PI) / 180);
    const out: number[] = [];
    const at = (i: number, j: number) =>
      geodeticToEcef(LAT + (i - steps) * degLat, LON + (j - steps) * degLon, ALT);
    for (let i = 0; i < steps * 2; i++) {
      for (let j = 0; j < steps * 2; j++) {
        const p00 = at(i, j);
        const p10 = at(i + 1, j);
        const p11 = at(i + 1, j + 1);
        const p01 = at(i, j + 1);
        out.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
      }
    }
    return Float64Array.from(out);
  }

  it("PIN: a spherical shell 50 m up rasterizes to a CONSTANT 50 m, not to 50 − r²/2R", () => {
    const basis = enuBasis(LAT, LON);
    const frame: EnuFrame = enuFrameAt(LAT, LON); // the ONE constructor — not a fourth hand-built copy
    const dsm = createLocalDsm(discGridSpec(600, 50)); // 25×25 over ±600 m
    rasterizeTinGround(dsm, shellTin(800, 8), null, I4, frame, {});
    expect(groundCoverage(dsm)).toBe(1);
    for (let c = 0; c < dsm.cellCount; c++) expect(dsm.ground[c]).toBeCloseTo(ALT, 2);

    // The size of the term this test defends: the raw ENU `up` of the corner vertex really is ~28 mm
    // BELOW the tangent plane, i.e. 10× the 0.003 m band asserted above.
    const corner = geodeticToEcef(
      LAT + ((180 / Math.PI / R_MEAN_M) * 600) / 1,
      LON,
      ALT,
    );
    const du =
      (corner[0] - frame.originEcef[0]) * basis.up[0] +
      (corner[1] - frame.originEcef[1]) * basis.up[1] +
      (corner[2] - frame.originEcef[2]) * basis.up[2];
    expect(ALT - du).toBeGreaterThan(0.02);
    expect(ALT - du).toBeLessThan(0.04);
  });
});

describe("localDsm — solids resting on the ground", () => {
  function flatDsm(nx = 21, cellM = 5): ReturnType<typeof createLocalDsm> {
    const dsm = createLocalDsm({ nx, ny: nx, cellM, originE: -50, originN: -50 });
    dsm.ground.fill(4);
    dsm.groundKnown.fill(1);
    return dsm;
  }

  it("scanline-fills a footprint at cell CENTRES and rides the terrain in the aboveGround datum", () => {
    const dsm = flatDsm();
    const stamped = stampSolid(dsm, {
      ring: [-12, -12, 12, -12, 12, 12, -12, 12],
      baseM: 0,
      topM: 30,
      datum: "aboveGround",
    });
    expect(stamped).toBe(25); // 5×5 cell centres inside a 24 m box at 5 m pitch
    const c = cellIndexAt(dsm, 10, 10);
    expect(dsm.solidMask[c]).toBe(1);
    expect(dsm.solidBase[c]).toBeCloseTo(4, 5); // ground + render_min_height
    expect(dsm.solidTop[c]).toBeCloseTo(34, 5); // ground + render_height
    expect(dsm.solidMask[cellIndexAt(dsm, 0, 0)]).toBe(0);
  });

  it("a vertex landing exactly on a scanline is counted ONCE (no even-odd stripe)", () => {
    const dsm = flatDsm(11, 10); // rows at n = −50, −40 … +50
    // Ring vertices at n = −20 and n = +20, exactly on two scanlines. Naive even-odd counts BOTH
    // endpoints of the horizontal edges there, gets 4 crossings, and fills only [x1,x2] — a stripe.
    stampSolid(dsm, {
      ring: [-25, -20, 25, -20, 25, 20, -25, 20],
      baseM: 0,
      topM: 10,
      datum: "aboveGround",
    });
    // Half-open in N: the BOTTOM edge belongs to this polygon, the TOP edge belongs to its neighbour,
    // so a shared boundary is stamped exactly once across two abutting rings.
    for (let iy = 3; iy <= 6; iy++) {
      expect(dsm.solidMask[cellIndexAt(dsm, 5, iy)]).toBe(1);
    }
    expect(dsm.solidMask[cellIndexAt(dsm, 5, 7)]).toBe(0);
    expect(dsm.solidMask[cellIndexAt(dsm, 5, 2)]).toBe(0);
    // And the full span is filled, not a stripe: every column inside the ring's east/west edges
    // (e ∈ [−25, 25] ⇒ ix 3…7 at a 10 m pitch from e = −50).
    for (let ix = 3; ix <= 7; ix++) expect(dsm.solidMask[cellIndexAt(dsm, ix, 4)]).toBe(1);
    expect(dsm.solidMask[cellIndexAt(dsm, 2, 4)]).toBe(0);
    expect(dsm.solidMask[cellIndexAt(dsm, 8, 4)]).toBe(0);
  });

  it("overlapping stamps merge base by MIN and top by MAX — a split building is one mass", () => {
    const dsm = flatDsm();
    const ring = [-6, -6, 6, -6, 6, 6, -6, 6];
    stampSolid(dsm, { ring, baseM: 10, topM: 20, datum: "absolute" });
    stampSolid(dsm, { ring, baseM: 3, topM: 14, datum: "absolute" });
    const c = cellIndexAt(dsm, 10, 10);
    expect(dsm.solidBase[c]).toBeCloseTo(3, 5);
    expect(dsm.solidTop[c]).toBeCloseTo(20, 5);
  });

  it("the ABSOLUTE datum does not re-base enriched seats onto interpolated terrain", () => {
    const dsm = flatDsm();
    stampSolid(dsm, {
      ring: [-6, -6, 6, -6, 6, 6, -6, 6],
      baseM: 100,
      topM: 140,
      datum: "absolute",
    });
    const c = cellIndexAt(dsm, 10, 10);
    expect(dsm.solidBase[c]).toBeCloseTo(100, 5); // NOT 104
    expect(dsm.solidTop[c]).toBeCloseTo(140, 5);
  });

  it("aboveGround stamps refuse cells with no terrain — '10 m above nothing' is not a height", () => {
    const dsm = flatDsm();
    dsm.ground.fill(Number.NaN);
    dsm.groundKnown.fill(0);
    expect(
      stampSolid(dsm, {
        ring: [-12, -12, 12, -12, 12, 12, -12, 12],
        baseM: 0,
        topM: 30,
        datum: "aboveGround",
      }),
    ).toBe(0);
  });

  it("insideSolidInterior is owner ruling R1's aerial gate: interior yes, roof and below no", () => {
    const dsm = flatDsm();
    stampSolid(dsm, {
      ring: [-12, -12, 12, -12, 12, 12, -12, 12],
      baseM: 6,
      topM: 30,
      datum: "aboveGround",
    });
    const c = cellIndexAt(dsm, 10, 10);
    expect(insideSolidInterior(dsm, c, 5)).toBe(false); // under the overhang
    expect(insideSolidInterior(dsm, c, 6)).toBe(true); // render_min_height ≤ h
    expect(insideSolidInterior(dsm, c, 29.9)).toBe(true);
    expect(insideSolidInterior(dsm, c, 30)).toBe(false); // h < render_height is EXCLUSIVE: on the roof
    expect(insideSolidInterior(dsm, cellIndexAt(dsm, 0, 0), 10)).toBe(false);
  });

  /**
   * **THE ONE DATUM.** `heightAboveGroundM` is ABOVE THIS CELL'S GROUND; `solidBase`/`solidTop` are
   * ABSOLUTE (height above the local sphere). The rebase lives here and nowhere else — which is why
   * `landcoverRaster.accessAt` now takes this function's BOOLEAN instead of the pair.
   *
   * The ground is 100 m ON PURPOSE. At ground 0 the two datums coincide and every assertion below
   * passes against the bug: that is the check that could not fail, and it is exactly the reason R1's
   * only aerial gate shipped switched off.
   */
  it("PIN: THE DATUM — over 100 m of ground, the interior is [100, 130) absolute and [0, 30) above it", () => {
    const dsm = createLocalDsm({ nx: 21, ny: 21, cellM: 5, originE: -50, originN: -50 });
    dsm.ground.fill(100);
    dsm.groundKnown.fill(1);
    stampSolid(dsm, {
      ring: [-12, -12, 12, -12, 12, 12, -12, 12],
      baseM: 0, // MVT render_min_height — ABOVE GROUND, re-based exactly once, by stampSolid
      topM: 30, // MVT render_height
      datum: "aboveGround",
    });
    const c = cellIndexAt(dsm, 10, 10);
    expect(dsm.solidBase[c]).toBeCloseTo(100, 5); // ABSOLUTE
    expect(dsm.solidTop[c]).toBeCloseTo(130, 5);

    // The right answer, in the right datum.
    expect(insideSolidInterior(dsm, c, 10)).toBe(true);
    expect(insideSolidInterior(dsm, c, 30)).toBe(false); // the roof, standable
    expect(insideSolidInterior(dsm, c, 0)).toBe(true);

    // NEGATIVE CONTROL 1 — the ABOVE-GROUND height compared straight against the ABSOLUTE pair, which
    // is what `accessAt(grid, ix, iy, 10, dsm.solidBase[c], dsm.solidTop[c])` did: `10 >= 100` is
    // false, so the drone is declared free INSIDE the building.
    expect(10 >= dsm.solidBase[c] && 10 < dsm.solidTop[c]).toBe(false);
    // NEGATIVE CONTROL 2 — the ABSOLUTE height handed to the above-ground parameter: 210 vs [100,130).
    expect(insideSolidInterior(dsm, c, 100 + 10)).toBe(false);
    // Both mistakes fail OPEN. That is the dangerous direction, and it is invisible at ground 0:
    const flat = createLocalDsm({ nx: 21, ny: 21, cellM: 5, originE: -50, originN: -50 });
    flat.ground.fill(0);
    flat.groundKnown.fill(1);
    stampSolid(flat, {
      ring: [-12, -12, 12, -12, 12, 12, -12, 12],
      baseM: 0,
      topM: 30,
      datum: "aboveGround",
    });
    const fc = cellIndexAt(flat, 10, 10);
    expect(10 >= flat.solidBase[fc] && 10 < flat.solidTop[fc]).toBe(insideSolidInterior(flat, fc, 10));
  });

  it("unknown ground is not an interior — an envelope needs the ground it rests on", () => {
    const dsm = createLocalDsm({ nx: 9, ny: 9, cellM: 5, originE: -20, originN: -20 });
    dsm.ground.fill(100);
    dsm.groundKnown.fill(1);
    stampSolid(dsm, { ring: [-15, -15, 15, -15, 15, 15, -15, 15], baseM: 0, topM: 30, datum: "aboveGround" });
    const c = cellIndexAt(dsm, 4, 4);
    expect(insideSolidInterior(dsm, c, 10)).toBe(true);
    // Ignorance is not a verdict (pin 3): drop the evidence and the gate opens rather than guessing.
    dsm.groundKnown[c] = 0;
    dsm.ground[c] = Number.NaN;
    expect(insideSolidInterior(dsm, c, 10)).toBe(false);
  });
});

/**
 * F3 — the hero case. A deck 10 m over the water at 1.5 km occupies [0.306, 0.382]°; a max-only height
 * field declares everything below 0.382° blocked, so "the sun setting behind the bridge" and "a blank
 * 15-storey wall" become the same object — and the wall then OUTSCORES an open river horizon by 4.4 %.
 * This test goes red the moment anyone rasterizes a floating solid into the surface.
 */
describe("localDsm — floating solids are NEVER part of the surface (F3)", () => {
  it("PIN: adding a deck leaves ground, solidMask and surfaceTop untouched", () => {
    const dsm = createLocalDsm({ nx: 21, ny: 21, cellM: 10, originE: -100, originN: -100 });
    dsm.ground.fill(0);
    dsm.groundKnown.fill(1);
    addFloatingSolid(dsm, {
      e0: -80,
      n0: 0,
      e1: 80,
      n1: 0,
      halfWidthM: 8,
      baseM: 10,
      topM: 14,
      src: SRC_DECK,
    });
    sealDsm(dsm);
    const under = cellIndexAt(dsm, 10, 10); // directly beneath the deck
    expect(dsm.solidMask[under]).toBe(0);
    expect(dsm.canopyMask[under]).toBe(0);
    expect(dsm.surfaceTop[under]).toBe(0);
    expect(dsm.surfaceSrc[under]).toBe(SRC_TERRAIN);
    expect(dsm.floating).toHaveLength(1);
    expect(srcName(dsm.floating[0].src)).toBe("deck");
  });
});

/**
 * §8 — vegetation is FICTION at the individual level: 151,046 of Dnipro's 161,823 canopies are seeded
 * scatter with jittered class-default heights, only 628 are surveyed points, and outside the two baked
 * cities there are none at all. A canopy may therefore never be indistinguishable from a wall.
 */
describe("localDsm — canopies are a tagged, removable layer (§8)", () => {
  it("PIN: a tree-set surface is tagged SRC_TREE, and sealDsm({includeCanopy:false}) removes it", () => {
    const dsm = createLocalDsm({ nx: 21, ny: 21, cellM: 5, originE: -50, originN: -50 });
    dsm.ground.fill(2);
    dsm.groundKnown.fill(1);
    const stamped = addCanopy(dsm, { e: 0, n: 0, centerM: 12, radiusM: 6 });
    expect(stamped).toBeGreaterThan(0);
    const c = cellIndexAt(dsm, 10, 10);

    sealDsm(dsm, { includeCanopy: true });
    expect(dsm.canopyInSurface).toBe(true);
    expect(dsm.surfaceSrc[c]).toBe(SRC_TREE);
    expect(dsm.surfaceTop[c]).toBeCloseTo(18, 4); // centre 12 + radius 6

    sealDsm(dsm, { includeCanopy: false });
    expect(dsm.canopyInSurface).toBe(false);
    expect(dsm.surfaceSrc[c]).toBe(SRC_TERRAIN);
    expect(dsm.surfaceTop[c]).toBeCloseTo(2, 4);
    // The sphere itself survives BOTH seals — provenance is not deleted by a display choice.
    expect(dsm.canopies).toHaveLength(1);
    expect(dsm.canopyTop[c]).toBeCloseTo(18, 4);
  });

  it("a building outranks a canopy at the same cell (paint order: buildings LAST)", () => {
    const dsm = createLocalDsm({ nx: 11, ny: 11, cellM: 5, originE: -25, originN: -25 });
    dsm.ground.fill(0);
    dsm.groundKnown.fill(1);
    addCanopy(dsm, { e: 0, n: 0, centerM: 8, radiusM: 4 });
    stampSolid(dsm, {
      ring: [-6, -6, 6, -6, 6, 6, -6, 6],
      baseM: 0,
      topM: 40,
      datum: "aboveGround",
      src: SRC_BUILDING,
    });
    sealDsm(dsm);
    const c = cellIndexAt(dsm, 5, 5);
    expect(dsm.surfaceSrc[c]).toBe(SRC_BUILDING);
    expect(dsm.surfaceTop[c]).toBeCloseTo(40, 4);
  });
});

describe("localDsm — the seal contract", () => {
  it("every mutator clears `sealed`, so a stale surface cannot reach the sweep", () => {
    const dsm = createLocalDsm({ nx: 9, ny: 9, cellM: 5, originE: -20, originN: -20 });
    expect(dsm.sealed).toBe(false);
    dsm.ground.fill(1);
    dsm.groundKnown.fill(1);
    sealDsm(dsm);
    expect(dsm.sealed).toBe(true);

    stampSolid(dsm, { ring: [-5, -5, 5, -5, 5, 5, -5, 5], baseM: 0, topM: 9, datum: "aboveGround" });
    expect(dsm.sealed).toBe(false);
    sealDsm(dsm);
    addCanopy(dsm, { e: 10, n: 10, centerM: 5, radiusM: 3 });
    expect(dsm.sealed).toBe(false);
    sealDsm(dsm);
    addFloatingSolid(dsm, {
      e0: -5,
      n0: 8,
      e1: 5,
      n1: 8,
      halfWidthM: 2,
      baseM: 4,
      topM: 6,
      src: SRC_DECK,
    });
    expect(dsm.sealed).toBe(false);
    sealDsm(dsm);
    rasterizeTinGround(dsm, planeTin(30, () => 1), null, I4, FLAT, { earthRadiusM: Infinity });
    expect(dsm.sealed).toBe(false);
  });

  it("dsmBytes counts every resident layer — §5's memory ledger is load-bearing", () => {
    const dsm = createLocalDsm(discGridSpec(300, 3));
    // 4 Float32 (ground, solidBase, solidTop, canopyTop, surfaceTop = 5×4 B) + 5 Uint8 = 25 B/cell.
    expect(dsmBytes(dsm) / dsm.cellCount).toBe(25);
    expect(dsm.cellCount).toBe(201 * 201);
  });

  it("srcName maps every code, and an out-of-range code degrades to 'none'", () => {
    expect(srcName(SRC_NONE)).toBe("none");
    expect(srcName(SRC_TERRAIN)).toBe("terrain");
    expect(srcName(SRC_BUILDING)).toBe("building");
    expect(srcName(SRC_TREE)).toBe("tree");
    expect(srcName(SRC_DECK)).toBe("deck");
    expect(srcName(99)).toBe("none");
  });
});
