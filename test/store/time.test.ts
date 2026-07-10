import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  localDateStr,
  timeToFraction,
  useTimeStore,
  withLocalDate,
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

describe("time store pin/live", () => {
  it("setTime pins, goLive resumes", () => {
    useTimeStore.getState().setTime(ANCHOR);
    expect(useTimeStore.getState().live).toBe(false);
    expect(useTimeStore.getState().timeMs).toBe(ANCHOR);
    useTimeStore.getState().goLive();
    expect(useTimeStore.getState().live).toBe(true);
  });
});
