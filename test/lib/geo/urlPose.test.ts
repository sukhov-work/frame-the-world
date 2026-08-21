import { describe, expect, it } from "vitest";
import {
  formatFpvHash,
  formatPoseHash,
  formatSceneHash,
  mobileShellHash,
  parseFpvHash,
  parsePoseHash,
  parseTimeHash,
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

describe("scene time on the hash (&t=, owner 2026-07-14)", () => {
  const pose = { latDeg: 48.4672, lonDeg: 35.0395, altM: 477, headingDeg: 324.2, tiltDeg: 52.4 };
  const T = 1_780_000_000_123;

  it("formatSceneHash appends &t only for a CUSTOM scene time (live is never shared)", () => {
    expect(formatSceneHash(pose, null)).toBe(formatPoseHash(pose));
    expect(formatSceneHash(pose, T)).toBe(`${formatPoseHash(pose)}&t=${T}`);
  });

  it("parsePoseHash tolerates (and ignores) a trailing &t", () => {
    expect(parsePoseHash(formatSceneHash(pose, T))).toEqual(parsePoseHash(formatPoseHash(pose)));
  });

  it("parseTimeHash extracts the instant; null when absent or malformed", () => {
    expect(parseTimeHash(formatSceneHash(pose, T))).toBe(T);
    expect(parseTimeHash(formatPoseHash(pose))).toBeNull();
    expect(parseTimeHash("")).toBeNull();
    expect(parseTimeHash("#t=123")).toBeNull(); // time never travels without a pose
    expect(parseTimeHash("#p=1,2,3,4,5&t=abc")).toBeNull();
    expect(parseTimeHash("#p=1,2,3,4,5&t=99999999999999999")).toBeNull(); // out of the sanity band
  });

  it("accepts the combined hash with or without the leading #", () => {
    const h = formatSceneHash(pose, T);
    expect(parseTimeHash(h.slice(1))).toBe(T);
    expect(parsePoseHash(h.slice(1))).not.toBeNull();
  });
});

describe("FPV pose hash (#f=, owner 2026-07-14)", () => {
  const fpv = {
    latDeg: 48.464712,
    lonDeg: 35.046199,
    eyeM: 1.7,
    headingDeg: 300.4,
    pitchDeg: 2.8,
    fovDeg: 55,
  };

  it("round-trips within the format's precision", () => {
    const p = parseFpvHash(formatFpvHash(fpv, null))!;
    expect(p.latDeg).toBeCloseTo(fpv.latDeg, 6);
    expect(p.lonDeg).toBeCloseTo(fpv.lonDeg, 6);
    expect(p.eyeM).toBeCloseTo(1.7, 1);
    expect(p.headingDeg).toBeCloseTo(300.4, 1);
    expect(p.pitchDeg).toBeCloseTo(2.8, 1);
    expect(p.fovDeg).toBeCloseTo(55, 1);
  });

  it("clamps/wraps on write (eye floor, pitch band, fov band, heading wrap)", () => {
    const p = parseFpvHash(
      formatFpvHash(
        { latDeg: 48, lonDeg: 215, eyeM: 0, headingDeg: -90, pitchDeg: 120, fovDeg: 500 },
        null,
      ),
    )!;
    expect(p.lonDeg).toBeCloseTo(-145, 5);
    expect(p.eyeM).toBe(0.5);
    expect(p.headingDeg).toBeCloseTo(270, 1);
    expect(p.pitchDeg).toBe(89);
    expect(p.fovDeg).toBe(120);
  });

  it("carries a custom scene time and parseTimeHash reads it back", () => {
    const T = 1_780_000_000_123;
    const h = formatFpvHash(fpv, T);
    expect(h.includes("&t=")).toBe(true);
    expect(parseTimeHash(h)).toBe(T);
    expect(parseFpvHash(h)).toEqual(parseFpvHash(formatFpvHash(fpv, null)));
    expect(parseTimeHash(formatFpvHash(fpv, null))).toBeNull();
  });

  it("rejects malformed input and never cross-parses with #p=", () => {
    expect(parseFpvHash("")).toBeNull();
    expect(parseFpvHash("#f=")).toBeNull();
    expect(parseFpvHash("#f=1,2,3,4,5")).toBeNull(); // too few
    expect(parseFpvHash("#f=1,2,3,4,5,6,7")).toBeNull(); // too many
    expect(parseFpvHash("#f=a,2,3,4,5,6")).toBeNull(); // NaN
    expect(parseFpvHash("#f=95,2,3,4,5,6")).toBeNull(); // latitude out of range
    expect(parseFpvHash(formatPoseHash({ latDeg: 1, lonDeg: 2, altM: 10, headingDeg: 0, tiltDeg: 45 }))).toBeNull();
    expect(parsePoseHash(formatFpvHash(fpv, null))).toBeNull();
  });

  it("accepts the hash with or without the leading #", () => {
    const h = formatFpvHash(fpv, null);
    expect(parseFpvHash(h.slice(1))).toEqual(parseFpvHash(h));
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

describe("mobileShellHash — desktop→/m shell-switch hash (owner batch #5 item 6)", () => {
  const pose = { latDeg: 48.46, lonDeg: 35.05, altM: 3_200, headingDeg: 217.4, tiltDeg: 45 };

  it("forces the orbit tilt to 0 so /m lands on the 2D map, keeping lat/lon/alt/heading", () => {
    const out = parsePoseHash(mobileShellHash(formatPoseHash(pose)))!;
    expect(out.tiltDeg).toBe(0);
    expect(out.latDeg).toBeCloseTo(pose.latDeg, 5);
    expect(out.lonDeg).toBeCloseTo(pose.lonDeg, 5);
    expect(out.altM).toBe(3_200);
    expect(out.headingDeg).toBeCloseTo(pose.headingDeg, 1);
  });

  it("preserves a pinned scene time across the transform", () => {
    const T = 1_780_000_000_123;
    const h = mobileShellHash(formatSceneHash(pose, T));
    expect(parseTimeHash(h)).toBe(T);
    expect(parsePoseHash(h)!.tiltDeg).toBe(0);
  });

  it("passes an FPV hash through EXACT (a first-person view reproduces 1:1 on /m)", () => {
    const f = formatFpvHash(
      { latDeg: 48.46, lonDeg: 35.05, eyeM: 1.7, headingDeg: 90, pitchDeg: 5, fovDeg: 60 },
      1_780_000_000_123,
    );
    expect(mobileShellHash(f)).toBe(f);
  });

  it("returns empty on no/garbage pose — the caller keeps the plain /m default boot", () => {
    expect(mobileShellHash("")).toBe("");
    expect(mobileShellHash("#explore")).toBe("");
    expect(mobileShellHash("#p=garbage")).toBe("");
  });
});
