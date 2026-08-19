import { describe, expect, it } from "vitest";
import {
  azAltToEnu,
  dayFraction,
  elevationSeries,
  localDayWindow,
  sampleDayArc,
  sampleTargetArc,
  solarOffsetHours,
} from "../../../src/lib/ephemeris/dayArc";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import {
  nextRiseAzimuth,
  targetElevationSeries,
  traceStates,
} from "../../../src/lib/ephemeris/dayArc";
import {
  bodyTarget,
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

describe("elevationSeries (QoL-1 scrubber rail curves)", () => {
  const start = SOLSTICE_NOON - 12 * 3_600_000;
  const end = SOLSTICE_NOON + 12 * 3_600_000;

  it("samples the window inclusively at the requested step", () => {
    const s = elevationSeries("sun", start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 10);
    expect(s.length).toBe((24 * 60) / 10 + 1);
    expect(s[0].utcMs).toBe(start);
    expect(s[s.length - 1].utcMs).toBe(end);
    for (let i = 1; i < s.length; i++) expect(s[i].utcMs).toBeGreaterThan(s[i - 1].utcMs);
  });

  it("puts the solstice sun high at local noon and deep at local midnight", () => {
    const s = elevationSeries("sun", start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 10);
    const at = (ms: number) => s.reduce((a, b) => (Math.abs(b.utcMs - ms) < Math.abs(a.utcMs - ms) ? b : a));
    // maxAlt = 90 − 48.46 + 23.44 ≈ +65°; minAlt = 48.46 + 23.44 − 90 ≈ −18°.
    expect(at(SOLSTICE_NOON).altDeg).toBeGreaterThan(60);
    expect(at(start).altDeg).toBeLessThan(-14);
  });

  it("agrees with the horizontal() face it wraps (one ephemeris, ADR D6)", () => {
    const s = elevationSeries("moon", start, start + 3_600_000, DNIPRO.latDeg, DNIPRO.lonDeg, 30);
    expect(s.length).toBe(3);
    const direct = horizontal("moon", s[1].utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(s[1].altDeg).toBeCloseTo(direct.altDeg, 9);
  });

  it("returns [] on garbage windows", () => {
    expect(elevationSeries("sun", end, start, DNIPRO.latDeg, DNIPRO.lonDeg, 10)).toEqual([]);
    expect(elevationSeries("sun", start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 0)).toEqual([]);
  });
});

describe("targetElevationSeries + traceStates (QoL-1 §3.1.D rail trace)", () => {
  const start = SOLSTICE_NOON - 6 * 3_600_000;
  const end = SOLSTICE_NOON + 6 * 3_600_000;
  const polaris = fixedTarget({
    id: "star:TEST-POLARIS",
    name: "Test Polaris",
    kind: "star",
    aliases: [],
    raDeg: 37.95,
    decDeg: 89.26,
    vmag: 2,
    facts: { kind: "dso", dsoType: "**", typeLabel: "STAR", constellation: null, names: [] },
    source: "TEST",
  });
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

  it("samples the window inclusively at the requested step and agrees with targetAzAlt", () => {
    const s = targetElevationSeries(polaris, start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 8);
    expect(s.length).toBe(Math.floor((12 * 60) / 8) + 1);
    expect(s[0].utcMs).toBe(start);
    expect(s[s.length - 1].utcMs).toBe(end);
    const direct = targetAzAlt(polaris, s[3].utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(s[3].altDeg).toBeCloseTo(direct.altDeg, 9);
    expect(s[3].azDeg).toBeCloseTo(direct.azDeg, 9);
  });

  it("returns [] on garbage windows", () => {
    expect(targetElevationSeries(polaris, end, start, DNIPRO.latDeg, DNIPRO.lonDeg, 8)).toEqual([]);
    expect(targetElevationSeries(polaris, start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 0)).toEqual([]);
  });

  it("classifies against a mock skyline: clear above, blocked below, down under the horizon", () => {
    const s = targetElevationSeries(polaris, start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 60);
    // Polaris from Dnipro sits ~48° up all day — a 50° wall blocks it, a 10° wall doesn't.
    expect(traceStates(s, () => 50).every((st) => st === "blocked")).toBe(true);
    expect(traceStates(s, () => 10).every((st) => st === "clear")).toBe(true);
    // No profile → horizon-only classification: up samples are clear.
    expect(traceStates(s, null).every((st) => st === "clear")).toBe(true);
    // A dec −80° target never rises from Dnipro → every sample is down, wall or no wall.
    const sDown = targetElevationSeries(southern, start, end, DNIPRO.latDeg, DNIPRO.lonDeg, 60);
    expect(traceStates(sDown, () => 50).every((st) => st === "down")).toBe(true);
  });

  it("skyline sampler receives the sample azimuth", () => {
    const s = targetElevationSeries(polaris, start, start + 3_600_000, DNIPRO.latDeg, DNIPRO.lonDeg, 30);
    const seen: number[] = [];
    traceStates(s, (az) => { seen.push(az); return -90; });
    expect(seen.length).toBe(s.length);
    expect(seen[0]).toBeCloseTo(s[0].azDeg, 9);
  });
});

describe("nextRiseAzimuth (goto-chip below-horizon jump, owner 2026-08-19b)", () => {
  // Midnight local solar time in Dnipro on the solstice — the sun is well below the horizon.
  const midnight = SOLSTICE_NOON + 12 * 3_600_000;
  const neverUp = fixedTarget({
    id: "dso:TEST-NEVER-UP",
    name: "Test Never Up",
    kind: "cluster",
    aliases: [],
    raDeg: 120,
    decDeg: -80, // from 48.5°N a −80° dec target never clears the horizon
    vmag: 5,
    facts: { kind: "dso", dsoType: "OCl", typeLabel: "OPEN CLUSTER", constellation: null, names: [] },
    source: "TEST",
  });

  it("finds the sun's next rise from a night instant: within a day, NE on the solstice", () => {
    const rise = nextRiseAzimuth(bodyTarget("sun"), midnight, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(rise).not.toBeNull();
    expect(rise!.utcMs).toBeGreaterThan(midnight);
    expect(rise!.utcMs - midnight).toBeLessThan(24 * 3_600_000);
    // Summer-solstice sunrise sits far north of east at 48.5°N (~45–70°).
    expect(rise!.azDeg).toBeGreaterThan(30);
    expect(rise!.azDeg).toBeLessThan(90);
    // The interpolated instant really is a horizon crossing.
    const at = targetAzAlt(bodyTarget("sun"), rise!.utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(Math.abs(at.altDeg)).toBeLessThan(0.5);
  });

  it("returns null for a target that never rises here", () => {
    expect(nextRiseAzimuth(neverUp, midnight, DNIPRO.latDeg, DNIPRO.lonDeg)).toBeNull();
  });

  it("returns null for a circumpolar target that never sets (no crossing exists)", () => {
    const polarisHigh = fixedTarget({
      id: "star:TEST-P2",
      name: "Test P2",
      kind: "star",
      aliases: [],
      raDeg: 37.95,
      decDeg: 89.26,
      vmag: 2,
      facts: { kind: "dso", dsoType: "**", typeLabel: "STAR", constellation: null, names: [] },
      source: "TEST",
    });
    expect(nextRiseAzimuth(polarisHigh, midnight, DNIPRO.latDeg, DNIPRO.lonDeg)).toBeNull();
  });
});
