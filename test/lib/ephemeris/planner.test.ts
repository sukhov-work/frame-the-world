import { describe, expect, it } from "vitest";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import { localDayWindow } from "../../../src/lib/ephemeris/dayArc";
import {
  CIVIL_TWILIGHT_DEG,
  clampObserverElevationM,
  dayEvents,
  goldenElevationsDeg,
  moonPhaseEvents,
  OBSERVER_MAX_ELEV_M,
  OBSERVER_MAX_EYE_M,
  OBSERVER_MIN_ELEV_M,
  planElevationsM,
  skylineState,
  targetSkylineState,
  type PlanEvent,
  type PlanObserver,
} from "../../../src/lib/ephemeris/planner";
import { fixedTarget, targetAzAlt } from "../../../src/lib/ephemeris/targets";

/** Same fixture as bodies.test.ts — Dnipro, UA (JPL-anchored `horizontal` is the ground truth
 *  every planner event is checked against: self-consistency, not a second almanac). */
const DNIPRO: PlanObserver = {
  latDeg: 48.4647,
  lonDeg: 35.0462,
  groundAltM: 100,
  eyeAboveGroundM: 2,
};

/** 2026 June solstice, midday UTC (≈15:00 Dnipro solar). */
const SOLSTICE_NOON_MS = Date.UTC(2026, 5, 21, 12, 0, 0);

/** tuning.GOLDEN mirror (fadeIn sin −12°→−1°, fadeOut sin +10°→+21° — 2026-07-13 values).
 *  Parity-guarded below (audit C1: golden.test's twin mirror drifted once already). */
const CURVE = { fadeInLo: -0.21, fadeInHi: -0.0175, fadeOutLo: 0.17, fadeOutHi: 0.36 };

it("CURVE mirror matches the shipped tuning.GOLDEN (drift guard — audit C1)", async () => {
  const { GOLDEN } = await import("../../../src/components/globe/tuning");
  expect(CURVE).toEqual({
    fadeInLo: GOLDEN.fadeInLo,
    fadeInHi: GOLDEN.fadeInHi,
    fadeOutLo: GOLDEN.fadeOutLo,
    fadeOutHi: GOLDEN.fadeOutHi,
  });
});

const eventByKind = (events: PlanEvent[], kind: PlanEvent["kind"]) =>
  events.find((e) => e.kind === kind);

describe("goldenElevationsDeg — thresholds derived from the scene's own bell", () => {
  it("crosses 0.5 at the smoothstep band midpoints (asin of mean sines)", () => {
    const g = goldenElevationsDeg(CURVE);
    expect(g.loDeg).toBeCloseTo(Math.asin((-0.21 - 0.0175) / 2) * (180 / Math.PI), 6);
    expect(g.hiDeg).toBeCloseTo(Math.asin((0.17 + 0.36) / 2) * (180 / Math.PI), 6);
    expect(g.loDeg).toBeCloseTo(-6.53, 1);
    expect(g.hiDeg).toBeCloseTo(15.37, 1);
  });
});

