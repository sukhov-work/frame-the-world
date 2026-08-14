import { describe, expect, it } from "vitest";
import {
  moonCalendar,
  nextSupermoons,
  SUPERMOON_MAX_KM,
} from "../../../src/lib/ephemeris/moonCalendar";

const FROM = Date.UTC(2026, 7, 1); // 2026-08-01

describe("moonCalendar", () => {
  const events = moonCalendar(FROM, 60);

  it("walks two lunations of quarters + apsides, time-sorted", () => {
    const quarters = events.filter((e) =>
      ["newMoon", "firstQuarter", "fullMoon", "thirdQuarter"].includes(e.kind),
    );
    const apsides = events.filter((e) => e.kind === "perigee" || e.kind === "apogee");
    expect(quarters.length).toBeGreaterThanOrEqual(7); // ~8 quarters in 60 d
    expect(apsides.length).toBeGreaterThanOrEqual(4); // ~2 perigees + 2 apogees
    for (let i = 1; i < events.length; i++)
      expect(events[i].utcMs).toBeGreaterThanOrEqual(events[i - 1].utcMs);
  });

  it("every event stays inside the range and carries physical annotations", () => {
    for (const e of events) {
      expect(e.utcMs).toBeGreaterThanOrEqual(FROM);
      expect(e.utcMs).toBeLessThanOrEqual(FROM + 60 * 86_400_000);
      expect(e.distanceKm).toBeGreaterThan(350_000);
      expect(e.distanceKm).toBeLessThan(410_000);
      expect(e.discArcmin).toBeGreaterThan(28);
      expect(e.discArcmin).toBeLessThan(34.5);
      expect(e.illum).toBeGreaterThanOrEqual(0);
      expect(e.illum).toBeLessThanOrEqual(1);
    }
  });

  it("phase geometry is honest: full ≈ 1, new ≈ 0 illumination", () => {
    for (const e of events) {
      if (e.kind === "fullMoon") expect(e.illum).toBeGreaterThan(0.97);
      if (e.kind === "newMoon") expect(e.illum).toBeLessThan(0.03);
    }
  });

  it("perigee is nearer than apogee, always", () => {
    const per = events.filter((e) => e.kind === "perigee").map((e) => e.distanceKm);
    const apo = events.filter((e) => e.kind === "apogee").map((e) => e.distanceKm);
    expect(Math.max(...per)).toBeLessThan(Math.min(...apo));
  });

  it("supermoon tag only ever sits on a full moon within the threshold", () => {
    for (const e of events) {
      if (e.supermoon) {
        expect(e.kind).toBe("fullMoon");
        expect(e.distanceKm).toBeLessThanOrEqual(SUPERMOON_MAX_KM);
      }
    }
  });
});

describe("nextSupermoons", () => {
  it("finds upcoming supermoons, each a threshold-passing full moon", () => {
    const sm = nextSupermoons(FROM, 2);
    expect(sm.length).toBeGreaterThanOrEqual(1); // there is at least one within ~5 lunations of any epoch year
    for (const e of sm) {
      expect(e.kind).toBe("fullMoon");
      expect(e.supermoon).toBe(true);
      expect(e.distanceKm).toBeLessThanOrEqual(SUPERMOON_MAX_KM);
    }
  });
});
