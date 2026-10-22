import { describe, expect, it } from "vitest";
import {
  facadeCameraBasis,
  facadePoseOfBasis,
  facadeReprojection,
  projectFacadePoint,
  solveFacadePose,
  type FacadeEnuPose,
  type FacadePair,
  type Vec3,
} from "../../../src/lib/geo/pnp";
import { frustumGeometry } from "../../../src/lib/geo/frustum";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";
import { verticalFovDeg } from "../../../src/lib/decode/sensors";

/**
 * F5's remainder (T172, 2026-10-23) — the pure PnP solve for the facade alignment pairs. The
 * conventions are pinned AGAINST THE APP'S OWN BUILDERS: the camera basis is `frustumGeometry`'s
 * (frustum.ts — heading / pitch / roll / the roll sign), the uv frame is the projector's sample
 * frame (u right, v DOWN — buildingMaterial.ts `vec2(ftwUv.x, 1.0 - ftwUv.y)`), and the far face's
 * corners land on (0, 0) … (1, 1) in `frustumGeometry`'s own corner order.
 */

const DEG = Math.PI / 180;
const LAT = 48.4647;
const LON = 35.0462;
const ALT = 112.4;

/** A seeded LCG — deterministic "random" (the harnesses' `mulberry32` idiom). */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** A Box–Muller normal. */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** The app's own vectors are READONLY tuples (`lib/geo/projection.Vec3`); the solver's are mutable. */
type RVec3 = readonly [number, number, number];
/** ECEF → ENU metres about the apex (the test's bridge from the app's builder to the solver's frame). */
const ecefToEnu = (p: RVec3, origin: RVec3, b: ReturnType<typeof enuBasis>): Vec3 => {
  const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  const dot = (v: RVec3) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return [dot(b.east), dot(b.north), dot(b.up)];
};

/** The facade wall: a planar 20 × 12 m grid of points standing `distM` ahead of the camera's
 *  forward, FACING it (the wall's plane ⊥ the horizontal forward), ENU metres about the camera. */
function wallPoints(pose: FacadeEnuPose, n: number, distM: number, seed: number, leavePlane = 0): Vec3[] {
  const r = rng(seed);
  const h = pose.headingDeg * DEG;
  const fwd: Vec3 = [Math.sin(h), Math.cos(h), 0];
  const right: Vec3 = [Math.cos(h), -Math.sin(h), 0];
  const centre: Vec3 = [pose.enu[0] + fwd[0] * distM, pose.enu[1] + fwd[1] * distM, pose.enu[2] + 4];
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const sx = (i < 4 ? [-1, 1, 1, -1][i] : r() * 2 - 1) * 10; // the first four = the corners (a square's homography)
    const sy = (i < 4 ? [1, 1, -1, -1][i] : r() * 2 - 1) * 6;
    const depth = i === n - 1 && leavePlane ? leavePlane : 0;
    pts.push([centre[0] + right[0] * sx + fwd[0] * depth, centre[1] + right[1] * sx + fwd[1] * depth, centre[2] + sy]);
  }
  return pts;
}
const pairsFor = (pose: FacadeEnuPose, pts: Vec3[], aspect: number, noisePx = 0, widthPx = 1600, seed = 7): FacadePair[] => {
  const r = rng(seed);
  return pts.map((enu) => {
    const uv = projectFacadePoint(enu, pose, aspect);
    if (!uv) throw new Error("a synthesized point fell behind the camera");
    if (noisePx > 0) {
      uv[0] += (gauss(r) * noisePx) / widthPx;
      uv[1] += (gauss(r) * noisePx) / (widthPx / aspect);
    }
    return { uv, enu };
  });
};
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const POSES: FacadeEnuPose[] = [
  { enu: [0, 0, 0], headingDeg: 0, pitchDeg: -5, rollDeg: 0, hFovDeg: 50 },
  { enu: [3, -2, 1.5], headingDeg: 90, pitchDeg: 12, rollDeg: 2.5, hFovDeg: 69.4 },
  { enu: [-7, 11, 0.4], headingDeg: 214.5, pitchDeg: -5, rollDeg: 2.5, hFovDeg: 69.4 },
  { enu: [1, 1, 2], headingDeg: 214.5, pitchDeg: 12, rollDeg: 0, hFovDeg: 50 },
];
const ASPECTS = [4 / 3, 3 / 2];

