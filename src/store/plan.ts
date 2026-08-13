import { create } from "zustand";
import type { PlanEvent } from "../lib/ephemeris/planner";

/**
 * Plan seam (Pass 3 WS4 + Dnipro Slice 5) — the bridge between the globe's obstruction/planner
 * feed (scene/planFeed.ts, written at low cadence like the camera mirrors) and the PlanPanel
 * chips. The globe owns every computation; the panel only renders + jumps scene time via
 * store/time.setTime.
 */

/** Where the current plan is anchored — the eye the skyline is measured from. */
export type PlanAnchorKind = "photo" | "fpv" | "focus";

interface PlanAnchor {
  kind: PlanAnchorKind;
  latDeg: number;
  lonDeg: number;
}

/** One sky body vs the cached skyline at the CURRENT scene instant (+ next crossings). */
export interface PlanBodyState {
  blockedNow: boolean;
  azDeg: number;
  altDeg: number;
  /** Skyline elevation at the body's azimuth (deg) — what it must clear. */
  skylineAltDeg: number;
  nextClearMs: number | null;
  nextBlockMs: number | null;
}

/** The tracked SkyTarget vs the skyline (ASTRO ENGINE phase E) — same verdict shape as
 *  sun/moon plus enough identity for the row to label itself without importing the sky store. */
export interface PlanTargetState extends PlanBodyState {
  id: string;
  label: string;
  glyph: string;
}

export interface PlanState {
  /** Panel visibility (user toggle — the pill stays either way). */
  open: boolean;
  setOpen(open: boolean): void;

  // ── Globe-written mirrors (planFeed only — never write from React) ────────────────────────
  anchor: PlanAnchor | null;
  /** Sorted jump-to-time chips for the anchor's local solar day (+ next full/new moon). */
  events: PlanEvent[];
  /** Skyline profile state: building when a photo/FPV anchor exists; coverage 0..1 is the
   *  fraction of azimuth bins with real terrain/geometry evidence (the WS4 honesty contract). */
  profileReady: boolean;
  profileCoverage: number;
  trustRadiusM: number;
  /** Per-instant body vs skyline — null until the profile is ready (focus anchors never get
   *  one: no eye, no skyline; the almanac chips still work). */
  sun: PlanBodyState | null;
  moon: PlanBodyState | null;
  /** Tracked sky target vs skyline — additionally null while the target's SHOW chip is off. */
  target: PlanTargetState | null;

  _syncPlan(
    p: Partial<
      Pick<
        PlanState,
        | "anchor"
        | "events"
        | "profileReady"
        | "profileCoverage"
        | "trustRadiusM"
        | "sun"
        | "moon"
        | "target"
      >
    >,
  ): void;
}

export const usePlanStore = create<PlanState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),

  anchor: null,
  events: [],
  profileReady: false,
  profileCoverage: 0,
  trustRadiusM: 0,
  sun: null,
  moon: null,
  target: null,

  _syncPlan: (p) => set(p),
}));

// Dev-only introspection (mirrors window.__globe) so browser verification can drive the store
// without reaching through the UI. No secrets, no behaviour change.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__planStore = usePlanStore;
}
