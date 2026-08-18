import { describe, expect, it } from "vitest";
import { easeSeatM } from "../../../src/components/globe/scene/aimCones";
import { MAX_TERRAIN_M } from "../../../src/lib/geo/terrain";

/**
 * A1 regression (audit-2, 2026-08-18): the aim-cone terrain seat was the ONE live `heightAt`
 * consumer without the `[0, MAX_TERRAIN_M]` clamp — a coarse-LOD negative probe snapped the
 * circle underground on the FIRST sample and the ease retained it. The clamp must gate the
 * probe BEFORE it seats or steers the ease (lib/geo/terrain.ts consumer mandate).
 */
describe("easeSeatM — clamped, eased aim-cone terrain seat", () => {
  const TAU = 250;

  it("first finite sample SNAPS (unseeded NaN prev)", () => {
    expect(easeSeatM(Number.NaN, 120, 16, TAU)).toBe(120);
  });

  it("null probe keeps the last seat — including the unseeded NaN state", () => {
    expect(easeSeatM(95, null, 16, TAU)).toBe(95);
    expect(Number.isNaN(easeSeatM(Number.NaN, null, 16, TAU))).toBe(true);
  });

  it("A1: a coarse-LOD NEGATIVE first sample seats at 0, never underground", () => {
    expect(easeSeatM(Number.NaN, -500, 16, TAU)).toBe(0);
  });

  it("A1: a negative probe cannot steer an existing seat below 0", () => {
    let h = 40;
    for (let i = 0; i < 400; i++) h = easeSeatM(h, -2000, 16, TAU);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(0.5); // converges to the clamp floor, not the raw −2000
  });

  it("garbage above Everest clamps to MAX_TERRAIN_M", () => {
    expect(easeSeatM(Number.NaN, 1e9, 16, TAU)).toBe(MAX_TERRAIN_M);
  });

  it("eases toward the probe with the exact 1−exp(−dt/τ) step", () => {
    const stepped = easeSeatM(100, 200, 250, TAU);
    expect(stepped).toBeCloseTo(100 + 100 * (1 - Math.exp(-1)), 9);
    // Converges: many steps approach the probe from below.
    let h = 100;
    for (let i = 0; i < 200; i++) h = easeSeatM(h, 200, 100, TAU);
    expect(h).toBeCloseTo(200, 3);
  });
});
