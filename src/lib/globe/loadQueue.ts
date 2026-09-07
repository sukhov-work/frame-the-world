/**
 * T106 slice (b) (2026-09-07e) — the deferred `load-model` work queue. A tile's `load-model`
 * event used to do EVERYTHING for the cell in one synchronous handler — the crease edges, the
 * per-building edge attribution, the fingerprint pass, the banked-seat restore, the override
 * re-apply — and the biggest baked cell spent 65 ms of one frame on it on the phone twin
 * (MEASUREMENTS §23.4). The handler now registers the cell and swaps materials (phase 1, µs)
 * and pushes ONE unit per mesh onto this queue; `update()` drains the queue under a per-frame
 * TIME budget (phase 2). A unit is a small state machine (`step(deadlineMs)` → done?) whose
 * phases are each atomic — nothing half-registered is ever visible — and whose long loops honour
 * the deadline between chunks.
 *
 * Policy (pure, so vitest pins it):
 *   · every drain makes progress: the first unit's `step` ALWAYS runs, even with a zero budget
 *     (a budget can only bound the work, never starve it — the phone twin under 4× throttle
 *     would otherwise never register a cell);
 *   · after each step the deadline decides whether the next one runs this frame;
 *   · the unit picked is the one with the LOWEST `priority()` (the nearest / most-looked-at
 *     cell — the same law the download queue uses), re-evaluated per pick, so a landing burst
 *     registers what the viewer sees first; ties keep arrival order;
 *   · a unit that returned "not done" is STICKY: it is stepped again before any other, so at
 *     most ONE unit holds mid-flight state (a resumable builder's tables) at any time;
 *   · `cancel(key)` drops every unit of a key (the tile's scene on `dispose-model`) — a unit
 *     mid-flight is simply abandoned, its partial state garbage.
 */

export interface LoadUnit {
  /** Cancel handle — the tile's scene object. */
  readonly key: object;
  /** Lower runs first. Re-read at every pick, so it may follow the camera. */
  priority(): number;
  /**
   * Do work until done or `deadlineMs` (a `performance.now()` instant). MUST make progress on
   * every call, and MUST leave the world consistent whenever it returns — phases are atomic.
   * @returns true when the unit is finished and must be dropped.
   */
  step(deadlineMs: number): boolean;
}

export interface LoadQueueStats {
  /** Units still waiting (including a unit mid-flight). */
  pending: number;
  /** Drains that ran at least one step. */
  frames: number;
  /** Total ms spent inside `drain`. */
  ms: number;
  /** The worst single drain (ms) — the number the frame budget exists to bound. */
  maxFrameMs: number;
  /** Units finished. */
  done: number;
  /** Units dropped by `cancel`. */
  cancelled: number;
}

export interface LoadQueue {
  push(unit: LoadUnit): void;
  /** Drop every unit whose `key` matches. Returns how many were dropped. */
  cancel(key: object): number;
  /** Run units under `budgetMs` from `now()`. Returns the ms spent this drain (0 when idle). */
  drain(budgetMs: number): number;
  pending(): number;
  clear(): void;
  stats(): LoadQueueStats;
}

export function createLoadQueue(now: () => number = () => performance.now()): LoadQueue {
  const units: LoadUnit[] = [];
  let active: LoadUnit | null = null; // the unit mid-flight — stepped first
  const stats: LoadQueueStats = { pending: 0, frames: 0, ms: 0, maxFrameMs: 0, done: 0, cancelled: 0 };
  const pickIndex = (): number => {
    let best = 0;
    let bestP = units[0].priority();
    for (let i = 1; i < units.length; i++) {
      const p = units[i].priority();
      if (p < bestP) {
        bestP = p;
        best = i;
      }
    }
    return best;
  };
  return {
    push(unit) {
      units.push(unit);
      stats.pending = units.length;
    },
    cancel(key) {
      let n = 0;
      for (let i = units.length - 1; i >= 0; i--) {
        if (units[i].key === key) {
          if (units[i] === active) active = null;
          units.splice(i, 1);
          n++;
        }
      }
      stats.cancelled += n;
      stats.pending = units.length;
      return n;
    },
    drain(budgetMs) {
      if (units.length === 0) return 0;
      const t0 = now();
      const deadline = t0 + Math.max(0, budgetMs);
      // The first step is unconditional (progress); every later one is gated on the deadline.
      for (;;) {
        const i = active ? units.indexOf(active) : pickIndex();
        const unit = units[i];
        if (unit.step(deadline)) {
          units.splice(i, 1);
          stats.done++;
          active = null;
        } else {
          active = unit;
        }
        if (units.length === 0 || now() >= deadline) break;
      }
      const dt = now() - t0;
      stats.frames++;
      stats.ms += dt;
      if (dt > stats.maxFrameMs) stats.maxFrameMs = dt;
      stats.pending = units.length;
      return dt;
    },
    pending: () => units.length,
    clear() {
      stats.cancelled += units.length;
      units.length = 0;
      active = null;
      stats.pending = 0;
    },
    stats: () => ({ ...stats }),
  };
}
