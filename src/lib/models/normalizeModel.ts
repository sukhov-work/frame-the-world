/**
 * The three-dependent half of the D3 upload pipeline (MESH SUITE MS4, 2026-09-02): load a
 * dropped model (GLB · glTF + companions · OBJ + MTL · FBX), read its facts, decimate over-budget
 * geometry with MeshoptSimplifier, pack everything into ONE binary glTF with GLTFExporter, and
 * paint a card thumbnail. BROWSER TIER — the model upload store reaches it through ONE dynamic
 * import, so neither the globe bundle nor the unit tests carry three's loaders; the pure rules it
 * applies (the caps, the audit, the decimation plan) live in `modelCaps.ts` and are unit-tested.
 *
 * Why the main thread (an [ASSUMPTION] recorded 2026-09-02, measured in the browser leg of
 * `scripts/verify-modelupload.mjs`): FBXLoader resolves textures through `TextureLoader` →
 * `<img>`, which a Worker does not have; inputs are ≤ 15 MB and every step but the exporter's
 * texture re-encode is tens of milliseconds; the re-encode is already async per texture. The
 * decode Worker rule (C1) is about RAW demosaic — seconds of wasm — not this.
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  LoadingManager,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Texture,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import {
  decimationPlan,
  violationMessage,
  type ModelFormat,
  type ModelStats,
  type ModelViolation,
} from "./modelCaps";

export interface LoadedModel {
  root: Object3D;
  /** Animation clips the source carried (dropped at export — the audit warns). */
  animations: number;
}

/** A load failure the card can name — `violation` set when it maps onto a contract rule. */
export class ModelLoadError extends Error {
  constructor(
    message: string,
    readonly violation: ModelViolation | null = null,
  ) {
    super(message);
    this.name = "ModelLoadError";
  }
}

/** Texture slots the inspector, the exporter and the disposer agree on (envMap is scene state,
 *  never part of an asset). */
const MAP_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "specularMap",
  "lightMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "transmissionMap",
  "thicknessMap",
  "iridescenceMap",
  "specularColorMap",
  "specularIntensityMap",
] as const;

