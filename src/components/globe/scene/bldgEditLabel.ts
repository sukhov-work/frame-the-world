import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";

/**
 * U8 — the mesh-pinned dual-height indicator (owner 2026-08-18: "show original height and
 * current dynamic height while extruding, pinned to mesh"). A DOM label layer owned by this
 * module — the geoLabels/skyNames discipline (NOT a React island: it re-anchors to the armed
 * building's roof EVERY FRAME during a drag via direct style writes; a zustand mirror at 60 fps
 * would churn, and GL sprite text would forfeit the design fonts).
 *
 * The orchestrator (stepBldgEdit) owns the anchor math (buildingTopWorld at the LIVE drag
 * scale) and calls `update` per frame; this module owns only the DOM + the world→screen
 * projection (the exact geoLabels guard sequence: behind-camera test → NDC → px).
 *
 * MESH SUITE MS2 (2026-09-02): an optional OP line above the two height lines — the live
 * numbers of the active gizmo op (metres east/north/up, the compass-sense yaw, the XZ scales)
 * while the chip carries every op's current vs original. Null/empty hides it, which is what
 * the U8 extrude op passes, so the label stays byte-identical there.
 *
 * MESH SUITE MS3 (2026-09-02): a second, muted HOVER note for an edited building nobody has
 * armed ("EDITED · shared · 34.3 m · was 24.5 m") — the owner's "subtle indication of original
 * vs overridden params" for the buildings the tint ladder marks. Same layer, same projection.
 */
export interface BldgEditLabelHandle {
  /** Place/refresh the label at the projected `world` point. `origM` = baked height,
   *  `liveM` = current dynamic height, `opLine` = the MS2 op readout (null = none).
   *  Pass `world = null` to hide. */
  update(
    world: THREE.Vector3 | null,
    origM: number,
    liveM: number,
    camera: THREE.PerspectiveCamera,
    opLine?: string | null,
  ): void;
  /** MS3: the hover note at the projected `world` point (`null` hides it). */
  hover(world: THREE.Vector3 | null, text: string, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

const _ndc = new THREE.Vector3();
const _vc = new THREE.Vector3();

/** geoLabels guard sequence: behind-camera cull first (project() alone mirrors points behind
 *  the eye into the frame), then NDC → client px. Null = not on screen. */
const projectPx = (
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
): { x: number; y: number } | null => {
  _vc.copy(world).applyMatrix4(camera.matrixWorldInverse);
  if (_vc.z >= 0) return null;
  _ndc.copy(world).project(camera);
  return {
    x: (_ndc.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_ndc.y * 0.5 + 0.5) * window.innerHeight,
  };
};

export function attachBldgEditLabel(): BldgEditLabelHandle {
  const layer = document.createElement("div");
  layer.className = "bldg-edit-label";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;";
  document.body.appendChild(layer);

  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:0;top:0;white-space:nowrap;display:none;" +
    "transform:translate(-50%,-130%);" + // hang just above the roof point
    "font:600 0.68rem var(--font-mono,monospace);letter-spacing:0.08em;" +
    `color:${tokens.accent};text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg};` +
    "text-align:center;";
  // (No class on the op line: it is a CHILD of the layer, and the /m PiP-hole guard —
  // test/styles/mapWindowChrome — takes every `.className = "…"` in scene/ for a new LAYER.)
  const opEl = document.createElement("div");
  opEl.style.cssText =
    "display:none;font:600 0.62rem var(--font-mono,monospace);letter-spacing:0.08em;" +
    `color:${tokens.accent};margin-bottom:1px;`;
  const liveEl = document.createElement("div");
  const origEl = document.createElement("div");
  origEl.style.cssText =
    "font:500 0.55rem var(--font-mono,monospace);letter-spacing:0.08em;" +
    `color:${tokens.textSecondary};margin-top:1px;`;
  el.appendChild(opEl);
  el.appendChild(liveEl);
  el.appendChild(origEl);
  layer.appendChild(el);

  // MS3: the hover note — muted, one line, same anchor rule (just above the roof point).
  const hovEl = document.createElement("div");
  hovEl.style.cssText =
    "position:absolute;left:0;top:0;white-space:nowrap;display:none;" +
    "transform:translate(-50%,-130%);" +
    "font:500 0.55rem var(--font-mono,monospace);letter-spacing:0.1em;" +
    `color:${tokens.textSecondary};text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg};` +
    "text-align:center;";
  layer.appendChild(hovEl);

  let lastLive = "";
  let lastOrig = "";
  let lastOp = "";
  let lastHover = "";

  return {
    update(world, origM, liveM, camera, opLine = null) {
      const px = world ? projectPx(world, camera) : null;
      if (!px) {
        el.style.display = "none";
        return;
      }
      const live = `${liveM.toFixed(1)} m`;
      const orig = `↳ was ${origM.toFixed(1)} m`;
      const op = opLine ?? "";
      if (live !== lastLive) {
        liveEl.textContent = live;
        lastLive = live;
      }
      if (orig !== lastOrig) {
        origEl.textContent = orig;
        lastOrig = orig;
      }
      if (op !== lastOp) {
        opEl.textContent = op;
        opEl.style.display = op ? "block" : "none";
        lastOp = op;
      }
      el.style.left = `${px.x.toFixed(1)}px`;
      el.style.top = `${px.y.toFixed(1)}px`;
      el.style.display = "block";
    },
    hover(world, text, camera) {
      const px = world ? projectPx(world, camera) : null;
      if (!px || !text) {
        hovEl.style.display = "none";
        return;
      }
      if (text !== lastHover) {
        hovEl.textContent = text;
        lastHover = text;
      }
      hovEl.style.left = `${px.x.toFixed(1)}px`;
      hovEl.style.top = `${px.y.toFixed(1)}px`;
      hovEl.style.display = "block";
    },
    dispose() {
      layer.remove();
    },
  };
}
