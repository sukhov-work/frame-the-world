import type { AimSample } from "../../lib/ephemeris/azSector";
import { bandFor, bandFutureInk, type RadarBandKey } from "../../lib/geo/radarBands";
import { AIMCONES } from "../globe/tuning";

/**
 * THE canvas radar painter — one drawing, two surfaces (audit #3 A1-8 → T35, 2026-08-22).
 *
 * The expanded chart (`panels/MapWindow`) and the FPV mini-map (`panels/MiniMap`) painted the
 * same instrument from two hand-maintained copies: ≈95 duplicated lines, of which Track E's
 * jscpd only flagged a 29-line tip. Both are canvas twins of the GL fan (`scene/aimCones`) and
 * must stay pixel-consistent with it — three surfaces, one geometry model.
 *
 * Extract-then-delegate (Gall): this is what both surfaces shipped, with the four things that
 * genuinely differ lifted into parameters —
 *   • **centre + twist**: the chart draws at the anchor's screen point on a rotatable chart;
 *     the mini-map is always centred and always north-up (`cx=cy=0` under a translated
 *     transform, `rotRad=0`), so its DOM `.mm-n` chip is its north marker.
 *   • **fill weight** (`fillAlphaK`): the mini-map doubles the wash — its map ink is dense at
 *     patch scale.
 *   • **target ray reach** (`targetRayPx`): the tracking ray runs to the window edge on the
 *     chart, to a patch fraction on the mini-map. Sun/moon dials always cap at their own band.
 *   • **past ink**: the inert-history grey, resolved by the caller (both pass the same value
 *     from different sources — the token bridge and the CSS custom property).
 *
 * Everything else — the band radii, the annular fill paths, the rim arcs, the rise/set spokes,
 * the future ink and every alpha — comes from the shared model and `AIMCONES`.
 */

const DEG = Math.PI / 180;

/** One body's drawable radar state (both surfaces already build this shape per paint). */
export interface RadarCanvasBody {
  key: RadarBandKey;
  /** Body identity ink — spokes + the direction line. */
  color: string;
  emphasized: boolean;
  /** Already-swept runs, fractured by the skyline where a profile applies. */
  past: readonly AimSample[][];
  /** Still-to-come runs, likewise fractured. */
  future: readonly AimSample[][];
  /** The UNFRACTURED day runs — the rise/set spokes mark the horizon boundary, so they are
   *  never gapped. Empty when the body is circumpolar (`day.kind === "ring"`). */
  spokeRuns: readonly AimSample[][];
  nowAzDeg: number;
  nowAltDeg: number;
}

export interface RadarCanvasOpts {
  /** Canvas centre of the radar, in the ctx's CURRENT transform. */
  cx: number;
  cy: number;
  /** Chart twist (rad, screen-CCW). 0 on any north-up surface. */
  rotRad: number;
  /** Unit-radius scale in device px — the bands are fractions of this. */
  rBase: number;
  /** /m shell: the whole band stack shifts inward (owner batch #5 item 2). */
  mobile: boolean;
  /** Device pixel ratio — line widths are authored in CSS px. */
  dpr: number;
  /** The TARGET body's tracking-ray reach in device px (owner batch #4 item 6). */
  targetRayPx: number;
  /** Inert-history grey for the swept half (tokens.textSecondary / --color-text-secondary). */
  pastInk: string;
  /** Fill-alpha multiplier; 1 on the chart, 2 on the mini-map's dense patch. */
  fillAlphaK?: number;
}

/**
 * Paint the annular band radar for `bodies`. Leaves `globalAlpha` at 1 and does not touch the
 * transform — the caller owns both.
 */
