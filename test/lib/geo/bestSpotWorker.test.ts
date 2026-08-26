import { describe, expect, it } from "vitest";

import { BESTSPOT_SCORING_V1, scoringHash } from "../../../src/lib/geo/bestSpotScoring";
import {
  composeField,
  composeScores,
  createTermBuffer,
  discGeometry,
  STAND_G,
  TERM_FLAG,
  type ComposeContext,
} from "../../../src/lib/geo/bestSpotSolver";
import {
  buildDsm,
  builtDensityOf,
  censusOf,
  contactOf,
  dayKeyOf,
  inkFractionOf,
  noteOf,
  shortlist,
  snapAz,
  noBuiltGeometry,
  terrainOnlyVerdict,
  tilesOverlapping,
  tinPostingM,
  transfersOf,
  unmappedFieldPack,
  type CanopyWire,
  type TinMeshWire,
} from "../../../src/lib/geo/bestSpotWorker";
import { buildLandGrid, LAND_CODE } from "../../../src/lib/geo/landcoverRaster";
import { R_MEAN_M } from "../../../src/lib/geo/horizonProfile";
import {
  cellAtEnu,
  enuFrameAt,
  insideSolidInterior,
  SRC_BUILDING,
  SRC_DECK,
  SRC_TERRAIN,
  SRC_TREE,
} from "../../../src/lib/geo/localDsm";
import {
  CANOPY_CENTER_Y,
  CANOPY_HALF_Y,
  UNIT_CANOPY_R,
} from "../../../src/lib/geo/occlusion";
import type { ParsedVtile } from "../../../src/components/globe/scene/vectorTiles";

/**
 * BEST SPOT — THE WORKER'S PURE HALF (`BESTSPOT_SPEC_V2.md` §7 S3d).
 *
 * The message shell is guarded behind a `typeof self` check precisely so these rules can be pinned
 * without a browser. Each block below names the DEFECT it exists to keep dead — none of them is a
 * restatement of the implementation.
 */

const HASH = scoringHash(BESTSPOT_SCORING_V1);

describe("§3.4 item 6 — the tile-coverage REFUSAL renders UNMAPPED, it does not paint a grid", () => {
  it("a LandGrid built from ZERO sources claims hard = 1 for every cell — the defect", () => {
    // THE POSITIVE CONTROL, and it is the whole reason the refusal exists (`landcoverRaster.ts:182`
    // was measured): with no parsed tiles every cell comes back `unknown`, and `unknown` carries
    // `hard = 1`. The water mask therefore DISAPPEARS and the top-K would rank a cell in the
    // middle of the Dnipro. If this ever stops being true the refusal can be reconsidered — until
    // then it is mandatory.
    const grid = buildLandGrid(
      { centreLatDeg: 48.4647, centreLonDeg: 35.0462, halfSpanM: 60, cellM: 20 },
      [],
    );
    expect(grid.cls.every((c) => c === LAND_CODE.unknown)).toBe(true);
  });

  it("the refusal pack is ALL ZERO — score 0 AND STAND_G.unknown, on every cell", () => {
    const geo = discGeometry(300, 24);
    const pack = unmappedFieldPack(geo, 48.4647, 35.0462, 1.7, 0.15, 0.9, HASH);
    expect(pack.rg8.length).toBe(geo.n * geo.n * 2);
    // `.g` is the render class the sheet reads. Every one of them must be UNKNOWN — a single
    // `scoredReachable` byte here is a cell the map invites a person to stand on unexamined.
    let nonUnknown = 0;
    for (let i = 1; i < pack.rg8.length; i += 2) if (pack.rg8[i] !== STAND_G.unknown) nonUnknown++;
    expect(nonUnknown).toBe(0);
    expect(pack.unmappedFrac).toBe(1);
    expect(pack.coverage).toBe(0);
    expect(pack.conformM).toBeNull();
    // MUTATION CHECK: the assertion above can fail — `STAND_G.unknown` really is a distinguishable
    // value and the other three levels are not zero.
    expect([STAND_G.inaccessible, STAND_G.scoredNotGroundReachable, STAND_G.scoredReachable]).not.toContain(
      STAND_G.unknown,
    );
  });

  it("the tile floor counts the tiles the disc OVERLAPS, not a fixed ring", () => {
    // A 300 m disc + 400 m collar at Dnipro spans 1-4 z14 tiles (z14 at 48.46° is 1,621.6 m), so
    // asking for a 3×3 ring would refuse discs that are perfectly well covered.
    const small = tilesOverlapping(48.4647, 35.0462, 700, 14);
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.length).toBeLessThanOrEqual(4);
    // …and a 5 km half-span really does need more, so the count is a function of the disc.
    expect(tilesOverlapping(48.4647, 35.0462, 5000, 14).length).toBeGreaterThan(small.length);
  });
});

