import { describe, expect, it } from "vitest";
import {
  FACADE_PAIRS_MAX,
  FACADE_PAIR_TARGET_MAX_LEN,
  alignmentRecordOf,
  parseFacadeAlignment,
  parseFacadeSolvedPose,
  solvedPoseOfAlignment,
  type FacadeAlignPair,
  type FacadeSolved,
} from "../../../src/lib/geo/facadeAlign";
import { FACADE_ALIGNMENT_MAX_BYTES } from "../../../src/lib/wix/facadeRecords";

// T172 (F5) — the RECORD half of facadeAlign.ts: the `alignment` JSON-in-TEXT column a FacadePhotos
// row stores (lenient parse of untrusted input, the serialiser the bodies carry, the SOLVED-stamp read).
// The maths half (the ENU bridge, the solve) is tested beside the solver.

const origin = { lat: 48.4647, lon: 35.0462, altM: 112.4 };
const pose = {
  lat: 48.464712345678901,
  lon: 35.046187654321098,
  altitudeM: 1.6180339887498949,
  headingDeg: 217.31415926535897,
  pitchDeg: 3.2718281828459045,
  rollDeg: -0.41421356237309515,
  hFovDeg: 66.60660660660661,
};
const solved: FacadeSolved = { pose, rmsPx: 1.25, n: 4, fovSolved: false, planar: true, at: "2026-10-24T10:00:00.000Z" };
const pair = (i: number): FacadeAlignPair => ({ uv: [(i % 10) / 10 + 0.01, 0.5], enu: [10 + i, 20, (i % 5) * 1.5] });
const pairs4 = [0, 1, 2, 3].map(pair);
const raw = (over: Record<string, unknown> = {}) => ({ pairs: pairs4, origin, solved, ...over });

describe("parseFacadeAlignment", () => {
  it("accepts the record shape (pairs + origin + solved), keeping a target", () => {
    const r = parseFacadeAlignment(raw({ pairs: [{ ...pairs4[0], target: "osm:w1" }, ...pairs4.slice(1)] }));
    expect(r).not.toBeNull();
    expect(r!.pairs).toHaveLength(4);
    expect(r!.pairs[0]).toEqual({ ...pairs4[0], target: "osm:w1" });
    expect(r!.origin).toEqual(origin);
    expect(r!.solved).toEqual(solved);
  });

  it("drops malformed pairs (wrong arity, non-finite, far out of frame, not an object) and an over-long target", () => {
    const r = parseFacadeAlignment(
      raw({
        pairs: [
          pairs4[0],
          { uv: [0.1], enu: [1, 2, 3] },
          { uv: [0.1, 0.2], enu: [1, 2] },
          { uv: [0.1, Number.NaN], enu: [1, 2, 3] },
          { uv: [0.1, 0.2], enu: [1, "2", 3] },
          { uv: [2, 0.2], enu: [1, 2, 3] },
          null,
          "pair",
          { ...pairs4[1], target: "x".repeat(FACADE_PAIR_TARGET_MAX_LEN + 1) },
        ],
      }),
    );
    expect(r!.pairs).toEqual([pairs4[0], pairs4[1]]);
  });

  it(`caps the pairs at FACADE_PAIRS_MAX (${FACADE_PAIRS_MAX})`, () => {
    const many = Array.from({ length: FACADE_PAIRS_MAX + 6 }, (_, i) => pair(i));
    expect(parseFacadeAlignment(raw({ pairs: many }))!.pairs).toHaveLength(FACADE_PAIRS_MAX);
  });

  it("null for {} / a legacy shape / no or bad origin / no valid pair / a non-object", () => {
    expect(parseFacadeAlignment({})).toBeNull();
    expect(parseFacadeAlignment({ pairs: [] })).toBeNull();
    expect(parseFacadeAlignment(raw({ origin: undefined }))).toBeNull();
    expect(parseFacadeAlignment(raw({ origin: { lat: 91, lon: 0, altM: 0 } }))).toBeNull();
    expect(parseFacadeAlignment(raw({ origin: { lat: 48, lon: 35 } }))).toBeNull();
    expect(parseFacadeAlignment(raw({ pairs: [] }))).toBeNull();
    expect(parseFacadeAlignment(raw({ pairs: [{ uv: [0.1], enu: [1, 2, 3] }] }))).toBeNull();
    expect(parseFacadeAlignment(raw({ pairs: "nope" }))).toBeNull();
    expect(parseFacadeAlignment(null)).toBeNull();
    expect(parseFacadeAlignment([pairs4])).toBeNull();
  });

  it("drops a malformed solved block while keeping the pairs", () => {
    for (const bad of [
      { ...solved, pose: { ...pose, headingDeg: Number.NaN } },
      { ...solved, rmsPx: -1 },
      { ...solved, n: 2.5 },
      { ...solved, at: 7 },
      "solved",
    ]) {
      const r = parseFacadeAlignment(raw({ solved: bad }));
      expect(r!.pairs).toHaveLength(4);
      expect(r!.solved).toBeUndefined();
    }
  });
});

