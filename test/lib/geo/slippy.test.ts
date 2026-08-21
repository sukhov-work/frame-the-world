import { describe, expect, it } from "vitest";
import {
  chartWalkAzRad,
  lonLatToTileF,
  metersPerTilePx,
  tileFToLonLat,
  zoomForMetersPerPx,
} from "../../../src/lib/geo/slippy";
import { lonLatToTile } from "../../../src/components/globe/scene/vectorTiles";

/**
 * Slippy tile math (U3 MapWindow) — the fractional web-mercator forward/inverse pair and the
 * altitude→zoom picker. Cross-checked against the well-known z0/z1 anchors and roundtrips.
 */
describe("lonLatToTileF / tileFToLonLat", () => {
  it("maps the null island to the exact centre of the z0 tile", () => {
    const t = lonLatToTileF(0, 0, 0);
    expect(t.x).toBeCloseTo(0.5, 12);
    expect(t.y).toBeCloseTo(0.5, 12);
  });

  it("maps the NW corner of the world to tile 0,0", () => {
    const t = lonLatToTileF(-180, 85.0511287798066, 2);
    expect(t.x).toBeCloseTo(0, 9);
    expect(t.y).toBeCloseTo(0, 6);
  });

  it("roundtrips Dnipro at z14 to sub-metre precision", () => {
    const lon = 35.0462;
    const lat = 48.4647;
    const t = lonLatToTileF(lon, lat, 14);
    const back = tileFToLonLat(t.x, t.y, 14);
    expect(back.lonDeg).toBeCloseTo(lon, 9);
    expect(back.latDeg).toBeCloseTo(lat, 9);
  });

  it("agrees with the vectorTiles integer tiler (floor of the fraction)", () => {
    for (const [lon, lat, z] of [
      [35.0462, 48.4647, 14],
      [-0.1276, 51.5072, 12],
      [151.2093, -33.8688, 16],
    ] as const) {
      const f = lonLatToTileF(lon, lat, z);
      const i = lonLatToTile(lon, lat, z);
      expect(Math.floor(f.x)).toBe(i.x);
      expect(Math.floor(f.y)).toBe(i.y);
    }
  });
});

describe("metersPerTilePx", () => {
  it("equator z0: the whole circumference across one 256-px tile", () => {
    expect(metersPerTilePx(0, 0)).toBeCloseTo(40_075_016.686 / 256, 3);
  });

  it("shrinks with cos(lat) and halves per zoom", () => {
    const z14 = metersPerTilePx(48.4647, 14);
    expect(metersPerTilePx(48.4647, 15)).toBeCloseTo(z14 / 2, 9);
    expect(z14).toBeLessThan(metersPerTilePx(0, 14));
  });
});

describe("zoomForMetersPerPx", () => {
  it("picks a deeper zoom for a finer target and clamps to the range", () => {
    const coarse = zoomForMetersPerPx(48.4647, 100, 3, 19);
    const fine = zoomForMetersPerPx(48.4647, 1, 3, 19);
    expect(fine).toBeGreaterThan(coarse);
    expect(zoomForMetersPerPx(48.4647, 1e9, 3, 19)).toBe(3);
    expect(zoomForMetersPerPx(48.4647, 1e-9, 3, 19)).toBe(19);
  });

  it("is consistent with metersPerTilePx (the picked zoom lands within a factor ~√2)", () => {
    const z = zoomForMetersPerPx(48.4647, 5, 3, 19);
    const got = metersPerTilePx(48.4647, z);
    expect(got / 5).toBeGreaterThan(0.5);
    expect(got / 5).toBeLessThan(2);
  });
});

/**
 * QA slice B — screen-relative walk on the expanded chart. The truth anchor is the chart's
 * OWN forward transform (screen = R(rot)·tileΔ, tile north = −y): a walk along compass
 * azimuth az is tile Δ(sin az, −cos az), which lands on screen at
 * (sin(az+rot), −cos(az+rot)) — screen-UP exactly when az = −rot. chartWalkAzRad must be
 * that inverse for every input direction, not just up.
 */
describe("chartWalkAzRad — stick direction → compass azimuth on a twisted chart", () => {
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  it("north-up chart (rot 0): up=N, right=E, down=S, left=W", () => {
    expect(norm(chartWalkAzRad(0, 1, 0))).toBeCloseTo(0, 12);
    expect(norm(chartWalkAzRad(1, 0, 0))).toBeCloseTo(Math.PI / 2, 12);
    expect(norm(chartWalkAzRad(0, -1, 0))).toBeCloseTo(Math.PI, 12);
    expect(norm(chartWalkAzRad(-1, 0, 0))).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it("stick-up tracks chart-up exactly for any twist (the owner's acceptance check)", () => {
    for (const rot of [-2.1, -0.7, 0.3, 1.234, 2.9]) {
      // Walk az from the input, pushed through the chart's FORWARD transform: the screen
      // direction of that world walk must be straight up (0, -1).
      const az = chartWalkAzRad(0, 1, rot);
      const tile = { x: Math.sin(az), y: -Math.cos(az) }; // tile Δ of a unit walk along az
      const sx = tile.x * Math.cos(rot) - tile.y * Math.sin(rot);
      const sy = tile.x * Math.sin(rot) + tile.y * Math.cos(rot);
      expect(sx).toBeCloseTo(0, 12);
      expect(sy).toBeCloseTo(-1, 12);
    }
  });

  it("round-trips every input direction through the chart transform (diagonals included)", () => {
    for (const rot of [0, 0.9, -1.7]) {
      for (const [x, y] of [
        [1, 1],
        [-1, 1],
        [0.3, -0.8],
        [-0.5, -0.5],
      ] as const) {
        const az = chartWalkAzRad(x, y, rot);
        const tile = { x: Math.sin(az), y: -Math.cos(az) };
        const sx = tile.x * Math.cos(rot) - tile.y * Math.sin(rot);
        const sy = tile.x * Math.sin(rot) + tile.y * Math.cos(rot);
        const len = Math.hypot(x, y);
        // Screen +y is DOWN, the input's y is UP — the round-trip must reproduce the input.
        expect(sx).toBeCloseTo(x / len, 12);
        expect(sy).toBeCloseTo(-y / len, 12);
      }
    }
  });

  it("a quarter-turn twist (rot = π/2, chart twisted CCW) sends stick-up along west", () => {
    expect(norm(chartWalkAzRad(0, 1, Math.PI / 2))).toBeCloseTo((3 * Math.PI) / 2, 12);
  });
});
