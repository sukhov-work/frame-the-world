import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { GRATICULE } from "../tuning";
import { glf } from "./glsl";

/**
 * Graticule — REAL lat/lon lines (not a sphere wireframe, which draws triangulation diagonals).
 * A hemisphere-discard shader draws only the near side, so it vanishes when the camera dives
 * inside. Tunables: GRATICULE.
 */
export interface GraticuleHandle {
  lines: THREE.LineSegments;
  /** RENDERING_QUALITY_PASS F7: opacity presence 0..1 (× GRATICULE.lineOpacity) — the orchestrator
   *  ramps it across an altitude band instead of hard-toggling `visible` on the dive to the city.
   *  Hides the mesh entirely at 0 so a fully-faded cage costs no draw. */
  setPresence(k: number): void;
  dispose(): void;
}

export function attachGraticule(
  scene: THREE.Scene,
  opts: { baseScale: THREE.Vector3 },
): GraticuleHandle {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(tokens.graticule) },
      uOpacity: { value: GRATICULE.lineOpacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vW);
        vec3 toCam = normalize(cameraPosition - vW);
        if (dot(n, toCam) < ${glf(GRATICULE.nearCutoff)}) discard;   // near hemisphere only -> auto-vanishes when inside
        gl_FragColor = vec4(uColor, uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const lines = new THREE.LineSegments(
    graticuleGeometry(GRATICULE.stepDeg, GRATICULE.segmentsPerLine),
    material,
  );
  lines.rotation.x = Math.PI / 2;
  lines.scale.copy(opts.baseScale).multiplyScalar(GRATICULE.lift);
  lines.raycast = () => {}; // don't let GlobeControls pivot/zoom-pick the decoration
  scene.add(lines);

  return {
    lines,
    setPresence(k) {
      const p = Math.min(1, Math.max(0, k));
      material.uniforms.uOpacity.value = GRATICULE.lineOpacity * p;
      lines.visible = p > 0.01; // fully faded → no draw
    },
    dispose() {
      lines.geometry.dispose();
      material.dispose();
      scene.remove(lines);
    },
  };
}

/**
 * True lat/lon graticule geometry (meridians + parallels) on a unit sphere in local +Y-up frame.
 * Returns LineSegments-ready positions (pairs of endpoints). The caller applies rotation.x = +PI/2
 * and the base scale so it aligns with the ellipsoid.
 */
function graticuleGeometry(stepDeg: number, seg: number): THREE.BufferGeometry {
  const p: number[] = [];
  const d = Math.PI / 180;
  // parallels (skip the poles)
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    const y = Math.sin(lat * d);
    const r = Math.cos(lat * d);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI;
      const a1 = ((i + 1) / seg) * 2 * Math.PI;
      p.push(r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1));
    }
  }
  // meridians
  for (let lon = 0; lon < 360; lon += stepDeg) {
    const a = lon * d;
    for (let i = 0; i < seg; i++) {
      const f0 = (-90 + (i / seg) * 180) * d;
      const f1 = (-90 + ((i + 1) / seg) * 180) * d;
      p.push(
        Math.cos(f0) * Math.cos(a), Math.sin(f0), Math.cos(f0) * Math.sin(a),
        Math.cos(f1) * Math.cos(a), Math.sin(f1), Math.cos(f1) * Math.sin(a),
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}
