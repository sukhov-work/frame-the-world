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
 */
export interface BldgEditLabelHandle {
  /** Place/refresh the label at the projected `world` point. `origM` = baked height,
   *  `liveM` = current dynamic height. Pass `world = null` to hide. */
  update(
    world: THREE.Vector3 | null,
    origM: number,
    liveM: number,
    camera: THREE.PerspectiveCamera,
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
  const liveEl = document.createElement("div");
  const origEl = document.createElement("div");
  origEl.style.cssText =
    "font:500 0.55rem var(--font-mono,monospace);letter-spacing:0.08em;" +
    `color:${tokens.textSecondary};margin-top:1px;`;
  el.appendChild(liveEl);
  el.appendChild(origEl);
  layer.appendChild(el);

  let lastLive = "";
  let lastOrig = "";

  return {
    update(world, origM, liveM, camera) {
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
      if (live !== lastLive) {
        liveEl.textContent = live;
        lastLive = live;
      }
      if (orig !== lastOrig) {
        origEl.textContent = orig;
        lastOrig = orig;
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
