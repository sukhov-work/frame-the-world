import { describe, expect, it } from "vitest";
import {
  labelScaleFor,
  streetPresence,
  textHeightM,
  textPxTargetFor,
  uprightFlip,
  worldPerPx,
} from "../../../src/components/globe/scene/streetNames";
import { STREETS } from "../../../src/components/globe/tuning";

/**
 * Street names v3 (S7 feedback batch — GL labels pinned to the ground mesh) — the pure gates:
 * the reveal band, painted-text world sizes, and the upright-flip hysteresis that keeps labels
 * readable without flickering when the camera rides the street axis.
 */
describe("streetPresence (reveal band)", () => {
  it("is hidden above the reveal and fully present from fullAltM down to the street", () => {
    expect(streetPresence(STREETS.topAltM + 500)).toBe(0);
    expect(streetPresence(STREETS.topAltM)).toBe(0);
    expect(streetPresence(STREETS.fullAltM)).toBe(1);
    expect(streetPresence(300)).toBe(1); // stays on at street level
  });

  it("ramps linearly across the band", () => {
    const mid = (STREETS.topAltM + STREETS.fullAltM) / 2;
    expect(streetPresence(mid)).toBeCloseTo(0.5, 10);
  });
});

describe("textHeightM (painted text world size by class tier)", () => {
  it("majors are the largest tier, the long tail the smallest", () => {
    expect(textHeightM(0)).toBe(STREETS.textHeightM[0]); // motorway
    expect(textHeightM(2)).toBe(STREETS.textHeightM[0]); // primary
    expect(textHeightM(3)).toBe(STREETS.textHeightM[1]); // secondary
    expect(textHeightM(4)).toBe(STREETS.textHeightM[1]); // tertiary
    expect(textHeightM(5)).toBe(STREETS.textHeightM[2]); // minor
    expect(textHeightM(99)).toBe(STREETS.textHeightM[2]); // unknown classes
  });

  it("tiers are monotonically non-increasing (majors never smaller)", () => {
    expect(STREETS.textHeightM[0]).toBeGreaterThanOrEqual(STREETS.textHeightM[1]);
    expect(STREETS.textHeightM[1]).toBeGreaterThanOrEqual(STREETS.textHeightM[2]);
  });
});

describe("worldPerPx + labelScaleFor (v4.1 per-tier legibility scale)", () => {
  it("worldPerPx: a 55° camera at 2 km over an 874-px viewport ≈ 2.4 m/px", () => {
    const wpp = worldPerPx(2_000, 55, 874);
    expect(wpp).toBeCloseTo((2 * 2_000 * Math.tan((55 * Math.PI) / 360)) / 874, 12);
    expect(wpp).toBeGreaterThan(2);
    expect(wpp).toBeLessThan(3);
  });

  it("textPxTargetFor mirrors the class-tier ladder", () => {
    expect(textPxTargetFor(0)).toBe(STREETS.textPxTarget[0]);
    expect(textPxTargetFor(2)).toBe(STREETS.textPxTarget[0]);
    expect(textPxTargetFor(3)).toBe(STREETS.textPxTarget[1]);
    expect(textPxTargetFor(5)).toBe(STREETS.textPxTarget[2]);
    expect(textPxTargetFor(99)).toBe(STREETS.textPxTarget[2]);
  });

  it("floors at 1 (street level keeps the road-paint world sizes)", () => {
    const wpp = worldPerPx(300, 55, 874);
    expect(labelScaleFor(STREETS.textHeightM[2], STREETS.textPxTarget[2], wpp)).toBe(1);
    expect(labelScaleFor(STREETS.textHeightM[0], STREETS.textPxTarget[0], wpp)).toBe(1);
  });

  it("each tier lands on ITS OWN screen px target at altitude (majors no longer 2×)", () => {
    const wpp = worldPerPx(4_000, 55, 874);
    for (const [h, px] of [
      [STREETS.textHeightM[0], STREETS.textPxTarget[0]],
      [STREETS.textHeightM[2], STREETS.textPxTarget[2]],
    ] as const) {
      const s = labelScaleFor(h, px, wpp);
      expect(s).toBeGreaterThan(1);
      if (s < STREETS.maxTextScale) {
        expect((h * s) / wpp).toBeCloseTo(px, 6); // scaled screen height = the tier target
      }
    }
  });

  it("caps at maxTextScale", () => {
    expect(labelScaleFor(STREETS.textHeightM[2], STREETS.textPxTarget[2], 1e9)).toBe(
      STREETS.maxTextScale,
    );
  });

  it("screen sizes stay monotone across tiers (majors ≥ minors)", () => {
    const wpp = worldPerPx(3_000, 55, 874);
    const px = (h: number, p: number) => (h * labelScaleFor(h, p, wpp)) / wpp;
    expect(px(STREETS.textHeightM[0], STREETS.textPxTarget[0])).toBeGreaterThanOrEqual(
      px(STREETS.textHeightM[2], STREETS.textPxTarget[2]),
    );
  });
});

describe("uprightFlip (hysteresis — no flicker on the street axis)", () => {
  it("flips only past the dead band", () => {
    expect(uprightFlip(-STREETS.flipHysteresis - 0.01, false)).toBe(true);
    expect(uprightFlip(-STREETS.flipHysteresis - 0.01, true)).toBe(false);
  });

  it("holds the current side inside the dead band (both signs)", () => {
    expect(uprightFlip(-STREETS.flipHysteresis + 0.01, false)).toBe(false);
    expect(uprightFlip(-STREETS.flipHysteresis + 0.01, true)).toBe(true);
    expect(uprightFlip(0, false)).toBe(false);
    expect(uprightFlip(0, true)).toBe(true);
    expect(uprightFlip(0.5, true)).toBe(true); // readable — no reason to unflip
  });

  it("a camera oscillating around zero never toggles (the v2 jump killer)", () => {
    let flipped = false;
    for (const dot of [0.03, -0.03, 0.05, -0.05, 0.02, -0.06]) {
      flipped = uprightFlip(dot, flipped);
    }
    expect(flipped).toBe(false);
  });
});
