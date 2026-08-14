import { describe, expect, it } from "vitest";
import { azAltFrameMarker, frameMarker } from "../../../src/lib/geo/offscreen";

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

describe("azAltFrameMarker (QoL-1 §3.1.D rail trace / QoL-2 frameFinder seed)", () => {
  const pose = { headingDeg: 0, pitchDeg: 0, fovDeg: 50, aspect: 16 / 9 };

  it("straight down the view axis is in frame at any heading/pitch", () => {
    expect(azAltFrameMarker(0, 0, pose).inFrame).toBe(true);
    const tilted = { ...pose, headingDeg: 137, pitchDeg: 42 };
    expect(azAltFrameMarker(137, 42, tilted).inFrame).toBe(true);
  });

  it("respects the vertical half-FOV about the pitch", () => {
    expect(azAltFrameMarker(0, 24, pose).inFrame).toBe(true);
    expect(azAltFrameMarker(0, 26, pose).inFrame).toBe(false);
    expect(azAltFrameMarker(0, -26, pose).inFrame).toBe(false);
    // Raising the pitch brings the high bearing in.
    expect(azAltFrameMarker(0, 26, { ...pose, pitchDeg: 10 }).inFrame).toBe(true);
  });

  it("respects the horizontal half-FOV about the heading (wraps through north)", () => {
    const hHalfDeg = (Math.atan(Math.tan((25 * Math.PI) / 180) * pose.aspect) * 180) / Math.PI;
    expect(azAltFrameMarker(hHalfDeg - 1, 0, pose).inFrame).toBe(true);
    expect(azAltFrameMarker(hHalfDeg + 1, 0, pose).inFrame).toBe(false);
    expect(azAltFrameMarker(360 - (hHalfDeg - 1), 0, pose).inFrame).toBe(true);
  });

  it("behind the camera is never in frame", () => {
    expect(azAltFrameMarker(180, 0, pose).inFrame).toBe(false);
    expect(azAltFrameMarker(180, 45, pose).inFrame).toBe(false);
  });

  it("agrees with frameMarker through an explicit camera basis (east view)", () => {
    // Looking due east, body 10° south of the view axis → vx = tan(10°) of the forward length.
    const m = azAltFrameMarker(100, 0, { ...pose, headingDeg: 90 });
    const direct = frameMarker(Math.tan((10 * Math.PI) / 180), 0, -1,
      Math.tan((25 * Math.PI) / 180), pose.aspect);
    expect(m.inFrame).toBe(direct.inFrame);
    expect(m.dirX).toBeGreaterThan(0); // south of an east view = frame right
  });
});
