/**
 * The AR overlay's CAMERA seam (owner order 2026-09-19), the pure half: which constraints to ask
 * `getUserMedia` for, which of a phone's several rear cameras is the MAIN (1×) one, and what to
 * tell the user when the camera does not come. DOM-free — `components/mobile/ArCameraOverlay.tsx`
 * owns the stream; this is unit-pinned (`test/lib/sensors/arCamera.test.ts`).
 *
 * WHY THE MAIN CAMERA MATTERS: the overlay scales the feed to the 3D view's focal length from ONE
 * number — the streamed frame's FOV. An ultra-wide or a tele lens answering `facingMode:
 * "environment"` makes that number wrong by 2×.
 *  · iOS Safari: plain `facingMode: "environment"` IS the 1× "Back Camera" (the iOS 16.4 ultra-wide
 *    regression was fixed — WebKit bug 253186). The virtual "Dual Wide" / "Triple" devices switch
 *    lenses mid-stream and must not be picked; labels are LOCALIZED, so none is matched by name.
 *  · Android Chrome: `facingMode` is only a hint and a multi-camera phone may hand back any rear
 *    lens. Camera2's id 0 is the main rear camera by convention, and Chrome labels devices
 *    `camera2 <id>, facing back` — so after the first grant (labels are blank before it) the
 *    overlay re-acquires by `deviceId` when the track it got is not that one.
 */

export interface CameraDeviceLike {
  kind: string;
  deviceId: string;
  label: string;
}

/** `getUserMedia` constraints: the rear camera (or an exact device), capped — see `FPV.arCam*`. */
export function cameraConstraints(
  ideal: { widthPx: number; heightPx: number; fps: number },
  deviceId?: string,
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
      width: { ideal: ideal.widthPx },
      height: { ideal: ideal.heightPx },
      frameRate: { ideal: ideal.fps },
    },
  };
}

const CAMERA2_BACK = /camera2?\s*(\d+)\s*,\s*facing back/i;

/**
 * The `deviceId` to RE-ACQUIRE with, or null when the current track is already right (or nothing
 * better can be told). Only Chrome-on-Android's `camera2 N, facing back` labels are trusted:
 * the lowest N is the main rear camera. Anything else (iOS's localized labels, a desktop webcam,
 * blank labels) → null: `facingMode` already did the best that can be done.
 */
export function pickMainBackCamera(devices: readonly CameraDeviceLike[], currentDeviceId: string | undefined): string | null {
  let best: { id: string; n: number } | null = null;
  for (const d of devices) {
    if (d.kind !== "videoinput" || !d.deviceId) continue;
    const m = CAMERA2_BACK.exec(d.label);
    if (!m) continue;
    const n = Number(m[1]);
    if (best === null || n < best.n) best = { id: d.deviceId, n };
  }
  if (!best || best.id === currentDeviceId) return null;
  return best.id;
}

export type CameraFailure = "insecure" | "unsupported" | "denied" | "none" | "busy" | "other";

/** Classify a `getUserMedia` failure (`DOMException.name`) — or the lack of the API at all. */
export function classifyCameraError(e: unknown, env: { secure: boolean; hasApi: boolean }): CameraFailure {
  if (!env.secure) return "insecure";
  if (!env.hasApi) return "unsupported";
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "none";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "other";
}

/** The copy, in one place (the AR_COPY posture: every line says what the user can DO). */
export const AR_CAM_COPY: Readonly<Record<CameraFailure, string>> = Object.freeze({
  insecure: "THE CAMERA NEEDS HTTPS — THIS PAGE IS NOT SECURE",
  unsupported: "NO CAMERA ACCESS IN THIS BROWSER",
  denied: "CAMERA ACCESS WAS DENIED — ALLOW IT IN THE BROWSER'S SITE SETTINGS, THEN TAP CAM AGAIN",
  none: "NO REAR CAMERA FOUND",
  busy: "THE CAMERA IS IN USE BY ANOTHER APP — CLOSE IT AND TAP CAM AGAIN",
  other: "THE CAMERA DID NOT START — TAP CAM AGAIN",
});
