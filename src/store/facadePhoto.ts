/**
 * Facade-photo state (the photo flow (b)) — the TECHNICAL-photo twin of `store/upload`.
 * A street photo of a facade is decoded through the same pipeline and placed as a camera pose,
 * and the globe projects it onto the 3D buildings. Technical photos texture buildings: they are
 * never pins. Field names match the upload store so one frustum-source type fits both.
 *
 * F1 / F2 (owner order 2026-10-21, `rendering/PHOTO_PROJECTION_PLAN_2026-10-21.md` §1): the pose
 * is EDITED on the globe (a gizmo — move / rotate / scale, where SCALE = the H-FOV and never a
 * stretch) and SAVED as a FacadePhotos row (`store/facadeSave`). A saved row is PUBLIC (T190, owner
 * 2026-10-22g): every visitor sees it on the buildings at its exact pose; only the owner edits or
 * removes it (`lib/wix/facadeRecords.ts`).
 *
 * SEPARATE on purpose (owner rule: zero regression to the upload/pin flow): its own module-level
 * decode machinery, no temp-pin / pendingPlacement side effect, no `store/camera` import. The
 * residency store (`./facades`) is reached by a LAZY import only (the `store/save` → `./pins`
 * idiom) so this module never hard-depends on it.
 */

import { create } from "zustand";
import { extractMetadata, type ExtractedPhoto, type PhotoExif, type PreviewSource } from "../lib/decode/extract";
import {
  effectiveHFovDeg,
  exifBaselineParams,
  type AdjustableKey,
  type AdjustableParams,
  type Placement,
} from "../lib/decode/params";
import { focalFromHorizontalFov } from "../lib/decode/sensors";
import { exifPoseOf } from "../lib/save/facadeBody";
import type { FacadeListItem, FacadePose, FacadePoseSnapshot } from "../lib/wix/facadeRecords";
import { PHOTO_PROJECT } from "../components/globe/tuning";

/**
 * idle → decoding → review → placed (GPS present)
 *                          ↘ placing (no GPS: "SET ON GLOBE" → the user clicks the globe) → placed
 */
export type FacadePhase = "idle" | "decoding" | "review" | "placing" | "placed";

/** F1 — the gizmo the globe shows on the placed frustum: none (sliders only), move, rotate, scale. */
export type FacadeGizmoOp = "none" | "move" | "rotate" | "scale";
export const FACADE_GIZMO_OPS: readonly FacadeGizmoOp[] = ["none", "move", "rotate", "scale"];

