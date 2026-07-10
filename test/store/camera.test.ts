import { beforeEach, describe, expect, it } from "vitest";
import {
  altMToSlider,
  headingDeltaDeg,
  sliderToAltM,
  useCameraStore,
  wrapHeadingDeg,
} from "../../src/store/camera";

describe("heading math", () => {
  it("wraps headings into [0, 360)", () => {
    expect(wrapHeadingDeg(0)).toBe(0);
    expect(wrapHeadingDeg(360)).toBe(0);
    expect(wrapHeadingDeg(-90)).toBe(270);
    expect(wrapHeadingDeg(725)).toBe(5);
  });

  it("returns the shortest signed arc (the glide never takes the long way round)", () => {
    expect(headingDeltaDeg(10, 350)).toBe(-20);
    expect(headingDeltaDeg(350, 10)).toBe(20);
    expect(headingDeltaDeg(0, 180)).toBe(180); // tie breaks to +180
    expect(headingDeltaDeg(90, 90)).toBe(0);
    expect(headingDeltaDeg(359, 1)).toBe(2);
  });
});

describe("zoom slider mapping", () => {
  const MIN = 120;
  const MAX = 12_000_000;

  it("is a log mapping hitting both endpoints", () => {
    expect(sliderToAltM(0, MIN, MAX)).toBeCloseTo(MIN, 6);
    expect(sliderToAltM(1, MIN, MAX)).toBeCloseTo(MAX, 3);
    // halfway in log space = the geometric mean, NOT the arithmetic one
    expect(sliderToAltM(0.5, MIN, MAX)).toBeCloseTo(Math.sqrt(MIN * MAX), 3);
  });

  it("round-trips with altMToSlider and clamps out-of-range altitudes", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(altMToSlider(sliderToAltM(t, MIN, MAX), MIN, MAX)).toBeCloseTo(t, 9);
    }
    expect(altMToSlider(1, MIN, MAX)).toBe(0); // below min clamps to the start
    expect(altMToSlider(1e9, MIN, MAX)).toBe(1); // above max clamps to the end
  });
});

describe("camera store glide targets", () => {
  beforeEach(() => {
    useCameraStore.getState().clearAllTargets();
  });

  it("keeps live mirrors and targets independent", () => {
    const s = useCameraStore.getState();
    s._syncHeading(123.4);
    s._syncZoom(42_000);
    expect(useCameraStore.getState().headingDeg).toBeCloseTo(123.4);
    expect(useCameraStore.getState().zoomAltM).toBe(42_000);
    expect(useCameraStore.getState().targetHeadingDeg).toBeNull();
    expect(useCameraStore.getState().targetZoomAltM).toBeNull();
  });

  it("clearAllTargets releases every pending glide (direct manipulation wins)", () => {
    const s = useCameraStore.getState();
    s.setTargetTilt(30);
    s.setTargetHeading(270);
    s.setTargetZoom(5_000);
    expect(useCameraStore.getState().targetTiltDeg).toBe(30);
    expect(useCameraStore.getState().targetHeadingDeg).toBe(270);
    expect(useCameraStore.getState().targetZoomAltM).toBe(5_000);
    useCameraStore.getState().clearAllTargets();
    expect(useCameraStore.getState().targetTiltDeg).toBeNull();
    expect(useCameraStore.getState().targetHeadingDeg).toBeNull();
    expect(useCameraStore.getState().targetZoomAltM).toBeNull();
  });
});
