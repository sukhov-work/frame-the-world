import { useState } from "react";
import InfoDot from "../ui/InfoDot";
import DragGrip, { ResizeGrip, usePanelDrag, usePanelResize } from "../ui/DragGrip";
import ChipRow, { type ChipOption } from "../controls/ChipRow";
import InstrumentSlider from "../controls/InstrumentSlider";
import {
  shortlistQuality,
  useBestSpotStore,
  type BestSpotSpot,
  type BestSpotState,
} from "../../store/bestSpot";
import { useCameraStore } from "../../store/camera";
import { BESTSPOT } from "../globe/tuning";
import { HEAT_SPOTS, heatRampById, spotQualityCss } from "../../lib/theme/heatPalette";
import {
  scoringHash,
  type BestSpotScoringPatch,
  type BestSpotTermKey,
} from "../../lib/geo/bestSpotScoring";
import { AERIAL_MIN_M, type BestSpotKind } from "../../lib/geo/bestSpotTypes";
import { cardinal } from "../../lib/format/readout";
import "../../styles/plan-panel.css"; // the shared .pp-* board grammar (chips, rows, status)
import "../../styles/find-panel.css"; // .fnd-sw + .fnd-row--hot — the row ↔ scene hover contract
import "../../styles/upload-flow.css"; // the .uf-slider grammar controls/InstrumentSlider renders
import "../../styles/bestspot-panel.css";
import "../../styles/tips.css";

/**
 * BEST SPOT panel (S5, `.claude/claude-docs/bestspot/BESTSPOT_SPEC_V2.md` §6.9) — the third face of the
 * shared planning window: WHERE TO STAND for this sunrise / sunset / moonrise / moonset. The disc
 * solver publishes into `store/bestSpot`; this panel is the readout, the request surface, and — the
 * part that is not decoration — the HONESTY surface.
 *
 * **Every status line here is a claim the feature would otherwise make falsely.** An unqualified
 * "1 m heatmap" is a C2 violation: obstruction is solved at 3 m (R3) over terrain posted at ~145 m,
 * with azimuth stepped at 0.25° so a vertical building edge resolves to about half a solar disc, and
 * the evidence only reaches as far as the streamed tiles do. Delete a line and the picture starts
 * lying; that is why they are copy and not chrome.
 *
 * **NO SPINNER** (§2.3). Three states instead: the `READING THE MAP` chip while MVT fetches are
 * outstanding (the only leg longer than a frame and the only one that can fail), the coarse sheet as
 * its own progress with a determinate `24 m → 3 m` pip, and the top-K list inert and labelled
 * `RANKING…`. The coarse FIELD is honest (ρ 0.910 at 6 m); the coarse TOP-K is not (10 of 20 survive
 * at 12 m). The single justified spinner is the explicit 1 m `REFINE THIS SPOT` re-solve (R8).
 *
 * Window geometry is a twin of `.pp` under the SAME `planfind` drag/resize session key — the
 * `find-panel.css` precedent. Mutual exclusion with PLAN / FIND is enforced at click time in
 * `PlanFindToggle`; all three stores keep owning their own `open`.
 */

// ── The seam to fields the engine has not published yet ──────────────────────────────────────
/**
 * S5 shipped these OPTIONAL so the panel could render honestly before S3d/S7 existed, and S7
 * landed every one of them (`store/bestSpot`'s engine band publishes `centreLatDeg`/`centreLonDeg`,
 * `moonWorth`, `terrainPostingM`, `refining`/`refineSpot`, and now `terrainOnly`,
 * `heightProvenance` and `shortlistCellM`). The seam stays because it is what the ZERO-STATE
 * rendering is written against: `_syncBestSpot` is a partial merge and the store's own defaults are
 * the pre-solve reading, so every line below must still be true with nothing solved yet.
 */
interface BestSpotPending {
  centreLatDeg?: number;
  centreLonDeg?: number;
  moonWorth?: number;
  terrainPostingM?: number;
  refining?: boolean;
  refineSpot?: (key: string) => void;
  /** Owner batch 2026-08-26 item 3 — installed by the ORCHESTRATOR, not the feed (a preview is a
   *  camera move), so it is absent until the globe island mounts. */
  previewSpot?: (key: string | null) => void;
  previewKey?: string | null;
}
const pending = (s: BestSpotState): BestSpotPending => s as BestSpotState & BestSpotPending;

// ── Copy that is measurement, not decoration ─────────────────────────────────────────────────

/** §8: the sweep steps 0.25° over the window, and a solar disc spans ~2.1 columns. So the finest
 *  horizontal feature the score can resolve is about half a disc — say so, or a user reads the
 *  contours as if they had building-edge precision. */
const AZ_STEP_LINE = "A VERTICAL EDGE RESOLVES TO ~HALF A DISC";

/** AS-BUILT, and the wording matters. `eventTrack` returns null when the rise/set azimuth is not
 *  invertible — measured across the TROPICS (at low latitude the setting azimuth is nearly
 *  stationary at the horizon), NOT at the poles. "This latitude" alone sends people hunting at
 *  70°N for a failure that lives at 0°. */
const TRACK_NULL_LINES = [
  "⚠ NO RISE/SET SOLUTION AT THIS LATITUDE ON THIS DATE",
  "THIS IS A TROPICS CASE, NOT A POLAR ONE — NEAR THE EQUATOR THE AZIMUTH BARELY MOVES ALONG THE HORIZON.",
] as const;

const KIND_OPTIONS: readonly ChipOption<BestSpotKind>[] = [
  { value: "sunrise", label: "☀", kind: "SUNRISE", tone: "sun", title: "Stand for sunrise" },
  { value: "sunset", label: "☀", kind: "SUNSET", tone: "sun", title: "Stand for sunset" },
  { value: "moonrise", label: "☾", kind: "M.RISE", tone: "moon", title: "Stand for moonrise" },
  { value: "moonset", label: "☾", kind: "M.SET", tone: "moon", title: "Stand for moonset" },
];

