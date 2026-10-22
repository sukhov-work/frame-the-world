import { describe, expect, it } from "vitest";
import { clampGroundM, MAX_TERRAIN_M, refineGroundSeat, sampleGroundM } from "../../../src/lib/geo/terrain";

describe("clampGroundM", () => {
  it("clamps negative garbage (loading / coarse-LOD tiles) up to 0", () => {
    expect(clampGroundM(-500)).toBe(0);
    expect(clampGroundM(-0.0001)).toBe(0);
  });

  it("passes plausible heights through unchanged", () => {
    expect(clampGroundM(0)).toBe(0);
    expect(clampGroundM(123.4)).toBe(123.4);
    expect(clampGroundM(MAX_TERRAIN_M)).toBe(MAX_TERRAIN_M);
  });

  it("caps above Everest-plausible ground", () => {
    expect(clampGroundM(50_000)).toBe(MAX_TERRAIN_M);
    expect(clampGroundM(MAX_TERRAIN_M + 1)).toBe(MAX_TERRAIN_M);
  });
});

describe("sampleGroundM (audit A1 — the pin ground-latch regression)", () => {
  it("missing sample falls back and stays not-real (resnap keeps trying)", () => {
    expect(sampleGroundM(null, 120)).toEqual({ h: 120, real: false });
    expect(sampleGroundM(undefined, 120)).toEqual({ h: 120, real: false });
    expect(sampleGroundM(Number.NaN, 120)).toEqual({ h: 120, real: false });
  });

  it("negative loading-phase garbage is clamped for placement but NEVER latched as real", () => {
    expect(sampleGroundM(-500, 120)).toEqual({ h: 0, real: false });
    expect(sampleGroundM(-0.0001, 120)).toEqual({ h: 0, real: false });
  });

  it("over-ceiling garbage is capped and not latched", () => {
    expect(sampleGroundM(50_000, 120)).toEqual({ h: MAX_TERRAIN_M, real: false });
  });

  it("in-range answers pass through and latch", () => {
    expect(sampleGroundM(0, 120)).toEqual({ h: 0, real: true });
    expect(sampleGroundM(97.3, 120)).toEqual({ h: 97.3, real: true });
    expect(sampleGroundM(MAX_TERRAIN_M, 120)).toEqual({ h: MAX_TERRAIN_M, real: true });
  });
});

describe("refineGroundSeat (T195 — a seat refines to a finer tile and never regresses to a coarser one)", () => {
  it("the first answer seats: a missing sample falls back unreal with no depth; a finite one is real at its depth", () => {
    expect(refineGroundSeat(null, null, 120)).toEqual({ seat: { h: 120, real: false, depth: -1 }, moved: true });
    expect(refineGroundSeat(null, { h: 90.3, depth: 11 }, 120)).toEqual({ seat: { h: 90.3, real: true, depth: 11 }, moved: true });
    // A bare height (a `heightAt` sampler) is real with an unknown depth.
    expect(refineGroundSeat(null, 97.3, 120)).toEqual({ seat: { h: 97.3, real: true, depth: -1 }, moved: true });
    // Out-of-range garbage is placed clamped but stays unreal — and carries no depth to refuse later answers by.
    expect(refineGroundSeat(null, { h: -500, depth: 11 }, 120)).toEqual({ seat: { h: 0, real: false, depth: -1 }, moved: true });
  });

  it("an unreal seat takes any finite in-range answer; no tile holds it", () => {
    const unreal = { h: 120, real: false, depth: -1 };
    expect(refineGroundSeat(unreal, undefined, 120)).toEqual({ seat: unreal, moved: false });
    expect(refineGroundSeat(unreal, { h: 85.85, depth: 18 }, 120)).toEqual({ seat: { h: 85.85, real: true, depth: 18 }, moved: true });
    expect(refineGroundSeat(unreal, 85.85, 120)).toEqual({ seat: { h: 85.85, real: true, depth: -1 }, moved: true });
  });

  it("THE T195 RULE: a real seat moves to a strictly deeper tile, holds on an equal or coarser one, holds on garbage", () => {
    const coarse = { h: 90.26, real: true, depth: 11 }; // the 60 km boot's answer
    const fine = refineGroundSeat(coarse, { h: 85.85, depth: 18 }, 120); // the descent refined the tile
    expect(fine).toEqual({ seat: { h: 85.85, real: true, depth: 18 }, moved: true });
    // The camera leaves, the fine tile is disposed, the parent answers again — the seat holds.
    expect(refineGroundSeat(fine.seat, { h: 90.26, depth: 11 }, 120)).toEqual({ seat: fine.seat, moved: false });
    // The same tile re-asked — the same raycast, nothing moves (even with a jittered height).
    expect(refineGroundSeat(fine.seat, { h: 85.9, depth: 18 }, 120)).toEqual({ seat: fine.seat, moved: false });
    // A deeper answer that is out of range is loading-phase garbage — hold the real seat.
    expect(refineGroundSeat(fine.seat, { h: -3, depth: 19 }, 120)).toEqual({ seat: fine.seat, moved: false });
    // A deeper tile with the SAME height — seated deeper, but the anchor did not move.
    expect(refineGroundSeat(fine.seat, { h: 85.85, depth: 19 }, 120)).toEqual({ seat: { h: 85.85, real: true, depth: 19 }, moved: false });
  });

  it("a real seat with an unknown depth (a plain heightAt sampler) is the old latch — it never moves", () => {
    const latched = { h: 97.3, real: true, depth: -1 };
    expect(refineGroundSeat(latched, 85, 120)).toEqual({ seat: latched, moved: false });
    expect(refineGroundSeat(latched, { h: 85, depth: -1 }, 120)).toEqual({ seat: latched, moved: false });
    // …unless the new sampler knows its depth: any stamped tile is deeper than "unknown".
    expect(refineGroundSeat(latched, { h: 85, depth: 11 }, 120)).toEqual({ seat: { h: 85, real: true, depth: 11 }, moved: true });
  });
});
