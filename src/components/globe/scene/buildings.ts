import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { tokens } from "../../../lib/theme/tokens";
import { BUILDINGS, FPV, TILESETS } from "../tuning";
import { glf } from "./glsl";

/**
 * OSM building tiles (Cesium ion, TILESETS.ionAssetId) restyled to the design-board building idiom
 * (canvas ftw-scene): DARK slate mass with lighter edge strokes that catch the light — not a light
 * fill. Flat shading keeps per-facet silhouettes; a faint sage emissive stops the night side going
 * pure black. Accent stays reserved for signal (pins). Tunables: BUILDINGS + TILESETS.
 *
 * Style is applied by material swap on `load-model` (NOT BatchedTilesPlugin — locked invariant).
 * ONE shared fill material + ONE shared edge material (disposed once, here); edge GEOMETRY is
 * per-tile (disposed on `dispose-model`).
 */
export interface BuildingsHandle {
  tiles: TilesRenderer;
  update(): void;
  /** FPV ghost mode (Phase 5.5 S2 follow-up): fade ALL buildings so the first-person view is
   *  never lost inside a mesh. Both materials are shared, so this is two uniform writes —
   *  per-tile obstruction testing is impossible without breaking the one-material invariant.
   *  Pass null to restore the normal look. S6: the fill fades per-fragment by CAMERA DISTANCE
   *  (fully transparent inside FPV.buildingGhostNearM, `fillOpacity` beyond buildingGhostFarM)
   *  — distance-from-camera is global, so the falloff rides the shared material's uniforms. */
  setGhost(ghost: { fillOpacity: number; edgeOpacity: number } | null): void;
  /** S6 (owner): 0 = pure ghost curve, 1 = full opacity — the orchestrator drives it from the
   *  FPV eye height above ground (FPV.buildingSolidLoM/HiM): risen over the rooftops, there is
   *  nothing left to see through. Per-frame safe (uniform + two cheap material writes). */
  setGhostSolid(k: number): void;
  dispose(): void;
}

export function attachBuildings(
  scene: THREE.Scene,
  opts: { camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; ionToken: string },
): BuildingsHandle {
  // S7d trial flag: Re:Earth Overture buildings (hosted 3D Tiles 1.1, meshopt-compressed glTF)
  // instead of Cesium OSM Buildings — same renderer, same styling, different source. Default OFF.
  const useOverture: boolean = TILESETS.overtureBuildings;
  const tiles = useOverture
    ? new TilesRenderer(TILESETS.overtureTilesetUrl)
    : new TilesRenderer();
  if (!useOverture) {
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({ apiToken: opts.ionToken, assetId: TILESETS.ionAssetId }),
    );
  }
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }),
  );

  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  scene.add(tiles.group);

  // (The old 90 m TERRAIN.buildingSinkM hack is gone: the ground now RENDERS Cesium World
  // Terrain — the same terrain OSM Buildings are height-clamped to — so bases seat naturally.)

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
  // FPV ghost curve (S6): persistent uniform holders — onBeforeCompile re-binds them across
  // the transparent-toggle recompile, so state survives. uGhostK gates the whole effect (0 in
  // the normal look — the injected math multiplies alpha by exactly 1.0).
  const uGhostK = { value: 0 };
  const uSolidK = { value: 0 };
  const uGhostAlpha = { value: FPV.buildingGhostOpacity as number };
  styleMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGhostK = uGhostK;
    shader.uniforms.uSolidK = uSolidK;
    shader.uniforms.uGhostAlpha = uGhostAlpha;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uGhostK;\nuniform float uSolidK;\nuniform float uGhostAlpha;",
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          // FPV ghost: near the camera the mass melts away entirely (the street stays
          // readable), easing to the ghost opacity with distance; uSolidK lifts the whole
          // curve back to solid as the viewpoint climbs over the rooftops.
          float ftwD = length(vViewPosition);
          float ftwGhostA = uGhostAlpha *
            smoothstep(${glf(FPV.buildingGhostNearM)}, ${glf(FPV.buildingGhostFarM)}, ftwD);
          diffuseColor.a *= mix(1.0, mix(ftwGhostA, 1.0, uSolidK), uGhostK);
        }`,
      );
  };
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.landHi), // lighter than the fill -> pronounced lit edges (design stroke)
    transparent: true,
    opacity: BUILDINGS.edgeOpacity,
  });
  // Ghost-mode edge opacity (lines can't ride the per-fragment fill curve — LineBasicMaterial
  // has no distance falloff worth a custom shader); setGhostSolid blends it back toward the
  // normal stroke as the viewpoint climbs.
  let ghostEdgeOpacity: number = BUILDINGS.edgeOpacity;
  // (S7c grow-on-zoom REMOVED 2026-07-11 same day — owner: unreliable. Buildings render at
  // full height whenever their tiles load; see DECISIONS for the reverted mechanics.)
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
        // Sun shadows (city scale): buildings cast onto the ground twins and onto each other.
        // Tiles arrive with both flags false — the shadow pass skips everything otherwise.
        c.castShadow = true;
        c.receiveShadow = true;
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
    setGhost(ghost) {
      const wasTransparent = styleMat.transparent;
      styleMat.transparent = ghost !== null;
      // Alpha now lives entirely in the injected distance curve — opacity stays 1 so the
      // shader's mix() is the one source (uGhostK 0 renders identical to the pre-S6 look).
      uGhostK.value = ghost ? 1 : 0;
      if (ghost) uGhostAlpha.value = ghost.fillOpacity;
      ghostEdgeOpacity = ghost ? ghost.edgeOpacity : BUILDINGS.edgeOpacity;
      styleMat.depthWrite = ghost === null || uSolidK.value > 0.6; // ghosts must not occlude each other into solidity
      if (wasTransparent !== styleMat.transparent) styleMat.needsUpdate = true; // shader recompile
      edgeMat.opacity = ghost
        ? ghost.edgeOpacity + (BUILDINGS.edgeOpacity - ghost.edgeOpacity) * uSolidK.value
        : BUILDINGS.edgeOpacity;
    },
    setGhostSolid(k) {
      uSolidK.value = THREE.MathUtils.clamp(k, 0, 1);
      if (uGhostK.value > 0) {
        // Near-solid ghosts write depth again — a ~1.0-alpha transparent surface with
        // depthWrite off would show its own back faces through the front.
        styleMat.depthWrite = uSolidK.value > 0.6;
        edgeMat.opacity =
          ghostEdgeOpacity + (BUILDINGS.edgeOpacity - ghostEdgeOpacity) * uSolidK.value;
      }
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
