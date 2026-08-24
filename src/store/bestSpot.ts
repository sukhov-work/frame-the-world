import { create } from "zustand";
import { BESTSPOT } from "../components/globe/tuning";
import {
  BESTSPOT_SCORING_V1,
  resolveScoring,
  sanitizeScoringPatch,
  scoringHash,
  type BestSpotScoring,
  type BestSpotScoringPatch,
} from "../lib/geo/bestSpotScoring";
import type { BestSpotKind } from "../lib/geo/bestSpotTypes";
import { loadViewPrefs, saveViewPref } from "../lib/prefs";
import type { HeatRampId } from "../lib/theme/heatPalette";

/**
 * BEST SPOT seam (`.claude/claude-docs/BESTSPOT_SPEC_V2.md` §5.6/§6.8/§6.9) — the bridge between
 * the disc solver (worker → `scene/bestSpotFeed`) and the desktop panel. Three bands, and the
 * band a field is in decides WHO may write it:
 *
 *  1. **UI-written, engine-read** — the request: what event, how big a disc, how high a sheet.
 *  2. **Engine-written mirrors** (`bestSpotFeed` ONLY, never React) — the answer plus its honesty
 *     channels. `_syncBestSpot` is the single writer, the `store/plan._syncPlan` grammar.
 *  3. **Scoring** — the §5.6 hot-swap seam's store half. `setScoring` sanitizes → resolves →
 *     bumps the epoch; the feed compares epochs and re-posts the profile ON THE JOB.
 *
 * Hover flows BOTH ways and therefore needs TWO fields (the `store/find` precedent): `hoverKey` is
 * the panel row under the pointer (React-written → the marker ring eases up), `sceneHoverKey` is
 * the marker under the canvas pointer (globe-written → the row highlights). One shared field makes
 * the two sides fight.
 *
 * The tunables the panel needs are MIRRORED here (`radiiM`, `topKCap`, `ultraMaxRadiusM`,
 * `displayLo/Hi`) so `components/panels|controls/**` needs no `components/globe/**` import — the
 * `store/minimap.patchM` trick, and a hard requirement of `mobileFence.test.ts` for the controls.
 */

/** Which heat LUT the sheet samples. A NAME, never a colour: `lib/theme/heatPalette.ts` owns the
 *  stops and `HeatRampId` is imported rather than re-declared — a second copy of that union is
 *  exactly the "two conventions that look alike" drift this repo keeps paying for. */
export type BestSpotRampId = HeatRampId;

/**
 * One shortlist entry — everything a panel row AND its scene marker need, plain data.
 *
 * Lives here rather than in `lib/geo` for the `store/find.FindGhost` reason: it is the SEAM's
 * shape (row ↔ marker join, panel copy), not the kernel's. The kernel's per-cell result is
 * `lib/geo/bestSpotTypes.CellScore`; this is the projection of the best eight of them.
 */
export interface BestSpotSpot {
  /** `${col}:${row}` in the solved grid — the row ↔ marker join key, and what `hoverKey` carries. */
  key: string;
  /** 1..`BESTSPOT.topK` — rendered as the digit inside the marker core (§6.8). */
  rank: number;
  /** ABSOLUTE composite 0..1. §3.5 is non-negotiable: every row prints this BESIDE its relative
   *  bar, so an all-bad disc reads as all-bad instead of being renormalised into looking good. */
  score: number;
  latDeg: number;
  lonDeg: number;
  /** Ground distance (m) and bearing (deg, 0 = north) from the disc centre — the `62 m NE` half. */
  distM: number;
  bearingDeg: number;
  /** What sets the horizon at the contact azimuth — drives the `GRAZE` / `OPEN HORIZON` / `GAP`
   *  row copy. Mirrors the metric's own verdict; the panel never re-derives it. */
  contact: "graze" | "gap" | "open";
  /** The provenance footnote (`ON A BRIDGE`, `TREE LINE` + "(modelled height)"), or null. */
  note: string | null;
  /** Owner ruling **R1**: the cell is above `access.aerialMinM`, i.e. DRONE semantics apply. */
  aerial: boolean;
  /** R1's secondary readout — is the ground directly below this cell accessible on foot? */
  groundReachable: boolean;
  /** Offset from the event instant (ms) at which the disc is best framed from here — the
   *  `· 3m20s` half of the row. */
  leadMs: number;
  /** Owner ruling **R8** — the cell pitch this row's ACCESSIBILITY was decided at. 1 m on every
   *  solve (the "stand on the footpath, not in the hedge" half, +59 ms); the field stays 3 m. */
  gridCellM: number;
  /** …and whether its OBSTRUCTION has been re-solved at 1 m too. That half is user-triggered
   *  (`REFINE THIS SPOT`, ~1.0-1.6 s) because it needs a 985 ms streamed hull. */
  obstructionRefined: boolean;
}

