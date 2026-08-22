import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { tokens } from "../../../lib/theme/tokens";
import { clampGroundM } from "../../../lib/geo/terrain";
import { ecefToGeodetic, geodeticToEcef } from "../../../lib/geo/projection";
import { buildingNightFactor } from "../../../lib/globe/buildingNight";
import {
  lruFloorBytesForCap,
  peripheryErrorTarget,
  type FoveationTierCfg,
  type QueueCaps,
} from "../../../lib/globe/quality";
import { makeClosestFirstComparator, type LoadAim } from "../../../lib/globe/loadPriority";
import {
  bboxCenterDeg,
  csrFromRunIds,
  featureRunsOf,
  mapVertsToRuns,
  regionCenterDeg,
  runCentroid,
  runIndexOfVertex,
  seatStep,
  vertexKeyToRun,
  type FeatureRun,
  type GeoBbox,
} from "../../../lib/globe/enrichedMask";
import {
  checksumMatches,
  NEUTRAL_K_EPS,
  SCALE_MAX_K,
  SCALE_MIN_K,
} from "../../../lib/globe/bldgOverrides";
import { EARTH, ENRICHED, FOVEATION, LOADING, TILESETS, TREES } from "../tuning";
import { createBuildingMaterials, FTW_BAYER_GLSL } from "./buildingMaterial";
import { makeTileCenterReader } from "./tilePriority";
import { makeTileFoveation } from "./tileFoveation";

/**
 * Dnipro 3D enrichment — a THIRD `TilesRenderer` (Slice 0 de-risk spike). It streams a SELF-HOSTED
 * 3D-Tiles set (a plain HTTPS URL — Cloudflare R2 in production, or `bakes/enriched/` served at
 * `/enriched/*` by the dev middleware; NO Cesium ion auth) of roof-shaped enriched buildings, styled to the same
 * "dark mass, lit edges" idiom as the global OSM buildings, and seated on the RENDERED terrain.
 *
 * ── R1 (the #1 spike risk) — VERTICAL-DATUM SEATING ─────────────────────────────────────────────
 * Cesium World Terrain renders WGS84-ELLIPSOIDAL heights; open DEMs are geoid-orthometric (GLO-30 =
 * EGM2008, N≈+20.42 m over Dnipro), so a naive absolute-Z bake sinks buildings ~20 m. The verified
 * strategy is therefore to clamp to CWT AT RUNTIME (research 2026-07-13): the sample is baked with its
 * ground at ellipsoid h=0, and this module lifts the whole `tiles.group` by the terrain height sampled
 * at the bbox centre (`terrainHeightAt` — the same rendered-CWT ellipsoidal sampler the frustum/pins
 * seat on). `ENRICHED.seatOffsetM` is the browser nudge for any residual; set
 * `ENRICHED.reseatToTerrain=false` for a tileset already baked to CWT-consistent ellipsoidal Z.
 *
 * ── Slice 2 — PER-CELL RE-SEAT (owner #4: "buildings sit at water level") ───────────────────────
 * One centre lift seats a city-BLOCK within cm, but over the ~6 km bake the terrain itself varies
 * (riverbank → hills) and a single plane floats/sinks whole districts. Each grid cell is a separate
 * leaf tile whose raw `boundingVolume.region` the baker wrote from actual building extents, so on
 * `load-model` we register the cell, round-robin sample the rendered terrain at each cell's OWN
 * centre (`ENRICHED.reseatSamplesPerFrame` bounds the raycast cost), and offset the cell's scene in
 * the GROUP frame along the cell's geodetic up by (cell seat − centre seat) — the identical frame
 * and up-vector construction the browser-verified group lift uses, just per cell. First sample
 * snaps, refinements ease (`seatStep`). TRAP: `TilesGroup.updateMatrixWorld` only recurses into
 * children when the GROUP matrix changed — every scene.position write must force
 * `scene.updateMatrixWorld(true)` itself (the library does the same on visibility flips).
 * The cell content shifts against its static bounding volume by |delta| ≤ a few tens of metres;
 * the baker pads region heights (RESEAT_PAD_M) so culling never clips a lifted cell.
 *
 * The masking of the OSM buildings UNDER this bbox lives in scene/buildings.ts (a stop-traversal
 * `calculateTileViewError` plugin). This module owns only the enriched tileset itself. ONE shared fill
 * material + ONE shared edge material (disposed once, here); edge GEOMETRY is per-tile.
 *
 * ── Slice 3 — TREES ─────────────────────────────────────────────────────────────────────────────
 * The baker writes an `EXT_mesh_gpu_instancing` node ("ftw-trees") into each cell glb; three's
 * GLTFLoader (default extension, source-verified 0.185) turns it into ONE InstancedMesh per cell —
 * so trees inherit the cell streaming, LRU and per-cell terrain re-seat with zero extra machinery.
 * Here they get the ONE shared canopy material (vecGreen, flat-shaded, night-dimmed in setNight),
 * cast/receive shadows, and are excluded from raycasts (InstancedMesh.raycast iterates every
 * instance — a pointer-down pivot pick must never pay that). TRAP (source-verified): the library's
 * tile disposal never calls mesh.dispose(), and instanceMatrix lives on the MESH — dispose-model
 * must call it or every LRU eviction leaks the instance GL buffer.
 *
 * ── PER-BUILDING RE-SEAT (owner 2026-07-14: "buildings sunk into / levitating above ground") ────
 * The per-cell plane still leaves WITHIN-cell relief error (±10 m on steep ~0.9 km cells) — so on
 * top of the cell seat, every building and tree lifts by (terrain@its-own-footprint − cell seat):
 *  · A building = one contiguous `_feature_id_0` vertex run (the baker emits each footprint in one
 *    pass) → the delta is written INTO the position attribute's local Y (glb local +Y IS geodetic
 *    up: the baker maps ENU (e,n,u) → glTF (e,u,−n)). CPU mutation, deliberately: the occlusion
 *    sweeps (lib/geo/occlusion.ts), shadow maps and controls picks all read the same arrays, so a
 *    shader displacement would desync the skyline planner from what's rendered.
 *  · The cell's EdgesGeometry strokes are separate COPIES of the source floats → an exact-position
 *    key map built at load (pristine buffer) buckets edge verts per building (CSR), co-mutated.
 *  · A tree = one instanceMatrix column-Y translation (m13 += delta) — sweepTreeInstances reads
 *    the same array, so the planner sees the lifted canopy too.
 * Sampling is budgeted (reseatFeatureSamplesPerFrame / reseatTreeSamplesPerFrame): half the budget
 * always goes to the cell NEAREST the camera (the street you stand on seats in ~1 s), half sweeps
 * all loaded cells round-robin. First sample SNAPS (tile is still streaming in), refinements ease
 * (`seatStep`); geometry bounding volumes get a one-time pad (reseatBoundsPadM). `seatState()`
 * exposes an epoch + quiet-frames counter so the orchestrator can invalidate a skyline profile
 * built over pre-seat geometry exactly once, after the writes settle.
 *
 * ── U8 — PER-BUILDING HEIGHT OVERRIDE (owner 2026-08-18) ────────────────────────────────────────
 * Double-click/tap in FPV arms a building; a drag rescales it. This module owns the geometry side:
 *  · Pick: the fill meshes keep their default raycast (decorations are noop'd for exactly this) —
 *    a hit on a NON-INDEXED cell mesh gives `face.a` = a direct vertex index (source-verified
 *    three 0.18x), binary-searched through the cached run table (`runIndexOfVertex`).
 *  · The override is a SCALE about the building's LIVE base (baseY + appliedM), applied inside
 *    `applyFeatureSeats` — the ONE writer of the position arrays. A scale about the live base
 *    commutes with the seat's incremental `+= dy` translation (a later dy shifts base and spans
 *    together), so the two can never fight; the edge CSR gets the identical formula and the
 *    settle epoch bumps as usual (skyline/occlusion re-profile for free).
 *  · Pristine per-run capture at load-model (baseY/topY/centroid X-Z) feeds the checksum that
 *    invalidates persisted rows after a re-bake, the "original height" display, and the ghost.
 *  · The GHOST (drag preview) is the run's geometry rebased so the base sits at local y=0 —
 *    the whole drag is `ghost.scale.y = k`, zero per-frame geometry writes. MeshBasicMaterial,
 *    transparent, depthTest OFF (reads "on top" through the solid original in grow AND shrink),
 *    XZ inflated a hair so coincident faces never shimmer. The REAL mesh stays untouched until
 *    the orchestrator commits via `setHeightScale`.
 */

