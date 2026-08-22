import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { AIMCONES, FOCALCONE } from "../tuning";
import { easeSeatM } from "./aimCones";
// audit #3 A1-8 / T35: the flat material, the tangent-plane root + seat, the presence ramp and
// the fade step are the SHARED planning-overlay grammar — `scene/aimCones` carried a
// byte-identical copy of the material factory alone.
import {
  easeFade,
  makeFlatOverlayMaterial,
  makeTangentGroup,
  OVERLAY_RENDER_ORDER,
  presenceForAlt,
  seatTangentGroup,
} from "./tangentOverlay";

/**
 * Planned-shot FOCAL CONE on the main globe (owner batch #4 S2, 2026-08-21 — "focal cone
 * everywhere"): a ground wedge at the plan anchor spanning the planned HORIZONTAL fov around
 * the planned heading, reach = the target tracking ray (radar radius × AIMCONES.rayLenK).
 * Draws the camera store's plannedView OUTSIDE FPV only — inside FPV you are standing in the
 * cone, so the GL surface hides while the 2D twins (MapWindow, minimap) mirror the live hud.
 *
 * Same construction grammar as scene/aimCones: unit geometry on the anchor's ENU tangent
 * plane, planetary magnitude in the group matrix, depth-free alpha ink (renderOrder 9),
 * eased terrain seat, altitude presence band shared with the radar (one planning instrument).
 * "Very transparent, highlighted boundary" (owner): near-zero fill, the two boundary rays
 * carry the reading. Colour = tokens.focalCone — outside every radar ink family.
 */

export interface FocalConeHandle {
  group: THREE.Group;
  update(ctx: {
    /** The plan anchor (deg); null hides the cone. */
    anchor: { latDeg: number; lonDeg: number } | null;
    /** Geodetic camera altitude (m) — presence band + zoom-adaptive reach. */
    alt: number;
    /** Shell-aware presence band (m) — the AIMCONES band (one planning instrument). */
    band: { fullAltM: number; topAltM: number };
    /** False hides (FPV, radar master off, no planned view). */
    enabled: boolean;
    /** Planned view (compass heading + HORIZONTAL fov, deg); null hides. */
    headingDeg: number | null;
    hFovDeg: number | null;
    /** /m shell (orchestrator-pushed) — the reach rides the radar's mobile radius (item 2). */
    mobile: boolean;
    dtMs: number;
  }): void;
  dispose(): void;
}

const DEG = Math.PI / 180;
/** Wedge arc segments — sub-degree facets across the widest legal hFov. */
const SEGMENTS = 48;
/** Rebuild deadband (deg) — the joystick sweeps hFov continuously; sub-0.1° never shows. */
const HFOV_EPS_DEG = 0.1;