const basename = (p: string): string => {
  try {
    return decodeURIComponent(p.split(/[\\/]/).pop() ?? p).toLowerCase();
  } catch {
    return (p.split(/[\\/]/).pop() ?? p).toLowerCase();
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Companion files (a `.bin` buffer, an `.mtl`, textures) resolve by BASENAME through a blob-URL
 * map on a LoadingManager — the three editor's idiom. `idle()` waits for loads the parse
 * method itself does not await (FBX/OBJ textures) before the blob URLs are revoked.
 */
function companionManager(files: File[], primary: number) {
  const urls = new Map<string, string>();
  files.forEach((f, i) => {
    if (i !== primary) urls.set(basename(f.name), URL.createObjectURL(f));
  });
  const manager = new LoadingManager();
  manager.setURLModifier((url) =>
    url.startsWith("blob:") || url.startsWith("data:") ? url : (urls.get(basename(url)) ?? url),
  );
  let inFlight = false;
  let resolveIdle: () => void = () => {};
  const idlePromise = new Promise<void>((r) => (resolveIdle = r));
  manager.onStart = () => {
    inFlight = true;
  };
  manager.onLoad = () => {
    inFlight = false;
    resolveIdle();
  };
  manager.onError = () => {
    /* a missing companion is a visual gap, not a failure — the item still ends */
  };
  return {
    manager,
    idle: async () => {
      if (inFlight) await Promise.race([idlePromise, sleep(15_000)]);
    },
    revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

/** Compressed glTF needs decoder wasm this app does not ship — say so, don't hand the member a
 *  stack trace. */
function classifyLoadError(e: unknown): Error {
  const msg = String((e as Error)?.message ?? e);
  if (/DRACOLoader|KTX2Loader|draco|ktx2|basisu?/i.test(msg)) {
    const v: ModelViolation = { code: "UNSUPPORTED_COMPRESSION" };
    return new ModelLoadError(violationMessage(v), v);
  }
  return e instanceof Error ? e : new Error(msg);
}

export async function loadModelFiles(files: File[], primary: number, format: ModelFormat): Promise<LoadedModel> {
  const file = files[primary];
  const { manager, idle, revoke } = companionManager(files, primary);
  try {
    if (format === "glb" || format === "gltf") {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      const loader = new GLTFLoader(manager);
      loader.setMeshoptDecoder(MeshoptDecoder); // EXT_meshopt_compression decodes with embedded wasm
      const data = format === "glb" ? await file.arrayBuffer() : await file.text();
      const gltf = await loader.parseAsync(data, "").catch((e) => {
        throw classifyLoadError(e);
      });
      return { root: gltf.scene, animations: gltf.animations.length };
    }
    if (format === "obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const loader = new OBJLoader(manager);
      const mtl = files.find((f, i) => i !== primary && /\.mtl$/i.test(f.name));
      if (mtl) {
        const { MTLLoader } = await import("three/examples/jsm/loaders/MTLLoader.js");
        const materials = new MTLLoader(manager).parse(await mtl.text(), "");
        materials.preload();
        loader.setMaterials(materials);
      }
      return { root: loader.parse(await file.text()), animations: 0 };
    }
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    const group = new FBXLoader(manager).parse(await file.arrayBuffer(), "");
    return { root: group, animations: group.animations?.length ?? 0 };
  } finally {
    await idle();
    revoke();
  }
}

/** Triangles a geometry draws (index or vertex count, honouring a finite drawRange). */
export function triangleCount(g: BufferGeometry): number {
  const pos = g.attributes.position;
  if (!pos) return 0;
  const available = g.index ? g.index.count : pos.count;
  const count = Number.isFinite(g.drawRange.count) ? Math.min(g.drawRange.count, available) : available;
  return Math.floor(count / 3);
}

const materialsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);

const texturesOf = (mat: Material): Texture[] => {
  const out: Texture[] = [];
  const rec = mat as unknown as Record<string, unknown>;
  for (const slot of MAP_SLOTS) {
    const t = rec[slot] as Texture | null | undefined;
    if (t && (t as Texture).isTexture) out.push(t);
  }
  return out;
};

const imageEdge = (t: Texture): number => {
  const img = t.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null;
  if (!img) return 0;
  return Math.max(img.width ?? img.videoWidth ?? 0, img.height ?? img.videoHeight ?? 0);
};

/** Read the facts the audit judges. `unitScale` (metres per source unit) scales the bounds only. */
export function inspectModel(root: Object3D, animations: number, unitScale: number): ModelStats {
  let tris = 0;
  let meshes = 0;
  let skinned = false;
  let morphs = false;
  let maxTextureEdge = 0;
  const textures = new Set<Texture>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    meshes++;
    if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
    const g = m.geometry as BufferGeometry;
    if (g.morphAttributes?.position?.length) morphs = true;
    tris += triangleCount(g);
    for (const mat of materialsOf(m)) {
      for (const t of texturesOf(mat)) {
        textures.add(t);
        maxTextureEdge = Math.max(maxTextureEdge, imageEdge(t));
      }
    }
  });
  const raw = rawSize(root);
  return {
    tris,
    meshes,
    textures: textures.size,
    maxTextureEdge,
    animations,
    skinned,
    morphs,
    bbox: [raw.x * unitScale, raw.y * unitScale, raw.z * unitScale],
  };
}

/** World bounds with the root's OWN scale factored back out — `applyUnitScale` bakes the unit
 *  into `root.scale`, so a re-inspect after a unit change must not multiply it in twice
 *  (browser-caught 2026-09-02h: the cm→m switch read 30 m instead of 3,000 m). */
function rawSize(root: Object3D): Vector3 {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return new Vector3();
  const size = box.getSize(new Vector3());
  const s = root.scale;
  return new Vector3(size.x / (s.x || 1), size.y / (s.y || 1), size.z / (s.z || 1));
}

/** The longest raw extent (source units) — feeds the unit guess. */
export function rawExtent(root: Object3D): number {
  const s = rawSize(root);
  return Math.max(s.x, s.y, s.z);
}

/** Positions as a tight Float32Array (quantized / interleaved sources decode through the
 *  attribute accessors). */
function positionsF32(g: BufferGeometry): Float32Array {
  const pos = g.attributes.position;
  if (pos.array instanceof Float32Array && pos.itemSize === 3 && !pos.normalized) return pos.array as Float32Array;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i);
    out[i * 3 + 1] = pos.getY(i);
    out[i * 3 + 2] = pos.getZ(i);
  }
  return out;
}