describe("§2.2 T1′ — a scene-time scrub inside ONE local day changes NOTHING", () => {
  const LON = 35.0462;
  const noon = Date.UTC(2026, 7, 24, 12, 0, 0);

  it("+3 h inside the same local day is the SAME key; +25 h is a different one", () => {
    expect(dayKeyOf(noon, LON)).toBe(dayKeyOf(noon + 3 * 3_600_000, LON));
    expect(dayKeyOf(noon, LON)).not.toBe(dayKeyOf(noon + 25 * 3_600_000, LON));
  });

  it("the key is the SOLAR day, not the UTC one — a longitude 180° away disagrees", () => {
    // The failure this pins: a `Math.floor(ms / 86_400_000)` key would put Dnipro's evening and
    // its own midnight in different "days" at the wrong instant, so a scrub across UTC midnight
    // would re-pay a 490 ms T0.5 rebuild for nothing (or, worse, NOT re-pay one when it must).
    expect(dayKeyOf(noon, LON)).not.toBe(dayKeyOf(noon, LON - 180));
  });
});

describe("§2.2 T0.5 — the hull cache key snaps to the ABSOLUTE azimuth lattice", () => {
  it("two samples of one lattice point collide; two lattice points never do", () => {
    // Measured: +1 day moves `setAzDeg` by −0.534° and exact matches on the WINDOW-anchored
    // lattice are 0 of 40. On the absolute 0.25° lattice consecutive days share 37 of 39 — but
    // only if the key quantises finely enough to be exact and coarsely enough to absorb the
    // ~1e-9° the inversion carries.
    expect(snapAz(287.5)).toBe(snapAz(287.5 + 1e-7));
    expect(snapAz(287.5)).not.toBe(snapAz(287.75));
    expect(snapAz(287.5)).not.toBe(snapAz(287.5001));
  });
});

