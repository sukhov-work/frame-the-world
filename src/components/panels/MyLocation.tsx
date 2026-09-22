/**
 * MyLocation (QoL-1, owner 2026-08-14) — the desktop "jump into FPV where I stand" nav
 * affordance (PLANNING_QOL_PLAN §3.3). One click: geolocation fix → `requestFpvJump` — the
 * proven share-link path (drops the temp pin, flies there, stands in temp-pin FPV at eye
 * height, facing north). CLIENT-SIDE ONLY (constraint C6): the fix never leaves the browser
 * and is never published. The /m twin is SceneActions' 🧭 chip (same pose, same discipline).
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import "../../styles/my-location.css";
import "../../styles/tips.css";

export default function MyLocation() {
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
        // Straight into temp-pin FPV (owner 2026-08-14). Owner 2026-09-22 (FPV item 2): a POINT
        // jump — the eye height, look elevation and lens the viewer last stood at are carried by
        // the orchestrator, the heading is the planned view's; nothing resets to north / 1.7 m.
        useCameraStore.getState().requestFpvJump({
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
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
    <span className="ml">
      <button
        type="button"
        className="ml-toggle tip"
        disabled={busy}
        data-tip="STAND WHERE YOU ARE — FPV AT YOUR REAL LOCATION."
        data-tip-pos="down"
        onClick={locate}
      >
        {busy ? "Locating…" : "My spot"}
      </button>
      {note && (
        <span className="ml-note" role="status">
          {note}
        </span>
      )}
    </span>
  );
}
