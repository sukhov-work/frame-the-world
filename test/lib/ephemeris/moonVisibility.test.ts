import { describe, expect, it } from "vitest";
import {
  contrastThreshold,
  DANJON_LIMIT_DEG,
  extinctionMagPerAirmass,
  moonApparentMag,
  moonTransmittance,
  moonVisibility,
  moonVisibilityAt,
  skyLuminanceAt,
} from "../../../src/lib/ephemeris/moonVisibility";
import { moonPhaseIntensity } from "../../../src/lib/ephemeris/moonlight";

/**
 * T200 — the moon's perceived visibility (owner 2026-10-25e). The anchors are the sourced
 * numbers in the module header (K&S 1991 · Kasten–Young 1989 · Schaefer 1998 · Patat 2006 ·
 * Crumey 2014); the worked cases are the planner's own questions.
 */
describe("moonApparentMag — K&S 1991 eq. 9 + the opposition surge + distance", () => {
  it("the polynomial's anchors (mean distance)", () => {
    expect(moonApparentMag(90)).toBeCloseTo(-10.13, 1); // quarter
    expect(moonApparentMag(30)).toBeCloseTo(-11.95, 1);
    expect(moonApparentMag(150)).toBeCloseTo(-6.8, 1);
  });
  it("full moon carries the surge: brighter than the bare −12.73, by ≤ 35 %", () => {
    const m0 = moonApparentMag(0);
    expect(m0).toBeLessThan(-12.73);
    expect(m0).toBeGreaterThan(-12.73 - 2.5 * Math.log10(1.351));
    expect(moonApparentMag(7)).toBeCloseTo(-12.73 + 0.026 * 7 + 4e-9 * 7 ** 4, 6); // the ramp ends
  });
  it("agrees with moonPhaseIntensity (the renderer's K&S curve) outside the surge", () => {
    for (const a of [10, 45, 90, 135, 170]) {
      const flux = 10 ** (-0.4 * (moonApparentMag(a) - -12.73));
      expect(flux).toBeCloseTo(moonPhaseIntensity(a), 6);
    }
  });
  it("a quarter moon is ~11× dimmer than full (not 50 %)", () => {
    const ratio = 10 ** (0.4 * (moonApparentMag(90) - (-12.73)));
    expect(ratio).toBeGreaterThan(10);
    expect(ratio).toBeLessThan(12);
  });
  it("distance is inverse-square: perigee brighter, apogee dimmer", () => {
    expect(moonApparentMag(0, 356_500)).toBeLessThan(moonApparentMag(0));
    expect(moonApparentMag(0, 406_700)).toBeGreaterThan(moonApparentMag(0));
    expect(moonApparentMag(0, 406_700) - moonApparentMag(0, 356_500)).toBeCloseTo(
      5 * Math.log10(406_700 / 356_500),
      6,
    );
  });
});

describe("extinction — Schaefer 1998 at sea level, Kasten–Young airmass", () => {
  it("sea-level totals: blue loses most (B 0.368 · G 0.238 · R 0.155 mag/airmass)", () => {
    const [r, g, b] = extinctionMagPerAirmass(0);
    expect(r).toBeCloseTo(0.156, 2);
    expect(g).toBeCloseTo(0.238, 2);
    expect(b).toBeCloseTo(0.368, 2);
  });
  it("a high site thins the air (Rayleigh e^(−h/8200), aerosol e^(−h/1500))", () => {
    const sea = extinctionMagPerAirmass(0);
    const alt = extinctionMagPerAirmass(2_800); // Mauna Kea-ish: K&S measured 0.12–0.17 in V
    expect(alt[1]).toBeLessThan(sea[1]);
    expect(alt[1]).toBeGreaterThan(0.1);
    expect(alt[1]).toBeLessThan(0.18);
  });
  it("airmass and loss at the table's rungs (zenith 1.0 · 30° 2.0 · 10° 5.6 · 5° 10.3)", () => {
    expect(moonTransmittance(90).airmass).toBeCloseTo(1, 2);
    expect(moonTransmittance(30).airmass).toBeCloseTo(1.99, 1);
    expect(moonTransmittance(10).airmass).toBeCloseTo(5.59, 1);
    expect(moonTransmittance(5).airmass).toBeCloseTo(10.3, 0);
    // ~1.3 mag lost in V at 10°
    const t10 = moonTransmittance(10).transmittance[1];
    expect(-2.5 * Math.log10(t10)).toBeCloseTo(1.33, 1);
  });
  it("reddens monotonically toward the horizon: blue/red falls, red stays the peak", () => {
    let prevBg = 2;
    for (const alt of [80, 60, 40, 30, 20, 10, 5, 2, 0]) {
      const t = moonTransmittance(alt).transmittance;
      expect(t[0]).toBeGreaterThanOrEqual(t[1]);
      expect(t[1]).toBeGreaterThanOrEqual(t[2]);
      const bg = t[2] / t[0];
      expect(bg).toBeLessThanOrEqual(prevBg);
      prevBg = bg;
    }
    // at 10° the moon is orange: the blue channel is about a third of the red
    const t = moonTransmittance(10).transmittance;
    expect(t[2] / t[0]).toBeGreaterThan(0.25);
    expect(t[2] / t[0]).toBeLessThan(0.45);
  });
});

