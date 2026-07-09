import { describe, it, expect } from "vitest";
import {
  fovFromFocalAndSensor,
  computeHorizontalFov,
  lookupSensorWidthMm,
  normaliseKey,
  verticalFovDeg,
  FULL_FRAME_WIDTH_MM,
  DEFAULT_SENSOR_WIDTH_MM,
} from "../../../src/lib/decode/sensors";

describe("fovFromFocalAndSensor", () => {
  it("full-frame 50mm ≈ 39.6° (the textbook 'normal' lens)", () => {
    expect(fovFromFocalAndSensor(50, FULL_FRAME_WIDTH_MM)).toBeCloseTo(39.6, 1);
  });
  it("full-frame 24mm ≈ 73.7° wide", () => {
    expect(fovFromFocalAndSensor(24, 36)).toBeCloseTo(73.74, 1);
  });
  it("rejects non-positive inputs", () => {
    expect(() => fovFromFocalAndSensor(0, 36)).toThrow();
    expect(() => fovFromFocalAndSensor(50, 0)).toThrow();
  });
});

describe("sensor DB lookup", () => {
  it("normalises make/model case + whitespace", () => {
    expect(normaliseKey("sony", "ilce-6700")).toBe("SONY ILCE-6700");
    expect(normaliseKey("  Sony ", "  ILCE-6700 ")).toBe("SONY ILCE-6700");
  });
  it("finds a known APS-C body", () => {
    expect(lookupSensorWidthMm("SONY", "ILCE-6700")).toBe(23.5);
  });
  it("returns undefined for an unknown body", () => {
    expect(lookupSensorWidthMm("ACME", "CAM-9000")).toBeUndefined();
  });
});

describe("computeHorizontalFov — D4 fallback ordering", () => {
  it("1) prefers FocalLengthIn35mmFormat (exact, no lookup)", () => {
    const r = computeHorizontalFov({ focalLengthIn35mmMm: 28 });
    expect(r.source).toBe("focal35");
    expect(r.estimated).toBe(false);
    expect(r.sensorWidthMm).toBe(FULL_FRAME_WIDTH_MM);
    expect(r.hFovDeg).toBeCloseTo(65.47, 1);
  });

  it("2) falls back to the sensor DB + physical focal length", () => {
    const r = computeHorizontalFov({ focalLengthMm: 50, make: "SONY", model: "ILCE-6700" });
    expect(r.source).toBe("sensorDb");
    expect(r.estimated).toBe(false);
    expect(r.sensorWidthMm).toBe(23.5);
    expect(r.hFovDeg).toBeCloseTo(26.45, 1);
  });

  it("3) flags an estimated default when the body is unknown", () => {
    const r = computeHorizontalFov({ focalLengthMm: 35, make: "ACME", model: "CAM-9000" });
    expect(r.source).toBe("default");
    expect(r.estimated).toBe(true);
    expect(r.sensorWidthMm).toBe(DEFAULT_SENSOR_WIDTH_MM);
  });

  it("never hard-fails with no focal length at all", () => {
    const r = computeHorizontalFov({});
    expect(r.estimated).toBe(true);
    expect(r.hFovDeg).toBeGreaterThan(0);
    expect(r.hFovDeg).toBeLessThan(180);
  });
});

describe("verticalFovDeg", () => {
  it("equals the horizontal FOV at aspect 1:1", () => {
    expect(verticalFovDeg(50, 1)).toBeCloseTo(50, 5);
  });
  it("is narrower than horizontal for a landscape 3:2 frame", () => {
    expect(verticalFovDeg(50, 1.5)).toBeLessThan(50);
  });
});
