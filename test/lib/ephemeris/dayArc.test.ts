import { describe, expect, it } from "vitest";
import {
  azAltToEnu,
  dayFraction,
  localDayWindow,
  sampleDayArc,
  sampleTargetArc,
  solarOffsetHours,
} from "../../../src/lib/ephemeris/dayArc";
import {
  cometTarget,
  fixedTarget,
  planetTarget,
  targetAzAlt,
} from "../../../src/lib/ephemeris/targets";

// Same observer + almanac anchors as bodies.test.ts (JPL Horizons, Dnipro 48.4647N/35.0462E).
const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
// Dnipro solar offset = round(35.0462/15) = 2 h; solstice noon anchor 09:40Z ≈ local solar noon.
const SOLSTICE_NOON = Date.UTC(2026, 5, 21, 9, 40, 0);

describe("localDayWindow (scene solar-day convention)", () => {
  it("uses the captureTime whole-hour solar offset", () => {
    expect(solarOffsetHours(DNIPRO.lonDeg)).toBe(2);
    expect(solarOffsetHours(0)).toBe(0);
    expect(solarOffsetHours(-122.4)).toBe(-8); // San Francisco
  });

  it("brackets the scene instant in a 24 h window aligned to the local midnight", () => {
    const { startMs, endMs, offsetHours } = localDayWindow(SOLSTICE_NOON, DNIPRO.lonDeg);
    expect(offsetHours).toBe(2);
    expect(startMs).toBe(Date.UTC(2026, 5, 20, 22, 0, 0)); // local 2026-06-21 00:00 at UTC+2
    expect(endMs - startMs).toBe(86_400_000);
    expect(SOLSTICE_NOON).toBeGreaterThanOrEqual(startMs);
    expect(SOLSTICE_NOON).toBeLessThan(endMs);
  });

  it("an instant just before local midnight stays in the earlier day", () => {
    const justBefore = Date.UTC(2026, 5, 20, 21, 59, 59);
    const { endMs } = localDayWindow(justBefore, DNIPRO.lonDeg);
    expect(endMs).toBe(Date.UTC(2026, 5, 20, 22, 0, 0));
  });
});

describe("sampleDayArc", () => {
  const arc = sampleDayArc("sun", SOLSTICE_NOON, DNIPRO.latDeg, DNIPRO.lonDeg);

  it("samples the day densely and inclusively (10 min → 145 points, monotonic time)", () => {
    expect(arc.points).toHaveLength(145);
    expect(arc.points[0].utcMs).toBe(arc.startMs);
    expect(arc.points[144].utcMs).toBe(arc.endMs);
    for (let i = 1; i < arc.points.length; i++) {
      expect(arc.points[i].utcMs).toBeGreaterThan(arc.points[i - 1].utcMs);
    }
  });

  it("puts 25 hour ticks on the local hours", () => {
    expect(arc.hourTicks).toHaveLength(25);
    expect(arc.hourTicks[0].utcMs).toBe(arc.startMs);
    expect(arc.hourTicks[24].utcMs).toBe(arc.endMs);
    // Tick 12 = local solar noon → the sun peaks ~65° in the south (Horizons anchor 64.97°).
    // The whole-hour offset sits 20 min past true transit at Dnipro, and near a 65° transit
    // the azimuth sweeps ~33°/h — the ±1 h convention error is visible here by design.
    const noon = arc.hourTicks[12];
    expect(noon.altDeg).toBeGreaterThan(63.5);
    expect(Math.abs(noon.azDeg - 180)).toBeLessThan(15);
  });

  it("solstice sun arc rises and sets once (two horizon crossings) and peaks near noon", () => {
    let crossings = 0;
    for (let i = 1; i < arc.points.length; i++) {
      if (arc.points[i].altDeg > 0 !== arc.points[i - 1].altDeg > 0) crossings++;
    }
    expect(crossings).toBe(2);
    const peak = arc.points.reduce((a, b) => (b.altDeg > a.altDeg ? b : a));
    expect(peak.altDeg).toBeCloseTo(64.97, 0);
    expect(Math.abs(peak.utcMs - SOLSTICE_NOON)).toBeLessThanOrEqual(10 * 60_000);
    expect(arc.everUp).toBe(true);
  });

  it("t01 spans 0..1 across the window", () => {
    expect(arc.points[0].t01).toBe(0);
    expect(arc.points[144].t01).toBe(1);
    const mid = arc.points[72];
    expect(mid.t01).toBeCloseTo(0.5, 5);
  });

  it("moon arc samples from the same ephemeris (Horizons anchor 2026-06-29 21:00Z)", () => {
    const moonAnchor = Date.UTC(2026, 5, 29, 21, 0, 0);
    const moonArc = sampleDayArc("moon", moonAnchor, DNIPRO.latDeg, DNIPRO.lonDeg, {
      stepMin: 60,
    });
    const p = moonArc.points.find((q) => q.utcMs === moonAnchor);
    expect(p).toBeDefined();
    expect(p!.azDeg).toBeCloseTo(171.211895, 1);
    expect(p!.altDeg).toBeCloseTo(12.777505, 1);
  });
});

