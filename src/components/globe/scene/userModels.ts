import * as THREE from "three";
import { enuBasis, geodeticToEcef } from "../../../lib/geo/projection";
import { sampleGroundM } from "../../../lib/geo/terrain";
import { seatStep } from "../../../lib/globe/enrichedMask";
import { normalizeDeg, transformToRig, type FeatureTransform } from "../../../lib/globe/featureTransform";
import {
  densityWarning,
  groundFitOffset,
  planResidency,
  sanitizeModelTransform,
  type ModelTransform,
} from "../../../lib/models/modelPlacement";
import type { PublicModel } from "../../../lib/wix/modelRecords";
import { tokens } from "../../../lib/theme/tokens";
import { MODELS } from "../tuning";
import type { GhostRig } from "./enrichedBuildings";

/**
 * userModels — MESH SUITE MS5 (D3 placement, 2026-09-02): the world's user-uploaded GLBs in the
 * globe scene. The orchestrator pushes the world rows (`setModels`, from `store/userModels` —
 * this module never reads a store, the scene fence) and the MDL chip's gate (`setVisible`);
 * this module owns residency, seating, the rig the gizmo drives, the pick and the disposal.
 *
 * THE FRAME. Every model is `frame` (ECEF position at its seated ground point, quaternion = the
 * local ENU basis: +X east, +Y up, −Z north — the glTF convention the baker maps enriched cells
 * into, so a model's own +Y is geodetic up) → `anchor` (the LIVE move offset of a gizmo drag in
 * ENU metres; 0 at rest — a commit folds it into a new placement, never a stored offset) → `body`
 * (yaw + UNIFORM scale, the record's two seats) → the loaded GLB root, re-based so its footprint
 * centre sits on the origin and its lowest point at y = 0 (`groundFitOffset`: the owner's
 * "auto ground-fit at the mesh centroid"). Vertices stay model-local; the ECEF cancellation
 * happens in the CPU's float64 model-view product — the frustum/pins precision idiom.
 *
 * THE RIG IS THE MODEL. `rig(id)` hands the MS2 gizmo a GhostRig-shaped `{ anchor, body, cx: 0,
 * cz: 0, liveBaseY: 0, inflate: 1 }`, so `rigToTransform` reads the drag back with no ghost and
 * no recompose: the drag IS the Object3D edit. The orchestrator marks a drag (`setDragging`) so
 * the per-frame seat/ease writes leave the rig alone until release.
 *
 * RESIDENCY. A world row is a RECORD (cheap JSON); a resident model has its GLB (≤ 8 MiB, ≤ 100k
 * tris) fetched and in the scene. Closest-first under `MODELS.maxResident` and the triangle
 * BUDGET (`planResidency`, hysteresis on the radius); what the budget refuses inside the load
 * radius is `skipped` — the physical-density warning (owner 2026-09-01c: no quota, warn). Zero
 * per-frame cost with nothing resident: `update` early-returns.
 *
 * SEATING. The rendered terrain at the placement (`terrainHeightAt`, clamped by `sampleGroundM`),
 * eased with `seatStep` (a LOD refine slides, never teleports); models whose seat is not yet
 * REAL re-ask at `resnap()` cadence — the Pins idiom. A model never sinks below or floats above
 * the ground by an edit: there is no lift seat (MESH_SUITE_PLAN §10).
 *
 * MATERIALS. A GLB keeps its own PBR materials (the scene's lights, shadows and tone mapping
 * apply; the enriched `uFtw*` haze/dissolve/tint injections do not — [ASSUMPTION] recorded).
 * Every mesh casts + receives shadows; the armed model gets an emissive lift in the accent token.
 */

export interface UserModelPick {
  id: string;
  /** Ray distance (m). */
  distance: number;
}

export interface UserModelInfo {
  id: string;
  title: string;
  lat: number;
  lon: number;
  seats: ModelTransform;
  /** Footprint size (m, the larger of X/Z after the unit scale), from the loaded bounds or the
   *  record's bbox; null when neither is known. */
  sizeM: number | null;
  /** MS5b: the size `[w, d, h]` (m: X, Z, Y extents at scale 1) from the loaded bounds or the
   *  record's bbox `[x, y, z]`; null when neither is known. */
  sizeM3: [number, number, number] | null;
  resident: boolean;
}

export interface UserModelCounts {
  world: number;
  resident: number;
  loading: number;
  skipped: number;
  /** Resident triangles (the records' counts). */
  tris: number;
  failed: number;
  visible: boolean;
  warn: boolean;
}

