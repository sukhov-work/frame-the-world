import { useEffect, useRef } from "react";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { useCameraStore } from "../../store/camera";
import { useMiniMapStore } from "../../store/minimap";
import { usePlacesMapStore } from "../../store/places";
import { useSkyStore } from "../../store/sky";
import { useTimeStore, sceneTimeMs } from "../../store/time";
import { lonLatToTileF, tileFToLonLat, zoomForMetersPerPx } from "../../lib/geo/slippy";
import {
  sampleAimDay,
  splitAimRuns,
  wrap180,
  type AimDay,
  type AimSample,
} from "../../lib/ephemeris/azSector";
import { localDayWindow } from "../../lib/ephemeris/dayArc";
import { bodyTarget, targetAzAlt, type SkyTarget } from "../../lib/ephemeris/targets";
import { tokens } from "../../lib/theme/tokens";
import { AIMCONES, FPV, FRUSTUM, TILESETS } from "../globe/tuning";
import "../../styles/map-window.css";

/**
 * MapWindow (UPLIFT U3, owner point 2) — the fullscreen north-up photo-tile map, opened by
 * tapping the FPV mini-map. Desktop: a large centred window (the GUIDE precedent); /m: true
 * fullscreen (styles/map-window.css switches on body.m). A plain 2D canvas drawing the SAME
 * raster sources the ground drape uses (Esri World Imagery in satellite mode, CARTO dark
 * otherwise — TILESETS; Esri ToS: reuse-in-dev per UPLIFT_PLAN §4.2, licensed-source decision
 * rides U7), plus the viewer's position + live FOV cone and the temp pin.
 *
 * Interactions: drag pans · wheel / pinch / ± buttons zoom · double-click (desktop) or
 * long-press (touch) = VIEW FROM HERE (requestFpvJump — relocates a live FPV session, the
 * MobilePlaces idiom) · ✕ / Esc returns to the mini-map. Top-level island (the S2
 * containing-block rule) on both pages.
 */

const TILE_SRC_PX = 256; // XYZ source tiles are 256 px
const MIN_Z = 3;
const PINCH_SENS = 0.8; // continuous-pinch damping (batch #4 item 4): <1 = calmer than 1:1 log2
const LONG_PRESS_MS = 500; // the ORCH long-press shape (tuning.ts ORCH.longPressMs twin)
const DRAG_CANCEL_PX = 6;
const TILE_CACHE_MAX = 300;
// U4 aim overlay: chart-fixed radius (the FOV-cone idiom — the map is a chart, metres live on
// the globe module); slightly wider than the 0.22 FOV cone so the sectors read around it.
const AIM_R_FRAC = 0.3;
const AIM_TAP_TOL_DEG = 8; // tap-promote angular tolerance around a direction line

interface TileImg {
  img: HTMLImageElement;
  ok: boolean;
}

type AimKey = "target" | "sun" | "moon";

