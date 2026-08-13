/**
 * SceneActions (M1) — the /m FPV-entry affordances (MOBILE_PLAN §3 SCENE): 🧭 MY LOCATION
 * (geolocation → temp pin + fly; CLIENT-SIDE ONLY, never published — constraint C6), and the
 * temp-pin flow — ◎ LOOK FROM HERE (setTempFpv, the CameraTiltPanel popup's store calls with
 * thumb-sized chips) / ✕ CLEAR PIN / ✕ EXIT VIEW (phones have no Escape key). The desktop
 * pin-side popup needs a hover-scale pointer; a fixed chip column is the touch idiom.
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { SEARCH } from "../globe/tuning";
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
        const latDeg = pos.coords.latitude;
        const lonDeg = pos.coords.longitude;
        // Client-side only (C6): the temp pin never leaves the browser and is never published.
        const cam = useCameraStore.getState();
        cam.setTempPin({ latDeg, lonDeg });
        cam.requestFly({ latDeg, lonDeg, altM: SEARCH.altDefaultM });
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
