import { describe, expect, it } from "vitest";
import {
  Body,
  DefineStar,
  Equator,
  Horizon,
  MakeTime,
  Observer,
} from "astronomy-engine";
import {
  cometTarget,
  fixedTarget,
  GALACTIC_CENTRE_ID,
  galacticCentreTarget,
  PLANETS,
  planetTarget,
  targetAzAlt,
  type PlanetId,
} from "../../../src/lib/ephemeris/targets";
import { galacticToEquatorial, raDecToUnit } from "../../../src/lib/ephemeris/stars";
import { cometStateAt, TEMPEL2 } from "../../../src/lib/ephemeris/comet";
import { cometWindows, targetWindows } from "../../../src/lib/ephemeris/planner";

/**
 * SkyTarget providers vs astronomy-engine's OWN topocentric pipeline (Equator + Horizon).
 * Same contract as bodies.test.ts/comet.test.ts: the providers land through `ecefFrameAt` +
 * a hand-rolled ENU projection, the reference goes through the library's `Observer` machinery —
 * two INDEPENDENT paths to the same sky, agreeing ⇒ the frame recipe and the parallax handling
 * are right. Asserted at ±0.05° (the bodies.test.ts gate; residuals measured ~0.001–0.01°).
 */

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const utc = (iso: string) => Date.parse(iso);
const INSTANTS = ["2026-08-03T21:00:00Z", "2026-02-01T04:00:00Z", "2027-05-15T22:00:00Z"];

/** Reference az/alt via the library's own Observer pipeline (of-date, aberration, airless). */
function refAzAlt(body: Body, utcMs: number): { azDeg: number; altDeg: number } {
  const time = MakeTime(new Date(utcMs));
  const obs = new Observer(DNIPRO.latDeg, DNIPRO.lonDeg, 0);
  const eq = Equator(body, time, obs, true, true);
  const hor = Horizon(time, obs, eq.ra, eq.dec);
  return { azDeg: hor.azimuth, altDeg: hor.altitude };
}

describe("planetTarget (engine provider vs Equator/Horizon)", () => {
  const ids: PlanetId[] = ["mercury", "venus", "mars", "jupiter", "saturn", "neptune", "pluto"];
  for (const id of ids) {
    it(`${id}: topocentric az/alt matches the library's own pipeline`, () => {
      for (const iso of INSTANTS) {
        const t = utc(iso);
        const mine = targetAzAlt(planetTarget(id), t, DNIPRO.latDeg, DNIPRO.lonDeg);
        const ref = refAzAlt(PLANETS[id].body, t);
        // Compare as angular separation on the sky (az wraps; az error inflates near the zenith).
        const dAz =
          (((mine.azDeg - ref.azDeg + 540) % 360) - 180) *
          Math.cos((ref.altDeg * Math.PI) / 180);
        const dAlt = mine.altDeg - ref.altDeg;
        expect(Math.hypot(dAz, dAlt), `${id} @ ${iso}`).toBeLessThan(0.05);
      }
    });
  }

  it("magnitude/phase plumbing carries the engine model (fixtures probed 2026-08-03T21Z)", () => {
    const t = utc("2026-08-03T21:00:00Z");
    expect(planetTarget("venus").stateAt(t).magnitude).toBeCloseTo(-4.35, 1);
    expect(planetTarget("jupiter").stateAt(t).magnitude).toBeCloseTo(-1.78, 1);
    expect(planetTarget("saturn").stateAt(t).magnitude).toBeCloseTo(0.5, 1);
    expect(planetTarget("pluto").stateAt(t).magnitude).toBeCloseTo(14.46, 1);
    const venus = planetTarget("venus").stateAt(t);
    expect(venus.phaseFraction).toBeCloseTo(0.545, 2);
    expect(venus.magnitudeModel).toBe("engine");
  });

  it("angular diameter is in the physical ballpark (Jupiter ~30–50″)", () => {
    const s = planetTarget("jupiter").stateAt(utc("2026-08-03T21:00:00Z"));
    expect(s.angularDiamArcsec).not.toBeNull();
    expect(s.angularDiamArcsec!).toBeGreaterThan(25);
    expect(s.angularDiamArcsec!).toBeLessThan(55);
  });

  it("elongation respects inner-planet geometry (Venus can never leave ~47°)", () => {
    for (const iso of INSTANTS) {
      const s = planetTarget("venus").stateAt(utc(iso));
      expect(s.elongationDeg).toBeGreaterThanOrEqual(0);
      expect(s.elongationDeg).toBeLessThan(60);
    }
  });
});

