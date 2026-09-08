/**
 * useRateIntegrator (owner 2026-09-08b) — the consumer half of the spring-centred encoder for a
 * value that lives in a STORE rather than in the orchestrator: the BEST SPOT sheet altitude on
 * both shells. `controls/RateEncoder` emits a rate (units/s, null on release); this hook eases
 * it (`CONTROLS.rateEaseTauMs`, the orchestrator's `stepEncoderRates` idiom — release coasts out,
 * it never stops dead) and integrates it every animation frame as an EXPONENTIAL step with a
 * floor: `v += rate · dt · max(v, baseM)` — the log character the old slider had (fine near the
 * ground, fast aloft), clamped to [min, max]. The loop runs only while there is motion to
 * integrate; at rest it costs nothing.
 *
 * The step is pure (`stepRateValue`) so the DOM-less vitest can pin the feel: the deadband, the
 * clamp, the exponential shape, the coast-out.
 */

import { useEffect, useRef } from "react";
import { CONTROLS } from "../globe/tuning";

export interface RateIntegratorConfig {
  /** Exponential step floor (units) — below it the step is linear at `rate · dt · baseM`. */
  baseM: number;
  min: number;
  max: number;
  /** Ease time constant (ms) — defaults to the orchestrator's `CONTROLS.rateEaseTauMs`. */
  tauMs?: number;
  /** Below this |eased rate| the loop parks (defaults to `CONTROLS.rateDeadbandLog`). */
  deadband?: number;
}

export interface RateIntegratorState {
  /** The eased (applied) rate. */
  applied: number;
}

/** One frame: ease the commanded rate into `applied`, then step `value` by it. Pure. */
export function stepRateValue(
  value: number,
  state: RateIntegratorState,
  rate: number | null,
  dtMs: number,
  cfg: RateIntegratorConfig,
): { value: number; applied: number; moving: boolean } {
  const tau = cfg.tauMs ?? CONTROLS.rateEaseTauMs;
  const deadband = cfg.deadband ?? CONTROLS.rateDeadbandLog;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  let applied = state.applied + ((rate ?? 0) - state.applied) * k;
  if (rate === null && Math.abs(applied) <= deadband) applied = 0;
  const moving = rate !== null || applied !== 0;
  let next = value;
  if (Math.abs(applied) > deadband) {
    next = Math.min(cfg.max, Math.max(cfg.min, value + ((applied * dtMs) / 1000) * Math.max(value, cfg.baseM)));
  }
  return { value: next, applied, moving };
}

/**
 * Returns the `onRate` handler for a `RateEncoder`. `read` / `write` address the store value;
 * both are read through refs so the loop never closes over a stale render.
 */
export function useRateIntegrator(
  read: () => number,
  write: (v: number) => void,
  cfg: RateIntegratorConfig,
): (rate: number | null) => void {
  const readRef = useRef(read);
  const writeRef = useRef(write);
  const cfgRef = useRef(cfg);
  readRef.current = read;
  writeRef.current = write;
  cfgRef.current = cfg;
  const rate = useRef<number | null>(null);
  const applied = useRef(0);
  const raf = useRef<number | null>(null);
  const lastT = useRef(0);
  // The integrator's OWN continuous position, seeded from the store when a gesture starts. The
  // store may quantise or snap what it is handed (BEST SPOT's `clampLiftM` snaps a lift under
  // 0.5 m to exactly 0) — integrating the store's echo would park a slow climb at the snap.
  const pos = useRef(0);

  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    applied.current = 0;
  };
  useEffect(() => stop, []);

  const tick = (t: number) => {
    raf.current = null;
    const dt = lastT.current === 0 ? 16 : Math.min(100, t - lastT.current);
    lastT.current = t;
    const r = stepRateValue(pos.current, { applied: applied.current }, rate.current, dt, cfgRef.current);
    applied.current = r.applied;
    if (r.value !== pos.current) {
      pos.current = r.value;
      writeRef.current(r.value);
    }
    if (r.moving) raf.current = requestAnimationFrame(tick);
    else lastT.current = 0;
  };

  return (next: number | null) => {
    rate.current = next;
    if (raf.current === null) {
      lastT.current = 0;
      pos.current = readRef.current();
      raf.current = requestAnimationFrame(tick);
    }
  };
}
