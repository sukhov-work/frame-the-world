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
import { computeHorizontalFov, type FovResult } from "../lib/decode/sensors";

/**
 * idle → decoding → review → placed (GPS present)
 *                          ↘ placing (no GPS: "SET ON GLOBE" → user clicks the globe) → placed
 */
export type UploadPhase = "idle" | "decoding" | "review" | "placing" | "placed";

/** Capture location driving the frustum — GPS-seeded at ingest, or set by clicking the globe. */
export interface Placement {
  latDeg: number;
  lonDeg: number;
}

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

/** A saved pin re-opened as the camera view (globe pin click / My-pins click, Phase 5.1).
 *  Carries whatever the record kept — missing pose fields fall back to the D4 manual path. */
export interface SavedPinView {
  pinId: string;
  title: string;
  lat: number;
  lon: number;
  previewUrl: string | null;
  capturedAt: string | null;
  altitudeM?: number | null;
  headingDeg?: number | null;
  pitchDeg?: number | null;
  rollDeg?: number | null;
  focalLengthMm?: number | null;
  hFovDeg?: number | null;
  textureWidth?: number | null;
  textureHeight?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
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

/**
 * The live H-FOV for the CURRENT params — the ONE derivation both the review readout and the
 * rendered frustum use (they must never disagree). The focal35 shortcut only holds while focal is
 * untouched from EXIF; a manual focal recomputes via the Make/Model sensor lookup (D4).
 */
export function derivedFov(exif: PhotoExif, params: AdjustableParams): FovResult {
  const focalUntouched = params.focalLengthMm === exif.focalLengthMm;
  return computeHorizontalFov({
    focalLengthMm: params.focalLengthMm,
    focalLengthIn35mmMm: focalUntouched ? exif.focalLengthIn35mmMm : undefined,
    make: exif.make,
    model: exif.model,
  });
}

interface UploadStore {
  /** Panel visibility — toggled by the nav "Upload" link / Escape. */
  open: boolean;
  phase: UploadPhase;
  fileName?: string;
  fileSizeBytes?: number;
  /** The original File handle (Phase 5: uploaded as the private original on SAVE PIN — decode
   *  never retained it, so the save flow needs it kept here). Cleared with the flow. */
  file?: File;
  previewUrl?: string;
  previewSource: PreviewSource;
  /** 0..1 — trickles toward the latest REAL worker stage target (see loadFile). */
  decodeProgress: number;
  /** Wall-clock decode duration, ms. */
  decodeMs?: number;
  /** Immutable EXIF baseline; undefined until a file is ingested. */
  exif?: PhotoExif;
  params: AdjustableParams;
  /** Capture location (GPS-seeded at ingest; manual via `setPlacement`). Position is NOT a slider
   *  param — it changes via EXIF or the click-to-place path only. */
  placement?: Placement;
  /** Pixel dimensions of the decoded display texture — the frustum's aspect ratio source. */
  textureWidth?: number;
  textureHeight?: number;
  /** Placed image-plane opacity override (0..1). Undefined = the FRUSTUM.planeOpacity default
   *  (~30% transparent) — a VIEW preference for superimposing the photo on the landscape while
   *  tuning, not an EXIF param (no provenance badge). */
  planeOpacity?: number;
  /** Set when the file could not be ingested at all (back on the dropzone). */
  loadError?: string;
  /** Set when metadata arrived but the full WASM decode failed (review still shows). */
  decodeError?: string;
  /** Set when the placed state is a RE-OPENED saved pin (globe/My-pins click) — the panel
   *  hides SAVE PIN (re-saving would duplicate) and no original File exists. */
  viewingPinId?: string;
  /** How the globe camera relates to the placed photo (Phase 5.5 S2): 'orbit' = the default
   *  free camera framing the frustum from behind; 'fpv' = photographer mode — the camera sits
   *  EXACTLY at the frustum apex with the photo's pose (drag = look around, wheel = FOV zoom).
   *  Only meaningful while placed; every phase change resets it to 'orbit'. */
  viewMode: "orbit" | "fpv";

