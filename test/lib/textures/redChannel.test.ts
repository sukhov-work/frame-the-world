import { describe, expect, it } from "vitest";
import { extractRedChannel } from "../../../src/lib/textures/redChannel";

/** 2×2 RGBA fixture — R values encode the pixel's (x, y) so flips are unambiguous:
 *  row 0: [10, 20] · row 1: [30, 40] (G/B/A bytes are decoys). */
const rgba = new Uint8ClampedArray([
  10, 99, 99, 255, 20, 99, 99, 255, // row 0
  30, 99, 99, 255, 40, 99, 99, 255, // row 1
]);

describe("extractRedChannel", () => {
  it("extracts the R byte per pixel in row order", () => {
    expect(Array.from(extractRedChannel(rgba, 2, 2))).toEqual([10, 20, 30, 40]);
  });

  it("flipY reverses row order (canvas top-down → GL bottom-up)", () => {
    expect(Array.from(extractRedChannel(rgba, 2, 2, { flipY: true }))).toEqual([30, 40, 10, 20]);
  });

  it("rejects a size mismatch loudly", () => {
    expect(() => extractRedChannel(rgba, 3, 2)).toThrow(/expected 24 RGBA bytes/);
  });
});
