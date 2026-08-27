import { describe, expect, it } from "vitest";
import { sunDiscArms } from "../../../src/components/globe/scene/sky";
import { bandCurve } from "../../../src/lib/globe/lightBands";
import { BLOOM, SKY } from "../../../src/components/globe/tuning";
import { solarChroma } from "../../../src/lib/globe/duskLight";
import { tokens } from "../../../src/lib/theme/tokens";

/**
 * THE SUN DISC AT DUSK (owner taste pass, 2026-08-27c) — "the sun disk becomes too white and
 * transparent … keep it solid … start diminishing it earlier … then can do a solid orange disk."
 *
 * The disc was `AdditiveBlending`, so its result is literally `disc + sky`: dimming it and
 * dissolving it into the sky were the SAME operation, and no level knob could ever have produced a
 * dim-but-solid sun. It now carries a premultiplied arm as well. These tests pin the two things a
 * screenshot cannot show — that the OFF path is still exactly addition, and that alpha can never
 * punch a black hole.
 */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lumOf = (hex: string) => {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(v.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);
const level = (deg: number) => bandCurve(SKY.discLevelCurve, sinDeg(deg));
/** three's `smoothstep(x, min, max)` — the same one `sky.update` uses for the solidity ramp. */
const smoothstep = (x: number, lo: number, hi: number) => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const solidAt = (deg: number) => 1 - smoothstep(deg, SKY.discSolidLoDeg, SKY.discSolidHiDeg);

describe("sunDiscArms — the premultiplied split", () => {
  it("is EXACTLY the shipped addition when solid is 0", () => {
    // The whole off-state proof: alpha 0 makes `DST' = rgb + DST·(1 − 0)` = ONE/ONE, so the
    // premultiplied path is a strict superset of AdditiveBlending rather than a look change.
    for (const cover of [0, 0.3, 1]) {
      for (const lvl of [0, 1, 5]) {
        const a = sunDiscArms(cover, lvl, 0, 0.4);
        expect(a.alpha).toBe(0);
        expect(a.rgb).toBeCloseTo(lvl * cover + 0.4, 12);
      }
    }
  });

  it("NEVER punches a black hole — alpha is 0 wherever coverage is", () => {
    // Under addition every mask could safely be applied to colour alone, because colour 0 already
    // means invisible. Under premultiplied "over" a fragment with rgb 0 and a 1 is BLACK. So the
    // eclipse silhouette, the horizon fade and the disc mask all have to reach ALPHA too.
    for (const solid of [0, 0.5, 1]) {
      expect(sunDiscArms(0, 5, solid, 0).alpha).toBe(0);
      expect(sunDiscArms(0, 5, solid, 0).rgb).toBe(0);
    }
    // …and a fully covered, fully solid fragment is opaque with its own colour, never black.
    const solidCore = sunDiscArms(1, 0.65, 1, 0);
    expect(solidCore.alpha).toBe(1);
    expect(solidCore.rgb).toBeGreaterThan(0);
  });

  it("keeps the HALO out of alpha", () => {
    // The halo is an exp() to 7 disc radii with no compact support; an alpha derived from total
    // brightness would make ~14 solar diameters of sky partly opaque and re-create the quad edge.
    const a = sunDiscArms(0, 5, 1, 0.9);
    expect(a.alpha).toBe(0);
    expect(a.rgb).toBe(0.9);
  });

  it("is premultiplied — rgb already carries the coverage", () => {
    expect(sunDiscArms(0.5, 4, 1, 0).rgb).toBeCloseTo(2, 12);
    expect(sunDiscArms(0.5, 4, 1, 0).alpha).toBeCloseTo(0.5, 12);
  });
});

describe("SKY.discLevelCurve — 'diminish earlier, proportionally, then hold'", () => {
  it("starts dimming EARLIER than the shipped 10° ramp", () => {
    expect(level(20)).toBeCloseTo(1, 6);
    expect(level(15)).toBeLessThan(1); // the old `sunExtinctAltHiDeg` ramp was still exactly 1.0…
    expect(level(10)).toBeLessThan(0.7); // …and still 1.0 here, where this is already well down
  });

  it("falls monotonically and proportionally through the band", () => {
    let prev = -1;
    for (let d = -2; d <= 20; d += 0.25) {
      const v = level(d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(level(12)).toBeLessThan(0.8);
    expect(level(8)).toBeLessThan(0.4);
    expect(level(4)).toBeLessThan(0.2);
  });

  it("HOLDS below 1° — the 'solid orange disk', not a fade to nothing", () => {
    const at1 = level(1);
    expect(level(0)).toBeCloseTo(at1, 6);
    expect(level(-1)).toBeCloseTo(at1, 6);
    expect(at1).toBeGreaterThan(0.05); // it must survive; the defect was it becoming a ghost
  });

  it("puts the BLOOM crossing above the band the owner is watching", () => {
    // Core luminance = sunIntensity × level × lum(sunCore). Below BLOOM.threshold the disc stops
    // blooming entirely; that transition must not land inside 0-3°, or the glow pops.
    const core = (deg: number) => SKY.sunIntensity * level(deg) * lumOf(tokens.sunCore);
    expect(core(20)).toBeGreaterThan(BLOOM.threshold);
    expect(core(8)).toBeGreaterThan(BLOOM.threshold);
    for (const d of [3, 2, 1, 0, -1]) expect(core(d)).toBeLessThan(BLOOM.threshold);
    // …and it still reads as a sun against the sky rather than as a hole.
    expect(core(0)).toBeGreaterThan(0.3);
  });
});

describe("the solidity ramp", () => {
  it("is EXACTLY 0 at and above discSolidHiDeg — so no daytime frame moves", () => {
    expect(solidAt(SKY.discSolidHiDeg)).toBe(0);
    for (const d of [6, 8, 15, 45, 90]) expect(solidAt(d)).toBe(0);
  });

  it("is fully solid at and below discSolidLoDeg", () => {
    expect(solidAt(SKY.discSolidLoDeg)).toBe(1);
    for (const d of [1, 0, -1, -5]) expect(solidAt(d)).toBe(1);
  });

  it("crosses smoothly in between, and the window is the one the owner named", () => {
    expect(solidAt(3.5)).toBeGreaterThan(0.4);
    expect(solidAt(3.5)).toBeLessThan(0.6);
    expect(SKY.discSolidLoDeg).toBe(1); // "up until some point e.g 1 degree to horizon"
    expect(SKY.discSolidHiDeg).toBeGreaterThan(SKY.discSolidLoDeg);
  });
});

describe("the disc's chroma — orange, not crimson", () => {
  const floored = (deg: number) => {
    const ch = solarChroma(deg);
    const f = SKY.discChromaFloor;
    return ch.map((c, i) => Math.max(c, f[i]));
  };
  const tintAt = (deg: number) => {
    const t = floored(deg);
    const k = SKY.discChromaK * solidAt(deg);
    return t.map((c) => 1 + (c - 1) * k);
  };

  it("is EXACTLY white wherever the disc is still the shipped additive one", () => {
    for (const d of [6, 10, 30, 90]) for (const c of tintAt(d)) expect(c).toBe(1);
    // …and the crossing is where the level curve says it is, not where the disc happens to dim.
    expect(SKY.discSolidHiDeg).toBeLessThan(8);
  });

  it("goes warm at the horizon without going crimson", () => {
    const t = tintAt(0);
    expect(t[0]).toBeCloseTo(1, 6); // red survives
    expect(t[1]).toBeLessThan(0.9); // green pulled down…
    expect(t[1]).toBeGreaterThan(0.5); // …but nowhere near solarChroma's raw 0.212
    expect(t[2]).toBeGreaterThan(0.35); // and the blue channel is NOT dead
    expect(t[2]).toBeLessThan(t[1]);
  });

  it("the floor is what stops it — raw solarChroma at the horizon really is crimson", () => {
    const raw = solarChroma(0);
    expect(raw[1]).toBeLessThan(0.3);
    expect(raw[2]).toBeLessThan(0.05);
    expect(SKY.discChromaFloor[1]).toBeGreaterThan(raw[1]);
    expect(SKY.discChromaFloor[2]).toBeGreaterThan(raw[2]);
  });
});

describe("the halo leaves before the core dims", () => {
  const halo = (deg: number) => Math.pow(level(deg), SKY.haloExtinctPow);
  it("falls FASTER than the level it rides", () => {
    expect(SKY.haloExtinctPow).toBeGreaterThan(1);
    for (const d of [8, 4, 2, 0]) expect(halo(d)).toBeLessThan(level(d) + 1e-12);
    expect(halo(4)).toBeLessThan(0.25);
  });
  it("is exactly 1 at high sun", () => {
    expect(halo(20)).toBeCloseTo(1, 9);
  });
});
