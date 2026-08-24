/**
 * Contention-normalised timing for the BEST SPOT perf pins.
 *
 * **WHY THIS EXISTS.** `npm test` runs ~12 vitest workers on the same CPU, so a wall-clock budget
 * asserted inside one of them is a claim about the RUNNER, not about the code. Measured 2026-08-24
 * on a box at load average 30+ (the full suite, a `wix dev` server and a CDP Chrome): the identical
 * solver reported a 3 m median of **646 ms standalone and 1,335-1,522 ms in-suite**, the fused pass
 * 462 ms against a 450 ms budget, and the `scoreMask` speedup 1.58× against a 1.7× floor it clears
 * at 1.80-1.91× standalone. Three red tests, zero regressions.
 *
 * Raising the budgets to fit the worst machine makes the numbers meaningless; leaving them makes
 * the suite flaky. So the budget stays exactly where the plan put it and the MEASUREMENT is
 * expressed in *reference-machine milliseconds* instead of wall-clock ones.
 *
 * **THE CALIBRATION MUST BE INTERLEAVED.** A single `machineK()` taken before a loop was measured
 * reporting `k = 1.04` while the solves it was meant to normalise ran at a median of 1,335 ms —
 * vitest's other workers happened to be between files at that instant. Contention is bursty, so the
 * only honest unit is the machine's throughput *during the sample being normalised*. Every helper
 * here samples it per-iteration.
 *
 * **AND IT MUST BE LONG ENOUGH TO BE PREEMPTED — THIS IS THE PART THAT WAS STILL WRONG.** The first
 * form of `spin()` ran 4 M iterations (~3.5 ms) and was measured reporting `k = 1.00` while the
 * solves it was normalising ran at 2.78× their standalone cost. Interleaving was not the whole
 * story: a 3.5 ms workload FITS INSIDE ONE SCHEDULER QUANTUM, so it is almost never descheduled,
 * while a 600 ms solve is descheduled dozens of times. The ruler was structurally blind to the only
 * kind of contention that matters here. MEASURED 2026-08-24 — identical arithmetic, one box, one
 * load (12 vitest workers + 10 spinners on 12 cores, load average ~110):
 *
 * | iterations | quiet    | loaded   | reported k |
 * |------------|----------|----------|------------|
 * | 4 M        |   3.6 ms |   3.6 ms | **1.00**   |
 * | 8 M        |   7.2 ms |   7.3 ms | **1.00**   |
 * | 16 M       |  14.4 ms |  14.4 ms | **1.00**   |
 * | 32 M       |  36.9 ms |  64.3 ms | **1.74**   |
 * | 64 M       |  67.5 ms | 135.7 ms | **2.01**   |
 * | 128 M      | 144.9 ms | 257.6 ms | **1.78**   |
 *
 * The ruler reads exactly 1.00 — no contention whatsoever — until it runs longer than ~15 ms, and
 * then it works. So `spin()` is 32 M iterations: the first size that measures anything, and the
 * cheapest one that does. It still UNDER-reports (a 100 MB streaming pass over the same window read
 * 1.69, and the solver — 101 MiB of resident hulls — took 2.78×, because register-only arithmetic
 * cannot see memory-bandwidth contention). Under-reporting is the safe direction: it leaves every
 * budget STRICTER than the machine deserves, never looser.
 *
 * A solver regression still fails: `spin()` does not get slower when the solver does.
 */

/** Reference cost (ms) of `spin()` on a quiet M3 Pro, node v20.19. The calibration's unit.
 *
 *  MEASURED 2026-08-24 at `best of 11 = 26.80 ms`, and quoted 4 % ABOVE that on purpose — as
 *  exactly 8 × the 3.5 ms the 4 M form was measured at — because `k = dt / reference`: a reference
 *  set at the optimistic end inflates `k`, and an inflated `k` dissolves the budget it divides.
 *  Rounding the reference UP keeps every pin on the strict side of the truth. */
export const SPIN_REFERENCE_MS = 28;

/** Clamp: never tighten below the shipped budget, never let a slow box dissolve the pin entirely. */
export const MACHINE_K_MAX = 8;

/** A fixed, allocation-free arithmetic workload. Returns a checksum so it cannot be optimised out.
 *  32 M iterations ≈ 27 ms — see the table above for why anything shorter reports `k = 1.00` on a
 *  box that is demonstrably 2× oversubscribed. */
export function spin(): number {
  let acc = 0;
  for (let i = 1; i <= 32_000_000; i++) acc += Math.sqrt(i) / (i + 1);
  return acc;
}

/** How much slower this process is running than the reference machine, right now, from ONE `spin()`. */
export function machineK(): number {
  const t0 = performance.now();
  const sum = spin();
  const dt = performance.now() - t0;
  // Guard the guard: if the loop were ever optimised away the checksum collapses and the
  // calibration would silently report a superhuman machine, dissolving every budget that uses it.
  if (!Number.isFinite(sum) || sum <= 0) throw new Error("calibration loop did not run");
  return Math.min(MACHINE_K_MAX, Math.max(1, dt / SPIN_REFERENCE_MS));
}

