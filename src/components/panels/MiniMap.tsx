import { useEffect, useRef, useState } from "react";
import { useMiniMapStore, type MiniMapPose, type MiniMapScene } from "../../store/minimap";
import { useCameraStore } from "../../store/camera";
import { useSkyStore } from "../../store/sky";
import { useTimeStore, sceneTimeMs } from "../../store/time";
import {
  fractureRunsBySkyline,
  sampleAimDay,
  splitAimRuns,
  type AimDay,
  type AimSample,
} from "../../lib/ephemeris/azSector";
import { usePlanStore } from "../../store/plan";
import { useUploadStore } from "../../store/upload";
import { aimAnchorFor } from "../../lib/geo/aimAnchor";
import { type RadarBandKey } from "../../lib/geo/radarBands";
import { sampleBins, skylineBinsFor } from "../../lib/geo/horizonProfile";
import { localDayWindow } from "../../lib/ephemeris/dayArc";
import { bodyTarget, targetAzAlt, type SkyTarget } from "../../lib/ephemeris/targets";
import { cssInk } from "../../lib/theme/cssInk";
import { tokens } from "../../lib/theme/tokens";
import { AIMCONES, FOCALCONE, PLAN } from "../globe/tuning";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { AimJoystick } from "../controls/Joystick";
import { drawRadarCanvas } from "./radarCanvas";
import "../../styles/mini-map.css";

/**
 * FPV mini-map (owner 2026-07-14) — a small square 2D vector patch (MINIMAP.patchM edge to
 * edge, ~200 m) always centred on the walked viewer, shown ONLY while FPV is active. North-up
 * with a heading cone at the centre — the precise-orientation aid for arrow-key walking.
 *
 * Pure consumer: scene/minimapFeed.ts projects roads/water/green/building footprints from the
 * shared MVT source into origin-local metres and mirrors them into store/minimap (features on
 * tile arrival / a 60 m walk; pose at ~20 Hz). This panel just pans a <canvas> between feature
 * rebuilds. Colours resolve from the tokens.css custom properties at draw time (the canvas
 * cannot read var() — the streetNames idiom). Top-level island (the S2 containing-block rule).
 *
 * Batch #4 S2 (owner item 9): the minimap gains the RADAR — the same concentric annular band
 * model as the GL fan + MapWindow twin (AIMCONES.band*), drawn in screen space around the
 * centred viewer (this surface is always north-up, so the DOM `.mm-n` chip IS the radar's
 * north marker). The FOV cone wears the focal-cone ink (one "planned shot" colour everywhere).
 */

/** CSS px of the square canvas (the CSS size — the buffer is DPR-scaled). 200 makes the card's
 *  border-box exactly 210px — the FPV HUD below pins the same width (owner 2026-08-14 ask 6).
 *  Must match `.mm-canvas` width/height in mini-map.css. */
const SIZE_PX = 200;
/** Radar outer-circle radius as a canvas fraction — N chip + scale text stay outside it. */
const RADAR_R_FRAC = 0.44;

type AimKey = RadarBandKey;

interface RadarBody {
  key: AimKey;
  color: string;
  emphasized: boolean;
  day: AimDay;
  past: readonly AimSample[][];
  future: readonly AimSample[][];
  nowAzDeg: number;
  nowAltDeg: number;
}

/** /m shell — body.m is server-rendered by the layout before any island mounts (the
 *  MapWindow idiom). The band model shifts inward on /m (owner batch #5 item 2); the radar
 *  RADIUS is not scaled here — the card itself is already CSS-shrunk to 124px on /m. */
const mobileShell = typeof document !== "undefined" && document.body.classList.contains("m");

// Per-body aim-day memo (the MapWindow idiom) — ~145 ephemeris calls per (target, day,
// anchor); the 20 Hz pose repaint only re-splits at now. Module singleton: the island mounts
// once per page and the memo stays warm across FPV sessions.
const aimCache = new Map<AimKey, { key: string; day: AimDay }>();

