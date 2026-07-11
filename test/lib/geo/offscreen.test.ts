import { describe, expect, it } from "vitest";
import { frameMarker } from "../../../src/lib/geo/offscreen";

// A 50° vertical FOV, 16:9 frame — the working case for the FPV HUD markers.
const TAN_HALF_V = Math.tan((50 * Math.PI) / 360);
const ASPECT = 16 / 9;

describe("frameMarker", () => {
  it("dead ahead is in frame", () => {
    const m = frameMarker(0, 0, -1, TAN_HALF_V, ASPECT);
    expect(m.inFrame).toBe(true);
  });

  it("just inside / just outside the vertical half-FOV", () => {
    const inside = frameMarker(0, Math.tan((24 * Math.PI) / 180), -1, TAN_HALF_V, ASPECT);
    expect(inside.inFrame).toBe(true);
    const outside = frameMarker(0, Math.tan((26 * Math.PI) / 180), -1, TAN_HALF_V, ASPECT);
    expect(outside.inFrame).toBe(false);
    expect(outside.dirY).toBeCloseTo(1, 5); // chip points up toward the body
    expect(outside.dirX).toBeCloseTo(0, 5);
  });

  it("horizontal limit scales by aspect", () => {
    const hHalfDeg = (Math.atan(TAN_HALF_V * ASPECT) * 180) / Math.PI;
    const inside = frameMarker(
      Math.tan(((hHalfDeg - 1) * Math.PI) / 180), 0, -1, TAN_HALF_V, ASPECT);
    expect(inside.inFrame).toBe(true);
    const outside = frameMarker(
      Math.tan(((hHalfDeg + 1) * Math.PI) / 180), 0, -1, TAN_HALF_V, ASPECT);
    expect(outside.inFrame).toBe(false);
    expect(outside.dirX).toBeCloseTo(1, 5); // chip points right
  });

  it("behind the camera is never in frame and still aims the chip", () => {
    const m = frameMarker(0.4, 0.3, 0.87, TAN_HALF_V, ASPECT);
    expect(m.inFrame).toBe(false);
    expect(Math.hypot(m.dirX, m.dirY)).toBeCloseTo(1, 6);
    expect(m.dirX).toBeGreaterThan(0);
    expect(m.dirY).toBeGreaterThan(0);
  });

  it("degenerate straight-behind points the chip up", () => {
    const m = frameMarker(0, 0, 1, TAN_HALF_V, ASPECT);
    expect(m.inFrame).toBe(false);
    expect(m.dirX).toBe(0);
    expect(m.dirY).toBe(1);
  });
});