describe("the DSM keeps BUILT MASS out of `ground` — provenance survives", () => {
  /** One axis-aligned quad in the local ENU tangent plane at `heightM`, as a TIN wire. */
  const quad = (frame: ReturnType<typeof enuFrameAt>, halfM: number, heightM: number): TinMeshWire => {
    const p: number[] = [];
    const corner = (e: number, n: number) => {
      const x = frame.originEcef[0] + e * frame.east[0] + n * frame.north[0] + heightM * frame.up[0];
      const y = frame.originEcef[1] + e * frame.east[1] + n * frame.north[1] + heightM * frame.up[1];
      const z = frame.originEcef[2] + e * frame.east[2] + n * frame.north[2] + heightM * frame.up[2];
      p.push(x, y, z);
    };
    corner(-halfM, -halfM);
    corner(halfM, -halfM);
    corner(halfM, halfM);
    corner(-halfM, -halfM);
    corner(halfM, halfM);
    corner(-halfM, halfM);
    return {
      positions: Float32Array.from(p),
      index: null,
      // Identity: the positions above are already ECEF.
      matrixWorld: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    };
  };

  it("a roof over terrain becomes a SOLID (base = terrain, top = roof), never ground", () => {
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm } = buildDsm(geo, frame, [quad(frame, 90, 0)], [quad(frame, 40, 25)]);
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(dsm.groundKnown[centre]).toBe(1);
    // THE ASSERTION: `ground` is still the TERRAIN. Rasterising built mass straight into `ground`
    // would be three lines shorter and would make every roof read as SRC_TERRAIN — which silently
    // deletes the `graze.conf.*` provenance split and lets `groundKnown` claim ground evidence
    // where there is only a roof.
    // ±0.5 m, not ±0.05: the wire carries ECEF in FLOAT32 (the real `BufferAttribute` dtype), and
    // 6.4e6 m at f32 quantises to ~0.5 m. The claim being made is "the ground is 0 and not 25".
    expect(Math.abs(dsm.ground[centre])).toBeLessThan(0.5);
    expect(dsm.solidMask[centre]).toBe(1);
    expect(dsm.solidSrc[centre]).toBe(SRC_BUILDING);
    expect(dsm.solidTop[centre]).toBeCloseTo(25, 0);
    expect(Math.abs(dsm.solidBase[centre])).toBeLessThan(0.5);
    // …and the SEALED surface reports the roof, tagged as built.
    expect(dsm.surfaceTop[centre]).toBeCloseTo(25, 0);
    expect(dsm.surfaceSrc[centre]).toBe(SRC_BUILDING);
  });

  it("a roof with NO terrain under it is SKIPPED — a height above nothing is not a height", () => {
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm } = buildDsm(geo, frame, [], [quad(frame, 40, 25)]);
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(dsm.groundKnown[centre]).toBe(0);
    expect(dsm.solidMask[centre]).toBe(0);
    // POSITIVE CONTROL: the same built quad DOES stamp when terrain is present (test above), so
    // this zero is the skip rule and not an inert fixture.
  });

  it("half a metre of TIN noise is not a building", () => {
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm } = buildDsm(geo, frame, [quad(frame, 90, 0)], [quad(frame, 40, 0.2)]);
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(dsm.solidMask[centre]).toBe(0);
    expect(dsm.surfaceSrc[centre]).toBe(SRC_TERRAIN);
  });

  /**
   * D2 (2026-08-26g) — canopies reach the surface, and they reach it as their OWN LAYER.
   *
   * `addCanopy` and `sealDsm({includeCanopy})` shipped in `localDsm` with **zero production
   * callers**; `buildDsm` tagged every solid `SRC_BUILDING` unconditionally, so `graze.conf.tree`,
   * `SRC_TREE` and `noteOf(SRC_TREE)` were all unreachable and the spec's *"terrain, every
   * building, bridge decks, trees"* was not what shipped. On a tree-lined avenue the model saw
   * open sky.
   */
  const canopySet = (
    frame: ReturnType<typeof enuFrameAt>,
    offsets: readonly [number, number][],
    heightM: number,
    radiusM: number,
  ): CanopyWire => {
    const m: number[] = [];
    const s = radiusM / UNIT_CANOPY_R;
    for (const [e, n] of offsets) {
      // Column-major, yaw-only about +Y — the slice-3 bake contract `sweepTreeInstances` decodes.
      m.push(s, 0, 0, 0, 0, heightM, 0, 0, 0, 0, s, 0, e, 0, n, 1);
    }
    return {
      instanceMatrices: Float32Array.from(m),
      count: offsets.length,
      // Cell → ECEF, columns = the ENU basis at the frame origin (rigid, per the bake contract).
      matrixWorld: Float64Array.from([
        frame.east[0], frame.east[1], frame.east[2], 0,
        frame.up[0], frame.up[1], frame.up[2], 0,
        frame.north[0], frame.north[1], frame.north[2], 0,
        frame.originEcef[0], frame.originEcef[1], frame.originEcef[2], 1,
      ]),
    };
  };

  it("a canopy folds into `surfaceTop` as SRC_TREE — and NEVER into the solid mask", () => {
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm, canopyStamps } = buildDsm(
      geo,
      frame,
      [quad(frame, 90, 0)],
      [],
      [canopySet(frame, [[0, 0]], 12, 4)],
    );
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(canopyStamps).toBeGreaterThan(0);
    // The tree really is between the eye and the sun — it reaches the SWEPT surface…
    expect(dsm.surfaceSrc[centre]).toBe(SRC_TREE);
    expect(dsm.surfaceTop[centre]).toBeGreaterThan(6);
    // …but it is NOT a solid, and this is the assertion that matters most.
    expect(dsm.solidMask[centre]).toBe(0);
    expect(dsm.canopyMask[centre]).toBe(1);
  });

  it("THE TRAP — you can still stand under a tree, at ground level AND at drone height", () => {
    // `landcoverRaster.accessAt` decides the aerial gate through `localDsm.insideSolidInterior`.
    // A canopy written into `solidMask` — the obvious way to make a tree "block" — would make
    // every tree-lined avenue INACCESSIBLE the moment the sheet is lifted to `access.aerialMinM`
    // (5 m): a drone declared to be *inside* a tree. The 6 m arm is the one that catches it; the
    // 1.7 m arm alone passes even in the broken version, because the canopy starts above the eye.
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm } = buildDsm(
      geo,
      frame,
      [quad(frame, 90, 0)],
      [],
      [canopySet(frame, [[0, 0]], 12, 4)],
    );
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(insideSolidInterior(dsm, centre, 1.7)).toBe(false);
    expect(insideSolidInterior(dsm, centre, 6)).toBe(false);
    // POSITIVE CONTROL — a real building at the same cell DOES report an interior at 6 m, so the
    // two falses above are the canopy layering and not a dead predicate.
    const withRoof = buildDsm(geo, frame, [quad(frame, 90, 0)], [quad(frame, 40, 25)]).dsm;
    expect(insideSolidInterior(withRoof, centre, 6)).toBe(true);
  });

  it("a BUILDING taller than the canopy keeps the surface — the tree does not overwrite it", () => {
    const geo = discGeometry(60, 20, 40);
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const { dsm } = buildDsm(
      geo,
      frame,
      [quad(frame, 90, 0)],
      [quad(frame, 40, 30)],
      [canopySet(frame, [[0, 0]], 12, 4)],
    );
    const centre = ((geo.nGrid - 1) / 2) * geo.nGrid + (geo.nGrid - 1) / 2;
    expect(dsm.surfaceSrc[centre]).toBe(SRC_BUILDING);
    expect(dsm.surfaceTop[centre]).toBeCloseTo(30, 0);
  });

  it("PARITY — the DSM's canopy decode and `sweepTreeInstances` place the same tree", () => {
    // `localDsm.ts:631-633` claims the two surfaces "agree by construction". Nothing enforced it,
    // and they are now written by two different modules, so this is the enforcement. A canopy in
    // the wrong vertical datum (the missing `(e²+n²)/2R` fall-away term) fails here by ~38 mm at
    // the collar — small, silent, and exactly the "two conventions that look alike" bug class.
    const frame = enuFrameAt(48.4647, 35.0462, 0);
    const geo = discGeometry(60, 20, 40);
    const H = 14;
    const R = 5;
    // ON a cell centre, deliberately: `addCanopy` stamps a cell only when the cell's CENTRE falls
    // inside the sphere, and a 5 m canopy between two centres of a 20 m grid legitimately stamps
    // nothing. The parity claim is about the DATUM, so the fixture must not also be a sampling test.
    const set = canopySet(frame, [[20, -20]], H, R);
    const { dsm } = buildDsm(geo, frame, [quad(frame, 200, 0)], [], [set]);

    // What the DSM believes the canopy TOP is, right above the instance.
    const c = cellAtEnu(dsm, 20, -20);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(dsm.canopyMask[c]).toBe(1);

    // What `sweepTreeInstances` believes, decoded with ITS constants from the same 16 floats.
    const heightM = set.instanceMatrices[5];
    const radiusM =
      Math.hypot(set.instanceMatrices[0], set.instanceMatrices[1], set.instanceMatrices[2]) *
      UNIT_CANOPY_R;
    const sphereR = Math.max(radiusM, CANOPY_HALF_Y * heightM);
    const expectedTop = CANOPY_CENTER_Y * heightM + sphereR;
    expect(heightM).toBeCloseTo(H, 6);
    expect(radiusM).toBeCloseTo(R, 6);

    // **THE DATUM IS THE ASSERTION.** `sweepTreeInstances` works in raw ECEF, so its top is a
    // plain tangent-plane height. The DSM measures every height above the SPHERE through the frame
    // — `rasterizeTinGround`'s pin 5 — so the same tree legitimately reads `(e²+n²)/2R` HIGHER
    // here: 62.8 µm at this cell, 38 mm at the 700 m collar. Subtracting the term and demanding
    // equality pins the conversion in the direction that matters: drop it from `enuOfEcef` and the
    // canopy lands in a different vertical datum from the terrain it stands on, and this goes red.
    const fallAwayM = (20 * 20 + 20 * 20) / (2 * R_MEAN_M);
    expect(fallAwayM).toBeGreaterThan(1e-5); // the fixture really does exercise the term
    expect(dsm.canopyTop[c] - fallAwayM).toBeCloseTo(expectedTop, 6);
  });
});

