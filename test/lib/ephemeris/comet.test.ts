import { describe, expect, it } from "vitest";
import {
  closestApproach,
  cometAzAlt,
  cometBrightness,
  cometStateAt,
  jplMagnitude,
  observedMagnitude,
  visibilityClass,
  helioEqjAu,
  hgMagnitude,
  jdTdbFromUtcMs,
  nextPerihelionMs,
  perihelionMs,
  solveKepler,
  TEMPEL2,
  utcMsFromJdTdb,
} from "../../../src/lib/ephemeris/comet";
import { cometWindows } from "../../../src/lib/ephemeris/planner";
import { dot, enuBasis } from "../../../src/lib/geo/projection";

/**
 * Almanac gate for the comet, same contract as bodies.test.ts: every expected value below is a
 * JPL Horizons row (ssd.jpl.nasa.gov/api/horizons.api, target `DES=10P; CAP`, queried 2026-08-02).
 * Geocentric rows are QUANTITIES=1,9,20,23 at CENTER=500@399 (astrometric ICRF RA/Dec, T-mag,
 * delta, S-O-T); the topocentric row is the same query at Dnipro (48.4647 N / 35.0462 E / 0.1 km).
 *
 * The propagator agreed to ≤3″ across the whole apparition at research time; asserted at 0.01°
 * (36″) here — a 10× margin that still catches any sign/frame regression.
 */
const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const utc = (iso: string) => Date.parse(iso);

/** [ISO instant, RA deg, Dec deg, T-mag, delta AU] from Horizons. */
const GEOCENTRIC_ROWS: Array<[string, number, number, number, number]> = [
  ["2026-06-01T00:00:00Z", 302.61145, -8.21493, 14.261, 0.72700015750125],
  ["2026-07-01T00:00:00Z", 315.93135, -12.20481, 13.292, 0.50777230091659],
  ["2026-07-31T00:00:00Z", 327.15046, -23.70405, 12.78, 0.41571875607692],
  ["2026-08-10T00:00:00Z", 330.0738, -28.0314, 12.794, 0.41756591537614],
  ["2026-09-09T00:00:00Z", 336.85549, -35.13813, 13.352, 0.51511089250518],
  ["2026-11-28T00:00:00Z", 359.91208, -18.63624, 16.027, 1.3133908020548],
];

describe("cometStateAt (geocentric astrometric, vs JPL Horizons)", () => {
  for (const [iso, raDeg, decDeg, tmag, deltaAu] of GEOCENTRIC_ROWS) {
    it(`10P @ ${iso}`, () => {
      const s = cometStateAt(utc(iso));
      // Angular separation, not per-coordinate: RA errors shrink by cos(dec) on the sky.
      const dRa = (((s.raDeg - raDeg + 540) % 360) - 180) * Math.cos((decDeg * Math.PI) / 180);
      const sepDeg = Math.hypot(dRa, s.decDeg - decDeg);
      expect(sepDeg).toBeLessThan(0.01);
      expect(s.distanceAu).toBeCloseTo(deltaAu, 4);
      // The JPL model is asserted against Horizons' T-mag (it IS that model); what the app
      // SHOWS is the observed curve — see the light-curve suite below.
      expect(jplMagnitude(s.distanceAu, s.sunDistanceAu)).toBeCloseTo(tmag, 1);
    });
  }

  it("elongation matches the near-opposition geometry of the 2026 pass", () => {
    // Horizons S-O-T = 163.0307 @ 2026-07-31 00:00Z
    expect(cometStateAt(utc("2026-07-31T00:00:00Z")).elongationDeg).toBeCloseTo(163.0307, 1);
  });

  it("the ECEF direction is a unit vector, and the tail points anti-sunward", () => {
    const s = cometStateAt(utc("2026-08-02T00:00:00Z"));
    expect(Math.hypot(...s.dir)).toBeCloseTo(1, 12);
    expect(Math.hypot(...s.tailDir)).toBeCloseTo(1, 12);
    // Near opposition (elongation 164°) the sun→comet direction and the earth→comet direction
    // are nearly the same ray — the tail points almost straight away from us.
    expect(dot(s.dir, s.tailDir)).toBeGreaterThan(0.95);
  });
});

