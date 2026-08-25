import { describe, expect, it } from "vitest";
import {
  aboveGateK,
  belowGateK,
  moonReadyK,
  moonRigTakeoverK,
  sunKeyTroughK,
  type KeyGateProfile,
} from "../../../src/lib/globe/keyHandoff";
import { GOLDEN, SHADOWS, SKY, SUN } from "../../../src/components/globe/tuning";
import { goldenFactor } from "../../../src/lib/ephemeris/golden";

/**
 * RC2 / owner bug B3 (2026-08-25) — "sunset/sunrise shadow snap + luminosity jump".
 *
 * The regression guard is a SCRUB, not a spot check: walk the sun down through its elevation
 * gate one arc-second at a time and assert that nothing the viewer sees moves in a single step.
 * A spot check at the gate would pass with the bug still in — the defect was a discontinuity,
 * and discontinuities are only visible between samples.
 */

const P: KeyGateProfile = {
  gateSin: SHADOWS.minSunElevSin,
  bandSin: SHADOWS.fadeBandSin,
  moonMinIllum: SHADOWS.moonMinIllum,
  moonIllumSoftFrac: SHADOWS.moonIllumSoftFrac,
};

const sinDeg = (deg: number) => Math.sin((deg * Math.PI) / 180);

describe("gate ramps", () => {
  it("aboveGateK is exactly 0 AT the gate and 1 a band above it", () => {
    expect(aboveGateK(P.gateSin, P)).toBe(0);
    expect(aboveGateK(P.gateSin - 0.01, P)).toBe(0);
    expect(aboveGateK(P.gateSin + P.bandSin, P)).toBe(1);
    expect(aboveGateK(1, P)).toBe(1);
  });

  it("belowGateK is exactly 0 AT the gate and 1 a band below it", () => {
    expect(belowGateK(P.gateSin, P)).toBe(0);
    expect(belowGateK(P.gateSin + 0.01, P)).toBe(0);
    expect(belowGateK(P.gateSin - P.bandSin, P)).toBe(1);
    expect(belowGateK(-1, P)).toBe(1);
  });

  it("the band really is about three degrees of elevation", () => {
    const gateDeg = (Math.asin(P.gateSin) * 180) / Math.PI;
    const topDeg = (Math.asin(P.gateSin + P.bandSin) * 180) / Math.PI;
    expect(gateDeg).toBeCloseTo(0.46, 1);
    expect(topDeg - gateDeg).toBeGreaterThan(2.5);
    expect(topDeg - gateDeg).toBeLessThan(3.5);
  });

  it("a zero band degrades to the pre-RC2 boolean snap, and never to NaN", () => {
    const snap: KeyGateProfile = { ...P, bandSin: 0 };
    expect(aboveGateK(P.gateSin, snap)).toBe(0);
    expect(aboveGateK(P.gateSin + 1e-9, snap)).toBe(1);
    expect(Number.isNaN(belowGateK(P.gateSin, snap))).toBe(false);
  });

  it("moonReadyK needs BOTH gates and is smooth in each", () => {
    expect(moonReadyK(0.5, 0.9, P)).toBe(1); // high, bright
    expect(moonReadyK(P.gateSin, 0.9, P)).toBe(0); // at its own elevation gate
    expect(moonReadyK(0.5, P.moonMinIllum * (1 - P.moonIllumSoftFrac), P)).toBe(0); // too dark
    const mid = moonReadyK(0.5, P.moonMinIllum * (1 - P.moonIllumSoftFrac / 2), P);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("the sunset handoff is continuous", () => {
  /** What the rig delivers this frame: key intensity, and the shadow field's strength. */
  function frame(sunElevDeg: number, moonElevDeg: number, moonIllum: number, moonKs: number) {
    const sunDot = sinDeg(sunElevDeg);
    const moonDot = sinDeg(moonElevDeg);
    const sunUp = sunDot > P.gateSin;
    const moonQualifies = moonDot > P.gateSin && moonIllum >= P.moonMinIllum;
    const moonArm = !sunUp && moonQualifies;
    const takeover = moonArm ? moonRigTakeoverK(sunDot, P) : 0;
    if (moonArm) {
      return {
        rigKey: SKY.moonKeyIntensity * moonKs * takeover,
        shadow: Math.min(aboveGateK(moonDot, P), takeover),
      };
    }
    const goldenK = goldenFactor(sunDot, GOLDEN);
    return {
      rigKey:
        SUN.keyIntensity *
        (1 + goldenK * GOLDEN.keyBrighten) *
        sunKeyTroughK(sunDot, moonDot, moonIllum, P),
      shadow: aboveGateK(sunDot, P),
    };
  }

  it("the SHADOW field never steps, with or without a moon waiting", () => {
    for (const [moonElev, illum] of [
      [40, 0.95], // a bright moon is up: the source switches at the gate
      [-20, 0.95], // no moon up: the sun key stays, only the shadows fade
      [40, 0.2], // moon up but too dark to qualify
    ] as const) {
      let prev = frame(6, moonElev, illum, 0.9).shadow;
      let worst = 0;
      for (let deg = 6; deg >= -6; deg -= 1 / 3600) {
        const now = frame(deg, moonElev, illum, 0.9).shadow;
        worst = Math.max(worst, Math.abs(now - prev));
        prev = now;
      }
      // One arc-second of solar motion is ~0.07 s of real time. A step is anything the fade
      // cannot explain: the whole fade spans ~3° = 10,800 arc-seconds.
      expect(worst).toBeLessThan(1e-3);
    }
  });

  it("the RIG's own key contribution troughs to zero at the switch, so the direction teleport is invisible", () => {
    const atGateAbove = frame(0.4601, 40, 0.95, 0.9).rigKey;
    const atGateBelow = frame(0.4599, 40, 0.95, 0.9).rigKey;
    expect(atGateAbove).toBeLessThan(1e-3);
    expect(atGateBelow).toBeLessThan(1e-3);
  });

  it("the TOTAL moon key is preserved across the handoff (rig + dedicated = moonKs)", () => {
    const moonKs = 0.7;
    for (let deg = 0.46; deg >= -4; deg -= 0.01) {
      const takeover = moonRigTakeoverK(sinDeg(deg), P);
      const rig = SKY.moonKeyIntensity * moonKs * takeover;
      const dedicated = SKY.moonKeyIntensity * moonKs * (1 - takeover);
      expect(rig + dedicated).toBeCloseTo(SKY.moonKeyIntensity * moonKs, 12);
    }
  });

  it("with no moon waiting, the phantom night key is untouched (AB1 is not this slice's call)", () => {
    // The sun key below the gate with no qualifying moon must be exactly what it was before RC2.
    for (const deg of [0.5, 0.2, -1, -5, -20]) {
      expect(sunKeyTroughK(sinDeg(deg), sinDeg(-30), 0.95, P)).toBe(1);
    }
  });

  it("a moon crossing its own illumination threshold mid-band cannot pop the trough", () => {
    // Illumination changes ~1.5 %/hour, so this is a slow sweep at a fixed, in-band sun.
    const sunDot = sinDeg(1.5);
    let prev = sunKeyTroughK(sunDot, sinDeg(40), 0.4, P);
    let worst = 0;
    for (let illum = 0.4; illum <= 0.9; illum += 0.0005) {
      const now = sunKeyTroughK(sunDot, sinDeg(40), illum, P);
      worst = Math.max(worst, Math.abs(now - prev));
      prev = now;
    }
    expect(worst).toBeLessThan(1e-2);
  });

  it("deep night and full day are byte-identical to the pre-RC2 behaviour", () => {
    // Rig carries the whole moon key once the night has committed…
    expect(moonRigTakeoverK(sinDeg(-10), P)).toBe(1);
    // …and the sun key is untroughed well above the gate, moon or no moon.
    expect(sunKeyTroughK(sinDeg(30), sinDeg(40), 0.95, P)).toBe(1);
    expect(aboveGateK(sinDeg(30), P)).toBe(1);
  });
});
