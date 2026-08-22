import { describe, expect, it } from "vitest";
import {
  azAltOfEcef,
  binIndex,
  createProfile,
  horizonDipDeg,
  isBlocked,
  marchTerrainBin,
  profileCoverage,
  raiseBin,
  R_MEAN_M,
  sampleBins,
  sampleProfile,
  skylineBinsFor,
  type SilhouetteFrame,
  type SkylineGate,
  type TerrainAnchor,
} from "../../../src/lib/geo/horizonProfile";
import { enuBasis, geodeticToEcef } from "../../../src/lib/geo/projection";

const K = 0.13; // standard terrestrial refraction coefficient (PLAN.refractionK)

const MARCH = { minRangeM: 50, maxRangeM: 30_000, stepGrowth: 1.35, refractionK: K };

/** Anchor at the equator/prime-meridian: ECEF x≈up, y≈east, z≈north — hand-checkable. */
const ANCHOR: TerrainAnchor = { latDeg: 0, lonDeg: 0, eyeAltM: 2 };

function frameAt(latDeg: number, lonDeg: number, eyeAltM: number): SilhouetteFrame {
  const basis = enuBasis(latDeg, lonDeg);
  return {
    originEcef: geodeticToEcef(latDeg, lonDeg, eyeAltM),
    east: basis.east,
    north: basis.north,
    up: basis.up,
    refractionK: K,
  };
}

describe("horizonProfile — bins, sampling, dip", () => {
  it("initializes every bin to the open-sky floor, unknown", () => {
    const p = createProfile(96, -0.5);
    expect(p.altDeg[0]).toBeCloseTo(-0.5, 6);
    expect(p.altDeg[95]).toBeCloseTo(-0.5, 6);
    expect(profileCoverage(p)).toBe(0);
  });

  it("horizonDipDeg: 0 at ground level, ≈−0.3° at 100 m (√(2h(1−k)/R))", () => {
    expect(horizonDipDeg(0, K)).toBe(-0);
    const expected = -(Math.sqrt((2 * 100 * (1 - K)) / R_MEAN_M) * 180) / Math.PI;
    expect(horizonDipDeg(100, K)).toBeCloseTo(expected, 6);
    expect(horizonDipDeg(100, K)).toBeCloseTo(-0.299, 2);
  });

  it("binIndex wraps azimuth into [0,360) and never overflows", () => {
    const p = createProfile(120, 0);
    expect(binIndex(p, 0)).toBe(0);
    expect(binIndex(p, 359.999)).toBe(119);
    expect(binIndex(p, 360)).toBe(0);
    expect(binIndex(p, -3)).toBe(binIndex(p, 357));
  });

  it("raiseBin only rises; sampleProfile interpolates between bin centres", () => {
    const p = createProfile(36, 0); // 10° bins, centres at 5°, 15°, …
    raiseBin(p, 5, 10);
    raiseBin(p, 5, 4); // lower — must not lower the bin
    raiseBin(p, 15, 20);
    expect(sampleProfile(p, 5)).toBeCloseTo(10, 6);
    expect(sampleProfile(p, 15)).toBeCloseTo(20, 6);
    expect(sampleProfile(p, 10)).toBeCloseTo(15, 6); // midway between centres
    expect(profileCoverage(p)).toBeCloseTo(2 / 36, 6);
  });

  it("isBlocked compares body altitude against the interpolated skyline", () => {
    const p = createProfile(36, 0);
    raiseBin(p, 90, 25);
    expect(isBlocked(p, 90, 10)).toBe(true);
    expect(isBlocked(p, 90, 30)).toBe(false);
  });
});

describe("marchTerrainBin — synthetic terrain", () => {
  const degPerMLat = 180 / Math.PI / R_MEAN_M;

  // The feed marches at BIN-CENTRE azimuths (sampleProfile interpolates between centres, so an
  // edge-azimuth sample would blend with the untouched neighbour) — tests do the same.
  const CENTER_N = 1.875; // 96 bins → 3.75° wide, bin 0 centre
  const CENTER_E = 91.875; // bin 24 centre

  it("a 100 m plateau starting 1 km north raises the north bin to ≈5.6°", () => {
    const p = createProfile(96, -0.05);
    const heightAt = (latDeg: number) => {
      const northM = (latDeg - ANCHOR.latDeg) / degPerMLat;
      return northM >= 1000 ? 100 : 0;
    };
    const sampled = marchTerrainBin(p, ANCHOR, CENTER_N, heightAt, MARCH);
    expect(sampled).toBeGreaterThan(0);
    // atan((100−2)/d) at the first plateau sample d ∈ [1000, 1350]
    expect(sampleProfile(p, CENTER_N)).toBeGreaterThan(4);
    expect(sampleProfile(p, CENTER_N)).toBeLessThan(6.2);
    expect(profileCoverage(p)).toBeCloseTo(1 / 96, 6);
  });

  it("a flat plain reads slightly BELOW the horizon (curvature-refraction drop)", () => {
    const p = createProfile(96, -5);
    marchTerrainBin(p, ANCHOR, CENTER_E, () => 0, MARCH);
    const alt = sampleProfile(p, CENTER_E);
    expect(alt).toBeLessThan(0);
    expect(alt).toBeGreaterThan(-0.3);
  });

  it("an unloaded-tile march (all null) leaves the bin unknown at the floor", () => {
    const p = createProfile(96, -0.5);
    const sampled = marchTerrainBin(p, ANCHOR, 180, () => null, MARCH);
    expect(sampled).toBe(0);
    expect(profileCoverage(p)).toBe(0);
    expect(sampleProfile(p, 180)).toBeCloseTo(-0.5, 6);
  });
});