describe("dayEvents — almanac chips, self-consistent with the JPL-anchored horizontal()", () => {
  const events = dayEvents(SOLSTICE_NOON_MS, DNIPRO, CURVE);
  const window = localDayWindow(SOLSTICE_NOON_MS, DNIPRO.lonDeg);

  it("returns a sorted set inside the local solar day window", () => {
    expect(events.length).toBeGreaterThan(6);
    for (let i = 1; i < events.length; i++)
      expect(events[i].utcMs).toBeGreaterThanOrEqual(events[i - 1].utcMs);
    for (const e of events) {
      expect(e.utcMs).toBeGreaterThanOrEqual(window.startMs);
      expect(e.utcMs).toBeLessThan(window.endMs);
    }
  });

  it("sunrise/sunset sit at the refracted-disc horizon (alt ≈ −0.83°, NE/NW at solstice)", () => {
    const sunrise = eventByKind(events, "sunrise");
    const sunset = eventByKind(events, "sunset");
    expect(sunrise && sunset).toBeTruthy();
    // −50′ (34′ refraction + 16′ semidiameter) minus a ~2 m eye dip
    expect(sunrise!.altDeg).toBeGreaterThan(-1.1);
    expect(sunrise!.altDeg).toBeLessThan(-0.6);
    expect(sunset!.altDeg).toBeGreaterThan(-1.1);
    expect(sunset!.altDeg).toBeLessThan(-0.6);
    // June solstice at 48°N: sun rises far NE, sets far NW
    expect(sunrise!.azDeg).toBeGreaterThan(30);
    expect(sunrise!.azDeg).toBeLessThan(70);
    expect(sunset!.azDeg).toBeGreaterThan(290);
    expect(sunset!.azDeg).toBeLessThan(330);
  });

  it("civil dawn/dusk cross −6° geometric", () => {
    const dawn = eventByKind(events, "civilDawn");
    const dusk = eventByKind(events, "civilDusk");
    expect(dawn && dusk).toBeTruthy();
    expect(dawn!.altDeg).toBeCloseTo(CIVIL_TWILIGHT_DEG, 1);
    expect(dusk!.altDeg).toBeCloseTo(CIVIL_TWILIGHT_DEG, 1);
  });

  it("golden chips cross the derived bell thresholds", () => {
    const g = goldenElevationsDeg(CURVE);
    const amStart = eventByKind(events, "goldenAmStart");
    const amEnd = eventByKind(events, "goldenAmEnd");
    const pmStart = eventByKind(events, "goldenPmStart");
    const pmEnd = eventByKind(events, "goldenPmEnd");
    expect(amStart && amEnd && pmStart && pmEnd).toBeTruthy();
    expect(amStart!.altDeg).toBeCloseTo(g.loDeg, 1);
    expect(amEnd!.altDeg).toBeCloseTo(g.hiDeg, 1);
    expect(pmStart!.altDeg).toBeCloseTo(g.hiDeg, 1);
    expect(pmEnd!.altDeg).toBeCloseTo(g.loDeg, 1);
    expect(amStart!.utcMs).toBeLessThan(amEnd!.utcMs);
    expect(pmStart!.utcMs).toBeLessThan(pmEnd!.utcMs);
  });

  it("solar noon is the due-south culmination (~65° at the Dnipro solstice)", () => {
    const noon = eventByKind(events, "sunNoon");
    expect(noon).toBeTruthy();
    expect(noon!.azDeg).toBeCloseTo(180, 0);
    expect(noon!.altDeg).toBeCloseTo(65, 0); // JPL 64.97 (bodies.test.ts fixture)
  });

  it("event annotations match a direct horizontal() call (one ephemeris, one face)", () => {
    for (const e of events) {
      const pos = horizontal(e.body, e.utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
      expect(e.azDeg).toBeCloseTo(pos.azDeg, 6);
      expect(e.altDeg).toBeCloseTo(pos.altDeg, 6);
    }
  });
});

describe("moonPhaseEvents — next full/new moon", () => {
  it("finds both within 40 days, after the scene instant", () => {
    const events = moonPhaseEvents(SOLSTICE_NOON_MS, DNIPRO);
    const full = eventByKind(events, "fullMoon");
    const nw = eventByKind(events, "newMoon");
    expect(full && nw).toBeTruthy();
    for (const e of [full!, nw!]) {
      expect(e.utcMs).toBeGreaterThan(SOLSTICE_NOON_MS);
      expect(e.utcMs).toBeLessThan(SOLSTICE_NOON_MS + 40 * 86_400_000);
    }
    // half a synodic month apart, ±2 d
    expect(Math.abs(Math.abs(full!.utcMs - nw!.utcMs) - 14.77 * 86_400_000)).toBeLessThan(
      2 * 86_400_000,
    );
  });
});

describe("skylineState — body vs the cached horizon profile", () => {
  it("a 10° wall: high solstice sun is clear; the next-block crossing lands ON the wall", () => {
    const s = skylineState("sun", SOLSTICE_NOON_MS, DNIPRO, () => 10);
    expect(s.blockedNow).toBe(false);
    expect(s.skylineAltDeg).toBeCloseTo(10, 6);
    expect(s.nextBlockMs).not.toBeNull();
    const atCross = horizontal("sun", s.nextBlockMs!, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(atCross.altDeg).toBeCloseTo(10, 1);
    // and it re-clears next morning
    expect(s.nextClearMs).not.toBeNull();
    expect(s.nextClearMs!).toBeGreaterThan(s.nextBlockMs!);
  });

  it("a 90° dome never clears", () => {
    const s = skylineState("sun", SOLSTICE_NOON_MS, DNIPRO, () => 89.9);
    expect(s.blockedNow).toBe(true);
    expect(s.nextClearMs).toBeNull();
  });

  it("an all-open profile at night: sun blocked below the horizon, clears at ≈0° next morning", () => {
    const midnight = Date.UTC(2026, 5, 21, 21, 30, 0); // ≈00:30 Dnipro solar
    const s = skylineState("sun", midnight, DNIPRO, () => 0);
    expect(s.blockedNow).toBe(true);
    expect(s.nextClearMs).not.toBeNull();
    const atClear = horizontal("sun", s.nextClearMs!, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(atClear.altDeg).toBeCloseTo(0, 1);
  });

  it("a west-only opening: the sun emerges when its azimuth enters the gap", () => {
    // 89° everywhere except az 240–300 (west) → open
    const profile = (az: number) => (az >= 240 && az <= 300 ? 0 : 89);
    const morning = Date.UTC(2026, 5, 21, 6, 0, 0);
    const s = skylineState("sun", morning, DNIPRO, profile);
    expect(s.blockedNow).toBe(true);
    expect(s.nextClearMs).not.toBeNull();
    const atClear = horizontal("sun", s.nextClearMs!, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(atClear.azDeg).toBeGreaterThan(238);
    expect(atClear.azDeg).toBeLessThan(302);
    expect(atClear.altDeg).toBeGreaterThan(0);
  });
});

describe("targetSkylineState — any tracked SkyTarget vs the profile (ASTRO ENGINE phase E)", () => {
  // Vega as a fixed target: dec 38.8° from 48.5°N rises and sets every sidereal day — a clean
  // diurnal crosser for the same synthetic profiles the sun/moon tests use.
  const VEGA = fixedTarget({
    id: "star:test-vega",
    name: "Vega",
    kind: "star",
    aliases: [],
    raDeg: 279.2347,
    decDeg: 38.7837,
    vmag: 0.03,
    facts: { kind: "dso", dsoType: "*", typeLabel: "STAR", constellation: "Lyr", names: [] },
    source: "test fixture",
  });

  it("crossings land ON the wall through the SAME targetAzAlt face the scene reads", () => {
    const s = targetSkylineState(VEGA, SOLSTICE_NOON_MS, DNIPRO, () => 10);
    const eyeM = DNIPRO.groundAltM + DNIPRO.eyeAboveGroundM;
    const nowPos = targetAzAlt(VEGA, SOLSTICE_NOON_MS, DNIPRO.latDeg, DNIPRO.lonDeg, eyeM);
    expect(s.azDeg).toBeCloseTo(nowPos.azDeg, 6);
    expect(s.altDeg).toBeCloseTo(nowPos.altDeg, 6);
    expect(s.skylineAltDeg).toBeCloseTo(10, 6);
    expect(s.blockedNow).toBe(nowPos.altDeg <= 10);
    // Vega peaks at ~80° and dips to ~ −3° from Dnipro — both crossings must exist.
    expect(s.nextClearMs).not.toBeNull();
    expect(s.nextBlockMs).not.toBeNull();
    const atClear = targetAzAlt(VEGA, s.nextClearMs!, DNIPRO.latDeg, DNIPRO.lonDeg, eyeM);
    expect(atClear.altDeg).toBeCloseTo(10, 1);
    const atBlock = targetAzAlt(VEGA, s.nextBlockMs!, DNIPRO.latDeg, DNIPRO.lonDeg, eyeM);
    expect(atBlock.altDeg).toBeCloseTo(10, 1);
  });

  it("a 90° dome never clears; an all-open pit never blocks", () => {
    const dome = targetSkylineState(VEGA, SOLSTICE_NOON_MS, DNIPRO, () => 89.9);
    expect(dome.blockedNow).toBe(true);
    expect(dome.nextClearMs).toBeNull();
    const pit = targetSkylineState(VEGA, SOLSTICE_NOON_MS, DNIPRO, () => -90);
    expect(pit.blockedNow).toBe(false);
    expect(pit.nextBlockMs).toBeNull();
  });
});

/**
 * T32 (audit #3 F1, fixed 2026-08-22) — the OBSERVER ELEVATION range contract.
 *
 * The planner is fed the LIVE camera height. In the 2D shell the camera sits at LEO, so
 * `groundAltM + eyeAboveGroundM` reaches millions of metres, and astronomy-engine's
 * `Atmosphere()` — reached from every rise/set search through the Observer's elevation — throws
 * `Invalid elevation` above +100 km. It was browser-caught during the U6 verify and survived
 * only because the orchestrator's throttled frame catch swallowed it.
 *
 * Mutation that makes these RED: delete `OBSERVER_MAX_ELEV_M` from `clampObserverElevationM`
 * (i.e. go back to the bare `Math.max(-400, …)`). The LEO case then throws exactly the string
 * the positive control below pins, and the clamp cases return the raw input.
 */
describe("observer elevation clamp (T32)", () => {
  it("clamps both ends and rejects non-finite input", () => {
    expect(clampObserverElevationM(0)).toBe(0);
    expect(clampObserverElevationM(1_234)).toBe(1_234);
    expect(clampObserverElevationM(-9_999)).toBe(OBSERVER_MIN_ELEV_M);
    expect(clampObserverElevationM(500_000)).toBe(OBSERVER_MAX_ELEV_M);
    // The exact LEO value the 2D shell produces — far past the library's own +100 km limit.
    expect(clampObserverElevationM(6_000_000)).toBe(OBSERVER_MAX_ELEV_M);
    expect(clampObserverElevationM(Number.NaN)).toBe(0);
    expect(clampObserverElevationM(Number.POSITIVE_INFINITY)).toBe(0);
    // The band must stay INSIDE the library's own [-500, +100000] or the clamp buys nothing.
    expect(OBSERVER_MIN_ELEV_M).toBeGreaterThan(-500);
    expect(OBSERVER_MAX_ELEV_M).toBeLessThan(100_000);
  });

  it("the eye the rise/set search SUBTRACTS lands in band too", async () => {
    // SearchRiseSet builds a SECOND observer at `obsM − eyeM` and runs THAT through Atmosphere.
    // Clamping only the observer left `10_000 − 6_000_000` and still threw; this pins the pair.
    const { Atmosphere } = await import("astronomy-engine");
    const cases: [number, number][] = [
      [100, 2], // the ordinary Dnipro fixture
      [-400, 0], // Dead-Sea floor, eye on the ground
      [9_000, 10_000], // both near their ceilings — the sum clips
      [10_000_000, 6_000_000], // the LEO case that browser-caught during the U6 verify
      [-1_000_000, -5], // absurd negatives (a bad terrain sample) and a negative eye
      [Number.NaN, Number.NaN],
    ];
    for (const [groundAltM, eyeAboveGroundM] of cases) {
      const { obsM, eyeM } = planElevationsM({ latDeg: 0, lonDeg: 0, groundAltM, eyeAboveGroundM });
      expect(eyeM).toBeGreaterThanOrEqual(0);
      expect(eyeM).toBeLessThanOrEqual(OBSERVER_MAX_EYE_M);
      expect(obsM).toBeGreaterThanOrEqual(OBSERVER_MIN_ELEV_M);
      expect(obsM).toBeLessThanOrEqual(OBSERVER_MAX_ELEV_M);
      expect(() => Atmosphere(obsM)).not.toThrow();
      expect(() => Atmosphere(obsM - eyeM)).not.toThrow(); // the ground observer
    }
  });

  it("POSITIVE CONTROL: astronomy-engine really does throw at the un-clamped LEO elevation", async () => {
    const { Atmosphere } = await import("astronomy-engine");
    expect(() => Atmosphere(6_000_000)).toThrow(/Invalid elevation/);
    expect(() => Atmosphere(Number.NaN)).toThrow(/Invalid elevation/);
    // …and does NOT throw at the clamped value, so the clamp is a sufficient fix.
    expect(() => Atmosphere(clampObserverElevationM(6_000_000))).not.toThrow();
  });

  it("a full almanac from LEO returns instead of throwing", () => {
    const leo: PlanObserver = { ...DNIPRO, eyeAboveGroundM: 6_000_000 };
    expect(() => dayEvents(SOLSTICE_NOON_MS, leo, CURVE)).not.toThrow();
    expect(() => moonPhaseEvents(SOLSTICE_NOON_MS, leo)).not.toThrow();
    // Still a real almanac — the clamp must not empty it out.
    expect(dayEvents(SOLSTICE_NOON_MS, leo, CURVE).length).toBeGreaterThan(0);
    // At the 10 km ceiling the sun rises EARLIER than at ground level (a deeper horizon dip),
    // which also proves the elevation is still reaching the search at all.
    const rise = (o: PlanObserver) =>
      dayEvents(SOLSTICE_NOON_MS, o, CURVE).find((e) => e.kind === "sunrise")?.utcMs ?? null;
    const [hi, lo] = [rise(leo), rise(DNIPRO)];
    expect(hi).not.toBeNull();
    expect(lo).not.toBeNull();
    expect(hi!).toBeLessThan(lo!);
  });
});