/**
 * The three RENDER classes, counted over the solved disc (§6.9's legend has one line each).
 * `unknown` is UNMAPPED — evidence below `gates.minCoverage`, no ink, excluded from the top-K —
 * and it is NEVER a low score (`bestSpotMetric.ts:757`). `blocked` is `A_hard = 0`: you cannot
 * stand there at all (water, a building interior, military/industrial).
 */
export interface BestSpotVerdictCounts {
  scored: number;
  unknown: number;
  blocked: number;
  total: number;
}

/** Frozen: it is the shared pre-solve default, and a consumer that mutated it would poison every
 *  later reset. The feed always REPLACES the object, never edits it. */
const ZERO_COUNTS: BestSpotVerdictCounts = Object.freeze({
  scored: 0,
  unknown: 0,
  blocked: 0,
  total: 0,
});

/** The pre-solve provenance reading — frozen for the `ZERO_COUNTS` reason. */
const ZERO_PROVENANCE = Object.freeze({ enriched: 0, osm: 0 });

/** The engine-written band — `_syncBestSpot`'s domain, named once so the type can't drift. */
type BestSpotFeedKeys =
  | "verdictCounts"
  | "coverage"
  | "unmappedFrac"
  | "reachM"
  | "topK"
  | "sceneHoverKey"
  | "solving"
  | "ladderRung"
  | "tilesPending"
  | "gridCellM"
  | "sheetAltM"
  | "suggestedLiftM"
  | "trackNull"
  | "builtDensityPerKm2"
  | "terrainOnly"
  | "heightProvenance"
  | "shortlistCellM"
  | "scoringHashLive"
  | "centreLatDeg"
  | "centreLonDeg"
  | "moonWorth"
  | "terrainPostingM"
  | "refining"
  | "refineSpot";

export interface BestSpotState {
  // ── UI-written, engine-read ────────────────────────────────────────────────────────────────
  /** Panel visibility. `setOpen` is what `PlanFindToggle`'s mutual-exclusion `pick()` calls on
   *  the OTHER two windows — plain, unconditional, no side effects, exactly like plan/find. */
  open: boolean;
  setOpen(open: boolean): void;
  /** Which event the disc is scored for (§6.9's first chip row). One code path for all four. */
  kind: BestSpotKind;
  setKind(kind: BestSpotKind): void;
  /** Disc radius (m). Clamped to a member of `BESTSPOT.radiiM` — the chips are the contract, and
   *  an off-ladder radius would silently change the solver's cost model. */
  radiusM: number;
  setRadiusM(m: number): void;
  /** Sheet lift (m) ABOVE the pedestrian eye; `sheetAltM = BESTSPOT.eyeM + liftM` is published by
   *  the engine. 0 is R6's default. */
  liftM: number;
  setLiftM(m: number): void;
  /**
   * Owner ruling **R8** — the 1 m ULTRA tier. **Refused above `ultraMaxRadiusM`** (1 m at 500 m
   * is 1,002,001 cells ≈ 12.2 s), and cleared automatically when the radius grows past it, so
   * there is no ordering of setter calls that reaches a 1 m cell on a 500 m disc.
   */
  ultra: boolean;
  setUltra(on: boolean): void;
  /** DERIVED, never set directly: the REQUESTED field resolution (m). `gridCellM` is what the
   *  solver actually delivered on the current ladder rung. */
  cellM: number;
  /** Which heat LUT — the panel's A/B button (§6.9 `.bsp-ab`). */
  rampId: BestSpotRampId;
  setRampId(id: BestSpotRampId): void;
  /** Panel row under the pointer → that marker eases up (React-written, §6.8). */
  hoverKey: string | null;
  setHoverKey(key: string | null): void;

