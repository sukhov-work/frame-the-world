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
 * StylizedTiles — the real, geo-accurate globe (ADR D1).
 * Cesium OSM Buildings (ion asset 96188) via NASA-AMMOS `3d-tiles-renderer`, stylized with the
 * documented `load-model` material override, navigated with `GlobeControls` (current API: `setEllipsoid`).
 *
 * Asset 96188 is buildings-ONLY (no terrain / no imagery), and it only refines at city zoom — so from
 * orbit the user sees ONLY the base ellipsoid. That base therefore IS the global "instrument" and must
 * read as a premium stylized Earth. It is built here as:
 *   • a mask-driven land/ocean ShaderMaterial (continents from a real land/ocean mask, oceans deep, peaks
 *     brighter from the elevation channel), self-lit with half-lambert + a night floor so continents stay
 *     readable even on the dark side (a navigation instrument must never hide half its map);
 *   • a true lat/lon graticule (real meridians/parallels, not a triangulated sphere wireframe), which
 *     hemisphere-discards so it vanishes when the camera dives inside the shell;
 *   • a fresnel limb-glow atmosphere (cyan-teal per brief) that peaks only at the grazing horizon;
 *   • a screen-space star-field that follows the camera so it stays inside GlobeControls' dynamic far
 *     plane (the celestial sphere at infinity would otherwise be frustum-clipped).
 *
 * All colour comes from the GL token bridge (ADR D14) — no hardcoded hex here.
 * Dynamically imported by GlobeCanvas ONLY when `PUBLIC_CESIUM_ION_TOKEN` is present.
 */

// Phase-1 test city (Dnipro, UA).
const DNIPRO_LAT = 48.4647;
const DNIPRO_LON = 35.0462;

// WGS84 semi-axes (m) — must match the ellipsoid the OSM building tiles extrude from.
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.3;