/** What sets the horizon at the contact azimuth — the metric's own verdict, never re-derived. */
const CONTACT_LABEL: Record<BestSpotSpot["contact"], string> = {
  graze: "GRAZE",
  gap: "GAP",
  open: "OPEN HORIZON",
};

/** The four preference weights, as the DEV taste strip's sliders (§5.9 — 41 of the ~45 leaves stay
 *  on the console; this is the ONE strip, and it lives in the panel because `components/controls/**`
 *  is the shared tier and a DEV-only tuning control there would need a fence exception). */
const TERM_SLIDERS = [
  { key: "v", label: "V · VISIBILITY" },
  { key: "l", label: "L · CONTACT LOWNESS" },
  { key: "p", label: "P · DEPTH" },
  { key: "f", label: "F · GRAZE" },
] as const;

// ── Pure readout helpers (exported so the fences can drive them off a real store state) ───────

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo || 1)));
  return t * t * (3 - 2 * t);
}

/**
 * A cell's swatch colour, through the SAME display normalisation the GL sheet samples its LUT with
 * (`smoothstep(displayLo, displayHi, S)`), and through the SAME 11 stops — `heatPalette` entries
 * carry a `css` and a `gl` face precisely so the DOM row and the marker cannot drift.
 */
export function heatCssForScore(score: number, s: BestSpotState): string {
  const stops = heatRampById(s.rampId);
  const t = smoothstep(s.displayLo, s.displayHi, score);
  return stops[Math.round(t * (stops.length - 1))].css;
}

/** Leaf count of a scoring patch — "custom (N fields)" means N LEAVES the owner moved, not N groups. */
export function countPatchLeaves(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v !== "object") return 1;
  return Object.values(v as Record<string, unknown>).reduce<number>(
    (n, x) => n + countPatchLeaves(x),
    0,
  );
}

/**
 * §5.7 rule 4 — a non-empty persisted patch MUST announce itself, or the next taste pass runs
 * against numbers the owner forgot he set. The `MAP IS STALE` tail is §5.6's one comparison: a
 * result whose echoed hash disagrees with the live profile is a job that landed after a newer patch.
 */
export function scoringLine(s: BestSpotState): string {
  const n = countPatchLeaves(s.scoringPatch);
  if (n === 0) return "SCORING: default";
  const hash = scoringHash(s.scoring);
  const stale = s.scoringHashLive !== null && s.scoringHashLive !== hash;
  return `SCORING: custom (${n} field${n === 1 ? "" : "s"}) · ${hash}${stale ? " · MAP IS STALE" : ""}`;
}

/**
 * §8's RIBBON. MVT z14 quantises at 0.396 m/unit at Dnipro, so the coordinates really are
 * sub-metre — but the POLYLINE is generalised at the 5-20 m chord scale (measured: water median
 * 5.5-16.8 m, buildings 7.8-12.3 m), so a class boundary is only ever right to within a cell or
 * two. §8 says "draw it"; the honest minimum is to SAY it, because a 1 m accessibility answer with
 * no uncertainty attached reads as a survey.
 */
const RIBBON_LINE = "LANDCOVER EDGES CARRY A ~1–2 CELL RIBBON — MVT LINES ARE GENERALISED AT 5–20 m";

/**
 * S7's built-density prior, in the panel's own words. `terrainOnly` is the ENGINE's verdict (the
 * parsed density fell under `BESTSPOT.builtDensityFloorPerKm2`), never a threshold re-applied here.
 */
const RURAL_LINE = "⚠ RURAL — TERRAIN ONLY, NO SURVEYED BUILDINGS HERE";

/**
 * THE PRIOR'S SECOND ARM (2026-08-24 fix pass), and it is a different sentence because it is a
 * different fact. `terrainOnly` now also fires when the parsed MVT is DENSE and yet not one building
 * mesh reached the obstruction DSM — which is what `▦ 3D DETAIL` off does (it detaches both building
 * tilesets, so nothing streams and there is nothing to flatten). Measured in that state at the
 * owner's hero location: 54.74 buildings/km² in the tiles, `heightProvenance {0, 0}`, and all 31,417
 * scored cells carrying one identical score byte. Saying "RURAL" there would be a lie about the
 * place; the honest line names the MODEL, and it is the one the user can act on.
 */
const NO_BUILT_GEOMETRY_LINE =
  "⚠ NO BUILDING GEOMETRY REACHED THIS DISC — TURN ▦ 3D DETAIL ON, OR WAIT FOR TILES";

/**
 * Which of the prior's two arms fired. Pure, and it reads only fields the engine published: a panel
 * that re-derived the FLOOR would be a second copy of the threshold.
 */
export function terrainOnlyLine(s: BestSpotState): string | null {
  if (!s.terrainOnly) return null;
  const hp = s.heightProvenance;
  if (hp.enriched + hp.osm === 0 && s.builtDensityPerKm2 >= BESTSPOT.builtDensityFloorPerKm2) {
    return `${NO_BUILT_GEOMETRY_LINE} · ${s.builtDensityPerKm2.toFixed(2)}/km² MAPPED HERE`;
  }
  return `${RURAL_LINE} · ${s.builtDensityPerKm2.toFixed(2)}/km² UNDER A ${BESTSPOT.builtDensityFloorPerKm2}/km² FLOOR`;
}

