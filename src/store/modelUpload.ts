/**
 * Model upload flow state (MESH SUITE MS4, D3 — 2026-09-02): the zustand spine of the MODEL
 * branch of the UPLOAD modal. Deliberately a SEPARATE store from `store/upload`: 17 modules read
 * that store and 15 sites branch on its `phase` to drive the frustum, the placing hint and the
 * detail panel — a model is not a photo, and the photo contract stays byte-identical (the §4a
 * posture). The two share the overlay (`useUploadStore.open`) and the UPLOAD HERE seed
 * (`pendingPlacement`, consumed here exactly as `ingest` consumes it for a GPS-less photo).
 *
 *   idle → loading → inspecting → decimating? → packing → review → uploading → stored
 *                                                  ↘ error (a named reason; back on the dropzone)
 *
 * The heavy steps run through an injectable `ModelPipeline` (default = ONE lazy import of
 * `lib/models/normalizeModel`, so neither the globe bundle nor the unit tests carry three's
 * loaders). Binary state — the loaded scene, the packed GLB — lives in MODULE scope, never in
 * the store: zustand snapshots are for the UI.
 */

import { create } from "zustand";
import type { Placement } from "../lib/decode/params";
import {
  MODEL_CAPS,
  TEXTURE_EDGE_LADDER,
  UNIT_SCALE,
  auditGlbSize,
  auditModelStats,
  auditRawSize,
  suggestUnit,
  violationMessage,
  type ModelFormat,
  type ModelStats,
  type ModelUnit,
  type ModelViolation,
} from "../lib/models/modelCaps";
import { titleFromFileName } from "../lib/save/pinBody";
import { safeModelFileName } from "../lib/wix/modelRecords";
import { useCameraStore } from "./camera";
import { useUploadStore } from "./upload";
import { useUserModelsStore } from "./userModels";

export type ModelPhase =
  | "idle"
  | "loading"
  | "inspecting"
  | "decimating"
  | "packing"
  | "review"
  | "uploading"
  | "stored"
  | "error";

/** The three-dependent steps, as the store sees them (`root` is opaque here on purpose). */
export interface ModelPipeline {
  load(files: File[], primary: number, format: ModelFormat): Promise<{ root: unknown; animations: number }>;
  rawExtent(root: unknown): number;
  inspect(root: unknown, animations: number, unitScale: number): ModelStats;
  decimate(root: unknown, maxTris: number): Promise<{ tris: number; before: number } | { violation: ModelViolation }>;
  applyUnitScale(root: unknown, metresPerUnit: number): void;
  exportGlb(root: unknown, maxTextureEdge: number): Promise<ArrayBuffer>;
  thumbnail(root: unknown): Promise<Blob | null>;
  dispose(root: unknown): void;
}

const defaultPipeline: ModelPipeline = {
  load: async (files, primary, format) => (await import("../lib/models/normalizeModel")).loadModelFiles(files, primary, format),
  rawExtent: (root) => {
    // Sync by contract; the module is already loaded by `load` — the cache hit is synchronous
    // only through the resolved binding kept below.
    if (!loadedModule) throw new Error("normalizeModel not loaded");
    return loadedModule.rawExtent(root as never);
  },
  inspect: (root, animations, unitScale) => {
    if (!loadedModule) throw new Error("normalizeModel not loaded");
    return loadedModule.inspectModel(root as never, animations, unitScale);
  },
  decimate: async (root, maxTris) => (await import("../lib/models/normalizeModel")).decimateModel(root as never, maxTris),
  applyUnitScale: (root, k) => {
    if (!loadedModule) throw new Error("normalizeModel not loaded");
    loadedModule.applyUnitScale(root as never, k);
  },
  exportGlb: async (root, edge) => (await import("../lib/models/normalizeModel")).exportGlb(root as never, edge),
  thumbnail: async (root) => (await import("../lib/models/normalizeModel")).renderThumbnail(root as never),
  dispose: (root) => {
    loadedModule?.disposeModel(root as never);
  },
};
let loadedModule: typeof import("../lib/models/normalizeModel") | null = null;
let pipeline: ModelPipeline = {
  ...defaultPipeline,
  load: async (files, primary, format) => {
    loadedModule = await import("../lib/models/normalizeModel");
    return loadedModule.loadModelFiles(files, primary, format);
  },
};

