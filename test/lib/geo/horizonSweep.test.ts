import { describe, expect, it } from "vitest";
import {
  buildHulls,
  buildShear,
  cellOfSlot,
  createSweepOut,
  hullBytes,
  queryRay,
  rayEvidenceAt,
  serializeHulls,
  slotOfCell,
  sweepAzimuth,
  type RayHulls,
} from "../../../src/lib/geo/horizonSweep";
import {
  addFloatingSolid,
  cellIndexAt,
  createLocalDsm,
  discGridSpec,
  sealDsm,
  stampSolid,
  SRC_BUILDING,
  SRC_DECK,
  SRC_TERRAIN,
  type LocalDsm,
} from "../../../src/lib/geo/localDsm";
import { horizonDipDeg, R_MEAN_M } from "../../../src/lib/geo/horizonProfile";
// LENS B: the consumer of `RayEvidence.src`, imported so the deck's tangency claim can be pinned
// against the sweep's own output rather than against a hand-written fixture.
import {
  BESTSPOT_METRIC_DEFAULTS,
  cellScore,
  depthOfDistM,
  grazeSample,
  smoothstep,
} from "../../../src/lib/geo/bestSpotMetric";
import { BESTSPOT_SCORING_V1 } from "../../../src/lib/geo/bestSpotScoring";
import type {
  CellAccess,
  EventTrack,
  OccluderSrc,
  RayEvidence,
  TrackSample,
} from "../../../src/lib/geo/bestSpotTypes";

const K = 0.13; // PLAN.refractionK — the surveyor's standard terrestrial coefficient
const RAD2DEG = 180 / Math.PI;

/** The 1.7 m pedestrian eye's own geometric horizon, −0.03904°. S3b's GRAZE anchors its RELIEF ramp
 *  here rather than at 0, which is why the deck tests below hand it to `grazeSample`: it is the
 *  difference between "an edge stands above the horizon" and "the horizon is where it should be". */
const DIP_AT_LIFT = horizonDipDeg(1.7, K);

/** Deterministic PRNG. `Math.random` in a committed test makes a red build unreproducible, which is
 *  the one thing a pin may never be. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat DSM with every cell known — the sweep, not the rasterizer, is under test here. */
function flatDsm(nx: number, ny: number, cellM: number, height = 0): LocalDsm {
  const dsm = createLocalDsm({
    nx,
    ny,
    cellM,
    originE: -((nx - 1) / 2) * cellM,
    originN: -((ny - 1) / 2) * cellM,
  });
  dsm.ground.fill(height);
  dsm.groundKnown.fill(1);
  sealDsm(dsm);
  return dsm;
}

/**
 * The apparent-elevation formula in its DIRECT, undecomposed form — the independent reference every
 * hull result is checked against. `atan((h − eye − D²(1−k)/2R) / D)`, exactly what `marchTerrainBin`
 * computes and what `horizonProfile`'s docblock defines an apparent terrestrial angle to be.
 */
function altAppDeg(hM: number, eyeM: number, distM: number, dropPerM2: number): number {
  return Math.atan((hM - eyeM - distM * distM * dropPerM2) / distM) * RAD2DEG;
}

/** Upper convex hull INDICES of points ordered by increasing `s` — the naive pre-F4 candidate set,
 *  i.e. exactly what a "hull first, curvature at the survivors" implementation would consider. */
function upperHullIdx(s: readonly number[], z: readonly number[]): number[] {
  const st: number[] = [];
  for (let i = 0; i < s.length; i++) {
    while (st.length >= 2) {
      const a = st[st.length - 2];
      const b = st[st.length - 1];
      const cross = (s[b] - s[a]) * (z[i] - z[a]) - (z[b] - z[a]) * (s[i] - s[a]);
      if (cross >= 0) st.pop();
      else break;
    }
    st.push(i);
  }
  return st;
}

// =============================================================================================
// PIN 1 — F4: CURVATURE IS FOLDED IN *BEFORE* THE HULL
// =============================================================================================

/**
 * The drop term `d²(1−k)/2R` is CONVEX, so `Z′ = Z − drop` is `Z` plus a CONCAVE function, which ADDS
 * hull vertices. A sample INTERIOR to `hull(raw Z)` can be the true horizon setter of `hull(Z′)`.
 * Building the hull on raw heights and applying curvature only at the surviving candidates silently
 * UNDER-REPORTS the skyline — worst at long range, which is exactly where the metric's `P` term and
 * the owner's "far in the distance" bridge live.
 *
 * The geometry is the spec's own counterexample, `d = [1,2,3]`, `Z = [0, 0.9, 2]`, on a TOY planet
 * (`earthRadiusM = 0.87`, `k = 0.13` ⇒ `drop = 0.5`) chosen so the term is visible at metre scale and
 * reproduces the spec's two printed angles, −2.8624° and −26.5651°, to the digit.
 *
 * ⚠ SPEC DEFECT, pinned here rather than papered over: at the eye BESTSPOT_PLAN §F4 names (−1) the
 * middle sample CANNOT be the setter for any positive drop — the requirement `slope(2) > slope(1)`
 * reduces to `drop < −0.05`. At that eye the NEAREST sample wins in BOTH orderings (+26.5651°), so
 * that eye demonstrates nothing. The finding itself is true and is pinned two ways below: on hull
 * MEMBERSHIP (which is eye-free), and at an eye where the two orderings genuinely disagree.
 */