/**
 * §8 — the PROVENANCE badge, and it is three different claims with three different truth values.
 *
 * Heights: metre-exact only where the ENRICHED bake has real geometry; everywhere else OSM-derived
 * with **~78 % class defaults** (99,590 of 127,890). Vegetation: **fiction at the individual
 * level** — 151,046 of Dnipro's 161,823 canopies are seeded scatter with jittered class-default
 * heights and only 628 are surveyed points, and outside the two baked cities there are no trees at
 * all. That is exactly why `BESTSPOT_SAFETY.confTreeMax` clamps `graze.conf.tree ≤ 0.6`: the
 * framing term may notice a tree line, it may never fire CONFIDENTLY on one.
 */
export function provenanceLine(s: BestSpotState): string {
  const hp = s.heightProvenance;
  if (hp.enriched === 0 && hp.osm === 0) return "BUILDING HEIGHTS: NOT MEASURED YET";
  const heights =
    hp.enriched > 0
      ? `BUILDING HEIGHTS: ${hp.enriched} SURVEYED + ${hp.osm} OSM-DERIVED (~78% DEFAULTS)`
      : `BUILDING HEIGHTS: OSM-DERIVED ONLY (~78% CLASS DEFAULTS)`;
  return `${heights} · TREES ARE MODELLED, NOT SURVEYED`;
}

/**
 * The mandatory status block, in order. Pure, so the fence can mutate the store and prove every
 * number on screen came from it rather than from a literal in the JSX.
 *
 * **§8's honest resolution ladder, and every clause of it is load-bearing.** An unqualified
 * "1 m heatmap" is a C2 violation, so the obstruction line names the FIELD's pitch, the
 * SHORTLIST's separately (R8 re-solves accessibility at 1 m on every solve; obstruction only
 * behind `REFINE THIS SPOT`), the terrain's ACTUAL posting under this disc, the azimuth step, the
 * landcover ribbon, and how far the evidence reached.
 */
export function bestSpotStatusLines(s: BestSpotState): string[] {
  const p = pending(s);
  return [
    `${Math.round(s.unmappedFrac * 100)}% UNMAPPED · COVERAGE ${s.coverage.toFixed(2)}`,
    // The two halves of R8, named apart. `shortlistCellM` is what the engine ACTUALLY decided the
    // rows' accessibility at; quoting `ultraCellM` here would be a claim about a pass that may not
    // have run (it is skipped before the finest rung lands, and on a refused disc).
    `OBSTRUCTION AT ${s.gridCellM} m · SHORTLIST ACCESSIBILITY AT ${s.shortlistCellM} m`,
    // `> 0`, not `??` (S3d): the engine's field is a plain `number` and it is **0 until a disc has
    // actually been solved**.
    //
    // AND THE 0 CASE NO LONGER INVENTS A NUMBER (2026-08-24 fix pass). It used to fall back to
    // `TERRAIN_POSTING_BAKED_M`, a measurement of the DNIPRO bake, everywhere on Earth — which is
    // wrong by ~14× on plain world terrain. Worse, the engine's own figure was itself a bug
    // (`postingOf` returned the GRID CELL SIZE for every input, so this line printed
    // `OVER TERRAIN AT ~3 m` in a city whose real posting is ~145 m). Both are now measured
    // (`bestSpotWorker.tinPostingM`), and an unmeasured disc says so rather than printing a number
    // it cannot defend.
    (p.terrainPostingM ?? 0) > 0
      ? `OVER TERRAIN POSTED AT ~${Math.round(p.terrainPostingM as number)} m`
      : "TERRAIN POSTING NOT MEASURED YET",
    AZ_STEP_LINE,
    RIBBON_LINE,
    `EVIDENCE REACHES ${Math.round(s.reachM)} m — BEYOND THAT, UNKNOWN`,
    provenanceLine(s),
    scoringLine(s),
  ];
}

/**
 * The DEV strip's patch merge (§5.6): `setScoring` REPLACES, so the caller composes. `undefined`
 * DELETES the leaf rather than writing an undefined into it — that is what "reset this one field
 * back to the shipped default" has to mean, and a `{ weights: {} }` residue would still read as a
 * custom profile in the status line.
 */
function withWeight(
  patch: BestSpotScoringPatch | null,
  key: BestSpotTermKey,
  value: number | undefined,
): BestSpotScoringPatch {
  const weights: { [K in BestSpotTermKey]?: number } = { ...patch?.weights };
  if (value === undefined) delete weights[key];
  else weights[key] = value;
  return { ...patch, weights };
}

/**
 * §2.3 — the shortlist is INERT until the requested resolution actually lands. `ladderRung >= 0`
 * is "first ink"; `gridCellM <= cellM` is "the rung that landed is at least as fine as the one
 * asked for", which is also true for the ULTRA tier, whose 1 m is not a member of `ladderCellsM`.
 */
export function shortlistReady(s: BestSpotState): boolean {
  return s.ladderRung >= 0 && s.gridCellM <= s.cellM;
}