export function attachFocalCone(opts: {
  scene: THREE.Scene;
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
}): FocalConeHandle {
  const group = makeTangentGroup(opts.scene);

  const fillMat = makeFlatOverlayMaterial(tokens.focalCone);
  const edgeMat = makeFlatOverlayMaterial(tokens.focalCone);
  // audit #3 A1-10 / T38: the wedge's vertex COUNT is fixed — SEGMENTS triangles for the fill,
  // 2 rays × 2 triangles for the boundary — only the angles change. It used to dispose and
  // reallocate BOTH BufferGeometries on every rebuild, and since HFOV_EPS_DEG (0.1°) sits below
  // the aim stick's sweep rate, "every rebuild" meant every frame the stick was held: two GPU
  // buffer deletes + two uploads per frame, on the surface a phone is holding in one hand.
  // Allocate once, rewrite in place, flag needsUpdate — three re-uploads the same buffer.
  const fillPos = new Float32Array(SEGMENTS * 3 * 3);
  const edgePos = new Float32Array(2 * 2 * 3 * 3);
  const fillAttr = new THREE.BufferAttribute(fillPos, 3).setUsage(THREE.DynamicDrawUsage);
  const edgeAttr = new THREE.BufferAttribute(edgePos, 3).setUsage(THREE.DynamicDrawUsage);
  const fillGeo = new THREE.BufferGeometry().setAttribute("position", fillAttr);
  const edgeGeo = new THREE.BufferGeometry().setAttribute("position", edgeAttr);
  const fill = new THREE.Mesh(fillGeo, fillMat);
  const edges = new THREE.Mesh(edgeGeo, edgeMat);
  for (const obj of [fill, edges]) {
    obj.raycast = () => {};
    obj.frustumCulled = false; // unit geometry under a scaled matrix — bounds would lie
    obj.renderOrder = OVERLAY_RENDER_ORDER;
    group.add(obj);
  }

  let builtHFovDeg = NaN;
  let fade = 0;
  let groundM = Number.NaN;

  /** Rewrite the unit wedge for a horizontal fov: fill fan around +north (heading applies as
   *  rotation.z) + the two boundary rays as thin quads ("highlighted boundary"). Writes into
   *  the pre-allocated attributes — same vertex count at every hFov (audit #3 A1-10). */
  function rebuild(hFovDeg: number) {
    builtHFovDeg = hFovDeg;
    const half = (hFovDeg / 2) * DEG;
    let f = 0;
    const put = (arr: Float32Array, i: number, x: number, y: number) => {
      arr[i] = x;
      arr[i + 1] = y;
      arr[i + 2] = 0;
      return i + 3;
    };
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = -half + (2 * half * i) / SEGMENTS;
      const a1 = -half + (2 * half * (i + 1)) / SEGMENTS;
      f = put(fillPos, f, 0, 0);
      f = put(fillPos, f, Math.sin(a0), Math.cos(a0));
      f = put(fillPos, f, Math.sin(a1), Math.cos(a1));
    }
    const w = FOCALCONE.edgeHalfWidthK;
    let e = 0;
    for (const a of [-half, half]) {
      // Apex→reach quad along the boundary ray; the half-width is perpendicular to the ray.
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      const px = -dy * w;
      const py = dx * w;
      e = put(edgePos, e, px, py);
      e = put(edgePos, e, dx + px, dy + py);
      e = put(edgePos, e, dx - px, dy - py);
      e = put(edgePos, e, px, py);
      e = put(edgePos, e, dx - px, dy - py);
      e = put(edgePos, e, -px, -py);
    }
    fillAttr.needsUpdate = true;
    edgeAttr.needsUpdate = true;
  }

  return {
    group,
    update({ anchor, alt, band, enabled, headingDeg, hFovDeg, mobile, dtMs }) {
      const presence = presenceForAlt(alt, band);
      const want =
        enabled && anchor !== null && headingDeg !== null && hFovDeg !== null && presence > 0;
      fade = easeFade(fade, want, dtMs, FOCALCONE.fadeTauMs);
      if (fade < 0.01 && !want) {
        group.visible = false;
        return;
      }
      if (anchor && headingDeg !== null && hFovDeg !== null) {
        if (Number.isNaN(builtHFovDeg) || Math.abs(hFovDeg - builtHFovDeg) > HFOV_EPS_DEG) {
          rebuild(hFovDeg);
        }
        // Heading is a rotation on the shared tangent-plane group, never a rebuild.
        fill.rotation.z = -headingDeg * DEG;
        edges.rotation.z = -headingDeg * DEG;

        groundM = easeSeatM(
          groundM,
          opts.terrainHeightAt(anchor.latDeg, anchor.lonDeg),
          dtMs,
          FOCALCONE.fadeTauMs,
        );
        // Reach = the tracking ray: the radar's zoom-adaptive radius × rayLenK (item 6);
        // rides the radar's mobile shrink so the two instruments stay one system (item 2).
        const radius =
          Math.min(AIMCONES.radiusMaxM, Math.max(AIMCONES.radiusMinM, alt * AIMCONES.radiusAltK)) *
          (mobile ? AIMCONES.mobileRadiusK : 1) *
          AIMCONES.rayLenK;
        seatTangentGroup(group, anchor.latDeg, anchor.lonDeg, groundM, radius);
      }
      group.visible = true;
      const overlayA = fade * presence;
      fillMat.uniforms.uAlpha.value = FOCALCONE.fillAlpha * overlayA;
      edgeMat.uniforms.uAlpha.value = FOCALCONE.edgeAlpha * overlayA;
    },
    dispose() {
      fill.geometry.dispose();
      edges.geometry.dispose();
      fillMat.dispose();
      edgeMat.dispose();
      opts.scene.remove(group);
    },
  };
}