/** U8 — one resolved building pick (the arm target). `cx/cz/vc` are the pristine checksum
 *  fields (bake-local metres, un-rounded — the store rounds); `distance` (m) feeds the drag gain. */
export interface BuildingPick {
  cellUri: string;
  featureId: number;
  bakedHeightM: number;
  /** Committed scale target (1 = original). */
  currentK: number;
  distance: number;
  cx: number;
  cz: number;
  vc: number;
}
export interface EnrichedBuildingsHandle {
  tiles: TilesRenderer;
  /** Per-frame: R1 re-seat to the rendered terrain + tile streaming/LOD. */
  update(): void;
  /** Adaptive quality (mirrors BuildingsHandle): raise screen-space error + bound LRU bytes on weaker
   *  tiers. `lruCapBytes` null → restore the captured library default. U5: `queueCaps` bounds the
   *  download/parse concurrency the same way (null → captured defaults). */
  setQualityTier(errorTarget: number, lruCapBytes: number | null, queueCaps: QueueCaps | null): void;
  /** UPLIFT U6 (mirrors BuildingsHandle): per-tier foveation config (null = off). */
  setFoveation(cfg: FoveationTierCfg | null): void;
  /** UPLIFT U6: FPV boundary flip — regions on/off + periphery relax/restore. */
  setFoveaActive(on: boolean): void;
  /** UPLIFT U6: per-frame WORLD eye + unit look while foveated. The adapter converts through
   *  group.matrixWorldInverse — which here carries the R1 seat lift, not identity. */
  setFoveaPose(eyeWorld: THREE.Vector3, fwdWorld: THREE.Vector3): void;
  /** DEV probe (__globe.u6()). */
  foveaSnapshot(): { engaged: boolean; baseErrorTarget: number };
  /** FPV building shading (owner ask): `k` 0 = see-through wireframe (bright edges, ~0.28 fill),
   *  1 = opaque shaded (faint edges). `null` restores the non-FPV default (opaque, ENRICHED edges). */
  setSolidity(k: number | null): void;
  /** Pass 2 R3 night hook (mirrors BuildingsHandle.setNight — one ephemeris sample drives both
   *  tilesets). Dormant while BUILDINGS.nightWindowGain is 0, wired so the sets can never drift. */
  setNight(sunElevSin: number, up: THREE.Vector3): void;
  /** ULTRA S4 aerial perspective (T45) — mirrors BuildingsHandle.setUltraHaze; the orchestrator
   *  pushes ONE haze number to the ground and both building sets, so they cannot drift. */
  setUltraHaze(haze: number, col: THREE.Color, sunW: THREE.Vector3): void;
  /** /m 2D map mode (UPLIFT U1) — mirrors BuildingsHandle.setActive: `false` removes the group
   *  from the scene graph and freezes update() (no traversal/streaming/re-seat work); loaded
   *  cells stay LRU-cached for an instant re-attach. Desktop never calls this. */
  setActive(on: boolean): void;
  /** Per-building re-seat progress: `epoch` bumps on every frame that WROTE seating deltas,
   *  `quietFrames` counts frames since the last write. The orchestrator invalidates a ready
   *  skyline profile once per settled epoch (PLAN.reseatQuietFrames). */
  seatState(): { epoch: number; quietFrames: number };
  /** U8 pick: raycast the enriched fill meshes; the first qualifying hit (baked height ≥
   *  ENRICHED.overrideMinPickHeightM — skips the o2w fences/lamps) resolves through the cached
   *  run table. Null = no building under the ray. */
  pickBuilding(raycaster: THREE.Raycaster): BuildingPick | null;
  /** U8 commit: set a building's height-scale target (1 = original). The next frames ease the
   *  REAL mesh there inside applyFeatureSeats (fill + edge CSR + bounds pad + committed tint). */
  setHeightScale(cellUri: string, featureId: number, k: number): void;
  /** U8 ghost preview (drag-time). `showGhost` builds the rebased semi-transparent copy over the
   *  solid original (false = cell not loaded); `setGhostK` is the live drag scale; `hideGhost`
   *  removes + disposes. At most one ghost exists. */
  showGhost(cellUri: string, featureId: number): boolean;
  setGhostK(k: number): void;
  hideGhost(): void;
  /** U8 armed-run tint — the RAW baked feature id (null = disarm). */
  setArmedId(featureId: number | null): void;
  /** U8: world position of the building's roof centre at height-scale `k` (the pinned
   *  dual-height label anchor). False when the cell isn't loaded. */
  buildingTopWorld(cellUri: string, featureId: number, k: number, out: THREE.Vector3): boolean;
  /** DEV introspection (window.__globe) — per-feature re-seat coverage + applied-delta spread. */
  debugSeats(): {
    cells: number;
    located: number;
    features: number;
    featuresSampled: number;
    featureAppliedMinM: number;
    featureAppliedMaxM: number;
    /** U8: features with a non-neutral height-scale target (browser-verify probe). */
    overridden: number;
    trees: number;
    treesSampled: number;
    epoch: number;
    quietFrames: number;
  };
  dispose(): void;
}

