import { describe, expect, it } from "vitest";
import {
  circDiffDeg,
  deviceToEarth,
  LOOK_HORIZ_MIN,
  LookSmoother,
  poseFromEuler,
  specCompassHeading,
  wrapDeg360,
} from "../../../src/lib/sensors/deviceOrientation";

/**
 * The AR look-around math (owner order 2026-09-07g) — pinned with the KNOWN POSES the brief named
 * and the W3C spec's own consistency checks. Frames per the spec §3.1: device x right / y top /
 * z out of the screen; Earth X east / Y north / Z up; R = Rz(α)·Rx(β)·Ry(γ).
 */

const D2R = Math.PI / 180;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(circDiffDeg(a, b)) < tol;

describe("poseFromEuler — the named poses", () => {
  it("phone FLAT, screen up, top pointing NORTH → yaw 0 / pitch −90 (the top edge decides yaw)", () => {
    const p = poseFromEuler(0, 0, 0);
    expect(p.pitchDeg).toBeCloseTo(-90, 6);
    expect(p.lookHoriz).toBeLessThan(LOOK_HORIZ_MIN);
    expect(near(p.yawDeg, 0)).toBe(true);
    expect(p.topHoriz).toBeCloseTo(1, 9);
  });

  it("flat with the top pointing WEST (the spec's α = 90 example) → yaw 270", () => {
    const p = poseFromEuler(90, 0, 0);
    expect(near(p.yawDeg, 270)).toBe(true);
    expect(near(p.topHeadingDeg, 270)).toBe(true);
    expect(p.pitchDeg).toBeCloseTo(-90, 6);
  });

  it("UPRIGHT, rear camera facing NORTH → yaw 0 / pitch 0; the top edge points at the sky", () => {
    const p = poseFromEuler(0, 90, 0);
    expect(near(p.yawDeg, 0)).toBe(true);
    expect(p.pitchDeg).toBeCloseTo(0, 6);
    expect(p.topHoriz).toBeLessThan(1e-9); // the compass says nothing about yaw here (rung 2's gate)
  });

  it("UPRIGHT facing EAST → yaw 90 / pitch 0 (α is the compass heading's opposite sense)", () => {
    const p = poseFromEuler(270, 90, 0);
    expect(near(p.yawDeg, 90)).toBe(true);
    expect(p.pitchDeg).toBeCloseTo(0, 6);
  });

  it("tilted UP past vertical (β = 120) looks 30° above the horizon", () => {
    expect(poseFromEuler(0, 120, 0).pitchDeg).toBeCloseTo(30, 6);
    expect(poseFromEuler(0, 60, 0).pitchDeg).toBeCloseTo(-30, 6);
  });

  it("the spec's consistency checks: γ = 0 ⇒ heading = −α; β = 90 ⇒ heading = −(α + γ)", () => {
    for (const a of [0, 30, 100, 200, 359]) {
      expect(near(poseFromEuler(a, 45, 0).yawDeg, -a)).toBe(true);
      for (const g of [-40, 0, 25]) expect(near(poseFromEuler(a, 90, g).yawDeg, -(a + g), 1e-5)).toBe(true);
    }
  });

  it("agrees with the spec's §A.1 compassHeading() everywhere the heading is defined", () => {
    let n = 0;
    for (let a = 0; a < 360; a += 23)
      for (let b = -170; b <= 170; b += 17)
        for (let g = -85; g <= 85; g += 19) {
          const p = poseFromEuler(a, b, g);
          if (p.lookHoriz < LOOK_HORIZ_MIN) continue;
          expect(near(p.yawDeg, specCompassHeading(a, b, g), 1e-6)).toBe(true);
          n++;
        }
    expect(n).toBeGreaterThan(1000); // the lattice really was walked
  });
});

/** Rotation matrix (row-major 3×3) → the spec's (α, β, γ), Chromium's `orientation_util.cc`
 *  generic branch: α = atan2(−r01, r11), β = asin(r21), γ = atan2(−r20, r22). */
function eulerFromBasis(ex: [number, number, number], ey: [number, number, number], ez: [number, number, number]) {
  // columns are the images of the device axes; row-major r[i][j] = column j, row i
  const r01 = ey[0];
  const r11 = ey[1];
  const r21 = ey[2];
  const r20 = ex[2];
  const r22 = ez[2];
  return {
    alphaDeg: wrapDeg360(Math.atan2(-r01, r11) / D2R),
    betaDeg: Math.asin(Math.max(-1, Math.min(1, r21))) / D2R,
    gammaDeg: Math.atan2(-r20, r22) / D2R,
  };
}