  // ── Engine-written mirrors (bestSpotFeed only — never write from React) ────────────────────
  /** Render-class census over the disc — the `36% UNMAPPED` status line and the legend counts. */
  verdictCounts: BestSpotVerdictCounts;
  /** Mean per-cell evidence coverage 0..1 over the FULL swept span (the honesty channel `C`). */
  coverage: number;
  /** Fraction of cells that came back UNMAPPED. Published separately from `verdictCounts`
   *  because the panel prints it every frame and must not divide in render. */
  unmappedFrac: number;
  /** §3.4 item 5 — how far the evidence actually REACHED (m), the panel's `EVIDENCE REACHES 700 m
   *  — BEYOND THAT, UNKNOWN` line. Without this channel, refinement silently LOWERS scores as
   *  data arrives and that reads as a regression. */
  reachM: number;
  /** The shortlist, best first. **Greyed in the panel until the last ladder rung lands** — the
   *  coarse field is honest (ρ 0.767–0.910) but the coarse top-K is not (§2.3). */
  topK: readonly BestSpotSpot[];
  /** Marker under the canvas pointer → that row highlights (globe-written). */
  sceneHoverKey: string | null;
  /** A solve is in flight. NOT a spinner — the R0 sheet is its own progress indicator (§2.3). */
  solving: boolean;
  /** Index into `BESTSPOT.ladderCellsM` of the rung that last LANDED; −1 before first ink. The
   *  determinate `24 m → 3 m` pip reads this, and so does the top-K's greyed state. */
  ladderRung: number;
  /** MVT fetches outstanding — the `READING THE MAP` chip. The only leg longer than a frame and
   *  the only one that can fail, which is why it is the one thing that gets a chip. */
  tilesPending: boolean;
  /** Cell size (m) of the rung that last landed. `cellM` is what was REQUESTED. */
  gridCellM: number;
  /** Sheet altitude above ground (m) = `BESTSPOT.eyeM + liftM`, published so the altitude chip
   *  and the scale spoke read ONE number rather than each re-deriving it. */
  sheetAltM: number;
  /** Owner ruling **R6** — the COMPUTED lift (m) that would clear the floor, or null when the
   *  field is already legible. Never a constant: it is the lowest of `BESTSPOT.liftProbesM` that
   *  puts more than `emptyFieldFrac` of cells above `displayLo`. */
  suggestedLiftM: number | null;
  /** AS-BUILT: `eventTrack` returns null when `SearchRiseSet` finds nothing in the local-day
   *  window — measured across the TROPICS, not just the poles (2 null days in 60 consecutive
   *  Dnipro moonrises). The panel owes that its own line; a blank disc with no explanation is
   *  the failure this flag exists to prevent. */
  trackNull: boolean;
  /** S7's built-density prior input: buildings per km² straight off the parsed tiles (Dnipro
   *  centre 558/21, rural UA 1/21, Everest 0/21). Free, and it is what tells a terrain-only disc
   *  apart from a genuinely open one — the confidently-uniform 0.470–0.661 failure mode (§3.2). */
  builtDensityPerKm2: number;
  /**
   * **S7 — the built-density prior FIRED.** MVT presence is not evidence of survey: `parseTile`
   * does `if (!layer) continue`, so "tile fetched, zero buildings" is byte-identical to "OSM never
   * surveyed here", and a terrain-only rural disc measured `scored`, C = 1.000, openSky 40/40 and
   * S = 0.470-0.661 — uniform, warm, confident. When the parsed density falls under
   * `builtDensityFloorPerKm2` this goes true, the solver stops crediting OPEN-SKY rays as evidence,
   * and the panel says `⚠ RURAL — TERRAIN ONLY, NO SURVEYED BUILDINGS HERE`. A disc whose horizon
   * is set by REAL RELIEF (Everest) is untouched by it — the rays there are not open sky.
   */
  terrainOnly: boolean;
  /**
   * **S7's provenance badge**, counted per disc where the two tilesets are still distinguishable.
   *
   * §8: building heights are metre-exact only where the ENRICHED bake has real geometry; elsewhere
   * they are OSM-derived with **~78 % class defaults** (99,590 of 127,890). The panel may not make
   * that claim from a constant — it reads THIS.
   */
  heightProvenance: { enriched: number; osm: number };
  /** Owner ruling **R8** — the cell pitch the shortlist's ACCESSIBILITY was decided at (1 m when
   *  the fine landcover grid ran, the field's own pitch otherwise). The field's obstruction stays
   *  `gridCellM`; naming the two separately is the C2 half of §8's ladder. */
  shortlistCellM: number;
  /** The `scoringHash` echoed by the result currently on screen. §5.6: a mismatch against
   *  `scoringHash(scoring)` means a stale job landed after a newer patch — that one comparison is
   *  what stops "the picture disagrees with the numbers". Null before the first result. */
  scoringHashLive: string | null;
  /**
   * The centre the disc was ACTUALLY solved at — **not the request** (S3d).
   *
   * The panel used to fall back to `camera.tempPin`, which is R2's centre SOURCE, i.e. what was
   * asked for. Between a pin move and the re-solve landing those two are different places, so the
   * header named a location the sheet was not about — an honesty defect, and exactly the class
   * this feature exists to close. Null before the first result.
   */
  centreLatDeg: number | null;
  centreLonDeg: number | null;
  /** Owner ruling **R7** — `worth` of the current MOON event (`moonPhaseTerm × twilightGate`), the
   *  `☾ THIS MOON IS WORTH 0.09` badge. Exactly 1 for sun kinds, which never consult it. */
  moonWorth: number;
  /**
   * The effective DSM posting (m) under THIS disc — √(covered area / covered cells).
   *
   * ~145 m inside the baked city and ~2 km on plain world terrain, so a panel line that quoted the
   * baked-city measurement everywhere was wrong by ~14× outside Dnipro/Kyiv. 0 before the first
   * result, which the panel reads as "not measured yet" rather than as "perfect".
   */
  terrainPostingM: number;
  /** Owner ruling **R8** — a 1 m obstruction re-solve of ONE shortlisted cell is in flight. The
   *  ONE place in this feature a spinner is justified (~1.0–1.6 s); the disc itself never gets
   *  one, because the coarse sheet IS its own progress indicator (§2.3). */
  refining: boolean;
  /** Ask for that re-solve. Installed by `scene/bestSpotFeed` (a no-op until the engine mounts, so
   *  the panel can call it unconditionally); `key` is a `topK` row's `${col}:${row}`. */
  refineSpot(key: string): void;
  /** The ONE engine writer. Partial merge — a feed that only learned `tilesPending` must not
   *  blank the fields it did not compute. */
  _syncBestSpot(p: Partial<Pick<BestSpotState, BestSpotFeedKeys>>): void;

