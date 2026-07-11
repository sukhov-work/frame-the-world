import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelPresence, rankAllowedAt } from "../../../src/components/globe/scene/geoLabels";
import { LABELS } from "../../../src/components/globe/tuning";

/**
 * Geo labels (Phase 5.5 S7b): the pure window math + the baked-asset contract between
 * scripts/build-ne-labels.mjs and the scene/geoLabels loader (layout drift = a blank layer).
 */
describe("labelPresence (altitude window)", () => {
  it("is zero at street level and at the default LEO pose (the DoD line)", () => {
    expect(labelPresence(5_000)).toBe(0);
    expect(labelPresence(1_100_000)).toBe(0); // POSE.cam.altM — labels never dress the LEO hero
  });

  it("is fully present through the middle of the window", () => {
    expect(labelPresence(LABELS.minAltM + LABELS.fadeSpanM)).toBe(1);
    expect(labelPresence(400_000)).toBe(1);
    expect(labelPresence(LABELS.maxAltM - LABELS.fadeSpanM)).toBe(1);
  });

  it("ramps across the fade span at both edges", () => {
    expect(labelPresence(LABELS.minAltM + LABELS.fadeSpanM / 2)).toBeCloseTo(0.5, 10);
    expect(labelPresence(LABELS.maxAltM - LABELS.fadeSpanM / 2)).toBeCloseTo(0.5, 10);
  });
});

describe("rankAllowedAt (scalerank gate)", () => {
  it("admits only the majors at the window top and every rank once fully zoomed", () => {
    expect(rankAllowedAt(LABELS.maxAltM)).toBeCloseTo(LABELS.rankAtMax, 10);
    expect(rankAllowedAt(LABELS.rankFullAltM)).toBe(10);
    expect(rankAllowedAt(LABELS.minAltM)).toBe(10);
  });

  it("is monotonic — descending never hides a rank it already showed", () => {
    let prev = rankAllowedAt(LABELS.maxAltM);
    for (let alt = LABELS.maxAltM; alt >= LABELS.rankFullAltM; alt -= 50_000) {
      const r = rankAllowedAt(alt);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r;
    }
  });
});

describe("baked Natural Earth assets (scripts/build-ne-labels.mjs contract)", () => {
  it("ne-boundaries.bin parses per the documented layout", () => {
    const buf = readFileSync(new URL("../../../public/data/ne-boundaries.bin", import.meta.url));
    const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const partCount = f[0];
    expect(partCount).toBeGreaterThan(100);
    expect(Number.isInteger(partCount)).toBe(true);
    let totalVerts = 0;
    for (let p = 0; p < partCount; p++) {
      const count = f[1 + p];
      expect(count).toBeGreaterThanOrEqual(2);
      totalVerts += count;
    }
    // exact length: header + counts + (lat, lon) per vertex
    expect(f.length).toBe(1 + partCount + totalVerts * 2);
    for (let i = 1 + partCount; i < f.length; i += 2) {
      expect(Math.abs(f[i])).toBeLessThanOrEqual(90); // lat
      expect(Math.abs(f[i + 1])).toBeLessThanOrEqual(180); // lon
    }
  });

  it("ne-places.json is rank-sorted name/rank/lat/lon tuples", () => {
    const data = JSON.parse(
      readFileSync(new URL("../../../public/data/ne-places.json", import.meta.url), "utf8"),
    ) as { credit: string; places: [string, number, number, number][] };
    expect(data.credit).toContain("Natural Earth");
    expect(data.places.length).toBeGreaterThan(1000);
    let prevRank = -Infinity;
    for (const [name, rank, lat, lon] of data.places) {
      expect(typeof name).toBe("string");
      expect(rank).toBeGreaterThanOrEqual(prevRank); // the loader's early-break depends on this
      prevRank = rank;
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
    expect(data.places.some(([name]) => name === "Tokyo")).toBe(true);
  });
});
