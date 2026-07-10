import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ATMOSPHERE, SUN, WGS84_A } from "../tuning";
import { DITHER_GLSL, glf } from "./glsl";

/**
 * Atmosphere — physically-anchored limb glow. A screen-facing fresnel peaks at the SHELL's
 * silhouette, which from LEO sits visibly above the limb (a detached band with a dark gap — the
 * "crude halo"). Instead each fragment computes its view ray's closest-approach altitude above the
 * surface and applies exponential density falloff exp(-h/H): the glow is pinned to Earth's limb and
 * decays outward correctly at ANY camera altitude — a thin bright teal line (small scale height)
 * inside a broad Rayleigh-blue haze (large scale height), sun-modulated. Tunables: ATMOSPHERE.
 *
 * The glow is computed from the VIEW RAY, so it needs exactly one shell layer per pixel — and it
 * must be the NEAR one: GlobeControls fits camera.far tightly to the visible terrain (~3.9e6 m at
 * LEO), and the shell's far hemisphere beyond the limb sits PAST that plane (the same dynamic-far
 * clip that once hid the starfield). DoubleSide + a per-frame inside/outside uniform picks the
 * hemisphere that is guaranteed to be inside the frustum.
 */
export interface AtmosphereHandle {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  /** Per-frame: pick the visible hemisphere + thin the halo toward outer orbit. */
  update(camDistToCentre: number, alt: number): void;
  dispose(): void;
}

export function attachAtmosphere(
  scene: THREE.Scene,
  opts: { baseScale: THREE.Vector3 },
): AtmosphereHandle {
  const uniforms = {
    uColor: { value: new THREE.Color(tokens.atmosphere) },
    uColorDeep: { value: new THREE.Color(tokens.atmosphereDeep) },
    uSunDir: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uIntensity: { value: ATMOSPHERE.intensity },
    uRe: { value: WGS84_A }, // limb reference radius
    uH1: { value: ATMOSPHERE.lineScaleHeightM },
    uH2: { value: ATMOSPHERE.hazeScaleHeightM },
    uInside: { value: 0 }, // 1 when the camera is inside the shell (render back faces instead)
    // 0 at LEO (thick horizon haze is the point of the POV) -> 1 at outer orbit, where the same
    // physical scale heights read as a fat ring around the small disc: shrink widths and shift
    // the line toward Rayleigh blue — "distinct but elegant and subtle" (owner 2026-07-10).
    uOrbit: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uColorDeep;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      uniform float uRe;
      uniform float uH1;
      uniform float uH2;
      uniform float uInside;
      uniform float uOrbit;
      varying vec3 vW;
      void main() {
        // one shell layer per view ray: near (front) faces when outside, far (back) faces when inside
        if (uInside < 0.5 ? !gl_FrontFacing : gl_FrontFacing) discard;
        // Closest approach of the view ray to the planet centre (Earth is at the origin) ->
        // the ray's minimum altitude above the surface: exponential density falloff pins the glow
        // to the limb at ANY camera altitude (a fresnel rim would peak at the shell silhouette,
        // which from LEO detaches from the limb as a floating band).
        vec3 O = cameraPosition;
        vec3 D = normalize(vW - cameraPosition);
        float tc = max(-dot(O, D), 0.0);
        vec3 closest = O + D * tc;
        float dmin = length(closest);
        float h = max(dmin - uRe, 0.0);
        float hs = mix(1.0, ${glf(ATMOSPHERE.orbitWidthShrink)}, uOrbit);
        float g1 = exp(-h / (uH1 * hs));    // bright limb line
        float g2 = exp(-h / (uH2 * hs));    // broad haze
        float sun = clamp(dot(normalize(closest), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
        // rays that strike the planet get a faint blue air-wash (atmosphere between craft and
        // ground) instead of the limb line — the near shell is NOT depth-occluded by the disc
        float hitsGround = 1.0 - smoothstep(uRe - ${glf(ATMOSPHERE.groundBandBelowM)}, uRe + ${glf(ATMOSPHERE.groundBandAboveM)}, dmin);
        vec3 lineCol = mix(uColor, uColorDeep, ${glf(ATMOSPHERE.lineBlueBase)} + ${glf(ATMOSPHERE.lineBlueByOrbit)} * uOrbit); // bluer as we pull away
        vec3 limbCol = lineCol * g1 * ${glf(ATMOSPHERE.lineGain)} + uColorDeep * g2 * ${glf(ATMOSPHERE.hazeGain)};
        vec3 washCol = uColorDeep * ${glf(ATMOSPHERE.groundWashGain)};
        vec3 color = mix(limbCol, washCol, hitsGround) * uIntensity * mix(${glf(ATMOSPHERE.sunFloor)}, 1.0, sun);
        ${DITHER_GLSL}
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0); // additive multiplies by src alpha -> keep alpha 1
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, ATMOSPHERE.segments, ATMOSPHERE.segments),
    material,
  );
  mesh.scale.copy(opts.baseScale).multiplyScalar(ATMOSPHERE.shellScale); // shell high enough for the haze to decay inside it
  mesh.rotation.x = Math.PI / 2;
  mesh.raycast = () => {};
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    update(camDistToCentre, alt) {
      uniforms.uInside.value = camDistToCentre < mesh.scale.y ? 1 : 0; // scale.y = smallest shell axis
      // LEO keeps the thick horizon haze; pulling out to outer orbit thins the halo.
      uniforms.uOrbit.value = THREE.MathUtils.clamp(
        (alt - ATMOSPHERE.orbitStartAlt) / ATMOSPHERE.orbitSpanAlt,
        0,
        1,
      );
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
