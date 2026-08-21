import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { AIMCONES, FOCALCONE } from "../tuning";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";
import { easeSeatM } from "./aimCones";

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

function makeFlatMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() {
        if (uAlpha < 0.003) discard;
        gl_FragColor = vec4(uColor, uAlpha);
        #include <colorspace_fragment>
      }`,
  });
}

export function attachFocalCone(opts: {
  scene: THREE.Scene;
  terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
}): FocalConeHandle {
  const group = new THREE.Group();
  group.visible = false;
  group.matrixAutoUpdate = false;
  opts.scene.add(group);

  const fillMat = makeFlatMaterial(tokens.focalCone);
  const edgeMat = makeFlatMaterial(tokens.focalCone);
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat);
  const edges = new THREE.Mesh(new THREE.BufferGeometry(), edgeMat);
  for (const obj of [fill, edges]) {
    obj.raycast = () => {};
    obj.frustumCulled = false; // unit geometry under a scaled matrix — bounds would lie
    obj.renderOrder = 9;
    group.add(obj);
  }

  let builtHFovDeg = NaN;
  let fade = 0;
  let groundM = Number.NaN;
  const _e = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _p = new THREE.Vector3();

  /** Rebuild the unit wedge for a horizontal fov: fill fan around +north (heading applies as
   *  rotation.z) + the two boundary rays as thin quads ("highlighted boundary"). */
  function rebuild(hFovDeg: number) {
    builtHFovDeg = hFovDeg;
    const half = (hFovDeg / 2) * DEG;
    const fillPos: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = -half + (2 * half * i) / SEGMENTS;
      const a1 = -half + (2 * half * (i + 1)) / SEGMENTS;
      fillPos.push(0, 0, 0, Math.sin(a0), Math.cos(a0), 0, Math.sin(a1), Math.cos(a1), 0);
    }
    const w = FOCALCONE.edgeHalfWidthK;
    const edgePos: number[] = [];
    for (const a of [-half, half]) {
      // Apex→reach quad along the boundary ray; the half-width is perpendicular to the ray.
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      const px = -dy * w;
      const py = dx * w;
      edgePos.push(px, py, 0, dx + px, dy + py, 0, dx - px, dy - py, 0);
      edgePos.push(px, py, 0, dx - px, dy - py, 0, -px, -py, 0);
    }
    fill.geometry.dispose();
    fill.geometry = new THREE.BufferGeometry();
    fill.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fillPos), 3));
    edges.geometry.dispose();
    edges.geometry = new THREE.BufferGeometry();
    edges.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgePos), 3));
  }

  return {
    group,
    update({ anchor, alt, band, enabled, headingDeg, hFovDeg, mobile, dtMs }) {
      const presence =
        alt >= band.topAltM
          ? 0
          : alt <= band.fullAltM
            ? 1
            : 1 - (alt - band.fullAltM) / (band.topAltM - band.fullAltM);
      const want =
        enabled && anchor !== null && headingDeg !== null && hFovDeg !== null && presence > 0;
      fade += ((want ? 1 : 0) - fade) * (1 - Math.exp(-dtMs / FOCALCONE.fadeTauMs));
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
        const basis = enuBasis(anchor.latDeg, anchor.lonDeg);
        const [x, y, z] = geodeticToEcef(
          anchor.latDeg,
          anchor.lonDeg,
          Number.isNaN(groundM) ? 0 : groundM,
        );
        _e.set(basis.east[0], basis.east[1], basis.east[2]).multiplyScalar(radius);
        _n.set(basis.north[0], basis.north[1], basis.north[2]).multiplyScalar(radius);
        _u.set(basis.up[0], basis.up[1], basis.up[2]).multiplyScalar(radius);
        group.matrix.makeBasis(_e, _n, _u).setPosition(_p.set(x, y, z));
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