/** Test / DEV seam: swap the three-dependent steps for fakes. Returns the previous pipeline. */
export function _setModelPipeline(next: ModelPipeline | null): ModelPipeline {
  const prev = pipeline;
  pipeline = next ?? {
    ...defaultPipeline,
    load: async (files, primary, format) => {
      loadedModule = await import("../lib/models/normalizeModel");
      return loadedModule.loadModelFiles(files, primary, format);
    },
  };
  return prev;
}

export interface StoredModel {
  modelId: string;
  url: string;
  thumbnailUrl: string | null;
  readiness: string;
}

interface ModelUploadStore {
  phase: ModelPhase;
  /** 0..1 coarse pipeline progress (stage boundaries only — no step reports percentages). */
  progress: number;
  fileName?: string;
  format?: ModelFormat;
  /** Bytes across the whole drop (model + companions). */
  rawBytes?: number;
  /** Member-editable record title (defaults to the file name's stem). */
  title: string;
  stats?: ModelStats;
  /** Triangle count BEFORE auto-decimation; null when the model was within budget. */
  decimatedFromTris: number | null;
  glbBytes?: number;
  /** The texture-edge rung the pack succeeded at. */
  textureEdge?: number;
  /** Object URL of the rendered card thumbnail (revoked on clear). */
  thumbnailUrl?: string;
  warnings: string[];
  violations: ModelViolation[];
  /** Pipeline refusal (phase "error") or upload failure (phase stays "review"). */
  error?: string;
  errorCode?: string;
  unit: ModelUnit;
  /** True while the unit is the heuristic's guess (the card says so until the member picks). */
  unitSuggested: boolean;
  /** The UPLOAD HERE seed, consumed at review like a GPS-less photo's — MS5 places the rest. */
  placement?: Placement;
  stored?: StoredModel;

  /** Load → inspect → audit → decimate → pack → thumbnail → review (or a named refusal). */
  begin(files: File[], primary: number, format: ModelFormat): Promise<void>;
  setTitle(title: string): void;
  /** Re-scale the bounds and re-pack at the member's unit. */
  setUnit(unit: ModelUnit): Promise<void>;
  /** Mint → PUT the GLB → POST the record. Sign-in is the CALLER's gate (the endpoint's 401 is
   *  the structural one). */
  upload(): Promise<void>;
  /** Back to nothing (frees the scene, revokes the thumbnail). */
  clear(): void;
}

let seq = 0;
let root: unknown = null;
let animations = 0;
let glb: Blob | null = null;
/** The rendered card thumbnail — uploaded beside the GLB as a public image (the platform's own
 *  MODEL3D thumbnail URL is a permanent 403, measured 2026-09-02h). */
let thumbBlob: Blob | null = null;

const revoke = (url?: string) => {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
};

const releaseScene = () => {
  if (root !== null) {
    try {
      pipeline.dispose(root);
    } catch {
      /* a half-loaded scene may lack disposable parts */
    }
  }
  root = null;
  animations = 0;
  glb = null;
  thumbBlob = null;
};

const fail = (violations: ModelViolation[], message?: string): Partial<ModelUploadStore> => ({
  phase: "error",
  progress: 0,
  violations,
  error: message ?? violations.map(violationMessage).join(" · "),
  errorCode: violations[0]?.code,
});

