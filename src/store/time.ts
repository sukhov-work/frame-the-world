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
