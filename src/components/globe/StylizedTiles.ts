import * as THREE from "three";
import {
  GlobeControls,
  TilesRenderer,
  WGS84_ELLIPSOID,
} from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import {
  GLTFExtensionsPlugin,
  TilesFadePlugin,
  UpdateOnChangePlugin,
  XYZTilesOverlay,
} from "3d-tiles-renderer/three/plugins";
// GeneratedSurfacePlugin is present at runtime (plugins index.js re-exports it) but ships without a
// .d.ts in 0.4.28, so TS can't see it. Runtime-correct; type-suppressed.
// @ts-expect-error - untyped export in 3d-tiles-renderer@0.4.28
import { GeneratedSurfacePlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { tokens } from "../../lib/theme/tokens";

/**
 * StylizedTiles — the real, geo-accurate globe (ADR D1), rebuilt to the PROJECT_SEED §2 signature
 * scene: "slightly rotating by default, seen from a cinematic LOW-EARTH-ORBIT angle … stylized and
 * adaptive with zoom: explicitly NOT messy half-baked semi-realistic textures, and NOT flat."
 *
 * The scene is one continuous instrument across three altitude bands, with no hard visual switches:
 *   • ORBIT — the base ellipsoid: NASA Blue Marble (topo+bathy) graded into the sage/slate palette
 *     (organic geological features — deserts, ice, ocean depth — but stylized, per C2), normal-mapped
 *     relief, geographically correct VIIRS city lights on the night side, and a subtle in-shader limb
 *     scattering so the disc melts into the halo.
 *   • MID — a second TilesRenderer drapes real satellite imagery (Esri World Imagery, z19) on the
 *     WGS84 ellipsoid, color-graded by the SAME palette + sun shading as the base, and screen-door
 *     crossfaded in by altitude — detail "grows" organically out of the stylized earth.
 *   • CITY — the imagery keeps refining under the OSM building tiles (Cesium ion 96188).
 *
 * Default POV is a spacecraft in LEO: ~1,100 km up, pitched toward the horizon (limb + atmosphere arc
 * in the top of frame), drifting at ISS-like angular speed; drift pauses on interaction and resumes
 * after 8 s (design-board motion spec). All colour flows through the GL token bridge (ADR D14).
 * Dynamically imported by GlobeCanvas ONLY when `PUBLIC_CESIUM_ION_TOKEN` is present.
 */

// WGS84 semi-axes (m) — must match the ellipsoid the OSM building tiles extrude from.
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.3;

// Phase-1 test city (Dnipro, UA).
const DNIPRO_LAT = 48.4647;
const DNIPRO_LON = 35.0462;
// Cesium OSM Buildings are clamped to Cesium World Terrain, so building bases sit at terrain
// elevation ABOVE the ellipsoid our imagery ground drapes on (~60–150 m around Dnipro) — they read
// as floating. Until real terrain lands (later phase), sink the buildings layer by the test city's
// mean terrain height. City-specific by design: Phase 1 verifies against Dnipro only.
const TERRAIN_SINK_M = 90;

// Fixed sun direction for Phase 1 (world/ECEF). MUST match GlobeCanvas's DirectionalLight so the earth's
// terminator agrees with the OSM building-tile shading. Wired to the ephemeris in a later phase.
const SUN_DIR = new THREE.Vector3(5, 2, 4).normalize();

// Default LEO pose: camera ~400 km SW of Dnipro (48.4647, 35.0462 — the Phase-1 test city) at
// 1,100 km, aimed past the city toward the NE horizon
// so the limb + atmosphere sit in the top quarter of a 38° FOV frame (seed: "as if user is in low
// earth orbit", cinematic oblique — not nadir).
const LEO_CAM = { lat: 46.0, lon: 31.3, alt: 1_100_000 };
const LEO_TARGET = { lat: 53.2, lon: 41.3, alt: 0 };

// Altitude bands (m above the WGS84 surface). The imagery ground OVERLAPS the base's resolution limit
// so the handoff is a gradual dissolve, never a visible switch.
const GROUND_ACTIVE_ALT = 3_000_000; // imagery TilesRenderer updates below this
const GROUND_FADE_TOP = 2_600_000; // screen-door fade starts (0 → imagery invisible)
const GROUND_FADE_BOTTOM = 1_400_000; // fade complete (1 → imagery fully owns the ground)
const DECOR_MIN_ALT = 150_000; // graticule + atmosphere hidden below (no wire cage at street level)
const STAR_FADE_BOTTOM = 250_000; // stars gone below this …
const STAR_FADE_SPAN = 450_000; // … fading in fully by bottom+span (visible at LEO)
const DRIFT_MIN_ALT = 400_000; // idle drift only while genuinely "in orbit"
const DRIFT_RESUME_MS = 8_000; // design board: pause on interaction, resume after 8 s
const DRIFT_RAD_PER_FRAME = (0.0011 * Math.PI) / 180; // ≈0.066°/s @60fps — real ISS angular pace

export interface TilesHandle {
  update: () => void;
  dispose: () => void;
}

export function attachStylizedTiles(opts: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ionToken: string;
  reduceMotion?: boolean;
}): TilesHandle {
  const { scene, camera, renderer, ionToken, reduceMotion = false } = opts;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ============================================================================================
  // 1. Base ellipsoid — the orbit instrument. NASA Blue Marble colour graded toward the palette
  //    (organic geology, stylized tone), elevation ramp + normal relief, VIIRS night lights, and
  //    limb scattering. Colour maps are sRGB (real imagery); mask/elevation/normal stay DATA
  //    (NoColorSpace — an sRGB tag on data decode-darkens it; that was the original near-black bug).
  // ============================================================================================
  const loader = new THREE.TextureLoader();
  const landMaskTex = loader.load("/textures/earth-landmask.png"); // land=white, ocean=black (data)
  const elevationTex = loader.load("/textures/earth-topology.png"); // grayscale elevation (data)
  const normalTex = loader.load("/textures/earth-normal.jpg"); // tangent-space relief (data)
  const colorTex = loader.load("/textures/earth-color.jpg"); // NASA Blue Marble topo+bathy 5400² (sRGB)
  const nightTex = loader.load("/textures/earth-night.jpg"); // NASA VIIRS city lights 3600² (sRGB)
  for (const t of [landMaskTex, elevationTex, normalTex, colorTex, nightTex]) {
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = maxAniso; // crisp coasts + relief at the grazing angles a LEO POV lives at
  }
  landMaskTex.colorSpace = THREE.NoColorSpace;
  elevationTex.colorSpace = THREE.NoColorSpace;
  normalTex.colorSpace = THREE.NoColorSpace;
  colorTex.colorSpace = THREE.SRGBColorSpace;
  nightTex.colorSpace = THREE.SRGBColorSpace;

  const earthUniforms = {
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
    uSunDir: { value: SUN_DIR.clone() },
    uNightFloor: { value: 0.32 }, // dark-side floor — just enough to navigate; city lights carry the rest
    uRelief: { value: 0.75 }, // normal-map strength (0 = flat, 1 = full 3D relief)
    uOrganic: { value: 0.58 }, // 0 = pure palette duotone, 1 = pure (graded) NASA colour
    uSat: { value: 0.5 }, // chroma kept from the NASA colour before the palette mix
    uGain: { value: 0.55 }, // darkens the NASA colour into the instrument's tonal range
  };
  const baseMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
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
        float land = smoothstep(0.35, 0.65, mask);  // antialiased coastline
        // Stylized duotone ramp (the palette skeleton): water -> land -> landHi -> peak.
        vec3 landCol = mix(uLand, uLandHi, smoothstep(0.02, 0.14, elev));
        landCol = mix(landCol, uPeak, smoothstep(0.22, 0.58, elev));
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
        float night = 1.0 - smoothstep(0.30, 0.52, wrap);
        float li = dot(texture2D(uNight, vUv).rgb, vec3(0.333));
        color += uCityLights * (li * li * 2.1) * night * land;
        // In-shader limb scattering (day side): the disc brightens toward the grazing edge so the
        // sphere melts into the halo instead of meeting a stuck-on ring.
        float rim = pow(1.0 - max(dot(normalize(cameraPosition - vDir), N), 0.0), 3.0);
        color += uAtmTint * rim * 0.12 * wrap;
        // Blue-noise-ish dither: additive gradients on a near-black bg band badly without it.
        color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Sit the stylized base ~1.9 km BELOW the WGS84 surface so the refining imagery ground (drawn AT
  // exact WGS84) always renders cleanly in front of it — no base/imagery z-fight. Sub-pixel from
  // orbit; hidden by imagery at zoom. polygonOffset keeps buildings above it before imagery loads.
  baseMat.polygonOffset = true;
  baseMat.polygonOffsetFactor = 1;
  baseMat.polygonOffsetUnits = 1;
  const base = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 384), baseMat);
  const BASE_SHRINK = 0.9997;
  base.scale.set(WGS84_A * BASE_SHRINK, WGS84_B * BASE_SHRINK, WGS84_A * BASE_SHRINK);
  base.rotation.x = Math.PI / 2;
  scene.add(base);

  // ============================================================================================
  // 2. Graticule — REAL lat/lon lines (not a sphere wireframe, which draws triangulation diagonals).
  //    A hemisphere-discard shader draws only the near side, so it vanishes when the camera dives inside.
  // ============================================================================================
  const grid = new THREE.LineSegments(
    graticuleGeometry(15),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(tokens.graticule) },
        uOpacity: { value: 0.14 },
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
          if (dot(n, toCam) < 0.05) discard;   // near hemisphere only -> auto-vanishes when inside
          gl_FragColor = vec4(uColor, uOpacity);
          #include <colorspace_fragment>
        }`,
    }),
  );
  grid.rotation.x = Math.PI / 2;
  grid.scale.copy(base.scale).multiplyScalar(1.0015); // ~10 km above the surface
  grid.raycast = () => {}; // don't let GlobeControls pivot/zoom-pick the decoration
  scene.add(grid);

  // ============================================================================================
  // 3. Atmosphere — physically-anchored limb glow. A screen-facing fresnel peaks at the SHELL's
  //    silhouette, which from LEO sits visibly above the limb (a detached band with a dark gap —
  //    the "crude halo"). Instead each fragment computes its view ray's closest-approach altitude
  //    above the surface and applies exponential density falloff exp(-h/H): the glow is pinned to
  //    Earth's limb and decays outward correctly at ANY camera altitude — a thin bright teal line
  //    (small scale height) inside a broad Rayleigh-blue haze (large scale height), sun-modulated.
  // ============================================================================================
  // The glow is computed from the VIEW RAY, so it needs exactly one shell layer per pixel — and it
  // must be the NEAR one: GlobeControls fits camera.far tightly to the visible terrain (~3.9e6 m at
  // LEO), and the shell's far hemisphere beyond the limb sits PAST that plane (the same dynamic-far
  // clip that once hid the starfield). DoubleSide + a per-frame inside/outside uniform picks the
  // hemisphere that is guaranteed to be inside the frustum.
  const atmUniforms = {
    uColor: { value: new THREE.Color(tokens.atmosphere) },
    uColorDeep: { value: new THREE.Color(tokens.atmosphereDeep) },
    uSunDir: { value: SUN_DIR.clone() },
    uIntensity: { value: 0.55 },
    uRe: { value: WGS84_A }, // limb reference radius
    uH1: { value: 60_000 }, // teal line scale height (m) — thin, hugs the horizon
    uH2: { value: 240_000 }, // blue haze scale height (m) — the soft outer falloff
    uInside: { value: 0 }, // 1 when the camera is inside the shell (render back faces instead)
    // 0 at LEO (thick horizon haze is the point of the POV) -> 1 at outer orbit, where the same
    // physical scale heights read as a fat ring around the small disc: shrink widths to 1/10 and
    // shift the line toward Rayleigh blue — "distinct but elegant and subtle" (owner 2026-07-10).
    uOrbit: { value: 0 },
  };
  const atmMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: atmUniforms,
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
        float hs = mix(1.0, 0.1, uOrbit);   // outer orbit: 1/10 of the LEO glow width
        float g1 = exp(-h / (uH1 * hs));    // bright limb line
        float g2 = exp(-h / (uH2 * hs));    // broad haze
        float sun = clamp(dot(normalize(closest), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
        // rays that strike the planet get a faint blue air-wash (atmosphere between craft and
        // ground) instead of the limb line — the near shell is NOT depth-occluded by the disc
        float hitsGround = 1.0 - smoothstep(uRe - 60000.0, uRe + 10000.0, dmin);
        vec3 lineCol = mix(uColor, uColorDeep, 0.2 + 0.5 * uOrbit); // bluer as we pull away
        vec3 limbCol = lineCol * g1 * 0.8 + uColorDeep * g2 * 0.3;
        vec3 washCol = uColorDeep * 0.045;
        vec3 color = mix(limbCol, washCol, hitsGround) * uIntensity * mix(0.25, 1.0, sun);
        color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0); // additive multiplies by src alpha -> keep alpha 1
        #include <colorspace_fragment>
      }`,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), atmMat);
  atmosphere.scale.copy(base.scale).multiplyScalar(1.1); // shell high enough for the haze to decay inside it
  atmosphere.rotation.x = Math.PI / 2;
  atmosphere.raycast = () => {};
  scene.add(atmosphere);

  // ============================================================================================
  // 4. Star-field — additive round soft stars with size/brightness variance + a subtle twinkle.
  //    Built on a UNIT sphere; each frame it is re-centred on the camera and scaled to sit just behind
  //    Earth's near surface but INSIDE GlobeControls' dynamic far plane (a fixed celestial sphere would
  //    be frustum-clipped away, which is why stars were previously invisible).
  // ============================================================================================
  const starCount = 5000;
  const starPos = new Float32Array(starCount * 3);
  const aSize = new Float32Array(starCount);
  const aPhase = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = Math.sin(ph) * Math.sin(th);
    starPos[i * 3 + 2] = Math.cos(ph);
    const m = Math.random();
    aSize[i] = m * m * 2.0 + 0.8; // a few bright, many faint (px, pre-DPR)
    aPhase[i] = Math.random() * Math.PI * 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(tokens.star) },
      uTime: { value: 0 },
      uDpr: { value: renderer.getPixelRatio() },
      uFade: { value: 1 }, // altitude fade so stars leave cleanly on descent (no bleed over the ground)
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uDpr;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vB = 0.7 + 0.3 * sin(uTime * 1.5 + aPhase);   // subtle twinkle
        gl_PointSize = aSize * uDpr;                  // screen-space (no attenuation)
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying float vB;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d) * vB * 0.8 * uFade;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.raycast = () => {};
  scene.add(stars);

  // ============================================================================================
  // 5. Tiles — Cesium OSM Buildings, ion asset 96188.
  // ============================================================================================
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({ apiToken: ionToken, assetId: "96188" }),
  );
  const draco = new DRACOLoader().setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  scene.add(tiles.group);
  // Sink the terrain-clamped buildings onto the ellipsoid-draped ground (see TERRAIN_SINK_M).
  const dniproUp = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToNormal(
    (DNIPRO_LAT * Math.PI) / 180,
    (DNIPRO_LON * Math.PI) / 180,
    dniproUp,
  );
  tiles.group.position.addScaledVector(dniproUp, -TERRAIN_SINK_M);

  // Design-board building idiom (canvas ftw-scene): DARK slate mass with lighter edge strokes that
  // catch the light — not a light fill. Flat shading keeps per-facet silhouettes; a faint sage
  // emissive stops the night side going pure black. Accent stays reserved for signal (pins).
  const styleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.surface), // dark slate mass (design building front #0F151D–#12161C)
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true, // crisp per-facet silhouettes (the documented stylization move)
    emissive: new THREE.Color(tokens.land),
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide, // guard against missing backfaces on some b3dm tiles
  });
  // Push the building faces back a hair so their OWN edge lines win the depth tie (lines ignore
  // polygonOffset). Still less than the ground's offset (1), so bases keep winning vs the imagery.
  styleMat.polygonOffset = true;
  styleMat.polygonOffsetFactor = 0.5;
  styleMat.polygonOffsetUnits = 0.5;
  // ONE shared edge material (never disposed per-tile); geometry is per-tile (disposed on unload).
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.landHi), // lighter than the fill -> pronounced lit edges (design stroke)
    transparent: true,
    opacity: 0.4,
  });
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
        // Pronounced edges: hard creases (>30°) as line segments riding the mesh. The added child is
        // a LineSegments, so the isMesh branch skips it when traverse reaches it.
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(c.geometry, 30), edgeMat);
        edges.raycast = () => {}; // never let GlobeControls pick a decoration line
        c.add(edges);
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    e.scene.traverse((c: any) => {
      // per-tile edge geometry only — edgeMat and styleMat are SHARED (disposed once, in dispose())
      if (c.isLineSegments) c.geometry.dispose();
    });
  });

  // ============================================================================================
  // 5b. Refining imagery ground — a SECOND TilesRenderer draping real satellite imagery (Esri World
  //     Imagery, z19 street-level detail) on the WGS84 ellipsoid. Each generated tile mesh is a
  //     MeshBasicMaterial with the overlay texture as `map` (GeneratedSurfacePlugin.js parseToMesh),
  //     so we chain onBeforeCompile to (a) grade it into the instrument's palette — desaturate,
  //     darken, cool cast — (b) apply the SAME half-lambert sun shading as the base so the terminator
  //     is continuous across LODs, and (c) screen-door-dissolve the whole layer in by altitude
  //     (bayer discard, same technique TilesFadePlugin uses per-tile — no transparency sorting).
  //     Result: descending from orbit, real terrain detail grows organically INSIDE the stylized
  //     earth; there is no "switch". Attribution is shown in the DOM (index.astro).
  // ============================================================================================
  const groundOverlay = new XYZTilesOverlay({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    levels: 19, // Esri World Imagery refines to ~z19 (sub-metre in cities)
  });
  const ground = new TilesRenderer();
  ground.registerPlugin(new TilesFadePlugin()); // per-tile fade-in (the gradual reveal), no popping
  ground.registerPlugin(new UpdateOnChangePlugin()); // only re-tile when the camera actually moves
  ground.registerPlugin(
    new GeneratedSurfacePlugin({
      overlay: groundOverlay,
      shape: "ellipsoid",
      applyOverlayTexture: true,
    }),
  );
  ground.setCamera(camera);
  ground.setResolutionFromRenderer(camera, renderer);
  ground.group.visible = false; // revealed by altitude in update()
  scene.add(ground.group);

  // Shared uniforms across every ground-tile material — one value drives the whole layer.
  const groundUniforms = {
    uFtwFade: { value: 0 }, // 0 = invisible (all fragments discarded) … 1 = fully present
    uFtwSun: { value: SUN_DIR.clone() },
    uFtwNightFloor: { value: 0.45 }, // slightly above base floor: close-zoom ground must stay navigable
    uFtwDesat: { value: 0.52 }, // pull satellite chroma toward the instrument
    uFtwGain: { value: 0.56 }, // sit the imagery in the dark scene's tonal range
    uFtwCast: { value: new THREE.Vector3(0.92, 0.99, 1.06) }, // cool slate cast (palette direction)
  };
  const gradeGround = (shader: any) => {
    shader.uniforms = { ...shader.uniforms, ...groundUniforms };
    shader.vertexShader = shader.vertexShader.replace(
      /void\s+main\(\)\s*{/,
      (v: string) => `varying vec3 vFtwW;\n${v}`,
    ).replace(
      /#include <project_vertex>/,
      (v: string) => `${v}\n  vFtwW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      /void main\(/,
      (v: string) => /* glsl */ `
        varying vec3 vFtwW;
        uniform float uFtwFade;
        uniform vec3 uFtwSun;
        uniform float uFtwNightFloor;
        uniform float uFtwDesat;
        uniform float uFtwGain;
        uniform vec3 uFtwCast;
        float ftwBayer2(vec2 v) { return mod(3.0 * v.y + 2.0 * v.x, 4.0); }
        float ftwBayer4(vec2 v) {
          vec2 P1 = mod(v, 2.0);
          vec2 P2 = floor(0.5 * mod(v, 4.0));
          return 4.0 * ftwBayer2(P1) + ftwBayer2(P2);
        }
        ${v}`,
    ).replace(
      /#include <map_fragment>/,
      (v: string) => /* glsl */ `${v}
        {
          // palette grade + the SAME sun shading as the stylized base (continuous terminator)
          vec3 nW = normalize(vFtwW);
          float wrap = dot(nW, normalize(uFtwSun)) * 0.5 + 0.5;
          float shade = mix(uFtwNightFloor, 1.0, wrap * wrap);
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 graded = mix(diffuseColor.rgb, vec3(lum), uFtwDesat) * uFtwGain * uFtwCast;
          // blue-dominant pixels = water -> pull toward the instrument's near-black ocean so the
          // imagery's bright seas never punch through the dark palette (rivers/lakes stay slate too)
          float waterness = smoothstep(0.0, 0.12, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
          graded *= mix(1.0, 0.35, waterness);
          diffuseColor.rgb = graded * shade;
        }`,
    ).replace(
      /#include <dithering_fragment>/,
      (v: string) => /* glsl */ `${v}
        {
          // altitude screen-door dissolve for the WHOLE imagery layer (offset vs TilesFadePlugin's grid)
          float fb = ftwBayer4(floor(mod(gl_FragCoord.xy + 2.0, 4.0)));
          if ((0.5 + fb) / 16.0 > uFtwFade) discard;
        }`,
    );
  };
  ground.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh && c.material) {
        const mat = c.material;
        // Push the imagery surface just behind the building footprints so building bases win the tie.
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = 1;
        mat.polygonOffsetUnits = 1;
        if (mat.map) {
          mat.map.anisotropy = maxAniso; // oblique LEO/city views sample imagery at grazing angles
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.needsUpdate = true;
        }
        // CHAIN (never assign) — TilesFadePlugin has already wrapped onBeforeCompile for its own fade.
        const prev = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, r: any) => {
          if (prev) prev(shader, r);
          gradeGround(shader);
        };
        mat.needsUpdate = true;
      }
    });
  });

  // ============================================================================================
  // 6. Camera framing: globe-scale near/far (GlobeControls refines them each frame), then the
  //    signature LEO pose — oblique toward the horizon, NOT nadir (PROJECT_SEED §2).
  // ============================================================================================
  camera.near = 1;
  camera.far = 1e9;

  const camPos = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    (LEO_CAM.lat * Math.PI) / 180,
    (LEO_CAM.lon * Math.PI) / 180,
    LEO_CAM.alt,
    camPos,
  );
  const targetPos = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    (LEO_TARGET.lat * Math.PI) / 180,
    (LEO_TARGET.lon * Math.PI) / 180,
    LEO_TARGET.alt,
    targetPos,
  );
  camera.position.copy(camPos);
  camera.up.copy(camPos).normalize(); // local "up" = away from Earth centre (spacecraft POV, no roll)
  camera.lookAt(targetPos);
  camera.updateProjectionMatrix();

  // ============================================================================================
  // 7. GlobeControls — documented ellipsoid binding, damping for a premium feel, snappy zoom.
  // ============================================================================================
  const controls = new GlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid((tiles as any).ellipsoid ?? WGS84_ELLIPSOID, tiles.group);
  controls.enableDamping = true; // globe inertia — the single biggest "premium" interaction win
  controls.dampingFactor = 0.15;
  controls.maxAltitude = Math.PI / 2; // allow tilting to the true horizon
  controls.cameraRadius = 8; // keep a touch above rooftops via adjustHeight
  controls.zoomSpeed = 5; // per brief — snappy trackpad pinch (default 1 is painfully slow)

  const t0 = performance.now();

  // Idle orbital drift — the "spacecraft in LEO" feel (seed: "slightly rotating by default").
  // Rotates the camera around Earth's axis at ISS-like angular speed; pauses the moment the user
  // touches the scene and resumes after 8 s (design-board motion spec). Skipped for reduced motion.
  let lastInteract = -Infinity;
  const noteInteract = () => {
    lastInteract = performance.now();
  };
  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", noteInteract);
  dom.addEventListener("wheel", noteInteract, { passive: true });
  dom.addEventListener("touchstart", noteInteract, { passive: true });
  const _driftAxis = new THREE.Vector3(0, 0, 1); // ECEF +Z = Earth's rotation axis
  const _driftQ = new THREE.Quaternion();

  // Dev-only introspection so browser verification (Playwright) can read camera altitude and tile
  // state without reaching into the closure. No secrets, no behaviour change.
  if (import.meta.env.DEV) {
    (window as any).__globe = {
      camera,
      controls,
      tiles,
      ground,
      groundUniforms,
      earthUniforms,
      alt: () => WGS84_ELLIPSOID.getPositionElevation(camera.position),
    };
  }

  return {
    update() {
      // A single bad frame (transient tiles error, WebGL glitch) MUST NOT freeze the canvas.
      try {
        controls.update();
        camera.updateMatrixWorld();
        tiles.update();

        // True geodetic altitude above the WGS84 ellipsoid. (position.length() - WGS84_A is up to
        // ~21 km off at mid-latitudes — enough to mis-time the low-altitude gates.)
        const dist = camera.position.length();
        const alt = WGS84_ELLIPSOID.getPositionElevation(camera.position);

        // Idle orbital drift (LEO spacecraft feel) — orbit only, paused for 8 s after interaction.
        if (
          !reduceMotion &&
          alt > DRIFT_MIN_ALT &&
          performance.now() - lastInteract > DRIFT_RESUME_MS
        ) {
          _driftQ.setFromAxisAngle(_driftAxis, DRIFT_RAD_PER_FRAME);
          camera.position.applyQuaternion(_driftQ);
          camera.up.applyQuaternion(_driftQ);
          camera.quaternion.premultiply(_driftQ);
        }

        // Imagery ground: active below GROUND_ACTIVE_ALT; the layer screen-door-dissolves in across
        // the fade band so real terrain detail grows organically out of the stylized base (no switch),
        // then keeps LOD-refining (Esri z19 + TilesFadePlugin) all the way to street level.
        const groundOn = alt < GROUND_ACTIVE_ALT;
        ground.group.visible = groundOn;
        if (groundOn) {
          groundUniforms.uFtwFade.value = THREE.MathUtils.clamp(
            (GROUND_FADE_TOP - alt) / (GROUND_FADE_TOP - GROUND_FADE_BOTTOM),
            0,
            1,
          );
          ground.update();
        }

        // Orbit-only decoration: hide the graticule + atmosphere once we dive toward the city
        // (no "wire cage" up-view, no shell overdraw over the buildings).
        const orbital = alt > DECOR_MIN_ALT;
        grid.visible = orbital;
        atmosphere.visible = orbital;
        atmUniforms.uInside.value = dist < atmosphere.scale.y ? 1 : 0; // scale.y = smallest shell axis
        // LEO keeps the thick horizon haze; pulling out to outer orbit thins the halo to 1/10.
        atmUniforms.uOrbit.value = THREE.MathUtils.clamp((alt - 2_500_000) / 6_500_000, 0, 1);

        // Stars are the high-altitude backdrop; visible from LEO, fading out on final descent so
        // they leave cleanly before the ground fills the view (no bleed over the near surface).
        const starVisible = alt > STAR_FADE_BOTTOM;
        stars.visible = starVisible;
        if (starVisible) {
          // Keep the star sphere centred on the camera, scaled to sit beyond the farthest visible
          // ground (the limb tangent distance — NOT the nadir altitude: from an oblique LEO POV the
          // slant range to terrain far exceeds alt, and an alt-scaled sphere puts star specks IN
          // FRONT of the ground). Clamped inside GlobeControls' dynamic far plane so it isn't culled.
          const limbDist = Math.sqrt(alt * (2 * WGS84_A + alt));
          stars.position.copy(camera.position);
          stars.scale.setScalar(Math.min(1.05 * limbDist, camera.far * 0.9));
          starMat.uniforms.uFade.value = Math.min(
            1,
            (alt - STAR_FADE_BOTTOM) / STAR_FADE_SPAN,
          );
          if (!reduceMotion) {
            starMat.uniforms.uTime.value = (performance.now() - t0) / 1000;
          }
        }
      } catch (err) {
        console.error("[globe] tiles/controls update error:", err);
      }
    },
    dispose() {
      dom.removeEventListener("pointerdown", noteInteract);
      dom.removeEventListener("wheel", noteInteract);
      dom.removeEventListener("touchstart", noteInteract);
      controls.dispose();
      tiles.dispose();
      ground.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      draco.dispose();
      landMaskTex.dispose();
      elevationTex.dispose();
      normalTex.dispose();
      colorTex.dispose();
      nightTex.dispose();
      base.geometry.dispose();
      baseMat.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      atmMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      scene.remove(base, grid, atmosphere, stars, tiles.group, ground.group);
    },
  };
}

/**
 * True lat/lon graticule geometry (meridians + parallels) on a unit sphere in local +Y-up frame.
 * Returns LineSegments-ready positions (pairs of endpoints). The caller applies rotation.x = +PI/2
 * and the base scale so it aligns with the ellipsoid.
 */
function graticuleGeometry(stepDeg = 15, seg = 128): THREE.BufferGeometry {
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
