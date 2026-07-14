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
  bboxCenterDeg,
  csrFromRunIds,
  featureRunsOf,
  mapVertsToRuns,
  regionCenterDeg,
  runCentroid,
  seatStep,
  vertexKeyToRun,
  type FeatureRun,
  type GeoBbox,
} from "../../../lib/globe/enrichedMask";
import { EARTH, ENRICHED, TILESETS, TREES } from "../tuning";
import { createBuildingMaterials, FTW_BAYER_GLSL } from "./buildingMaterial";

/**
 * Dnipro 3D enrichment — a THIRD `TilesRenderer` (Slice 0 de-risk spike). It streams a SELF-HOSTED
 * 3D-Tiles set (a plain HTTPS URL — Cloudflare R2 in production, or `public/enriched-sample/` served
 * locally by `wix dev`; NO Cesium ion auth) of roof-shaped enriched buildings, styled to the same
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
 */
export interface EnrichedBuildingsHandle {
  tiles: TilesRenderer;
  /** Per-frame: R1 re-seat to the rendered terrain + tile streaming/LOD. */
  update(): void;
  /** Adaptive quality (mirrors BuildingsHandle): raise screen-space error + bound LRU bytes on weaker
   *  tiers. `lruCapBytes` null → restore the captured library default. */
  setQualityTier(errorTarget: number, lruCapBytes: number | null): void;
  /** FPV building shading (owner ask): `k` 0 = see-through wireframe (bright edges, ~0.28 fill),
   *  1 = opaque shaded (faint edges). `null` restores the non-FPV default (opaque, ENRICHED edges). */
  setSolidity(k: number | null): void;
  /** Pass 2 R3 night hook (mirrors BuildingsHandle.setNight — one ephemeris sample drives both
   *  tilesets). Dormant while BUILDINGS.nightWindowGain is 0, wired so the sets can never drift. */
  setNight(sunElevSin: number, up: THREE.Vector3): void;
  /** Per-building re-seat progress: `epoch` bumps on every frame that WROTE seating deltas,
   *  `quietFrames` counts frames since the last write. The orchestrator invalidates a ready
   *  skyline profile once per settled epoch (PLAN.reseatQuietFrames). */
  seatState(): { epoch: number; quietFrames: number };
  /** DEV introspection (window.__globe) — per-feature re-seat coverage + applied-delta spread. */
  debugSeats(): {
    cells: number;
    located: number;
    features: number;
    featuresSampled: number;
    featureAppliedMinM: number;
    featureAppliedMaxM: number;
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
  },
): EnrichedBuildingsHandle {
  const tiles = new TilesRenderer(opts.url);
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  tiles.errorTarget = ENRICHED.errorTarget;
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }),
  );
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
  }
  interface MeshPart {
    mesh: THREE.Mesh;
    posAttr: THREE.BufferAttribute;
    edgeAttr: THREE.BufferAttribute | null;
    /** Edge-vertex indices bucketed per feature run (CSR) — built from the pristine buffers. */
    edgeCsr: { offsets: Int32Array; verts: Int32Array } | null;
    features: FeatureSeat[];
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
      cell = {
        scene: e.scene,
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
            cell.parts.push({
              mesh: c,
              posAttr,
              edgeAttr,
              edgeCsr,
              features: runs.map((run) => ({ run, latDeg: 0, lonDeg: 0, seatM: null, appliedM: null })),
              cursor: 0,
            });
          }
        }
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    const cell = cellByScene.get(e.scene);
    if (cell) {
      cellByScene.delete(e.scene);
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
          if (f.seatM == null) continue; // unsampled → stays on the cell plane
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
          if (f.appliedM != null && Math.abs(next - f.appliedM) < 0.01) continue; // settled
          const dy = next - (f.appliedM ?? 0);
          f.appliedM = next;
          const { start, count } = f.run;
          for (let i = start; i < start + count; i++) pos[i * 3 + 1] += dy;
          touchedFill = true;
          if (edgePos && part.edgeCsr) {
            const { offsets, verts } = part.edgeCsr;
            for (let j = offsets[r]; j < offsets[r + 1]; j++) edgePos[verts[j] * 3 + 1] += dy;
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

  return {
    tiles,
    update() {
      uniforms.uNowMs.value = performance.now(); // F1: advance the shared reveal clock before the draw
      frameNo++;
      if (ENRICHED.reseatToTerrain) {
        const h = opts.terrainHeightAt(centre.latDeg, centre.lonDeg);
        if (h != null) {
          seatM = clampGroundM(h); // sticky; ignore null/garbage
          centreSampled = true;
        }
        tiles.group.position.copy(_up).multiplyScalar(seatM + ENRICHED.seatOffsetM);

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
            const next = seatStep(cell.appliedM, cell.seatM - seatM, ENRICHED.reseatEaseK);
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
    setQualityTier(errorTarget, lruCapBytes) {
      tiles.errorTarget = errorTarget;
      tiles.lruCache.maxBytesSize = lruCapBytes ?? lruDefaultBytes;
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
    seatState: () => ({ epoch: seatEpochN, quietFrames: seatQuietN }),
    debugSeats() {
      let located = 0;
      let features = 0;
      let featuresSampled = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let trees = 0;
      let treesSampled = 0;
      for (const cell of cellList) {
        if (cell.located) located++;
        for (const part of cell.parts) {
          features += part.features.length;
          for (const f of part.features) {
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
        trees,
        treesSampled,
        epoch: seatEpochN,
        quietFrames: seatQuietN,
      };
    },
    dispose() {
      cellList.length = 0;
      cellByScene.clear();
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
