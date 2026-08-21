import { describe, expect, it } from "vitest";
import {
  bandFor,
  bandFutureInk,
  easeSeatM,
} from "../../../src/components/globe/scene/aimCones";
import { MAX_TERRAIN_M } from "../../../src/lib/geo/terrain";
import { AIMCONES } from "../../../src/components/globe/tuning";
import { tokens } from "../../../src/lib/theme/tokens";

describe("bandFor — S2 concentric annular band allocation (one model, three surfaces)", () => {
  it("maps each body to its own tunable pair", () => {
    expect(bandFor("sun")).toBe(AIMCONES.bandSun);
    expect(bandFor("moon")).toBe(AIMCONES.bandMoon);
    expect(bandFor("target")).toBe(AIMCONES.bandTarget);
  });
  it("bands are well-formed and NON-OVERLAPPING (batch #6 order: moon < sun < target)", () => {
    for (const mobile of [false, true]) {
      for (const key of ["sun", "moon", "target"] as const) {
        const [rIn, rOut] = bandFor(key, mobile);
        expect(rIn).toBeGreaterThan(0);
        expect(rOut).toBeGreaterThan(rIn);
        expect(rOut).toBeLessThanOrEqual(1);
      }
      // Moon innermost, sun directly above, target a small gap above the sun (owner batch #6
      // — supersedes the batch-#4 sun-inner sketch order).
      expect(bandFor("moon", mobile)[1]).toBeLessThan(bandFor("sun", mobile)[0]);
      expect(bandFor("sun", mobile)[1]).toBeLessThan(bandFor("target", mobile)[0]);
      // The target zone is COMPACTED off the unit rim: ~3× the sun/moon band width.
      const bandW = bandFor("sun", mobile)[1] - bandFor("sun", mobile)[0];
      const targetW = bandFor("target", mobile)[1] - bandFor("target", mobile)[0];
      expect(bandFor("target", mobile)[1]).toBeLessThan(1);
      expect(targetW / bandW).toBeCloseTo(3, 5);
    }
  });
  it("the N marker offset sits past its anchor radius", () => {
    expect(AIMCONES.northOffsetK).toBeGreaterThan(1);
  });
  it("mobile variant (batch #5 item 2): the whole stack pulled inward, own tunables", () => {
    expect(bandFor("sun", true)).toBe(AIMCONES.bandSunMobile);
    expect(bandFor("moon", true)).toBe(AIMCONES.bandMoonMobile);
    expect(bandFor("target", true)).toBe(AIMCONES.bandTargetMobile);
    expect(AIMCONES.bandSunMobile[0]).toBeLessThan(AIMCONES.bandSun[0]);
    expect(AIMCONES.bandMoonMobile[0]).toBeLessThan(AIMCONES.bandMoon[0]);
    expect(AIMCONES.bandTargetMobile[0]).toBeLessThan(AIMCONES.bandTarget[0]);
    // The /m radius shrink is a proper fraction — never grows, never vanishes.
    expect(AIMCONES.mobileRadiusK).toBeGreaterThan(0);
    expect(AIMCONES.mobileRadiusK).toBeLessThan(1);
  });
  it("resting fill wash (batch #5 item 1): visible, below the emphasized fill", () => {
    expect(AIMCONES.fillAlphaRest).toBeGreaterThan(0.003); // above the shader discard gate
    expect(AIMCONES.fillAlphaRest).toBeLessThan(AIMCONES.fillAlpha);
  });
});

describe("bandFutureInk — item 17 body-tinted future halves (owner 2026-08-21b)", () => {
  it("sun/moon future = BODY ink; target keeps the scrubber future-blue", () => {
    expect(bandFutureInk("sun")).toBe(tokens.sunGlow);
    expect(bandFutureInk("moon")).toBe(tokens.moonDial);
    expect(bandFutureInk("target")).toBe(tokens.timeFuture);
  });
  it("every future ink stays distinct from the shared past grey", () => {
    for (const key of ["sun", "moon", "target"] as const) {
      expect(bandFutureInk(key)).not.toBe(tokens.textSecondary);
    }
  });
});

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