  // ── Scoring (§5.6 hot-swap seam, store half) ───────────────────────────────────────────────
  /** The RESOLVED, frozen profile the solver runs. Rides the job, never a module read. */
  scoring: BestSpotScoring;
  /** The PATCH the resolved profile came from — null means "shipped default". This, and only
   *  this, is what gets persisted (§5.7): a future change to a shipped default must propagate to
   *  every field the owner never touched. */
  scoringPatch: BestSpotScoringPatch | null;
  /** Bumped on every accepted `setScoring`. The feed watches this integer, not the object. */
  scoringEpoch: number;
  /**
   * Sanitize → resolve → bump the epoch → persist the PATCH (debounced).
   *
   * REPLACES the current patch rather than deep-merging onto it: the §5.6 DEV seam owns the
   * merge (it has `scoringPatch` to merge from) and a store that merged too would make
   * "reset this one field" unexpressible. `null` clears the patch back to the shipped default.
   */
  setScoring(patch: BestSpotScoringPatch | null): void;

  // ── Tunable mirrors — so the panel needs no globe import (the minimap.patchM trick) ────────
  radiiM: readonly number[];
  topKCap: number;
  ultraMaxRadiusM: number;
  displayLo: number;
  displayHi: number;
}

/** Nearest chip on the radius ladder — an off-ladder radius silently changes the cost model. */
function snapRadiusM(m: number): number {
  if (!Number.isFinite(m)) return BESTSPOT.defaultRadiusM;
  let best = BESTSPOT.radiiM[0] as number;
  for (const r of BESTSPOT.radiiM) if (Math.abs(r - m) < Math.abs(best - m)) best = r;
  return best;
}

/** R6/§6.9: an exact 0 is the pedestrian default AND the double-click reset; the log slider's own
 *  domain starts at `liftMinM`, so anything between is snapped to 0 rather than to half a metre —
 *  the two are visually identical and 0 is the one the panel labels. */
function clampLiftM(m: number): number {
  if (!Number.isFinite(m) || m <= 0) return 0;
  if (m < BESTSPOT.liftMinM) return 0;
  return Math.min(BESTSPOT.liftMaxM, m);
}

/** R8 in one place: ULTRA only exists at or below `ultraMaxRadiusM`. */
function ultraAllowedAt(radiusM: number): boolean {
  return radiusM <= BESTSPOT.ultraMaxRadiusM;
}

function cellFor(ultra: boolean, radiusM: number): number {
  return ultra && ultraAllowedAt(radiusM) ? BESTSPOT.ultraCellM : BESTSPOT.defaultCellM;
}

