import { describe, expect, it } from "vitest";
import {
  parseSavePlaceBody,
  placeListItem,
  placeRecord,
  PLACE_QUOTA,
} from "../../../src/lib/wix/placeRecords";

const validBody = {
  title: "Dnipro embankment dusk",
  latDeg: 48.4647,
  lonDeg: 35.0462,
  eyeM: 1.7,
  headingDeg: 352.1,
  pitchDeg: 2.4,
  fovDeg: 26.8,
  timeMs: 1_775_000_000_000,
};

describe("parseSavePlaceBody", () => {
  it("accepts a full valid body verbatim", () => {
    const parsed = parseSavePlaceBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body).toEqual(validBody);
  });

  it("defaults the title and accepts a null/absent time (live scene)", () => {
    const { title: _t, timeMs: _m, ...rest } = validBody;
    const parsed = parseSavePlaceBody(rest);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.title).toBe("Untitled place");
    expect(parsed.body.timeMs).toBeNull();
  });

  it("wraps heading and longitude like the #f= hash does (one contract)", () => {
    const parsed = parseSavePlaceBody({ ...validBody, headingDeg: -10, lonDeg: 190 });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.headingDeg).toBeCloseTo(350);
    expect(parsed.body.lonDeg).toBeCloseTo(-170);
  });

  it.each([
    ["latDeg", { ...validBody, latDeg: 91 }],
    ["eyeM low", { ...validBody, eyeM: 0.2 }],
    ["eyeM high", { ...validBody, eyeM: 20_000 }],
    ["pitchDeg", { ...validBody, pitchDeg: 90 }],
    ["fovDeg", { ...validBody, fovDeg: 0.5 }],
    ["timeMs", { ...validBody, timeMs: -5 }],
    ["timeMs far future", { ...validBody, timeMs: 99_000_000_000_000 }],
    ["non-object", null],
    ["missing pose", { title: "x" }],
  ])("rejects %s", (_name, raw) => {
    expect("error" in parseSavePlaceBody(raw)).toBe(true);
  });
});

describe("placeRecord / placeListItem round-trip", () => {
  it("builds the row with the owner id and reads it back as a jumpable list item", () => {
    const parsed = parseSavePlaceBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    const row = placeRecord(parsed.body, "member-1");
    expect(row.ownerMemberId).toBe("member-1");
    const item = placeListItem({ ...row, _id: "place-1", _createdDate: "2026-07-15T09:00:00Z" });
    expect(item).not.toBeNull();
    expect(item?.latDeg).toBe(validBody.latDeg);
    expect(item?.eyeM).toBe(validBody.eyeM);
    expect(item?.headingDeg).toBeCloseTo(validBody.headingDeg);
    expect(item?.fovDeg).toBe(validBody.fovDeg);
    expect(item?.timeMs).toBe(validBody.timeMs);
    expect(item?.createdAt).toBe("2026-07-15T09:00:00Z");
  });

  it("drops rows with an incomplete pose (defensive list mapping)", () => {
    expect(placeListItem({ _id: "x", lat: 48, lon: 35 })).toBeNull();
    expect(placeListItem({ title: "no id" })).toBeNull();
  });

  it("quota constant stays a small per-member cap", () => {
    expect(PLACE_QUOTA).toBeGreaterThan(0);
    expect(PLACE_QUOTA).toBeLessThanOrEqual(100);
  });
});
