/**
 * InfoDot — the dedicated 13px "i" badge for flow-level explanations (tips batch 2026-07-11).
 * Renders a tips.css-anchored tip (pseudo-element, works inside backdrop-filtered cards) on
 * hover and keyboard focus. Control-level hover tips use `class="tip" data-tip` directly;
 * this dot is for the ONE per-panel "what is this flow" note. Styled in styles/tips.css.
 */

import "../../styles/tips.css";

export type TipPos = "up" | "down" | "left" | "right";

export interface InfoDotProps {
  /** The explanation (≤ ~180 chars, sentence case allowed). */
  tip: string;
  /** Tip placement relative to the dot — default up. */
  pos?: TipPos;
  /** aria-label prefix; the tip text is appended so screen readers get the full note. */
  label?: string;
}

export default function InfoDot({ tip, pos, label = "About this control" }: InfoDotProps) {
  return (
    <span
      role="note"
      tabIndex={0}
      className="tip infodot"
      data-tip={tip}
      data-tip-pos={pos}
      aria-label={`${label}: ${tip}`}
    >
      i
    </span>
  );
}
