import { describe, expect, it } from "vitest";
import {
  formatPoseHash,
  parsePoseHash,
  wrapLon,
} from "../../../src/lib/geo/urlPose";

/**
 * URL pose hash (S7 feedback batch #2) — the shareable/reload-safe camera pose. Format and
 * parse must round-trip; anything malformed parses to null (the welcome then shows normally).
 */
describe("formatPoseHash ↔ parsePoseHash round-trip", () => {
  it("round-trips a city pose within the format's precision", () => {
    const pose = { latDeg: 48.4672, lonDeg: 35.0395, altM: 477, headingDeg: 324.2, tiltDeg: 52.4 };
    const parsed = parsePoseHash(formatPoseHash(pose));
    expect(parsed).not.toBeNull();
    expect(parsed!.latDeg).toBeCloseTo(pose.latDeg, 5);
    expect(parsed!.lonDeg).toBeCloseTo(pose.lonDeg, 5);
    expect(parsed!.altM).toBe(477);
    expect(parsed!.headingDeg).toBeCloseTo(324.2, 1);
    expect(parsed!.tiltDeg).toBeCloseTo(52.4, 1);
  });

  it("wraps heading/longitude and clamps altitude/tilt on write", () => {
    const hash = formatPoseHash({
      latDeg: 48,
      lonDeg: 215, // → −145
      altM: 0.5, // → floor 2
      headingDeg: -90, // → 270
      tiltDeg: 120, // → cap 88
    });
    const p = parsePoseHash(hash)!;
    expect(p.lonDeg).toBeCloseTo(-145, 5);
    expect(p.altM).toBe(2);
    expect(p.headingDeg).toBeCloseTo(270, 1);
    expect(p.tiltDeg).toBe(88);
  });

  it("accepts the hash with or without the leading #", () => {
    const hash = formatPoseHash({ latDeg: 1, lonDeg: 2, altM: 1000, headingDeg: 0, tiltDeg: 45 });
    expect(parsePoseHash(hash)).not.toBeNull();
    expect(parsePoseHash(hash.slice(1))).toEqual(parsePoseHash(hash));
  });
});

describe("parsePoseHash rejects malformed input", () => {
  it.each([
    ["", null],
    ["#", null],
    ["#p=", null],
    ["#p=1,2,3,4", null], // too few
    ["#p=1,2,3,4,5,6", null], // too many
    ["#p=a,2,3,4,5", null], // NaN
    ["#p=1,2,,4,5", null], // empty part
    ["#p=95,2,3,4,5", null], // latitude out of range
    ["#other=1", null],
  ])("%s → null", (hash) => {
    expect(parsePoseHash(hash as string)).toBeNull();
  });

  it("clamps parsed altitude/tilt into their valid bands", () => {
    const p = parsePoseHash("#p=10,20,999999999,10,99")!;
    expect(p.altM).toBe(50_000_000);
    expect(p.tiltDeg).toBe(88);
  });
});

describe("wrapLon", () => {
  it("wraps to [−180, 180)", () => {
    expect(wrapLon(0)).toBe(0);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(215)).toBeCloseTo(-145, 10);
    expect(wrapLon(-545)).toBeCloseTo(175, 10);
  });
});