describe("the camera basis — frustumGeometry's, verbatim (heading / pitch / roll / the roll sign)", () => {
  it("facadeCameraBasis equals the app's basis expressed in ENU for every pose", () => {
    const b = enuBasis(LAT, LON);
    const toEnu = (v: RVec3): Vec3 => [v[0] * b.east[0] + v[1] * b.east[1] + v[2] * b.east[2], v[0] * b.north[0] + v[1] * b.north[1] + v[2] * b.north[2], v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2]];
    for (const p of [...POSES, { enu: [0, 0, 0] as Vec3, headingDeg: 359.9, pitchDeg: 0, rollDeg: -7, hFovDeg: 60 }]) {
      const g = frustumGeometry({ latDeg: LAT, lonDeg: LON, altM: ALT, headingDeg: p.headingDeg, pitchDeg: p.pitchDeg, rollDeg: p.rollDeg, hFovDeg: p.hFovDeg, vFovDeg: verticalFovDeg(p.hFovDeg, 1.5), planeDistM: 10 });
      const mine = facadeCameraBasis(p.headingDeg, p.pitchDeg, p.rollDeg);
      for (const [row, app] of [[mine[0], toEnu(g.right)], [mine[1], toEnu(g.up)], [mine[2], toEnu(g.forward)]] as [Vec3, Vec3][])
        for (let i = 0; i < 3; i++) expect(row[i]).toBeCloseTo(app[i], 11);
    }
  });

  it("the uv frame: the far face's top-left is (0, 0), the bottom-right (1, 1), the centre (½, ½) — through frustumGeometry's corners", () => {
    for (const aspect of ASPECTS)
      for (const p of POSES) {
        const d = 40;
        const g = frustumGeometry({ latDeg: LAT, lonDeg: LON, altM: ALT, headingDeg: p.headingDeg, pitchDeg: p.pitchDeg, rollDeg: p.rollDeg, hFovDeg: p.hFovDeg, vFovDeg: verticalFovDeg(p.hFovDeg, aspect), planeDistM: d });
        const b = enuBasis(LAT, LON);
        const origin = geodeticToEcef(LAT, LON, ALT);
        const pose: FacadeEnuPose = { ...p, enu: [0, 0, 0] };
        const [tl, tr, br, bl] = g.corners.map((c) => projectFacadePoint(ecefToEnu(c, origin, b), pose, aspect)!);
        expect(tl[0]).toBeCloseTo(0, 9);
        expect(tl[1]).toBeCloseTo(0, 9);
        expect(tr[0]).toBeCloseTo(1, 9);
        expect(tr[1]).toBeCloseTo(0, 9);
        expect(br[0]).toBeCloseTo(1, 9);
        expect(br[1]).toBeCloseTo(1, 9);
        expect(bl[0]).toBeCloseTo(0, 9);
        expect(bl[1]).toBeCloseTo(1, 9);
        const centre = ecefToEnu([g.apex[0] + g.forward[0] * d, g.apex[1] + g.forward[1] * d, g.apex[2] + g.forward[2] * d], origin, b);
        const c = projectFacadePoint(centre, pose, aspect)!;
        expect(c[0]).toBeCloseTo(0.5, 9);
        expect(c[1]).toBeCloseTo(0.5, 9);
      }
    // Behind the camera → null.
    expect(projectFacadePoint([0, -10, 0], POSES[0], 1.5)).toBeNull();
  });

  it("pose ↔ basis round-trips (heading wrapped, roll signed, a −0 folded)", () => {
    for (const p of POSES) {
      const back = facadePoseOfBasis(facadeCameraBasis(p.headingDeg, p.pitchDeg, p.rollDeg));
      expect(angDiff(back.headingDeg, p.headingDeg)).toBeLessThan(1e-9);
      expect(back.pitchDeg).toBeCloseTo(p.pitchDeg, 9);
      expect(back.rollDeg).toBeCloseTo(p.rollDeg, 9);
    }
    const z = facadePoseOfBasis(facadeCameraBasis(0, 0, 0));
    expect(Object.is(z.headingDeg, 0)).toBe(true);
    expect(Object.is(z.rollDeg, 0)).toBe(true);
    expect(facadePoseOfBasis(facadeCameraBasis(-90, 0, 0)).headingDeg).toBeCloseTo(270, 9);
  });
});

