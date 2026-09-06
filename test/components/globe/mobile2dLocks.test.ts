import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROLS, MOBILE2D } from "../../../src/components/globe/tuning";

/**
 * The `/m` shell's 2D-map locks (`stepMobile2dLocks`, StylizedTiles.ts) — T77 phone profile
 * 2026-09-07b (MEASUREMENTS §21). On both phones the `/m` frame was CPU-bound with the terrain
 * loaded (iPhone 17 Pro 26 ms, Pixel 6 Pro 55 ms per frame) and the CPU profile put 87 % of the
 * main thread under ONE call: `controls.getPivotPoint`, a centre-screen raycast that walks the
 * terrain TIN's triangles, issued EVERY frame to measure the live tilt — before the deadband that
 * exists so a locked map does "no per-frame rotation work" (tuning.ts MOBILE2D). The fix judges
 * the deadband from the ellipsoid normal under the camera and raycasts only in frames that rotate.
 * Two pins: the ORDER (deadband first, one raycast, inside the correction) and the geometric claim
 * the substitution rests on.
 */

const root = join(__dirname, "..", "..", "..");
const src = readFileSync(join(root, "src", "components", "globe", "StylizedTiles.ts"), "utf8");

const body = (() => {
  const start = src.indexOf("const stepMobile2dLocks = () => {");
  const end = src.indexOf("const stepZoomGlide = () => {", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe("stepMobile2dLocks — the tilt deadband is judged without the pivot raycast", () => {
  it("calls controls.getPivotPoint exactly once, and only inside the tilt-correction branch", () => {
    const calls = body.match(/controls\.getPivotPoint\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const deadband = body.indexOf("MOBILE2D.lockTiltEpsDeg");
    const pivot = body.indexOf("controls.getPivotPoint(");
    const rotate = body.indexOf("zc._applyRotation(");
    expect(deadband).toBeGreaterThan(0);
    // deadband test → raycast → the rotation that consumes the pivot: strictly in that order
    expect(pivot).toBeGreaterThan(deadband);
    expect(rotate).toBeGreaterThan(pivot);
  });

  it("measures the live pitch from the ellipsoid normal under the CAMERA, not the pivot", () => {
    const up = body.indexOf("zc.getUpDirection(camera.position, _pivotUp)");
    const pitch = body.indexOf("_pivotUp.angleTo(_camBack)");
    const pivot = body.indexOf("controls.getPivotPoint(");
    expect(up).toBeGreaterThan(0);
    expect(pitch).toBeGreaterThan(up);
    expect(pivot).toBeGreaterThan(pitch);
    // the old shape — the pivot's own up — must not come back
    expect(body).not.toContain("zc.getUpDirection(_pivot, _pivotUp)");
  });

  it("the substitution is exact to far below the deadband: normals 300 m apart on WGS84 differ by < 0.003°", () => {
    // The pivot (ground under the screen centre) sits within a few hundred metres of the
    // sub-camera point on a locked nadir map at the shell's 200–600 m altitudes; the ellipsoid
    // normal turns by (arc / radius) over that distance. Against a 0.2° deadband that is noise.
    const a = 6378137; // WGS84 semi-major axis (m); the polar radius is smaller → a tighter bound
    const b = 6356752.314245;
    const arcM = 300;
    const worstTurnRad = arcM / b; // the curvature is greatest along a meridian at the equator... bounded by the smaller radius
    const worstTurnDeg = (worstTurnRad * 180) / Math.PI;
    expect(worstTurnDeg).toBeLessThan(0.003);
    expect(worstTurnDeg).toBeLessThan(MOBILE2D.lockTiltEpsDeg / 60);
    expect(a).toBeGreaterThan(b);
  });
});

describe("stepTiltGlide — the glide's pivot is raycast at a cadence, not per frame", () => {
  const glide = (() => {
    const start = src.indexOf("const stepTiltGlide = () => {");
    const end = src.indexOf("const stepHeadingGlide = () => {", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it("calls controls.getPivotPoint once, behind the tiltGlidePivotRefreshMs gate, into its own vector", () => {
    expect(glide.match(/controls\.getPivotPoint\(/g) ?? []).toHaveLength(1);
    const gate = glide.indexOf("CONTROLS.tiltGlidePivotRefreshMs");
    const pivot = glide.indexOf("controls.getPivotPoint(_tiltGlidePivot)");
    const rotate = glide.indexOf("zc._applyRotation(");
    expect(gate).toBeGreaterThan(0);
    expect(pivot).toBeGreaterThan(gate);
    expect(rotate).toBeGreaterThan(pivot);
    // the per-frame shape must not come back
    expect(glide).not.toContain("controls.getPivotPoint(_pivot)");
  });

  it("re-arms the pivot for the next glide when a glide arrives or none is running", () => {
    expect(glide.match(/tiltGlidePivotAtMs = -Infinity/g) ?? []).toHaveLength(2);
  });

  it("the cadence lets a landing tile move the pivot within a glide, yet is far sparser than a frame", () => {
    expect(CONTROLS.tiltGlidePivotRefreshMs).toBeGreaterThanOrEqual(100);
    expect(CONTROLS.tiltGlidePivotRefreshMs).toBeLessThanOrEqual(500);
    expect(CONTROLS.tiltGlidePivotRefreshMs).toBeGreaterThan(16.7 * 6); // ≥ 6 frames apart at 60 Hz
  });
});
