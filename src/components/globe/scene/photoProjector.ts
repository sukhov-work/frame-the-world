import * as THREE from "three";
import type { FrustumGeometry } from "../../../lib/geo/frustum";
import { PHOTO_PROJECT } from "../tuning";
import { PHOTO_PROJECT_SLOTS, type PhotoProjectorFeed, type PhotoProjectorSlot } from "./buildingMaterial";

/**
 * photoProjector — the photo flow (b) (prototype 2026-10-18; K SLOTS 2026-10-21, T171 — design:
 * `rendering/BUILDING_COLOUR_TRIAGE_2026-10-13.md` §4 + `rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md`
 * §2, backlog T157 / T169 / T171). FACADE photos (store/facadePhoto — technical photos, never pins) are
 * projected from their own camera poses onto the two building tilesets' shared fill material, with
 * occlusion from a depth map rendered AT each pose. This module owns the things the material cannot,
 * per SLOT: the photo texture (an ImageBitmap decode + resize off the main thread), the projector
 * camera (built from the SAME frustum geometry the placed-photo wireframe draws — what you see is
 * what projects), and the depth map (one R8 + DEPTH24 target per slot, two layered passes: the
 * enriched set through a plain depth material, the OSM set through one carrying the OSM clip prism
 * so the coarse OSM ancestors that straddle the Dnipro bbox never write phantom depth over the
 * enriched buildings). It publishes everything through ONE feed object the material packs per
 * render pass (`buildingMaterial.setPhotoProjector`) — nothing here is per draw.
 *
 * SLOTS. `PHOTO_PROJECT.slots` (K) slots are compiled into the material; this module keeps a pool
 * of K slot records. The DRAFT (the photo being placed / edited — `setSource` + `update`, the
 * prototype's API, kept byte-for-byte for the orchestrator and the 2026-10-18 harness) is the slot
 * `"draft"`; the saved photos of the residency plan (F3) take the rest through `request` /
 * `release` / `setGeometry`, and `setPriority` orders the feed (the material composites
 * front-to-back in feed order, so order IS priority: the draft first, then the nearest).
 *
 * THE PHOTO ARRAY (T170 / F4, 2026-10-22). Every live photo lives in a LAYER of ONE
 * `DataArrayTexture` (`PHOTO_PROJECT.layerPx` square, K layers; layer = the record's pool index),
 * stretched to the layer at load, so the city material binds one `sampler2DArray` for any K
 * (the plain route spent K units on the photos alone — 3 + 2K in all under ULTRA's three shadow
 * samplers, a ceiling of K ≤ 6; the array makes 3 + 1 + K). The depth maps stay K separate
 * targets (three 0.185's WebGL backend has no layered depth attachment). A layer upload
 * regenerates the whole array's mips (~24 ms) — a residency plan filling several slots pays it
 * once per slot as each decode resolves, never twice in one frame by construction (one load
 * resolves per task).
 *
 * Store-free by the scene fence: the orchestrator pushes the store's state in (`setSource` /
 * `request`) and the live frustum per frame (`update` / `setGeometry`). Every tier since F6 — the
 * orchestrator passes the tier's `tune` (K, the layer edge, the depth edge, the cadence, the draft).
 *
 * Cost when OFF: nothing (no pass, no texture, no live slot → one dead uniform branch per fragment
 * in the city material). Cost when ON: at most ONE depth re-render per frame across the slots (a
 * dirty slot first — a pose / photo / tile change — else the stalest past `depthRefreshMs`), each
 * render = two narrow-frustum depth passes over the building layers; per frame = one float64 4×4
 * multiply per live slot per set per pass (in the material) + per building fragment one mat4 × vec4
 * per live slot and, only inside a slot's frustum, one depth fetch + one photo fetch.
 */
export interface PhotoProjectorSource {
  /** The photo (the store's previewUrl — a blob: URL or a remote URL); null = nothing to project. */
  url: string | null;
  enabled: boolean;
  /** 0..1 — the facade's albedo replaced inside the footprint. */
  strength: number;
  /** 0..1 — 0 = lit by the scene, 1 = the photo's own colours. */
  ownLight: number;
  /** Metres from the apex the photo papers geometry; null / undefined = `PHOTO_PROJECT.rangeM`. */
  rangeM?: number | null;
}

