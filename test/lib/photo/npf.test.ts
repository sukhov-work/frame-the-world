import { describe, expect, it } from "vitest";
import {
  decAtAzAlt,
  maxCosDecInFrame,
  npfFullSec,
  npfSimpleSec,
  rule500Sec,
} from "../../../src/lib/photo/npf";

describe("npfSimpleSec", () => {
  it("matches the MOBILE_PLAN test vector: D850 4.35 µm, 14 mm f/2.8 → ≈ 16.3 s", () => {
    expect(npfSimpleSec(2.8, 14, 4.35)).toBeCloseTo(16.32, 1);
  });
  it("longer focal → shorter exposure", () => {
    expect(npfSimpleSec(2.8, 24, 4.35)).toBeLessThan(npfSimpleSec(2.8, 14, 4.35));
  });
});

describe("npfFullSec", () => {
  it("D850 vector at k=1, equator: (16.856·2.8 + 0.0997·14 + 13.713·4.35)/14 ≈ 7.7 s", () => {
    expect(npfFullSec(2.8, 14, 4.35, 1, 1)).toBeCloseTo(7.73, 1);
  });
  it("declination lengthens the exposure: cos δ = 0.5 doubles it", () => {
    expect(npfFullSec(2.8, 14, 4.35, 0.5, 1)).toBeCloseTo(2 * npfFullSec(2.8, 14, 4.35, 1, 1), 6);
  });
  it("k relaxes linearly", () => {
    expect(npfFullSec(2.8, 14, 4.35, 1, 3)).toBeCloseTo(3 * npfFullSec(2.8, 14, 4.35, 1, 1), 6);
  });
  it("floors cos δ near the pole instead of diverging", () => {
    expect(npfFullSec(2.8, 14, 4.35, 0, 1)).toBe(npfFullSec(2.8, 14, 4.35, 0.05, 1));
  });
});

describe("rule500Sec", () => {
  it("500/(CF·f): 14 mm full-frame ≈ 35.7 s; APS-C 1.5× shortens it", () => {
    expect(rule500Sec(14, 1)).toBeCloseTo(35.71, 1);
    expect(rule500Sec(14, 1.5)).toBeCloseTo(23.81, 1);
  });
});

describe("decAtAzAlt", () => {
  it("due south at altitude a from latitude φ sits at δ = a − (90 − φ)", () => {
    // φ = 48.46°, a = 30° → δ = 30 − 41.54 = −11.54°
    expect(decAtAzAlt(48.46, 180, 30)).toBeCloseTo(30 - (90 - 48.46), 5);
  });
  it("the zenith carries the observer's latitude as declination", () => {
    expect(decAtAzAlt(48.46, 0, 90)).toBeCloseTo(48.46, 5);
  });
  it("the north celestial pole is δ = 90", () => {
    expect(decAtAzAlt(48.46, 0, 48.46)).toBeCloseTo(90, 5);
  });
});

describe("maxCosDecInFrame", () => {
  const base = { fovDeg: 50, aspect: 16 / 9 };
  it("a frame straddling the celestial equator pins cos δ to exactly 1", () => {
    // due south at the equator's altitude (90 − φ) — the equator crosses mid-frame
    const pose = { headingDeg: 180, pitchDeg: 90 - 48.46, ...base };
    expect(maxCosDecInFrame(pose, 48.46)).toBe(1);
  });
  it("a polar frame moves slowly: cos δ well under 1", () => {
    const pose = { headingDeg: 0, pitchDeg: 48.46, fovDeg: 20, aspect: 16 / 9 };
    expect(maxCosDecInFrame(pose, 48.46)).toBeLessThan(0.35);
  });
  it("wider frames reach faster-moving sky: cos δ grows with fov", () => {
    const narrow = maxCosDecInFrame({ headingDeg: 0, pitchDeg: 48.46, fovDeg: 10, aspect: 1 }, 48.46);
    const wide = maxCosDecInFrame({ headingDeg: 0, pitchDeg: 48.46, fovDeg: 60, aspect: 1 }, 48.46);
    expect(wide).toBeGreaterThan(narrow);
  });
});
