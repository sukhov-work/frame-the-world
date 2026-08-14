import { describe, expect, it } from "vitest";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import { targetAzAlt, galacticCentreTarget } from "../../../src/lib/ephemeris/targets";
import {
  bodyDayPositions,
  frameStandings,
  frameStandingsFromPositions,
  FIND_VIS,
  type DayPosition,
  type FramePose,
  type FrameSampler,
} from "../../../src/lib/ephemeris/frameFinder";
import { sameLocalTimeInstants } from "../../../src/store/time";

/**
 * FIND v2 (owner rework 2026-08-14): fixed time-of-day day scan against the LIVE frame frustum.
 * The load-bearing claims: (1) the window IS the frame — zoom (FOV) and orientation change the
 * result set; (2) the scan instant is the scrubber's wall-clock time on every following day;
 * (3) visibility encodes moon illumination / GC darkness / skyline blocking for the ghost alpha.
 */

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const BASE = Date.UTC(2026, 5, 15, 10, 0, 0); // 2026-06-15 10:00 UTC — Dnipro early afternoon
const GC = galacticCentreTarget();

const sun: FrameSampler = (ms) => horizontal("sun", ms, DNIPRO.latDeg, DNIPRO.lonDeg);

const pose = (headingDeg: number, pitchDeg: number, fovDeg: number, aspect = 1.5): FramePose => ({
  latDeg: DNIPRO.latDeg,
  lonDeg: DNIPRO.lonDeg,
  headingDeg,
  pitchDeg,
  fovDeg,
  aspect,
});

/** Fabricated in-frame position at a real instant — the annotation paths read only utcMs. */
const at = (utcMs: number, azDeg: number, altDeg: number): DayPosition => ({ utcMs, azDeg, altDeg });

describe("sameLocalTimeInstants (the day walk)", () => {
  it("repeats the exact LOCAL wall-clock time on every following day", () => {
    const instants = sameLocalTimeInstants(BASE, 400); // spans DST boundaries in any TZ
    expect(instants).toHaveLength(400);
    const base = new Date(BASE);
    for (const ms of instants) {
      const d = new Date(ms);
      expect(d.getHours()).toBe(base.getHours());
      expect(d.getMinutes()).toBe(base.getMinutes());
    }
    // Strictly ascending, first instant on the NEXT day (day 0 is the scene itself).
    for (let i = 1; i < instants.length; i++)
      expect(instants[i]).toBeGreaterThan(instants[i - 1]);
    expect(instants[0] - BASE).toBeGreaterThan(20 * 3600_000);
    expect(instants[0] - BASE).toBeLessThan(28 * 3600_000);
  });
});

describe("frameStandings — the frame IS the query", () => {
  // Aim the frame at where the sun stands 10 days out at this hour; scan 30 days.
  const day10 = sameLocalTimeInstants(BASE, 30)[9];
  const aim = sun(day10);
  const instants = sameLocalTimeInstants(BASE, 30);

  it("finds standings inside a wide frame, every hit inside the window and above horizon", () => {
    const hits = frameStandings("sun", sun, pose(aim.azDeg, aim.altDeg, 40), instants);
    expect(hits.length).toBeGreaterThanOrEqual(5); // June sun drifts slowly at fixed hour
    expect(hits.some((h) => h.utcMs === day10)).toBe(true);
    for (const h of hits) {
      expect(Math.abs(h.fx)).toBeLessThanOrEqual(1);
      expect(Math.abs(h.fy)).toBeLessThanOrEqual(1);
      expect(h.altDeg).toBeGreaterThan(0);
      expect(h.body).toBe("sun");
      expect(h.visibility).toBe(1); // the sun in a clear frame is fully visible
    }
  });

  it("findings depend on the frame SIZE: a narrow (zoomed) frame finds strictly fewer", () => {
    const wide = frameStandings("sun", sun, pose(aim.azDeg, aim.altDeg, 40), instants);
    const narrow = frameStandings("sun", sun, pose(aim.azDeg, aim.altDeg, 3), instants);
    expect(narrow.length).toBeLessThan(wide.length);
    const wideKeys = new Set(wide.map((h) => h.utcMs));
    for (const h of narrow) expect(wideKeys.has(h.utcMs)).toBe(true);
  });

  it("findings depend on the frame ORIENTATION: facing away finds nothing", () => {
    const away = frameStandings(
      "sun",
      sun,
      pose((aim.azDeg + 180) % 360, aim.altDeg, 40),
      instants,
    );
    expect(away).toHaveLength(0);
  });

  it("position hints: a standing right/above the centre lands at fx>0 / fy>0", () => {
    const p = pose(180, 20, 50);
    const right = frameStandingsFromPositions("sun", [at(BASE, 190, 20)], p);
    const left = frameStandingsFromPositions("sun", [at(BASE, 170, 20)], p);
    const high = frameStandingsFromPositions("sun", [at(BASE, 180, 30)], p);
    expect(right[0].fx).toBeGreaterThan(0.1);
    expect(left[0].fx).toBeLessThan(-0.1);
    expect(high[0].fy).toBeGreaterThan(0.1);
  });

  it("skyline: a wall flags the hit blocked AND dims its visibility", () => {
    const p = pose(aim.azDeg, aim.altDeg, 40);
    const blocked = frameStandings("sun", sun, p, instants, () => 80);
    const clear = frameStandings("sun", sun, p, instants, () => 0);
    expect(blocked[0].skyline).toBe("blocked");
    expect(clear[0].skyline).toBe("clear");
    expect(blocked[0].visibility).toBeCloseTo(FIND_VIS.blockedDim, 5);
    expect(clear[0].visibility).toBe(1);
  });
});

