import { create } from "zustand";

/**
 * Save-facade flow state (F2, owner order 2026-10-21 — T169) — drives the SAVE section of the
 * facade detail panel. The `store/save` twin: same phase vocabulary, the same busy guard, the same
 * `toApiError` normalisation, so a harness that knows one knows both.
 *
 * `saveFacade()` snapshots the facade store and walks the pipeline:
 *   original → Wix Media over TUS (progress; a failure DEGRADES to a warning — a 30 MB hiccup must
 *   not lose the pose) → the two derivatives off the decoded preview (the 2048-px DISPLAY JPEG,
 *   REQUIRED: it is what every slot projects; the 512-px THUMB, a marker fallback — degrades)
 *   → POST /api/facades (the C6 posture lives server-side: private row, exact pose, own-only read).
 * Media/network modules are lazy imports so tests and the globe bundle stay clean of them; the
 * residency store (`./facades`) is lazy for the same reason as in `store/facadePhoto`.
 *
 * THE APEX GATE (`NOT_SEATED`): the record stores the RENDERED apex height (`facadeRecords.ts` —
 * THE APEX HEIGHT), which only the globe knows. The facade store receives it through `_syncApex`
 * a frame or more after the placement; until then a SAVE is refused rather than persisting a
 * number the owner never saw.
 */

import { buildSaveFacadeBody, buildUpdateFacadeBody, type FacadeSnapshot } from "../lib/save/facadeBody";
import { titleFromFileName } from "../lib/save/pinBody";
import { useFacadePhotoStore, type FacadePhotoStore } from "./facadePhoto";

export type FacadeSavePhase =
  | "idle"
  | "uploading-original"
  | "deriving"
  | "uploading-display"
  | "uploading-thumb"
  | "saving"
  | "saved"
  | "updating"
  | "updated"
  | "deleting"
  | "error";

export interface FacadeSaveState {
  phase: FacadeSavePhase;
  /** Original-upload progress 0..1 (TUS). */
  progress: number;
  /** Member-facing error line; errorCode mirrors the endpoint's error field. */
  error?: string;
  errorCode?: string;
  /** Non-fatal degradations (the original or the thumb failed to upload — the pose is saved). */
  warning?: string;
  /** The row the last SAVE / UPDATE landed on. */
  facadeId?: string;
  /** Custom title; null = default to the file-name title (the pin flow's S3 idiom). */
  title: string | null;
  setTitle: (title: string | null) => void;
  saveFacade: () => Promise<void>;
  /** PATCH the row this placed photo IS (`savedFacadeId`) with the current pose + projection. No media re-upload. */
  updateFacade: () => Promise<void>;
  /** DELETE that row: record + media server-side, then the residency forgets it and the placed state clears. */
  deleteFacade: () => Promise<void>;
  /** Back to idle (new file / start over). Keeps the title — the panel re-seeds it per identity. */
  reset: () => void;
}

/** Any in-flight write phase — starting another operation while one runs is refused (the B15 invariant). */
const BUSY_PHASES: readonly FacadeSavePhase[] = [
  "uploading-original",
  "deriving",
  "uploading-display",
  "uploading-thumb",
  "saving",
  "updating",
  "deleting",
];
export const isFacadeSaveBusy = (phase: FacadeSavePhase): boolean => BUSY_PHASES.includes(phase);

/** Normalize a thrown API error into `{ error, errorCode }` (B15). The fetch wrappers in
 *  lib/save/uploadMedia attach `.code` from the endpoint's error field. */
function toApiError(e: unknown, fallback: string): { error: string; errorCode?: string } {
  const err = e as Error & { code?: string };
  return { error: err.message || fallback, errorCode: err.code };
}

/** The lazy residency hook-up — guarded: a missing module must never turn a landed save into an error. */
async function withResidency(fn: (s: Awaited<typeof import("./facades")>["useFacadesStore"]) => void): Promise<void> {
  try {
    const m = await import("./facades");
    fn(m.useFacadesStore);
  } catch {
    // no residency on this shell (or under test) — the save itself already landed
  }
}

/** The placed facade store as a save snapshot, or null when there is nothing placed to save. */
function snapshotOf(f: FacadePhotoStore, apexAltM: number, title: string | null): FacadeSnapshot | null {
  if (f.phase !== "placed" || !f.exif || !f.placement) return null;
  return {
    exif: f.exif,
    params: f.params,
    placement: f.placement,
    rollDeg: f.rollDeg,
    hFovDeg: f.hFovDeg,
    projection: { strength: f.projection.strength, ownLight: f.projection.ownLight, rangeM: f.projection.rangeM },
    textureWidth: f.textureWidth,
    textureHeight: f.textureHeight,
    fileName: f.fileName,
    fileSizeBytes: f.fileSizeBytes,
    apexAltM,
    exifPose: f.exifPose ?? null,
    title,
  };
}

const NOT_PLACED = { phase: "error" as const, error: "place the photo on the globe first", errorCode: "NOT_PLACED" };
const NOT_SEATED = { phase: "error" as const, error: "the globe has not seated the photo yet", errorCode: "NOT_SEATED" };
const NOT_SAVED = { phase: "error" as const, error: "no saved facade photo in view", errorCode: "NOT_SAVED" };