describe("horizonSweep — PIN: curvature BEFORE the hull (F4)", () => {
  const DROP = 0.5; // (1 − 0.13) / (2 × 0.87)
  const HEIGHTS = [-1, 0, 0.9, 2]; // sample 0 is the eye cell; samples 1..3 are the spec's d = 1,2,3

  function specDsm(): LocalDsm {
    const dsm = createLocalDsm({ nx: 1, ny: 4, cellM: 1, originE: 0, originN: 0 });
    HEIGHTS.forEach((h, i) => {
      dsm.ground[i] = h;
      dsm.groundKnown[i] = 1;
    });
    sealDsm(dsm);
    return dsm;
  }

  function specHulls(): RayHulls {
    return buildHulls(specDsm(), 0, { refractionK: K, earthRadiusM: 0.87 });
  }

  it("folds the drop into every sample, not into the survivors: zs = h − s²·drop", () => {
    const h = specHulls();
    expect(h.dropPerM2).toBeCloseTo(DROP, 12);
    expect(Array.from(h.zs).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-1, -0.5, -1.1, -2.5]);
  });

  it("THE FINDING: the middle sample is NOT on hull(raw Z) but IS on hull(curvature-folded Z)", () => {
    const s = [1, 2, 3];
    // What a "hull first" implementation would keep: the middle is dropped.
    expect(upperHullIdx(s, [0, 0.9, 2])).toEqual([0, 2]);
    // What folding curvature in first keeps: all three — curvature ADDED a vertex.
    expect(upperHullIdx(s, [-0.5, -1.1, -2.5])).toEqual([0, 1, 2]);

    // …and the shipped hull agrees: the persistent chain from the eye cell visits slot 2.
    const h = specHulls();
    const chain: number[] = [];
    for (let cur = 1; cur >= 0; cur = h.link[cur]) chain.push(cur);
    expect(chain).toEqual([1, 2, 3]);
  });

  it("THE UNDER-REPORT: hull-then-curvature returns the FAR sample and loses 3.00° of skyline", () => {
    const h = specHulls();
    const eyeAboveGround = 2; // ⇒ eye at absolute +1, where the two orderings actually disagree
    const eyeM = HEIGHTS[0] + eyeAboveGround;

    const right = queryRay(h, 0, eyeAboveGround);
    expect(right.srcIdx).toBe(2); // the MIDDLE sample — the true horizon setter
    expect(right.distM).toBeCloseTo(2, 12);
    expect(right.altAppDeg).toBeCloseTo(-46.3972, 4);

    // The pre-correction order: hull on RAW Z ⇒ candidates {d=1, d=3}; curvature applied only there.
    const candidates = upperHullIdx([1, 2, 3], [0, 0.9, 2]).map((i) => i + 1);
    expect(candidates).toEqual([1, 3]);
    const wrong = Math.max(
      ...candidates.map((t) => altAppDeg(HEIGHTS[t], eyeM, t, DROP)),
    );
    expect(wrong).toBeCloseTo(-49.3987, 4); // the FAR sample
    expect(right.altAppDeg - wrong).toBeCloseTo(3.0015, 3);
    expect(right.altAppDeg).toBeGreaterThan(wrong); // the naive order UNDER-reports, always
  });

  it("reproduces the spec's printed angles — and records that its eye (−1) proves nothing", () => {
    // The two numbers BESTSPOT_PLAN §F4 prints, from the eye it names (absolute −1, i.e. lift 0):
    expect(altAppDeg(HEIGHTS[2], -1, 2, DROP)).toBeCloseTo(-2.8624, 4);
    expect(altAppDeg(HEIGHTS[3], -1, 3, DROP)).toBeCloseTo(-26.5651, 4);
    // …but the sample the spec omits from the comparison beats both, so at THIS eye the correct and
    // the incorrect orderings return the same answer. `slope(2) > slope(1)` ⟺ `drop < −0.05`.
    expect(altAppDeg(HEIGHTS[1], -1, 1, DROP)).toBeCloseTo(26.5651, 4);
    const q = queryRay(specHulls(), 0, 0);
    expect(q.srcIdx).toBe(1);
    expect(q.altAppDeg).toBeCloseTo(26.5651, 4);
  });
});

// =============================================================================================
// PIN 2 — THE HULL EQUALS BRUTE FORCE
// =============================================================================================

/**
 * A monotone stack is easy to write and easy to write WRONG (an off-by-one in the pop predicate loses
 * exactly the vertices that matter and every result still looks plausible). This checks the hull query
 * against an O(n²) max-angle reference computed from the DIRECT `atan((h − eye − D²·drop)/D)` formula
 * over the raw DSM heights — no shared code path except the DSM itself.
 */
describe("horizonSweep — PIN: hull query == O(n²) brute force, 100 seeded columns × 3 eye heights", () => {
  it("agrees to 1e-9 degrees on every cell of every column", () => {
    const nx = 100;
    const ny = 128;
    const cellM = 3;
    const rng = mulberry32(0x5eed1);
    const dsm = createLocalDsm({ nx, ny, cellM, originE: 0, originN: 0 });
    for (let c = 0; c < dsm.cellCount; c++) {
      dsm.ground[c] = rng() * 60;
      dsm.groundKnown[c] = 1;
    }
    sealDsm(dsm);

    // az 0 ⇒ each ray is exactly one grid COLUMN, walked south→north.
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const drop = (1 - K) / (2 * R_MEAN_M);
    expect(hulls.dropPerM2).toBeCloseTo(drop, 18);

    let compared = 0;
    let srcChecked = 0;
    for (const lift of [1.7, 100, 400]) {
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny - 1; iy++) {
          const cell = iy * nx + ix;
          const eye = dsm.ground[cell] + lift;
          let best = -Infinity;
          let bestIy = -1;
          for (let jy = iy + 1; jy < ny; jy++) {
            const a = altAppDeg(dsm.ground[jy * nx + ix], eye, (jy - iy) * cellM, drop);
            if (a > best) {
              best = a;
              bestIy = jy;
            }
          }
          const got = queryRay(hulls, cell, lift);
          expect(Math.abs(got.altAppDeg - best)).toBeLessThan(1e-9);
          expect(got.distM).toBeCloseTo((bestIy - iy) * cellM, 9);
          // The setter is checked only when the maximum is unique by a real margin — on an exact tie
          // "which sample" is a free choice and pinning it would be pinning an implementation detail.
          const second = (() => {
            let s = -Infinity;
            for (let jy = iy + 1; jy < ny; jy++) {
              if (jy === bestIy) continue;
              const a = altAppDeg(dsm.ground[jy * nx + ix], eye, (jy - iy) * cellM, drop);
              if (a > s) s = a;
            }
            return s;
          })();
          if (best - second > 1e-6) {
            expect(cellOfSlot(hulls.shear, got.srcIdx)).toBe(bestIy * nx + ix);
            srcChecked++;
          }
          compared++;
        }
      }
    }
    expect(compared).toBe(100 * 127 * 3);
    expect(srcChecked).toBeGreaterThan(compared * 0.9);
  });

  it("the last cell of a ray has nothing in front of it and says so", () => {
    const dsm = flatDsm(4, 6, 5);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const last = cellIndexAt(dsm, 2, 5); // northmost row, az 0 ⇒ no forward sample
    const q = queryRay(hulls, last, 1.7);
    expect(q.srcIdx).toBe(-1);
    expect(Number.isNaN(q.altAppDeg)).toBe(true);
    expect(q.distM).toBe(Infinity);
  });
});

// =============================================================================================
// PIN 3 — THE HULL IS INVARIANT IN EYE HEIGHT
// =============================================================================================

/**
 * THE pin the whole architecture rests on, and the one S6's `hullBuilds` counter re-pins at the
 * feed level. The serialised hull must be byte-identical across 1.7 / 100 / 400 m while the query
 * OUTPUT differs. It goes red if a lift term ever leaks into `buildHulls`, if a query mutates the
 * hull, or if the rejected `(H, D)` slab — which MUST rebuild on lift — is ever restored.
 */
