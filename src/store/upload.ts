/**
 * Upload flow state — the zustand spine of the ingest path (ARCHITECTURE §7: `store/` = reactive EXIF
 * params). The EXIF baseline is immutable once ingested; `params` are the adjustable working values the
 * frustum will consume in Phase 3. Reset semantics per design board 04: double-click a slider (or
 * "RESET TO EXIF") returns a param to its EXIF baseline — or back to unset when the file never had it
 * (the D4 manual-entry fields).
 *
 * The pure param helpers (`exifBaselineParams`, `missingParamKeys`, `paramSource`, `isDirty`,
 * `derivedFov`) live in `lib/decode/params` (B8) and are re-exported here for back-compat.
 */

import { create } from "zustand";
import { extractMetadata, type ExtractedPhoto, type PhotoExif, type PreviewSource } from "../lib/decode/extract";
import { focalFromHorizontalFov } from "../lib/decode/sensors";
import { exifBaselineParams, type AdjustableKey, type AdjustableParams, type Placement } from "../lib/decode/params";
import type { CameraPoseOptics } from "../lib/pins/fields";
import type { PinListing } from "../lib/market/listing";
import { useCameraStore } from "./camera";

// The pure param layer moved to lib/decode/params (B8 — lib/save/pinBody.ts must not import UP into
// the store). Re-exported here so existing consumers (panels, tests) keep their import path.
export { exifBaselineParams, missingParamKeys, paramSource, isDirty, derivedFov } from "../lib/decode/params";
export type { AdjustableParams, AdjustableKey } from "../lib/decode/params";

/**
 * idle → decoding → review → placed (GPS present)
 *                          ↘ placing (no GPS: "SET ON GLOBE" → user clicks the globe) → placed
 */
type UploadPhase = "idle" | "decoding" | "review" | "placing" | "placed";

/** A saved pin re-opened as the camera view (globe pin click / My-pins click, Phase 5.1).
 *  Carries whatever the record kept — the pose/optics are `Partial<CameraPoseOptics>` (any
 *  missing field falls back to the D4 manual path). */
interface SavedPinView extends Partial<CameraPoseOptics> {
  pinId: string;
  title: string;
  lat: number;
  lon: number;
  previewUrl: string | null;
  capturedAt: string | null;
  /** Set when the record is the member's OWN Photos row (My-pins path) — unlocks the
   *  UPDATE / RE-PLACE / DELETE actions in the detail panel (Phase 5.5 S3). */
  ownPhotoId?: string | null;
  isPublic?: boolean;
  publicPrecision?: string | null;
  /** Marketplace (Phase 6): present when the pin is listed for sale — an OWN pin shows UNLIST, a
   *  FOREIGN pin shows BUY. Flows in via the spread at both open sites (globe pin + My-pins row).
   *  `productVariantId` rides in from PublicPin so a buyer's checkout can reference the variant. */
  productId?: string | null;
  productVariantId?: string | null;
  priceAmount?: number | null;
  currency?: string | null;
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
  /** The member's own Photos row id when the viewed pin came from MY PINS — gates the
   *  UPDATE / RE-PLACE / DELETE actions (a globe click on a foreign pin never sets this). */
  ownPhotoId?: string;
  /** Save-time choices of the own viewed pin — seeds the edit section's controls. */
  ownPinMeta?: { isPublic: boolean; precision: string | null };
  /** Marketplace (Phase 6): the viewed pin's active listing (null = not for sale). Seeded when a
   *  pin opens; the market store flips it on list/unlist so the panel updates without a reopen. */
  listing?: PinListing | null;
  /** One-shot location seed from the temp-pin "UPLOAD HERE" action: applied at ingest when
   *  the file carries no GPS (EXIF wins when present — it is the real capture location). */
  pendingPlacement?: Placement;
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
  /** Edit-location for a viewed OWN pin: placed → placing (the same click-to-place path);
   *  the previous placement is kept so Escape can fall back to it. */
  rePlace(): void;
  /** Abort the placing mode: an own viewed pin returns to its (kept) placement; a fresh
   *  upload goes back to the review overlay. */
  cancelPlacing(): void;
  /** Temp-pin "UPLOAD HERE": open the upload overlay with a location seed for GPS-less
   *  files (consumed at ingest; dropped when the overlay closes without a file). */
  uploadAt(latDeg: number, lonDeg: number): void;
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