/** Rewrite every attribute so only vertices the new index references remain — the simplifier
 *  leaves the orphans in place, and orphans are what would bust the GLB byte cap. */
function compactIndexed(g: BufferGeometry, newIndex: Uint32Array): void {
  const vertexCount = g.attributes.position.count;
  const NONE = 0xffffffff;
  const remap = new Uint32Array(vertexCount).fill(NONE);
  let unique = 0;
  const idx = new Uint32Array(newIndex.length);
  for (let i = 0; i < newIndex.length; i++) {
    const v = newIndex[i];
    if (remap[v] === NONE) remap[v] = unique++;
    idx[i] = remap[v];
  }
  for (const key of Object.keys(g.attributes)) {
    const a = g.attributes[key] as BufferAttribute;
    const src = a.array as unknown as ArrayLike<number> & { constructor: new (n: number) => typeof a.array };
    const out = new src.constructor(unique * a.itemSize) as unknown as number[] & typeof a.array;
    for (let v = 0; v < vertexCount; v++) {
      const to = remap[v];
      if (to === NONE) continue;
      for (let k = 0; k < a.itemSize; k++) out[to * a.itemSize + k] = src[v * a.itemSize + k];
    }
    g.setAttribute(key, new BufferAttribute(out, a.itemSize, a.normalized));
  }
  g.setIndex(new BufferAttribute(idx, 1));
  g.clearGroups();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/** Error rungs the simplifier is allowed, relative to the mesh extent — it stops at the first
 *  that reaches the target (1 % is invisible on a building; 100 % is "whatever it takes"). */
const SIMPLIFY_ERROR_RUNGS = [0.01, 0.05, 0.25, 1];

/**
 * Bring the model under `maxTris` in place: proportional per-mesh targets (`decimationPlan`),
 * MeshoptSimplifier with locked borders, then attribute compaction. Multi-material meshes are
 * left alone (simplifying scrambles their group ranges) — the plan says whether that fits.
 */
export async function decimateModel(
  root: Object3D,
  maxTris: number,
): Promise<{ tris: number; before: number } | { violation: ModelViolation }> {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const counts = meshes.map((m) => triangleCount(m.geometry as BufferGeometry));
  const locked = meshes.map((m) => {
    const g = m.geometry as BufferGeometry;
    return g.groups.length > 1 || Number.isFinite(g.drawRange.count);
  });
  const before = counts.reduce((a, b) => a + b, 0);
  const plan = decimationPlan(counts, locked, maxTris);
  if (!plan) return { violation: { code: "TOO_MANY_TRIS", count: before, max: maxTris } };

  const [{ MeshoptSimplifier }, { mergeVertices, deinterleaveGeometry }] = await Promise.all([
    import("three/examples/jsm/libs/meshopt_simplifier.module.js"),
    import("three/examples/jsm/utils/BufferGeometryUtils.js"),
  ]);
  await MeshoptSimplifier.ready;

  // A geometry instanced by several meshes is simplified ONCE (to the first target it meets).
  const done = new Map<BufferGeometry, number>();
  let after = 0;
  meshes.forEach((m, i) => {
    const target = plan[i];
    let g = m.geometry as BufferGeometry;
    if (done.has(g)) {
      after += done.get(g) as number;
      return;
    }
    if (target >= counts[i]) {
      after += counts[i];
      done.set(g, counts[i]);
      return;
    }
    deinterleaveGeometry(g);
    if (!g.index) {
      g = mergeVertices(g);
      m.geometry = g;
    }
    const positions = positionsF32(g);
    const indices = g.index!.array instanceof Uint32Array ? (g.index!.array as Uint32Array) : Uint32Array.from(g.index!.array as ArrayLike<number>);
    let best: Uint32Array | null = null;
    for (const err of SIMPLIFY_ERROR_RUNGS) {
      const [idx] = MeshoptSimplifier.simplify(indices, positions, 3, target * 3, err, ["LockBorder"]);
      if (!best || idx.length < best.length) best = idx;
      if (idx.length <= target * 3) break;
    }
    const result = best ?? indices;
    compactIndexed(g, result);
    const tris = result.length / 3;
    done.set(g, tris);
    after += tris;
  });
  return { tris: after, before };
}

/** Source units → metres, baked into the root node's scale (the GLB carries it). */
export function applyUnitScale(root: Object3D, metresPerUnit: number): void {
  root.scale.setScalar(metresPerUnit);
  root.updateMatrixWorld(true);
}

/** One binary glTF: textures capped at `maxTextureEdge` (the exporter downsizes through a
 *  canvas), animations omitted (never passed), hidden nodes dropped. */
export async function exportGlb(root: Object3D, maxTextureEdge: number): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const out = await new GLTFExporter().parseAsync(root, {
    binary: true,
    maxTextureSize: maxTextureEdge,
    onlyVisible: true,
  });
  if (!(out instanceof ArrayBuffer)) throw new Error("the exporter did not return a binary glTF");
  return out;
}

