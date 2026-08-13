/**
 * SceneActions (M1) — the /m FPV-entry affordances (MOBILE_PLAN §3 SCENE): 🧭 MY LOCATION
 * (geolocation → STRAIGHT INTO temp-pin FPV via requestFpvJump — QoL-1 upgrade, owner
 * 2026-08-14, PLANNING_QOL_PLAN §3.3; was pin+fly. CLIENT-SIDE ONLY, never published —
 * constraint C6), and the temp-pin flow — ◎ LOOK FROM HERE (setTempFpv, the CameraTiltPanel
 * popup's store calls with thumb-sized chips) / ✕ CLEAR PIN / ✕ EXIT VIEW (phones have no
 * Escape key). The desktop twin is the MyLocation nav island (same pose, same discipline).
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { FPV, FRUSTUM } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

export default function SceneActions() {
  const tempPin = useCameraStore((s) => s.tempPin);
  const tempFpv = useCameraStore((s) => s.tempFpv);
  const setTempPin = useCameraStore((s) => s.setTempPin);
  const setTempFpv = useCameraStore((s) => s.setTempFpv);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    },
    [],
  );
  const flashNote = (text: string) => {
    setNote(text);
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 4000);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      flashNote("NO LOCATION ON THIS DEVICE");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        // Client-side only (C6): the fix never leaves the browser and is never published.
        // Straight into temp-pin FPV at a standing eye, facing north (the share-link path
        // drops the pin and flies there) — owner 2026-08-14.
        useCameraStore.getState().requestFpvJump({
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          eyeM: FRUSTUM.eyeHeightM,
          headingDeg: 0,
          pitchDeg: 0,
          fovDeg: FPV.tempFovDeg,
        });
      },
      () => {
        setBusy(false);
        flashNote("LOCATION UNAVAILABLE");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="m-actions">
      {note && (
        <span className="m-act m-act--quiet" role="status">
          {note}
        </span>
      )}
      {tempFpv ? (
        <button type="button" className="m-act" onClick={() => setTempFpv(false)}>
          ✕ EXIT VIEW
        </button>
      ) : tempPin ? (
        <>
          <button type="button" className="m-act m-act--accent" onClick={() => setTempFpv(true)}>
            ◎ LOOK FROM HERE
          </button>
          <button type="button" className="m-act m-act--quiet" onClick={() => setTempPin(null)}>
            ✕ CLEAR PIN
          </button>
        </>
      ) : null}
      {!tempFpv && (
        <button type="button" className="m-act" disabled={busy} onClick={locate}>
          🧭 {busy ? "LOCATING…" : "MY LOCATION"}
        </button>
      )}
    </div>
  );
}