/** Nearest-rank quantile. At `q = 0.95` with N < 20 this IS the maximum, and it is reported as such
 *  rather than smoothed into something that sounds better than it is. */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

export interface NormalisedTiming {
  /** Raw wall-clock samples (ms) — what the machine actually did. */
  readonly rawMs: readonly number[];
  /** Samples in REFERENCE-machine ms — what the budget is asserted against. */
  readonly refMs: readonly number[];
  /**
   * The per-iteration calibration factors, in iteration order.
   *
   * Published because some budgets are on a phase the caller cannot wrap a timer around — the
   * fused pass reports `timings.scoreMs` from INSIDE `solveTerms` — and those inner numbers have
   * to ride the SAME per-iteration contention factor as the wall clock they were measured under,
   * not a second calibration taken at some other instant.
   */
  readonly ks: readonly number[];
  readonly medianRefMs: number;
  readonly p95RefMs: number;
  readonly medianRawMs: number;
  readonly medianK: number;
  readonly maxK: number;
  /** One line, ready to `console.log` — the measurement IS the deliverable. */
  readonly line: string;
}

/**
 * Run `fn` `n` times, calibrating immediately before each run, and report both scales.
 * `setup` runs OUTSIDE the timed region (use it for a fresh `Resident` on a cold-solve pin).
 */
export function timeNormalised(
  label: string,
  n: number,
  fn: (i: number) => void,
  setup?: (i: number) => void,
): NormalisedTiming {
  const rawMs: number[] = [];
  const refMs: number[] = [];
  const ks: number[] = [];
  for (let i = 0; i < n; i++) {
    setup?.(i);
    const k = machineK(); // sampled HERE, against this iteration's contention
    ks.push(k);
    const t0 = performance.now();
    fn(i);
    const dt = performance.now() - t0;
    rawMs.push(dt);
    refMs.push(dt / k);
  }
  const medianRefMs = quantile(refMs, 0.5);
  const p95RefMs = quantile(refMs, 0.95);
  const medianRawMs = quantile(rawMs, 0.5);
  const medianK = quantile(ks, 0.5);
  const maxK = quantile(ks, 1);
  return {
    rawMs,
    refMs,
    ks,
    medianRefMs,
    p95RefMs,
    medianRawMs,
    medianK,
    maxK,
    line:
      `[${label}] n=${n}: raw median ${medianRawMs.toFixed(1)} ms · ` +
      `NORMALISED median ${medianRefMs.toFixed(1)} · p95 ${p95RefMs.toFixed(1)} ref-ms · ` +
      `machineK median ${medianK.toFixed(2)} max ${maxK.toFixed(2)}`,
  };
}

export interface RatioTiming {
  readonly medianRatio: number;
  readonly ratios: readonly number[];
  /** Raw wall-clock ms of the SLOW arm, per round — reported so the log carries the measurement
   *  and not only the conclusion. */
  readonly slowMs: readonly number[];
  /** Raw wall-clock ms of the FAST arm, per round. */
  readonly fastMs: readonly number[];
  readonly line: string;
}

/**
 * The median of PER-ROUND ratios of `slow` to `fast`, measured INTERLEAVED.
 *
 * A ratio is self-normalising only when both arms meet the same contention, which a single round
 * does not guarantee — measured, one round reported 1.58× for a speedup that repeats at 1.80-1.91×.
 * Interleaving and taking the median across rounds is strictly more robust than one round, not
 * looser: the threshold is unchanged.
 */
export function timeRatio(
  label: string,
  rounds: number,
  slow: () => void,
  fast: () => void,
): RatioTiming {
  const ratios: number[] = [];
  const slowMs: number[] = [];
  const fastMs: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const a0 = performance.now();
    slow();
    const a = performance.now() - a0;
    const b0 = performance.now();
    fast();
    const b = performance.now() - b0;
    slowMs.push(a);
    fastMs.push(b);
    ratios.push(a / Math.max(1e-6, b));
  }
  const medianRatio = quantile(ratios, 0.5);
  return {
    medianRatio,
    ratios,
    slowMs,
    fastMs,
    line:
      `[${label}] ${rounds} interleaved rounds: raw medians slow ` +
      `${quantile(slowMs, 0.5).toFixed(2)} ms / fast ${quantile(fastMs, 0.5).toFixed(2)} ms · ` +
      `NORMALISED (self, per round) median ${medianRatio.toFixed(2)}× · ` +
      `min ${quantile(ratios, 0).toFixed(2)}× · max ${quantile(ratios, 1).toFixed(2)}×`,
  };
}
