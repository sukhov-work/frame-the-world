import { describe, expect, it } from "vitest";
import { HeightMemo } from "../../../src/lib/globe/heightMemo";

/**
 * RC11 (audit slice S16) — the terrain-height memo.
 *
 * The property that makes it safe to put in front of `heightAt` — which seats buildings, the
 * photo frustum and the FPV eye — is that it is EXACT: same epoch and same coordinates in, same
 * answer out, with no quantisation and no interpolation. Everything below is about that, plus
 * the one deliberate omission: `null` is never cached, because "no tile covers this yet" is the
 * answer that most wants retrying.
 */

describe("HeightMemo", () => {
  it("misses on an empty memo and hits after a set", () => {
    const m = new HeightMemo(100);
    expect(m.get(48.4647, 35.0462, 1)).toBeUndefined();
    m.set(48.4647, 35.0462, 1, 85.85);
    expect(m.get(48.4647, 35.0462, 1)).toBe(85.85);
  });

  it("is exact — a coordinate one micro-degree away is a different question", () => {
    const m = new HeightMemo(100);
    m.set(48.4647, 35.0462, 1, 85.85);
    expect(m.get(48.46470001, 35.0462, 1)).toBeUndefined();
    expect(m.get(48.4647, 35.04620001, 1)).toBeUndefined();
    expect(m.get(-48.4647, 35.0462, 1)).toBeUndefined();
  });

  it("never confuses the two coordinates", () => {
    const m = new HeightMemo(100);
    m.set(1, 2, 1, 10);
    m.set(2, 1, 1, 20);
    expect(m.get(1, 2, 1)).toBe(10);
    expect(m.get(2, 1, 1)).toBe(20);
  });

  it("drops EVERYTHING when the terrain epoch moves — the ground refined under it", () => {
    const m = new HeightMemo(100);
    m.set(1, 2, 1, 10);
    m.set(3, 4, 1, 30);
    expect(m.get(1, 2, 2)).toBeUndefined(); // new epoch → cleared
    expect(m.get(3, 4, 2)).toBeUndefined(); // …and it stays cleared
    expect(m.stats().invalidations).toBe(1); // one drop, not two
    expect(m.stats().entries).toBe(0);
  });

  it("a set at a newer epoch also drops the old generation", () => {
    const m = new HeightMemo(100);
    m.set(1, 2, 1, 10);
    m.set(3, 4, 2, 30);
    expect(m.get(1, 2, 2)).toBeUndefined();
    expect(m.get(3, 4, 2)).toBe(30);
  });

  it("caches zero and negative heights (both are real answers)", () => {
    const m = new HeightMemo(100);
    m.set(1, 2, 1, 0);
    m.set(3, 4, 1, -12.5);
    expect(m.get(1, 2, 1)).toBe(0);
    expect(m.get(3, 4, 1)).toBe(-12.5);
  });

  it("drops wholesale on overflow and counts it rather than growing without bound", () => {
    const m = new HeightMemo(4);
    for (let i = 0; i < 4; i++) m.set(i, 0, 1, i);
    expect(m.stats().entries).toBe(4);
    m.set(99, 0, 1, 99);
    expect(m.stats().entries).toBe(1);
    expect(m.stats().overflows).toBe(1);
    expect(m.get(99, 0, 1)).toBe(99);
    expect(m.get(0, 0, 1)).toBeUndefined();
  });

  it("reports a hit rate that reflects the round-robin it exists for", () => {
    const m = new HeightMemo(1_000);
    // First sweep over 50 footprints: all misses. Second and third: all hits.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 50; i++) {
        const v = m.get(i, 0, 7);
        if (v === undefined) m.set(i, 0, 7, i * 1.5);
      }
    }
    const s = m.stats();
    expect(s.hits).toBe(100);
    expect(s.misses).toBe(50);
    expect(s.hitRate).toBeCloseTo(2 / 3, 4);
    expect(s.epoch).toBe(7);
  });

  it("resetStats leaves the entries and clear() removes them", () => {
    const m = new HeightMemo(100);
    m.set(1, 2, 1, 10);
    m.get(1, 2, 1);
    m.resetStats();
    expect(m.stats().hits).toBe(0);
    expect(m.stats().entries).toBe(1);
    m.clear();
    expect(m.stats().entries).toBe(0);
    expect(m.get(1, 2, 1)).toBeUndefined();
  });
});
