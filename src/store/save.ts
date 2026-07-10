import { create } from "zustand";

/**
 * Save-pin flow state (Phase 5) — drives the SAVE PIN section of PhotoDetailPanel.
 *
 * `savePin()` snapshots the upload store and walks the pipeline:
 *   original → Wix Media over TUS (progress; a failure DEGRADES to a warning — a 30 MB upload
 *   hiccup must not lose the pin) → preview JPEG derivative (downscale + PUT) → POST
 *   /api/photos (the quota + C6 gate lives server-side). Media/network modules are lazy
 *   imports so tests and the globe bundle stay clean of them.
 */

import { DEFAULT_PRECISION_TIER, type PrecisionTier } from "../lib/geo/precision";
import { buildSavePinBody, titleFromFileName } from "../lib/save/pinBody";
import { useUploadStore } from "./upload";

export type SavePhase =
  | "idle"
  | "uploading-original"
  | "uploading-preview"
  | "saving"
  | "saved"
  | "error";

export interface SaveState {
  phase: SavePhase;
  /** Original-upload progress 0..1 (TUS). */
  progress: number;
  /** Member-facing error line; errorCode mirrors the endpoint's error field. */
  error?: string;
  errorCode?: string;
  /** Non-fatal degradations (e.g. original upload failed, pin saved without it). */
  warning?: string;
  photoId?: string;
  publicPinId?: string | null;
  quotaUsed?: number;
  quotaLimit?: number;
  /** UI choices — C6: public defaults ON at REDUCED precision. */
  isPublic: boolean;
  precision: PrecisionTier;
  setIsPublic: (v: boolean) => void;
  setPrecision: (tier: PrecisionTier) => void;
  savePin: () => Promise<void>;
  /** Back to idle (new file / start over). */
  reset: () => void;
}

export const useSaveStore = create<SaveState>((set, get) => ({
  phase: "idle",
  progress: 0,
  isPublic: true,
  precision: DEFAULT_PRECISION_TIER,

  setIsPublic: (isPublic) => set({ isPublic }),
  setPrecision: (precision) => set({ precision }),

  savePin: async () => {
    const phase = get().phase;
    if (phase === "uploading-original" || phase === "uploading-preview" || phase === "saving") {
      return;
    }
    const u = useUploadStore.getState();
    if (!u.exif || !u.placement || u.phase !== "placed") {
      set({ phase: "error", error: "place the photo on the globe first", errorCode: "NOT_PLACED" });
      return;
    }
    const snapshot = {
      exif: u.exif,
      params: u.params,
      placement: u.placement,
      textureWidth: u.textureWidth,
      textureHeight: u.textureHeight,
      fileName: u.fileName,
      fileSizeBytes: u.fileSizeBytes,
    };
    const file = u.file;
    const previewSourceUrl = u.previewUrl;
    set({ phase: "uploading-original", progress: 0, error: undefined, errorCode: undefined, warning: undefined });

    try {
      const media = await import("../lib/save/uploadMedia");

      // 1) private original (TUS) — degrade to a warning on failure, never lose the pin
      let originalFileId: string | null = null;
      let warning: string | undefined;
      if (file) {
        try {
          const uploaded = await media.uploadOriginal(file, (f) => set({ progress: f }));
          originalFileId = uploaded.fileId;
        } catch (e) {
          console.warn("[save] original upload failed — saving pin without it", e);
          warning = "original upload failed — pin saved without the RAW";
        }
      } else {
        warning = "original file no longer available — pin saved without it";
      }

      // 2) public preview derivative (required for a public pin, optional for private)
      set({ phase: "uploading-preview", progress: 1 });
      let previewFileId: string | null = null;
      let previewUrl: string | null = null;
      if (previewSourceUrl) {
        try {
          const blob = await media.downscaleToJpeg(previewSourceUrl);
          const name = `${titleFromFileName(snapshot.fileName)}-preview.jpg`;
          const uploaded = await media.uploadPreview(blob, name);
          previewFileId = uploaded.fileId;
          previewUrl = uploaded.url;
        } catch (e) {
          if (get().isPublic) throw e; // a public pin without a preview is a broken pin
          console.warn("[save] preview upload failed on a private pin — continuing", e);
        }
      }

      // 3) the pin record — quota + C6 reduction enforced by the endpoint
      set({ phase: "saving" });
      const body = buildSavePinBody(snapshot, {
        isPublic: get().isPublic,
        precision: get().precision,
        originalFileId,
        previewFileId,
        previewUrl,
      });
      const res = await media.postPhotoRecord(body);
      set({
        phase: "saved",
        photoId: res.photoId,
        publicPinId: res.publicPinId,
        quotaUsed: res.quota?.used,
        quotaLimit: res.quota?.limit,
        warning,
      });
      if (res.publicPinId) {
        // The new public pin should appear on the globe right away.
        const { usePinsStore } = await import("./pins");
        usePinsStore.getState().refresh();
      }
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      set({
        phase: "error",
        error: err.message || "save failed",
        errorCode: err.code,
      });
    }
  },

  reset: () =>
    set({
      phase: "idle",
      progress: 0,
      error: undefined,
      errorCode: undefined,
      warning: undefined,
      photoId: undefined,
      publicPinId: undefined,
      quotaUsed: undefined,
      quotaLimit: undefined,
    }),
}));

// DEV convenience (mirrors store/upload.ts).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __saveStore: typeof useSaveStore }).__saveStore = useSaveStore;
}