describe("sampleTargetArc (ASTRO ENGINE phase C — the tracked target's trail)", () => {
  it("shares the sun/moon day-window grammar and samples via targetAzAlt exactly", () => {
    const target = cometTarget(); // 10P — the standing default the trail ships tracking
    const arc = sampleTargetArc(target, SOLSTICE_NOON, DNIPRO.latDeg, DNIPRO.lonDeg, {
      stepMin: 60,
    });
    const win = localDayWindow(SOLSTICE_NOON, DNIPRO.lonDeg);
    expect(arc.startMs).toBe(win.startMs);
    expect(arc.endMs).toBe(win.endMs);
    expect(arc.points).toHaveLength(25);
    expect(arc.hourTicks).toHaveLength(25);
    // One target, one ephemeris, three faces: every trail point IS a targetAzAlt sample.
    for (const p of [arc.points[0], arc.points[12], arc.points[24]]) {
      const ref = targetAzAlt(target, p.utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
      expect(p.azDeg).toBeCloseTo(ref.azDeg, 9);
      expect(p.altDeg).toBeCloseTo(ref.altDeg, 9);
    }
  });

  it("a planet's arc matches the engine provider through the same face", () => {
    const target = planetTarget("saturn");
    const arc = sampleTargetArc(target, SOLSTICE_NOON, DNIPRO.latDeg, DNIPRO.lonDeg, {
      stepMin: 120,
    });
    const p = arc.points[6];
    const ref = targetAzAlt(target, p.utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(p.azDeg).toBeCloseTo(ref.azDeg, 9);
    expect(p.altDeg).toBeCloseTo(ref.altDeg, 9);
    expect(arc.everUp).toBe(true); // Saturn (dec ≈ −5° mid-2026) clears a 48.5°N horizon daily
  });

  it("everUp = false for a far-southern object that never rises here", () => {
    // Dec −80°: max altitude from 48.46°N = 90 − |48.46 − (−80)| ≈ −38° — never up, by geometry.
    const southern = fixedTarget({
      id: "dso:TEST-S",
      name: "Test South",
      kind: "cluster",
      aliases: [],
      raDeg: 120,
      decDeg: -80,
      vmag: 5,
      facts: { kind: "dso", dsoType: "OCl", typeLabel: "OPEN CLUSTER", constellation: null, names: [] },
      source: "TEST",
    });
    const arc = sampleTargetArc(southern, SOLSTICE_NOON, DNIPRO.latDeg, DNIPRO.lonDeg, {
      stepMin: 60,
    });
    expect(arc.everUp).toBe(false);
    expect(Math.max(...arc.points.map((p) => p.altDeg))).toBeLessThan(-30);
  });
});

describe("dayFraction", () => {
  it("maps scene time into the window, clamped", () => {
    const arc = { startMs: 1000, endMs: 1000 + 86_400_000 };
    expect(dayFraction(arc, 1000)).toBe(0);
    expect(dayFraction(arc, 1000 + 43_200_000)).toBeCloseTo(0.5, 9);
    expect(dayFraction(arc, 0)).toBe(0);
    expect(dayFraction(arc, 1e15)).toBe(1);
  });
});

describe("azAltToEnu", () => {
  it("maps compass bearings to the ENU axes", () => {
    const [eN, nN, uN] = azAltToEnu(0, 0); // due north on the horizon
    expect(eN).toBeCloseTo(0, 9);
    expect(nN).toBeCloseTo(1, 9);
    expect(uN).toBeCloseTo(0, 9);
    const [eE] = azAltToEnu(90, 0); // due east
    expect(eE).toBeCloseTo(1, 9);
    const [, , uZ] = azAltToEnu(123, 90); // zenith
    expect(uZ).toBeCloseTo(1, 9);
    const [eS, nS, uS] = azAltToEnu(180, 45); // south at 45°
    expect(eS).toBeCloseTo(0, 9);
    expect(nS).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(uS).toBeCloseTo(Math.SQRT1_2, 9);
  });
});