export function drawRadarCanvas(
  ctx: CanvasRenderingContext2D,
  o: RadarCanvasOpts,
  bodies: readonly RadarCanvasBody[],
): void {
  const fillK = o.fillAlphaK ?? 1;
  /** Compass az (N=0, CW) → canvas point (north −y, east +x) + the chart rotation. */
  const pt = (azDeg: number, rr: number): [number, number] => {
    const th = (azDeg - 90) * DEG + o.rotRad;
    return [o.cx + rr * Math.cos(th), o.cy + rr * Math.sin(th)];
  };
  // ANNULAR band fill: outer arc forward + inner arc reversed per run — the fan-centre wedge
  // is retired with the compact scaling (bands are fixed radii since batch #4 S2).
  const sectorPath = (runs: readonly AimSample[][], rIn: number, rOut: number) => {
    ctx.beginPath();
    for (const run of runs) {
      if (run.length < 2) continue;
      ctx.moveTo(...pt(run[0].azDeg, rOut));
      for (let i = 1; i < run.length; i++) ctx.lineTo(...pt(run[i].azDeg, rOut));
      for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(...pt(run[i].azDeg, rIn));
      ctx.closePath();
    }
  };
  // Rim ARC only (no radial legs) — the past/future stroke must not draw the spokes: those are
  // the body's rise/set boundary and wear its identity colour (owner 2026-08-18); a ring's
  // closePath seam stays retired.
  const arcPath = (runs: readonly AimSample[][], r: number) => {
    ctx.beginPath();
    for (const run of runs) {
      if (run.length < 2) continue;
      ctx.moveTo(...pt(run[0].azDeg, r));
      for (let i = 1; i < run.length; i++) ctx.lineTo(...pt(run[i].azDeg, r));
    }
  };

  for (const b of bodies) {
    const [kIn, kOut] = bandFor(b.key, o.mobile);
    const rIn = o.rBase * kIn;
    const rOut = o.rBase * kOut;
    const futureInk = bandFutureInk(b.key);
    // Glassy fills, NEVER resting at zero (owner batch #5 item 1: the strips read as empty) —
    // past NEUTRAL grey (inert history, never a day/night claim — owner 2026-08-18), future in
    // the body ink; emphasis breathes the wash up to fillAlpha.
    ctx.globalAlpha = (b.emphasized ? AIMCONES.fillAlpha : AIMCONES.fillAlphaRest) * fillK;
    ctx.fillStyle = o.pastInk;
    sectorPath(b.past, rIn, rOut);
    ctx.fill();
    ctx.fillStyle = futureInk;
    sectorPath(b.future, rIn, rOut);
    ctx.fill();
    ctx.globalAlpha = AIMCONES.rimAlpha;
    ctx.lineWidth = 1 * o.dpr;
    ctx.strokeStyle = o.pastInk;
    arcPath(b.past, rOut);
    ctx.stroke();
    ctx.strokeStyle = futureInk;
    arcPath(b.future, rOut);
    ctx.stroke();
    // Rise/set radial spokes — BODY identity colour, spanning the band (inner→outer, the GL
    // module's S2 rule); a ring (circumpolar) has no rise/set, hence no spokes.
    if (b.spokeRuns.length > 0) {
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      for (const run of b.spokeRuns) {
        if (run.length < 2) continue;
        for (const s of [run[0], run[run.length - 1]]) {
          ctx.moveTo(...pt(s.azDeg, rIn));
          ctx.lineTo(...pt(s.azDeg, rOut));
        }
      }
      ctx.stroke();
    }
    // Direction line at the CURRENT azimuth — body identity colour, pales below the horizon.
    // Sun/moon dials cap EXACTLY at their own band's outer radius (owner S2); the TARGET line
    // is the tracking RAY (item 6) — it runs to `targetRayPx`.
    ctx.globalAlpha = b.nowAltDeg > 0 ? AIMCONES.lineAlpha : AIMCONES.lineAlphaDown;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1 * o.dpr;
    ctx.beginPath();
    ctx.moveTo(o.cx, o.cy);
    ctx.lineTo(...pt(b.nowAzDeg, b.key === "target" ? o.targetRayPx : rOut));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
