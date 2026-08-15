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
import { loginUrl, returnHereUrl, useMemberStore } from "../../store/member";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import {
  applyStoredVariant,
  isVariantActive,
  setVariantUrl,
} from "../../lib/globe/enrichedVariant";
import { loadViewPrefs, saveViewPref } from "../../lib/prefs";
import { FPV, FRUSTUM } from "../globe/tuning";
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
          🧭 {busy ? "LOCATING…" : "MY LOCATION"}
        </button>
      )}
      {!tempFpv && <BuildingsChip />}
    </div>
  );
}

/** ▦ 3D DETAIL (owner 2026-08-15e) — the desktop deck's BLD twin: classic extruded bake ↔ the
 *  OSM2World detailed bake, OFF (classic) by default. Reload-based by design (a live tileset
 *  swap would tear down the enriched renderer mid-frame); the pose hash makes it lossless.
 *  Same pref (`enrichedVariant`) + same effective-state derivation as the desktop chip, so the
 *  choice carries across shells. Hidden where no enriched bake exists. */
function BuildingsChip() {
  const hasEnriched = Boolean(import.meta.env.PUBLIC_ENRICHED_TILES_URL);
  if (!hasEnriched) return null;
  const o2wActive = isVariantActive(
    applyStoredVariant(location.search, loadViewPrefs().enrichedVariant),
  );
  return (
    <button
      type="button"
      className={o2wActive ? "m-act m-act--accent" : "m-act m-act--quiet"}
      aria-pressed={o2wActive}
      onClick={() => {
        // Persist the NEW state, then reload with it explicit in the URL — the effective
        // (URL+pref) flag is what must flip, not the raw URL param (the desktop rule).
        saveViewPref("enrichedVariant", !o2wActive);
        location.assign(setVariantUrl(location.href, !o2wActive));
      }}
    >
      ▦ 3D DETAIL{o2wActive ? " ON" : ""}
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
