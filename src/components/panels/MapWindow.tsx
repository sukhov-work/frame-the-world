import { useEffect, useRef } from "react";
import { useCameraStore } from "../../store/camera";
import { useMiniMapStore } from "../../store/minimap";
import { lonLatToTileF, tileFToLonLat, zoomForMetersPerPx } from "../../lib/geo/slippy";
import { FPV, FRUSTUM, TILESETS } from "../globe/tuning";
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
const LONG_PRESS_MS = 500; // the ORCH long-press shape (tuning.ts ORCH.longPressMs twin)
const DRAG_CANCEL_PX = 6;
const TILE_CACHE_MAX = 300;

interface TileImg {
  img: HTMLImageElement;
  ok: boolean;
}

export default function MapWindow() {
  const open = useMiniMapStore((s) => s.mapWindowOpen);
  const setOpen = useMiniMapStore((s) => s.setMapWindowOpen);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The view state lives in refs — drawing is manual (rAF-scheduled), React only owns chrome.
  const view = useRef({ latDeg: 0, lonDeg: 0, z: 16 });
  const tiles = useRef<Map<string, TileImg>>(new Map());
  const rafPending = useRef(false);
  // The zoom chips need the effect-scoped zoomBy — bridged through a ref.
  const zoomButtons = useRef<(dz: number) => void>(() => {});

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
    view.current.z = cam.fpvHud
      ? Math.min(17, maxZ)
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
      const zDraw = Math.min(z + boost, srcMaxZ);
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
      const zDraw = Math.min(z + boost, srcMaxZ);
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
      const zDraw = Math.min(z + boost, srcMaxZ);
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
      view.current.z = Math.min(maxZNow, Math.max(MIN_Z, view.current.z + dz));
      requestRedraw();
    };
    zoomButtons.current = zoomBy;

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
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
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const dz = Math.round(Math.log2(d / pinchStartDist));
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", requestRedraw);
    // Live markers: the camera mirrors tick at store cadence; redraw on any change while open.
    const unsub = useCameraStore.subscribe(requestRedraw);
    requestRedraw();

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", requestRedraw);
      unsub();
      cancelPress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="mw" role="dialog" aria-label="Full map">
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