// ── Persistence ──────────────────────────────────────────────────────────────────────────────
// `saveViewPref` runs a FULL `loadViewPrefs()` (JSON.parse + sanitize of the whole blob) on every
// write, so a taste slider under the pointer would pay that per frame. TRAILING edge: one write
// per quiet `BESTSPOT.persistDebounceMs` and the LAST patch wins, which is what a drag means.
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistPatchDebounced(patch: BestSpotScoringPatch | null): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // A cleared patch is stored as ABSENT, never as `{}` — "custom (0 fields)" is not a tune.
    saveViewPref("bestSpotTuning", patch ?? undefined);
  }, BESTSPOT.persistDebounceMs);
}

// Boot hydration (the `store/sky` idiom — one read at module init; SSR/tests degrade to {}).
const storedPatch = loadViewPrefs().bestSpotTuning ?? null;
const bootPatch = storedPatch && Object.keys(storedPatch).length > 0 ? storedPatch : null;

export const useBestSpotStore = create<BestSpotState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),

  kind: "sunset",
  setKind: (kind) => set({ kind }),

  radiusM: BESTSPOT.defaultRadiusM,
  setRadiusM: (m) => {
    const radiusM = snapRadiusM(m);
    // R8: growing the disc past the ULTRA ceiling drops ULTRA with it, so no call order reaches
    // a 1 m cell on a 500 m disc.
    const ultra = get().ultra && ultraAllowedAt(radiusM);
    set({ radiusM, ultra, cellM: cellFor(ultra, radiusM) });
  },

  liftM: BESTSPOT.defaultLiftM,
  setLiftM: (m) => set({ liftM: clampLiftM(m) }),

  ultra: false,
  setUltra: (on) => {
    const { radiusM } = get();
    const ultra = on && ultraAllowedAt(radiusM);
    set({ ultra, cellM: cellFor(ultra, radiusM) });
  },
  cellM: BESTSPOT.defaultCellM,

  rampId: BESTSPOT.rampId,
  setRampId: (rampId) => set({ rampId }),

  hoverKey: null,
  setHoverKey: (hoverKey) => set({ hoverKey }),

  verdictCounts: ZERO_COUNTS,
  coverage: 0,
  unmappedFrac: 0,
  reachM: 0,
  topK: [],
  sceneHoverKey: null,
  solving: false,
  ladderRung: -1,
  tilesPending: false,
  gridCellM: BESTSPOT.defaultCellM,
  sheetAltM: BESTSPOT.eyeM + BESTSPOT.defaultLiftM,
  suggestedLiftM: null,
  trackNull: false,
  builtDensityPerKm2: 0,
  terrainOnly: false,
  heightProvenance: ZERO_PROVENANCE,
  shortlistCellM: BESTSPOT.defaultCellM,
  scoringHashLive: null,
  centreLatDeg: null,
  centreLonDeg: null,
  moonWorth: 1,
  terrainPostingM: 0,
  refining: false,
  // A no-op until `scene/bestSpotFeed` installs the real one, so the panel never has to branch on
  // whether the engine has mounted — the `store/find` seam grammar.
  refineSpot: () => {},
  _syncBestSpot: (p) => set(p),

  scoring: resolveScoring(bootPatch),
  scoringPatch: bootPatch,
  scoringEpoch: 0,
  setScoring: (patch) => {
    const clean = patch ? sanitizeScoringPatch(patch) : null;
    const next = clean && Object.keys(clean).length > 0 ? clean : null;
    set({
      scoring: resolveScoring(next),
      scoringPatch: next,
      scoringEpoch: get().scoringEpoch + 1,
    });
    persistPatchDebounced(next);
  },

  radiiM: BESTSPOT.radiiM,
  topKCap: BESTSPOT.topK,
  ultraMaxRadiusM: BESTSPOT.ultraMaxRadiusM,
  displayLo: BESTSPOT.displayLo,
  displayHi: BESTSPOT.displayHi,
}));

// §5.7 rule 4: a non-empty persisted patch MUST announce itself, or the next taste pass runs
// against numbers the owner forgot he set. DEV console at boot; the panel's status line
// (`SCORING: custom (n fields) · <hash>`) is the shipped half and lands with S5.
if (import.meta.env.DEV && typeof window !== "undefined") {
  if (bootPatch) {
    console.info(
      `bestSpot: SCORING custom · ${scoringHash(useBestSpotStore.getState().scoring)} ` +
        `(default ${scoringHash(BESTSPOT_SCORING_V1)}) — restored from ftw:view-prefs:v1`,
    );
  }
  // Dev-only introspection (the window.__* DEV-seam registry, global.d.ts) so browser
  // verification can drive the disc without reaching through the UI.
  window.__bestSpotStore = useBestSpotStore;
}