/** The GLB fetch, injectable (unit tests hand in a synthetic root; the default is a lazy
 *  `GLTFLoader` — the stored GLB is a plain exporter file, no DRACO/meshopt/KTX2). */
export interface ModelLoader {
  load(url: string): Promise<THREE.Object3D>;
}

export interface UserModelsHandle {
  /** The world rows for the current cover — atomic; diffed by id + updatedAt. */
  setModels(rows: readonly PublicModel[]): void;
  /** The MDL chip: off hides the group AND releases every resident model. */
  setVisible(on: boolean): void;
  /** Per frame (frameCount from the orchestrator): residency re-plan at cadence, seat + seat
   *  eases for resident models. Early-returns with nothing resident. */
  update(camera: THREE.PerspectiveCamera, frameCount: number): void;
  /** Re-ask the terrain under every resident model (low cadence). */
  resnap(): void;
  /** The resident model under a ray, nearest first. */
  pick(raycaster: THREE.Raycaster): UserModelPick | null;
  /** The gizmo's rig for a RESIDENT model (null otherwise). */
  rig(id: string): GhostRig | null;
  /** The gizmo's `place` callback: write a live transform onto the rig (uniform scale, no lift). */
  placeRig(id: string, t: FeatureTransform): void;
  /** A drag is in flight on this model's rig — the per-frame writes leave it alone. */
  setDragging(id: string, on: boolean): void;
  /** The COMMITTED seats (eased in; `snap` lands them at once — a drag release). */
  setSeats(id: string, t: ModelTransform, snap?: boolean): void;
  /** The COMMITTED placement moved: the frame re-seats at the new point, the anchor returns
   *  to zero (the offset is now in the placement). */
  rebase(id: string, latDeg: number, lonDeg: number): void;
  /** Emissive highlight on the armed model (null = none). */
  setArmed(id: string | null): void;
  /** The label anchor: the model's top centre in world space (false when not resident). */
  topWorld(id: string, out: THREE.Vector3): boolean;
  info(id: string): UserModelInfo | null;
  counts(): UserModelCounts;
  /** DEV: per-model residency + seat state (the `__globe.userModels()` seam). */
  debug(): Record<string, unknown>;
  dispose(): void;
}

interface Entry {
  row: PublicModel;
  frame: THREE.Group;
  anchor: THREE.Group;
  body: THREE.Group;
  root: THREE.Object3D | null;
  state: "idle" | "loading" | "ready" | "failed";
  /** Bumped on unload so a late fetch for a released model is dropped. */
  gen: number;
  /** ECEF of the placement at the applied seat — the residency distance and the frame position. */
  ecef: THREE.Vector3;
  seatM: number;
  seatReal: boolean;
  appliedM: number | null;
  target: ModelTransform;
  applied: ModelTransform;
  dragging: boolean;
  heightM: number;
  sizeM: number | null;
  sizeM3: [number, number, number] | null;
  meshes: THREE.Mesh[];
}

const _m = new THREE.Matrix4();
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _box = new THREE.Box3();
const _emissive = new THREE.Color();
const MODEL_RIG_FRAME = { cx: 0, cz: 0, liveBaseY: 0, inflate: 1 } as const;

/** The default GLB fetch — lazy so neither the globe boot bundle nor a test carries the loader. */
const defaultLoader: ModelLoader = {
  load: async (url) => {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  },
};

/** Dispose everything a loaded GLB allocated: geometries, materials and their texture maps. */
function disposeRoot(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      const mm = m as THREE.Material & Record<string, unknown>;
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "bumpMap", "specularMap"]) {
        const t = mm[k] as THREE.Texture | undefined;
        if (t && typeof t.dispose === "function") t.dispose();
      }
      m.dispose();
    }
  });
}

