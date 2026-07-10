/**
 * Upload flow state — the zustand spine of the ingest path (ARCHITECTURE §7: `store/` = reactive EXIF
 * params). The EXIF baseline is immutable once ingested; `params` are the adjustable working values the
 * frustum will consume in Phase 3. Reset semantics per design board 04: double-click a slider (or
 * "RESET TO EXIF") returns a param to its EXIF baseline — or back to unset when the file never had it
 * (the D4 manual-entry fields).
 *
 * Pure helpers (`missingParamKeys`, `paramSource`, `isDirty`, `exifBaselineParams`) are exported for
 * unit tests and for render-time derivation — they never touch the store.
 */

import { create } from "zustand";
import { extractMetadata, type ExtractedPhoto, type PhotoExif, type PreviewSource } from "../lib/decode/extract";

export type UploadPhase = "idle" | "decoding" | "review";

/** The EXIF-seeded values the user can adjust before placing (Phase 3 wires these into the frustum). */
export interface AdjustableParams {
  focalLengthMm?: number;
  headingDeg?: number;
  pitchDeg?: number;
  altitudeM?: number;
}

export type AdjustableKey = keyof AdjustableParams;

/** D4 nudge order — the fields worth flagging when EXIF is thin (focal falls back via the sensor DB). */
const D4_KEYS: readonly AdjustableKey[] = ["headingDeg", "pitchDeg", "altitudeM"];

export function exifBaselineParams(exif: PhotoExif): AdjustableParams {
  return {
    focalLengthMm: exif.focalLengthMm,
    headingDeg: exif.headingDeg,
    pitchDeg: exif.pitchDeg,
    altitudeM: exif.gpsAltitudeM,
  };
}

/** The D4 fields absent from the file's EXIF — the UI must visibly invite manual entry for these. */
export function missingParamKeys(exif: PhotoExif): AdjustableKey[] {
  const baseline = exifBaselineParams(exif);
  return D4_KEYS.filter((k) => baseline[k] === undefined);
}

export type ParamSource = "exif" | "manual" | "missing";

/** Provenance of the current value of one param — drives the EXIF / MANUAL / MISSING badges. */
export function paramSource(exif: PhotoExif, params: AdjustableParams, key: AdjustableKey): ParamSource {
  const baseline = exifBaselineParams(exif)[key];
  const current = params[key];
  if (current === undefined) return baseline === undefined ? "missing" : "exif";
  if (baseline !== undefined && current === baseline) return "exif";
  return "manual";
}

/** True when any param departs from the EXIF baseline — lights the changed dot + "RESET TO EXIF". */
export function isDirty(exif: PhotoExif, params: AdjustableParams): boolean {
  const keys: AdjustableKey[] = ["focalLengthMm", ...D4_KEYS];
  return keys.some((k) => paramSource(exif, params, k) === "manual");
}

interface UploadStore {
  /** Panel visibility — toggled by the nav "Upload" link / Escape. */
  open: boolean;
  phase: UploadPhase;
  fileName?: string;
  fileSizeBytes?: number;
  previewUrl?: string;
  previewSource: PreviewSource;
  /** 0..1 — trickles toward the latest REAL worker stage target (see loadFile). */
  decodeProgress: number;
  /** Wall-clock decode duration, ms. */
  decodeMs?: number;
  /** Immutable EXIF baseline; undefined until a file is ingested. */
  exif?: PhotoExif;
  params: AdjustableParams;
  /** Set when the file could not be ingested at all (back on the dropzone). */
  loadError?: string;
  /** Set when metadata arrived but the full WASM decode failed (review still shows). */
  decodeError?: string;

  openPanel(): void;
  closePanel(): void;
  /** Browser path: real extract pipeline with worker progress. Unit tests drive `ingest` directly. */
  loadFile(file: File): Promise<void>;
  ingest(extracted: ExtractedPhoto, decodeMs?: number): void;
  setParam(key: AdjustableKey, value: number): void;
  resetParam(key: AdjustableKey): void;
  resetAll(): void;
  /** Back to the empty dropzone (revokes the preview object URL). */
  clear(): void;
}

function revokePreview(url?: string): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

/** Module-level so a second loadFile cancels the previous decode + trickle. */
let trickleTimer: ReturnType<typeof setInterval> | undefined;
let activeAbort: AbortController | undefined;
let loadSeq = 0;

export const useUploadStore = create<UploadStore>((set, get) => ({
  open: false,
  phase: "idle",
  previewSource: "none",
  decodeProgress: 0,
  params: {},

  openPanel: () => set({ open: true }),

  closePanel: () => set({ open: false }),

  loadFile: async (file: File) => {
    const seq = ++loadSeq;
    activeAbort?.abort();
    const abort = (activeAbort = new AbortController());
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl);
    set({
      phase: "decoding",
      fileName: file.name,
      fileSizeBytes: file.size,
      previewUrl: undefined,
      previewSource: "none",
      decodeProgress: 0,
      decodeMs: undefined,
      exif: undefined,
      params: {},
      loadError: undefined,
      decodeError: undefined,
    });

    // The worker reports REAL stage boundaries (wasm-load / unpack / demosaic / encode) but no
    // intra-stage percentages — so the bar eases toward the latest stage target instead of jumping.
    let target = 0.08;
    trickleTimer = setInterval(() => {
      if (seq !== loadSeq) return;
      const p = get().decodeProgress;
      if (p < target) set({ decodeProgress: Math.min(target, p + Math.max(0.003, (target - p) * 0.09)) });
    }, 80);

    const started = performance.now();
    try {
      const extracted = await extractMetadata(file, {
        signal: abort.signal,
        onProgress: (t) => {
          if (seq === loadSeq) target = Math.max(target, t);
        },
        onPreview: (url, source) => {
          if (seq !== loadSeq) return;
          const previous = get().previewUrl;
          if (previous && previous !== url) revokePreview(previous);
          set({ previewUrl: url, previewSource: source });
        },
      });
      if (seq !== loadSeq || abort.signal.aborted) return;
      clearInterval(trickleTimer);
      const previous = get().previewUrl;
      if (previous && previous !== extracted.previewUrl) revokePreview(previous);
      get().ingest(extracted, Math.round(performance.now() - started));
    } catch (err) {
      if (seq !== loadSeq || abort.signal.aborted) return;
      clearInterval(trickleTimer);
      set({
        phase: "idle",
        decodeProgress: 0,
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  ingest: (extracted, decodeMs) =>
    set({
      phase: "review",
      fileName: extracted.fileName,
      fileSizeBytes: extracted.fileSizeBytes,
      previewUrl: extracted.previewUrl,
      previewSource: extracted.previewSource,
      decodeProgress: 1,
      decodeMs,
      exif: extracted.exif,
      params: exifBaselineParams(extracted.exif),
      loadError: undefined,
      decodeError: extracted.decodeError,
    }),

  setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),

  resetParam: (key) =>
    set((s) => {
      const baseline = s.exif ? exifBaselineParams(s.exif)[key] : undefined;
      return { params: { ...s.params, [key]: baseline } };
    }),

  resetAll: () => set((s) => ({ params: s.exif ? exifBaselineParams(s.exif) : {} })),

  clear: () => {
    loadSeq++;
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl);
    set({
      phase: "idle",
      fileName: undefined,
      fileSizeBytes: undefined,
      previewUrl: undefined,
      previewSource: "none",
      decodeProgress: 0,
      decodeMs: undefined,
      exif: undefined,
      params: {},
      loadError: undefined,
      decodeError: undefined,
    });
  },
}));