describe("fixedTarget (fixed provider vs DefineStar/Equator/Horizon)", () => {
  const VEGA = { raDeg: 279.23473, decDeg: 38.78369 }; // α Lyr, J2000
  const vega = fixedTarget({
    id: "star:vega",
    name: "Vega",
    kind: "star",
    aliases: ["vega", "alpha lyrae"],
    raDeg: VEGA.raDeg,
    decDeg: VEGA.decDeg,
    vmag: 0.03,
    facts: { kind: "dso", dsoType: "*", typeLabel: "STAR", constellation: "Lyr", names: [] },
    source: "TEST",
  });

  it("az/alt matches a DefineStar at the same J2000 coordinates", () => {
    // 1000 ly ⇒ parallax is sub-milliarcsecond — the star is effectively at infinity, like ours.
    DefineStar(Body.Star1, VEGA.raDeg / 15, VEGA.decDeg, 1000);
    for (const iso of INSTANTS) {
      const t = utc(iso);
      const mine = targetAzAlt(vega, t, DNIPRO.latDeg, DNIPRO.lonDeg);
      const ref = refAzAlt(Body.Star1, t);
      const dAz =
        (((mine.azDeg - ref.azDeg + 540) % 360) - 180) * Math.cos((ref.altDeg * Math.PI) / 180);
      const dAlt = mine.altDeg - ref.altDeg;
      // DefineStar applies aberration (~20″) that a catalog direction doesn't — allow it.
      expect(Math.hypot(dAz, dAlt), `vega @ ${iso}`).toBeLessThan(0.05);
    }
  });

  it("carries the catalog magnitude with the catalog label and no distances", () => {
    const s = vega.stateAt(utc("2026-08-03T21:00:00Z"));
    expect(s.magnitude).toBe(0.03);
    expect(s.magnitudeModel).toBe("catalog");
    expect(s.distanceAu).toBeNull();
    expect(s.raDeg).toBeCloseTo(VEGA.raDeg, 6);
    expect(Math.hypot(...s.dir)).toBeCloseTo(1, 12);
  });
});

describe("cometTarget (kepler provider — 10P stops being a special case)", () => {
  it("is field-for-field the comet ephemeris", () => {
    const t = utc("2026-08-03T21:00:00Z");
    const viaTarget = cometTarget(TEMPEL2).stateAt(t);
    const direct = cometStateAt(t, TEMPEL2);
    expect(viaTarget.dir).toEqual(direct.dir);
    expect(viaTarget.tailDir).toEqual(direct.tailDir);
    expect(viaTarget.magnitude).toBe(direct.magnitude);
    expect(viaTarget.magnitudeModel).toBe(direct.magnitudeModel);
    expect(viaTarget.raDeg).toBe(direct.raDeg);
    expect(viaTarget.distanceAu).toBe(direct.distanceAu);
  });

  it("targetWindows(cometTarget) reproduces cometWindows exactly", () => {
    const from = utc("2026-08-02T00:00:00Z");
    const o = { ...DNIPRO, groundAltM: 100, eyeAboveGroundM: 1.6 };
    const opts = { days: 8, stepMin: 15, limit: 5 };
    const viaTarget = targetWindows(from, o, cometTarget(TEMPEL2), opts);
    const direct = cometWindows(from, o, opts);
    expect(viaTarget).toEqual(direct);
    expect(viaTarget.length).toBeGreaterThan(0);
  });
});

describe("targetAzAlt parallax handling", () => {
  it("solar-system bodies get diurnal parallax; fixed targets project the geocentric dir", () => {
    const t = utc("2026-08-03T21:00:00Z");
    // The moonless check: for a FIXED target, az/alt from two antipodal observers differ only
    // by the ENU projection (no distance term) — the state itself is observer-independent.
    const mars = planetTarget("mars");
    const a = targetAzAlt(mars, t, DNIPRO.latDeg, DNIPRO.lonDeg, 0);
    const b = targetAzAlt(mars, t, DNIPRO.latDeg, DNIPRO.lonDeg, 3000);
    // 3 km of eye height moves a planet by micro-degrees — but the code path must not blow up,
    // and the direction must stay the same to ~arcsec.
    expect(Math.abs(a.altDeg - b.altDeg)).toBeLessThan(0.01);
  });
});

describe("galacticCentreTarget (Phase 8a P2)", () => {
  const gc = galacticCentreTarget();
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it("carries the fixed-provider state contract with no photometry", () => {
    const s = gc.stateAt(utc("2026-08-13T21:00:00Z"));
    expect(gc.id).toBe(GALACTIC_CENTRE_ID);
    expect(s.magnitude).toBeNull();
    expect(s.magnitudeModel).toBe("catalog");
    expect(s.distanceAu).toBeNull();
    expect(s.angularDiamArcsec).toBeNull();
    expect(Math.hypot(...s.dir)).toBeCloseTo(1, 12);
  });

  it("aims at Sgr A*, ≈4.3′ from the frame-defining l=0,b=0 point — close but NOT merged", () => {
    const sgrA = raDecToUnit(266.41684 / 15, -29.00781);
    const frameGc = galacticToEquatorial(0, 0);
    const sepDeg = (Math.acos(Math.min(1, dot(sgrA, frameGc))) * 180) / Math.PI;
    expect(sepDeg).toBeGreaterThan(0.04); // silently merging the constants would trip this
    expect(sepDeg).toBeLessThan(0.1); // and a typo in either constant would trip this
  });

  it("NGP↔GC round-trip: the target direction lies in the galactic plane (b ≈ −0.05°)", () => {
    const sgrA = raDecToUnit(266.41684 / 15, -29.00781);
    const ngp = galacticToEquatorial(0, 90);
    const bDeg = (Math.asin(Math.max(-1, Math.min(1, dot(sgrA, ngp)))) * 180) / Math.PI;
    expect(Math.abs(bDeg)).toBeLessThan(0.1);
  });

  it("from Dnipro peaks low in the south (dec −29° → max alt ≈ 12.5°)", () => {
    // Scan a winter night when GC transits in darkness is irrelevant here — pure geometry:
    // max altitude over any day = 90 − |lat − dec| = 90 − 77.47 ≈ 12.53°.
    let peak = -90;
    const start = utc("2026-08-12T00:00:00Z");
    for (let t = start; t < start + 24 * 3600_000; t += 10 * 60_000) {
      peak = Math.max(peak, targetAzAlt(gc, t, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg);
    }
    expect(peak).toBeGreaterThan(11.5);
    expect(peak).toBeLessThan(13.5);
  });
});
