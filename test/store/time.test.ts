import { describe, expect, it } from "vitest";
import { fractionToTime, timeToFraction, useTimeStore } from "../../src/store/time";

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

describe("time store pin/live", () => {
  it("setTime pins, goLive resumes", () => {
    useTimeStore.getState().setTime(ANCHOR);
    expect(useTimeStore.getState().live).toBe(false);
    expect(useTimeStore.getState().timeMs).toBe(ANCHOR);
    useTimeStore.getState().goLive();
    expect(useTimeStore.getState().live).toBe(true);
  });
});
