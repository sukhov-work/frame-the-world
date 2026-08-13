import { describe, expect, it } from "vitest";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import {
  MW_DARK_SUN_DEG,
  MW_MIN_ALT_DEG,
  mwArcTiltDeg,
  mwSeason,
} from "../../../src/lib/ephemeris/mwSeason";
import { galacticCentreTarget, targetAzAlt } from "../../../src/lib/ephemeris/targets";
import type { PlanObserver } from "../../../src/lib/ephemeris/planner";

const DNIPRO: PlanObserver = { latDeg: 48.4647, lonDeg: 35.0462, groundAltM: 0, eyeAboveGroundM: 1.6 };
const utc = (iso: string) => Date.parse(iso);
const GC = galacticCentreTarget();

describe("mwSeason", () => {
  it("returns one row per local night, day-stepped", () => {
    const nights = mwSeason(utc("2026-08-12T00:00:00Z"), DNIPRO, GC, { days: 3 });
    expect(nights).toHaveLength(3);
    expect(nights[1].dayStartMs - nights[0].dayStartMs).toBe(24 * 3600_000);
    expect(nights[2].dayStartMs - nights[1].dayStartMs).toBe(24 * 3600_000);
  });

  it("mid-August Dnipro is IN season: a real dark window, gated at −18°/+5°", () => {
    const nights = mwSeason(utc("2026-08-12T00:00:00Z"), DNIPRO, GC, { days: 2 });
    const withWindow = nights.filter((n) => n.window != null);
    expect(withWindow.length).toBeGreaterThan(0);
    for (const n of withWindow) {
      const w = n.window!;
      expect(n.usableMinutes).toBeGreaterThan(0);
      // Both edges are qualifying samples: sun in astronomical darkness, GC above the floor.
      expect(horizontal("sun", w.startMs, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg).toBeLessThan(
        MW_DARK_SUN_DEG,
      );
      expect(horizontal("sun", w.endMs, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg).toBeLessThan(
        MW_DARK_SUN_DEG,
      );
      expect(targetAzAlt(GC, w.peakMs, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg).toBeGreaterThan(
        MW_MIN_ALT_DEG,
      );
      // Score algebra holds and interference stays a fraction.
      expect(n.moonInterference).toBeGreaterThanOrEqual(0);
      expect(n.moonInterference).toBeLessThanOrEqual(1);
      expect(n.score).toBeCloseTo(n.usableMinutes * (1 - n.moonInterference), 9);
    }
  });

  it("December Dnipro is OUT of season: the sun sits on the GC (RA ≈ 18h) — no windows", () => {
    const nights = mwSeason(utc("2026-12-18T00:00:00Z"), DNIPRO, GC, { days: 4 });
    for (const n of nights) {
      expect(n.window).toBeNull();
      expect(n.usableMinutes).toBe(0);
      expect(n.score).toBe(0);
    }
  });
});

describe("mwArcTiltDeg", () => {
  it("stays in [0, 90] across a night", () => {
    const start = utc("2026-08-12T18:00:00Z");
    for (let i = 0; i < 12; i++) {
      const tilt = mwArcTiltDeg(start + i * 3600_000, DNIPRO.latDeg, DNIPRO.lonDeg);
      expect(tilt).toBeGreaterThanOrEqual(0);
      expect(tilt).toBeLessThanOrEqual(90);
    }
  });

  it("literature anchor: at the pole, the band crosses the horizon at the galactic inclination (62.87°)", () => {
    // At lat 90 the horizon IS the celestial equator, so the galactic equator's tilt at its
    // ascending node (l ≈ 32.93°, where dec = 0) is the plane inclination itself: 62.87°.
    // lat 89.9 avoids the exactly-degenerate ENU basis; ANY time works — the pole sky only spins.
    for (const node of [32.93, 212.93]) {
      const tilt = mwArcTiltDeg(utc("2026-08-12T00:00:00Z"), 89.9, 0, node);
      expect(Math.abs(tilt - 62.87)).toBeLessThan(1.5);
    }
  });

  it("is stable under sampling-epsilon refinement (great-circle tangent, not chord noise)", () => {
    const t = utc("2026-08-12T22:00:00Z");
    const a = mwArcTiltDeg(t, DNIPRO.latDeg, DNIPRO.lonDeg, 0);
    const b = mwArcTiltDeg(t, DNIPRO.latDeg, DNIPRO.lonDeg, 0.001);
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});
