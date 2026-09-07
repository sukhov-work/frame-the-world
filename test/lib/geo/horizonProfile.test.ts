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
  sampleBinsKnown,
  sampleProfile,
  sampleProfileKnown,
  foldCoarseProfile,
  skylineSamplerFor,
  withinGuard,
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
  it("matches sampleProfile over the same bins at every azimuth (a fully known profile)", () => {
    const p = createProfile(360, -0.5);
    p.known.fill(1);
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
 * T112 (owner ruling 2026-09-07d, "best effort even below 50 %") — honesty moved from the
 * whole profile to the bin: a consumer gets the exact answer wherever a bin has evidence and
 * `null` only where it has none; a known bin beside an unknown one is HELD, never sagged.
 */
describe("sampleBinsKnown — the per-bin best-effort sampler (T112)", () => {
  const bins = [0, 10, 20, 0]; // centres 45/135/225/315°
  it("two known neighbours interpolate exactly like sampleBins", () => {
    const known = [1, 1, 1, 1];
    for (let az = 0; az < 360; az += 5) {
      expect(sampleBinsKnown(bins, known, az)).toBeCloseTo(sampleBins(bins, az), 9);
    }
  });
  it("a known bin beside an unknown one answers its OWN span with its own value (no sag, no lerp)", () => {
    const known = [0, 1, 0, 0]; // only the 135° bin (span 90°–180°) has evidence
    expect(sampleBinsKnown(bins, known, 135)).toBeCloseTo(10, 9);
    expect(sampleBinsKnown(bins, known, 90)).toBeCloseTo(10, 9); // the span's first azimuth
    expect(sampleBinsKnown(bins, known, 179.9)).toBeCloseTo(10, 9); // …and its last
    expect(sampleBinsKnown(bins, known, 100)).toBeCloseTo(10, 9); // not lerped toward the 45° floor
  });
  it("an azimuth inside an unknown bin answers null — the consumer's own 'unknown'", () => {
    const known = [0, 1, 0, 0];
    expect(sampleBinsKnown(bins, known, 0)).toBeNull();
    expect(sampleBinsKnown(bins, known, 89.9)).toBeNull(); // still inside the 45° bin's span
    expect(sampleBinsKnown(bins, known, 180.1)).toBeNull(); // inside the 225° bin's span
    expect(sampleBinsKnown(bins, known, 270)).toBeNull();
  });
  it("sampleProfile is the best-effort twin: the known answer, else the floor", () => {
    const p = createProfile(4, -0.3);
    raiseBin(p, 135, 10);
    expect(sampleProfileKnown(p, 135)).toBeCloseTo(10, 9);
    expect(sampleProfileKnown(p, 0)).toBeNull();
    expect(sampleProfile(p, 135)).toBeCloseTo(10, 9);
    expect(sampleProfile(p, 0)).toBeCloseTo(-0.3, 9);
    expect(isBlocked(p, 0, -0.2)).toBe(false); // geometrically up in an unknown bin: best effort
    expect(isBlocked(p, 100, 5)).toBe(true); // inside the 135° bin's span
  });
  it("the store mirror and the scene profile agree at every azimuth (bins + known)", () => {
    const p = createProfile(120, -0.2);
    raiseBin(p, 10, 4);
    raiseBin(p, 13, 6);
    raiseBin(p, 200, 30);
    const bins = Array.from(p.altDeg);
    const known = Array.from(p.known);
    for (let az = 0; az < 360; az += 0.37) {
      const a = sampleBinsKnown(bins, known, az);
      const b = sampleProfileKnown(p, az);
      if (a == null || b == null) expect(a).toBe(b);
      else expect(a).toBeCloseTo(b, 9);
    }
  });
});

/**
 * T110 — the fine profile. Terrain is marched at a coarse count and folded into the fine one
 * by the same known-aware interpolation; mesh evidence already there survives the fold.
 */
describe("foldCoarseProfile — terrain at 120 bins into a fine profile (T110)", () => {
  it("identical counts copy exactly, including the evidence flags", () => {
    const c = createProfile(12, -0.1);
    raiseBin(c, 45, 3);
    raiseBin(c, 195, 7);
    const f = createProfile(12, -0.1);
    foldCoarseProfile(f, c);
    expect(Array.from(f.altDeg)).toEqual(Array.from(c.altDeg));
    expect(Array.from(f.known)).toEqual(Array.from(c.known));
  });
  it("a fine bin between two known coarse centres takes the interpolated elevation", () => {
    const c = createProfile(4, -0.1); // centres 45/135/225/315
    c.known.fill(1);
    c.altDeg[0] = 0;
    c.altDeg[1] = 10;
    c.altDeg[2] = 0;
    c.altDeg[3] = 0;
    const f = createProfile(24, -0.1); // centres every 15°, first at 7.5°
    foldCoarseProfile(f, c);
    const i90 = 6; // centre 97.5° → t = (97.5−45)/90
    expect(f.altDeg[i90]).toBeCloseTo(10 * ((97.5 - 45) / 90), 5);
    expect(f.known[i90]).toBe(1);
    expect(profileCoverage(f)).toBe(1);
  });
  it("unknown coarse bins fold as unknown; a single known neighbour is held; mesh max survives", () => {
    const c = createProfile(4, -0.1);
    raiseBin(c, 135, 10); // only the 135° centre known
    const f = createProfile(24, -0.1); // 15° bins
    raiseBin(f, 157.5, 25); // a mesh already raised this fine bin above the terrain
    raiseBin(f, 300, 1);
    foldCoarseProfile(f, c);
    // the 135° coarse span (90°–180°) folds as 10 — except where a mesh is taller
    expect(sampleProfileKnown(f, 97.5)).toBeCloseTo(10, 5);
    expect(sampleProfileKnown(f, 157.5)).toBeCloseTo(25, 5);
    expect(sampleProfileKnown(f, 90)).toBeCloseTo(10, 5); // the span's first azimuth
    // the 45° coarse span (0°–90°) is unknown: its fine bins stay unknown
    expect(sampleProfileKnown(f, 60)).toBeNull();
    // 180°–360° coarse-unknown: the fine bins stay unknown except the mesh one
    expect(sampleProfileKnown(f, 260)).toBeNull();
    expect(sampleProfileKnown(f, 300)).toBeCloseTo(1, 5);
  });
});

/**
 * AUDIT #3 A1-16 — the skyline gate, hoisted 2026-08-22; RE-SHAPED by T112 on 2026-09-07d.
 *
 * A1-16 found that no radar consulted `profileCoverage`, and answered with a coverage FLOOR: a
 * < 50 %-covered profile claimed nothing. The owner's ruling ("best effort even below 50 %")
 * replaces the floor with the per-bin answer — `skylineSamplerFor` returns a sampler that is
 * exact where a bin has evidence and `null` where it has none, at ANY coverage. The two
 * clauses that remain are the real eye and the guard distance.
 *
 * Mutation that makes these RED: reinstate a coverage clause, drop the guard-distance clause
 * or the "focus anchor owns no profile" clause — each has its own case below.
 */
describe("skylineSamplerFor — one gate, every consumer (A1-16 → T112)", () => {
  const BINS = [1, 2, 3, 4];
  const EYE = { latDeg: 48.4647, lonDeg: 35.0462 };
  const gate = (o: Partial<SkylineGate> = {}): SkylineGate => ({
    ready: true,
    bins: BINS,
    known: [1, 1, 1, 1],
    coverage: 1,
    eye: EYE,
    anchor: EYE,
    guardM: 60,
    ...o,
  });

  it("a complete profile at the surface's own eye answers everywhere", () => {
    const v = skylineSamplerFor(gate());
    expect(v).not.toBeNull();
    expect(v!.bins).toBe(BINS);
    expect(v!.partial).toBe(false);
    expect(v!.coverage).toBe(1);
    expect(v!.altAt(135)).toBeCloseTo(2, 9);
  });

  it("THE RULING: a sparsely covered profile still answers where it has evidence", () => {
    const v = skylineSamplerFor(gate({ known: [0, 1, 0, 0], coverage: 0.25 }));
    expect(v).not.toBeNull();
    expect(v!.partial).toBe(true);
    expect(v!.coverage).toBeCloseTo(0.25, 9);
    expect(v!.altAt(135)).toBeCloseTo(2, 9); // the known bin — exact
    expect(v!.altAt(0)).toBeNull(); // no evidence — the consumer's "unknown", not "clear"
    // zero coverage: a sampler that answers null everywhere (no whole-profile refusal needed)
    const z = skylineSamplerFor(gate({ known: [0, 0, 0, 0], coverage: 0 }));
    expect(z).not.toBeNull();
    expect(z!.altAt(135)).toBeNull();
  });

  it("without evidence flags (the pre-T112 shape) every bin is treated as known", () => {
    const v = skylineSamplerFor(gate({ known: undefined }));
    expect(v!.altAt(135)).toBeCloseTo(2, 9);
    expect(v!.partial).toBe(false);
  });

  it("a far-away eye may not lend its skyline to another point's surface", () => {
    const near = { latDeg: EYE.latDeg + 0.0004, lonDeg: EYE.lonDeg }; // ≈45 m
    const far = { latDeg: EYE.latDeg + 0.0009, lonDeg: EYE.lonDeg }; // ≈100 m
    expect(skylineSamplerFor(gate({ anchor: near }))).not.toBeNull();
    expect(skylineSamplerFor(gate({ anchor: far }))).toBeNull();
    // The guard is a true 2D distance — an EAST offset of the same metric size also fails.
    const eastFar = {
      latDeg: EYE.latDeg,
      lonDeg: EYE.lonDeg + 100 / (111_320 * Math.cos((EYE.latDeg * Math.PI) / 180)),
    };
    expect(skylineSamplerFor(gate({ anchor: eastFar }))).toBeNull();
    expect(withinGuard({ eye: EYE, anchor: eastFar, guardM: 60 })).toBe(false);
    expect(withinGuard({ eye: EYE, anchor: near, guardM: 60 })).toBe(true);
  });

  it("no profile, no bins, or a focus anchor ⇒ no claim (the pre-existing honest fallbacks)", () => {
    expect(skylineSamplerFor(gate({ ready: false }))).toBeNull();
    expect(skylineSamplerFor(gate({ bins: null }))).toBeNull();
    expect(skylineSamplerFor(gate({ eye: null }))).toBeNull();
  });
});
