/**
 * Instrument encoder — a spring-centred RATE control (Phase 5.5 S2, owner item 14). Where the
 * board-04 Slider sets an absolute value, the encoder sets a VELOCITY: the knob rests centre;
 * horizontal deflection maps through an expo curve to a rate (fine control near centre, speed at
 * the ends); release springs the knob back and reports null — the consumer eases the motion out.
 * Keyboard: hold ←/→ for a steady quarter-rate; releasing the key stops.
 *
 * 2026-09-08b: the implementation moved to the SHARED tier (`controls/RateEncoder`) so the /m
 * shell can drive the BEST SPOT sheet altitude with the same instrument — this module is the
 * desktop's typed door onto it (the `ui/` badge and tip types are the structural ones, named).
 */

import RateEncoder from "../controls/RateEncoder";
import type { BadgeTone } from "./Slider";
import type { TipPos } from "./InfoDot";

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

export default function Encoder(props: EncoderProps) {
  return <RateEncoder {...props} />;
}