describe("azAltOfEcef — exact ECEF→ENU geometry", () => {
  it("a point 1 km east at eye height sits at az 90, alt ≈ 0", () => {
    const f = frameAt(0, 0, 0);
    const east1km = geodeticToEcef(0, (1000 / R_MEAN_M) * (180 / Math.PI), 0);
    const r = azAltOfEcef(f, east1km[0], east1km[1], east1km[2]);
    expect(r.azDeg).toBeCloseTo(90, 1);
    expect(Math.abs(r.altDeg)).toBeLessThan(0.02);
    expect(r.distM).toBeCloseTo(1000, -1);
  });

  it("a point 1 km straight up reads alt ≈ 90 at ~1000 m", () => {
    const f = frameAt(0, 0, 0);
    const up = geodeticToEcef(0, 0, 1000);
    const r = azAltOfEcef(f, up[0], up[1], up[2]);
    expect(r.altDeg).toBeCloseTo(90, 3);
    expect(r.distM).toBeCloseTo(1000, 3);
  });

  it("a point due north reads az ≈ 0", () => {
    const f = frameAt(0, 0, 0);
    const north = geodeticToEcef((500 / R_MEAN_M) * (180 / Math.PI), 0, 0);
    const r = azAltOfEcef(f, north[0], north[1], north[2]);
    expect(Math.min(r.azDeg, 360 - r.azDeg)).toBeLessThan(0.1);
  });
});

describe("sampleBins (the store-mirror sampler, QoL-1 §3.1.D)", () => {
  it("matches sampleProfile over the same bins at every azimuth", () => {
    const p = createProfile(360, -0.5);
    raiseBin(p, 90.5, 12);
    raiseBin(p, 91.5, 8);
    raiseBin(p, 359.5, 3);
    const bins = Array.from(p.altDeg); // the plain array store/plan mirrors
    for (let az = 0; az < 360; az += 0.7) {
      expect(sampleBins(bins, az)).toBeCloseTo(sampleProfile(p, az), 9);
    }
  });

  it("wraps and interpolates between bin centres", () => {
    const bins = [0, 10, 0, 0]; // 4 bins, centres at 45/135/225/315°
    expect(sampleBins(bins, 135)).toBeCloseTo(10, 9);
    expect(sampleBins(bins, 90)).toBeCloseTo(5, 9);
    expect(sampleBins(bins, 0)).toBeCloseTo(0, 9); // wrap: between 315° and 45° centres
  });
});

/**
 * AUDIT #3 A1-16 — the skyline-gap gate, hoisted 2026-08-22.
 *
 * `profileCoverage` reached `planFeed`, the store and both PLAN panels and was consulted by NO
 * radar surface (verified: the positive control `profileBins` DID match in both panels). A
 * 15 %-covered profile fractured its bands with exactly the authority of a complete one — the
 * gaps themselves are true, but the clear sky between them is ignorance drawn as knowledge.
 *
 * Mutation that makes these RED: drop the coverage clause, the guard-distance clause or the
 * "focus anchor owns no profile" clause from `skylineBinsFor` — each has its own case below.
 */
describe("skylineBinsFor — one gap gate, three radar surfaces (A1-16)", () => {
  const BINS = [1, 2, 3, 4];
  const EYE = { latDeg: 48.4647, lonDeg: 35.0462 };
  const gate = (o: Partial<SkylineGate> = {}): SkylineGate => ({
    ready: true,
    bins: BINS,
    coverage: 1,
    eye: EYE,
    anchor: EYE,
    guardM: 60,
    minCoverage: 0.5,
    ...o,
  });

  it("a complete profile at the radar's own eye claims its gaps", () => {
    expect(skylineBinsFor(gate())).toBe(BINS);
  });

  it("THE FINDING: a sparsely covered profile claims NOTHING", () => {
    expect(skylineBinsFor(gate({ coverage: 0.15 }))).toBeNull();
    expect(skylineBinsFor(gate({ coverage: 0 }))).toBeNull();
    // …and the floor is inclusive, so exactly-at-threshold still claims.
    expect(skylineBinsFor(gate({ coverage: 0.5 }))).toBe(BINS);
    expect(skylineBinsFor(gate({ coverage: 0.49 }))).toBeNull();
  });

  it("a far-away eye may not lend its skyline to another point's radar", () => {
    const near = { latDeg: EYE.latDeg + 0.0004, lonDeg: EYE.lonDeg }; // ≈45 m
    const far = { latDeg: EYE.latDeg + 0.0009, lonDeg: EYE.lonDeg }; // ≈100 m
    expect(skylineBinsFor(gate({ anchor: near }))).toBe(BINS);
    expect(skylineBinsFor(gate({ anchor: far }))).toBeNull();
    // The guard is a true 2D distance — an EAST offset of the same metric size also fails.
    const eastFar = {
      latDeg: EYE.latDeg,
      lonDeg: EYE.lonDeg + 100 / (111_320 * Math.cos((EYE.latDeg * Math.PI) / 180)),
    };
    expect(skylineBinsFor(gate({ anchor: eastFar }))).toBeNull();
  });

  it("no profile, no bins, or a focus anchor ⇒ no claim (the pre-existing honest fallbacks)", () => {
    expect(skylineBinsFor(gate({ ready: false }))).toBeNull();
    expect(skylineBinsFor(gate({ bins: null }))).toBeNull();
    expect(skylineBinsFor(gate({ eye: null }))).toBeNull();
  });

  it("the shipped floor is a real threshold — not 0 (which would gate nothing)", async () => {
    const { PLAN } = await import("../../../src/components/globe/tuning");
    expect(PLAN.minCoverageForGaps).toBeGreaterThan(0);
    expect(PLAN.minCoverageForGaps).toBeLessThanOrEqual(1);
  });
});
