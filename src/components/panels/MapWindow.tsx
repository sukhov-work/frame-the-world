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
import { AIMCONES, FOCALCONE, FPV, FRUSTUM, TILESETS } from "../globe/tuning";
import "../../styles/map-window.css";

/**
 * MapWindow (UPLIFT U3, owner point 2) — the fullscreen north-up photo-tile map, opened by
 * tapping the FPV mini-map. Desktop: a large centred window (the GUIDE precedent); /m: true
 * fullscreen (styles/map-window.css switches on body.m). A plain 2D canvas drawing the SAME
 * raster sources the ground drape uses (Esri World Imagery in satellite mode, CARTO dark
 * otherwise — TILESETS; Esri ToS: reuse-in-dev per UPLIFT_PLAN §4.2, licensed-source decision
 * rides U7), plus the viewer's position + live FOV cone and the temp pin.
 *
 * Interactions: drag pans · wheel / pinch / ± buttons zoom · two-finger TWIST rotates the
 * chart (batch #4 item 4b — view.rot, reset north-up per open; every transform runs through
 * ONE rotation-aware helper set) · double-click (desktop) or long-press (touch) = VIEW FROM
 * HERE (requestFpvJump — relocates a live FPV session, the MobilePlaces idiom) · ✕ / Esc
 * returns to the mini-map. Top-level island (the S2 containing-block rule) on both pages.
 */

const TILE_SRC_PX = 256; // XYZ source tiles are 256 px
const MIN_Z = 3;
const PINCH_SENS = 0.8; // continuous-pinch damping (batch #4 item 4): <1 = calmer than 1:1 log2
const LONG_PRESS_MS = 500; // the ORCH long-press shape (tuning.ts ORCH.longPressMs twin)
const DRAG_CANCEL_PX = 6;
const TILE_CACHE_MAX = 300;
// U4 aim overlay: chart-fixed radius (the FOV-cone idiom — the map is a chart, metres live on
// the globe module). The S2 annular bands (AIMCONES.bandSun/bandMoon/bandTarget) subdivide it.
const AIM_R_FRAC = 0.3;
const AIM_TAP_TOL_DEG = 8; // tap-promote angular tolerance around a direction line