export interface FacadeProjection {
  /** The projection onto the buildings (the frustum + plane stay visible either way). */
  enabled: boolean;
  /** 0..1 — how much of the facade's albedo the photo replaces inside its footprint. */
  strength: number;
  /** 0..1 — 0 = the photo is lit by the scene (sun/shadow/night); 1 = it shows its own colours. */
  ownLight: number;
  /** Metres from the apex the photo papers geometry; null = the tunable (`PHOTO_PROJECT.rangeM`). */
  rangeM: number | null;
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
  /** F1 — the H-FOV OVERRIDE (deg); undefined = the `derivedFov` baseline. SCALE = the H-FOV and
   *  the lens slider writes the same number (a focal write would JUMP the FOV on the first drag —
   *  `effectiveHFovDeg`'s doc). Read it through `effectiveHFovDeg(exif, params, hFovDeg)` only. */
  hFovDeg?: number;
  /** F1 — the gizmo op the globe shows; "none" = sliders only. */
  gizmoOp: FacadeGizmoOp;
  placement?: Placement;
  textureWidth?: number;
  textureHeight?: number;
  /** Placed image-plane opacity override (0..1); undefined = the FRUSTUM.planeOpacity default. */
  planeOpacity?: number;
  projection: FacadeProjection;
  /** F2 — the RENDERED apex height above the ellipsoid (m), written by the globe orchestrator at a
   *  low cadence from the terrain-seated frustum (the camera-store `_sync*` idiom). The save flow
   *  needs it (`lib/wix/facadeRecords.ts` — THE APEX HEIGHT); undefined until the globe seats it. */
  apexAltM?: number;
  /** F2 — the apex height above the rendered ground (m), same cadence. */
  apexAboveGroundM?: number;
  /** F2 — the EXIF pose as the photo arrived (the RESET baseline the record stores). Captured ONCE
   *  per draft, LAZILY: the apex is seated by the globe a frame or more after the placement, so
   *  the capture happens in the first `_syncApex` that lands while placed (never in `place()` —
   *  an apex of 0 would be a lie the record keeps). A re-opened record carries its own. */
  exifPose?: FacadePose;
  /** F2 — the FacadePhotos row this placed photo IS (a re-open, or after SAVE) → SAVE becomes UPDATE. */
  savedFacadeId?: string;
  loadError?: string;
  decodeError?: string;
  openPanel(): void;
  closePanel(): void;
  loadFile(file: File): Promise<void>;
  /** GPS → placement; no pendingPlacement / temp-pin side effect. */
  ingest(extracted: ExtractedPhoto, decodeMs?: number): void;
  setParam(key: AdjustableKey, value: number): void;
  resetParam(key: AdjustableKey): void;
  /** Params back to the EXIF baseline, rollDeg AND the H-FOV override back to undefined. */
  resetAll(): void;
  setRollDeg(deg: number | undefined): void;
  /** The H-FOV override, clamped to `[PHOTO_PROJECT.hFovMinDeg, hFovMaxDeg]`; undefined = the baseline. */
  setHFovDeg(deg: number | undefined): void;
  setGizmoOp(op: FacadeGizmoOp): void;
  setPlaneOpacity(opacity: number | undefined): void;
  /** Merges; strength/ownLight clamp to [0,1]; rangeM clamps to [10, 5000] or stays null. */
  setProjection(patch: Partial<FacadeProjection>): void;
  /** review|placed → placed (has placement) | placing (no placement); closes the overlay. */
  place(): void;
  /** The globe's click-to-place → placed (only when exif exists). Never resets a captured exifPose. */
  setPlacement(latDeg: number, lonDeg: number): void;
  /** Move the placement by metres (north+, east+) — the registration nudge. 1° lat = 111_320 m; lon scaled by cos(lat). No-op without a placement. */
  nudgePlacement(northM: number, eastM: number): void;
  /** placed|placing → review (open). */
  backToReview(): void;
  /** placing → review (open). */
  cancelPlacing(): void;
  /** Back to idle; revokes blob previews; aborts an in-flight decode; releases the residency's editing row. */
  clear(): void;
  /** The orchestrator's low-cadence apex write (see `apexAltM`); captures `exifPose` on its first landing. */
  _syncApex(apexAltM: number, aboveGroundM: number): void;
  /** After a SAVE: this draft is now row `id` (UPDATE from here on). */
  _markSaved(id: string): void;
  /** Re-open a saved row as the placed photo — the `openSavedPin` twin. The EXIF is SYNTHESIZED
   *  so the shared derivations reproduce the record: `focalLengthIn35mmMm` from the stored H-FOV
   *  (the focal35 path gives it back exactly), `gpsAltitudeM` = the stored APEX (the EXIF-sourced
   *  absolute semantics in `PhotoFrustum.rebuild` then reproduce it: `max(apexAltM, terrain + eye)`). */
  openSaved(item: FacadeListItem): void;
  /** The journal's restore + the gizmo cancel: ONE set writing the placement, the three pose
   *  params (null → unset), the roll nudge and the H-FOV override (null → undefined). */
  restorePose(snap: FacadePoseSnapshot): void;
  /** The journal's `current` read — null unless placed. */
  poseSnapshot(): FacadePoseSnapshot | null;
}

const DEFAULT_PROJECTION: FacadeProjection = { enabled: true, strength: 1, ownLight: 0.6, rangeM: null };
const METRES_PER_DEG_LAT = 111_320;
/** The per-slot range's rails (m) — under 10 m nothing but the camera's own lamppost is painted;
 *  above 5 km a facade is sub-pixel (the depth map's `farM` is 3 km). */
