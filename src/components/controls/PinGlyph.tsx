/**
 * PinGlyph (T189, owner 2026-10-22g) — the LOCATION-PIN icon shared by both shells: the camera
 * panel's MY SPOT cell (T180, `panels/CameraTiltPanel.tsx`), the /m 🧭 MY LOC cell
 * (`mobile/SceneActions.tsx`) and the FPV minimap's re-centre button (`panels/MapWindow.tsx`)
 * draw the SAME outline pin with a dot; the GL place markers (`scene/placeMarkers.ts`) and the 2D
 * map's place layer draw it on a canvas. A member of the `components/controls/**` tier
 * (`test/components/mobileFence.test.ts` rule 3): a pure leaf — react only, class names only; the
 * CONSUMER styles `pinClassName` / `dotClassName` (stroke / fill in `currentColor`), so the icon
 * takes the cell's colour and no font decides how it looks.
 */

import type { ReactElement } from "react";

/** The pin body (a 24-grid SVG path): the head is a 6.5-radius circle at (12, 9), the point at (12, 21.5). */
export const PIN_GLYPH_PATH = "M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5 12.5s6.5-7.9 6.5-12.5A6.5 6.5 0 0 0 12 2.5z";
/** The dot inside the head. */
export const PIN_GLYPH_DOT = { cx: 12, cy: 9, r: 2.3 } as const;

export function PinGlyph({
  className,
  pinClassName,
  dotClassName,
}: {
  className: string;
  /** Defaults to `${className}-pin` / `${className}-dot`. */
  pinClassName?: string;
  dotClassName?: string;
}): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className={pinClassName ?? `${className}-pin`} d={PIN_GLYPH_PATH} />
      <circle className={dotClassName ?? `${className}-dot`} cx={PIN_GLYPH_DOT.cx} cy={PIN_GLYPH_DOT.cy} r={PIN_GLYPH_DOT.r} />
    </svg>
  );
}