describe("frameStandings — visibility model", () => {
  it("moon visibility scales with illumination (full > new)", () => {
    // Scan a synodic month at the base hour for the illumination extremes.
    const days = sameLocalTimeInstants(BASE, 30);
    const p = pose(180, 20, 50);
    const standings = days.map(
      (t) => frameStandingsFromPositions("moon", [at(t, 180, 20)], p)[0],
    );
    const byIllum = [...standings].sort((a, b) => a.moonIllum - b.moonIllum);
    const newest = byIllum[0];
    const fullest = byIllum[byIllum.length - 1];
    expect(fullest.moonIllum).toBeGreaterThan(0.8);
    expect(newest.moonIllum).toBeLessThan(0.2);
    expect(fullest.visibility).toBeGreaterThan(newest.visibility);
    expect(newest.visibility).toBeGreaterThanOrEqual(FIND_VIS.moonFloor);
  });

  it("GC visibility is ~0 by day and rises in the dark", () => {
    const p = pose(180, 20, 50);
    const noon = Date.UTC(2026, 0, 15, 10, 0, 0); // Dnipro midday, January
    const midnight = Date.UTC(2026, 0, 15, 22, 0, 0); // Dnipro midnight — deep astro dark
    expect(horizontal("sun", noon, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg).toBeGreaterThan(0);
    expect(horizontal("sun", midnight, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg).toBeLessThan(-18);
    const day = frameStandingsFromPositions("gc", [at(noon, 180, 20)], p)[0];
    const night = frameStandingsFromPositions("gc", [at(midnight, 180, 20)], p)[0];
    expect(day.visibility).toBeLessThan(0.05);
    expect(night.visibility).toBeGreaterThan(day.visibility);
  });

  it("the GC rides the real target sampler (dso:gc az/alt is finite and sane)", () => {
    const p = targetAzAlt(GC, BASE, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(Number.isFinite(p.azDeg)).toBe(true);
    expect(p.azDeg).toBeGreaterThanOrEqual(0);
    expect(p.azDeg).toBeLessThan(360);
    expect(Math.abs(p.altDeg)).toBeLessThanOrEqual(90);
  });

  it("bodyDayPositions is a pure sample map (one entry per instant, az/alt echoed)", () => {
    const instants = sameLocalTimeInstants(BASE, 5);
    const positions = bodyDayPositions(sun, instants);
    expect(positions).toHaveLength(5);
    positions.forEach((pos, i) => {
      expect(pos.utcMs).toBe(instants[i]);
      const echo = sun(pos.utcMs);
      expect(pos.azDeg).toBeCloseTo(echo.azDeg, 9);
      expect(pos.altDeg).toBeCloseTo(echo.altDeg, 9);
    });
  });
});
