import type { BestSpotSpot, BestSpotState } from "../../store/bestSpot";
import { BESTSPOT } from "../globe/tuning";
import { heatRampById } from "../../lib/theme/heatPalette";
import { scoringHash } from "../../lib/geo/bestSpotScoring";
import type { BestSpotKind } from "../../lib/geo/bestSpotTypes";
import { cardinal } from "../../lib/format/readout";

/**
 * BEST SPOT copy — the pure readout helpers BOTH shells print (owner order 2026-09-07g: the
 * heatmap comes to `/m`). Moved here VERBATIM from `panels/BestSpotPanel.tsx` (S5, SPEC_V2 §6.9)
 * so the mobile sheet can render the same honesty lines without importing a desktop panel —
 * `components/controls/**` is the one tier both shells may import (`mobileFence.test.ts` rule 3:
 * react + stores + `lib/**` + globe tunables + styles, never a panel or the mobile shell).
 *
 * **Every status line here is a claim the feature would otherwise make falsely.** An unqualified
 * "1 m heatmap" is a C2 violation: obstruction is solved at 3 m (R3) over terrain posted at ~145 m,
 * with azimuth stepped at 0.25° so a vertical building edge resolves to about half a solar disc, and
 * the evidence only reaches as far as the streamed tiles do. Delete a line and the picture starts
 * lying; that is why they are copy and not chrome — and why the two shells share ONE copy of them.
 *
 * Hook-free and DOM-free on purpose: the fences drive every function off a real store state and
 * prove every number on screen came from it rather than from a literal in the JSX.
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
export interface BestSpotPending {
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
export const pending = (s: BestSpotState): BestSpotPending => s as BestSpotState & BestSpotPending;

// ── Copy that is measurement, not decoration ─────────────────────────────────────────────────

/** §8: the sweep steps 0.25° over the window, and a solar disc spans ~2.1 columns. So the finest
 *  horizontal feature the score can resolve is about half a disc — say so, or a user reads the
 *  contours as if they had building-edge precision. */
export const AZ_STEP_LINE = "A VERTICAL EDGE RESOLVES TO ~HALF A DISC";

/** AS-BUILT, and the wording matters. `eventTrack` returns null when the rise/set azimuth is not
 *  invertible — measured across the TROPICS (at low latitude the setting azimuth is nearly
 *  stationary at the horizon), NOT at the poles. "This latitude" alone sends people hunting at
 *  70°N for a failure that lives at 0°. */
export const TRACK_NULL_LINES = [
  "⚠ NO RISE/SET SOLUTION AT THIS LATITUDE ON THIS DATE",
  "THIS IS A TROPICS CASE, NOT A POLAR ONE — NEAR THE EQUATOR THE AZIMUTH BARELY MOVES ALONG THE HORIZON.",
] as const;

/** The four event chips. Shaped like `ChipRow`'s `ChipOption<BestSpotKind>` STRUCTURALLY rather
 *  than by import: `mobileFence.test.ts` rule 3 lets a `controls/**` file import only react, stores,
 *  `lib/**`, the globe tunables and styles — a sibling import would widen the leaf. The mobile
 *  sheet renders these as `.m-toggle` pills; the desktop panel hands them to `ChipRow` as-is. */
export interface BestSpotKindOption {
  value: BestSpotKind;
  label: string;
  kind: string;
  tone: "sun" | "moon";
  title: string;
}
export const KIND_OPTIONS: readonly BestSpotKindOption[] = [
  { value: "sunrise", label: "☀", kind: "SUNRISE", tone: "sun", title: "Stand for sunrise" },
  { value: "sunset", label: "☀", kind: "SUNSET", tone: "sun", title: "Stand for sunset" },
  { value: "moonrise", label: "☾", kind: "M.RISE", tone: "moon", title: "Stand for moonrise" },
  { value: "moonset", label: "☾", kind: "M.SET", tone: "moon", title: "Stand for moonset" },
];

/** What sets the horizon at the contact azimuth — the metric's own verdict, never re-derived. */
export const CONTACT_LABEL: Record<BestSpotSpot["contact"], string> = {
  graze: "GRAZE",
  gap: "GAP",
  open: "OPEN HORIZON",
};

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
export const RIBBON_LINE = "LANDCOVER EDGES CARRY A ~1–2 CELL RIBBON — MVT LINES ARE GENERALISED AT 5–20 m";

