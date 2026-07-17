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
import { numOrNull, strOrNull } from "../lib/geo/coerce";
import { DEFAULT_PRECISION_TIER } from "../lib/geo/precision";
import type { CameraPoseOptics } from "../lib/pins/fields";
import { PINS } from "../components/globe/tuning";

/** Camera pose (orientation/optics — NOT location; C6 governs coordinates only) rides on the
 *  public record via CameraPoseOptics. Fields are null on pins saved before the pose fields
 *  existed — the camera view falls back to defaults. */
export interface PublicPin extends CameraPoseOptics {
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
  /** Marketplace (Phase 6): set when the photo is listed for sale — powers the globe BUY seam.
   *  Not location data (C6-ok). null on pins that aren't for sale. `productVariantId` is required
   *  to build the checkout catalogReference (productId alone → empty checkout). */
  productId: string | null;
  productVariantId: string | null;
  priceAmount: number | null;
  currency: string | null;
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
  return {
    id,
    title: typeof item.title === "string" ? item.title : "Untitled",
    authorName: strOrNull(item.authorName),
    lat,
    lon,
    precision: typeof item.precision === "string" ? item.precision : DEFAULT_PRECISION_TIER,
    previewUrl: strOrNull(item.previewUrl),
    capturedAt: strOrNull(item.capturedAt),
    altitudeM: numOrNull(item.altitudeM),
    headingDeg: numOrNull(item.headingDeg),
    pitchDeg: numOrNull(item.pitchDeg),
    rollDeg: numOrNull(item.rollDeg),
    focalLengthMm: numOrNull(item.focalLengthMm),
    hFovDeg: numOrNull(item.hFovDeg),
    textureWidth: numOrNull(item.textureWidth),
    textureHeight: numOrNull(item.textureHeight),
    cameraMake: strOrNull(item.cameraMake),
    cameraModel: strOrNull(item.cameraModel),
    lensModel: strOrNull(item.lensModel),
    productId: strOrNull(item.productId),
    productVariantId: strOrNull(item.productVariantId),
    priceAmount: numOrNull(item.priceAmount),
    currency: strOrNull(item.currency),
  };
}

export interface PinsState {
  pins: PublicPin[];
  status: "idle" | "loading" | "ready" | "error";
  /** Pin to pulse-highlight on the globe (post-save landing beacon, Phase 5.5 S3). The globe
   *  layer owns the pulse duration; setting the same id again restarts it. */
  highlightId: string | null;
  /** Hovered pin (Phase 5.5 S4) + its head's screen position (px) — orchestrator-mirrored at
   *  low cadence so panels/PinHoverCard can float the details card next to the pin. */
  hoverPin: PublicPin | null;
  hoverScreen: { x: number; y: number } | null;
  /** Cluster size when the hovered marker is a COLLAPSED cluster (adaptive de-cluster, far
   *  range) — the card shows "N photos here · click to zoom" instead of one pin's details. */
  hoverCount: number;
  /** Orchestrator-only: low-cadence view focus mirror; triggers the debounced query. */
  reportViewport: (latDeg: number, lonDeg: number, altM: number) => void;
  /** Force a re-query of the last viewport (e.g. right after saving a public pin). */
  refresh: () => void;
  highlight: (pinId: string | null) => void;
  /** Orchestrator-only: mirror the hover state (pin + projected head position + cluster size). */
  _syncHover: (
    pin: PublicPin | null,
    screen: { x: number; y: number } | null,
    count?: number,
  ) => void;
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
  hoverPin: null,
  hoverScreen: null,
  hoverCount: 1,

  highlight: (pinId) => set({ highlightId: pinId }),

  _syncHover: (pin, screen, count = 1) =>
    set({ hoverPin: pin, hoverScreen: screen, hoverCount: count }),

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
  window.__pinsStore = usePinsStore;
}
