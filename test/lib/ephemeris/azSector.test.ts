import { describe, expect, it } from "vitest";
import {
  aimDayFromSamples,
  fractureRunsBySkyline,
  lerpAzDeg,
  norm360,
  sampleAimDay,
  splitAimRuns,
  wrap180,
  type AimSample,
} from "../../../src/lib/ephemeris/azSector";
import { bodyTarget } from "../../../src/lib/ephemeris/targets";
import { localDayWindow } from "../../../src/lib/ephemeris/dayArc";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Synthetic day: samples every hour from t=0 to t=24h inclusive. */
function day(alts: (h: number) => number, azs: (h: number) => number): AimSample[] {
  const out: AimSample[] = [];
  for (let h = 0; h <= 24; h++) out.push({ utcMs: h * HOUR, altDeg: alts(h), azDeg: azs(h) });
  return out;
}

describe("wrap180 / norm360 / lerpAzDeg", () => {
  it("wraps to [−180, 180)", () => {
    expect(wrap180(0)).toBe(0);
    expect(wrap180(180)).toBe(-180);
    expect(wrap180(-180)).toBe(-180);
    expect(wrap180(350)).toBe(-10);
    expect(wrap180(-350)).toBe(10);
    expect(wrap180(720 + 15)).toBe(15);
  });

  it("norm360 lands in [0, 360)", () => {
    expect(norm360(360)).toBe(0);
    expect(norm360(-10)).toBe(350);
    expect(norm360(725)).toBe(5);
  });

  it("lerps the short way across north", () => {
    // 350° → 10° is +20° through 0, not −340°.
    expect(lerpAzDeg(350, 10, 0.5)).toBeCloseTo(0, 10);
    expect(lerpAzDeg(350, 10, 0.25)).toBeCloseTo(355, 10);
    // And the reverse direction.
    expect(lerpAzDeg(10, 350, 0.5)).toBeCloseTo(0, 10);
  });
});

describe("aimDayFromSamples", () => {
  it("one rise→set run with interpolated horizon edges", () => {
    // Up between h=6 (alt crosses 0 between 5 and 6) and h=18.
    const samples = day(
      (h) => (h >= 6 && h <= 18 ? 30 : -30),
      (h) => norm360(h * 15),
    );
    const d = aimDayFromSamples(samples, 0, DAY);
    expect(d.kind).toBe("arc");
    expect(d.runs).toHaveLength(1);
    const run = d.runs[0];
    // Edges are the interpolated crossings, altDeg ≈ 0.
    expect(run[0].altDeg).toBeCloseTo(0, 10);
    expect(run[run.length - 1].altDeg).toBeCloseTo(0, 10);
    // −30 → +30 crosses zero halfway between h=5 and h=6.
    expect(run[0].utcMs).toBeCloseTo(5.5 * HOUR, 5);
    expect(run[run.length - 1].utcMs).toBeCloseTo(18.5 * HOUR, 5);
    // Interior samples preserved in time order.
    for (let i = 1; i < run.length; i++) expect(run[i].utcMs).toBeGreaterThan(run[i - 1].utcMs);
  });

  it("circumpolar day is a ring (single run, no crossings)", () => {
    const samples = day(
      () => 25,
      (h) => norm360(h * 15),
    );
    const d = aimDayFromSamples(samples, 0, DAY);
    expect(d.kind).toBe("ring");
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]).toHaveLength(25); // all samples, no interpolated edges
  });

  it("never-up day is none", () => {
    const d = aimDayFromSamples(
      day(
        () => -5,
        (h) => norm360(h * 15),
      ),
      0,
      DAY,
    );
    expect(d.kind).toBe("none");
    expect(d.runs).toHaveLength(0);
  });

  it("two runs when the body is up at both window edges (moon shape)", () => {
    // Up h=0..3 (sets), down, up again h=20..24 — cut by the window at both ends.
    const samples = day(
      (h) => (h <= 3 || h >= 20 ? 20 : -20),
      (h) => norm360(h * 15),
    );
    const d = aimDayFromSamples(samples, 0, DAY);
    expect(d.kind).toBe("arc");
    expect(d.runs).toHaveLength(2);
    // First run starts at the window edge (no synthetic crossing before it).
    expect(d.runs[0][0].utcMs).toBe(0);
    // Second run ends at the window edge.
    const r2 = d.runs[1];
    expect(r2[r2.length - 1].utcMs).toBe(24 * HOUR);
  });

  it("azimuth interpolation at the horizon crossing is wrap-aware", () => {
    // Crossing between az 350° and 10° — the edge must land near 0°, never ~180°.
    const samples: AimSample[] = [
      { utcMs: 0, altDeg: -10, azDeg: 350 },
      { utcMs: HOUR, altDeg: 10, azDeg: 10 },
      { utcMs: 2 * HOUR, altDeg: -10, azDeg: 30 },
    ];
    const d = aimDayFromSamples(samples, 0, 2 * HOUR);
    const edge = d.runs[0][0];
    expect(Math.abs(wrap180(edge.azDeg - 0))).toBeLessThan(1e-9);
  });
});

