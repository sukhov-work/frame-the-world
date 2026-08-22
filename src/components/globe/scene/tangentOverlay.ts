import * as THREE from "three";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";

/**
 * The shared grammar of the ground-plane PLANNING overlays (audit #3 A1-8 → T35, 2026-08-22).
 *
 * `scene/aimCones` (the radar fan) and `scene/focalCone` (the planned-shot wedge) are one
 * instrument drawn twice: unit geometry on the anchor's ENU tangent plane, planetary magnitude
 * carried in the group matrix, depth-free alpha ink, an altitude presence band and an
 * exponential fade. The audit measured ≈47 duplicated lines between them, including a
 * byte-identical flat-material factory (`makeLineMaterial` / `makeFlatMaterial`).
 *
 * Extract-then-delegate (Gall): every body here is what the two modules shipped — this file adds
 * no behaviour. Both now call it, so a change to the grammar reaches both surfaces.
 */

/** Render order for the whole planning-overlay family (both modules used 9). */
export const OVERLAY_RENDER_ORDER = 9;

/**
 * Flat single-colour material with a runtime alpha. Depth-free by design: a metre-scale plane
 * cannot follow terrain relief, and a planning overlay reads THROUGH the world — which is also
 * what makes the flat-map MAP-INK behaviour automatic. Alpha-blended, NEVER additive (S6).
 * `DoubleSide` because the tangent plane is seen from either hemisphere of tilt.
 */
export function makeFlatOverlayMaterial(color: string): THREE.ShaderMaterial {
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

/** A matrix-driven tangent-plane root: hidden until the first seat, and `matrixAutoUpdate` off
 *  because `seatTangentGroup` writes `matrix` directly. */
export function makeTangentGroup(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.visible = false;
  group.matrixAutoUpdate = false;
  scene.add(group);
  return group;
}

/**
 * Altitude PRESENCE ramp, 1 → 0 across the shell-aware band: full below `fullAltM`, gone at or
 * above `topAltM`, linear between. Pure.
 */
export function presenceForAlt(alt: number, band: { fullAltM: number; topAltM: number }): number {
  return alt >= band.topAltM
    ? 0
    : alt <= band.fullAltM
      ? 1
      : 1 - (alt - band.fullAltM) / (band.topAltM - band.fullAltM);
}

/** One exponential step of the whole-overlay fade toward `want` (1 shown / 0 hidden). Pure. */
export function easeFade(fade: number, want: boolean, dtMs: number, tauMs: number): number {
  return fade + ((want ? 1 : 0) - fade) * (1 - Math.exp(-dtMs / tauMs));
}

// Module scratch — the overlays run one at a time inside the orchestrator's frame step, and
// allocating three Vector3 per seat per surface per frame is exactly the waste T38 is about.
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Seat a tangent-plane group: ECEF position at (lat, lon, groundM) and a basis of
 * east/north/up each scaled by `radius`, so UNIT geometry in the group renders at
 * `radius` metres. A NaN `groundM` (unseeded terrain) sits at the ellipsoid.
 */
export function seatTangentGroup(
  group: THREE.Group,
  latDeg: number,
  lonDeg: number,
  groundM: number,
  radius: number,
): void {
  const basis = enuBasis(latDeg, lonDeg);
  const [x, y, z] = geodeticToEcef(latDeg, lonDeg, Number.isNaN(groundM) ? 0 : groundM);
  _e.set(basis.east[0], basis.east[1], basis.east[2]).multiplyScalar(radius);
  _n.set(basis.north[0], basis.north[1], basis.north[2]).multiplyScalar(radius);
  _u.set(basis.up[0], basis.up[1], basis.up[2]).multiplyScalar(radius);
  group.matrix.makeBasis(_e, _n, _u).setPosition(_p.set(x, y, z));
}
