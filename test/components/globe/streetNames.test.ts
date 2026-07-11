import { describe, expect, it } from "vitest";
import {
  streetPresence,
  textHeightM,
  uprightFlip,
} from "../../../src/components/globe/scene/streetNames";
import { STREETS } from "../../../src/components/globe/tuning";

/**
 * Street names v3 (S7 feedback batch — GL labels pinned to the ground mesh) — the pure gates:
 * the reveal band, painted-text world sizes, and the upright-flip hysteresis that keeps labels
 * readable without flickering when the camera rides the street axis.
 */
describe("streetPresence (reveal band)", () => {
  it("is hidden above the reveal and fully present from fullAltM down to the street", () => {
    expect(streetPresence(3_000)).toBe(0);
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
