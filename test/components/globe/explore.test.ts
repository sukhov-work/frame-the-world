import { describe, expect, it } from "vitest";
import {
  edgeRamp,
  legOmegaRadPerS,
  lookAheadArcRad,
  orderByNearestNeighbour,
} from "../../../src/components/globe/explore";
import { WGS84_A } from "../../../src/lib/geo/projection";

const deg = (r: number) => (r * 180) / Math.PI;

describe("orderByNearestNeighbour (Explore journey, §Item 11)", () => {
  it("walks a west→east chain in order instead of zigzagging", () => {
    // Kyiv → Dnipro → Kharkiv-ish chain; start west of all of them.
    const pins = [
      { lat: 49.99, lon: 36.23 }, // Kharkiv (farthest east)
      { lat: 50.45, lon: 30.52 }, // Kyiv (nearest to the start)
      { lat: 48.46, lon: 35.05 }, // Dnipro (middle)
    ];
    expect(orderByNearestNeighbour(pins, 50.0, 25.0)).toEqual([1, 2, 0]);
  });

  it("visits every pin exactly once", () => {
    const pins = Array.from({ length: 12 }, (_, i) => ({
      lat: -30 + i * 7,
      lon: -120 + i * 23,
    }));
    const order = orderByNearestNeighbour(pins, 0, 0);
    expect([...order].sort((a, b) => a - b)).toEqual(pins.map((_, i) => i));
  });

  it("handles empty and single-pin lists", () => {
    expect(orderByNearestNeighbour([], 0, 0)).toEqual([]);
    expect(orderByNearestNeighbour([{ lat: 10, lon: 10 }], 0, 0)).toEqual([0]);
  });
});

describe("lookAheadArcRad (the cruise's constant-tilt look-at geometry)", () => {
  it("matches the spherical-triangle solution at the Explore pose", () => {
    // R=6378 km, h=900 km, tilt 50°: sin∠L = (7278/6378)·sin50° → γ = asin(...) − 50° ≈ 10.9°.
    const g = lookAheadArcRad(900_000, 50, WGS84_A);
    expect(deg(g)).toBeGreaterThan(10);
    expect(deg(g)).toBeLessThan(12);
  });

  it("is zero at nadir and grows with tilt", () => {
    expect(lookAheadArcRad(900_000, 0, WGS84_A)).toBe(0);
    const g30 = lookAheadArcRad(900_000, 30, WGS84_A);
    const g50 = lookAheadArcRad(900_000, 50, WGS84_A);
    expect(g30).toBeGreaterThan(0);
    expect(g50).toBeGreaterThan(g30);
  });

  it("clamps past-the-limb tilts to the horizon arc", () => {
    const horizon = Math.acos(WGS84_A / (WGS84_A + 900_000));
    expect(lookAheadArcRad(900_000, 88, WGS84_A)).toBeCloseTo(horizon, 10);
  });
});

describe("legOmegaRadPerS", () => {
  const min = 0.06;
  const max = 0.55;

  it("targets the leg duration in the meditative band", () => {
    // A 10° leg over 28 s → ~0.357°/s: inside the clamp, so exactly arc/target.
    const arc = (10 * Math.PI) / 180;
    expect(deg(legOmegaRadPerS(arc, 28, min, max))).toBeCloseTo(10 / 28, 6);
  });

  it("clamps tiny and huge legs to the band", () => {
    expect(deg(legOmegaRadPerS(0.0001, 28, min, max))).toBeCloseTo(min, 6);
    expect(deg(legOmegaRadPerS(Math.PI, 28, min, max))).toBeCloseTo(max, 6);
  });
});

describe("edgeRamp", () => {
  const FRAC = 0.18;
  const FLOOR = 0.12;

  it("is full speed through the middle and eased at both ends", () => {
    expect(edgeRamp(0.5, FRAC, FLOOR)).toBe(1);
    expect(edgeRamp(0.05, FRAC, FLOOR)).toBeLessThan(1);
    expect(edgeRamp(0.95, FRAC, FLOOR)).toBeLessThan(1);
  });

  it("never stalls: the floor keeps the ends progressing", () => {
    expect(edgeRamp(0, FRAC, FLOOR)).toBe(FLOOR);
    expect(edgeRamp(1, FRAC, FLOOR)).toBe(FLOOR);
    for (const p of [0, 0.01, 0.5, 0.99, 1]) {
      expect(edgeRamp(p, FRAC, FLOOR)).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});
