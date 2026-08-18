import { describe, expect, it } from "vitest";
import {
  bilinearHeight,
  flatNearFade,
  nightDimFor,
  ribbonStrip,
  vectorPresence,
} from "../../../src/components/globe/scene/vectorFeatures";
import { VECTOR } from "../../../src/components/globe/tuning";

/**
 * Vector feature web (S7 feedback batch) — the pure geometry/gate helpers: presence band,
 * night dim, ribbon strip construction, and the terrain height lattice lookup.
 */
describe("vectorPresence (reveal band)", () => {
  it("hidden at/above topAltM, full at/below fullAltM", () => {
    expect(vectorPresence(VECTOR.topAltM)).toBe(0);
    expect(vectorPresence(VECTOR.topAltM + 1)).toBe(0);
    expect(vectorPresence(VECTOR.fullAltM)).toBe(1);
    expect(vectorPresence(200)).toBe(1);
  });
});

describe("nightDimFor (unlit ink must not glow at night)", () => {
  it("full by day, floored at VECTOR.nightDim by night, monotone between", () => {
    expect(nightDimFor(0.5)).toBe(1);
    expect(nightDimFor(-0.5)).toBeCloseTo(VECTOR.nightDim, 10);
    let prev = nightDimFor(-0.2);
    for (let s = -0.2; s <= 0.2; s += 0.02) {
      const d = nightDimFor(s);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });
});

describe("ribbonStrip (road/waterway ribbons with real widths)", () => {
  it("a straight 2-point line becomes one quad of the requested width", () => {
    const strip = ribbonStrip(
      [
        { x: 0, y: 0, z: 5 },
        { x: 100, y: 0, z: 5 },
      ],
      10,
    );
    expect(strip).not.toBeNull();
    expect(strip!.positions).toHaveLength(4 * 3);
    expect(strip!.indices).toHaveLength(6);
    // Offsets are ±width/2 perpendicular to the +X direction (i.e. in Y).
    const ys = [strip!.positions[1], strip!.positions[4]];
    expect(Math.abs(ys[0] - ys[1])).toBeCloseTo(10, 9);
    // z passes through untouched (terrain seating happens before the strip).
    expect(strip!.positions[2]).toBe(5);
  });

  it("interior vertices use the averaged direction (miter continuity)", () => {
    const strip = ribbonStrip(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      2,
    );
    expect(strip).not.toBeNull();
    // 3 points → 6 vertices, 2 segments → 4 triangles.
    expect(strip!.positions).toHaveLength(6 * 3);
    expect(strip!.indices).toHaveLength(12);
    // The corner's offset direction bisects the 90° turn: perpendicular of (1,1)/√2.
    const cx = strip!.positions[6];
    const cy = strip!.positions[7];
    const dx = cx - 10;
    const dy = cy - 0;
    expect(Math.abs(dx + dy)).toBeCloseTo(0, 9); // along (-1,1)/√2 (or its negation)
  });

  it("rejects degenerate input", () => {
    expect(ribbonStrip([{ x: 0, y: 0, z: 0 }], 5)).toBeNull();
    expect(ribbonStrip([], 5)).toBeNull();
    expect(
      ribbonStrip(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        0,
      ),
    ).toBeNull();
  });
});

describe("bilinearHeight (terrain lattice lookup)", () => {
  const n = 3;
  // 3×3 lattice: rows are v (0, 0.5, 1), columns u — a simple slope in u.
  const lattice = new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);

  it("hits the corners and interpolates the middle", () => {
    expect(bilinearHeight(lattice, n, 0, 0)).toBe(0);
    expect(bilinearHeight(lattice, n, 1, 0)).toBe(20);
    expect(bilinearHeight(lattice, n, 0.5, 0.5)).toBeCloseTo(10, 9);
    expect(bilinearHeight(lattice, n, 0.25, 0)).toBeCloseTo(5, 9);
  });

  it("clamps outside the unit square and zeroes NaN slots", () => {
    expect(bilinearHeight(lattice, n, -1, 0)).toBe(0);
    expect(bilinearHeight(lattice, n, 2, 1)).toBe(20);
    const withNaN = new Float32Array([Number.NaN, 10, 20, 0, 10, 20, 0, 10, 20]);
    // The NaN corner reads as 0 — the layer builds flat there instead of exploding.
    expect(bilinearHeight(withNaN, n, 0, 0)).toBe(0);
  });
});

describe("VECTOR width tables (the render filter)", () => {
  it("bridge-capable road classes carry positive widths; transit is parsed but never built", () => {
    expect(VECTOR.roadWidthM.motorway).toBeGreaterThan(VECTOR.roadWidthM.minor);
    expect(VECTOR.roadWidthM.minor).toBeGreaterThan(VECTOR.roadWidthM.path);
    expect(VECTOR.roadWidthM.transit).toBe(0);
    expect(VECTOR.waterwayWidthM.river).toBeGreaterThan(VECTOR.waterwayWidthM.stream);
  });
});

describe("flatNearFade (2D-map street-zoom ink fade)", () => {
  it("full ink at/above the hi edge, the floor at/below the lo edge, monotone between", () => {
    expect(flatNearFade(VECTOR.flatNearFadeHiAltM)).toBe(1);
    expect(flatNearFade(5_000)).toBe(1);
    expect(flatNearFade(VECTOR.flatNearFadeLoAltM)).toBeCloseTo(VECTOR.flatNearFadeFloor, 12);
    expect(flatNearFade(0)).toBeCloseTo(VECTOR.flatNearFadeFloor, 12);
    const mid = (VECTOR.flatNearFadeLoAltM + VECTOR.flatNearFadeHiAltM) / 2;
    expect(flatNearFade(mid)).toBeGreaterThan(VECTOR.flatNearFadeFloor);
    expect(flatNearFade(mid)).toBeLessThan(1);
  });
});
