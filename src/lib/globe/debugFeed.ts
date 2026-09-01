/**
 * Debug feed — the always-compiled data seam behind the desktop `DBG` chip (owner 2026-09-01).
 *
 * WHY THIS EXISTS SEPARATELY FROM `window.__globe`: every `window.__*` probe is
 * `import.meta.env.DEV`-gated and statically eliminated from a release build, so a product
 * debug window cannot read them. This module is the runtime-gated twin (the ULT precedent:
 * compiled everywhere, active only while the chip is on). It is PURE TS — no three import, no
 * DOM — so both `components/globe/**` (writers) and `components/panels/**` (the reader) may
 * import it without breaking any fence.
 *
 * Three kinds of surface, matched to three cost classes:
 *  - SERIES  — per-frame scalars the engine pushes (frame dt, CPU ms, draw calls…). Rings are
 *              pre-allocated `Float32Array`s; a push while inactive is one boolean check and a
 *              return. NOTHING here allocates on the hot path.
 *  - PROVIDER — a registered closure returning a flat snapshot object, polled by the panel at
 *              ITS cadence (≤4 Hz), never per frame. A throwing provider reads as null — the
 *              panel treats a broken reach as a finding, not a crash (the esriPlaceholder rule).
 *  - ACTION  — an on-demand heavy probe (scene traversals like `debugSeats()`), run only from
 *              an explicit button press. Never polled.
 *
 * Counter discipline: cumulative counters (gate draws/skips, hitches, epochs…) are NEVER
 * displayed from one read — `makeRateTracker` differences two samples into a per-second rate
 * (the RC11 lesson: a single sample of a since-page-load counter read 9.8 % where the truth
 * was 87 %).
 */

import { DEBUGHUD } from "../../components/globe/tuning";

export type DebugValue = number | string | boolean | null | undefined;
export type DebugSnapshot = Record<string, DebugValue>;

/** The per-frame series the engine pushes. A fixed union so a typo is a type error. */
export type DebugSeriesId =
  | "frame.dt" // rAF-to-rAF delta (ms) — cadence, includes compositor/vsync stalls
  | "frame.cpu" // tilesHandle.update() bracket (ms) — the orchestrator's main-thread cost
  | "frame.draw" // composer.render()+PiP bracket (ms) — wall-clock submit, NOT GPU time
  | "frame.gpu" // EXT_disjoint_timer_query result (ms), a few frames late; absent = unsupported
  | "frame.calls" // renderer.info.render.calls, whole frame (shadow + composer + PiP passes)
  | "frame.tris"; // renderer.info.render.triangles, whole frame

interface Ring {
  buf: Float32Array;
  head: number; // next write slot
  len: number; // filled count (≤ capacity)
}

let feedActive = false;
const rings = new Map<DebugSeriesId, Ring>();
const providers = new Map<string, () => DebugSnapshot>();
const actions = new Map<string, () => unknown>();

/** Panel lifecycle: mounts flip this on, unmounts flip it off. Idempotent. */
export function setDebugFeedActive(on: boolean): void {
  feedActive = on;
}

/** The one check every engine push site makes — the whole off-state cost of the feature. */
export function debugFeedActive(): boolean {
  return feedActive;
}

/** Push one per-frame sample. No-op while inactive; ring allocated on first active push. */
export function debugPush(id: DebugSeriesId, v: number): void {
  if (!feedActive) return;
  let r = rings.get(id);
  if (!r) {
    r = { buf: new Float32Array(DEBUGHUD.ringCapacity), head: 0, len: 0 };
    rings.set(id, r);
  }
  r.buf[r.head] = v;
  r.head = (r.head + 1) % r.buf.length;
  if (r.len < r.buf.length) r.len++;
}

/** Copy a series oldest→newest into `out`; returns the sample count (0 = no data yet). */
export function debugSeriesRead(id: DebugSeriesId, out: Float32Array): number {
  const r = rings.get(id);
  if (!r || r.len === 0) return 0;
  const n = Math.min(r.len, out.length);
  const start = (r.head - n + r.buf.length * 2) % r.buf.length;
  for (let i = 0; i < n; i++) out[i] = r.buf[(start + i) % r.buf.length];
  return n;
}

