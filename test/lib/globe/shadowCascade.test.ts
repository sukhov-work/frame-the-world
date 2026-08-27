import { describe, expect, it } from "vitest";
import {
  cascadeNeedsRender,
  fitCascade,
  fitCascades,
  type CascadeProfile,
} from "../../../src/lib/globe/shadowCascade";
import { ULTRA } from "../../../src/components/globe/tuning";

const P = (over: Partial<CascadeProfile> = {}): CascadeProfile => ({
  reachM: 60_000,
  maxBoundsM: 60_000,
  mapPx: 4096,
  radius: 3,
  quantM: 4_000,
  biasTexels: 0.6,
  normalBiasTexels: 1.5,
  ...over,
});

const RELIEF = 9_000;
const CLEAR = 2_000;

describe("fitCascade", () => {
  it("covers the view distance, quantized UP so the box only moves in steps", () => {
    const f = fitCascade(31_500, 18_000, RELIEF, CLEAR, P());
    expect(f.halfExtentM).toBe(32_000); // ceil(31500 / 4000) * 4000
  });

  it("never exceeds its own reach or cap", () => {
    const f = fitCascade(500_000, 18_000, RELIEF, CLEAR, P());
    expect(f.halfExtentM).toBe(60_000);
  });

  it("never falls below the cascade before it — the ladder cannot invert", () => {
    const f = fitCascade(1_000, 18_000, RELIEF, CLEAR, P());
    expect(f.halfExtentM).toBeGreaterThanOrEqual(18_000);
  });

  it("NO CASTER BEHIND THE LIGHT: near is the clearance, and the box+relief fits inside near..far", () => {
    // The invariant the whole stand-off exists for — a grazing sun on a wide box must not put
    // distant terrain behind the shadow camera's near plane, which drops it from the depth pass
    // silently. Worst case along the light: a caster at the far corner, `relief` above centre.
    for (const view of [20_000, 60_000, 150_000, 400_000]) {
      for (const p of [P(), P({ reachM: 260_000, maxBoundsM: 260_000, mapPx: 2048, quantM: 16_000 })]) {
        const f = fitCascade(view, 18_000, RELIEF, CLEAR, p);
        expect(f.nearM).toBe(CLEAR);
        expect(f.nearM).toBeGreaterThan(0);
        // nearest possible caster (box corner toward the light, at +relief)
        expect(f.lightDistM - f.halfExtentM - RELIEF).toBeGreaterThanOrEqual(f.nearM - 1e-9);
        // furthest possible caster (box corner away from the light, at −relief)
        expect(f.lightDistM + f.halfExtentM + RELIEF).toBeLessThanOrEqual(f.farM + 1e-9);
      }
    }
  });

  it("derives bias from the LIVE depth range, so the metric bias is what was authored", () => {
    const f = fitCascade(60_000, 18_000, RELIEF, CLEAR, P());
    // three adds `bias` to shadowCoord.z after the divide; ortho depth is linear in view depth.
    expect(-f.bias * (f.farM - f.nearM)).toBeCloseTo(f.biasM, 6);
    expect(f.biasM).toBeCloseTo(0.6 * f.metresPerTexel, 9);
    expect(f.bias).toBeLessThan(0);
  });

  it("scales both bias terms with texel size — a coarse cascade errs toward LIT", () => {
    const fine = fitCascade(60_000, 18_000, RELIEF, CLEAR, P());
    const coarse = fitCascade(240_000, 60_000, RELIEF, CLEAR, P({
      reachM: 260_000, maxBoundsM: 260_000, mapPx: 2048, quantM: 16_000,
    }));
    expect(coarse.metresPerTexel).toBeGreaterThan(fine.metresPerTexel);
    expect(coarse.normalBiasM).toBeGreaterThan(fine.normalBiasM);
    expect(coarse.biasM).toBeGreaterThan(fine.biasM);
  });

  it("reports the texel price it is paying", () => {
    const f = fitCascade(60_000, 18_000, RELIEF, CLEAR, P());
    expect(f.metresPerTexel).toBeCloseTo((2 * 60_000) / 4096, 9);
  });
});

