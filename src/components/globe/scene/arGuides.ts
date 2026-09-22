import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ARGUIDES } from "../tuning";
import { projectCameraDir, type ScreenPoint } from "../../../lib/sky/screenProject";
import type { ArcWire } from "./dayArcs";

/**
 * AR GUIDES (owner order 2026-09-22 item 3): "much thicker and brighter — regardless of the CAM
 * slider — tracking guides for the sun, the moon and the current object in AR mode, and more
 * distinct bodies vs targets, so they are clear in the camera overlay". The use case: put the
 * rendered sun / moon on the REAL one in the feed and calibrate on that (a far object — no
 * parallax, the one reference a phone's eye position cannot spoil).
 *
 * WHY A DOM LAYER. Every GL guide (the sun / moon discs, the target reticle, the 1-px day arcs)
 * is painted on the canvas, which sits UNDER the camera `<video>` (z 1) — at the CAM end of the
 * 3D ↔ CAM slider the composite is 0.9·video + 0.1·scene and every guide loses 90 % of its
 * contrast. The scene's own crisp-over-the-feed instruments (sky names, geo labels) are DOM
 * layers at z 2 owned by scene modules (the `skyNames.ts` discipline); this one sits at z 3
 * (above the feed, above the labels, under the calibration pad at z 5) so it reads at full ink
 * whatever the slider says. GL lines are hardware 1-px (`linewidth` is a WebGL no-op); an SVG
 * stroke is any width, with a dark halo under it for contrast against a bright sky.
 *
 * WHAT IT DRAWS, per frame while AR is on: three MARKERS — the sun (a solid warm ring + a core
 * dot), the moon (a dashed cool ring — distinct from the sun at a glance), the tracked target (an
 * accent reticle: ring + four crosshair ticks, the reticle grammar the GL marker uses) — each with
 * a label; and the sun / moon DAY ARCS as 3-px SVG polylines (the same sampled directions the GL
 * arcs are built from — `dayArcs.arcs()` — so both agree to the pixel), the past half dimmer.
 * Projection is the ONE pinhole (`lib/sky/screenProject`): a body the GL impostor draws at pixel
 * (x, y) is ringed at (x, y). A marker behind the camera hides (the GOTO edge chips already point
 * off-frame); an arc breaks where it passes behind or off the screen.
 *
 * Scene-module contract: no store reads — the orchestrator passes everything through `update`.
 */
