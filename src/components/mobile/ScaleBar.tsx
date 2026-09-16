/**
 * ScaleBar (owner 2026-09-16) — the /m 2D map's scale bar, seated in the status strip's right
 * cluster (the rung the FPV HUD pill takes while a viewpoint is live). Reads the camera mirror's
 * centre-pixel metres-per-CSS-px (`mapScaleMPerPx`, exact at nadir), rounds it onto the 1/2/5
 * ladder (`lib/format/scaleBar`) and draws a bar exactly that many pixels wide. Shown ONLY in
 * the 2D map mode outside FPV (owner: "on the regular map, only in 2D"). Store + lib only (the
 * mobile fence); the CSS lives with the strip in styles/mobile/mobile.css.
 */

import { useCameraStore } from "../../store/camera";
import { scaleBarFor } from "../../lib/format/scaleBar";

/** The bar's pixel budget — under the strip's right third on a 360 px phone with the logo. */
export const SCALE_BAR_MAX_PX = 110;

export default function ScaleBar() {
  const mPerPx = useCameraStore((s) => s.mapScaleMPerPx);
  const bar = scaleBarFor(mPerPx ?? Number.NaN, SCALE_BAR_MAX_PX);
  if (!bar) return null;
  return (
    <span className="m-scalebar" role="img" aria-label={`Map scale: ${bar.label}`}>
      <span className="m-scalebar__label">{bar.label}</span>
      <span className="m-scalebar__bar" style={{ width: `${bar.px.toFixed(1)}px` }} />
    </span>
  );
}
