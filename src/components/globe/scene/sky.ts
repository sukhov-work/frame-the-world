import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { ATMOSPHERE, SKY, WGS84_A, WGS84_B } from "../tuning";
import { DITHER_GLSL, glf } from "./glsl";

/**
 * Sky bodies — the sun and the moon at their ASTRONOMICALLY CORRECT positions (lib/ephemeris,
 * ADR D6), rendered as camera-anchored impostors so they survive GlobeControls' dynamic far plane:
 * each frame both bodies sit along their true direction at `camera.far × SKY.impostorFarFrac`,
 * scaled to their TRUE apparent angular size (sun ≈ 0.53°, moon ≈ 0.5° discs). Depth testing stays
 * ON, so the earth/terrain/buildings occlude them correctly at the horizon.
 *
 *  • Sun — additive HDR disc + tight shader halo; the wide soft glow comes from the bloom pass
 *    (the core is pushed over BLOOM.threshold via SKY.sunIntensity).
 *  • Moon — NASA LROC colour map on a sphere lit IN-SHADER by the real sun direction, so the
 *    phase (terminator on the lunar disc) is astronomically correct for free. A faint earthshine
 *    floor keeps the dark limb readable. Texture centre (lon 0 = near side) is aimed at Earth.
 *  • Moonlight — a cool DirectionalLight whose intensity follows the K&S-1991 phase curve
 *    (lib/ephemeris/moonlight: quarter ≈ 9% of full), so full-moon nights light the buildings
 *    and everything dimmer than gibbous reads honestly faint.
 *
 * Tunables: SKY. Colours: tokens.sunCore / sunGlow / moonlight (D14).
 */
export interface SkyHandle {
  sunMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  moonLight: THREE.DirectionalLight;
  /** Per-frame: re-anchor both impostors (camera + far plane move every frame). */
  update(ctx: {
    camera: THREE.PerspectiveCamera;
    /** Geodetic camera altitude (m) — the orchestrator's shared sample (tunables contract:
     *  modules never re-derive it). Drives the horizon fade band width. */
    alt: number;
    /** Unit direction TO the sun (world/ECEF). */
    sunDir: THREE.Vector3;
    /** Moon centre in world/ECEF metres (true position — direction is derived per-camera). */
    moonPos: THREE.Vector3;
    /** True apparent angular radii (rad) from the ephemeris distances. */
    sunAngRad: number;
    moonAngRad: number;
    /** K&S-1991 phase-scaled lunar intensity 0..1 (`lib/ephemeris/moonlight`, 1 = full moon) —
     *  drives the moonlight key. The orchestrator passes 0 while the shadow rig impersonates
     *  the moon (S5 source switch), so the night key is never doubled. */
    moonIntensity: number;
  }): void;
  /** Hover affordance (qol3): per-frame ABSOLUTE brightness lift — uIntensity/uBrightness are
   *  write-once uniforms, so the setter re-derives them from the SKY constants (idempotent;
   *  never compounds). k = eased 0..1 hover × ORCH.skyHoverGain, per body. */
  setHoverGlow(sunK: number, moonK: number): void;
  dispose(): void;
}

// Horizon occlusion — the impostors sit at a FAKE camera-anchored distance, so the depth buffer
// CANNOT occlude them against the planet (the limb is usually farther than the impostor; that was
// the "moon clipping through the earth" bug). Each fragment compares its view ray's elevation
// sine against the TRUE ellipsoid horizon (with dip) and fades across an ANGULAR band — so a
// setting body slices gradually behind the real horizon line at street level AND melts into the
// limb haze from orbit (owner 2026-07-15; the old closest-approach metric band collapsed to a
// razor cut at 0° elevation in FPV — see SKY.horizonFadeStreetDeg provenance).
//
// Space is ELLIPSOID-SCALED (x,y ÷ a, z ÷ b → the ellipsoid becomes the unit sphere): tangency
// is preserved exactly by the linear map, so the horizon is exact; angle distortion ≤ the
// flattening (~0.3%), invisible. The horizon terms (uHorizonUp = scaled-space up, uSinHor =
// horizon elevation sine incl. dip, uHorizonBandSin = band width) are computed per frame on the
// CPU in float64 — float32 shader math near r ≈ 1 would make the dip noisy at low eye heights.
export const HORIZON_FADE_GLSL = /* glsl */ `
      uniform vec3 uHorizonUp;
      uniform float uSinHor;
      uniform float uHorizonBandSin;
      float horizonFade(vec3 worldPos) {
        vec3 dW = worldPos - cameraPosition;
        vec3 Ds = normalize(vec3(dW.xy, dW.z * ${glf(WGS84_A / WGS84_B)}));
        return smoothstep(uSinHor, uSinHor + uHorizonBandSin, dot(Ds, uHorizonUp));
      }`;

