import { describe, it, expect } from "vitest";
import {
  geodeticToEcef,
  enuBasis,
  cameraForward,
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
