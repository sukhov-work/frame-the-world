/**
 * Shared chip row (BESTSPOT S5, `SPEC_V2 §6.9`) — the second member of the `components/controls/**`
 * tier: input instruments whose FEEL must not fork between the desktop panels and the `/m` shell
 * (`test/components/mobileFence.test.ts` rule 3). Like `Joystick`, it is a **pure leaf**: it imports
 * `react` and CLASS NAMES only — no panel, no `ui/`, no mobile, no `three`, no colour literal. The
 * `.pp-chip` grammar it renders is owned by `styles/plan-panel.css`, which the CONSUMER imports (the
 * `FindPanel` → `plan-panel.css` precedent); this file must not reach for a stylesheet it does not
 * own, or the /m twin inherits a desktop card's CSS.
 *
 * It is also HOOK-FREE on purpose. A leaf with no hooks is a plain function, so a test can call it
 * and walk the returned element tree to invoke `onClick` — the repo has no DOM in vitest (no jsdom,
 * no testing-library), and that is the difference between a chip row whose click path is proven and
 * one that is merely rendered.
 *
 * Serves BOTH §6.9 chip rows: EVENT (4 kinds, sun/moon toned) and RADIUS (5 discs + the ULTRA
 * toggle, which rides in as `children` because it is a boolean, not a member of the ladder).
 */

import type { ReactNode } from "react";

export interface ChipOption<T> {
  /** The value picked. Also the React key (stringified) — so it must be unique in the row. */
  value: T;
  label: string;
  /** Small trailing cell in the `.pp-chip__kind` idiom (a unit, a glyph's word). */
  kind?: string;
  /** `.pp-chip--sun` / `.pp-chip--moon` — the day-arc colour grammar addressed BY NAME. A chip
   *  never carries a colour; `plan-panel.css` owns what those two words mean. */
  tone?: "sun" | "moon";
  /** Rendered but unpickable — e.g. R8's 1 m ULTRA above a 300 m radius. The chip STAYS so the
   *  ladder does not silently change shape; `title` is where the reason goes. */
  disabled?: boolean;
  title?: string;
}

export interface ChipRowProps<T> {
  options: readonly ChipOption<T>[];
  /** The picked value. `null` picks nothing — a row may legitimately have no selection. */
  value: T | null;
  onPick: (value: T) => void;
  ariaLabel: string;
  /** Extra chips appended INSIDE the row (the ULTRA toggle beside the radius ladder). */
  children?: ReactNode;
}

export default function ChipRow<T extends string | number>({
  options,
  value,
  onPick,
  ariaLabel,
  children,
}: ChipRowProps<T>) {
  return (
    <div className="pp-chips" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`pp-chip${on ? " pp-chip--on" : ""}${o.tone ? ` pp-chip--${o.tone}` : ""}`}
            aria-pressed={on}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onPick(o.value)}
          >
            {o.label}
            {o.kind && <span className="pp-chip__kind">{o.kind}</span>}
          </button>
        );
      })}
      {children}
    </div>
  );
}