describe("horizonSweep — PIN: hulls are lift-invariant, outputs are not", () => {
  function citylikeDsm(): LocalDsm {
    const nx = 41;
    const dsm = createLocalDsm({ nx, ny: nx, cellM: 10, originE: -200, originN: -200 });
    const rng = mulberry32(0xb00c);
    for (let c = 0; c < dsm.cellCount; c++) {
      dsm.ground[c] = rng() * 18;
      dsm.groundKnown[c] = 1;
    }
    for (let i = 0; i < 12; i++) {
      const e = rng() * 340 - 170;
      const n = rng() * 340 - 170;
      stampSolid(dsm, {
        ring: [e - 15, n - 15, e + 15, n - 15, e + 15, n + 15, e - 15, n + 15],
        baseM: 0,
        topM: 12 + rng() * 50,
        datum: "aboveGround",
        src: SRC_BUILDING,
      });
    }
    addFloatingSolid(dsm, {
      e0: -180,
      n0: 60,
      e1: 180,
      n1: 90,
      halfWidthM: 9,
      baseM: 24,
      topM: 29,
      src: SRC_DECK,
    });
    sealDsm(dsm);
    return dsm;
  }

  it("the SERIALISED hull is byte-identical across 1.7 / 100 / 400 m", () => {
    const dsm = citylikeDsm();
    const hulls = buildHulls(dsm, 42.5, { refractionK: K });
    const before = serializeHulls(hulls);
    const out = createSweepOut(dsm.cellCount, 1 << 15);
    const snapshots: Float32Array[] = [];
    for (const lift of [1.7, 100, 400]) {
      sweepAzimuth(dsm, hulls, 42.5, lift, out);
      snapshots.push(Float32Array.from(out.groundAltAppDeg));
      expect(serializeHulls(hulls)).toEqual(before);
    }
    // …while the OUTPUT genuinely moves. A hull that were secretly rebuilt per lift would also pass
    // the byte check above if the outputs were identical, so both halves are required.
    expect(snapshots[0]).not.toEqual(snapshots[1]);
    expect(snapshots[1]).not.toEqual(snapshots[2]);
    let moved = 0;
    for (let c = 0; c < dsm.cellCount; c++) {
      if (Math.abs(snapshots[0][c] - snapshots[2][c]) > 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(dsm.cellCount * 0.5);
  });

  it("the build is DETERMINISTIC — same DSM, same bytes", () => {
    const a = citylikeDsm();
    const b = citylikeDsm();
    expect(serializeHulls(buildHulls(a, 42.5, { refractionK: K }))).toEqual(
      serializeHulls(buildHulls(b, 42.5, { refractionK: K })),
    );
  });

  it("sweeping carries NO hidden state: 1.7 → 400 → 1.7 reproduces the first field exactly", () => {
    const dsm = citylikeDsm();
    const hulls = buildHulls(dsm, 42.5, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 15);
    sweepAzimuth(dsm, hulls, 42.5, 1.7, out);
    const first = Float32Array.from(out.groundAltAppDeg);
    const firstBands = out.bandUsed;
    sweepAzimuth(dsm, hulls, 42.5, 400, out);
    sweepAzimuth(dsm, hulls, 42.5, 1.7, out);
    expect(out.groundAltAppDeg).toEqual(first);
    expect(out.bandUsed).toBe(firstBands);
  });

  it("the setter moves monotonically OUTWARD as the eye rises — why the walk is O(1) amortised", () => {
    const dsm = citylikeDsm();
    const hulls = buildHulls(dsm, 42.5, { refractionK: K });
    let checked = 0;
    for (let c = 0; c < dsm.cellCount; c += 7) {
      let prev = -1;
      for (const lift of [1.7, 20, 100, 400, 2000]) {
        const q = queryRay(hulls, c, lift);
        if (q.srcIdx < 0) continue;
        if (prev >= 0) expect(q.distM).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = q.distM;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("refuses an UNSEALED DSM rather than sweeping a stale surface", () => {
    const dsm = citylikeDsm();
    dsm.sealed = false;
    expect(() => buildHulls(dsm, 0, { refractionK: K })).toThrow(/sealed/);
  });

  it("refuses hulls built from a different DSM, or asked for the wrong azimuth", () => {
    const dsm = citylikeDsm();
    const hulls = buildHulls(dsm, 42.5, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 16);
    expect(() => sweepAzimuth(dsm, hulls, 43.5, 1.7, out)).toThrow(/azimuth mismatch/);
    expect(() => sweepAzimuth(citylikeDsm(), hulls, 42.5, 1.7, out)).toThrow(/different DSM/);
  });
});

// =============================================================================================
// PIN 4 — A DECK IS A BAND, NOT A RAISED HORIZON
// =============================================================================================

/**
 * F3, the owner's hero location. A deck 10 m over the water at 1.5 km subtends a fraction of a degree
 * and leaves OPEN SKY beneath it; a max-only profile calls everything below its top blocked, so "the
 * sun setting behind the bridge" and "a blank 15-storey wall" become the same object — and the wall
 * then outscores an open river horizon. The negative control at the end of this test IS that wall, and
 * it produces a visibly different number.
 */
describe("horizonSweep — PIN: a deck yields a BAND, and leaves the ground horizon alone (F3)", () => {
  const CELL = 10;
  const N = 341; // ±1700 m
  const LIFT = 1.7;
  const DROP = (1 - K) / (2 * R_MEAN_M);

  function deckScene(asWall: boolean): { dsm: LocalDsm; centre: number } {
    const dsm = flatDsm(N, N, CELL, 0);
    const ring = [-200, 1492, 200, 1492, 200, 1508, -200, 1508];
    if (asWall) {
      // The bug this pin exists to catch: the deck rasterized into the height field.
      stampSolid(dsm, { ring, baseM: 10, topM: 14, datum: "absolute", src: SRC_DECK });
    } else {
      addFloatingSolid(dsm, {
        e0: -200,
        n0: 1500,
        e1: 200,
        n1: 1500,
        halfWidthM: 8,
        baseM: 10,
        topM: 14,
        src: SRC_DECK,
      });
    }
    sealDsm(dsm);
    return { dsm, centre: cellIndexAt(dsm, 170, 170) };
  }

  it("the band is [0.3095°, 0.4664°] at 1500 m, the GROUND channel stays terrain, and the RAY is headlined 'deck' (the old 'terrain' pin was the F_sil-killer)", () => {
    const { dsm, centre } = deckScene(false);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    sweepAzimuth(dsm, hulls, 0, LIFT, out);
    const ev = rayEvidenceAt(out, centre);

    // A BAND exists, with the near/far edges of a 16 m-wide deck at 1500 m.
    expect(ev.bands).toHaveLength(1);
    const [lo, hi] = ev.bands[0];
    expect(lo).toBeCloseTo(altAppDeg(10, LIFT, 1508, DROP), 5);
    expect(hi).toBeCloseTo(altAppDeg(14, LIFT, 1492, DROP), 5);
    expect(lo).toBeCloseTo(0.3095, 4);
    expect(hi).toBeCloseTo(0.4665, 4);
    expect(out.bandSrc[out.bandStart[centre]]).toBe(SRC_DECK);
    expect(out.bandDistM[out.bandStart[centre]]).toBeCloseTo(1492, 6);

    // …and the GROUND horizon is still the flat water beneath it, unchanged and NEGATIVE.
    expect(ev.groundAltAppDeg).toBeCloseTo(altAppDeg(0, LIFT, 1700, DROP), 5);
    expect(ev.groundAltAppDeg).toBeCloseTo(-0.0639, 4);
    expect(ev.groundAltAppDeg).toBeLessThan(lo); // THE claim: the deck did not raise the horizon
    // The GROUND channel is terrain — the water, 1700 m out at the grid edge. That much the old
    // assertion had right, and it is still pinned here, on the field that means it.
    expect(ev.groundSrc).toBe<OccluderSrc>("terrain");
    expect(ev.groundDistM).toBeCloseTo(1700, 6);
    // WHY THE OLD `expect(ev.src).toBe("terrain")` WAS WRONG (LENS B, 2026-08-24): it pinned the
    // ray's SUMMARY tag to the ground channel, and `localDsm` deliberately keeps floating solids out
    // of `surfaceSrc` — so a real bridge deck could only ever publish "terrain", and
    // `bestSpotMetric.silTangency`'s `!isBuiltSrc(ev.src)` early-return made the whole tangency
    // kernel unreachable for every deck the producer can emit. §3.2 defines the tag over "the
    // geometry that set Hg(a), OR the nearest band edge"; the deck's near edge is 1492 m and the
    // water horizon is 1700 m, so the NEAREST — and the thing the photograph is about — is the deck.
    expect(ev.src).toBe<OccluderSrc>("deck");
    expect(ev.blockerDistM).toBeCloseTo(1492, 6);
    expect(ev.bandSrc).toEqual<OccluderSrc[]>(["deck"]);
    expect(ev.bandDistM[0]).toBeCloseTo(1492, 6);
    expect(ev.known).toBe(1);
    // Something floats overhead, so this is not a genuinely open horizon.
    expect(ev.openSky).toBe(false);
  });

  it("THE WALL: the same geometry rasterized into the surface reads 0.466° of solid block", () => {
    const { dsm, centre } = deckScene(true);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    sweepAzimuth(dsm, hulls, 0, LIFT, out);
    const ev = rayEvidenceAt(out, centre);
    expect(ev.bands).toHaveLength(0);
    // 0.4639, not the deck band's 0.4665: a rasterized ring is quantised to CELL CENTRES, so the
    // wall's only row sits at n = 1500 rather than at the deck's true 1492 m near edge.
    expect(ev.groundAltAppDeg).toBeCloseTo(0.4639, 4);
    expect(ev.src).toBe("deck");
    // 0.53° apart on IDENTICAL geometry — the difference between an open river horizon and a wall.
    const asDeck = (() => {
      const s = deckScene(false);
      const h = buildHulls(s.dsm, 0, { refractionK: K });
      const o = createSweepOut(s.dsm.cellCount, 1 << 16);
      sweepAzimuth(s.dsm, h, 0, LIFT, o);
      return o.groundAltAppDeg[s.centre];
    })();
    expect(ev.groundAltAppDeg - asDeck).toBeGreaterThan(0.5);
  });

  it("a cell PAST the deck sees no band at all — bands are a suffix, not a global list", () => {
    const { dsm } = deckScene(false);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    sweepAzimuth(dsm, hulls, 0, LIFT, out);
    const beyond = cellIndexAt(dsm, 170, 330); // n = +1600, north of the deck
    expect(out.bandN[beyond]).toBe(0);
    const before = cellIndexAt(dsm, 170, 100); // n = −700, looking through the deck
    expect(out.bandN[before]).toBe(1);
  });

  it("a deck the eye is standing under is clipped, not reported as a ±90° sky-filling band", () => {
    const { dsm } = deckScene(false);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    sweepAzimuth(dsm, hulls, 0, LIFT, out, { nearClipM: 30 });
    const under = cellIndexAt(dsm, 170, 320); // n = +1500, directly beneath the deck
    expect(out.bandN[under]).toBe(0);
  });

  it("records band OVERFLOW instead of silently truncating", () => {
    const { dsm } = deckScene(false);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 4);
    sweepAzimuth(dsm, hulls, 0, LIFT, out);
    expect(out.bandOverflow).toBe(true);
    expect(out.bandUsed).toBe(4);
  });
});

// =============================================================================================
// PIN 5 — UNSAMPLED IS known = 0, AND IS NOT OPEN SKY
// =============================================================================================

/**
 * The shipped convention is that an unsampled bin REPORTS THE OPEN-SKY FLOOR (`createProfile` fills
 * `altDeg` with `openSkyAltDeg` and leaves `known = 0`), so any consumer that reads the value without
 * the flag converts ignorance into a good score — and `V` is the term that decides whether the body is
 * there at all. This test fixes both halves: the floor is published as a floor, and `openSky` — the
 * explicit boolean that replaces the fragile `alt === openSkyAltDeg` float test — stays FALSE.
 */
describe("horizonSweep — PIN: unsampled is known=0 and is NOT open sky", () => {
  function halfMappedDsm(): LocalDsm {
    const n = 81;
    const dsm = createLocalDsm({ nx: n, ny: n, cellM: 5, originE: -200, originN: -200 });
    for (let iy = 0; iy <= 40; iy++) {
      for (let ix = 0; ix < n; ix++) {
        dsm.ground[iy * n + ix] = 0;
        dsm.groundKnown[iy * n + ix] = 1;
      }
    }
    sealDsm(dsm);
    return dsm;
  }

  it("a ray with no forward evidence reports known=0, openSky=0 and src 'none'", () => {
    const dsm = halfMappedDsm();
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, hulls, 0, 1.7, out);

    // Standing on the last mapped row, looking north into unmapped terrain.
    const edge = cellIndexAt(dsm, 40, 40);
    const ev = rayEvidenceAt(out, edge);
    expect(ev.known).toBe(0);
    expect(ev.openSky).toBe(false); // ← the whole pin: a floor is not a measurement
    expect(ev.src).toBe("none");
    expect(ev.blockerDistM).toBe(Infinity);
    // The published value IS the eye's own dip — but it is labelled, not laundered.
    expect(ev.groundAltAppDeg).toBeCloseTo(horizonDipDeg(1.7, K), 5);

    // A cell with no ground at all has no eye either: NaN, not 0, not a dip.
    const unmapped = cellIndexAt(dsm, 40, 60);
    const ev2 = rayEvidenceAt(out, unmapped);
    expect(ev2.known).toBe(0);
    expect(ev2.openSky).toBe(false);
    expect(Number.isNaN(ev2.groundAltAppDeg)).toBe(true);
  });

  it("POSITIVE CONTROL: the same eye over mapped flat ground DOES report known=1 + openSky", () => {
    const dsm = halfMappedDsm();
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, hulls, 0, 1.7, out);
    const inside = cellIndexAt(dsm, 40, 20);
    const ev = rayEvidenceAt(out, inside);
    expect(ev.known).toBe(1);
    expect(ev.openSky).toBe(true);
    expect(ev.src).toBe("terrain");
    expect(ev.groundAltAppDeg).toBeLessThan(0); // SIGNED, never floored at the dip
  });

  it("a BUILT horizon is never openSky, however low it is", () => {
    const dsm = flatDsm(81, 81, 5, 0);
    stampSolid(dsm, {
      ring: [-30, 190, 30, 190, 30, 200, -30, 200],
      baseM: 0,
      topM: 0.5,
      datum: "aboveGround",
      src: SRC_BUILDING,
    });
    sealDsm(dsm);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, hulls, 0, 1.7, out);
    const centre = cellIndexAt(dsm, 40, 40);
    expect(out.groundSrc[centre]).toBe(SRC_BUILDING);
    expect(out.openSky[centre]).toBe(0);
    expect(out.known[centre]).toBe(1);
  });
});

// =============================================================================================
// The shear, and the two traversals
// =============================================================================================

describe("horizonSweep — the shear is a BIJECTION (every cell on exactly one ray)", () => {
  it("covers every cell exactly once at every azimuth, on a non-square grid", () => {
    const nx = 37;
    const ny = 53;
    for (const az of [0, 17.3, 45, 88.9, 90, 135, 180, 226.4, 270, 271.4, 315, 359.6]) {
      const sh = buildShear(nx, ny, 3, az);
      const seen = new Uint8Array(nx * ny);
      for (let c = 0; c < nx * ny; c++) {
        const slot = slotOfCell(sh, c);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(nx * ny);
        expect(seen[slot]).toBe(0);
        seen[slot] = 1;
        expect(cellOfSlot(sh, slot)).toBe(c);
      }
      expect(sh.rayStart[sh.rayCount]).toBe(nx * ny);
      // The along-ray step is the true spacing, so a diagonal ray is √2 cells per sample, not 1.
      expect(sh.dsM).toBeCloseTo(3 / Math.max(Math.abs(sh.ue), Math.abs(sh.un)), 12);
    }
  });

  it("rays run AWAY from the eye: at az 180 the samples walk south", () => {
    const sh = buildShear(5, 5, 10, 180);
    expect(sh.xDominant).toBe(false);
    expect(sh.sgn).toBe(-1);
    const slot0 = slotOfCell(sh, cellIndexAt(createLocalDsm({ nx: 5, ny: 5, cellM: 10 }), 2, 4));
    const slot1 = slotOfCell(sh, cellIndexAt(createLocalDsm({ nx: 5, ny: 5, cellM: 10 }), 2, 0));
    expect(slot1).toBeGreaterThan(slot0); // the SOUTH cell is further along a south-facing ray
  });

  it("a due-east sweep really looks east: a wall to the east blocks, one to the west does not", () => {
    const dsm = flatDsm(41, 41, 5, 0);
    stampSolid(dsm, {
      ring: [90, -40, 100, -40, 100, 40, 90, 40],
      baseM: 0,
      topM: 40,
      datum: "aboveGround",
      src: SRC_BUILDING,
    });
    sealDsm(dsm);
    const centre = cellIndexAt(dsm, 20, 20);
    const east = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, buildHulls(dsm, 90, { refractionK: K }), 90, 1.7, east);
    const west = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, buildHulls(dsm, 270, { refractionK: K }), 270, 1.7, west);
    expect(east.groundSrc[centre]).toBe(SRC_BUILDING);
    expect(east.groundAltAppDeg[centre]).toBeGreaterThan(20);
    expect(west.groundSrc[centre]).toBe(SRC_TERRAIN);
    expect(west.groundAltAppDeg[centre]).toBeLessThan(0);
  });
});

