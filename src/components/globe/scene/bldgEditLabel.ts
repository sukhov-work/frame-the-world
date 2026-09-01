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
  dispose(): void;
}

const _ndc = new THREE.Vector3();
const _vc = new THREE.Vector3();

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

  let lastLive = "";
  let lastOrig = "";
  let lastOp = "";

  return {
    update(world, origM, liveM, camera, opLine = null) {
      if (!world) {
        el.style.display = "none";
        return;
      }
      // geoLabels guard sequence: behind-camera cull first (project() alone mirrors points
      // behind the eye into the frame), then NDC → client px.
      _vc.copy(world).applyMatrix4(camera.matrixWorldInverse);
      if (_vc.z >= 0) {
        el.style.display = "none";
        return;
      }
      _ndc.copy(world).project(camera);
      const x = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
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
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
      el.style.display = "block";
    },
    dispose() {
      layer.remove();
    },
  };
}
