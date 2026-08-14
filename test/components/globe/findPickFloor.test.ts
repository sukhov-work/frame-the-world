import { describe, expect, it } from "vitest";
import { findPickFloor } from "../../../src/components/globe/scene/findGhosts";
import { FINDGHOSTS } from "../../../src/components/globe/tuning";

/** CPU twin of the FIND ghosts' sky-aware interactivity floor (owner bug 2026-08-14 night-6:
 *  visible twilight moon standings ignored the mouse — a flat 0.08 floor sat above their
 *  effective alphas). The floor blends night→day on the observer's sun altitude. */
describe("findPickFloor", () => {
  it("full night floor: 'if it draws, it responds'", () => {
    expect(findPickFloor(-18)).toBe(FINDGHOSTS.pickMinAlphaNight);
    expect(findPickFloor(FINDGHOSTS.pickSunAltLoDeg)).toBe(FINDGHOSTS.pickMinAlphaNight);
  });

  it("full day floor: a washed-invisible ghost must not steal a sky click", () => {
    expect(findPickFloor(45)).toBe(FINDGHOSTS.pickMinAlphaDay);
    expect(findPickFloor(FINDGHOSTS.pickSunAltHiDeg)).toBe(FINDGHOSTS.pickMinAlphaDay);
  });

  it("monotone across the twilight band", () => {
    let prev = findPickFloor(FINDGHOSTS.pickSunAltLoDeg);
    for (
      let alt = FINDGHOSTS.pickSunAltLoDeg + 0.5;
      alt <= FINDGHOSTS.pickSunAltHiDeg;
      alt += 0.5
    ) {
      const f = findPickFloor(alt);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("owner repro pin: civil twilight (sun −5.8°) keeps the faintest visible standing live", () => {
    // Measured 2026-08-14 at f=48.449313,35.102246,1.7,250.6,2.5,20.9&t=1786728571688:
    // moon standings' effective alphas ran 0.026 (12.01 · 21%) … 0.079 (17.08 · 27%) — every
    // ring plainly visible, ALL hover-dead under the flat 0.08 floor.
    const floor = findPickFloor(-5.8);
    expect(floor).toBeLessThan(0.026);
    // …but never below the shader's own discard (a ghost that does not draw stays inert).
    expect(floor).toBeGreaterThan(0.012);
  });

  it("night floor sits above the shader discard, day floor above night", () => {
    expect(FINDGHOSTS.pickMinAlphaNight).toBeGreaterThan(0.012);
    expect(FINDGHOSTS.pickMinAlphaDay).toBeGreaterThan(FINDGHOSTS.pickMinAlphaNight);
  });
});
