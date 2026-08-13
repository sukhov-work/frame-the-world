import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  hourTicksBetween,
  localDateStr,
  localTimeStr,
  playbackNowMs,
  timeToFraction,
  useTimeStore,
  withLocalDate,
  withLocalTime,
} from "../../src/store/time";

const ANCHOR = Date.UTC(2026, 6, 10, 12, 0, 0);
const WINDOW = 24 * 3_600_000;

describe("scrub window math", () => {
  it("centres the anchor on the rail", () => {
    expect(timeToFraction(ANCHOR, ANCHOR, WINDOW)).toBe(0.5);
    expect(fractionToTime(0.5, ANCHOR, WINDOW)).toBe(ANCHOR);
  });

  it("maps the window edges to the rail ends", () => {
    expect(timeToFraction(ANCHOR - WINDOW / 2, ANCHOR, WINDOW)).toBe(0);
    expect(timeToFraction(ANCHOR + WINDOW / 2, ANCHOR, WINDOW)).toBe(1);
    expect(fractionToTime(0, ANCHOR, WINDOW)).toBe(ANCHOR - WINDOW / 2);
    expect(fractionToTime(1, ANCHOR, WINDOW)).toBe(ANCHOR + WINDOW / 2);
  });

  it("round-trips and clamps outside the window", () => {
    const t = ANCHOR + 3.25 * 3_600_000;
    expect(fractionToTime(timeToFraction(t, ANCHOR, WINDOW), ANCHOR, WINDOW)).toBe(t);
    expect(timeToFraction(ANCHOR + WINDOW, ANCHOR, WINDOW)).toBe(1); // beyond the rail — clamped
    expect(fractionToTime(1.4, ANCHOR, WINDOW)).toBe(ANCHOR + WINDOW / 2);
  });
});

describe("date jump (multiday scrubber)", () => {
  // Local-timezone semantics by design — assertions compare local fields, so they hold in any TZ.
  const base = new Date(2026, 6, 10, 15, 42, 17, 250).getTime(); // Jul 10, 15:42:17.250 local

  it("localDateStr formats the local calendar date as YYYY-MM-DD", () => {
    expect(localDateStr(base)).toBe("2026-07-10");
    expect(localDateStr(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });

  it("moves to another date preserving the local time-of-day", () => {
    const ms = withLocalDate(base, "2026-12-21")!;
    const d = new Date(ms);
    expect(localDateStr(ms)).toBe("2026-12-21");
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      15, 42, 17, 250,
    ]);
  });

  it("round-trips through its own formatter and crosses years", () => {
    const ms = withLocalDate(base, "2031-02-28")!;
    expect(localDateStr(ms)).toBe("2031-02-28");
    expect(withLocalDate(ms, localDateStr(base))).not.toBeNull();
  });

  it("rejects malformed input (a cleared date field must not scrub the scene)", () => {
    expect(withLocalDate(base, "")).toBeNull();
    expect(withLocalDate(base, "2026-13")).toBeNull();
    expect(withLocalDate(base, "not-a-date")).toBeNull();
  });
});

describe("time-of-day jump (calendar precise time, owner 2026-07-14)", () => {
  const base = new Date(2026, 6, 10, 15, 42, 17, 250).getTime(); // Jul 10, 15:42:17.250 local

  it("localTimeStr formats the local wall time as HH:MM", () => {
    expect(localTimeStr(base)).toBe("15:42");
    expect(localTimeStr(new Date(2026, 0, 5, 4, 7).getTime())).toBe("04:07");
  });

  it("moves the wall time keeping the calendar date (seconds reset)", () => {
    const ms = withLocalTime(base, "04:05")!;
    const d = new Date(ms);
    expect(localDateStr(ms)).toBe("2026-07-10");
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      4, 5, 0, 0,
    ]);
  });

  it("accepts HH:MM:SS and round-trips through its own formatter", () => {
    const ms = withLocalTime(base, "23:59:58")!;
    const d = new Date(ms);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([23, 59, 58]);
    expect(localTimeStr(ms)).toBe("23:59");
  });

  it("rejects malformed input (a cleared time field must not scrub the scene)", () => {
    expect(withLocalTime(base, "")).toBeNull();
    expect(withLocalTime(base, "9:5")).toBeNull();
    expect(withLocalTime(base, "25:00")).toBeNull();
    expect(withLocalTime(base, "12:60")).toBeNull();
    expect(withLocalTime(base, "not-a-time")).toBeNull();
  });
});