export default function MapWindow() {
  const open = useMiniMapStore((s) => s.mapWindowOpen);
  const setOpen = useMiniMapStore((s) => s.setMapWindowOpen);
  // Desktop window drag (owner batch #4 item 13) — /m ignores it (fullscreen, grip hidden).
  const drag = usePanelDrag("map-window");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The view state lives in refs — drawing is manual (rAF-scheduled), React only owns chrome.
  const view = useRef({ latDeg: 0, lonDeg: 0, z: 16 });
  const tiles = useRef<Map<string, TileImg>>(new Map());
  const rafPending = useRef(false);
  // The zoom chips need the effect-scoped zoomBy — bridged through a ref.
  const zoomButtons = useRef<(dz: number) => void>(() => {});
  // U4: per-body aim-day memo — ~145 ephemeris calls per (target, day, anchor); the 20 Hz
  // FPV repaint only re-splits at now. Warm across open/close like the tile cache.
  const aimCache = useRef<Map<AimKey, { key: string; day: AimDay }>>(new Map());

  // /m batch item 4 (owner 2026-08-19): while the fullscreen map is up the FPV walk controls
  // float above it (mobile/fpv.css `body.mw-open` rung) — precision moves with the map open.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("mw-open");
    return () => document.body.classList.remove("mw-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = useCameraStore.getState();
    // Centre on the FPV eye (camGeo) — or the orbit focus when opened outside FPV; initial
    // zoom matches the current view scale so the map "continues" what the user sees.
    const centre = cam.camGeo ?? { latDeg: cam.focusLatDeg, lonDeg: cam.focusLonDeg };
    view.current.latDeg = centre.latDeg;
    view.current.lonDeg = centre.lonDeg;
    const satellite = cam.groundMode === "satellite";
    const maxZ = satellite ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
    // FPV opens one level closer since batch #4 item 4 ("start with closer zoom") — z18 on
    // Esri (max 19) keeps one wheel/pinch step of headroom plus the retina boost.
    view.current.z = cam.fpvHud
      ? Math.min(18, maxZ)
      : zoomForMetersPerPx(centre.latDeg, Math.max(0.3, cam.zoomAltM * 0.0012), MIN_Z, maxZ);

    const requestRedraw = () => {
      if (rafPending.current) return;
      rafPending.current = true;
      requestAnimationFrame(() => {
        rafPending.current = false;
        draw();
      });
    };

    const cssVar = (name: string) =>
      getComputedStyle(canvas).getPropertyValue(name).trim() || "#8ef";

    // ── U4 aim helpers (shared by draw() and the tap-promote hit test) ──────────────────────
    // LIVE anchor (owner lag report 2026-08-18): the plan-STORE anchor is a low-cadence,
    // ~25 m-chunked mirror with a lifecycle that strands stale FPV anchors — while walking,
    // the circle visibly trailed the 20 Hz camGeo-centred chart. Resolve live instead, the
    // aimCones orchestrator rule: walking FPV viewer > temp pin > viewer point > focus mirror.
    const aimAnchorNow = (camNow: ReturnType<typeof useCameraStore.getState>) =>
      (camNow.fpvHud ? camNow.camGeo : null) ??
      camNow.tempPin ??
      camNow.camGeo ?? { latDeg: camNow.focusLatDeg, lonDeg: camNow.focusLonDeg };

    const aimBodiesNow = (skyNow: ReturnType<typeof useSkyStore.getState>) => {
      const out: { key: AimKey; target: SkyTarget; color: string; emphasized: boolean }[] = [];
      if (!skyNow.aimVisible) return out; // RADAR master switch (LAYERS batch, 2026-08-19)
      // UNFOLLOW/SHOW-off (2026-08-19): a hidden target draws no direction line either.
      if (skyNow.aimTarget && skyNow.visible)
        out.push({
          key: "target",
          target: skyNow.target,
          color: tokens.accent,
          emphasized: skyNow.aimFocus === "target",
        });
      if (skyNow.aimSun)
        out.push({
          key: "sun",
          target: bodyTarget("sun"),
          color: tokens.sunGlow,
          emphasized: skyNow.aimFocus === "sun",
        });
      if (skyNow.aimMoon)
        out.push({
          key: "moon",
          target: bodyTarget("moon"),
          color: tokens.moonDial, // dial SILVER — distinct from the past-sector grey (owner 2026-08-18)
          emphasized: skyNow.aimFocus === "moon",
        });
      return out;
    };

    const aimDayFor = (
      key: AimKey,
      target: SkyTarget,
      anchor: { latDeg: number; lonDeg: number },
      nowMs: number,
    ): AimDay => {
      const w0 = localDayWindow(nowMs, anchor.lonDeg);
      const memoKey = `${target.id}:${anchor.latDeg.toFixed(3)}:${anchor.lonDeg.toFixed(3)}:${w0.startMs}`;
      const hit = aimCache.current.get(key);
      if (hit && hit.key === memoKey) return hit.day;
      const day = sampleAimDay(target, nowMs, anchor.latDeg, anchor.lonDeg, AIMCONES.stepMin);
      aimCache.current.set(key, { key: memoKey, day });
      return day;
    };

    const tileFor = (tpl: string, z: number, x: number, y: number): TileImg => {
      const n = 2 ** z;
      const wx = ((x % n) + n) % n; // wrap longitude
      const url = tpl
        .replace("{z}", String(z))
        .replace("{x}", String(wx))
        .replace("{y}", String(y));
      const cache = tiles.current;
      const hit = cache.get(url);
      if (hit) return hit;
      const entry: TileImg = { img: new Image(), ok: false };
      entry.img.crossOrigin = "anonymous";
      entry.img.onload = () => {
        entry.ok = true;
        requestRedraw();
      };
      entry.img.src = url;
      cache.set(url, entry);
      if (cache.size > TILE_CACHE_MAX) {
        for (const k of cache.keys()) {
          if (cache.size <= TILE_CACHE_MAX) break;
          cache.delete(k);
        }
      }
      return entry;
    };

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w === 0 || h === 0) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const camNow = useCameraStore.getState();
      const sat = camNow.groundMode === "satellite";
      const tpl = sat ? TILESETS.esriImageryUrl : TILESETS.cartoDarkUrl;
      const srcMaxZ = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      // Retina: fetch one level deeper and draw tiles half-size so texel density matches the
      // glass (the slippy retina idiom); zDraw stays within the source's real range.
      const boost = dpr >= 1.5 ? 1 : 0;
      const { z, latDeg, lonDeg } = view.current;
      const zDraw = Math.min(Math.round(z) + boost, srcMaxZ); // integer tile level under a continuous z
      const tilePx = TILE_SRC_PX * dpr * 2 ** (z - zDraw); // device px per drawn tile
      const c = lonLatToTileF(lonDeg, latDeg, zDraw);
      const n = 2 ** zDraw;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = cssVar("--color-bg");
      ctx.fillRect(0, 0, w, h);
      const x0 = Math.floor(c.x - w / 2 / tilePx);
      const x1 = Math.floor(c.x + w / 2 / tilePx);
      const y0 = Math.max(0, Math.floor(c.y - h / 2 / tilePx));
      const y1 = Math.min(n - 1, Math.floor(c.y + h / 2 / tilePx));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = tileFor(tpl, zDraw, tx, ty);
          if (!t.ok) continue;
          const dx = Math.round(w / 2 + (tx - c.x) * tilePx);
          const dy = Math.round(h / 2 + (ty - c.y) * tilePx);
          ctx.drawImage(t.img, dx, dy, Math.ceil(tilePx), Math.ceil(tilePx));
        }
      }
      // Markers: geodetic → drawn-tile space → device px.
      const toPx = (lat: number, lon: number): [number, number] => {
        const p = lonLatToTileF(lon, lat, zDraw);
        return [w / 2 + (p.x - c.x) * tilePx, h / 2 + (p.y - c.y) * tilePx];
      };
      const accent = cssVar("--color-accent");

      // ── U4 aim overlay — the GL aimCones module's canvas twin: same azSector helper, same
      // token colours (bridge import — sunGlow/moonlight have no CSS custom property), chart-
      // fixed radius. Split at scene time per paint (cheap); the day sampling is memoised.
      // Drawn BEFORE the pin/eye markers so position always reads on top.
      {
        const skyNow = useSkyStore.getState();
        const anchor = aimAnchorNow(camNow);
        const nowMs = sceneTimeMs();
        const rBase = Math.min(w, h) * AIM_R_FRAC;
        const [ax, ay] = toPx(anchor.latDeg, anchor.lonDeg);
        const pt = (azDeg: number, rr: number): [number, number] => {
          // Compass az (N=0, CW) → canvas angle: north is −y, east is +x.
          const th = ((azDeg - 90) * Math.PI) / 180;
          return [ax + rr * Math.cos(th), ay + rr * Math.sin(th)];
        };
        const sectorPath = (runs: readonly AimSample[][], r: number) => {
          ctx.beginPath();
          for (const run of runs) {
            if (run.length < 2) continue;
            ctx.moveTo(ax, ay);
            for (const s of run) {
              const [x, y] = pt(s.azDeg, r);
              ctx.lineTo(x, y);
            }
            ctx.closePath(); // wedge closure — FILLS only; strokes use arcPath + spokes
          }
        };
        // Rim ARC only (no centre legs) — the past/future stroke must not draw the radial
        // spokes: those are the body's rise/set boundary and wear its identity colour (owner
        // 2026-08-18; also removes the ring day-boundary seam the closePath used to draw).
        const arcPath = (runs: readonly AimSample[][], r: number) => {
          ctx.beginPath();
          for (const run of runs) {
            if (run.length < 2) continue;
            const [x0, y0] = pt(run[0].azDeg, r);
            ctx.moveTo(x0, y0);
            for (let i = 1; i < run.length; i++) {
              const [x, y] = pt(run[i].azDeg, r);
              ctx.lineTo(x, y);
            }
          }
        };
        for (const b of aimBodiesNow(skyNow)) {
          const r = rBase * (b.emphasized ? 1 : AIMCONES.compactK);
          const day = aimDayFor(b.key, b.target, anchor, nowMs);
          const split = splitAimRuns(day, nowMs);
          if (b.emphasized) {
            // Glassy fills — past NEUTRAL grey (inert history, never a day/night claim —
            // owner 2026-08-18), future blue (the scrubber's language).
            ctx.globalAlpha = AIMCONES.fillAlpha;
            ctx.fillStyle = tokens.textSecondary;
            sectorPath(split.past, r);
            ctx.fill();
            ctx.fillStyle = tokens.timeFuture;
            sectorPath(split.future, r);
            ctx.fill();
          }
          ctx.globalAlpha = AIMCONES.rimAlpha;
          ctx.lineWidth = 1 * dpr;
          ctx.strokeStyle = tokens.textSecondary;
          arcPath(split.past, r);
          ctx.stroke();
          ctx.strokeStyle = tokens.timeFuture;
          arcPath(split.future, r);
          ctx.stroke();
          // Rise/set radial spokes — BODY identity colour (sun orange / moon silver / target
          // accent); a ring (circumpolar) has no rise/set → no spokes (the GL module's rule).
          if (day.kind !== "ring") {
            ctx.strokeStyle = b.color;
            ctx.beginPath();
            for (const run of day.runs) {
              if (run.length < 2) continue;
              for (const s of [run[0], run[run.length - 1]]) {
                const [ex, ey] = pt(s.azDeg, r);
                ctx.moveTo(ax, ay);
                ctx.lineTo(ex, ey);
              }
            }
            ctx.stroke();
          }
          // Direction line at the CURRENT azimuth — body identity colour, pales below horizon.
          // Slim (the GL module's owner-2026-08-18 halving); only the FOCUSED body's line reads
          // past the rim — the others end exactly at their circle. The TARGET line is the
          // tracking RAY (batch #4 item 6): it runs to the window edge for distant alignment.
          const nowPos = targetAzAlt(b.target, nowMs, anchor.latDeg, anchor.lonDeg);
          ctx.globalAlpha = nowPos.altDeg > 0 ? AIMCONES.lineAlpha : AIMCONES.lineAlphaDown;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          const rayLen =
            b.key === "target" ? Math.hypot(w, h) : r * (b.emphasized ? AIMCONES.lineLenK : 1);
          const [lx, ly] = pt(nowPos.azDeg, rayLen);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // MY PLACES markers (LAYERS batch, owner 2026-08-19) — the member's saved views: the
      // temp-pin drawing at the lavender pin hue, so "yours but dormant" reads at a glance.
      const placesNow = usePlacesMapStore.getState();
      if (placesNow.onMap && placesNow.places.length > 0) {
        ctx.strokeStyle = tokens.pinLavender;
        ctx.fillStyle = tokens.pinLavender;
        for (const p of placesNow.places) {
          const [px, py] = toPx(p.latDeg, p.lonDeg);
          if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 1.8 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      const pin = camNow.tempPin;
      if (pin) {
        const [px, py] = toPx(pin.latDeg, pin.lonDeg);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 * dpr;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(px, py, 7 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      const geo = camNow.camGeo;
      if (geo) {
        const [px, py] = toPx(geo.latDeg, geo.lonDeg);
        const hud = camNow.fpvHud;
        if (hud) {
          // Live FOV cone — the mini-map's U3 cone at map scale.
          const half = Math.atan(Math.tan((hud.fovDeg * Math.PI) / 360) * hud.aspect);
          const heading = (hud.headingDeg * Math.PI) / 180;
          const r = Math.min(w, h) * 0.22;
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.16;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.arc(px, py, r, heading - half - Math.PI / 2, heading + half - Math.PI / 2);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1 * dpr;
          ctx.strokeStyle = accent;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cssVar("--color-bg");
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    };

    // --- interactions ------------------------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pinchStartDist = 0;
    let pinchStartZ = 0;
    let downX = 0;
    let downY = 0;
    let pressTimer: number | null = null;
    const cancelPress = () => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const canvasPointToLatLon = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { z, latDeg, lonDeg } = view.current;
      const sat = useCameraStore.getState().groundMode === "satellite";
      const srcMaxZ = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      const boost = dpr >= 1.5 ? 1 : 0;
      const zDraw = Math.min(Math.round(z) + boost, srcMaxZ); // integer tile level under a continuous z
      const tilePx = TILE_SRC_PX * dpr * 2 ** (z - zDraw);
      const c = lonLatToTileF(lonDeg, latDeg, zDraw);
      const dx = ((clientX - rect.left - rect.width / 2) * dpr) / tilePx;
      const dy = ((clientY - rect.top - rect.height / 2) * dpr) / tilePx;
      const ll = tileFToLonLat(c.x + dx, c.y + dy, zDraw);
      return { latDeg: ll.latDeg, lonDeg: ll.lonDeg };
    };

    const viewFromHere = (clientX: number, clientY: number) => {
      const at = canvasPointToLatLon(clientX, clientY);
      useCameraStore.getState().requestFpvJump({
        latDeg: at.latDeg,
        lonDeg: at.lonDeg,
        eyeM: FRUSTUM.eyeHeightM,
        headingDeg: 0,
        pitchDeg: 0,
        fovDeg: FPV.tempFovDeg,
      });
      setOpen(false);
    };

    const panBy = (dxCss: number, dyCss: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { z } = view.current;
      const sat = useCameraStore.getState().groundMode === "satellite";
      const srcMaxZ = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      const boost = dpr >= 1.5 ? 1 : 0;
      const zDraw = Math.min(Math.round(z) + boost, srcMaxZ); // integer tile level under a continuous z
      const tilePx = TILE_SRC_PX * dpr * 2 ** (z - zDraw);
      const c = lonLatToTileF(view.current.lonDeg, view.current.latDeg, zDraw);
      const ll = tileFToLonLat(c.x - (dxCss * dpr) / tilePx, c.y - (dyCss * dpr) / tilePx, zDraw);
      view.current.lonDeg = ll.lonDeg;
      view.current.latDeg = Math.max(-85, Math.min(85, ll.latDeg));
      requestRedraw();
    };

    const zoomBy = (dz: number) => {
      const sat = useCameraStore.getState().groundMode === "satellite";
      const maxZNow = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      // Wheel/chips step whole levels — rounding first re-seats a fractional pinch z.
      view.current.z = Math.min(maxZNow, Math.max(MIN_Z, Math.round(view.current.z + dz)));
      requestRedraw();
    };
    zoomButtons.current = zoomBy;

    const onPointerDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // NotFoundError when the pointer is already gone (a fast tap released within the
        // same frame, or a synthetic event) — the drag/press bookkeeping below still applies.
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        downX = e.clientX;
        downY = e.clientY;
        if (e.pointerType === "touch") {
          cancelPress();
          pressTimer = window.setTimeout(() => {
            pressTimer = null;
            dragging = false;
            viewFromHere(downX, downY);
          }, LONG_PRESS_MS);
        }
      } else if (pointers.size === 2) {
        cancelPress();
        dragging = false;
        const [a, b] = [...pointers.values()];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartZ = view.current.z;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && dragging) {
        if (
          pressTimer !== null &&
          Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_CANCEL_PX
        ) {
          cancelPress();
        }
        panBy(e.clientX - prev.x, e.clientY - prev.y);
      } else if (pointers.size === 2 && pinchStartDist > 0) {
        // Continuous pinch (owner batch #4 item 4 — the old Math.round snapped whole slippy
        // levels and read as chaotic steps): fractional z, gently damped; tiles render at the
        // nearest integer level scaled by 2^(z − zDraw).
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const dz = Math.log2(d / pinchStartDist) * PINCH_SENS;
        const sat = useCameraStore.getState().groundMode === "satellite";
        const maxZNow = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
        const next = Math.min(maxZNow, Math.max(MIN_Z, pinchStartZ + dz));
        if (next !== view.current.z) {
          view.current.z = next;
          requestRedraw();
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      cancelPress();
      if (pointers.size === 0) dragging = false;
      if (pointers.size < 2) pinchStartDist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    const onDblClick = (e: MouseEvent) => viewFromHere(e.clientX, e.clientY);
    // U4 tap-promote: a click ON a body's direction line promotes it to the emphasized system
    // (UPLIFT_PLAN §2/U4 "a tap on a line promotes it"). Tight gate — azimuth within tolerance
    // AND radially along the line's reach — so ordinary map taps never steal the focus.
    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_CANCEL_PX) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = rect.width * dpr;
      const h = rect.height * dpr;
      const camNow = useCameraStore.getState();
      const skyNow = useSkyStore.getState();
      const anchor = aimAnchorNow(camNow);
      const nowMs = sceneTimeMs();
      // Same transform stack as draw() (the canvasPointToLatLon idiom).
      const sat = camNow.groundMode === "satellite";
      const srcMaxZ = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      const boost = dpr >= 1.5 ? 1 : 0;
      const { z, latDeg, lonDeg } = view.current;
      const zDraw = Math.min(Math.round(z) + boost, srcMaxZ); // integer tile level under a continuous z
      const tilePx = TILE_SRC_PX * dpr * 2 ** (z - zDraw);
      const c = lonLatToTileF(lonDeg, latDeg, zDraw);
      const a = lonLatToTileF(anchor.lonDeg, anchor.latDeg, zDraw);
      const axPx = w / 2 + (a.x - c.x) * tilePx;
      const ayPx = h / 2 + (a.y - c.y) * tilePx;
      const dx = (e.clientX - rect.left) * dpr - axPx;
      const dy = (e.clientY - rect.top) * dpr - ayPx;
      const dist = Math.hypot(dx, dy);
      // Compass azimuth of the tap around the anchor (north = −y on canvas).
      const azClick = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      const rBase = Math.min(w, h) * AIM_R_FRAC;
      let best: { key: AimKey; dAz: number } | null = null;
      for (const b of aimBodiesNow(skyNow)) {
        if (b.emphasized) continue; // already the focus
        // The target's tracking ray runs to the window edge (batch #4 item 6) — its whole
        // length promotes; sun/moon keep the compact-rim band.
        const reach =
          b.key === "target" ? Math.hypot(w, h) : rBase * AIMCONES.compactK * AIMCONES.lineLenK;
        if (dist < rBase * AIMCONES.compactK * 0.15 || dist > reach * 1.05) continue;
        const nowPos = targetAzAlt(b.target, nowMs, anchor.latDeg, anchor.lonDeg);
        const dAz = Math.abs(wrap180(azClick - nowPos.azDeg));
        if (dAz <= AIM_TAP_TOL_DEG && (!best || dAz < best.dAz)) best = { key: b.key, dAz };
      }
      if (best) {
        skyNow.setAimFocus(best.key);
        requestRedraw();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", requestRedraw);
    // Live markers: the camera mirrors tick at store cadence; redraw on any change while open.
    // U4: the aim overlay also re-derives on sky toggles/target swaps and on time scrubs —
    // getState() reads inside draw() can't see those without their own subscriptions.
    const unsub = useCameraStore.subscribe(requestRedraw);
    const unsubSky = useSkyStore.subscribe(requestRedraw);
    const unsubTime = useTimeStore.subscribe(requestRedraw);
    // MY PLACES (LAYERS batch): rows arrive async — repaint when they land or the toggle flips.
    const unsubPlaces = usePlacesMapStore.subscribe(requestRedraw);
    if (usePlacesMapStore.getState().onMap) usePlacesMapStore.getState().ensureLoaded();
    requestRedraw();

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", requestRedraw);
      unsub();
      unsubSky();
      unsubTime();
      unsubPlaces();
      cancelPress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="mw" role="dialog" aria-label="Full map" style={drag.style}>
      <DragGrip drag={drag} label="Move the map window" />
      <canvas ref={canvasRef} className="mw-canvas" />
      <div className="mw-top">
        <span className="mw-title">MAP</span>
        <button type="button" className="mw-btn" aria-label="Zoom in" onClick={() => zoomButtons.current(1)}>
          +
        </button>
        <button type="button" className="mw-btn" aria-label="Zoom out" onClick={() => zoomButtons.current(-1)}>
          −
        </button>
        <button type="button" className="mw-btn mw-close" onClick={() => setOpen(false)}>
          ✕ MINI-MAP
        </button>
      </div>
      <span className="mw-hint">DOUBLE-CLICK / LONG-PRESS — VIEW FROM HERE</span>
      <a
        className="mw-credit"
        href="https://www.esri.com/"
        target="_blank"
        rel="noreferrer noopener"
      >
        © Esri · Maxar · Earthstar Geographics · © CARTO · © OpenStreetMap contributors
      </a>
    </div>
  );
}
