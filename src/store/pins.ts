import { create } from "zustand";

/**
 * Public pins store (Phase 5) — the shared globe's pin layer.
 *
 * The globe orchestrator mirrors its view focus + altitude here at low cadence
 * (`reportViewport`); a debounced worker decides whether the viewport moved enough to
 * re-query Wix Data and swaps `pins` atomically. Query tiers (D7 — no geo query on Wix Data):
 *   • ≥ PINS.queryGlobalAltM — newest pins globally (a hemisphere view can't be cell-covered);
 *   • below — `hasSome` over the geohash cells covering the viewport (gh4, or gh6 when low).
 * PublicPins is world-readable (read: ANYONE), so this works signed-out — the DoD case.
 *
 * Pure helpers are exported for tests; the Wix SDK import stays lazy inside the query.
 */

import { geohashesForViewport, type GeohashBounds } from "../lib/geo/geohash";
import { PINS } from "../components/globe/tuning";

export interface PublicPin {
  id: string;
  title: string;
  /** Denormalized member display label (Phase 5.5 S3); null on pre-S3 rows until back-fill. */
  authorName: string | null;
  /** REDUCED coordinates — all a public record ever carries (C6). */
  lat: number;
  lon: number;
  precision: string;
  previewUrl: string | null;
  capturedAt: string | null;
  /** Camera pose (orientation/optics — NOT location; C6 governs coordinates only). Null on
   *  pins saved before the pose fields existed — the camera view falls back to defaults. */
  altitudeM: number | null;
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  focalLengthMm: number | null;
  hFovDeg: number | null;
  textureWidth: number | null;
  textureHeight: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
}

export interface Viewport {
  latDeg: number;
  lonDeg: number;
  altM: number;
}

export type PinsQueryPlan =
  | { mode: "global" }
  | { mode: "cells"; precision: 4 | 6; cells: string[] };

/** Viewport half-span in degrees for the cell cover, from camera altitude. */
export function viewportSpanDeg(altM: number): number {
  const span = (altM / 1000) * PINS.spanDegPerKm;
  return Math.min(PINS.spanMaxDeg, Math.max(PINS.spanMinDeg, span));
}

export function viewportBounds(v: Viewport): GeohashBounds {
  const half = viewportSpanDeg(v.altM);
  return {
    latMin: Math.max(-90, v.latDeg - half),
    latMax: Math.min(90, v.latDeg + half),
    lonMin: Math.max(-180, v.lonDeg - half),
    lonMax: Math.min(180, v.lonDeg + half),
  };
}

/** Decide the query tier + cells for a viewport. */
export function planPinsQuery(v: Viewport): PinsQueryPlan {
  if (v.altM >= PINS.queryGlobalAltM) return { mode: "global" };
  const precision = v.altM < PINS.queryFineAltM ? 6 : 4;
  const cells = geohashesForViewport(viewportBounds(v), precision);
  // A pathological cover (span too wide for the tier) falls back to the global fetch rather
  // than shipping a huge hasSome list.
  if (cells.length > 120) return { mode: "global" };
  return { mode: "cells", precision, cells };
}

/** True when the viewport moved enough that the last query no longer covers it. */
export function needsRequery(prev: Viewport | null, next: Viewport): boolean {
  if (!prev) return true;
  const prevGlobal = prev.altM >= PINS.queryGlobalAltM;
  const nextGlobal = next.altM >= PINS.queryGlobalAltM;
  if (prevGlobal !== nextGlobal) return true;
  if (nextGlobal) return false; // one global fetch covers every global viewport
  const prevFine = prev.altM < PINS.queryFineAltM;
  const nextFine = next.altM < PINS.queryFineAltM;
  if (prevFine !== nextFine) return true;
  const span = viewportSpanDeg(prev.altM);
  const moved = Math.max(Math.abs(next.latDeg - prev.latDeg), Math.abs(next.lonDeg - prev.lonDeg));
  if (moved > span * PINS.requeryMoveFrac) return true;
  const altRatio = Math.abs(next.altM - prev.altM) / Math.max(prev.altM, 1);
  return altRatio > PINS.requeryAltFrac;
}

