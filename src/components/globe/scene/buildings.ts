import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { tokens } from "../../../lib/theme/tokens";
import { BUILDINGS, TERRAIN, TILESETS } from "../tuning";

/**
 * OSM building tiles (Cesium ion, TILESETS.ionAssetId) restyled to the design-board building idiom
 * (canvas ftw-scene): DARK slate mass with lighter edge strokes that catch the light — not a light
 * fill. Flat shading keeps per-facet silhouettes; a faint sage emissive stops the night side going
 * pure black. Accent stays reserved for signal (pins). Tunables: BUILDINGS + TERRAIN + TILESETS.
 *
 * Style is applied by material swap on `load-model` (NOT BatchedTilesPlugin — locked invariant).
 * ONE shared fill material + ONE shared edge material (disposed once, here); edge GEOMETRY is
 * per-tile (disposed on `dispose-model`).
 */
export interface BuildingsHandle {
  tiles: TilesRenderer;
  update(): void;
  dispose(): void;
}

export function attachBuildings(
  scene: THREE.Scene,
  opts: { camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; ionToken: string },
): BuildingsHandle {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({ apiToken: opts.ionToken, assetId: TILESETS.ionAssetId }),
  );
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));

  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  scene.add(tiles.group);

  // Cesium OSM Buildings are clamped to Cesium World Terrain, so building bases sit at terrain
  // elevation ABOVE the ellipsoid our imagery ground drapes on — they read as floating. Sink the
  // whole layer by the test city's mean terrain height (TERRAIN.buildingSinkM; city-specific
  // interim until real terrain lands).
  const cityUp = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToNormal(
    (TERRAIN.cityLatDeg * Math.PI) / 180,
    (TERRAIN.cityLonDeg * Math.PI) / 180,
    cityUp,
  );
  tiles.group.position.addScaledVector(cityUp, -TERRAIN.buildingSinkM);

  const styleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.surface), // dark slate mass (design building front #0F151D–#12161C)
    roughness: BUILDINGS.roughness,
    metalness: 0.0,
    flatShading: true, // crisp per-facet silhouettes (the documented stylization move)
    emissive: new THREE.Color(tokens.land),
    emissiveIntensity: BUILDINGS.emissiveIntensity,
    side: THREE.DoubleSide, // guard against missing backfaces on some b3dm tiles
  });
  // Push the building faces back a hair so their OWN edge lines win the depth tie (lines ignore
  // polygonOffset). Still less than the ground's offset, so bases keep winning vs the imagery.
  styleMat.polygonOffset = true;
  styleMat.polygonOffsetFactor = BUILDINGS.polygonOffset;
  styleMat.polygonOffsetUnits = BUILDINGS.polygonOffset;
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.landHi), // lighter than the fill -> pronounced lit edges (design stroke)
    transparent: true,
    opacity: BUILDINGS.edgeOpacity,
  });
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
        // Pronounced edges: hard creases as line segments riding the mesh. The added child is
        // a LineSegments, so the isMesh branch skips it when traverse reaches it.
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(c.geometry, BUILDINGS.edgeAngleDeg),
          edgeMat,
        );
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

  return {
    tiles,
    update() {
      tiles.update();
    },
    dispose() {
      tiles.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
