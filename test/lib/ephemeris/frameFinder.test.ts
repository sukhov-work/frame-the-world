import { describe, expect, it } from "vitest";
import {
  angularSepDeg,
  frameCrossings,
  nearestFrameCentre,
  type FramePose,
  type FrameSampler,
} from "../../../src/lib/ephemeris/frameFinder";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import { azAltFrameMarker } from "../../../src/lib/geo/offscreen";

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const SOLSTICE_NOON = Date.UTC(2026, 5, 21, 9, 40, 0); // ≈ local solar noon at 35°E
const HOUR = 3_600_000;

/** A 16:9 pose looking due south, 30° up, 50° vertical FOV. */
const POSE: FramePose = {
  ...DNIPRO,
  headingDeg: 180,
  pitchDeg: 30,
  fovDeg: 50,
  aspect: 16 / 9,
};

/** Fixed-direction sampler. */
const fixed = (azDeg: number, altDeg: number): FrameSampler => () => ({ azDeg, altDeg });

/** Sampler swinging azimuth linearly from az0 at t0 by rateDegPerHour, at constant altitude. */
const swing =
  (t0: number, az0: number, rateDegPerHour: number, altDeg: number): FrameSampler =>
  (utcMs) => ({ azDeg: az0 + ((utcMs - t0) / HOUR) * rateDegPerHour, altDeg });

describe("angularSepDeg", () => {
  it("is zero at coincidence and exact on the meridian", () => {
    expect(angularSepDeg({ azDeg: 180, altDeg: 30 }, { azDeg: 180, altDeg: 30 })).toBeCloseTo(0, 9);
    expect(angularSepDeg({ azDeg: 180, altDeg: 50 }, { azDeg: 180, altDeg: 30 })).toBeCloseTo(20, 9);
  });
  it("wraps azimuth correctly", () => {
    expect(angularSepDeg({ azDeg: 359, altDeg: 0 }, { azDeg: 1, altDeg: 0 })).toBeCloseTo(2, 6);
  });
});

describe("frameCrossings — synthetic samplers", () => {
  it("a body parked at the frame centre yields one window spanning the whole horizon", () => {
    const from = SOLSTICE_NOON;
    const wins = frameCrossings(fixed(180, 30), POSE, from, 0.5);
    expect(wins.length).toBe(1);
    expect(wins[0].startMs).toBe(from);
    expect(wins[0].endMs).toBe(from + 0.5 * 86_400_000);
    expect(wins[0].peakSepDeg).toBeCloseTo(0, 6);
    expect(wins[0].skyline).toBe("unknown"); // no profileFn injected
  });

  it("a body below the horizon never crosses, even inside the rectangle direction", () => {
    expect(frameCrossings(fixed(180, -5), { ...POSE, pitchDeg: -5 }, SOLSTICE_NOON, 1)).toEqual([]);
  });

  it("bisects the entry/exit of a swinging body to ≈ the analytic frame edge", () => {
    // At alt == pitch, entry happens where the HORIZONTAL half-angle is reached. For a roll-free
    // frame the horizontal half-angle at the centre row is atan(tan(fov/2)·aspect); the swing at
    // constant alt=30 crosses that offset in azimuth scaled by cos(alt) geometry — instead of
    // replicating the camera math, assert against azAltFrameMarker itself via a fine scan.
    const from = SOLSTICE_NOON;
    // Start well outside the ~40° horizontal half-angle so entry happens MID-scan.
    const s = swing(from, 100, 10, 30); // 10°/h eastward through south
    const wins = frameCrossings(s, POSE, from, 0.75, { stepMin: 5 }); // exit ≈ +12.4 h — mid-scan
    expect(wins.length).toBe(1);
    const w = wins[0];
    // The bisected edges bracket the predicate flip within tolerance: just inside at +1.5 s,
    // just outside at −1.5 s (the finder's tolerance is 1 s).
    const inside = (t: number) => {
      const p = s(t);
      return p.altDeg > 0 && azAltFrameMarker(p.azDeg, p.altDeg, POSE).inFrame;
    };
    expect(inside(w.startMs + 1_500)).toBe(true);
    expect(inside(w.startMs - 1_500)).toBe(false);
    expect(inside(w.endMs - 1_500)).toBe(true);
    expect(inside(w.endMs + 1_500)).toBe(false);
    // Peak = the pass nearest the centre: the swing crosses az=180 exactly 8 h after t0.
    expect(Math.abs(w.peakMs - (from + 8 * HOUR))).toBeLessThan(30_000);
  });

  it("classifies the skyline: clear above the wall, blocked below, mixed across", () => {
    const from = SOLSTICE_NOON;
    const parked = fixed(180, 30);
    expect(frameCrossings(parked, POSE, from, 0.2, { profileFn: () => 10 })[0].skyline).toBe("clear");
    expect(frameCrossings(parked, POSE, from, 0.2, { profileFn: () => 50 })[0].skyline).toBe("blocked");
    // A wall at 30° exactly on the south meridian, open elsewhere → the swinging body samples both.
    const s = swing(from, 160, 10, 30);
    const wall = (az: number) => (Math.abs(az - 180) < 5 ? 35 : 10);
    const win = frameCrossings(s, POSE, from, 0.3, { profileFn: wall })[0];
    expect(win.skyline).toBe("mixed");
  });

  it("respects maxWindows and the open-at-from honesty rule", () => {
    const from = SOLSTICE_NOON;
    // A fast swing enters/leaves the frame repeatedly over 3 days: cap at 2.
    const s: FrameSampler = (utcMs) => ({
      azDeg: 180 + 60 * Math.sin(((utcMs - from) / HOUR) * 0.8),
      altDeg: 30,
    });
    const wins = frameCrossings(s, POSE, from, 3, { maxWindows: 2 });
    expect(wins.length).toBe(2);
    // Parked body: the window opens AT from (in frame NOW).
    expect(frameCrossings(fixed(180, 30), POSE, from, 0.1)[0].startMs).toBe(from);
  });

  it("returns [] on a degenerate horizon", () => {
    expect(frameCrossings(fixed(180, 30), POSE, SOLSTICE_NOON, 0)).toEqual([]);
    expect(frameCrossings(fixed(180, 30), POSE, SOLSTICE_NOON, -1)).toEqual([]);
  });
});

