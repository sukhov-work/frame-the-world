import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declinationDeg, decimalYear, fieldXY, WMM_EPOCH, WMM_VALID_UNTIL } from "../../../src/lib/geo/wmm";

/**
 * WMM2025 — pinned to NOAA's OFFICIAL test-value file (`WMM2025_TestValues.txt`, shipped inside
 * `WMM2025COF.zip`; the first seven fields: decimal year, altitude km, lat, lon, D, I, H) — 100 rows
 * at 2025.0 / 2026.0 / 2027.5 / 2028.0 / 2029.5, altitudes 0–100 km, both hemispheres, the poles'
 * neighbourhoods. The file prints D and I to 0.01°, H to nT·1e-6. A wrong Legendre recursion, a
 * wrong normalisation sign, a mis-typed coefficient or a swapped g/h column all fail here by degrees.
 *
 * The sea-level anchors are the NOAA calculator (WMM-2025, API v1.2.1) read 2026-09-07; BGS's
 * independent evaluator agrees to 0.001° at Dnipro and London.
 */

const rows = readFileSync(join(__dirname, "fixtures", "wmm2025-testvalues.txt"), "utf8")
  .trim()
  .split("\n")
  .map((l) => l.trim().split(/\s+/).map(Number));

describe("WMM2025 — the official test vectors", () => {
  it("has the 100 rows (zero-result probe)", () => {
    expect(rows.length).toBe(100);
  });

  it("declination matches every official row to 0.01°", () => {
    const bad: string[] = [];
    for (const [year, altKm, lat, lon, D] of rows) {
      const d = declinationDeg(lat, lon, altKm, year);
      if (Math.abs(d - D) > 0.0051) bad.push(`${year} ${altKm} ${lat} ${lon}: ${d.toFixed(3)} vs ${D}`);
    }
    expect(bad).toEqual([]);
  });

  it("inclination and H match too (the full vector is right, not just its angle)", () => {
    const bad: string[] = [];
    for (const [year, altKm, lat, lon, , I, H] of rows) {
      const { X, Y, Z } = fieldXY(lat, lon, altKm, year);
      const h = Math.hypot(X, Y);
      const inc = (Math.atan2(Z, h) * 180) / Math.PI;
      if (Math.abs(inc - I) > 0.0051 || Math.abs(h - H) > 0.5) bad.push(`${year} ${lat} ${lon}: I ${inc.toFixed(3)} vs ${I} · H ${h.toFixed(1)} vs ${H.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("WMM2025 — sea-level anchors (NOAA calculator, 2026-09-07)", () => {
  const anchors: [string, number, number, number, number][] = [
    // name, lat, lon, decimal year, D
    ["Dnipro 2026.0", 48.45, 35.07, 2026.0, 8.54067],
    ["Dnipro 2026-09-07", 48.45, 35.07, decimalYear(new Date("2026-09-07T00:00:00Z")), 8.58172],
    ["London", 51.5, -0.1276, 2026.0, 1.07737],
    ["New York", 40.7128, -74.006, 2026.0, -12.49427],
    ["Sydney", -33.8688, 151.2093, 2026.0, 12.81],
    ["Cape Town", -33.9249, 18.4241, 2026.0, -26.62439],
  ];
  for (const [name, lat, lon, year, D] of anchors) {
    it(`${name} → ${D}° (±0.1°)`, () => {
      expect(Math.abs(declinationDeg(lat, lon, 0, year) - D)).toBeLessThan(0.1);
    });
  }

  it("the un-corrected compass error the AR ladder exists to remove is ~8.6° at Dnipro", () => {
    const d = declinationDeg(48.45, 35.07, 0, 2026.68);
    expect(d).toBeGreaterThan(8.4);
    expect(d).toBeLessThan(8.7);
    // Sign convention: trueHeading = magneticHeading + declination (east-positive).
    expect(((90 + d) % 360) - 90).toBeCloseTo(d, 6);
  });

  it("decimalYear is the WMM convention (day-of-year fraction)", () => {
    expect(decimalYear(new Date("2026-01-01T00:00:00Z"))).toBe(2026);
    expect(decimalYear(new Date("2026-07-02T12:00:00Z"))).toBeCloseTo(2026.5, 3);
    expect(WMM_EPOCH).toBe(2025);
    expect(WMM_VALID_UNTIL).toBe(2030);
  });
});