describe("horizonSweep — the two traversals agree", () => {
  it("queryRay (chain walk) == sweepAzimuth (binary peak search) on every known cell", () => {
    const nx = 45;
    const rng = mulberry32(0xa11ce);
    const dsm = createLocalDsm({ nx, ny: nx, cellM: 4, originE: -88, originN: -88 });
    for (let c = 0; c < dsm.cellCount; c++) {
      dsm.ground[c] = rng() * 40;
      dsm.groundKnown[c] = 1;
    }
    for (let i = 0; i < 6; i++) {
      const e = rng() * 160 - 80;
      const n = rng() * 160 - 80;
      stampSolid(dsm, {
        ring: [e - 8, n - 8, e + 8, n - 8, e + 8, n + 8, e - 8, n + 8],
        baseM: 0,
        topM: 10 + rng() * 40,
        datum: "aboveGround",
        src: SRC_BUILDING,
      });
    }
    sealDsm(dsm);
    const out = createSweepOut(dsm.cellCount, 16);
    let checked = 0;
    for (const az of [0, 33.7, 90, 158.2, 244.9]) {
      const hulls = buildHulls(dsm, az, { refractionK: K });
      sweepAzimuth(dsm, hulls, az, 12, out);
      for (let c = 0; c < dsm.cellCount; c++) {
        const q = queryRay(hulls, c, 12);
        if (q.srcIdx < 0) {
          expect(out.known[c]).toBe(0);
          continue;
        }
        expect(out.known[c]).toBe(1);
        expect(out.srcSlot[c]).toBe(q.srcIdx);
        expect(out.groundAltAppDeg[c]).toBeCloseTo(q.altAppDeg, 5);
        // Float32 storage vs the float64 return — 173 m round-trips to ~4e-6 m.
        expect(out.groundDistM[c]).toBeCloseTo(q.distM, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8000);
  });

  it("a per-cell lift array equals the scalar path when the lift is constant", () => {
    const dsm = flatDsm(31, 31, 6, 0);
    stampSolid(dsm, {
      ring: [-20, 60, 20, 60, 20, 70, -20, 70],
      baseM: 0,
      topM: 25,
      datum: "aboveGround",
      src: SRC_BUILDING,
    });
    sealDsm(dsm);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const a = createSweepOut(dsm.cellCount, 16);
    const b = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, hulls, 0, 30, a);
    sweepAzimuth(dsm, hulls, 0, new Float32Array(dsm.cellCount).fill(30), b);
    expect(b.groundAltAppDeg).toEqual(a.groundAltAppDeg);
    expect(b.known).toEqual(a.known);
  });

  it("a cell on a BLUFF has a DEPRESSED horizon — the signed value `raiseBin` cannot express", () => {
    // North half at 0 m, south half (where the eye stands) at 60 m: the horizon is genuinely BELOW
    // the eye's dip, which a profile floored at `openSkyAltDeg` and only ever RAISED cannot report.
    const n = 41;
    const dsm = createLocalDsm({ nx: n, ny: n, cellM: 10, originE: -200, originN: -200 });
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        dsm.ground[iy * n + ix] = iy <= 20 ? 60 : 0;
        dsm.groundKnown[iy * n + ix] = 1;
      }
    }
    sealDsm(dsm);
    const out = createSweepOut(dsm.cellCount, 16);
    sweepAzimuth(dsm, buildHulls(dsm, 0, { refractionK: K }), 0, 1.7, out);
    const brink = cellIndexAt(dsm, 20, 20);
    expect(out.groundAltAppDeg[brink]).toBeLessThan(-10);
    expect(out.groundAltAppDeg[brink]).toBeLessThan(horizonDipDeg(1.7, K));
    expect(out.known[brink]).toBe(1);
  });
});