describe("frameCrossings — the real sun over Dnipro", () => {
  it("a south-facing solstice frame catches the sun around local noon, tagged day-light", () => {
    const from = SOLSTICE_NOON - 8 * HOUR;
    const sun: FrameSampler = (utcMs) => horizontal("sun", utcMs, DNIPRO.latDeg, DNIPRO.lonDeg);
    // Solstice noon sun ≈ 65° alt due south: aim the frame there.
    const pose: FramePose = { ...DNIPRO, headingDeg: 180, pitchDeg: 60, fovDeg: 50, aspect: 16 / 9 };
    const wins = frameCrossings(sun, pose, from, 1);
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const noonWin = wins.find((w) => w.startMs <= SOLSTICE_NOON && SOLSTICE_NOON <= w.endMs);
    expect(noonWin).toBeDefined();
    expect(noonWin!.light).toBe("day");
    expect(noonWin!.moonIllum).toBeGreaterThanOrEqual(0);
    expect(noonWin!.moonIllum).toBeLessThanOrEqual(1);
  });
});

describe("nearestFrameCentre", () => {
  it("finds the exact centre pass of a swinging body", () => {
    const from = SOLSTICE_NOON;
    const s = swing(from, 140, 10, 30); // crosses az=180 at +4 h
    const hit = nearestFrameCentre(s, POSE, from, 0.5);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.utcMs - (from + 4 * HOUR))).toBeLessThan(30_000);
    expect(hit!.sepDeg).toBeLessThan(0.05);
  });

  it("answers even when the body never enters the frame, and honours requireUp", () => {
    const s = swing(SOLSTICE_NOON, 100, 5, 30); // approaches but stays ~west of south for 6 h
    const hit = nearestFrameCentre(s, POSE, SOLSTICE_NOON, 0.25);
    expect(hit).not.toBeNull();
    expect(hit!.sepDeg).toBeGreaterThan(0);
    const down = fixed(180, -10);
    expect(nearestFrameCentre(down, POSE, SOLSTICE_NOON, 0.25)).toBeNull();
    expect(nearestFrameCentre(down, POSE, SOLSTICE_NOON, 0.25, { requireUp: false })).not.toBeNull();
  });

  it("returns null on a degenerate horizon", () => {
    expect(nearestFrameCentre(fixed(180, 30), POSE, SOLSTICE_NOON, 0)).toBeNull();
  });
});
