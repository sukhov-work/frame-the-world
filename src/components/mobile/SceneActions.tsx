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
import { createPortal } from "react-dom";
import Sheet from "./Sheet";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { usePlacesMapStore } from "../../store/places";
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { saveViewPref } from "../../lib/prefs";
import { formatAltM } from "../../lib/format/readout";
import { CONTROLS, FPV, FRUSTUM, MOBILE2D, ORCH } from "../globe/tuning";
import "../../styles/mobile/chrome.css";

/** Last FPV focal (vertical FOV) seen this session — a long-press 3D jump re-enters at the
 *  focal the user last stood at instead of the temp default (batch #4 item 10). Tracked from
 *  the fpvHud mirror by the SceneActions root (always mounted on /m). */
let lastFpvFovDeg: number | null = null;

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
  // Track the last FPV focal for the long-press 3D jump (module note above).
  useEffect(
    () =>
      useCameraStore.subscribe((s) => {
        if (s.fpvHud) lastFpvFovDeg = s.fpvHud.fovDeg;
      }),
    [],
  );

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
      {!tempFpv && <LayersChip />}
    </div>
  );
}

/** 2D ↔ 3D (UPLIFT U1, owner point 1) — the accessibility twin of the two-finger tilt gesture.
 *  2D → 3D tilts up to the desktop toggle's angle (buildings attach on the mode write); 3D →
 *  2D glides back to nadir + north (buildings detach). The orchestrator's locks/gate own the
 *  camera + tileset mechanics — this chip only writes the store seams.
 *  LONG-PRESS (owner batch #4 item 10, 2026-08-21): jump straight into FPV at the current map
 *  centre — no set point needed — keeping the last-used focal (the MapWindow long-press pose,
 *  aimed the way the map is turned). The ORCH long-press shape: 500 ms, 6 px move-cancel. */
