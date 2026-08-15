import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useFindStore } from "../../store/find";
import { useTimeStore, sceneTimeMs } from "../../store/time";
import { aimAtSky } from "../../store/skyAim";
import { bodyTarget, targetAzAlt, targetShortName } from "../../lib/ephemeris/targets";
import { bodyStatesAt } from "../../lib/ephemeris/bodies";
import { dayEvents, type PlanEvent } from "../../lib/ephemeris/planner";
import type { FindBody } from "../../lib/ephemeris/frameFinder";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { GOLDEN } from "../globe/tuning";
import "../../styles/sky-menu.css";

/**
 * Sky context menu (QoL-2 ask 7, owner 2026-08-14; grown 2026-08-15c) — right-click (desktop)
 * or long-press (/m) the sun, the moon or the tracked target: TRACK it (make it the sky
 * target), AIM the camera at it, toggle TRACKING (the FPV camera lock), its GHOSTS chain,
 * its MARK reticle + TRAIL arc, its FIND IN FRAME body chip, and jump to its next rise/set —
 * the rise/set jump also turns the camera so the body lands in frame (owner 2026-08-15c: the
 * old time-only jump left users staring at empty sky; the FIND "frame is the query" no-move
 * rule deliberately does NOT apply to menu actions). The moon's header carries its
 * illuminated %. Fed by the orchestrator's angular hit test (camera.skyMenu mirror — a
 * static click point, no live re-anchoring); dismissed by any canvas press, Escape, a
 * click-away, or any action.
 *
 * Top-level island (index.astro + m.astro), positioned from fixed client coords — the
 * `.ct-pinpop` discipline (never inside a backdrop-filtered ancestor). Two-shell fence:
 * this island must NEVER import from components/mobile/** — the one shell probe allowed is
 * the `body.m` class (MobileLayout), used to keep the desktop-only PLAN/FIND window
 * exclusivity from disturbing the /m plan sheet.
 */

const NAME: Record<"sun" | "moon", string> = { sun: "SUN", moon: "MOON" };

const hhmm = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([AP])M$/i, (_, p) => p.toLowerCase());

