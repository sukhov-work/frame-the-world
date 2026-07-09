import * as THREE from "three";
import {
  GlobeControls,
  TilesRenderer,
  WGS84_ELLIPSOID,
} from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { tokens } from "../../lib/theme/tokens";

/**
 * StylizedTiles — the real, geo-accurate globe (ADR D1).
 * Cesium OSM Buildings (ion asset 96188) via NASA-AMMOS `3d-tiles-renderer`, stylized with the
 * documented `load-model` material override, navigated with `GlobeControls` (current, non-deprecated
 * API: `setEllipsoid`; no `tilesRenderer` in the constructor).
 *
 * Asset 96188 is buildings-only; buildings only render at city zoom (issue #662). So this module
 * also renders the "premium instrument" LEO backdrop:
 *   • an ECEF-scale stylized base ellipsoid textured with a grayscale world topology so continents
 *     read as navigation cues (Cesium/three-globe topology, self-hosted in /public/textures);
 *   • a subtle lat/lon graticule (front-face-only — vanishes when the camera dives inside);
 *   • a faint accent-tinted atmosphere rim (back-side additive glow at the limb);
 *   • a restrained star-field at ECEF scale, screen-space size so points are readable.
 *
 * Dynamically imported by GlobeCanvas ONLY when `PUBLIC_CESIUM_ION_TOKEN` is present.
 */

// Phase-1 test city (Dnipro, UA).
const DNIPRO_LAT = 48.4647;
const DNIPRO_LON = 35.0462;

// WGS84 semi-axes (m).
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.3;

export interface TilesHandle {
  update: () => void;
  dispose: () => void;
}

export function attachStylizedTiles(opts: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ionToken: string;
}): TilesHandle {
  const { scene, camera, renderer, ionToken } = opts;

  // ============================================================================================
  // 1. Stylized ECEF-scale base ellipsoid — continents visible via a grayscale topology map, so the
  //    user has a navigation reference and knows where to zoom.
  // ============================================================================================
  // NASA/Cesium equirectangular topology (self-hosted in public/textures/).
  const earthTex = new THREE.TextureLoader().load(
    "/textures/earth-topology.png",
  );
  earthTex.colorSpace = THREE.SRGBColorSpace;
  earthTex.wrapS = THREE.RepeatWrapping;
  // UV alignment: SphereGeometry's u=0 seam sits at local -X; after our +π/2 X-rotation that stays
  // at world -X (= 180° in ECEF), which is exactly where standard equirectangular u=0 lives — no
  // offset needed. If continents ever look shifted, tune `earthTex.offset.x`.

  const baseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.landHi), // slate base; topology (grayscale) modulates it
    map: earthTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const base = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), baseMat);
  // Align sphere pole (local +Y) with world +Z (ECEF north); oblate WGS84 shape.
  // Shrunk 0.05% so building tiles never z-fight the surface.
  const shrink = 0.9995;
  base.scale.set(WGS84_A * shrink, WGS84_B * shrink, WGS84_A * shrink); // (X, Y=polar, Z)
  base.rotation.x = Math.PI / 2;
  scene.add(base);

  // ============================================================================================
  // 2. Firmer lat/lon graticule — visible from orbit; FrontSide + wireframe means it back-face-culls
  //    to invisibility when the camera dives inside the shell (avoids a weird "wire cage" up-view).
  // ============================================================================================
  const gridMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tokens.landHi),
    wireframe: true,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  const grid = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), gridMat);
  grid.scale.copy(base.scale).multiplyScalar(1.001); // ~6.4 km above the surface
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  // ============================================================================================
  // 3. Atmosphere rim — accent-tinted back-side additive glow at the limb. Signature "premium
  //    instrument" horizon halo from orbit.
  // ============================================================================================
  const atmMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tokens.accent),
    transparent: true,
    opacity: 0.18,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    atmMat,
  );
  atmosphere.scale.copy(base.scale).multiplyScalar(1.03); // ~200 km shell
  atmosphere.rotation.x = Math.PI / 2;
  scene.add(atmosphere);

  // ============================================================================================
  // 4. Restrained star-field — ECEF-scale, screen-space point size so stars stay readable.
  // ============================================================================================
  const starCount = 2500;
  const starPos = new Float32Array(starCount * 3);
  const starR = 5e8;
  for (let i = 0; i < starCount; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = starR * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = starR * Math.sin(ph) * Math.sin(th);
    starPos[i * 3 + 2] = starR * Math.cos(ph);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5, // pixels (sizeAttenuation:false)
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
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

  const styleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.landHi),
    roughness: 0.7,
    metalness: 0.0,
  });
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) c.material = styleMat;
    });
  });

  // ============================================================================================
  // 6. Camera framing: globe-scale near/far, positioned above Dnipro looking at Earth center.
  // ============================================================================================
  // GlobeControls dynamically refines near/far each update; these are the safe outer bounds.
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
  camera.up.set(0, 0, 1); // ECEF +Z = north pole → north is "up" in the view
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // ============================================================================================
  // 7. GlobeControls (new API) — snappier zoom for trackpad pinch.
  // ============================================================================================
  const controls = new GlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid(WGS84_ELLIPSOID, scene);
  controls.zoomSpeed = 5; // default = 1 (painfully slow on trackpad); 5× makes pinch usable

  return {
    update() {
      // A single bad frame (transient tiles error, WebGL glitch) MUST NOT freeze the canvas.
      try {
        controls.update();
        camera.updateMatrixWorld();
        tiles.update();
      } catch (err) {
        console.error("[globe] tiles/controls update error:", err);
      }
    },
    dispose() {
      controls.dispose();
      tiles.dispose();
      styleMat.dispose();
      draco.dispose();
      earthTex.dispose();
      base.geometry.dispose();
      baseMat.dispose();
      grid.geometry.dispose();
      gridMat.dispose();
      atmosphere.geometry.dispose();
      atmMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      scene.remove(base, grid, atmosphere, stars, tiles.group);
    },
  };
}