// Fixed sun direction for Phase 1 (world/ECEF). MUST match GlobeCanvas's DirectionalLight so the earth's
// terminator agrees with the OSM building-tile shading. Wired to the ephemeris in a later phase.
const SUN_DIR = new THREE.Vector3(5, 2, 4).normalize();

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
  // 1. Base ellipsoid — mask-driven land/ocean with elevation relief (THE global instrument).
  //    A single multiply-map can only tint ONE colour; we need TWO (water vs land), so we MIX in a
  //    ShaderMaterial. Both textures are DATA (NoColorSpace) — an sRGB tag would decode-darken them.
  // ============================================================================================
  const loader = new THREE.TextureLoader();
  const landMaskTex = loader.load("/textures/earth-landmask.png"); // land=white, ocean=black
  const elevationTex = loader.load("/textures/earth-topology.png"); // grayscale elevation (peaks bright)
  const normalTex = loader.load("/textures/earth-normal.jpg"); // tangent-space relief normals
  for (const t of [landMaskTex, elevationTex, normalTex]) {
    t.colorSpace = THREE.NoColorSpace; // all three are DATA, not colour — skip the sRGB decode
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = maxAniso; // crisp coasts + relief at grazing angles
  }

  const earthUniforms = {
    uLandMask: { value: landMaskTex },
    uElevation: { value: elevationTex },
    uNormal: { value: normalTex },
    uWater: { value: new THREE.Color(tokens.water) }, // THREE.Color => LINEAR uniform
    uLand: { value: new THREE.Color(tokens.land) },
    uLandHi: { value: new THREE.Color(tokens.landHi) },
    uPeak: { value: new THREE.Color(tokens.peak) },
    uSunDir: { value: SUN_DIR.clone() },
    uNightFloor: { value: 0.5 }, // continents readable on the dark side (0.35..0.55)
    uRelief: { value: 0.75 }, // normal-map strength (0 = flat, 1 = full 3D relief)
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
      uniform vec3 uWater, uLand, uLandHi, uPeak, uSunDir;
      uniform float uNightFloor;
      uniform float uRelief;
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        float mask = texture2D(uLandMask, vUv).r;   // GPU-filtered 0..1 across coasts
        float elev = texture2D(uElevation, vUv).r;  // elevation, 0 over ocean
        float land = smoothstep(0.35, 0.65, mask);  // antialiased coastline
        // relief: rolling terrain reads as landHi, high peaks/ice as peak (uPeak is the non-white ceiling)
        vec3 landCol = mix(uLand, uLandHi, smoothstep(0.02, 0.14, elev));
        landCol = mix(landCol, uPeak, smoothstep(0.22, 0.58, elev));
        vec3 albedo = mix(uWater, landCol, land);
        // Tangent-space normal map -> lit 3D relief. Build a tangent frame from the ECEF outward normal
        // (guard the pole where the default 'up' aligns with N). Relief only on land (ocean normal ~ flat).
        vec3 N = normalize(vDir);
        vec3 up = abs(N.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(up, N));
        vec3 B = cross(N, T);
        vec3 nT = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        nT.xy *= uRelief * land;
        vec3 Np = normalize(T * nT.x + B * nT.y + N * nT.z);
        // half-lambert form off the relief normal; night floor keeps the map readable on the unlit side
        float wrap = dot(Np, normalize(uSunDir)) * 0.5 + 0.5;
        float shade = mix(uNightFloor, 1.0, wrap * wrap);
        gl_FragColor = vec4(albedo * shade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Sit the stylized base ~1.9 km BELOW the WGS84 surface so the refining imagery ground (which the ground
  // TilesRenderer draws AT exact WGS84) always renders cleanly in front of it — no base/imagery z-fight.
  // The base is the orbit backdrop + the fallback ground before imagery loads; polygonOffset keeps any
  // buildings above it in that fallback case. 1.9 km is sub-pixel from orbit and hidden by imagery at zoom.
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
        uOpacity: { value: 0.18 },
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
  // 3. Atmosphere — fresnel limb glow (peaks at the grazing horizon, ~0 across the disc), cyan-teal
  //    per the brief. Uniform-opacity back-side sphere painted a flat disc; this paints only a rim.
  // ============================================================================================
  const atmMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(tokens.atmosphere) },
      uSunDir: { value: SUN_DIR.clone() },
      uIntensity: { value: 0.5 }, // subtler, more transparent limb
      uPower: { value: 3.6 }, // higher = thinner rim that hugs the horizon
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vW);
        vec3 n = -normalize(vN);            // back-side normals point inward -> flip
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), uPower);
        float sun = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
        float glow = fres * uIntensity * mix(0.6, 1.0, sun);
        gl_FragColor = vec4(uColor * glow, 1.0);   // additive multiplies by src alpha -> keep alpha 1
        #include <colorspace_fragment>
      }`,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), atmMat);
  atmosphere.scale.copy(base.scale).multiplyScalar(1.03); // ~190 km shell
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

  // Lighter slate + flat shading + faint emissive so buildings POP above the darker map and never go
  // pure black on the night side. Accent stays reserved for signal (pins) — buildings are neutral.
  const styleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.peak),
    roughness: 0.55,
    metalness: 0.0,
    flatShading: true, // crisp per-facet silhouettes (the documented stylization move)
    emissive: new THREE.Color(tokens.land),
    emissiveIntensity: 0.15,
    side: THREE.DoubleSide, // guard against missing backfaces on some b3dm tiles
  });
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
      }
    });
  });

  // ============================================================================================
  // 5b. Refining ground map — a SECOND TilesRenderer draping a dark raster map on the WGS84 ellipsoid.
  //     GeneratedSurfacePlugin synthesises tiled ellipsoid geometry that LODs with altitude and pulls
  //     Carto dark {z}/{x}/{y} tiles that sharpen as you descend ("details gain clarity gradually"). It
  //     shares ECEF/WGS84 with the buildings so they land on it. Revealed only below ~300 km so orbit
  //     stays fully stylized + cheap. Attribution (© OpenStreetMap © CARTO) is shown in the DOM (ToS).
  // ============================================================================================
  const groundOverlay = new XYZTilesOverlay({
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
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
  // Push the imagery surface just behind the building footprints so building bases win the depth tie.
  ground.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh && c.material) {
        c.material.polygonOffset = true;
        c.material.polygonOffsetFactor = 1;
        c.material.polygonOffsetUnits = 1;
      }
    });
  });

  // ============================================================================================
  // 6. Camera framing: globe-scale near/far (GlobeControls refines them each frame), above Dnipro.
  // ============================================================================================
  camera.near = 1;
  camera.far = 1e9;

  const altitude = 15_000_000; // ~15,000 km — Earth fills ~35° of a 38° FOV
  const dniproPos = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    (DNIPRO_LAT * Math.PI) / 180,
    (DNIPRO_LON * Math.PI) / 180,
    altitude,
    dniproPos,
  );
  camera.position.copy(dniproPos);
  camera.up.set(0, 0, 1); // ECEF +Z = north pole -> north is "up"
  camera.lookAt(0, 0, 0);
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

  return {
    update() {
      // A single bad frame (transient tiles error, WebGL glitch) MUST NOT freeze the canvas.
      try {
        controls.update();
        camera.updateMatrixWorld();
        tiles.update();

        // Distance from Earth centre (Earth is at the origin) -> altitude above the surface.
        const dist = camera.position.length();
        const alt = dist - WGS84_A;

        // Refining dark map: reveal + tile only below ~300 km so orbit stays stylized + cheap. Below that,
        // Carto tiles LOD in and fade up (TilesFadePlugin), sharpening as the camera descends to the city.
        const groundOn = alt < 300_000;
        ground.group.visible = groundOn;
        if (groundOn) ground.update();

        // Orbit-only decoration: hide the graticule + atmosphere once we dive toward the city
        // (no "wire cage" up-view, no shell overdraw over the buildings).
        const orbital = alt > 150_000; // 150 km
        grid.visible = orbital;
        atmosphere.visible = orbital;

        // Stars are the high-altitude backdrop. They fade out between 2000 km and 800 km so they leave
        // cleanly before the ground fills the view (avoids depth-offset bleed over the near surface).
        const starVisible = alt > 800_000;
        stars.visible = starVisible;
        if (starVisible) {
          // Keep the star sphere centred on the camera, scaled to sit just behind Earth's near surface
          // (so Earth occludes the far half) yet inside the dynamic far plane (so it isn't clipped).
          stars.position.copy(camera.position);
          stars.scale.setScalar(1.05 * alt);
          starMat.uniforms.uFade.value = Math.min(1, (alt - 800_000) / 1_200_000);
          if (!reduceMotion) {
            starMat.uniforms.uTime.value = (performance.now() - t0) / 1000;
          }
        }
      } catch (err) {
        console.error("[globe] tiles/controls update error:", err);
      }
    },
    dispose() {
      controls.dispose();
      tiles.dispose();
      ground.dispose();
      styleMat.dispose();
      draco.dispose();
      landMaskTex.dispose();
      elevationTex.dispose();
      normalTex.dispose();
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
