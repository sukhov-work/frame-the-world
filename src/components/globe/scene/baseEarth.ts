import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { EARTH, SUN } from "../tuning";
import { DITHER_GLSL, glf } from "./glsl";

/**
 * Base ellipsoid — the orbit instrument. NASA Blue Marble colour graded toward the palette
 * (organic geology, stylized tone per C2), elevation ramp + normal relief, VIIRS night lights,
 * and in-shader day-side limb scattering so the disc melts into the halo.
 *
 * Colour maps are sRGB (real imagery); mask/elevation/normal stay DATA (NoColorSpace — an sRGB
 * tag on data decode-darkens it; that was the original near-black bug). All tunables: EARTH.
 */
export interface BaseEarthHandle {
  mesh: THREE.Mesh;
  /** Runtime-tunable grade uniforms (exposed on __globe in DEV). */
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

export function attachBaseEarth(
  scene: THREE.Scene,
  opts: { baseScale: THREE.Vector3; maxAniso: number },
): BaseEarthHandle {
  const loader = new THREE.TextureLoader();
  const landMaskTex = loader.load(EARTH.textures.landMask);
  const elevationTex = loader.load(EARTH.textures.elevation);
  const normalTex = loader.load(EARTH.textures.normal);
  const colorTex = loader.load(EARTH.textures.color);
  const nightTex = loader.load(EARTH.textures.night);
  const allTex = [landMaskTex, elevationTex, normalTex, colorTex, nightTex];
  for (const t of allTex) {
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = opts.maxAniso; // crisp coasts + relief at the grazing angles a LEO POV lives at
  }
  landMaskTex.colorSpace = THREE.NoColorSpace;
  elevationTex.colorSpace = THREE.NoColorSpace;
  normalTex.colorSpace = THREE.NoColorSpace;
  colorTex.colorSpace = THREE.SRGBColorSpace;
  nightTex.colorSpace = THREE.SRGBColorSpace;

  const uniforms = {
    uLandMask: { value: landMaskTex },
    uElevation: { value: elevationTex },
    uNormal: { value: normalTex },
    uColor: { value: colorTex },
    uNight: { value: nightTex },
    uWater: { value: new THREE.Color(tokens.water) }, // THREE.Color => LINEAR uniform
    uLand: { value: new THREE.Color(tokens.land) },
    uLandHi: { value: new THREE.Color(tokens.landHi) },
    uPeak: { value: new THREE.Color(tokens.peak) },
    uCityLights: { value: new THREE.Color(tokens.cityLights) },
    uAtmTint: { value: new THREE.Color(tokens.atmosphereDeep) },
    uSunDir: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uMoonDir: { value: new THREE.Vector3(0, 0, 1) },
    uMoonGlow: { value: 0 }, // SKY.moonSceneGlow × illuminated fraction (per ephemeris sample)
    uMoonCol: { value: new THREE.Color(tokens.moonlight) },
    uNightFloor: { value: EARTH.nightFloor },
    uRelief: { value: EARTH.relief },
    uOrganic: { value: EARTH.organic },
    uSat: { value: EARTH.sat },
    uGain: { value: EARTH.gain },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz;                       // globe centred at origin -> outward direction
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLandMask;
      uniform sampler2D uElevation;
      uniform sampler2D uNormal;
      uniform sampler2D uColor;
      uniform sampler2D uNight;
      uniform vec3 uWater, uLand, uLandHi, uPeak, uCityLights, uAtmTint, uSunDir;
      uniform vec3 uMoonDir, uMoonCol;
      uniform float uMoonGlow;
      uniform float uNightFloor;
      uniform float uRelief;
      uniform float uOrganic;
      uniform float uSat;
      uniform float uGain;
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        float mask = texture2D(uLandMask, vUv).r;   // GPU-filtered 0..1 across coasts
        float elev = texture2D(uElevation, vUv).r;  // elevation, 0 over ocean
        float land = smoothstep(${glf(EARTH.coastBand[0])}, ${glf(EARTH.coastBand[1])}, mask);
        // Stylized duotone ramp (the palette skeleton): water -> land -> landHi -> peak.
        vec3 landCol = mix(uLand, uLandHi, smoothstep(${glf(EARTH.landRamp[0])}, ${glf(EARTH.landRamp[1])}, elev));
        landCol = mix(landCol, uPeak, smoothstep(${glf(EARTH.peakRamp[0])}, ${glf(EARTH.peakRamp[1])}, elev));
        vec3 duo = mix(uWater, landCol, land);
        // Organic layer: NASA Blue Marble (topo+bathy) — partially desaturated + darkened so deserts,
        // forests, ice and ocean depth READ geographically without going semi-realistic (C2).
        vec3 organic = texture2D(uColor, vUv).rgb;
        float oLum = dot(organic, vec3(0.2126, 0.7152, 0.0722));
        organic = mix(vec3(oLum), organic, uSat) * uGain;
        vec3 albedo = mix(duo, organic, uOrganic);
        // Tangent-space normal map -> lit 3D relief. Build a tangent frame from the ECEF outward normal
        // (guard the pole where the default 'up' aligns with N). Relief only on land (ocean ~ flat).
        vec3 N = normalize(vDir);
        vec3 up = abs(N.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(up, N));
        vec3 B = cross(N, T);
        vec3 nT = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        nT.xy *= uRelief * land;
        vec3 Np = normalize(T * nT.x + B * nT.y + N * nT.z);
        // half-lambert off the relief normal; night floor keeps the map readable on the unlit side
        float wrap = dot(Np, normalize(uSunDir)) * 0.5 + 0.5;
        float shade = mix(uNightFloor, 1.0, wrap * wrap);
        vec3 color = albedo * shade;
        // Geographically correct night-side city lights (VIIRS). li^2 kills haze, keeps real cities.
        float night = 1.0 - smoothstep(${glf(EARTH.nightBand[0])}, ${glf(EARTH.nightBand[1])}, wrap);
        float li = dot(texture2D(uNight, vUv).rgb, vec3(0.333));
        color += uCityLights * (li * li * ${glf(EARTH.cityLightGain)}) * night * land;
        // Cool moonlight lifts the dark side by lunar phase (astronomically-driven, like the sun).
        color += albedo * uMoonCol * (max(dot(Np, normalize(uMoonDir)), 0.0) * uMoonGlow * night);
        // In-shader limb scattering (day side): the disc brightens toward the grazing edge so the
        // sphere melts into the halo instead of meeting a stuck-on ring.
        float rim = pow(1.0 - max(dot(normalize(cameraPosition - vDir), N), 0.0), ${glf(EARTH.rimPow)});
        color += uAtmTint * rim * ${glf(EARTH.rimGain)} * wrap;
        ${DITHER_GLSL}
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Sit the stylized base ~1.9 km BELOW the WGS84 surface (EARTH.shrink, applied by the caller's
  // baseScale) so the refining imagery ground (drawn AT exact WGS84) always renders cleanly in
  // front of it. polygonOffset keeps buildings above it before imagery loads.
  material.polygonOffset = true;
  material.polygonOffsetFactor = EARTH.polygonOffset;
  material.polygonOffsetUnits = EARTH.polygonOffset;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, EARTH.segments, EARTH.segments),
    material,
  );
  mesh.scale.copy(opts.baseScale);
  mesh.rotation.x = Math.PI / 2; // sphere UV poles (+Y) -> ECEF +Z
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    dispose() {
      for (const t of allTex) t.dispose();
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