describe("fitCascades — the ladder", () => {
  const LADDER = ULTRA.cascades as unknown as CascadeProfile[];

  it("is strictly nested and monotone in extent", () => {
    const fits = fitCascades(300_000, 18_000, RELIEF, CLEAR, LADDER);
    let prev = 18_000;
    for (const f of fits) {
      if (!f) continue;
      expect(f.halfExtentM).toBeGreaterThan(prev);
      prev = f.halfExtentM;
    }
  });

  it("drops a cascade that would duplicate the one before it — street level costs nothing", () => {
    // Cascade 0 already holds a short look, so neither extra box is worth a depth pass.
    const fits = fitCascades(2_000, 60_000, RELIEF, CLEAR, LADDER);
    expect(fits[0]).toBeNull();
    expect(fits[1]).toBeNull();
  });

  it("REGRESSION — the owner's measured poses are now fully covered", () => {
    // `__globe.ultraLook()` on 2026-08-27, ULTRA on, before this module existed. Each row is
    // (viewFitM, cascade-0 boundsM); the single box covered 8–35 % of the frame.
    for (const [viewFit, half0] of [
      [148_757, 18_000], // Fuji, 5.2 km, 84° tilt
      [427_828, 18_000], // Fuji, 15 km, 68° tilt
      [100_163, 18_000], // mountains, 3.5 km, dusk
      [200_165, 18_000], // farmland, 7 km
      [20_043, 10_944], // city, 700 m
    ] as const) {
      const fits = fitCascades(viewFit, half0, RELIEF, CLEAR, LADDER);
      const cover = Math.max(half0, ...fits.map((f) => f?.halfExtentM ?? 0));
      // Either the ladder reaches the whole view, or it is at its documented far cap — past which
      // ULTRA's own haze has washed the field to `hazeMaxK` and a shadow is not readable anyway.
      expect(cover >= viewFit || cover === 260_000).toBe(true);
      expect(cover).toBeGreaterThan(half0 * 1.05);
    }
  });

  it("the shipped ladder's coarsest texel is still sub-pixel-ish at its own reach", () => {
    // A 260 km half-extent at 2048² is 254 m/texel; at 150 km one screen pixel is ~61 m at the
    // app's default FOV, so ~4 px. Documented, not accidental — this asserts the arithmetic that
    // the tuning comment claims, so a mapPx edit that breaks the claim fails here.
    const f = fitCascade(400_000, 60_000, RELIEF, CLEAR, LADDER[1]);
    expect(f.metresPerTexel).toBeLessThan(300);
  });
});

describe("cascadeNeedsRender", () => {
  const base = {
    halfExtentM: 60_000,
    appliedHalfExtentM: 60_000,
    centreDriftM: 0,
    keySwingRad: 0,
    epoch: 4,
    appliedEpoch: 4,
    ageMs: 0,
    moveFrac: 0.12,
    swingRad: 0.004,
    maxStaleMs: 1_500,
  };

  it("renders when it never has", () => {
    expect(cascadeNeedsRender({ ...base, appliedHalfExtentM: 0 })).toBe(true);
  });

  it("renders when the fitted extent changed", () => {
    expect(cascadeNeedsRender({ ...base, halfExtentM: 64_000 })).toBe(true);
  });

  it("renders when terrain streamed in — new tiles are new casters", () => {
    expect(cascadeNeedsRender({ ...base, epoch: 5 })).toBe(true);
  });

  it("tolerates eye drift up to moveFrac of the half-extent, then renders", () => {
    expect(cascadeNeedsRender({ ...base, centreDriftM: 7_000 })).toBe(false);
    expect(cascadeNeedsRender({ ...base, centreDriftM: 7_300 })).toBe(true);
  });

  it("renders when the key direction swings past the threshold", () => {
    expect(cascadeNeedsRender({ ...base, keySwingRad: 0.003 })).toBe(false);
    expect(cascadeNeedsRender({ ...base, keySwingRad: 0.005 })).toBe(true);
  });

  it("is bounded by the staleness net — a missed trigger can never freeze a cascade", () => {
    expect(cascadeNeedsRender({ ...base, ageMs: 1_499 })).toBe(false);
    expect(cascadeNeedsRender({ ...base, ageMs: 1_500 })).toBe(true);
  });

  it("does nothing while the camera is parked and nothing streams", () => {
    expect(cascadeNeedsRender(base)).toBe(false);
  });
});