/** Per-frame CPU horizon terms (float64) shared by every sky consumer of HORIZON_FADE_GLSL —
 *  scene/stars reuses it for the star/Milky-Way fade. Returns the scaled-space up + horizon sine. */
export function horizonTerms(
  camPos: { x: number; y: number; z: number },
  outUp: THREE.Vector3,
): number {
  const ox = camPos.x / WGS84_A;
  const oy = camPos.y / WGS84_A;
  const oz = camPos.z / WGS84_B;
  const r = Math.sqrt(ox * ox + oy * oy + oz * oz);
  outUp.set(ox / r, oy / r, oz / r);
  // Camera at/under the surface (transient during flights) → horizon at the horizontal.
  const rSafe = Math.max(r, 1);
  return -Math.sqrt(Math.max(rSafe * rSafe - 1, 0)) / rSafe;
}

/** Angular band width (sine units) for the current altitude: street slice ↔ orbit melt. */
export function horizonBandSin(altM: number): number {
  const t = THREE.MathUtils.smoothstep(altM, SKY.horizonFadeAltLoM, SKY.horizonFadeAltHiM);
  const deg = SKY.horizonFadeStreetDeg + (SKY.horizonFadeOrbitDeg - SKY.horizonFadeStreetDeg) * t;
  return Math.sin(THREE.MathUtils.degToRad(deg));
}

/**
 * CPU twin of the moon fragment's premultiplied two-arm mix (scalar albedo) — testable maths
 * for the qol3 day-moon fix (the horizonTerms/skyBudget twin precedent). Premultiplied output:
 * the blend is `src.rgb + dst.rgb·(1−src.a)`, so
 *  • day arm (uDaySky→1): alpha 0 + rgb = albedo·lit·brightness·dayGain — the disc can only ADD
 *    light over the sky. The old NormalBlending day arm lerped a DARK albedo colour over a
 *    BRIGHT sky at alpha = lit·gain, which DARKENED every mid-lit pixel (the owner's abrupt
 *    dark-crescent screenshots, 2026-08-14): a physically-backwards regime — the real daytime
 *    moon is sky + reflected sunlight, never a shadow on the sky.
 *  • night arm (uDaySky→0): alpha = fade + rgb = albedo·(earthshine + lit·brightness)·fade —
 *    byte-identical to the previous opaque star-occluding disc.
 */
export function moonDiscArms(
  lit: number,
  albedo: number,
  daySky: number,
  fade: number,
): { rgb: number; alpha: number } {
  const nightRgb = albedo * (SKY.moonEarthshine + lit * SKY.moonBrightness);
  const dayRgb = albedo * lit * SKY.moonBrightness * SKY.moonDayAddGain;
  const aNight = fade * (1 - daySky);
  return { rgb: nightRgb * aNight + dayRgb * daySky * fade, alpha: aNight };
}