/** Radar bodies for the CURRENT stores — [] when the radar master is off or no anchor. */
function radarNow(): RadarBody[] {
  const cam = useCameraStore.getState();
  const skyNow = useSkyStore.getState();
  // T36: through the ONE shared ladder (lib/geo/aimAnchor). This surface mounts only inside
  // FPV, so rung 1 always wins and the result is identical to the `cam.camGeo` it replaces —
  // the point is that a future change to the ladder can no longer reach two surfaces and miss
  // this one. The null guard stays: it covers the frames before the first camGeo mirror, where
  // falling through to the view focus would draw a radar somewhere the walker is not.
  if (!skyNow.aimVisible || !cam.camGeo) return [];
  const upNow = useUploadStore.getState();
  const anchor = aimAnchorFor({
    fpvActive: true,
    camGeo: cam.camGeo,
    placement: (upNow.phase === "placed" && upNow.placement) || null,
    tempPin: cam.tempPin,
    focus: { latDeg: cam.focusLatDeg, lonDeg: cam.focusLonDeg },
  });
  const nowMs = sceneTimeMs();
  // Skyline sampler for occlusion GAPS (owner QA 2026-08-21 item 3) — this surface is
  // FPV-only and anchored at the walking eye, exactly where planFeed sweeps its profile;
  // the AIMCONES.skylineGuardM match keeps a stale far-away profile from lending its gaps.
  const plan = usePlanStore.getState();
  // THE gate since audit #3 A1-16 (lib/geo/horizonProfile.skylineBinsFor) — one rule on all
  // three radar surfaces, evidence floor included.
  const bins = skylineBinsFor({
    ready: plan.profileReady,
    bins: plan.profileBins,
    coverage: plan.profileCoverage,
    eye: plan.anchor && plan.anchor.kind !== "focus" ? plan.anchor : null,
    anchor,
    guardM: AIMCONES.skylineGuardM,
    minCoverage: PLAN.minCoverageForGaps,
  });
  const skyline: ((azDeg: number) => number) | null = bins
    ? (azDeg: number) => sampleBins(bins, azDeg)
    : null;
  const wanted: { key: AimKey; target: SkyTarget; color: string }[] = [];
  // UNFOLLOW/SHOW-off (2026-08-19): a hidden target draws no radar ink either.
  if (skyNow.aimTarget && skyNow.visible)
    wanted.push({ key: "target", target: skyNow.target, color: tokens.accent });
  if (skyNow.aimSun) wanted.push({ key: "sun", target: bodyTarget("sun"), color: tokens.sunGlow });
  if (skyNow.aimMoon)
    wanted.push({ key: "moon", target: bodyTarget("moon"), color: tokens.moonDial });
  return wanted.map(({ key, target, color }) => {
    const w0 = localDayWindow(nowMs, anchor.lonDeg);
    const memoKey = `${target.id}:${anchor.latDeg.toFixed(3)}:${anchor.lonDeg.toFixed(3)}:${w0.startMs}`;
    const hit = aimCache.get(key);
    const day =
      hit && hit.key === memoKey
        ? hit.day
        : sampleAimDay(target, nowMs, anchor.latDeg, anchor.lonDeg, AIMCONES.stepMin);
    if (!hit || hit.key !== memoKey) aimCache.set(key, { key: memoKey, day });
    const split = splitAimRuns(day, nowMs);
    const nowPos = targetAzAlt(target, nowMs, anchor.latDeg, anchor.lonDeg);
    return {
      key,
      color,
      emphasized: skyNow.aimFocus === key,
      day,
      // Occlusion GAPS (QA item 3): fills + rim arcs fracture behind the skyline; the
      // rise/set spokes (day.runs) and the direction line stay whole.
      past: fractureRunsBySkyline(split.past, skyline),
      future: fractureRunsBySkyline(split.future, skyline),
      nowAzDeg: nowPos.azDeg,
      nowAltDeg: nowPos.altDeg,
    };
  });
}

/** audit #3 A1-11 / T38: memoised at `lib/theme/cssInk` — this used to force a style recalc per
 *  token per paint (8 here × 20 Hz). The values are `:root` tokens; they cannot change without
 *  an explicit `invalidateCssInk()`. */
function cssVar(el: HTMLElement, name: string): string {
  return cssInk(el, name);
}

