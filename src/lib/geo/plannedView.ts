/**
 * Planned-view math (owner batch #4 S2, 2026-08-21) — pure helpers behind the "focal cone
 * everywhere" feature. The planned view is a heading + HORIZONTAL fov pair in the camera
 * store (session-only): outside FPV the focal cone on the globe / MapWindow / minimap draws
 * it, and the on-screen aim joystick steers it through rate seams with the same expo +
 * low-pass feel as the FPV encoder knobs (ui/Encoder.tsx + the orchestrator's
 * stepEncoderRates/stepFocalEncoder). Inside FPV the cone mirrors fpvHud and the joystick
 * writes the real camera's rate seams instead. All pure — no three/DOM.
 */

import { norm360 } from "../ephemeris/azSector";

const DEG = Math.PI / 180;

/** Horizontal FOV from a camera's VERTICAL fov + aspect (deg) — the U3 view-cone width.
 *  Canonical home since batch #4 S2 (scene/minimapFeed re-exports it — pure, unit-tested). */
export function horizontalFovDeg(vFovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vFovDeg * DEG) / 2) * aspect)) / DEG;
}

/** 35mm-equivalent focal length (mm) for a HORIZONTAL fov — full-frame width 36 mm, the
 *  photographer's number (batch #6 item 3: the aim stick's readout). Pure — unit-tested. */
export function focalMmFromHFov(hFovDeg: number): number {
  return 18 / Math.tan((hFovDeg * DEG) / 2);
}

/** Encoder expo curve (ui/Encoder.tsx rateFor): deflection −1..1 → signed rate; γ > 1 bends
 *  small deflections toward fine control (the desktop knobs ship γ 2.2). */
export function stickRate(deflection: number, maxRate: number, gamma: number): number {
  const d = Math.max(-1, Math.min(1, deflection));
  return maxRate * Math.sign(d) * Math.abs(d) ** gamma;
}

export interface PlannedViewState {
  headingDeg: number;
  hFovDeg: number;
}

/**
 * The RANGE CONTRACT for a stored planned view (audit #3 A2-3 / T39, 2026-08-22).
 *
 * `hFovDeg` was clamped in only 3 of its 7 writers — the photo seed, `integratePlanned` and the
 * placed-photo seed that duplicated it. The other four (the FPV-jump seed, the two FPV-exit
 * continuity seeds and the boot seed) piped `horizontalFovDeg(vFov, aspect)` straight through,
 * and the FPV vertical band widens hard at extreme aspects: measured breaches were **1.27°** (/m
 * portrait, aspect 0.46, at max zoom-in) and **122.4°** (landscape, aspect 2.17, at min zoom) —
 * both outside `FOCALCONE.minHFovDeg 3 / maxHFovDeg 120`, drawing an out-of-band cone on all
 * three radar surfaces and a ~1624 mm reading on the aim stick's mm footer.
 *
 * Applied ONCE, at `store/camera.setPlannedView` — every writer goes through that seam, so a
 * future eighth writer inherits the contract instead of re-deriving it. Non-finite input falls
 * back to the band midpoint rather than poisoning the cone geometry with NaN.
 */
export function clampPlannedView(
  v: PlannedViewState,
  minHFovDeg: number,
  maxHFovDeg: number,
): PlannedViewState {
  const h = Number.isFinite(v.hFovDeg)
    ? Math.min(maxHFovDeg, Math.max(minHFovDeg, v.hFovDeg))
    : (minHFovDeg + maxHFovDeg) / 2;
  const heading = Number.isFinite(v.headingDeg) ? norm360(v.headingDeg) : 0;
  return heading === v.headingDeg && h === v.hFovDeg ? v : { headingDeg: heading, hFovDeg: h };
}

export interface PlannedIntegration extends PlannedViewState {
  /** Low-passed applied rates — feed back on the next call (release eases out, never snaps). */
  appliedHeadingDegPerS: number;
  appliedHFovPerS: number;
}

/**
 * One integration step: commanded rates (0 when the stick is released) are low-passed with
 * the FPV encoders' time constant, then heading advances linearly (wraps 360) and hFov moves
 * in LOG space (rate + = zoom IN / narrower, the fovRatePerS convention) clamped to
 * [minHFovDeg, maxHFovDeg].
 */
export function integratePlanned(
  prev: PlannedIntegration,
  commandedHeadingDegPerS: number,
  commandedHFovPerS: number,
  dtMs: number,
  tauMs: number,
  minHFovDeg: number,
  maxHFovDeg: number,
): PlannedIntegration {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
  const appliedH =
    prev.appliedHeadingDegPerS + (commandedHeadingDegPerS - prev.appliedHeadingDegPerS) * k;
  const appliedF = prev.appliedHFovPerS + (commandedHFovPerS - prev.appliedHFovPerS) * k;
  const dtS = dtMs / 1000;
  return {
    headingDeg: norm360(prev.headingDeg + appliedH * dtS),
    hFovDeg: Math.min(
      maxHFovDeg,
      Math.max(minHFovDeg, prev.hFovDeg * Math.exp(-appliedF * dtS)),
    ),
    appliedHeadingDegPerS: appliedH,
    appliedHFovPerS: appliedF,
  };
}

/** Both applied rates decayed below moving — the release ease-out has finished. */
export function plannedAtRest(s: PlannedIntegration, epsilon = 0.01): boolean {
  return Math.abs(s.appliedHeadingDegPerS) < epsilon && Math.abs(s.appliedHFovPerS) < epsilon;
}