describe("the shortlist — UNKNOWN and INACCESSIBLE never rank", () => {
  const geo = discGeometry(60, 20, 40);
  const frame = enuFrameAt(48.4647, 35.0462, 0);

  /** An n² term buffer where every cell is fully-covered, ordinary ground, and a `scores` array. */
  const fixture = (cls: number, coverage = 1) => {
    const terms = createTermBuffer(geo.n);
    terms.c.fill(coverage);
    terms.cls.fill(cls);
    terms.flags.fill(TERM_FLAG.hasStar);
    terms.srcStar.fill(SRC_TERRAIN);
    const scores = new Float64Array(terms.cellCount);
    for (let i = 0; i < scores.length; i++) scores[i] = 0.5;
    return { terms, scores };
  };

  it("a pin MID-RESERVOIR returns ZERO candidates and every cell reads BLOCKED", () => {
    // §7's done-check 2. `water.hard = 0` is one of the eleven locked SAFETY bits — flipping it is
    // what makes the top-K tell a photographer to stand in the Dnipro — so the whole disc must
    // come back `blocked`, and the shortlist must be EMPTY rather than "the least bad water cell".
    const { terms, scores } = fixture(LAND_CODE.water);
    const spots = shortlist(terms, scores, BESTSPOT_SCORING_V1, geo, frame, null, 1.7, 8, 25);
    expect(spots).toEqual([]);
    const census = censusOf(terms, scores, BESTSPOT_SCORING_V1, 1.7);
    expect(census.blocked).toBe(census.total);
    expect(census.scored).toBe(0);
    expect(census.unknown).toBe(0);
  });

  it("…and the SAME fixture over grass DOES rank, so the zero above is not a dead fixture", () => {
    const { terms, scores } = fixture(LAND_CODE.green);
    const spots = shortlist(terms, scores, BESTSPOT_SCORING_V1, geo, frame, null, 1.7, 8, 25);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots[0].rank).toBe(1);
    expect(spots[0].groundReachable).toBe(true);
    // Non-maximum suppression: eight PLACES, not eight cells of one plateau.
    for (let i = 1; i < spots.length; i++) {
      for (let j = 0; j < i; j++) {
        const d = Math.hypot(
          spots[i].distM * Math.sin((spots[i].bearingDeg * Math.PI) / 180) -
            spots[j].distM * Math.sin((spots[j].bearingDeg * Math.PI) / 180),
          spots[i].distM * Math.cos((spots[i].bearingDeg * Math.PI) / 180) -
            spots[j].distM * Math.cos((spots[j].bearingDeg * Math.PI) / 180),
        );
        expect(d).toBeGreaterThanOrEqual(25 - 1e-6);
      }
    }
  });

  it("UNKNOWN is a render class, never a low score — it does not rank AT ALL", () => {
    const { terms, scores } = fixture(LAND_CODE.green, 0); // coverage 0 ⇒ below `gates.minCoverage`
    expect(shortlist(terms, scores, BESTSPOT_SCORING_V1, geo, frame, null, 1.7, 8, 25)).toEqual([]);
    const census = censusOf(terms, scores, BESTSPOT_SCORING_V1, 1.7);
    expect(census.unknown).toBe(census.total);
  });
});

