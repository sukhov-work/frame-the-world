import { describe, expect, it } from "vitest";
import { decodeGeohashBounds, encodeGeohash } from "../../../src/lib/geo/geohash";
import {
  DEFAULT_PRECISION_TIER,
  isPrecisionTier,
  reduceLocation,
  TIER_GEOHASH_PRECISION,
} from "../../../src/lib/geo/precision";

// Dnipro rooftop — the project's canonical test location (C6 context).
const LAT = 48.4647;
const LON = 35.0462;

describe("precision tiers (C6)", () => {
  it("defaults to a REDUCED tier, never exact", () => {
    expect(DEFAULT_PRECISION_TIER).not.toBe("exact");
  });

  it("maps tiers to the documented geohash precisions", () => {
    expect(TIER_GEOHASH_PRECISION.exact).toBe(9);
    expect(TIER_GEOHASH_PRECISION["1km"]).toBe(6);
    expect(TIER_GEOHASH_PRECISION.city).toBe(4);
  });

  it("validates tier strings", () => {
    expect(isPrecisionTier("1km")).toBe(true);
    expect(isPrecisionTier("exact")).toBe(true);
    expect(isPrecisionTier("City")).toBe(false);
    expect(isPrecisionTier(6)).toBe(false);
  });
});

describe("reduceLocation", () => {
  it("exact tier passes the input through with a p9 geohash", () => {
    const r = reduceLocation(LAT, LON, "exact");
    expect(r.latReduced).toBe(LAT);
    expect(r.lonReduced).toBe(LON);
    expect(r.geohash).toBe(encodeGeohash(LAT, LON, 9));
    expect(r.geohash).toHaveLength(9);
  });

  it("1km tier publishes the p6 cell center, not the input point", () => {
    const r = reduceLocation(LAT, LON, "1km");
    expect(r.latReduced).not.toBe(LAT);
    expect(r.lonReduced).not.toBe(LON);
    // the published point is the center of the cell that contains the input
    const cell = decodeGeohashBounds(encodeGeohash(LAT, LON, 6));
    expect(r.latReduced).toBeCloseTo((cell.latMin + cell.latMax) / 2, 12);
    expect(r.lonReduced).toBeCloseTo((cell.lonMin + cell.lonMax) / 2, 12);
    // and stays within the tier's error budget (p6 cell ≈ 1.2 × 0.61 km)
    expect(Math.abs(r.latReduced - LAT)).toBeLessThan(0.01);
    expect(Math.abs(r.lonReduced - LON)).toBeLessThan(0.011);
  });

  it("city tier publishes the p4 cell center (~tens of km cell)", () => {
    const r = reduceLocation(LAT, LON, "city");
    expect(r.geohash).toHaveLength(4);
    const cell = decodeGeohashBounds(r.geohash);
    expect(r.latReduced).toBeCloseTo((cell.latMin + cell.latMax) / 2, 12);
    expect(r.lonReduced).toBeCloseTo((cell.lonMin + cell.lonMax) / 2, 12);
  });

  it("every point in a cell maps to the SAME public location (anonymity set)", () => {
    const a = reduceLocation(48.46471, 35.04621, "1km");
    const b = reduceLocation(48.46479, 35.04629, "1km"); // ~10 m away, same p6 cell
    expect(a.latReduced).toBe(b.latReduced);
    expect(a.lonReduced).toBe(b.lonReduced);
    expect(a.geohash).toBe(b.geohash);
  });

  it("query prefixes derive from the PUBLIC location and nest correctly", () => {
    for (const tier of ["exact", "1km", "city"] as const) {
      const r = reduceLocation(LAT, LON, tier);
      expect(r.gh4).toHaveLength(4);
      expect(r.gh6).toHaveLength(6);
      expect(r.gh6.startsWith(r.gh4)).toBe(true);
      expect(r.geohash.startsWith(r.gh4)).toBe(true);
      // gh6 must contain the published point (what the globe renders)
      const b = decodeGeohashBounds(r.gh6);
      expect(r.latReduced).toBeGreaterThanOrEqual(b.latMin);
      expect(r.latReduced).toBeLessThanOrEqual(b.latMax);
      expect(r.lonReduced).toBeGreaterThanOrEqual(b.lonMin);
      expect(r.lonReduced).toBeLessThanOrEqual(b.lonMax);
    }
  });

  it("southern/western hemisphere works (negative coords)", () => {
    const r = reduceLocation(-33.8688, -70.6693, "1km");
    expect(r.geohash).toHaveLength(6);
    expect(Math.abs(r.latReduced - -33.8688)).toBeLessThan(0.01);
    expect(r.gh6.startsWith(r.gh4)).toBe(true);
  });
});
