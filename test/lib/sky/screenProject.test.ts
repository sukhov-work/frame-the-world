import { describe, expect, it } from "vitest";
import { projectCameraDir } from "../../../src/lib/sky/screenProject";

const V = 55; // deg
const tanHalfV = Math.tan((V * Math.PI) / 360);
const W = 400;
const H = 800;
const aspect = W / H;

describe("projectCameraDir — the AR guides' pinhole (owner 2026-09-22 item 3)", () => {
  it("the look axis lands on the viewport centre, in front, in view", () => {
    const p = projectCameraDir(0, 0, -1, tanHalfV, aspect, W, H);
    expect(p).toEqual({ x: W / 2, y: H / 2, inView: true, front: true });
  });

  it("the vertical FOV's edge lands on the top / bottom edge exactly (f · tan θ, screen y grows down)", () => {
    const up = projectCameraDir(0, tanHalfV, -1, tanHalfV, aspect, W, H);
    expect(up.y).toBeCloseTo(0, 9);
    expect(up.x).toBeCloseTo(W / 2, 9);
    const down = projectCameraDir(0, -tanHalfV, -1, tanHalfV, aspect, W, H);
    expect(down.y).toBeCloseTo(H, 9);
    // and the horizontal edge is the vertical one scaled by the aspect
    const right = projectCameraDir(tanHalfV * aspect, 0, -1, tanHalfV, aspect, W, H);
    expect(right.x).toBeCloseTo(W, 9);
    expect(right.y).toBeCloseTo(H / 2, 9);
  });

  it("a direction behind the camera is `front: false`, never in view, and stays on ITS side of the centre", () => {
    const behindRight = projectCameraDir(0.3, 0, +1, tanHalfV, aspect, W, H);
    expect(behindRight.front).toBe(false);
    expect(behindRight.inView).toBe(false);
    expect(behindRight.x).toBeGreaterThan(W / 2);
    const sideways = projectCameraDir(1, 0, 0, tanHalfV, aspect, W, H);
    expect(sideways.front).toBe(false);
    expect(Number.isFinite(sideways.x)).toBe(true);
  });

  it("the margin widens the in-view test (an arc point just past the edge still draws)", () => {
    const px = projectCameraDir(tanHalfV * aspect * 1.05, 0, -1, tanHalfV, aspect, W, H);
    expect(px.inView).toBe(false);
    const wide = projectCameraDir(tanHalfV * aspect * 1.05, 0, -1, tanHalfV, aspect, W, H, 40);
    expect(wide.inView).toBe(true);
  });

  it("reuses the `out` record (no per-frame allocation)", () => {
    const o = { x: 0, y: 0, inView: false, front: false };
    expect(projectCameraDir(0, 0, -1, tanHalfV, aspect, W, H, 0, o)).toBe(o);
  });
});
