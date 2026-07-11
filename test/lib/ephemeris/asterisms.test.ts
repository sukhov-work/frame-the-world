import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  asterismSegments,
  type AsterismsAsset,
} from "../../../src/lib/ephemeris/asterisms";
import { raDecToUnit } from "../../../src/lib/ephemeris/stars";

const asset: AsterismsAsset = JSON.parse(
  readFileSync(join(__dirname, "../../../public/data/asterisms.json"), "utf8"),
);

describe("baked asterisms asset", () => {
  it("carries the d3-celestial credit and the famous ~20-figure cut", () => {
    expect(asset.credit).toContain("d3-celestial");
    expect(asset.asterisms.length).toBeGreaterThanOrEqual(20);
    expect(asset.asterisms.length).toBeLessThanOrEqual(30);
    const ids = asset.asterisms.map((a) => a.id);
    expect(ids).toContain("BigDipper");
    expect(ids).toContain("SummerTriangle");
    expect(new Set(ids).size).toBe(ids.length); // dedupe held (NorthernCross repeats upstream)
  });

  it("stores RA in DEGREES 0–360 (the unit trap the parser owns)", () => {
    for (const a of asset.asterisms) {
      for (const line of a.lines) {
        for (const [ra, dec] of line) {
          expect(ra).toBeGreaterThanOrEqual(0);
          expect(ra).toBeLessThan(360);
          expect(Math.abs(dec)).toBeLessThanOrEqual(90);
        }
      }
    }
    // Dubhe (α UMa): RA 11h03.7m ≈ 165.93°, Dec +61.75° — degrees, unmistakably not hours.
    const dipper = asset.asterisms.find((a) => a.id === "BigDipper")!;
    const dubhe = dipper.lines[0].find(([ra]) => Math.abs(ra - 165.932) < 0.01);
    expect(dubhe).toBeDefined();
    expect(dubhe![1]).toBeCloseTo(61.751, 2);
  });
});

describe("asterismSegments", () => {
  const segs = asterismSegments(asset);

  it("emits unit vectors paired for LineSegments", () => {
    expect(segs.positions.length % 6).toBe(0);
    expect(segs.segmentCount).toBe(segs.positions.length / 6);
    expect(segs.figureCount).toBe(asset.asterisms.length);
    for (let i = 0; i < Math.min(segs.positions.length, 600); i += 3) {
      const r = Math.hypot(
        segs.positions[i],
        segs.positions[i + 1],
        segs.positions[i + 2],
      );
      expect(r).toBeCloseTo(1, 5);
    }
  });

  it("converts RA degrees → hours before raDecToUnit (Dubhe lands where the star is)", () => {
    const expected = raDecToUnit(165.932 / 15, 61.751);
    // Dubhe is a segment endpoint in the Big Dipper figure — find a matching vertex.
    let found = false;
    for (let i = 0; i < segs.positions.length; i += 3) {
      if (
        Math.abs(segs.positions[i] - expected[0]) < 1e-4 &&
        Math.abs(segs.positions[i + 1] - expected[1]) < 1e-4 &&
        Math.abs(segs.positions[i + 2] - expected[2]) < 1e-4
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("interior polyline vertices are duplicated (line-strip → segment pairs)", () => {
    // Big Dipper: 1 polyline of 8 vertices → 7 segments → 14 stored vertices.
    const dipperOnly = asterismSegments({
      credit: asset.credit,
      asterisms: [asset.asterisms.find((a) => a.id === "BigDipper")!],
    });
    expect(dipperOnly.segmentCount).toBe(7);
  });
});