describe("skyLuminanceAt — the twilight ladder", () => {
  it("spans the ~10⁷ dynamic range and is monotone in the sun's altitude", () => {
    expect(skyLuminanceAt(60)).toBeGreaterThan(5_000);
    expect(skyLuminanceAt(-18)).toBeLessThan(3e-4);
    let prev = Infinity;
    for (let a = 70; a >= -25; a -= 1) {
      const v = skyLuminanceAt(a);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it("Patat 2006's rungs: −5° ≈ 1–2 cd/m² · −10° ≈ 0.01 · −15° ≈ 3e−4", () => {
    expect(skyLuminanceAt(-5)).toBeGreaterThan(0.8);
    expect(skyLuminanceAt(-5)).toBeLessThan(2.5);
    expect(skyLuminanceAt(-10)).toBeGreaterThan(0.005);
    expect(skyLuminanceAt(-10)).toBeLessThan(0.02);
    expect(skyLuminanceAt(-15)).toBeCloseTo(3.3e-4, 4);
  });
  it("1 mag per degree through civil and nautical twilight (Schaefer 1998)", () => {
    const ratio = skyLuminanceAt(-3) / skyLuminanceAt(-6);
    expect(Math.abs(2.5 * Math.log10(ratio) / 3 - 1)).toBeLessThan(0.15);
  });
});

describe("contrastThreshold — Crumey 2014 / Blackwell 1946", () => {
  it("photopic floor × the field factor by day; rises as the sky darkens; thin crescents pay more", () => {
    expect(contrastThreshold(3000, 0)).toBeCloseTo(2.72e-3 * 2.5, 6);
    expect(contrastThreshold(0.01, 0)).toBeGreaterThan(contrastThreshold(3000, 0));
    expect(contrastThreshold(3000, 160)).toBeCloseTo(2.72e-3 * 2.5 * 3, 6);
  });
});

describe("moonVisibility — the planner's questions", () => {
  it("a full moon at 21° on a night sky is BRIGHT", () => {
    const v = moonVisibility({ phaseAngleDeg: 4, moonAltDeg: 21, sunAltDeg: -23 });
    expect(v.verdict).toBe("bright");
    expect(v.label).toBe("BRIGHT");
    expect(v.sky).toBe("night");
    expect(v.contrast).toBeGreaterThan(1e5);
  });
  it("the full moon 8° up in the east at civil dusk (the owner's 2026-10-25 evening) is still bright, but low in haze and orange", () => {
    const v = moonVisibility({ phaseAngleDeg: 8.5, moonAltDeg: 8.4, sunAltDeg: -2.8 });
    expect(v.verdict).toBe("bright");
    expect(v.reason).toMatch(/civil twilight/);
    expect(v.reason).toMatch(/low in haze/);
    expect(v.extinctionMag).toBeGreaterThan(1.2);
    expect(v.tint[2]).toBeLessThan(0.5); // blue well under red
  });
  it("a last-quarter moon 33° up under a +24° sun is PALE — visible, washed", () => {
    const v = moonVisibility({ phaseAngleDeg: 94, moonAltDeg: 33, sunAltDeg: 24 });
    expect(v.verdict).toBe("pale");
    expect(v.sky).toBe("day");
    expect(v.contrast).toBeGreaterThan(0.05);
    expect(v.contrast).toBeLessThan(1);
    expect(v.reason).toMatch(/daylight/);
  });
  it("a young crescent (α 160°) at −3° is CLEAR; at −6° it goes bright", () => {
    const dusk = moonVisibility({ phaseAngleDeg: 160, moonAltDeg: 12, sunAltDeg: -3 });
    expect(["clear", "bright"]).toContain(dusk.verdict);
    expect(dusk.reason).toMatch(/thin crescent/);
    const later = moonVisibility({ phaseAngleDeg: 160, moonAltDeg: 8, sunAltDeg: -6 });
    expect(later.score).toBeGreaterThan(dusk.score);
  });
  it("a crescent (α 150°) with the sun still up at 5° is faint or lost — it sits in daylight", () => {
    const v = moonVisibility({ phaseAngleDeg: 150, moonAltDeg: 20, sunAltDeg: 5 });
    expect(["faint", "lost"]).toContain(v.verdict);
  });
  it("inside the Danjon limit the crescent is NEAR THE SUN whatever the sky", () => {
    const v = moonVisibility({
      phaseAngleDeg: 175,
      moonAltDeg: 10,
      sunAltDeg: -4,
      elongationDeg: DANJON_LIMIT_DEG - 1,
    });
    expect(v.verdict).toBe("sunward");
    expect(v.label).toBe("NEAR THE SUN");
  });
  it("under the horizon is BELOW HORIZON before any photometry", () => {
    const v = moonVisibility({ phaseAngleDeg: 0, moonAltDeg: -2, sunAltDeg: -20 });
    expect(v.verdict).toBe("below");
    expect(v.label).toBe("BELOW HORIZON");
  });
  it("the verdict never improves as the sun rises (monotone in the sky)", () => {
    const order = ["below", "sunward", "lost", "faint", "pale", "clear", "bright"];
    let prevScore = Infinity;
    let prevVerdict = "bright";
    for (let sun = -20; sun <= 40; sun += 2) {
      const v = moonVisibility({ phaseAngleDeg: 60, moonAltDeg: 35, sunAltDeg: sun });
      expect(v.score).toBeLessThanOrEqual(prevScore + 1e-9);
      expect(order.indexOf(v.verdict)).toBeLessThanOrEqual(order.indexOf(prevVerdict));
      prevScore = v.score;
      prevVerdict = v.verdict;
    }
  });
  it("the observed magnitude only gets fainter toward the horizon; the tint only warmer", () => {
    let prevMag = -Infinity;
    let prevB = 2;
    for (const alt of [70, 45, 30, 20, 12, 8, 5, 3, 1, 0]) {
      const v = moonVisibility({ phaseAngleDeg: 20, moonAltDeg: alt, sunAltDeg: -15 });
      expect(v.observedMag).toBeGreaterThanOrEqual(prevMag);
      expect(v.tint[2]).toBeLessThanOrEqual(prevB);
      prevMag = v.observedMag;
      prevB = v.tint[2];
    }
  });
  it("the lit area's luminance follows the phase law over the lit fraction (crescent sliver dimmer per area)", () => {
    const full = moonVisibility({ phaseAngleDeg: 0, moonAltDeg: 90, sunAltDeg: -30 });
    const quarter = moonVisibility({ phaseAngleDeg: 90, moonAltDeg: 90, sunAltDeg: -30 });
    const crescent = moonVisibility({ phaseAngleDeg: 150, moonAltDeg: 90, sunAltDeg: -30 });
    expect(full.moonLuminance).toBeGreaterThan(3_000); // ~3.9e3 at the zenith after extinction (+ the surge)
    expect(full.moonLuminance).toBeLessThan(6_000);
    expect(quarter.moonLuminance / full.moonLuminance).toBeGreaterThan(0.12);
    expect(quarter.moonLuminance / full.moonLuminance).toBeLessThan(0.2);
    expect(crescent.moonLuminance).toBeLessThan(quarter.moonLuminance);
    expect(crescent.moonLuminance).toBeGreaterThan(150);
  });
  it("an eclipse dims the lit area (the umbra's 0.055) and can turn a night moon pale", () => {
    const v = moonVisibility({ phaseAngleDeg: 1, moonAltDeg: 40, sunAltDeg: -30, eclipseDim: 0.055 });
    expect(v.moonLuminance).toBeLessThan(400);
    expect(v.verdict).toBe("bright"); // still far over a dark sky — the eye sees the copper disc
  });
});

describe("moonVisibilityAt — the real sky over Dnipro", () => {
  const DNIPRO = { lat: 48.464627, lon: 35.064907 };
  it("2026-10-25 16:45 local: the full moon rising at civil dusk — bright, low in haze", () => {
    const v = moonVisibilityAt(Date.UTC(2026, 9, 25, 14, 45), DNIPRO.lat, DNIPRO.lon);
    expect(v.verdict).toBe("bright");
    expect(v.reason).toMatch(/low in haze/);
    expect(v.illuminatedFraction).toBeGreaterThan(0.98);
  });
  it("2026-11-02 10:00 local: the last quarter high in a morning sky — pale", () => {
    const v = moonVisibilityAt(Date.UTC(2026, 10, 2, 8, 0), DNIPRO.lat, DNIPRO.lon);
    expect(v.verdict).toBe("pale");
    expect(v.sky).toBe("day");
  });
  it("2026-10-28 13:00Z: the moon is under the horizon", () => {
    const v = moonVisibilityAt(Date.UTC(2026, 9, 28, 11, 0), DNIPRO.lat, DNIPRO.lon);
    expect(v.verdict).toBe("below");
  });
});