describe("screen rotation — the rear camera does not care which way the UI is turned", () => {
  it("BOTH landscape holds of the same physical aim give the same yaw / pitch, and only roll moves ±90°", () => {
    let checked = 0;
    for (const [a, b, g] of [
      [270, 80, 0],
      [45, 60, 10],
      [180, 100, -20],
      [10, 45, 30],
    ]) {
      const portrait = poseFromEuler(a, b, g);
      if (portrait.lookHoriz < LOOK_HORIZ_MIN) continue;
      const bx = deviceToEarth(a, b, g, { x: 1, y: 0, z: 0 });
      const by = deviceToEarth(a, b, g, { x: 0, y: 1, z: 0 });
      const bz = deviceToEarth(a, b, g, { x: 0, y: 0, z: 1 });
      for (const sign of [1, -1]) {
        // The phone turned ±90° about its OWN z (the look axis): new x' = ±y, new y' = ∓x, z' = z.
        const ex: [number, number, number] = sign > 0 ? [by.x, by.y, by.z] : [-by.x, -by.y, -by.z];
        const ey: [number, number, number] = sign > 0 ? [-bx.x, -bx.y, -bx.z] : [bx.x, bx.y, bx.z];
        const ez: [number, number, number] = [bz.x, bz.y, bz.z];
        const e = eulerFromBasis(ex, ey, ez);
        // The UI follows the turn: screen angle 90 or 270 (counter-clockwise from natural).
        const screenAngle = sign > 0 ? 270 : 90;
        const landscape = poseFromEuler(e.alphaDeg, e.betaDeg, e.gammaDeg, screenAngle);
        expect(near(landscape.yawDeg, portrait.yawDeg, 1e-4)).toBe(true);
        expect(landscape.pitchDeg).toBeCloseTo(portrait.pitchDeg, 4);
        // With the UI re-oriented the picture's up is level again — roll returns to portrait's.
        expect(Math.abs(circDiffDeg(landscape.rollDeg, portrait.rollDeg))).toBeLessThan(1e-3);
        // …and WITHOUT the UI angle the raw roll is the ±90° of the physical turn.
        const raw = poseFromEuler(e.alphaDeg, e.betaDeg, e.gammaDeg, 0);
        expect(Math.abs(Math.abs(circDiffDeg(raw.rollDeg, portrait.rollDeg)) - 90)).toBeLessThan(1e-3);
        checked++;
      }
    }
    expect(checked).toBe(8);
  });

  it("an extractor's alternative Euler triple (α+180, 180−β, γ+180) is the SAME rotation — the vectors do not care", () => {
    // WebKit's extraction jumps between the two Euler solutions as the screen passes vertical
    // (`R[8]` changes sign); both name one rotation, so everything derived from the VECTORS is
    // identical — exactly why the product never reads α/β/γ directly.
    for (const [a, b, g] of [
      [30, 89.9, 5],
      [120, 100, -20],
      [200, 45, 30],
    ]) {
      const p = poseFromEuler(a, b, g);
      const q = poseFromEuler(a + 180, 180 - b, g + 180);
      expect(Math.abs(circDiffDeg(p.yawDeg, q.yawDeg))).toBeLessThan(1e-6);
      expect(q.pitchDeg).toBeCloseTo(p.pitchDeg, 9);
      expect(Math.abs(circDiffDeg(p.rollDeg, q.rollDeg))).toBeLessThan(1e-6);
    }
    // …and two poses a hair apart across vertical are a hair apart in yaw/pitch.
    const before = poseFromEuler(30, 89.9, 5);
    const after = poseFromEuler(30, 90.1, 5);
    expect(Math.abs(circDiffDeg(before.yawDeg, after.yawDeg))).toBeLessThan(0.5);
    expect(Math.abs(before.pitchDeg - after.pitchDeg)).toBeLessThan(0.5);
  });
});

describe("LookSmoother — a vector EMA with a dead-band", () => {
  it("passes the first sample through, holds inside the dead-band, tracks a real turn", () => {
    const sm = new LookSmoother(80, 0.3);
    expect(sm.push(10, 5, 0)).toEqual({ headingDeg: 10, pitchDeg: 5 });
    // ±0.1° tremor: nothing moves
    for (let i = 1; i < 30; i++) {
      const o = sm.push(10 + (i % 2 ? 0.1 : -0.1), 5 + (i % 3 ? 0.05 : -0.05), i * 16);
      expect(o).toEqual({ headingDeg: 10, pitchDeg: 5 });
    }
    // a 40° turn tracks within a few time constants
    let o = { headingDeg: 10, pitchDeg: 5 };
    for (let i = 30; i < 60; i++) o = sm.push(50, 5, i * 16);
    expect(Math.abs(circDiffDeg(o.headingDeg, 50))).toBeLessThan(0.5);
  });

  it("crosses 0/360 without a seam", () => {
    const sm = new LookSmoother(40, 0.2);
    sm.push(358, 0, 0);
    let o = { headingDeg: 358, pitchDeg: 0 };
    for (let i = 1; i < 40; i++) o = sm.push(2, 0, i * 16);
    expect(Math.abs(circDiffDeg(o.headingDeg, 2))).toBeLessThan(0.3);
    expect(o.headingDeg).toBeGreaterThanOrEqual(0);
    expect(o.headingDeg).toBeLessThan(360);
  });
});
