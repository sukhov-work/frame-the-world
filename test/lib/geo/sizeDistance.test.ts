import { describe, expect, it } from "vitest";
import {
  subjectDistanceForDiscMatch,
  subjectHeightMatchingDisc,
} from "../../../src/lib/geo/sizeDistance";

const MOON_DIAM_RAD = (0.53 * Math.PI) / 180; // canonical ~0.53° disc

describe("sizeDistance", () => {
  it("a 1.8 m person spans the moon from ≈ 195 m away", () => {
    expect(subjectDistanceForDiscMatch(1.8, MOON_DIAM_RAD)).toBeCloseTo(194.6, 0);
  });
  it("the two faces are inverses", () => {
    const d = subjectDistanceForDiscMatch(10, MOON_DIAM_RAD);
    expect(subjectHeightMatchingDisc(d, MOON_DIAM_RAD)).toBeCloseTo(10, 9);
  });
  it("bigger disc → stand closer for the same subject", () => {
    expect(subjectDistanceForDiscMatch(10, MOON_DIAM_RAD * 1.14)).toBeLessThan(
      subjectDistanceForDiscMatch(10, MOON_DIAM_RAD),
    );
  });
});