describe("time store pin/live", () => {
  it("setTime pins, goLive resumes", () => {
    useTimeStore.getState().setTime(ANCHOR);
    expect(useTimeStore.getState().live).toBe(false);
    expect(useTimeStore.getState().timeMs).toBe(ANCHOR);
    useTimeStore.getState().goLive();
    expect(useTimeStore.getState().live).toBe(true);
  });
});

describe("playback (PLAY / fast-forward, owner 2026-07-14)", () => {
  it("playbackNowMs derives the fluid instant from the anchor pair", () => {
    const s = { timeMs: ANCHOR, live: false, playRate: 600, playWallMs: 1_000 };
    expect(playbackNowMs(s, 11_000)).toBe(ANCHOR + 10_000 * 600); // 10 real s at 10 min/s
    expect(playbackNowMs({ ...s, playRate: 1 }, 11_000)).toBe(ANCHOR + 10_000);
    expect(playbackNowMs({ ...s, playRate: null, playWallMs: null }, 99)).toBe(ANCHOR);
    expect(playbackNowMs({ ...s, live: true }, 123)).toBe(123); // live ignores the pin
  });

  it("play() pins + arms; stopPlay() freezes pinned; goLive() clears playback", () => {
    useTimeStore.getState().setTime(ANCHOR);
    useTimeStore.getState().play(600);
    let s = useTimeStore.getState();
    expect(s.live).toBe(false);
    expect(s.playRate).toBe(600);
    expect(s.playWallMs).not.toBeNull();
    useTimeStore.getState().stopPlay();
    s = useTimeStore.getState();
    expect(s.playRate).toBeNull();
    expect(s.playWallMs).toBeNull();
    expect(s.live).toBe(false); // stays pinned where the reel stopped
    useTimeStore.getState().goLive();
    s = useTimeStore.getState();
    expect(s.live).toBe(true);
    expect(s.playRate).toBeNull();
  });

  it("play(1) while LIVE is a no-op (the wall clock IS real-speed playback)", () => {
    useTimeStore.getState().goLive();
    useTimeStore.getState().play(1);
    const s = useTimeStore.getState();
    expect(s.live).toBe(true);
    expect(s.playRate).toBeNull();
  });

  it("play(rate>1) from LIVE pins the current instant and fast-forwards", () => {
    useTimeStore.getState().goLive();
    useTimeStore.getState().play(3600);
    const s = useTimeStore.getState();
    expect(s.live).toBe(false);
    expect(s.playRate).toBe(3600);
  });

  it("setTime during playback rebases the anchor but keeps the reel running", () => {
    useTimeStore.getState().setTime(ANCHOR);
    useTimeStore.getState().play(60);
    useTimeStore.getState().setTime(ANCHOR + 5_000_000);
    const s = useTimeStore.getState();
    expect(s.timeMs).toBe(ANCHOR + 5_000_000);
    expect(s.playRate).toBe(60);
    expect(s.playWallMs).not.toBeNull();
    useTimeStore.getState().goLive(); // leave the store clean for other suites
  });
});

describe("hourTicksBetween (QoL-1 conveyor rail labels)", () => {
  const start = Date.UTC(2026, 6, 10, 12, 17, 0);
  const WINDOW12 = 12 * 3_600_000;

  it("emits every full local hour inside the window, ascending", () => {
    const ticks = hourTicksBetween(start, start + WINDOW12);
    expect(ticks.length).toBeGreaterThanOrEqual(11); // DST transitions can trim one
    expect(ticks.length).toBeLessThanOrEqual(13);
    expect(ticks[0].ms).toBeGreaterThanOrEqual(start);
    expect(ticks[ticks.length - 1].ms).toBeLessThanOrEqual(start + WINDOW12);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].ms).toBeGreaterThan(ticks[i - 1].ms);
  });

  it("labels carry the browser-local wall hour (the date-input convention)", () => {
    for (const t of hourTicksBetween(start, start + WINDOW12)) {
      expect(t.hour).toBe(new Date(t.ms).getHours());
      expect(new Date(t.ms).getMinutes()).toBe(0);
      expect(t.isMidnight).toBe(t.hour === 0);
    }
  });

  it("crosses local midnight with exactly one midnight tick per day boundary", () => {
    const dayCross = hourTicksBetween(start, start + 24 * 3_600_000);
    expect(dayCross.filter((t) => t.isMidnight).length).toBe(1);
  });

  it("returns [] for empty or inverted windows", () => {
    expect(hourTicksBetween(start, start)).toEqual([]);
    expect(hourTicksBetween(start, start - 1)).toEqual([]);
  });
});
