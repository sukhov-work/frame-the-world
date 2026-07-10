/**
 * Instrument slider — design board 04 idiom: 2px rail, glowing accent fill, 12px knob,
 * ew-resize pointer drag, **double-click resets to the EXIF value**. Keyboard-operable
 * (role="slider", arrows ± step, Home/End). An unset value (D4 missing field) renders
 * dimmed at the rail start until the first drag sets it.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type BadgeTone = "accent" | "warn" | "dim";

export interface SliderProps {
  label: string;
  /** Mono readout shown at the row's right edge (already formatted). */
  formatted: string;
  /** Current value; undefined = unset (missing from EXIF, not yet entered). */
  value?: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Double-click / Backspace — return to the EXIF baseline (or back to unset). */
  onReset: () => void;
  badge?: { text: string; tone: BadgeTone };
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export default function Slider({ label, formatted, value, min, max, step = 1, onChange, onReset, badge }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const pct = value === undefined ? 0 : clamp01((value - min) / (max - min)) * 100;

  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    const raw = min + clamp01((clientX - rect.left) / rect.width) * (max - min);
    const snapped = Math.round(raw / step) * step;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(valueFromClientX(e.clientX));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange(valueFromClientX(e.clientX));
  };

  const endDrag = () => setDragging(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = value ?? min;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(min, Number((base - step).toFixed(4))));
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, Number((base + step).toFixed(4))));
    else if (e.key === "Home") onChange(min);
    else if (e.key === "End") onChange(max);
    else if (e.key === "Backspace" || e.key === "Delete") onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div className={`uf-slider${value === undefined ? " uf-slider--unset" : ""}`}>
      <div className="uf-slider__head">
        <span className="uf-slider__label">
          {label}
          {badge && <span className={`uf-badge uf-badge--${badge.tone}`}>{badge.text}</span>}
        </span>
        <span className="uf-slider__value">{formatted}</span>
      </div>
      <div
        ref={trackRef}
        className="uf-slider__track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? min}
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
