/**
 * SceneActions (M1) — the /m FPV-entry affordances (MOBILE_PLAN §3 SCENE): 🧭 MY LOCATION
 * (geolocation → fly the 2D MAP there with the temp pin armed for LOOK FROM HERE — owner
 * 2026-08-18, supersedes the 2026-08-14 straight-into-FPV ruling. CLIENT-SIDE ONLY, never
 * published — constraint C6), and the temp-pin flow — ◎ LOOK FROM HERE (setTempFpv, the
 * CameraTiltPanel popup's store calls with thumb-sized chips) / ✕ CLEAR PIN / ✕ EXIT VIEW
 * (phones have no Escape key). The desktop twin is the MyLocation nav island (which keeps the
 * straight-into-FPV jump — desktop has no 2D map). Also home to the 2D/3D mode chip row with
 * its micro compass + altitude readout (owner 2026-08-18).
 */

import { useEffect, useRef, useState } from "react";
import { useCameraStore } from "../../store/camera";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { formatAltM } from "../../lib/format/readout";
import { CONTROLS, MOBILE2D } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

export default function SceneActions({ onOpenPlaces }: { onOpenPlaces?: () => void }) {
  const tempPin = useCameraStore((s) => s.tempPin);
  const tempFpv = useCameraStore((s) => s.tempFpv);
  const setTempPin = useCameraStore((s) => s.setTempPin);
  const setTempFpv = useCameraStore((s) => s.setTempFpv);
  // Member gate for the SAVED PLACES chip (owner 2026-08-15c) — the shared auth idiom.
  const memberPhase = useMemberStore((s) => s.phase);
  const refreshMember = useMemberStore((s) => s.refresh);
  useEffect(() => {
    void refreshMember();
  }, [refreshMember]);
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
        // Land ON the 2D map with the pin armed (owner 2026-08-18): the map flies there
        // north-up/nadir (the orchestrator's 2D-aware fly-to arrival), the temp pin raises
        // the LOOK FROM HERE chip — one more tap enters FPV, instead of being pushed there.
        const cam = useCameraStore.getState();
        cam.setMapMode("2d");
        cam.setTempPin({ latDeg: pos.coords.latitude, lonDeg: pos.coords.longitude });
        cam.requestFly({
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          altM: MOBILE2D.locateAltAboveGroundM,
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
      <SavePlaceChip />
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
      {/* SAVED PLACES (owner 2026-08-15c): logged-in members pick from the full MY PLACES
          list — the idle SEARCH sheet. Sits directly ABOVE the MY LOCATION chip. */}
      {memberPhase === "member" && onOpenPlaces && (
        <button type="button" className="m-act" onClick={onOpenPlaces}>
          ▤ SAVED PLACES
        </button>
      )}
      {!tempFpv && (
        <button type="button" className="m-act" disabled={busy} onClick={locate}>
          🧭 {busy ? "LOCATING…" : "MY LOC"}
        </button>
      )}
      {!tempFpv && (
        <div className="m-actrow">
          <MapModeChip />
          <NavChip />
        </div>
      )}
      {!tempFpv && <BuildingsChip />}
    </div>
  );
}

/** 2D ↔ 3D (UPLIFT U1, owner point 1) — the accessibility twin of the two-finger tilt gesture.
 *  2D → 3D tilts up to the desktop toggle's angle (buildings attach on the mode write); 3D →
 *  2D glides back to nadir + north (buildings detach). The orchestrator's locks/gate own the
 *  camera + tileset mechanics — this chip only writes the store seams. */
function MapModeChip() {
  const mapMode = useCameraStore((s) => s.mapMode);
  const setMapMode = useCameraStore((s) => s.setMapMode);
  const setTargetTilt = useCameraStore((s) => s.setTargetTilt);
  const setTargetHeading = useCameraStore((s) => s.setTargetHeading);
  const is2D = mapMode === "2d";
  return (
    <button
      type="button"
      className="m-act"
      aria-pressed={is2D}
      onClick={() => {
        if (is2D) {
          setMapMode("3d");
          setTargetTilt(CONTROLS.toggle3dTiltDeg);
        } else {
          setMapMode("2d");
          setTargetTilt(0);
          setTargetHeading(0);
        }
      }}
    >
      {is2D ? "▲ 3D" : "▼ 2D"}
    </button>
  );
}

/** Micro compass + altitude readout (owner 2026-08-18) — sits exactly RIGHT of the 2D/3D chip.
 *  The needle is the camera bearing mirror (screen-up based in 2D, where it pins to N; forward
 *  based in 3D — StylizedTiles' pose mirror handles the switch); the readout is the camera
 *  altitude mirror. Selectors return ROUNDED/FORMATTED values so the chip re-renders only when
 *  the display changes, not per frame. Tap in 3D = face north (the desktop compass-rose click). */
function NavChip() {
  const headingDeg = useCameraStore((s) => Math.round(((s.headingDeg % 360) + 360) % 360) % 360);
  const altText = useCameraStore((s) => formatAltM(s.zoomAltM).toUpperCase());
  const setTargetHeading = useCameraStore((s) => s.setTargetHeading);
  const is2D = useCameraStore((s) => s.mapMode === "2d");
  return (
    <button
      type="button"
      className="m-act m-nav"
      aria-label={`Bearing ${headingDeg}°, altitude ${altText}${is2D ? "" : " — tap to face north"}`}
      onClick={() => {
        if (!is2D) setTargetHeading(0);
      }}
    >
      <svg
        className="m-nav__dial"
        viewBox="0 0 20 20"
        aria-hidden="true"
        style={{ transform: `rotate(${-headingDeg}deg)` }}
      >
        <circle cx="10" cy="10" r="9" className="m-nav__ring" />
        <polygon points="10,2.6 12.4,10 7.6,10" className="m-nav__n" />
        <polygon points="10,17.4 12.4,10 7.6,10" className="m-nav__s" />
      </svg>
      <span className="m-nav__alt">{altText}</span>
    </button>
  );
}

/** ▦ 3D DETAIL (owner 2026-08-15e; on/off semantics 2026-08-18) — the desktop BLD twin: a plain
 *  LIVE 3D-buildings show/hide (store `buildings3d`, persisted, shared across shells). WHICH
 *  bake streams is the registry's call (lib/globe/regions.ts — best variant by default), so the
 *  chip never reloads. Hidden in the 2D map (U1: buildings are absent there — a dead control). */
function BuildingsChip() {
  const mapMode = useCameraStore((s) => s.mapMode);
  const buildings3d = useCameraStore((s) => s.buildings3d);
  const setBuildings3d = useCameraStore((s) => s.setBuildings3d);
  if (mapMode === "2d") return null;
  return (
    <button
      type="button"
      className={buildings3d ? "m-act m-act--accent" : "m-act m-act--quiet"}
      aria-pressed={buildings3d}
      onClick={() => setBuildings3d(!buildings3d)}
    >
      ▦ 3D DETAIL{buildings3d ? " ON" : ""}
    </button>
  );
}

/** ◎ SAVE VIEW (owner 2026-08-15) — the desktop SavePlaceControl twin, one-tap: bookmark the
 *  live FPV pose + pinned scene time to /api/places (it appears in MY PLACES on both shells).
 *  Phones get an auto title (no inline naming — rename/delete stay desktop). Anonymous gets a
 *  SIGN IN chip instead: the pose hash rides the login round trip, so the view survives it.
 *  Pose source = the SAME mirrors the `#f=` hash writer uses (fpvHud + camGeo), re-read at
 *  the save instant — a saved place and a shared link can never disagree. */
function SavePlaceChip() {
  const phase = useMemberStore((s) => s.phase);
  const refresh = useMemberStore((s) => s.refresh);
  const ready = useCameraStore((s) => s.fpvHud !== null && s.camGeo !== null);
  // Subscribed so the chip's ⏱ hint follows the scrubber state.
  const live = useTimeStore((s) => s.live);
  const [mode, setMode] = useState<"idle" | "busy" | "saved" | "error">("idle");
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!ready) return null;

  if (phase === "anonymous") {
    return (
      <button
        type="button"
        className="m-act m-act--quiet"
        onClick={() => {
          // Click-time returnTo — the #f= pose hash rides, the view survives the login hop.
          window.location.href = loginUrl(returnHereUrl());
        }}
      >
        ◎ SIGN IN TO SAVE
      </button>
    );
  }
  if (phase !== "member") return null;

  const save = async () => {
    // Re-read the live mirrors at the save instant — the render props may be a frame stale.
    const hud = useCameraStore.getState().fpvHud;
    const geo = useCameraStore.getState().camGeo;
    if (!hud || !geo) return;
    setMode("busy");
    const t = useTimeStore.getState();
    const stamp = new Date(sceneTimeMs()).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      const r = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `View · ${stamp}`,
          latDeg: geo.latDeg,
          lonDeg: geo.lonDeg,
          eyeM: Math.min(10_000, Math.max(0.5, hud.eyeAboveGroundM)),
          headingDeg: hud.headingDeg,
          pitchDeg: Math.min(89, Math.max(-89, hud.pitchDeg)),
          fovDeg: hud.fovDeg,
          timeMs: t.live ? null : sceneTimeMs(), // LIVE is never persisted (the &t= rule)
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMode("saved");
      window.setTimeout(() => setMode((m) => (m === "saved" ? "idle" : m)), 1800);
    } catch {
      setMode("error");
      window.setTimeout(() => setMode((m) => (m === "error" ? "idle" : m)), 1800);
    }
  };

  return (
    <button
      type="button"
      className="m-act"
      disabled={mode === "busy" || mode === "saved"}
      onClick={() => void save()}
    >
      {mode === "saved"
        ? "✓ SAVED"
        : mode === "error"
          ? "◎ RETRY SAVE"
          : mode === "busy"
            ? "◎ SAVING…"
            : `◎ SAVE VIEW${live ? "" : " ⏱"}`}
    </button>
  );
}
