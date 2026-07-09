import * as THREE from "three";
import { TilesRenderer, GlobeControls } from "3d-tiles-renderer";
import {
  CesiumIonAuthPlugin,
  GLTFExtensionsPlugin,
} from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { tokens } from "../../lib/theme/tokens";

/**
 * StylizedTiles — the real, geo-accurate globe (ADR D1). Cesium OSM Buildings (ion asset 96188)
 * loaded via NASA-AMMOS `3d-tiles-renderer`, stylized with the documented `load-model` material
 * override (NOT BatchedTilesPlugin — incompatible), navigated with `GlobeControls`.
 *
 * Dynamically imported by GlobeCanvas ONLY when `PUBLIC_CESIUM_ION_TOKEN` is present, so the base
 * build (procedural globe) never depends on this module or its heavy deps.
 *
 * BROWSER-ONLY / UNVERIFIED until run in `wix dev` with a real ion token (mem:project/dev_environment).
 * TODO(D2 precision): re-center the tiles group near origin (ReorientationPlugin / CESIUM_RTC) to kill
 *   float32 jitter at globe scale, and enable GlobeControls dynamic near/far.
 * TODO: fly the camera to Dnipro (48.4647, 35.0462) on first tileset load to hit the Phase-1 DoD.
 */
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

  // D1 stylization: swap each streamed tile's material to a cool slate. Occlusion-safe.
  const styleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.landHi),
    roughness: 0.85,
    metalness: 0.0,
  });
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) c.material = styleMat;
    });
  });

  // Google-Earth-style navigation. Start far out so the globe-sized tileset resolves (issue #662).
  const controls = new GlobeControls(
    scene,
    camera,
    renderer.domElement,
    tiles,
  );
  camera.position.set(0, 0, 2.4e7);
  camera.lookAt(0, 0, 0);

  return {
    update() {
      controls.update();
      camera.updateMatrixWorld();
      tiles.update();
    },
    dispose() {
      controls.dispose();
      tiles.dispose();
      styleMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