// =============================================================================================
// The memory ledger and the measured cost
// =============================================================================================

describe("horizonSweep — residency and cost", () => {
  function benchDsm(radiusM: number, cellM: number): LocalDsm {
    const spec = discGridSpec(radiusM, cellM);
    const dsm = createLocalDsm(spec);
    const rng = mulberry32(0xbeef);
    // A gentle relief plus noise — a perfectly flat field would give a 2-vertex hull and flatter the
    // measurement; real terrain plus buildings keeps the stack working.
    for (let iy = 0; iy < spec.ny; iy++) {
      for (let ix = 0; ix < spec.nx; ix++) {
        const c = iy * spec.nx + ix;
        dsm.ground[c] = 12 * Math.sin(ix / 23) * Math.cos(iy / 31) + rng() * 3;
        dsm.groundKnown[c] = 1;
      }
    }
    const buildings = Math.round((spec.nx * spec.ny) / 400);
    const half = (spec.nx * cellM) / 2;
    for (let i = 0; i < buildings; i++) {
      const e = rng() * 2 * half - half;
      const n = rng() * 2 * half - half;
      stampSolid(dsm, {
        ring: [e - 9, n - 9, e + 9, n - 9, e + 9, n + 9, e - 9, n + 9],
        baseM: 0,
        topM: 8 + rng() * 45,
        datum: "aboveGround",
        src: SRC_BUILDING,
      });
    }
    sealDsm(dsm);
    return dsm;
  }

  it("PIN: one azimuth's hulls stay at ~12 B/cell — no cells-sized index map may come back", () => {
    const dsm = benchDsm(300, 3);
    const hulls = buildHulls(dsm, 37, { refractionK: K });
    const perCell = hullBytes(hulls) / dsm.cellCount;
    // zs (Float64) + link (Int32) = 12 B; the shear's own arrays are O(nx+ny), not O(cells). A
    // `cellSlot`/`slotCell` pair would push this to 20 B and re-open §5's memory wall at 1 m.
    expect(perCell).toBeGreaterThan(11.9);
    expect(perCell).toBeLessThan(12.6);
  });

  it("MEASURED COST — buildHulls + sweepAzimuth at 201² (3 m) and 601² (1 m)", () => {
    const rows: string[] = [];
    for (const [radius, cell] of [
      [300, 3],
      [300, 1],
    ] as const) {
      const dsm = benchDsm(radius, cell);
      const out = createSweepOut(dsm.cellCount, 1 << 10);
      // Warm BOTH halves on throwaway azimuths first — an unwarmed first sweep reads ~3× slow and
      // would make the smaller grid look more expensive than the larger one.
      for (const w of [11, 67, 199]) sweepAzimuth(dsm, buildHulls(dsm, w, { refractionK: K }), w, 1.7, out);
      let build = 0;
      let sweep = 0;
      const AZ = [23, 101.5, 218.25];
      for (const az of AZ) {
        let t = performance.now();
        const hulls = buildHulls(dsm, az, { refractionK: K });
        build += performance.now() - t;
        t = performance.now();
        sweepAzimuth(dsm, hulls, az, 1.7, out);
        sweep += performance.now() - t;
        expect(out.known.reduce((a, b) => a + b, 0)).toBeGreaterThan(dsm.cellCount * 0.9);
      }
      const b = build / AZ.length;
      const s = sweep / AZ.length;
      rows.push(
        `${dsm.nx}²@${cell}m  cells=${dsm.cellCount}  build=${b.toFixed(1)}ms  sweep=${s.toFixed(1)}ms` +
          `  perAz=${(b + s).toFixed(1)}ms  K=24 ⇒ ${((b + s) * 24).toFixed(0)}ms` +
          `  hull=${(hullBytes(buildHulls(dsm, 23, { refractionK: K })) / 1e6).toFixed(2)}MB/az`,
      );
    }
    console.log("\n[BESTSPOT S2b measured]\n" + rows.join("\n") + "\n");
    expect(rows).toHaveLength(2);
  }, 120_000);
});