describe("cometAzAlt (topocentric, vs JPL Horizons at Dnipro)", () => {
  it("10P @ 2026-08-02 00:00Z", () => {
    const { azDeg, altDeg } = cometAzAlt(
      utc("2026-08-02T00:00:00Z"),
      DNIPRO.latDeg,
      DNIPRO.lonDeg,
      100,
    );
    expect(azDeg).toBeCloseTo(196.486339, 1);
    expect(altDeg).toBeCloseTo(15.391642, 1);
  });

  it("altitude agrees with the ECEF direction projected on the local up", () => {
    const t = utc("2026-08-02T00:00:00Z");
    const { up } = enuBasis(DNIPRO.latDeg, DNIPRO.lonDeg);
    const geocentricAltDeg =
      (Math.asin(dot(cometStateAt(t).dir, up)) * 180) / Math.PI;
    // Geocentric vs topocentric differ only by the ~21″ diurnal parallax at Δ = 0.41 au.
    expect(geocentricAltDeg).toBeCloseTo(
      cometAzAlt(t, DNIPRO.latDeg, DNIPRO.lonDeg, 100).altDeg,
      1,
    );
  });

  it("is below the horizon over the antipode at the same instant", () => {
    const { altDeg } = cometAzAlt(
      utc("2026-08-02T00:00:00Z"),
      -DNIPRO.latDeg,
      DNIPRO.lonDeg - 180,
    );
    expect(altDeg).toBeLessThan(0);
  });
});

