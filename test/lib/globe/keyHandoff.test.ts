import { describe, expect, it } from "vitest";
import {
  aboveGateK,
  belowGateK,
  moonReadyK,
  moonRigTakeoverK,
  sunKeyTroughK,
  type KeyGateProfile,
} from "../../../src/lib/globe/keyHandoff";
import { GOLDEN, SHADOWS, SKY, SUN, ULTRA } from "../../../src/components/globe/tuning";
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

/**
 * SUNSET SHADOW-RELEASE (2026-09-06) — the SAME invariants, on the ULTRA twins.
 *
 * `StylizedTiles` now builds two more profiles: `ULTRA_KEY_GATE` (the wide handoff band) and
 * `ULTRA_SHADOW_GATE` (the field's own, disc-wide band), both crossing at `ULTRA.shadowGateSin`
 * = sin(−0.8333°) instead of `SHADOWS.minSunElevSin` = sin(+0.4584°), because the code's sun is
 * GEOMETRIC and the upper limb does not set until 50′ below the geometric horizon.
 *
 * The property that made moving the gate safe is the one above: BOTH ARMS REACH ZERO AT THE GATE.
 * These re-run it on the moved crossing, which is the only thing about the twins that is
 * load-bearing — everything else is band width.
 */
const U: KeyGateProfile = { ...P, gateSin: ULTRA.shadowGateSin };
const U_FIELD: KeyGateProfile = { ...U, bandSin: ULTRA.shadowFadeBandSin };

describe("the ULTRA gate twins", () => {
  it("cross at the sun's upper limb, not at +0.4584°", () => {
    expect((Math.asin(U.gateSin) * 180) / Math.PI).toBeCloseTo(-0.8333, 3);
    // 34' of refraction + 16' of solar semidiameter = 50' = 0.8333°.
    expect(U.gateSin).toBeCloseTo(-Math.sin((50 / 60) * (Math.PI / 180)), 6);
    // The BASE profile is untouched — that is the byte-identical-`high` half of the contract.
    expect(P.gateSin).toBe(SHADOWS.minSunElevSin);
  });

  it("BOTH arms still reach zero AT the gate — the invariant the whole move rests on", () => {
    for (const prof of [U, U_FIELD]) {
      expect(aboveGateK(prof.gateSin, prof)).toBe(0); // the sun arm's field and key trough
      expect(belowGateK(prof.gateSin, prof)).toBe(0); // the rig's moon takeover
      expect(moonRigTakeoverK(prof.gateSin, prof)).toBe(0);
      expect(moonReadyK(prof.gateSin, 0.95, prof)).toBe(0);
      // …and with a bright moon waiting, the sun key troughs to nothing there too, so the
      // direction teleport still happens while the rig delivers no light.
      expect(sunKeyTroughK(prof.gateSin, 0.5, 0.95, prof)).toBe(0);
    }
  });

  it("the field's band is the solar DISC, and the handoff band is still the wide one", () => {
    const deg = (v: number) => (Math.asin(v) * 180) / Math.PI;
    // Full shadows now survive to −0.30° instead of dying from +1.06°.
    expect(deg(U_FIELD.gateSin + U_FIELD.bandSin)).toBeCloseTo(-0.3, 2);
    expect(deg(U.gateSin + U.bandSin)).toBeGreaterThan(1.9); // the ~3° handoff band, unchanged
    expect(U.bandSin).toBe(SHADOWS.fadeBandSin);
  });

  it("the moved field still never STEPS — the RC2 scrub, re-run on the twin", () => {
    let prev = aboveGateK(sinDeg(6), U_FIELD);
    let worst = 0;
    for (let deg = 6; deg >= -6; deg -= 1 / 3600) {
      const now = aboveGateK(sinDeg(deg), U_FIELD);
      worst = Math.max(worst, Math.abs(now - prev));
      prev = now;
    }
    // The band is a fifth of the base one, so a single arc-second may move it five times as far —
    // still four orders of magnitude below anything a frame can show.
    expect(worst).toBeLessThan(5e-3);
    expect(aboveGateK(sinDeg(-1), U_FIELD)).toBe(0);
    expect(aboveGateK(sinDeg(-0.29), U_FIELD)).toBe(1);
  });
});

/**
 * T100 — the CHIP's field release band, and its supersession.
 *
 * Ruling (b) of 2026-09-06m slid the band's top to +0.2° (`ULTRA.shadowReleaseStartSin`) so the
 * FIELD's release was spread over the +0.2 / 0 / −0.14 / −0.5° rungs. The ladder on it
 * (MEASUREMENTS §17.2) moved the T66 rise from the −0.5° rung (4.94) to the −0.14° rung (4.23)
 * and did not remove it, and its four measured arms showed why no field band can: the ground
 * twins are a stock `ShadowMaterial` whose mask is `mix(1, shadow, intensity)` PER CASCADE, so the
 * overlay's delivered darkening is `opacity × (1 − (1 − field)³)` — blind to the field above 0.5
 * and exactly 0 wherever the field is 0. Ruling (a) of 2026-09-06o put the band back on the DISC
 * (the tunable at its identity, `shadowGateSin + shadowFadeBandSin`) and gave the OVERLAY its own
 * tail (`duskLight.overlayReleaseK`, pinned in `duskLight.test.ts`). The construction below is
 * the expression `StylizedTiles` uses, so the pins are computed, not transcribed; the slide
 * itself stays as a knob, and the block keeps proving it still works.
 */
