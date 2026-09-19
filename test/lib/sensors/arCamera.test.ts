import { describe, expect, it } from "vitest";
import { AR_CAM_COPY, cameraConstraints, classifyCameraError, pickMainBackCamera } from "../../../src/lib/sensors/arCamera";

/** The AR overlay's camera seam (owner order 2026-09-19): the MAIN rear camera, capped, and a
 *  failure copy that says what the user can do. */

const dev = (deviceId: string, label: string, kind = "videoinput") => ({ kind, deviceId, label });

describe("cameraConstraints", () => {
  it("asks for the rear camera at the capped ideals, never audio", () => {
    const c = cameraConstraints({ widthPx: 1280, heightPx: 720, fps: 30 });
    expect(c.audio).toBe(false);
    expect(c.video).toEqual({ facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
  });

  it("an exact device replaces the facing hint (the Android re-acquire)", () => {
    const v = cameraConstraints({ widthPx: 1280, heightPx: 720, fps: 30 }, "abc").video as MediaTrackConstraints;
    expect(v.deviceId).toEqual({ exact: "abc" });
    expect("facingMode" in v).toBe(false);
  });
});

describe("pickMainBackCamera — Camera2 id 0 is the main rear lens", () => {
  const pixel = [dev("f", "camera2 1, facing front"), dev("uw", "camera2 2, facing back"), dev("main", "camera2 0, facing back"), dev("tele", "camera2 3, facing back")];

  it("re-acquires when Chrome handed back the ultra-wide / tele", () => {
    expect(pickMainBackCamera(pixel, "uw")).toBe("main");
    expect(pickMainBackCamera(pixel, "tele")).toBe("main");
    expect(pickMainBackCamera(pixel, undefined)).toBe("main");
  });

  it("keeps the stream when it already IS the main camera", () => {
    expect(pickMainBackCamera(pixel, "main")).toBeNull();
  });

  it("trusts nothing else: iOS's localized labels, blank labels (no grant yet), a webcam, audio devices", () => {
    expect(pickMainBackCamera([dev("a", "Back Camera"), dev("b", "Back Triple Camera"), dev("c", "Задня камера")], "a")).toBeNull();
    expect(pickMainBackCamera([dev("a", ""), dev("b", "")], "a")).toBeNull();
    expect(pickMainBackCamera([dev("a", "FaceTime HD Camera")], "a")).toBeNull();
    expect(pickMainBackCamera([dev("m", "camera2 0, facing back", "audioinput")], "x")).toBeNull();
    expect(pickMainBackCamera([], "x")).toBeNull();
  });
});

describe("classifyCameraError — every failure has copy that names an action", () => {
  const ok = { secure: true, hasApi: true };
  it("the environment outranks the exception", () => {
    expect(classifyCameraError(null, { secure: false, hasApi: true })).toBe("insecure");
    expect(classifyCameraError(null, { secure: true, hasApi: false })).toBe("unsupported");
  });
  it("maps the DOMException names", () => {
    expect(classifyCameraError({ name: "NotAllowedError" }, ok)).toBe("denied");
    expect(classifyCameraError({ name: "NotFoundError" }, ok)).toBe("none");
    expect(classifyCameraError({ name: "OverconstrainedError" }, ok)).toBe("none");
    expect(classifyCameraError({ name: "NotReadableError" }, ok)).toBe("busy");
    expect(classifyCameraError(new Error("?"), ok)).toBe("other");
  });
  it("no failure is left without copy", () => {
    for (const k of ["insecure", "unsupported", "denied", "none", "busy", "other"] as const) expect(AR_CAM_COPY[k].length).toBeGreaterThan(10);
    expect(AR_CAM_COPY.insecure).toMatch(/HTTPS/);
  });
});
