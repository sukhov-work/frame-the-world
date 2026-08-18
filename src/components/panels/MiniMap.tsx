import { useEffect, useRef, useState } from "react";
import { useMiniMapStore, type MiniMapPose, type MiniMapScene } from "../../store/minimap";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import "../../styles/mini-map.css";

/**
 * FPV mini-map (owner 2026-07-14) — a small square 2D vector patch (MINIMAP.patchM edge to
 * edge, ~200 m) always centred on the walked viewer, shown ONLY while FPV is active. North-up
 * with a heading wedge at the centre — the precise-orientation aid for arrow-key walking.
 *
 * Pure consumer: scene/minimapFeed.ts projects roads/water/green/building footprints from the
 * shared MVT source into origin-local metres and mirrors them into store/minimap (features on
 * tile arrival / a 60 m walk; pose at ~20 Hz). This panel just pans a <canvas> between feature
 * rebuilds. Colours resolve from the tokens.css custom properties at draw time (the canvas
 * cannot read var() — the streetNames idiom). Top-level island (the S2 containing-block rule).
 */

/** CSS px of the square canvas (the CSS size — the buffer is DPR-scaled). 200 makes the card's
 *  border-box exactly 210px — the FPV HUD below pins the same width (owner 2026-08-14 ask 6).
 *  Must match `.mm-canvas` width/height in mini-map.css. */
const SIZE_PX = 200;

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function draw(
  canvas: HTMLCanvasElement,
  scene: MiniMapScene,
  pose: MiniMapPose,
  patchM: number,
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

  // Viewer: screen space again — the U3 FOV cone (width = the live horizontal FPV FOV, so it
  // visibly narrows as you pinch-zoom the lens) or the legacy wedge when no FOV is mirrored,
  // + the centre dot.
  ctx.setTransform(1, 0, 0, 1, px / 2, px / 2);
  ctx.rotate((pose.headingDeg * Math.PI) / 180); // north-up map: heading rotates clockwise
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink.viewer;
  if (pose.coneDeg !== null) {
    const half = ((pose.coneDeg / 2) * Math.PI) / 180;
    const r = px * 0.42; // cone reach — a fixed fraction of the patch
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // canvas angles: 0 = +x (east); "up" (the heading direction after the rotate) is −y ⇒ −π/2
    ctx.arc(0, 0, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = ink.viewer;
    ctx.stroke();
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
    if (canvasRef.current && scene && pose) draw(canvasRef.current, scene, pose, patchM);
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
        {collapsed ? "▣" : "»"}
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
    </div>
  );
}
