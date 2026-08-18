import { describe, expect, it } from "vitest";
import {
  clipLineToBounds,
  clipRingToBounds,
  lonLatToTile,
  ringArea,
  sampleLineAnchors,
  tileLocalToLonLat,
} from "../../../src/components/globe/scene/vectorTiles";

/**
 * Shared MVT source (S7 feedback batch) — the pure tile math (moved here from streetNames when
 * the fetch/parse layer became shared) + the polygon ring-winding classifier the water/green
 * fills rely on.
 */
describe("web-mercator tile math", () => {
  it("locates Dnipro's z14 tile (probe-verified 2026-07-11: 9786/5663 holds the city center)", () => {
    expect(lonLatToTile(35.0462, 48.4647, 14)).toEqual({ x: 9786, y: 5663 });
  });

  it("tileLocalToLonLat round-trips through lonLatToTile", () => {
    // Center of the Dnipro tile → its lon/lat must map back into the same tile.
    const { lonDeg, latDeg } = tileLocalToLonLat(14, 9786, 5663, 4096, 2048, 2048);
    expect(lonLatToTile(lonDeg, latDeg, 14)).toEqual({ x: 9786, y: 5663 });
    // …and sits within the tile's geographic span (~0.022° lon at z14).
    expect(lonDeg).toBeGreaterThan(35.0);
    expect(lonDeg).toBeLessThan(35.08);
    expect(latDeg).toBeGreaterThan(48.4);
    expect(latDeg).toBeLessThan(48.5);
  });

  it("tile origin (0,0) is the tile's north-west corner", () => {
    const nw = tileLocalToLonLat(14, 9786, 5663, 4096, 0, 0);
    const se = tileLocalToLonLat(14, 9786, 5663, 4096, 4096, 4096);
    expect(nw.lonDeg).toBeLessThan(se.lonDeg);
    expect(nw.latDeg).toBeGreaterThan(se.latDeg); // y grows southward in mercator tiles
  });

  it("extent=1 gives the raw tile bounds (the vectorFeatures lattice contract)", () => {
    const nw = tileLocalToLonLat(14, 9786, 5663, 1, 0, 0);
    const nw4096 = tileLocalToLonLat(14, 9786, 5663, 4096, 0, 0);
    expect(nw.lonDeg).toBeCloseTo(nw4096.lonDeg, 12);
    expect(nw.latDeg).toBeCloseTo(nw4096.latDeg, 12);
  });
});

describe("ringArea (MVT polygon winding — outer vs hole)", () => {
  it("clockwise in screen coords (y down) is positive = outer, per the MVT spec", () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(ringArea(cw)).toBeGreaterThan(0);
    expect(ringArea([...cw].reverse())).toBeLessThan(0);
  });

  it("area magnitude is the euclidean area", () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(Math.abs(ringArea(cw))).toBeCloseTo(100, 10);
  });
});

describe("clipRingToBounds (MVT buffer removal — the river-flicker fix)", () => {
  const square = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it("a ring inside the bounds is untouched", () => {
    const r = square(1, 1, 5, 5);
    expect(clipRingToBounds(r, 0, 10)).toEqual(r);
  });

  it("a ring overhanging the tile edge is clipped exactly to the boundary", () => {
    // Overhangs the right edge by 4 (the MVT buffer situation).
    const clipped = clipRingToBounds(square(6, 2, 14, 8), 0, 10);
    expect(clipped.length).toBeGreaterThanOrEqual(4);
    for (const p of clipped) {
      expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(0 - 1e-9);
    }
    expect(Math.abs(ringArea(clipped))).toBeCloseTo(4 * 6, 9); // 6..10 × 2..8
  });

  it("preserves winding and drops fully-outside rings", () => {
    const cw = square(-8, -8, -2, -2); // CW in y-down (matches the outer convention)
    expect(clipRingToBounds(cw, 0, 10)).toEqual([]);
    const inside = square(1, 1, 3, 3);
    expect(Math.sign(ringArea(clipRingToBounds(inside, 0, 10)))).toBe(Math.sign(ringArea(inside)));
  });
});

describe("clipLineToBounds (roads clipped to the tile, split on exits)", () => {
  it("keeps an inside line whole", () => {
    const pts = [
      { x: 1, y: 1 },
      { x: 5, y: 5 },
      { x: 9, y: 1 },
    ];
    expect(clipLineToBounds(pts, 0, 10)).toEqual([pts]);
  });

  it("cuts a line at the boundary", () => {
    const parts = clipLineToBounds(
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
      ],
      0,
      10,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0][0]).toEqual({ x: 5, y: 5 });
    expect(parts[0][1].x).toBeCloseTo(10, 9);
  });

  it("splits a line that leaves and re-enters into two parts", () => {
    // Goes out the right edge and comes back in.
    const parts = clipLineToBounds(
      [
        { x: 8, y: 2 },
        { x: 14, y: 2 },
        { x: 14, y: 6 },
        { x: 8, y: 6 },
      ],
      0,
      10,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1].x).toBeCloseTo(10, 9);
    expect(parts[1][0].x).toBeCloseTo(10, 9);
  });

  it("drops a fully-outside line", () => {
    expect(
      clipLineToBounds(
        [
          { x: 12, y: 0 },
          { x: 15, y: 5 },
        ],
        0,
        10,
      ),
    ).toEqual([]);
  });
});

describe("sampleLineAnchors (v4 — names along the streets)", () => {
  it("a short line keeps the v3 single mid-vertex anchor", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const out = sampleLineAnchors(line, 1_000, 6);
    expect(out).toHaveLength(1);
    expect(out[0].a).toEqual({ x: 100, y: 0 });
    expect(out[0].b).toEqual({ x: 200, y: 0 });
  });

  it("a long line drops an anchor every step, starting at half a step", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
    ];
    const out = sampleLineAnchors(line, 300, 6);
    // arc length 1000, anchors at 150 / 450 / 750
    expect(out.map((o) => Math.round(o.a.x))).toEqual([150, 450, 750]);
    for (const o of out) expect(o.b).toEqual({ x: 1_000, y: 0 });
  });

  it("caps at maxAnchors", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
    ];
    expect(sampleLineAnchors(line, 100, 4)).toHaveLength(4);
  });

  it("anchors interpolate across vertices and take the local segment direction", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const out = sampleLineAnchors(line, 80, 6);
    // length 200 → anchors at 40 (on the east segment) and 120 (on the north segment)
    expect(out).toHaveLength(2);
    expect(out[0].a.x).toBeCloseTo(40, 9);
    expect(out[0].a.y).toBeCloseTo(0, 9);
    expect(out[0].b).toEqual({ x: 100, y: 0 });
    expect(out[1].a.x).toBeCloseTo(100, 9);
    expect(out[1].a.y).toBeCloseTo(20, 9);
    expect(out[1].b).toEqual({ x: 100, y: 100 });
  });

  it("degenerate input returns empty", () => {
    expect(sampleLineAnchors([{ x: 0, y: 0 }], 100, 6)).toEqual([]);
  });
});