export const useModelUploadStore = create<ModelUploadStore>((set, get) => ({
  phase: "idle",
  progress: 0,
  title: "",
  decimatedFromTris: null,
  warnings: [],
  violations: [],
  unit: "m",
  unitSuggested: false,

  begin: async (files, primary, format) => {
    const my = ++seq;
    releaseScene();
    revoke(get().thumbnailUrl);
    const file = files[primary];
    const rawBytes = files.reduce((a, f) => a + f.size, 0);
    set({
      phase: "loading",
      progress: 0.05,
      fileName: file?.name,
      format,
      rawBytes,
      title: titleFromFileName(file?.name),
      stats: undefined,
      decimatedFromTris: null,
      glbBytes: undefined,
      textureEdge: undefined,
      thumbnailUrl: undefined,
      warnings: [],
      violations: [],
      error: undefined,
      errorCode: undefined,
      unit: "m",
      unitSuggested: false,
      placement: undefined,
      stored: undefined,
    });

    // The source-size gate runs on the drop — before a single byte is parsed.
    const rawViolation = auditRawSize(rawBytes);
    if (rawViolation) {
      set(fail([rawViolation]));
      return;
    }

    try {
      const loaded = await pipeline.load(files, primary, format);
      if (my !== seq) {
        pipeline.dispose(loaded.root);
        return;
      }
      root = loaded.root;
      animations = loaded.animations;

      set({ phase: "inspecting", progress: 0.3 });
      const unit = suggestUnit(pipeline.rawExtent(root));
      let stats = pipeline.inspect(root, animations, UNIT_SCALE[unit]);
      const audit = auditModelStats(stats);
      if (audit.violations.length > 0) {
        releaseScene();
        set(fail(audit.violations));
        return;
      }

      let decimatedFromTris: number | null = null;
      if (audit.decimateTo !== null) {
        set({ phase: "decimating", progress: 0.45, stats, unit, unitSuggested: unit !== "m" });
        const d = await pipeline.decimate(root, audit.decimateTo);
        if (my !== seq) return;
        if ("violation" in d) {
          releaseScene();
          set(fail([d.violation]));
          return;
        }
        decimatedFromTris = d.before;
        stats = { ...stats, tris: d.tris };
      }

      set({ phase: "packing", progress: 0.6, stats, unit, unitSuggested: unit !== "m", warnings: audit.warnings, decimatedFromTris });
      const packed = await pack(root, stats, unit);
      if (my !== seq) return;
      if ("violation" in packed) {
        releaseScene();
        set(fail([packed.violation]));
        return;
      }
      glb = packed.blob;

      set({ progress: 0.9 });
      let thumbnailUrl: string | undefined;
      try {
        const blob = await pipeline.thumbnail(root);
        if (blob) {
          thumbBlob = blob;
          thumbnailUrl = URL.createObjectURL(blob);
        }
      } catch {
        /* the card shows a placeholder */
      }
      if (my !== seq) {
        revoke(thumbnailUrl);
        return;
      }

      // The UPLOAD HERE seed — retire the temp pin like a GPS-less photo's ingest does.
      const seed = useUploadStore.getState().pendingPlacement;
      if (seed) {
        useUploadStore.setState({ pendingPlacement: undefined });
        useCameraStore.getState().setTempPin(null);
      }
      set({
        phase: "review",
        progress: 1,
        glbBytes: packed.blob.size,
        textureEdge: packed.edge,
        thumbnailUrl,
        placement: seed,
        error: undefined,
        errorCode: undefined,
      });
    } catch (err) {
      if (my !== seq) return;
      releaseScene();
      const v = (err as { violation?: ModelViolation | null })?.violation ?? null;
      set(fail(v ? [v] : [], v ? undefined : `COULD NOT READ THIS MODEL — ${(err as Error)?.message ?? String(err)}`));
      if (!v) set({ errorCode: "LOAD_FAILED" });
    }
  },

  setTitle: (title) => set({ title }),

  setUnit: async (unit) => {
    const s = get();
    if (s.phase !== "review" || root === null || !s.stats) {
      set({ unit, unitSuggested: false });
      return;
    }
    const my = ++seq;
    const stats = pipeline.inspect(root, animations, UNIT_SCALE[unit]);
    set({ phase: "packing", progress: 0.6, unit, unitSuggested: false, stats: { ...s.stats, bbox: stats.bbox } });
    try {
      const packed = await pack(root, stats, unit);
      if (my !== seq) return;
      if ("violation" in packed) {
        releaseScene();
        set(fail([packed.violation]));
        return;
      }
      glb = packed.blob;
      set({ phase: "review", progress: 1, glbBytes: packed.blob.size, textureEdge: packed.edge });
    } catch (err) {
      if (my !== seq) return;
      releaseScene();
      set(fail([], `COULD NOT RE-PACK THIS MODEL — ${(err as Error)?.message ?? String(err)}`));
    }
  },

  upload: async () => {
    const s = get();
    if (s.phase !== "review" || !glb || !s.stats || !s.format) return;
    const my = seq;
    set({ phase: "uploading", error: undefined, errorCode: undefined });
    try {
      const media = await import("../lib/save/uploadMedia");
      const fileName = safeModelFileName(`${titleFromFileName(s.fileName)}.glb`) ?? "model.glb";
      const file = await media.uploadModelGlb(glb, fileName);
      if (my !== seq) return;
      // The card thumbnail rides along as a public image — best-effort: a model without one is
      // still a model (the MS6 list shows a placeholder).
      let thumbnailFileId: string | null = null;
      if (thumbBlob) {
        try {
          const thumb = await media.uploadPreview(thumbBlob, fileName.replace(/\.glb$/i, "-thumb.png"), "image/png");
          thumbnailFileId = thumb.fileId;
        } catch (e) {
          console.warn("[modelUpload] thumbnail upload failed — registering without one", e);
        }
        if (my !== seq) return;
      }
      const res = await media.postModelRecord({
        fileId: file.fileId,
        thumbnailFileId,
        title: s.title.trim() || titleFromFileName(s.fileName),
        fileName: s.fileName ?? null,
        sourceFormat: s.format,
        rawBytes: s.rawBytes ?? null,
        glbBytes: glb.size,
        tris: s.stats.tris,
        meshes: s.stats.meshes,
        textures: s.stats.textures,
        decimatedFromTris: s.decimatedFromTris,
        bbox: s.stats.bbox,
        lat: s.placement?.latDeg ?? null,
        lon: s.placement?.lonDeg ?? null,
      });
      if (my !== seq) return;
      set({
        phase: "stored",
        stored: { modelId: res.modelId, url: res.url, thumbnailUrl: res.thumbnailUrl ?? null, readiness: res.readiness },
      });
      // MS5: the row is MINE now — armable in FPV, and in the world at once when it was seeded
      // (the optimistic swap; the world read catches up past the read lag).
      useUserModelsStore.getState().addMine({
        id: res.modelId,
        title: s.title.trim() || titleFromFileName(s.fileName),
        url: res.url,
        thumbnailUrl: res.thumbnailUrl ?? null,
        fileName: s.fileName ?? null,
        sourceFormat: s.format,
        glbBytes: glb.size,
        tris: s.stats.tris,
        meshes: s.stats.meshes,
        textures: s.stats.textures,
        decimatedFromTris: s.decimatedFromTris,
        bbox: s.stats.bbox,
        readiness: res.readiness === "READY" || res.readiness === "FAILED" ? res.readiness : "PENDING",
        hidden: false,
        lat: s.placement?.latDeg ?? null,
        lon: s.placement?.lonDeg ?? null,
        rotDeg: 0,
        scale: 1,
        createdAt: null,
      });
    } catch (e) {
      if (my !== seq) return;
      const err = e as Error & { code?: string };
      // The packed model stays — the member can retry without re-dropping the file.
      set({ phase: "review", error: err.message || "upload failed", errorCode: err.code ?? "UPLOAD_FAILED" });
    }
  },

  clear: () => {
    seq++;
    releaseScene();
    revoke(get().thumbnailUrl);
    set({
      phase: "idle",
      progress: 0,
      fileName: undefined,
      format: undefined,
      rawBytes: undefined,
      title: "",
      stats: undefined,
      decimatedFromTris: null,
      glbBytes: undefined,
      textureEdge: undefined,
      thumbnailUrl: undefined,
      warnings: [],
      violations: [],
      error: undefined,
      errorCode: undefined,
      unit: "m",
      unitSuggested: false,
      placement: undefined,
      stored: undefined,
    });
  },
}));

