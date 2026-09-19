import { describe, expect, it } from "vitest";
import { circDiffDeg } from "../../../src/lib/sensors/deviceOrientation";
import { YAW_TRIM_DEFAULTS, YawTrim } from "../../../src/lib/sensors/yawTrim";

/**
 * YAW TRIM (owner order 2026-09-19) — "the image drifts each time you move the phone from side to
 * side". The relative (gyro-led) attitude drives; the compass only OBSERVES the yaw offset, and
 * this filter decides how much of each observation to believe. Every gate is pinned here with the
 * numbers the 2026-09-19 research defends (DECISIONS 2026-09-19).
 */

const D = YAW_TRIM_DEFAULTS;
const HZ = 16; // ms per observation (~60 Hz)

/** Feed a constant observation for `ms` at 60 Hz, quasi-static; returns the last time fed. */
function feed(t: YawTrim, obs: number | ((tMs: number) => number), fromMs: number, ms: number, rate = 0): number {
  let now = fromMs;
  for (; now <= fromMs + ms; now += HZ) t.observe(typeof obs === "number" ? obs : obs(now), now, rate);
  return now;
}

describe("YawTrim — acquisition", () => {
  it("the FIRST fix lands exactly: north is right from the first frame", () => {
    const t = new YawTrim();
    expect(t.has()).toBe(false);
    expect(t.offsetDeg()).toBe(0);
    expect(t.observe(137.25, 0, 0)).toBe(137.25);
    expect(t.state()).toBe("acquiring");
  });

  it("the fast window refines that one noisy sample, then hands over to the slow trim", () => {
    const t = new YawTrim();
    t.observe(140, 0, 0); // a first sample 3° off the real 137
    const end = feed(t, 137, HZ, D.acquireMs - 2 * HZ);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 137))).toBeLessThan(0.6); // τ 800 ms over 1.5 s
    t.observe(137, end + D.acquireMs, 0);
    expect(t.state()).not.toBe("acquiring");
  });

  it("works across the 0/360 seam", () => {
    const t = new YawTrim();
    t.observe(359, 0, 0);
    feed(t, 2, HZ, D.acquireMs - 2 * HZ);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 2))).toBeLessThan(0.6);
  });
});

/** A trim that has acquired `at` and is past its fast window, with a full quiet window. */
function settled(at: number, opts = {}): { t: YawTrim; now: number } {
  const t = new YawTrim(opts);
  const now = feed(t, at, 0, D.acquireMs + D.windowMs + 100);
  expect(Math.abs(circDiffDeg(t.offsetDeg(), at))).toBeLessThan(1e-6);
  return { t, now };
}

describe("YawTrim — the slow, rate-capped trim (corrections the eye cannot see)", () => {
  it("a 6° gyro creep is re-absorbed — and never faster than the cap", () => {
    const { t, now } = settled(100);
    let prev = t.offsetDeg();
    let maxStep = 0;
    let at = now;
    for (; at < now + 12_000; at += HZ) {
      const o = t.observe(106, at, 0);
      maxStep = Math.max(maxStep, Math.abs(circDiffDeg(o, prev)));
      prev = o;
    }
    expect(maxStep).toBeLessThanOrEqual((D.maxRateDegPerS * HZ) / 1000 + 1e-9); // ≤ 1.5°/s
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 106))).toBeLessThan(1.5); // τ 8 s: most of it after 12 s
    expect(t.state()).toBe("trimming");
  });

  it("after a visual calibration the trim slows again — the user's eyes outrank the magnetometer", () => {
    const a = settled(100);
    const b = settled(100);
    b.t.commit(0, b.now); // calibrated, no drag
    expect(b.t.isCalibrated()).toBe(true);
    for (let at = a.now; at < a.now + 4000; at += HZ) {
      a.t.observe(103, at, 0);
      b.t.observe(103, at, 0);
    }
    const movedA = Math.abs(circDiffDeg(a.t.offsetDeg(), 100));
    const movedB = Math.abs(circDiffDeg(b.t.offsetDeg(), 100));
    expect(movedB).toBeLessThan(movedA / 3);
    expect(movedB).toBeLessThanOrEqual(D.calibratedMaxRateDegPerS * 4 + 1e-9);
  });
});