/** `62 m` / `1.5 km` — the walk, in the unit a walker thinks in. */
export function distLabel(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Offset from the event instant at which the disc is best framed from that cell: `+3m20s`. */
export function leadLabel(ms: number): string {
  const total = Math.round(Math.abs(ms) / 1000);
  return `${ms < 0 ? "−" : "+"}${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

/**
 * WHY THIS CELL IS ON THE LIST, in one sentence — the metric's own `contact` verdict spelled out
 * (owner batch 2026-08-26, item 3). Never re-derived here: the worker decided which of the three it
 * is, and a second opinion computed in the panel is a second opinion that can disagree.
 */
const CONTACT_WHY: Record<BestSpotSpot["contact"], string> = {
  graze: "THE EVENT GRAZES A SKYLINE EDGE FROM HERE — THE LONG, LOW CONTACT",
  gap: "THE EVENT DROPS THROUGH A GAP IN THE SKYLINE FROM HERE",
  open: "OPEN HORIZON ON THE CONTACT BEARING FROM HERE",
};

/**
 * R8's re-solve, made VISIBLE (owner batch 2026-08-26, item 5: *"once pressed - need to see effect
 * (or have feedback that nothing to improve)"*).
 *
 * The 1 m obstruction pass costs ~1.5 s and moved the row's score by hundredths, which is to say it
 * was indistinguishable from a dead button. This is the missing readout, and the ZERO case is the
 * important one: `NO CHANGE AT 1 m` is a real answer — the coarse pass was already right about this
 * cell — and it is the answer the old UI could not give. Returns null before any refine.
 *
 * The 0.005 threshold is the row's own printing precision (`score.toFixed(2)`): a delta that cannot
 * change the number beside it must not be announced as a change.
 */
export function refineDeltaLabel(spot: BestSpotSpot): string | null {
  if (!spot.obstructionRefined) return null;
  const from = spot.refinedFromScore;
  if (from === null || from === undefined) return `SOLVED AT ${spot.gridCellM} m`;
  const d = spot.score - from;
  if (Math.abs(d) < 0.005) return `${spot.gridCellM} m: NO CHANGE`;
  return `${spot.gridCellM} m: ${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
}

/**
 * The canvas hover tip's lines (item 3) — pure, so the fence can prove every word on screen came
 * from the store row rather than from a literal in the JSX.
 *
 * It is deliberately the SAME facts the panel row prints, in the same order, because the tip exists
 * to answer "why is there a #4 over there?" without making the user hunt the list for row 4.
 */
export function spotWhyLines(spot: BestSpotSpot): string[] {
  const out = [
    `#${spot.rank} · ${spot.score.toFixed(2)} · ${distLabel(spot.distM)} ${cardinal(spot.bearingDeg)}`,
    CONTACT_WHY[spot.contact],
    `BEST FRAMED ${leadLabel(spot.leadMs)} FROM THE CONTACT · ACCESSIBILITY AT ${spot.gridCellM} m`,
  ];
  const note = [
    spot.note,
    spot.aerial ? "▲ AERIAL" : null,
    spot.groundReachable ? null : "NO GROUND ACCESS BELOW",
    refineDeltaLabel(spot),
  ]
    .filter(Boolean)
    .join(" · ");
  if (note) out.push(note);
  return out;
}

/**
 * One shortlist row — HOOK-FREE on purpose, so the fence can call it as a plain function and invoke
 * `onMouseEnter` / `onClick` off the returned tree (vitest here has no DOM).
 *
 * §3.5 is non-negotiable: the row prints the ABSOLUTE score BESIDE the relative bar. Display
 * normalisation is what makes a 97.7 %-black pedestrian disc legible; without the absolute number
 * beside it, "best of a bad lot" reads as "great".
 */
export function SpotRow({
  spot,
  relative,
  swatchCss,
  hot,
  selected,
  previewing,
  refining,
  onHover,
  onSelect,
  onGo,
  onLook,
  onRefine,
}: {
  spot: BestSpotSpot;
  /** score ÷ the shortlist's best — the BAR and the SWATCH. Never the number. */
  relative: number;
  swatchCss: string;
  /** The canvas pointer is on this row's marker. */
  hot: boolean;
  /** The user PICKED this row (owner item 1) — its marker is lit on the globe. */
  selected: boolean;
  /** …and is currently standing at it in the FPV preview (item 3). */
  previewing: boolean;
  /** R8's 1 m obstruction re-solve is in flight (for THIS row — the store carries one at a time). */
  refining: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string | null) => void;
  /** The EXPLICIT travel action — the only thing that moves the disc centre. */
  onGo: (spot: BestSpotSpot) => void;
  onLook: (spot: BestSpotSpot) => void;
  onRefine: (spot: BestSpotSpot) => void;
}) {
  // R1's secondary readout rides the provenance footnote: "a place I can climb to" is the owner's
  // stated preference, so a cell that is only reachable by air says so on the row that offers it.
  // Item 5's refine delta joins it: it is a property of the ROW, not of the button, so it stays
  // visible after the selection moves on.
  const note = [
    spot.note,
    spot.aerial ? "▲ AERIAL" : null,
    spot.groundReachable ? null : "NO GROUND ACCESS BELOW",
    refineDeltaLabel(spot),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={`pp-day__row bsp-row${hot ? " fnd-row--hot" : ""}${selected ? " bsp-row--sel" : ""}`}
      onMouseEnter={() => onHover(spot.key)}
      onMouseLeave={() => onHover(null)}
    >
      {/* THE ROW BODY IS NOW A SELECT, NOT A JUMP (owner item 1). Clicking used to drop the temp
          pin, which moved the disc centre, which re-solved the field — and destroyed the very list
          the row came from. A second click deselects, so the gesture is reversible. */}
      <button
        type="button"
        className="pp-day__jump"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : spot.key)}
        title={`Select this spot — it lights up on the globe. Nothing moves until you press GO.`}
      >
        <span className="fnd-sw" style={{ background: swatchCss }} />
        <span className="pp-day__time">{spot.rank}</span>
        <span className="pp-day__time">{spot.score.toFixed(2)}</span>
        <span className="pp-mw__bar" title="Score relative to the best spot found">
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, relative)) * 100)}%` }} />
        </span>
        <span className="pp-day__time">{`${distLabel(spot.distM)} ${cardinal(spot.bearingDeg)}`}</span>
        <span className="pp-day__kind">{CONTACT_LABEL[spot.contact]}</span>
        <span className="pp-day__meta">{leadLabel(spot.leadMs)}</span>
      </button>
      {/* The actions live to the RIGHT of the row and only on the SELECTED one — the owner's own
          proposal, and it is also what makes REFINE unambiguous (item 5): the button names the
          cell it acts on instead of silently following the last thing the pointer touched. */}
      {selected && (
        <span className="bsp-row__acts">
          <button
            type="button"
            className="bsp-act"
            onClick={() => onGo(spot)}
            title={`Move the disc centre here — ${distLabel(spot.distM)} ${cardinal(spot.bearingDeg)} away. THIS re-solves the heatmap around the new centre.`}
          >
            GO →
          </button>
          <button
            type="button"
            className={`bsp-act${previewing ? " bsp-act--on" : ""}`}
            aria-pressed={previewing}
            onClick={() => onLook(spot)}
            title="Stand here in first person WITHOUT moving the disc — the heatmap and this list survive. Escape returns."
          >
            {previewing ? "◎ BACK" : "◎ LOOK"}
          </button>
          <button
            type="button"
            className="bsp-act"
            data-busy={refining ? "1" : "0"}
            data-refined={spot.obstructionRefined ? "1" : "0"}
            disabled={refining || spot.obstructionRefined}
            onClick={() => onRefine(spot)}
            title={
              spot.obstructionRefined
                ? `This cell's OBSTRUCTION has already been re-solved at ${spot.gridCellM} m.`
                : `Re-solve THIS ONE cell's obstruction at ${BESTSPOT.ultraCellM} m — a small disc around this cell, NOT the whole area and NOT the whole disc. It needs a 985 ms streamed hull, so about a second.`
            }
          >
            {spot.obstructionRefined ? "◠ 1 m ✓" : refining ? "◠ …" : "◠ REFINE"}
          </button>
        </span>
      )}
      {note && <span className="pp-day__meta">{note}</span>}
    </div>
  );
}