const RANGE_MIN_M = 10;
const RANGE_MAX_M = 5000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampHFov(deg: number): number {
  return Math.min(PHOTO_PROJECT.hFovMaxDeg, Math.max(PHOTO_PROJECT.hFovMinDeg, deg));
}

function revokePreview(url?: string): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

/**
 * The lazy residency hook-up (`./facades` is agent C's store; this module never hard-depends on
 * it — the `store/save` → `./pins` idiom). Fire-and-forget and guarded: a missing module (tests,
 * a shell without the residency) must never surface as an error in the photo flow.
 */
function tellResidencyEditing(id: string | null): void {
  void import("./facades")
    .then((m) => m.useFacadesStore.getState().setEditing(id))
    .catch(() => undefined);
}

/**
 * The lazy `exifPose` capture (see the field's doc): a fresh draft (never a re-opened row — its
 * baseline is the record's), placed, with the apex seated, and no pose captured yet. The H-FOV is
 * the EXIF BASELINE's (`exifBaselineParams`, no override) — so the record's `exifPose` equals what
 * RESET TO EXIF produces, not whatever the review-step sliders held at placement.
 */
function captureExifPose(s: FacadePhotoStore, apexAltM: number): { exifPose: FacadePose } | null {
  if (s.exifPose || s.savedFacadeId || s.phase !== "placed" || !s.exif || !s.placement) return null;
  const hFov = effectiveHFovDeg(s.exif, exifBaselineParams(s.exif));
  return { exifPose: exifPoseOf(s.exif, s.placement, apexAltM, hFov) };
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
  gizmoOp: "none",
  projection: { ...DEFAULT_PROJECTION },

  openPanel: () => set({ open: true }),

  closePanel: () => set({ open: false }),

  loadFile: async (file: File) => {
    const seq = ++loadSeq;
    activeAbort?.abort();
    const abort = (activeAbort = new AbortController());
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl);
    if (get().savedFacadeId) tellResidencyEditing(null); // a new file ends the row's edit session
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
      hFovDeg: undefined,
      gizmoOp: "none",
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      apexAltM: undefined,
      apexAboveGroundM: undefined,
      exifPose: undefined,
      savedFacadeId: undefined,
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
      hFovDeg: undefined,
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

  resetAll: () =>
    set((s) => ({ params: s.exif ? exifBaselineParams(s.exif) : {}, rollDeg: undefined, hFovDeg: undefined })),

  setRollDeg: (rollDeg) => set({ rollDeg }),

  setHFovDeg: (deg) =>
    set({ hFovDeg: typeof deg === "number" && Number.isFinite(deg) ? clampHFov(deg) : undefined }),

  setGizmoOp: (gizmoOp) => set({ gizmoOp }),

  setPlaneOpacity: (planeOpacity) => set({ planeOpacity }),

  setProjection: (patch) =>
    set((s) => {
      const next: FacadeProjection = { ...s.projection, ...patch };
      next.strength = clamp01(next.strength);
      next.ownLight = clamp01(next.ownLight);
      next.rangeM =
        typeof next.rangeM === "number" && Number.isFinite(next.rangeM)
          ? Math.min(RANGE_MAX_M, Math.max(RANGE_MIN_M, next.rangeM))
          : null;
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
    set((s) =>
      s.phase === "placed" || s.phase === "placing" ? { phase: "review" as const, open: true, gizmoOp: "none" as const } : {},
    ),

  cancelPlacing: () => set((s) => (s.phase === "placing" ? { phase: "review" as const, open: true } : {})),

  clear: () => {
    loadSeq++;
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl);
    if (get().savedFacadeId) tellResidencyEditing(null); // the row returns to residency
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
      hFovDeg: undefined,
      gizmoOp: "none",
      placement: undefined,
      textureWidth: undefined,
      textureHeight: undefined,
      planeOpacity: undefined,
      projection: { ...DEFAULT_PROJECTION },
      apexAltM: undefined,
      apexAboveGroundM: undefined,
      exifPose: undefined,
      savedFacadeId: undefined,
      loadError: undefined,
      decodeError: undefined,
    });
  },

  _syncApex: (apexAltM, aboveGroundM) =>
    set((s) => {
      const captured = captureExifPose(s, apexAltM);
      if (!captured && s.apexAltM === apexAltM && s.apexAboveGroundM === aboveGroundM) return {}; // low cadence, no churn
      return { apexAltM, apexAboveGroundM: aboveGroundM, ...captured };
    }),

  _markSaved: (id) => set({ savedFacadeId: id }),

  openSaved: (item) => {
    loadSeq++; // supersede any in-flight decode
    activeAbort?.abort();
    clearInterval(trickleTimer);
    revokePreview(get().previewUrl); // wixstatic URLs are not blob: — the revoke is a no-op there
    // Reproduce the stored H-FOV exactly through the focal35 shortcut in derivedFov (the pin
    // flow's openSavedPin idiom): hFov = 2·atan(36 / (2·f)) with f = 18 / tan(hFov / 2).
    const focal35 =
      item.hFovDeg > 0 && item.hFovDeg < 180 ? focalFromHorizontalFov(item.hFovDeg) : undefined;
    const exif: PhotoExif = {
      make: item.cameraMake ?? undefined,
      model: item.cameraModel ?? undefined,
      lensModel: item.lensModel ?? undefined,
      focalLengthMm: item.focalLengthMm ?? undefined,
      focalLengthIn35mmMm: focal35,
      capturedAt: item.capturedAt ?? undefined,
      width: item.textureWidth ?? undefined,
      height: item.textureHeight ?? undefined,
      gpsLat: item.lat,
      gpsLon: item.lon,
      gpsAltitudeM: item.apexAltM, // the APEX: EXIF-sourced = absolute → the frustum re-seats at max(apex, terrain + eye)
      headingDeg: item.headingDeg,
      pitchDeg: item.pitchDeg,
      rollDeg: item.rollDeg,
    };
    set({
      open: false,
      phase: "placed",
      fileName: item.title,
      fileSizeBytes: item.fileSizeBytes ?? undefined,
      file: undefined,
      previewUrl: item.displayUrl,
      previewSource: "decoded",
      decodeProgress: 1,
      decodeMs: undefined,
      exif,
      params: exifBaselineParams(exif),
      rollDeg: undefined,
      hFovDeg: undefined,
      gizmoOp: "none",
      placement: { latDeg: item.lat, lonDeg: item.lon },
      textureWidth: item.textureWidth ?? undefined,
      textureHeight: item.textureHeight ?? undefined,
      planeOpacity: undefined,
      projection: { enabled: true, strength: clamp01(item.strength), ownLight: clamp01(item.ownLight), rangeM: item.rangeM },
      apexAltM: undefined,
      apexAboveGroundM: undefined,
      exifPose: item.exifPose ?? undefined,
      savedFacadeId: item.id,
      loadError: undefined,
      decodeError: undefined,
    });
    tellResidencyEditing(item.id); // the row leaves residency while it is the draft
  },

  restorePose: (snap) =>
    set((s) => {
      if (!s.exif) return {};
      const params: AdjustableParams = { ...s.params };
      const put = (key: "headingDeg" | "pitchDeg" | "altitudeM", v: number | null) => {
        if (v === null) delete params[key];
        else params[key] = v;
      };
      put("headingDeg", snap.headingDeg);
      put("pitchDeg", snap.pitchDeg);
      put("altitudeM", snap.altitudeM);
      return {
        placement: { latDeg: snap.lat, lonDeg: snap.lon },
        params,
        rollDeg: snap.rollDeg ?? undefined,
        hFovDeg: snap.hFovDeg ?? undefined,
      };
    }),

  poseSnapshot: () => {
    const s = get();
    if (s.phase !== "placed" || !s.placement) return null;
    return {
      lat: s.placement.latDeg,
      lon: s.placement.lonDeg,
      altitudeM: s.params.altitudeM ?? null,
      headingDeg: s.params.headingDeg ?? null,
      pitchDeg: s.params.pitchDeg ?? null,
      rollDeg: s.rollDeg ?? null,
      hFovDeg: s.hFovDeg ?? null,
    };
  },
}));

// Dev-only introspection (the window.__uploadStore twin) so browser verification can drive the
// store without the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__facadeStore = useFacadePhotoStore;
}