export interface ArGuidesHandle {
  update(ctx: {
    /** AR look-around is on (the /m AR chip) and the viewer stands in FPV. */
    enabled: boolean;
    camera: THREE.PerspectiveCamera;
    /** The viewport in CSS px (the canvas and the feed share it). */
    viewW: number;
    viewH: number;
    /** World-space unit directions FROM THE CAMERA (the moon and a finite target are camera-relative). */
    sun: THREE.Vector3;
    moon: THREE.Vector3;
    /** The tracked target — null when its SHOW toggle is off. */
    target: { dir: THREE.Vector3; label: string } | null;
    /** The sun / moon day arcs (empty when the SKY guides are off or the viewer is not in FPV). */
    arcs: readonly ArcWire[];
  }): void;
  /** DEV seam: what the layer last drew (the harness reads rendered geometry, not this). */
  debug(): { shown: boolean; markers: { id: string; x: number; y: number; inView: boolean }[]; arcPoints: number };
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

interface Marker {
  id: "sun" | "moon" | "target";
  el: HTMLDivElement;
  label: HTMLSpanElement;
  last: ScreenPoint;
  shown: boolean;
  text: string;
}

export function attachArGuides(): ArGuidesHandle {
  const layer = document.createElement("div");
  layer.className = "ar-guides";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:${ARGUIDES.zIndex};display:none;`;
  document.body.appendChild(layer);

  // The arcs: one SVG, a halo path under an ink path per (body × past/future).
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ar-guides__arcs");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;";
  layer.appendChild(svg);
  const arcPaths = new Map<string, { halo: SVGPathElement; ink: SVGPathElement }>();
  const arcPath = (key: string, color: string, alpha: number) => {
    let p = arcPaths.get(key);
    if (p) return p;
    const halo = document.createElementNS(SVG_NS, "path");
    halo.setAttribute("fill", "none");
    halo.setAttribute("stroke", tokens.bg);
    halo.setAttribute("stroke-opacity", String(ARGUIDES.haloAlpha));
    halo.setAttribute("stroke-width", String(ARGUIDES.arcWidthPx + 2 * ARGUIDES.haloPx));
    halo.setAttribute("stroke-linecap", "round");
    halo.setAttribute("stroke-linejoin", "round");
    const ink = document.createElementNS(SVG_NS, "path");
    ink.setAttribute("fill", "none");
    ink.setAttribute("stroke", color);
    ink.setAttribute("stroke-opacity", String(alpha));
    ink.setAttribute("stroke-width", String(ARGUIDES.arcWidthPx));
    ink.setAttribute("stroke-linecap", "round");
    ink.setAttribute("stroke-linejoin", "round");
    svg.appendChild(halo);
    svg.appendChild(ink);
    p = { halo, ink };
    arcPaths.set(key, p);
    return p;
  };

  // The dark halo under every stroke — the bg token at the halo alpha (contrast on a bright sky).
  const halo = `color-mix(in srgb, ${tokens.bg} ${Math.round(ARGUIDES.haloAlpha * 100)}%, transparent)`;
  const ringCss = (color: string, dashed: boolean) =>
    `position:absolute;left:0;top:0;width:${ARGUIDES.ringPx}px;height:${ARGUIDES.ringPx}px;` +
    `margin:${-ARGUIDES.ringPx / 2}px 0 0 ${-ARGUIDES.ringPx / 2}px;border-radius:50%;box-sizing:border-box;` +
    `border:${ARGUIDES.ringWidthPx}px ${dashed ? "dashed" : "solid"} ${color};` +
    `box-shadow:0 0 0 ${ARGUIDES.haloPx}px ${halo},inset 0 0 0 ${ARGUIDES.haloPx}px ${halo};`;
  const makeMarker = (id: Marker["id"], color: string, text: string): Marker => {
    const el = document.createElement("div");
    el.className = `ar-guide ar-guide--${id}`;
    el.dataset.body = id;
    el.style.cssText = "position:absolute;left:0;top:0;display:none;will-change:transform;";
    const ring = document.createElement("span");
    ring.style.cssText = ringCss(color, id === "moon");
    el.appendChild(ring);
    if (id === "sun") {
      // a core dot: the disc itself sits here
      const dot = document.createElement("span");
      dot.style.cssText =
        `position:absolute;left:0;top:0;width:${ARGUIDES.dotPx}px;height:${ARGUIDES.dotPx}px;` +
        `margin:${-ARGUIDES.dotPx / 2}px 0 0 ${-ARGUIDES.dotPx / 2}px;border-radius:50%;background:${color};` +
        `box-shadow:0 0 0 ${ARGUIDES.haloPx}px ${halo};`;
      el.appendChild(dot);
    }
    if (id === "target") {
      // the reticle: four crosshair ticks outside the ring (the GL reticle's own grammar)
      const r = ARGUIDES.ringPx / 2;
      const t = ARGUIDES.tickPx;
      const w = ARGUIDES.ringWidthPx;
      for (const [dx, dy, horiz] of [
        [0, -r - t, false],
        [0, r, false],
        [-r - t, 0, true],
        [r, 0, true],
      ] as const) {
        const tick = document.createElement("span");
        tick.style.cssText =
          `position:absolute;left:${dx - (horiz ? 0 : w / 2)}px;top:${dy - (horiz ? w / 2 : 0)}px;` +
          `width:${horiz ? t : w}px;height:${horiz ? w : t}px;background:${color};` +
          `box-shadow:0 0 0 ${ARGUIDES.haloPx}px ${halo};`;
        el.appendChild(tick);
      }
    }
    const label = document.createElement("span");
    // (classList, not `.className = "…"`: the mapWindowChrome discovery guard reads every
    // `.className = "…"` in scene/* as a mounted LAYER that must join the PiP hide list — the
    // layer here is `.ar-guides`, and this label is a child hidden with it.)
    label.classList.add("ar-guide__label");
    label.style.cssText =
      `position:absolute;left:0;top:${ARGUIDES.ringPx / 2 + ARGUIDES.tickPx + 4}px;transform:translateX(-50%);` +
      `white-space:nowrap;font:600 ${ARGUIDES.labelRem}rem var(--font-mono,monospace);letter-spacing:0.14em;` +
      `color:${color};text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg},0 1px 0 ${tokens.bg};`;
    label.textContent = text;
    el.appendChild(label);
    layer.appendChild(el);
    return { id, el, label, last: { x: 0, y: 0, inView: false, front: false }, shown: false, text };
  };
  const markers: Marker[] = [
    makeMarker("sun", tokens.sunGlow, "SUN"),
    makeMarker("moon", tokens.moonlight, "MOON"),
    makeMarker("target", tokens.accent, "TARGET"),
  ];

  const _c = new THREE.Vector3();
  const _p: ScreenPoint = { x: 0, y: 0, inView: false, front: false };
  let shown = false;
  let arcPoints = 0;
  const parts: string[] = [];

  const placeMarker = (m: Marker, dirW: THREE.Vector3 | null, text: string, cam: THREE.PerspectiveCamera, tanHalfV: number, W: number, H: number) => {
    if (!dirW) {
      if (m.shown) {
        m.el.style.display = "none";
        m.shown = false;
      }
      m.last.inView = false;
      return;
    }
    // a DIRECTION goes through the rotation part of matrixWorldInverse only (transformDirection)
    _c.copy(dirW).transformDirection(cam.matrixWorldInverse);
    projectCameraDir(_c.x, _c.y, _c.z, tanHalfV, cam.aspect, W, H, ARGUIDES.ringPx, m.last);
    if (!m.last.inView) {
      if (m.shown) {
        m.el.style.display = "none";
        m.shown = false;
      }
      return;
    }
    m.el.style.transform = `translate(${m.last.x.toFixed(1)}px, ${m.last.y.toFixed(1)}px)`;
    if (m.text !== text) {
      m.label.textContent = text;
      m.text = text;
    }
    if (!m.shown) {
      m.el.style.display = "block";
      m.shown = true;
    }
  };
  return {
    update({ enabled, camera, viewW, viewH, sun, moon, target, arcs }) {
      if (!enabled) {
        if (shown) {
          layer.style.display = "none";
          shown = false;
          for (const m of markers) {
            m.el.style.display = "none";
            m.shown = false;
          }
          for (const p of arcPaths.values()) {
            p.halo.setAttribute("d", "");
            p.ink.setAttribute("d", "");
          }
          arcPoints = 0;
        }
        return;
      }
      if (!shown) {
        layer.style.display = "block";
        shown = true;
      }
      const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      placeMarker(markers[0], sun, "SUN", camera, tanHalfV, viewW, viewH);
      placeMarker(markers[1], moon, "MOON", camera, tanHalfV, viewW, viewH);
      placeMarker(markers[2], target ? target.dir : null, target ? target.label : "TARGET", camera, tanHalfV, viewW, viewH);

      // The arcs — rebuilt as path strings per frame (≤ ~300 projections; a string, no layout).
      arcPoints = 0;
      const seen = new Set<string>();
      for (const w of arcs) {
        const color = w.body === "sun" ? tokens.sunGlow : tokens.moonlight;
        for (const half of ["past", "future"] as const) {
          const key = `${w.body}:${half}`;
          seen.add(key);
          const paths = arcPath(key, color, half === "past" ? ARGUIDES.arcAlphaPast : ARGUIDES.arcAlphaFuture);
          parts.length = 0;
          let pen = false;
          const n = w.dirs.length / 3;
          for (let i = 0; i < n; i++) {
            const isPast = w.t01[i] < w.now01;
            const wantHalf = half === "past" ? isPast : !isPast;
            const faded = w.fade[i] < ARGUIDES.arcMinFade;
            if (!wantHalf || faded) {
              pen = false;
              continue;
            }
            _c.set(w.dirs[i * 3], w.dirs[i * 3 + 1], w.dirs[i * 3 + 2]).transformDirection(camera.matrixWorldInverse);
            projectCameraDir(_c.x, _c.y, _c.z, tanHalfV, camera.aspect, viewW, viewH, ARGUIDES.arcMarginPx, _p);
            if (!_p.inView) {
              pen = false;
              continue;
            }
            parts.push(`${pen ? "L" : "M"}${_p.x.toFixed(1)} ${_p.y.toFixed(1)}`);
            pen = true;
            arcPoints++;
          }
          const d = parts.join("");
          paths.halo.setAttribute("d", d);
          paths.ink.setAttribute("d", d);
        }
      }
      for (const [key, p] of arcPaths) {
        if (!seen.has(key)) {
          p.halo.setAttribute("d", "");
          p.ink.setAttribute("d", "");
        }
      }
    },
    debug: () => ({
      shown,
      markers: markers.map((m) => ({ id: m.id, x: m.last.x, y: m.last.y, inView: m.shown })),
      arcPoints,
    }),
    dispose() {
      layer.remove();
    },
  };
}