describe("solveFacadePose — exact recovery (noise-free)", () => {
  const check = (res: ReturnType<typeof solveFacadePose>, truth: FacadeEnuPose, posTol = 1e-3, angTol = 1e-4) => {
    expect(res.ok, res.reason).toBe(true);
    for (let i = 0; i < 3; i++) expect(Math.abs(res.pose.enu[i] - truth.enu[i]), `enu[${i}]`).toBeLessThan(posTol);
    expect(angDiff(res.pose.headingDeg, truth.headingDeg), "heading").toBeLessThan(angTol);
    expect(Math.abs(res.pose.pitchDeg - truth.pitchDeg), "pitch").toBeLessThan(angTol);
    expect(Math.abs(res.pose.rollDeg - truth.rollDeg), "roll").toBeLessThan(angTol);
    expect(res.rmsPx).toBeLessThan(1e-4);
  };

  it("the PLANAR path: a facing wall, N 4 / 6 / 12, every seeded pose and aspect", () => {
    let seed = 1;
    for (const aspect of ASPECTS)
      for (const truth of POSES)
        for (const n of [4, 6, 12]) {
          const pairs = pairsFor(truth, wallPoints(truth, n, 25 + (seed % 5) * 11, seed++), aspect);
          const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect, widthPx: 1600 });
          expect(res.planar).toBe(true);
          expect(res.fovSolved).toBe(false);
          check(res, truth);
          for (const p of pairs) expect(projectFacadePoint(p.enu, res.pose, aspect)).not.toBeNull(); // in front: the right sign
        }
  });

  it("the GENERAL path: one point off the plane (N 6 / 12) — the DLT start, the same recovery", () => {
    let seed = 40;
    for (const aspect of ASPECTS)
      for (const truth of POSES)
        for (const n of [6, 12]) {
          const pairs = pairsFor(truth, wallPoints(truth, n, 30 + (seed % 4) * 12, seed++, 6), aspect);
          const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect, widthPx: 1600 });
          expect(res.planar).toBe(false);
          check(res, truth);
        }
  });

  it("N 4–5 off the plane still solves (the planar start on the best-fit plane feeds the refinement)", () => {
    const truth = POSES[1];
    const pairs = pairsFor(truth, wallPoints(truth, 5, 40, 99, 3), 4 / 3);
    const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect: 4 / 3, widthPx: 1600 });
    check(res, truth, 1e-2, 1e-3);
  });

  it("a caller's init pose is a second start — the EXIF pose 2 m / 3° off converges to the truth", () => {
    const truth = POSES[2];
    const pairs = pairsFor(truth, wallPoints(truth, 6, 50, 5), 3 / 2);
    const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect: 3 / 2, widthPx: 1600 }, { init: { enu: [truth.enu[0] + 2, truth.enu[1] - 1, truth.enu[2] + 0.5], headingDeg: truth.headingDeg + 3, pitchDeg: truth.pitchDeg - 2, rollDeg: 0 } });
    check(res, truth);
  });
});