// =============================================================================================
// **D2 — THE ORDINAL `.g` AXIS, ALL FOUR LEVELS, AND THE CENSUS THAT MUST AGREE WITH IT.**
// =============================================================================================
describe("D2 — `composeField`'s .g and `censusOf` are two functions that may never disagree", () => {
  const geo = discGeometry(60, 20, 40);
  const ctx: ComposeContext = {
    cellM: geo.cellM,
    radiusM: geo.radiusM,
    centreLatDeg: 48.4647,
    centreLonDeg: 35.0462,
    centreGroundM: 100,
    sheetAltM: 1.7,
    dipFloorDeg: -0.05,
    kind: "sunset" as const,
    worthParts: { sunAltAtT0Deg: -0.83, moonPhaseAngleDeg: 90 },
    coverage: 1,
    unmappedFrac: 0,
    minReachM: 700,
    conformM: null,
    displayLo: 0.15,
    displayHi: 0.9,
  };

  /**
   * A term buffer painted in four horizontal bands — UNMAPPED, water, a building interior and
   * ordinary green — so all four render classes exist in ONE field.
   */
  const banded = () => {
    const terms = createTermBuffer(geo.n);
    terms.flags.fill(TERM_FLAG.hasStar);
    terms.srcStar.fill(SRC_TERRAIN);
    const q = Math.floor(geo.n / 4);
    for (let j = 0; j < geo.n; j++) {
      for (let i = 0; i < geo.n; i++) {
        const c = j * geo.n + i;
        if (j < q) {
          terms.c[c] = 0; // below `gates.minCoverage` ⇒ UNKNOWN
          terms.cls[c] = LAND_CODE.green;
        } else if (j < 2 * q) {
          terms.c[c] = 1;
          terms.cls[c] = LAND_CODE.water; // A_hard = 0 on the ground
        } else if (j < 3 * q) {
          terms.c[c] = 1;
          terms.cls[c] = LAND_CODE.building;
          terms.flags[c] |= TERM_FLAG.inSolid; // inside the mass, at every altitude
        } else {
          terms.c[c] = 1;
          terms.cls[c] = LAND_CODE.green;
        }
      }
    }
    return terms;
  };

  const gCensus = (rg8: Uint8Array): Record<number, number> => {
    const out: Record<number, number> = {};
    for (let i = 1; i < rg8.length; i += 2) out[rg8[i]] = (out[rg8[i]] ?? 0) + 1;
    return out;
  };

  it("AT THE PEDESTRIAN EYE: 0 UNKNOWN · 85 INACCESSIBLE · 255 REACHABLE, and none at 170", () => {
    const terms = banded();
    const pack = composeField(terms, ctx, BESTSPOT_SCORING_V1);
    const census = censusOf(terms, composeScores(terms, ctx, BESTSPOT_SCORING_V1), BESTSPOT_SCORING_V1, ctx.sheetAltM);
    const g = gCensus(pack.rg8);
    expect(g[STAND_G.unknown]).toBe(census.unknown);
    expect(g[STAND_G.inaccessible]).toBe(census.blocked);
    expect((g[STAND_G.scoredReachable] ?? 0) + (g[STAND_G.scoredNotGroundReachable] ?? 0)).toBe(census.scored);
    // …and the levels are the ones §6.4 names, not "whatever came out".
    expect(g[STAND_G.unknown]).toBeGreaterThan(0);
    expect(g[STAND_G.inaccessible]).toBeGreaterThan(0);
    expect(g[STAND_G.scoredReachable]).toBeGreaterThan(0);
    expect(g[STAND_G.scoredNotGroundReachable] ?? 0).toBe(0); // on foot, nothing is "air-only"
    // Water AND the building interior are both inaccessible — half the disc, exactly.
    expect(g[STAND_G.inaccessible]).toBe(census.blocked);
  });

  it("AT A 55 m DRONE SHEET: the water becomes 170, and ONLY the solid stays 85", () => {
    // THE MEASUREMENT THAT LOOKED LIKE A CLASS-BYTE BUG. At `sheetAltM ≥ access.aerialMinM` the
    // rule is `hard = inSolid ? 0 : 1` — a drone over the river is a legitimate place to BE, and it
    // is `170 SCORED-not-groundReachable` because the ground under it is not walkable. Reported as
    // "every A_hard = 0 cell is encoded 170", the reading was taken at 55 m against a census taken
    // at the pedestrian eye. What IS a real failure is ZERO cells at 85 up there: that means the
    // DSM has no solid layer at all, which is D1 wearing a different hat.
    const terms = banded();
    const air = { ...ctx, sheetAltM: 56.7 };
    const pack = composeField(terms, air, BESTSPOT_SCORING_V1);
    const census = censusOf(terms, composeScores(terms, air, BESTSPOT_SCORING_V1), BESTSPOT_SCORING_V1, air.sheetAltM);
    const g = gCensus(pack.rg8);
    expect(g[STAND_G.unknown]).toBe(census.unknown);
    expect(g[STAND_G.inaccessible]).toBe(census.blocked);
    expect((g[STAND_G.scoredReachable] ?? 0) + (g[STAND_G.scoredNotGroundReachable] ?? 0)).toBe(census.scored);
    // The water band moved from 85 to 170; the solid band did not move.
    expect(g[STAND_G.scoredNotGroundReachable]).toBeGreaterThan(0);
    expect(g[STAND_G.inaccessible]).toBeGreaterThan(0);
    expect(g[STAND_G.inaccessible]).toBeLessThan(
      gCensus(composeField(terms, ctx, BESTSPOT_SCORING_V1).rg8)[STAND_G.inaccessible],
    );
  });

  it("the four levels are 0 / 85 / 170 / 255 — evenly spaced, so LinearFilter lands BETWEEN classes", () => {
    // Structural, and it is why `.g` is ordinal at all: an interpolated texel can only fall between
    // two ADJACENT levels, which is the 1–2 cell uncertainty ribbon §6.4 asks to be drawn.
    expect([STAND_G.unknown, STAND_G.inaccessible, STAND_G.scoredNotGroundReachable, STAND_G.scoredReachable])
      .toEqual([0, 85, 170, 255]);
  });
});

