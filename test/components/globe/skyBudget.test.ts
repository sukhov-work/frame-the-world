import { describe, expect, it } from "vitest";
import { tokens } from "../../../src/lib/theme/tokens";
import { ATMOSPHERE, BLOOM } from "../../../src/components/globe/tuning";

/**
 * Horizon sky budget guard (S7 feedback — "white mess at strong tilt"). The low-altitude sky
 * dome is ADDITIVE: at the horizon (sinEl = 0, full day) the shader sums
 *   zenith term  = mix(skyDay, skyHorizon, skyHorizonWhiteness) × skyDayGain
 *   haze term    = mix(skyHorizon, skyDay, skyHazeBlue) × skyHorizonGain × hazeAltK
 * If that total crosses BLOOM.threshold, UnrealBloom picks the band up and SPREADS it — the
 * exact white-out the owner reported (the old budget ran ~1.2 vs threshold 0.9). This test is
 * the JS twin of the shader math in scene/atmosphere.ts — keep them in sync.
 */
const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const hexToLinear = (hex: string): [number, number, number] => {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(v.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
};
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const skyDay = hexToLinear(tokens.skyDay);
const skyHorizon = hexToLinear(tokens.skyHorizon);

/** The shader's horizon-ray sky total (sinEl = 0, dayK = 1, no golden), per channel. */
function horizonSky(hazeAltK: number): number[] {
  const zenith = mix(skyDay, skyHorizon, ATMOSPHERE.skyHorizonWhiteness).map(
    (c) => c * ATMOSPHERE.skyDayGain,
  );
  const haze = mix(skyHorizon, skyDay, ATMOSPHERE.skyHazeBlue).map(
    (c) => c * ATMOSPHERE.skyHorizonGain * hazeAltK,
  );
  return zenith.map((c, i) => c + haze[i]);
}

describe("low-altitude horizon sky budget", () => {
  it("stays under the bloom threshold at every altitude (no bloom-amplified white-out)", () => {
    const atCruise = horizonSky(1); // above hazeLowAltHi — the strongest haze
    expect(Math.max(...atCruise)).toBeLessThan(BLOOM.threshold);
    expect(luminance(atCruise)).toBeLessThan(BLOOM.threshold);
  });

  it("is dimmer at street level than at cruise (the very-low-altitude subtlety ramp)", () => {
    const street = luminance(horizonSky(ATMOSPHERE.hazeLowAltK));
    const cruise = luminance(horizonSky(1));
    expect(street).toBeLessThan(cruise);
    expect(ATMOSPHERE.hazeLowAltK).toBeLessThan(1);
    expect(ATMOSPHERE.hazeLowAltLo).toBeLessThan(ATMOSPHERE.hazeLowAltHi);
  });

  it("the horizon anchor is tinted, not white (whiteness strictly below 1)", () => {
    expect(ATMOSPHERE.skyHorizonWhiteness).toBeLessThan(1);
    expect(ATMOSPHERE.skyHorizonWhiteness).toBeGreaterThan(0);
  });
});