describe("solveFacadePose — noise, the H-FOV, the outlier pass", () => {
  it("1 px Gaussian noise on a 1600-px frame, N 12: position < 0.8 m, angles < 1.2°, RMS < 2.5 px (the measured worst ×2 — a FRONTAL wall couples yaw with lateral translation)", () => {
    let seed = 300;
    let worstPos = 0;
    let worstAng = 0;
    for (const aspect of ASPECTS)
      for (const truth of POSES) {
        const pairs = pairsFor(truth, wallPoints(truth, 12, 35, seed++), aspect, 1, 1600, seed++);
        const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect, widthPx: 1600 });
        expect(res.ok, res.reason).toBe(true);
        const pos = Math.hypot(...(res.pose.enu.map((v, i) => v - truth.enu[i]) as Vec3));
        const ang = Math.max(angDiff(res.pose.headingDeg, truth.headingDeg), Math.abs(res.pose.pitchDeg - truth.pitchDeg), Math.abs(res.pose.rollDeg - truth.rollDeg));
        worstPos = Math.max(worstPos, pos);
        worstAng = Math.max(worstAng, ang);
        expect(pos).toBeLessThan(0.8);
        expect(ang).toBeLessThan(1.2);
        expect(res.rmsPx).toBeLessThan(2.5);
        expect(res.residuals).toHaveLength(12);
        expect(res.residuals.every((r) => Number.isFinite(r.px))).toBe(true);
      }
    // Measured 2026-10-23 (the seeds above, a 20 × 12 m wall at 35 m, 1 px σ): worst position 0.39 m,
    // worst angle 0.60°, worst RMS 1.37 px — the bars carry ~2×. (A frontal plane's yaw ↔ lateral
    // translation valley is what the member's pairs on ONE facade can resolve; a corner or a second
    // building tightens it — the UI should say so when every target is one wall.)
    expect(worstPos).toBeLessThan(0.8);
    expect(worstAng).toBeLessThan(1.2);
  });

  it("solveFov: N ≥ 6 recovers an H-FOV 8° off within 0.5° (noise-free: within 1e-3°); N 4–5 holds the given one", () => {
    const truth = POSES[1]; // 69.4°
    for (const [n, held] of [[6, false], [12, false], [5, true], [4, true]] as [number, boolean][]) {
      const pairs = pairsFor(truth, wallPoints(truth, n, 45, 500 + n, n >= 6 ? 5 : 0), 4 / 3);
      const res = solveFacadePose(pairs, { hFovDeg: 61.4, aspect: 4 / 3, widthPx: 1600 }, { solveFov: true });
      expect(res.ok, res.reason).toBe(true);
      expect(res.fovSolved).toBe(!held);
      if (held) expect(res.pose.hFovDeg).toBeCloseTo(61.4, 9);
      else {
        expect(Math.abs(res.pose.hFovDeg - 69.4)).toBeLessThan(1e-3);
        expect(angDiff(res.pose.headingDeg, truth.headingDeg)).toBeLessThan(1e-3);
      }
    }
    // With 1 px noise the solved H-FOV stays within 0.5°.
    const noisy = pairsFor(truth, wallPoints(truth, 12, 45, 600, 5), 4 / 3, 1, 1600, 601);
    const res = solveFacadePose(noisy, { hFovDeg: 61.4, aspect: 4 / 3, widthPx: 1600 }, { solveFov: true });
    expect(Math.abs(res.pose.hFovDeg - 69.4)).toBeLessThan(0.5);
  });

  it("one gross outlier among 12 (a mis-marked pair 40 px off) is down-weighted — the pose stays within the noisy bars", () => {
    const truth = POSES[3];
    const pairs = pairsFor(truth, wallPoints(truth, 12, 38, 700), 3 / 2, 0.5, 1600, 701);
    pairs[7] = { ...pairs[7], uv: [pairs[7].uv[0] + 40 / 1600, pairs[7].uv[1] - 25 / 1066] };
    const res = solveFacadePose(pairs, { hFovDeg: truth.hFovDeg, aspect: 3 / 2, widthPx: 1600 });
    expect(res.ok).toBe(true);
    // Measured 2026-10-23: 0.50 m / 0.39° with the outlier (0.17 m / 0.23° without) — the Huber pass
    // keeps it inside the noisy bars; the outlier itself stays REPORTED (45 px), never hidden.
    expect(Math.hypot(...(res.pose.enu.map((v, i) => v - truth.enu[i]) as Vec3))).toBeLessThan(0.8);
    expect(angDiff(res.pose.headingDeg, truth.headingDeg)).toBeLessThan(1.2);
    expect(res.residuals[7].px).toBeGreaterThan(20);
    expect(res.rmsPx).toBeGreaterThan(5); // the RMS tells the truth about the set
  });

  it("facadeReprojection prints a pose's residuals (the EXIF-vs-SOLVED readout): the truth ≈ 0, an offset pose > 0", () => {
    const truth = POSES[0];
    const pairs = pairsFor(truth, wallPoints(truth, 6, 30, 800), 4 / 3);
    expect(facadeReprojection(pairs, truth, { hFovDeg: truth.hFovDeg, aspect: 4 / 3, widthPx: 1600 }).rmsPx).toBeLessThan(1e-9);
    const off = facadeReprojection(pairs, { ...truth, headingDeg: truth.headingDeg + 1 }, { hFovDeg: truth.hFovDeg, aspect: 4 / 3, widthPx: 1600 });
    expect(off.rmsPx).toBeGreaterThan(10);
    expect(off.residuals[0].uv[0]).not.toBe(0);
  });
});

describe("solveFacadePose — the degenerate inputs answer ok: false, never throw", () => {
  const intr = { hFovDeg: 60, aspect: 4 / 3, widthPx: 1600 };
  it("fewer than 4 pairs", () => {
    const truth = POSES[0];
    const pairs = pairsFor(truth, wallPoints(truth, 4, 30, 1), 4 / 3).slice(0, 3);
    const res = solveFacadePose(pairs, intr);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/at least 4/);
    expect(res.residuals).toEqual([]);
  });
  it("four collinear world points", () => {
    const truth = POSES[0];
    const pts: Vec3[] = [0, 1, 2, 3].map((i) => [-6 + i * 4, 30, 3]);
    const res = solveFacadePose(pairsFor(truth, pts, 4 / 3), intr);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/collinear/);
  });
  it("a repeated point (world or photo)", () => {
    const truth = POSES[0];
    const pairs = pairsFor(truth, wallPoints(truth, 5, 30, 2), 4 / 3);
    pairs[4] = { ...pairs[4], enu: [...pairs[0].enu] as Vec3 };
    expect(solveFacadePose(pairs, intr).ok).toBe(false);
    const p2 = pairsFor(truth, wallPoints(truth, 5, 30, 2), 4 / 3);
    p2[4] = { ...p2[4], uv: [...p2[0].uv] as [number, number] };
    expect(solveFacadePose(p2, intr).ok).toBe(false);
  });
  it("bad intrinsics / a NaN pair", () => {
    const truth = POSES[0];
    const pairs = pairsFor(truth, wallPoints(truth, 6, 30, 3), 4 / 3);
    expect(solveFacadePose(pairs, { hFovDeg: 180, aspect: 4 / 3 }).ok).toBe(false);
    expect(solveFacadePose([{ uv: [Number.NaN, 0.5], enu: [0, 1, 2] }, ...pairs], intr).ok).toBe(false);
  });
});
