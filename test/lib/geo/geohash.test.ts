import { describe, it, expect } from "vitest";
import {
  encodeGeohash,
  decodeGeohash,
  decodeGeohashBounds,
  adjacentGeohash,
  neighbourGeohashes,
  geohashesForViewport,
} from "../../../src/lib/geo/geohash";

describe("encodeGeohash", () => {
  it("matches the canonical vector (42.6, -5.6) → 'ezs42'", () => {
    expect(encodeGeohash(42.6, -5.6, 5)).toBe("ezs42");
  });
  it("matches the canonical vector (57.64911, 10.40744) → 'u4pruydqqvj'", () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });
  it("rejects out-of-range coordinates + bad precision", () => {
    expect(() => encodeGeohash(91, 0)).toThrow();
    expect(() => encodeGeohash(0, 181)).toThrow();
    expect(() => encodeGeohash(0, 0, 0)).toThrow();
  });
});

describe("decodeGeohash", () => {
  it("'ezs42' contains its source point within the cell", () => {
    const b = decodeGeohashBounds("ezs42");
    expect(42.6).toBeGreaterThanOrEqual(b.latMin);
    expect(42.6).toBeLessThanOrEqual(b.latMax);
    expect(-5.6).toBeGreaterThanOrEqual(b.lonMin);
    expect(-5.6).toBeLessThanOrEqual(b.lonMax);
  });
  it("round-trips within 9-char precision (< 0.001°)", () => {
    for (const [lat, lon] of [[48.4647, 35.0462], [0, 0], [-33.8688, 151.2093], [90, 180]] as const) {
      const d = decodeGeohash(encodeGeohash(lat, lon, 9));
      expect(Math.abs(d.lat - lat)).toBeLessThan(0.001);
      expect(Math.abs(d.lon - lon)).toBeLessThan(0.001);
    }
  });
  it("rejects invalid characters", () => {
    expect(() => decodeGeohash("abcia")).toThrow(); // 'a','i' are not in the base-32 alphabet
  });
});

describe("adjacency", () => {
  it("east neighbour increases longitude, same latitude band", () => {
    const c = decodeGeohash("ezs42");
    const e = decodeGeohash(adjacentGeohash("ezs42", "e"));
    expect(e.lon).toBeGreaterThan(c.lon);
    expect(Math.abs(e.lat - c.lat)).toBeLessThan(1e-6);
  });
  it("north neighbour increases latitude, same longitude band", () => {
    const c = decodeGeohash("ezs42");
    const n = decodeGeohash(adjacentGeohash("ezs42", "n"));
    expect(n.lat).toBeGreaterThan(c.lat);
    expect(Math.abs(n.lon - c.lon)).toBeLessThan(1e-6);
  });
  it("returns 8 distinct same-length neighbours", () => {
    const nb = neighbourGeohashes("ezs42");
    const vals = Object.values(nb);
    expect(vals).toHaveLength(8);
    expect(new Set(vals).size).toBe(8);
    for (const v of vals) expect(v).toHaveLength(5);
  });
});

describe("geohashesForViewport (D7 prefix set)", () => {
  it("covers a small Dnipro viewport and includes every corner cell", () => {
    const bounds = { latMin: 48.40, latMax: 48.52, lonMin: 35.00, lonMax: 35.12 };
    const cells = geohashesForViewport(bounds, 5);
    expect(cells.length).toBeGreaterThan(0);
    for (const [lat, lon] of [
      [bounds.latMin, bounds.lonMin],
      [bounds.latMin, bounds.lonMax],
      [bounds.latMax, bounds.lonMin],
      [bounds.latMax, bounds.lonMax],
      [48.46, 35.06], // centre
    ] as const) {
      expect(cells).toContain(encodeGeohash(lat, lon, 5));
    }
  });
  it("rejects an inverted viewport", () => {
    expect(() => geohashesForViewport({ latMin: 1, latMax: 0, lonMin: 0, lonMax: 1 }, 5)).toThrow();
  });
});