describe("YawTrim — the gates", () => {
  it("FROZEN while the phone swings, and for the settle time after: a lagging compass moves nothing", () => {
    const { t, now } = settled(100);
    // a swing: 120°/s, the compass observation is 25° off for its duration
    let at = now;
    for (; at < now + 1500; at += HZ) t.observe(125, at, 120);
    expect(t.offsetDeg()).toBeCloseTo(100, 9);
    expect(t.state()).toBe("frozen-rate");
    // the phone stops; the compass is STILL catching up for 300 ms — inside the settle window
    for (; at < now + 1500 + D.settleMs - HZ; at += HZ) t.observe(118, at, 2);
    expect(t.offsetDeg()).toBeCloseTo(100, 9);
  });

  it("FROZEN while the FIELD moves: compass − gyro sliding with the phone still = a disturbed field", () => {
    const { t, now } = settled(100);
    // the observation slides 8°/s (a car driving past / walking by a steel railing)
    let at = now;
    for (; at < now + 2000; at += HZ) t.observe(100 + ((at - now) / 1000) * 8, at, 1);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 100))).toBeLessThan(0.5);
    expect(t.state()).toBe("frozen-field");
  });

  it("FROZEN while the observations disagree with each other (spread)", () => {
    const { t, now } = settled(100);
    let i = 0;
    for (let at = now; at < now + 2000; at += HZ) t.observe(100 + (i++ % 2 ? 9 : -9), at, 0);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 100))).toBeLessThan(0.2);
    expect(t.state()).toBe("frozen-field");
  });

  it("a BIG disagreement must persist, and is then slewed — never jumped", () => {
    const { t, now } = settled(100);
    let at = now;
    // …a short one is ignored entirely
    for (; at < now + D.jumpHoldMs - 500; at += HZ) t.observe(160, at, 0);
    expect(t.offsetDeg()).toBeCloseTo(100, 9);
    expect(t.state()).toBe("jump-hold");
    // …it goes away: nothing happened
    at = feed(t, 100, at, D.windowMs + 200);
    expect(t.offsetDeg()).toBeCloseTo(100, 6);
    // …a persistent one (the compass really was re-calibrated by a figure-8) is followed at the slew rate
    const start = at;
    let prev = t.offsetDeg();
    let maxStep = 0;
    for (; at < start + D.jumpHoldMs + D.windowMs + 12_000; at += HZ) {
      const o = t.observe(160, at, 0);
      maxStep = Math.max(maxStep, Math.abs(circDiffDeg(o, prev)));
      prev = o;
    }
    expect(maxStep).toBeLessThanOrEqual((D.jumpSlewDegPerS * HZ) / 1000 + 1e-9);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 160))).toBeLessThan(3);
  });

  it("garbage observations are ignored; a long gap is not one giant step", () => {
    const { t, now } = settled(100);
    expect(t.observe(NaN, now, 0)).toBeCloseTo(100, 9);
    expect(t.observe(100, NaN, 0)).toBeCloseTo(100, 9);
    // 10 minutes of silence, then a 5° disagreement: the first step integrates ≤ maxStepMs
    const o = feed(t, 105, now + 600_000, 200);
    expect(o).toBeGreaterThan(0);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), 100))).toBeLessThan(0.5);
  });
});

describe("YawTrim — the user's calibration is a measured compass BIAS", () => {
  it("setBias moves the offset AT ONCE by the change (a stored calibration arriving, RESET)", () => {
    const { t, now } = settled(100);
    t.setBias(4);
    expect(t.offsetDeg()).toBeCloseTo(104, 9);
    // …and the same compass reading now AGREES with it: nothing pulls it back
    feed(t, 100, now, 5000);
    expect(t.offsetDeg()).toBeCloseTo(104, 6);
    t.setBias(0);
    expect(t.offsetDeg()).toBeCloseTo(100, 6);
    t.setBias(0); // idempotent
    expect(t.offsetDeg()).toBeCloseTo(100, 6);
  });

  it("CONFIRM: the offset takes the drag whole, the bias is what makes the compass agree — nothing drifts afterwards", () => {
    const { t, now } = settled(100);
    const bias = t.commit(-7, now);
    expect(bias).toBeCloseTo(-7, 6);
    expect(t.offsetDeg()).toBeCloseTo(93, 6);
    feed(t, 100, now + HZ, 20_000);
    expect(t.offsetDeg()).toBeCloseTo(93, 4); // the calibrated view HOLDS
  });

  it("CONFIRM while the trim had NOT converged: the residual goes into the bias, not into a later pull", () => {
    const { t, now } = settled(100);
    // the compass now reads 104 but the slow trim has barely started toward it
    let at = feed(t, 104, now, 1200);
    const before = t.offsetDeg();
    expect(circDiffDeg(104, before)).toBeGreaterThan(2); // unconverged by > 2°
    // the user aligns by eye: truth is 1° right of the current view
    const bias = t.commit(1, at);
    const truth = circDiffDeg(before + 1, 0);
    expect(t.offsetDeg()).toBeCloseTo(truth, 6);
    expect(bias).toBeCloseTo(circDiffDeg(truth, 104), 3); // truth − compass, NOT 0 + 1
    at = feed(t, 104, at + HZ, 30_000);
    expect(Math.abs(circDiffDeg(t.offsetDeg(), truth))).toBeLessThan(0.05); // no later pull
  });

  it("CONFIRM before any observation just carries the drag; reacquire keeps the bias, reset keeps it too but un-calibrates", () => {
    const t = new YawTrim();
    expect(t.commit(5, 0)).toBe(5);
    expect(t.observe(200, 10, 0)).toBe(205); // the first fix lands on observation + bias
    t.reacquire();
    expect(t.has()).toBe(false);
    expect(t.biasDeg()).toBe(5);
    expect(t.isCalibrated()).toBe(true);
    t.reset();
    expect(t.biasDeg()).toBe(5);
    expect(t.isCalibrated()).toBe(false);
  });
});
