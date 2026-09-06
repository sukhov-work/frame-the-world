import { describe, expect, it } from "vitest";
import {
  cascadeNeedsRender,
  fitCascade,
  fitCascades,
  texelBias,
  texelSizeM,
  type CascadeProfile,
} from "../../../src/lib/globe/shadowCascade";
import { SHADOWS, ULTRA } from "../../../src/components/globe/tuning";

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

/**
 * T77 slice A1 (2026-09-06) — the bias derivation, now SHARED with cascade 0.
 *
 * It was the ladder's private arithmetic; the shipped rig biased itself by hand and ended up an
 * order of magnitude under the ladder (`SHADOWS.normalBias` 0.75 m = 0.31 texel at the FPV pose,
 * `ULTRA.shadowNormalBias` 0.45 m = 0.13 texel at the city pose, against 1.5 texels here) — which
 * is one of the two mechanisms behind the 62–75 % isolated-pixel flips in `MEASUREMENTS` §8. These
 * pin the properties cascade 0 now depends on, including the ONE thing it needs that the ladder
 * does not: a cap, because it is the only box with contact points a viewer can stand next to.
 */
describe("texelSizeM / texelBias — the one metric-bias derivation", () => {
  it("texelSizeM is the extent-to-map ratio, and never divides by zero", () => {
    expect(texelSizeM(1_600, 4096)).toBeCloseTo(0.78125, 9);
    expect(texelSizeM(5_000, 4096)).toBeCloseTo(2.44140625, 9); // the FPV pose, §8's 2.44 m
    expect(texelSizeM(13_760, 8192)).toBeCloseTo(3.359375, 9); // the city ULTRA pose, §8's 3.36 m
    expect(texelSizeM(1_000, 0)).toBe(2_000);
  });

  it("both biases are monotone (strictly increasing) in the texel size", () => {
    let prevN = -Infinity;
    let prevB = -Infinity;
    for (const mpt of [0.39, 0.78, 2.44, 3.36, 29, 127]) {
      const t = texelBias({ metresPerTexel: mpt, depthRangeM: 96_000, biasTexels: 0.6, normalBiasTexels: 1.5 });
      expect(t.normalBiasM).toBeGreaterThan(prevN);
      expect(t.biasM).toBeGreaterThan(prevB);
      prevN = t.normalBiasM;
      prevB = t.biasM;
    }
  });

  it("the CAP binds only where it is meant to — cascade 0, not the ladder", () => {
    // At the city ULTRA pose 1.5 texels is 5.04 m of normal offset, which would float every
    // building off its own base. Cascade 0 passes the cap; the cascades pass nothing.
    const mpt = texelSizeM(13_760, 8192);
    const capped = texelBias({ metresPerTexel: mpt, depthRangeM: 96_000, biasTexels: 0.6, normalBiasTexels: 1.5, normalBiasMaxM: SHADOWS.normalBiasMaxM });
    expect(1.5 * mpt).toBeCloseTo(5.039, 3);
    expect(capped.normalBiasM).toBe(SHADOWS.normalBiasMaxM);
    const uncapped = texelBias({ metresPerTexel: mpt, depthRangeM: 96_000, biasTexels: 0.6, normalBiasTexels: 1.5 });
    expect(uncapped.normalBiasM).toBeCloseTo(5.039, 3);
    // …and at street level, where contact is everything, the cap does not bind at all.
    const street = texelBias({ metresPerTexel: texelSizeM(1_600, 8192), depthRangeM: 96_000, biasTexels: 0.6, normalBiasTexels: 1.5, normalBiasMaxM: SHADOWS.normalBiasMaxM });
    expect(street.normalBiasM).toBeLessThan(SHADOWS.normalBiasMaxM);
    expect(street.normalBiasM).toBeCloseTo(1.5 * texelSizeM(1_600, 8192), 9);
  });

  it("the depth bias round-trips through three's fraction-of-range unit", () => {
    const t = texelBias({ metresPerTexel: 3.359375, depthRangeM: 96_000, biasTexels: 0.6, normalBiasTexels: 1.5 });
    expect(-t.bias * 96_000).toBeCloseTo(t.biasM, 9);
    expect(t.bias).toBeLessThan(0); // negative pulls surfaces TOWARD the light — kills acne
  });

  it("0 texels is exactly 0 metres — the identity arm the base profile ships on", () => {
    const t = texelBias({ metresPerTexel: 2.44140625, depthRangeM: 7_000, biasTexels: 0, normalBiasTexels: 0 });
    expect(t.biasM).toBe(0);
    expect(t.bias).toBe(-0); // the caller never uses this arm; it takes the raw constant instead
    expect(t.normalBiasM).toBe(0);
  });

  it("the LADDER's own fits still come out of the shared function unchanged", () => {
    // The refactor must be byte-identical for the cascades or it silently re-tunes them.
    const f = fitCascade(60_000, 18_000, RELIEF, CLEAR, P());
    const t = texelBias({ metresPerTexel: f.metresPerTexel, depthRangeM: f.farM - f.nearM, biasTexels: P().biasTexels, normalBiasTexels: P().normalBiasTexels });
    expect(f.bias).toBe(t.bias);
    expect(f.biasM).toBe(t.biasM);
    expect(f.normalBiasM).toBe(t.normalBiasM);
    // Uncapped by construction: 1.5 texels at 29 m/texel is 44 m, far past SHADOWS.normalBiasMaxM.
    expect(f.normalBiasM).toBeGreaterThan(SHADOWS.normalBiasMaxM);
  });
});