/**
 * S7's built-density prior, in the panel's own words. `terrainOnly` is the ENGINE's verdict (the
 * parsed density fell under `BESTSPOT.builtDensityFloorPerKm2`), never a threshold re-applied here.
 */
export const RURAL_LINE = "⚠ RURAL — TERRAIN ONLY, NO SURVEYED BUILDINGS HERE";

/**
 * THE PRIOR'S SECOND ARM (2026-08-24 fix pass), and it is a different sentence because it is a
 * different fact. `terrainOnly` now also fires when the parsed MVT is DENSE and yet not one building
 * mesh reached the obstruction DSM — which is what `▦ 3D DETAIL` off does (it detaches both building
 * tilesets, so nothing streams and there is nothing to flatten). Measured in that state at the
 * owner's hero location: 54.74 buildings/km² in the tiles, `heightProvenance {0, 0}`, and all 31,417
 * scored cells carrying one identical score byte. Saying "RURAL" there would be a lie about the
 * place; the honest line names the MODEL, and it is the one the user can act on.
 */
export const NO_BUILT_GEOMETRY_LINE =
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
  return bestSpotStatusEntries(s).map((e) => e.line);
}

/** The ladder's line keys — what the mobile sheet folds BY (never by index): the phone keeps
 *  `unmapped`, `obstruction` and `reach` inline and the other five behind a caveats toggle. */
export type BestSpotStatusKey =
  | "unmapped"
  | "obstruction"
  | "posting"
  | "azStep"
  | "ribbon"
  | "reach"
  | "provenance"
  | "scoring";

/** `bestSpotStatusLines` with each line NAMED — same order, same text; the desktop prints the
 *  lines, the phone folds by key. ONE builder, so the two shells cannot drift by a line. */
export function bestSpotStatusEntries(
  s: BestSpotState,
): readonly { key: BestSpotStatusKey; line: string }[] {
  const p = pending(s);
  return [
    { key: "unmapped", line: `${Math.round(s.unmappedFrac * 100)}% UNMAPPED · COVERAGE ${s.coverage.toFixed(2)}` },
    // The two halves of R8, named apart. `shortlistCellM` is what the engine ACTUALLY decided the
    // rows' accessibility at; quoting `ultraCellM` here would be a claim about a pass that may not
    // have run (it is skipped before the finest rung lands, and on a refused disc).
    {
      key: "obstruction",
      line: `OBSTRUCTION AT ${s.gridCellM} m · SHORTLIST ACCESSIBILITY AT ${s.shortlistCellM} m`,
    },
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
    {
      key: "posting",
      line:
        (p.terrainPostingM ?? 0) > 0
          ? `OVER TERRAIN POSTED AT ~${Math.round(p.terrainPostingM as number)} m`
          : "TERRAIN POSTING NOT MEASURED YET",
    },
    { key: "azStep", line: AZ_STEP_LINE },
    { key: "ribbon", line: RIBBON_LINE },
    { key: "reach", line: `EVIDENCE REACHES ${Math.round(s.reachM)} m — BEYOND THAT, UNKNOWN` },
    { key: "provenance", line: provenanceLine(s) },
    { key: "scoring", line: scoringLine(s) },
  ];
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
export const CONTACT_WHY: Record<BestSpotSpot["contact"], string> = {
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
 * The row's provenance footnote, joined: the note, R1's aerial flag, the ground-access readout and
 * item 5's refine delta. ONE builder for the desktop row, the hover tip and the mobile row — three
 * copies of the same join is exactly the drift the shared tier exists to stop.
 */
export function spotNoteLine(spot: BestSpotSpot): string {
  return [
    spot.note,
    spot.aerial ? "▲ AERIAL" : null,
    spot.groundReachable ? null : "NO GROUND ACCESS BELOW",
    refineDeltaLabel(spot),
  ]
    .filter(Boolean)
    .join(" · ");
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
  const note = spotNoteLine(spot);
  if (note) out.push(note);
  return out;
}