export interface DebugSeriesStats {
  n: number;
  last: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  /** Mean of the worst ceil(n/100) samples — the "1 % low" a frame graph is judged by.
   *  For frame TIMES the worst samples are the LARGEST; this reports that tail's mean. */
  worst1: number;
  /** Jitter = p95 − p50: how far the bad frames sit from the typical one. */
  jitter: number;
}

// Scratch for stats — module-level so a 2 Hz stats pass allocates nothing.
const statsScratch = new Float32Array(4096);

/** Order-statistics over a series. Sorts a scratch COPY (the ring itself is never mutated). */
export function debugSeriesStatsOf(id: DebugSeriesId): DebugSeriesStats | null {
  const r = rings.get(id);
  if (!r || r.len === 0) return null;
  const n = debugSeriesRead(id, statsScratch);
  const last = statsScratch[n - 1];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += statsScratch[i];
  const sorted = statsScratch.subarray(0, n);
  sorted.sort(); // TypedArray#sort is numeric by default
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  const tail = Math.max(1, Math.ceil(n / 100));
  let tailSum = 0;
  for (let i = n - tail; i < n; i++) tailSum += sorted[i];
  const p50 = q(0.5);
  const p95 = q(0.95);
  return {
    n,
    last,
    min: sorted[0],
    max: sorted[n - 1],
    avg: sum / n,
    p50,
    p95,
    worst1: tailSum / tail,
    jitter: p95 - p50,
  };
}

/** Register a snapshot provider; returns the unregister. Last registration per id wins
 *  (a re-attached globe replaces its old closures rather than stacking them). */
export function registerDebugProvider(id: string, fn: () => DebugSnapshot): () => void {
  providers.set(id, fn);
  return () => {
    if (providers.get(id) === fn) providers.delete(id);
  };
}

/** Poll one provider. A throw reads as null — the panel shows the group as unreachable. */
export function readDebugProvider(id: string): DebugSnapshot | null {
  const fn = providers.get(id);
  if (!fn) return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

export function debugProviderIds(): string[] {
  return [...providers.keys()];
}

/** Register an on-demand heavy probe (a scene traversal). Returns the unregister. */
export function registerDebugAction(id: string, fn: () => unknown): () => void {
  actions.set(id, fn);
  return () => {
    if (actions.get(id) === fn) actions.delete(id);
  };
}

/** Run one action. A throw reads as `{ error }` — surfaced, never rethrown into the panel. */
export function runDebugAction(id: string): unknown {
  const fn = actions.get(id);
  if (!fn) return { error: `no action "${id}"` };
  try {
    return fn();
  } catch (e) {
    return { error: String(e) };
  }
}

export function debugActionIds(): string[] {
  return [...actions.keys()];
}

/**
 * Rate tracker for cumulative counters: feed it (key, absolute value, nowMs) each poll and it
 * returns the per-SECOND rate over the window since the previous poll — or null on the first
 * sample (an honest "no rate yet", never a giant since-page-load figure).
 * A counter that goes BACKWARD (a re-attach reset its closure) re-seats silently.
 */
export function makeRateTracker(): {
  rate: (key: string, value: number, nowMs: number) => number | null;
} {
  const last = new Map<string, { v: number; atMs: number }>();
  return {
    rate(key, value, nowMs) {
      const prev = last.get(key);
      last.set(key, { v: value, atMs: nowMs });
      if (!prev || nowMs <= prev.atMs || value < prev.v) return null;
      return ((value - prev.v) * 1000) / (nowMs - prev.atMs);
    },
  };
}

/** Test seam — wipe all state (rings, providers, actions, the active flag). */
export function __resetDebugFeedForTests(): void {
  feedActive = false;
  rings.clear();
  providers.clear();
  actions.clear();
}