function draw(
  canvas: HTMLCanvasElement,
  scene: MiniMapScene,
  pose: MiniMapPose,
  patchM: number,
  radar: RadarBody[],
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = SIZE_PX * dpr;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ink = {
    bg: cssVar(canvas, "--color-bg"),
    green: cssVar(canvas, "--color-vec-green"),
    water: cssVar(canvas, "--color-vec-water"),
    building: cssVar(canvas, "--color-text-muted"),
    roadMajor: cssVar(canvas, "--color-vec-road-major"),
    roadMinor: cssVar(canvas, "--color-vec-road-minor"),
    bridge: cssVar(canvas, "--color-vec-bridge"),
    viewer: cssVar(canvas, "--color-accent"),
  };
  const pxPerM = px / patchM;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ink.bg;
  ctx.fillRect(0, 0, px, px);

  // World space: origin-local metres, viewer at the canvas centre, north up (y flips).
  ctx.setTransform(pxPerM, 0, 0, -pxPerM, px / 2 - pose.dxM * pxPerM, px / 2 + pose.dyM * pxPerM);

  const fillKind = (kind: "green" | "water" | "building", color: string, alpha: number) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (const f of scene.fills) {
      if (f.kind !== kind) continue;
      ctx.beginPath();
      ctx.moveTo(f.pts[0], f.pts[1]);
      for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i], f.pts[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
  };
  fillKind("green", ink.green, 0.65);
  fillKind("water", ink.water, 0.8);
  fillKind("building", ink.building, 0.5);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.95;
  const minWidthM = 1.4 / pxPerM; // every stroke stays readable at map scale
  for (const line of scene.lines) {
    ctx.strokeStyle =
      line.kind === "waterway"
        ? ink.water
        : line.bridge
          ? ink.bridge
          : line.widthM >= 10
            ? ink.roadMajor
            : ink.roadMinor;
    ctx.lineWidth = Math.max(line.widthM, minWidthM);
    ctx.beginPath();
    ctx.moveTo(line.pts[0], line.pts[1]);
    for (let i = 2; i < line.pts.length; i += 2) ctx.lineTo(line.pts[i], line.pts[i + 1]);
    ctx.stroke();
  }

  // ── S2 radar — screen space around the centred viewer; north-up (this surface never
  // rotates — the DOM `.mm-n` chip is its north marker). Same geometry model + inks as the
  // GL fan / MapWindow twin: annular band fills (emphasized body only), past/future rim at
  // the outer radius, body-colour rise/set spokes across the band, dials capped at the band
  // (target ray to the patch edge).
  ctx.setTransform(1, 0, 0, 1, px / 2, px / 2);
  if (radar.length > 0) {
    // THE canvas radar painter since audit #3 A1-8 / T35 (panels/radarCanvas) — this block and
    // the expanded chart's twin were ≈95 hand-maintained duplicated lines. This surface is
    // always centred (the transform above put the origin at the viewer) and always north-up,
    // and it doubles the fill wash because its map ink is dense at patch scale.
    drawRadarCanvas(
      ctx,
      {
        cx: 0,
        cy: 0,
        rotRad: 0,
        rBase: px * RADAR_R_FRAC,
        mobile: mobileShell,
        dpr,
        targetRayPx: px * 0.75,
        pastInk: cssVar(canvas, "--color-text-secondary"),
        fillAlphaK: 2,
      },
      radar.map((b) => ({
        key: b.key,
        color: b.color,
        emphasized: b.emphasized,
        past: b.past,
        future: b.future,
        spokeRuns: b.day.kind === "ring" ? [] : b.day.runs,
        nowAzDeg: b.nowAzDeg,
        nowAltDeg: b.nowAltDeg,
      })),
    );
  }

  // Viewer: the U3 FOV cone (width = the live horizontal FPV FOV, so it visibly narrows as
  // you pinch-zoom the lens) or the legacy wedge when no FOV is mirrored, + the centre dot.
  // S2: the cone wears the focal-cone ink — the ONE planned-shot colour on every surface.
  ctx.setTransform(1, 0, 0, 1, px / 2, px / 2);
  ctx.rotate((pose.headingDeg * Math.PI) / 180); // north-up map: heading rotates clockwise
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink.viewer;
  if (pose.coneDeg !== null) {
    const half = ((pose.coneDeg / 2) * Math.PI) / 180;
    const r = px * 0.42; // cone reach — a fixed fraction of the patch
    ctx.fillStyle = tokens.focalCone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // canvas angles: 0 = +x (east); "up" (the heading direction after the rotate) is −y ⇒ −π/2
    ctx.arc(0, 0, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.globalAlpha = FOCALCONE.fillAlpha * 2; // patch scale: dense map ink below
    ctx.fill();
    // Boundary LEGS only — stroking the closed wedge drew the far ARC too, which no other
    // surface does (owner batch #5 item 1 consistency pass); a touch wider + brighter than
    // the 1px radar lines, the GL 1.25× rule.
    ctx.globalAlpha = FOCALCONE.edgeAlpha;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = tokens.focalCone;
    ctx.beginPath();
    for (const a of [-Math.PI / 2 - half, -Math.PI / 2 + half]) {
      ctx.moveTo(0, 0);
      ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    ctx.stroke();
    ctx.fillStyle = ink.viewer;
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -11 * dpr);
    ctx.lineTo(5.5 * dpr, 4 * dpr);
    ctx.lineTo(-5.5 * dpr, 4 * dpr);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 2.6 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

export default function MiniMap() {
  const scene = useMiniMapStore((s) => s.scene);
  const pose = useMiniMapStore((s) => s.pose);
  const patchM = useMiniMapStore((s) => s.patchM);
  const setMapWindowOpen = useMiniMapStore((s) => s.setMapWindowOpen);
  const drag = usePanelDrag("mini-map");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // /m-only collapse (owner 2026-08-15c): the patch folds into a small puck at the right
  // edge, aligned with the button column. Open by default; the control is CSS-hidden on
  // desktop (.mm-collapse — body.m reveals it), so this state never fires there.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const doDraw = () => {
      if (canvasRef.current && scene && pose) draw(canvasRef.current, scene, pose, patchM, radarNow());
    };
    doDraw();
    // S2 radar: sky toggles/focus swaps + time scrubs repaint even while standing still
    // (the pose tick only covers movement) — the MapWindow subscription idiom.
    const unsubSky = useSkyStore.subscribe(doDraw);
    const unsubTime = useTimeStore.subscribe(doDraw);
    return () => {
      unsubSky();
      unsubTime();
    };
  }, [scene, pose, patchM]);

  if (!scene || !pose) return null;
  return (
    <div className={`mm${collapsed ? " mm--collapsed" : ""}`} style={drag.style}>
      <DragGrip drag={drag} label="Move the mini-map" tipPos="right" />
      <button
        type="button"
        className="mm-collapse"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand the mini-map" : "Collapse the mini-map"}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          /* Folded-map glyph (owner 2026-08-19: the ▣ puck read as a blank white square). */
          <svg className="mm-glyph" viewBox="0 0 20 20" aria-hidden="true">
            <path
              className="mm-glyph__fold"
              d="M3 5.5 L7.5 3.5 L12.5 5.5 L17 3.5 L17 14.5 L12.5 16.5 L7.5 14.5 L3 16.5 Z"
            />
            <path className="mm-glyph__seam" d="M7.5 3.5 L7.5 14.5 M12.5 5.5 L12.5 16.5" />
            <circle className="mm-glyph__dot" cx="10" cy="10" r="1.7" />
          </svg>
        ) : (
          "»"
        )}
      </button>
      {/* U3 (owner point 2): the patch itself is the tap target for the fullscreen map. */}
      <button
        type="button"
        className="mm-open"
        aria-label={`Mini-map — a ${patchM} metre square around your position, north up. Open the full map`}
        onClick={() => setMapWindowOpen(true)}
      >
        <canvas ref={canvasRef} className="mm-canvas" />
      </button>
      <span className="mm-n" aria-hidden="true">
        N
      </span>
      <span className="mm-scale" aria-hidden="true">
        {patchM} M
      </span>
      {/* AIM joystick (batch #4 item 11) — bottom-right of the card; in FPV (the minimap's
          only life) it steers the REAL camera heading/focal. Hidden with the collapse. */}
      {/* Owner batch #6 item 4: the /m aim stick moved above the WALK stick (MobileShell) —
          the card corner keeps it on DESKTOP only. */}
      {!collapsed && !mobileShell && <AimJoystick variant="minimap" />}
    </div>
  );
}
