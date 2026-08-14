import { describe, expect, it } from "vitest";
import {
  SUNEVENT,
  sunEventDays,
  sunEventFrameHits,
  sunEventInFrame,
  type SunEventDay,
} from "../../../src/lib/ephemeris/sunEventFrame";
import type { FramePose } from "../../../src/lib/ephemeris/frameFinder";

/** §3.5 sunsets-in-frame — the event-anchored day loop + disc-padded airless frame test.
 *  House idiom: self-consistency against the JPL-anchored ephemeris (range vectors, never
 *  absolute almanac timestamps); fabricated days for the pure frame/skyline geometry. */

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462, groundAltM: 0, eyeAboveGroundM: 1.6 };
const DAY_MS = 86_400_000;
const AUG = Date.UTC(2026, 7, 15, 0, 0, 0);

// Local literal mirror of tuning.GOLDEN (the planner.test drift-guard pattern — planner.test
// already pins the tuning parity; this file only needs the shape).
const CURVE = { fadeInLo: -0.21, fadeInHi: -0.0175, fadeOutLo: 0.17, fadeOutHi: 0.36 };

const pose = (headingDeg: number, pitchDeg = 2, fovDeg = 40, aspect = 1.6): FramePose => ({
  latDeg: DNIPRO.latDeg,
  lonDeg: DNIPRO.lonDeg,
  headingDeg,
  pitchDeg,
  fovDeg,
  aspect,
});

const day = (over: Partial<SunEventDay>): SunEventDay => ({
  kind: "sunset",
  utcMs: 1_000,
  azDeg: 180,
  altDeg: 0,
  discRadDeg: 0.27,
  azDriftDegPerDay: 0,
  ...over,
});

describe("sunEventDays (pose-free face)", () => {
  it("August Dnipro sunsets: refracted label instants, airless annotations in the planner bands", () => {
    const days = sunEventDays(DNIPRO, AUG, 10, ["sunset"]);
    expect(days.length).toBe(10);
    for (const d of days) {
      expect(d.utcMs).toBeGreaterThanOrEqual(AUG - DAY_MS);
      expect(d.utcMs).toBeLessThan(AUG + 11 * DAY_MS);
      // Airless centre at the refracted set instant: −50′ minus eye dip (planner.test bands).
      expect(d.altDeg).toBeGreaterThan(-1.1);
      expect(d.altDeg).toBeLessThan(-0.6);
      expect(d.azDeg).toBeGreaterThan(280);
      expect(d.azDeg).toBeLessThan(310);
      expect(d.discRadDeg).toBeGreaterThan(0.255);
      expect(d.discRadDeg).toBeLessThan(0.28);
    }
  });

  it("drift is seeded from day −1: EVERY row carries a real per-day azimuth walk", () => {
    const days = sunEventDays(DNIPRO, AUG, 6, ["sunset"]);
    for (const d of days) {
      // Post-solstice August at 48°N: the sunset walks south a fraction of a degree per day.
      expect(d.azDriftDegPerDay).toBeLessThan(0);
      expect(d.azDriftDegPerDay).toBeGreaterThan(-1.5);
    }
  });

  it("golden kinds carry band samples at the sweep cadence and need the curve parameter", () => {
    expect(() => sunEventDays(DNIPRO, AUG, 2, ["goldenPm"])).toThrow(TypeError);
    const days = sunEventDays(DNIPRO, AUG, 2, ["goldenPm"], CURVE);
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) {
      expect(d.samples!.length).toBeGreaterThan(3);
      const dt = d.samples![1].utcMs - d.samples![0].utcMs;
      expect(dt).toBe(SUNEVENT.goldenStepMin * 60_000);
      // PM band FALLS from the render-bell hi edge toward the lo edge.
      expect(d.samples![0].altDeg).toBeGreaterThan(d.samples![d.samples!.length - 1].altDeg);
    }
  });

  it("is pure — identical inputs give identical output", () => {
    const a = sunEventDays(DNIPRO, AUG, 3, ["sunrise", "sunset"]);
    const b = sunEventDays(DNIPRO, AUG, 3, ["sunrise", "sunset"]);
    expect(a).toEqual(b);
  });
});

