import { describe, expect, it } from "vitest";
import { clockDayWindow, dayRiseSet, nextRiseSet } from "../../../src/lib/ephemeris/riseSet";
import { bodyTarget, fixedTarget, type SkyTarget } from "../../../src/lib/ephemeris/targets";

/**
 * THE DAY'S RISE / SET (owner 2026-10-25c): "for the sun and the moon (and most likely everything else) you
 * calculate for the NEXT calendar day, not the current one — if today the moon rises at 15:45 you write 16:08,
 * tomorrow's. Until the end of the day, 00:00, keep calculating all pairs for the CURRENT day; if the moon
 * rises today but sets tomorrow, add a micro indication like (+1)."
 *
 * Pinned: the clock-day window is browser-local midnight to midnight; each side is the day's own event even
 * when it has already passed (the contrast with `nextRiseSet`, the 2026-09-16 "next event" semantics the row
 * was built on); an event past the day's end carries the clock-day offset; a circumpolar object has none;
 * the pair rolls at midnight and stands still within the day.
 */

const DNIPRO = { lat: 48.4647, lon: 35.0462 };
/** A local wall-clock instant on a calendar date (the machine's zone — the row prints that clock). */
const local = (y: number, m0: number, d: number, h = 0, min = 0) => new Date(y, m0, d, h, min).getTime();
const sun = bodyTarget("sun");
const moon = bodyTarget("moon");
/** A fixed star (the riseSet.test idiom). */
const star = (id: string, raDeg: number, decDeg: number): SkyTarget =>
  fixedTarget({
    id,
    name: id,
    kind: "star",
    aliases: [],
    raDeg,
    decDeg,
    vmag: 1,
    facts: { kind: "dso", dsoType: "*", typeLabel: "STAR", constellation: "—", names: [] },
    source: "TEST",
  });

describe("clockDayWindow — the browser-local calendar day", () => {
  it("brackets the instant from local midnight to the next midnight (23 / 24 / 25 h on DST days)", () => {
    for (const ms of [local(2026, 7, 21, 15, 0), local(2026, 2, 29, 12, 0), local(2026, 9, 25, 23, 59)]) {
      const { startMs, endMs } = clockDayWindow(ms);
      expect(startMs).toBeLessThanOrEqual(ms);
      expect(endMs).toBeGreaterThan(ms);
      expect(new Date(startMs).getHours()).toBe(0);
      expect(new Date(startMs).getMinutes()).toBe(0);
      expect([23, 24, 25]).toContain(Math.round((endMs - startMs) / 3_600_000));
      expect(new Date(endMs).getDate()).toBe(new Date(ms).getDate() + 1 || 1);
    }
  });
  it("23:59 and 00:01 fall in different days", () => {
    const a = clockDayWindow(local(2026, 7, 21, 23, 59));
    const b = clockDayWindow(local(2026, 7, 22, 0, 1));
    expect(b.startMs).toBe(a.endMs);
  });
});

describe("dayRiseSet — the sun", () => {
  it("at 15:00 the rise is TODAY'S, already passed — where nextRiseSet gave tomorrow's", () => {
    const now = local(2026, 7, 21, 15, 0);
    const day = dayRiseSet(sun, now, DNIPRO.lat, DNIPRO.lon);
    const next = nextRiseSet(sun, now, DNIPRO.lat, DNIPRO.lon);
    expect(day.rise).not.toBeNull();
    expect(day.rise!.ms).toBeLessThan(now); // this morning
    expect(day.rise!.dayOffset).toBe(0);
    expect(next.riseMs!).toBeGreaterThan(now); // the old row: tomorrow morning
    expect(next.riseMs! - day.rise!.ms).toBeGreaterThan(23 * 3_600_000);
    expect(next.riseMs! - day.rise!.ms).toBeLessThan(25 * 3_600_000);
    // the set is this evening — the same instant both ways
    expect(day.set!.dayOffset).toBe(0);
    expect(Math.abs(day.set!.ms - next.setMs!)).toBeLessThan(1000); // the finder converges within ms from either start
    expect(day.set!.ms).toBeGreaterThan(now);
  });
  it("both events sit inside the clock day; the pair is the same at 00:30, 12:00 and 23:30 of that day", () => {
    const a = dayRiseSet(sun, local(2026, 7, 21, 0, 30), DNIPRO.lat, DNIPRO.lon);
    const b = dayRiseSet(sun, local(2026, 7, 21, 12, 0), DNIPRO.lat, DNIPRO.lon);
    const c = dayRiseSet(sun, local(2026, 7, 21, 23, 30), DNIPRO.lat, DNIPRO.lon);
    expect(b.rise!.ms).toBe(a.rise!.ms);
    expect(c.rise!.ms).toBe(a.rise!.ms);
    expect(c.set!.ms).toBe(a.set!.ms);
    for (const e of [a.rise!, a.set!]) {
      expect(e.ms).toBeGreaterThanOrEqual(a.dayStartMs);
      expect(e.ms).toBeLessThan(a.dayEndMs);
      expect(e.dayOffset).toBe(0);
    }
  });
  it("rolls at midnight: the next day's pair is a day later", () => {
    const a = dayRiseSet(sun, local(2026, 7, 21, 23, 59), DNIPRO.lat, DNIPRO.lon);
    const b = dayRiseSet(sun, local(2026, 7, 22, 0, 1), DNIPRO.lat, DNIPRO.lon);
    expect(b.dayStartMs).toBe(a.dayEndMs);
    expect(b.rise!.ms - a.rise!.ms).toBeGreaterThan(23 * 3_600_000);
    expect(b.rise!.ms - a.rise!.ms).toBeLessThan(25 * 3_600_000);
  });
});

