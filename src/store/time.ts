import { create } from "zustand";

/**
 * Scene time — the single clock the ephemeris (sun/moon positions, terminator, shadows) reads.
 *
 * Three modes:
 *  • live   — the scene follows the real wall clock. Consumers call `sceneTimeMs()` (cheap;
 *    reads Date.now()) instead of subscribing per-frame — the store is NOT written at 60 fps.
 *  • pinned — `setTime(ms)` freezes the scene at a UTC instant (the Phase-4 time scrubber's
 *    seam: dragging scrubs `timeMs`; `goLive()` resumes the wall clock).
 *  • playing — `play(rate)` advances the pinned instant fluidly at `rate` scene-seconds per
 *    real second (owner 2026-07-14: PLAY + fast-forward presets). The store is STILL never
 *    written per frame: `sceneTimeMs()` derives the current instant from the play anchor, so
 *    every per-frame consumer (ephemeris resample, shaders, arcs) gets continuous time free.
 *
 * Time is ALWAYS UTC epoch ms here. Formatting (local wall clock, TZ) is the UI's concern
 * (`lib/format/readout.ts` patterns) — never store a formatted date.
 */
export interface TimeState {
  /** Pinned scene time (UTC epoch ms). Only meaningful when `live` is false; while playing it
   *  is the instant playback (re)started from — see `playbackNowMs`. */
  timeMs: number;
  /** True = follow the real clock; false = pinned at `timeMs` (or playing from it). */
  live: boolean;
  /** Playback rate (scene-seconds per real second; 1 = real speed, 3600 = 1 h/s). null = not
   *  playing. Playing implies `live === false` — LIVE at real speed needs no playback. */
  playRate: number | null;
  /** Wall-clock ms when playback (re)started from `timeMs`; null while not playing. */
  playWallMs: number | null;
  /** Pin the scene to a UTC instant (scrubber). A running playback continues FROM that instant
   *  (the anchor rebases) — scrubbing mid-play adjusts the position, it doesn't stop the reel. */
  setTime: (ms: number) => void;
  /** Resume following the wall clock (also stops any playback). */
  goLive: () => void;
  /** Play scene time forward at `rate` scene-seconds per real second, starting from the
   *  current scene instant. No-op when already live at real speed (owner spec). */
  play: (rate: number) => void;
  /** Stop playback, freezing the scene at the instant playback reached (stays pinned). */
  stopPlay: () => void;
}

/** The scene instant (UTC ms) a given state describes at wall-clock `wallMs` (pure — the
 *  playback derivation `sceneTimeMs` and the unit tests share). */
export function playbackNowMs(
  s: Pick<TimeState, "timeMs" | "live" | "playRate" | "playWallMs">,
  wallMs: number,
): number {
  if (s.live) return wallMs;
  if (s.playRate !== null && s.playWallMs !== null) {
    return Math.round(s.timeMs + (wallMs - s.playWallMs) * s.playRate);
  }
  return s.timeMs;
}

export const useTimeStore = create<TimeState>((set) => ({
  timeMs: Date.now(),
  live: true,
  playRate: null,
  playWallMs: null,
  setTime: (ms) =>
    set((s) => ({
      timeMs: ms,
      live: false,
      playWallMs: s.playRate === null ? null : Date.now(),
    })),
  goLive: () => set({ live: true, timeMs: Date.now(), playRate: null, playWallMs: null }),
  play: (rate) =>
    set((s) => {
      if (s.live && rate === 1) return {}; // already the wall clock at real speed
      const now = Date.now();
      return {
        timeMs: playbackNowMs(s, now),
        live: false,
        playRate: rate,
        playWallMs: now,
      };
    }),
  stopPlay: () =>
    set((s) =>
      s.playRate === null
        ? {}
        : { timeMs: playbackNowMs(s, Date.now()), playRate: null, playWallMs: null },
    ),
}));

/** The scene's current UTC instant (ms) — wall clock when live, the fluid playback instant
 *  while playing, the pinned value otherwise. */
export function sceneTimeMs(): number {
  return playbackNowMs(useTimeStore.getState(), Date.now());
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

// --- Hour ticks (QoL-1 scrubber v2): the sliding rail annotates REAL local hours. Browser-local
//     by the same convention as the date/time inputs below; Date#setHours does the calendar
//     walking, so DST transitions land where the wall clock says (a spring-forward hour simply
//     never appears; a fold's repeated hour appears once). -------------------------------------

export interface HourTick {
  ms: number;
  /** Browser-local hour 0..23 — the tick label. */
  hour: number;
  /** Local midnight — the day boundary tick (styled taller / dated by the consumer). */
  isMidnight: boolean;
}

/** Every full local hour inside [startMs, endMs], ascending. Pure; safe on any window size. */
export function hourTicksBetween(startMs: number, endMs: number): HourTick[] {
  if (!(endMs > startMs)) return [];
  const out: HourTick[] = [];
  const d = new Date(startMs);
  d.setMinutes(0, 0, 0);
  if (d.getTime() < startMs) d.setHours(d.getHours() + 1);
  while (d.getTime() <= endMs) {
    const hour = d.getHours();
    out.push({ ms: d.getTime(), hour, isMidnight: hour === 0 });
    const before = d.getTime();
    d.setHours(d.getHours() + 1);
    if (d.getTime() <= before) d.setTime(before + 3_600_000); // DST-fold guard — never stall
  }
  return out;
}

// --- Date jump (multiday scrubber, 2026-07-10). The rail stays a ±12 h window; the date picker
//     moves the whole window to another calendar day, preserving the local time-of-day. The
//     ephemeris takes any UTC instant, so sun/moon/star positions stay exact on any date. -------

/** Scene instant → "YYYY-MM-DD" in the browser's local timezone (the `<input type="date">` value). */
export function localDateStr(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The same LOCAL time-of-day moved to another calendar date ("YYYY-MM-DD", browser timezone).
 *  Null for a malformed string (a cleared/partial date input must not scrub the scene). A DST
 *  boundary can shift the instant by the offset difference — inherent to local-clock semantics. */
export function withLocalDate(ms: number, dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const next = new Date(ms);
  next.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(next.getTime()) ? null : next.getTime();
}

// --- Time-of-day jump (owner 2026-07-14): the calendar's precise-time twin. Same local-clock
//     semantics as withLocalDate — the date stays, the wall time moves. -------------------------

/** Scene instant → "HH:MM" in the browser's local timezone (the `<input type="time">` value). */
export function localTimeStr(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The same LOCAL calendar date moved to another wall time ("HH:MM" or "HH:MM:SS", browser
 *  timezone; seconds reset when omitted). Null for malformed/cleared input — never scrub on
 *  garbage (the withLocalDate discipline). */
export function withLocalTime(ms: number, timeStr: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || s > 59) return null;
  const next = new Date(ms);
  next.setHours(h, min, s, 0);
  return Number.isNaN(next.getTime()) ? null : next.getTime();
}

// Dev-only introspection (the window.__* DEV-seam registry, global.d.ts) so browser verification
// drives the REAL island instance — a page-context `import("/src/store/time.ts")` can resolve a
// SECOND module instance in the Vite dev graph (observed 2026-08-14). No secrets, no behaviour.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__timeStore = useTimeStore;
}