const U_RELEASE: KeyGateProfile = {
  ...U_FIELD,
  bandSin: ULTRA.shadowReleaseBandSin,
  gateSin:
    Math.max(ULTRA.shadowReleaseStartSin, ULTRA.shadowGateSin + ULTRA.shadowReleaseBandSin) -
    ULTRA.shadowReleaseBandSin,
};

/** The (b) band, rebuilt from its ruled value so the knob's behaviour stays pinned. */
const U_RELEASE_B: KeyGateProfile = {
  ...U_FIELD,
  bandSin: ULTRA.shadowReleaseBandSin,
  gateSin:
    Math.max(0.00349, ULTRA.shadowGateSin + ULTRA.shadowReleaseBandSin) -
    ULTRA.shadowReleaseBandSin,
};

describe("T100 — the chip's field release band (ruling b, superseded by ruling a)", () => {
  const deg = (v: number) => (Math.asin(v) * 180) / Math.PI;

  it("SHIPS at its identity: the band is back on the disc, −0.30° down to the gate", () => {
    expect(ULTRA.shadowReleaseStartSin).toBe(ULTRA.shadowGateSin + ULTRA.shadowFadeBandSin);
    expect(ULTRA.shadowReleaseBandSin).toBe(ULTRA.shadowFadeBandSin);
    expect(U_RELEASE.gateSin).toBe(U_FIELD.gateSin); // digit for digit — the clamp's identity
    expect(deg(U_RELEASE.gateSin + U_RELEASE.bandSin)).toBeCloseTo(-0.3, 2); // the top
    expect(deg(U_RELEASE.gateSin)).toBeCloseTo(-0.8333, 3); // the zero — true sunset
    for (const d of [1, 0.5, 0.2, 0, -0.14, -0.3, -0.5, -0.8333, -1]) {
      expect(aboveGateK(sinDeg(d), U_RELEASE)).toBe(aboveGateK(sinDeg(d), U_FIELD));
    }
  });

  it("…which keeps the FIELD full at every rung the overlay's tail has to hold (the shader product)", () => {
    // `opacity × (1 − (1 − field)³)`: with the field ≥ 0.63 at −0.5° the overlay's tail delivers
    // ≥ 95 % of itself there; on the (b) band the field was 0 at −0.5° and the tail would have
    // delivered nothing (the −0.5° rung read the bare composite on every arm of §17.2).
    expect(aboveGateK(sinDeg(-0.14), U_RELEASE)).toBe(1);
    expect(aboveGateK(sinDeg(-0.5), U_RELEASE)).toBeGreaterThan(0.6);
    expect(aboveGateK(sinDeg(-0.5), U_RELEASE_B)).toBe(0);
    const g3 = (f: number) => 1 - Math.pow(1 - f, 3);
    expect(g3(aboveGateK(sinDeg(-0.5), U_RELEASE))).toBeGreaterThan(0.95);
  });

  it("the (b) knob still works when asked for: +0.2°, the disc-wide width, a zero above the gate", () => {
    expect(deg(U_RELEASE_B.gateSin + U_RELEASE_B.bandSin)).toBeCloseTo(0.2, 2);
    expect(deg(U_RELEASE_B.gateSin)).toBeCloseTo(-0.333, 2);
    expect(U_RELEASE_B.gateSin).toBeGreaterThan(ULTRA.shadowGateSin);
    expect(aboveGateK(ULTRA.shadowGateSin, U_RELEASE_B)).toBe(0);
    const k0 = aboveGateK(sinDeg(0), U_RELEASE_B);
    const k14 = aboveGateK(sinDeg(-0.14), U_RELEASE_B);
    expect(k0).toBeGreaterThan(0.6);
    expect(k0).toBeLessThan(0.75);
    expect(k14).toBeGreaterThan(0.25);
    expect(k14).toBeLessThan(0.35);
  });

  it("is ZERO at and below the rig's gate — the direction teleport still happens at no contribution", () => {
    for (const p of [U_RELEASE, U_RELEASE_B]) {
      expect(aboveGateK(ULTRA.shadowGateSin, p)).toBe(0);
      expect(aboveGateK(sinDeg(-0.9), p)).toBe(0);
      expect(aboveGateK(sinDeg(-1.5), p)).toBe(0);
    }
  });

  it("a start at or below the gate-anchored top restores ULTRA_SHADOW_GATE digit for digit", () => {
    for (const start of [ULTRA.shadowGateSin + ULTRA.shadowFadeBandSin, ULTRA.shadowGateSin, -1]) {
      const restored: KeyGateProfile = {
        ...U_FIELD,
        bandSin: ULTRA.shadowReleaseBandSin,
        gateSin:
          Math.max(start, ULTRA.shadowGateSin + ULTRA.shadowReleaseBandSin) -
          ULTRA.shadowReleaseBandSin,
      };
      expect(restored.gateSin).toBe(U_FIELD.gateSin);
      for (const d of [1, 0, -0.14, -0.3, -0.5, -0.8333, -1]) {
        expect(aboveGateK(sinDeg(d), restored)).toBe(aboveGateK(sinDeg(d), U_FIELD));
      }
    }
  });

  it("never STEPS either — the RC2 scrub on the slid band", () => {
    let prev = aboveGateK(sinDeg(6), U_RELEASE_B);
    let worst = 0;
    for (let d = 6; d >= -6; d -= 1 / 3600) {
      const now = aboveGateK(sinDeg(d), U_RELEASE_B);
      worst = Math.max(worst, Math.abs(now - prev));
      prev = now;
    }
    expect(worst).toBeLessThan(5e-3);
  });
});
