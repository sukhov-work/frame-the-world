import { describe, expect, it } from "vitest";
import { HeightMemo } from "../../../src/lib/globe/heightMemo";

/**
 * RC11 (audit slice S16) — the terrain-height memo.
 *
 * The property that makes it safe to put in front of `heightAt` — which seats buildings, the
 * photo frustum and the FPV eye — is that it is EXACT: same coordinates in, same answer out, with
 * no quantisation and no interpolation. Everything below is about that, plus the one deliberate
 * omission: `null` is never cached, because "no tile covers this yet" is the answer that most
 * wants retrying.
 *
 * T77 lever 6 changed WHEN entries die, never HOW they are keyed. The old memo dropped city-wide
 * on the terrain epoch — a counter that fires 1.9–4.8 times a second — so the seat sweep
 * re-raycast the whole city forever. It now drops the coarse buckets a terrain tile's own region
 * covers. The exactness tests therefore stand unchanged; the new ones pin the two directions that
 * matter: an entry INSIDE an arriving tile must die (under-invalidation is a wrong seat) and an
 * entry outside it must SURVIVE (over-invalidation is the waste the lever exists to remove).
 */

const DEG = Math.PI / 180;
/** A 3D-Tiles region `[west, south, east, north]` in RADIANS, built from degrees — the unit
 *  `QuantizedMeshPlugin` hands the ground renderer, and the unit `invalidateRegionRad` takes. */
const region = (w: number, s: number, e: number, n: number): number[] => [
  w * DEG,
  s * DEG,
  e * DEG,
  n * DEG,
  -1000,
  1000,
];
/** The production shape: capacity, bucket size, maxAge (0 = backstop off unless a test wants it). */
const memo = (capacity = 100, bucketDeg = 0.002, maxAgeMs = 0, now?: () => number) =>
  new HeightMemo(capacity, bucketDeg, maxAgeMs, now);
const BIG = 1_000_000; // a maxBuckets that never forces the wholesale fallback

describe("HeightMemo", () => {
  it("misses on an empty memo and hits after a set", () => {
    const m = memo();
    expect(m.get(48.4647, 35.0462)).toBeUndefined();
    m.set(48.4647, 35.0462, 85.85);
    expect(m.get(48.4647, 35.0462)).toBe(85.85);
  });

  it("is exact — a coordinate one micro-degree away is a different question", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    expect(m.get(48.46470001, 35.0462)).toBeUndefined();
    expect(m.get(48.4647, 35.04620001)).toBeUndefined();
    expect(m.get(-48.4647, 35.0462)).toBeUndefined();
  });

  it("never confuses the two coordinates", () => {
    const m = memo();
    m.set(1, 2, 10);
    m.set(2, 1, 20);
    expect(m.get(1, 2)).toBe(10);
    expect(m.get(2, 1)).toBe(20);
  });

  it("caches zero and negative heights (both are real answers)", () => {
    const m = memo();
    m.set(1, 2, 0);
    m.set(3, 4, -12.5);
    expect(m.get(1, 2)).toBe(0);
    expect(m.get(3, 4)).toBe(-12.5);
  });

  it("drops wholesale on overflow and counts it rather than growing without bound", () => {
    const m = memo(4);
    for (let i = 0; i < 4; i++) m.set(i, 0, i);
    expect(m.stats().entries).toBe(4);
    m.set(99, 0, 99);
    expect(m.stats().entries).toBe(1);
    expect(m.stats().overflows).toBe(1);
    expect(m.get(99, 0)).toBe(99);
    expect(m.get(0, 0)).toBeUndefined();
  });

  it("reports a hit rate that reflects the round-robin it exists for", () => {
    const m = memo(1_000);
    m.noteEpoch(7);
    // First sweep over 50 footprints: all misses. Second and third: all hits.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 50; i++) {
        const v = m.get(i, 0);
        if (v === undefined) m.set(i, 0, i * 1.5);
      }
    }
    const s = m.stats();
    expect(s.hits).toBe(100);
    expect(s.misses).toBe(50);
    expect(s.hitRate).toBeCloseTo(2 / 3, 4);
    expect(s.epoch).toBe(7);
  });

  it("resetStats leaves the entries and clear() removes them", () => {
    const m = memo();
    m.set(1, 2, 10);
    m.get(1, 2);
    m.resetStats();
    expect(m.stats().hits).toBe(0);
    expect(m.stats().entries).toBe(1);
    m.clear();
    expect(m.stats().entries).toBe(0);
    expect(m.get(1, 2)).toBeUndefined();
  });

  it("the terrain epoch is REPORTED, never an invalidation (T77 lever 6's whole point)", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    m.noteEpoch(1);
    m.noteEpoch(2);
    m.noteEpoch(406); // a whole leg's worth of tile arrivals
    expect(m.get(48.4647, 35.0462)).toBe(85.85); // …and the answer is still there
    expect(m.stats().epoch).toBe(406);
    expect(m.stats().invalidations).toBe(0);
  });
});