describe("splitAimRuns", () => {
  const samples = day(
    (h) => (h >= 6 && h <= 18 ? 30 : -30),
    (h) => norm360(h * 15),
  );
  const d = aimDayFromSamples(samples, 0, DAY);

  it("splits a straddling run at an interpolated now-sample shared by both halves", () => {
    const s = splitAimRuns(d, 12.5 * HOUR);
    expect(s.past).toHaveLength(1);
    expect(s.future).toHaveLength(1);
    const p = s.past[0];
    const f = s.future[0];
    expect(p[p.length - 1].utcMs).toBe(12.5 * HOUR);
    expect(f[0].utcMs).toBe(12.5 * HOUR);
    // The meeting sample is identical — the two paths join without a gap.
    expect(p[p.length - 1].azDeg).toBeCloseTo(f[0].azDeg, 10);
    // Amber grows through the day: later split → longer past.
    const later = splitAimRuns(d, 16 * HOUR);
    expect(later.past[0].length).toBeGreaterThan(p.length);
  });

  it("before-rise the whole run is future; after-set it is past", () => {
    const before = splitAimRuns(d, 2 * HOUR);
    expect(before.past).toHaveLength(0);
    expect(before.future).toHaveLength(1);
    const after = splitAimRuns(d, 22 * HOUR);
    expect(after.past).toHaveLength(1);
    expect(after.future).toHaveLength(0);
  });
});

describe("sampleAimDay (real ephemeris, Dnipro)", () => {
  // Dnipro 48.4647N / 35.0462E, 2026-06-21 (near-solstice): the sun rises far NE and sets far
  // NW. Loose ±4° tolerances — the edges are airless sample interpolations, not almanac rows.
  const LAT = 48.4647;
  const LON = 35.0462;
  const noonUtc = Date.UTC(2026, 5, 21, 10, 0, 0); // ~solar noon at lon 35°E

  it("summer sun is a single NE→NW arc", () => {
    const d = sampleAimDay(bodyTarget("sun"), noonUtc, LAT, LON);
    expect(d.kind).toBe("arc");
    expect(d.runs).toHaveLength(1);
    const run = d.runs[0];
    const rise = run[0];
    const set = run[run.length - 1];
    // Vector: timeanddate.com Dnipro 2026-06-21 — sunrise az ≈51° (NE), sunset az ≈309° (NW).
    expect(Math.abs(wrap180(rise.azDeg - 51))).toBeLessThan(4); // NE
    expect(Math.abs(wrap180(set.azDeg - 309))).toBeLessThan(4); // NW
    // The window really is the local solar day containing the instant.
    const w = localDayWindow(noonUtc, LON);
    expect(d.startMs).toBe(w.startMs);
    expect(d.endMs).toBe(w.endMs);
    // Azimuth sweeps monotonically clockwise through south between the edges.
    for (let i = 1; i < run.length; i++) {
      expect(wrap180(run[i].azDeg - run[i - 1].azDeg)).toBeGreaterThan(0);
    }
  });
});

describe("fractureRunsBySkyline — radar occlusion gaps (owner QA 2026-08-21 item 3)", () => {
  // Six samples marching east→SE, climbing: az 90+10i, alt 10+2i.
  const run: AimSample[] = Array.from({ length: 6 }, (_, i) => ({
    utcMs: i * HOUR,
    azDeg: 90 + 10 * i,
    altDeg: 10 + 2 * i,
  }));
  /** A 30° building wall over az (105, 125) — hides the az-110 and az-120 samples. */
  const wall = (azDeg: number) => (azDeg > 105 && azDeg < 125 ? 30 : 0);

  it("null sampler returns the runs UNTOUCHED (no profile ⇒ no gap claim)", () => {
    const runs = [run];
    expect(fractureRunsBySkyline(runs, null)).toBe(runs);
  });

  it("a blocked middle span becomes a GAP — one run fractures into two sub-runs", () => {
    const out = fractureRunsBySkyline([run], wall);
    expect(out).toHaveLength(2);
    expect(out[0].map((s) => s.azDeg)).toEqual([90, 100]);
    expect(out[1].map((s) => s.azDeg)).toEqual([130, 140]);
  });

  it("an all-clear sampler preserves every sample; an all-blocking one erases the run", () => {
    expect(fractureRunsBySkyline([run], () => 0)[0]).toEqual(run);
    expect(fractureRunsBySkyline([run], () => 90)).toEqual([]);
  });

  it("sub-runs shorter than 2 samples are dropped (cannot draw)", () => {
    // Only the az-130 sample clears this skyline — a 1-sample island, dropped.
    const out = fractureRunsBySkyline([run], (az) => (az > 125 && az < 135 ? 0 : 90));
    expect(out).toEqual([]);
  });

  it("exactly-at-skyline counts as VISIBLE (altDeg >= skyline keeps the sample)", () => {
    const out = fractureRunsBySkyline([run], () => 10); // first sample sits exactly at 10°
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(run);
  });
});