/**
 * The canvas hover tip (owner batch 2026-08-26, item 3) — *"on hover over suggested spot on map
 * (e.g spot #4 in circle), show hint about why this one was chosen with basic info that you show in
 * plan"*.
 *
 * Its own island slot, floating at the marker's projected screen position (`sceneHoverScreen`, the
 * `camera.tempPinScreen` → `.ct-pinpop` recipe verbatim). It renders NOTHING unless the engine has
 * both a hovered key and a position for it, so a disarmed disc, FPV or an off-screen marker all
 * collapse to null without the panel having to know why.
 *
 * `pointer-events: none` in the CSS is load-bearing: the tip sits under the pointer by construction,
 * and a tip that could take the pointer would steal the click that opens the preview.
 */
export function BestSpotHoverTip() {
  const key = useBestSpotStore((s) => s.sceneHoverKey);
  const at = useBestSpotStore((s) => s.sceneHoverScreen);
  const topK = useBestSpotStore((s) => s.topK);
  if (key === null || at === null) return null;
  const spot = topK.find((t) => t.key === key);
  if (!spot) return null;
  return (
    <div className="bsp-tip" role="status" style={{ left: at.x, top: at.y }}>
      {spotWhyLines(spot).map((line) => (
        <div className="bsp-tip__line" key={line}>
          {line}
        </div>
      ))}
      <div className="bsp-tip__cta">CLICK TO LOOK FROM HERE — THE DISC STAYS PUT</div>
    </div>
  );
}

