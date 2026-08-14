import { describe, expect, it } from "vitest";
import {
  arcDistRad,
  buildHoverIndex,
  hitTestNames,
  raDecUnit,
  type Vec3,
} from "../../../src/lib/sky/hoverNames";

const DEG = Math.PI / 180;

const seg = (a: Vec3, b: Vec3) => ({ a, b, cosAB: a[0] * b[0] + a[1] * b[1] + a[2] * b[2] });

describe("raDecUnit", () => {
  it("puts the equinox on +x, the pole on +z", () => {
    expect(raDecUnit(0, 0)[0]).toBeCloseTo(1, 12);
    expect(raDecUnit(0, 90)[2]).toBeCloseTo(1, 12);
    expect(raDecUnit(90, 0)[1]).toBeCloseTo(1, 12);
  });
});

describe("arcDistRad", () => {
  const a = raDecUnit(0, 0);
  const b = raDecUnit(20, 0); // 20° arc along the equator
  it("measures perpendicular distance to the middle of the arc", () => {
    const d = raDecUnit(10, 3); // above the midpoint by 3°
    expect(arcDistRad(d, seg(a, b))).toBeCloseTo(3 * DEG, 5);
  });
  it("falls back to endpoint distance beyond the arc ends", () => {
    const d = raDecUnit(25, 0); // 5° past b along the equator
    expect(arcDistRad(d, seg(a, b))).toBeCloseTo(5 * DEG, 5);
  });
  it("handles a degenerate zero-length segment", () => {
    const d = raDecUnit(2, 0);
    expect(arcDistRad(d, seg(a, a))).toBeCloseTo(2 * DEG, 5);
  });
});

// A miniature sky: Vega + a faint star, one asterism line, one constellation figure + anchor.
const INDEX = buildHoverIndex(
  {
    stars: [
      { name: "Vega", con: "Lyr", vmag: 0.03, raDeg: 279.235, decDeg: 38.784 },
      { name: "Faintling", con: "Lyr", vmag: 3.5, raDeg: 282.0, decDeg: 33.0 },
      { name: "TooFaint", con: "Lyr", vmag: 9.9, raDeg: 285.0, decDeg: 30.0 },
    ],
    conNames: { Lyr: "Lyra" },
    asterisms: [
      { name: "Summer Triangle", lines: [[[279.235, 38.784], [310.358, 45.28], [297.696, 8.868]]] },
    ],
    constellationFigures: [
      { name: "Lyra", lines: [[[279.235, 38.784], [281.2, 37.6], [282.5, 36.9]]] },
    ],
    anchors: [{ name: "Lyra", raDeg: 283.5, decDeg: 36.5 }],
  },
  { maxVmag: 3.6, starHitBrightDeg: 1.1, starHitFaintDeg: 0.5 },
);

const OPTS = { includeAsterisms: true, figureHitDeg: 1.2, anchorHitDeg: 8 };

describe("hitTestNames", () => {
  it("names a bright star inside its pad, with the constellation as the sub-line", () => {
    const hit = hitTestNames(INDEX, raDecUnit(279.5, 39.2), OPTS);
    expect(hit).toMatchObject({ kind: "star", name: "Vega", sub: "Lyra" });
  });
  it("scales the star pad by magnitude — 0.9° hits Vega but not a vmag-3.5 star", () => {
    // 0.9° north of each star: inside Vega's 1.1° pad, outside Faintling's ~0.5° pad.
    expect(hitTestNames(INDEX, raDecUnit(279.235, 39.68), OPTS)?.name).toBe("Vega");
    const faint = hitTestNames(INDEX, raDecUnit(282.0, 33.9), OPTS);
    expect(faint?.name).not.toBe("Faintling");
  });
  it("drops stars past maxVmag entirely", () => {
    const hit = hitTestNames(INDEX, raDecUnit(285.0, 30.0), OPTS);
    expect(hit?.name).not.toBe("TooFaint");
  });
  it("a star beats the asterism line it sits on (most specific wins)", () => {
    const hit = hitTestNames(INDEX, raDecUnit(279.235, 38.784), OPTS);
    expect(hit?.kind).toBe("star");
  });
  it("names an asterism from the middle of a long figure edge", () => {
    // midpoint of the Vega→Deneb edge is far from any named star
    const hit = hitTestNames(INDEX, raDecUnit(294.5, 42.5), OPTS);
    expect(hit).toMatchObject({ kind: "asterism", name: "Summer Triangle" });
  });
  it("skips asterisms when their tracery is hidden", () => {
    const hit = hitTestNames(INDEX, raDecUnit(294.5, 42.5), {
      ...OPTS,
      includeAsterisms: false,
    });
    expect(hit === null || hit.kind !== "asterism").toBe(true);
  });
  it("falls back to the constellation anchor away from any line", () => {
    const hit = hitTestNames(INDEX, raDecUnit(288.0, 34.0), {
      ...OPTS,
      includeAsterisms: false,
    });
    expect(hit).toMatchObject({ kind: "constellation", name: "Lyra" });
  });
  it("returns null on empty sky", () => {
    expect(hitTestNames(INDEX, raDecUnit(100, -60), OPTS)).toBeNull();
  });
});
