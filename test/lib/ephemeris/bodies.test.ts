import { describe, expect, it } from "vitest";
import {
  angularRadiusRad,
  bodyStatesAt,
  horizontal,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../../../src/lib/ephemeris/bodies";
import { dot, enuBasis } from "../../../src/lib/geo/projection";

/**
 * Almanac gate (IMPLEMENTATION_PLAN §Phase 4): expected values are from the JPL Horizons API
 * (ssd.jpl.nasa.gov/api/horizons.api, apparent AIRLESS az/el, observer Dnipro 48.4647 N /
 * 35.0462 E / h=0; queried 2026-07-10). astronomy-engine agreed to ≤0.0007° at research time;
 * asserted at ±0.05° here (plan tolerance is ±0.5° — we pass with 10× margin).
 */
const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };

describe("horizontal (topocentric az/alt vs JPL Horizons)", () => {
  it("sun @ 2026-06-21 12:00Z over Dnipro", () => {
    const { azDeg, altDeg } = horizontal("sun", Date.UTC(2026, 5, 21, 12, 0, 0), DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(azDeg).toBeCloseTo(239.926195, 1);
    expect(altDeg).toBeCloseTo(52.991281, 1);
  });

  it("sun @ solstice solar noon (2026-06-21 09:40Z) peaks at ~65° over Dnipro", () => {
    const { azDeg, altDeg } = horizontal("sun", Date.UTC(2026, 5, 21, 9, 40, 0), DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(azDeg).toBeCloseTo(179.126684, 1);
    expect(altDeg).toBeCloseTo(64.970179, 1);
  });

  it("moon @ 2026-06-29 21:00Z over Dnipro", () => {
    const { azDeg, altDeg } = horizontal("moon", Date.UTC(2026, 5, 29, 21, 0, 0), DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(azDeg).toBeCloseTo(171.211895, 1);
    expect(altDeg).toBeCloseTo(12.777505, 1);
  });
});

describe("bodyStatesAt (ECEF directions the scene consumes)", () => {
  const t = Date.UTC(2026, 5, 21, 12, 0, 0);

  it("sun ECEF direction agrees with the topocentric az/alt path", () => {
    // Solar parallax is ~0.002° — the geocentric ECEF direction must reproduce the
    // observer az/alt almost exactly when projected on the local ENU basis.
    const { sunDir } = bodyStatesAt(t);
    const { east, north, up } = enuBasis(DNIPRO.latDeg, DNIPRO.lonDeg);
    const altDeg = (Math.asin(dot(sunDir, up)) * 180) / Math.PI;
    const azDeg =
      ((Math.atan2(dot(sunDir, east), dot(sunDir, north)) * 180) / Math.PI + 360) % 360;
    expect(azDeg).toBeCloseTo(239.926195, 1);
    expect(altDeg).toBeCloseTo(52.991281, 1);
  });

  it("subsolar latitude at the June solstice is the Tropic of Cancer (+23.43°)", () => {
    const { sunDir } = bodyStatesAt(t);
    const subsolarLat = (Math.asin(sunDir[2]) * 180) / Math.PI;
    expect(subsolarLat).toBeGreaterThan(23.3);
    expect(subsolarLat).toBeLessThan(23.5);
  });

  it("subsolar latitude at the December solstice is the Tropic of Capricorn (−23.44°)", () => {
    // Unit twin of the browser-verified Dec-21 jump (audit C6 — was browser-tier only).
    const { sunDir } = bodyStatesAt(Date.UTC(2026, 11, 21, 12, 0, 0));
    const subsolarLat = (Math.asin(sunDir[2]) * 180) / Math.PI;
    expect(subsolarLat).toBeLessThan(-23.3);
    expect(subsolarLat).toBeGreaterThan(-23.5);
  });

  it("moon ECEF direction is within topocentric parallax (<1.2°) of the observer view", () => {
    const tm = Date.UTC(2026, 5, 29, 21, 0, 0);
    const { moonDir } = bodyStatesAt(tm);
    const { east, north, up } = enuBasis(DNIPRO.latDeg, DNIPRO.lonDeg);
    const altDeg = (Math.asin(dot(moonDir, up)) * 180) / Math.PI;
    const azDeg =
      ((Math.atan2(dot(moonDir, east), dot(moonDir, north)) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(azDeg - 171.211895)).toBeLessThan(1.2);
    expect(Math.abs(altDeg - 12.777505)).toBeLessThan(1.2);
  });

  it("moon distance, phase angle and illumination near the 2026-07-02 full moon", () => {
    const tm = Date.UTC(2026, 5, 29, 21, 0, 0);
    const s = bodyStatesAt(tm);
    expect(s.moonDistanceKm).toBeGreaterThan(404_000); // geocentric: 405,383 km (Horizons topo 403,917)
    expect(s.moonDistanceKm).toBeLessThan(407_000);
    expect(s.moonPhaseDeg).toBeCloseTo(178.65, 0); // near-full: moon−sun ecliptic longitude ≈ 180°
    expect(s.moonIllumination).toBeCloseTo(0.9986, 2);
  });

  it("sun distance ≈ 1 AU (aphelion side in June/July)", () => {
    const s = bodyStatesAt(t);
    expect(s.sunDistanceAu).toBeGreaterThan(1.0);
    expect(s.sunDistanceAu).toBeLessThan(1.02);
  });
});

describe("angularRadiusRad", () => {
  it("sun ≈ 0.263° and moon ≈ 0.245–0.28° apparent radius", () => {
    const sun = angularRadiusRad(SUN_RADIUS_KM, 1.0161687 * 149_597_870.69);
    expect((sun * 180) / Math.PI).toBeCloseTo(0.262, 2);
    const moon = angularRadiusRad(MOON_RADIUS_KM, 405_383);
    expect((moon * 180) / Math.PI).toBeCloseTo(0.2456, 2);
  });
});
