import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildingNightFactor } from "../../../lib/globe/buildingNight";
import {
  lruFloorBytesForCap,
  peripheryErrorTarget,
  type FoveationTierCfg,
  type QueueCaps,
} from "../../../lib/globe/quality";
import { makeClosestFirstComparator, type LoadAim } from "../../../lib/globe/loadPriority";
import {
  bboxClipPrismEcef,
  bboxContainsRad,
  bboxToRadians,
  type GeoBbox,
} from "../../../lib/globe/enrichedMask";
import { BUILDINGS, EARTH, FOVEATION, LOADING, TILESETS } from "../tuning";
import { createBuildingMaterials } from "./buildingMaterial";
import { makeTileCenterReader } from "./tilePriority";
import { makeTileFoveation } from "./tileFoveation";

/**
 * OSM building tiles (Cesium ion, TILESETS.ionAssetId) restyled to the design-board building idiom
 * (canvas ftw-scene): DARK slate mass with lighter edge strokes that catch the light — not a light
 * fill. Flat shading keeps per-facet silhouettes; a faint sage emissive stops the night side going
 * pure black. Accent stays reserved for signal (pins). Tunables: BUILDINGS + TILESETS.
 *
 * Style is applied by material swap on `load-model` (NOT BatchedTilesPlugin — locked invariant).
 * ONE shared fill material + ONE shared edge material (disposed once, here); edge GEOMETRY is
 * per-tile (disposed on `dispose-model`). The material construction itself lives in
 * scene/buildingMaterial.ts (Slice 2) so the enriched Dnipro tileset renders the identical look
 * from its own instance.
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
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): coarsen the skyline + bound tile memory on
   *  weaker tiers. `errorTarget` raises the screen-space error (fewer building tiles); `lruCapBytes`
   *  caps this renderer's own LRU byte budget (already resolved by `lruCapBytesForTier` — `null` =
   *  restore the captured library default, the `high`-tier byte-identical path). */
  setQualityTier(errorTarget: number, lruCapBytes: number | null, queueCaps: QueueCaps | null): void;
  /** UPLIFT U6: per-tier foveation config (QUALITY.tiers[tier].foveation; null = off — the
   *  `high` tier and orbit/2D stay byte-identical). Applied at the next boundary/pose. */
  setFoveation(cfg: FoveationTierCfg | null): void;
  /** UPLIFT U6: FPV boundary flip — ON adds the fovea ray + eye bubble and relaxes the BASE
   *  errorTarget to the periphery value; OFF clears the regions and restores the tier base. */
  setFoveaActive(on: boolean): void;
  /** UPLIFT U6: per-frame WORLD eye + unit look while foveated (no-op otherwise). */
  setFoveaPose(eyeWorld: THREE.Vector3, fwdWorld: THREE.Vector3): void;
  /** DEV probe (__globe.u6()). */
  foveaSnapshot(): { engaged: boolean; baseErrorTarget: number };
  /** /m 2D map mode (UPLIFT U1): `false` DETACHES the tileset — the group leaves the scene
   *  graph (render + every raycast, incl. GlobeControls' whole-scene pivot cast) and `update()`
   *  freezes, so traversal/download/parse stop entirely. Loaded tiles stay in the LRU, so
   *  re-attach is instant where the cache still holds them. Desktop never calls this. */
  setActive(on: boolean): void;
  /** Pass 2 R3 (Dnipro identity): drive the night-side window emissive. Pass the SINE of the sun's
   *  elevation at the view focus (`sunDir·focusUp`); the module converts it to a night factor with
   *  the SAME EARTH.lightsBand terminator the earth + ground use, so the windows light up in step
   *  with the terminator sweeping the city. City-scale — one factor across the skyline is right.
   *  `up` = the view-focus geodetic up; the emissive lights only walls perpendicular to it. */
  setNight(sunElevSin: number, up: THREE.Vector3): void;
  dispose(): void;
}

