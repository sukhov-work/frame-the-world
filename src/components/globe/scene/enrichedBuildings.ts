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
import {
  lookBiasedDistance,
  makeClosestFirstComparator,
  type LoadAim,
} from "../../../lib/globe/loadPriority";
import {
  bboxCenterDeg,
  csrFromRunIds,
  featureRunsOf,
  mapSegmentsToRuns,
  regionCenterDeg,
  runCentroid,
  runIndexOfVertex,
  seatStep,
  vertexKeyToRunWithCollisions,
  type FeatureRun,
  type GeoBbox,
} from "../../../lib/globe/enrichedMask";
import {
  checksumMatches,
  NEUTRAL_K_EPS,
  SCALE_MAX_K,
  SCALE_MIN_K,
  XF_RAILS,
} from "../../../lib/globe/bldgOverrides";
import {
  boundsGrowthM,
  clampXf,
  easeXf,
  IDENTITY_XF,
  isExactIdentityXf,
  isIdentityXf,
  pristineFromIncremental,
  pristineIndexed,
  IDENTITY_TRANSFORM,
  recomposeIndexed,
  recomposeVerts,
  runRadiusXZ,
  type FeatureTransform,
  type SpatialXf,
} from "../../../lib/globe/featureTransform";
import type { EffectiveOverride } from "../../../lib/globe/bldgSync";
import {
  type CellMeta,
  cellUriOf,
  isPickableClass,
  metaUrlForGlb,
  parseCellMeta,
} from "../../../lib/globe/enrichedMeta";
import { EARTH, ENRICHED, FOVEATION, LOADING, TILESETS, TREES, WGS84_A } from "../tuning";
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
  /** RC17 stable OSM element id, null on a bake with no sidecar (or a feature the baker had none
   *  for). This is the key U8 rows migrate to — `featureId` is bake-sequential and dies on a
   *  re-bake, which is why the store still carries a centroid checksum alongside it. */
  osm: string | null;
  /** RC17 class token, null on a bake with no sidecar. */
  cls: string | null;
  bakedHeightM: number;
  /** Committed height-scale target (1 = original) — `current.sy`, kept for the U8 callers. */
  currentK: number;
  /** MS1: the committed FULL edit target (height scale + spatial components). */
  current: FeatureTransform;
  distance: number;
  cx: number;
  cz: number;
  vc: number;
}
/** MS2 — the ghost rig as the gizmo (scene/bldgGizmo.ts) needs it. `anchor` carries the
 *  translation in the cell's bake-local frame (+X east, +Y up, −Z north), `body` the yaw + the
 *  scale (X/Z inflated by `inflate`); `cx/cz` the pristine pivot, `liveBaseY` the seated base the
 *  rig was last placed on. Pure Object3D references — the gizmo never touches geometry. */
