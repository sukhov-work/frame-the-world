import { describe, it, expect } from "vitest";
import {
  geodeticToEcef,
  enuBasis,
  cameraForward,
  dirAzAltDeg,
  length,
  WGS84_A,
  WGS84_B,
} from "../../../src/lib/geo/projection";

describe("geodeticToEcef — axis reference points", () => {
  it("(0,0,0) sits on +X at the equatorial radius", () => {
    const [x, y, z] = geodeticToEcef(0, 0, 0);
    expect(x).toBeCloseTo(WGS84_A, 0);
    expect(y).toBeCloseTo(0, 2);
    expect(z).toBeCloseTo(0, 6);
  });
  it("(0,90,0) sits on +Y", () => {
    const [x, y, z] = geodeticToEcef(0, 90, 0);
    expect(x).toBeCloseTo(0, 2);
    expect(y).toBeCloseTo(WGS84_A, 0);
    expect(z).toBeCloseTo(0, 6);
  });
  it("(90,0,0) sits on +Z at the polar radius (oblateness)", () => {
    const [x, y, z] = geodeticToEcef(90, 0, 0);
    expect(x).toBeCloseTo(0, 2);
    expect(y).toBeCloseTo(0, 2);
    expect(z).toBeCloseTo(WGS84_B, 0);
  });
  it("altitude adds along the ellipsoid normal at the equator", () => {
    const [x] = geodeticToEcef(0, 0, 1000);
    expect(x).toBeCloseTo(WGS84_A + 1000, 0);
  });
  it("Dnipro lands ~6.37e6 m from the geocentre", () => {
    const d = length(geodeticToEcef(48.4647, 35.0462, 0));
    expect(d).toBeGreaterThan(6.36e6);
    expect(d).toBeLessThan(6.38e6);
  });
});

describe("enuBasis at (0,0)", () => {
  it("east=+Y, north=+Z, up=+X", () => {
    const { east, north, up } = enuBasis(0, 0);
    expect(east).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6), expect.closeTo(0, 6)]);
    expect(north).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    expect(up).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)]);
  });
});

describe("cameraForward heading/pitch at (0,0)", () => {
  const near = (v: readonly number[], e: readonly number[]) =>
    v.forEach((c, i) => expect(c).toBeCloseTo(e[i], 6));

  it("heading 0, pitch 0 → north (+Z)", () => near(cameraForward(0, 0, 0, 0), [0, 0, 1]));
  it("heading 90 → east (+Y)", () => near(cameraForward(0, 0, 90, 0), [0, 1, 0]));
  it("pitch +90 → straight up (+X)", () => near(cameraForward(0, 0, 0, 90), [1, 0, 0]));
  it("pitch -90 → straight down (-X)", () => near(cameraForward(0, 0, 123, -90), [-1, 0, 0]));
  it("is always unit length", () => {
    for (const hp of [[0, 0], [37, 12], [270, -45], [180, 80]] as const) {
      expect(length(cameraForward(10, 20, hp[0], hp[1]))).toBeCloseTo(1, 6);
    }
  });
});

describe("dirAzAltDeg — dir→bearing against an ENU basis (audit-2 A5 fold; inverse of cameraForward)", () => {
  const toXyz = (v: readonly [number, number, number]) => ({ x: v[0], y: v[1], z: v[2] });

  it("round-trips cameraForward for a grid of heading/pitch at Dnipro", () => {
    const basis = enuBasis(48.4647, 35.0462);
    for (const [h, p] of [[0, 0], [90, 0], [180, 45], [270, -30], [359.5, 80], [37.2, -12.8]] as const) {
      const { azDeg, altDeg } = dirAzAltDeg(toXyz(cameraForward(48.4647, 35.0462, h, p)), basis);
      expect(azDeg).toBeCloseTo(h, 5);
      expect(altDeg).toBeCloseTo(p, 5);
    }
  });

  it("wraps azimuth to [0,360) — a due-west direction reads 270, never −90", () => {
    const basis = enuBasis(0, 0);
    const { azDeg } = dirAzAltDeg(toXyz(cameraForward(0, 0, 270, 0)), basis);
    expect(azDeg).toBeCloseTo(270, 6);
    expect(azDeg).toBeGreaterThanOrEqual(0);
  });

  it("clamps the up-dot: a straight-up direction is exactly +90 alt, no NaN", () => {
    const basis = enuBasis(45, 45);
    const { altDeg } = dirAzAltDeg(toXyz(basis.up), basis);
    expect(altDeg).toBeCloseTo(90, 6);
  });
});
