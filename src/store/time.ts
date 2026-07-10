import { create } from "zustand";

/**
 * Scene time — the single clock the ephemeris (sun/moon positions, terminator, shadows) reads.
 *
 * Two modes:
 *  • live  — the scene follows the real wall clock. Consumers call `sceneTimeMs()` (cheap;
 *    reads Date.now()) instead of subscribing per-frame — the store is NOT written at 60 fps.
 *  • pinned — `setTime(ms)` freezes the scene at a UTC instant (the Phase-4 time scrubber's
 *    seam: dragging scrubs `timeMs`; `goLive()` resumes the wall clock).
 *
 * Time is ALWAYS UTC epoch ms here. Formatting (local wall clock, TZ) is the UI's concern
 * (`lib/format/readout.ts` patterns) — never store a formatted date.
 */
export interface TimeState {
  /** Pinned scene time (UTC epoch ms). Only meaningful when `live` is false. */
  timeMs: number;
  /** True = follow the real clock; false = pinned at `timeMs`. */
  live: boolean;
  /** Pin the scene to a UTC instant (scrubber). */
  setTime: (ms: number) => void;
  /** Resume following the wall clock. */
  goLive: () => void;
}

export const useTimeStore = create<TimeState>((set) => ({
  timeMs: Date.now(),
  live: true,
  setTime: (ms) => set({ timeMs: ms, live: false }),
  goLive: () => set({ live: true, timeMs: Date.now() }),
}));

/** The scene's current UTC instant (ms) — wall clock when live, pinned value otherwise. */
export function sceneTimeMs(): number {
  const s = useTimeStore.getState();
  return s.live ? Date.now() : s.timeMs;
}

// --- Scrubber window math (pure — exported for the TimeScrubber panel + unit tests, the
//     upload.ts pure-helper pattern). The rail maps a window of `windowMs` centred on `anchorMs`
//     onto [0,1]; the knob clamps at the rail ends (the panel recentres the anchor on release). --

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Rail fraction [0,1] for an instant inside a window centred on `anchorMs`. */
export function timeToFraction(ms: number, anchorMs: number, windowMs: number): number {
  return clamp01((ms - anchorMs) / windowMs + 0.5);
}

/** Instant (UTC ms) for a rail fraction — inverse of `timeToFraction` inside the window. */
export function fractionToTime(fraction: number, anchorMs: number, windowMs: number): number {
  return Math.round(anchorMs + (clamp01(fraction) - 0.5) * windowMs);
}
