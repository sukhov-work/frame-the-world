import { useEffect, useState } from "react";
import { sortByProximity } from "../../lib/geo/proximity";
import type { PlaceListItem } from "../../lib/wix/placeRecords";
import { useCameraStore } from "../../store/camera";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { useTimeStore } from "../../store/time";
import "../../styles/mobile/chrome.css";

/**
 * MY PLACES on /m (owner 2026-08-15) — the desktop MyPins · PLACES twin: the member's saved
 * first-person viewpoints (the exact `#f=` pose + the pinned scene time, lib/wix/placeRecords).
 * Rendered by MobileSearch while the search box is IDLE — the empty SEARCH sheet doubles as
 * the places list, one tap from the status-strip account chip. Tap a row = restore the clock
 * FIRST, then requestFpvJump (the MyPins jump order — FPV entry reads the restored time).
 * Save half lives in SceneActions (◎ SAVE VIEW). Delete stays desktop-only (MY PINS · PLACES).
 */
export default function MobilePlaces({ onJump }: { onJump: () => void }) {
  const phase = useMemberStore((s) => s.phase);
  const refresh = useMemberStore((s) => s.refresh);
  const [places, setPlaces] = useState<PlaceListItem[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (phase !== "member") return;
    let stale = false;
    fetch("/api/places")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { places?: PlaceListItem[] }) => {
        // Nearest-first from the CURRENT map position (owner 2026-08-19b): FPV eye when
        // live, else the orbit/2D view focus. Sorted once per fetch — a list must not
        // reshuffle under the reader's finger while the map pans.
        const cam = useCameraStore.getState();
        const at = cam.camGeo ?? { latDeg: cam.focusLatDeg, lonDeg: cam.focusLonDeg };
        if (!stale) setPlaces(sortByProximity(j.places ?? [], at.latDeg, at.lonDeg));
      })
      .catch(() => {
        if (!stale) setErr(true);
      });
    return () => {
      stale = true;
    };
  }, [phase]);

  const jump = (p: PlaceListItem) => {
    // Time FIRST (the MyPins order): the FPV entry must light the scene at the saved instant.
    const t = useTimeStore.getState();
    if (p.timeMs !== null) t.setTime(p.timeMs);
    else t.goLive();
    useCameraStore.getState().requestFpvJump({
      latDeg: p.latDeg,
      lonDeg: p.lonDeg,
      eyeM: p.eyeM,
      headingDeg: p.headingDeg,
      pitchDeg: p.pitchDeg,
      fovDeg: p.fovDeg,
    });
    onJump();
  };

  if (phase === "anonymous") {
    return (
      <div className="m-places">
        <div className="m-places__head">MY PLACES</div>
        <a
          className="m-hit"
          href={loginUrl("/m")}
          onClick={(e) => {
            e.preventDefault();
            window.location.href = loginUrl(returnHereUrl());
          }}
        >
          <span className="m-hit__name">SIGN IN TO SAVE VIEWS</span>
          <span className="m-hit__detail">
            bookmark any viewpoint with its time · reopen it here
          </span>
        </a>
      </div>
    );
  }
  if (phase !== "member") return null; // unknown/loading — stay quiet, no flash

  return (
    <div className="m-places">
      <div className="m-places__head">MY PLACES</div>
      {err && <div className="m-status-line">PLACES UNAVAILABLE — TRY AGAIN LATER</div>}
      {places === null && !err && <div className="m-status-line">LOADING…</div>}
      {places !== null && places.length === 0 && (
        <div className="m-status-line">NONE YET — ENTER A VIEW AND TAP ◎ SAVE VIEW</div>
      )}
      {places?.map((p) => (
        <button key={p.id} type="button" className="m-hit" onClick={() => jump(p)}>
          <span className="m-hit__name">◎ {p.title}</span>
          <span className="m-hit__detail">
            {p.latDeg.toFixed(3)}, {p.lonDeg.toFixed(3)}
            {p.timeMs !== null
              ? ` · ⏱ ${new Date(p.timeMs).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
