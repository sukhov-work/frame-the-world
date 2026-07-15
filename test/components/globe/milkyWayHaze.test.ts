import { describe, expect, it } from "vitest";
import { raDecToUnit } from "../../../src/lib/ephemeris/stars";

/**
 * Milky Way haze UV twin (owner 2026-07-15). JS twin of the dir→RA/Dec→UV mapping in
 * scene/stars.ts's haze fragment shader — KEEP IN SYNC. The invariant that matters: a BSC5
 * star (raDecToUnit) and the SVS texture sample for the SAME RA/Dec must agree, i.e. the
 * shader formula must exactly invert raDecToUnit. Texture convention (svs.gsfc.nasa.gov/4851):
 * plate carrée, J2000 equatorial, RA 0h centred, RA increasing LEFT — u = 0.5 − RA/2π,
 * v = 0.5 + dec/π (v up). Landmarks were verified against the actual 4k pixels during the
 * bake: photometric bulge (3064,1351) vs Sgr A* projection (3113,1354); LMC (1140,1815) vs
 * projection (1128,1817).
 */
const dirToUv = (d: [number, number, number]): [number, number] => {
  const dec = Math.asin(Math.max(-1, Math.min(1, d[2])));
  const ra = Math.atan2(d[1], d[0]);
  const u = 0.5 - ra / (2 * Math.PI); // RepeatWrapping absorbs u outside [0,1)
  const v = 0.5 + dec / Math.PI;
  return [((u % 1) + 1) % 1, v];
};

const toPx = (u: number, v: number): [number, number] => [
  Math.round(u * 4096),
  Math.round((1 - v) * 2048), // image rows are top-down
];

describe("Milky Way haze dir→UV mapping (shader twin)", () => {
  it("inverts raDecToUnit exactly (stars and haze share one frame)", () => {
    // Sgr A* 17h45m40s / −29.008°; Deneb 20h41m26s / +45.280°; Polaris 2h31m49s / +89.264°.
    for (const [raH, decDeg] of [
      [17.7611, -29.0078],
      [20.6905, 45.2803],
      [2.5303, 89.2641],
    ]) {
      const [u, v] = dirToUv(raDecToUnit(raH, decDeg));
      const raDeg = raH * 15;
      const expectedU = (((0.5 - raDeg / 360) % 1) + 1) % 1;
      const expectedV = 0.5 + decDeg / 180;
      expect(u).toBeCloseTo(expectedU, 9);
      expect(v).toBeCloseTo(expectedV, 9);
    }
  });

  it("projects the verified landmarks onto their measured 4k pixels", () => {
    const [ug, vg] = dirToUv(raDecToUnit(17.7611, -29.0078)); // galactic centre
    expect(toPx(ug, vg)[0]).toBeGreaterThan(3090);
    expect(toPx(ug, vg)[0]).toBeLessThan(3135);
    expect(toPx(ug, vg)[1]).toBeGreaterThan(1340);
    expect(toPx(ug, vg)[1]).toBeLessThan(1370);
    const [ul, vl] = dirToUv(raDecToUnit(5.3928, -69.7561)); // LMC
    expect(toPx(ul, vl)[0]).toBeGreaterThan(1110);
    expect(toPx(ul, vl)[0]).toBeLessThan(1150);
    expect(toPx(ul, vl)[1]).toBeGreaterThan(1800);
    expect(toPx(ul, vl)[1]).toBeLessThan(1835);
  });
});
