import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { SKY, WGS84_A } from "../tuning";
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
 *  • Moonlight — a cool DirectionalLight whose intensity follows the illuminated fraction, so
 *    full-moon nights light the buildings and new-moon nights go dark.
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
    /** Unit direction TO the sun (world/ECEF). */
    sunDir: THREE.Vector3;
    /** Moon centre in world/ECEF metres (true position — direction is derived per-camera). */
    moonPos: THREE.Vector3;
    /** True apparent angular radii (rad) from the ephemeris distances. */
    sunAngRad: number;
    moonAngRad: number;
    /** Illuminated fraction 0..1 — drives the moonlight intensity. */
    moonIllumination: number;
  }): void;
  dispose(): void;
}

// Horizon occlusion — the impostors sit at a FAKE camera-anchored distance, so the depth buffer
// CANNOT occlude them against the planet (the limb is usually farther than the impostor; that was
// the "moon clipping through the earth" bug). Instead each fragment tests its view ray against the
// earth analytically (same closest-approach math as scene/atmosphere) and fades across
// SKY.horizonFadeBandM — the body melts into the horizon haze instead of popping. `cameraPosition`
// is a three-provided fragment uniform. Rays whose closest approach lies behind the camera
// (tc <= 0) open away from the planet — nothing to occlude, e.g. a zenith moon at street level.
const HORIZON_FADE_GLSL = /* glsl */ `
      float horizonFade(vec3 worldPos) {
        vec3 D = normalize(worldPos - cameraPosition);
        float tc = -dot(cameraPosition, D);
        if (tc <= 0.0) return 1.0;
        float dmin = length(cameraPosition + D * tc);
        return smoothstep(0.0, ${glf(SKY.horizonFadeBandM)}, dmin - ${glf(WGS84_A)});
      }`;

const IMPOSTOR_VERTEX_GLSL = /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`;

export function attachSky(scene: THREE.Scene): SkyHandle {
  // --- Sun: billboarded plane, additive; UV distance drives core disc + exp halo. -------------
  const sunUniforms = {
    uCore: { value: new THREE.Color(tokens.sunCore) },
    uGlow: { value: new THREE.Color(tokens.sunGlow) },
    uIntensity: { value: SKY.sunIntensity },
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
    uBrightness: { value: SKY.moonBrightness },
    uEarthshine: { value: SKY.moonEarthshine },
  };
  const moonMat = new THREE.ShaderMaterial({
    uniforms: moonUniforms,
    // Transparent so the horizon fade can dissolve the disc; depthWrite stays ON — the moon BODY
    // occludes stars behind it regardless of phase. Fully-occluded fragments discard instead
    // (no depth hole punched into the starfield by an invisible disc).
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
      varying vec2 vUv;
      varying vec3 vNw;
      varying vec3 vW;
      ${HORIZON_FADE_GLSL}
      void main() {
        float fade = horizonFade(vW);
        if (fade < 0.004) discard; // behind the planet — write no depth, hide no stars
        vec3 albedo = texture2D(uMap, vUv).rgb;
        float lit = max(dot(normalize(vNw), normalize(uSunDir)), 0.0);
        // soften the terminator a touch (regolith scattering reads better than a hard lambert)
        lit = pow(lit, 0.8);
        vec3 color = albedo * (uEarthshine + lit * uBrightness);
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, fade);
        #include <tonemapping_fragment>
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
    update({ camera, sunDir, moonPos, sunAngRad, moonAngRad, moonIllumination }) {
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

      // Moonlight follows the moon; intensity follows the phase.
      moonLight.position.copy(_dir).multiplyScalar(1e7);
      moonLight.target.position.set(0, 0, 0);
      moonLight.intensity = SKY.moonKeyIntensity * moonIllumination;
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