/** One slot's live state (DEV seam, never mirrored flags). */
export interface PhotoProjectorSlotSnapshot {
  id: string;
  on: boolean;
  enabled: boolean;
  url: string | null;
  textureReady: boolean;
  /** The DECODED photo's size (px) — before the stretch to the array layer. */
  textureSize: [number, number] | null;
  /** T170: the slot's layer in the photo array (the pool index; fixed for the slot's life). */
  layer: number;
  depthSize: [number, number];
  depthRenders: number;
  lastDepthMs: number;
  apex: [number, number, number];
  vFovDeg: number;
  aspect: number;
  strength: number;
  ownLight: number;
  rangeM: number;
  /** T177: the viewer-distance fade applied on top of `strength` (1 = none). */
  fade: number;
  error: string | null;
}

export interface PhotoProjectorSnapshot {
  /** The DRAFT slot's view (the prototype's fields, kept for the 2026-10-18 harness)… */
  on: boolean;
  enabled: boolean;
  url: string | null;
  textureReady: boolean;
  textureSize: [number, number] | null;
  /** 1 = an ImageBitmap source (row 0 at v 0 → the shader flips v), 0 = an image element. */
  flipV: number;
  depthSize: [number, number];
  depthRenders: number;
  lastDepthMs: number;
  apex: [number, number, number];
  vFovDeg: number;
  aspect: number;
  strength: number;
  ownLight: number;
  error: string | null;
  /** …and the whole pool (T171): the live count, every occupied slot in FEED order, the capacity. */
  slotsOn: number;
  slots: PhotoProjectorSlotSnapshot[];
  capacity: number;
  depthRendersTotal: number;
  /** T170: the photo array once allocated (the first load) — its layer edge, layer count and the
   *  RGBA8 + mips bytes it holds (computed: WebGL reports no texture memory). */
  photoArray: { layerPx: number; layers: number; bytesMB: number } | null;
}

export interface PhotoProjectorHandle {
  /** The ONE feed both building sets hold by reference. */
  feed: PhotoProjectorFeed;
  /** The DRAFT slot's source — the orchestrator pushes the store's state on change (never per frame). */
  setSource(src: PhotoProjectorSource): void;
  /** Per frame: the DRAFT's live facade frustum (null = not placed) + the frame clock (ms) — then
   *  the whole pool ticks (`tick`). Kept as the prototype's one call. */
  update(geom: FrustumGeometry | null, nowMs: number): void;
  /** F3: give a saved photo a slot (or refresh its source if it has one). False when the pool is
   *  full — the caller's residency plan should never over-ask (it gets `capacity`). */
  request(id: string, src: PhotoProjectorSource): boolean;
  /** F3: free a saved photo's slot (its texture is dropped; the depth target is kept for reuse). */
  release(id: string): void;
  /** F3: a saved photo's frustum (built once from its record; null = render nothing). */
  setGeometry(id: string, geom: FrustumGeometry | null): void;
  /** F3: the feed order = priority (front-to-back compositing). Ids not in the pool are ignored;
   *  occupied slots not named keep their relative order after the named ones. */
  setPriority(ids: readonly string[]): void;
  /** T177: the VIEWER-distance fade of a saved slot (0..1, default 1) — multiplies the source's
   *  strength in the feed so a photo recedes before the residency releases it (degrade, never
   *  clip). Per frame from the orchestrator; the draft is never faded. Unknown ids are ignored. */
  setFade(id: string, fade: number): void;
  /** Advance every slot: pose → matrix, the one depth re-render this frame, the on flags. */
  tick(nowMs: number): void;
  /** A building tile landed or left — every depth map is stale; re-render on the next ticks. */
  markDepthDirty(): void;
  /** The slot ids currently occupied (feed order) and the pool size. */
  occupied(): string[];
  readonly capacity: number;
  /** DEV seam (`__globe.photoProjector()`): the live state, read off the objects, never mirrored flags. */
  snapshot(): PhotoProjectorSnapshot;
  dispose(): void;
}

export const DRAFT_SLOT_ID = "draft";