/** The GL module's band allocation, read from the SAME tunables (one geometry model). */
const bandFor = (key: AimKey): readonly [number, number] =>
  key === "sun" ? AIMCONES.bandSun : key === "moon" ? AIMCONES.bandMoon : AIMCONES.bandTarget;

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
  // #1 PiP (batch #4 S3): /m-only live-3D hole — draw() clearRects the canvas under this
  // button's DOM box. body.m is set by the layout before any island mounts (stable per shell).
  const mobileShell =
    typeof document !== "undefined" && document.body.classList.contains("m");
  const pipRef = useRef<HTMLButtonElement>(null);
  // The view state lives in refs — drawing is manual (rAF-scheduled), React only owns chrome.
  // rot = chart bearing (rad, screen-CCW; 0 = north-up) — two-finger twist writes it (item 4b).
  const view = useRef({ latDeg: 0, lonDeg: 0, z: 16, rot: 0 });
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
    view.current.rot = 0; // every open starts north-up (the /m 2D-map boot rule)
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

    // ── ONE rotation-aware transform (batch #4 item 4b) ─────────────────────────────────────
    // Forward: screen = centre + R(rot)·(tile − c)·tilePx (tile-space: east +x, SOUTH +y, so
    // north is −y at rot 0). Inverse rides the transpose. Every consumer — draw, pan, point→
    // lat/lon, tap-promote — goes through this ONE stack (the four pre-S2 copies drifted).
    const xformNow = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sat = useCameraStore.getState().groundMode === "satellite";
      const srcMaxZ = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
      // Retina: fetch one level deeper, draw half-size (the slippy retina idiom).
      const boost = dpr >= 1.5 ? 1 : 0;
      const { z, latDeg, lonDeg, rot } = view.current;
      const zDraw = Math.min(Math.round(z) + boost, srcMaxZ); // integer tile level under a continuous z
      const tilePx = TILE_SRC_PX * dpr * 2 ** (z - zDraw); // device px per drawn tile
      const c = lonLatToTileF(lonDeg, latDeg, zDraw);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      return {
        dpr,
        sat,
        srcMaxZ,
        zDraw,
        tilePx,
        c,
        rot,
        /** Tile-space delta from centre → device-px delta from canvas centre. */
        fwd: (vx: number, vy: number): [number, number] => [
          (vx * cos - vy * sin) * tilePx,
          (vx * sin + vy * cos) * tilePx,
        ],
        /** Device-px delta from canvas centre → tile-space delta (Rᵀ). */
        inv: (dx: number, dy: number): [number, number] => [
          (dx * cos + dy * sin) / tilePx,
          (-dx * sin + dy * cos) / tilePx,
        ],
      };
    };

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
      const X = xformNow();
      const { zDraw, tilePx, c, rot } = X;
      const tpl = X.sat ? TILESETS.esriImageryUrl : TILESETS.cartoDarkUrl;
      const n = 2 ** zDraw;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = cssVar("--color-bg");
      ctx.fillRect(0, 0, w, h);
      // Tiles blit under the chart rotation about the canvas centre (item 4b); the visible
      // range must cover the ROTATED viewport — half-diagonal AABB, else corners clip.
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rot);
      const rTiles = Math.hypot(w, h) / 2 / tilePx;
      const x0 = Math.floor(c.x - rTiles);
      const x1 = Math.floor(c.x + rTiles);
      const y0 = Math.max(0, Math.floor(c.y - rTiles));
      const y1 = Math.min(n - 1, Math.floor(c.y + rTiles));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = tileFor(tpl, zDraw, tx, ty);
          if (!t.ok) continue;
          const px = (tx - c.x) * tilePx;
          const py = (ty - c.y) * tilePx;
          // North-up keeps the texel-snapping round; under rotation snapping is meaningless —
          // draw exact with a 1 px overdraw as the seam guard.
          if (rot === 0) {
            ctx.drawImage(t.img, Math.round(px), Math.round(py), Math.ceil(tilePx), Math.ceil(tilePx));
          } else {
            ctx.drawImage(t.img, px, py, tilePx + 1, tilePx + 1);
          }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Markers: geodetic → drawn-tile space → ROTATED device px (the one shared transform).
      const toPx = (lat: number, lon: number): [number, number] => {
        const p = lonLatToTileF(lon, lat, zDraw);
        const [dx, dy] = X.fwd(p.x - c.x, p.y - c.y);
        return [w / 2 + dx, h / 2 + dy];
      };
      const accent = cssVar("--color-accent");

      // ── U4 aim overlay — the GL aimCones module's canvas twin: same azSector helper, same
      // token colours (bridge import — sunGlow/moonlight have no CSS custom property), chart-
      // fixed radius. Split at scene time per paint (cheap); the day sampling is memoised.
      // Drawn BEFORE the pin/eye markers so position always reads on top.
      const skyNow = useSkyStore.getState();
      {
        const anchor = aimAnchorNow(camNow);
        const nowMs = sceneTimeMs();
        const rBase = Math.min(w, h) * AIM_R_FRAC;
        const [ax, ay] = toPx(anchor.latDeg, anchor.lonDeg);
        const pt = (azDeg: number, rr: number): [number, number] => {
          // Compass az (N=0, CW) → canvas angle (north −y, east +x) + the chart rotation.
          const th = ((azDeg - 90) * Math.PI) / 180 + rot;
          return [ax + rr * Math.cos(th), ay + rr * Math.sin(th)];
        };
        // ANNULAR band fill (S2): outer arc forward + inner arc reversed per run — the
        // fan-centre wedge is retired with the compact scaling (bands are fixed radii now).
        const sectorPath = (runs: readonly AimSample[][], rIn: number, rOut: number) => {
          ctx.beginPath();
          for (const run of runs) {
            if (run.length < 2) continue;
            ctx.moveTo(...pt(run[0].azDeg, rOut));
            for (let i = 1; i < run.length; i++) ctx.lineTo(...pt(run[i].azDeg, rOut));
            for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(...pt(run[i].azDeg, rIn));
            ctx.closePath();
          }
        };
        // Rim ARC only (no radial legs) — the past/future stroke must not draw the spokes:
        // those are the body's rise/set boundary and wear its identity colour (owner
        // 2026-08-18); a ring's closePath seam stays retired.
        const arcPath = (runs: readonly AimSample[][], r: number) => {
          ctx.beginPath();
          for (const run of runs) {
            if (run.length < 2) continue;
            const [px0, py0] = pt(run[0].azDeg, r);
            ctx.moveTo(px0, py0);
            for (let i = 1; i < run.length; i++) {
              const [x, y] = pt(run[i].azDeg, r);
              ctx.lineTo(x, y);
            }
          }
        };
        const radarBodies = aimBodiesNow(skyNow);
        for (const b of radarBodies) {
          const [kIn, kOut] = bandFor(b.key);
          const rIn = rBase * kIn;
          const rOut = rBase * kOut;
          const day = aimDayFor(b.key, b.target, anchor, nowMs);
          const split = splitAimRuns(day, nowMs);
          // Future ink is the BODY colour for sun/moon (owner item 17 — sunGlow / moonDial
          // against the inert past grey); the target band keeps the scrubber future-blue.
          // Same rule as the GL fan's bandFutureInk — b.color IS that body ink here.
          const futureInk = b.key === "target" ? tokens.timeFuture : b.color;
          if (b.emphasized) {
            // Glassy fills — past NEUTRAL grey (inert history, never a day/night claim —
            // owner 2026-08-18), future in futureInk.
            ctx.globalAlpha = AIMCONES.fillAlpha;
            ctx.fillStyle = tokens.textSecondary;
            sectorPath(split.past, rIn, rOut);
            ctx.fill();
            ctx.fillStyle = futureInk;
            sectorPath(split.future, rIn, rOut);
            ctx.fill();
          }
          ctx.globalAlpha = AIMCONES.rimAlpha;
          ctx.lineWidth = 1 * dpr;
          ctx.strokeStyle = tokens.textSecondary;
          arcPath(split.past, rOut);
          ctx.stroke();
          ctx.strokeStyle = futureInk;
          arcPath(split.future, rOut);
          ctx.stroke();
          // Rise/set radial spokes — BODY identity colour, spanning the band (inner→outer,
          // the GL module's S2 rule); a ring (circumpolar) has no rise/set → no spokes.
          if (day.kind !== "ring") {
            ctx.strokeStyle = b.color;
            ctx.beginPath();
            for (const run of day.runs) {
              if (run.length < 2) continue;
              for (const s of [run[0], run[run.length - 1]]) {
                ctx.moveTo(...pt(s.azDeg, rIn));
                ctx.lineTo(...pt(s.azDeg, rOut));
              }
            }
            ctx.stroke();
          }
          // Direction line at the CURRENT azimuth — body identity colour, pales below
          // horizon. Sun/moon dials cap EXACTLY at their own band's outer radius (owner S2);
          // the TARGET line is the tracking RAY (item 6) — it runs to the window edge.
          const nowPos = targetAzAlt(b.target, nowMs, anchor.latDeg, anchor.lonDeg);
          ctx.globalAlpha = nowPos.altDeg > 0 ? AIMCONES.lineAlpha : AIMCONES.lineAlphaDown;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          const rayLen = b.key === "target" ? Math.hypot(w, h) : rOut;
          ctx.lineTo(...pt(nowPos.azDeg, rayLen));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // Small `N` on the radar rim (owner addendum 2026-08-21) — the chart rotates now, so
        // the radar carries its own north; rides pt() and turns with the twist.
        if (radarBodies.length > 0) {
          const [nx, ny] = pt(0, rBase * AIMCONES.northOffsetK);
          ctx.globalAlpha = AIMCONES.rimAlpha;
          ctx.fillStyle = tokens.textSecondary;
          ctx.font = `600 ${Math.max(9 * dpr, rBase * AIMCONES.northSizeK)}px ${getComputedStyle(canvas).fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("N", nx, ny);
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
      // Focal cone (S2 "focal cone everywhere", replaces the hardcoded 0.22 hud-only cone):
      // in FPV it mirrors the live hud at the eye; outside FPV it draws the PLANNED view at
      // the radar anchor (gated by the RADAR master like the GL twin). Distinct focalCone
      // ink, near-zero fill, highlighted boundary, reach = the tracking ray (window edge on
      // the chart — the item-6 idiom); angles ride the chart rotation.
      {
        const hud = camNow.fpvHud;
        const geo = camNow.camGeo;
        const planned = camNow.plannedView;
        const cone = hud
          ? geo
            ? {
                at: geo,
                headingDeg: hud.headingDeg,
                halfRad: Math.atan(Math.tan((hud.fovDeg * Math.PI) / 360) * hud.aspect),
              }
            : null
          : planned && skyNow.aimVisible
            ? {
                at: aimAnchorNow(camNow),
                headingDeg: planned.headingDeg,
                halfRad: (planned.hFovDeg * Math.PI) / 360,
              }
            : null;
        if (cone) {
          const [px, py] = toPx(cone.at.latDeg, cone.at.lonDeg);
          const heading = (cone.headingDeg * Math.PI) / 180 + rot;
          const r = Math.hypot(w, h);
          const a0 = heading - cone.halfRad - Math.PI / 2;
          const a1 = heading + cone.halfRad - Math.PI / 2;
          ctx.fillStyle = tokens.focalCone;
          ctx.globalAlpha = FOCALCONE.fillAlpha;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.arc(px, py, r, a0, a1);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = FOCALCONE.edgeAlpha;
          ctx.lineWidth = 1 * dpr;
          ctx.strokeStyle = tokens.focalCone;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + r * Math.cos(a0), py + r * Math.sin(a0));
          ctx.moveTo(px, py);
          ctx.lineTo(px + r * Math.cos(a1), py + r * Math.sin(a1));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      const geo = camNow.camGeo;
      if (geo) {
        const [px, py] = toPx(geo.latDeg, geo.lonDeg);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cssVar("--color-bg");
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
      // #1 PiP (batch #4 S3, /m only): punch the live-3D hole LAST — the GL canvas renders the
      // FPV view beneath this window (body.m .mw drops its panel background; this canvas paints
      // the chart bg, so cleared pixels reach GL). The rect tracks the .mw-pip button's DOM box,
      // so CSS owns the placement and the ring + hole can never drift apart.
      const pip = pipRef.current;
      if (pip) {
        const pr = pip.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        ctx.clearRect(
          (pr.left - cr.left) * dpr,
          (pr.top - cr.top) * dpr,
          pr.width * dpr,
          pr.height * dpr,
        );
      }
    };

    // --- interactions ------------------------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pinchStartDist = 0;
    let pinchStartZ = 0;
    // Item 4b twist: the inter-pointer ANGLE drives view.rot alongside the continuous pinch
    // (own canvas — no ROTATE/ZOOM latch needed, both compose); the midpoint pans.
    let pinchStartAngle = 0;
    let pinchStartRot = 0;
    let pinchPrevMidX = 0;
    let pinchPrevMidY = 0;
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
      const X = xformNow();
      const [vx, vy] = X.inv(
        (clientX - rect.left - rect.width / 2) * X.dpr,
        (clientY - rect.top - rect.height / 2) * X.dpr,
      );
      const ll = tileFToLonLat(X.c.x + vx, X.c.y + vy, X.zDraw);
      return { latDeg: ll.latDeg, lonDeg: ll.lonDeg };
    };

    const viewFromHere = (clientX: number, clientY: number) => {
      const at = canvasPointToLatLon(clientX, clientY);
      // setOpen(false) unmounts this window before the browser synthesizes the trailing
      // click, which then retargets to whatever chrome sits underneath (the SceneActions
      // long-press trap, 2026-08-21 S2) — swallow ONE click at the document, short-fused.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(
        () => document.removeEventListener("click", swallow, { capture: true }),
        900,
      );
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
      const X = xformNow();
      const [vx, vy] = X.inv(dxCss * X.dpr, dyCss * X.dpr);
      const ll = tileFToLonLat(X.c.x - vx, X.c.y - vy, X.zDraw);
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
        pinchStartAngle = Math.atan2(b.y - a.y, b.x - a.x);
        pinchStartRot = view.current.rot;
        pinchPrevMidX = (a.x + b.x) / 2;
        pinchPrevMidY = (a.y + b.y) / 2;
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
        // nearest integer level scaled by 2^(z − zDraw). Item 4b composes the TWIST (angle →
        // chart rot, undamped 1:1 — fingers stay glued to the map) and the midpoint pan.
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const dz = Math.log2(d / pinchStartDist) * PINCH_SENS;
        const sat = useCameraStore.getState().groundMode === "satellite";
        const maxZNow = sat ? TILESETS.esriMaxLevel : TILESETS.cartoMaxLevel;
        const nextZ = Math.min(maxZNow, Math.max(MIN_Z, pinchStartZ + dz));
        const nextRot =
          pinchStartRot + (Math.atan2(b.y - a.y, b.x - a.x) - pinchStartAngle);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const changed = nextZ !== view.current.z || nextRot !== view.current.rot;
        view.current.z = nextZ;
        view.current.rot = nextRot;
        if (midX !== pinchPrevMidX || midY !== pinchPrevMidY) {
          panBy(midX - pinchPrevMidX, midY - pinchPrevMidY); // redraws
          pinchPrevMidX = midX;
          pinchPrevMidY = midY;
        } else if (changed) {
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
      // The ONE shared transform stack (item 4b — de-rotate the tap into tile space).
      const X = xformNow();
      const a = lonLatToTileF(anchor.lonDeg, anchor.latDeg, X.zDraw);
      const [adx, ady] = X.fwd(a.x - X.c.x, a.y - X.c.y);
      const dx = (e.clientX - rect.left) * dpr - (w / 2 + adx);
      const dy = (e.clientY - rect.top) * dpr - (h / 2 + ady);
      const dist = Math.hypot(dx, dy);
      // Compass azimuth of the tap around the anchor — inverse-rotated (tile north = −y).
      const [vx, vy] = X.inv(dx, dy);
      const azClick = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
      const rBase = Math.min(w, h) * AIM_R_FRAC;
      let best: { key: AimKey; dAz: number } | null = null;
      for (const b of aimBodiesNow(skyNow)) {
        if (b.emphasized) continue; // already the focus
        // The target's tracking ray runs to the window edge (batch #4 item 6) — its whole
        // length promotes; sun/moon promote along their capped band dial (S2 fixed radii).
        const reach = b.key === "target" ? Math.hypot(w, h) : rBase * bandFor(b.key)[1];
        if (dist < rBase * 0.08 || dist > reach * 1.05) continue;
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
      {/* #1 PiP (batch #4 S3): on /m the ✕ MINI-MAP button is REPLACED by a live-3D PiP — a
          transparent button over the canvas hole draw() clears; the GL FPV view (which persists
          under this window the whole time) shows through. Tap = close = back to FPV. */}
      {mobileShell && (
        <button
          type="button"
          ref={pipRef}
          className="mw-pip"
          aria-label="Live 3D view — tap to return to it"
          onClick={() => setOpen(false)}
        >
          <span className="mw-pip__tag">▲ FPV</span>
        </button>
      )}
      <div className="mw-top">
        <span className="mw-title">MAP</span>
        <button type="button" className="mw-btn" aria-label="Zoom in" onClick={() => zoomButtons.current(1)}>
          +
        </button>
        <button type="button" className="mw-btn" aria-label="Zoom out" onClick={() => zoomButtons.current(-1)}>
          −
        </button>
        {!mobileShell && (
          <button type="button" className="mw-btn mw-close" onClick={() => setOpen(false)}>
            ✕ MINI-MAP
          </button>
        )}
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
