import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { tokens } from "../../../lib/theme/tokens";
import { clampGroundM } from "../../../lib/geo/terrain";
import { ecefToGeodetic, geodeticToEcef } from "../../../lib/geo/projection";
import { locateTreeInstances, TREE_LOCATE_CHUNK } from "../../../lib/globe/treeLocate";
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
  createSegmentRunAttributor,
  createAttributorScratch,
  csrFromRunIds,
  featureRunsOf,
  mapSegmentsToRuns,
  regionCenterDeg,
  runCentroid,
  runIndexOfVertex,
  seatLand,
  segmentRunsFromSources,
  vertexKeyToRunWithCollisions,
  type FeatureRun,
  type GeoBbox,
  type SegmentRunAttributor,
  seatLandF32,
} from "../../../lib/globe/enrichedMask";
import {
  deepAnswerVerdict,
  idleSweepNow,
  regionArmsCell,
  seatFreezeM,
} from "../../../lib/globe/seatQuiet";
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
// T77 lever 5: dt → per-frame ease coefficient. The ONE such helper in the repo — every ease that
// is frame-rate independent goes through it so the law cannot fork (`lightBands.ts:187`).
import { easeK } from "../../../lib/globe/lightBands";
import {
  type CellMeta,
  cellUriOf,
  isPickableClass,
  metaUrlForGlb,
  parseCellMeta,
} from "../../../lib/globe/enrichedMeta";
import { EARTH, ENRICHED, FOVEATION, LOADING, TILESETS, TREES, WGS84_A } from "../tuning";
import { createBuildingMaterials, FTW_BAYER_GLSL } from "./buildingMaterial";
import { createFastEdgesScratch } from "../../../lib/globe/fastEdges";
import { buildEdgesGeometry, createEdgesBuilder, type EdgesBuild, type EdgesBuilder } from "./edgesGeometry";
import { createLoadQueue, type LoadUnit } from "../../../lib/globe/loadQueue";
import { makeTileCenterReader } from "./tilePriority";
import { makeTileFoveation } from "./tileFoveation";
import { frameHeld, frameNow, noteFrameHold, registerFrameClock } from "../../../lib/globe/frameFreeze";

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
 * snaps, refinements ease (`seatLand`). TRAP: `TilesGroup.updateMatrixWorld` only recurses into
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
 * (`seatLand`); geometry bounding volumes get a one-time pad (reseatBoundsPadM). `seatState()`
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
  /** MS5b: the PRISTINE footprint extents `[dx, dz]` (bake-local metres, the mapped building's
   *  east–west × north–south size) — the SCALE rows print `dx·sx × dz·sz` against them. */
  footprintM: [number, number];
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
  /** Per-frame: R1 re-seat to the rendered terrain + tile streaming/LOD. `dtMs` is the frame delta
   *  ALREADY clamped by the orchestrator (`ORCH.maxFrameDtMs`) — T77 lever 5: every seat ease in
   *  here is `easeK(dtMs, τ)`, so a 30 fps machine settles at the same wall-clock rate as a
   *  120 fps one instead of at a quarter of it. */
  update(dtMs: number): void;
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
  /** T77 MEASURE (2026-09-05) — the RESEAT-SETTLE read seam. Per-frame residuals taken inside
   *  `applyFeatureSeats()` (which already visits every resident feature every frame, so this
   *  costs two compares per feature and allocates nothing): `maxResidualM` = the largest
   *  |target − applied| left after this frame's ease over every seated feature; `movedFeatures` =
   *  how many features WROTE a seat delta this frame (the engine's own 1 cm write gate); the
   *  `near*` twins are scoped to the RC7 look-cone priority cells — the only scope a settle bar
   *  can be held to (ENGINE_STATE §2.5: the city-wide round-robin cannot clear 1 cm in a test
   *  window). `frame` is this module's apply counter; pair every read with it. Plain field
   *  reads — poll-safe at any cadence; a harness never has to walk debugSeats() per frame.
   *
   *  T77 NEW-3 adds `cellMaxResidualM` — the CELL layer's own largest residual. Without it this
   *  object was checkable but not SUFFICIENT: every feature residual is measured against its own
   *  cell plane, so a cell layer parked 8 cm off terrain reads as a perfectly settled city.
   *  T77 4a adds `collapsed`, the APPLY-time poisoned-pair collapses `rejected` used to swallow
   *  (a discarded sample moves nothing on screen; a collapse visibly drops a seated building). */
  seatSettle(): {
    frame: number;
    maxResidualM: number;
    movedFeatures: number;
    nearMaxResidualM: number;
    nearMovedFeatures: number;
    nearCells: number;
    cellMaxResidualM: number;
    epoch: number;
    quietFrames: number;
    deferred: number;
    rejected: number;
    collapsed: number;
    shallow: number;
    /** T77 slice C-1 5b — REFRESH answers discarded inside the sub-pixel deadband. */
    frozen: number;
    /** T77 slice C-1 — cell planes corrected out of turn by a deeper footprint answer. */
    deepResamples: number;
    /** T101 — deeper-disagreeing answers the cap could not serve: the cell was HELD, the sample
     *  was not counted as rejected. Climbs through a streaming burst, never after quiet. */
    deepHeld: number;
    /** T101 — resident cells the sampling passes are skipping right now (`deepPending`). */
    deepPendingCells: number;
    /** T77 slice C-1 5a — resident cells the apply pass skipped this frame as fixed points. */
    idleCells: number;
    /** T77 slice C-1 5d — did the refresh round-robin run this frame? */
    sweepNow: boolean;
  };
  /** DEBUG HUD (owner 2026-09-01): cheap running counters — plain field reads, poll-safe.
   *  `deferred` counts null-TERRAIN sample deferrals (the burn rate debugSeats()'s `unseated`
   *  backlog cannot show); `rejected` is the running twin of the per-cell gate counter, and
   *  `collapsed` (T77 4a) its apply-time half. */
  debugCounts(): {
    cells: number;
    priorityCells: number;
    deferred: number;
    rejected: number;
    collapsed: number;
    /** T77 slice C-1 5b/5a/deep-resample — the quiet counters (see `seatSettle`). */
    frozen: number;
    idleCells: number;
    deepResamples: number;
    /** T101 — the deep-pending hold's two numbers (see `seatSettle`). */
    deepHeld: number;
    deepPendingCells: number;
    seatCacheHits: number;
    seatCacheMisses: number;
    /** T106 slice (b) — the deferred `load-model` queue: units waiting, and the worst drain (ms). */
    loadPending: number;
    loadMaxMs: number;
    /** T115 — the resumable tree locate: worst call (ms) and tree sets still mid-locate. */
    treeLocateMaxMs: number;
    treeLocatePending: number;
  };
  /** U8 pick: raycast the enriched fill meshes; the first qualifying hit resolves through the
   *  cached run table. RC17 qualifies on the sidecar's CLASS token (Building family only, so an
   *  o2w fence/lamp/pylon is skipped and whatever stands behind it answers), falling back to the
   *  old `ENRICHED.overrideMinPickHeightM` height floor on a bake with no sidecar. Null = no
   *  building under the ray. */
  pickBuilding(raycaster: THREE.Raycaster): BuildingPick | null;
  /** U8 commit: set a building's height-scale target (1 = original). The next frames ease the
   *  REAL mesh there inside applyFeatureSeats (fill + edge CSR + bounds pad); the committed tint
   *  is written at once by `applyTransformTarget` (`setOverrideTint`, the `_ftw_override` byte),
   *  never in the apply pass (T125 docblock fix 2026-09-08c). */
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
    /** MS5b: the pristine footprint extents `[dx, dz]` (bake-local metres). */
    footprintM: [number, number];
    /** MS3: the RC17 sidecar's OSM element id (the row's `o`), null on a bake without one. */
    osm: string | null;
    /** MS2: the run has its terrain seat (the RC7 first sample landed and is applied). Before it,
     *  the building — and the ghost rig on it — still sits on the cell plane and can jump by the
     *  cell's relief when the sample lands; a harness presses handles only after this is true. */
    seated: boolean;
    /** MS3: the committed-tint level written to the mesh (0 none · 1 world-shared · 2 mine). */
    tint: 0 | 1 | 2;
    /** T125: the `_ftw_override` byte actually on the geometry at the run's first vertex (255 mine ·
     *  128 shared · 0 none), `null` while the attribute was never created — the GPU-side twin of
     *  `tint`, so a harness can prove the upload, not just the cache. */
    tintByte: number | null;
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
  /** T77 slice B (DEV diagnostic) — the cells with the most plausibility-gate hits, each with its
   *  plane (`seatM`, depth, gate width, dirty frames) and its worst features (`seatM`, depth,
   *  applied, residual). The loop's ATTRIBUTION instrument: which cell, which tile depth, how far. */
  debugCellSeats(limit?: number): Array<{
    uri: string;
    seatM: number | null;
    seatDepth: number;
    gateM: number;
    reliefM: number;
    rejected: number;
    dirtyFrames: number;
    /** T77 slice C-1 — the per-cell quiet state (5a skip, 5e arming window, drain backlog). */
    applyIdle: boolean;
    terrainDirtyFrames: number;
    pending: number;
    /** T101 — is this cell HELD (skipped by the sampling passes until its plane re-samples)? */
    deepPending: boolean;
    features: number;
    worst: Array<{ seatM: number | null; seatDepth: number; appliedM: number | null; residM: number }>;
  }>;
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
  /** T118 — the deferred `load-model` units not yet drained; one integer, no allocation (the
   *  BEST SPOT readiness term's read — `debugLoad()` is the DEV ledger copy). */
  loadPending(): number;
  /** T106 — the `load-model` handler's cost ledger: cells landed since attach, ms in the
   *  crease-edge build / the per-building attribution / the whole handler (total + worst),
   *  and the cells that took three's own edge path (expected 0 on a baked variant). */
  debugLoad(): {
    cells: number;
    edgesMs: number;
    maskMs: number;
    /** The SYNCHRONOUS handler (phase 1: cell registration + material swap) — total and worst. */
    handlerMs: number;
    handlerMaxMs: number;
    slowPathCells: number;
    // T106 slice (b) — the deferred phase
    registerMs: number;
    edgesMaxMs: number; // worst single edge-build STEP (bounded by the budget + one chunk)
    maskMaxMs: number; // worst attribution unit (atomic)
    registerMaxMs: number; // worst registry unit (atomic)
    deferredMs: number; // total ms inside the per-frame drain
    deferredMaxMs: number; // the WORST single drain — the number the budget exists to bound
    deferredFrames: number;
    pending: number;
    unitsDone: number;
    unitsCancelled: number;
    budgetMs: number;
    // T115 — the resumable tree-instance locate (`locateTrees`): calls, chunks, instances,
    // total and worst ms per call, and how many tree sets are still mid-locate.
    treeLocateCalls: number;
    treeLocateChunks: number;
    treeLocateInstances: number;
    treeLocateMs: number;
    treeLocateMaxMs: number;
    treeLocatePending: number;
  };
  /** T106 slice (b) DEV seam — set the per-frame phase-2 budget live (ms; a huge value drains
   *  the whole queue in one frame = the pre-slice handler's per-frame shape, the A/B's B).
   *  Returns the value in force. */
  setLoadBudgetMs(ms: number): number;
  /** T106 DEV seam — the A/B and the §4a identity proof ON THE RESIDENT CELLS: for up to
   *  `limit` registered parts, run three's `EdgesGeometry` + the string-keyed attribution and
   *  the fast builder + the integer attribution on the SAME live floats, time both, and compare
   *  the outputs element-for-element. `mismatch` must read 0. */
  benchEdges(limit?: number): {
    parts: number;
    tris: number;
    threeMs: number;
    fastMs: number;
    maskStringMs: number;
    maskIntMs: number;
    mismatch: number;
    runMismatch: number;
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
    /** T77 slice B 4d — the same sampler with the answering tile's DEPTH (`ImageryGroundHandle.
     *  sampleAt`). Optional so the /m twin and the tests' stubs keep the plain sampler; without
     *  it every answer is depth `-1` = "cannot be judged", and the gate behaves as before. */
    terrainSampleAt?: (latDeg: number, lonDeg: number) => { h: number; depth: number } | null;
    /** T77 slice C-1 5e — `ImageryGroundHandle.terrainDirtyRegions`: DRAIN the ring of terrain
     *  regions ([w, s, e, n] in degrees) that arrived or were disposed since the last call. The
     *  seat drain is the ring's single consumer (it is drained on read) and uses it to re-arm
     *  exactly the cells whose ground moved, instead of sweeping the whole city forever. Optional
     *  — without it every cell falls back to the idle sweep rate, which is still correct, only
     *  slower to notice a change. */
    terrainDirtyRegions?: () => [number, number, number, number][];
    /** UPLIFT U5: the shared download-priority aim state (mirrors attachBuildings.loadAim). */
    loadAim: LoadAim;
    /** T106 slice (b): the per-frame ms budget for phase 2 of `load-model` (the deferred edge
     *  build / attribution / registry — `lib/globe/loadQueue`). The orchestrator keys it on
     *  `lean` (`ENRICHED.loadBudgetMs` / `loadBudgetMsLean`); the default is the desktop value. */
    loadBudgetMs?: number;
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
  /** T106 — the `load-model` handler's cost ledger (DEV seam `debugLoad()`): cells landed,
   *  ms in the crease-edge build and in the per-building attribution, the whole handler's
   *  total and worst, and how many cells took three's own (string-keyed) edge path. */
  const loadLedger = {
    cells: 0,
    edgesMs: 0,
    maskMs: 0,
    handlerMs: 0,
    handlerMaxMs: 0,
    slowPathCells: 0,
    // T106 slice (b): the deferred phase, per unit and per drain
    registerMs: 0,
    edgesMaxMs: 0,
    maskMaxMs: 0,
    registerMaxMs: 0,
    // 2026-09-07f: the edge builder's CONSTRUCTION apart from its steps (the tables' allocation
    // — on the Pixel the worst "step" was the biggest cell's fresh typed arrays, not a chunk)
    allocMs: 0,
    allocMaxMs: 0,
    // 2026-09-07f: the one-shot `ensureLocated` (the parts-first order), timed — FEATURES only
    // since T115 (the trees below)
    locateCalls: 0,
    locateMs: 0,
    locateMaxMs: 0,
    locateFeatures: 0,
    locateMaxFeatures: 0,
    // T115 (2026-09-07j): the tree-instance locate, RESUMABLE in chunks of TREE_LOCATE_CHUNK
    // under the reseat drain's deadline (`lib/globe/treeLocate`) — per call (one or more chunks)
    treeLocateCalls: 0,
    treeLocateChunks: 0,
    treeLocateInstances: 0,
    treeLocateMs: 0,
    treeLocateMaxMs: 0,
    /** Tree sets whose instances are not all located yet (a landing burst mid-drain). */
    treeLocatePending: 0,
  };
  /** T106 slice (b) — the deferred `load-model` queue (`lib/globe/loadQueue`): one unit per
   *  mesh, drained in `update()` under `loadBudgetMs` per frame, nearest cell first. */
  const loadQueue = createLoadQueue();
  let loadBudgetMs = opts.loadBudgetMs ?? ENRICHED.loadBudgetMs;
  /** 2026-09-07f: the edge builder's tables, reused by every unit in turn (one live builder per
   *  queue) — the per-unit ~9 MB of fresh typed arrays was the GC trigger on the Pixel. */
  const edgeScratch = createFastEdgesScratch();
  const maskScratch = createAttributorScratch();
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
    /** T77 4d — the tile depth `seatM` was taken from (−1 = unknown). A SHALLOWER answer never
     *  overwrites it: the fine tile was evicted, not the ground. */
    seatDepth: number;
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
    /** MS5b: pristine footprint extents (bake-local m) — display only (the SCALE rows' metres);
     *  captured with `rXZ` before any writer touches the array, never mutated after. */
    dx: number;
    dz: number;
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
    /** T77 4e — SEATED features whose held seat was carried through a cell-plane move and now
     *  wants one refinement against the finer tile. Drained after `unseated` (a stale seat is not
     *  the emergency an absent one is) and kept apart from it so RC7's invariant — the drain plus
     *  the seated count never exceeds the feature total — stays true (it caught the first cut). */
    refine: number[];
  }
  interface TreeSet {
    mesh: THREE.InstancedMesh;
    latDeg: Float64Array; // per-instance footprint (lazy-located — T115: in chunks, see `locateTrees`)
    lonDeg: Float64Array;
    /** T115 — every instance below `locCursor` has its lat/lon; `located` once the cursor reaches
     *  the count. The sampling passes never read an instance above the cursor. */
    locCursor: number;
    located: boolean;
    seatM: Float32Array; // NaN = never sampled
    appliedM: Float32Array; // NaN = on the cell plane
    seatDepth: Int16Array; // T77 4d — per instance, −1 = unknown (see FeatureSeat.seatDepth)
    cursor: number;
    /** RC7 — never-sampled instance indices, drained first (see MeshPart.unseated). */
    unseated: number[];
    /** T77 4e — seated instances queued for one refinement (see MeshPart.refine). */
    refine: number[];
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
    /** T77 slice B 4c — frames left in which this cell's own plane is UNSETTLED (its sweep
     *  sample just moved it by more than `ENRICHED.reseatCellSettleM`). While > 0 the apply-time
     *  plausibility gate HOLDS an implausible feature instead of collapsing it: the pair is
     *  expected to disagree exactly then, and collapsing on that disagreement was the
     *  poisoned-pair loop (4,277 collapses in 1,512 frames at the FPV eye, 2026-09-06h). */
    seatDirtyFrames: number;
    /** T77 4d — the tile depth the cell's own `seatM` came from (−1 = unknown). */
    seatDepth: number;
    /** T77 slice C-1 5a — this cell's last full apply pass wrote NOTHING, so its applied state is
     *  a fixed point and the pass may skip it entirely. Re-armed (`touchCell`) by every event
     *  that can create work: a footprint/tree sample, a plane move, a 4e carry, an override or
     *  spatial transform, a load, a seat-cache warm start. Never set while the cell still has a
     *  drain queue — a queued footprint is work by definition. */
    applyIdle: boolean;
    /** T77 slice C-1 5e — frames left in which this cell counts as "the ground under it just
     *  changed" (set from `terrainDirtyRegions()`): its plane is re-sampled first and its refresh
     *  sweep ignores `reseatIdleSweepEveryFrames`. */
    terrainDirtyFrames: number;
    /** T77 slice C-1 5e — this cell's PLANE still owes one out-of-turn re-sample because the
     *  ground under it changed. A one-shot flag, not a countdown: set when a drained dirty region
     *  arms the cell, cleared the moment the dirty-first plane sweep reaches it. It exists so an
     *  arming BURST drains over the following frames — the first cut tested
     *  `terrainDirtyFrames === reseatDirtyArmFrames` ("armed this very frame"), which silently
     *  dropped every armed cell past the frame's 6-sample plane budget back into the 60-cell
     *  round-robin the priority sweep exists to skip. */
    planeDirty: boolean;
    /** T77 slice C-1 — the frame in which this cell's plane was last re-sampled OUT of turn by
     *  the deep-answer rule, so one stale plane costs at most one extra raycast per frame. */
    deepResampleFrame: number;
    /** T101 (2026-09-06, owner ruling (a)) — this cell is HELD: a footprint answered from a DEEPER
     *  tile than the plane, disagreed with it, and the deep-answer rule could not re-sample the
     *  plane this frame (`reseatDeepResampleMaxPerFrame` spent, or the cell already corrected once
     *  this frame). Every sample against that plane is a foregone rejection, so `sampleFeatures` /
     *  `sampleTrees` skip the cell entirely — the raycast budget was the thing being wasted
     *  (+39,629 re-rejections over the 479-frame orbit arrival, 2026-09-06k2). One flag, not a
     *  count: set by `acceptSample`, cleared by `refreshCellPlane` — the single plane-move law, so
     *  ANY path that re-samples the plane (round-robin, dirty-first sweep, the deep rule itself)
     *  re-opens the cell, and its features are still where they were in `unseated`/`refine`. */
    deepPending: boolean;
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
    touchCell(cell); // T77 5a: an override/transform target is apply-pass work
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
  /** T77 slice C-1 5d — may the REFRESH round-robin (pass 2 of `sampleFeatures`/`sampleTrees`)
   *  run this frame? Computed once per frame in `update()` from `reseatIdleSweepEveryFrames`; a
   *  cell whose ground just changed (5e, `terrainDirtyFrames`) ignores it. */
  let sweepNow = true;
  /** RC7 — the look-biased top-K cells the per-feature sweep prioritises (re-ranked every
   *  `reseatPriorityEveryFrames`, or whenever one of them was evicted). */
  let priorityCells: CellSeat[] = [];
  let cellSweep = 0; // global round-robin cell cursor (building sampling)
  /** T77 slice C-1 5e — cursor for the DIRTY-first plane sweep (see `update()`). */
  let dirtySweep = 0;
  let treeSweep = 0; // ditto for tree sampling
  let seatEpochN = 0;
  let seatQuietN = 0;
  // DEBUG HUD (owner 2026-09-01) — running totals for the cheap `debugCounts()` accessor: the
  // per-cell twins live on CellSeat and are only reachable through debugSeats()'s full walk.
  let deferredN = 0; // null-TERRAIN sample deferrals (acceptSample h == null)
  let rejectedN = 0; // plausibility-gate rejections (twin of the per-cell `rejected`)
  // T77 step 4a (2026-09-06) — the POISONED-PAIR collapses, counted separately from `rejectedN`.
  // Both names describe a plausibility-gate failure, but they are different events with different
  // costs: `rejectedN` is a SAMPLE thrown away at acceptSample time (the footprint keeps its old
  // seat and nothing on screen moves), while this one fires at APPLY time, when a feature that
  // was already seated is COLLAPSED back onto the cell plane — i.e. a building visibly drops by
  // up to the cell gate and must be re-sampled from the head of the drain. Folding both into one
  // counter is why the measurement could not tell "the gate is doing its job" from "buildings are
  // being yanked around", so they are now two numbers. `rejectedN`'s meaning is unchanged; the
  // per-cell `cell.rejected` still counts BOTH (it is the per-cell health total).
  let collapsedN = 0;
  /** T77 slice C-1 5b — REFRESH answers discarded by the sub-pixel freeze. Not a rejection (the
   *  answer was plausible) and not a deferral (the terrain answered): the seat we hold is already
   *  right to within half a pixel, so writing it would cost a buffer upload for nothing. The
   *  number that says the freeze is working is this one climbing while `movedFeatures` falls. */
  let frozenN = 0;
  /** Per-pass reasons `applyFeatureSeats` counted a cell as work (2026-09-07h, DEV seam). */
  const applyReasons = { hold: 0, collapse: 0, resid: 0, scale: 0, xf: 0, fill: 0, treeHold: 0, treeCollapse: 0, treeOff: 0, treeWrite: 0 };
  /** T77 slice C-1 — cell planes re-sampled OUT OF TURN because a footprint answered from a
   *  DEEPER tile than the plane itself (the boot-time rejection fix). Bounded to one per cell per
   *  frame; a climb after quiet would mean the plane sweep is losing a race, not catching up. */
  let deepResampleN = 0;
  /** T77 slice C-1 — this frame's share of that. The per-CELL bound alone is not a bound on COST:
   *  at the boot the terrain refines under every resident cell at once, so "one per cell per
   *  frame" is one extra plane raycast per cell — 60 of them, 0.02–0.07 ms each, i.e. up to ~4 ms
   *  of exactly the main-thread regression this slice exists to remove. Reset in `update()` and
   *  spent against `ENRICHED.reseatDeepResampleMaxPerFrame`; what it defers arrives one frame
   *  later through the same path. */
  let deepResampleSpent = 0;
  /** T101 (2026-09-06) — deeper-disagreeing answers the cap could NOT serve, whose cell was HELD
   *  instead of the sample being rejected. Not a rejection (the plane, not the answer, is the
   *  stale half) and not a deferral (the terrain answered): the cell waits for its plane. The
   *  number that says the hold is working is this one climbing through the arrival burst while
   *  `rejected` stays near the resident cell count instead of +39,629; a climb after quiet means
   *  a cell's centre is answering coarser than its footprints, forever (see `deepAnswerVerdict`). */
  let deepHeldN = 0;
  /** T77 4d — answers refused because a SHALLOWER tile than the held seat's produced them (the
   *  LRU had evicted the fine tile). Not a rejection: the ground did not move, the cache did. */
  let shallowN = 0;
  // T77 MEASURE (2026-09-05) — seatSettle() accumulators, rewritten by every applyFeatureSeats()
  // pass. `prioritySet` mirrors `priorityCells` (rebuilt only when the ranking is), so the
  // near-scope test inside the apply loop is one Set.has per CELL, never an allocation per frame.
  let applyMaxResidualM = 0;
  let applyMovedN = 0;
  let applyNearMaxResidualM = 0;
  let applyNearMovedN = 0;
  // T77 NEW-3: the CELL layer's own residual. The feature residuals above are measured against
  // (feature seat − cell seat), so a cell plane that never lands is invisible to them even though
  // it moves every building on it — the metric was checkable but not SUFFICIENT. Reset by the
  // per-cell pass in update(), read by seatSettle().
  let applyCellMaxResidualM = 0;
  let prioritySet: Set<CellSeat> = new Set();
  const _w = new THREE.Vector3();
  const _m5 = new THREE.Vector3(); // RC0 M5 scratch (bake-height capture, once per cell)
  /** RC7 — cells sorted by look-biased distance, truncated to `reseatPriorityCells`. */
  const rankPriorityCells = (): CellSeat[] =>
    cellList
      .map((c) => ({ c, d: lookBiasedDistance(c.ecef, opts.loadAim) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, ENRICHED.reseatPriorityCells)
      .map((x) => x.c);

  /**
   * T106 slice (b) (2026-09-07e) — PHASE 2 of a mesh's `load-model`, as one unit on the deferred
   * queue. Five phases in the order the pristine contract needs; a step returns only BETWEEN
   * phases or inside a resumable loop, never with a half-written structure visible:
   *   0 · the crease edges — `createEdgesBuilder`, RESUMABLE under the frame deadline (the
   *       biggest Dnipro cell's build alone is ~20 ms on the phone twin); on completion the
   *       `LineSegments` is added with ITS OWN F1 birth stamp (`frameNow()` at that frame —
   *       T94: the seam's clock), so the strokes dissolve in when they exist, not retroactively;
   *   1 · the per-building segment attribution — `createSegmentRunAttributor`, RESUMABLE (the
   *       biggest cell's was 18 ms atomic on the twin, the first cut's worst frame);
   *   2 · the CSR + edge spans + the one-time bounds pad (atomic, small);
   *   3 · the feature fingerprints from the PRISTINE floats (no seat write can have touched
   *       them — the apply passes only walk registered parts), RESUMABLE by run;
   *   4 · the part object and, if the cell was located while this unit waited (the one-shot
   *       `ensureLocated` will not run again for it), the footprint locate — RESUMABLE by
   *       feature;
   *   5 · the registration (atomic, small): the RC9 banked seats, `cell.parts.push` +
   *       `partByMesh.set`, the override re-apply, and `touchCell` so the apply pass sees the
   *       new features.
   * `dispose-model` cancels the unit by its scene; a cancelled unit mid-build is just dropped.
   */
  const makeMeshLoadUnit = (key: object, cell: CellSeat | null, c: THREE.Mesh): LoadUnit => {
    // 0 edges (resumable) · 1 attribution (resumable) · 2 CSR + spans + bounds (atomic) ·
    // 3 feature fingerprints (resumable, by run) · 4 the part + footprint locate (resumable) ·
    // 5 register (atomic) · 6 done
    let phase = 0;
    let part: MeshPart | null = null;
    let locCursor = 0;
    let builder: EdgesBuilder | null = null;
    let edgeBuild: EdgesBuild | null = null;
    let edges: THREE.LineSegments | null = null;
    let runs: FeatureRun[] = [];
    let posAttr: THREE.BufferAttribute | null = null;
    let edgeAttr: THREE.BufferAttribute | null = null;
    let attributor: SegmentRunAttributor | null = null;
    let segRuns: Int32Array | null = null;
    let edgeCsr: ReturnType<typeof csrFromRunIds> | null = null;
    let edgeSpan: Int32Array | null = null;
    let features: FeatureSeat[] = [];
    const runIdx = new Map<number, number>();
    let runCursor = 0;
    let cellMeta: CellMeta | null | undefined;
    const over = (deadlineMs: number): boolean => performance.now() >= deadlineMs;
    const ledger = (k: "edges" | "mask" | "register", dt: number): void => {
      if (k === "edges") {
        loadLedger.edgesMs += dt;
        if (dt > loadLedger.edgesMaxMs) loadLedger.edgesMaxMs = dt;
      } else if (k === "mask") {
        loadLedger.maskMs += dt;
        if (dt > loadLedger.maskMaxMs) loadLedger.maskMaxMs = dt;
      } else {
        loadLedger.registerMs += dt;
        if (dt > loadLedger.registerMaxMs) loadLedger.registerMaxMs = dt;
      }
    };
    return {
      key,
      priority: () => (cell ? lookBiasedDistance(cell.ecef, opts.loadAim) : 0),
      step(deadlineMs) {
        if (phase === 0) {
          const t0 = performance.now();
          // T106 (2026-09-07d): the crease edges through the fast builder — element-identical
          // to `new THREE.EdgesGeometry(c.geometry, ENRICHED.edgeAngleDeg)` (pinned by
          // `fastEdges.test`, resumed or not), without the string hashing that was 1.8 s of the
          // Pixel's descent.
          if (!builder) {
            builder = createEdgesBuilder(c.geometry, ENRICHED.edgeAngleDeg, edgeScratch);
            const dtAlloc = performance.now() - t0;
            loadLedger.allocMs += dtAlloc;
            if (dtAlloc > loadLedger.allocMaxMs) loadLedger.allocMaxMs = dtAlloc;
          }
          const t1 = performance.now();
          const done = builder.step(deadlineMs);
          ledger("edges", performance.now() - t1);
          if (!done) return false;
          edgeBuild = builder.result();
          builder = null;
          loadLedger.cells++;
          if (!edgeBuild.fast) loadLedger.slowPathCells++;
          const birthMs = frameNow(); // F1: the strokes' own birth — this frame, from the seam
          edges = new THREE.LineSegments(edgeBuild.geometry, edgeMat);
          edges.raycast = () => {}; // never let GlobeControls pick a decoration line
          edges.onBeforeRender = () => {
            uniforms.uEdgeBirthMs.value = birthMs; // F1: its own holder (separate draw item)
          };
          c.add(edges);
          // A late child is not reached by the tile scene's one-shot world-matrix update (see
          // scene/buildings.ts) — the cell's seat passes re-run `updateMatrixWorld` and have hidden
          // it here, but a cell that never re-seats after its edges land would draw them inside
          // the planet. Seat the stroke itself (2026-09-07f).
          edges.updateMatrixWorld(true);
          // Per-building re-seat registry: contiguous `_feature_id_0` runs + the exact-position
          // CSR that lets each building drag ITS OWN edge verts along. Built from the PRISTINE
          // buffers (before any delta) — the key map must match what the edge builder copied.
          const fid = cell && ENRICHED.reseatPerFeature ? c.geometry.getAttribute("_feature_id_0") : null;
          const pa = c.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
          const plain =
            !!pa &&
            !(pa as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
            !pa.normalized &&
            pa.array instanceof Float32Array;
          if (!fid || !plain) {
            phase = 6;
            return true;
          }
          posAttr = pa as THREE.BufferAttribute;
          runs = featureRunsOf(fid.array);
          edgeAttr = edges.geometry.getAttribute("position") as THREE.BufferAttribute | null;
          phase = 1;
          if (over(deadlineMs)) return false;
        }
        if (phase === 1) {
          const t0 = performance.now();
          // MS1: collision-aware per-SEGMENT attribution — a party-wall corner's stroke stays
          // with the building whose other end it touches, so a move/rotate never stretches a
          // neighbour's edge. T106: from the edge builder's SOURCE indices on integer keys
          // (`createSegmentRunAttributor`, the same rules as `mapSegmentsToRuns` — pinned by
          // `fastEdges.test`, resumed or not); the string-keyed path stays for a geometry the
          // fast edge builder declined (never a baked cell).
          if (edgeAttr && edgeBuild?.srcIndex && posAttr) {
            if (!attributor) attributor = createSegmentRunAttributor(edgeBuild.srcIndex, posAttr.array, runs, maskScratch);
            const done = attributor.step(deadlineMs);
            ledger("mask", performance.now() - t0);
            if (!done) return false;
            segRuns = attributor.result();
            attributor = null;
          } else if (edgeAttr && posAttr) {
            const { map: keyMap, collisions } = vertexKeyToRunWithCollisions(posAttr.array, runs);
            segRuns = mapSegmentsToRuns(edgeAttr.array, keyMap, collisions);
            ledger("mask", performance.now() - t0);
          }
          phase = 2;
          if (over(deadlineMs)) return false;
        }
        if (phase === 2) {
          const t0 = performance.now();
          edgeCsr = segRuns ? csrFromRunIds(segRuns, runs.length) : null;
          segRuns = null;
          // MS1: per-run [min, max] edge vertex index — the partial-upload range of a run's
          // strokes (a run's crease segments are emitted contiguously by the edge builder).
          edgeSpan = null;
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
          for (const g of [c.geometry, (edges as THREE.LineSegments).geometry]) {
            if (!g.boundingSphere) g.computeBoundingSphere();
            if (g.boundingSphere) g.boundingSphere.radius += ENRICHED.reseatBoundsPadM;
          }
          // RC17: the sidecar is guaranteed present by the time this runs (the fetch plugin
          // resolves the model behind it), so `baseY` can be the building's TRUE base from the
          // first frame rather than the geometric minimum RC13's skirt just moved 4 m down.
          // Every downstream consumer — the U8 scale pivot, the ghost rebase, the bounds
          // growth, the reported height — asks for "the building's base" and now gets it.
          cellMeta = cell?.uri ? metaByUri.get(cell.uri) : undefined;
          features = new Array(runs.length);
          ledger("mask", performance.now() - t0);
          phase = 3;
          if (over(deadlineMs)) return false;
        }
        if (phase === 3 && posAttr) {
          const t0 = performance.now();
          // U8: pristine per-run capture (base/top Y + centroid X/Z) — MUST happen before any
          // seat write mutates Y (none can: the part is not registered yet). Baked height,
          // checksum and ghost all read these. Resumable by RUN under the deadline, checked
          // every ~1,024 vertices.
          const posArr = posAttr.array as Float32Array;
          let sinceCheck = 0;
          while (runCursor < runs.length) {
            const i = runCursor++;
            const run = runs[i];
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
            features[i] = {
              run,
              latDeg: 0,
              lonDeg: 0,
              seatM: null,
              seatDepth: -1,
              appliedM: null,
              baseY: m ? baseY + m.skirt : baseY,
              topY,
              cls: m?.cls ?? null,
              osm: m?.osm ?? null,
              cx,
              cz,
              rXZ: runRadiusXZ(cx, cz, minX, maxX, minZ, maxZ),
              dx: Number.isFinite(maxX - minX) ? maxX - minX : 0,
              dz: Number.isFinite(maxZ - minZ) ? maxZ - minZ : 0,
              scaleK: 1,
              appliedK: 1,
              xf: null,
              axf: null,
              pristine: null,
              pristineEdge: null,
              ov: 0,
            };
            sinceCheck += run.count;
            if (sinceCheck >= 1024) {
              sinceCheck = 0;
              if (runCursor < runs.length && over(deadlineMs)) {
                ledger("register", performance.now() - t0);
                return false;
              }
            }
          }
          ledger("register", performance.now() - t0);
          phase = 4;
          if (over(deadlineMs)) return false;
        }
        if (phase === 4 && cell && posAttr && edges) {
          // Build the part (a plain object — registration is the push below), then the footprint
          // locate: the cell may have been located (its first plane sample landed) while this
          // unit waited, and `ensureLocated` is one-shot per cell, so these footprints are
          // located HERE — RESUMABLE by feature (an ECEF → geodetic per building; the biggest
          // cell's ~2,000 were 13.7 ms atomic on the twin in the first cut).
          const t0 = performance.now();
          if (!part) {
            part = {
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
              refine: [], // T77 4e
            };
          }
          if (cell.located) {
            while (locCursor < features.length) {
              locateFeature(part, features[locCursor++]);
              if ((locCursor & 255) === 0 && locCursor < features.length && over(deadlineMs)) {
                ledger("register", performance.now() - t0);
                return false;
              }
            }
          }
          ledger("register", performance.now() - t0);
          phase = 5;
          if (over(deadlineMs)) return false;
        }
        if (phase === 5 && cell && part) {
          const t0 = performance.now();
          // The cell may have become located on the frame boundary between phase 4 and here
          // (the sampling pass's one-shot `ensureLocated` walks only REGISTERED parts): finish
          // the locate atomically rather than register footprints at lat/lon 0.
          if (cell.located) for (; locCursor < features.length; locCursor++) locateFeature(part, features[locCursor]);
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
          touchCell(cell); // T77 5a: new features are apply-pass work
          ledger("register", performance.now() - t0);
        }
        phase = 6;
        return true;
      },
    };
  };

  tiles.addEventListener("load-model", (e: any) => {
    // One birth stamp per TILE (this load-model event) — the whole cell dissolves in as a unit
    // (the F1 screen-door reveal, same as the OSM tiles). One tone seed per tile, ditto.
    // T94: `frameNow()` — the clock `uNowMs` is stamped with, so a tile that resolves during a
    // freeze is not born in the future (see the same note in `buildings.ts`).
    const birthMs = frameNow();
    const tHandler = performance.now();
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
        seatDirtyFrames: 0,
        seatDepth: -1,
        bakedElevM: null,
        applyIdle: false, // T77 5a: a new cell has everything to do
        terrainDirtyFrames: 0,
        planeDirty: false, // T77 5e: the round-robin owns a brand-new cell's first plane sample
        deepResampleFrame: -1,
        deepPending: false, // T101: nothing has disagreed with a plane that does not exist yet
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
            locCursor: 0,
            located: n === 0,
            seatM: new Float32Array(n).fill(NaN),
            appliedM: new Float32Array(n).fill(NaN),
            seatDepth: new Int16Array(n).fill(-1),
            cursor: 0,
            unseated: Array.from({ length: n }, (_v, i) => i), // RC7
            refine: [],
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
        // T106 slice (b) (2026-09-07e): everything else this mesh needs — the crease edges, the
        // per-building edge attribution, the feature registry, the banked seats, the override
        // re-apply — is PHASE 2: one unit on the deferred queue, drained by `update()` under
        // `loadBudgetMs` per frame (`makeMeshLoadUnit`). Nothing writes this mesh's buffers
        // until that unit registers the part (the seat passes only walk `cell.parts`), so the
        // §4a pristine capture is still a straight copy of what the parser produced.
        loadQueue.push(makeMeshLoadUnit(e.scene, cell, c));
      }
    });
    const dtHandler = performance.now() - tHandler;
    loadLedger.handlerMs += dtHandler;
    if (dtHandler > loadLedger.handlerMaxMs) loadLedger.handlerMaxMs = dtHandler;
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    loadQueue.cancel(e.scene); // T106 (b): a unit still waiting for this tile is dropped whole
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
  // jump; cells/features already ease). The APPLIED seat now rides the same seatLand discipline
  // (first sample snaps, refinements ease), and the per-cell targets reference the APPLIED value
  // so the sum (group + cell + feature) still converges on each footprint's own terrain.
  let seatAppliedM: number | null = null;

  /** One-shot footprint location for a cell's FEATURES: run centroids → world → geodetic. Gated
   *  on the cell having snapped once (its scene matrixWorld was force-updated); vertical deltas
   *  never move a footprint's lat/lon, so locating before/after writes is safe. The trees are
   *  NOT here since T115 — `locateTrees` below, resumable. */
  const ensureLocated = (cell: CellSeat): boolean => {
    if (cell.located) return true;
    if (cell.appliedM == null) return false;
    // 2026-09-07f: timed — a cell located AFTER its parts registered (the other order locates
    // per part in the unit's phase 4, resumably). On the Pixel's descent this fired 58× with
    // 0 features (§25.5); the 7.5 ms max it carried was the tree loop, now `locateTrees`.
    const t0 = performance.now();
    let n = 0;
    for (const part of cell.parts) {
      for (const f of part.features) locateFeature(part, f);
      n += part.features.length;
    }
    cell.located = true;
    const dt = performance.now() - t0;
    loadLedger.locateCalls++;
    loadLedger.locateMs += dt;
    loadLedger.locateFeatures += n;
    if (dt > loadLedger.locateMaxMs) {
      loadLedger.locateMaxMs = dt;
      loadLedger.locateMaxFeatures = n;
    }
    return true;
  };

  /** T115 — the reseat drain's deadline for this frame (`sampleT0 + reseatBudgetMs`, set in
   *  `update()`), and the tree locate's own: the FIRST chunk of a frame always runs (a budget
   *  bounds the work, never starves it — the loadQueue's law), every further chunk only while
   *  the later of the two deadlines is unspent — the drain's, or `treeLocateBudgetMs` after the
   *  frame's first chunk began. Without the second the locate crawled at one chunk per frame
   *  behind a spent reseat budget (113 sets still unlocated at the end of a desktop descent). */
  let sampleDeadlineMs = 0;
  let treeLocateDeadlineMs = 0;
  let treeLocateChunkedThisFrame = false;

  /** T115 — tree sets the drain still OWES a locate: unlocated, in a cell that has snapped (an
   *  un-snapped cell's sets are not pending in any actionable sense — `ensureLocated` waits on
   *  the same snap). Non-zero only during a landing burst. */
  const treeLocatePendingCount = (): number => {
    let n = 0;
    for (const cell of cellList) {
      if (cell.appliedM == null) continue;
      for (const t of cell.trees) if (!t.located) n++;
    }
    return n;
  };

  /** T115 — locate a cell's tree instances (instance translation → world → geodetic) in chunks
   *  of `TREE_LOCATE_CHUNK` under the drain's deadline. Byte-identical to the one-shot it
   *  replaced (`lib/globe/treeLocate.ts`, pinned against three). Gated like `ensureLocated` on
   *  the cell's first snap (the mesh's matrixWorld is final by then).
   *  @returns true when every set of the cell is located */
  const locateTrees = (cell: CellSeat): boolean => {
    if (cell.appliedM == null) return false;
    for (const t of cell.trees) {
      if (t.located) continue;
      const n = t.seatM.length;
      const arr = t.mesh.instanceMatrix.array as ArrayLike<number>;
      const world = t.mesh.matrixWorld.elements;
      const t0 = performance.now();
      let chunks = 0;
      let done = 0;
      while (t.locCursor < n) {
        if (treeLocateChunkedThisFrame) {
          const now = performance.now();
          if (now >= sampleDeadlineMs && now >= treeLocateDeadlineMs) break;
        } else {
          treeLocateChunkedThisFrame = true;
          treeLocateDeadlineMs = performance.now() + ENRICHED.treeLocateBudgetMs;
        }
        const to = Math.min(n, t.locCursor + TREE_LOCATE_CHUNK);
        done += to - t.locCursor;
        t.locCursor = locateTreeInstances(arr, world, t.locCursor, to, t.latDeg, t.lonDeg);
        chunks++;
      }
      if (chunks > 0) {
        const dt = performance.now() - t0;
        loadLedger.treeLocateCalls++;
        loadLedger.treeLocateChunks += chunks;
        loadLedger.treeLocateInstances += done;
        loadLedger.treeLocateMs += dt;
        if (dt > loadLedger.treeLocateMaxMs) loadLedger.treeLocateMaxMs = dt;
      }
      if (t.locCursor >= n) t.located = true;
      else return false;
    }
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
  /** T77 slice C-1 5a — re-arm a cell for the apply pass. ONE named choke point so "what can
   *  create seat work in a cell" is a list you can read rather than a property you must prove.
   *  Cheap by construction (one boolean store), so it is called on every write path. */
  const touchCell = (cell: CellSeat): void => {
    cell.applyIdle = false;
  };
  /** T77 slice C-1 5a — how many resident cells the apply pass is currently skipping. The gate
   *  number for "the drain is quiet": at a settled pose it equals the resident cell count. */
  const idleCellCount = (): number => {
    let n = 0;
    for (const cell of cellList) if (cell.applyIdle) n++;
    return n;
  };
  /** T101 — how many resident cells the sampling passes are currently skipping because their
   *  plane is known-stale (`deepPending`). Non-zero only while tiles are refining under cells the
   *  6-per-frame plane sweep has not reached; at a quiet pose it must read 0. Same O(cells) walk
   *  and the same seams as `idleCellCount`. */
  const deepPendingCellCount = (): number => {
    let n = 0;
    for (const cell of cellList) if (cell.deepPending) n++;
    return n;
  };
  /** T101 — is this cell HELD right now? The one predicate the sampling passes consult, at entry
   *  and after every `acceptSample` (the hold is set INSIDE that call, and the pass must stop at
   *  the first held answer rather than spend the rest of its budget on the same stale plane).
   *  Gated on the tunable so `reseatDeepPendingHold: false` never skips anything, even if a stale
   *  flag were somehow left on a cell. */
  const cellHeld = (cell: CellSeat): boolean => ENRICHED.reseatDeepPendingHold && cell.deepPending;
  /** T77 slice C-1 5a — does this cell still owe the drain anything? Early-exits on the first
   *  non-empty queue, so a settled cell costs one walk of its (few) parts and tree sets. */
  const cellHasPending = (cell: CellSeat): boolean => {
    for (const part of cell.parts) if (part.unseated.length > 0 || part.refine.length > 0) return true;
    for (const t of cell.trees) if (t.unseated.length > 0 || t.refine.length > 0) return true;
    return false;
  };
  /** T77 slice C-1 5b — the vertical metres one screen pixel spans at 1 m from the eye. Computed
   *  ONCE per frame in `update()` (the camera and the drawing buffer are constant across a pass)
   *  and multiplied by a cell's own distance to get its metres-per-pixel. 0 disables the freeze,
   *  which is what a stubbed renderer/camera in the unit tests gets. */
  let metresPerPixelPerM = 0;
  const refreshPixelScale = (): void => {
    const cam = opts.camera;
    const h = opts.renderer?.domElement?.height ?? 0;
    if (!cam || !(h > 0) || !(cam.fov > 0)) {
      metresPerPixelPerM = 0;
      return;
    }
    metresPerPixelPerM = (2 * Math.tan((cam.fov * Math.PI) / 360)) / h;
  };
  /** T77 slice C-1 5b — the deadband (m) under which a REFRESHED answer for a footprint in this
   *  cell is discarded. See `ENRICHED.reseatMinSeatPx` for the two bounds and why they exist.
   *  Returns 0 (no freeze) when the pixel scale is unknown or the knob is off. */
  const cellFreezeM = (cell: CellSeat): number => {
    const eye = opts.loadAim?.eye;
    if (!eye) return 0;
    const dx = cell.ecef.x - eye.x;
    const dy = cell.ecef.y - eye.y;
    const dz = cell.ecef.z - eye.z;
    return seatFreezeM(
      ENRICHED.reseatMinSeatPx,
      metresPerPixelPerM,
      Math.sqrt(dx * dx + dy * dy + dz * dz),
      cell.reliefHiM - cell.reliefLoM,
      ENRICHED.reseatExpectedReliefM,
      ENRICHED.reseatFreezeReliefK,
    );
  };
  /** T77 4e — a cell plane moved by `dM`: shift every held seat with it and queue the lot for a
   *  fresh sample at the drain's TAIL (the head is the array END — `unseated.pop()`). O(features)
   *  once per plane move; never touches an unsampled feature (its seat is the plane itself). */
  const shiftCellSeats = (cell: CellSeat, dM: number): void => {
    touchCell(cell); // T77 5a: every held seat in this cell just moved
    for (const part of cell.parts) {
      const requeue: number[] = [];
      for (let r = 0; r < part.features.length; r++) {
        const f = part.features[r];
        if (f.seatM == null) continue;
        f.seatM += dM;
        requeue.push(r);
      }
      if (requeue.length) part.refine = requeue.concat(part.refine);
    }
    for (const t of cell.trees) {
      const requeue: number[] = [];
      for (let i = 0; i < t.seatM.length; i++) {
        if (Number.isNaN(t.seatM[i])) continue;
        t.seatM[i] += dM;
        requeue.push(i);
      }
      if (requeue.length) t.refine = requeue.concat(t.refine);
    }
  };
  /** T77 4d — one terrain sample with its tile depth; the plain sampler when the depth-aware one
   *  is not wired (depth −1). */
  const sampleAt = (latDeg: number, lonDeg: number): { h: number; depth: number } | null => {
    if (opts.terrainSampleAt) return opts.terrainSampleAt(latDeg, lonDeg);
    const h = opts.terrainHeightAt(latDeg, lonDeg);
    return h == null ? null : { h, depth: -1 };
  };
  /** T77 4d — may this answer replace the seat we hold? Only a depth that is KNOWN on both sides
   *  and strictly shallower is refused; unknowns always pass (the pre-4d behaviour).
   *
   *  OFF by default (`ENRICHED.reseatDepthGuard`), and the browser said why (2026-09-06h): the
   *  orbit ARRIVAL leg went from a city-wide p95 of 0.00 m to 33.5 m with the guard on. At 700 m
   *  the traversal SETTLES coarser than the finest tile it passed through on the way, so the fine
   *  tile is legitimately disposed — and a seat that refuses the resident tile's answer is a seat
   *  against ground that is no longer drawn. Worse, the CELL plane and its features refuse at
   *  different moments, which is the poisoned pair by another name (578 refusals, cell p95 8 m).
   *  The seat must follow the RENDERED terrain, whatever its depth; LRU thrash at a static pose
   *  is the LRU's defect (slice C/D), not the seat's. The counter stays as a diagnostic. */
  const shallowerThanHeld = (heldDepth: number, depth: number): boolean =>
    ENRICHED.reseatDepthGuard && heldDepth >= 0 && depth >= 0 && depth < heldDepth;
  /** T77 slice C-1 — re-sample ONE cell's plane and run the 4c hold / 4e carry a plane move
   *  requires. Extracted from the round-robin in `update()` so the deep-answer rule below can
   *  correct a stale plane OUT OF TURN through exactly the same path: there must be one
   *  plane-move law, or the pair `f.seatM − cell.seatM` goes poisoned again by a second route. */
  const refreshCellPlane = (cell: CellSeat): void => {
    // T101 (2026-09-06) — RELEASE a held cell on entry, i.e. on the ATTEMPT rather than on a
    // successful answer. The hold exists because its plane was known-stale; this is the one place
    // the plane is re-sampled, through every path (round-robin, dirty-first sweep, the deep rule
    // itself), so it is the one place the hold can end. Releasing on the attempt is what keeps a
    // held cell from wedging: a centre that answers null (its tile mid-refine) or is refused by
    // the 4d guard re-opens the cell for exactly one feature sample per plane-sweep rotation —
    // the round-robin's own rate — instead of parking it until the centre answers, which for a
    // permanently unanswerable centre is never. Nothing is re-queued: the held features never
    // left `unseated`/`refine`, so "re-queue once" is "stop skipping". `touchCell` is the 5a
    // contract — a re-opened cell may have work again — and is a no-op if it already had some.
    if (cell.deepPending) {
      cell.deepPending = false;
      touchCell(cell);
    }
    const cs = sampleAt(cell.latDeg, cell.lonDeg);
    if (!cs) return;
    // T77 4d: a cell plane taken from a fine tile is never replaced by its coarse parent.
    if (shallowerThanHeld(cell.seatDepth, cs.depth) && cell.seatM != null) {
      shallowN++;
      return;
    }
    cell.seatDepth = cs.depth;
    const nextSeat = clampGroundM(cs.h);
    // T77 slice B 4c: a cell plane that just moved by more than the settle bound is UNSETTLED for
    // a few frames — the apply-time gate holds instead of collapsing while the features under it
    // re-sample against the new plane.
    if (cell.seatM != null && Math.abs(nextSeat - cell.seatM) > ENRICHED.reseatCellSettleM) {
      cell.seatDirtyFrames = ENRICHED.reseatCellSettleFrames;
      // T77 slice B 4e (2026-09-06h, browser-attributed): CARRY the plane move. Every feature seat
      // in this cell was sampled against the OLD plane, so the pair `f.seatM − cell.seatM` is
      // about to disagree by exactly this delta — the whole poisoned-pair mechanism, measured at
      // the FPV boot as the terrain refined depth 7 → 8 → 9 → 15 → 17 (plane 0 → 45 → 86 m): each
      // step collapsed every feature of every cell it moved (889 + 968 collapses in two ticks)
      // and re-drained them all. Shifting the held seats by the same delta keeps every target
      // CONTINUOUS (no collapse, no jump — the building rides the cell ease), and queueing them
      // at the drain's TAIL refines each one exactly once against the finer tile.
      shiftCellSeats(cell, nextSeat - cell.seatM);
    }
    // T77 slice C-1 5a: every feature target in this cell is `f.seatM − cell.seatM`, so a plane
    // move re-arms the whole cell whether or not it crossed the 4c settle bound.
    if (cell.seatM !== nextSeat) touchCell(cell);
    cell.seatM = nextSeat;
  };
  const acceptSample = (
    h: number | null,
    cell: CellSeat,
    depth = -1,
    heldM: number | null = null,
  ): number | null => {
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
      // T77 slice C-1 — a DEEPER answer than the plane's own is evidence the PLANE is stale, not
      // that the answer is garbage. The plane is swept 6 cells a frame; at the FPV boot the
      // terrain refines depth 7 → 18 under a cell long before its centre comes round again, and
      // the gate rejected +1,324 REAL samples on the way in. Correct the plane once per cell per
      // frame (through `refreshCellPlane`, so 4c/4e still hold) and re-test against it.
      //
      // T101 (2026-09-06, owner ruling (a)) — and when the correction CANNOT run this frame (the
      // per-frame cap is spent, or this cell was already corrected once this frame and the plane
      // still disagrees), HOLD THE CELL instead of rejecting the sample. Falling through to
      // `rejected` was the C-1 fall-through: the feature went back into its queue and was raycast
      // and rejected again every frame against the same stale plane until the round-robin reached
      // the cell — +39,629 re-rejections over the 479-frame orbit arrival (2026-09-06k2), the
      // sampling budget burnt while the tiles were still streaming. A held sample is NOT a
      // rejection: `rejected` keeps meaning "implausible against a CURRENT plane", and the FPV
      // eye's `rejected +0` reading keeps its meaning. The feature keeps its sticky seat exactly
      // as a rejected one does; the cell is skipped by the sampling passes until
      // `refreshCellPlane` re-opens it. The decision itself is `deepAnswerVerdict`
      // (lib/globe/seatQuiet — pure, unit-gated); `reseatDeepPendingHold: false` turns "hold"
      // back into "reject" and reproduces the per-frame re-rejection exactly.
      const verdict = deepAnswerVerdict(
        ENRICHED.reseatResampleCellOnDeep,
        ENRICHED.reseatDeepPendingHold,
        depth,
        cell.seatDepth,
        cell.deepResampleFrame === frameNo,
        deepResampleSpent,
        ENRICHED.reseatDeepResampleMaxPerFrame,
      );
      if (verdict === "resample") {
        cell.deepResampleFrame = frameNo;
        deepResampleSpent++;
        deepResampleN++;
        refreshCellPlane(cell);
      } else if (verdict === "hold") {
        cell.deepPending = true;
        deepHeldN++;
        return null;
      }
      if (cell.seatM == null || Math.abs(c - cell.seatM) > cellGateM(cell)) {
        cell.rejected++;
        rejectedN++;
        return null;
      }
    }
    // T77 slice C-1 5b — the sub-pixel freeze. A REFRESH that would move a held seat by less than
    // the deadband is discarded: the answers a warm memo/raycast gives for the same footprint
    // wander by millimetres, `seatSnapM` is 5 mm, and every one of those wanders used to restart
    // and land an ease — 103 features a frame writing forever at a QUIET pose, and the position
    // buffers they dirtied made `bufferSubData` 57 % of the FPV main thread. Never applied to a
    // first sample (`heldM == null`): an absent seat is visibly wrong and must land.
    if (heldM != null) {
      const fz = cellFreezeM(cell);
      if (fz > 0 && Math.abs(c - heldM) < fz) {
        frozenN++;
        return null;
      }
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
    // T101 (2026-09-06) — a HELD cell is not sampled at all. Its plane is known-stale (a deeper
    // footprint disagreed with it and the deep rule could not correct it this frame), so every
    // raycast against it — a first sample, a 4e refinement, a refresh — is a foregone rejection;
    // the budget it would have spent falls through to the next cell (an unspent priority share
    // joins the round-robin share in `update()`). Nothing is dropped: the features are still in
    // their queues, and `refreshCellPlane` re-opens the cell the moment its plane is re-sampled.
    // The same predicate is consulted after every `acceptSample` below: the hold is set INSIDE
    // that call, and the pass stops at the first held answer instead of spending the rest of its
    // budget on the same stale plane.
    if (cellHeld(cell)) return 0;
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
        const smp = sampleAt(f.latDeg, f.lonDeg);
        if (smp && shallowerThanHeld(f.seatDepth, smp.depth) && f.seatM != null) {
          shallowN++; // 4d: the fine tile left, the ground did not — keep the seat we hold
          continue;
        }
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1);
        if (c != null) {
          f.seatM = c;
          f.seatDepth = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else deferred.push(i); // try again next pass, behind everything not yet tried
        if (cellHeld(cell)) break; // T101: the plane is known-stale — the rest of the cell waits
      }
      for (const i of deferred) part.unseated.unshift(i);
      if (spent >= budget || cellHeld(cell)) return spent;
    }
    // Pass 1b (T77 4e) — the refinement queue: seated features carried through a plane move.
    for (const part of cell.parts) {
      while (spent < budget && part.refine.length > 0) {
        const i = part.refine.pop() as number;
        const f = part.features[i];
        if (f.seatM == null) continue; // collapsed meanwhile — it is in `unseated` now
        spent++;
        const smp = sampleAt(f.latDeg, f.lonDeg);
        if (smp && shallowerThanHeld(f.seatDepth, smp.depth)) {
          shallowN++;
          continue;
        }
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1, f.seatM);
        if (c != null) {
          f.seatM = c;
          f.seatDepth = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else if (cellHeld(cell)) {
          // T101: a HELD refinement keeps its place at the head of the queue (`pop` takes the
          // end) — the feature WAITS, it is not dropped; the plane it waits for will most likely
          // move and 4e-carry the whole cell anyway.
          part.refine.push(i);
          return spent;
        }
        // A refused/absent answer is NOT re-queued: the carried seat is a fine estimate and the
        // round-robin below revisits it anyway.
      }
      if (spent >= budget) return spent;
    }
    // Pass 2 — refresh, round-robin within the cell (the pre-RC7 behaviour, on what is left).
    // T77 slice C-1 5d: this pass re-asks about footprints that ALREADY have a seat, so at a
    // quiet pose it is pure speculation — and it was running at the full budget every frame
    // forever. It now runs on the idle rate unless this cell is draining or its ground just
    // moved (`sweepNow`, computed once per frame in `update()`).
    if (!sweepNow && !cell.terrainDirtyFrames) return spent;
    for (const part of cell.parts) {
      if (part.features.length === 0) continue;
      const k = Math.min(budget - spent, part.features.length);
      let took = 0; // T101: what this part actually spent, in case the hold stops it short
      for (let i = 0; i < k; i++) {
        took++;
        const f = part.features[part.cursor++ % part.features.length];
        const smp = sampleAt(f.latDeg, f.lonDeg);
        if (smp && shallowerThanHeld(f.seatDepth, smp.depth) && f.seatM != null) {
          shallowN++;
          continue;
        }
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1, f.seatM);
        if (c != null) {
          f.seatM = c;
          f.seatDepth = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else if (cellHeld(cell)) break; // T101
      }
      part.cursor %= Math.max(1, part.features.length);
      spent += took;
      if (spent >= budget || cellHeld(cell)) break;
    }
    return spent;
  };

  /** Ditto for TREE instances (same drain-then-refresh order). */
  const sampleTrees = (cell: CellSeat, budget: number): number => {
    if (budget <= 0 || cell.seatM == null || !ensureLocated(cell)) return 0;
    // T115: every reader of `t.latDeg` / `t.lonDeg` is below this line and inside a loop that
    // skips a set until it is located — this call advances the cell's locate by its chunk(s),
    // then samples whatever sets are already whole; an unlocated set's `unseated` queue keeps
    // `cellHasPending` true, so the drain comes back to it.
    locateTrees(cell);
    if (cellHeld(cell)) return 0; // T101 — see sampleFeatures (same stops after each sample)
    let spent = 0;
    for (const t of cell.trees) {
      if (!t.located || t.unseated.length === 0) continue;
      const deferred: number[] = [];
      while (spent < budget && t.unseated.length > 0) {
        const idx = t.unseated.pop() as number;
        spent++;
        const smp = sampleAt(t.latDeg[idx], t.lonDeg[idx]);
        if (smp && shallowerThanHeld(t.seatDepth[idx], smp.depth) && !Number.isNaN(t.seatM[idx])) {
          shallowN++;
          continue;
        }
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1);
        if (c != null) {
          t.seatM[idx] = c;
          t.seatDepth[idx] = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else deferred.push(idx); // back of the queue — see sampleFeatures
        if (cellHeld(cell)) break; // T101
      }
      for (const idx of deferred) t.unseated.unshift(idx);
      if (spent >= budget || cellHeld(cell)) return spent;
    }
    for (const t of cell.trees) {
      if (!t.located) continue; // T115
      // T77 4e — the refinement queue (see sampleFeatures pass 1b).
      while (spent < budget && t.refine.length > 0) {
        const idx = t.refine.pop() as number;
        if (Number.isNaN(t.seatM[idx])) continue;
        spent++;
        const smp = sampleAt(t.latDeg[idx], t.lonDeg[idx]);
        if (smp && shallowerThanHeld(t.seatDepth[idx], smp.depth)) {
          shallowN++;
          continue;
        }
        const held = Number.isNaN(t.seatM[idx]) ? null : t.seatM[idx];
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1, held);
        if (c != null) {
          t.seatM[idx] = c;
          t.seatDepth[idx] = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else if (cellHeld(cell)) {
          t.refine.push(idx); // T101: keeps its place at the head — it waits, it is not dropped
          return spent;
        }
      }
      if (spent >= budget) return spent;
    }
    // T77 slice C-1 5d — the tree refresh round-robin, on the idle rate (see sampleFeatures).
    if (!sweepNow && !cell.terrainDirtyFrames) return spent;
    for (const t of cell.trees) {
      const n = t.seatM.length;
      if (!t.located || n === 0) continue; // T115
      const k = Math.min(budget - spent, n);
      let took = 0; // T101
      for (let i = 0; i < k; i++) {
        took++;
        const idx = t.cursor++ % n;
        const smp = sampleAt(t.latDeg[idx], t.lonDeg[idx]);
        if (smp && shallowerThanHeld(t.seatDepth[idx], smp.depth) && !Number.isNaN(t.seatM[idx])) {
          shallowN++;
          continue;
        }
        const held = Number.isNaN(t.seatM[idx]) ? null : t.seatM[idx];
        const c = acceptSample(smp ? smp.h : null, cell, smp ? smp.depth : -1, held);
        if (c != null) {
          t.seatM[idx] = c;
          t.seatDepth[idx] = smp ? smp.depth : -1;
          touchCell(cell); // T77 5a
        } else if (cellHeld(cell)) break; // T101
      }
      t.cursor %= n;
      spent += took;
      if (spent >= budget || cellHeld(cell)) break;
    }
    return spent;
  };

  /** Apply pass: ease every sampled building/tree toward (its seat − the CELL's target seat) —
   *  the cell scene supplies the rest, so the sum converges on the footprint's own terrain.
   *  Cheap compares over everything loaded (~0.2 ms); writes touch only pending runs.
   *
   *  T77 lever 5: `kSeat` / `kXf` are the frame's ease coefficients, computed ONCE per frame by
   *  `update()` from `dtMs`. They are passed in rather than recomputed here because this pass
   *  runs over every resident feature — an `easeK()` per feature would be tens of thousands of
   *  `Math.exp` calls a frame for a value that is constant across the pass by construction. */
  const applyFeatureSeats = (kSeat: number, kXf: number): boolean => {
    let wrote = false;
    // T77 MEASURE: the settle accumulators are per-PASS — reset here, read by seatSettle().
    applyMaxResidualM = 0;
    applyMovedN = 0;
    applyNearMaxResidualM = 0;
    applyNearMovedN = 0;
    // 2026-09-07h: WHY the pass counted as work — per reason, per pass. Found while putting BEST
    // SPOT on /m: the seat epoch ticked every frame at a settled pose and nothing downstream that
    // debounces on it could ever fire; the residuals said 0 and no other seam said which branch.
    for (const k of Object.keys(applyReasons) as (keyof typeof applyReasons)[]) applyReasons[k] = 0;
    for (const cell of cellList) {
      if (cell.seatM == null || !cell.located) continue;
      // T77 slice C-1 5a — SKIP a settled cell. A cell whose last full pass wrote nothing is a
      // fixed point: `seatLand` lands its tail EXACTLY, so a feature already on its target cannot
      // be moved by any ease coefficient this frame, and `f.scaleK === f.appliedK` / a settled
      // `axf` are k-independent too. Only an event that changes a target can un-settle it, and
      // every one of those goes through `touchCell`. Its residual contribution is 0 by the same
      // argument, so the settle accumulators below stay honest.
      if (ENRICHED.reseatIdleSkip && cell.applyIdle) continue;
      const near = prioritySet.has(cell);
      let cellWrote = false;
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
              // T77 slice B 4b/4c (2026-09-06h): NEVER drop the building to the cell plane. The
              // old `target = 0` slammed a feature whose OWN ground had not moved down onto the
              // plane and then eased it back up as soon as the drain re-sampled it — two large
              // writes and a visible drop, per collapse, forever at a streaming pose. Now: while
              // the cell's plane is itself unsettled (4c) the pair is EXPECTED to disagree, so
              // hold the applied seat and say nothing; once it has settled and the pair is still
              // implausible (4b), freeze the applied seat, forget the feature's sample and put it
              // at the head of the drain — it re-seats from wherever it stands.
              if (cell.seatDirtyFrames > 0) {
                cellWrote = true; // T77 5a: an unresolved pair is work — never settle on a hold
                applyReasons.hold++;
                continue;
              }
              f.seatM = null;
              cell.rejected++;
              collapsedN++; // T77 4a: an APPLY-time collapse, not a discarded sample
              part.unseated.push(r); // RC7: back to the head of the drain, not the round-robin
              cellWrote = true; // T77 5a: a queued footprint is work — never settle on it
              applyReasons.collapse++;
              continue;
            }
            // T77 NEW-3: `seatLand`, and NO 1 cm write gate. The gate was what stopped the seat
            // landing (it parked every ease at 0.01/k = 8.3 cm and then never wrote again); with
            // the tail snap the ease reaches the target exactly and `next === f.appliedM` becomes
            // the settled test — self-terminating, and true rather than approximately true.
            const next = seatLand(f.appliedM, target, kSeat, ENRICHED.seatSnapM);
            if (next !== f.appliedM) {
              dy = next - (f.appliedM ?? 0);
              f.appliedM = next;
              applyMovedN++;
              if (near) applyNearMovedN++;
            }
            // T77 MEASURE: the residual LEFT after this frame's ease (0 once the ease has landed).
            const resid = Math.abs(target - (f.appliedM ?? 0));
            if (resid > applyMaxResidualM) applyMaxResidualM = resid;
            if (near && resid > applyNearMaxResidualM) applyNearMaxResidualM = resid;
            // T77 slice C-1 5a — the idle test is "this cell is ON TARGET", not merely "this
            // frame wrote nothing". They differ on exactly one frame shape and it is reachable:
            // `easeK(0, τ)` is 0 (two updates inside one millisecond, a duplicated rAF, a paused
            // clock), so `seatLand` returns the applied value unchanged and NOTHING writes while
            // the feature is still centimetres short. Settling on that would park the cell off
            // target with nothing left to re-arm it — the 8.3 cm stall slice B removed, back by
            // a different door. A non-zero residual is work, whatever this frame managed to do.
            if (resid !== 0) {
              cellWrote = true;
              applyReasons.resid++;
            }
          }
          // U8 height-override step: ease appliedK toward the committed target. The write is a
          // scale about the LIVE base (baseY + appliedM) — it commutes with the translation
          // above (a later dy shifts base and spans together), so seat and override never fight;
          // the poisoned-pair collapse is a pure translation and passes through the scale intact.
          let ratio = 1;
          if (f.scaleK !== f.appliedK) {
            let nextK = f.appliedK + (f.scaleK - f.appliedK) * kXf;
            if (Math.abs(f.scaleK - nextK) < 0.002) nextK = f.scaleK; // snap the ease tail
            ratio = nextK / f.appliedK;
            f.appliedK = nextK;
          }
          // T77 slice C-1 5a — an unfinished height-override ease is work (same `easeK === 0`
          // argument as the seat residual above).
          if (f.scaleK !== f.appliedK) {
            cellWrote = true;
            applyReasons.scale++;
          }
          // MESH SUITE MS1: a feature carrying a spatial transform (`axf`) eases every component
          // here and is recomposed ABSOLUTELY from its pristine snapshot below — the incremental
          // writer cannot express a rotation or an XZ scale. `f.axf === null` for every untouched
          // building: this branch costs them one null check.
          let xfMoved = false;
          let xfSettledIdentity = false;
          if (f.axf) {
            const e = easeXf(f.axf, f.xf ?? IDENTITY_XF, kXf);
            f.axf = e.next;
            xfMoved = e.moved;
            xfSettledIdentity = e.settled && f.xf === null;
            // T77 slice C-1 5a — an unfinished spatial ease is work (see the seat residual above).
            if (!e.settled) {
              cellWrote = true;
              applyReasons.xf++;
            }
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
          cellWrote = true; // T77 5a
          applyReasons.fill++;
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
            // T77 slice B 4b/4c — the buildings' rule, verbatim: hold while the cell plane is
            // unsettled, otherwise freeze in place and re-queue (never drop to the plane).
            if (cell.seatDirtyFrames > 0) {
              cellWrote = true; // T77 5a (see the buildings' twin above)
              applyReasons.treeHold++;
              continue;
            }
            t.seatM[i] = NaN; // poisoned pair — forget the sample, re-seat from where it stands
            cell.rejected++;
            collapsedN++; // T77 4a: an APPLY-time collapse, not a discarded sample
            t.unseated.push(i); // RC7: re-queued at the head of the drain
            cellWrote = true; // T77 5a
            applyReasons.treeCollapse++;
            continue;
          }
          // T77 NEW-3: same landing law as the buildings (the tree array carries its "unseated"
          // state as NaN rather than null, hence the conversion). `next === applied` is false for
          // a NaN `applied` — NaN !== NaN — so a first sample still writes and still snaps.
          const prev = Number.isNaN(applied) ? null : applied;
          // 2026-09-07h: `seatLandF32`, not `seatLand` — `t.appliedM` is a Float32Array, and a
          // float64 target that float32 cannot hold landed EVERY FRAME forever (one tree set per
          // cell uploading its instance matrix per frame; the seat epoch never quiet). "Settled"
          // is decided in the array's precision: landed = within the snap of the target.
          const next = seatLandF32(prev, target, kSeat, ENRICHED.seatSnapM);
          // T77 slice C-1 5a — off target is work even on a frame that wrote nothing (the
          // `easeK === 0` shape; the buildings' twin carries the full argument).
          if (Math.abs(target - next) >= ENRICHED.seatSnapM) {
            cellWrote = true;
            applyReasons.treeOff++;
          }
          if (next === applied) continue; // settled: the ease has landed, nothing to write
          arr[i * 16 + 13] += next - (Number.isNaN(applied) ? 0 : applied);
          t.appliedM[i] = next;
          touched = true;
        }
        if (touched) {
          t.mesh.instanceMatrix.needsUpdate = true;
          wrote = true;
          cellWrote = true; // T77 5a
          applyReasons.treeWrite++;
        }
      }
      // T77 slice C-1 5a — nothing moved anywhere in this cell: it is a fixed point until
      // `touchCell` says otherwise. A cell that still holds a drain queue is NEVER settled, even
      // on a frame where the budget did not reach it (the queue is work, not a fixed point).
      if (!cellWrote && !cellHasPending(cell) && cell.seatDirtyFrames === 0) cell.applyIdle = true;
    }
    return wrote;
  };

  // /m 2D map mode (UPLIFT U1) — see setActive on the handle.
  let active = true;

  // T94 — the deterministic-capture seam names the clocks it can hold (lib/globe/frameFreeze).
  const unregFrameClock = registerFrameClock("enriched.uNowMs");

  return {
    tiles,
    update(dtMs) {
      if (!active) return; // detached: no reveal clock, no streaming, no re-seat writes
      uniforms.uNowMs.value = frameNow(); // F1: advance the shared reveal clock before the draw
      // T94 — the deterministic-capture seam holds the WHOLE per-frame body, not just the stream.
      // A clock freeze (`dtMs === 0` ⇒ `kSeat`/`kXf` are 0) already stops every EASE, but the
      // re-seat drain below is not only an ease: `sampleFeatures`/`sampleTrees` discover new
      // footprints every frame and the apply pass SNAPS a first sample regardless of the
      // coefficient ("first real sample snaps, refinements slide"). Measured at
      // `dnipro-fpv-south`: 16-32 features still moved per frame under a clock-only freeze, and
      // the far skyline flickered by up to 160 channel counts between two captures.
      if (frameHeld("streaming")) {
        noteFrameHold("enriched.stream+seatDrain");
        return;
      }
      frameNo++;
      // T77 lever 5: ONE `easeK` per frame for the whole tileset — the group seat, every cell
      // seat, every building and every tree ride the same coefficient by construction, so they
      // cannot slide at different rates on a slow frame. `dtMs` arrives already clamped by the
      // orchestrator (`ORCH.maxFrameDtMs`), and `easeK` clamps again for safety.
      const kSeat = easeK(dtMs, ENRICHED.reseatEaseTauMs);
      const kXf = easeK(dtMs, ENRICHED.overrideEaseTauMs);
      // T77 slice C-1 5b/5d — the two per-frame constants of the sampling policy: the pixel scale
      // the sub-pixel freeze measures against, and whether the refresh round-robin runs at all.
      refreshPixelScale();
      sweepNow = idleSweepNow(frameNo, ENRICHED.reseatIdleSweepEveryFrames);
      deepResampleSpent = 0; // the deep-answer plane correction's per-FRAME budget
      // T106 slice (b): PHASE 2 of `load-model` — drain the deferred units under the frame
      // budget, BEFORE the seat passes so a part registered this frame is sampled this frame.
      // Held with the rest of the body under the T94 freeze (a registration moves pixels).
      if (loadQueue.pending() > 0) loadQueue.drain(loadBudgetMs);
      if (ENRICHED.reseatToTerrain) {
        const h = opts.terrainHeightAt(centre.latDeg, centre.lonDeg);
        if (h != null) {
          seatM = clampGroundM(h); // sticky; ignore null/garbage
          centreSampled = true;
        }
        // U2/A5: apply the EASED seat (first real sample snaps, refinements slide). T77 NEW-3:
        // `seatLand`, so the GROUP seat lands too — every cell and feature target is expressed
        // relative to it, so a group ease that asymptotes leaves the whole city short by the
        // same residual and no per-feature landing can recover it.
        if (centreSampled) seatAppliedM = seatLand(seatAppliedM, seatM, kSeat, ENRICHED.seatSnapM);
        const seatRefM = seatAppliedM ?? seatM;
        tiles.group.position.copy(_up).multiplyScalar(seatRefM + ENRICHED.seatOffsetM);

        // Per-cell re-seat: refresh a few cell samples per frame (bounded raycast cost), then
        // ease every sampled cell toward (its seat − the centre seat) along its own geodetic up.
        if (ENRICHED.reseatPerCell && centreSampled && cellList.length > 0) {
          // T77 slice C-1 5e — consume the ground's DRAINED dirty-region ring and re-arm exactly
          // the cells whose terrain arrived or was disposed. `terrainEpoch()` says only THAT the
          // ground changed, which is why the whole city used to be swept forever; this says
          // WHERE. The ring is drained on read, so this module is its single consumer (a second
          // one must fan out in StylizedTiles). Bounded: 64 regions × the cell list.
          if (ENRICHED.reseatDirtyRegions && opts.terrainDirtyRegions) {
            const regions = opts.terrainDirtyRegions();
            if (regions.length > 0) {
              // A cell is a POINT (its centre) with a ~`cellHalfSpanM` half-span; `regionArmsCell`
              // pads the region by that so a tile landing on a cell's edge still arms it.
              for (const cell of cellList) {
                for (const r of regions) {
                  if (regionArmsCell(r, cell.latDeg, cell.lonDeg, ENRICHED.cellHalfSpanM)) {
                    cell.terrainDirtyFrames = ENRICHED.reseatDirtyArmFrames;
                    cell.planeDirty = true; // owes ONE out-of-turn plane sample
                    touchCell(cell); // 5a: the ground under it moved — re-open the apply pass
                    break;
                  }
                }
              }
            }
          }
          // The plane sweep: DIRTY cells first (their plane is the stale one), then the
          // round-robin, so a newly arrived tile corrects its cell within a frame or two instead
          // of waiting out a 60-cell rotation at 6 a frame. `planeDirty` is a one-shot debt
          // cleared as the cell is picked, so an arming BURST bigger than the frame's plane
          // budget drains over the next frames instead of being dropped, and a cell can never
          // spin here: one arming buys exactly one out-of-turn sample.
          const n = Math.min(ENRICHED.reseatSamplesPerFrame, cellList.length);
          let spentPlane = 0;
          if (ENRICHED.reseatDirtyRegions) {
            for (let g = 0; g < cellList.length && spentPlane < n; g++) {
              const cell = cellList[dirtySweep++ % cellList.length];
              if (!cell.planeDirty) continue;
              cell.planeDirty = false;
              refreshCellPlane(cell);
              spentPlane++;
            }
            dirtySweep %= cellList.length;
          }
          for (let i = spentPlane; i < n; i++) refreshCellPlane(cellList[rrCursor++ % cellList.length]);
          if (rrCursor >= cellList.length) rrCursor %= cellList.length;
          applyCellMaxResidualM = 0; // T77 NEW-3: per-PASS, like the feature accumulators
          for (const cell of cellList) {
            if (cell.seatDirtyFrames > 0) cell.seatDirtyFrames--; // T77 4c: one frame of grace
            // T77 slice C-1 5e: the arming window in which this cell's refresh sweep ignores the
            // idle rate. It outlives the plane correction on purpose — the footprints under a
            // newly arrived tile are the ones whose seats are actually stale.
            if (cell.terrainDirtyFrames > 0) cell.terrainDirtyFrames--;
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
            const cellTarget = cell.seatM - seatRefM;
            // T77 NEW-3: land the cell plane exactly (see `seatLand`). The 1 cm gate that used to
            // guard this write parked every cell 8.3 cm off its own terrain, and every building
            // on it inherited that error on top of its own.
            const next = seatLand(cell.appliedM, cellTarget, kSeat, ENRICHED.seatSnapM);
            // The residual LEFT after this frame's ease (same reading as the feature residuals):
            // 0 once the plane has landed, so a stuck cell layer shows up as a number instead of
            // hiding behind feature residuals that are measured RELATIVE to it.
            const cellResid = Math.abs(cellTarget - next);
            if (cellResid > applyCellMaxResidualM) applyCellMaxResidualM = cellResid;
            if (next === cell.appliedM) continue; // settled
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
              prioritySet = new Set(priorityCells); // T77: the seatSettle() near-scope mirror
            }
            // T77 slice B 5c (2026-09-06h): the per-frame COUNT is a floor, a MILLISECOND budget
            // is the ceiling. The count was sized for raycasts (0.02–0.07 ms each); a drain of
            // plane-shifted seats (4e) re-asks questions the memo already holds, at microseconds
            // each, and at 64 a frame the 39k-feature / 60k-tree refinement took ~40 s after the
            // stream had quieted — the one thing left between the FPV eye and "no write 90 frames
            // after quiet". So: spend the count, then keep draining while there is something
            // queued AND `reseatBudgetMs` of this frame is unspent, up to `reseatBudgetMaxMul`×.
            const sampleT0 = performance.now();
            const budgetMs = ENRICHED.reseatBudgetMs;
            // T115: the tree-locate chunks share this frame's reseat deadline.
            sampleDeadlineMs = sampleT0 + budgetMs;
            treeLocateChunkedThisFrame = false;
            const runFeatureRound = (budget: number): number => {
              let fb = budget;
              const fRr = Math.max(1, Math.round(fb * ENRICHED.reseatRoundRobinShare));
              let fPri = fb - fRr;
              for (const cell of priorityCells) {
                if (fPri <= 0) break;
                fPri -= sampleFeatures(cell, fPri);
              }
              fb = fRr + Math.max(0, fPri); // unspent priority budget falls through to the sweep
              for (let g = 0; g < cellList.length && fb > 0; g++)
                fb -= sampleFeatures(cellList[cellSweep++ % cellList.length], fb);
              return budget - fb;
            };
            const runTreeRound = (budget: number): number => {
              let tb = budget;
              const tRr = Math.max(1, Math.round(tb * ENRICHED.reseatRoundRobinShare));
              let tPri = tb - tRr;
              for (const cell of priorityCells) {
                if (tPri <= 0) break;
                tPri -= sampleTrees(cell, tPri);
              }
              tb = tRr + Math.max(0, tPri);
              for (let g = 0; g < cellList.length && tb > 0; g++)
                tb -= sampleTrees(cellList[treeSweep++ % cellList.length], tb);
              return budget - tb;
            };
            const drainPending = (): boolean => {
              for (const cell of cellList) if (cellHasPending(cell)) return true;
              return false;
            };
            runFeatureRound(ENRICHED.reseatFeatureSamplesPerFrame);
            runTreeRound(ENRICHED.reseatTreeSamplesPerFrame);
            for (
              let extra = 1;
              extra < ENRICHED.reseatBudgetMaxMul &&
              performance.now() - sampleT0 < budgetMs &&
              drainPending();
              extra++
            ) {
              runFeatureRound(ENRICHED.reseatFeatureSamplesPerFrame);
              runTreeRound(ENRICHED.reseatTreeSamplesPerFrame);
            }
            if (cellList.length > 0) {
              cellSweep %= cellList.length;
              treeSweep %= cellList.length;
            }
            if (applyFeatureSeats(kSeat, kXf)) {
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
    // T77 MEASURE (2026-09-05) — the reseat-settle read seam (see the interface doc).
    seatSettle: () => ({
      frame: frameNo,
      maxResidualM: applyMaxResidualM,
      movedFeatures: applyMovedN,
      nearMaxResidualM: applyNearMaxResidualM,
      nearMovedFeatures: applyNearMovedN,
      nearCells: priorityCells.length,
      // T77 NEW-3: the CELL layer's residual, so "is the seat settled?" is answerable from this
      // one object. Feature residuals are relative to the cell plane and are silent about it.
      cellMaxResidualM: applyCellMaxResidualM,
      epoch: seatEpochN,
      quietFrames: seatQuietN,
      deferred: deferredN,
      rejected: rejectedN,
      collapsed: collapsedN, // T77 4a
      shallow: shallowN, // T77 4d: coarse-parent answers refused (the LRU, not the ground, moved)
      frozen: frozenN, // T77 5b: refresh answers inside the sub-pixel deadband
      applyReasons: { ...applyReasons }, // 2026-09-07h: why the last pass counted as work
      deepResamples: deepResampleN, // T77 slice C-1: cell planes corrected by a deeper answer
      deepHeld: deepHeldN, // T101: deeper answers the cap could not serve — held, not rejected
      deepPendingCells: deepPendingCellCount(), // T101: cells the sampling passes are skipping
      idleCells: idleCellCount(), // T77 5a: cells the apply pass skipped as fixed points
      sweepNow, // T77 5d: did the refresh round-robin run this frame?
    }),
    // DEBUG HUD (owner 2026-09-01) — the CHEAP counters: plain field reads, safe at poll
    // cadence. Everything richer (per-cell breakdowns, m5 rings, skirt/pickFence walks) stays
    // behind debugSeats(), which walks every cell × part × feature and is action-only.
    debugCounts: () => ({
      cells: cellList.length,
      priorityCells: priorityCells.length,
      deferred: deferredN,
      rejected: rejectedN,
      collapsed: collapsedN, // T77 4a
      frozen: frozenN, // T77 5b
      idleCells: idleCellCount(), // T77 5a
      deepResamples: deepResampleN, // T77 slice C-1
      deepHeld: deepHeldN, // T101
      deepPendingCells: deepPendingCellCount(), // T101
      seatCacheHits,
      seatCacheMisses,
      loadPending: loadQueue.pending(), // T106 (b)
      loadMaxMs: loadQueue.stats().maxFrameMs,
      treeLocateMaxMs: loadLedger.treeLocateMaxMs, // T115
      treeLocatePending: treeLocatePendingCount(), // T115
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
          footprintM: [f.dx, f.dz],
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
      const { f, part } = found;
      // T125: the GPU-side byte, not the cache — `f.ov` is set before the attribute write, so a
      // harness reading only `tint` could not tell a broken upload from a working one.
      const ovAttr = (part.mesh.geometry as THREE.BufferGeometry).getAttribute("_ftw_override") as
        | THREE.BufferAttribute
        | undefined;
      return {
        tintByte: ovAttr ? (ovAttr.array as Uint8Array)[f.run.start] : null,
        target: { sy: f.scaleK, ...(f.xf ?? IDENTITY_XF) },
        applied: { sy: f.appliedK, ...(f.axf ?? IDENTITY_XF) },
        cx: f.cx,
        cz: f.cz,
        vc: f.run.count,
        bakedHeightM: f.topY - f.baseY,
        footprintM: [f.dx, f.dz],
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
    debugCellSeats(limit = 8) {
      const rows = [...cellList]
        .sort((a, b) => b.rejected - a.rejected)
        .slice(0, limit)
        .map((cell) => {
          const worst: Array<{ seatM: number | null; seatDepth: number; appliedM: number | null; residM: number }> = [];
          let features = 0;
          for (const part of cell.parts) {
            for (const f of part.features) {
              features++;
              const target = f.seatM != null && cell.seatM != null ? f.seatM - cell.seatM : 0;
              const residM = Math.abs(target - (f.appliedM ?? 0));
              if (worst.length < 4 || residM > worst[worst.length - 1].residM) {
                worst.push({ seatM: f.seatM, seatDepth: f.seatDepth, appliedM: f.appliedM, residM });
                worst.sort((a, b) => b.residM - a.residM);
                if (worst.length > 4) worst.pop();
              }
            }
          }
          const reliefM = cell.reliefHiM - cell.reliefLoM;
          return {
            uri: cell.uri,
            seatM: cell.seatM,
            seatDepth: cell.seatDepth,
            gateM: cellGateM(cell),
            reliefM: Number.isFinite(reliefM) ? reliefM : 0,
            rejected: cell.rejected,
            dirtyFrames: cell.seatDirtyFrames,
            // T77 slice C-1 — the three quiet-state fields: is this cell's apply pass skipped, is
            // its ground still counted as freshly changed (5e), and how much does it still owe
            // the drain? "The seat is quiet" is answerable per cell from these.
            applyIdle: cell.applyIdle,
            terrainDirtyFrames: cell.terrainDirtyFrames,
            pending:
              cell.parts.reduce((n, prt) => n + prt.unseated.length + prt.refine.length, 0) +
              cell.trees.reduce((n, t) => n + t.unseated.length + t.refine.length, 0),
            deepPending: cell.deepPending, // T101: held until its plane re-samples
            features,
            worst,
          };
        });
      return rows;
    },
    setLoadBudgetMs(ms) {
      loadBudgetMs = Number.isFinite(ms) && ms >= 0 ? ms : ENRICHED.loadBudgetMs;
      return loadBudgetMs;
    },
    loadPending: () => loadQueue.pending(),
    debugLoad: () => {
      const q = loadQueue.stats();
      return {
        ...loadLedger,
        treeLocatePending: treeLocatePendingCount(),
        scratchReuses: edgeScratch.reuses + maskScratch.reuses,
        scratchGrowths: edgeScratch.growths + maskScratch.growths,
        deferredMs: q.ms,
        deferredMaxMs: q.maxFrameMs,
        deferredFrames: q.frames,
        pending: q.pending,
        unitsDone: q.done,
        unitsCancelled: q.cancelled,
        budgetMs: loadBudgetMs,
      };
    },
    benchEdges: (limit = 40) => {
      const out = { parts: 0, tris: 0, threeMs: 0, fastMs: 0, maskStringMs: 0, maskIntMs: 0, mismatch: 0, runMismatch: 0 };
      for (const { part } of partByMesh.values()) {
        if (out.parts >= limit) break;
        const geom = part.mesh.geometry;
        const pos = part.posAttr.array as Float32Array;
        out.parts++;
        out.tris += Math.floor((geom.index ? geom.index.count : part.posAttr.count) / 3);
        const t0 = performance.now();
        const ref = new THREE.EdgesGeometry(geom, ENRICHED.edgeAngleDeg);
        const t1 = performance.now();
        const fast = buildEdgesGeometry(geom, ENRICHED.edgeAngleDeg);
        const t2 = performance.now();
        out.threeMs += t1 - t0;
        out.fastMs += t2 - t1;
        const a = (ref.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
        const b = (fast.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
        if (a.length !== b.length) out.mismatch++;
        else {
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
              out.mismatch++;
              break;
            }
          }
        }
        const t3 = performance.now();
        const { map, collisions } = vertexKeyToRunWithCollisions(pos, part.runs);
        const rs = mapSegmentsToRuns(a, map, collisions);
        const t4 = performance.now();
        const ri = fast.srcIndex ? segmentRunsFromSources(fast.srcIndex, pos, part.runs) : null;
        const t5 = performance.now();
        out.maskStringMs += t4 - t3;
        out.maskIntMs += t5 - t4;
        if (!ri || ri.length !== rs.length) out.runMismatch++;
        else {
          for (let i = 0; i < rs.length; i++) {
            if (rs[i] !== ri[i]) {
              out.runMismatch++;
              break;
            }
          }
        }
        ref.dispose();
        fast.geometry.dispose();
      }
      return out;
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
      unregFrameClock();
      loadQueue.clear(); // T106 (b)
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
      prioritySet.clear();
      tiles.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      treeMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