export function attachEnrichedBuildings(
  scene: THREE.Scene,
  opts: {
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    /** Plain HTTPS (or same-origin) URL to the enriched `tileset.json`. */
    url: string;
    /** The city bbox (deg) — its centre is the R1 re-seat sample point. */
    bbox: GeoBbox;
    /** Rendered-CWT ellipsoidal height sampler (ground.heightAt); null while tiles load. */
    terrainHeightAt: (latDeg: number, lonDeg: number) => number | null;
    /** UPLIFT U5: the shared download-priority aim state (mirrors attachBuildings.loadAim). */
    loadAim: LoadAim;
    /** U8: persisted height overrides for THIS variant — consulted per cell at load-model (LRU
     *  reloads re-apply for free). A checksum mismatch (re-bake reshuffled ids) reports through
     *  `onInvalid` so the orchestrator drops the stored row. Omit = overrides disabled (the
     *  `?enriched=<url>` verbatim dev seam has no stable variant identity). */
    overrides?: {
      forCell(
        cellUri: string,
      ): Array<{ featureId: number; k: number; cx: number; cz: number; vc: number }>;
      onInvalid(cellUri: string, featureId: number): void;
    };
  },
): EnrichedBuildingsHandle {
  const tiles = new TilesRenderer(opts.url);
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  const lruDefaultMinBytes = tiles.lruCache.minBytesSize; // U2/A9: min/max travel as a pair
  const dlJobsDefault = tiles.downloadQueue.maxJobs; // U5: restored on `high`
  const parseJobsDefault = tiles.parseQueue.maxJobs;
  if (LOADING.closestFirst.enriched) {
    // U5 closest-first (see buildings.ts / tuning.LOADING): nearest cells stream first; the
    // enriched tree is shallow (root → ~1 km leaf cells) so dropping ancestors costs nothing.
    tiles.loadAncestors = false;
    tiles.downloadQueue.priorityCallback = makeClosestFirstComparator(
      opts.loadAim,
      makeTileCenterReader(),
    );
  }
  tiles.errorTarget = ENRICHED.errorTarget;
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }),
  );
  // #15(c) (batch #4 S3): enriched cells are bake-content-addressed R2 binaries → immutable.
  // Claim ONLY the .glb content fetches with HTTP force-cache (skips revalidation);
  // tileset.json declines → the default fetch keeps revalidating. Same claimer shape +
  // priority slot as FTW_TERRAIN_PATCH (no ion auth on this renderer to defer to).
  tiles.registerPlugin({
    name: "FTW_ENRICHED_FORCE_CACHE",
    priority: -500,
    fetchData(url: string | URL, options: RequestInit) {
      const u = String(url);
      if (!u.endsWith(".glb")) return null;
      return fetch(u, { ...options, cache: "force-cache" });
    },
  } as never);
  // U6 foveated FPV loading (mirrors buildings.ts): regions tighten inside the fovea only; the
  // periphery rides the base errorTarget through the same one-writer recompute.
  const fovea = makeTileFoveation(tiles, FOVEATION.regionErrorTargetM.enriched);
  tiles.registerPlugin(fovea.plugin);
  let tierErrorTarget = tiles.errorTarget;
  let fovCfg: FoveationTierCfg | null = null;
  let fovOn = false;
  const applyErrorTarget = () => {
    tiles.errorTarget = peripheryErrorTarget(tierErrorTarget, fovCfg, fovOn);
  };
  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  scene.add(tiles.group);

  // Stylization reconcile (Slice 2): the enriched set renders from the SAME material construction
  // as the global OSM buildings (scene/buildingMaterial.ts) — R2 per-building tone keyed on the
  // baked `_feature_id_0`, the F1 screen-door reveal, the dormant R3 night hooks — so both tilesets
  // read as ONE city. Its OWN instance though: Slice 2 also puts the bbox clipping-plane hole on the
  // OSM material, and the enriched set lives inside that prism (a literally-shared material would
  // clip it away). Edge tint stays flippable to accent (ENRICHED.debugDistinctEdges) for A/B.
  const { fillMat: styleMat, edgeMat, uniforms } = createBuildingMaterials({
    edgeColor: ENRICHED.debugDistinctEdges ? tokens.accent : tokens.landHi,
    edgeOpacity: ENRICHED.edgeOpacity,
  });
  // Slice 3 trees: the baker writes an EXT_mesh_gpu_instancing node per cell → three loads it as an
  // InstancedMesh; ONE shared flat-shaded canopy material (vecGreen — the vector-web vegetation
  // family), night-dimmed CPU-side in setNight (one colour write per ephemeris sample — no shader).
  const treeBaseColor = new THREE.Color(tokens.vecGreen);
  const treeMat = new THREE.MeshStandardMaterial({
    color: treeBaseColor.clone(),
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  // FPV BUILDINGS-slider fade for the canopies: the SAME screen-door dissolve the building fill
  // uses (owner 2026-07-14: gradual + uniform) — the material stays opaque + depth-writing at
  // every slider value, so trees never alpha-sort against buildings or flip look at a threshold.
  const uTreeAlpha = { value: 1 };
  treeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFtwTreeAlpha = uTreeAlpha;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uFtwTreeAlpha;
        ${FTW_BAYER_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        if (uFtwTreeAlpha < 0.999) {
          float ftwTFb = (0.5 + ftwBayer4(floor(mod(gl_FragCoord.xy, 4.0)))) / 16.0;
          if (ftwTFb > uFtwTreeAlpha) discard;
        }`,
      );
  };
  // Pass 2 R2: a low-discrepancy per-tile seed sequence (golden-ratio increment — well-spread, no
  // Math.random). The baker's feature ids are GLOBAL across the bake, so the seed mostly decorrelates
  // this set from same-id OSM tiles; it also keeps the construction identical to buildings.ts.
  let tileSeedSeq = 0;

  // Per-cell re-seat registry: one record per LOADED leaf cell (created on load-model from the
  // tile's raw region bounding volume, dropped on dispose-model). `list` is the round-robin
  // iteration order; `byScene` keys the dispose. Seats are sticky-last-good per cell.
  interface FeatureSeat {
    run: FeatureRun;
    latDeg: number; // footprint sample point (lazy — needs a settled cell matrixWorld)
    lonDeg: number;
    seatM: number | null; // sticky last-good terrain at the footprint
    appliedM: number | null; // delta currently baked into the geometry (null = on the cell plane)
    // U8 — pristine per-run capture (load-model, BEFORE any write; Y mutates afterward):
    baseY: number; // pristine min local Y (the building's base)
    topY: number; // pristine max local Y (baked height = topY − baseY)
    cx: number; // pristine centroid X/Z (bake-local m) — checksum + ghost inflate centre
    cz: number;
    scaleK: number; // height-scale TARGET (1 = original; set by commit / persisted rows)
    appliedK: number; // scale currently baked into the geometry (eases toward scaleK)
  }
  interface MeshPart {
    mesh: THREE.Mesh;
    posAttr: THREE.BufferAttribute;
    edgeAttr: THREE.BufferAttribute | null;
    edgeGeom: THREE.BufferGeometry | null; // U8: bounds-pad growth needs the edge geometry too
    /** Edge-vertex indices bucketed per feature run (CSR) — built from the pristine buffers. */
    edgeCsr: { offsets: Int32Array; verts: Int32Array } | null;
    runs: FeatureRun[]; // the runIndexOfVertex table (same objects features[].run wrap)
    features: FeatureSeat[];
    runIdx: Map<number, number>; // baked feature id → features[] index (pick / override apply)
    extraPadM: number; // U8: bounds radius already grown past the base reseat pad
    cursor: number; // round-robin feature sampling cursor
  }
  interface TreeSet {
    mesh: THREE.InstancedMesh;
    latDeg: Float64Array; // per-instance footprint (lazy-located with the cell)
    lonDeg: Float64Array;
    seatM: Float32Array; // NaN = never sampled
    appliedM: Float32Array; // NaN = on the cell plane
    cursor: number;
  }
  interface CellSeat {
    scene: THREE.Object3D;
    uri: string; // U8 — the baked content uri basename ("cell-10-10.glb"): env-invariant identity
    latDeg: number;
    lonDeg: number;
    up: THREE.Vector3; // geodetic up at the CELL centre, in the (unrotated) group frame
    basePos: THREE.Vector3; // scene.position as the library decomposed it at load
    seatM: number | null; // last-good terrain height at the cell centre (null = never sampled)
    appliedM: number | null; // eased delta currently applied (null = base, untouched)
    ecef: THREE.Vector3; // cell centre at h=0 — the nearest-cell priority metric
    parts: MeshPart[]; // per-building re-seat registries (empty when the gate is off)
    trees: TreeSet[];
    located: boolean; // feature/tree footprints resolved to lat/lon (one-shot per cell)
  }
  const cellList: CellSeat[] = [];
  const cellByScene = new Map<THREE.Object3D, CellSeat>();
  // U8 registries: cell identity for the persistence key + mesh → registry for the pick path.
  const cellByUri = new Map<string, CellSeat>();
  const partByMesh = new Map<THREE.Mesh, { cell: CellSeat; part: MeshPart }>();
  // U8 ghost (at most one — the drag preview). Owns its geometry; material is shared below.
  let ghost: { mesh: THREE.Mesh; geom: THREE.BufferGeometry; cellScene: THREE.Object3D } | null =
    null;
  const ghostMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tokens.accent), // D14: GL colour through the token bridge
    transparent: true,
    opacity: ENRICHED.overrideGhostOpacity,
    depthTest: false, // "on top" through the solid original — grow AND shrink stay readable
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const hideGhostImpl = () => {
    if (!ghost) return;
    ghost.mesh.parent?.remove(ghost.mesh);
    ghost.geom.dispose();
    ghost = null;
  };
  /** U8: committed-override tint mask (`_ftw_override`, Uint8 normalized — the shared building
   *  shader zero-fills geometries without it, so the attribute is created lazily on first use). */
  const setOverrideTint = (part: MeshPart, runI: number, on: boolean) => {
    const geom = part.mesh.geometry as THREE.BufferGeometry;
    let attr = geom.getAttribute("_ftw_override") as THREE.BufferAttribute | undefined;
    if (!attr) {
      if (!on) return;
      attr = new THREE.BufferAttribute(new Uint8Array(part.posAttr.count), 1, true);
      geom.setAttribute("_ftw_override", attr);
    }
    const { start, count } = part.features[runI].run;
    (attr.array as Uint8Array).fill(on ? 255 : 0, start, start + count);
    attr.needsUpdate = true;
  };
  /** U8: a tall override can outgrow the one-time reseat bounds pad — grow the fill+edge
   *  bounding spheres by the extra height (monotonic; shrink never un-grows, harmless). */
  const growBoundsFor = (part: MeshPart, f: FeatureSeat, k: number) => {
    const need = Math.max(0, (f.topY - f.baseY) * (k - 1));
    if (need <= part.extraPadM) return;
    for (const g of [part.mesh.geometry as THREE.BufferGeometry, part.edgeGeom]) {
      if (g?.boundingSphere) g.boundingSphere.radius += need - part.extraPadM;
    }
    part.extraPadM = need;
  };
  /** U8: resolve (cellUri, featureId) → the live registry entry, or null while unloaded. */
  const findFeature = (
    cellUri: string,
    featureId: number,
  ): { cell: CellSeat; part: MeshPart; f: FeatureSeat; runI: number } | null => {
    const cell = cellByUri.get(cellUri);
    if (!cell) return null;
    for (const part of cell.parts) {
      const runI = part.runIdx.get(featureId);
      if (runI !== undefined) return { cell, part, f: part.features[runI], runI };
    }
    return null;
  };
  let rrCursor = 0;
  // Per-building re-seat state: sampling cursors + the settle telemetry for seatState().
  let frameNo = 0;
  let nearestCell: CellSeat | null = null;
  let cellSweep = 0; // global round-robin cell cursor (building sampling)
  let treeSweep = 0; // ditto for tree sampling
  let seatEpochN = 0;
  let seatQuietN = 0;
  const _w = new THREE.Vector3();

  tiles.addEventListener("load-model", (e: any) => {
    // One birth stamp per TILE (this load-model event) — the whole cell dissolves in as a unit
    // (the F1 screen-door reveal, same as the OSM tiles). One tone seed per tile, ditto.
    const birthMs = performance.now();
    const tileSeed = (tileSeedSeq++ * 0.6180339887498949) % 1.0;
    const region = e.tile?.boundingVolume?.region;
    let cell: CellSeat | null = null;
    if (ENRICHED.reseatToTerrain && ENRICHED.reseatPerCell && Array.isArray(region)) {
      const c = regionCenterDeg(region);
      const up = new THREE.Vector3();
      WGS84_ELLIPSOID.getCartographicToNormal((c.latDeg * Math.PI) / 180, (c.lonDeg * Math.PI) / 180, up);
      const ecef = geodeticToEcef(c.latDeg, c.lonDeg, 0);
      // U8: the baked content uri BASENAME ("cell-10-10.glb") — authored relative by the baker
      // and left untouched by the library, so it's byte-identical between the dev middleware
      // and the R2 worker (basename defensively, in case a library version absolutizes).
      const uri = String(e.tile?.content?.uri ?? "").split("/").pop() ?? "";
      cell = {
        scene: e.scene,
        uri,
        latDeg: c.latDeg,
        lonDeg: c.lonDeg,
        up,
        basePos: e.scene.position.clone(),
        seatM: null,
        appliedM: null,
        ecef: new THREE.Vector3(ecef[0], ecef[1], ecef[2]),
        parts: [],
        trees: [],
        located: false,
      };
      cellList.push(cell);
      cellByScene.set(e.scene, cell);
      if (uri) cellByUri.set(uri, cell);
    }
    e.scene.traverse((c: any) => {
      // Trees FIRST — InstancedMesh passes `isMesh` too, and must NOT get the building material,
      // the F1 birth writes, or an EdgesGeometry built from its (single-tree) base geometry.
      if (c.isInstancedMesh) {
        const orig = c.material;
        c.material = treeMat;
        if (orig && orig !== treeMat) orig.dispose();
        c.castShadow = TREES.castShadow;
        c.receiveShadow = true;
        // three's InstancedMesh.raycast iterates EVERY instance; GlobeControls raycasts the whole
        // scene on pointer-down. Trees are decoration — never let them eat a pivot pick.
        c.raycast = () => {};
        // Per-tree re-seat registry (translation column m13 is the pure local-up shift; the
        // yaw-about-Y baked rotation never mixes it — occlusion.ts reads the same layout).
        if (cell && ENRICHED.reseatPerFeature && c.instanceMatrix?.array instanceof Float32Array) {
          const n = c.count as number;
          cell.trees.push({
            mesh: c,
            latDeg: new Float64Array(n),
            lonDeg: new Float64Array(n),
            seatM: new Float32Array(n).fill(NaN),
            appliedM: new Float32Array(n).fill(NaN),
            cursor: 0,
          });
        }
        return;
      }
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat;
        if (orig && orig !== styleMat) orig.dispose();
        // F1 + Pass 2 R2: feed this tile's birth + tone seed to the shared fill material right
        // before this mesh draws (both constant per tile — cheap writes, no per-tile material).
        c.onBeforeRender = () => {
          uniforms.uFillBirthMs.value = birthMs;
          uniforms.uFtwTileSeed.value = tileSeed;
        };
        c.castShadow = true;
        c.receiveShadow = true;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(c.geometry, ENRICHED.edgeAngleDeg),
          edgeMat,
        );
        edges.raycast = () => {}; // never let GlobeControls pick a decoration line
        edges.onBeforeRender = () => {
          uniforms.uEdgeBirthMs.value = birthMs; // F1: same birth, its own holder (separate draw item)
        };
        c.add(edges);
        // Per-building re-seat registry: contiguous `_feature_id_0` runs + the exact-position
        // CSR that lets each building drag ITS OWN edge verts along. Built from the PRISTINE
        // buffers (before any delta) — the key map must match what EdgesGeometry copied.
        if (cell && ENRICHED.reseatPerFeature) {
          const fid = c.geometry.getAttribute("_feature_id_0");
          const posAttr = c.geometry.getAttribute("position");
          const plainF32 =
            posAttr &&
            !posAttr.isInterleavedBufferAttribute &&
            !posAttr.normalized &&
            posAttr.array instanceof Float32Array;
          if (fid && plainF32) {
            const runs = featureRunsOf(fid.array);
            const keyMap = vertexKeyToRun(posAttr.array, runs);
            const edgeAttr = edges.geometry.getAttribute("position") as THREE.BufferAttribute | null;
            const edgeCsr = edgeAttr
              ? csrFromRunIds(mapVertsToRuns(edgeAttr.array, keyMap), runs.length)
              : null;
            // One-time bounds pad: verts will shift by up to ~±15 m — picks and the planner's
            // trust-radius cull must keep seeing the cell (region volumes are baker-padded).
            for (const g of [c.geometry, edges.geometry]) {
              if (!g.boundingSphere) g.computeBoundingSphere();
              if (g.boundingSphere) g.boundingSphere.radius += ENRICHED.reseatBoundsPadM;
            }
            // U8: pristine per-run capture (base/top Y + centroid X/Z) — MUST happen here,
            // before any seat write mutates Y. Baked height, checksum and ghost all read these.
            const posArr = posAttr.array as Float32Array;
            const runIdx = new Map<number, number>();
            const features: FeatureSeat[] = runs.map((run, i) => {
              runIdx.set(run.id, i);
              let baseY = Infinity;
              let topY = -Infinity;
              let sx = 0;
              let sz = 0;
              for (let v = run.start; v < run.start + run.count; v++) {
                const y = posArr[v * 3 + 1];
                if (y < baseY) baseY = y;
                if (y > topY) topY = y;
                sx += posArr[v * 3];
                sz += posArr[v * 3 + 2];
              }
              const n = Math.max(1, run.count);
              return {
                run,
                latDeg: 0,
                lonDeg: 0,
                seatM: null,
                appliedM: null,
                baseY,
                topY,
                cx: sx / n,
                cz: sz / n,
                scaleK: 1,
                appliedK: 1,
              };
            });
            const part: MeshPart = {
              mesh: c,
              posAttr,
              edgeAttr,
              edgeGeom: edges.geometry,
              edgeCsr,
              runs,
              features,
              runIdx,
              extraPadM: 0,
              cursor: 0,
            };
            cell.parts.push(part);
            partByMesh.set(c, { cell, part });
            // U8: re-apply persisted overrides — LRU-evicted cells come back pristine, so
            // load-model is the ONE re-entry point. A checksum miss (re-bake reshuffled the
            // bake-sequential ids) invalidates the stored row instead of rescaling a stranger.
            if (opts.overrides && cell.uri) {
              for (const row of opts.overrides.forCell(cell.uri)) {
                const i = runIdx.get(row.featureId);
                const f = i === undefined ? undefined : features[i];
                if (!f || !checksumMatches(row, f.cx, f.cz, f.run.count)) {
                  opts.overrides.onInvalid(cell.uri, row.featureId);
                  continue;
                }
                f.scaleK = Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, row.k));
                growBoundsFor(part, f, f.scaleK);
                setOverrideTint(part, i as number, true);
              }
            }
          }
        }
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    const cell = cellByScene.get(e.scene);
    if (cell) {
      cellByScene.delete(e.scene);
      // U8 registries + a mid-drag ghost die with their cell (the orchestrator's armed state
      // survives — the override re-applies when the cell streams back).
      if (cell.uri && cellByUri.get(cell.uri) === cell) cellByUri.delete(cell.uri);
      for (const part of cell.parts) partByMesh.delete(part.mesh);
      if (ghost && ghost.cellScene === e.scene) hideGhostImpl();
      const i = cellList.indexOf(cell);
      if (i !== -1) {
        cellList[i] = cellList[cellList.length - 1]; // swap-pop; round-robin order is irrelevant
        cellList.pop();
      }
    }
    e.scene.traverse((c: any) => {
      if (c.isLineSegments) c.geometry.dispose(); // edgeMat/styleMat are shared (disposed in dispose())
      // LRU-eviction leak fix (source-verified 2026-07-13): the library disposes geometries and
      // materials but never calls mesh.dispose(), and an InstancedMesh's instanceMatrix is an
      // InstancedBufferAttribute on the MESH — only InstancedMesh.dispose() fires the 'dispose'
      // event that makes the renderer free its GL buffer. Without this, every evicted cell leaks
      // its instance buffer.
      if (c.isInstancedMesh) c.dispose();
    });
  });

  // R1 re-seat: the geodetic up at the bbox centre (constant — one translation seats the whole city
  // block) + a sticky last-good terrain height (heightAt returns null while tiles load and NEGATIVE
  // garbage on coarse LODs → clamp-only-upward, the S2 terrain discipline).
  const centre = bboxCenterDeg(opts.bbox);
  const _up = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToNormal(
    (centre.latDeg * Math.PI) / 180,
    (centre.lonDeg * Math.PI) / 180,
    _up,
  );
  let seatM = 0; // last-good terrain height (m above ellipsoid) at the bbox centre
  let centreSampled = false; // per-cell deltas are meaningless until the base seat is real
  // U2/A5: the group lift itself was the ONE unsmoothed layer — a terrain-LOD refine at the bbox
  // centre stepped the whole city in a single frame (the "buildings re-seat at a new altitude"
  // jump; cells/features already ease). The APPLIED seat now rides the same seatStep discipline
  // (first sample snaps, refinements ease), and the per-cell targets reference the APPLIED value
  // so the sum (group + cell + feature) still converges on each footprint's own terrain.
  let seatAppliedM: number | null = null;

  /** One-shot footprint location for a cell: run centroids / instance translations → world →
   *  geodetic. Gated on the cell having snapped once (its scene matrixWorld was force-updated);
   *  vertical deltas never move a footprint's lat/lon, so locating before/after writes is safe. */
  const ensureLocated = (cell: CellSeat): boolean => {
    if (cell.located) return true;
    if (cell.appliedM == null) return false;
    for (const part of cell.parts) {
      const arr = part.posAttr.array as ArrayLike<number>;
      for (const f of part.features) {
        const ctr = runCentroid(arr, f.run);
        _w.set(ctr[0], ctr[1], ctr[2]).applyMatrix4(part.mesh.matrixWorld);
        const g = ecefToGeodetic([_w.x, _w.y, _w.z]);
        f.latDeg = g.latDeg;
        f.lonDeg = g.lonDeg;
      }
    }
    for (const t of cell.trees) {
      const arr = t.mesh.instanceMatrix.array as ArrayLike<number>;
      for (let i = 0; i < t.seatM.length; i++) {
        _w.set(arr[i * 16 + 12], arr[i * 16 + 13], arr[i * 16 + 14]).applyMatrix4(t.mesh.matrixWorld);
        const g = ecefToGeodetic([_w.x, _w.y, _w.z]);
        t.latDeg[i] = g.latDeg;
        t.lonDeg[i] = g.lonDeg;
      }
    }
    cell.located = true;
    return true;
  };

  /** Accept a footprint terrain sample only when it is plausible relative to the cell seat —
   *  streaming-time raycasts can return coarse-LOD garbage (a −134 m first sample snapped a
   *  building underground, browser-caught 2026-07-14); real within-cell relief is ±~20 m. */
  const acceptSample = (h: number | null, cellSeatM: number): number | null => {
    if (h == null) return null;
    const c = clampGroundM(h);
    return Math.abs(c - cellSeatM) <= ENRICHED.reseatFeatureMaxDeltaM ? c : null;
  };

  /** Spend up to `budget` terrain raycasts on a cell's BUILDING footprints (round-robin within
   *  the cell). Returns samples spent. Sticky last-good + clampGroundM — the terrain discipline. */
  const sampleFeatures = (cell: CellSeat, budget: number): number => {
    if (budget <= 0 || cell.seatM == null || !ensureLocated(cell)) return 0;
    let spent = 0;
    for (const part of cell.parts) {
      if (part.features.length === 0) continue;
      const k = Math.min(budget - spent, part.features.length);
      for (let i = 0; i < k; i++) {
        const f = part.features[part.cursor++ % part.features.length];
        const c = acceptSample(opts.terrainHeightAt(f.latDeg, f.lonDeg), cell.seatM);
        if (c != null) f.seatM = c;
      }
      part.cursor %= Math.max(1, part.features.length);
      spent += k;
      if (spent >= budget) break;
    }
    return spent;
  };

  /** Ditto for TREE instances. */
  const sampleTrees = (cell: CellSeat, budget: number): number => {
    if (budget <= 0 || cell.seatM == null || !ensureLocated(cell)) return 0;
    let spent = 0;
    for (const t of cell.trees) {
      const n = t.seatM.length;
      if (n === 0) continue;
      const k = Math.min(budget - spent, n);
      for (let i = 0; i < k; i++) {
        const idx = t.cursor++ % n;
        const c = acceptSample(opts.terrainHeightAt(t.latDeg[idx], t.lonDeg[idx]), cell.seatM);
        if (c != null) t.seatM[idx] = c;
      }
      t.cursor %= n;
      spent += k;
      if (spent >= budget) break;
    }
    return spent;
  };

  /** Apply pass: ease every sampled building/tree toward (its seat − the CELL's target seat) —
   *  the cell scene supplies the rest, so the sum converges on the footprint's own terrain.
   *  Cheap compares over everything loaded (~0.2 ms); writes touch only pending runs. */
  const applyFeatureSeats = (): boolean => {
    let wrote = false;
    for (const cell of cellList) {
      if (cell.seatM == null || !cell.located) continue;
      for (const part of cell.parts) {
        let touchedFill = false;
        const pos = part.posAttr.array as Float32Array;
        const edgePos = part.edgeAttr ? (part.edgeAttr.array as Float32Array) : null;
        for (let r = 0; r < part.features.length; r++) {
          const f = part.features[r];
          // Seat translation step (unchanged law): unsampled features stay on the cell plane.
          let dy = 0;
          if (f.seatM != null) {
            let target = f.seatM - cell.seatM;
            // Poisoned pair (browser-caught): the CELL seat can itself be streaming-time garbage
            // when a feature samples — the pair then looks plausible until the cell corrects and
            // the stale feature seat drags the building tens of metres. An implausible delta at
            // APPLY time collapses back to the cell plane and re-samples on the next round-robin.
            if (Math.abs(target) > ENRICHED.reseatFeatureMaxDeltaM) {
              f.seatM = null;
              target = 0;
            }
            const next = seatStep(f.appliedM, target, ENRICHED.reseatEaseK);
            if (f.appliedM == null || Math.abs(next - f.appliedM) >= 0.01) {
              dy = next - (f.appliedM ?? 0);
              f.appliedM = next;
            }
          }
          // U8 height-override step: ease appliedK toward the committed target. The write is a
          // scale about the LIVE base (baseY + appliedM) — it commutes with the translation
          // above (a later dy shifts base and spans together), so seat and override never fight;
          // the poisoned-pair collapse is a pure translation and passes through the scale intact.
          let ratio = 1;
          if (f.scaleK !== f.appliedK) {
            let nextK = f.appliedK + (f.scaleK - f.appliedK) * ENRICHED.overrideEaseK;
            if (Math.abs(f.scaleK - nextK) < 0.002) nextK = f.scaleK; // snap the ease tail
            ratio = nextK / f.appliedK;
            f.appliedK = nextK;
          }
          if (dy === 0 && ratio === 1) continue; // settled
          const liveBase = f.baseY + (f.appliedM ?? 0);
          const { start, count } = f.run;
          if (ratio === 1) {
            for (let i = start; i < start + count; i++) pos[i * 3 + 1] += dy;
          } else {
            for (let i = start; i < start + count; i++) {
              const y = pos[i * 3 + 1] + dy;
              pos[i * 3 + 1] = liveBase + (y - liveBase) * ratio;
            }
          }
          touchedFill = true;
          if (edgePos && part.edgeCsr) {
            const { offsets, verts } = part.edgeCsr;
            if (ratio === 1) {
              for (let j = offsets[r]; j < offsets[r + 1]; j++) edgePos[verts[j] * 3 + 1] += dy;
            } else {
              for (let j = offsets[r]; j < offsets[r + 1]; j++) {
                const vi = verts[j] * 3 + 1;
                const y = edgePos[vi] + dy;
                edgePos[vi] = liveBase + (y - liveBase) * ratio;
              }
            }
          }
        }
        if (touchedFill) {
          part.posAttr.needsUpdate = true;
          if (part.edgeAttr) part.edgeAttr.needsUpdate = true;
          wrote = true;
        }
      }
      for (const t of cell.trees) {
        const arr = t.mesh.instanceMatrix.array as Float32Array;
        let touched = false;
        for (let i = 0; i < t.seatM.length; i++) {
          const s = t.seatM[i];
          if (Number.isNaN(s)) continue;
          const applied = t.appliedM[i];
          let target = s - cell.seatM;
          if (Math.abs(target) > ENRICHED.reseatFeatureMaxDeltaM) {
            t.seatM[i] = NaN; // poisoned pair — back to the cell plane, re-sample later
            target = 0;
          }
          const next = Number.isNaN(applied) ? target : applied + (target - applied) * ENRICHED.reseatEaseK;
          if (!Number.isNaN(applied) && Math.abs(next - applied) < 0.01) continue;
          arr[i * 16 + 13] += next - (Number.isNaN(applied) ? 0 : applied);
          t.appliedM[i] = next;
          touched = true;
        }
        if (touched) {
          t.mesh.instanceMatrix.needsUpdate = true;
          wrote = true;
        }
      }
    }
    return wrote;
  };

  // /m 2D map mode (UPLIFT U1) — see setActive on the handle.
  let active = true;

  return {
    tiles,
    update() {
      if (!active) return; // detached: no reveal clock, no streaming, no re-seat writes
      uniforms.uNowMs.value = performance.now(); // F1: advance the shared reveal clock before the draw
      frameNo++;
      if (ENRICHED.reseatToTerrain) {
        const h = opts.terrainHeightAt(centre.latDeg, centre.lonDeg);
        if (h != null) {
          seatM = clampGroundM(h); // sticky; ignore null/garbage
          centreSampled = true;
        }
        // U2/A5: apply the EASED seat (seatStep: first real sample snaps, refinements slide).
        if (centreSampled) seatAppliedM = seatStep(seatAppliedM, seatM, ENRICHED.reseatEaseK);
        const seatRefM = seatAppliedM ?? seatM;
        tiles.group.position.copy(_up).multiplyScalar(seatRefM + ENRICHED.seatOffsetM);

        // Per-cell re-seat: refresh a few cell samples per frame (bounded raycast cost), then
        // ease every sampled cell toward (its seat − the centre seat) along its own geodetic up.
        if (ENRICHED.reseatPerCell && centreSampled && cellList.length > 0) {
          const n = Math.min(ENRICHED.reseatSamplesPerFrame, cellList.length);
          for (let i = 0; i < n; i++) {
            const cell = cellList[rrCursor++ % cellList.length];
            const ch = opts.terrainHeightAt(cell.latDeg, cell.lonDeg);
            if (ch != null) cell.seatM = clampGroundM(ch);
          }
          if (rrCursor >= cellList.length) rrCursor %= cellList.length;
          for (const cell of cellList) {
            if (cell.seatM == null) continue; // unsampled → stays on the centre-seat plane
            // U2/A5: target references the APPLIED group seat — while the group ease is mid-slide
            // a sampled cell's sum stays exactly on its own terrain (a centre refine is about the
            // centre, not this cell), and unsampled cells ride the group ease smoothly.
            const next = seatStep(cell.appliedM, cell.seatM - seatRefM, ENRICHED.reseatEaseK);
            if (cell.appliedM != null && Math.abs(next - cell.appliedM) < 0.01) continue; // settled
            cell.appliedM = next;
            cell.scene.position.copy(cell.basePos).addScaledVector(cell.up, next);
            // TilesGroup only recurses into children when ITS matrix changed — force the update.
            cell.scene.updateMatrixWorld(true);
          }

          // Per-BUILDING/per-tree re-seat: budgeted terrain sampling (half on the cell nearest
          // the camera — the street you stand on — half round-robin across all loaded cells),
          // then the cheap apply pass eases every sampled footprint onto its own ground.
          if (ENRICHED.reseatPerFeature) {
            if (
              frameNo % ENRICHED.reseatPriorityEveryFrames === 1 ||
              !nearestCell ||
              !cellByScene.has(nearestCell.scene)
            ) {
              nearestCell = null;
              let best = Infinity;
              for (const cell of cellList) {
                const d = cell.ecef.distanceToSquared(opts.camera.position);
                if (d < best) {
                  best = d;
                  nearestCell = cell;
                }
              }
            }
            let fb = ENRICHED.reseatFeatureSamplesPerFrame;
            if (nearestCell) fb -= sampleFeatures(nearestCell, Math.ceil(fb / 2));
            for (let g = 0; g < cellList.length && fb > 0; g++)
              fb -= sampleFeatures(cellList[cellSweep++ % cellList.length], fb);
            let tb = ENRICHED.reseatTreeSamplesPerFrame;
            if (nearestCell) tb -= sampleTrees(nearestCell, Math.ceil(tb / 2));
            for (let g = 0; g < cellList.length && tb > 0; g++)
              tb -= sampleTrees(cellList[treeSweep++ % cellList.length], tb);
            if (cellList.length > 0) {
              cellSweep %= cellList.length;
              treeSweep %= cellList.length;
            }
            if (applyFeatureSeats()) {
              seatEpochN++;
              seatQuietN = 0;
            } else {
              seatQuietN++;
            }
          }
        }
      } else {
        tiles.group.position.copy(_up).multiplyScalar(ENRICHED.seatOffsetM);
      }
      tiles.update();
    },
    setQualityTier(errorTarget, lruCapBytes, queueCaps) {
      tierErrorTarget = errorTarget; // U6: base recomputes through the periphery rule
      applyErrorTarget();
      tiles.lruCache.maxBytesSize = lruCapBytes ?? lruDefaultBytes;
      tiles.lruCache.minBytesSize = lruFloorBytesForCap(lruCapBytes) ?? lruDefaultMinBytes; // U2/A9
      tiles.downloadQueue.maxJobs = queueCaps?.download ?? dlJobsDefault; // U5
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
    setSolidity(k) {
      // Solidity renders as the shared SCREEN-DOOR dissolve (owner 2026-07-14: gradual +
      // uniform) — fill and canopy stay OPAQUE and depth-writing at every k, so there is no
      // transparent-sort and no binary depthWrite threshold (the old flip at k>0.55 made every
      // mesh read instantly solid between two slider ticks).
      if (k == null) {
        uniforms.uFlatAlpha.value = 1;
        edgeMat.opacity = ENRICHED.edgeOpacity;
        uTreeAlpha.value = 1;
        return;
      }
      uniforms.uFlatAlpha.value = 0.28 + 0.72 * k;
      edgeMat.opacity = ENRICHED.edgeOpacity + (0.14 - ENRICHED.edgeOpacity) * k;
      // Trees follow the same slider (owner FPV ask: nothing may occlude the framed subject at 0).
      uTreeAlpha.value = TREES.fpvMinOpacity + (1 - TREES.fpvMinOpacity) * k;
    },
    setNight(sunElevSin, up) {
      const night = buildingNightFactor(sunElevSin, EARTH.lightsBand);
      uniforms.uFtwNight.value = night;
      uniforms.uFtwUp.value.copy(up); // R3: facade gating up (view-focus geodetic up)
      // Slice 3: canopy albedo dims toward night (CPU write on the ONE shared tree material —
      // mirrors the vector web's night dimming; no shader work needed).
      treeMat.color.copy(treeBaseColor).multiplyScalar(1 - TREES.nightDim * night);
    },
    setUltraHaze(haze, col, sunW) {
      uniforms.uFtwHaze.value = haze;
      uniforms.uFtwHazeCol.value.copy(col);
      uniforms.uFtwSunW.value.copy(sunW);
    },
    seatState: () => ({ epoch: seatEpochN, quietFrames: seatQuietN }),
    pickBuilding(raycaster) {
      // Fill meshes keep default raycast; edges/trees/ghost are noop'd — hits here are either
      // registered building fills or upstream scenery, and only the former resolve.
      for (const hit of raycaster.intersectObject(tiles.group, true)) {
        const reg = partByMesh.get(hit.object as THREE.Mesh);
        const a = (hit as { face?: { a: number } }).face?.a;
        if (!reg || typeof a !== "number") continue;
        const r = runIndexOfVertex(reg.part.runs, a);
        if (r < 0) continue;
        const f = reg.part.features[r];
        const bakedHeightM = f.topY - f.baseY;
        // The o2w bake keeps fences/walls/lamps as runs with no runtime class signal (yet —
        // the meta sidecar lands at the next re-bake): a height floor keeps the gesture on
        // actual massing, falling through to the building BEHIND the fence.
        if (bakedHeightM < ENRICHED.overrideMinPickHeightM) continue;
        if (!reg.cell.uri) return null; // verbatim dev tileset — no stable identity
        return {
          cellUri: reg.cell.uri,
          featureId: f.run.id,
          bakedHeightM,
          currentK: f.scaleK,
          distance: hit.distance,
          cx: f.cx,
          cz: f.cz,
          vc: f.run.count,
        };
      }
      return null;
    },
    setHeightScale(cellUri, featureId, k) {
      const found = findFeature(cellUri, featureId);
      if (!found) return;
      const clamped = Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, k));
      found.f.scaleK = clamped;
      growBoundsFor(found.part, found.f, clamped);
      setOverrideTint(found.part, found.runI, Math.abs(clamped - 1) >= NEUTRAL_K_EPS);
    },
    showGhost(cellUri, featureId) {
      hideGhostImpl();
      const found = findFeature(cellUri, featureId);
      if (!found) return false;
      const { cell, part, f } = found;
      const pos = part.posAttr.array as Float32Array;
      const { start, count } = f.run;
      const liveBase = f.baseY + (f.appliedM ?? 0);
      const inflate = ENRICHED.overrideGhostInflate;
      // Rebase the run so the building base sits at local y=0 and spans are BAKED-relative
      // (divide out the committed appliedK) — the whole drag is then `scale.y = k`, zero
      // per-frame geometry writes. XZ inflates a hair about the centroid so the ghost's walls
      // sit just proud of the original's (no coincident-face shimmer).
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const s = (start + i) * 3;
        arr[i * 3] = (pos[s] - f.cx) * inflate + f.cx;
        arr[i * 3 + 1] = (pos[s + 1] - liveBase) / f.appliedK;
        arr[i * 3 + 2] = (pos[s + 2] - f.cz) * inflate + f.cz;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const mesh = new THREE.Mesh(geom, ghostMat);
      mesh.raycast = () => {}; // GlobeControls raycasts the scene — never pick the preview
      mesh.renderOrder = 20; // draw after the opaque city (depthTest is off anyway)
      mesh.frustumCulled = false; // one short-lived mesh; not worth re-deriving scaled bounds
      mesh.position.y = liveBase; // parented to part.mesh → group/cell seats apply for free
      mesh.scale.y = f.appliedK;
      part.mesh.add(mesh);
      // TilesGroup trap (module header): updateMatrixWorld does NOT recurse into cell children
      // unless the GROUP matrix changed — force the ghost's own compose or it renders with an
      // identity local matrix (browser-caught 2026-08-19: invisible ghost, label correct).
      mesh.updateMatrixWorld(true);
      ghost = { mesh, geom, cellScene: cell.scene };
      return true;
    },
    setGhostK(k) {
      if (!ghost) return;
      ghost.mesh.scale.y = Math.max(0.05, k);
      ghost.mesh.updateMatrixWorld(true); // same TilesGroup trap — every write forces
    },
    hideGhost: hideGhostImpl,
    setArmedId(featureId) {
      uniforms.uFtwArmedId.value = featureId ?? -1;
    },
    buildingTopWorld(cellUri, featureId, k, out) {
      const found = findFeature(cellUri, featureId);
      if (!found) return false;
      const { f } = found;
      const liveBase = f.baseY + (f.appliedM ?? 0);
      out
        .set(f.cx, liveBase + (f.topY - f.baseY) * k, f.cz)
        .applyMatrix4(found.part.mesh.matrixWorld);
      return true;
    },
    debugSeats() {
      let located = 0;
      let features = 0;
      let featuresSampled = 0;
      let overridden = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let trees = 0;
      let treesSampled = 0;
      for (const cell of cellList) {
        if (cell.located) located++;
        for (const part of cell.parts) {
          features += part.features.length;
          for (const f of part.features) {
            if (Math.abs(f.scaleK - 1) >= NEUTRAL_K_EPS) overridden++;
            if (f.seatM == null) continue;
            featuresSampled++;
            if (f.appliedM != null) {
              lo = Math.min(lo, f.appliedM);
              hi = Math.max(hi, f.appliedM);
            }
          }
        }
        for (const t of cell.trees) {
          trees += t.seatM.length;
          for (let i = 0; i < t.seatM.length; i++) if (!Number.isNaN(t.seatM[i])) treesSampled++;
        }
      }
      return {
        cells: cellList.length,
        located,
        features,
        featuresSampled,
        featureAppliedMinM: lo,
        featureAppliedMaxM: hi,
        overridden,
        trees,
        treesSampled,
        epoch: seatEpochN,
        quietFrames: seatQuietN,
      };
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) scene.add(tiles.group);
      else scene.remove(tiles.group);
    },
    dispose() {
      hideGhostImpl();
      ghostMat.dispose();
      cellList.length = 0;
      cellByScene.clear();
      cellByUri.clear();
      partByMesh.clear();
      nearestCell = null;
      tiles.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      treeMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
