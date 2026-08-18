import { describe, it, expect } from "vitest";
import {
  patchServesTile,
  patchTileUri,
  tileRange,
  tileRangeInside,
  tileSpanDeg,
  type TerrainPatchCfg,
} from "../../../src/lib/geo/terrainTiles";
// The bake-side twin (plain node can't import TS, so the math lives twice) — this file PINS the
// two copies: every divergence fails here before it can ship a bake/runtime mismatch.
import * as bake from "../../../scripts/bake/terrain/tiling.mjs";

const DNIPRO: TerrainPatchCfg = {
  path: "dnipro",
  extentBbox: [34.0, 48.0, 36.0, 49.0],
  extentMaxDepth: 13,
  cityBbox: [34.915, 48.37, 35.185, 48.55],
  maxDepth: 13,
};

describe("geodetic TMS tiling", () => {
  it("span halves per level; L13 matches the U7-measured Dnipro tile arithmetic", () => {
    expect(tileSpanDeg(0)).toBe(180);
    expect(tileSpanDeg(13)).toBeCloseTo(0.02197265625, 12);
    // The U7 probe session + the bake both landed the city-centre tile at 9787/6301.
    const r = tileRange(DNIPRO.cityBbox, 13);
    expect(r.startX).toBeLessThanOrEqual(9787);
    expect(r.endX).toBeGreaterThanOrEqual(9787);
    expect(r.startY).toBeLessThanOrEqual(6301);
    expect(r.endY).toBeGreaterThanOrEqual(6301);
  });

  it("tileRangeInside ⊂ tileRange, and null when nothing fits", () => {
    for (const z of [8, 10, 13]) {
      const inside = tileRangeInside(DNIPRO.extentBbox, z);
      const touch = tileRange(DNIPRO.extentBbox, z);
      if (inside) {
        expect(inside.startX).toBeGreaterThanOrEqual(touch.startX);
        expect(inside.endX).toBeLessThanOrEqual(touch.endX);
        expect(inside.startY).toBeGreaterThanOrEqual(touch.startY);
        expect(inside.endY).toBeLessThanOrEqual(touch.endY);
      }
    }
    // At L6 one tile spans 2.8° — nothing fits fully inside a 1°-tall extent.
    expect(tileRangeInside(DNIPRO.extentBbox, 6)).toBeNull();
  });
});

describe("patchServesTile — the serve-set rule", () => {
  it("claims fully-inside tiles up to extentMaxDepth, never straddlers", () => {
    const z = 13;
    const inside = tileRangeInside(DNIPRO.extentBbox, z)!;
    expect(patchServesTile(DNIPRO, z, inside.startX, inside.startY)).toBe(true);
    expect(patchServesTile(DNIPRO, z, inside.startX - 1, inside.startY)).toBe(false); // straddler
    expect(patchServesTile(DNIPRO, z, inside.endX + 1, inside.endY)).toBe(false);
  });

  it("never claims beyond maxDepth (virtual upsampling territory) nor at world-coarse levels", () => {
    expect(patchServesTile(DNIPRO, 14, 9787 * 2, 6301 * 2)).toBe(false);
    expect(patchServesTile(DNIPRO, 0, 1, 0)).toBe(false);
    expect(patchServesTile(DNIPRO, 6, 76, 49)).toBe(false); // nothing fits at L6
  });

  it("deep-detail clause: above extentMaxDepth only city-intersecting tiles serve", () => {
    const deep: TerrainPatchCfg = { ...DNIPRO, maxDepth: 14 };
    const city = tileRange(deep.cityBbox, 14);
    expect(patchServesTile(deep, 14, city.startX, city.startY)).toBe(true);
    expect(patchServesTile(deep, 14, city.startX - 2, city.startY)).toBe(false);
  });

  it("patchTileUri builds the CDN path exactly and mirrors the serve rule", () => {
    const z = 13;
    const { startX, startY } = tileRangeInside(DNIPRO.extentBbox, z)!;
    expect(patchTileUri(DNIPRO, "https://cdn.test/terrain", z, startX, startY)).toBe(
      `https://cdn.test/terrain/dnipro/13/${startX}/${startY}.terrain`,
    );
    expect(patchTileUri(DNIPRO, "https://cdn.test/terrain", 0, 0, 0)).toBeNull();
  });
});

describe("bake-script twin parity (scripts/bake/terrain/tiling.mjs)", () => {
  it("tileRange / tileRangeInside / patchServesTile agree over a probe grid", () => {
    for (const z of [5, 8, 10, 13, 14]) {
      expect(bake.tileRange(DNIPRO.extentBbox, z)).toEqual(tileRange(DNIPRO.extentBbox, z));
      expect(bake.tileRangeInside(DNIPRO.extentBbox, z)).toEqual(tileRangeInside(DNIPRO.extentBbox, z));
      expect(bake.tileRange(DNIPRO.cityBbox, z)).toEqual(tileRange(DNIPRO.cityBbox, z));
    }
    const inside13 = tileRangeInside(DNIPRO.extentBbox, 13)!;
    for (const [z, x, y] of [
      [13, inside13.startX, inside13.startY],
      [13, inside13.startX - 1, inside13.startY],
      [13, 9787, 6301],
      [12, 4893, 3150],
      [10, 1223, 787],
      [14, 19574, 12602],
      [0, 1, 0],
    ] as const) {
      expect(bake.patchServesTile(DNIPRO, z, x, y)).toBe(patchServesTile(DNIPRO, z, x, y));
    }
  });
});