/** Map a Wix Data item to a PublicPin (defensive — bad rows are dropped by the caller). */
export function pinFromItem(item: Record<string, unknown>): PublicPin | null {
  const lat = item.latReduced;
  const lon = item.lonReduced;
  const id = item._id;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof id !== "string") return null;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    id,
    title: typeof item.title === "string" ? item.title : "Untitled",
    authorName: str(item.authorName),
    lat,
    lon,
    precision: typeof item.precision === "string" ? item.precision : "1km",
    previewUrl: str(item.previewUrl),
    capturedAt: str(item.capturedAt),
    altitudeM: num(item.altitudeM),
    headingDeg: num(item.headingDeg),
    pitchDeg: num(item.pitchDeg),
    rollDeg: num(item.rollDeg),
    focalLengthMm: num(item.focalLengthMm),
    hFovDeg: num(item.hFovDeg),
    textureWidth: num(item.textureWidth),
    textureHeight: num(item.textureHeight),
    cameraMake: str(item.cameraMake),
    cameraModel: str(item.cameraModel),
    lensModel: str(item.lensModel),
  };
}

export interface PinsState {
  pins: PublicPin[];
  status: "idle" | "loading" | "ready" | "error";
  /** Pin to pulse-highlight on the globe (post-save landing beacon, Phase 5.5 S3). The globe
   *  layer owns the pulse duration; setting the same id again restarts it. */
  highlightId: string | null;
  /** Orchestrator-only: low-cadence view focus mirror; triggers the debounced query. */
  reportViewport: (latDeg: number, lonDeg: number, altM: number) => void;
  /** Force a re-query of the last viewport (e.g. right after saving a public pin). */
  refresh: () => void;
  highlight: (pinId: string | null) => void;
}

let lastQueried: Viewport | null = null;
let lastReported: Viewport | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let querySeq = 0;

async function runQuery(v: Viewport, set: (partial: Partial<PinsState>) => void): Promise<void> {
  const seq = ++querySeq;
  lastQueried = v;
  set({ status: "loading" });
  try {
    const { items } = await import("@wix/data");
    const plan = planPinsQuery(v);
    const query =
      plan.mode === "global"
        ? items.query("PublicPins").descending("_createdDate")
        : items
            .query("PublicPins")
            .hasSome(plan.precision === 6 ? "gh6" : "gh4", plan.cells)
            .descending("_createdDate");
    const res = await query.limit(PINS.maxRender).find();
    if (seq !== querySeq) return; // superseded by a newer viewport
    const pins = (res.items as Record<string, unknown>[])
      .map(pinFromItem)
      .filter((p): p is PublicPin => p !== null);
    set({ pins, status: "ready" });
  } catch (e) {
    if (seq !== querySeq) return;
    console.warn("[pins] viewport query failed", e);
    set({ status: "error" });
  }
}

export const usePinsStore = create<PinsState>((set) => ({
  pins: [],
  status: "idle",
  highlightId: null,

  highlight: (pinId) => set({ highlightId: pinId }),

  reportViewport: (latDeg, lonDeg, altM) => {
    const v: Viewport = { latDeg, lonDeg, altM };
    lastReported = v;
    if (!needsRequery(lastQueried, v)) return;
    // THROTTLE, not debounce: reports arrive ~5/s from the render loop, so resetting a pending
    // timer on every report would starve it forever (needsRequery stays true until the FIRST
    // query lands). Let one pending timer fire with the freshest report instead.
    if (debounceTimer !== undefined) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      // Query the freshest report — the camera may have kept moving since the timer was armed.
      const target = lastReported ?? v;
      if (needsRequery(lastQueried, target)) void runQuery(target, set);
    }, PINS.queryDebounceMs);
  },

  refresh: () => {
    const target = lastReported ?? lastQueried;
    if (!target) return;
    lastQueried = null; // force
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    void runQuery(target, set);
  },
}));

// DEV convenience (mirrors the other stores).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __pinsStore: typeof usePinsStore }).__pinsStore = usePinsStore;
}