// NDC [-1,1]³ → [0,1]³ (the texture-space bias every shadow mapper folds into its matrix).
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/** The projector camera's vertical FOV (deg) and aspect from the frustum's far-face corners —
 *  derived from the SAME geometry the wireframe draws, so the projected rectangle IS the drawn
 *  plane (no second FOV derivation to drift). Exported for the unit twin. */
export function projectorOptics(geom: FrustumGeometry): { vFovDeg: number; aspect: number; planeDistM: number } {
  const [tl, tr, , bl] = geom.corners;
  const height = Math.hypot(tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]);
  const width = Math.hypot(tl[0] - tr[0], tl[1] - tr[1], tl[2] - tr[2]);
  // The far face is ⊥ forward: its centre's distance along forward is the plane distance.
  const cx = (tl[0] + tr[0] + bl[0] + geom.corners[2][0]) / 4 - geom.apex[0];
  const cy = (tl[1] + tr[1] + bl[1] + geom.corners[2][1]) / 4 - geom.apex[1];
  const cz = (tl[2] + tr[2] + bl[2] + geom.corners[2][2]) / 4 - geom.apex[2];
  const planeDistM = cx * geom.forward[0] + cy * geom.forward[1] + cz * geom.forward[2];
  const vFovDeg = (2 * Math.atan2(height / 2, planeDistM) * 180) / Math.PI;
  return { vFovDeg, aspect: height > 0 ? width / height : 1, planeDistM };
}

/** bias · P · V for a camera at `geom.apex` looking down `geom.forward` with `geom.up` — the
 *  WORLD → photo-clip matrix the feed carries (float64). Exported for the unit twin: the far-face
 *  corners must land on the uv corners. */
export function projectorMatrix(
  geom: FrustumGeometry,
  near: number,
  far: number,
  out = new THREE.Matrix4(),
  cam = new THREE.PerspectiveCamera(),
): THREE.Matrix4 {
  const { vFovDeg, aspect } = projectorOptics(geom);
  cam.position.set(geom.apex[0], geom.apex[1], geom.apex[2]);
  cam.up.set(geom.up[0], geom.up[1], geom.up[2]);
  cam.lookAt(
    geom.apex[0] + geom.forward[0],
    geom.apex[1] + geom.forward[1],
    geom.apex[2] + geom.forward[2],
  );
  cam.fov = vFovDeg;
  cam.aspect = aspect;
  cam.near = near;
  cam.far = far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true); // Camera: also refreshes matrixWorldInverse
  return out.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
}

/** The effective range (m) for a stored / draft `rangeM` (null → the tunable), clamped to a sane
 *  band — ONE law for the projector's paint and the residency's painted volume (T177). */
export const effectiveRangeM = (rangeM: number | null | undefined): number =>
  typeof rangeM === "number" && Number.isFinite(rangeM) && rangeM > 0 ? Math.min(PHOTO_PROJECT.farM, Math.max(10, rangeM)) : PHOTO_PROJECT.rangeM;
const rangeOf = (src: PhotoProjectorSource): number => effectiveRangeM(src.rangeM);

/** The pose numbers a slot's matrix + depth map depend on — the apex, forward, up AND the four
 *  far-face corners (21 floats). T174 (owner test 2026-10-22, a bug): the SCALE gizmo changes the
 *  H-FOV, which moves ONLY the corners, and the prototype's 9-float compare never saw it — the
 *  projection stayed stale until the apex or the heading moved. `last` is updated in place;
 *  returns whether anything differed (a NaN-filled `last` always differs). Exported for the twin. */