describe("row copy comes from stored PROVENANCE, never re-derived", () => {
  const geo = discGeometry(20, 20, 20);

  it("openSky ⇒ OPEN, a bounded notch with depth ⇒ GAP, otherwise GRAZE", () => {
    const t = createTermBuffer(geo.n);
    t.flags[0] = TERM_FLAG.starOpenSky;
    expect(contactOf(t, 0)).toBe("open");
    t.flags[1] = 0;
    t.notchWidthDeg[1] = 2.4;
    t.notchDepthDeg[1] = 0.8;
    expect(contactOf(t, 1)).toBe("gap");
    t.flags[2] = 0;
    t.notchWidthDeg[2] = Infinity; // an UNBOUNDED gap is open sky, not a frame
    t.notchDepthDeg[2] = 0.8;
    expect(contactOf(t, 2)).toBe("graze");
    t.flags[3] = 0;
    t.notchWidthDeg[3] = 2.4;
    t.notchDepthDeg[3] = -Infinity; // a shoulder was never sampled — ignorance is not depth
    expect(contactOf(t, 3)).toBe("graze");
  });

  it("the footnote names decks and trees, and stays SILENT for terrain", () => {
    expect(noteOf(SRC_DECK)).toBe("ON A BRIDGE");
    expect(noteOf(SRC_TREE)).toContain("modelled height");
    expect(noteOf(SRC_TERRAIN)).toBeNull();
    expect(noteOf(SRC_BUILDING)).toBeNull();
  });
});

describe("R6's empty-field test and S7's built-density prior read the SOURCES, not a constant", () => {
  it("inkFraction counts only SCORED cells — UNMAPPED is not 'dark'", () => {
    // The trap: dividing by the whole grid makes a 90 %-unmapped disc look empty and would offer a
    // lift for a disc whose problem is missing data, not a low sun.
    const pack = unmappedFieldPack(discGeometry(20, 20), 0, 0, 1.7, 0.15, 0.9, HASH);
    expect(inkFractionOf(pack)).toBe(0); // no scored cells at all ⇒ 0, not NaN
    const mixed = unmappedFieldPack(discGeometry(20, 20), 0, 0, 1.7, 0.15, 0.9, HASH);
    // two SCORED cells, one of them lit
    mixed.rg8[1] = STAND_G.scoredReachable;
    mixed.rg8[0] = 200;
    mixed.rg8[3] = STAND_G.scoredReachable;
    expect(inkFractionOf(mixed)).toBe(0.5);
  });

  it("built density is buildings per km², straight off the parsed tiles", () => {
    const tile = (buildings: number): ParsedVtile => ({
      tx: 0,
      ty: 0,
      labels: [],
      lines: [],
      areas: [],
      polys: Array.from({ length: buildings }, () => ({
        kind: "building" as const,
        cls: "",
        subclass: "",
        polys: [],
      })),
    });
    // Dnipro centre measured 558 buildings over a 3×3 z14 ring (21 km²); Everest measured 0.
    const dense = builtDensityOf([tile(558)], 48.46, 14);
    const empty = builtDensityOf([tile(0)], 27.99, 14);
    expect(dense).toBeGreaterThan(100);
    expect(empty).toBe(0);
    // A z14 tile at 48.46° is 1,621.6 m on a side ⇒ 2.63 km², so 558 buildings is ~212/km².
    expect(dense).toBeGreaterThan(150);
    expect(dense).toBeLessThan(300);
    expect(builtDensityOf([], 48.46, 14)).toBe(0); // no tiles ⇒ 0, never a division by zero
  });
});