/**
 * Pack at the member's unit, walking the texture-edge ladder until the GLB fits the byte cap.
 * An untextured model gains nothing from lower rungs — it is judged on the first.
 */
async function pack(
  scene: unknown,
  stats: ModelStats,
  unit: ModelUnit,
): Promise<{ blob: Blob; edge: number } | { violation: ModelViolation }> {
  pipeline.applyUnitScale(scene, UNIT_SCALE[unit]);
  const rungs = stats.textures > 0 ? TEXTURE_EDGE_LADDER.filter((e) => e <= MODEL_CAPS.maxTextureEdge) : [MODEL_CAPS.maxTextureEdge];
  let last: { bytes: number; edge: number } | null = null;
  for (const edge of rungs) {
    const buf = await pipeline.exportGlb(scene, edge);
    last = { bytes: buf.byteLength, edge };
    if (buf.byteLength <= MODEL_CAPS.maxGlbBytes) return { blob: new Blob([buf], { type: "model/gltf-binary" }), edge };
  }
  return { violation: auditGlbSize(last?.bytes ?? Infinity, last?.edge ?? rungs[rungs.length - 1]) as ModelViolation };
}

// DEV seam (mirrors store/upload.ts): the harness reads the phase/stats and drives upload().
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__modelUploadStore = useModelUploadStore;
}