export default function BestSpotPanel() {
  // ONE session key with PLAN and FIND — the shared window keeps its dragged spot and its user size
  // across a mode switch (owner 2026-08-15; BEST SPOT joins that contract, §6.9).
  const drag = usePanelDrag("planfind");
  const resize = usePanelResize("planfind");
  // WHOLE-STATE read, deliberately: every field of this store is rendered somewhere on this panel
  // (that is what an honesty surface IS), so a fan of per-field selectors would buy nothing and
  // would quietly go stale the day a status line reaches for one more channel. The engine mirrors
  // land at `BESTSPOT.mirrorEveryFrames` cadence, never per frame.
  const s = useBestSpotStore();
  // R2: the temp pin is a CENTRE SOURCE. Until the engine echoes the centre it actually solved at,
  // the request is the best the header can honestly show.
  const tempPin = useCameraStore((c) => c.tempPin);
  const [tuneOpen, setTuneOpen] = useState(false);

  const p = pending(s);
  const latDeg = p.centreLatDeg ?? tempPin?.latDeg ?? null;
  const lonDeg = p.centreLonDeg ?? tempPin?.lonDeg ?? null;
  const hasCentre = latDeg !== null && lonDeg !== null;

  // Closed renders nothing — every hook above still runs, so the store-driven feeds keep gating.
  if (!s.open) return null;

  const {
    setOpen,
    heatmapOn,
    setHeatmapOn,
    selectedKey,
    setSelectedKey,
    kind,
    setKind,
    radiusM,
    setRadiusM,
    radiiM,
    ultra,
    setUltra,
    ultraMaxRadiusM,
    liftM,
    setLiftM,
    rampId,
    setRampId,
    sceneHoverKey,
    topK,
    verdictCounts,
    tilesPending,
    ladderRung,
    gridCellM,
    cellM,
    suggestedLiftM,
    trackNull,
    terrainOnly,
    scoring,
    scoringPatch,
    setScoring,
  } = s;
  const ready = shortlistReady(s);
  const bestScore = topK.length > 0 ? Math.max(...topK.map((t) => t.score)) : 1;
  // Hoisted out of the row map: `shortlistQuality` needs the whole list, and re-deriving it per row
  // would be eight passes over eight rows for one number that does not change between them.
  const topKScores = topK.map((t) => t.score);
  const ladder = BESTSPOT.ladderCellsM;
  const rungFrac = ladder.length > 1 ? Math.min(1, Math.max(0, (ladderRung + 1) / ladder.length)) : 1;
  // SHEET ALTITUDE, settled: the store carries `eyeM` (1.7, the pedestrian eye) and `liftM` (metres
  // ABOVE it), so the number a person reads off the slider is their sum. The rail therefore starts
  // at `eyeM`, NOT at §6.9's mocked 0.5 m — `liftMinM` is the LOG slider's own domain floor (a log
  // scale has no zero), not a place anybody can stand, and `BESTSPOT_METRIC_DEFAULTS` is
  // `{ eyeM: 1.7, liftM: 0 }`. Double-click returns to `liftM = 0`, i.e. eye level.
  const sheetAltM = BESTSPOT.eyeM + liftM;
  const ultraAllowed = radiusM <= ultraMaxRadiusM;
  // ITEM 1/5 — the selection is LOOKED UP, never cached. A re-solve replaces every row, so a key
  // that no longer exists simply resolves to "nothing selected" and the actions disappear with it;
  // there is no stale-selection clean-up pass anywhere, because there is nothing to clean.
  const selected = topK.find((t) => t.key === selectedKey) ?? null;
  const previewKey = p.previewKey ?? null;

  return (
    <>
      {/* ITEM 3's HOVER TIP — a SIBLING of `.bsp-root`, never a child. `.bsp-root` carries the drag
          `transform`, and a transform (like a backdrop-filter) makes every `position: fixed`
          descendant relative to it — the exact bug the `.ct-pinpop` island was extracted to avoid.
          It floats at the marker's own projected position, so "why is there a #4 over there?" is
          answered where the question is asked. */}
      <BestSpotHoverTip />
      <div className="bsp-root" style={drag.style}>
        <DragGrip drag={drag} label="Move the planning window" tipPos="up" />
        <aside className="bsp" aria-label="Best spot" style={resize.style}>
          <div className="pp-head">
            <span className="pp-title">BEST SPOT</span>
            <span className="pp-anchor">
              {hasCentre ? `${latDeg.toFixed(4)}, ${lonDeg.toFixed(4)}` : "—"}
            </span>
            <InfoDot
              tip="Where to stand for this sunrise, sunset, moonrise or moonset. Every ground cell in the disc is scored for how good a place it is to watch the event from — real buildings, real terrain, real landcover. The sheet is the field; the eight markers are the shortlist, re-solved at 1 m. The status lines below say exactly how far the evidence goes."
              pos="right"
            />
            <button
              type="button"
              className="pp-x"
              aria-label="Close the planning window"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          {/* Scrolling lives on this INNER wrapper so the head's InfoDot tip is never clipped and the
              DragGrip tab that overhangs the card is never cut off (the .pp-scroll discipline). */}
          <div className="bsp-scroll">
            <div className="pp-chips">
              {/* OWNER ITEM 4 — this was a READOUT wearing a chip's clothes: it printed ON whenever a
                  centre existed, could not be clicked, and the thing that actually armed the solver
                  was "the window is open". Now it is the switch it always looked like. Opening the
                  window leaves it OFF (`setOpen` forces that), so the request can be composed for
                  free; arming re-reads whatever the chips say NOW. It is deliberately NOT disabled
                  without a centre — arming first and then double-clicking the ground is a legitimate
                  order, and the line below says what is missing. */}
              <button
                type="button"
                className={`pp-chip${heatmapOn ? " pp-chip--on" : ""}`}
                aria-pressed={heatmapOn}
                onClick={() => setHeatmapOn(!heatmapOn)}
                title={
                  heatmapOn
                    ? "Turn the heatmap off. The window stays open and keeps your settings; turning it back on solves with whatever you have changed meanwhile."
                    : "Solve this disc and paint the heatmap. Set the event, the radius and the sheet altitude first — while it is off, nothing is computed."
                }
              >
                {"◎ HEATMAP"}
                <span className="pp-chip__kind">
                  {heatmapOn ? (hasCentre ? "ON" : "ARMED — NO CENTRE") : "OFF"}
                </span>
              </button>
              {/* §2.3 state 1 — the ONLY leg longer than a frame and the only one that can fail. */}
              {tilesPending && <span className="pp-chip">READING THE MAP</span>}
            </div>

            {!hasCentre && (
              <div className="pp-status">
                NO CENTRE YET — DOUBLE-CLICK THE GROUND (OR STAND SOMEWHERE IN LOOK) TO SET ONE
              </div>
            )}
            {!heatmapOn && (
              <div className="pp-status">
                HEATMAP OFF — NOTHING IS BEING COMPUTED. SET THE EVENT, RADIUS AND ALTITUDE, THEN TURN
                IT ON.
              </div>
            )}
            {/* ITEM 3 — the preview is a MODE, and a mode with no visible state is a trap. The second
                clause is the one that matters: it is the promise this whole mechanism exists to keep. */}
            {previewKey !== null && (
              <div className="pp-status" data-tone="warn">
                {`◎ LOOKING FROM #${topK.find((t) => t.key === previewKey)?.rank ?? "?"} — THE DISC IS STILL CENTRED WHERE IT WAS, NOTHING IS BEING RE-SOLVED. ESC RETURNS.`}
              </div>
            )}

            <div className="pp-section">EVENT</div>
            <ChipRow options={KIND_OPTIONS} value={kind} onPick={setKind} ariaLabel="Event" />
            {/* R7 — the moon multiplies but the FLOOR rises, so a bad night DIMS rather than vanishes.
                The badge says which kind of night this is, because the sheet alone cannot. */}
            {(kind === "moonrise" || kind === "moonset") && (
              <div className="pp-status">
                {p.moonWorth === undefined
                  ? "☾ MOON WORTH NOT PUBLISHED YET"
                  : `☾ THIS MOON IS WORTH ${p.moonWorth.toFixed(2)}`}
              </div>
            )}

            <div className="pp-section">RADIUS (m)</div>
            <ChipRow
              options={radiiM.map((r) => ({ value: r, label: String(r), title: `${r} m disc` }))}
              value={radiusM}
              onPick={setRadiusM}
              ariaLabel="Disc radius"
            >
              {/* R8 — 1 m ULTRA is a SHORTLIST tool, not a field tool: it buys ρ = 0.969 against 3 m
                  and changes 4 of the top 20 for 6.7× the wall clock, and at 500 m it is 1,002,001
                  cells ≈ 12.2 s. The chip stays visible above the ceiling so the ladder does not
                  silently change shape; it just cannot be armed. */}
              <button
                type="button"
                className={`pp-chip${ultra ? " pp-chip--on" : ""}`}
                aria-pressed={ultra}
                disabled={!ultraAllowed}
                onClick={() => setUltra(!ultra)}
                title={
                  ultraAllowed
                    ? `${BESTSPOT.ultraCellM} m field — the ULTRA tier`
                    : `${BESTSPOT.ultraCellM} m is refused above a ${ultraMaxRadiusM} m radius (R8) — over a million cells`
                }
              >
                {`${BESTSPOT.ultraCellM} m`}
                <span className="pp-chip__kind">ULTRA</span>
              </button>
            </ChipRow>

            <InstrumentSlider
              label="SHEET ALTITUDE"
              formatted={`${sheetAltM < 10 ? sheetAltM.toFixed(1) : Math.round(sheetAltM)} m`}
              value={sheetAltM}
              min={BESTSPOT.eyeM}
              max={BESTSPOT.liftMaxM}
              log
              // R1: at and above 5 m the ground rules stop applying and the DRONE rules take over
              // (only solid interiors are masked). The badge is where that switch becomes visible.
              badge={sheetAltM >= AERIAL_MIN_M ? "▲ DRONE" : undefined}
              onChange={(v) => setLiftM(v - BESTSPOT.eyeM)}
              onReset={() => setLiftM(0)}
              ariaLabel="Sheet altitude above the ground"
            />

            {/* R6 — at pedestrian height a real central-Dnipro disc is 97.7 % black with a maximum of
                0.381. That is physically correct and the eight markers ARE the product; but when the
                engine has found a lift that clears the floor, the way out is one tap. The number is
                COMPUTED (the lowest probe that clears `emptyFieldFrac`) — never a constant. */}
            {suggestedLiftM !== null && (
              <button
                type="button"
                className="pp-chip"
                onClick={() => setLiftM(suggestedLiftM)}
                title="Lift the sheet to the lowest altitude that puts a readable fraction of the disc above the display floor"
              >
                {`NOTHING CLEARS THE SKYLINE AT EYE LEVEL — TRY ${Math.round(suggestedLiftM)} m`}
              </button>
            )}

            <div className="bsp-legend">
              <div className="pp-section">
                SCORE
                <button
                  type="button"
                  className="bsp-ab"
                  onClick={() => setRampId(rampId === "inferno" ? "turbo" : "inferno")}
                  title="A/B the heat ramp. INFERNO is monotone in perceived lightness; TURBO is not — its brightest band sits mid-scale, which puts the best spot in dark red."
                >
                  [{rampId.toUpperCase()}]
                </button>
              </div>
              <div
                className="bsp-legend__ramp"
                style={{
                  backgroundImage: `linear-gradient(to right, ${heatRampById(rampId)
                    .map((stop) => stop.css)
                    .join(", ")})`,
                }}
              />
              {/* Ticks are DERIVED: the display floor, the two contour majors the sheet draws heavier,
                  and the display ceiling. Nothing here is a hand-placed number. */}
              <div className="bsp-legend__tick">
                <span>{s.displayLo.toFixed(2)}</span>
                {BESTSPOT.contourMajors.map((m) => (
                  <b key={m}>{m.toFixed(2)}</b>
                ))}
                <span>{s.displayHi.toFixed(2)}</span>
              </div>
              <div className="bsp-legend__cls" data-cls="unmapped">
                <i />
                {`UNMAPPED — NOT SCORED${
                  verdictCounts.total > 0 ? ` · ${verdictCounts.unknown.toLocaleString("en-US")}` : ""
                }`}
              </div>
              <div className="bsp-legend__cls" data-cls="blocked">
                <i />
                {`CAN'T STAND HERE${
                  verdictCounts.total > 0 ? ` · ${verdictCounts.blocked.toLocaleString("en-US")}` : ""
                }`}
              </div>
              {/* OWNER ITEM 2's legend, and it has to be here or the markers become a second
                  unlabelled rainbow. The ramp above reads the ABSOLUTE score; this one reads the
                  eight against EACH OTHER, which is the only normalisation under which eight cells
                  clustered in the low end of a real disc are told apart at all. Saying which is
                  which is the whole cost of being allowed to renormalise — and it is said in TWO
                  rows, not four: the scarcest thing on this panel is the vertical space above the
                  shortlist, and the shortlist is the product (measured in the browser, the
                  four-row version pushed row #1 below the fold at the default window height). */}
              <div className="pp-section">
                MARKERS
                <span
                  className="bsp-legend__cap"
                  title="The marker's HUE spreads this shortlist across the whole ramp — best at the bright end, worst at the dim one — so eight spots can be ranked at a glance even when their scores are close. Its BRIGHTNESS is the ABSOLUTE score: eight faint markers mean eight poor spots, however colourful they are."
                >
                  HUE SPREADS THE EIGHT · BRIGHTNESS IS ABSOLUTE
                </span>
              </div>
              <div
                className="bsp-legend__ramp"
                style={{
                  backgroundImage: `linear-gradient(to right, ${HEAT_SPOTS.map((stop) => stop.css).join(", ")})`,
                }}
              />
              <div className="bsp-legend__tick">
                <span>#8</span>
                <span>#1</span>
              </div>
            </div>

            {bestSpotStatusLines(s).map((line) => (
              <div className="pp-status" key={line}>
                {line}
              </div>
            ))}
            {/* S7's built-density prior — the plan's own "single most dangerous failure mode in the
                feature". `parseTile` does `if (!layer) continue`, so "tile fetched, zero buildings"
                is byte-identical to "OSM never surveyed here", and before this line existed a
                terrain-only rural disc rendered warm, uniform and confident at S = 0.470–0.661 while
                reporting 100 % coverage. The engine publishes the verdict AND the density it was
                measured from; the panel prints both so the claim is checkable. */}
            {terrainOnly && (
              <div className="pp-status" data-tone="warn">
                {terrainOnlyLine(s)}
              </div>
            )}
            {trackNull &&
              TRACK_NULL_LINES.map((line) => (
                <div className="pp-status" data-tone="warn" key={line}>
                  {line}
                </div>
              ))}

            <div className="pp-section">
              {`BEST SPOTS${ready ? "" : " · RANKING…"}${
                verdictCounts.total > 0
                  ? ` · ${topK.length} OF ${verdictCounts.scored.toLocaleString("en-US")}`
                  : ""
              }`}
            </div>
            {/* §2.3 state 2 — the determinate rung pip. The sheet is its own progress indicator; this
                says how far down the ladder it has come, in the ladder's own units. */}
            {!ready && (
              <>
                <span className="pp-mw__bar">
                  <i style={{ width: `${Math.round(rungFrac * 100)}%` }} />
                </span>
                <div className="pp-status">
                  {`${ladder[0]} m → ${cellM} m${ladderRung >= 0 ? ` · NOW ${gridCellM} m` : ""}`}
                </div>
              </>
            )}
            <div data-ranking={ready ? "0" : "1"}>
              {topK.map((spot) => (
                <SpotRow
                  key={spot.key}
                  spot={spot}
                  relative={spot.score / (bestScore || 1)}
                  // The SAME two functions the GL marker goes through — `shortlistQuality` for the
                  // place on the ramp and `spotQualityCss` for the colour — so the swatch beside a
                  // row IS its marker on the globe. That binding is what replaces the old one flat
                  // accent. §3.5 is unharmed: the ABSOLUTE score is printed 6 px to its right, and
                  // the bar next to it still reads `score ÷ best`.
                  swatchCss={spotQualityCss(shortlistQuality(spot.score, topKScores))}
                  hot={sceneHoverKey === spot.key}
                  selected={selectedKey === spot.key}
                  previewing={previewKey === spot.key}
                  refining={(p.refining ?? false) && selectedKey === spot.key}
                  onHover={(key) => useBestSpotStore.getState().setHoverKey(key)}
                  onSelect={setSelectedKey}
                  // THE ONLY ACTION THAT MOVES THE DISC (item 1). Everything else on the row is a
                  // look; this one is a commitment, and it is behind its own button because it costs
                  // the shortlist the user is reading.
                  onGo={(hit) => {
                    // LEAVE ANY PREVIEW FIRST, and the order is load-bearing: ending a preview
                    // RESTORES the temp pin it borrowed, so a GO issued from inside one would be
                    // silently undone by that restore a frame later. Both writes are synchronous,
                    // so restore-then-move lands on the move.
                    p.previewSpot?.(null);
                    useCameraStore.getState().setTempPin({ latDeg: hit.latDeg, lonDeg: hit.lonDeg });
                  }}
                  onLook={(hit) => p.previewSpot?.(previewKey === hit.key ? null : hit.key)}
                  onRefine={(hit) => p.refineSpot?.(hit.key)}
                />
              ))}
              {ready && topK.length === 0 && (
                <div className="pp-status">
                  NOTHING IN THIS DISC SCORES ABOVE THE FLOOR — TRY ANOTHER EVENT, A WIDER RADIUS, OR
                  THE LIFT
                </div>
              )}
            </div>
            {/* ITEM 5 — the old `REFINE THIS SPOT` chip lived down here and silently acted on the last
                row the pointer had touched (or #1). Its replacement is on the SELECTED row, where it
                names its own target. This line is what is left: the instruction, and the answer to
                "what does refine even do", stated once rather than hidden in a tooltip. */}
            {ready && topK.length > 0 && selected === null && (
              <div className="pp-status">
                PICK A SPOT ABOVE TO LIGHT IT ON THE GLOBE — THEN GO THERE, LOOK FROM IT, OR REFINE
                THAT ONE CELL AT {BESTSPOT.ultraCellM} m
              </div>
            )}

            {/* §5.9 — the DEV taste strip. ONE 4-slider weights row; the other ~41 leaves stay on the
                console. It lives HERE and not in `components/controls/**` because that tier is shared
                with `/m` and a DEV-only control there would need a fence exception. */}
            {import.meta.env.DEV && (
              <>
                <button
                  type="button"
                  className={`pp-chip${tuneOpen ? " pp-chip--on" : ""}`}
                  aria-pressed={tuneOpen}
                  onClick={() => setTuneOpen(!tuneOpen)}
                  title="DEV — the four preference weights. Recompose class: ~0.3 ms, live."
                >
                  TUNE
                </button>
                {tuneOpen &&
                  TERM_SLIDERS.map((t) => (
                    <InstrumentSlider
                      key={t.key}
                      label={t.label}
                      formatted={scoring.weights[t.key].toFixed(2)}
                      value={scoring.weights[t.key]}
                      min={0}
                      max={1}
                      // §5.6: the store REPLACES the patch; the DEV seam owns the merge, because it
                      // is the half that has `scoringPatch` to merge from.
                      onChange={(v) => setScoring(withWeight(scoringPatch, t.key, v))}
                      onReset={() => setScoring(withWeight(scoringPatch, t.key, undefined))}
                    />
                  ))}
              </>
            )}
          </div>
          <ResizeGrip resize={resize} label="Resize the planning window" />
        </aside>
      </div>
    </>
  );
}