export const useFacadeSaveStore = create<FacadeSaveState>((set, get) => ({
  phase: "idle",
  progress: 0,
  title: null,

  setTitle: (title) => set({ title }),

  saveFacade: async () => {
    if (isFacadeSaveBusy(get().phase)) return;
    const f = useFacadePhotoStore.getState();
    if (f.phase !== "placed" || !f.exif || !f.placement || !f.previewUrl) {
      set(NOT_PLACED);
      return;
    }
    if (f.apexAltM === undefined) {
      set(NOT_SEATED);
      return;
    }
    const customTitle = get().title?.trim() || null;
    const snapshot = snapshotOf(f, f.apexAltM, customTitle);
    if (!snapshot) {
      set(NOT_PLACED);
      return;
    }
    const file = f.file;
    const previewSourceUrl = f.previewUrl;
    const stem = customTitle ?? titleFromFileName(f.fileName);
    set({ phase: "uploading-original", progress: 0, error: undefined, errorCode: undefined, warning: undefined, facadeId: undefined });

    try {
      const media = await import("../lib/save/uploadMedia");
      const warnings: string[] = [];

      // 1) the private original (TUS) — degrade to a warning on failure, never lose the pose.
      //    A re-opened record has no File any more (SAVE is not offered there, but be exact).
      let originalFileId: string | null = null;
      if (file) {
        try {
          const uploaded = await media.uploadOriginal(file, (p) => set({ progress: p }));
          originalFileId = uploaded.fileId;
        } catch (e) {
          console.warn("[facadeSave] original upload failed — saving the facade without it", e);
          warnings.push("original upload failed — saved without the original");
        }
      } else {
        warnings.push("original file no longer available — saved without it");
      }

      // 2) the derivatives off the decoded preview — the DISPLAY copy is REQUIRED (a slot
      //    projects it), so a failure here or on its upload IS the error.
      set({ phase: "deriving", progress: 1 });
      const { display, thumb } = await media.makeFacadeDerivatives(previewSourceUrl);
      set({ phase: "uploading-display" });
      const displayFile = await media.uploadFacadeImage(display, `${stem}-display.jpg`);
      const displayFileId = displayFile.fileId;
      if (!displayFileId) throw new Error("the display copy's upload returned no file id");

      // 3) the thumb — a marker fallback only (the markers fall back to the display) → degrades.
      set({ phase: "uploading-thumb" });
      let thumbFileId: string | null = null;
      try {
        thumbFileId = (await media.uploadFacadeImage(thumb, `${stem}-thumb.jpg`)).fileId;
      } catch (e) {
        console.warn("[facadeSave] thumb upload failed — the markers fall back to the display", e);
        warnings.push("thumb upload failed — markers use the display copy");
      }

      // 4) the record — the private row; the server copies the URLs off the verified descriptors.
      set({ phase: "saving" });
      const res = await media.postFacadeRecord(
        buildSaveFacadeBody(snapshot, { originalFileId, displayFileId, thumbFileId }),
      );
      set({ phase: "saved", facadeId: res.facadeId, warning: warnings.length ? warnings.join(" · ") : undefined });
      useFacadePhotoStore.getState()._markSaved(res.facadeId); // SAVE becomes UPDATE from here on
      await withResidency((facades) => {
        const s = facades.getState();
        s.upsertMine(res.facade);
        s.setEditing(res.facadeId); // the draft IS this row now — hidden from residency while open
      });
    } catch (e) {
      set({ phase: "error", ...toApiError(e, "save failed") });
    }
  },

  updateFacade: async () => {
    if (isFacadeSaveBusy(get().phase)) return;
    const f = useFacadePhotoStore.getState();
    if (!f.savedFacadeId) {
      set(NOT_SAVED);
      return;
    }
    // A re-opened row has not been re-seated by the globe until its first frame; its synthesized
    // EXIF altitude IS the stored apex (`openSaved`), so it is the exact fallback — never a guess.
    const apexAltM = f.apexAltM ?? f.exif?.gpsAltitudeM;
    if (apexAltM === undefined) {
      set(NOT_SEATED);
      return;
    }
    const snapshot = snapshotOf(f, apexAltM, get().title?.trim() || null);
    if (!snapshot) {
      set(NOT_PLACED);
      return;
    }
    const facadeId = f.savedFacadeId;
    set({ phase: "updating", error: undefined, errorCode: undefined, warning: undefined });
    try {
      const media = await import("../lib/save/uploadMedia");
      const res = await media.patchFacadeRecord(buildUpdateFacadeBody(snapshot, facadeId));
      set({ phase: "updated", facadeId: res.facadeId });
      await withResidency((facades) => facades.getState().upsertMine(res.facade));
    } catch (e) {
      set({ phase: "error", ...toApiError(e, "update failed") });
    }
  },

  deleteFacade: async () => {
    if (isFacadeSaveBusy(get().phase)) return;
    const f = useFacadePhotoStore.getState();
    if (!f.savedFacadeId) {
      set(NOT_SAVED);
      return;
    }
    const facadeId = f.savedFacadeId;
    set({ phase: "deleting", error: undefined, errorCode: undefined, warning: undefined });
    try {
      const media = await import("../lib/save/uploadMedia");
      await media.deleteFacadeRecord(facadeId);
      await withResidency((facades) => facades.getState().removeMine(facadeId));
      useFacadePhotoStore.getState().clear(); // the placed photo no longer exists
      set({ phase: "idle", facadeId: undefined });
    } catch (e) {
      set({ phase: "error", ...toApiError(e, "delete failed") });
    }
  },

  reset: () =>
    set({
      phase: "idle",
      progress: 0,
      error: undefined,
      errorCode: undefined,
      warning: undefined,
      facadeId: undefined,
    }),
}));

// DEV convenience (mirrors store/save.ts) — the harness drives SAVE / UPDATE / DELETE through it.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  window.__facadeSaveStore = useFacadeSaveStore;
}