// =============================================================================================
// **D3 — THE TERRAIN POSTING WAS THE GRID CELL SIZE, ALGEBRAICALLY, FOR EVERY INPUT.**
// =============================================================================================
describe("D3 — `terrainPostingM` measures the TIN, not the grid it was rasterised onto", () => {
  /** A flat regular TIN of `n × n` vertices spanning ±`halfM` in the frame's ENU plane. */
  const gridMesh = (frame: ReturnType<typeof enuFrameAt>, halfM: number, n: number): TinMeshWire => {
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const e = -halfM + (2 * halfM * i) / (n - 1);
        const nn = -halfM + (2 * halfM * j) / (n - 1);
        const o = (j * n + i) * 3;
        pos[o] = frame.originEcef[0] + e * frame.east[0] + nn * frame.north[0];
        pos[o + 1] = frame.originEcef[1] + e * frame.east[1] + nn * frame.north[1];
        pos[o + 2] = frame.originEcef[2] + e * frame.east[2] + nn * frame.north[2];
      }
    }
    // Identity matrixWorld, column-major.
    const m = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return { positions: pos, index: null, matrixWorld: m };
  };

  const FRAME = enuFrameAt(48.4647, 35.0462, 100);

  /** The lattice sits just INSIDE the footprint, so the boundary row is unambiguously counted —
   *  an ENU coordinate rebuilt through a dot product of ECEF doubles lands within ~1e-9 of ±half
   *  and half of a rim vertex row would otherwise fall out on rounding. */
  const INSET = 0.98;

  it("√(footprint / vertices) — a 21² TIN over ±340 m posts at 32.4 m, a 5² one at 136 m", () => {
    // THE DEFECT, stated as arithmetic: the shipped `postingOf` was
    //   sqrt((cells · cellM² · known) / cells / max(1, known))
    // in which the two `known` factors cancel, leaving `sqrt(cellM²) === cellM`. It reported 3.0 m
    // in Dnipro and 3.0 m at Everest — the REQUEST, echoed back as if it were evidence, and the
    // panel printed it as `OVER TERRAIN AT ~3 m` (a C2 violation).
    const HALF = 340;
    const dense = tinPostingM([gridMesh(FRAME, HALF * INSET, 21)], FRAME, HALF);
    const coarse = tinPostingM([gridMesh(FRAME, HALF * INSET, 5)], FRAME, HALF);
    expect(dense).toBeCloseTo((2 * HALF) / 21, 2); // 680 / 21 = 32.4 m
    expect(coarse).toBeCloseTo((2 * HALF) / 5, 2); // 680 / 5 = 136 m
    // …and the ratio is the vertex-count ratio, which is what "posting" means.
    expect(coarse / dense).toBeCloseTo(21 / 5, 2);
  });

  it("it is INDEPENDENT of the solve grid — the same TIN posts the same at 3 m and at 24 m", () => {
    // The falsifiable half. `postingOf` returned 3 and 24 for these two; `tinPostingM` never sees
    // the grid at all, which is the point.
    const HALF = 340;
    const mesh = [gridMesh(FRAME, HALF * INSET, 13)];
    expect(tinPostingM(mesh, FRAME, HALF)).toBe(tinPostingM(mesh, FRAME, HALF));
    expect(tinPostingM(mesh, FRAME, HALF)).not.toBeCloseTo(3, 0);
    expect(tinPostingM(mesh, FRAME, HALF)).not.toBeCloseTo(24, 0);
  });

  it("vertices OUTSIDE the footprint are not counted, and an empty TIN posts 0 (= not measured)", () => {
    // A mesh entirely beyond the disc must not inflate the density of the disc.
    const near = gridMesh(FRAME, 100 * INSET, 11);
    expect(tinPostingM([near], FRAME, 100)).toBeCloseTo(200 / 11, 2);
    // The SAME mesh judged against a 4× larger footprint keeps its 121 vertices but spreads them
    // over 4× the area ⇒ the posting doubles. Nothing is double-counted and nothing is invented.
    expect(tinPostingM([near], FRAME, 200)).toBeCloseTo(2 * (200 / 11), 2);
    // A DISTANT tile is entirely rejected — the posting is byte-identical with and without it.
    const far = gridMesh(enuFrameAt(48.6, 35.3, 100), 100, 41);
    expect(tinPostingM([near, far], FRAME, 100)).toBeCloseTo(200 / 11, 2);
    expect(tinPostingM([], FRAME, 340)).toBe(0);
  });
});