export function attachUserModels(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above the ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
    loader?: ModelLoader;
  } = {},
): UserModelsHandle {
  const loader = opts.loader ?? defaultLoader;
  const group = new THREE.Group();
  group.name = "userModels";
  scene.add(group);

  const entries = new Map<string, Entry>();
  const resident = new Set<string>();
  const meshEntry = new Map<THREE.Object3D, Entry>();
  let visible = true;
  let dirty = true;
  let loading = 0;
  let skipped = 0;
  let residentTris = 0;
  let failed = 0;
  let armedId: string | null = null;
  const armedOriginal = new Map<THREE.Material, { color: THREE.Color; intensity: number }>();

  const seatFor = (row: PublicModel) =>
    sampleGroundM(opts.terrainHeightAt?.(row.lat, row.lon), MODELS.fallbackGroundM);

  const placeFrame = (e: Entry) => {
    const h = e.appliedM ?? e.seatM;
    const p = geodeticToEcef(e.row.lat, e.row.lon, h);
    e.ecef.set(p[0], p[1], p[2]);
    e.frame.position.copy(e.ecef);
    const b = enuBasis(e.row.lat, e.row.lon);
    _e.set(b.east[0], b.east[1], b.east[2]);
    _u.set(b.up[0], b.up[1], b.up[2]);
    _n.set(-b.north[0], -b.north[1], -b.north[2]); // local +Z = south (−Z = north)
    _m.makeBasis(_e, _u, _n);
    e.frame.quaternion.setFromRotationMatrix(_m);
    e.frame.updateMatrixWorld(true);
  };

  const writeBody = (e: Entry) => {
    const rad = (e.applied.rotDeg * Math.PI) / 180;
    e.body.quaternion.set(0, Math.sin(rad / 2), 0, Math.cos(rad / 2));
    e.body.scale.setScalar(Math.max(0.001, e.applied.scale));
    e.body.updateMatrixWorld(true);
  };

  const makeEntry = (row: PublicModel): Entry => {
    const frame = new THREE.Group();
    const anchor = new THREE.Group();
    const body = new THREE.Group();
    frame.add(anchor);
    anchor.add(body);
    const seats = sanitizeModelTransform(row.rotDeg, row.scale);
    const e: Entry = {
      row,
      frame,
      anchor,
      body,
      root: null,
      state: "idle",
      gen: 0,
      ecef: new THREE.Vector3(),
      seatM: MODELS.fallbackGroundM,
      seatReal: false,
      appliedM: null,
      target: seats,
      applied: { ...seats },
      dragging: false,
      heightM: 0,
      sizeM: row.bbox ? Math.max(row.bbox[0], row.bbox[2]) : null,
      sizeM3: row.bbox ? [row.bbox[0], row.bbox[2], row.bbox[1]] : null,
      meshes: [],
    };
    const s = seatFor(row);
    e.seatM = s.h;
    e.seatReal = s.real;
    e.appliedM = s.h;
    placeFrame(e);
    writeBody(e);
    return e;
  };

  const unload = (e: Entry) => {
    e.gen++;
    if (e.root) {
      e.body.remove(e.root);
      disposeRoot(e.root);
      e.root = null;
    }
    for (const m of e.meshes) meshEntry.delete(m);
    e.meshes = [];
    if (e.state === "loading") loading = Math.max(0, loading - 1);
    e.state = "idle";
    if (resident.delete(e.row.id)) {
      residentTris -= e.row.tris;
      if (residentTris < 0) residentTris = 0;
    }
    group.remove(e.frame);
    e.dragging = false;
  };

  const onLoaded = (e: Entry, gen: number, root: THREE.Object3D) => {
    if (e.gen !== gen || e.state !== "loading") {
      disposeRoot(root); // released (or re-requested) while the bytes were in flight
      return;
    }
    loading = Math.max(0, loading - 1);
    // Ground-fit: footprint centre on the origin, lowest point at y = 0.
    _box.setFromObject(root);
    if (_box.isEmpty()) {
      e.state = "failed";
      failed++;
      disposeRoot(root);
      return;
    }
    const off = groundFitOffset([_box.min.x, _box.min.y, _box.min.z], [_box.max.x, _box.max.y, _box.max.z]);
    root.position.set(off[0], off[1], off[2]);
    e.heightM = _box.max.y - _box.min.y;
    e.sizeM = Math.max(_box.max.x - _box.min.x, _box.max.z - _box.min.z);
    e.sizeM3 = [_box.max.x - _box.min.x, _box.max.z - _box.min.z, e.heightM];
    e.meshes = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      e.meshes.push(mesh);
      meshEntry.set(mesh, e);
    });
    e.root = root;
    e.body.add(root);
    group.add(e.frame);
    e.state = "ready";
    resident.add(e.row.id);
    residentTris += e.row.tris;
    e.frame.updateMatrixWorld(true);
    if (armedId === e.row.id) applyArmed(e, true);
  };

  const startLoad = (e: Entry) => {
    if (e.state !== "idle") return;
    e.state = "loading";
    loading++;
    const gen = e.gen;
    loader
      .load(e.row.url)
      .then((root) => onLoaded(e, gen, root))
      .catch((err) => {
        if (e.gen !== gen || e.state !== "loading") return;
        loading = Math.max(0, loading - 1);
        e.state = "failed";
        failed++;
        console.warn("[userModels] GLB load failed", e.row.id, err);
      });
  };

  const applyArmed = (e: Entry, on: boolean) => {
    for (const mesh of e.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mm = m as THREE.MeshStandardMaterial;
        if (!mm || !("emissive" in mm) || !mm.emissive) continue;
        if (on) {
          if (!armedOriginal.has(mm)) armedOriginal.set(mm, { color: mm.emissive.clone(), intensity: mm.emissiveIntensity });
          mm.emissive.copy(_emissive.set(tokens.accent));
          mm.emissiveIntensity = MODELS.armedEmissive;
        } else {
          const orig = armedOriginal.get(mm);
          if (orig) {
            mm.emissive.copy(orig.color);
            mm.emissiveIntensity = orig.intensity;
            armedOriginal.delete(mm);
          }
        }
      }
    }
  };

  const _cam = new THREE.Vector3();
  const replan = (camera: THREE.PerspectiveCamera) => {
    dirty = false;
    if (!visible) {
      for (const e of entries.values()) if (e.state !== "idle") unload(e);
      skipped = 0;
      return;
    }
    _cam.copy(camera.position);
    const rows = [];
    for (const e of entries.values()) {
      if (e.state === "failed") continue;
      rows.push({ id: e.row.id, tris: e.row.tris, distM: _cam.distanceTo(e.ecef) });
    }
    const wanted = new Set<string>();
    for (const e of entries.values()) if (e.state === "ready" || e.state === "loading") wanted.add(e.row.id);
    const plan = planResidency(rows, wanted, {
      loadRadiusM: MODELS.loadRadiusM,
      unloadRadiusM: MODELS.unloadRadiusM,
      maxResident: MODELS.maxResident,
      triBudget: MODELS.triBudget,
    });
    skipped = plan.skipped;
    for (const id of plan.unload) {
      const e = entries.get(id);
      if (e) unload(e);
    }
    for (const id of plan.load) {
      if (loading >= MODELS.maxConcurrentLoads) break;
      const e = entries.get(id);
      if (e) startLoad(e);
    }
  };

  const easeDeg = (a: number, t: number, k: number) => {
    const target = a + normalizeDeg(t - a);
    let n = a + (target - a) * k;
    if (Math.abs(target - n) < 0.02) n = target;
    return normalizeDeg(n);
  };

  return {
    setModels(rows) {
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        const e = entries.get(row.id);
        if (!e) {
          entries.set(row.id, makeEntry(row));
          dirty = true;
          continue;
        }
        if (e.row === row) continue;
        const moved = e.row.lat !== row.lat || e.row.lon !== row.lon;
        const seats = sanitizeModelTransform(row.rotDeg, row.scale);
        const reseated = seats.rotDeg !== e.target.rotDeg || seats.scale !== e.target.scale;
        const urlChanged = e.row.url !== row.url;
        e.row = row;
        if (urlChanged) {
          unload(e);
          dirty = true;
        }
        if (moved && !e.dragging) this.rebase(row.id, row.lat, row.lon);
        if (reseated && !e.dragging) this.setSeats(row.id, seats, false);
      }
      for (const [id, e] of entries) {
        if (seen.has(id)) continue;
        unload(e);
        entries.delete(id);
        if (armedId === id) armedId = null;
        dirty = true;
      }
    },
    setVisible(on) {
      if (visible === on) return;
      visible = on;
      group.visible = on;
      dirty = true;
    },
    update(camera, frameCount) {
      if (dirty || frameCount % MODELS.residencyEveryFrames === 0) replan(camera);
      if (resident.size === 0) return;
      for (const id of resident) {
        const e = entries.get(id);
        if (!e || e.state !== "ready") continue;
        // The seat: ease the applied ground toward the sampled one (a refine slides).
        const next = seatStep(e.appliedM, e.seatM, MODELS.seatEaseK);
        const landed = Math.abs(e.seatM - next) < MODELS.seatSnapM ? e.seatM : next;
        if (landed !== e.appliedM) {
          e.appliedM = landed;
          placeFrame(e);
        }
        if (e.dragging) continue; // the gizmo owns the rig until release
        const a = e.applied;
        const t = e.target;
        if (a.rotDeg !== t.rotDeg || a.scale !== t.scale) {
          const rot = easeDeg(a.rotDeg, t.rotDeg, MODELS.xfEaseK);
          let sc = a.scale + (t.scale - a.scale) * MODELS.xfEaseK;
          if (Math.abs(t.scale - sc) < 0.002) sc = t.scale;
          e.applied = { rotDeg: rot, scale: sc };
          writeBody(e);
        }
      }
    },
    resnap() {
      for (const id of resident) {
        const e = entries.get(id);
        if (!e) continue;
        const s = seatFor(e.row);
        if (!s.real && e.seatReal) continue; // keep a real seat over a fresh null/garbage answer
        e.seatM = s.h;
        e.seatReal = s.real;
      }
    },
    pick(raycaster) {
      if (!visible || resident.size === 0) return null;
      const hits = raycaster.intersectObject(group, true);
      for (const hit of hits) {
        const e = meshEntry.get(hit.object);
        if (e && e.state === "ready") return { id: e.row.id, distance: hit.distance };
      }
      return null;
    },
    rig(id) {
      const e = entries.get(id);
      if (!e || e.state !== "ready") return null;
      return { anchor: e.anchor, body: e.body, ...MODEL_RIG_FRAME };
    },
    placeRig(id, t) {
      const e = entries.get(id);
      if (!e || e.state !== "ready") return;
      const r = transformToRig(t, MODEL_RIG_FRAME);
      e.anchor.position.set(r.ax, 0, r.az); // no lift seat: ay is always the seated base
      e.body.quaternion.set(0, r.qy, 0, r.qw);
      e.body.scale.set(r.sx, r.sy, r.sz);
      e.anchor.updateMatrixWorld(true);
    },
    setDragging(id, on) {
      const e = entries.get(id);
      if (!e) return;
      e.dragging = on;
      if (!on) {
        // The rig falls back onto the committed seats (a cancelled drag re-places from them).
        e.anchor.position.set(0, 0, 0);
        writeBody(e);
      }
    },
    setSeats(id, t, snap = false) {
      const e = entries.get(id);
      if (!e) return;
      const seats = sanitizeModelTransform(t.rotDeg, t.scale);
      e.target = seats;
      if (snap || e.state !== "ready") {
        e.applied = { ...seats };
        writeBody(e);
      }
    },
    rebase(id, latDeg, lonDeg) {
      const e = entries.get(id);
      if (!e) return;
      if (e.row.lat !== latDeg || e.row.lon !== lonDeg) e.row = { ...e.row, lat: latDeg, lon: lonDeg };
      e.anchor.position.set(0, 0, 0);
      const s = seatFor(e.row);
      e.seatM = s.h;
      e.seatReal = s.real;
      placeFrame(e); // the frame moves at once (the eased height follows)
      e.anchor.updateMatrixWorld(true);
      dirty = true;
    },
    setArmed(id) {
      if (armedId === id) return;
      const prev = armedId ? entries.get(armedId) : null;
      if (prev) applyArmed(prev, false);
      armedId = id;
      const next = id ? entries.get(id) : null;
      if (next && next.state === "ready") applyArmed(next, true);
    },
    topWorld(id, out) {
      const e = entries.get(id);
      if (!e || e.state !== "ready") return false;
      e.body.updateMatrixWorld(true);
      out.set(0, e.heightM, 0);
      e.body.localToWorld(out);
      return true;
    },
    info(id) {
      const e = entries.get(id);
      if (!e) return null;
      return {
        id,
        title: e.row.title,
        lat: e.row.lat,
        lon: e.row.lon,
        seats: { ...e.target },
        sizeM: e.sizeM,
        sizeM3: e.sizeM3 ? [e.sizeM3[0], e.sizeM3[1], e.sizeM3[2]] : null,
        resident: e.state === "ready",
      };
    },
    counts() {
      return {
        world: entries.size,
        resident: resident.size,
        loading,
        skipped,
        tris: residentTris,
        failed,
        visible,
        warn: densityWarning(skipped, residentTris, MODELS.densityWarnTris),
      };
    },
    debug() {
      const models: Record<string, unknown>[] = [];
      for (const e of entries.values()) {
        models.push({
          id: e.row.id,
          title: e.row.title,
          state: e.state,
          lat: e.row.lat,
          lon: e.row.lon,
          seatM: e.seatM,
          seatReal: e.seatReal,
          appliedM: e.appliedM,
          target: e.target,
          applied: e.applied,
          anchor: e.anchor.position.toArray(),
          bodyScale: e.body.scale.x,
          heightM: e.heightM,
          sizeM: e.sizeM,
          sizeM3: e.sizeM3,
          dragging: e.dragging,
          tris: e.row.tris,
        });
      }
      return { ...this.counts(), armedId, models };
    },
    dispose() {
      for (const e of entries.values()) unload(e);
      entries.clear();
      meshEntry.clear();
      armedOriginal.clear();
      scene.remove(group);
    },
  };
}