export function attachBuildings(
  scene: THREE.Scene,
  opts: {
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    ionToken: string;
    /** Dnipro 3D enrichment (Slice 0): when set, MASK the global OSM buildings inside this bbox so
     *  the self-hosted enriched tileset (scene/enrichedBuildings.ts) replaces them there. Null/absent
     *  → no mask (byte-identical to before). */
    maskBbox?: GeoBbox | null;
    /** UPLIFT U5: the shared download-priority aim state (StylizedTiles refreshes it per frame;
     *  the closest-first comparator reads it). Consumed only when LOADING.closestFirst.buildings. */
    loadAim: LoadAim;
  },
): BuildingsHandle {
  // S7d trial flag: Re:Earth Overture buildings (hosted 3D Tiles 1.1, meshopt-compressed glTF)
  // instead of Cesium OSM Buildings — same renderer, same styling, different source. Default OFF.
  const useOverture: boolean = TILESETS.overtureBuildings;
  const tiles = useOverture
    ? new TilesRenderer(TILESETS.overtureTilesetUrl)
    : new TilesRenderer();
  // The renderer's own LRU byte budget at construction (0.4 GB default) — restored on the `high`
  // tier so the byte-identical invariant holds; mid/low actively tighten it (setQualityTier).
  // U2/A9: the min/max pair travels TOGETHER — a cap under the library's 0.3 GiB min floor
  // inverts the eviction band and every parse onto the full cache is discarded (re-stream loop).
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  const lruDefaultMinBytes = tiles.lruCache.minBytesSize;
  // U5: captured queue-concurrency defaults (25 download / 5 parse) — restored on `high` so the
  // byte-identical invariant holds; mid/low tighten them (setQualityTier third arg).
  const dlJobsDefault = tiles.downloadQueue.maxJobs;
  const parseJobsDefault = tiles.parseQueue.maxJobs;
  if (LOADING.closestFirst.buildings) {
    // U5 closest-first: no ancestor stand-in downloads — the library's own traversal now queues
    // only target-SSE tiles, distance-ordered (see tuning.LOADING header). The custom download
    // comparator reproduces that ordering and adds the FPV look-direction bias; the parse queue
    // keeps the library's unified callback (already distance-routed once loadAncestors=false).
    tiles.loadAncestors = false;
    tiles.downloadQueue.priorityCallback = makeClosestFirstComparator(
      opts.loadAim,
      makeTileCenterReader(),
    );
  }
  if (!useOverture) {
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({ apiToken: opts.ionToken, assetId: TILESETS.ionAssetId }),
    );
  }
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }),
  );
  // U6 foveated FPV loading: regions only ever TIGHTEN detail inside the fovea (max-error merge);
  // the periphery win rides the base errorTarget via peripheryErrorTarget. Empty regions == no-op.
  const fovea = makeTileFoveation(tiles, FOVEATION.regionErrorTargetM.buildings);
  tiles.registerPlugin(fovea.plugin);
  // The base (periphery) errorTarget is a pure function of (tier value, fov cfg, fov on) — one
  // writer, recomputed on every input change, so tier flips mid-FPV and boundary flips compose.
  let tierErrorTarget = tiles.errorTarget;
  let fovCfg: FoveationTierCfg | null = null;
  let fovOn = false;
  const applyErrorTarget = () => {
    tiles.errorTarget = peripheryErrorTarget(tierErrorTarget, fovCfg, fovOn);
  };

  // Dnipro 3D enrichment (Slice 0): when an enriched buildings tileset is active, MASK the global
  // Cesium OSM Buildings inside its bbox so the enriched set REPLACES them (doesn't overlay). The
  // library's `calculateTileViewError` hook (3d-tiles-renderer 0.4.28, source-verified) is the clean
  // STOP-TRAVERSAL mask: returning inView=false stops the tile being marked-used / queued / traversed
  // into — no download, no draw, and a loaded one falls out of the used set and LRU-evicts. We test
  // each tile's bounding-sphere CENTRE (lat/lon in the tileset frame, via tiles.ellipsoid — the
  // ReorientationPlugin idiom) against the bbox. A coarse ANCESTOR whose centre is outside the bbox
  // but whose geometry spans it still downloads and draws at low zoom — the Slice-2 clipping-plane
  // prism (below, after the materials) discards those fragments pixel-exactly; this plugin remains
  // the bandwidth/LRU win for every tile it CAN stop. `getSphere`/`getPositionToCartographic` write
  // into reused scratch — no per-frame alloc on this hot path.
  if (opts.maskBbox) {
    const maskRad = bboxToRadians(opts.maskBbox);
    const maskSphere = new THREE.Sphere();
    const maskCarto = { lat: 0, lon: 0, height: 0 };
    tiles.registerPlugin({
      name: "FTW_DNIPRO_OSM_MASK",
      calculateTileViewError(tile: any, target: any) {
        const bv = tile?.engineData?.boundingVolume ?? tile?.cached?.boundingVolume;
        if (!bv) return false;
        bv.getSphere(maskSphere);
        (tiles as unknown as { ellipsoid: { getPositionToCartographic(p: THREE.Vector3, out: typeof maskCarto): void } })
          .ellipsoid.getPositionToCartographic(maskSphere.center, maskCarto);
        if (bboxContainsRad(maskRad, maskCarto.lon, maskCarto.lat)) {
          target.inView = false; // masked — the enriched tileset owns this bbox
          return true;
        }
        return false; // no-op for every tile outside the bbox
      },
    } as any);
  }

  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  scene.add(tiles.group);

  // (The old 90 m TERRAIN.buildingSinkM hack is gone: the ground now RENDERS Cesium World
  // Terrain — the same terrain OSM Buildings are height-clamped to — so bases seat naturally.)

  // The shared building look (fill + edge + injected shader work) — constructed by the ONE factory
  // both tilesets use (scene/buildingMaterial.ts). This module owns the OSM instance; the uniform
  // holders are persistent (onBeforeCompile re-binds them across the transparent-toggle recompile,
  // so state survives).
  const { fillMat: styleMat, edgeMat, uniforms } = createBuildingMaterials();
  const {
    uGhostK,
    uSolidK,
    uGhostAlpha,
    uNowMs,
    uFillBirthMs,
    uEdgeBirthMs,
    uFtwNight,
    uFtwTileSeed,
    uFtwUp,
  } = uniforms;

  // Slice 2 — the CLIPPING-PLANE HOLE. The stop-traversal mask above tests tile CENTRES, so a coarse
  // ANCESTOR tile whose centre is outside the bbox but whose geometry spans it leaks OSM mass across
  // the box at low zoom (browser-confirmed straddle-leak). The pixel-exact fix: a 4-plane ECEF prism
  // over the bbox on BOTH shared materials with `clipIntersection` — three discards ONLY fragments
  // inside all four planes (the bbox interior, where the enriched tileset owns the buildings), no
  // matter which tile delivered them. World space == ECEF here (the OSM tiles group is never
  // translated), so the planes are static — built once. `clipShadows` keeps clipped-away buildings
  // from still casting phantom shadows into the hole. The enriched material (its own instance, no
  // planes) is untouched — that's WHY the factory hands out separate instances.
  if (opts.maskBbox) {
    const clipPlanes = bboxClipPrismEcef(opts.maskBbox).map(
      (p) => new THREE.Plane(new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]), p.constant),
    );
    for (const m of [styleMat, edgeMat] as THREE.Material[]) {
      m.clippingPlanes = clipPlanes;
      m.clipIntersection = true;
      m.clipShadows = true;
    }
    // Gated: local clipping stays off (the renderer default) when no mask is active, so the
    // no-enrichment path is byte-identical to before.
    opts.renderer.localClippingEnabled = true;
  }
  // Ghost-mode edge opacity (lines can't ride the per-fragment fill curve — LineBasicMaterial
  // has no distance falloff worth a custom shader); setGhostSolid blends it back toward the
  // normal stroke as the viewpoint climbs.
  let ghostEdgeOpacity: number = BUILDINGS.edgeOpacity;
  // Pass 2 R2: a low-discrepancy per-tile seed sequence (golden-ratio increment — well-spread, no
  // Math.random) so tone doesn't repeat across tiles even when b3dm batch ids restart at 0 per tile.
  let tileSeedSeq = 0;
  // (S7c grow-on-zoom REMOVED 2026-07-11 same day — owner: unreliable. Buildings render at
  // full height whenever their tiles load; see DECISIONS for the reverted mechanics.)
  tiles.addEventListener("load-model", (e: any) => {
    // One birth stamp per TILE (this load-model event) — the whole b3dm dissolves in as a unit.
    const birthMs = performance.now();
    // Pass 2 R2: one low-discrepancy seed per TILE (golden-ratio increment) — see tileSeedSeq.
    const tileSeed = (tileSeedSeq++ * 0.6180339887498949) % 1.0;
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
        // F1 + Pass 2 R2: feed this tile's birth + tone seed to the shared fill material right
        // before this mesh draws (both constant per tile — cheap writes, no per-tile material).
        c.onBeforeRender = () => {
          uFillBirthMs.value = birthMs;
          uFtwTileSeed.value = tileSeed;
        };
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
        edges.onBeforeRender = () => {
          uEdgeBirthMs.value = birthMs; // F1: same birth, its own holder (separate draw item)
        };
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

  // /m 2D map mode (UPLIFT U1) — see setActive on the handle.
  let active = true;

  return {
    tiles,
    update() {
      if (!active) return; // detached: no reveal clock, no traversal, no streaming
      uNowMs.value = performance.now(); // F1: advance the shared reveal clock before the draw
      tiles.update();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) scene.add(tiles.group);
      else scene.remove(tiles.group);
    },
    setGhost(ghost) {
      // The ghost fade renders as a SCREEN-DOOR dissolve inside the shared shader (owner
      // 2026-07-14: gradual + uniform) — the fill stays OPAQUE and depth-writing at every
      // solidity, so there is no transparent-sort, no recompile toggle, and no binary
      // depthWrite threshold (the old flip near solid read as an instant jump to full
      // opacity between two slider ticks).
      uGhostK.value = ghost ? 1 : 0;
      if (ghost) uGhostAlpha.value = ghost.fillOpacity;
      ghostEdgeOpacity = ghost ? ghost.edgeOpacity : BUILDINGS.edgeOpacity;
      edgeMat.opacity = ghost
        ? ghost.edgeOpacity + (BUILDINGS.edgeOpacity - ghost.edgeOpacity) * uSolidK.value
        : BUILDINGS.edgeOpacity;
    },
    setGhostSolid(k) {
      uSolidK.value = THREE.MathUtils.clamp(k, 0, 1);
      if (uGhostK.value > 0) {
        edgeMat.opacity =
          ghostEdgeOpacity + (BUILDINGS.edgeOpacity - ghostEdgeOpacity) * uSolidK.value;
      }
    },
    setQualityTier(errorTarget, lruCapBytes, queueCaps) {
      tierErrorTarget = errorTarget; // U6: base recomputes through the periphery rule
      applyErrorTarget();
      tiles.lruCache.maxBytesSize = lruCapBytes ?? lruDefaultBytes; // null → captured default (high)
      tiles.lruCache.minBytesSize = lruFloorBytesForCap(lruCapBytes) ?? lruDefaultMinBytes; // U2/A9
      tiles.downloadQueue.maxJobs = queueCaps?.download ?? dlJobsDefault; // U5: null → captured default
      tiles.parseQueue.maxJobs = queueCaps?.parse ?? parseJobsDefault;
    },
    setFoveation(cfg) {
      fovCfg = cfg;
      fovea.configure(cfg);
      applyErrorTarget();
    },
    setFoveaActive(on) {
      fovOn = on;
      fovea.setActive(on);
      applyErrorTarget();
    },
    setFoveaPose(eyeWorld, fwdWorld) {
      fovea.setPose(eyeWorld, fwdWorld);
    },
    foveaSnapshot() {
      return { ...fovea.snapshot(), baseErrorTarget: tiles.errorTarget };
    },
    setNight(sunElevSin, up) {
      uFtwNight.value = buildingNightFactor(sunElevSin, EARTH.lightsBand);
      uFtwUp.value.copy(up); // R3: facade gating up (view-focus geodetic up)
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