function MapModeChip() {
  const mapMode = useCameraStore((s) => s.mapMode);
  const setMapMode = useCameraStore((s) => s.setMapMode);
  const setTargetTilt = useCameraStore((s) => s.setTargetTilt);
  const setTargetHeading = useCameraStore((s) => s.setTargetHeading);
  const is2D = mapMode === "2d";
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);
  const downPos = useRef({ x: 0, y: 0 });
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => cancelPress, []);
  const jumpHere = () => {
    const cam = useCameraStore.getState();
    cam.requestFpvJump({
      latDeg: cam.focusLatDeg,
      lonDeg: cam.focusLonDeg,
      eyeM: FRUSTUM.eyeHeightM,
      headingDeg: cam.headingDeg,
      pitchDeg: 0,
      fovDeg: lastFpvFovDeg ?? FPV.tempFovDeg,
    });
  };
  return (
    <button
      type="button"
      className="m-act"
      aria-pressed={is2D}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        pressFired.current = false;
        downPos.current = { x: e.clientX, y: e.clientY };
        cancelPress();
        pressTimer.current = window.setTimeout(() => {
          pressTimer.current = null;
          pressFired.current = true;
          jumpHere();
        }, ORCH.longPressMs);
      }}
      onPointerMove={(e) => {
        if (
          pressTimer.current !== null &&
          Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) >
            ORCH.clickDragPx
        )
          cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onClick={() => {
        if (pressFired.current) {
          // The long-press already consumed this gesture — swallow the trailing click.
          pressFired.current = false;
          return;
        }
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

/** ⊞ LAYERS (owner 2026-08-19, LAYERS batch) — configurability without clutter: ONE chip
 *  expanding the scene-layer toggles. Absorbs the old standalone ▦ 3D DETAIL chip (owner
 *  2026-08-15e) and adds: MY PLACES markers on the 2D map (member feature), photo pins
 *  (/m default OFF), and the aim RADAR master switch. Every toggle persists through the
 *  shared view-prefs blob; the expand state itself is session-local. Expands LEFT (owner
 *  2026-08-19b): the anchor chip is DOM-first inside a row-reverse row so it never moves. */
function LayersChip() {
  const [expanded, setExpanded] = useState(false);
  const mapMode = useCameraStore((s) => s.mapMode);
  const buildings3d = useCameraStore((s) => s.buildings3d);
  const setBuildings3d = useCameraStore((s) => s.setBuildings3d);
  const pinsVisible = useCameraStore((s) => s.pinsVisible);
  const setPinsVisible = useCameraStore((s) => s.setPinsVisible);
  const aimVisible = useSkyStore((s) => s.aimVisible);
  const setAimVisible = useSkyStore((s) => s.setAimVisible);
  const placesOn = usePlacesMapStore((s) => s.onMap);
  const setPlacesOn = usePlacesMapStore((s) => s.setOnMap);
  const vectorsVisible = useCameraStore((s) => s.vectorsVisible);
  const setVectorsVisible = useCameraStore((s) => s.setVectorsVisible);
  const toggleCls = (on: boolean) => (on ? "m-act m-act--accent" : "m-act m-act--quiet");
  return (
    <div className="m-layersrow">
      <button
        type="button"
        className="m-act"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        ⊞ LAYERS
      </button>
      {expanded && (
        <>
          {/* 2D has no buildings (U1) — the chip stays visible but stands down. */}
          <button
            type="button"
            className={toggleCls(buildings3d)}
            aria-pressed={buildings3d}
            disabled={mapMode === "2d"}
            onClick={() => setBuildings3d(!buildings3d)}
          >
            ▦ 3D DETAIL
          </button>
          <button
            type="button"
            className={toggleCls(placesOn)}
            aria-pressed={placesOn}
            onClick={() => setPlacesOn(!placesOn)}
          >
            ◎ MY PLACES
          </button>
          {/* Persist at the call site, never in the setter — the FPV declutter shares it. */}
          <button
            type="button"
            className={toggleCls(pinsVisible)}
            aria-pressed={pinsVisible}
            onClick={() => {
              saveViewPref("pinsVisible", !pinsVisible);
              setPinsVisible(!pinsVisible);
            }}
          >
            ⌖ PHOTO PINS
          </button>
          <button
            type="button"
            className={toggleCls(aimVisible)}
            aria-pressed={aimVisible}
            onClick={() => setAimVisible(!aimVisible)}
          >
            ∠ RADAR
          </button>
          <button
            type="button"
            className={toggleCls(vectorsVisible)}
            aria-pressed={vectorsVisible}
            onClick={() => setVectorsVisible(!vectorsVisible)}
          >
            ▤ VECTOR
          </button>
        </>
      )}
    </div>
  );
}

/** ◎ SAVE VIEW (owner 2026-08-15; optional naming ask owner 2026-08-19b — supersedes the
 *  auto-title-only ruling) — the desktop SavePlaceControl twin: bookmark the live FPV pose +
 *  pinned scene time to /api/places (it appears in MY PLACES on both shells). Tap first asks
 *  an OPTIONAL name in a small Sheet (portaled to <body>: the chip stack is a z-10 fixed
 *  layer exactly where the soft keyboard lands — the sheet idiom is the shell's one
 *  keyboard-safe input home, same as SEARCH). Empty submit keeps the auto title. Anonymous
 *  gets a SIGN IN chip instead: the pose hash rides the login round trip, so the view
 *  survives it. Pose source = the SAME mirrors the `#f=` hash writer uses (fpvHud + camGeo),
 *  re-read at the save instant — a saved place and a shared link can never disagree. */
function SavePlaceChip() {
  const phase = useMemberStore((s) => s.phase);
  const refresh = useMemberStore((s) => s.refresh);
  const ready = useCameraStore((s) => s.fpvHud !== null && s.camGeo !== null);
  // Subscribed so the chip's ⏱ hint follows the scrubber state.
  const live = useTimeStore((s) => s.live);
  const [mode, setMode] = useState<"idle" | "naming" | "busy" | "saved" | "error">("idle");
  const [title, setTitle] = useState("");
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
    // Custom name wins; empty keeps the auto title (nicer than the server's default).
    const finalTitle = title.trim() || `View · ${stamp}`;
    const pose = {
      latDeg: geo.latDeg,
      lonDeg: geo.lonDeg,
      eyeM: Math.min(10_000, Math.max(0.5, hud.eyeAboveGroundM)),
      headingDeg: hud.headingDeg,
      pitchDeg: Math.min(89, Math.max(-89, hud.pitchDeg)),
      fovDeg: hud.fovDeg,
      timeMs: t.live ? null : sceneTimeMs(), // LIVE is never persisted (the &t= rule)
    };
    try {
      const r = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: finalTitle, ...pose }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Push into the map-marker store so it shows WITHOUT a reload (owner 2026-08-19b).
      const j = (await r.json().catch(() => null)) as { placeId?: string } | null;
      if (j?.placeId) {
        usePlacesMapStore.getState().addLocal({
          id: j.placeId,
          title: finalTitle,
          createdAt: new Date().toISOString(),
          ...pose,
        });
      }
      setMode("saved");
      setTitle("");
      window.setTimeout(() => setMode((m) => (m === "saved" ? "idle" : m)), 1800);
    } catch {
      setMode("error");
      window.setTimeout(() => setMode((m) => (m === "error" ? "idle" : m)), 1800);
    }
  };

  return (
    <>
      <button
        type="button"
        className="m-act"
        disabled={mode === "busy" || mode === "saved"}
        onClick={() => setMode("naming")}
      >
        {mode === "saved"
          ? "✓ SAVED"
          : mode === "error"
            ? "◎ RETRY SAVE"
            : mode === "busy"
              ? "◎ SAVING…"
              : `◎ SAVE VIEW${live ? "" : " ⏱"}`}
      </button>
      {mode === "naming" &&
        createPortal(
          <Sheet title="SAVE VIEW" onClose={() => setMode("idle")}>
            <div className="m-savename">
              <input
                className="m-input"
                type="text"
                placeholder="NAME THIS PLACE (OPTIONAL)"
                maxLength={120}
                value={title}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                aria-label="Optional place name"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") void save();
                }}
              />
              <button type="button" className="m-act m-act--accent" onClick={() => void save()}>
                ◎ SAVE{live ? "" : " ⏱"}
              </button>
            </div>
          </Sheet>,
          document.body,
        )}
    </>
  );
}
