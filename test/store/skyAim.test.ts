import { describe, expect, it } from "vitest";
import { gotoAimSolution } from "../../src/store/skyAim";

/**
 * Item 18 (owner 2026-08-21b): the TargetPanel GOTO button and the viewport edge chip share
 * ONE aim policy — gotoSkyBody — whose bearing decision is this pure twin. The rise-azimuth
 * scan itself (nextRiseAzimuth) is covered in test/lib/ephemeris/dayArc.test.ts.
 */
describe("gotoAimSolution — shared GOTO bearing decision (chip + TargetPanel)", () => {
  it("an up body is aimed at directly (azimuth AND altitude)", () => {
    expect(gotoAimSolution({ azDeg: 210, altDeg: 34, up: true }, 97)).toEqual({
      azDeg: 210,
      altDeg: 34,
    });
  });
  it("a down body aims at its next-rise azimuth AT the horizon", () => {
    expect(gotoAimSolution({ azDeg: 300, altDeg: -12, up: false }, 97)).toEqual({
      azDeg: 97,
      altDeg: 0,
    });
  });
  it("no rise within the scan → current azimuth at the horizon (2026-08-19b chip rule)", () => {
    expect(gotoAimSolution({ azDeg: 300, altDeg: -12, up: false }, null)).toEqual({
      azDeg: 300,
      altDeg: 0,
    });
  });
  it("the marker's own up-gate wins over raw altitude (bodyMarkerMinAltDeg sliver)", () => {
    // A marker can be `up: false` with altDeg slightly above 0 — the decision must follow
    // the gate, not re-derive from altitude.
    const out = gotoAimSolution({ azDeg: 45, altDeg: 0.5, up: false }, 120);
    expect(out).toEqual({ azDeg: 120, altDeg: 0 });
  });
});
