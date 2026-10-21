/**
 * Facade-photo state (the photo flow (b) PROTOTYPE) — the TECHNICAL-photo twin of `store/upload`.
 * A street photo of a facade is decoded through the same pipeline and placed as a camera pose,
 * and the globe projects it onto the 3D buildings. Technical photos texture buildings: they are
 * never pins, never saved, never published, so C6 holds by construction (nothing leaves the
 * browser). Field names match the upload store so one frustum-source type fits both.
 *
 * SEPARATE on purpose (owner rule: zero regression to the upload/pin flow): its own module-level
 * decode machinery, no temp-pin / pendingPlacement side effect, no `store/camera` import.
 */

import { create } from "zustand";
import { extractMetadata, type ExtractedPhoto, type PhotoExif, type PreviewSource } from "../lib/decode/extract";
import { exifBaselineParams, type AdjustableKey, type AdjustableParams, type Placement } from "../lib/decode/params";

/**
 * idle → decoding → review → placed (GPS present)
 *                          ↘ placing (no GPS: "SET ON GLOBE" → the user clicks the globe) → placed
 */
export type FacadePhase = "idle" | "decoding" | "review" | "placing" | "placed";

export interface FacadeProjection {
  /** The projection onto the buildings (the frustum + plane stay visible either way). */
  enabled: boolean;
  /** 0..1 — how much of the facade's albedo the photo replaces inside its footprint. */
  strength: number;
  /** 0..1 — 0 = the photo is lit by the scene (sun/shadow/night); 1 = it shows its own colours. */
  ownLight: number;
}

export interface FacadePhotoStore {
  open: boolean;
  phase: FacadePhase;
  fileName?: string;
  fileSizeBytes?: number;
  file?: File;
  previewUrl?: string;
  previewSource: PreviewSource;
  decodeProgress: number;
  decodeMs?: number;
  exif?: PhotoExif;
  /** focalLengthMm / headingDeg / pitchDeg / altitudeM — the shared layer, EXIF-seeded. */
  params: AdjustableParams;
  /** The roll nudge (degrees, EXIF clockwise). undefined = the EXIF roll (exif.rollDeg) or 0. Not part of AdjustableParams on purpose. */
  rollDeg?: number;
  placement?: Placement;
  textureWidth?: number;
  textureHeight?: number;
  /** Placed image-plane opacity override (0..1); undefined = the FRUSTUM.planeOpacity default. */
  planeOpacity?: number;
  projection: FacadeProjection;
  loadError?: string;
  decodeError?: string;
  openPanel(): void;
  closePanel(): void;
  loadFile(file: File): Promise<void>;
  /** GPS → placement; no pendingPlacement / temp-pin side effect. */
  ingest(extracted: ExtractedPhoto, decodeMs?: number): void;
  setParam(key: AdjustableKey, value: number): void;
  resetParam(key: AdjustableKey): void;
  /** Params back to the EXIF baseline AND rollDeg back to undefined. */
  resetAll(): void;
  setRollDeg(deg: number | undefined): void;
  setPlaneOpacity(opacity: number | undefined): void;
  /** Merges; strength/ownLight clamp to [0,1]. */
  setProjection(patch: Partial<FacadeProjection>): void;
  /** review|placed → placed (has placement) | placing (no placement); closes the overlay. */
  place(): void;
  /** The globe's click-to-place → placed (only when exif exists). */
  setPlacement(latDeg: number, lonDeg: number): void;
  /** Move the placement by metres (north+, east+) — the registration nudge. 1° lat = 111_320 m; lon scaled by cos(lat). No-op without a placement. */
  nudgePlacement(northM: number, eastM: number): void;
  /** placed|placing → review (open). */
  backToReview(): void;
  /** placing → review (open). */
  cancelPlacing(): void;
  /** Back to idle; revokes blob previews; aborts an in-flight decode. */
  clear(): void;
}

const DEFAULT_PROJECTION: FacadeProjection = { enabled: true, strength: 1, ownLight: 0.6 };
const METRES_PER_DEG_LAT = 111_320;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function revokePreview(url?: string): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

