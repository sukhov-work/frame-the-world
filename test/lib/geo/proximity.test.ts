import { describe, expect, it } from "vitest";
import { roughDistDeg2, sortByProximity } from "../../../src/lib/geo/proximity";

// The MY PLACES nearest-first ordering (owner 2026-08-19b). Load-bearing: the ranking must
// be monotonic with true distance at planning scales and survive the antimeridian — a place
// across the date line is NEAR, not half a world away.

describe("roughDistDeg2", () => {
  it("is zero at the same point and grows with separation", () => {
    expect(roughDistDeg2(48.45, 35.05, 48.45, 35.05)).toBe(0);
    const near = roughDistDeg2(48.45, 35.05, 48.5, 35.1); // ~7 km
    const far = roughDistDeg2(48.45, 35.05, 50.45, 30.5); // ~390 km
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it("wraps the antimeridian — 179.9°E to 179.9°W is near, not 359.8° apart", () => {
    const wrapped = roughDistDeg2(0, 179.9, 0, -179.9);
    const unwrapped = roughDistDeg2(0, 179.9, 0, 170);
    expect(wrapped).toBeLessThan(unwrapped);
  });

  it("cos-corrects longitude: 1° of lon at 60°N ranks closer than 1° at the equator", () => {
    expect(roughDistDeg2(60, 0, 60, 1)).toBeLessThan(roughDistDeg2(0, 0, 0, 1));
  });
});

describe("sortByProximity", () => {
  const rows = [
    { id: "far", latDeg: 51.5, lonDeg: -0.1 }, // London
    { id: "near", latDeg: 48.5, lonDeg: 35.0 }, // Dnipro suburb
    { id: "mid", latDeg: 50.45, lonDeg: 30.5 }, // Kyiv
  ];

  it("orders nearest-first from the given position and never mutates the input", () => {
    const sorted = sortByProximity(rows, 48.45, 35.05);
    expect(sorted.map((r) => r.id)).toEqual(["near", "mid", "far"]);
    expect(rows[0].id).toBe("far"); // input untouched
  });

  it("is stable for exact ties (keeps fetch order — newest first)", () => {
    const dup = [
      { id: "a", latDeg: 10, lonDeg: 10 },
      { id: "b", latDeg: 10, lonDeg: 10 },
    ];
    expect(sortByProximity(dup, 0, 0).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