export const POSE_SIGNATURE_LENGTH = 21;
export function poseSignatureChanged(g: FrustumGeometry, last: Float64Array): boolean {
  let changed = false;
  const put = (i: number, v: number): void => {
    if (v !== last[i]) {
      changed = true;
      last[i] = v;
    }
  };
  put(0, g.apex[0]);
  put(1, g.apex[1]);
  put(2, g.apex[2]);
  put(3, g.forward[0]);
  put(4, g.forward[1]);
  put(5, g.forward[2]);
  put(6, g.up[0]);
  put(7, g.up[1]);
  put(8, g.up[2]);
  for (let c = 0; c < 4; c++) {
    const k = g.corners[c];
    put(9 + c * 3, k[0]);
    put(10 + c * 3, k[1]);
    put(11 + c * 3, k[2]);
  }
  return changed;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** One pool entry: the slot's own camera, depth target, texture and feed record. */
interface SlotRec {
  id: string | null;
  feed: PhotoProjectorSlot;
  source: PhotoProjectorSource;
  geom: FrustumGeometry | null;
  cam: THREE.PerspectiveCamera;
  vFovDeg: number;
  aspect: number;
  lastPose: Float64Array;
  /** T177: the viewer-distance fade (0..1) folded into `feed.slot.x`. */
  fade: number;
  rt: THREE.WebGLRenderTarget | null;
  depthTex: THREE.DepthTexture | null;
  depthDirty: boolean;
  depthRenders: number;
  lastDepthMs: number;
  /** T170: the record's layer in the photo array (= its pool index, fixed) and whether it holds
   *  an uploaded photo (the layer's pixels are stale otherwise — never sampled: `feed.layer` −1). */
  layer: number;
  textureReady: boolean;
  textureUrl: string | null;
  textureSize: [number, number] | null;
  flipV: number;
  loadSeq: number;
  error: string | null;
}

/** F6 (2026-10-23): the per-tier knobs the projector reads ONCE at attach — the desktop tier takes
 *  `PHOTO_PROJECT`'s, the lean / mobile tier `PHOTO_PROJECT_LEAN`'s (the orchestrator resolves them
 *  with `photoProjectFor(lean)`). `slots` MUST equal the K the city material was compiled with. */
export interface PhotoProjectorTune {
  /** K — the pool's records = the material's compiled slots. */
  slots?: number;
  /** The square layer edge of the photo array (px). */
  layerPx?: number;
  /** The depth map's long edge (px). */
  depthMapPx?: number;
  /** The live depth re-render cadence (ms). */
  depthRefreshMs?: number;
  /** Anisotropic filtering on the photo array (clamped to the device max). */
  anisotropy?: number;
  /** Whether record 0 is the DRAFT (the photo being placed / edited — the desktop flow). A
   *  view-only tier (/m: no upload, no editing) sets false so every record serves a SAVED row:
   *  `setSource` / the draft's `update` then address a detached record that is never rendered,
   *  `request(DRAFT_SLOT_ID)` answers false, and `capacity` is the whole pool. */
  draftSlot?: boolean;
}

export function attachPhotoProjector(
  scene: THREE.Scene,
  opts: {
    renderer: THREE.WebGLRenderer;
    /** The OSM set's clip prism (the bbox hole) — the OSM depth pass carries it; null = no mask. */
    osmClipPlanes: THREE.Plane[] | null;
    tune?: PhotoProjectorTune;
  },
): PhotoProjectorHandle {
  const tune = opts.tune ?? {};
  const K = Math.max(1, Math.floor(tune.slots ?? PHOTO_PROJECT_SLOTS));
  const depthMapPx = Math.max(16, Math.floor(tune.depthMapPx ?? PHOTO_PROJECT.depthMapPx));
  const depthRefreshMs = tune.depthRefreshMs ?? PHOTO_PROJECT.depthRefreshMs;
  const anisotropyWant = tune.anisotropy ?? PHOTO_PROJECT.anisotropy;
  const draftSlot = tune.draftSlot ?? true;
  const feed: PhotoProjectorFeed = {
    slots: [],
    photos: null,
    k: new THREE.Vector4(1, 0, 0, PHOTO_PROJECT.gain),
    depthP: new THREE.Vector4(
      PHOTO_PROJECT.nearM,
      PHOTO_PROJECT.farM,
      PHOTO_PROJECT.depthBiasM,
      PHOTO_PROJECT.depthBiasPerM,
    ),
    facing: new THREE.Vector4(PHOTO_PROJECT.facingLo, PHOTO_PROJECT.facingHi, PHOTO_PROJECT.edgeFeather, 0),
  };

  const defaultSource = (): PhotoProjectorSource => ({
    url: null,
    enabled: true,
    strength: PHOTO_PROJECT.strength,
    ownLight: PHOTO_PROJECT.ownLight,
    rangeM: null,
  });

  // --- the pool ---------------------------------------------------------------------------------
  // `pool` is the fixed K records; `feed.slots` is the SAME records' feed halves in PRIORITY order
  // (the material packs the live ones in that order). The draft is the pool's first record by
  // construction, so with no `setPriority` call the prototype's single-slot behaviour is exact.
  const makeRec = (i: number): SlotRec => ({
    id: null,
    feed: {
      on: false,
      projVP: new THREE.Matrix4(),
      apexW: new THREE.Vector3(),
      layer: -1,
      depth: null,
      slot: new THREE.Vector4(PHOTO_PROJECT.strength, 0, PHOTO_PROJECT.rangeM, PHOTO_PROJECT.ownLight),
    },
    source: defaultSource(),
    geom: null,
    cam: new THREE.PerspectiveCamera(50, 1.5, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM),
    vFovDeg: 0,
    aspect: 1.5,
    lastPose: new Float64Array(POSE_SIGNATURE_LENGTH).fill(NaN),
    fade: 1,
    rt: null,
    depthTex: null,
    depthDirty: true,
    depthRenders: 0,
    lastDepthMs: -Infinity,
    layer: i,
    textureReady: false,
    textureUrl: null,
    textureSize: null,
    flipV: 0,
    loadSeq: 0,
    error: null,
  });
  const pool: SlotRec[] = Array.from({ length: K }, (_, i) => makeRec(i));
  // The draft always holds the first record (never released; its texture comes and goes) — on the
  // desktop tier. A view-only tier (F6, `draftSlot: false`) has no draft: the pool is all SAVED
  // rows and the draft handle addresses a DETACHED record (layer −1, never in the pool, never
  // rendered, never loaded — `syncTexture` skips a record without a layer).
  const draft: SlotRec = draftSlot ? pool[0] : makeRec(-1);
  if (draftSlot) pool[0].id = DRAFT_SLOT_ID;
  let order: SlotRec[] = pool.slice();
  const syncFeedOrder = (): void => {
    feed.slots = order.map((r) => r.feed);
  };
  syncFeedOrder();

  const find = (id: string): SlotRec | undefined => pool.find((r) => r.id === id);

  const poseChanged = (r: SlotRec, g: FrustumGeometry): boolean => poseSignatureChanged(g, r.lastPose);

  // --- the depth maps (one target per slot, allocated on first need) -----------------------------
  const depthPlain = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  const depthOsm = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  if (opts.osmClipPlanes) {
    depthOsm.clippingPlanes = opts.osmClipPlanes;
    depthOsm.clipIntersection = true;
  }
  let depthRendersTotal = 0;

  const ensureTarget = (r: SlotRec): THREE.WebGLRenderTarget => {
    if (r.rt) return r.rt;
    const depthTex = new THREE.DepthTexture(depthMapPx, depthMapPx, THREE.UnsignedIntType);
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(depthMapPx, depthMapPx, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depthTex,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    r.rt = rt;
    r.depthTex = depthTex;
    return rt;
  };

  const sizeDepthFor = (r: SlotRec, a: number): void => {
    const rt = ensureTarget(r);
    const px = depthMapPx;
    const w = a >= 1 ? px : Math.max(16, Math.round(px * a));
    const h = a >= 1 ? Math.max(16, Math.round(px / a)) : px;
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h); // resizes the depth texture with it
  };

  const renderDepth = (r: SlotRec): void => {
    const rt = ensureTarget(r);
    const rd = opts.renderer;
    // The A2-2 bracket (the /m PiP precedent): a second `render()` would otherwise re-render every
    // shadow map; restore so nothing downstream inherits a frozen one. The composer leaves the
    // target bound to whatever it finds — hand it back exactly, then null is the mandatory default.
    const prevTarget = rd.getRenderTarget();
    const prevAutoClear = rd.autoClear;
    const prevShadowAuto = rd.shadowMap.autoUpdate;
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    rd.shadowMap.autoUpdate = false;
    rd.autoClear = false;
    scene.background = null;
    rd.setRenderTarget(rt);
    rd.clear(true, true, false);
    // Pass 1: the enriched buildings (their own layer, no clip). Pass 2: the OSM set through the
    // clipped material — the bbox hole stays a hole in the depth map too.
    scene.overrideMaterial = depthPlain;
    r.cam.layers.set(PHOTO_PROJECT.depthLayerEnriched);
    rd.render(scene, r.cam);
    scene.overrideMaterial = depthOsm;
    r.cam.layers.set(PHOTO_PROJECT.depthLayerOsm);
    rd.render(scene, r.cam);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    rd.autoClear = prevAutoClear;
    rd.shadowMap.autoUpdate = prevShadowAuto;
    rd.setRenderTarget(prevTarget);
    r.depthRenders++;
    depthRendersTotal++;
  };

  // --- the photo textures (T170 / F4: ONE array texture, a layer per pool record) -----------------
  // Allocated LAZILY on the first load, storage only: `source.dataReady = false` makes three's
  // `texStorage3D` allocate the K layers + the mip chain without a CPU buffer (WebGLTextures.js
  // :947-949, :1172-1178 on 0.185). Mips, filters and anisotropy are part of three's texture-cache
  // KEY (:530-546): they are set BEFORE the allocation and NEVER changed after — a change re-creates
  // the GL texture and silently drops every layer (:739-757). A layer is written with
  // `renderer.copyTextureToTexture` from a never-registered `THREE.Texture` around the decoded
  // ImageBitmap — the `texSubImage3D(…, image)` branch (WebGLRenderer.js:3452-3463) — which
  // regenerates the WHOLE array's mips: ~24 ms for 2048² × 6 on the M3 (measured 2026-10-22), rare
  // by the residency's hysteresis. The bitmap is closed the moment the copy returns (the pixels
  // are on the GPU); `needsUpdate` is never set on the array after the allocation.
  let photos: THREE.DataArrayTexture | null = null;
  const layerPx = Math.max(64, Math.floor(tune.layerPx ?? PHOTO_PROJECT.layerPx));
  const ensurePhotoArray = (): THREE.DataArrayTexture => {
    if (photos) return photos;
    const arr = new THREE.DataArrayTexture(null, layerPx, layerPx, K);
    arr.format = THREE.RGBAFormat;
    arr.type = THREE.UnsignedByteType;
    arr.colorSpace = THREE.SRGBColorSpace; // SRGB8_ALPHA8 → the sampler returns linear light
    arr.generateMipmaps = true;
    arr.minFilter = THREE.LinearMipmapLinearFilter;
    arr.magFilter = THREE.LinearFilter;
    arr.wrapS = THREE.ClampToEdgeWrapping;
    arr.wrapT = THREE.ClampToEdgeWrapping;
    arr.anisotropy = Math.min(anisotropyWant, opts.renderer.capabilities.getMaxAnisotropy());
    arr.source.dataReady = false; // allocate; transfer nothing
    arr.needsUpdate = true;
    opts.renderer.initTexture(arr);
    photos = arr;
    feed.photos = arr;
    return arr;
  };

  const dropTexture = (r: SlotRec): void => {
    // The layer stays allocated (the array is one GL object); the next load overwrites it.
    r.textureReady = false;
    r.textureUrl = null;
    r.textureSize = null;
    r.feed.layer = -1;
  };

  const loadTexture = async (r: SlotRec, url: string, seq: number): Promise<void> => {
    const res = await fetch(url);
    const blob = await res.blob();
    // `from-image` honours the EXIF orientation (a portrait phone frame arrives rotated); older
    // engines reject the enum — fall back to the default orientation rather than fail the load.
    let full: ImageBitmap;
    try {
      full = await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none" });
    } catch {
      full = await createImageBitmap(blob);
    }
    if (seq !== r.loadSeq) {
      full.close();
      return;
    }
    const decoded: [number, number] = [full.width, full.height];
    // The STRETCH to the square layer (non-uniform; the fragment addresses the photo in its own
    // normalised frame, so a 4:3 frame upsampled to 1:1 reads exactly as before — no crop, no
    // letterbox, no sub-rectangle for a coarse mip to bleed across; the photo keeps its long edge).
    let bmp = full;
    if (full.width !== layerPx || full.height !== layerPx) {
      bmp = await createImageBitmap(full, { resizeWidth: layerPx, resizeHeight: layerPx, resizeQuality: "high", premultiplyAlpha: "none" });
      full.close();
      if (seq !== r.loadSeq) {
        bmp.close();
        return;
      }
    }
    const arr = ensurePhotoArray();
    const src = new THREE.Texture(bmp);
    src.colorSpace = THREE.SRGBColorSpace;
    src.flipY = false; // ignored for an ImageBitmap anyway; the shader flips v
    src.premultiplyAlpha = false;
    try {
      opts.renderer.copyTextureToTexture(src, arr, null, new THREE.Vector3(0, 0, r.layer));
    } finally {
      bmp.close(); // the pixels are on the GPU — the copy is synchronous (a lost context must not leak the bitmap)
    }
    r.textureReady = true;
    r.textureUrl = url;
    r.textureSize = decoded;
    r.flipV = 1; // vestigial since F4 (every source is a bitmap, the flip is a shader constant) — the 2026-10-18 harness reads it
    r.feed.layer = r.layer;
    r.feed.slot.y = r.layer;
    r.depthDirty = true;
  };

  const syncTexture = (r: SlotRec): void => {
    const url = r.source.url;
    if (url === r.textureUrl || r.layer < 0) return; // a detached record (no draft slot) never loads
    if (!url) {
      r.loadSeq++;
      dropTexture(r);
      return;
    }
    const seq = ++r.loadSeq;
    r.error = null;
    loadTexture(r, url, seq).catch((err: unknown) => {
      if (seq !== r.loadSeq) return;
      // A failed decode is not fatal: the frustum + plane still show; the projection stays off.
      r.error = err instanceof Error ? err.message : String(err);
      dropTexture(r);
    });
  };

  const applySource = (r: SlotRec, src: PhotoProjectorSource): void => {
    r.source = src;
    r.feed.slot.x = clamp01(src.strength) * r.fade;
    r.feed.slot.w = clamp01(src.ownLight);
    r.feed.slot.z = rangeOf(src);
    syncTexture(r);
  };

  const clearSlot = (r: SlotRec): void => {
    r.loadSeq++;
    dropTexture(r);
    r.id = null;
    r.source = defaultSource();
    r.geom = null;
    r.lastPose.fill(NaN);
    r.fade = 1;
    r.feed.on = false;
    r.feed.depth = null;
    r.depthDirty = true;
    r.error = null;
  };

  const slotSnapshot = (r: SlotRec): PhotoProjectorSlotSnapshot => ({
    id: r.id ?? "",
    on: r.feed.on,
    enabled: r.source.enabled,
    url: r.source.url,
    textureReady: r.textureReady,
    textureSize: r.textureSize ? [r.textureSize[0], r.textureSize[1]] : null,
    layer: r.layer,
    depthSize: r.rt ? [r.rt.width, r.rt.height] : [depthMapPx, depthMapPx],
    depthRenders: r.depthRenders,
    lastDepthMs: r.lastDepthMs,
    apex: [r.feed.apexW.x, r.feed.apexW.y, r.feed.apexW.z],
    vFovDeg: r.vFovDeg,
    aspect: r.aspect,
    strength: r.feed.slot.x,
    ownLight: r.feed.slot.w,
    rangeM: r.feed.slot.z,
    fade: r.fade,
    error: r.error,
  });

  const tick = (nowMs: number): void => {
    // Pass 1: poses → matrices; which slots are live; who wants a depth render.
    let toRender: SlotRec | null = null;
    let stalest: SlotRec | null = null;
    for (const r of order) {
      const g = r.geom;
      const live = r.id !== null && g !== null && r.source.enabled && r.textureReady;
      if (!live) {
        if (r.feed.on) r.feed.on = false;
        continue;
      }
      if (poseChanged(r, g)) {
        const o = projectorOptics(g);
        r.vFovDeg = o.vFovDeg;
        r.aspect = o.aspect;
        projectorMatrix(g, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM, r.feed.projVP, r.cam);
        r.feed.apexW.copy(r.cam.position);
        sizeDepthFor(r, r.aspect);
        r.depthDirty = true;
      }
      if (r.depthDirty) {
        if (!toRender) toRender = r;
      } else if (nowMs - r.lastDepthMs > depthRefreshMs) {
        if (!stalest || r.lastDepthMs < stalest.lastDepthMs) stalest = r;
      }
    }
    // Pass 2: ONE depth render per frame across the pool — a dirty slot first (feed order = the
    // draft first), else the stalest past the refresh cadence.
    const victim = toRender ?? stalest;
    if (victim) {
      renderDepth(victim);
      victim.lastDepthMs = nowMs;
      victim.depthDirty = false;
    }
    // Pass 3: the on flags — a live slot goes on once its depth map exists.
    for (const r of order) {
      const live = r.id !== null && r.geom !== null && r.source.enabled && r.textureReady && r.depthRenders > 0 && r.depthTex !== null;
      if (live) {
        if (r.feed.depth !== r.depthTex) r.feed.depth = r.depthTex;
        if (!r.feed.on) r.feed.on = true;
      } else if (r.feed.on) r.feed.on = false;
    }
  };

  return {
    feed,
    get capacity() {
      return K;
    },
    setSource(src) {
      applySource(draft, src);
    },
    update(geom, nowMs) {
      draft.geom = geom;
      tick(nowMs);
    },
    request(id, src) {
      if (id === DRAFT_SLOT_ID) {
        if (!draftSlot) return false;
        applySource(draft, src);
        return true;
      }
      let r = find(id);
      if (!r) {
        r = pool.find((p) => p.id === null);
        if (!r) return false;
        r.id = id;
        r.lastPose.fill(NaN);
        r.depthDirty = true;
      }
      applySource(r, src);
      return true;
    },
    release(id) {
      if (id === DRAFT_SLOT_ID) return; // the draft is never released; its source goes null instead
      const r = find(id);
      if (r) clearSlot(r);
    },
    setGeometry(id, geom) {
      const r = find(id);
      if (r) r.geom = geom;
    },
    setFade(id, fade) {
      if (id === DRAFT_SLOT_ID) return;
      const r = find(id);
      if (!r) return;
      const f = Number.isFinite(fade) ? clamp01(fade) : 1;
      if (f === r.fade) return;
      r.fade = f;
      r.feed.slot.x = clamp01(r.source.strength) * f;
    },
    setPriority(ids) {
      const named: SlotRec[] = [];
      for (const id of ids) {
        const r = find(id);
        if (r && !named.includes(r)) named.push(r);
      }
      const rest = order.filter((r) => !named.includes(r));
      order = [...named, ...rest];
      syncFeedOrder();
    },
    tick,
    markDepthDirty() {
      for (const r of pool) r.depthDirty = true;
    },
    occupied() {
      return order.filter((r) => r.id !== null).map((r) => r.id as string);
    },
    snapshot() {
      const d = slotSnapshot(draft);
      return {
        on: d.on,
        enabled: d.enabled,
        url: d.url,
        textureReady: d.textureReady,
        textureSize: d.textureSize,
        flipV: draft.flipV,
        depthSize: d.depthSize,
        depthRenders: d.depthRenders,
        lastDepthMs: d.lastDepthMs,
        apex: d.apex,
        vFovDeg: d.vFovDeg,
        aspect: d.aspect,
        strength: d.strength,
        ownLight: d.ownLight,
        error: d.error,
        slotsOn: order.filter((r) => r.feed.on).length,
        slots: order.filter((r) => r.id !== null).map(slotSnapshot),
        capacity: K,
        depthRendersTotal,
        photoArray: photos ? { layerPx, layers: K, bytesMB: Math.round((layerPx * layerPx * 4 * (4 / 3) * K) / 1e5) / 10 } : null,
      };
    },
    dispose() {
      for (const r of pool) {
        r.loadSeq++;
        r.feed.on = false;
        dropTexture(r);
        r.rt?.dispose(); // frees the colour + depth textures with the framebuffer
        r.rt = null;
        r.depthTex = null;
      }
      photos?.dispose();
      photos = null;
      feed.photos = null;
      depthPlain.dispose();
      depthOsm.dispose();
    },
  };
}
