import { describe, it, expect } from "vitest";
import { channelsToRgba } from "../../../src/lib/decode/convert";

describe("channelsToRgba", () => {
  it("interleaves 3-channel RGB with opaque alpha", () => {
    const rgba = channelsToRgba(new Uint8Array([10, 20, 30, 40, 50, 60]), 2, 1, 3);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("replicates 1-channel grey", () => {
    const rgba = channelsToRgba(new Uint8Array([7, 200]), 1, 2, 1);
    expect(Array.from(rgba)).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
  });

  it("passes 4-channel through with its own alpha", () => {
    const rgba = channelsToRgba(new Uint8Array([1, 2, 3, 4]), 1, 1, 4);
    expect(Array.from(rgba)).toEqual([1, 2, 3, 4]);
  });

  it("demotes 16-bit samples to 8-bit", () => {
    const rgba = channelsToRgba(new Uint16Array([65535, 32768, 0]), 1, 1, 3);
    expect(Array.from(rgba)).toEqual([255, 128, 0, 255]);
  });

  it("throws on unsupported channel counts and short buffers", () => {
    expect(() => channelsToRgba(new Uint8Array(6), 1, 1, 2)).toThrow(/unsupported channel count/);
    expect(() => channelsToRgba(new Uint8Array(2), 1, 1, 3)).toThrow(/buffer too small/);
    expect(() => channelsToRgba(new Uint8Array(0), 0, 0, 3)).toThrow(/empty image/);
  });
});
