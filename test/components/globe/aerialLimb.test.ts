import { describe, expect, it } from "vitest";
import { FTW_AERIAL_GLSL, limbGlsl, limbK } from "../../../src/components/globe/scene/glsl";
import { POSE, ULTRA } from "../../../src/components/globe/tuning";

/**
 * T93 — THE LIMB (owner ruling 2026-09-06m option (a), built 2026-09-06n).
 *
 * The hard band along the horizon at `everest-orbit-73` was measured (MEASUREMENTS §17.4) to be
 * far TERRAIN hazed by `ftwAerial` toward `tint × ftwAirLevel(cosG)` — a lobe normalised to 1
 * looking into the sun and ~0.25–0.5 for a horizontal ray under a high sun — so 300–500 km of
 * terrain converged on an in-scatter darker than itself (luma ~88) under a ~205 sky. Past
 * `ULTRA.limbStartM` the LEVEL lobe relaxes toward isotropic. These pin the emitted term, its JS
 * twin, the byte-identity below the start, and the geometry that makes the start safe.
 */
const R = 6_371_000;
/** Distance to the sea-level horizon from altitude h (m) — where the terrain reach ends. */
const horizonM = (h: number) => Math.sqrt(2 * R * h + h * h);

describe("T93 — the aerial limb", () => {
  it("is emitted into the ONE shared aerial function, from the tunables", () => {
    expect(FTW_AERIAL_GLSL).toContain("float lobe = mix(ftwAirLevel(cosG), 1.0, limb);");
    expect(FTW_AERIAL_GLSL).toContain(limbGlsl(ULTRA.limbStartM, ULTRA.limbEndM));
    expect(FTW_AERIAL_GLSL).toContain("* lobe;");
    // …and the old direct multiply by the lobe is gone (one level term, not two).
    expect(FTW_AERIAL_GLSL).not.toContain("* ftwAirLevel(cosG);");
  });

  it("the shipped band is ordered and the emitter writes a real smoothstep for it", () => {
    expect(ULTRA.limbEndM).toBeGreaterThan(ULTRA.limbStartM);
    expect(limbGlsl(ULTRA.limbStartM, ULTRA.limbEndM)).toMatch(/^smoothstep\(40000\.0, 120000\.0, dist\)$/);
  });

  it("a disabled band (end <= start) folds to a constant 0 — never an unordered smoothstep", () => {
    expect(limbGlsl(300_000, 300_000)).toBe("0.0");
    expect(limbGlsl(300_000, 100_000)).toBe("0.0");
    expect(limbK(400_000, 300_000, 300_000)).toBe(0);
    expect(limbK(400_000, 300_000, 100_000)).toBe(0);
  });

  it("is EXACTLY 0 at and below the start (mix(lobe, 1, 0) is the lobe — byte-identical) and 1 past the end", () => {
    for (const d of [0, 1_000, 35_000, ULTRA.limbStartM]) {
      expect(limbK(d, ULTRA.limbStartM, ULTRA.limbEndM)).toBe(0);
    }
    for (const d of [ULTRA.limbEndM, 500_000, 2_000_000]) {
      expect(limbK(d, ULTRA.limbStartM, ULTRA.limbEndM)).toBe(1);
    }
    expect(limbK((ULTRA.limbStartM + ULTRA.limbEndM) / 2, ULTRA.limbStartM, ULTRA.limbEndM)).toBeCloseTo(0.5, 9);
    let prev = 0;
    for (let d = 0; d <= 600_000; d += 5_000) {
      const k = limbK(d, ULTRA.limbStartM, ULTRA.limbEndM);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it("geometry: the band's terrain is inside the ramp; the FPV horizon, the descent and legacy-everest are not; orbit-52's top rows sit at the ramp's foot", () => {
    // everest-orbit-73: 21.8 km over the Khumbu, the sea-level horizon (= the terrain reach and
    // the far plane) is ~527 km out; the measured band lies in the last third of that reach.
    const reach73 = horizonM(21_800);
    expect(reach73).toBeGreaterThan(500_000);
    expect(limbK(reach73, ULTRA.limbStartM, ULTRA.limbEndM)).toBe(1);
    expect(limbK(0.6 * reach73, ULTRA.limbStartM, ULTRA.limbEndM)).toBeGreaterThan(0.5);
    // The FPV eye (95 m at Dnipro): the horizon is ~35 km away — nothing an FPV frame draws can
    // reach the start, so every FPV pose is byte-identical.
    expect(horizonM(95)).toBeLessThan(40_000);
    expect(limbK(horizonM(95), ULTRA.limbStartM, ULTRA.limbEndM)).toBe(0);
    // The descent (31.8 km, tilt 29.3°, POSE.fovDeg 38): the top-of-frame ray is ~41.7° below
    // horizontal and meets sea level ~36 km out — under the start, byte-identical.
    const half = POSE.fovDeg / 2;
    const reachM = (altM: number, tiltDeg: number) =>
      altM / Math.tan(((90 - (tiltDeg + half)) * Math.PI) / 180);
    expect(reachM(31_794, 29.3)).toBeLessThan(ULTRA.limbStartM);
    expect(limbK(reachM(31_794, 29.3), ULTRA.limbStartM, ULTRA.limbEndM)).toBe(0);
    // legacy-everest (11.5 km, tilt 35°): ~16 km — byte-identical.
    expect(limbK(reachM(11_500, 35), ULTRA.limbStartM, ULTRA.limbEndM)).toBe(0);
    // everest-orbit-52 (21.8 km, tilt 52°): the top ray meets SEA LEVEL ~63 km out (limb ≈ 0.21,
    // an upper bound — the Khumbu's 5–8 km relief catches it nearer, ~45–50 km, limb ≈ 0.05): the
    // ramp's FOOT. Its top rows move by a few codes (the post sweep measured Δ ≤ 6 on the top
    // decile, MEASUREMENTS §17.5); the rest of the frame is under the start. Pinned small, not 0.
    const top52 = reachM(21_828, 52);
    expect(top52).toBeGreaterThan(ULTRA.limbStartM);
    expect(limbK(top52, ULTRA.limbStartM, ULTRA.limbEndM)).toBeLessThan(0.25);
  });
});