/**
 * A transparent PNG of the model from a three-quarter view, painted by a DISPOSABLE renderer on
 * an OffscreenCanvas (its context is released before this resolves — the globe keeps its own).
 * Null when the environment cannot paint one; the card falls back to a placeholder.
 */
export async function renderThumbnail(root: Object3D, sizePx = 512): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(sizePx, sizePx);
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: true, alpha: true });
  } catch {
    return null;
  }
  const parent = root.parent;
  const scene = new Scene();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(sizePx, sizePx, false);
    // `alpha: true` already clears to transparent (WebGLBackground: clearAlpha = alpha ? 0 : 1) —
    // no setClearColor call, which the navy-night-sky fence forbids repo-wide.
    scene.add(root);
    scene.add(new HemisphereLight(0xdfe8ff, 0x1a1408, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(1, 1.6, 0.8);
    scene.add(sun);
    const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 1e-3);
    const cam = new PerspectiveCamera(32, 1, 0.01, 1e6);
    const dist = (radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.12;
    const az = Math.PI * 0.22;
    const el = Math.PI * 0.14;
    cam.position
      .copy(sphere.center)
      .add(new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist));
    cam.near = dist / 200;
    cam.far = dist * 20;
    cam.updateProjectionMatrix();
    cam.lookAt(sphere.center);
    renderer.render(scene, cam);
    return await canvas.convertToBlob({ type: "image/png" });
  } catch {
    return null;
  } finally {
    scene.remove(root);
    if (parent) parent.add(root);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Free geometries, materials and textures (ImageBitmaps closed) — the loaded scene is ours. */
export function disposeModel(root: Object3D): void {
  const seenMat = new Set<Material>();
  const seenTex = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    (m.geometry as BufferGeometry | undefined)?.dispose();
    for (const mat of materialsOf(m)) {
      if (seenMat.has(mat)) continue;
      seenMat.add(mat);
      for (const t of texturesOf(mat)) {
        if (seenTex.has(t)) continue;
        seenTex.add(t);
        const img = t.image as { close?: () => void } | null;
        t.dispose();
        img?.close?.();
      }
      mat.dispose();
    }
  });
}