describe("sunEventFrameHits (pose-cheap face)", () => {
  it("NO altitude floor: the refracted sunset (airless −0.8°) lands in a west frame", () => {
    const eventDays = sunEventDays(DNIPRO, AUG, 10, ["sunrise", "sunset"]);
    const west = sunEventFrameHits(eventDays, pose(297));
    expect(west.length).toBeGreaterThan(0);
    for (const h of west) {
      expect(h.kind).toBe("sunset");
      expect(h.altDeg).toBeLessThan(0); // the load-bearing convention pin
      expect(Math.abs(h.fx)).toBeLessThanOrEqual(1.05);
      expect(Math.abs(h.fy)).toBeLessThanOrEqual(1.05);
      expect(h.skyline).toBe("unknown"); // no profileFn
    }
    // The same days facing east: sunrises only — the frame is the query.
    const east = sunEventFrameHits(eventDays, pose(63));
    expect(east.length).toBeGreaterThan(0);
    for (const h of east) expect(h.kind).toBe("sunrise");
    expect(sunEventFrameHits(eventDays, pose(0)).length).toBe(0); // facing north: nothing
  });

  it("disc pad: the limb catches a frame the centre-only test misses", () => {
    // fov 40 × aspect 1.6 → half-width 30.21°; centre-edge at az 210.21, limb pad ≈ +0.2°.
    const p = pose(180, 0);
    expect(sunEventFrameHits([day({ azDeg: 210.3 })], p).length).toBe(1);
    expect(sunEventFrameHits([day({ azDeg: 210.9 })], p).length).toBe(0);
  });

  it("rise/set skyline verdict asks 'is the true horizon visible there' — never centre-vs-profile", () => {
    const p = pose(180, 0);
    const flat = sunEventFrameHits([day({ altDeg: -0.83 })], p, () => 0);
    expect(flat[0].skyline).toBe("clear"); // sea horizon: centre-vs-profile would say blocked
    const ridge = sunEventFrameHits([day({ altDeg: -0.83 })], p, () => 3);
    expect(ridge[0].skyline).toBe("blocked");
    const eps = sunEventFrameHits([day({ altDeg: -0.83 })], p, () => SUNEVENT.horizonClearMaxDeg);
    expect(eps[0].skyline).toBe("clear");
  });

  it("golden hits report the FIRST in-frame band instant, centre-vs-profile skyline", () => {
    const g = day({
      kind: "goldenPm",
      utcMs: 0,
      azDeg: 120,
      altDeg: 10,
      samples: [
        { utcMs: 0, azDeg: 120, altDeg: 10 }, // outside the frame
        { utcMs: 300_000, azDeg: 165, altDeg: 8 }, // first inside
        { utcMs: 600_000, azDeg: 175, altDeg: 6 },
      ],
    });
    const p = pose(180, 6);
    const hits = sunEventFrameHits([g], p, () => 2);
    expect(hits.length).toBe(1);
    expect(hits[0].utcMs).toBe(300_000);
    expect(hits[0].altDeg).toBe(8);
    expect(hits[0].skyline).toBe("clear");
    expect(sunEventFrameHits([g], p, () => 50)[0].skyline).toBe("blocked");
  });
});

describe("sunEventInFrame (one-call face)", () => {
  it("composes the two faces exactly", () => {
    const composed = sunEventInFrame(pose(297), AUG, 8, {
      events: ["sunset"],
      eyeAboveGroundM: DNIPRO.eyeAboveGroundM,
    });
    const manual = sunEventFrameHits(sunEventDays(DNIPRO, AUG, 8, ["sunset"]), pose(297));
    expect(composed).toEqual(manual);
  });

  it("real golden evening over Dnipro lands in a wide west frame with sane light phases", () => {
    const hits = sunEventInFrame(pose(285, 8, 50), AUG, 4, {
      events: ["goldenPm"],
      golden: CURVE,
      eyeAboveGroundM: DNIPRO.eyeAboveGroundM,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.kind).toBe("goldenPm");
      expect(h.altDeg).toBeGreaterThan(-7); // inside the render-bell band
      expect(h.altDeg).toBeLessThan(16);
      expect(typeof h.light).toBe("string");
    }
  });
});
