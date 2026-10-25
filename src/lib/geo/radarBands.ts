/**
 * THE radar band model — one allocation, three surfaces (audit #3 A1-7 → T35, 2026-08-22).
 *
 * The concentric annular bands (owner batch #4 S2, reordered + compacted batch #6) are drawn by
 * the GL fan (`scene/aimCones`), the expanded chart (`panels/MapWindow`) and the FPV mini-map
 * (`panels/MiniMap`). `AIMCONES` was always the single source of the NUMBERS, but the mapping
 * from body → band, and the /m inward shift that goes with it, shipped as THREE hand-maintained
 * `bandFor` copies with no cross-file fence — plus two copies of the future-ink rule. Track E's
 * jscpd only saw the tip of it; the audit quantified the rest.
 *
 * Extract-then-delegate (Gall): the bodies below are byte-for-byte what `scene/aimCones`
 * shipped. `aimCones` re-exports them so its own consumers are unchanged, and the two panels
 * import from here instead of re-declaring. `test/lib/geo/radarBands.test.ts` fences the copies
 * from coming back.
 *
 * Pure and three-free — `lib/` may hold the model, `scene/` holds the geometry that draws it.
 */

import { AIMCONES, FOCALCONE } from "../../components/globe/tuning";
import { tokens } from "../theme/tokens";

/** The three bodies a radar surface can carry a band for. */
export type RadarBandKey = "target" | "sun" | "moon";

/** Per-body annular band `[inner, outer]` as unit-radius fractions. On /m the whole stack sits
 *  ~20 % closer to the centre (owner batch #5 item 2) — same widths and same order. */
export function bandFor(key: RadarBandKey, mobile = false): readonly [number, number] {
  return key === "sun"
    ? mobile
      ? AIMCONES.bandSunMobile
      : AIMCONES.bandSun
    : key === "moon"
      ? mobile
        ? AIMCONES.bandMoonMobile
        : AIMCONES.bandMoon
      : mobile
        ? AIMCONES.bandTargetMobile
        : AIMCONES.bandTarget;
}

/** Band FUTURE ink per body (owner item 17, 2026-08-21b): the sun/moon bands wear their BODY
 *  colour on the still-to-come part (sunGlow / moonDial silver) against the shared inert-grey
 *  past; the target band keeps the scrubber future-blue. */
export function bandFutureInk(key: RadarBandKey): string {
  return key === "sun" ? tokens.sunGlow : key === "moon" ? tokens.moonDial : tokens.timeFuture;
}

/** The STROKE profile of a radar surface — weight + ink multipliers. */
export interface RadarStroke {
  /** Stroke width multiplier (screen CSS px on a canvas, the quad width on the GL fan). */
  widthK: number;
  /** Direction-line (and the focal cone's boundary rays) alpha multiplier. */
  lineAlphaK: number;
  /** Rim arc + rise/set spoke alpha multiplier. */
  rimAlphaK: number;
  /** Band fill alpha multiplier. */
  fillAlphaK: number;
}

const DESKTOP_STROKE: RadarStroke = Object.freeze({
  widthK: 1,
  lineAlphaK: 1,
  rimAlphaK: 1,
  fillAlphaK: 1,
});

/** The stroke profile for a shell (owner 2026-10-10, iPhone 17 Pro: "radar lines too narrow …
 *  thicker and more vivid, still tasteful"): `AIMCONES.mobileStroke` on /m, the identity on
 *  desktop. Every radar surface — both canvases AND the GL fan (+ the focal cone's rays) — reads
 *  it, so a weight or an ink change reaches all of them at once. Pure. */
export function radarStroke(mobile: boolean): RadarStroke {
  return mobile ? AIMCONES.mobileStroke : DESKTOP_STROKE;
}

/** The GL fan's stroke weights, in SCREEN CSS px. */
export interface FanStrokeCssPx {
  /** The direction lines (the sun / moon dials, the target's tracking ray). */
  line: number;
  /** The rim arcs + the rise/set spokes. */
  rim: number;
  /** The focal cone's two boundary rays. */
  cone: number;
}

/**
 * The GL fan's stroke weights at the nadir map view, in SCREEN CSS px (owner 2026-10-25, iPhone 17 Pro:
 * "radar lines — the radar itself, the focus cone, the direction lines — have different thickness on the
 * main map and the FPV mini-map; I like the increased thickness from the main map, make it exactly the
 * same in the mini-map"). The fan's quads are RADIUS fractions — `AIMCONES.lineHalfWidthK`,
 * `AIMCONES.rimHalfWidthK`, the cone's `FOCALCONE.edgeHalfWidthK` over its ray-extended reach
 * (`AIMCONES.rayLenK`) — times the shell's `widthK`; inside its clamp band the fan's radius at nadir is
 * the chart's fraction-of-height rule (`AIMCONES.mapRadiusHK`, × `mobileRadiusK` on /m — "the GL fan
 * resolves to ≈1.02 × the viewport half-height"). Measured on the iPhone twin's glass before this mirror:
 * the fan's ray 2.7–3.4 CSS px and its cone legs 4.2 against the mini-map's 1.4–1.7 and 2.1. A canvas
 * that hands these to `drawRadarCanvas` (`strokeCssPx`) draws the fan's weights for ITS viewport. The match
 * is the NOMINAL one — the fan at nadir, well above the ground, inside its radius clamp (150 m – 12 km);
 * a street-zoom fan on the 150 m floor reads ~25 % heavier, a tilted or high one lighter — the fan is
 * hidden in FPV, so there is no live fan to copy and the nominal rule is the honest mirror. Pure.
 */
export function fanStrokeCssPx(viewHeightCssPx: number, mobile: boolean): FanStrokeCssPx {
  const r = viewHeightCssPx * AIMCONES.mapRadiusHK * (mobile ? AIMCONES.mobileRadiusK : 1);
  const k = radarStroke(mobile).widthK;
  return {
    line: 2 * AIMCONES.lineHalfWidthK * k * r,
    rim: 2 * AIMCONES.rimHalfWidthK * k * r,
    cone: 2 * FOCALCONE.edgeHalfWidthK * AIMCONES.rayLenK * k * r,
  };
}
