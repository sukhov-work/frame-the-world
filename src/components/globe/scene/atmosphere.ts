import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ATMOSPHERE, GOLDEN, SUN, WGS84_A, WGS84_B } from "../tuning";
import { DITHER_GLSL, glf } from "./glsl";
import { horizonTerms } from "./sky";

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
  /** RC24 — ULTRA's band tint for the horizon haze, and how strongly to pull toward it. `k` is
   *  the GROUND's own effective haze fraction (already gated + eased) times `ULTRA.domeTintK`,
   *  so the dome cannot tint on a schedule the ground is not on. `k = 0` is an exact no-op. */
  setUltraBand(k: number, col: THREE.Color): void;
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
    // True-horizon terms for the low-altitude sky regime (owner 2026-07-15 seam fix): scaled-
    // space up + horizon elevation sine (with dip), CPU float64 per frame — scene/sky.ts twin.
    uHorizonUp: { value: new THREE.Vector3(0, 0, 1) },
    uSinHor: { value: 0 },
    // 0 at LEO (thick horizon haze is the point of the POV) -> 1 at outer orbit, where the same
    // physical scale heights read as a fat ring around the small disc: shrink widths and shift
    // the line toward Rayleigh blue — "distinct but elegant and subtle" (owner 2026-07-10).
    uOrbit: { value: 0 },
    // ECLIPSE (2026-08-22k): daylight REMAINING, 0..1, pushed by the orchestrator's stepEclipse.
    // Exactly 1 whenever nothing is happening, so every multiply below is a provable no-op. The
    // sky dome is the single biggest lever for "the world went dark" — a total eclipse drops the
    // sky to roughly deep-twilight luminance, which is why the stars come out.
    //
    // Applied ONLY inside the low-altitude sky regime, never to the orbital limb model: the umbra
    // is a ~100 km spot on a 12,700 km planet, so dimming the whole lit limb from space would be a
    // far bigger lie than leaving it alone. Being inside the shadow is a street-level truth.
    uEclipse: { value: 1 },
    // --- RC24: the GOLDEN-HOUR DOME SEAM (ULTRA, 2026-08-25). -------------------------------
    // The one visible seam the ULTRA track shipped with. This dome tints its horizon haze from
    // GOLDEN's bell over solar elevation; ULTRA's ground tints its aerial perspective from a
    // FOUR-STOP BAND CURVE spanning 36° of solar elevation. Two different curves meeting at the
    // terrain/sky junction is a colour fork, right where the eye is looking at dusk.
    //
    // The coupling is deliberately not a second curve here: the orchestrator pushes the ground's
    // OWN EFFECTIVE, already-gated, already-eased haze value and the band tint it is using — the
    // same trick that keeps the ground and the buildings together (`FTW_AERIAL_GLSL` shares the
    // emitted function, not the intent). So the dome moves when the ground moves, through the
    // ground's altitude / flat-chart / dark-drape gates, and cannot drift onto its own schedule.
    //
    // OFF-STATE: `uFtwUltraK` is 0 whenever ULTRA is off, and `mix(x, y, 0.0)` is exactly `x`.
    uFtwUltraK: { value: 0 },
    uFtwUltraHaze: { value: new THREE.Color(0, 0, 0) },
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
      uniform vec3 uHorizonUp;
      uniform float uSinHor;
      uniform float uEclipse;
      uniform float uFtwUltraK;
      uniform vec3 uFtwUltraHaze;
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
          // Elevation ABOVE THE TRUE HORIZON (ellipsoid-scaled space; CPU float64 terms — the
          // scene/sky.ts twin). Anchoring the sky gradient + haze crest at the real horizon
          // (dip included) removes the full-width seam the geocentric-horizontal anchor drew
          // at 250–300 mm focal lengths (owner 2026-07-15).
          vec3 Ds = normalize(vec3(D.xy, D.z * ${glf(WGS84_A / WGS84_B)}));
          float sRel = dot(Ds, uHorizonUp) - uSinHor;
          float sunEl = dot(normalize(uSunDir), upC); // sun elevation sine at the camera
          float dayK = smoothstep(${glf(ATMOSPHERE.skyDawnLo)}, ${glf(ATMOSPHERE.skyDawnHi)}, sunEl)
                     * uEclipse;
          // S7 feedback ("white mess at strong tilt"): the horizon anchor is no longer pure
          // near-white skyHorizon — it mixes toward the blue skyDay (skyHorizonWhiteness), the
          // haze itself pulls blue (skyHazeBlue), the very-low-altitude haze is dimmed
          // (hazeLowAltK ramp — thin air column at drone heights), and the summed horizon budget
          // stays UNDER BLOOM.threshold so bloom never spreads it (unit-tested guard).
          // Zenith ramp rides smoothstep (zero slope at the horizon — C1): the old pow(x, 0.55)
          // had an INFINITE derivative at 0⁺, which read as a hard line at long focal lengths.
          vec3 horizonAnchor = mix(uSkyDay, uSkyHorizon, ${glf(ATMOSPHERE.skyHorizonWhiteness)});
          vec3 zenithCol = mix(horizonAnchor, uSkyDay,
            pow(smoothstep(0.0, 1.0, clamp(sRel, 0.0, 1.0)), ${glf(ATMOSPHERE.skyZenithPow)}));
          float hazeAltK = mix(${glf(ATMOSPHERE.hazeLowAltK)}, 1.0,
            smoothstep(${glf(ATMOSPHERE.hazeLowAltLo)}, ${glf(ATMOSPHERE.hazeLowAltHi)}, uCamAlt));
          // C1-smooth haze crest: softabs(sRel) rounds the meeting point of the two
          // exponentials (skyHazeSoft); the crest value stays exactly 1 (skyBudget guard).
          float hzG = sqrt(sRel * sRel + ${glf(ATMOSPHERE.skyHazeSoft ** 2)}) - ${glf(ATMOSPHERE.skyHazeSoft)};
          float hzTau = mix(${glf(ATMOSPHERE.skyHazeBelow)}, ${glf(ATMOSPHERE.skyHazeFalloff)},
            smoothstep(-${glf(ATMOSPHERE.skyHazeSoft)}, ${glf(ATMOSPHERE.skyHazeSoft)}, sRel));
          float haze = exp(-hzG / hzTau) * hazeAltK;
          float hGold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, sunEl)
                      * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, sunEl));
          vec3 hazeBase = mix(uSkyHorizon, uSkyDay, ${glf(ATMOSPHERE.skyHazeBlue)});
          vec3 hazeCol = mix(hazeBase, uGoldenCol * ${glf(GOLDEN.castGain)}, hGold * ${glf(ATMOSPHERE.skyGoldStrength)});
          // RC24 — the horizon haze is the band that MEETS the terrain, so it is the band that
          // has to agree with the ground's ULTRA tint. The zenith is left alone: it is far from
          // the junction, and pulling it would fight the skyBudget guard for no visible gain.
          hazeCol = mix(hazeCol, uFtwUltraHaze, uFtwUltraK);
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
    setUltraBand(k, col) {
      uniforms.uFtwUltraK.value = k;
      (uniforms.uFtwUltraHaze.value as THREE.Color).copy(col);
    },
    uniforms,
    update(camera, alt) {
      uniforms.uCamAlt.value = alt;
      uniforms.uSinHor.value = horizonTerms(camera.position, uniforms.uHorizonUp.value);
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
