import { describe, expect, it } from "vitest";
import {
  chooseTerrainHit,
  hitDepth,
  TERRAIN_DEPTH_KEY,
  TerrainPickStats,
} from "../../../src/lib/globe/terrainPick";

/**
 * RC6 / audit gap #2 (slice S3) — the terrain samplers must pick the FINEST hit, not the nearest.
 *
 * The failure this replaces is subtle and self-healing, which is why it survived so long: while a
 * coarse parent tile crossfades out it is still in the scene and still raycastable, and over any
 * slope it sits above or below its own children by the LOD error. `[0]` picked it whenever it sat
 * above — so a building seated during a fade was wrong by metres, and right again a second later.
 */

const hit = (depth: number | undefined, distance: number) => ({
  object: { userData: depth === undefined ? {} : { [TERRAIN_DEPTH_KEY]: depth } },
  distance,
});

describe("hitDepth", () => {
  it("reads the stamped depth", () => {
    expect(hitDepth(hit(7, 100))).toBe(7);
  });

  it("treats an unstamped object as the shallowest possible thing", () => {
    expect(hitDepth(hit(undefined, 100))).toBe(-1);
    expect(hitDepth({ object: {}, distance: 1 })).toBe(-1);
    expect(hitDepth({ object: { userData: { [TERRAIN_DEPTH_KEY]: "9" } }, distance: 1 })).toBe(-1);
  });
});

describe("chooseTerrainHit", () => {
  it("returns null for no hits", () => {
    expect(chooseTerrainHit([])).toBeNull();
  });

  it("returns the only hit", () => {
    const h = hit(5, 42);
    expect(chooseTerrainHit([h])).toBe(h);
  });

  it("prefers the DEEPEST tile even when it is further along the ray", () => {
    // The bug, exactly: a crossfading parent (depth 12) sits 3 m above its child (depth 15).
    const parent = hit(12, 9_997);
    const child = hit(15, 10_000);
    expect(chooseTerrainHit([parent, child])).toBe(child);
  });

  it("breaks ties on distance, nearest first", () => {
    const far = hit(15, 10_010);
    const near = hit(15, 10_000);
    expect(chooseTerrainHit([far, near])).toBe(near);
    expect(chooseTerrainHit([near, far])).toBe(near);
  });

  it("still answers when nothing is stamped (a pre-RC6 scene, or an unexpected object)", () => {
    const a = hit(undefined, 10_005);
    const b = hit(undefined, 10_000);
    expect(chooseTerrainHit([a, b])).toBe(b);
  });

  it("an unstamped object can only win if nothing stamped hit", () => {
    const stamped = hit(0, 10_100);
    const unstamped = hit(undefined, 10_000);
    expect(chooseTerrainHit([unstamped, stamped])).toBe(stamped);
  });

  it("does not mutate or reorder the input (three reuses its intersection array)", () => {
    const hits = [hit(12, 9_997), hit(15, 10_000), hit(15, 9_999)];
    const copy = [...hits];
    chooseTerrainHit(hits);
    expect(hits).toEqual(copy);
    expect(hits[0]).toBe(copy[0]);
  });

  it("scales to a deep fade stack and always lands on the maximum depth", () => {
    const hits = [];
    for (let d = 0; d < 20; d++) hits.push(hit(d, 10_000 - d)); // deeper = further
    const best = chooseTerrainHit(hits)!;
    expect(hitDepth(best)).toBe(19);
  });
});

describe("TerrainPickStats — audit measurement M7", () => {
  it("counts how often the nearest hit is NOT the one chosen", () => {
    const s = new TerrainPickStats();
    s.note(2, true, 0);
    s.note(3, false, 4.2);
    s.note(1, true, 0);
    s.note(2, false, -6.5);
    const snap = s.snapshot();
    expect(snap.samples).toBe(4);
    expect(snap.parentWins).toBe(2);
    expect(snap.parentWinRate).toBe(0.5);
    expect(snap.worstDeltaM).toBe(6.5); // magnitude, sign-independent
    expect(snap.hitsPerSample).toBe(2);
  });

  it("is empty-safe and resettable", () => {
    const s = new TerrainPickStats();
    expect(s.snapshot()).toEqual({
      samples: 0,
      parentWins: 0,
      parentWinRate: 0,
      worstDeltaM: 0,
      hitsPerSample: 0,
    });
    s.note(4, false, 3);
    s.reset();
    expect(s.snapshot().samples).toBe(0);
    expect(s.snapshot().worstDeltaM).toBe(0);
  });
});