/** Module-level and PRIVATE to this store — never shared with store/upload's decode. */
let trickleTimer: ReturnType<typeof setInterval> | undefined;
let activeAbort: AbortController | undefined;
let loadSeq = 0;

export const useFacadePhotoStore = create<FacadePhotoStore>((set, get) => ({
  open: false,
  phase: "idle",
  previewSource: "none",
  decodeProgress: 0,
  params: {},
  projection: { ...DEFAULT_PROJECTION },

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
      file,
      previewUrl: undefined,
      previewSource: "none",
      decodeProgress: 0,
      decodeMs: undefined,
      exif: undefined,
      params: {},
      rollDeg: undefined,
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      loadError: undefined,
      decodeError: undefined,
    });

    // Same easing as store/upload: the worker reports real stage boundaries, the bar eases.
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
      // Recover onto the dropzone with the reason — never a blank overlay.
      if (seq !== loadSeq || abort.signal.aborted) return;
      clearInterval(trickleTimer);
      set({
        phase: "idle",
        decodeProgress: 0,
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  ingest: (extracted, decodeMs) => {
    const gps =
      extracted.exif.gpsLat !== undefined && extracted.exif.gpsLon !== undefined
        ? { latDeg: extracted.exif.gpsLat, lonDeg: extracted.exif.gpsLon }
        : undefined;
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
      rollDeg: undefined,
      placement: gps,
      textureWidth: extracted.textureWidth ?? extracted.exif.width,
      textureHeight: extracted.textureHeight ?? extracted.exif.height,
      loadError: undefined,
      decodeError: extracted.decodeError,
    });
  },

  setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),

  resetParam: (key) =>
    set((s) => {
      const baseline = s.exif ? exifBaselineParams(s.exif)[key] : undefined;
      return { params: { ...s.params, [key]: baseline } };
    }),

  resetAll: () => set((s) => ({ params: s.exif ? exifBaselineParams(s.exif) : {}, rollDeg: undefined })),

  setRollDeg: (rollDeg) => set({ rollDeg }),

  setPlaneOpacity: (planeOpacity) => set({ planeOpacity }),

  setProjection: (patch) =>
    set((s) => {
      const next: FacadeProjection = { ...s.projection, ...patch };
      next.strength = clamp01(next.strength);
      next.ownLight = clamp01(next.ownLight);
      return { projection: next };
    }),

  place: () =>
    set((s) => {
      if (s.phase !== "review" && s.phase !== "placed") return {};
      if (!s.placement) return { phase: "placing" as const, open: false };
      return { phase: "placed" as const, open: false };
    }),

  setPlacement: (latDeg, lonDeg) =>
    set((s) => (s.exif ? { placement: { latDeg, lonDeg }, phase: "placed" as const, open: false } : {})),

  nudgePlacement: (northM, eastM) =>
    set((s) => {
      const p = s.placement;
      if (!p) return {};
      const cosLat = Math.cos((p.latDeg * Math.PI) / 180);
      const dLon = Math.abs(cosLat) > 1e-9 ? eastM / (METRES_PER_DEG_LAT * cosLat) : 0;
      return {
        placement: { latDeg: p.latDeg + northM / METRES_PER_DEG_LAT, lonDeg: p.lonDeg + dLon },
      };
    }),

  backToReview: () =>
    set((s) => (s.phase === "placed" || s.phase === "placing" ? { phase: "review" as const, open: true } : {})),

  cancelPlacing: () => set((s) => (s.phase === "placing" ? { phase: "review" as const, open: true } : {})),

  clear: () => {
    loadSeq++;
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl);
    set({
      phase: "idle",
      fileName: undefined,
      fileSizeBytes: undefined,
      file: undefined,
      previewUrl: undefined,
      previewSource: "none",
      decodeProgress: 0,
      decodeMs: undefined,
      exif: undefined,
      params: {},
      rollDeg: undefined,
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      planeOpacity: undefined,
      projection: { ...DEFAULT_PROJECTION },
      loadError: undefined,
      decodeError: undefined,
    });
  },
}));

// Dev-only introspection (the window.__uploadStore twin) so browser verification can drive the
// store without the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__facadeStore = useFacadePhotoStore;
}