// =============================================================================================
// LENS B (2026-08-24) — LEFT RED ON PURPOSE. See the audit report.
// =============================================================================================

/**
 * THE BUG CLASS: **a floating deck loses its own tag, so `F_sil` can never fire on the owner's hero
 * geometry.**
 *
 * `sweepAzimuth` writes `out.src[cell] = surfaceSrc[<the GROUND setter's cell>]`, and a floating
 * solid is deliberately never rasterised into `surfaceTop`/`surfaceSrc` (localDsm pin 2). So for a
 * REAL bridge deck over water the published `RayEvidence.src` is `"terrain"` — the far bank — and
 * `rayEvidenceAt` also drops `out.bandSrc` / `out.bandDistM` entirely.
 *
 * Downstream, `bestSpotMetric.silTangency` early-returns on `!isBuiltSrc(ev.src)`, so the tangency
 * kernel — the term BESTSPOT_PLAN §3.4 wrote FOR the bridge ("a deck has TWO edges and the body can
 * be tangent to the underside", `nearestEdgeDeltaDeg`'s own docstring) — is structurally unreachable
 * for every genuine deck. `F` collapses to `F_notch`, which is 0 over flat water, so "the sun setting
 * behind the Central Bridge" earns exactly the framing score of an empty horizon.
 *
 * The metric's own PIN 3 passes only because its fixture hand-writes `src: "deck"` on a ray that this
 * producer cannot emit (`horizonSweep.test.ts` above asserts `ev.src === "terrain"` for the same
 * geometry). §3.2 defines the setter tag over "the geometry that set Hg(a), OR the nearest band edge"
 * — the band half of that sentence is not implemented.
 */