const IMPOSTOR_VERTEX_GLSL = /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`;

export function attachSky(scene: THREE.Scene): SkyHandle {
  // Horizon-fade terms — ONE set of uniform holders shared by both impostor materials (same
  // {value} object references: one CPU write per frame updates both shaders).
  const uHorizonUp = { value: new THREE.Vector3(0, 0, 1) };
  const uSinHor = { value: 0 };
  const uHorizonBandSin = { value: horizonBandSin(0) };

  // --- Sun: billboarded plane, additive; UV distance drives core disc + exp halo. -------------
  const sunUniforms = {
    uCore: { value: new THREE.Color(tokens.sunCore) },
    uGlow: { value: new THREE.Color(tokens.sunGlow) },
    uIntensity: { value: SKY.sunIntensity as number }, // widened: setHoverGlow re-derives it
    uHorizonUp,
    uSinHor,
    uHorizonBandSin,
  };
  const sunMat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: IMPOSTOR_VERTEX_GLSL,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uGlow;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vW;
      ${HORIZON_FADE_GLSL}
      void main() {
        // r in disc-radius units: the plane spans sunGlowExtent disc radii.
        float r = length(vUv - 0.5) * 2.0 * ${glf(SKY.sunGlowExtent)};
        // limb-darkened core disc (real suns are ~30% dimmer at the limb)
        float disc = 1.0 - smoothstep(0.9, 1.0, r);
        float limb = mix(1.0, 0.7, smoothstep(0.0, 1.0, r));
        // tight shader halo — the WIDE glow is the bloom pass's job
        float halo = exp(-(max(r - 1.0, 0.0)) * 1.6) * ${glf(SKY.sunGlowGain)};
        vec3 color = (uCore * disc * limb * uIntensity + uGlow * halo) * horizonFade(vW);
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, 1.0); // additive: rgb carries everything
        #include <colorspace_fragment>
      }`,
  });
  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat);
  sunMesh.frustumCulled = false; // re-anchored every frame — stale bounds must never cull it
  sunMesh.raycast = () => {};
  scene.add(sunMesh);

  // --- Moon: sphere + LROC colour map, phase-lit by the real sun direction in-shader (scene
  //     lights would let the hemisphere fill wash out the dark limb). ---------------------------
  const moonTex = new THREE.TextureLoader().load(SKY.moonTexture);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moonUniforms = {
    uMap: { value: moonTex },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uBrightness: { value: SKY.moonBrightness as number }, // widened: setHoverGlow re-derives it
    uEarthshine: { value: SKY.moonEarthshine },
    // 0 night/space → 1 full daylight sky behind the disc (CPU per frame — see update()).
    uDaySky: { value: 0 },
    uHorizonUp,
    uSinHor,
    uHorizonBandSin,
  };
  const moonMat = new THREE.ShaderMaterial({
    uniforms: moonUniforms,
    // Transparent so the horizon fade can dissolve the disc; depthWrite stays ON — the moon BODY
    // occludes stars behind it regardless of phase. Fully-occluded OR day-sky-invisible fragments
    // discard instead (no depth hole punched into the starfield — and no depth wall that rejects
    // the additive sky dome drawn after the disc: the daytime dark-disc bug, owner 2026-08-14).
    //
    // PREMULTIPLIED custom blend (qol3, owner 2026-08-14 round 2): ONE / ONE_MINUS_SRC_ALPHA lets
    // ONE material be additive by day (alpha 0 — the disc can only ADD light, so no camera pose
    // can render a crescent DARKER than the sky) and opaque by night (alpha = fade — occludes
    // stars). See moonDiscArms above (the tested CPU twin). Do NOT revert to NormalBlending: the
    // day arm's darker-than-sky lerp was the abrupt dark-crescent bug.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNw;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vNw = normalize(mat3(modelMatrix) * normal); // uniform scale — no normal-matrix needed
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uBrightness;
      uniform float uEarthshine;
      uniform float uDaySky;
      varying vec2 vUv;
      varying vec3 vNw;
      varying vec3 vW;
      ${HORIZON_FADE_GLSL}
      void main() {
        float fade = horizonFade(vW);
        float lit = max(dot(normalize(vNw), normalize(uSunDir)), 0.0);
        // soften the terminator a touch (regolith scattering reads better than a hard lambert)
        lit = pow(lit, 0.8);
        vec3 albedo = texture2D(uMap, vUv).rgb;
        // Two premultiplied arms mixed by uDaySky (CPU twin: moonDiscArms — keep in lockstep).
        // NIGHT: the classic opaque star-occluding disc. DAY: additive-only reflected sunlight —
        // the dark side IS the sky, and no mid-lit pixel can ever be darker than the sky behind
        // it (the abrupt dark-crescent bug, owner 2026-08-14 round 2).
        vec3 nightRgb = albedo * (uEarthshine + lit * uBrightness);
        vec3 dayRgb = albedo * lit * uBrightness * ${glf(SKY.moonDayAddGain)};
        float aNight = fade * (1.0 - uDaySky);
        vec3 color = nightRgb * aNight + dayRgb * (uDaySky * fade);
        float alpha = aNight;
        // Invisible either way → write NO depth (dome safety: an unseen fragment must never
        // depth-reject the additive sky dome drawn after the disc).
        if (max(max(color.r, color.g), color.b) < ${glf(SKY.moonAlphaDiscard)} &&
            alpha < ${glf(SKY.moonAlphaDiscard)}) discard;
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, alpha);
        // NO tonemapping_fragment here: OutputPass tone-maps the whole buffer once — a second
        // in-shader pass crushed the earthshine limb to (7,6,2) black (the measured dark disc).
        // Every other sky shader already includes colorspace_fragment only.
        #include <colorspace_fragment>
      }`,
  });
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), moonMat);
  moonMesh.frustumCulled = false;
  moonMesh.raycast = () => {};
  scene.add(moonMesh);

  // --- Moonlight: cool fill that tracks the real moon direction + phase. -----------------------
  const moonLight = new THREE.DirectionalLight(
    new THREE.Color(tokens.moonlight),
    0, // set per-sample from the illuminated fraction
  );
  scene.add(moonLight);
  scene.add(moonLight.target);

  const _dir = new THREE.Vector3();
  const _pole = new THREE.Vector3(0, 0, 1); // ECEF +Z ≈ lunar north for a 0.5° disc
  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();

  return {
    sunMesh,
    moonMesh,
    moonLight,
    update({ camera, alt, sunDir, moonPos, sunAngRad, moonAngRad, moonIntensity }) {
      // Horizon fade terms (float64 on the CPU — see HORIZON_FADE_GLSL): shared uniform holders,
      // one write covers the sun AND moon materials.
      uSinHor.value = horizonTerms(camera.position, uHorizonUp.value);
      uHorizonBandSin.value = horizonBandSin(alt);

      // GlobeControls refits near/far per frame — looking AWAY from the earth pushes near out to
      // thousands of km (it fits the terrain BEHIND the camera), so the impostor distance must be
      // clamped into the live [near, far] band or the bodies near-plane-clip out of the sky.
      const d = THREE.MathUtils.clamp(
        camera.far * SKY.impostorFarFrac,
        camera.near * 1.2,
        camera.far * 0.95,
      );

      // Sun: parallax-free — anchor along the direction from the camera.
      sunMesh.position.copy(camera.position).addScaledVector(sunDir, d);
      // plane half-extent covers the halo: disc radius × glow extent
      sunMesh.scale.setScalar(d * Math.tan(sunAngRad) * SKY.sunGlowExtent);
      sunMesh.quaternion.copy(camera.quaternion); // billboard

      // Moon: true position is finite (≈384,000 km) — derive the per-camera direction, then
      // anchor inside the far plane at the true apparent size.
      _dir.copy(moonPos).sub(camera.position).normalize();
      moonMesh.position.copy(camera.position).addScaledVector(_dir, d);
      moonMesh.scale.setScalar(d * Math.tan(moonAngRad));
      // Aim the texture's near side (+X of the sphere UV seam layout) at Earth, north up.
      _x.copy(_dir).negate(); // sphere +X (map centre, lon 0 = near side) → toward Earth/camera side
      _y.copy(_pole).addScaledVector(_x, -_pole.dot(_x)).normalize(); // orthonormal "north"
      _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      moonMesh.quaternion.setFromRotationMatrix(_m);
      moonUniforms.uSunDir.value.copy(sunDir);
      // Day-sky visibility for the dark-limb alpha (dark-disc fix, owner 2026-08-14): the SAME
      // sun-elevation ramp the atmosphere's dayK uses × the sky-regime altitude fade — the
      // disc's alpha story always matches the sky the dome paints behind it. uHorizonUp was
      // just refreshed above (scaled-space up ≈ geodetic up to ~0.3%).
      const sinSun = sunDir.dot(uHorizonUp.value);
      const dayK = THREE.MathUtils.smoothstep(sinSun, ATMOSPHERE.skyDawnLo, ATMOSPHERE.skyDawnHi);
      const skyK = 1 - THREE.MathUtils.smoothstep(alt, ATMOSPHERE.skyFullAlt, ATMOSPHERE.skyGoneAlt);
      moonUniforms.uDaySky.value = dayK * skyK;

      // Moonlight follows the moon; intensity follows the K&S phase curve (quarter ≈ 9% of
      // full — physical relative scaling, calibrated at full moon by moonKeyIntensity).
      moonLight.position.copy(_dir).multiplyScalar(1e7);
      moonLight.target.position.set(0, 0, 0);
      moonLight.intensity = SKY.moonKeyIntensity * moonIntensity;
    },
    setHoverGlow(sunK, moonK) {
      sunUniforms.uIntensity.value = SKY.sunIntensity * (1 + sunK);
      moonUniforms.uBrightness.value = SKY.moonBrightness * (1 + moonK);
    },
    dispose() {
      moonTex.dispose();
      sunMesh.geometry.dispose();
      sunMat.dispose();
      moonMesh.geometry.dispose();
      moonMat.dispose();
      scene.remove(sunMesh);
      scene.remove(moonMesh);
      scene.remove(moonLight.target);
      scene.remove(moonLight);
    },
  };
}
