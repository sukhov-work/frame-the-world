import * as THREE from "three";
import type { FrustumGeometry } from "../../../lib/geo/frustum";
import { PHOTO_PROJECT } from "../tuning";
import type { PhotoProjectorFeed } from "./buildingMaterial";

/**
 * photoProjector — the photo flow (b) prototype (2026-10-18; design: `rendering/BUILDING_COLOUR_TRIAGE
 * _2026-10-13.md` §4, backlog T157). A FACADE photo (store/facadePhoto — a technical photo, never a pin)
 * is projected from its own camera pose onto the two building tilesets' shared fill material, with
 * occlusion from a depth map rendered AT the pose. This module owns the three things the material
 * cannot: the photo texture (an ImageBitmap decode + resize off the main thread), the projector
 * camera (built from the SAME frustum geometry the placed-photo wireframe draws — what you see is
 * what projects), and the depth map (one R8 + DEPTH24 target, two layered passes: the enriched set
 * through a plain depth material, the OSM set through one carrying the OSM clip prism so the
 * coarse OSM ancestors that straddle the Dnipro bbox never write phantom depth over the enriched
 * buildings). It publishes everything through ONE feed object the material reads per render pass
 * (`buildingMaterial.setPhotoProjector`) — nothing here is per draw.
 *
 * Store-free by the scene fence: the orchestrator pushes the store's state in (`setSource`) and the
 * live frustum per frame (`update`). Desktop-only by the attach gate in the orchestrator.
 *
 * Cost when OFF: nothing (no pass, no texture, `feed.on` false → one dead uniform branch per
 * fragment in the city material). Cost when ON: the depth map re-renders on a pose / photo
 * change and at most every `depthRefreshMs` otherwise (tile streaming, the enriched seat ease),
 * each render = two narrow-frustum depth passes over the building layers; per frame = one
 * float64 4×4 multiply per set per pass (in the material) + one extra depth fetch and one photo
 * fetch per building fragment.
 */
export interface PhotoProjectorSource {
  /** The photo (the store's previewUrl — a blob: URL or a remote URL); null = nothing to project. */
  url: string | null;
  enabled: boolean;
  /** 0..1 — the facade's albedo replaced inside the footprint. */
  strength: number;
  /** 0..1 — 0 = lit by the scene, 1 = the photo's own colours. */
  ownLight: number;
}

export interface PhotoProjectorSnapshot {
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
}

export interface PhotoProjectorHandle {
  /** The ONE feed both building sets hold by reference. */
  feed: PhotoProjectorFeed;
  /** The orchestrator pushes the store's state on change (never per frame). */
  setSource(src: PhotoProjectorSource): void;
  /** Per frame: the live facade frustum (null = not placed) + the frame clock (ms). Re-renders
   *  the depth map when the pose changed, when a tile landed/left (`markDepthDirty`) or when the
   *  refresh cadence is due; flips the feed on/off. */
  update(geom: FrustumGeometry | null, nowMs: number): void;
  /** A building tile landed or left — the depth map is stale; re-render at the next update. */
  markDepthDirty(): void;
  /** DEV seam (`__globe.photoProjector()`): the live state, read off the objects, never mirrored flags. */
  snapshot(): PhotoProjectorSnapshot;
  dispose(): void;
}

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