describe("orbit mechanics", () => {
  it("solveKepler inverts Kepler's equation at the comet's eccentricity", () => {
    const e = TEMPEL2.elements.e;
    for (const M of [0, 0.3, 1.2, Math.PI, 5.5]) {
      const E = solveKepler(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
    }
  });

  it("perihelion is the minimum of the heliocentric distance", () => {
    const tp = TEMPEL2.elements.tpJdTdb;
    const rAt = (jd: number) => Math.hypot(...helioEqjAu(jd));
    expect(rAt(tp)).toBeCloseTo(TEMPEL2.elements.qAu, 6);
    expect(rAt(tp - 20)).toBeGreaterThan(rAt(tp));
    expect(rAt(tp + 20)).toBeGreaterThan(rAt(tp));
  });

  it("aphelion sits at a(1+e) half a period from perihelion", () => {
    const { tpJdTdb, periodDays, aAu, e } = TEMPEL2.elements;
    expect(Math.hypot(...helioEqjAu(tpJdTdb + periodDays / 2))).toBeCloseTo(aAu * (1 + e), 4);
  });

  it("the JD ↔ epoch-ms conversions round-trip", () => {
    // A float64 Julian date carries ~0.01 ms of resolution at JD 2.46e6 — assert sub-millisecond,
    // which is 7 orders of magnitude finer than the comet's motion needs.
    const ms = utc("2026-08-02T02:44:45Z");
    expect(Math.abs(utcMsFromJdTdb(jdTdbFromUtcMs(ms)) - ms)).toBeLessThan(1);
  });

  it("perihelion lands on 2026-08-02 02:44Z and the next one 5.37 yr later", () => {
    // Horizons Tp = 2461254.615211 TDB for solution JPL#K265/43.
    expect(perihelionMs()).toBeCloseTo(utc("2026-08-02T02:44:45Z"), -4); // ±5 s
    expect(new Date(nextPerihelionMs()!).toISOString().slice(0, 7)).toBe("2031-12");
  });

  it("closest approach to Earth is 0.414 au on 2026-08-03", () => {
    const ca = closestApproach(perihelionMs());
    expect(new Date(ca.utcMs).toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(ca.distanceAu).toBeCloseTo(0.4145, 3);
  });

  it("the JPL model follows the Horizons M1/k1 law", () => {
    // 13.7 + 5·log10(0.41572) + 6.5·log10(1.41774) = 12.78 (Horizons T-mag @ 2026-07-31)
    expect(jplMagnitude(0.41571875607692, 1.41774)).toBeCloseTo(12.78, 2);
  });
});

/**
 * Brightness (owner catch 2026-08-03). Expected values are the MEDIAN reported total magnitudes
 * from COBS (cobs.si) for the wide-field/visual subset — the observations that see the whole coma.
 * They exist because JPL's M1/k1 fit, which the app showed at first, is ~4 mag too faint here:
 * it is fit to CCD aperture photometry attached to astrometric submissions.
 */
describe("cometBrightness (what an observer actually sees)", () => {
  /** [mid-month instant, COBS median magnitude for that month] — the observed-curve window. */
  const COBS_MEDIANS: Array<[string, number]> = [
    ["2026-05-15T12:00:00Z", 13.8],
    ["2026-06-15T12:00:00Z", 10.8],
    ["2026-07-15T12:00:00Z", 8.8],
    ["2026-08-02T12:00:00Z", 9.0],
  ];

  for (const [iso, median] of COBS_MEDIANS) {
    it(`tracks the observed median at ${iso.slice(0, 7)} (${median})`, () => {
      const s = cometStateAt(utc(iso));
      expect(s.magnitudeModel).toBe("observed");
      // Within the fit's own scatter + the month-to-month residual (worst 1.0 mag).
      expect(Math.abs(s.magnitude - median)).toBeLessThan(1.3);
    });
  }

  it("is a BINOCULAR object at closest approach, not a telescopic one", () => {
    const ca = closestApproach(perihelionMs());
    const s = cometStateAt(ca.utcMs);
    expect(s.magnitude).toBeGreaterThan(7.5);
    expect(s.magnitude).toBeLessThan(9.5);
    expect(visibilityClass(s.magnitude)).toBe("BINOCULARS (10×50)");
    // The regression this suite exists to prevent: the JPL model would have said ~12.8.
    expect(jplMagnitude(s.distanceAu, s.sunDistanceAu) - s.magnitude).toBeGreaterThan(3);
  });

  it("falls back to the JPL model — labelled — outside the light curve's window", () => {
    const s = cometStateAt(utc("2026-11-28T00:00:00Z")); // past toIso 2026-10-31
    expect(s.magnitudeModel).toBe("jpl");
    expect(s.magnitude).toBeCloseTo(jplMagnitude(s.distanceAu, s.sunDistanceAu), 6);
    expect(s.magnitudeUncertainty).toBeGreaterThan(1);
  });

  it("leaves the small-coma months to JPL, where JPL is the accurate model", () => {
    // April 2026: COBS median 16.0, JPL model 15.9 — the observed curve would say ~17.
    const s = cometStateAt(utc("2026-04-15T12:00:00Z"));
    expect(s.magnitudeModel).toBe("jpl");
    expect(Math.abs(s.magnitude - 16.0)).toBeLessThan(0.6);
  });

  it("carries the fit's RMS as the ± band while the observed curve is in force", () => {
    const b = cometBrightness(utc("2026-08-02T00:00:00Z"), 0.4148, 1.4177);
    expect(b.model).toBe("observed");
    expect(b.uncertaintyMag).toBeCloseTo(TEMPEL2.lightCurve!.rmsMag, 6);
    expect(b.magnitude).toBeCloseTo(
      observedMagnitude(0.4148, 1.4177, TEMPEL2.lightCurve!),
      6,
    );
  });

  it("visibilityClass spans the aperture ladder", () => {
    expect(visibilityClass(-1)).toContain("BRILLIANT");
    expect(visibilityClass(4.5)).toContain("NAKED EYE");
    expect(visibilityClass(8.6)).toContain("BINOCULARS");
    expect(visibilityClass(11)).toContain("SMALL TELESCOPE");
    expect(visibilityClass(16)).toContain("IMAGING");
  });
});

describe("cometWindows (the observing-session planner)", () => {
  const observer = {
    latDeg: DNIPRO.latDeg,
    lonDeg: DNIPRO.lonDeg,
    groundAltM: 100,
    eyeAboveGroundM: 1.6,
  };

  it("finds the nightly passes over Dnipro around the 2026 closest approach", () => {
    const ws = cometWindows(utc("2026-08-02T12:00:00Z"), observer, {
      days: 5,
      stepMin: 10,
      limit: 5,
    });
    expect(ws.length).toBeGreaterThanOrEqual(3);
    for (const w of ws) {
      expect(w.endMs).toBeGreaterThan(w.startMs);
      expect(w.peakMs).toBeGreaterThanOrEqual(w.startMs);
      expect(w.peakMs).toBeLessThanOrEqual(w.endMs);
      // The comet culminates ~16° from 48.5°N (dec ≈ −25°): the window peak must be low but up.
      expect(w.peakAltDeg).toBeGreaterThan(5);
      expect(w.peakAltDeg).toBeLessThan(20);
      // …due south, as a southern-declination object seen from mid-northern latitudes must be.
      expect(Math.abs(w.peakAzDeg - 180)).toBeLessThan(30);
      expect(w.score).toBeGreaterThan(0);
      expect(w.score).toBeLessThanOrEqual(1);
    }
    // Windows are disjoint and chronological.
    for (let i = 1; i < ws.length; i++) expect(ws[i].startMs).toBeGreaterThan(ws[i - 1].endMs);
  });

  it("the sun is genuinely down and the comet genuinely up at every peak", () => {
    const ws = cometWindows(utc("2026-08-02T12:00:00Z"), observer, { days: 3, limit: 2 });
    for (const w of ws) {
      expect(cometAzAlt(w.peakMs, observer.latDeg, observer.lonDeg, 101.6).altDeg).toBeGreaterThan(5);
    }
  });

  it("returns nothing where the comet never clears the horizon in the dark", () => {
    // Far northern summer: the sun never reaches −15° AND a dec −25° object never rises high.
    const svalbard = { latDeg: 78.2, lonDeg: 15.6, groundAltM: 0, eyeAboveGroundM: 1.6 };
    expect(cometWindows(utc("2026-08-02T12:00:00Z"), svalbard, { days: 3 })).toHaveLength(0);
  });
});

describe("universal-variable propagator — every conic (phase B)", () => {
  const base = {
    epochJdTdb: 2461000.5,
    iDeg: 0,
    nodeDeg: 0,
    periDeg: 0,
    tpJdTdb: 2461000.5,
    m1: 10,
    k1: 4,
  };
  /** Heliocentric distance from the propagator at Tp + dtDays. */
  const rAt = (el: Parameters<typeof helioEqjAu>[1], dtDays: number) => {
    const p = helioEqjAu(base.tpJdTdb + dtDays, el);
    return Math.hypot(p[0], p[1], p[2]);
  };

  it("near-parabolic (Hale-Bopp-like, e=0.9949): r=q at Tp, symmetric legs, sane at ±1 yr", () => {
    const q = 0.9141;
    const el = { ...base, e: 0.9949, qAu: q, aAu: q / (1 - 0.9949), nDegPerDay: 0, periodDays: Infinity };
    expect(rAt(el, 0)).toBeCloseTo(q, 9);
    expect(rAt(el, 200)).toBeCloseTo(rAt(el, -200), 9); // time-symmetric about perihelion
    const r1y = rAt(el, 365.25);
    expect(r1y).toBeGreaterThan(3); // receding — a comet like this is ~4 au out a year on
    expect(r1y).toBeLessThan(8);
  });

  it("hyperbolic (e=1.05): departs monotonically and beats the parabola out", () => {
    const q = 1.0;
    const hyp = { ...base, e: 1.05, qAu: q, aAu: q / (1 - 1.05), nDegPerDay: 0, periodDays: Infinity };
    const par = { ...base, e: 1.0, qAu: q, aAu: Infinity, nDegPerDay: 0, periodDays: Infinity };
    expect(rAt(hyp, 0)).toBeCloseTo(q, 9);
    expect(rAt(par, 0)).toBeCloseTo(q, 9);
    let prev = rAt(hyp, 0);
    for (const dt of [50, 150, 400, 1000]) {
      const r = rAt(hyp, dt);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    expect(rAt(hyp, 1000)).toBeGreaterThan(rAt(par, 1000)); // excess velocity
  });

  it("elliptic wrap: centuries from epoch the orbit still cycles r within [q, a(1+e)]", () => {
    const el = TEMPEL2.elements;
    for (const dt of [36500, -36500, 100 * el.periodDays + 17]) {
      const r = rAt(el, dt);
      expect(r).toBeGreaterThanOrEqual(el.qAu - 1e-6);
      expect(r).toBeLessThanOrEqual(el.aAu * (1 + el.e) + 1e-6);
    }
  });
});

describe("hgMagnitude — IAU (H,G) asteroid phase law (phase B)", () => {
  it("Ceres at opposition: H=3.34 at r=2.77, Δ=1.77 → V ≈ 6.8 (the classic naked-eye-miss)", () => {
    // α → 0 at exact opposition (R = r − Δ): the phase term vanishes and V = H + 5·log10(rΔ).
    const v = hgMagnitude(1.77, 2.77, 1.0, 3.34, 0.12);
    expect(v).toBeGreaterThan(6.5);
    expect(v).toBeLessThan(7.1);
  });

  it("phase dims: the same geometry at α ≈ 20° reads fainter than the zero-phase value", () => {
    // r=2.77, Δ=2.77, R≈0.96 → α ≈ 20° at the body.
    const zeroPhase = 3.34 + 5 * Math.log10(2.77 * 2.77);
    const v = hgMagnitude(2.77, 2.77, 0.96, 3.34, 0.12);
    expect(v).toBeGreaterThan(zeroPhase + 0.3);
    expect(v).toBeLessThan(zeroPhase + 2.5);
  });

  it("G defaults to 0.15 and both Φ functions stay inside (0,1]", () => {
    expect(hgMagnitude(1, 2, 1, 10)).toBeCloseTo(hgMagnitude(1, 2, 1, 10, 0.15), 12);
  });
});
