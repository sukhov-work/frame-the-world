import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AR_CALIB_IDENTITY,
  AR_CALIB_KEY,
  AR_CALIB_RAILS,
  AR_CAM_LONG_FOV_DEFAULT_DEG,
  applyArCalibration,
  camFocalEqMm,
  clearArCalibration,
  dragToAimDelta,
  focalPx,
  isCalibrated,
  isIdentityAim,
  loadArCalibration,
  pinchTwist,
  sanitizeArCalibration,
  saveArCalibration,
  smoothRollDeg,
  stepCalibration,
  videoLayout,
} from "../../../src/lib/sensors/arCalibration";

const D2R = Math.PI / 180;

/** A Map-backed `localStorage` — vitest runs in node (no DOM). */
function fakeStorage() {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  vi.stubGlobal("localStorage", ls);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

describe("arCalibration — the record and its rails", () => {
  it("junk reads as the identity; never throws", () => {
    for (const raw of [null, undefined, 7, "x", [], { yawDeg: "4" }, { yawDeg: NaN, pitchDeg: Infinity }]) {
      expect(sanitizeArCalibration(raw)).toEqual(AR_CALIB_IDENTITY);
    }
    expect(AR_CALIB_IDENTITY.camLongFovDeg).toBe(AR_CAM_LONG_FOV_DEFAULT_DEG);
    expect(isCalibrated(AR_CALIB_IDENTITY)).toBe(false);
    expect(isIdentityAim(AR_CALIB_IDENTITY)).toBe(true);
  });

  it("yaw wraps onto (−180, 180]; pitch, roll and the camera FOV clamp onto their rails", () => {
    expect(sanitizeArCalibration({ yawDeg: 190 }).yawDeg).toBe(-170);
    expect(sanitizeArCalibration({ yawDeg: -540 }).yawDeg).toBe(180);
    expect(sanitizeArCalibration({ pitchDeg: 99 }).pitchDeg).toBe(AR_CALIB_RAILS.pitchMaxDeg);
    expect(sanitizeArCalibration({ rollDeg: -99 }).rollDeg).toBe(-AR_CALIB_RAILS.rollMaxDeg);
    expect(sanitizeArCalibration({ camLongFovDeg: 5 }).camLongFovDeg).toBe(AR_CALIB_RAILS.camLongFovMinDeg);
    expect(sanitizeArCalibration({ camLongFovDeg: 170 }).camLongFovDeg).toBe(AR_CALIB_RAILS.camLongFovMaxDeg);
    expect(Object.is(sanitizeArCalibration({ yawDeg: -0 }).yawDeg, 0)).toBe(true);
  });

  it("the aim: heading wraps through north, pitch stays inside the sphere", () => {
    expect(applyArCalibration({ azDeg: 358, altDeg: 10 }, { yawDeg: 4, pitchDeg: -2 })).toEqual({ azDeg: 2, altDeg: 8 });
    expect(applyArCalibration({ azDeg: 1, altDeg: 0 }, { yawDeg: -3, pitchDeg: 0 })).toEqual({ azDeg: 358, altDeg: 0 });
    expect(applyArCalibration({ azDeg: 0, altDeg: 80 }, { yawDeg: 0, pitchDeg: 30 }).altDeg).toBe(90);
  });
});

describe("arCalibration — persistence (`ftw:ar-calib:v1`)", () => {
  it("no localStorage (SSR, vitest) → the identity, and a save still returns the stamped record", () => {
    expect(loadArCalibration()).toEqual(AR_CALIB_IDENTITY);
    const saved = saveArCalibration({ ...AR_CALIB_IDENTITY, yawDeg: 3 }, 1234);
    expect(saved).toMatchObject({ yawDeg: 3, savedAtMs: 1234 });
  });

  it("CONFIRM overrides the previous calibration; RESET removes the key", () => {
    const m = fakeStorage();
    saveArCalibration({ ...AR_CALIB_IDENTITY, yawDeg: 3, pitchDeg: 1 }, 1000);
    expect(loadArCalibration()).toMatchObject({ yawDeg: 3, pitchDeg: 1, savedAtMs: 1000 });
    saveArCalibration({ ...AR_CALIB_IDENTITY, yawDeg: -7.5, camLongFovDeg: 66 }, 2000);
    const c = loadArCalibration();
    expect(c).toMatchObject({ yawDeg: -7.5, pitchDeg: 0, camLongFovDeg: 66, savedAtMs: 2000 });
    expect(isCalibrated(c)).toBe(true);
    expect(clearArCalibration()).toEqual(AR_CALIB_IDENTITY);
    expect(m.has(AR_CALIB_KEY)).toBe(false);
    expect(loadArCalibration()).toEqual(AR_CALIB_IDENTITY);
  });

  it("a corrupt blob and a throwing storage both degrade to the identity", () => {
    const m = fakeStorage();
    m.set(AR_CALIB_KEY, "{not json");
    expect(loadArCalibration()).toEqual(AR_CALIB_IDENTITY);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
    });
    expect(loadArCalibration()).toEqual(AR_CALIB_IDENTITY);
    expect(() => saveArCalibration(AR_CALIB_IDENTITY)).not.toThrow();
    expect(() => clearArCalibration()).not.toThrow();
  });
});