  openPanel(): void;
  closePanel(): void;
  /** Browser path: real extract pipeline with worker progress. Unit tests drive `ingest` directly. */
  loadFile(file: File): Promise<void>;
  ingest(extracted: ExtractedPhoto, decodeMs?: number): void;
  setParam(key: AdjustableKey, value: number): void;
  resetParam(key: AdjustableKey): void;
  resetAll(): void;
  /** Preview plane opacity (0..1); undefined returns to the tuning default. */
  setPlaneOpacity(opacity: number | undefined): void;
  /** PLACE ON GLOBE: review → placed when a location exists; review → placing (awaiting a globe
   *  click) when the file has no GPS. Closes the overlay either way — the globe takes over. */
  place(): void;
  /** Click-to-place result (the globe's pointer ray → ellipsoid). Completes the placing path. */
  setPlacement(latDeg: number, lonDeg: number): void;
  /** Reopen the review overlay from the globe (placed/placing). */
  backToReview(): void;
  /** Open a SAVED pin as the placed camera view (frustum + detail panel + flight) —
   *  synthesizes the EXIF baseline from the stored record. */
  openSavedPin(view: SavedPinView): void;
  /** Enter/exit FPV photographer mode (no-op entering fpv unless a photo is placed). */
  setViewMode(mode: "orbit" | "fpv"): void;
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
  viewMode: "orbit",

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
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      loadError: undefined,
      decodeError: undefined,
      viewingPinId: undefined,
      viewMode: "orbit",
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
      placement:
        extracted.exif.gpsLat !== undefined && extracted.exif.gpsLon !== undefined
          ? { latDeg: extracted.exif.gpsLat, lonDeg: extracted.exif.gpsLon }
          : undefined,
      textureWidth: extracted.textureWidth ?? extracted.exif.width,
      textureHeight: extracted.textureHeight ?? extracted.exif.height,
      loadError: undefined,
      decodeError: extracted.decodeError,
      viewingPinId: undefined,
      viewMode: "orbit",
    }),

  setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),

  resetParam: (key) =>
    set((s) => {
      const baseline = s.exif ? exifBaselineParams(s.exif)[key] : undefined;
      return { params: { ...s.params, [key]: baseline } };
    }),

  resetAll: () => set((s) => ({ params: s.exif ? exifBaselineParams(s.exif) : {} })),

  setPlaneOpacity: (planeOpacity) => set({ planeOpacity }),

  place: () =>
    set((s) => {
      if (s.phase !== "review" && s.phase !== "placed") return {};
      if (!s.placement) return { phase: "placing", open: false, viewMode: "orbit" }; // SET ON GLOBE — await a globe click
      return { phase: "placed", open: false, viewMode: "orbit" };
    }),

  setPlacement: (latDeg, lonDeg) =>
    set((s) =>
      s.exif ? { placement: { latDeg, lonDeg }, phase: "placed" as const, open: false } : {},
    ),

  backToReview: () =>
    set((s) =>
      s.phase === "placed" || s.phase === "placing"
        ? { phase: "review" as const, open: true, viewMode: "orbit" as const }
        : {},
    ),

  setViewMode: (mode) =>
    set((s) => (mode === "fpv" && s.phase !== "placed" ? {} : { viewMode: mode })),

  openSavedPin: (view) => {
    loadSeq++; // supersede any in-flight decode
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl); // remote wixstatic URLs are not blob: — revoke is a no-op there
    // Reproduce the stored H-FOV exactly through the focal35 shortcut in derivedFov:
    // hFov = 2·atan(36 / (2·f35))  ⇒  f35 = 18 / tan(hFov/2).
    const focal35 =
      view.hFovDeg != null && view.hFovDeg > 0 && view.hFovDeg < 180
        ? 18 / Math.tan(((view.hFovDeg * Math.PI) / 180) / 2)
        : undefined;
    const exif: PhotoExif = {
      make: view.cameraMake ?? undefined,
      model: view.cameraModel ?? undefined,
      lensModel: view.lensModel ?? undefined,
      focalLengthMm: view.focalLengthMm ?? undefined,
      focalLengthIn35mmMm: focal35,
      capturedAt: view.capturedAt ?? undefined,
      width: view.textureWidth ?? undefined,
      height: view.textureHeight ?? undefined,
      gpsLat: view.lat,
      gpsLon: view.lon,
      gpsAltitudeM: view.altitudeM ?? undefined,
      headingDeg: view.headingDeg ?? undefined,
      pitchDeg: view.pitchDeg ?? undefined,
      rollDeg: view.rollDeg ?? undefined,
    };
    set({
      open: false,
      phase: "placed",
      fileName: view.title,
      fileSizeBytes: undefined,
      file: undefined,
      previewUrl: view.previewUrl ?? undefined,
      previewSource: view.previewUrl ? "decoded" : "none",
      decodeProgress: 1,
      decodeMs: undefined,
      exif,
      params: exifBaselineParams(exif),
      placement: { latDeg: view.lat, lonDeg: view.lon },
      textureWidth: view.textureWidth ?? undefined,
      textureHeight: view.textureHeight ?? undefined,
      planeOpacity: undefined,
      loadError: undefined,
      decodeError: undefined,
      viewingPinId: view.pinId,
      viewMode: "orbit",
    });
  },

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
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      planeOpacity: undefined,
      loadError: undefined,
      decodeError: undefined,
      viewingPinId: undefined,
      viewMode: "orbit",
    });
  },
}));

// Dev-only introspection (mirrors window.__globe) so browser verification can drive the store
// without reaching through the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __uploadStore: typeof useUploadStore }).__uploadStore = useUploadStore;
}
