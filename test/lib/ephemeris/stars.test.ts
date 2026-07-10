import { describe, expect, it } from "vitest";
import {
  BV_SENTINEL,
  magToBright,
  magToSize,
  parseStarCatalog,
  raDecToUnit,
  STAR_RECORD_FLOATS,
  type MagMapping,
} from "../../../src/lib/ephemeris/stars";
import { bodyStatesAt } from "../../../src/lib/ephemeris/bodies";

// SIMBAD ICRS J2000 reference values (research pass 2026-07-10; catalog agrees within ~0.4″).
const SIRIUS = { raH: 6.75247, decDeg: -16.71611, vmag: -1.46 };
const POLARIS = { raH: 2.5303, decDeg: 89.2641, vmag: 2.02 };

const MAPPING: MagMapping = {
  magRef: 2.0,
  sizeBase: 0.8,
  sizeSpread: 2.0,
  sizeGamma: 0.35,
  sizeMax: 5.0,
  brightGamma: 0.6,
  brightMin: 0.18,
};

describe("raDecToUnit", () => {
  it("puts Polaris at the celestial north pole (z ≈ +1)", () => {
    const [x, y, z] = raDecToUnit(POLARIS.raH, POLARIS.decDeg);
    expect(z).toBeCloseTo(Math.sin((89.2641 * Math.PI) / 180), 6);
    expect(Math.hypot(x, y)).toBeLessThan(0.013); // within 0.74° of the pole
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
  });

  it("matches Sirius' equatorial direction", () => {
    const [x, y, z] = raDecToUnit(SIRIUS.raH, SIRIUS.decDeg);
    const ra = (SIRIUS.raH * Math.PI) / 12;
    const dec = (SIRIUS.decDeg * Math.PI) / 180;
    expect(x).toBeCloseTo(Math.cos(dec) * Math.cos(ra), 6);
    expect(y).toBeCloseTo(Math.cos(dec) * Math.sin(ra), 6);
    expect(z).toBeCloseTo(Math.sin(dec), 6);
  });

  it("rotating a star at RA = GAST by −GAST lands it over longitude 0 (the ECEF handoff)", () => {
    const { gastRad } = bodyStatesAt(Date.UTC(2026, 6, 10, 9, 12, 0));
    const [x, y] = raDecToUnit((gastRad * 12) / Math.PI, 0); // star currently crossing Greenwich
    // scene/stars applies points.rotation.z = −GAST — the same Rz here, by hand:
    const c = Math.cos(-gastRad);
    const s = Math.sin(-gastRad);
    expect(x * c - y * s).toBeCloseTo(1, 6); // ECEF x → lon 0
    expect(x * s + y * c).toBeCloseTo(0, 6);
  });
});

describe("gastRad", () => {
  it("agrees with the almanac at the J2000 epoch (GMST 18.697h ≈ 280.46°)", () => {
    const { gastRad } = bodyStatesAt(Date.UTC(2000, 0, 1, 12, 0, 0));
    expect((gastRad * 180) / Math.PI).toBeCloseTo(280.46, 1); // nutation ≪ the 0.05° tolerance
  });
});

describe("parseStarCatalog", () => {
  const record = (star: { raH: number; decDeg: number; vmag: number }, bv: number) => {
    const [x, y, z] = raDecToUnit(star.raH, star.decDeg);
    return [x, y, z, star.vmag, bv];
  };

  it("de-interleaves packed records", () => {
    const data = new Float32Array([
      ...record(SIRIUS, 0.0),
      ...record(POLARIS, BV_SENTINEL),
    ]);
    const cat = parseStarCatalog(data.buffer);
    expect(cat.count).toBe(2);
    expect(cat.vmag[0]).toBeCloseTo(-1.46, 5);
    expect(cat.vmag[1]).toBeCloseTo(2.02, 5);
    expect(cat.bv[1]).toBeCloseTo(BV_SENTINEL, 5);
    expect(cat.positions[5]).toBeCloseTo(Math.sin((POLARIS.decDeg * Math.PI) / 180), 5);
    // every direction is unit-length
    for (let i = 0; i < cat.count; i++) {
      const n = Math.hypot(
        cat.positions[i * 3],
        cat.positions[i * 3 + 1],
        cat.positions[i * 3 + 2],
      );
      expect(n).toBeCloseTo(1, 5);
    }
  });

  it("rejects a truncated stream", () => {
    expect(() => parseStarCatalog(new Float32Array(STAR_RECORD_FLOATS + 1).buffer)).toThrow();
    expect(() => parseStarCatalog(new ArrayBuffer(0))).toThrow();
  });
});

describe("magnitude mapping", () => {
  it("is monotonic — brighter magnitude, bigger and brighter point", () => {
    expect(magToSize(SIRIUS.vmag, MAPPING)).toBeGreaterThan(magToSize(2.0, MAPPING));
    expect(magToSize(2.0, MAPPING)).toBeGreaterThan(magToSize(6.5, MAPPING));
    expect(magToBright(0, MAPPING)).toBeGreaterThan(magToBright(4, MAPPING));
  });

  it("clamps the extremes (Sirius capped, the mag-6.5 tail floored)", () => {
    expect(magToSize(SIRIUS.vmag, MAPPING)).toBeLessThanOrEqual(MAPPING.sizeMax);
    expect(magToBright(6.5, MAPPING)).toBeGreaterThanOrEqual(MAPPING.brightMin);
    expect(magToBright(-1.46, MAPPING)).toBeLessThanOrEqual(1);
  });
});