export interface GhostRig {
  anchor: THREE.Object3D;
  body: THREE.Object3D;
  cx: number;
  cz: number;
  liveBaseY: number;
  inflate: number;
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
  setUltraHaze(
    haze: number,
    col: THREE.Color,
    sunW: THREE.Vector3,
    /** Owner defect 2 (2026-08-27) — the anti-solar tint and the sky's luminance level, so the
     *  air over the city is the SAME air the ground under it is rendering. */
    cool: THREE.Color,
    skyLevel: number,
    afterglow: number,
    /** Owner taste pass (2026-08-27c) — the DUSK TROUGHS on the two flat, sun-blind terms that
     *  dominate a facade at low sun: the constant emissive floor (about 3.6x the sun key on a
     *  wall pointed straight into a 3 deg sun) and the unlit edge strokes (about 6.4x the lit
     *  surface they outline). Both exactly 1 with the chip off. */
    emisK: number,
    edgeK: number,
  ): void;
  /** /m 2D map mode (UPLIFT U1) — mirrors BuildingsHandle.setActive: `false` removes the group
   *  from the scene graph and freezes update() (no traversal/streaming/re-seat work); loaded
   *  cells stay LRU-cached for an instant re-attach. Desktop never calls this. */
  setActive(on: boolean): void;
  /** Per-building re-seat progress: `epoch` bumps on every frame that WROTE seating deltas,
   *  `quietFrames` counts frames since the last write. The orchestrator invalidates a ready
   *  skyline profile once per settled epoch (PLAN.reseatQuietFrames). */
  seatState(): { epoch: number; quietFrames: number };
  /** DEBUG HUD (owner 2026-09-01): cheap running counters — plain field reads, poll-safe.
   *  `deferred` counts null-TERRAIN sample deferrals (the burn rate debugSeats()'s `unseated`
   *  backlog cannot show); `rejected` is the running twin of the per-cell gate counter. */
  debugCounts(): {
    cells: number;
    priorityCells: number;
    deferred: number;
    rejected: number;
    seatCacheHits: number;
    seatCacheMisses: number;
  };
  /** U8 pick: raycast the enriched fill meshes; the first qualifying hit resolves through the
   *  cached run table. RC17 qualifies on the sidecar's CLASS token (Building family only, so an
   *  o2w fence/lamp/pylon is skipped and whatever stands behind it answers), falling back to the
   *  old `ENRICHED.overrideMinPickHeightM` height floor on a bake with no sidecar. Null = no
   *  building under the ray. */
  pickBuilding(raycaster: THREE.Raycaster): BuildingPick | null;
  /** U8 commit: set a building's height-scale target (1 = original). The next frames ease the
   *  REAL mesh there inside applyFeatureSeats (fill + edge CSR + bounds pad + committed tint). */
  setHeightScale(cellUri: string, featureId: number, k: number): void;
  /** MESH SUITE MS1: set a building's FULL edit target — height scale + the spatial components
   *  (rails applied: absolute scale band, translate radius, lift ≥ 0). Spatial components put
   *  the run on the absolute-recompose path (pristine snapshot on first use); an identity
   *  target lets it fall back to the incremental fast path once the ease settles. The ONE
   *  entry point the load re-apply, the U8 height commit and the MS2 gizmo share. */
  setTransform(
    cellUri: string,
    featureId: number,
    t: FeatureTransform,
    origin?: "mine" | "shared",
  ): void;
  /** MESH SUITE MS3: re-run the override apply over EVERY loaded cell — the world fetch landed
   *  (rows for cells already streamed), or a SYNC / reconcile changed what applies. Idempotent;
   *  a feature no row covers any more eases back to the original. O(features) once per call. */
  reapplyOverrides(): void;
  /** MS1: the committed TARGET, the currently APPLIED transform (easing toward it) and the
   *  row-building facts (pristine checksum triple + baked height), or null while unloaded. */
  featureState(
    cellUri: string,
    featureId: number,
  ): {
    target: FeatureTransform;
    applied: FeatureTransform;
    cx: number;
    cz: number;
    vc: number;
    bakedHeightM: number;
    /** MS3: the RC17 sidecar's OSM element id (the row's `o`), null on a bake without one. */
    osm: string | null;
    /** MS2: the run has its terrain seat (the RC7 first sample landed and is applied). Before it,
     *  the building — and the ghost rig on it — still sits on the cell plane and can jump by the
     *  cell's relief when the sample lands; a harness presses handles only after this is true. */
    seated: boolean;
    /** MS3: the committed-tint level written to the mesh (0 none · 1 world-shared · 2 mine). */
    tint: 0 | 1 | 2;
  } | null;
  /** U8 ghost preview (drag-time). `showGhost` builds the rebased semi-transparent copy over the
   *  solid original (false = cell not loaded); `setGhostK` is the live drag scale; `hideGhost`
   *  removes + disposes. At most one ghost exists. MS1: the ghost is the PRISTINE run about its
   *  pivot and carries the feature's live transform as Object3D writes, so `setGhostXf` (the MS2
   *  gizmo preview) drives position / yaw / XZ scale with zero geometry rewrites. */
  showGhost(cellUri: string, featureId: number, bodyVisible?: boolean): boolean;
  setGhostK(k: number): void;
  setGhostXf(xf: SpatialXf): void;
  /** MS2: place the whole rig from a full transform (height + spatial) — the per-frame keep-up
   *  between gizmo drags (the seat eases under it) and the clamp write-back during one. */
  setGhostTransform(t: FeatureTransform): void;
  /** MS2: show/hide the ghost MESH while the rig (and the gizmo on it) stays. */
  setGhostBodyVisible(on: boolean): void;
  /** MS2: the rig the gizmo attaches to, or null while no ghost exists / the cell is evicted
   *  (the ghost dies with its cell — the caller re-shows it when the cell streams back). */
  ghostRig(): GhostRig | null;
  hideGhost(): void;
  /** U8 armed-run tint — the RAW baked feature id (null = disarm). */
  setArmedId(featureId: number | null): void;
  /** U8: world position of the building's roof centre at height-scale `k` (the pinned
   *  dual-height label anchor). False when the cell isn't loaded. MS1: follows the APPLIED
   *  spatial transform, or `xf` when the caller previews one (the MS2 gizmo drag). */
  buildingTopWorld(
    cellUri: string,
    featureId: number,
    k: number,
    out: THREE.Vector3,
    xf?: SpatialXf,
  ): boolean;
  /** DEV introspection (window.__globe) — per-feature re-seat coverage + applied-delta spread. */
  debugSeats(): {
    cells: number;
    located: number;
    features: number;
    featuresSampled: number;
    featureAppliedMinM: number | null;
    featureAppliedMaxM: number | null;
    /** U8: features with a non-neutral height-scale target (browser-verify probe). */
    overridden: number;
    /** MS3: of those, the ones applied from the WORLD's rows (tint level 1). */
    shared: number;
    /** MS1: features currently on the absolute-recompose path (carrying a spatial transform). */
    spatial: number;
    trees: number;
    treesSampled: number;
    epoch: number;
    quietFrames: number;
    /** RC8 — samples the relief-scaled plausibility gate rejected (audit gap #5: this number
     *  did not exist, so a gate rejecting everything looked like a cell nobody had swept). */
    rejected: number;
    /** RC7 — features still waiting for their FIRST terrain sample. */
    unseated: number;
    /** RC0 M5 — applied seat delta binned by distance from the bake origin. QUADRATIC growth
     *  across the bins means the tangent-plane curvature error dominates (do RC12 first); a flat
     *  offset means the DSM bias does (RC15 first). */
    m5: Array<{
      fromM: number;
      toM: number;
      cells: number;
      meanDistM: number | null;
      /** The curvature residual RC12 would remove, AFTER the per-cell re-seat has absorbed the
       *  rest of it. Compare against `rmsReliefM` before re-opening RC12. */
      curvatureResidualM: number | null;
      n: number;
      rmsReliefM: number | null;
    }>;
    /** RC7 — the look-cone convergence the audit's S4 asked for (S4's own denominator). */
    nearFeatures: number;
    nearFeaturesSampled: number;
    priorityCells: number;
    /** RC9 — warm starts vs cold starts across LRU evictions, and how many cells are banked. */
    seatCacheHits: number;
    seatCacheMisses: number;
    seatCacheCells: number;
    /** RC17 — sidecar coverage. `metaCells` counts cells whose `.meta.json` arrived AND parsed;
     *  `metaMissing` counts cells that answered 404 or a schema this build refuses. On a bake
     *  that predates the writers both the class fence and the true-base correction are inert, so
     *  a check that reads a pick result without reading THESE is reading an unfenced pick and
     *  cannot tell the difference. `metaFeatures` is the class histogram behind the fence. */
    metaCells: number;
    metaMissing: number;
    metaFeatures: Record<string, number>;
    /** RC13 — `minVertexY` should reach ≈ −skirtM while `baseYMin` stays ≈ 0. Both, or neither
     *  half of the slice is real. */
    skirt: { n: number; minVertexY: number | null; baseYMin: number | null; heightMaxM: number };
    /** RC17 — `reclaimed` is the count of non-building features the old 2.5 m height floor was
     *  admitting to a U8 rescale and the class token now refuses. The only non-tautological
     *  number in this block. */
    pickFence: {
      features: number;
      classed: number;
      armable: number;
      oldFloorArmable: number;
      reclaimed: number;
    };
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
    /** U8: persisted overrides for THIS variant — consulted per cell at load-model (LRU reloads
     *  re-apply for free) and by `reapplyOverrides()`. A checksum mismatch (re-bake reshuffled
     *  ids) on a row with NO OSM id reports through `onInvalid` so the orchestrator drops it.
     *  MESH SUITE MS3: the rows are the EFFECTIVE merge of the local map and the world's fetched
     *  rows (lib/globe/bldgSync — origin `mine` / `shared` drives the tint ladder); `byOsm` is the
     *  RECOVERY lookup the load-model sweep runs for every feature the fingerprint pass left
     *  unclaimed, and `onRecovered` hands a re-found row back with fresh facts to be re-keyed.
     *  Omit = overrides disabled (the `?enriched=<url>` verbatim dev seam has no stable variant
     *  identity). */
    overrides?: {
      forCell(cellUri: string): EffectiveOverride[];
      onInvalid(cellUri: string, featureId: number): void;
      byOsm?(osm: string): EffectiveOverride | null;
      onRecovered?(
        row: EffectiveOverride,
        cellUri: string,
        featureId: number,
        facts: { cx: number; cz: number; vc: number; bakedHeightM: number },
      ): void;
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
  // RC17 — the per-cell sidecar cache. `null` is a REAL answer ("this bake has no meta"), which
  // is why the map holds nullable values instead of just missing keys: a legacy bake would
  // otherwise re-probe every cell on every LRU reload. Dropped with the seat cache on a variant
  // switch — another bake's class tokens are exactly as wrong as another bake's ground truth.
  const metaByUri = new Map<string, CellMeta | null>();
  const metaPending = new Map<string, Promise<void>>();
  let metaCells = 0; // cells whose sidecar arrived and parsed
  /** Fetch + cache one cell's sidecar. Never rejects — absence is a normal answer. */
  const primeMeta = (glbUrl: string): Promise<void> => {
    const uri = cellUriOf(glbUrl);
    if (!uri || metaByUri.has(uri)) return Promise.resolve();
    const pending = metaPending.get(uri);
    if (pending) return pending;
    const metaUrl = metaUrlForGlb(glbUrl);
    if (!metaUrl) return Promise.resolve();
    const p = fetch(metaUrl, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const parsed = j == null ? null : parseCellMeta(j);
        metaByUri.set(uri, parsed);
        if (parsed) metaCells++;
      })
      .catch(() => {
        metaByUri.set(uri, null);
      })
      .finally(() => {
        metaPending.delete(uri);
      });
    metaPending.set(uri, p);
    return p;
  };
  // #15(c) (batch #4 S3): enriched cells are bake-content-addressed R2 binaries → immutable.
  // Claim ONLY the .glb content fetches with HTTP force-cache (skips revalidation);
  // tileset.json declines → the default fetch keeps revalidating. Same claimer shape +
  // priority slot as FTW_TERRAIN_PATCH (no ion auth on this renderer to defer to).
  //
  // RC17 rides this claim to solve an ORDERING problem, not just to save a round trip. The
  // sidecar is what tells `load-model` a feature's class and its true base — and load-model is
  // where the pristine per-run capture happens and where persisted U8 overrides are re-applied.
  // A sidecar that lands afterwards would mean the first pick on a fresh cell uses the old height
  // floor, and a re-applied override would begin easing about the SKIRTED base and then have the
  // pivot move underneath it mid-ease. Resolving the model's own fetch behind the sidecar removes
  // the race outright. It costs nothing in practice: the two fetches run concurrently and the
  // sidecar is kilobytes against the cell's megabytes, so the join is the glb either way.
  tiles.registerPlugin({
    name: "FTW_ENRICHED_FORCE_CACHE",
    priority: -500,
    fetchData(url: string | URL, options: RequestInit) {
      const u = String(url);
      // Matched with a regex, not `endsWith`: since 2026-08-26 the baker stamps a `?v=<version>`
      // cache-buster onto every content uri, and an `endsWith(".glb")` test would quietly stop
      // matching — dropping the force-cache claim AND the sidecar prime, with nothing failing.
      if (!/\.glb(\?|$)/.test(u)) return null;
      const glb = fetch(u, { ...options, cache: "force-cache" });
      return Promise.all([glb, primeMeta(u)]).then(([r]) => r);
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
  /** The as-constructed emissive floor, captured so the dusk trough is a RESTORE rather than a
   *  re-derivation (the same discipline the ULTRA hemisphere restore uses). */
  const ENRICHED_EMISSIVE = styleMat.emissiveIntensity;
  /** Owner taste pass (2026-08-27c) — the dusk troughs on the two SUN-BLIND facade terms (the
   *  constant emissive floor and the unlit edge strokes). Banked by `setUltraHaze` and applied
   *  through `applyEdgeOpacity`, the ONE authority on the edge material's opacity — the FPV
   *  solidity slider routes through it too, so the two cannot fight. Exactly 1 with the chip
   *  off, so every expression stays byte-identical to what shipped. */
  let ultraEmisK = 1;
  let ultraEdgeK = 1;
  /** Absolute, so repeated calls cannot compound. `solidityK` is null when the slider is idle. */
  let solidityK: number | null = null;
  const applyEdgeOpacity = () => {
    const base =
      solidityK == null
        ? ENRICHED.edgeOpacity
        : ENRICHED.edgeOpacity + (0.14 - ENRICHED.edgeOpacity) * solidityK;
    edgeMat.opacity = base * ultraEdgeK;
  };
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
    /** The building's TRUE base in local Y. RC17 adds the RC13 skirt back onto the geometric
     *  minimum when the sidecar is present, so this is ground contact rather than the buried rim
     *  — which is what every consumer (scale pivot, ghost rebase, bounds growth) means by "base". */
    baseY: number;
    topY: number; // pristine max local Y (rendered height = topY − baseY)
    /** RC17 sidecar class token ("Building", "StreetLamp", …), null on a bake with no sidecar. */
    cls: string | null;
    /** RC17 stable OSM element id — the re-bake-durable key U8 rows will migrate to. */
    osm: string | null;
    cx: number; // pristine centroid X/Z (bake-local m) — checksum + ghost inflate centre
    cz: number;
    /** MS1: pristine XZ radius about the centroid — the bounds-growth arm for an XZ scale. */
    rXZ: number;
    scaleK: number; // height-scale TARGET (1 = original; set by commit / persisted rows)
    appliedK: number; // scale currently baked into the geometry (eases toward scaleK)
    // MESH SUITE MS1 — the spatial components (lib/globe/featureTransform.ts). `xf` is the
    // TARGET (null = identity), `axf` the APPLIED state: non-null ⇔ the run is on the
    // absolute-recompose path and owns a pristine snapshot. Both null for the 99 % of features
    // nobody has touched, which is the whole no-regression contract: one null check per frame.
    xf: SpatialXf | null;
    axf: SpatialXf | null;
    pristine: Float32Array | null; // the run's pristine fill verts (count × 3)
    pristineEdge: Float32Array | null; // its edge-CSR bucket, packed in bucket order
    /** MS3: the committed-tint level written to `_ftw_override` — 0 none · 1 world-shared
     *  (byte 128) · 2 mine (byte 255). Cached so an unchanged level never touches the buffer. */
    ov: 0 | 1 | 2;
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
    /** MS1: per-run [min, max] EDGE vertex index (hi = −1 when the run has no strokes) — the
     *  partial-upload range for a run's strokes. */
    edgeSpan: Int32Array | null;
    /** MS1: run indices written this frame (reused, truncated per frame — no allocation). */
    touchedRuns: number[];
    cursor: number; // round-robin feature sampling cursor
    /** RC7 — indices of features that have NEVER produced a seat, drained before any refresh.
     *  A building with no seat at all sits on the cell plane and is visibly wrong; a building
     *  with a slightly stale seat is not, so "never sampled" is strictly the more urgent work.
     *  Poisoned-pair collapses push back onto this queue, which is why it is a queue and not a
     *  one-shot scan. */
    unseated: number[];
  }
  interface TreeSet {
    mesh: THREE.InstancedMesh;
    latDeg: Float64Array; // per-instance footprint (lazy-located with the cell)
    lonDeg: Float64Array;
    seatM: Float32Array; // NaN = never sampled
    appliedM: Float32Array; // NaN = on the cell plane
    cursor: number;
    /** RC7 — never-sampled instance indices, drained first (see MeshPart.unseated). */
    unseated: number[];
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
    /** RC8 — the relief this cell has actually SHOWN, as a running range of accepted samples
     *  around its own seat. The flat 45 m plausibility bound was sized for Dnipro's ±20 m cells
     *  and silently rejects every real sample in genuinely steep terrain, which reads as
     *  buildings stuck on the cell plane rather than as a gate doing its job. The bound now
     *  WIDENS from evidence and never narrows below the flat one. */
    reliefLoM: number;
    reliefHiM: number;
    /** RC0 M5 — the height above the ellipsoid the BAKE itself put this cell at, with the group
     *  lift removed. `cell.seatM − bakedElevM` is therefore the bake's vertical error against the
     *  rendered terrain at this cell, and its SHAPE against distance from the bake origin is what
     *  separates a tangent-plane curvature error (quadratic — RC12 first) from a DSM bias (flat —
     *  RC15 first). Null until the group lift is real. */
    bakedElevM: number | null;
    /** RC8 — samples this cell has rejected as implausible. Published by `debugSeats()`; the
     *  audit's gap #5 was that this number did not exist anywhere, so the gate could reject 100 %
     *  of a cell's samples forever and look exactly like a cell nobody had swept yet. */
    rejected: number;
  }
  /**
   * RC9 — the seat cache that survives an LRU eviction.
   *
   * Walking out of a street and back re-loads its cells PRISTINE: every footprint returns to
   * `seatM = null`, drops onto the cell plane, and has to be re-sampled from scratch — so the
   * street you already seated re-seats in front of you, which is precisely the "buildings settle
   * as I walk" the fidelity audit was chasing. Terrain does not change while you turn around, so
   * the seats do not need re-deriving; they need REMEMBERING.
   *
   * Keyed by the cell's baked content URI (env-invariant, the same identity U8's persisted height
   * overrides use). Feature seats are keyed by baked feature id, so a re-bake that reshuffles ids
   * simply misses — the same failure mode U8's checksum handles, and a miss costs one re-sample.
   * The cache lives in this closure, so a VARIANT SWITCH (which disposes and re-attaches the
   * handle) drops it wholesale, as it must: a different bake has different ground truth.
   */
  interface CachedCellSeat {
    seatM: number | null;
    appliedM: number | null;
    reliefLoM: number;
    reliefHiM: number;
    /** RC0 M5 — the height above the ellipsoid the BAKE itself put this cell at, with the group
     *  lift removed. `cell.seatM − bakedElevM` is therefore the bake's vertical error against the
     *  rendered terrain at this cell, and its SHAPE against distance from the bake origin is what
     *  separates a tangent-plane curvature error (quadratic — RC12 first) from a DSM bias (flat —
     *  RC15 first). Null until the group lift is real. */
    bakedElevM: number | null;
    /** baked feature id → last-good footprint seat (m above the ellipsoid). */
    features: Map<number, number>;
    /** per-tree-set instance seats, in instance order (NaN = never sampled). */
    trees: Float32Array[];
  }
  const seatCache = new Map<string, CachedCellSeat>();
  let seatCacheHits = 0;
  let seatCacheMisses = 0;
  const cellList: CellSeat[] = [];
  const cellByScene = new Map<THREE.Object3D, CellSeat>();
  // U8 registries: cell identity for the persistence key + mesh → registry for the pick path.
  const cellByUri = new Map<string, CellSeat>();
  const partByMesh = new Map<THREE.Mesh, { cell: CellSeat; part: MeshPart }>();
  // U8 ghost (at most one — the drag preview). Owns its geometry; material is shared below.
  // MS1: also carries the feature it previews + the live transform it is showing.
  // MS2: the ghost is a RIG — `anchor` (a Group under the cell mesh, ENU frame, carries the
  // translation) + its child `body` (the mesh: yaw + scale). It is the TransformControls proxy
  // (scene/bldgGizmo.ts): MOVE drags the anchor, ROTATE / SCALE the body, and the numbers read
  // straight back into a FeatureTransform (lib/globe/featureTransform `rigToTransform`).
  let ghost: {
    anchor: THREE.Group;
    body: THREE.Mesh;
    geom: THREE.BufferGeometry;
    cellScene: THREE.Object3D;
    f: FeatureSeat;
    xf: SpatialXf;
    sy: number;
    /** The seated base the rig was last placed on (the lift rail's floor for the gizmo). */
    liveBaseY: number;
  } | null = null;
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
    ghost.anchor.parent?.remove(ghost.anchor);
    ghost.geom.dispose();
    ghost = null;
  };
  /** U8: committed-override tint mask (`_ftw_override`, Uint8 normalized — the shared building
   *  shader zero-fills geometries without it, so the attribute is created lazily on first use).
   *  MS3: a byte LADDER — 0 none · 128 world-shared · 255 mine (buildingMaterial.ts reads it as
   *  two thresholds); the level is cached per feature so a no-change apply never re-uploads. */
  const setOverrideTint = (part: MeshPart, runI: number, level: 0 | 1 | 2) => {
    const f = part.features[runI];
    if (f.ov === level) return;
    f.ov = level;
    const geom = part.mesh.geometry as THREE.BufferGeometry;
    let attr = geom.getAttribute("_ftw_override") as THREE.BufferAttribute | undefined;
    if (!attr) {
      if (level === 0) return;
      attr = new THREE.BufferAttribute(new Uint8Array(part.posAttr.count), 1, true);
      geom.setAttribute("_ftw_override", attr);
    }
    const { start, count } = f.run;
    (attr.array as Uint8Array).fill(level === 2 ? 255 : level === 1 ? 128 : 0, start, start + count);
    attr.needsUpdate = true;
  };
  /** U8: a tall override can outgrow the one-time reseat bounds pad — grow the fill+edge
   *  bounds by what the edit needs (monotonic; shrink never un-grows, harmless). MS1: the growth
   *  is the full `boundsGrowthM` (translation + lift + XZ growth + height growth), and the
   *  bounding BOX is grown alongside the sphere when one exists — `Mesh.raycast` early-outs on
   *  the box too (three 0.185 Mesh.js:260), so a sphere-only pad could leave a moved building
   *  visible but unpickable. */
  const growBoundsFor = (part: MeshPart, f: FeatureSeat, xf: SpatialXf, sy: number) => {
    const need = boundsGrowthM(xf, sy, f.rXZ, f.topY - f.baseY);
    if (need <= part.extraPadM) return;
    for (const g of [part.mesh.geometry as THREE.BufferGeometry, part.edgeGeom]) {
      if (g?.boundingSphere) g.boundingSphere.radius += need - part.extraPadM;
      if (g?.boundingBox) g.boundingBox.expandByScalar(need - part.extraPadM);
    }
    part.extraPadM = need;
  };
  /** MS1: capture a run's PRISTINE fill + edge vertices by inverting the incremental writer's
   *  state (at load-model — seat delta 0, scale 1 — that inverse is a plain copy). Idempotent. */
  const ensureSnapshot = (part: MeshPart, f: FeatureSeat, runI: number) => {
    if (f.pristine) return;
    const dyM = f.appliedM ?? 0;
    f.pristine = pristineFromIncremental(
      part.posAttr.array as Float32Array,
      f.run.start,
      f.run.count,
      f.baseY,
      dyM,
      f.appliedK,
    );
    if (part.edgeAttr && part.edgeCsr) {
      const { offsets, verts } = part.edgeCsr;
      f.pristineEdge = pristineIndexed(
        part.edgeAttr.array as Float32Array,
        verts,
        offsets[runI],
        offsets[runI + 1],
        f.baseY,
        dyM,
        f.appliedK,
      );
    }
  };
  /** MS1: leave the absolute path (the array already holds the identity recompose, which IS the
   *  incremental invariant — the fast path continues from it seamlessly). */
  const dropSnapshot = (f: FeatureSeat) => {
    f.axf = null;
    f.pristine = null;
    f.pristineEdge = null;
  };
  /** A feature's terrain sample point → lat/lon. Unedited features keep the exact array-centroid
   *  read they always had (vertical writes never move a footprint); a feature with a TARGET
   *  translation samples where it is GOING (the array may be mid-ease) — MS1 landmine #1: a
   *  moved building must not keep seating on its old footprint forever. */
  const locateFeature = (part: MeshPart, f: FeatureSeat) => {
    if (f.xf) {
      _w.set(f.cx + f.xf.tE, f.baseY, f.cz - f.xf.tN);
    } else {
      const ctr = runCentroid(part.posAttr.array as ArrayLike<number>, f.run);
      _w.set(ctr[0], ctr[1], ctr[2]);
    }
    _w.applyMatrix4(part.mesh.matrixWorld);
    const g = ecefToGeodetic([_w.x, _w.y, _w.z]);
    f.latDeg = g.latDeg;
    f.lonDeg = g.lonDeg;
  };
  /** MS1: the ONE entry point that sets a feature's edit target — load re-apply, the U8 height
   *  commit and the MS2 gizmo all land here. Rails first; then the path decision (spatial ⇒
   *  snapshot + absolute recompose; identity ⇒ fast path, immediately when nothing is left to
   *  ease); a changed translation re-locates the footprint and re-queues its terrain sample;
   *  bounds + committed tint last. */
  const applyTransformTarget = (
    cell: CellSeat,
    part: MeshPart,
    runI: number,
    t: FeatureTransform,
    origin: "mine" | "shared" = "mine",
  ) => {
    const f = part.features[runI];
    const sy = Number.isFinite(t.sy) ? Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, t.sy)) : 1;
    const clamped = clampXf(t, XF_RAILS);
    const spatial = isIdentityXf(clamped) ? null : clamped;
    const prev = f.xf;
    f.scaleK = sy;
    f.xf = spatial;
    if (spatial && !f.axf) {
      ensureSnapshot(part, f, runI);
      f.axf = { ...IDENTITY_XF };
    } else if (!spatial && f.axf && isExactIdentityXf(f.axf)) {
      dropSnapshot(f);
    }
    const moved =
      (prev?.tE ?? 0) !== (spatial?.tE ?? 0) || (prev?.tN ?? 0) !== (spatial?.tN ?? 0);
    if (moved && cell.located) {
      locateFeature(part, f);
      f.seatM = null; // re-sample at the new footprint; the applied lift stays until it lands
      if (!part.unseated.includes(runI)) part.unseated.push(runI);
    }
    growBoundsFor(part, f, spatial ?? IDENTITY_XF, sy);
    const edited = spatial !== null || Math.abs(sy - 1) >= NEUTRAL_K_EPS;
    setOverrideTint(part, runI, edited ? (origin === "shared" ? 1 : 2) : 0);
  };
  /** MESH SUITE MS3: apply the EFFECTIVE override rows to one loaded cell part — the ONE re-entry
   *  point for load-model (LRU-evicted cells come back pristine) and for `reapplyOverrides` (a
   *  world fetch or a SYNC changed what applies). Three passes: (1) the rows keyed to this cell by
   *  fingerprint — a checksum miss on a row with NO OSM id drops it (the U8 rule), a row WITH one
   *  is left to (2) the RECOVERY sweep, which asks `byOsm` for every feature still unclaimed, so a
   *  row whose bake-sequential key died in a re-bake finds its building by OSM id and is re-keyed
   *  with fresh facts (first feature wins when a bake gives one OSM id to several runs); (3) a
   *  feature that still carries an edit no row covers any more eases back to the original. */
  const applyCellOverrides = (cell: CellSeat, part: MeshPart) => {
    const ov = opts.overrides;
    if (!ov || !cell.uri) return;
    const claimed = new Set<number>();
    const claimedKeys = new Set<string>();
    for (const row of ov.forCell(cell.uri)) {
      const i = part.runIdx.get(row.featureId);
      const f = i === undefined ? undefined : part.features[i];
      if (!f || !checksumMatches(row.row, f.cx, f.cz, f.run.count)) {
        if (!row.row.o) ov.onInvalid(cell.uri, row.featureId);
        continue;
      }
      applyTransformTarget(cell, part, i as number, row.xf, row.origin);
      claimed.add(i as number);
      claimedKeys.add(row.key);
    }
    if (ov.byOsm) {
      for (let i = 0; i < part.features.length; i++) {
        if (claimed.has(i)) continue;
        const f = part.features[i];
        if (!f.osm) continue;
        const row = ov.byOsm(f.osm);
        if (!row || claimedKeys.has(row.key)) continue;
        applyTransformTarget(cell, part, i, row.xf, row.origin);
        claimed.add(i);
        claimedKeys.add(row.key);
        ov.onRecovered?.(row, cell.uri, f.run.id, {
          cx: f.cx,
          cz: f.cz,
          vc: f.run.count,
          bakedHeightM: f.topY - f.baseY,
        });
      }
    }
    for (let i = 0; i < part.features.length; i++) {
      if (claimed.has(i)) continue;
      const f = part.features[i];
      if (f.xf !== null || f.scaleK !== 1) applyTransformTarget(cell, part, i, IDENTITY_TRANSFORM);
    }
  };
  /** MS1: place the ghost from a transform — pure Object3D writes (position / yaw / scale about
   *  the pivot the geometry was rebased to). Every write forces its own matrix (TilesGroup trap). */
  const placeGhost = (xf: SpatialXf, sy: number) => {
    if (!ghost) return;
    const f = ghost.f;
    const inflate = ENRICHED.overrideGhostInflate;
    const liveBase = f.baseY + (f.appliedM ?? 0);
    ghost.xf = xf;
    ghost.sy = sy;
    ghost.liveBaseY = liveBase;
    // The forward map `transformToRig` (featureTransform.ts) in Object3D writes — the gizmo's
    // read-back is its exact inverse, so the two must never drift apart.
    ghost.anchor.position.set(f.cx + xf.tE, liveBase + xf.tU, f.cz - xf.tN);
    ghost.body.rotation.set(0, (xf.rotDeg * Math.PI) / 180, 0);
    ghost.body.scale.set(inflate * xf.sx, Math.max(0.05, sy), inflate * xf.sz);
    ghost.anchor.updateMatrixWorld(true);
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
  /** RC7 — the look-biased top-K cells the per-feature sweep prioritises (re-ranked every
   *  `reseatPriorityEveryFrames`, or whenever one of them was evicted). */
  let priorityCells: CellSeat[] = [];
  let cellSweep = 0; // global round-robin cell cursor (building sampling)
  let treeSweep = 0; // ditto for tree sampling
  let seatEpochN = 0;
  let seatQuietN = 0;
  // DEBUG HUD (owner 2026-09-01) — running totals for the cheap `debugCounts()` accessor: the
  // per-cell twins live on CellSeat and are only reachable through debugSeats()'s full walk.
  let deferredN = 0; // null-TERRAIN sample deferrals (acceptSample h == null)
  let rejectedN = 0; // plausibility-gate rejections (twin of the per-cell `rejected`)
  const _w = new THREE.Vector3();
  const _m5 = new THREE.Vector3(); // RC0 M5 scratch (bake-height capture, once per cell)
  /** RC7 — cells sorted by look-biased distance, truncated to `reseatPriorityCells`. */
  const rankPriorityCells = (): CellSeat[] =>
    cellList
      .map((c) => ({ c, d: lookBiasedDistance(c.ecef, opts.loadAim) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, ENRICHED.reseatPriorityCells)
      .map((x) => x.c);

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
      // The `?v=<tilesetVersion>` cache-buster is stripped FIRST and deliberately: this string is
      // the persistence key for U8 override rows and the banked cell seats, so leaving the
      // version in would make a version bump alone drop every saved edit in the browser.
      const uri = cellUriOf(String(e.tile?.content?.uri ?? ""));
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
        reliefLoM: Infinity,
        reliefHiM: -Infinity,
        rejected: 0,
        bakedElevM: null,
      };
      // RC9: warm start. `appliedM` is restored as-is rather than eased back from null — the
      // geometry is rebuilt from the bake anyway, so there is no slide to smooth, and easing
      // from zero would reproduce exactly the settle this slice exists to remove.
      const warm = uri ? seatCache.get(uri) : undefined;
      if (warm) {
        seatCacheHits++;
        cell.seatM = warm.seatM;
        cell.appliedM = warm.appliedM;
        cell.bakedElevM = warm.bakedElevM;
        cell.reliefLoM = warm.reliefLoM;
        cell.reliefHiM = warm.reliefHiM;
      } else if (uri) {
        seatCacheMisses++;
      }
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
            unseated: Array.from({ length: n }, (_v, i) => i), // RC7
          });
          // RC9: banked tree seats, matched by tree-set order and instance index (both are
          // fixed by the cell's own glb, so a mismatched length simply skips).
          const warmTrees = cell.uri ? seatCache.get(cell.uri)?.trees : undefined;
          const set = cell.trees[cell.trees.length - 1];
          const banked = warmTrees?.[cell.trees.length - 1];
          if (banked && banked.length === set.seatM.length) {
            set.seatM.set(banked);
            set.unseated = set.unseated.filter((i) => Number.isNaN(set.seatM[i]));
          }
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
            // MS1: collision-aware key map + per-SEGMENT attribution — a party-wall corner's
            // stroke stays with the building whose other end it touches, so a move/rotate never
            // stretches a neighbour's edge (enrichedMask.mapSegmentsToRuns).
            const { map: keyMap, collisions } = vertexKeyToRunWithCollisions(posAttr.array, runs);
            const edgeAttr = edges.geometry.getAttribute("position") as THREE.BufferAttribute | null;
            const edgeCsr = edgeAttr
              ? csrFromRunIds(mapSegmentsToRuns(edgeAttr.array, keyMap, collisions), runs.length)
              : null;
            // MS1: per-run [min, max] edge vertex index — the partial-upload range of a run's
            // strokes (a run's crease segments are emitted contiguously by EdgesGeometry).
            let edgeSpan: Int32Array | null = null;
            if (edgeCsr) {
              edgeSpan = new Int32Array(runs.length * 2);
              for (let r = 0; r < runs.length; r++) {
                let lo = Infinity;
                let hi = -1;
                for (let j = edgeCsr.offsets[r]; j < edgeCsr.offsets[r + 1]; j++) {
                  const v = edgeCsr.verts[j];
                  if (v < lo) lo = v;
                  if (v > hi) hi = v;
                }
                edgeSpan[r * 2] = hi < 0 ? 0 : lo;
                edgeSpan[r * 2 + 1] = hi;
              }
            }
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
            // RC17: the sidecar is guaranteed present by the time this runs (the fetch plugin
            // resolves the model behind it), so `baseY` can be the building's TRUE base from the
            // first frame rather than the geometric minimum RC13's skirt just moved 4 m down.
            // Every downstream consumer — the U8 scale pivot, the ghost rebase, the bounds
            // growth, the reported height — asks for "the building's base" and now gets it.
            const cellMeta = cell.uri ? metaByUri.get(cell.uri) : undefined;
            const features: FeatureSeat[] = runs.map((run, i) => {
              runIdx.set(run.id, i);
              let baseY = Infinity;
              let topY = -Infinity;
              let sx = 0;
              let sz = 0;
              let minX = Infinity;
              let maxX = -Infinity;
              let minZ = Infinity;
              let maxZ = -Infinity;
              for (let v = run.start; v < run.start + run.count; v++) {
                const x = posArr[v * 3];
                const y = posArr[v * 3 + 1];
                const z = posArr[v * 3 + 2];
                if (y < baseY) baseY = y;
                if (y > topY) topY = y;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
                sx += x;
                sz += z;
              }
              const n = Math.max(1, run.count);
              const m = cellMeta?.byId.get(run.id);
              const cx = sx / n;
              const cz = sz / n;
              return {
                run,
                latDeg: 0,
                lonDeg: 0,
                seatM: null,
                appliedM: null,
                baseY: m ? baseY + m.skirt : baseY,
                topY,
                cls: m?.cls ?? null,
                osm: m?.osm ?? null,
                cx,
                cz,
                rXZ: runRadiusXZ(cx, cz, minX, maxX, minZ, maxZ),
                scaleK: 1,
                appliedK: 1,
                xf: null,
                axf: null,
                pristine: null,
                pristineEdge: null,
                ov: 0,
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
              edgeSpan,
              touchedRuns: [],
              cursor: 0,
              // RC7: everything starts unseated, in bake order.
              unseated: features.map((_f, i) => i),
            };
            // RC9: restore banked footprint seats before the sweep ever runs. Anything the cache
            // knows drops out of the unseated drain, so a returning street spends its budget on
            // what it has NOT seen rather than on what it already had.
            const warmCell = cell.uri ? seatCache.get(cell.uri) : undefined;
            if (warmCell) {
              for (const [id, i] of runIdx) {
                const seat = warmCell.features.get(id);
                if (seat != null) features[i].seatM = seat;
              }
              part.unseated = part.unseated.filter((i) => features[i].seatM == null);
            }
            cell.parts.push(part);
            partByMesh.set(c, { cell, part });
            // U8: re-apply persisted overrides — LRU-evicted cells come back pristine, so
            // load-model is a re-entry point (MS3: `reapplyOverrides` is the other). A checksum
            // miss (re-bake reshuffled the bake-sequential ids) invalidates a fingerprint-only
            // row instead of rescaling a stranger; a row with an OSM id is recovered by it. The
            // array is pristine here, so the spatial snapshot is a straight copy.
            applyCellOverrides(cell, part);
          }
        }
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    const cell = cellByScene.get(e.scene);
    if (cell) {
      // RC9: bank the seats before the cell goes. Only cells that actually learned something are
      // worth keeping — an unlocated cell has nothing to say and would just occupy the map.
      if (cell.uri && cell.seatM != null) {
        const features = new Map<number, number>();
        for (const part of cell.parts) {
          for (const [id, i] of part.runIdx) {
            const seat = part.features[i]?.seatM;
            if (seat != null) features.set(id, seat);
          }
        }
        seatCache.set(cell.uri, {
          seatM: cell.seatM,
          appliedM: cell.appliedM,
          bakedElevM: cell.bakedElevM,
          reliefLoM: cell.reliefLoM,
          reliefHiM: cell.reliefHiM,
          features,
          trees: cell.trees.map((t) => Float32Array.from(t.seatM)),
        });
      }
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
  /** RC0 M5 — the bake ORIGIN in ECEF (the point `projectEN` measures from), so `debugSeats` can
   *  bin applied seat deltas by distance from it and separate a quadratic curvature error from a
   *  flat DSM bias. */
  const centreEcef = (() => {
    const v = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(
      (centre.latDeg * Math.PI) / 180,
      (centre.lonDeg * Math.PI) / 180,
      0,
      v,
    );
    return v;
  })();
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
    for (const part of cell.parts) for (const f of part.features) locateFeature(part, f);
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

  /**
   * Accept a footprint terrain sample only when it is plausible relative to the cell seat —
   * streaming-time raycasts can return coarse-LOD garbage (a −134 m first sample snapped a
   * building underground, browser-caught 2026-07-14).
   *
   * RC8: the bound is no longer flat. `reseatFeatureMaxDeltaM` (45 m) was sized for Dnipro's
   * ±~20 m grid cells; in genuinely steep terrain — the Khumbu, any mountain bake — a real sample
   * routinely exceeds it, and a gate that rejects every real sample looks EXACTLY like a cell
   * nobody has swept: buildings stay on the cell plane and nothing anywhere says why. The bound
   * now widens from the relief this cell has actually shown (accepted samples only, so it can
   * only grow on evidence) and never narrows below the flat one. Rejections are counted per cell
   * and published by `debugSeats()` — the audit's gap #5 was that the number did not exist.
   */
  const cellGateM = (cell: CellSeat): number => {
    const observed = cell.reliefHiM - cell.reliefLoM;
    if (!Number.isFinite(observed) || observed <= 0) return ENRICHED.reseatFeatureMaxDeltaM;
    return Math.max(ENRICHED.reseatFeatureMaxDeltaM, observed * ENRICHED.reseatReliefK);
  };
  const acceptSample = (h: number | null, cell: CellSeat): number | null => {
    // DEBUG HUD (owner 2026-09-01): `null` here has TWO causes and only rejection was counted —
    // the RC7 convergence stall (49.7 % with a full budget spent) was exactly the uncounted one,
    // a budget burning on footprints whose terrain had not loaded. Count the burn rate.
    if (h == null) {
      deferredN++;
      return null;
    }
    if (cell.seatM == null) return null;
    const c = clampGroundM(h);
    if (Math.abs(c - cell.seatM) > cellGateM(cell)) {
      cell.rejected++;
      rejectedN++;
      return null;
    }
    if (c < cell.reliefLoM) cell.reliefLoM = c;
    if (c > cell.reliefHiM) cell.reliefHiM = c;
    return c;
  };

  /**
   * Spend up to `budget` terrain raycasts on a cell's BUILDING footprints. Returns samples spent.
   * Sticky last-good + `clampGroundM` — the terrain discipline.
   *
   * RC7: NEVER-SAMPLED features drain first. The pre-RC7 sweep was a pure round-robin, so a cell
   * that had already sampled most of its buildings kept re-asking about them while its remaining
   * unseated ones — the visibly wrong ones, sitting flat on the cell plane — waited their turn
   * behind the whole list. Refreshes still happen, on whatever budget the drain leaves.
   */
  const sampleFeatures = (cell: CellSeat, budget: number): number => {
    if (budget <= 0 || cell.seatM == null || !ensureLocated(cell)) return 0;
    let spent = 0;
    // Pass 1 — the drain. A footprint whose terrain is not loaded yet answers null, and it must
    // go to the BACK of the queue, never straight back onto the head: popping and re-pushing the
    // same index retries it immediately, forever, and the whole budget vanishes into one
    // unanswerable footprint while the rest of the street stays flat on the cell plane. (Measured
    // 2026-08-25c: look-cone convergence stuck at 49.7 % with a full budget being spent.)
    for (const part of cell.parts) {
      if (part.unseated.length === 0) continue;
      const deferred: number[] = [];
      while (spent < budget && part.unseated.length > 0) {
        const i = part.unseated.pop() as number;
        const f = part.features[i];
        spent++;
        const c = acceptSample(opts.terrainHeightAt(f.latDeg, f.lonDeg), cell);
        if (c != null) f.seatM = c;
        else deferred.push(i); // try again next pass, behind everything not yet tried
      }
      for (const i of deferred) part.unseated.unshift(i);
      if (spent >= budget) return spent;
    }
    // Pass 2 — refresh, round-robin within the cell (the pre-RC7 behaviour, on what is left).
    for (const part of cell.parts) {
      if (part.features.length === 0) continue;
      const k = Math.min(budget - spent, part.features.length);
      for (let i = 0; i < k; i++) {
        const f = part.features[part.cursor++ % part.features.length];
        const c = acceptSample(opts.terrainHeightAt(f.latDeg, f.lonDeg), cell);
        if (c != null) f.seatM = c;
      }
      part.cursor %= Math.max(1, part.features.length);
      spent += k;
      if (spent >= budget) break;
    }
    return spent;
  };

  /** Ditto for TREE instances (same drain-then-refresh order). */
  const sampleTrees = (cell: CellSeat, budget: number): number => {
    if (budget <= 0 || cell.seatM == null || !ensureLocated(cell)) return 0;
    let spent = 0;
    for (const t of cell.trees) {
      if (t.unseated.length === 0) continue;
      const deferred: number[] = [];
      while (spent < budget && t.unseated.length > 0) {
        const idx = t.unseated.pop() as number;
        spent++;
        const c = acceptSample(opts.terrainHeightAt(t.latDeg[idx], t.lonDeg[idx]), cell);
        if (c != null) t.seatM[idx] = c;
        else deferred.push(idx); // back of the queue — see sampleFeatures
      }
      for (const idx of deferred) t.unseated.unshift(idx);
      if (spent >= budget) return spent;
    }
    for (const t of cell.trees) {
      const n = t.seatM.length;
      if (n === 0) continue;
      const k = Math.min(budget - spent, n);
      for (let i = 0; i < k; i++) {
        const idx = t.cursor++ % n;
        const c = acceptSample(opts.terrainHeightAt(t.latDeg[idx], t.lonDeg[idx]), cell);
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
            if (Math.abs(target) > cellGateM(cell)) {
              f.seatM = null;
              cell.rejected++;
              part.unseated.push(r); // RC7: back to the head of the drain, not the round-robin
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
          // MESH SUITE MS1: a feature carrying a spatial transform (`axf`) eases every component
          // here and is recomposed ABSOLUTELY from its pristine snapshot below — the incremental
          // writer cannot express a rotation or an XZ scale. `f.axf === null` for every untouched
          // building: this branch costs them one null check.
          let xfMoved = false;
          let xfSettledIdentity = false;
          if (f.axf) {
            const e = easeXf(f.axf, f.xf ?? IDENTITY_XF, ENRICHED.overrideEaseK);
            f.axf = e.next;
            xfMoved = e.moved;
            xfSettledIdentity = e.settled && f.xf === null;
          }
          if (dy === 0 && ratio === 1 && !xfMoved) continue; // settled
          const liveBase = f.baseY + (f.appliedM ?? 0);
          const { start, count } = f.run;
          if (f.axf && f.pristine) {
            // Absolute recompose (lib/globe/featureTransform.ts). For the identity spatial state
            // it lands exactly on the incremental invariant below, so a settled RESET can drop
            // the snapshot and hand the run back to the fast path with no seam.
            recomposeVerts(f.pristine, 0, pos, start * 3, count, f, f.axf, f.appliedK, f.appliedM ?? 0);
            if (edgePos && part.edgeCsr && f.pristineEdge) {
              const { offsets, verts } = part.edgeCsr;
              recomposeIndexed(
                f.pristineEdge,
                edgePos,
                verts,
                offsets[r],
                offsets[r + 1],
                f,
                f.axf,
                f.appliedK,
                f.appliedM ?? 0,
              );
            }
            if (xfSettledIdentity) dropSnapshot(f);
          } else {
            if (ratio === 1) {
              for (let i = start; i < start + count; i++) pos[i * 3 + 1] += dy;
            } else {
              for (let i = start; i < start + count; i++) {
                const y = pos[i * 3 + 1] + dy;
                pos[i * 3 + 1] = liveBase + (y - liveBase) * ratio;
              }
            }
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
          touchedFill = true;
          part.touchedRuns.push(r);
        }
        if (touchedFill) {
          // MS1: when few runs moved (a committed edit easing in, a late seat refinement) upload
          // only their byte ranges; a settling cell that touched many keeps the whole-buffer
          // upload it always had. three merges + clears the ranges after the upload.
          if (part.touchedRuns.length <= ENRICHED.editUpdateRangeMaxRuns) {
            for (const tr of part.touchedRuns) {
              const run = part.runs[tr];
              part.posAttr.addUpdateRange(run.start * 3, run.count * 3);
              if (part.edgeAttr && part.edgeSpan && part.edgeSpan[tr * 2 + 1] >= 0) {
                const lo = part.edgeSpan[tr * 2];
                const hi = part.edgeSpan[tr * 2 + 1];
                part.edgeAttr.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
              }
            }
          } else {
            part.posAttr.clearUpdateRanges();
            part.edgeAttr?.clearUpdateRanges();
          }
          part.touchedRuns.length = 0;
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
          if (Math.abs(target) > cellGateM(cell)) {
            t.seatM[i] = NaN; // poisoned pair — back to the cell plane, re-sample later
            cell.rejected++;
            t.unseated.push(i); // RC7: re-queued at the head of the drain
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
            // RC0 M5 (once per cell): what height the BAKE claims for this cell, group lift
            // removed. `basePos` is the position the library decomposed at load — pristine, and
            // never written by the re-seat (which only ever adds `appliedM` on top of it).
            if (cell.bakedElevM == null) {
              tiles.group.updateMatrixWorld();
              _m5.copy(cell.basePos).applyMatrix4(tiles.group.matrixWorld);
              cell.bakedElevM =
                WGS84_ELLIPSOID.getPositionElevation(_m5) - (seatRefM + ENRICHED.seatOffsetM);
            }
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
            // RC7 — rank the cells the VIEWER cares about, not merely the nearest one. In FPV
            // the nearest cell by pure distance is the one under your feet; the ones that read
            // as broken are the ones down the street you are looking at. Same bias law as the
            // download queue, so the seating front follows the streaming front.
            if (
              frameNo % ENRICHED.reseatPriorityEveryFrames === 1 ||
              priorityCells.length === 0 ||
              !priorityCells.every((c) => cellByScene.has(c.scene))
            ) {
              priorityCells = rankPriorityCells();
            }
            let fb = ENRICHED.reseatFeatureSamplesPerFrame;
            const fRr = Math.max(1, Math.round(fb * ENRICHED.reseatRoundRobinShare));
            let fPri = fb - fRr;
            for (const cell of priorityCells) {
              if (fPri <= 0) break;
              fPri -= sampleFeatures(cell, fPri);
            }
            fb = fRr + Math.max(0, fPri); // unspent priority budget falls through to the sweep
            for (let g = 0; g < cellList.length && fb > 0; g++)
              fb -= sampleFeatures(cellList[cellSweep++ % cellList.length], fb);
            let tb = ENRICHED.reseatTreeSamplesPerFrame;
            const tRr = Math.max(1, Math.round(tb * ENRICHED.reseatRoundRobinShare));
            let tPri = tb - tRr;
            for (const cell of priorityCells) {
              if (tPri <= 0) break;
              tPri -= sampleTrees(cell, tPri);
            }
            tb = tRr + Math.max(0, tPri);
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
      solidityK = k;
      if (k == null) {
        uniforms.uFlatAlpha.value = 1;
        applyEdgeOpacity();
        uTreeAlpha.value = 1;
        return;
      }
      uniforms.uFlatAlpha.value = 0.28 + 0.72 * k;
      applyEdgeOpacity();
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
    setUltraHaze(haze, col, sunW, cool, skyLevel, afterglow, emisK, edgeK) {
      uniforms.uFtwHaze.value = haze;
      uniforms.uFtwHazeCol.value.copy(col);
      uniforms.uFtwHazeCool.value.copy(cool);
      uniforms.uFtwSkyLevel.value = skyLevel;
      uniforms.uFtwAfterglowG.value = afterglow;
      // Banked, then applied through the EXISTING opacity writers below rather than written here:
      // edge opacity already has two authors (ghost / FPV solidity) and a third would fight them.
      ultraEmisK = emisK;
      ultraEdgeK = edgeK;
      styleMat.emissiveIntensity = ENRICHED_EMISSIVE * emisK;
      applyEdgeOpacity();
      uniforms.uFtwSunW.value.copy(sunW);
    },
    seatState: () => ({ epoch: seatEpochN, quietFrames: seatQuietN }),
    // DEBUG HUD (owner 2026-09-01) — the CHEAP counters: plain field reads, safe at poll
    // cadence. Everything richer (per-cell breakdowns, m5 rings, skirt/pickFence walks) stays
    // behind debugSeats(), which walks every cell × part × feature and is action-only.
    debugCounts: () => ({
      cells: cellList.length,
      priorityCells: priorityCells.length,
      deferred: deferredN,
      rejected: rejectedN,
      seatCacheHits,
      seatCacheMisses,
    }),
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
        // RC17 — the class fence. `continue`, not `return`: falling through to whatever stands
        // BEHIND the lamp post is the behaviour the height floor had, and it is the right one.
        //
        // The floor it replaces was a geometric proxy for a semantic question and got both
        // directions wrong — a single-storey outbuilding was unpickable, while every street lamp,
        // flagpole and 30 m transmission pylon cleared 2.5 m easily and was fully RESCALABLE. It
        // survives only as the fallback for a bake that predates the sidecar.
        if (f.cls !== null) {
          if (!isPickableClass(f.cls)) continue;
        } else if (bakedHeightM < ENRICHED.overrideMinPickHeightM) continue;
        if (!reg.cell.uri) return null; // verbatim dev tileset — no stable identity
        return {
          cellUri: reg.cell.uri,
          featureId: f.run.id,
          osm: f.osm,
          cls: f.cls,
          bakedHeightM,
          currentK: f.scaleK,
          current: { sy: f.scaleK, ...(f.xf ?? IDENTITY_XF) },
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
      // U8 callers change the height only — the spatial components ride along untouched.
      applyTransformTarget(found.cell, found.part, found.runI, {
        ...(found.f.xf ?? IDENTITY_XF),
        sy: k,
      });
    },
    setTransform(cellUri, featureId, t, origin = "mine") {
      const found = findFeature(cellUri, featureId);
      if (!found) return;
      applyTransformTarget(found.cell, found.part, found.runI, t, origin);
    },
    reapplyOverrides() {
      for (const cell of cellList) for (const part of cell.parts) applyCellOverrides(cell, part);
    },
    featureState(cellUri, featureId) {
      const found = findFeature(cellUri, featureId);
      if (!found) return null;
      const { f } = found;
      return {
        target: { sy: f.scaleK, ...(f.xf ?? IDENTITY_XF) },
        applied: { sy: f.appliedK, ...(f.axf ?? IDENTITY_XF) },
        cx: f.cx,
        cz: f.cz,
        vc: f.run.count,
        bakedHeightM: f.topY - f.baseY,
        osm: f.osm,
        seated: f.seatM !== null && f.appliedM !== null,
        tint: f.ov,
      };
    },
    showGhost(cellUri, featureId, bodyVisible = true) {
      hideGhostImpl();
      const found = findFeature(cellUri, featureId);
      if (!found) return false;
      const { cell, part, f } = found;
      const { count } = f.run;
      // MS1: the ghost is the PRISTINE run rebased to its pivot (centroid at the true base) —
      // the snapshot when the feature is on the absolute path, otherwise the inverse of the
      // incremental state (a temporary; a height-only drag never retains one). The feature's
      // live transform then rides the ghost OBJECT (`placeGhost`: position / yaw / scale), so
      // the whole drag is Object3D writes — `setGhostK` scales Y, `setGhostXf` (MS2) the rest.
      // XZ inflates a hair about the pivot so the ghost's walls sit just proud of the
      // original's (no coincident-face shimmer).
      const src =
        f.pristine ??
        pristineFromIncremental(
          part.posAttr.array as Float32Array,
          f.run.start,
          count,
          f.baseY,
          f.appliedM ?? 0,
          f.appliedK,
        );
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = src[i * 3] - f.cx;
        arr[i * 3 + 1] = src[i * 3 + 1] - f.baseY;
        arr[i * 3 + 2] = src[i * 3 + 2] - f.cz;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const body = new THREE.Mesh(geom, ghostMat);
      body.raycast = () => {}; // GlobeControls raycasts the scene — never pick the preview
      body.renderOrder = 20; // draw after the opaque city (depthTest is off anyway)
      body.frustumCulled = false; // one short-lived mesh; not worth re-deriving scaled bounds
      // MS2: the body hides between gizmo drags (the gizmo alone marks the op; the preview
      // appears on the first move, U8's feel) — a hidden mesh still composes its matrix, which
      // the gizmo's read-back and the label anchor rely on.
      body.visible = bodyVisible;
      const anchor = new THREE.Group();
      anchor.add(body);
      part.mesh.add(anchor); // parented to part.mesh → group/cell seats apply for free
      // MS2: seed from the TARGET (what the next edit builds on), not the applied state — a
      // commit still easing in would otherwise show the ghost lagging the handle it carries.
      ghost = {
        anchor,
        body,
        geom,
        cellScene: cell.scene,
        f,
        xf: f.xf ?? IDENTITY_XF,
        sy: f.scaleK,
        liveBaseY: f.baseY + (f.appliedM ?? 0),
      };
      // TilesGroup trap (module header): updateMatrixWorld does NOT recurse into cell children
      // unless the GROUP matrix changed — placeGhost forces the ghost's own compose or it
      // renders with an identity local matrix (browser-caught 2026-08-19: invisible ghost).
      placeGhost(ghost.xf, ghost.sy);
      return true;
    },
    setGhostK(k) {
      if (!ghost) return;
      placeGhost(ghost.xf, k);
    },
    setGhostXf(xf) {
      if (!ghost) return;
      placeGhost(xf, ghost.sy);
    },
    setGhostTransform(t) {
      if (!ghost) return;
      placeGhost(t, t.sy);
    },
    setGhostBodyVisible(on) {
      if (ghost) ghost.body.visible = on;
    },
    ghostRig() {
      if (!ghost) return null;
      return {
        anchor: ghost.anchor,
        body: ghost.body,
        cx: ghost.f.cx,
        cz: ghost.f.cz,
        liveBaseY: ghost.liveBaseY,
        inflate: ENRICHED.overrideGhostInflate,
      };
    },
    hideGhost: hideGhostImpl,
    setArmedId(featureId) {
      uniforms.uFtwArmedId.value = featureId ?? -1;
    },
    buildingTopWorld(cellUri, featureId, k, out, xf) {
      const found = findFeature(cellUri, featureId);
      if (!found) return false;
      const { f } = found;
      const x = xf ?? f.axf ?? IDENTITY_XF;
      const liveBase = f.baseY + (f.appliedM ?? 0);
      out
        .set(f.cx + x.tE, liveBase + x.tU + (f.topY - f.baseY) * k, f.cz - x.tN)
        .applyMatrix4(found.part.mesh.matrixWorld);
      return true;
    },
    debugSeats() {
      let located = 0;
      let features = 0;
      let featuresSampled = 0;
      let overridden = 0;
      let shared = 0; // MS3: of those, applied from the world's rows
      let spatial = 0; // MS1: runs on the absolute-recompose path
      let lo = Infinity;
      let hi = -Infinity;
      let trees = 0;
      let treesSampled = 0;
      let rejected = 0;
      let unseated = 0;
      let nearFeatures = 0;
      let nearFeaturesSampled = 0;
      const nearSet = new Set(priorityCells);
      // RC0 measurement M5 — THE §1.3 separator, and it came back with a REFUTATION.
      //
      // The audit could not tell a QUADRATIC seat error (F1: both bakers project onto a tangent
      // plane and never subtract the curvature rise d²/2R) from a FLAT BIAS (F2: the DSM the bake
      // was cut from includes the buildings it is seating) or a TIME-DECAYING one (F4: streaming),
      // and those three want RC12, RC15 and RC7 first respectively.
      //
      // Measured 2026-08-25c over the shipped Dnipro bake: **F1 CANNOT BE THE DOMINANT TERM,
      // because the per-cell re-seat already absorbs it.** The bake is deliberately laid at h≈0
      // and every cell is independently re-seated onto the terrain at its own centre, so the
      // curvature rise survives only as its VARIATION ACROSS ONE CELL — `d · r / R`, where r is
      // the cell half-span, not the bake radius. At 4 km out with ~450 m cells that is 0.28 m,
      // against a measured within-cell relief of 10–35 m rms. A ~1 % term does not justify
      // re-baking three regions.
      //
      // So the two numbers below are the ones that matter, per distance ring: the WITHIN-CELL
      // RELIEF the per-feature seat is correcting (the real work), and the curvature residual
      // that RC12 would remove (the bound, computed from the same geometry). Anyone re-opening
      // RC12 has to argue against the ratio of those two.
      const BINS = 8;
      const binStep = ENRICHED.debugM5BinM;
      const sum = new Float64Array(BINS);
      const sumSq = new Float64Array(BINS);
      const count = new Int32Array(BINS);
      // Within-cell relief, kept alongside so the two are never confused again.
      const reliefSumSq = new Float64Array(BINS);
      const reliefCount = new Int32Array(BINS);
      for (const cell of cellList) {
        if (cell.located) located++;
        rejected += cell.rejected;
        const cellDistM = cell.ecef.distanceTo(centreEcef);
        const bin = Math.min(BINS - 1, Math.floor(cellDistM / binStep));
        // The curvature residual RC12 would remove at this cell: the tangent-plane rise varies
        // across the cell by d·r/R, and the per-cell seat has already removed its mean.
        sum[bin] += (cellDistM * ENRICHED.cellHalfSpanM) / WGS84_A;
        sumSq[bin] += cellDistM;
        count[bin]++;
        const isNear = nearSet.has(cell);
        for (const part of cell.parts) {
          features += part.features.length;
          unseated += part.unseated.length;
          if (isNear) nearFeatures += part.features.length;
          for (const f of part.features) {
            if (Math.abs(f.scaleK - 1) >= NEUTRAL_K_EPS || f.xf) overridden++;
            if (f.ov === 1) shared++;
            if (f.axf) spatial++;
            if (f.seatM == null) continue;
            featuresSampled++;
            if (isNear) nearFeaturesSampled++;
            if (f.appliedM != null) {
              lo = Math.min(lo, f.appliedM);
              hi = Math.max(hi, f.appliedM);
              reliefSumSq[bin] += f.appliedM * f.appliedM;
              reliefCount[bin]++;
            }
          }
        }
        for (const t of cell.trees) {
          trees += t.seatM.length;
          for (let i = 0; i < t.seatM.length; i++) if (!Number.isNaN(t.seatM[i])) treesSampled++;
        }
      }
      const m5 = [];
      for (let b = 0; b < BINS; b++) {
        if (count[b] === 0 && reliefCount[b] === 0) continue;
        m5.push({
          fromM: b * binStep,
          toM: (b + 1) * binStep,
          cells: count[b],
          /** Mean distance from the bake origin in this ring (m). */
          meanDistM: count[b] ? +(sumSq[b] / count[b]).toFixed(1) : null,
          /** What RC12 would remove: the tangent-plane curvature residual left AFTER the per-cell
           *  re-seat, `d · cellHalfSpan / R`. This is the whole prize. */
          curvatureResidualM: count[b] ? +(sum[b] / count[b]).toFixed(4) : null,
          /** RMS within-cell relief the per-feature seat is correcting — the real work. */
          n: reliefCount[b],
          rmsReliefM: reliefCount[b] ? +Math.sqrt(reliefSumSq[b] / reliefCount[b]).toFixed(3) : null,
        });
      }
      return {
        cells: cellList.length,
        located,
        features,
        featuresSampled,
        featureAppliedMinM: Number.isFinite(lo) ? lo : null,
        featureAppliedMaxM: Number.isFinite(hi) ? hi : null,
        overridden,
        shared,
        spatial,
        trees,
        treesSampled,
        epoch: seatEpochN,
        quietFrames: seatQuietN,
        /** RC8 — samples the plausibility gate threw away. Zero for a whole session over steep
         *  terrain is itself the finding: it means the gate is not the reason nothing seated. */
        rejected,
        /** RC7 — features still waiting for their FIRST sample. Drains to 0 as the sweep runs. */
        unseated,
        /** RC0 M5 — applied seat delta binned by distance from the bake origin. */
        m5,
        /** RC7 — convergence IN THE LOOK CONE, which is the criterion the audit's S4 actually
         *  set. A whole-city fraction is the wrong denominator: 39k buildings over 101 cells will
         *  never all seat in five seconds and do not need to. */
        nearFeatures,
        nearFeaturesSampled,
        priorityCells: priorityCells.length,
        /** RC9 — cells that came back from an LRU eviction with their seats intact vs cold. */
        metaCells,
        metaMissing: [...metaByUri.values()].filter((m) => m === null).length,
        // RC13 — the skirt, read off the LIVE geometry and the live registry together. The two
        // fields are the two halves of one claim and only mean something as a pair: vertices must
        // reach below the base (or the skirt never baked), while the reported base must NOT (or
        // the sidecar's skirt-undo is not being applied and every height is 4 m too tall).
        skirt: (() => {
          let minVertexY = Infinity;
          let baseYMin = Infinity;
          let heightMaxM = 0;
          let n = 0;
          for (const c of cellList)
            for (const part of c.parts) {
              const pos = part.posAttr.array as Float32Array;
              for (const f of part.features) {
                n++;
                if (f.baseY < baseYMin) baseYMin = f.baseY;
                const h = f.topY - f.baseY;
                if (h > heightMaxM) heightMaxM = h;
                // The run's own vertex minimum, in the pristine baked frame: seats translate the
                // whole run, so the applied delta has to come back off to compare against baseY.
                const dy = f.appliedM ?? 0;
                for (let v = f.run.start; v < f.run.start + f.run.count; v++) {
                  const y = pos[v * 3 + 1] - dy;
                  if (y < minVertexY) minVertexY = y;
                }
              }
            }
          return {
            n,
            minVertexY: Number.isFinite(minVertexY) ? +minVertexY.toFixed(2) : null,
            baseYMin: Number.isFinite(baseYMin) ? +baseYMin.toFixed(2) : null,
            heightMaxM: +heightMaxM.toFixed(1),
          };
        })(),
        // RC17 — what the class fence actually changed, measured rather than asserted.
        // `armable` runs the SHIPPED gate; `oldFloorArmable` runs the pre-RC17 height floor over
        // the same features. Their difference is the only number here that is not a tautology:
        // it is the count of street lamps, pylons, walls and railings that WERE rescalable.
        pickFence: (() => {
          let features = 0, classed = 0, armable = 0, oldFloorArmable = 0;
          for (const c of cellList)
            for (const part of c.parts)
              for (const f of part.features) {
                features++;
                const tall = f.topY - f.baseY >= ENRICHED.overrideMinPickHeightM;
                if (tall) oldFloorArmable++;
                if (f.cls !== null) {
                  classed++;
                  if (isPickableClass(f.cls)) armable++;
                } else if (tall) armable++;
              }
          return { features, classed, armable, oldFloorArmable, reclaimed: oldFloorArmable - armable };
        })(),
        // Built from the LOADED cells rather than from the sidecar cache: the histogram should
        // describe what is on screen and fenceable right now, not what has ever been fetched.
        metaFeatures: (() => {
          const h: Record<string, number> = {};
          for (const c of cellList)
            for (const part of c.parts)
              for (const f of part.features) if (f.cls) h[f.cls] = (h[f.cls] ?? 0) + 1;
          return h;
        })(),
        seatCacheHits,
        seatCacheMisses,
        seatCacheCells: seatCache.size,
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
      seatCache.clear(); // RC9: a variant switch must never carry another bake's ground truth
      metaByUri.clear(); // RC17: ditto for class tokens — cell uris repeat across variants
      metaPending.clear();
      cellByScene.clear();
      cellByUri.clear();
      partByMesh.clear();
      priorityCells.length = 0;
      tiles.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      treeMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
