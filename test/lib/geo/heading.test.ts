import { describe, expect, it } from "vitest";
import { headingDeltaDeg, wrapHeadingDeg } from "../../../src/lib/geo/heading";

describe("heading math", () => {
  it("wraps headings into [0, 360)", () => {
    expect(wrapHeadingDeg(0)).toBe(0);
    expect(wrapHeadingDeg(360)).toBe(0);
    expect(wrapHeadingDeg(-90)).toBe(270);
    expect(wrapHeadingDeg(725)).toBe(5);
  });

  it("returns the shortest signed arc (the glide never takes the long way round)", () => {
    expect(headingDeltaDeg(10, 350)).toBe(-20);
    expect(headingDeltaDeg(350, 10)).toBe(20);
    expect(headingDeltaDeg(0, 180)).toBe(180); // tie breaks to +180
    expect(headingDeltaDeg(90, 90)).toBe(0);
    expect(headingDeltaDeg(359, 1)).toBe(2);
  });
});