export function attachPhotoProjector(
  scene: THREE.Scene,
  opts: {
    renderer: THREE.WebGLRenderer;
    /** The OSM set's clip prism (the bbox hole) — the OSM depth pass carries it; null = no mask. */
    osmClipPlanes: THREE.Plane[] | null;
  },
): PhotoProjectorHandle {
  const feed: PhotoProjectorFeed = {
    on: false,
    projVP: new THREE.Matrix4(),
    apexW: new THREE.Vector3(),
    map: null,
    depth: null,
    k: new THREE.Vector4(PHOTO_PROJECT.strength, PHOTO_PROJECT.ownLight, 0, PHOTO_PROJECT.gain),
    depthP: new THREE.Vector4(
      PHOTO_PROJECT.nearM,
      PHOTO_PROJECT.farM,
      PHOTO_PROJECT.depthBiasM,
      PHOTO_PROJECT.depthBiasPerM,
    ),
    facing: new THREE.Vector4(
      PHOTO_PROJECT.facingLo,
      PHOTO_PROJECT.facingHi,
      PHOTO_PROJECT.edgeFeather,
      PHOTO_PROJECT.rangeM,
    ),
  };

  // --- the projector camera -------------------------------------------------------------------
  const cam = new THREE.PerspectiveCamera(50, 1.5, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM);
  let vFovDeg = 0;
  let aspect = 1.5;
  // The pose the camera was last built from — a per-frame numeric compare, no allocation.
  const lastPose = new Float64Array(9).fill(NaN);
  const poseChanged = (g: FrustumGeometry): boolean => {
    let changed = false;
    const v = [g.apex[0], g.apex[1], g.apex[2], g.forward[0], g.forward[1], g.forward[2], g.up[0], g.up[1], g.up[2]];
    for (let i = 0; i < 9; i++) {
      if (v[i] !== lastPose[i]) {
        changed = true;
        lastPose[i] = v[i];
      }
    }
    return changed;
  };

  // --- the depth map ----------------------------------------------------------------------------
  const depthTex = new THREE.DepthTexture(PHOTO_PROJECT.depthMapPx, PHOTO_PROJECT.depthMapPx, THREE.UnsignedIntType);
  depthTex.minFilter = THREE.NearestFilter;
  depthTex.magFilter = THREE.NearestFilter;
  const rt = new THREE.WebGLRenderTarget(PHOTO_PROJECT.depthMapPx, PHOTO_PROJECT.depthMapPx, {
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depthTex,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const depthPlain = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  const depthOsm = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  if (opts.osmClipPlanes) {
    depthOsm.clippingPlanes = opts.osmClipPlanes;
    depthOsm.clipIntersection = true;
  }
  let depthDirty = true;
  let depthRenders = 0;
  let lastDepthMs = -Infinity;

  const sizeDepthFor = (a: number): void => {
    const px = PHOTO_PROJECT.depthMapPx;
    const w = a >= 1 ? px : Math.max(16, Math.round(px * a));
    const h = a >= 1 ? Math.max(16, Math.round(px / a)) : px;
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h); // resizes the depth texture with it
  };

  const renderDepth = (): void => {
    const r = opts.renderer;
    // The A2-2 bracket (the /m PiP precedent): a second `render()` would otherwise re-render every
    // shadow map; restore so nothing downstream inherits a frozen one. The composer leaves the
    // target bound to whatever it finds — hand it back exactly, then null is the mandatory default.
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevShadowAuto = r.shadowMap.autoUpdate;
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    scene.background = null;
    r.setRenderTarget(rt);
    r.clear(true, true, false);
    // Pass 1: the enriched buildings (their own layer, no clip). Pass 2: the OSM set through the
    // clipped material — the bbox hole stays a hole in the depth map too.
    scene.overrideMaterial = depthPlain;
    cam.layers.set(PHOTO_PROJECT.depthLayerEnriched);
    r.render(scene, cam);
    scene.overrideMaterial = depthOsm;
    cam.layers.set(PHOTO_PROJECT.depthLayerOsm);
    r.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    r.autoClear = prevAutoClear;
    r.shadowMap.autoUpdate = prevShadowAuto;
    r.setRenderTarget(prevTarget);
    depthRenders++;
  };

  // --- the photo texture --------------------------------------------------------------------
  let source: PhotoProjectorSource = { url: null, enabled: true, strength: PHOTO_PROJECT.strength, ownLight: PHOTO_PROJECT.ownLight };
  let texture: THREE.Texture | null = null;
  let textureUrl: string | null = null;
  let textureSize: [number, number] | null = null;
  let flipV = 0;
  let loadSeq = 0;
  let error: string | null = null;

  const dropTexture = (): void => {
    if (texture) {
      const img = texture.image as { close?: () => void } | undefined;
      texture.dispose();
      img?.close?.(); // an ImageBitmap frees its pixels on close
    }
    texture = null;
    textureUrl = null;
    textureSize = null;
    feed.map = null;
  };

  const loadTexture = async (url: string, seq: number): Promise<void> => {
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
    if (seq !== loadSeq) {
      full.close();
      return;
    }
    let bmp = full;
    const long = Math.max(full.width, full.height);
    if (long > PHOTO_PROJECT.maxTexturePx) {
      const k = PHOTO_PROJECT.maxTexturePx / long;
      bmp = await createImageBitmap(full, {
        resizeWidth: Math.max(1, Math.round(full.width * k)),
        resizeHeight: Math.max(1, Math.round(full.height * k)),
        resizeQuality: "high",
      });
      full.close();
      if (seq !== loadSeq) {
        bmp.close();
        return;
      }
    }
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace; // SRGB8_ALPHA8 → the sampler returns linear light
    tex.flipY = false; // ignored for ImageBitmap anyway; the shader flips v (feed.k.z)
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = Math.min(PHOTO_PROJECT.anisotropy, opts.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    dropTexture();
    texture = tex;
    textureUrl = url;
    textureSize = [bmp.width, bmp.height];
    flipV = 1;
    feed.map = tex;
    feed.k.z = flipV;
    depthDirty = true;
  };

  const syncTexture = (): void => {
    const url = source.url;
    if (url === textureUrl) return;
    if (!url) {
      loadSeq++;
      dropTexture();
      return;
    }
    const seq = ++loadSeq;
    error = null;
    loadTexture(url, seq).catch((err: unknown) => {
      if (seq !== loadSeq) return;
      // A failed decode is not fatal: the frustum + plane still show; the projection stays off.
      error = err instanceof Error ? err.message : String(err);
      dropTexture();
    });
  };

  return {
    feed,
    setSource(src) {
      source = src;
      feed.k.x = Math.min(1, Math.max(0, src.strength));
      feed.k.y = Math.min(1, Math.max(0, src.ownLight));
      syncTexture();
    },
    update(geom, nowMs) {
      if (!geom || !source.enabled || !texture) {
        if (feed.on) feed.on = false;
        return;
      }
      if (poseChanged(geom)) {
        const o = projectorOptics(geom);
        vFovDeg = o.vFovDeg;
        aspect = o.aspect;
        projectorMatrix(geom, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM, feed.projVP, cam);
        feed.apexW.copy(cam.position);
        sizeDepthFor(aspect);
        depthDirty = true;
      }
      if (depthDirty || nowMs - lastDepthMs > PHOTO_PROJECT.depthRefreshMs) {
        renderDepth();
        lastDepthMs = nowMs;
        depthDirty = false;
      }
      if (!feed.on) {
        feed.depth = depthTex;
        feed.on = true;
      }
    },
    markDepthDirty() {
      depthDirty = true;
    },
    snapshot() {
      return {
        on: feed.on,
        enabled: source.enabled,
        url: source.url,
        textureReady: texture !== null,
        textureSize: textureSize ? [textureSize[0], textureSize[1]] : null,
        flipV,
        depthSize: [rt.width, rt.height],
        depthRenders,
        lastDepthMs,
        apex: [feed.apexW.x, feed.apexW.y, feed.apexW.z],
        vFovDeg,
        aspect,
        strength: feed.k.x,
        ownLight: feed.k.y,
        error,
      };
    },
    dispose() {
      loadSeq++;
      feed.on = false;
      dropTexture();
      rt.dispose(); // frees the colour + depth textures with the framebuffer
      depthPlain.dispose();
      depthOsm.dispose();
    },
  };
}