  // Closing the overlay without a file also abandons a pending "UPLOAD HERE" seed.
  closePanel: () => set({ open: false, pendingPlacement: undefined }),

  uploadAt: (latDeg, lonDeg) =>
    set({ open: true, pendingPlacement: { latDeg, lonDeg } }),

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
      ownPhotoId: undefined,
      ownPinMeta: undefined,
      listing: null,
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
    set((s) => {
      // GPS is the real capture location and always wins; the temp-pin seed covers GPS-less
      // files ("UPLOAD HERE"). Applying the seed retires the temp pin — its job is done.
      const gps =
        extracted.exif.gpsLat !== undefined && extracted.exif.gpsLon !== undefined
          ? { latDeg: extracted.exif.gpsLat, lonDeg: extracted.exif.gpsLon }
          : undefined;
      const seeded = !gps && s.pendingPlacement ? s.pendingPlacement : undefined;
      if (seeded) useCameraStore.getState().setTempPin(null);
      return {
        phase: "review",
        fileName: extracted.fileName,
        fileSizeBytes: extracted.fileSizeBytes,
        previewUrl: extracted.previewUrl,
        previewSource: extracted.previewSource,
        decodeProgress: 1,
        decodeMs,
        exif: extracted.exif,
        params: exifBaselineParams(extracted.exif),
        placement: gps ?? seeded,
        pendingPlacement: undefined,
        textureWidth: extracted.textureWidth ?? extracted.exif.width,
        textureHeight: extracted.textureHeight ?? extracted.exif.height,
        loadError: undefined,
        decodeError: extracted.decodeError,
        viewingPinId: undefined,
        ownPhotoId: undefined,
        ownPinMeta: undefined,
        viewMode: "orbit",
      };
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

  rePlace: () =>
    set((s) =>
      s.phase === "placed" && s.viewingPinId
        ? { phase: "placing" as const, open: false, viewMode: "orbit" as const }
        : {},
    ),

  cancelPlacing: () =>
    set((s) => {
      if (s.phase !== "placing") return {};
      // An own viewed pin kept its placement — just stand back on it. A fresh upload
      // returns to the review overlay (the pre-S3 Escape behaviour).
      if (s.viewingPinId && s.placement) return { phase: "placed" as const, open: false };
      return { phase: "review" as const, open: true };
    }),

  setViewMode: (mode) =>
    set((s) => (mode === "fpv" && s.phase !== "placed" ? {} : { viewMode: mode })),

  openSavedPin: (view) => {
    loadSeq++; // supersede any in-flight decode
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl); // remote wixstatic URLs are not blob: — revoke is a no-op there
    // Reproduce the stored H-FOV exactly through the focal35 shortcut in derivedFov.
    const focal35 =
      view.hFovDeg != null && view.hFovDeg > 0 && view.hFovDeg < 180
        ? focalFromHorizontalFov(view.hFovDeg)
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
      ownPhotoId: view.ownPhotoId ?? undefined,
      ownPinMeta:
        view.ownPhotoId != null
          ? { isPublic: view.isPublic === true, precision: view.publicPrecision ?? null }
          : undefined,
      listing:
        typeof view.productId === "string" && view.productId.length > 0
          ? {
              productId: view.productId,
              variantId: view.productVariantId ?? null,
              priceAmount: view.priceAmount ?? null,
              currency: view.currency ?? null,
            }
          : null,
      pendingPlacement: undefined,
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
      ownPhotoId: undefined,
      ownPinMeta: undefined,
      listing: null,
      pendingPlacement: undefined,
      viewMode: "orbit",
    });
  },
}));

// Dev-only introspection (mirrors window.__globe) so browser verification can drive the store
// without reaching through the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__uploadStore = useUploadStore;
}