export default function SkyContextMenu() {
  const menu = useCameraStore((s) => s.skyMenu);
  const setMenu = useCameraStore((s) => s.setSkyMenu);
  const camGeo = useCameraStore((s) => s.camGeo);
  const focusLat = useCameraStore((s) => s.focusLatDeg);
  const focusLon = useCameraStore((s) => s.focusLonDeg);
  const sky = useSkyStore();
  const find = useFindStore();
  const setTime = useTimeStore((s) => s.setTime);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Viewport clamp (M3c): the card floats up-right of the anchor; a press near a screen edge
  // (a thumb long-press on /m, a right-click at the desktop edge) would push it offscreen.
  // Measure after layout, nudge back inside via margins; re-runs (and resets) per open.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !menu) return;
    el.style.marginLeft = "0px";
    el.style.marginTop = "0px";
    const r = el.getBoundingClientRect();
    const pad = 8;
    const dx = Math.max(pad - r.left, Math.min(0, window.innerWidth - pad - r.right));
    const dy = Math.max(pad - r.top, Math.min(0, window.innerHeight - pad - r.bottom));
    if (dx !== 0) el.style.marginLeft = `${Math.round(dx)}px`;
    if (dy !== 0) el.style.marginTop = `${Math.round(dy)}px`;
  }, [menu]);

  // Escape / click-away dismiss while open (pointerdown capture beats the menu's own clicks —
  // stopPropagation on the card keeps in-menu presses alive).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".skymenu")) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menu, setMenu]);

  // Next rise/set for the sun/moon — computed once per menu open (today + tomorrow windows).
  const riseSet = useMemo(() => {
    if (!menu || menu.kind === "target") return null;
    const lat = camGeo?.latDeg ?? focusLat;
    const lon = camGeo?.lonDeg ?? focusLon;
    const obs = { latDeg: lat, lonDeg: lon, groundAltM: 0, eyeAboveGroundM: 1.6 };
    const now = sceneTimeMs();
    const events: PlanEvent[] = [
      ...dayEvents(now, obs, GOLDEN),
      ...dayEvents(now + 86_400_000, obs, GOLDEN),
    ];
    const next = (kind: PlanEvent["kind"]) =>
      events.find((e) => e.kind === kind && e.utcMs > now) ?? null;
    return menu.kind === "sun"
      ? { rise: next("sunrise"), set: next("sunset") }
      : { rise: next("moonrise"), set: next("moonset") };
    // The menu is a one-shot surface: recompute only when it (re)opens.
  }, [menu, camGeo, focusLat, focusLon]);

  // Moon illuminated % for the header (owner 2026-08-15c) — once per open, scene instant.
  const moonIllum = useMemo(() => {
    if (!menu || menu.kind !== "moon") return null;
    return bodyStatesAt(sceneTimeMs()).moonIllumination;
  }, [menu]);

  if (!menu) return null;

  const isBody = menu.kind !== "target";
  const bodyId = menu.kind === "sun" ? ("sun" as const) : ("moon" as const);
  const tracked = isBody ? sky.target.id === `body:${bodyId}` : true;
  const glyph = isBody ? kindGlyph(bodyId) : kindGlyph(sky.target.kind);
  const label = isBody ? NAME[bodyId] : targetShortName(sky.target).toUpperCase();
  // FIND IN FRAME body chip for this object — sun/moon always, the tracked target only when
  // it IS the Milky-Way core (FIND scans sun/moon/gc, nothing else).
  const findBody: FindBody | null = isBody ? bodyId : sky.target.id === "dso:gc" ? "gc" : null;
  const findOn = findBody !== null && find.bodies[findBody];

  /** Sun/moon: make it the tracked target (idempotent), keep SHOW on. */
  const ensureTracked = () => {
    if (isBody && !tracked) sky.setTarget(bodyTarget(bodyId));
    if (!sky.visible) sky.setVisible(true);
  };

  /** Rise/set jumps also aim the camera at where the body stands at the NEW instant — the
   *  menu's az/alt snapshot is stale after a time jump, so recompute, then one-shot aim
   *  (alt floored at the horizon for framing; FPV glides, orbit turns). */
  const aimBodyAt = (ms: number) => {
    if (!isBody) return;
    const lat = camGeo?.latDeg ?? focusLat;
    const lon = camGeo?.lonDeg ?? focusLon;
    const p = targetAzAlt(bodyTarget(bodyId), ms, lat, lon);
    aimAtSky(p.azDeg, Math.max(p.altDeg, 0));
  };

  return (
    <div
      ref={cardRef}
      className="skymenu"
      role="menu"
      aria-label={`${label} actions`}
      style={{ left: menu.screenX, top: menu.screenY }}
    >
      <div className="skymenu__head">
        <span className={`skymenu__glyph skymenu__glyph--${menu.kind}`}>{glyph}</span>
        <span className="skymenu__name">{label}</span>
        <span className="skymenu__pos">
          {Math.round(menu.azDeg)}° · {menu.altDeg >= 0 ? "+" : ""}
          {Math.round(menu.altDeg)}°
          {moonIllum !== null ? ` · ${Math.round(moonIllum * 100)}%` : ""}
        </span>
      </div>
      {isBody && (
        <button
          type="button"
          className="skymenu__item"
          role="menuitem"
          onClick={() => {
            ensureTracked();
            sky.setOpen(true);
            setMenu(null);
          }}
        >
          {tracked ? "TARGET PANEL" : "⌖ TRACK"}
        </button>
      )}
      {!isBody && (
        <button
          type="button"
          className="skymenu__item"
          role="menuitem"
          onClick={() => {
            sky.setOpen(true);
            setMenu(null);
          }}
        >
          TARGET PANEL
        </button>
      )}
      <button
        type="button"
        className="skymenu__item"
        role="menuitem"
        onClick={() => {
          aimAtSky(menu.azDeg, menu.altDeg);
          setMenu(null);
        }}
      >
        ◎ AIM HERE
      </button>
      <button
        type="button"
        className="skymenu__item"
        role="menuitem"
        onClick={() => {
          ensureTracked();
          // Enabling for an untracked body first TRACKS it — one gesture (the ghosts idiom).
          sky.setTrack(isBody && !tracked ? true : !sky.track);
          setMenu(null);
        }}
      >
        {tracked && sky.track ? "TRACKING OFF" : "⊕ TRACKING"}
      </button>
      <button
        type="button"
        className="skymenu__item"
        role="menuitem"
        onClick={() => {
          ensureTracked();
          // Toggling ghosts for a body that wasn't tracked first TRACKS it — one gesture.
          sky.setGhosts(isBody && !tracked ? true : !sky.ghosts);
          setMenu(null);
        }}
      >
        {tracked && sky.ghosts ? "GHOSTS OFF" : "✧ GHOSTS"}
      </button>
      <button
        type="button"
        className="skymenu__item"
        role="menuitem"
        onClick={() => {
          ensureTracked();
          sky.setHighlight(isBody && !tracked ? true : !sky.highlight);
          setMenu(null);
        }}
      >
        {tracked && sky.highlight ? "MARK OFF" : "◌ MARK"}
      </button>
      <button
        type="button"
        className="skymenu__item"
        role="menuitem"
        onClick={() => {
          ensureTracked();
          sky.setTrail(isBody && !tracked ? true : !sky.trail);
          setMenu(null);
        }}
      >
        {tracked && sky.trail ? "TRAIL OFF" : "∿ TRAIL"}
      </button>
      {findBody && (
        <button
          type="button"
          className="skymenu__item"
          role="menuitem"
          onClick={() => {
            const f = useFindStore.getState();
            f.setBody(findBody, !findOn);
            if (!findOn) {
              // Switching a body ON opens the FIND surface (the scan lives in the panel /
              // the /m FindSheet hooks — find.open gates it). Desktop only: close the PLAN
              // window first (shared-window exclusivity); on /m `body.m` skips this so an
              // open PLAN sheet keeps its planFeed.
              if (!document.body.classList.contains("m"))
                usePlanStore.getState().setOpen(false);
              f.setOpen(true);
            }
            setMenu(null);
          }}
        >
          {findOn ? "FIND IN FRAME OFF" : "⌖ FIND IN FRAME"}
        </button>
      )}
      {riseSet?.rise && (
        <button
          type="button"
          className="skymenu__item"
          role="menuitem"
          onClick={() => {
            setTime(riseSet.rise!.utcMs);
            aimBodyAt(riseSet.rise!.utcMs);
            setMenu(null);
          }}
        >
          ↗ RISE {hhmm(riseSet.rise.utcMs)}
        </button>
      )}
      {riseSet?.set && (
        <button
          type="button"
          className="skymenu__item"
          role="menuitem"
          onClick={() => {
            setTime(riseSet.set!.utcMs);
            aimBodyAt(riseSet.set!.utcMs);
            setMenu(null);
          }}
        >
          ↘ SET {hhmm(riseSet.set.utcMs)}
        </button>
      )}
    </div>
  );
}
