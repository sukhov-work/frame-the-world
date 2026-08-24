/**
 * Shared instrument slider (BESTSPOT S5, `SPEC_V2 §6.9`) — the third member of the
 * `components/controls/**` tier (`test/components/mobileFence.test.ts` rule 3: react + stores +
 * `lib/**` + `styles/**` + `globe/tuning` ONLY).
 *
 * WHY IT IS A RE-IMPLEMENTATION AND NOT A WRAPPER. The shipped `ui/Slider.tsx` has exactly the feel
 * this needs — 2 px rail, glowing accent fill, 12 px knob, `ew-resize` drag, double-click reset,
 * `role="slider"` with arrows + Home/End. But `ui/**` is desktop chrome and the fence forbids this
 * tier from importing it, so the GRAMMAR is re-implemented here from its CLASS NAMES (`.uf-slider*`,
 * owned by `styles/upload-flow.css`) and nothing else. The stylesheet itself is imported by the
 * CONSUMER (the `FindPanel` → `plan-panel.css` precedent) so a shared leaf never drags a desktop
 * card's CSS into `/m`.
 *
 * Two things this adds over `ui/Slider`, both required by the SHEET ALTITUDE control:
 *   1. **A LOG domain.** 1.7 → 400 m linear puts every pedestrian value in the first 0.4 % of the
 *      rail. `log` maps by ratio, so the walk from 2 m to 20 m gets the same travel as 20 → 200.
 *   2. **A normalised keyboard step.** With a log domain a fixed `step` in metres is meaningless —
 *      one arrow press moves a fraction of the RAIL, which is the same gesture at both ends.
 *
 * HOOK-FREE ON PURPOSE. Drag state lives in the browser's own pointer capture and the value lives in
 * the caller's store, so this is a plain function — which is what lets a test call it and invoke
 * `onKeyDown` / `onDoubleClick` off the returned element tree. vitest here has no DOM (no jsdom, no
 * testing-library), so a component with hooks can only ever be string-rendered, and a keyboard
 * contract that is only string-rendered is not tested at all.
 */

import type { KeyboardEvent, PointerEvent } from "react";

/** One arrow press = this fraction of the rail. 1/50 gives ~1.1 m at the pedestrian end of the
 *  1.7–400 m log rail and ~8 m at the top — a nudge at both ends, which is the point of the log. */
const DEFAULT_STEP_NORM = 1 / 50;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Value → rail position 0..1. Log domains map by RATIO (`min` must be > 0 — the caller's job;
 *  a non-positive `min` falls back to linear rather than returning NaN into an aria attribute). */
export function sliderNorm(value: number, min: number, max: number, log: boolean): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  if (log && min > 0) return clamp01(Math.log(Math.max(value, min) / min) / Math.log(max / min));
  return clamp01((value - min) / (max - min));
}

/** Rail position 0..1 → value. The exact inverse of `sliderNorm`, so a round trip is stable. */
export function sliderValue(norm: number, min: number, max: number, log: boolean): number {
  const t = clamp01(norm);
  if (!(max > min)) return min;
  if (log && min > 0) return min * Math.pow(max / min, t);
  return min + t * (max - min);
}

/**
 * The keyboard contract, as a pure function so it can be tested without a DOM: the NEXT rail
 * position for a key, or `null` when the key is not ours (so the component knows to let it through).
 *
 * Arrows step by `stepNorm`; Home/End jump to the ends. Up/Right increase, Down/Left decrease —
 * the `ui/Slider` mapping, kept identical on purpose: one slider feel across the instrument.
 */
export function sliderKeyNorm(key: string, norm: number, stepNorm: number): number | null {
  if (key === "ArrowLeft" || key === "ArrowDown") return clamp01(norm - stepNorm);
  if (key === "ArrowRight" || key === "ArrowUp") return clamp01(norm + stepNorm);
  if (key === "Home") return 0;
  if (key === "End") return 1;
  return null;
}

export interface InstrumentSliderProps {
  label: string;
  /** Already-formatted readout at the row's right edge — the component never formats a unit. */
  formatted: string;
  value: number;
  min: number;
  max: number;
  /** Map by ratio rather than by difference. Requires `min > 0`. */
  log?: boolean;
  /** Arrow-key travel as a fraction of the rail (default 1/50). */
  stepNorm?: number;
  onChange: (value: number) => void;
  /** Double-click / Backspace / Delete — the caller's baseline, whatever that means to it. */
  onReset: () => void;
  /** Small caps flag beside the label (`▲ DRONE` once the sheet leaves pedestrian rules). */
  badge?: string;
  badgeTone?: "accent" | "warn" | "dim";
  /** Screen-reader name; defaults to `label`. */
  ariaLabel?: string;
}

export default function InstrumentSlider({
  label,
  formatted,
  value,
  min,
  max,
  log = false,
  stepNorm = DEFAULT_STEP_NORM,
  onChange,
  onReset,
  badge,
  badgeTone = "accent",
  ariaLabel,
}: InstrumentSliderProps) {
  const norm = sliderNorm(value, min, max, log);
  const pct = norm * 100;

  const emitFromClientX = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return;
    onChange(sliderValue((clientX - r.left) / r.width, min, max, log));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (test dispatch) have no capturable id — the press still lands
    }
    emitFromClientX(e.currentTarget, e.clientX);
  };

  // Capture IS the drag state (the `Joystick` pointer-capture idiom without its ref): while the
  // track holds the pointer every move is ours, and a pointer that escaped the window is not.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    let held = false;
    try {
      held = e.currentTarget.hasPointerCapture(e.pointerId);
    } catch {
      held = false;
    }
    if (held) emitFromClientX(e.currentTarget, e.clientX);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // never captured — nothing to release
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = sliderKeyNorm(e.key, norm, stepNorm);
    if (next !== null) {
      onChange(sliderValue(next, min, max, log));
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      onReset();
      e.preventDefault();
    }
  };

  return (
    <div className="uf-slider">
      <div className="uf-slider__head">
        <span className="uf-slider__label">
          {label}
          {badge && <span className={`uf-badge uf-badge--${badgeTone}`}>{badge}</span>}
        </span>
        <span className="uf-slider__value">{formatted}</span>
      </div>
      <div
        className="uf-slider__track"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatted}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
      >
        <div className="uf-slider__rail" />
        <div className="uf-slider__fill" style={{ width: `${pct}%` }} />
        <div className="uf-slider__knob" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}