describe("horizonSweep — RED: a swept bridge DECK is untagged, so F_sil is dead on the hero case", () => {
  const CELL = 10;
  const N = 341; // ±1700 m, the same scene as the F3 pin above
  const LIFT = 1.7;
  const RHO = 0.2635; // solar angular radius (deg)

  function sweptDeckEvidence() {
    const dsm = flatDsm(N, N, CELL, 0);
    addFloatingSolid(dsm, {
      e0: -200,
      n0: 1500,
      e1: 200,
      n1: 1500,
      halfWidthM: 8,
      baseM: 10,
      topM: 14,
      src: SRC_DECK,
    });
    sealDsm(dsm);
    const hulls = buildHulls(dsm, 0, { refractionK: K });
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    sweepAzimuth(dsm, hulls, 0, LIFT, out);
    const centre = cellIndexAt(dsm, 170, 170);
    return { out, centre, ev: rayEvidenceAt(out, centre) };
  }

  it("the DECK's tag survives the sweep into RayEvidence.src", () => {
    const { out, centre, ev } = sweptDeckEvidence();
    // The sweep KNOWS it is a deck…
    expect(out.bandSrc[out.bandStart[centre]]).toBe(SRC_DECK);
    // …and the contract's own `OccluderSrc` has a `"deck"` member for exactly this. RED: "terrain".
    expect(ev.src).toBe<OccluderSrc>("deck");
  });

  it("the sun tangent to the deck's UNDERSIDE scores a silhouette", () => {
    const { ev } = sweptDeckEvidence();
    expect(ev.bands).toHaveLength(1);
    const underside = ev.bands[0][0]; // 0.3095° — the "sun under the bridge" frame
    // S3b: re-expressed against `grazeSample`, which replaced `silTangency` (owner ruling R5). The
    // claim is unchanged — the deck's own underside is a frame and it is priced at the DECK's range
    // — but it is now made per EDGE, and the two halves are separately visible:
    const g = grazeSample(ev, underside, RHO, DIP_AT_LIFT, BESTSPOT_SCORING_V1, 1);
    // `cut` — dead tangent on the underside, so the triangular arm is exactly 1.
    expect(g.cut).toBeCloseTo(1, 12);
    // `Q` — the DECK's own tag, the DECK's own 1492 m, and relief measured above the observer's dip.
    expect(g.src).toBe<OccluderSrc>("deck");
    expect(g.distM).toBeCloseTo(1492, 3);
    expect(g.q).toBeCloseTo(
      smoothstep(0.05, 0.4, underside - DIP_AT_LIFT) * 0.9 * depthOfDistM(1492, 3_000),
      12,
    );
    expect(g.q).toBeGreaterThan(0);
    // …and the tag is no longer a GATE: the old kernel early-returned 0 here unless `ev.src` was
    // built, which is why this test used to have to relabel the ray to prove the plumbing. Under
    // GRAZE the same geometry tagged `terrain` still frames — it is worth MORE, not less (1.00
    // against a deck's 0.90), which is the whole of R5 in one line.
    const asTerrain = grazeSample(
      { ...ev, bandSrc: ["terrain"] },
      underside,
      RHO,
      DIP_AT_LIFT,
      BESTSPOT_SCORING_V1,
      1,
    );
    expect(asTerrain.q).toBeCloseTo(g.q / 0.9, 12);
  });
});

// =============================================================================================
// LENS B ACCEPTANCE — the COMPOSED claim the two RED assertions above only set up
// =============================================================================================

/**
 * The RED pair proves the tag reaches `RayEvidence` and that the kernel then fires. This proves the
 * thing the owner actually cares about: **the bridge is an ASSET, not a liability.**
 *
 * Measured before the fix, on exactly this geometry: `f = 0`, `S = 0.60799` WITH the deck against
 * `S = 0.62306` for the same cell with NO BRIDGE AT ALL. The hero location of the whole feature was
 * ranked BELOW empty water, and every slice's own tests were green while it was.
 *
 * The two scenes differ by ONE `addFloatingSolid` call, so nothing but the deck can move the number.
 */
