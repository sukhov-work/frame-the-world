import { describe, expect, it } from "vitest";
import { moonDiscArms } from "../../../src/components/globe/scene/sky";
import { SKY } from "../../../src/components/globe/tuning";

/**
 * Day-moon additive-arm guard (owner 2026-08-14 qol3 — the abrupt dark-crescent fix).
 * moonDiscArms is the CPU twin of the moon fragment's premultiplied two-arm mix; the material
 * blends ONE / ONE_MINUS_SRC_ALPHA, so a pixel's effect on the sky behind it is
 * `+rgb − dst·alpha`. The regression this pins: the OLD NormalBlending day arm lerped the DARK
 * albedo colour over a BRIGHTER sky at alpha = lit·gain — every mid-lit pixel DARKENED the sky
 * (the owner's dark-crescent camera-motion screenshots). By day the disc must be purely
 * additive: alpha exactly 0, whatever lit/fade/albedo say.
 */
describe("moonDiscArms — premultiplied day/night arms", () => {
  const lits = [0, 0.05, 0.1, 0.3, 0.5, 0.8, 1];
  const fades = [0, 0.25, 0.5, 1];
  const albedo = 0.3; // typical LROC map luminance

  it("day arm (uDaySky = 1) is additive-only: blend alpha is 0 for EVERY lit/fade", () => {
    for (const lit of lits)
      for (const fade of fades) {
        const { rgb, alpha } = moonDiscArms(lit, albedo, 1, fade);
        expect(alpha).toBe(0); // can never attenuate the sky → can never darken it
        expect(rgb).toBeGreaterThanOrEqual(0);
      }
  });

  it("day arm at lit = 0 contributes NOTHING — the dark side IS the sky", () => {
    const { rgb, alpha } = moonDiscArms(0, albedo, 1, 1);
    expect(rgb).toBe(0);
    expect(alpha).toBe(0);
  });

  it("day rgb grows monotonically with lit (crescent limb brightest)", () => {
    let prev = -1;
    for (const lit of lits) {
      const { rgb } = moonDiscArms(lit, albedo, 1, 1);
      expect(rgb).toBeGreaterThanOrEqual(prev);
      prev = rgb;
    }
  });

  it("night arm (uDaySky = 0) is byte-identical to the classic opaque disc", () => {
    for (const lit of lits)
      for (const fade of fades) {
        const { rgb, alpha } = moonDiscArms(lit, albedo, 0, fade);
        expect(alpha).toBeCloseTo(fade, 12); // occludes stars through the horizon melt
        expect(rgb).toBeCloseTo(
          albedo * (SKY.moonEarthshine + lit * SKY.moonBrightness) * fade,
          12,
        );
      }
  });

  it("twilight mixes linearly: uDaySky = 0.5 halves the opaque share", () => {
    const { alpha } = moonDiscArms(0.5, albedo, 0.5, 1);
    expect(alpha).toBeCloseTo(0.5, 12);
  });
});
