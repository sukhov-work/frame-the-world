import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ATMOSPHERE, GOLDEN, SUN, WGS84_A } from "../tuning";
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
  /** Per-frame: pick the visible hemisphere, thin the halo toward outer orbit, and below
   *  ATMOSPHERE.domeMaxAlt re-anchor the shell to the camera (sky-dome mode — the earth-centred
   *  shell would be far-plane-clipped at street level; the shader only uses ray DIRECTIONS, so
   *  the geometry swap is invisible). */
  update(camera: THREE.PerspectiveCamera, alt: number): void;
  dispose(): void;
}

// Chapman-obliquity saturation sines (S5 §Item 15 — the navy-night-sky root cause, see
// ATMOSPHERE.obliquityK): a grazing ray saturates at ~√(π·Re·H/2) of air; an up-looking ray at
// elevation sine s traverses only ~H/s. Below sinLimit = √(2H/(π·Re)) the two regimes meet.
const OBLIQ_SIN_LINE = Math.sqrt((2 * ATMOSPHERE.lineScaleHeightM) / (Math.PI * WGS84_A));
const OBLIQ_SIN_HAZE = Math.sqrt((2 * ATMOSPHERE.hazeScaleHeightM) / (Math.PI * WGS84_A));

export function attachAtmosphere(
  scene: THREE.Scene,
  opts: { baseScale: THREE.Vector3 },
): AtmosphereHandle {
  const uniforms = {
    uColor: { value: new THREE.Color(tokens.atmosphere) },
    uColorDeep: { value: new THREE.Color(tokens.atmosphereDeep) },
    uGoldenCol: { value: new THREE.Color(tokens.goldenHour) },
    uSkyDay: { value: new THREE.Color(tokens.skyDay) },
    uSkyHorizon: { value: new THREE.Color(tokens.skyHorizon) },
    uCamAlt: { value: 1e7 }, // camera altitude (m) — drives the low-altitude sky regime
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
      uniform vec3 uGoldenCol;
      uniform vec3 uSkyDay;
      uniform vec3 uSkyHorizon;
      uniform float uCamAlt;
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
        // Chapman obliquity (S5): exp(-h/H) alone weights a ray only by the density at its
        // closest approach — for UP-looking rays that point is the camera itself, so a zenith
        // ray rendered as bright as a grazing one (~30× the air) and the whole night sky
        // glowed navy at 20–350 km. Rays with their closest approach at the camera (sinEl > 0)
        // dim by sinLimit/max(sinEl, sinLimit); limb-passing rays (sinEl = 0) are untouched.
        float sinEl = max(dot(D, normalize(O)), 0.0);
        float pk1 = mix(1.0, ${glf(OBLIQ_SIN_LINE)} / max(sinEl, ${glf(OBLIQ_SIN_LINE)}), ${glf(ATMOSPHERE.obliquityK)});
        float pk2 = mix(1.0, ${glf(OBLIQ_SIN_HAZE)} / max(sinEl, ${glf(OBLIQ_SIN_HAZE)}), ${glf(ATMOSPHERE.obliquityK)});
        float g1 = exp(-h / (uH1 * hs)) * pk1;    // bright limb line
        float g2 = exp(-h / (uH2 * hs)) * pk2;    // broad haze
        float sun = clamp(dot(normalize(closest), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
        // rays that strike the planet get a faint blue air-wash (atmosphere between craft and
        // ground) instead of the limb line — the near shell is NOT depth-occluded by the disc
        float hitsGround = 1.0 - smoothstep(uRe - ${glf(ATMOSPHERE.groundBandBelowM)}, uRe + ${glf(ATMOSPHERE.groundBandAboveM)}, dmin);
        vec3 lineCol = mix(uColor, uColorDeep, ${glf(ATMOSPHERE.lineBlueBase)} + ${glf(ATMOSPHERE.lineBlueByOrbit)} * uOrbit); // bluer as we pull away
        vec3 limbCol = lineCol * g1 * ${glf(ATMOSPHERE.lineGain)} + uColorDeep * g2 * ${glf(ATMOSPHERE.hazeGain)};
        // golden-hour limb: warm the glow where the sun grazes the ray's closest-approach point
        // (2·sun−1 = sin of solar elevation there — same bell as the earth/ground grades)
        float gSin = 2.0 * sun - 1.0;
        float gold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, gSin)
                   * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, gSin));
        limbCol *= mix(vec3(1.0), uGoldenCol * ${glf(GOLDEN.castGain)}, gold * ${glf(GOLDEN.atmStrength)});
        vec3 washCol = uColorDeep * ${glf(ATMOSPHERE.groundWashGain)};
        vec3 color = mix(limbCol, washCol, hitsGround) * uIntensity * mix(${glf(ATMOSPHERE.sunFloor)}, 1.0, sun);
        // --- Low-altitude sky regime: the orbital limb model blends into a proper sky at city
        //     zooms — light-blue zenith, near-white horizon haze (aerial perspective over the
        //     distant terrain the dome overdraws), warmed through the golden band at dawn/dusk,
        //     black at night so the stars own it. -------------------------------------------------
        float skyK = 1.0 - smoothstep(${glf(ATMOSPHERE.skyFullAlt)}, ${glf(ATMOSPHERE.skyGoneAlt)}, uCamAlt);
        if (skyK > 0.001) {
          vec3 upC = normalize(O);
          float sinEl = dot(D, upC);                  // view-ray elevation sine at the camera
          float sunEl = dot(normalize(uSunDir), upC); // sun elevation sine at the camera
          float dayK = smoothstep(${glf(ATMOSPHERE.skyDawnLo)}, ${glf(ATMOSPHERE.skyDawnHi)}, sunEl);
          vec3 zenithCol = mix(uSkyHorizon, uSkyDay, pow(clamp(sinEl, 0.0, 1.0), ${glf(ATMOSPHERE.skyZenithPow)}));
          float haze = exp(-max(sinEl, 0.0) / ${glf(ATMOSPHERE.skyHazeFalloff)})
                     * exp(min(sinEl, 0.0) / ${glf(ATMOSPHERE.skyHazeBelow)});
          float hGold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, sunEl)
                      * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, sunEl));
          vec3 hazeCol = mix(uSkyHorizon, uGoldenCol * ${glf(GOLDEN.castGain)}, hGold * ${glf(ATMOSPHERE.skyGoldStrength)});
          vec3 skyCol = zenithCol * ${glf(ATMOSPHERE.skyDayGain)} * dayK
                      + hazeCol * haze * ${glf(ATMOSPHERE.skyHorizonGain)} * max(dayK, hGold);
          color = mix(color, skyCol, skyK);
        }
        ${DITHER_GLSL}
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0); // additive multiplies by src alpha -> keep alpha 1
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, ATMOSPHERE.segments, ATMOSPHERE.segments),
    material,
  );
  const shellScaleVec = opts.baseScale.clone().multiplyScalar(ATMOSPHERE.shellScale);
  mesh.scale.copy(shellScaleVec); // shell high enough for the haze to decay inside it
  mesh.rotation.x = Math.PI / 2;
  mesh.raycast = () => {};
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    update(camera, alt) {
      uniforms.uCamAlt.value = alt;
      // LEO keeps the thick horizon haze; pulling out to outer orbit thins the halo.
      uniforms.uOrbit.value = THREE.MathUtils.clamp(
        (alt - ATMOSPHERE.orbitStartAlt) / ATMOSPHERE.orbitSpanAlt,
        0,
        1,
      );
      if (alt < ATMOSPHERE.domeMaxAlt) {
        // Sky-dome mode: re-anchor the shell to the camera, sized inside the dynamic far plane.
        // The earth-centred shell's visible (far) hemisphere sits up to ~640 km overhead — past
        // GlobeControls' tightly-fitted far plane at street level. The shader shades by ray
        // DIRECTION only, so this swap changes nothing visually; the camera is always inside.
        mesh.position.copy(camera.position);
        mesh.scale.setScalar(camera.far * ATMOSPHERE.domeFarFrac);
        uniforms.uInside.value = 1;
      } else {
        mesh.position.set(0, 0, 0);
        mesh.scale.copy(shellScaleVec);
        uniforms.uInside.value = camera.position.length() < mesh.scale.y ? 1 : 0; // scale.y = smallest shell axis
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
