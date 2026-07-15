import { beforeEach, describe, expect, it } from "vitest";
import { altMToSlider, sliderToAltM, useCameraStore } from "../../src/store/camera";

// heading math (wrapHeadingDeg / headingDeltaDeg) moved to lib/geo/heading — see heading.test.ts.

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
    s.setFovRate(0.4);
    useCameraStore.getState().clearAllTargets();
    expect(useCameraStore.getState().headingRateDegPerS).toBeNull();
    expect(useCameraStore.getState().zoomRatePerS).toBeNull();
    expect(useCameraStore.getState().targetTiltDeg).toBeNull();
    expect(useCameraStore.getState().fovRatePerS).toBeNull();
  });
});

describe("sky guides seam (Phase 5.5 S6 follow-up)", () => {
  it("defaults ON and toggles; the marker mirror is orchestrator-fed and nullable", () => {
    expect(useCameraStore.getState().skyGuides).toBe(true);
    useCameraStore.getState().setSkyGuides(false);
    expect(useCameraStore.getState().skyGuides).toBe(false);
    useCameraStore.getState().setSkyGuides(true);
    const marker = {
      inFrame: false,
      dirX: 0,
      dirY: 1,
      azDeg: 214,
      altDeg: 60,
      up: true,
    };
    useCameraStore.getState()._syncSkyMarkers({ sun: marker, moon: marker });
    expect(useCameraStore.getState().skyMarkers?.sun.azDeg).toBe(214);
    useCameraStore.getState()._syncSkyMarkers(null);
    expect(useCameraStore.getState().skyMarkers).toBeNull();
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

describe("pin visibility seam (owner 2026-07-15, PIN chip)", () => {
  it("defaults ON and toggles; the FPV default-off dance restores correctly", () => {
    expect(useCameraStore.getState().pinsVisible).toBe(true);
    // FPV entry: remember + hide (the orchestrator's exact sequence).
    const before = useCameraStore.getState().pinsVisible;
    useCameraStore.getState().setPinsVisible(false);
    expect(useCameraStore.getState().pinsVisible).toBe(false);
    // FPV exit: restore only when the chip was NOT re-lit inside FPV.
    if (before && !useCameraStore.getState().pinsVisible) {
      useCameraStore.getState().setPinsVisible(true);
    }
    expect(useCameraStore.getState().pinsVisible).toBe(true);
  });

  it("a chip re-enable inside FPV survives the exit restore (no-op restore)", () => {
    useCameraStore.getState().setPinsVisible(false); // FPV entry hid them
    useCameraStore.getState().setPinsVisible(true); // user re-lit the chip inside FPV
    const before = true; // pre-FPV state the orchestrator remembered
    if (before && !useCameraStore.getState().pinsVisible) {
      useCameraStore.getState().setPinsVisible(true);
    }
    expect(useCameraStore.getState().pinsVisible).toBe(true);
  });
});

describe("FPV jump seam (saved places, owner 2026-07-15)", () => {
  it("posts a one-shot full FPV pose and the orchestrator consume clears it", () => {
    const pose = {
      latDeg: 48.4647,
      lonDeg: 35.0462,
      eyeM: 1.7,
      headingDeg: 352.1,
      pitchDeg: 2.4,
      fovDeg: 26.8,
    };
    useCameraStore.getState().requestFpvJump(pose);
    expect(useCameraStore.getState().fpvJumpRequest).toEqual(pose);
    useCameraStore.getState()._consumeFpvJump();
    expect(useCameraStore.getState().fpvJumpRequest).toBeNull();
  });
});

describe("explore seam (Phase 5.5 S4)", () => {
  it("arms and disarms the ambient journey", () => {
    expect(useCameraStore.getState().exploreActive).toBe(false);
    useCameraStore.getState().setExplore(true);
    expect(useCameraStore.getState().exploreActive).toBe(true);
    useCameraStore.getState().setExplore(false);
    expect(useCameraStore.getState().exploreActive).toBe(false);
  });
});