describe("arCalibration — the shared angular scale (\"the same focal number\")", () => {
  it("focalPx is the pinhole focal: H/2 over tan(vFov/2)", () => {
    expect(focalPx(800, 90)).toBeCloseTo(400, 9);
    expect(focalPx(800, 53.13010235415598)).toBeCloseTo(800, 6);
  });

  it("a camera whose long FOV equals the view's vertical FOV fills a portrait viewport exactly", () => {
    const l = videoLayout({ videoW: 1080, videoH: 1920, viewH: 800, vFovDeg: 60, camLongFovDeg: 60 })!;
    expect(l.heightPx).toBeCloseTo(800, 9);
    expect(l.widthPx).toBeCloseTo(450, 9);
  });

  it("EVERY ray lands on the same pixel in both pictures, not just the centre", () => {
    // A ray 17° above the axis: the 3D view draws it f·tan(17°) px up; the scaled video must too.
    const viewH = 844;
    const vFov = 47;
    const camLong = 64;
    const l = videoLayout({ videoW: 720, videoH: 1280, viewH, vFovDeg: vFov, camLongFovDeg: camLong })!;
    const fView = focalPx(viewH, vFov);
    const fVideoNative = 1280 / 2 / Math.tan((camLong * D2R) / 2);
    const yView = fView * Math.tan(17 * D2R);
    const yVideo = fVideoNative * Math.tan(17 * D2R) * l.scale;
    expect(yVideo).toBeCloseTo(yView, 9);
  });

  it("a longer virtual focal magnifies the video; a wider one insets it; landscape uses the long side", () => {
    const base = { videoW: 1080, videoH: 1920, viewH: 800, camLongFovDeg: 62 };
    const tele = videoLayout({ ...base, vFovDeg: 20 })!;
    const wide = videoLayout({ ...base, vFovDeg: 100 })!;
    expect(tele.heightPx).toBeGreaterThan(800);
    expect(wide.heightPx).toBeLessThan(800);
    const land = videoLayout({ videoW: 1920, videoH: 1080, viewH: 400, vFovDeg: 40, camLongFovDeg: 62 })!;
    expect(land.widthPx / land.heightPx).toBeCloseTo(16 / 9, 9);
    expect(land.widthPx).toBeCloseTo(2 * focalPx(400, 40) * Math.tan(31 * D2R), 9);
  });

  it("null until the stream reports a frame", () => {
    expect(videoLayout({ videoW: 0, videoH: 0, viewH: 800, vFovDeg: 60, camLongFovDeg: 62 })).toBeNull();
    expect(videoLayout({ videoW: 100, videoH: 100, viewH: 0, vFovDeg: 60, camLongFovDeg: 62 })).toBeNull();
  });

  it("the readout: a 26 mm-equivalent main camera is a ~69° long side", () => {
    expect(camFocalEqMm(2 * Math.atan(18 / 26) * (180 / Math.PI))).toBeCloseTo(26, 9);
    expect(camFocalEqMm(AR_CAM_LONG_FOV_DEFAULT_DEG)).toBeGreaterThan(24);
    expect(camFocalEqMm(AR_CAM_LONG_FOV_DEFAULT_DEG)).toBeLessThan(35);
  });
});