describe("HeightMemo — per-tile (spatial) invalidation (T77 lever 6)", () => {
  it("drops entries INSIDE an arriving tile's region and keeps the neighbours", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85); // inside
    m.set(48.4651, 35.0466, 90.1); // inside, a different bucket
    m.set(48.4599, 35.0462, 70.0); // south of the region
    m.set(48.4647, 35.0399, 71.0); // west of the region
    m.invalidateRegionRad(region(35.042, 48.462, 35.048, 48.468), BIG);
    expect(m.get(48.4647, 35.0462)).toBeUndefined();
    expect(m.get(48.4651, 35.0466)).toBeUndefined();
    expect(m.get(48.4599, 35.0462)).toBe(70.0); // SURVIVES — this is the lever
    expect(m.get(48.4647, 35.0399)).toBe(71.0);
    const s = m.stats();
    expect(s.regionInvalidations).toBe(1);
    expect(s.bucketsDropped).toBeGreaterThan(0);
    expect(s.fullDrops).toBe(0);
    expect(s.invalidations).toBe(1); // the total still reads as "how much work was lost"
  });

  it("a neighbouring BUCKET one grid step away survives (the index is not a whole-map key)", () => {
    // Bucket 0.002°: 48.4640 and 48.4661 are ten buckets apart, both far from the region below.
    const m = memo();
    m.set(48.464, 35.046, 1);
    m.set(48.4661, 35.046, 2);
    // A region covering only the first: [48.4635, 48.4645].
    m.invalidateRegionRad(region(35.0455, 48.4635, 35.0465, 48.4645), BIG);
    expect(m.get(48.464, 35.046)).toBeUndefined();
    expect(m.get(48.4661, 35.046)).toBe(2);
  });

  it("handles a bucket boundary on BOTH sides — the floor is consistent for entry and region", () => {
    // 48.464 / 0.002 = 24232 exactly: the entry sits ON a boundary, so `Math.floor` puts it in
    // the UPPER bucket. A region whose north edge is that same boundary therefore still covers
    // it (the edge floors onto the same row), and a region ending just below does not.
    const m = memo();
    m.set(48.464, 35.046, 1);
    m.invalidateRegionRad(region(35.0455, 48.4615, 35.0465, 48.46399), BIG);
    expect(m.get(48.464, 35.046)).toBe(1); // strictly below the boundary → untouched
    m.invalidateRegionRad(region(35.0455, 48.4615, 35.0465, 48.464), BIG);
    expect(m.get(48.464, 35.046)).toBeUndefined(); // the boundary row itself → dropped
  });

  it("takes RADIANS in and answers about DEGREES (the 3D-Tiles region unit)", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    // The same numbers passed as if they were degrees address a point off West Africa.
    m.invalidateRegionRad([35.042, 48.462, 35.048, 48.468], BIG);
    expect(m.get(48.4647, 35.0462)).toBe(85.85);
    m.invalidateRegionRad(region(35.042, 48.462, 35.048, 48.468), BIG);
    expect(m.get(48.4647, 35.0462)).toBeUndefined();
  });

  it("a region wider than maxBuckets falls back to a whole-map drop and says so", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    m.set(-12.5, 130.0, 4.2); // the other side of the world
    // A root quantized-mesh tile: a whole hemisphere. Walking its buckets would be ~10^10 steps.
    m.invalidateRegionRad(region(-180, -90, 0, 90), 4096);
    expect(m.stats().entries).toBe(0);
    expect(m.stats().fullDrops).toBe(1);
    expect(m.stats().regionInvalidations).toBe(0);
    expect(m.stats().invalidations).toBe(1);
  });

  it("a missing or malformed region drops nothing (staleness it cannot prove)", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    m.invalidateRegionRad(undefined, BIG);
    m.invalidateRegionRad(null, BIG);
    m.invalidateRegionRad([0.61, 0.845], BIG); // a box bounding volume, not a region
    expect(m.get(48.4647, 35.0462)).toBe(85.85);
    expect(m.stats().invalidations).toBe(0);
    // T114: the silent branch is counted — three region-less events, and a real region is not one
    expect(m.stats().regionless).toBe(3);
    m.invalidateRegionRad([0.61, 0.845, 0.612, 0.847, 0, 100], BIG);
    expect(m.stats().regionless).toBe(3);
  });

  it("a set AFTER an invalidation re-registers in its bucket (the index cannot leak empty)", () => {
    const m = memo();
    m.set(48.4647, 35.0462, 85.85);
    const r = region(35.042, 48.462, 35.048, 48.468);
    m.invalidateRegionRad(r, BIG);
    m.set(48.4647, 35.0462, 91.0); // the refined tile answers again
    expect(m.get(48.4647, 35.0462)).toBe(91.0);
    m.invalidateRegionRad(r, BIG); // …and the SECOND invalidation must still find it
    expect(m.get(48.4647, 35.0462)).toBeUndefined();
    expect(m.stats().regionInvalidations).toBe(2);
  });

  it("the maxAge backstop drops the whole map once the clock passes it", () => {
    let t = 0;
    const m = memo(100, 0.002, 60_000, () => t);
    m.set(48.4647, 35.0462, 85.85);
    t = 59_000;
    m.set(48.4648, 35.0462, 86.0); // still inside the window: nothing dropped
    expect(m.get(48.4647, 35.0462)).toBe(85.85);
    expect(m.stats().fullDrops).toBe(0);
    t = 120_001;
    m.set(48.4649, 35.0462, 87.0); // past it: the generation before this write is gone
    expect(m.get(48.4647, 35.0462)).toBeUndefined();
    expect(m.get(48.4648, 35.0462)).toBeUndefined();
    expect(m.get(48.4649, 35.0462)).toBe(87.0);
    expect(m.stats().fullDrops).toBe(1);
  });
});