// =============================================================================================
// **D5 — A MESSAGE MAY ONLY TRANSFER BUFFERS IT OWNS.**
// =============================================================================================
describe("D5 — `transfersOf` never hands away a buffer the worker still needs", () => {
  it("`rg8` is transferred and `conformM` is NOT — the resident rung keeps its lattice", () => {
    // THE SHIPPED BLOCKER, and it could not be caught by any test of the worker alone: vitest's
    // `postMessage` has no transfer semantics, so the detach never happened in Node.
    //
    // `composeField` allocates a FRESH `rg8` per message (safe to transfer) and hands out
    // `ctx.conformM` BY REFERENCE from the resident `RungState` (not safe). Transferring the latter
    // detached the worker's own copy on the first rung post, and the SECOND post of that rung —
    // i.e. every §5.6 hot-swap recompose and every `.ab(A, B)` leg — threw
    //   "Failed to execute 'postMessage': An ArrayBuffer is detached and could not be cloned."
    // The visible symptom was `scoringHashLive` frozen on the old hash: THE PICTURE DISAGREEING
    // WITH THE NUMBERS, which is the one thing the hash echo exists to prevent.
    const pack = unmappedFieldPack(discGeometry(60, 3), 48.4647, 35.0462, 1.7, 0.15, 0.9, HASH);
    const shared = new Float32Array(65 * 65);
    const withLattice = { ...pack, conformM: shared };
    const out = transfersOf(withLattice);
    expect(out).toEqual([withLattice.rg8.buffer]);
    expect(out).not.toContain(shared.buffer);
    // …and a pack that carries no lattice transfers exactly the same one buffer.
    expect(transfersOf(pack)).toEqual([pack.rg8.buffer]);
  });
});


// =============================================================================================
// **D1 — THE PRIOR'S SECOND ARM: DENSE TILES, EMPTY DSM.**
// =============================================================================================
describe("D1 — a disc with no BUILDING GEOMETRY may not sound confident about a city", () => {
  const FLOOR = 8; // `BESTSPOT.builtDensityFloorPerKm2`'s shape; the value rides the job

  it("central Dnipro with the tilesets DETACHED is TERRAIN-ONLY, not a confident disc", () => {
    // THE MEASURED FAILURE, 2026-08-24: 54.74 buildings/km² in the parsed MVT, `heightProvenance
    // {enriched: 0, osm: 0}`, and all 31,417 scored cells carrying the identical byte 187/255.
    // The engine KNEW both numbers and said nothing, which is the plan §11 failure mode exactly.
    expect(
      terrainOnlyVerdict({ tilesParsed: 9, builtDensityPerKm2: 54.74, floorPerKm2: FLOOR, builtMeshes: 0 }),
    ).toBe(true);
  });

  it("…and the SAME disc with geometry resident is NOT — so the arm is not a blanket", () => {
    expect(
      terrainOnlyVerdict({ tilesParsed: 9, builtDensityPerKm2: 54.74, floorPerKm2: FLOOR, builtMeshes: 19 }),
    ).toBe(false);
  });

  it("arm 1 is untouched: rural UA fires on DENSITY even with a mesh or two around", () => {
    expect(
      terrainOnlyVerdict({ tilesParsed: 9, builtDensityPerKm2: 0.05, floorPerKm2: FLOOR, builtMeshes: 3 }),
    ).toBe(true);
    // Everest: no density and no meshes — both arms agree, and the disc still SCORES because its
    // rays are set by measured relief rather than by an open-sky claim (S7's three-site design).
    expect(
      terrainOnlyVerdict({ tilesParsed: 9, builtDensityPerKm2: 0, floorPerKm2: FLOOR, builtMeshes: 0 }),
    ).toBe(true);
  });

  it("…and arm 2 alone REFUSES the disc — flagging it is not enough", () => {
    // `terrainOnly` only stops the solver crediting OPEN-SKY rays. Over a city with relief every
    // ray hits terrain, so the credit is never withheld and the field still comes back warm and
    // uniform — measured. `noBuiltGeometry` is the predicate `runSolve` refuses on, and it is
    // deliberately NOT true for the rural/Everest case, which must still SCORE off measured relief.
    expect(noBuiltGeometry({ builtDensityPerKm2: 54.74, floorPerKm2: FLOOR, builtMeshes: 0 })).toBe(true);
    expect(noBuiltGeometry({ builtDensityPerKm2: 54.74, floorPerKm2: FLOOR, builtMeshes: 19 })).toBe(false);
    expect(noBuiltGeometry({ builtDensityPerKm2: 0.05, floorPerKm2: FLOOR, builtMeshes: 0 })).toBe(false);
    expect(noBuiltGeometry({ builtDensityPerKm2: 0, floorPerKm2: FLOOR, builtMeshes: 0 })).toBe(false);
  });

  it("ZERO parsed tiles is the REFUSAL, and the prior must not pre-empt it", () => {
    // With no tiles at all `buildLandGrid` calls every cell standable and the water mask
    // disappears; that path posts `unmappedFieldPack` and never reaches the solver. A prior that
    // fired here would relabel a refusal as a rural disc.
    expect(
      terrainOnlyVerdict({ tilesParsed: 0, builtDensityPerKm2: 0, floorPerKm2: FLOOR, builtMeshes: 0 }),
    ).toBe(false);
  });
});