describe("parseFacadeSolvedPose", () => {
  it("accepts the snapshot (altitudeM may be null)", () => {
    expect(parseFacadeSolvedPose(pose)).toEqual(pose);
    expect(parseFacadeSolvedPose({ ...pose, altitudeM: null })).toEqual({ ...pose, altitudeM: null });
  });

  it("rejects NaN / Infinity / a missing or string field / out-of-range lat lon hFov / a non-object", () => {
    expect(parseFacadeSolvedPose({ ...pose, pitchDeg: Number.NaN })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, lon: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, altitudeM: Number.NaN })).toBeNull();
    const { rollDeg: _r, ...noRoll } = pose;
    expect(parseFacadeSolvedPose(noRoll)).toBeNull();
    const { altitudeM: _a, ...noAlt } = pose;
    expect(parseFacadeSolvedPose(noAlt)).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, headingDeg: "217" })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, lat: 90.5 })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, lon: -180.5 })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, hFovDeg: 0 })).toBeNull();
    expect(parseFacadeSolvedPose({ ...pose, hFovDeg: 180 })).toBeNull();
    expect(parseFacadeSolvedPose(null)).toBeNull();
    expect(parseFacadeSolvedPose([1, 2, 3])).toBeNull();
    expect(parseFacadeSolvedPose(42)).toBeNull();
  });
});

describe("solvedPoseOfAlignment", () => {
  it("reads the solve's pose off a raw (JSON) or a typed record; null without a valid solve", () => {
    expect(solvedPoseOfAlignment(JSON.parse(JSON.stringify(raw())))).toEqual(pose);
    expect(solvedPoseOfAlignment(parseFacadeAlignment(raw()))).toEqual(pose);
    expect(solvedPoseOfAlignment(raw({ solved: undefined }))).toBeNull();
    expect(solvedPoseOfAlignment(raw({ solved: { ...solved, pose: { ...pose, hFovDeg: Number.NaN } } }))).toBeNull();
    expect(solvedPoseOfAlignment({})).toBeNull();
    expect(solvedPoseOfAlignment(null)).toBeNull();
    expect(solvedPoseOfAlignment("{}")).toBeNull();
  });
});

describe("alignmentRecordOf", () => {
  it("rounds the pairs (uv 6 dp, ENU 3 dp), keeps a target, the origin verbatim", () => {
    const out = alignmentRecordOf([{ uv: [0.12345678901, 0.98765432109], enu: [10.123456, -20.98765, 3.00049], target: "osm:w7" }], origin)!;
    expect(out.pairs).toEqual([{ uv: [0.123457, 0.987654], enu: [10.123, -20.988, 3], target: "osm:w7" }]);
    expect(out.origin).toEqual(origin);
    expect("solved" in out).toBe(false);
  });

  it("keeps the solved pose VERBATIM — an unrounded double survives the JSON round trip and the parse", () => {
    const out = alignmentRecordOf(pairs4, origin, solved)!;
    const back = JSON.parse(JSON.stringify(out));
    expect(back.solved.pose.headingDeg).toBe(217.31415926535897);
    expect(back.solved.pose.lat).toBe(48.464712345678901);
    expect(back.solved).toEqual(solved);
    expect(solvedPoseOfAlignment(back)).toEqual(pose);
    // A copy, not the caller's object.
    expect((out.solved as { pose: unknown }).pose).not.toBe(pose);
  });

  it("null without pairs or without an origin", () => {
    expect(alignmentRecordOf([], origin, solved)).toBeNull();
    expect(alignmentRecordOf(pairs4, undefined, solved)).toBeNull();
  });

  it(`${FACADE_PAIRS_MAX} pairs + a solve serialise under FACADE_ALIGNMENT_MAX_BYTES (16 KiB)`, () => {
    const full = Array.from({ length: FACADE_PAIRS_MAX }, (_, i): FacadeAlignPair => ({
      uv: [0.123456789 + i / 100, 0.987654321 - i / 100],
      enu: [-1234.56789 + i, 2345.67891 - i, 123.456789],
      target: `osm:w${"9".repeat(12)}${i}`,
    }));
    const out = alignmentRecordOf(full, origin, solved)!;
    const bytes = new TextEncoder().encode(JSON.stringify(out)).length;
    expect(bytes).toBeLessThan(FACADE_ALIGNMENT_MAX_BYTES);
    expect(parseFacadeAlignment(JSON.parse(JSON.stringify(out)))!.pairs).toHaveLength(FACADE_PAIRS_MAX);
  });
});