describe("arCalibration — the gestures", () => {
  it("drag = grab-the-world, the FPV look-drag's own sense: right → yaw −, down → pitch +", () => {
    const f = focalPx(800, 60);
    const d = dragToAimDelta(40, 25, f, 0);
    expect(d.dYawDeg).toBeLessThan(0);
    expect(d.dPitchDeg).toBeGreaterThan(0);
    expect(d.dYawDeg).toBeCloseTo((-Math.atan(40 / f) * 180) / Math.PI, 12);
    expect(dragToAimDelta(-40, -25, f, 0)).toEqual({ dYawDeg: -d.dYawDeg, dPitchDeg: -d.dPitchDeg });
  });

  it("a pixel of drag moves the scene a pixel at any pitch (heading ÷ cos pitch), floored near the zenith", () => {
    const f = focalPx(800, 60);
    const level = dragToAimDelta(10, 0, f, 0).dYawDeg;
    expect(dragToAimDelta(10, 0, f, 60).dYawDeg).toBeCloseTo(level / 0.5, 9);
    expect(dragToAimDelta(10, 0, f, 89.9).dYawDeg).toBeCloseTo(level / 0.2, 9);
    expect(dragToAimDelta(10, 10, 0, 0)).toEqual({ dYawDeg: 0, dPitchDeg: 0 });
  });

  it("pinchTwist: screen-clockwise is +, spread is the distance ratio", () => {
    // Fingers on a horizontal line, the right one moves DOWN the screen → clockwise.
    const g = pinchTwist({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 })!;
    expect(g.twistDeg).toBeCloseTo(45, 9);
    expect(g.spread).toBeCloseTo(Math.SQRT2, 9);
    expect(pinchTwist({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it("a twist turns the VIDEO the other way; a spread narrows the camera FOV estimate", () => {
    const c0 = { ...AR_CALIB_IDENTITY, camLongFovDeg: 60 };
    const c1 = stepCalibration(c0, { twistDeg: 3, spread: 1.25 });
    expect(c1.rollDeg).toBe(-3);
    expect(Math.tan((c1.camLongFovDeg * D2R) / 2)).toBeCloseTo(Math.tan(30 * D2R) / 1.25, 12);
    // …and the video shrinks by exactly the spread against an unchanged view.
    const a = videoLayout({ videoW: 1080, videoH: 1920, viewH: 800, vFovDeg: 50, camLongFovDeg: c0.camLongFovDeg })!;
    const b = videoLayout({ videoW: 1080, videoH: 1920, viewH: 800, vFovDeg: 50, camLongFovDeg: c1.camLongFovDeg })!;
    expect(a.heightPx / b.heightPx).toBeCloseTo(1.25, 9);
  });

  it("steps accumulate onto the rails; garbage steps change nothing", () => {
    let c = { ...AR_CALIB_IDENTITY };
    for (let i = 0; i < 100; i++) c = stepCalibration(c, { dYawDeg: 5, dPitchDeg: 1 });
    expect(c.pitchDeg).toBe(AR_CALIB_RAILS.pitchMaxDeg);
    expect(c.yawDeg).toBeCloseTo(140, 9); // 500° wrapped onto (−180, 180]
    expect(stepCalibration(c, { dYawDeg: NaN, spread: -1, twistDeg: Infinity })).toEqual(c);
  });

  it("smoothRollDeg: seeds exactly, eases by 1 − e^(−dt/τ), takes the short way round", () => {
    expect(smoothRollDeg(null, 12, 16, 200)).toBe(12);
    expect(smoothRollDeg(0, 10, 200, 200)).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    expect(smoothRollDeg(179, -179, 1e9, 200)).toBeCloseTo(181, 6);
    expect(smoothRollDeg(5, 9, 16, 0)).toBe(9);
  });
});
