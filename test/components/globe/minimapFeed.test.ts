import { describe, expect, it } from "vitest";
import { horizontalFovDeg } from "../../../src/components/globe/scene/minimapFeed";

/**
 * U3 view cone — the vertical-FOV → horizontal-FOV conversion the mini-map cone width rides
 * (fpvHud mirrors the camera's VERTICAL fov; the cone must show the horizontal frame edge).
 */
describe("horizontalFovDeg", () => {
  it("square aspect keeps the FOV", () => {
    expect(horizontalFovDeg(58, 1)).toBeCloseTo(58, 9);
  });

  it("wide aspect widens, tall aspect narrows", () => {
    expect(horizontalFovDeg(58, 16 / 9)).toBeGreaterThan(58);
    expect(horizontalFovDeg(58, 9 / 16)).toBeLessThan(58);
  });

  it("matches the closed form for the phone portrait case", () => {
    const aspect = 402 / 874;
    const expected =
      (2 * Math.atan(Math.tan((58 * Math.PI) / 360) * aspect) * 180) / Math.PI;
    expect(horizontalFovDeg(58, aspect)).toBeCloseTo(expected, 12);
  });
});
