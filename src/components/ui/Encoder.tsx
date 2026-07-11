/**
 * Instrument encoder — a spring-centred RATE control (Phase 5.5 S2, owner item 14). Where the
 * board-04 Slider sets an absolute value, the encoder sets a VELOCITY: the knob rests centre;
 * horizontal deflection maps through an expo curve to a rate (fine control near centre, speed at
 * the ends); release springs the knob back and reports null — the consumer eases the motion out.
 * Keyboard: hold ←/→ for a steady quarter-rate; releasing the key stops.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { BadgeTone } from "./Slider";
import type { TipPos } from "./InfoDot";
import "../../styles/tips.css";

export interface EncoderProps {
  label: string;
  /** Mono readout at the row's right edge — the LIVE mirror (heading °, altitude), pre-formatted. */
  formatted: string;
  /** Rate at full deflection (units/s, sign follows deflection: right = positive). */
  maxRate: number;
  /** Expo response: rate = maxRate · sign(d) · |d|^gamma. */
  expoGamma: number;
  /** Deflection rate while deflected; null on release (spring back, motion eases out). */
  onRate: (rate: number | null) => void;
  /** Double-click / Backspace reset (e.g. back to the EXIF baseline) — optional. */
  onReset?: () => void;
  badge?: { text: string; tone: BadgeTone };
  /** Hover tip on the whole row (tips.css — delayed glass pill). */
  tip?: string;
  /** Tip placement — default up. */
  tipPos?: TipPos;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export default function Encoder({
  label,
  formatted,
  maxRate,
  expoGamma,
  onRate,
  onReset,
  badge,
  tip,
  tipPos,
}: EncoderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [deflection, setDeflection] = useState(0); // −1..1, 0 = at rest
  const [dragging, setDragging] = useState(false);

  const rateFor = (d: number): number => maxRate * Math.sign(d) * Math.abs(d) ** expoGamma;

  const deflectTo = (clientX: number): void => {
    const rect = trackRef.current!.getBoundingClientRect();
    const d = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    setDeflection(d);
    onRate(rateFor(d));
  };

  const release = (): void => {
    setDragging(false);
    setDeflection(0);
    onRate(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests) have no capturable id — the drag still works via move/up
    }
    setDragging(true);
    deflectTo(e.clientX);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") onRate(-maxRate * 0.25);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") onRate(maxRate * 0.25);
    else if ((e.key === "Backspace" || e.key === "Delete") && onReset) onReset();
    else return;
    e.preventDefault();
  };

  const knobPct = 50 + deflection * 50;
  const fillLeft = Math.min(50, knobPct);
  const fillWidth = Math.abs(knobPct - 50);

  return (
    <div
      className={`uf-slider ct-enc${dragging ? " is-live" : ""}${tip ? " tip" : ""}`}
      data-tip={tip}
      data-tip-pos={tip ? tipPos : undefined}
    >
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
        aria-label={`${label} rate`}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(deflection.toFixed(2))}
        aria-valuetext={formatted}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging && deflectTo(e.clientX)}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        onKeyUp={() => onRate(null)}
        onBlur={release}
      >
        <div className="uf-slider__rail" />
        <div className="ct-enc__centre" aria-hidden="true" />
        <div className="uf-slider__fill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
        <div className="uf-slider__knob" style={{ left: `${knobPct}%` }} />
      </div>
    </div>
  );
}