describe("horizonSweep × bestSpotMetric — ACCEPTANCE: the bridge OUTSCORES the empty river", () => {
  const CELL = 10;
  const N = 341; // ±1700 m, the F3 hero scene
  const LIFT = 1.7;
  const RHO = 0.2635;
  /** Azimuths swept around due north, at §8's shipped 0.25° step. The 400 m deck at 1500 m subtends
   *  ±7.6°, so every one of these rays crosses it. */
  const AZS = Array.from({ length: 25 }, (_, i) => -3 + i * 0.25);

  /** Rays for the centre cell across `AZS`, from a real sweep — no hand-written evidence anywhere. */
  function sweepCentre(withDeck: boolean): RayEvidence[] {
    const dsm = flatDsm(N, N, CELL, 0);
    if (withDeck) {
      addFloatingSolid(dsm, {
        e0: -200,
        n0: 1500,
        e1: 200,
        n1: 1500,
        halfWidthM: 8,
        baseM: 10,
        topM: 14,
        src: SRC_DECK,
      });
    }
    sealDsm(dsm);
    const centre = cellIndexAt(dsm, 170, 170);
    const out = createSweepOut(dsm.cellCount, 1 << 16);
    return AZS.map((az) => {
      sweepAzimuth(dsm, buildHulls(dsm, az, { refractionK: K }), az, LIFT, out);
      return rayEvidenceAt(out, centre);
    });
  }

  /** A sunset descending THROUGH the deck band [0.3095°, 0.4665°] and on down to the water at
   *  −0.0639°, azimuth-indexed onto the swept rays exactly as the §3.1 contract requires. */
  function sunsetTrack(): EventTrack {
    const topDeg = 1.2;
    const bottomDeg = -0.35;
    const n = AZS.length;
    const samples: TrackSample[] = AZS.map((az, i) => {
      const altAppDeg = topDeg + ((bottomDeg - topDeg) * i) / (n - 1);
      return {
        utcMs: 1_700_000_000_000 + i * 60_000,
        azDeg: (az + 360) % 360,
        altAppDeg,
        rhoDeg: RHO,
        w: Math.exp(-Math.max(0, altAppDeg) / 2.5),
      };
    });
    const sum = samples.reduce((a, s) => a + s.w, 0);
    return {
      kind: "sunset",
      t0Ms: samples[0].utcMs,
      samples: samples.map((s) => ({ ...s, w: s.w / sum })),
      windowLo: 0,
      windowHi: n - 1,
      setAzDeg: 0,
      worth: 1,
    };
  }

  const ACCESS: CellAccess = { hard: 1, soft: 1, cls: "deck", groundReachable: true };

  it("ACCEPTANCE — the same cell scores STRICTLY HIGHER with the deck than without it", () => {
    const track = sunsetTrack();
    const withDeck = cellScore(sweepCentre(true), track, ACCESS, BESTSPOT_METRIC_DEFAULTS);
    const bare = cellScore(sweepCentre(false), track, ACCESS, BESTSPOT_METRIC_DEFAULTS);
    expect(withDeck.verdict).toBe("scored");
    expect(bare.verdict).toBe("scored");
    // THE claim. Before the fix this comparison ran the other way (0.60799 vs 0.62306).
    expect(withDeck.score).toBeGreaterThan(bare.score);
    // …and by a real margin, not by 1e-9: the framing term is what the bridge buys.
    //
    // S3b: `> 0.1` → `> 0.05`, measured **0.05698**. This fixture's track is HAND-BUILT — 25 samples
    // over 1.55° of altitude, `windowLo = 0, windowHi = n − 1`, hand-made weights — which is the
    // very thing `bestSpotComposition.test.ts` exists to stop standing in for the real chain. On the
    // REAL `eventTrack` the same scene measures a **0.12613** margin and that file asserts `> 0.1`
    // unchanged. The number moved because GRAZE prices a 4 m slab by how long the sun rides it
    // (F 0.8294 → 0.4318 here) instead of saturating on any built edge the centre crosses.
    expect(withDeck.score - bare.score).toBeGreaterThan(0.05);
    // The channel that carries it — GRAZE fires on the DECK's own band edge, weighted by the DECK's
    // own 1492 m, not by the far bank's 1700 m. S3b: `> 0.8` → `> 0.4` (measured 0.43176).
    expect(withDeck.f).toBeGreaterThan(0.4);
    expect(withDeck.grazeSrc).toBe<OccluderSrc>("deck");
    expect(withDeck.grazeDistM).toBeCloseTo(1492, 3);
    // …and the bare river is still EXACTLY 0, for a better reason: RELIEF, not provenance. Proven
    // as a number in the test below.
    expect(bare.f).toBe(0);
    expect(withDeck.srcStar).toBe<OccluderSrc>("deck");
    expect(bare.srcStar).toBe<OccluderSrc>("terrain");
    // The bridge DOES cost visibility — it really is in the way for part of the descent. The point
    // is that the composition prices that against the frame it buys instead of only the loss.
    expect(withDeck.v).toBeLessThan(bare.v);
  });

  it("the deck's tangency is priced at the DECK's distance, and the water under it is NOT a silhouette", () => {
    const rays = sweepCentre(true);
    const mid = rays[Math.floor(rays.length / 2)];
    expect(mid.bands).toHaveLength(1);
    // Per-EDGE depth: the deck's own near edge, not the ray's ground setter 208 m further out.
    expect(mid.bandDistM[0]).toBeCloseTo(1492, 3);
    expect(mid.groundDistM).toBeCloseTo(1700, 3);
    // S3b: `silTangency(mid, underside, RHO, 0, 3000)` became `grazeSample(...).q`. Same claim —
    // per-EDGE depth, the deck's own near edge and not the ray's ground setter 208 m further out —
    // now with relief and confidence spelled out beside it instead of folded in.
    const atUnderside = grazeSample(mid, mid.bands[0][0], RHO, DIP_AT_LIFT, BESTSPOT_SCORING_V1, 1);
    expect(atUnderside.distM).toBeCloseTo(1492, 3);
    expect(atUnderside.q).toBeCloseTo(
      smoothstep(0.05, 0.4, mid.bands[0][0] - DIP_AT_LIFT) * 0.9 * depthOfDistM(1492, 3_000),
      12,
    );
    expect(atUnderside.q).not.toBeCloseTo(
      smoothstep(0.05, 0.4, mid.bands[0][0] - DIP_AT_LIFT) * 0.9 * depthOfDistM(1700, 3_000),
      6,
    );
    // THE MIRROR-IMAGE BUG, guarded: the ray's HEADLINE tag is "deck", but the thing AT the ground
    // horizon is water. Gating the ground edge on `ev.src` instead of `ev.groundSrc` would score an
    // open river horizon as a built silhouette — the same defect with the sign flipped.
    expect(mid.src).toBe<OccluderSrc>("deck");
    expect(mid.groundSrc).toBe<OccluderSrc>("terrain");
    // …AND IT SURVIVES S3b FOR A BETTER REASON, which this test now PROVES rather than assumes.
    // The old reason was PROVENANCE: `isBuiltSrc("terrain")` is false, so the ground edge was
    // ineligible — a rule that also scored an 8 km mountain ridge at 0, which is why R5 deleted it.
    // The new reason is RELIEF: the water horizon sits at −0.0639°, BELOW the observer's own dip of
    // −0.0390°, so `e − dipFloor` is −0.0249° and `smoothstep(0.05, 0.40, ·)` is a hard 0. There is
    // no edge standing above the horizon to ride.
    const atWater = grazeSample(mid, mid.groundAltAppDeg, RHO, DIP_AT_LIFT, BESTSPOT_SCORING_V1, 1);
    expect(atWater.q).toBe(0);
    expect(atWater.src).toBe<OccluderSrc>("terrain"); // …and it was NOT rejected for its tag
    expect(BESTSPOT_SCORING_V1.graze.conf.terrain).toBe(1); // terrain is the MOST trusted source
    expect(mid.groundAltAppDeg).toBeLessThan(DIP_AT_LIFT); // ← the actual reason, stated as a number
    expect(smoothstep(0.05, 0.4, mid.groundAltAppDeg - DIP_AT_LIFT)).toBe(0);
    // THE CONTROL: lift that same water line above the relief ramp and the identical `terrain` tag
    // frames at full confidence. Provenance was never what stopped it.
    const raised = grazeSample(
      { ...mid, groundAltAppDeg: DIP_AT_LIFT + 0.5 },
      DIP_AT_LIFT + 0.5,
      RHO,
      DIP_AT_LIFT,
      BESTSPOT_SCORING_V1,
      1,
    );
    expect(raised.q).toBeCloseTo(depthOfDistM(1700, 3_000), 12);
  });
});
