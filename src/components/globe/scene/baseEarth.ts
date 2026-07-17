import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { extractRedChannel } from "../../../lib/textures/redChannel";
import { EARTH, GOLDEN, SUN } from "../tuning";
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
  opts: { baseScale: THREE.Vector3; maxAniso: number; maxTextureSize: number },
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
    uLandMask: { value: landMaskTex as THREE.Texture }, // widened — the 8k swap is a DataTexture
    uElevation: { value: elevationTex },
    uNormal: { value: normalTex },
    uColor: { value: colorTex },
    uNight: { value: nightTex as THREE.Texture }, // widened — the 8k swap is a DataTexture
    uWater: { value: new THREE.Color(tokens.water) }, // THREE.Color => LINEAR uniform
    uLand: { value: new THREE.Color(tokens.land) },
    uLandHi: { value: new THREE.Color(tokens.landHi) },
    uPeak: { value: new THREE.Color(tokens.peak) },
    uCityLights: { value: new THREE.Color(tokens.cityLights) },
    uAtmTint: { value: new THREE.Color(tokens.atmosphereDeep) },
    uGoldenCol: { value: new THREE.Color(tokens.goldenHour) },
    uSunDir: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uMoonDir: { value: new THREE.Vector3(0, 0, 1) },
    uMoonGlow: { value: 0 }, // SKY.moonSceneGlow × K&S phase intensity (per ephemeris sample)
    // City-lights linearization exponent: the boot texture is sRGB (hardware-decoded → 1.0);
    // the 8k Black Marble swaps in as RAW gamma-encoded R8 data (no single-channel sRGB format
    // exists in WebGL2), so the shader linearizes with EARTH.night8kGamma after the swap.
    uNightGamma: { value: 1 },
    uMoonCol: { value: new THREE.Color(tokens.moonlight) },
    uNightFloor: { value: EARTH.nightFloor },
    uRelief: { value: EARTH.relief },
    uOrganic: { value: EARTH.organic },
    uSat: { value: EARTH.sat },
    uGain: { value: EARTH.gain },
    // Day/orbit grade ramp (2026-07-17): the *Orbit twins are the grade at full orbit; the
    // orchestrator drives uOrbitGrade per frame from camera altitude (EARTH.orbitGrade).
    uOrganicOrbit: { value: EARTH.orbitGrade.organic },
    uSatOrbit: { value: EARTH.orbitGrade.sat },
    uGainOrbit: { value: EARTH.orbitGrade.gain },
    uOrbitGrade: { value: 0 },
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
      uniform vec3 uWater, uLand, uLandHi, uPeak, uCityLights, uAtmTint, uGoldenCol, uSunDir;
      uniform vec3 uMoonDir, uMoonCol;
      uniform float uMoonGlow;
      uniform float uNightGamma;
      uniform float uNightFloor;
      uniform float uRelief;
      uniform float uOrganic;
      uniform float uSat;
      uniform float uGain;
      uniform float uOrganicOrbit;
      uniform float uSatOrbit;
      uniform float uGainOrbit;
      uniform float uOrbitGrade;
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
        // Day/orbit grade ramp: each grade knob mixes toward its orbit twin as the camera
        // pulls away (uOrbitGrade 0 = low-altitude base grade, 1 = full-orbit grade).
        float satK = mix(uSat, uSatOrbit, uOrbitGrade);
        float gainK = mix(uGain, uGainOrbit, uOrbitGrade);
        float organicK = mix(uOrganic, uOrganicOrbit, uOrbitGrade);
        organic = mix(vec3(oLum), organic, satK) * gainK;
        vec3 albedo = mix(duo, organic, organicK);
        // Tangent-space normal map -> lit 3D relief. Build a tangent frame from the ECEF outward normal
        // (guard the pole where the default 'up' aligns with N). Relief only on land (ocean ~ flat).
        vec3 N = normalize(vDir);
        vec3 up = abs(N.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(up, N));
        vec3 B = cross(N, T);
        vec3 nT = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        nT.xy *= uRelief * land;
        vec3 Np = normalize(T * nT.x + B * nT.y + N * nT.z);
        // Narrow terminator (owner 2026-07-10: the old half-lambert wrap² spread dusk across the
        // whole sphere). Day/night switches across EARTH.termBand over sin(solar elevation) at
        // the relief normal; the day side keeps a soft subsolar gradient for dimensionality.
        float sunDot = dot(Np, normalize(uSunDir));
        float dayK = smoothstep(${glf(EARTH.termBand[0])}, ${glf(EARTH.termBand[1])}, sunDot);
        float dayShade = mix(${glf(EARTH.dayGradMin)}, 1.0, sqrt(max(sunDot, 0.0)));
        float shade = mix(uNightFloor, dayShade, dayK);
        vec3 color = albedo * shade;
        // Golden-hour cast (Phase 4, D6/D14): warm band where the sun grazes the LOCAL horizon —
        // a bell over sin(elevation) = dot(geographic normal, sun), so the warmth hugs the
        // terminator and appears at the correct local times. GLSL twin of lib/ephemeris/golden.ts.
        float gSin = dot(N, normalize(uSunDir));
        float gold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, gSin)
                   * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, gSin));
        color *= mix(vec3(1.0), uGoldenCol * ${glf(GOLDEN.castGain)}, gold * ${glf(GOLDEN.earthStrength)});
        // Geographically correct night-side city lights (VIIRS Black Marble). SINGLE-CHANNEL
        // sample (S5 §Item 8 — the 8k upgrade ships as R8); uNightGamma linearizes the raw
        // gray (1.0 for the hardware-decoded sRGB boot texture). li^2 kills haze, keeps cities.
        // Lights ride the same solar-elevation sine as the terminator: on through dusk, off by sunrise.
        float night = 1.0 - smoothstep(${glf(EARTH.lightsBand[0])}, ${glf(EARTH.lightsBand[1])}, sunDot);
        float li = pow(texture2D(uNight, vUv).r, uNightGamma);
        color += uCityLights * (li * li * ${glf(EARTH.cityLightGain)}) * night * land;
        // Cool moonlight lifts the dark side by lunar phase (astronomically-driven, like the sun).
        color += albedo * uMoonCol * (max(dot(Np, normalize(uMoonDir)), 0.0) * uMoonGlow * night);
        // In-shader limb scattering (day side): the disc brightens toward the grazing edge so the
        // sphere melts into the halo instead of meeting a stuck-on ring.
        float rim = pow(1.0 - max(dot(normalize(cameraPosition - vDir), N), 0.0), ${glf(EARTH.rimPow)});
        color += uAtmTint * rim * ${glf(EARTH.rimGain)} * mix(0.25, 1.0, dayK);
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

  // --- S5 8k upgrades (§Item 8 night lights + the owner's continental/ocean follow-up): the
  //     boot textures paint the first frames; the 8192×4096 versions fetch in the background
  //     and swap in — same fallback idiom as the BSC5 star catalog. Single-channel maps (night,
  //     land/water mask) become R8 DataTextures (~34 MB GPU + mips vs ~134 MB as RGBA each);
  //     the colour map stays a plain sRGB texture. Skipped when the GPU can't take 8k. --------
  let disposed = false;
  /** Fetch + rasterize an image URL to ImageData (the ~134 MB RGBA store is freed promptly). */
  const rasterize = async (url: string): Promise<ImageData> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;
    return img;
  };
  /** Single-channel R8 texture from ImageData. flipY happens IN THE DATA — WebGL's
   *  UNPACK_FLIP_Y does not apply to typed-array uploads. R8 is color-renderable → GPU mips. */
  const makeR8 = (img: ImageData): THREE.DataTexture => {
    const red = extractRedChannel(img.data, img.width, img.height, { flipY: true });
    const tex = new THREE.DataTexture(red, img.width, img.height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = opts.maxAniso;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace; // raw data — night linearizes in-shader, mask is linear
    tex.needsUpdate = true;
    return tex;
  };
  const swapUniformTex = (u: THREE.IUniform, tex: THREE.Texture) => {
    (u.value as THREE.Texture).dispose();
    u.value = tex;
  };
  const upgradeNight = async () => {
    try {
      const img = await rasterize(EARTH.textures.night8k);
      if (disposed) return;
      swapUniformTex(uniforms.uNight, makeR8(img));
      uniforms.uNightGamma.value = EARTH.night8kGamma; // gamma-encoded gray → shader decode
    } catch (e) {
      console.warn("[globe] Black Marble 8k unavailable — keeping the boot night texture:", e);
    }
  };
  const upgradeLandMask = async () => {
    try {
      const img = await rasterize(EARTH.textures.landMask8k);
      if (disposed) return;
      swapUniformTex(uniforms.uLandMask, makeR8(img)); // mask is linear data — no gamma
    } catch (e) {
      console.warn("[globe] 8k land mask unavailable — keeping the boot mask:", e);
    }
  };
  const upgradeColor = () => {
    new THREE.TextureLoader().load(
      EARTH.textures.color8k,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.wrapS = THREE.RepeatWrapping;
        tex.anisotropy = opts.maxAniso;
        tex.colorSpace = THREE.SRGBColorSpace;
        swapUniformTex(uniforms.uColor, tex);
      },
      undefined,
      (e) => console.warn("[globe] 8k colour map unavailable — keeping the boot colour:", e),
    );
  };
  if (opts.maxTextureSize >= 8192) {
    void upgradeNight();
    void upgradeLandMask();
    upgradeColor();
  }

  return {
    mesh,
    uniforms,
    dispose() {
      disposed = true;
      for (const t of allTex) t.dispose();
      // the 8k swaps, where they landed (double-dispose of boot textures is harmless)
      (uniforms.uNight.value as THREE.Texture).dispose();
      (uniforms.uLandMask.value as THREE.Texture).dispose();
      (uniforms.uColor.value as THREE.Texture).dispose();
      mesh.geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
