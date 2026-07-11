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

describe("fly request seam (location finder, Phase 5.5 S1)", () => {
  it("posts a one-shot request and the orchestrator consume clears it", () => {
    const s = useCameraStore.getState();
    s.requestFly({ latDeg: 48.4647, lonDeg: 35.0462, altM: 41_000 });
    expect(useCameraStore.getState().flyRequest).toEqual({
      latDeg: 48.4647,
      lonDeg: 35.0462,
      altM: 41_000,
    });
    useCameraStore.getState()._consumeFlyRequest();
    expect(useCameraStore.getState().flyRequest).toBeNull();
  });

  it("keeps the geocoding-bias focus mirror independent of the fly request", () => {
    const s = useCameraStore.getState();
    s._syncFocus(50.45, 30.52);
    expect(useCameraStore.getState().focusLatDeg).toBeCloseTo(50.45);
    expect(useCameraStore.getState().focusLonDeg).toBeCloseTo(30.52);
    expect(useCameraStore.getState().flyRequest).toBeNull();
  });
});

describe("encoder rate seams (Phase 5.5 S2)", () => {
  it("stores a rate while deflected and null on release", () => {
    const s = useCameraStore.getState();
    s.setHeadingRate(22.5);
    s.setZoomRate(-0.8);
    expect(useCameraStore.getState().headingRateDegPerS).toBe(22.5);
    expect(useCameraStore.getState().zoomRatePerS).toBe(-0.8);
    useCameraStore.getState().setHeadingRate(null);
    useCameraStore.getState().setZoomRate(null);
    expect(useCameraStore.getState().headingRateDegPerS).toBeNull();
    expect(useCameraStore.getState().zoomRatePerS).toBeNull();
  });

  it("clearAllTargets releases the rates too (grabbing the globe wins)", () => {
    const s = useCameraStore.getState();
    s.setHeadingRate(10);
    s.setZoomRate(0.5);
    s.setTargetTilt(30);
    useCameraStore.getState().clearAllTargets();
    expect(useCameraStore.getState().headingRateDegPerS).toBeNull();
    expect(useCameraStore.getState().zoomRatePerS).toBeNull();
    expect(useCameraStore.getState().targetTiltDeg).toBeNull();
  });
});

describe("temporary pin seam (Phase 5.5 S2 follow-up)", () => {
  it("sets and clears the pin; clearing also exits its FPV", () => {
    const s = useCameraStore.getState();
    s.setTempPin({ latDeg: 48.46, lonDeg: 35.05 });
    expect(useCameraStore.getState().tempPin).toEqual({ latDeg: 48.46, lonDeg: 35.05 });
    useCameraStore.getState().setTempFpv(true);
    expect(useCameraStore.getState().tempFpv).toBe(true);
    useCameraStore.getState().setTempPin(null);
    expect(useCameraStore.getState().tempPin).toBeNull();
    expect(useCameraStore.getState().tempFpv).toBe(false);
  });

  it("refuses look-around FPV without a pin to stand on", () => {
    useCameraStore.getState().setTempPin(null);
    useCameraStore.getState().setTempFpv(true);
    expect(useCameraStore.getState().tempFpv).toBe(false);
  });
});