describe("dayRiseSet — the moon", () => {
  it("every event is at or after the day's start; an event past the day's end carries the clock-day offset", () => {
    for (let d = 1; d <= 40; d++) {
      const now = local(2026, 8, d, 12, 0);
      const rs = dayRiseSet(moon, now, DNIPRO.lat, DNIPRO.lon);
      for (const e of [rs.rise, rs.set]) {
        if (e === null) continue;
        expect(e.ms).toBeGreaterThanOrEqual(rs.dayStartMs);
        if (e.ms < rs.dayEndMs) expect(e.dayOffset).toBe(0);
        else {
          expect(e.dayOffset).toBeGreaterThanOrEqual(1);
          expect(e.dayOffset).toBe(Math.round((clockDayWindow(e.ms).startMs - rs.dayStartMs) / 86_400_000));
        }
      }
    }
  });
  it("within forty days the moon skips a rise or a set on some clock day — that side reads +1 (the owner's case)", () => {
    const marks: string[] = [];
    for (let d = 1; d <= 40; d++) {
      const rs = dayRiseSet(moon, local(2026, 8, d, 12, 0), DNIPRO.lat, DNIPRO.lon);
      if (rs.rise?.dayOffset === 1) marks.push(`rise+1@${d}`);
      if (rs.set?.dayOffset === 1) marks.push(`set+1@${d}`);
    }
    expect(marks.length).toBeGreaterThan(0);
    // and never more than a day ahead — two days always hold one of each
    for (let d = 1; d <= 40; d++) {
      const rs = dayRiseSet(moon, local(2026, 8, d, 12, 0), DNIPRO.lat, DNIPRO.lon);
      for (const e of [rs.rise, rs.set]) if (e) expect(e.dayOffset).toBeLessThanOrEqual(1);
    }
  });
  it("the moon up since 15:45 (the owner's example): the rise shown is TODAY'S, not tomorrow's", () => {
    // Find a September day on which the moon rises in the afternoon, then look at 20:00 that evening.
    let found = false;
    for (let d = 1; d <= 30 && !found; d++) {
      const rs = dayRiseSet(moon, local(2026, 8, d, 20, 0), DNIPRO.lat, DNIPRO.lon);
      if (!rs.rise || rs.rise.dayOffset !== 0) continue;
      const h = new Date(rs.rise.ms).getHours();
      if (h < 13 || h > 19) continue;
      found = true;
      const now = local(2026, 8, d, 20, 0);
      expect(rs.rise.ms).toBeLessThan(now); // already up
      const next = nextRiseSet(moon, now, DNIPRO.lat, DNIPRO.lon);
      expect(next.riseMs!).toBeGreaterThan(now); // the old row's "tomorrow"
      expect(next.riseMs! - rs.rise.ms).toBeGreaterThan(20 * 3_600_000);
    }
    expect(found).toBe(true);
  });
});

describe("dayRiseSet — point targets", () => {
  it("a circumpolar star from Dnipro has no rise and no set", () => {
    const polaris = star("star:polaris", 37.95, 89.264);
    const rs = dayRiseSet(polaris, local(2026, 7, 21, 12, 0), DNIPRO.lat, DNIPRO.lon);
    expect(rs.rise).toBeNull();
    expect(rs.set).toBeNull();
  });
  it("a mid-declination star: both events on the clock day or marked +1, never before the day's start", () => {
    const sirius = star("star:sirius", 101.29, -16.716);
    const rs = dayRiseSet(sirius, local(2026, 7, 21, 12, 0), DNIPRO.lat, DNIPRO.lon);
    for (const e of [rs.rise, rs.set]) {
      expect(e).not.toBeNull();
      expect(e!.ms).toBeGreaterThanOrEqual(rs.dayStartMs);
      expect([0, 1]).toContain(e!.dayOffset);
    }
  });
});
