import { describe, expect, it } from "vitest";
import {
  overrideId,
  overrideRecord,
  parseSyncBody,
  parseSyncEntry,
  publicOverride,
  SYNC_MAX,
} from "../../../src/lib/wix/overrideRecords";
import { SCALE_MAX_K, SCALE_MIN_K } from "../../../src/lib/globe/bldgOverrides";

// The U8 backend-prep contract (next phase's batch sync): deterministic LWW ids, server-side
// clamp, memberId stamped-but-never-published. "dnipro-o2w" is a real registry variant —
// parseSyncEntry validates variants against lib/globe/regions.

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  variant: "dnipro-o2w",
  cell: "cell-10-10.glb",
  featureId: 4711,
  heightScale: 2,
  cx: 120.5,
  cz: -44,
  vc: 96,
  bakedHeightM: 12.5,
  ...over,
});

describe("overrideId — the deterministic LWW upsert key", () => {
  it("is stable, 32 hex chars, and key-sensitive", () => {
    const a = overrideId("dnipro-o2w", "cell-10-10.glb", 4711);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4711)).toBe(a);
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4712)).not.toBe(a);
    expect(overrideId("dnipro", "cell-10-10.glb", 4711)).not.toBe(a);
    expect(overrideId("dnipro-o2w", "cell-10-11.glb", 4711)).not.toBe(a);
  });
});

describe("parseSyncEntry", () => {
  it("accepts a valid entry and clamps heightScale to the shared band (never rejects drift)", () => {
    expect(parseSyncEntry(entry())).toMatchObject({ heightScale: 2 });
    expect(parseSyncEntry(entry({ heightScale: 99 }))?.heightScale).toBe(SCALE_MAX_K);
    expect(parseSyncEntry(entry({ heightScale: 0.001 }))?.heightScale).toBe(SCALE_MIN_K);
  });

  it("rejects unknown variants (typo/vandalism probe) and structural junk", () => {
    expect(parseSyncEntry(entry({ variant: "not-a-region" }))).toBeNull();
    expect(parseSyncEntry(entry({ featureId: 1.5 }))).toBeNull();
    expect(parseSyncEntry(entry({ featureId: -1 }))).toBeNull();
    expect(parseSyncEntry(entry({ vc: 0 }))).toBeNull();
    expect(parseSyncEntry(entry({ bakedHeightM: 0 }))).toBeNull();
    expect(parseSyncEntry(entry({ cell: "" }))).toBeNull();
    expect(parseSyncEntry(null)).toBeNull();
  });
});

describe("parseSyncBody", () => {
  it("parses upserts + removes and names the offending index on junk", () => {
    const ok = parseSyncBody({
      upserts: [entry()],
      removes: [{ variant: "dnipro-o2w", cell: "cell-1-1.glb", featureId: 7 }],
    });
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok.upserts).toHaveLength(1);
      expect(ok.removes).toHaveLength(1);
    }
    const bad = parseSyncBody({ upserts: [entry(), entry({ vc: -1 })] });
    expect(bad).toEqual({ error: "upserts[1] is not a valid override entry" });
    const badRemove = parseSyncBody({ removes: [{ variant: "v" }] });
    expect(badRemove).toEqual({ error: "removes[0] is not a valid override key" });
  });

  it("rejects empty syncs and oversize batches (the platform bulk cap)", () => {
    expect(parseSyncBody({})).toMatchObject({ error: expect.stringContaining("nothing") });
    expect(
      parseSyncBody({ upserts: Array.from({ length: SYNC_MAX + 1 }, () => entry()) }),
    ).toMatchObject({ error: expect.stringContaining(`${SYNC_MAX}`) });
  });
});

describe("overrideRecord / publicOverride", () => {
  it("builds a COMPLETE row (bulkSave replaces whole items) with _id, region and memberId", () => {
    const e = parseSyncEntry(entry());
    expect(e).not.toBeNull();
    const row = overrideRecord(e!, "member-guid-123");
    expect(row).toMatchObject({
      _id: overrideId("dnipro-o2w", "cell-10-10.glb", 4711),
      variant: "dnipro-o2w",
      cell: "cell-10-10.glb",
      featureId: 4711,
      heightScale: 2,
      region: "dnipro",
      memberId: "member-guid-123",
      osmId: null,
    });
  });

  it("publicOverride NEVER emits memberId (C6: no raw member GUIDs world-readable) and drops bad rows", () => {
    const e = parseSyncEntry(entry());
    const row = overrideRecord(e!, "member-guid-123");
    const pub = publicOverride(row);
    expect(pub).not.toBeNull();
    expect(pub).not.toHaveProperty("memberId");
    expect(pub).toMatchObject({ variant: "dnipro-o2w", featureId: 4711, heightScale: 2 });
    expect(publicOverride({ variant: "v" })).toBeNull();
  });
});
