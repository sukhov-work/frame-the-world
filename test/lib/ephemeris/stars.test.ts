import { describe, expect, it } from "vitest";
import {
  BV_SENTINEL,
  bvToRgb,
  bvToTempK,
  GALACTIC_CENTER,
  GALACTIC_NORTH_POLE,
  galacticToEquatorial,
  magToBright,
  magToSize,
  milkyWayField,
  parseStarCatalog,
  raDecToUnit,
  STAR_RECORD_FLOATS,
  type MagMapping,
  type MilkyWayOptions,
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

describe("galacticToEquatorial", () => {
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it("maps the galactic centre (l=0, b=0) to Sgr A* (RA 266.405°, Dec −28.936°)", () => {
    const v = galacticToEquatorial(0, 0);
    const ref = raDecToUnit(GALACTIC_CENTER.raHours, GALACTIC_CENTER.decDeg);
    // Gram-Schmidt nudges x by the published frame's ~0.005° non-orthogonality — sub-arcminute
    expect(dot(v, ref)).toBeGreaterThan(Math.cos((0.02 * Math.PI) / 180));
  });

  it("maps the north galactic pole (b=90) to RA 192.859°, Dec +27.128°", () => {
    const v = galacticToEquatorial(123, 90); // l is irrelevant at the pole
    const ref = raDecToUnit(GALACTIC_NORTH_POLE.raHours, GALACTIC_NORTH_POLE.decDeg);
    expect(dot(v, ref)).toBeCloseTo(1, 8);
  });

  it("returns unit vectors with the plane ⊥ to the pole", () => {
    const pole = galacticToEquatorial(0, 90);
    for (const l of [0, 45, 90, 180, 270]) {
      const v = galacticToEquatorial(l, 0);
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 8);
      expect(Math.abs(dot(v, pole))).toBeLessThan(1e-6); // in-plane points ⊥ pole
    }
  });
});

describe("milkyWayField", () => {
  const OPTS: MilkyWayOptions = {
    count: 2000,
    sigmaBDeg: 8.5,
    haloFrac: 0.2,
    bulgeSigmaLDeg: 55,
    baseWeight: 0.35,
    sizeBase: 0.6,
    sizeSpread: 1.1,
  };
  // deterministic LCG so the test never flakes
  const lcg = (seed: number) => () => (seed = (seed * 48271) % 2147483647) / 2147483647;

  it("produces the requested count of unit directions hugging the galactic plane", () => {
    const f = milkyWayField(OPTS, lcg(42));
    expect(f.positions.length).toBe(OPTS.count * 3);
    const pole = galacticToEquatorial(0, 90);
    let planar = 0;
    for (let i = 0; i < OPTS.count; i++) {
      const v = [f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2]];
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 5);
      // |sin(b)| = |v·pole|; count points within ~2σ of the plane
      const sinB = Math.abs(v[0] * pole[0] + v[1] * pole[1] + v[2] * pole[2]);
      if (sinB < Math.sin((2 * OPTS.sigmaBDeg * Math.PI) / 180)) planar++;
    }
    expect(planar / OPTS.count).toBeGreaterThan(0.8); // a band, not a shell
  });

  it("weights brightness toward the galactic centre and keeps attributes in range", () => {
    const f = milkyWayField(OPTS, lcg(7));
    const centre = galacticToEquatorial(0, 0);
    let nearSum = 0;
    let nearN = 0;
    let farSum = 0;
    let farN = 0;
    for (let i = 0; i < OPTS.count; i++) {
      expect(f.bright[i]).toBeGreaterThan(0);
      expect(f.bright[i]).toBeLessThanOrEqual(1);
      expect(f.size[i]).toBeGreaterThanOrEqual(OPTS.sizeBase);
      const d =
        f.positions[i * 3] * centre[0] +
        f.positions[i * 3 + 1] * centre[1] +
        f.positions[i * 3 + 2] * centre[2];
      if (d > 0.7) {
        nearSum += f.bright[i];
        nearN++;
      } else if (d < -0.7) {
        farSum += f.bright[i];
        farN++;
      }
    }
    expect(nearN).toBeGreaterThan(0);
    expect(farN).toBeGreaterThan(0);
    expect(nearSum / nearN).toBeGreaterThan(farSum / farN); // Sagittarius bulge > anti-centre
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

describe("bvToRgb — B−V catalog colour (phase D star tint)", () => {
  it("Ballesteros temperature anchors: Sun ≈ 5800 K, Vega ≈ 9600 K, Betelgeuse ≈ 3300 K", () => {
    expect(bvToTempK(0.65)).toBeGreaterThan(5500);
    expect(bvToTempK(0.65)).toBeLessThan(6100);
    expect(bvToTempK(0.0)).toBeGreaterThan(9000);
    expect(bvToTempK(0.0)).toBeLessThan(10500);
    expect(bvToTempK(1.85)).toBeGreaterThan(3000);
    expect(bvToTempK(1.85)).toBeLessThan(3700);
  });

  it("channel ordering: hot stars blue-leaning, cool stars red-leaning, max channel = 1", () => {
    const rigel = bvToRgb(-0.03);
    const betelgeuse = bvToRgb(1.85);
    const sun = bvToRgb(0.65);
    expect(rigel[2]).toBeGreaterThan(rigel[0]); // b > r — blue-white
    expect(betelgeuse[0]).toBeGreaterThan(betelgeuse[2]); // r > b — orange
    expect(betelgeuse[0]).toBeGreaterThan(betelgeuse[1]);
    for (const c of [...rigel, ...betelgeuse, ...sun]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...rigel)).toBeCloseTo(1, 6);
    expect(Math.max(...betelgeuse)).toBeCloseTo(1, 6);
    expect(Math.max(...sun)).toBeCloseTo(1, 6);
  });

  it("the BV sentinel (no catalog colour) tints nothing", () => {
    expect(bvToRgb(9.99)).toEqual([1, 1, 1]);
  });
});
