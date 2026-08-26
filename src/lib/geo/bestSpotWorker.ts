/// <reference lib="webworker" />
/**
 * BEST SPOT — THE LONG-LIVED SOLVE WORKER (`BESTSPOT_SPEC_V2.md` §7 S3d).
 *
 * =============================================================================================
 * WHY A WORKER AT ALL, AND WHY IT IS MANDATORY RATHER THAN AN OPTIMISATION
 * =============================================================================================
 * The COARSEST rung of the ladder is 10.6 ms of solve on top of 24.4 ms of prep (track + MVT
 * parse) — already over a 16.7 ms frame — and the finest rung is 680 ms, i.e. 41 dropped frames
 * (`SPEC_V2 §2.3`). There is no cadence, no time-slice and no budget under which this runs on the
 * main thread; the only question was whether the worker is long-lived, and it is (see LIFECYCLE).
 *
 * =============================================================================================
 * THE FENCE THIS FILE EXISTS TO HOLD: **NO `components/globe/tuning` IMPORT.**
 * =============================================================================================
 * A long-lived worker latches module scope AT SPAWN. A tunable read here would be frozen at the
 * first toggle and invisibly stale for the rest of the session — the taste pass would move the
 * panel's numbers and not the picture. So EVERYTHING tunable rides the JOB:
 *   · the resolved scoring profile (`BestSpotScoring`) and its `scoringHash`;
 *   · the display window `displayLo`/`displayHi` the RG8 red channel is quantised over;
 *   · the ribbon widths `VECTOR.roadWidthM` / `VECTOR.waterwayWidthM` (`buildLandGrid`'s
 *     `widths` parameter — added in this slice precisely so this file needs no tuning edge);
 *   · the MVT endpoint, zoom, ladder rungs, collar, eye height and the tile floor.
 * `test/components/globe/fences.test.ts` pins the direct rule AND walks this file's whole static
 * import graph, asserting the set of modules that reach `components/globe/tuning` transitively
 * equals a written allow-list with a reason per entry. There is no ambiguity left to inherit.
 *
 * =============================================================================================
 * LIFECYCLE — spawn on first toggle, keep alive, terminate on dispose
 * =============================================================================================
 * The one shipped worker in this repo is single-shot-and-terminate (`decode/workerClient.ts:45,
 * 78-80`) because each RAW decode wants a fresh wasm heap. This one is the opposite shape: its
 * whole value is the RESIDENT state between jobs — parsed MVT tiles (22 ms), the flattened terrain
 * TIN, the event track (2.4 ms), the per-rung DSM/LandGrid/term buffers and the hull cache. A
 * respawn would re-pay all of it, so:
 *   · spawn — lazily, on the first `solve` (i.e. the first time the feature is switched on);
 *   · keep alive across centre changes: a CENTRE CHANGE DROPS THE GEOMETRY BUT KEEPS THE WORKER
 *     and its parsed-tile cache, because a pin nudged 40 m re-uses every z14 tile it had;
 *   · `cancel(jobId)` marks a job abandoned — the ladder checks between rungs and stops, so a
 *     cancelled 3 m rung costs at most one rung of latency and never leaks a posted result;
 *   · `terminate()` only in `dispose()`.
 * The staleness that a long-lived worker buys is answered by the JOB rule above and by the
 * `scoringHash` echo: every result carries the hash it was computed with, and the main thread
 * drops any result whose hash is not the store's current one.
 *
 * =============================================================================================
 * THE WORKER RE-FETCHES AND RE-PARSES MVT ITSELF
 * =============================================================================================
 * Reading the main thread's handle is impossible and would be wrong anyway: `attachVectorTiles`'s
 * cache is closure-private, its values are deep `[number,number][][][]` (a recurring expensive
 * structured clone), its 56-entry FIFO can evict mid-solve, and a failed fetch is cached as
 * PERMANENTLY `"failed"` for the process (`vectorTiles.ts:607` returns early on `cache.has`). So
 * this worker keeps its OWN cache with two deliberate differences: it never evicts (a disc is 1–4
 * z14 tiles) and a FAILED tile is not cached — the next job retries it, which is what makes a
 * transient network blip recoverable instead of permanent.
 *
 * `parseVectorTile` and `lonLatToTile` are IMPORTED from the shipped parser rather than forked:
 * two MVT parsers that look alike is this repo's most expensive recurring bug class, and the
 * parser is already pure and three-free. `@mapbox/vector-tile` and `pbf` are STATIC imports — a
 * dynamic `await import(...)` inside a worker is what triggered the libheif "optimized
 * dependencies changed" full-page reload (`astro.config.mjs:73-80`).
 */

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  lonLatToTile,
  parseVectorTile,
  type ParsedVtile,
} from "../../components/globe/scene/vectorTiles";
import {
  accessFromTermByte,
  compileAccessTables,
  composeField,
  composeScores,
  CONFORM_N,
  discGeometry,
  solveTerms,
  type BestSpotFieldPack,
  type BestSpotTermBuffer,
  type DiscGeometry,
  type HullResidency,
  type SolveRefusal,
  TERM_FLAG,
  ULTRA_CELL_M,
} from "./bestSpotSolver";
import {
  INVALIDATION_RANK,
  scoringHash as hashOf,
  trackHash,
  type BestSpotScoring,
  type InvalidationClass,
} from "./bestSpotScoring";
import { localDayWindow } from "../ephemeris/dayArc";
import { eventTrack, moonWorth } from "./bestSpotTrack";
import { AERIAL_MIN_M, type BestSpotKind, type CellAccess, type EventTrack } from "./bestSpotTypes";
import { accessSoftGain } from "./bestSpotMetric";
import { horizonDipDeg } from "./horizonProfile";
import {
  accessAt,
  buildLandGrid,
  type LandGrid,
  type LandRibbonWidths,
} from "./landcoverRaster";
import { CANOPY_CENTER_Y, CANOPY_HALF_Y, UNIT_CANOPY_R } from "./occlusion";
import {
  addCanopy,
  createLocalDsm,
  enuFrameAt,
  enuOfEcef,
  lonLatOfEnu,
  rasterizeTinGround,
  sealDsm,
  SRC_BUILDING,
  SRC_DECK,
  SRC_TREE,
  type EnuFrame,
  type LocalDsm,
} from "./localDsm";
import type { RayHulls } from "./horizonSweep";

// Referenced so the two MVT libs are STATICALLY reachable from the worker entry even if a future
// refactor stops re-exporting them through the parser — the pre-bundle guarantee above depends on
// it, and a dynamic import here costs a full page reload in dev.
void VectorTile;
void PbfReader;

// ---------------------------------------------------------------------------------------------
// THE WIRE — every message type, exported so the client type-imports exactly one description
// ---------------------------------------------------------------------------------------------

/**
 * One streamed TIN mesh, flattened on the MAIN thread and transferred as a COPY.
 *
 * COPY, never a view onto the live attribute: `instanceMatrix`/`position` arrays belong to three,
 * and transferring them would DETACH the buffer three renders from. The flatten is
 * `positionsOf`-shaped (the `planFeed.ts:204` idiom) so a quantised/interleaved b3dm attribute
 * arrives normalised rather than as raw shorts.
 */
export interface TinMeshWire {
  /** Stride-3 local vertex positions. */
  positions: Float32Array;
  /** Triangle indices, or null for non-indexed geometry. */
  index: Uint32Array | null;
  /** Column-major 4×4 (`Matrix4.elements`) placing `positions` in ECEF. */
  matrixWorld: Float64Array;
}

/**
 * One cell's TREE INSTANCES, flattened on the main thread as a COPY (2026-08-26g).
 *
 * Canopies ride their own wire rather than joining `built` because they are a different KIND of
 * evidence, not a different mesh: they go to the DSM's `canopyTop` layer and never to `solidMask`,
 * they are tagged `SRC_TREE` so the honesty layer can find them again, and their heights are ~99.9 %
 * a random draw over a class range rather than a survey. Folding them into `built` would make all
 * three of those facts unrecoverable one function later.
 *
 * The decode contract is `occlusion.sweepTreeInstances`'s, verbatim: 16 floats per instance in the
 * CELL frame, yaw-only about +Y, so `m5` is the height in metres and `|col0| · 0.5` is the canopy
 * radius; `matrixWorld` is the rigid cell→ECEF transform.
 */
export interface CanopyWire {
  /** Raw `InstancedMesh.instanceMatrix.array` slice — 16 floats per instance, cell-local. */
  instanceMatrices: Float32Array;
  count: number;
  /** Column-major 4×4 placing the instances in ECEF. */
  matrixWorld: Float64Array;
}

/** MVT ribbon widths, lifted off `VECTOR` on the main thread — see the fence note in the header. */
export type BestSpotRibbonWidths = LandRibbonWidths;

/**
 * S7's PROVENANCE BADGE, counted where the meshes actually are — on the main thread, per disc.
 *
 * §8's ladder is only honest if the panel can say WHICH half of the city it is standing in:
 * building heights are metre-exact where the ENRICHED bake has real geometry and OSM-derived
 * everywhere else, and the bake's own statistic is **~78 % class defaults (99,590 of 127,890)**.
 * Nothing in `lib/**` can see the difference — both tilesets arrive as anonymous TIN — so the
 * split is counted at `flattenTin` time and RIDES THE JOB, exactly like the ribbon widths.
 */
export interface BestSpotHeightProvenance {
  /** Meshes of the ENRICHED bake that reach the disc — real surveyed geometry, metre-exact. */
  enriched: number;
  /** Meshes of the global OSM building tileset — extruded footprints, ~78 % default heights. */
  osm: number;
}

/** Everything `solve` needs. All of it plain data or transferables. */
export interface BestSpotSolveJob {
  type: "solve";
  jobId: number;
  /** `store/bestSpot.scoringEpoch` at post time — echoed back so a stale epoch is droppable. */
  epoch: number;
  scoring: BestSpotScoring;
  scoringHash: string;
  centreLatDeg: number;
  centreLonDeg: number;
  /** Geodetic altitude (m) the `EnuFrame` is built at — THE DATUM BRIDGE (`buildConformLattice`). */
  frameAltM: number;
  radiusM: number;
  collarM: number;
  /** Coarse → fine (`BESTSPOT.ladderCellsM`), or a single rung for the drag tier. */
  ladderCellsM: readonly number[];
  kind: BestSpotKind;
  /** Scene time (epoch ms). The TRACK frames on the LOCAL DAY, so a scrub inside one day is a
   *  cache hit and re-runs NOTHING (`SPEC_V2 §2.2` T1′). */
  sceneMs: number;
  eyeM: number;
  liftM: number;
  refractionK: number;
  displayLo: number;
  displayHi: number;
  ribbonWidths: BestSpotRibbonWidths;
  /** MVT source, on the job so no `STREETS` read latches here. */
  tileJsonUrl: string;
  tileZ: number;
  /** `BESTSPOT.minTilesForSolve` — below this many PARSED overlapping tiles the disc is refused. */
  minTilesForSolve: number;
  /** Terrain TIN (ground tileset). Rasterised into `LocalDsm.ground`. */
  terrain: TinMeshWire[];
  /** Building TIN (OSM + enriched tilesets). Rasterised into the SOLID layer — see `buildDsm`. */
  built: TinMeshWire[];
  /**
   * Baked TREE instances covering the disc (2026-08-26g). Optional on the wire so every existing
   * job literal — nine of them across the test suite — stays valid and keeps meaning exactly what
   * it meant: a job with no canopies is a job whose DSM has no canopy layer.
   */
  canopies?: CanopyWire[];
  /** S7's badge — which tileset the `built` meshes came from. Counted on the main thread. */
  heightProvenance: BestSpotHeightProvenance;
  /**
   * **THE T1 KEY (S6).** Bumped by the feed ONLY when the geometry sources actually change — a new
   * centre/radius, or a streaming refinement past `rebuildQuietFrames`. It is NOT bumped by a lift
   * change or a day step, and that is the whole S6 pin: the DSM and the LandGrid are eye- AND
   * time-free, so a lift drag must re-use them, and only then can the hull cache (keyed on
   * `dsm.ground` IDENTITY inside `solveTerms`) hit at all.
   *
   * **The defect this closes, measured:** `solveRung` used to call `buildDsm` unconditionally, so
   * every lift change produced a FRESH `ground` array, `solveTerms`' `cached.ground === dsm.ground`
   * test failed on every azimuth, and a 2 → 400 m drag rebuilt all 39 hulls PER FRAME. The plan
   * pinned `hullBuilds` at 0 for that drag; as built it was 39.
   */
  sourcesEpoch: number;
  /** `"stream"` when the hulls cannot be resident (ULTRA — 898 MiB at 1 m/K=40). */
  mode: HullResidency;
  /** R6: probe these lifts at the coarse rung when the field comes back empty. Empty = skip. */
  liftProbesM: readonly number[];
  liftProbeCellM: number;
  emptyFieldFrac: number;
  /** Top-K cap and its non-maximum-suppression separation (m). */
  topK: number;
  topKMinSepM: number;
  /** `SolveInput.refuseBelowReachM` — S7 turns it ON at `BESTSPOT.refuseBelowReachM` (= the collar,
   *  the measured safe ceiling: 0 cells refused on a fully-mapped disc, 175 at 420 m). */
  refuseBelowReachM: number;
  /** S7's built-density prior — `BESTSPOT.builtDensityFloorPerKm2`. Below it the disc is
   *  TERRAIN-ONLY and `SolveInput.builtEvidence` goes false. The THRESHOLD rides the job; the
   *  worker measures the density and applies the verdict (`SPEC_V2 §3.2` case 3). */
  builtDensityFloorPerKm2: number;
  /** R8 half one — how many top candidates get their ACCESSIBILITY re-solved at `ultraCellM`
   *  (`BESTSPOT.shortlistCandidates`). 0 disables the 1 m pass. */
  shortlistCandidates: number;
  /** R8's shortlist cell pitch (m) — `BESTSPOT.ultraCellM`. On the job for the fence's sake. */
  shortlistCellM: number;
}

/** §5.6's hot-swap: recompose the RESIDENT term buffer at the finest landed rung. */
export interface BestSpotApplyJob {
  type: "apply";
  jobId: number;
  epoch: number;
  scoring: BestSpotScoring;
  scoringHash: string;
  displayLo: number;
  displayHi: number;
  /** The lowest invalidation class the patch touched (`scoringInvalidation`). `"recompose"` is the
   *  0.272 ms path; anything heavier is refused here and the client re-posts a full `solve`. */
  from: InvalidationClass;
  topK: number;
  topKMinSepM: number;
  /** R8 half one, on the recompose path too — the 1 m accessibility grid is RESIDENT, so a taste
   *  patch re-ranks against it for free rather than dropping back to the 3 m verdict. */
  shortlistCandidates: number;
  shortlistCellM: number;
}

/** R8 — the explicit 1 m obstruction re-solve of ONE shortlisted cell. */
export interface BestSpotRefineJob {
  type: "refine";
  jobId: number;
  epoch: number;
  scoring: BestSpotScoring;
  scoringHash: string;
  displayLo: number;
  displayHi: number;
  /** `${col}:${row}` in the CURRENT finest rung — the row ↔ marker join key. */
  key: string;
  /** Half-span (m) of the 1 m disc solved around that cell. */
  radiusM: number;
  eyeM: number;
  liftM: number;
  refractionK: number;
  refuseBelowReachM: number;
}

export interface BestSpotCancelJob {
  type: "cancel";
  jobId: number;
}

export type BestSpotWorkerRequest =
  | BestSpotSolveJob
  | BestSpotApplyJob
  | BestSpotRefineJob
  | BestSpotCancelJob;

/** One shortlist row, plain data — structurally `store/bestSpot.BestSpotSpot`. */
export interface BestSpotWireSpot {
  key: string;
  rank: number;
  score: number;
  latDeg: number;
  lonDeg: number;
  distM: number;
  bearingDeg: number;
  contact: "graze" | "gap" | "open";
  note: string | null;
  aerial: boolean;
  groundReachable: boolean;
  leadMs: number;
  /**
   * Owner ruling **R8**, and the done-check that proves the ladder is honest: **the shortlist
   * reports `gridCellM === 1` while the field reports 3.** It is the cell pitch this ROW's
   * ACCESSIBILITY was decided at — 1 m whenever the fine landcover grid was built, the field's own
   * pitch otherwise. OBSTRUCTION is still the field's (3 m) until `REFINE THIS SPOT` runs, which
   * is why the panel's copy names the two separately; an unqualified "1 m" is a C2 violation.
   */
  gridCellM: number;
  /** True once `refine` has re-solved this row's OBSTRUCTION at 1 m (R8's second half, the one
   *  place a spinner is justified). Distinct from `gridCellM`, which is about accessibility. */
  obstructionRefined: boolean;
  /**
   * The score this row carried immediately BEFORE that re-solve — absent until one lands.
   *
   * The WORKER never writes it: it is stamped by `bestSpotFeed.onRefined`, which is the only place
   * that holds both the old row and the new answer at once. It rides the wire shape rather than a
   * side-table so the feed's `liveSpots` stay ONE array — the 2026-08-24 defect was exactly a
   * refine patch living somewhere the mirror did not read.
   */
  refinedFromScore?: number | null;
}

export interface BestSpotVerdictWire {
  scored: number;
  unknown: number;
  blocked: number;
  total: number;
}

/** A ladder rung LANDED. The sheet paints from the first one; the top-K is only trustworthy on
 *  the last (`SPEC_V2 §2.3`: the coarse FIELD is honest, the coarse TOP-K is not). */
export interface BestSpotRungMsg {
  type: "rung";
  jobId: number;
  epoch: number;
  /** Echoed from the job — the main thread asserts it against the store's CURRENT hash before any
   *  texture upload. A mismatch means a stale job landed after a newer patch. */
  scoringHash: string;
  rungIndex: number;
  rungCount: number;
  cellM: number;
  field: BestSpotFieldPack;
  spots: BestSpotWireSpot[];
  verdictCounts: BestSpotVerdictWire;
  reachM: number;
  trackNull: boolean;
  refusal: SolveRefusal | "no-tiles" | "no-built-geometry" | null;
  tilesParsed: number;
  tilesNeeded: number;
  builtDensityPerKm2: number;
  /** S7 — the built-density prior FIRED: no building survey covers this disc, so an `openSky` ray
   *  is not evidence and the field is TERRAIN-ONLY. Drives the panel's `⚠ RURAL` line. */
  terrainOnly: boolean;
  /** How many (cell, azimuth) visits the prior withheld. 0 whenever `terrainOnly` is false — the
   *  prior's cost is always readable rather than inferred. */
  openSkyUncredited: number;
  /** The CANOPY twin (2026-08-26g): visits withheld because a MODELLED tree — ~99.93 % of baked
   *  heights are a random draw, not a survey — was what blocked the body. Published for the same
   *  reason as its sibling: without it the UNMAPPED cells a disc gains are unattributable. */
  canopyUncredited: number;
  /** How many cells `refuseBelowReachM` turned UNMAPPED on this rung (S7's §3.1 policy). */
  refusedShortReach: number;
  /** S7's badge — which building tileset stands under this disc. */
  heightProvenance: BestSpotHeightProvenance;
  /** R8 — the pitch the shortlist's ACCESSIBILITY was decided at (1 m when the fine grid ran). */
  shortlistCellM: number;
  /** S6's falsifiable pin: `buildHulls` calls this rung paid. 0 on a lift drag and on a within-day
   *  scrub; ≤ `ceil(Δaz/azStep)` on a day step; K on a radius change. */
  hullBuilds: number;
  /** Effective DSM posting (m) under THIS disc — √(disc area / TIN vertices that covered it). */
  terrainPostingM: number;
  /** R7's badge: `worth` of the current moon event, 1 for sun kinds. */
  moonWorth: number;
  /** The event's contact bearing (deg) — the sheet's scale spoke reads it. */
  contactAzDeg: number;
  /**
   * The event's CONTACT INSTANT (`EventTrack.t0Ms`, ms UTC) — the almanac's own refracted rise/set
   * time the whole disc is solved for.
   *
   * Published because the disc's answer is about THAT instant and nothing on the main thread could
   * re-derive it without running a second ephemeris (the exact "two conventions that look alike"
   * class this feature keeps paying for). The measured consequence of not having it: the
   * cross-model check in `scripts/verify-bestspot.mjs` asked `planFeed` whether the sun was blocked
   * at whatever instant the SCRUBBER happened to sit on — 7.35° BELOW the horizon — so
   * `blockedNow` was trivially true everywhere and both halves of the check proved nothing.
   */
  contactMs: number;
  ms: number;
}

/** MVT fetches outstanding — the `READING THE MAP` chip, the ONE leg that can fail. */
export interface BestSpotTilesMsg {
  type: "tiles";
  jobId: number;
  pending: boolean;
  parsed: number;
  needed: number;
}

/** R6 — the LOWEST probed lift that clears the floor. COMPUTED, never a constant. */
export interface BestSpotLiftMsg {
  type: "lift";
  jobId: number;
  suggestedLiftM: number | null;
}

/** R8's answer for one cell. */
export interface BestSpotRefinedMsg {
  type: "refined";
  jobId: number;
  scoringHash: string;
  key: string;
  score: number;
  /** null when the 1 m re-solve came back UNMAPPED — an honest "I still cannot see". */
  verdict: "scored" | "unknown" | "blocked";
  /** The cell pitch the OBSTRUCTION was re-solved at (`ULTRA_CELL_M`). Echoed rather than assumed
   *  so the row cannot claim a resolution the solver did not run at. */
  cellM: number;
  ms: number;
}

export interface BestSpotErrorMsg {
  type: "error";
  jobId: number;
  message: string;
}

export type BestSpotWorkerMessage =
  | BestSpotRungMsg
  | BestSpotTilesMsg
  | BestSpotLiftMsg
  | BestSpotRefinedMsg
  | BestSpotErrorMsg;

// ---------------------------------------------------------------------------------------------
// Resident state — what a long-lived worker exists FOR
// ---------------------------------------------------------------------------------------------

/** One landed ladder rung, kept so a lift change (T1) and a recompose (T2) need no rebuild. */
export interface RungState {
  cellM: number;
  geo: DiscGeometry;
  dsm: LocalDsm;
  land: LandGrid;
  /** The `sourcesKey` the DSM and LandGrid above were built from. **The T1 tier lives here**: a
   *  lift change carries the same key, so both survive and `solveTerms` finds its hulls by
   *  `dsm.ground` identity. A streaming refinement moves the key and both are rebuilt. */
  sourcesKey: string;
  terms: BestSpotTermBuffer;
  /** T1: hulls resident in `"resident"` mode, keyed by SNAPPED azimuth so a DAY step re-uses the
   *  37 of 39 azimuths the two windows share (`SPEC_V2 §2.2`). */
  hullByAz: Map<number, RayHulls>;
  coverage: number;
  unmappedFrac: number;
  minReachM: number;
  centreGroundM: number;
  conformM: Float32Array | null;
  sheetAltM: number;
}

/** Everything tied to ONE centre+radius (the T0 tier). */
export interface Resident {
  key: string;
  centreLatDeg: number;
  centreLonDeg: number;
  radiusM: number;
  collarM: number;
  frame: EnuFrame;
  frameAltM: number;
  terrain: TinMeshWire[];
  built: TinMeshWire[];
  canopies: CanopyWire[];
  heightProvenance: BestSpotHeightProvenance;
  /**
   * THE T1 KEY, resolved: `job.sourcesEpoch` plus the number of tiles that have actually parsed.
   *
   * The second half is not redundant. A disc can be solved with 3 of its 4 tiles while the fourth
   * is still failing; when it lands, `sourcesEpoch` has not moved (nothing streamed on the main
   * thread) but the LandGrid is genuinely stale. Keying on both is what makes "re-use the sources"
   * safe to state as an invariant rather than as an optimisation that is usually right.
   */
  sourcesKey: string;
  /** Parsed MVT covering the disc + collar. */
  tiles: ParsedVtile[];
  tilesNeeded: number;
  builtDensityPerKm2: number;
  /** S7 — the built-density prior's verdict for this disc. */
  terrainOnly: boolean;
  /**
   * R8 half one — the 1 m ACCESSIBILITY grid over the SCORED disc (no collar: landcover is a
   * per-cell property, not a ray property, so the collar buys nothing here and would cost 5.4× the
   * cells). Built once per `sourcesKey`, so a lift drag, a day step and every taste patch re-rank
   * against it for free. `null` until the first solve that asked for it.
   */
  fineLand: LandGrid | null;
  fineLandKey: string;
  /** T0.5: keyed on the local DAY, so a scrub inside one day re-uses it for 0 ms. */
  track: EventTrack | null;
  trackKey: string;
  rungs: Map<number, RungState>;
  /** The finest rung that landed — what `apply` and `refine` recompose over. */
  finestCellM: number;
  eyeM: number;
  liftM: number;
  refractionK: number;
  kind: BestSpotKind;
  moonWorth: number;
  terrainPostingM: number;
}

let resident: Resident | null = null;
/**
 * Cancelled job ids — checked between rungs and before every post.
 *
 * PRUNED, because `jobId` is monotone and a live altitude drag cancels one job per frame: an
 * unbounded set would grow by 60 integers a second for as long as the panel is open. Anything more
 * than `CANCEL_MEMORY` behind the current job can no longer be in flight (the worker is
 * single-threaded and processes jobs in order), so forgetting it is safe by construction.
 */
const cancelled = new Set<number>();
const CANCEL_MEMORY = 64;

function pruneCancelled(): void {
  if (cancelled.size <= CANCEL_MEMORY) return;
  for (const id of cancelled) if (id < currentJobId - CANCEL_MEMORY) cancelled.delete(id);
}
/** The newest job posted. An older job that is still climbing stops at its next rung boundary. */
let currentJobId = -1;

/** Parsed MVT, worker-owned. NEVER evicted (a disc is 1–4 z14 tiles) and a FAILURE IS NOT CACHED —
 *  the next job retries, which is the one thing the main-thread cache cannot do. */
const tileCache = new Map<string, ParsedVtile>();
let tileTemplate: string | null = null;
let templateFor = "";
let templatePromise: Promise<void> | null = null;

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * The worker's own guard on §5.6's drop test.
 *
 * The main thread drops any result whose `scoringHash` is not the store's current one. That test is
 * only as good as the ECHO: if a caller ever posted a `scoring` object whose real hash disagreed
 * with the `scoringHash` it claimed, every result would echo a hash it was NOT computed with and
 * the drop test would pass on a stale field — the exact failure the echo exists to prevent, made
 * invisible. One string compare per job, against a 490 ms rebuild.
 */
function assertHash(scoring: BestSpotScoring, claimed: string): void {
  const real = hashOf(scoring);
  if (real !== claimed) {
    throw new Error(
      `bestSpotWorker: scoringHash mismatch — job claims ${claimed}, profile hashes ${real}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// MVT — resolve the template once, fetch the disc's tiles, parse them
// ---------------------------------------------------------------------------------------------

async function ensureTemplate(tileJsonUrl: string): Promise<void> {
  if (tileTemplate !== null && templateFor === tileJsonUrl) return;
  if (templatePromise && templateFor === tileJsonUrl) return templatePromise;
  templateFor = tileJsonUrl;
  tileTemplate = null;
  // The /planet TileJSON is the MUTABLE pointer that rotates to each new OpenFreeMap build, so it
  // keeps the default cache mode; only the dated TILE urls below are immutable.
  templatePromise = fetch(tileJsonUrl)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`TileJSON ${r.status}`))))
    .then((tj: { tiles: string[] }) => {
      tileTemplate = tj.tiles[0] ?? null;
    })
    .catch((e) => {
      tileTemplate = null;
      console.warn("[bestSpot/worker] TileJSON unavailable:", e);
    });
  return templatePromise;
}

/** Which z14 tiles the disc + collar actually OVERLAPS. The floor is a count of THESE, not of a
 *  fixed 3×3 ring: `SPEC_V2 §3.4` item 6 asks "did we look", not "did we look at nine tiles". */
export function tilesOverlapping(
  centreLatDeg: number,
  centreLonDeg: number,
  halfSpanM: number,
  tileZ: number,
): { x: number; y: number }[] {
  const dLat = (halfSpanM / 111_320) * 1.001;
  const dLon = dLat / Math.max(0.05, Math.cos((centreLatDeg * Math.PI) / 180));
  const a = lonLatToTile(centreLonDeg - dLon, centreLatDeg + dLat, tileZ); // NW
  const b = lonLatToTile(centreLonDeg + dLon, centreLatDeg - dLat, tileZ); // SE
  const out: { x: number; y: number }[] = [];
  for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push({ x, y });
  }
  return out;
}

async function fetchTiles(
  job: BestSpotSolveJob,
  halfSpanM: number,
  onProgress: (parsed: number, needed: number) => void,
): Promise<{ tiles: ParsedVtile[]; needed: number }> {
  const want = tilesOverlapping(job.centreLatDeg, job.centreLonDeg, halfSpanM, job.tileZ);
  const needed = want.length;
  const have: ParsedVtile[] = [];
  const missing: { x: number; y: number }[] = [];
  for (const t of want) {
    const hit = tileCache.get(`${t.x}/${t.y}`);
    if (hit) have.push(hit);
    else missing.push(t);
  }
  if (missing.length === 0) return { tiles: have, needed };

  onProgress(have.length, needed);
  await ensureTemplate(job.tileJsonUrl);
  if (!tileTemplate) return { tiles: have, needed };
  const template = tileTemplate;

  await Promise.all(
    missing.map(async (t) => {
      const url = template
        .replace("{z}", String(job.tileZ))
        .replace("{x}", String(t.x))
        .replace("{y}", String(t.y));
      try {
        // The template embeds a dated build path, so tile URLs are immutable — `force-cache` skips
        // revalidation entirely and a warm second disc pays no network at all.
        const r = await fetch(url, { cache: "force-cache" });
        if (!r.ok) throw new Error(String(r.status));
        const parsed = parseVectorTile(await r.arrayBuffer(), t.x, t.y);
        tileCache.set(`${t.x}/${t.y}`, parsed);
        have.push(parsed);
      } catch {
        // DELIBERATELY NOT CACHED as "failed" — see the header. A blip must not blind the feature
        // for the rest of the process the way the main-thread cache does.
      }
    }),
  );
  return { tiles: have, needed };
}

/**
 * **S7's BUILT-DENSITY PRIOR, both arms, as one pure decision.** True means: an OPEN-SKY ray is not
 * evidence here, so the solver must not credit it (`solveTerms`'s `builtEvidence: false`) and the
 * panel must say why. It is a function and not three lines inside `runSolve` for the AS-BUILT
 * reason — a per-slice suite cannot catch a seam, so the rule that decides whether the disc is
 * allowed to sound confident has to be reachable from a test.
 *
 * **ARM 1 — NOBODY SURVEYED HERE.** `parseTile` does `if (!layer) continue`, so "tile fetched, zero
 * buildings" is byte-identical to "OSM never came". Measured at rural UA (1 building / 21 km²) the
 * disc used to come back `scored`, C = 1.000, openSky 40/40 and S = 0.470–0.661 — uniform, warm,
 * confident, over ground nobody had mapped.
 *
 * **ARM 2 — THE SURVEY EXISTS AND NONE OF IT REACHED THE DSM** (added 2026-08-24). Dense tiles and
 * ZERO building meshes flattened is not a hypothetical: `▦ 3D DETAIL` off DETACHES both building
 * tilesets (`buildings.setActive(false)` removes `tiles.group` from the scene and its `update()`
 * early-returns), so nothing streams and there is nothing to flatten. Measured in that state at
 * the owner's hero location: 54.74 buildings/km² in the parsed tiles, `heightProvenance
 * {enriched: 0, osm: 0}`, and all 31,417 scored cells of a 300 m disc carrying ONE score byte
 * (187/255, S ≈ 0.6991) with a top-8 spread of 0.003. Same failure as arm 1, opposite cause, and
 * the panel tells them apart from `builtDensityPerKm2` + `heightProvenance` — fields it already has.
 *
 * `tilesParsed > 0` is load-bearing on BOTH arms: zero parsed tiles is the tile-coverage REFUSAL, a
 * different and louder failure, and the prior must not pre-empt it.
 */
export function terrainOnlyVerdict(a: {
  tilesParsed: number;
  builtDensityPerKm2: number;
  floorPerKm2: number;
  builtMeshes: number;
}): boolean {
  if (a.tilesParsed <= 0) return false;
  return a.builtDensityPerKm2 < a.floorPerKm2 || noBuiltGeometry(a);
}

/**
 * ARM 2 ALONE — "the map knows of buildings here and NOT ONE of them reached the DSM".
 *
 * Named separately because it does more than flag: it REFUSES the disc (`runSolve` posts
 * `unmappedFieldPack`). Withholding open-sky credit, which is all `terrainOnly` buys, is the right
 * response where the horizon is set by sky and is NOT ENOUGH here — over a city with real relief
 * every ray hits terrain, the credit is never withheld, and the disc still paints a warm, uniform,
 * confident field. That is the measured 2026-08-24 failure and `BESTSPOT_PLAN §11`'s named worst
 * case, so the honest answer is UNKNOWN (§3.1: a render class, never a low score).
 */
export function noBuiltGeometry(a: {
  builtDensityPerKm2: number;
  floorPerKm2: number;
  builtMeshes: number;
}): boolean {
  return a.builtDensityPerKm2 >= a.floorPerKm2 && a.builtMeshes === 0;
}

/** S7's prior, and its input is free: buildings per km² straight off the parsed tiles (Dnipro
 *  centre 558/21, rural UA 1/21, Everest 0/21 — `SPEC_V2 §3.2` case 3). */
export function builtDensityOf(tiles: readonly ParsedVtile[], latDeg: number, tileZ: number): number {
  let buildings = 0;
  for (const t of tiles) for (const p of t.polys) if (p.kind === "building") buildings++;
  // z14 tile edge (m) at this latitude — the same expression `SPEC_V2 §3.4` quotes (1,621.6 m at
  // 48.46°). Zero tiles is 0 density, not a division by zero.
  const edgeM = ((2 * Math.PI * 6_378_137) / 2 ** tileZ) * Math.cos((latDeg * Math.PI) / 180);
  const areaKm2 = (tiles.length * edgeM * edgeM) / 1e6;
  return areaKm2 > 0 ? buildings / areaKm2 : 0;
}

// ---------------------------------------------------------------------------------------------
// The DSM — terrain into `ground`, built mass into the SOLID layer
// ---------------------------------------------------------------------------------------------

/**
 * Build a fresh DSM for one rung. **FRESH, NEVER ACCUMULATED** (`SPEC_V2 §3.4` item 4):
 * `rasterizeTinGround` merges by MAX for order-independence, which is right for a fixed tile set
 * and means a refined (LOWER) LOD can never bring the ground back down. A `createLocalDsm` is
 * 16 ms; keeping a stale high roof forever is not recoverable at any price.
 *
 * TWO PASSES, TWO LAYERS, and the split is the whole reason provenance survives:
 *   1. TERRAIN TIN → `ground` / `groundKnown`. This is the datum every apparent-elevation
 *      expression downstream is written in.
 *   2. BUILT TIN (OSM + enriched building tilesets) → a scratch DSM's `ground`, then folded into
 *      the SOLID layer (`solidBase` = terrain, `solidTop` = roof, `solidSrc = SRC_BUILDING`)
 *      wherever it stands above the terrain. Rasterising built mass straight into `ground` would
 *      have been three lines shorter and would have made every roof read as TERRAIN — which
 *      silently deletes the `graze.conf.*` provenance split AND lets `groundKnown` claim ground
 *      evidence where there is only a roof. A cell with a roof but no terrain under it is skipped,
 *      the `stampSolid` rule: "a height above nothing is not a height".
 */
export function buildDsm(
  geo: DiscGeometry,
  frame: EnuFrame,
  terrain: readonly TinMeshWire[],
  built: readonly TinMeshWire[],
  canopies: readonly CanopyWire[] = [],
): { dsm: LocalDsm; groundWrites: number; canopyStamps: number } {
  const dsm = createLocalDsm({ nx: geo.nGrid, ny: geo.nGrid, cellM: geo.cellM });
  let groundWrites = 0;
  for (const m of terrain) {
    groundWrites += rasterizeTinGround(dsm, m.positions, m.index, m.matrixWorld, frame);
  }

  if (built.length > 0) {
    const roof = createLocalDsm({ nx: geo.nGrid, ny: geo.nGrid, cellM: geo.cellM });
    for (const m of built) {
      rasterizeTinGround(roof, m.positions, m.index, m.matrixWorld, frame);
    }
    const { ground, groundKnown, solidBase, solidTop, solidMask, solidSrc } = dsm;
    for (let c = 0; c < dsm.cellCount; c++) {
      if (groundKnown[c] === 0 || roof.groundKnown[c] === 0) continue;
      const top = roof.ground[c];
      if (!(top > ground[c] + 0.5)) continue; // half a metre of TIN noise is not a building
      solidMask[c] = 1;
      solidBase[c] = ground[c];
      solidTop[c] = top;
      solidSrc[c] = SRC_BUILDING;
    }
  }

  // ── CANOPIES (2026-08-26g) ──────────────────────────────────────────────────────────────────
  //
  // They go to `canopyTop`/`canopyMask` and **never** to `solidMask`, and that is not a stylistic
  // choice — it is the difference between "a tree is between you and the sun" and "you may not
  // stand here". `landcoverRaster.accessAt` reads the solid ENVELOPE through
  // `localDsm.insideSolidInterior`, so a canopy written as a solid would make every tree-lined
  // avenue INACCESSIBLE the moment the sheet is lifted to `access.aerialMinM` (5 m) — a drone
  // "inside" a tree. The layered DSM already models this correctly; it simply had no caller.
  //
  // The decode mirrors `occlusion.sweepTreeInstances` exactly (`occlusion.ts:168-196`) so the
  // BEST SPOT surface and the plan feed's horizon profile describe the same trees.
  let canopyStamps = 0;
  for (const set of canopies) {
    const m = set.matrixWorld;
    // Cell-local +Y in ECEF. The bake contract is a rigid cell transform, so this is a unit vector
    // and the instance's own scale survives the compose.
    const upX = m[4];
    const upY = m[5];
    const upZ = m[6];
    for (let i = 0; i < set.count; i++) {
      const o = i * 16;
      const heightM = set.instanceMatrices[o + 5];
      if (!(heightM > 0)) continue;
      const radiusM =
        Math.hypot(
          set.instanceMatrices[o],
          set.instanceMatrices[o + 1],
          set.instanceMatrices[o + 2],
        ) * UNIT_CANOPY_R;
      const lx = set.instanceMatrices[o + 12];
      const ly = set.instanceMatrices[o + 13];
      const lz = set.instanceMatrices[o + 14];
      const baseX = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const baseY = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      const baseZ = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      const cy = CANOPY_CENTER_Y * heightM;
      const enu = enuOfEcef(frame, baseX + upX * cy, baseY + upY * cy, baseZ + upZ * cy);
      canopyStamps += addCanopy(dsm, {
        e: enu.e,
        n: enu.n,
        centerM: enu.up,
        radiusM: Math.max(radiusM, CANOPY_HALF_Y * heightM),
      });
    }
  }

  sealDsm(dsm, { includeCanopy: true });
  return { dsm, groundWrites, canopyStamps };
}

// ---------------------------------------------------------------------------------------------
// The shortlist
// ---------------------------------------------------------------------------------------------

/** Which of the three contacts the panel's row copy names. Derived from the stored GEOMETRY, never
 *  re-run through the metric: `starOpenSky` is provenance the solver already wrote, and a bounded
 *  notch with real depth IS the GAP case by `notchAt`'s own definition. */
export function contactOf(terms: BestSpotTermBuffer, i: number): "graze" | "gap" | "open" {
  if ((terms.flags[i] & TERM_FLAG.starOpenSky) !== 0) return "open";
  const w = terms.notchWidthDeg[i];
  const d = terms.notchDepthDeg[i];
  return Number.isFinite(w) && d > 0 ? "gap" : "graze";
}

/** The provenance footnote (`§6.9`). `null` for terrain and open horizons — a note that says
 *  nothing trains the eye to skip the ones that say something. */
export function noteOf(srcCode: number): string | null {
  if (srcCode === SRC_DECK) return "ON A BRIDGE";
  if (srcCode === SRC_TREE) return "TREE LINE (modelled height)";
  return null;
}

/**
 * R8 half one — the **1 m ACCESSIBILITY** re-solve of the shortlist candidates.
 *
 * A `LandGrid` at `cellM` over the SCORED disc, plus how many top candidates it is applied to.
 * Handed to `shortlist` as a unit so the "did the fine pass run" question has ONE answer and the
 * published `gridCellM` cannot disagree with what was actually used.
 */
export interface FineAccess {
  land: LandGrid;
  cellM: number;
  candidates: number;
}

/**
 * The top-K, with non-maximum suppression at `topKMinSepM` so the eight rows are eight PLACES
 * rather than eight cells of one plateau (`SPEC_V2 §6.8`).
 *
 * UNKNOWN and INACCESSIBLE cells are excluded BEFORE ranking, not filtered after: `verdict` is a
 * render class and a cell nobody looked at has no rank, however the arithmetic came out.
 *
 * ── R8, half one: **1 m ACCESSIBILITY ON EVERY SOLVE** ────────────────────────────────────────
 * With `fine` supplied, the top `fine.candidates` are re-judged on a `fine.cellM` landcover grid
 * BEFORE the non-maximum suppression runs. That is the half that says *stand on the footpath, not
 * in the hedge*, it is the resolution the landcover data actually supports (MVT coordinates are
 * sub-metre), and it is measured at +52–59 ms — invisible. Two things change and nothing else:
 *  · a candidate whose 1 m cell is INACCESSIBLE is dropped (a 3 m cell straddling a wall, a
 *    canal edge or a fence resolves to the wrong side about a third of the time);
 *  · the SOFT rung is re-read at 1 m and the row's score is rescaled by the ratio of the two
 *    `accessSoftGain`s — the ONE factor of the composition that is a function of the landcover
 *    cell, so the rescale is exact rather than an approximation of a re-solve.
 * OBSTRUCTION is untouched here and stays the field's: 1 m obstruction needs a 985 ms streamed
 * hull and is the user-triggered `REFINE THIS SPOT`. The row publishes `gridCellM` so the panel
 * can name the two separately — an unqualified "1 m" is a C2 violation.
 */
export function shortlist(
  terms: BestSpotTermBuffer,
  scores: Float64Array,
  scoring: BestSpotScoring,
  geo: DiscGeometry,
  frame: EnuFrame,
  track: EventTrack | null,
  sheetAltM: number,
  cap: number,
  minSepM: number,
  fine: FineAccess | null = null,
): BestSpotWireSpot[] {
  const n = terms.n;
  const half = (n - 1) / 2;
  const minCoverage = scoring.gates.minCoverage;
  const tables = compileAccessTables(scoring);
  const access: CellAccess = { hard: 1, soft: 1, cls: "unknown", groundReachable: true };

  const cand: number[] = [];
  for (let i = 0; i < terms.cellCount; i++) {
    if (terms.c[i] < minCoverage) continue;
    if (!(scores[i] > 0)) continue;
    accessFromTermByte(terms.cls[i], terms.flags[i], sheetAltM, tables, access);
    if (access.hard === 0) continue;
    cand.push(i);
  }
  cand.sort((a, b) => scores[b] - scores[a]);

  // ── R8 half one ────────────────────────────────────────────────────────────────────────────
  const fineScore = fine ? new Map<number, number>() : null;
  let fineCellM = geo.cellM;
  if (fine && fineScore && fine.candidates > 0) {
    fineCellM = fine.cellM;
    const softExp = scoring.curves.accessSoftExponent;
    const kept: number[] = [];
    const limit = Math.min(fine.candidates, cand.length);
    for (let k = 0; k < limit; k++) {
      const i = cand[k];
      const col = i % n;
      const row = (i - col) / n;
      const e = (col - half) * geo.cellM;
      const nn = (row - half) * geo.cellM;
      const fi = fineIndexOf(fine.land, e, nn);
      if (fi === null) {
        kept.push(i); // outside the fine grid — keep the coarse verdict rather than invent one
        fineScore.set(i, scores[i]);
        continue;
      }
      // `inSolidInterior` is a DSM question and is unchanged by the landcover pitch, so the
      // aerial branch reuses the coarse bit rather than re-deriving a solid envelope at 1 m.
      const inSolid = (terms.flags[i] & TERM_FLAG.inSolid) !== 0;
      const fineAcc = accessAt(fine.land, fi.ix, fi.iy, sheetAltM, inSolid, scoring);
      if (fineAcc.hard === 0) continue; // the hedge, the wall, the canal edge — DROPPED
      accessFromTermByte(terms.cls[i], terms.flags[i], sheetAltM, tables, access);
      const coarseGain = accessSoftGain(Math.min(1, Math.max(0, access.soft)), softExp);
      const fineGain = accessSoftGain(Math.min(1, Math.max(0, fineAcc.soft)), softExp);
      kept.push(i);
      fineScore.set(i, coarseGain > 0 ? Math.min(1, (scores[i] * fineGain) / coarseGain) : scores[i]);
    }
    // The candidates BELOW the fine window keep their coarse score and their coarse rank; they can
    // only ever be reached when the 1 m pass drops most of the window, which is exactly when the
    // list would otherwise be short.
    for (let k = limit; k < cand.length; k++) {
      kept.push(cand[k]);
      fineScore.set(cand[k], scores[cand[k]]);
    }
    cand.length = 0;
    for (const i of kept) cand.push(i);
    cand.sort((a, b) => (fineScore.get(b) ?? 0) - (fineScore.get(a) ?? 0));
  }
  const scoreOf = (i: number): number => fineScore?.get(i) ?? scores[i];

  const out: BestSpotWireSpot[] = [];
  const sep2 = minSepM * minSepM;
  const takenE: number[] = [];
  const takenN: number[] = [];
  for (const i of cand) {
    if (out.length >= cap) break;
    const col = i % n;
    const row = (i - col) / n;
    const e = (col - half) * geo.cellM;
    const nn = (row - half) * geo.cellM;
    let clash = false;
    for (let k = 0; k < takenE.length; k++) {
      const de = e - takenE[k];
      const dn = nn - takenN[k];
      if (de * de + dn * dn < sep2) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    takenE.push(e);
    takenN.push(nn);
    accessFromTermByte(terms.cls[i], terms.flags[i], sheetAltM, tables, access);
    const ll = lonLatOfEnu(frame, e, nn);
    // `leadMs` — the offset from the event instant at which THIS cell frames the disc. `altStar`
    // is the altitude of that moment; the track is monotone in altitude across its window, so the
    // nearest window sample inverts it. Without `hasStar` the cell never reached half-visible and
    // there is no moment to name.
    let leadMs = 0;
    if (track && (terms.flags[i] & TERM_FLAG.hasStar) !== 0) {
      const alt = terms.altStar[i];
      let best = -1;
      let bestD = Infinity;
      for (let s = track.windowLo; s <= track.windowHi; s++) {
        const d = Math.abs(track.samples[s].altAppDeg - alt);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best >= 0) leadMs = track.samples[best].utcMs - track.t0Ms;
    }
    out.push({
      key: `${col}:${row}`,
      rank: out.length + 1,
      score: scoreOf(i),
      latDeg: ll.latDeg,
      lonDeg: ll.lonDeg,
      distM: Math.hypot(e, nn),
      bearingDeg: (((Math.atan2(e, nn) * 180) / Math.PI) % 360 + 360) % 360,
      contact: contactOf(terms, i),
      note: noteOf(terms.srcStar[i]),
      aerial: sheetAltM >= Math.max(AERIAL_MIN_M, scoring.access.aerialMinM),
      groundReachable: access.groundReachable,
      leadMs,
      gridCellM: fineCellM,
      obstructionRefined: false,
    });
  }
  return out;
}

/**
 * A disc cell's ENU offset → the FINE grid's own indices, or null when it falls outside it.
 *
 * Both grids are built from the SAME centre lat/lon through `makeLandGrid`, so their ENU frames
 * share an origin and the mapping is a rounded division — no reprojection, and no second
 * convention for "which cell is this" (`localDsm`'s named "two grids that look alike" class).
 */
function fineIndexOf(land: LandGrid, eM: number, nM: number): { ix: number; iy: number } | null {
  const half = (land.nx - 1) / 2;
  const ix = Math.round(eM / land.cellM) + half;
  const iy = Math.round(nM / land.cellM) + half;
  if (ix < 0 || iy < 0 || ix >= land.nx || iy >= land.ny) return null;
  return { ix, iy };
}

/** The render-class census the legend and the `36% UNMAPPED` status line read. */
export function censusOf(
  terms: BestSpotTermBuffer,
  scores: Float64Array,
  scoring: BestSpotScoring,
  sheetAltM: number,
): BestSpotVerdictWire {
  const tables = compileAccessTables(scoring);
  const access: CellAccess = { hard: 1, soft: 1, cls: "unknown", groundReachable: true };
  const minCoverage = scoring.gates.minCoverage;
  let scored = 0;
  let unknown = 0;
  let blocked = 0;
  for (let i = 0; i < terms.cellCount; i++) {
    if (terms.c[i] < minCoverage) {
      unknown++;
      continue;
    }
    accessFromTermByte(terms.cls[i], terms.flags[i], sheetAltM, tables, access);
    if (access.hard === 0) blocked++;
    else scored++;
  }
  void scores;
  return { scored, unknown, blocked, total: terms.cellCount };
}

/** Fraction of SCORED cells above `displayLo` — R6's "does this field have any ink in it" test. */
export function inkFractionOf(field: BestSpotFieldPack): number {
  const rg8 = field.rg8;
  let scored = 0;
  let lit = 0;
  for (let i = 0; i < rg8.length; i += 2) {
    if (rg8[i + 1] === 0) continue; // UNKNOWN — excluded from the denominator, never counted as bad
    scored++;
    if (rg8[i] > 0) lit++;
  }
  return scored > 0 ? lit / scored : 0;
}

// ---------------------------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------------------------

/**
 * The local-day key the TRACK is a function of (`SPEC_V2 §2.2` T0.5 vs T1′).
 *
 * `localDayWindow` and NOT a hand-rolled `lon/15` offset: `eventTrack` frames on `localDayWindow`
 * INTERNALLY, so two scene times that share a window produce a byte-identical track. A second
 * expression of "which day is this" that agreed with it to within a few minutes would put the
 * T1′ = 0 ms guarantee on the wrong side of midnight near a timezone edge — the named
 * "two conventions that look alike" class. `scene/bestSpotFeed` keys on the same function.
 */
export function dayKeyOf(sceneMs: number, lonDeg: number): string {
  return String(localDayWindow(sceneMs, lonDeg).startMs);
}

/**
 * THE T0.5 CACHE KEY — everything the resident `EventTrack` is a function of, and nothing else.
 *
 * Exported and pure so the contract is pinnable. It carries three terms and each one is load-bearing
 * in a different direction:
 *  · `kind` — the four windows are disjoint, so a kind change is a genuine rebuild;
 *  · the LOCAL DAY — this is the term that makes a within-day scrub cost 0 ms and 0 hulls, which is
 *    the falsifiable pin the whole architecture rests on (`bestSpotResidency.test.ts`);
 *  · `trackHash` — **added 2026-08-26g as a defect fix.** `w_i` is baked inside `eventTrack` from
 *    `trackWeight.altScaleDeg` + `.horizonCeiling`, so without this term a taste pass on either one
 *    re-solved against the PREVIOUS track and moved nothing until the scene crossed a day boundary.
 *
 * It is deliberately NOT `scoringHash`: a `weights.v` tweak must stay the 0.272 ms recompose it is
 * classed as, and folding the whole profile in here would rebuild the track for every taste knob.
 */
export function trackKeyOf(job: BestSpotSolveJob): string {
  return `${job.kind}|${dayKeyOf(job.sceneMs, job.centreLonDeg)}|${trackHash(job.scoring)}`;
}

function residentKeyOf(job: BestSpotSolveJob): string {
  return [
    job.centreLatDeg.toFixed(7),
    job.centreLonDeg.toFixed(7),
    job.radiusM,
    job.collarM,
    job.tileZ,
  ].join("|");
}

function post(msg: BestSpotWorkerMessage, transfer: Transferable[] = []): void {
  if (cancelled.has(msg.jobId)) return;
  (self as unknown as Worker).postMessage(msg, transfer);
}

/** Compose one rung's resident terms into a pack + a shortlist. The T2 tier, and the ONE place a
 *  field is turned into pixels — `apply`, `solve` and `refine` all funnel through it. */
function composeRung(
  rung: RungState,
  res: Resident,
  scoring: BestSpotScoring,
  displayLo: number,
  displayHi: number,
  topK: number,
  topKMinSepM: number,
  fine: FineAccess | null = null,
): { field: BestSpotFieldPack; spots: BestSpotWireSpot[]; census: BestSpotVerdictWire } {
  const ctx = {
    cellM: rung.geo.cellM,
    radiusM: rung.geo.radiusM,
    centreLatDeg: res.centreLatDeg,
    centreLonDeg: res.centreLonDeg,
    centreGroundM: rung.centreGroundM,
    sheetAltM: rung.sheetAltM,
    dipFloorDeg: horizonDipDeg(rung.sheetAltM, res.refractionK),
    kind: res.kind,
    worthParts: {
      sunAltAtT0Deg: res.track?.sunAltAtT0Deg ?? 0,
      moonPhaseAngleDeg: res.track?.moonPhaseAngleDeg ?? 0,
    },
    coverage: rung.coverage,
    unmappedFrac: rung.unmappedFrac,
    minReachM: rung.minReachM,
    conformM: rung.conformM,
    displayLo,
    displayHi,
  };
  const field = composeField(rung.terms, ctx, scoring);
  const scores = composeScores(rung.terms, ctx, scoring);
  const spots = shortlist(
    rung.terms,
    scores,
    scoring,
    rung.geo,
    res.frame,
    res.track,
    rung.sheetAltM,
    topK,
    topKMinSepM,
    fine,
  );
  const census = censusOf(rung.terms, scores, scoring, rung.sheetAltM);
  return { field, spots, census };
}

/**
 * Solve ONE rung over the resident sources. Returns null when the disc was refused.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * **THE T1 TIER LIVES IN THIS FUNCTION, AND IT IS S6's WHOLE PIN.**
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * The DSM and the LandGrid are functions of the SOURCES (centre, radius, cell pitch, the streamed
 * TIN, the parsed tiles) and of NOTHING ELSE — not the lift, not the eye, not the scene time. So
 * when `res.sourcesKey` has not moved they are re-used verbatim, and that re-use is what makes the
 * hull cache reachable at all: `solveTerms` accepts a cached hull only when
 * `cached.ground === dsm.ground` (an IDENTITY test on the height field it was built from, which is
 * the only test that cannot be fooled by a rebuilt array with the same numbers in it).
 *
 * **The defect this closes, measured.** This function used to call `buildDsm` unconditionally, so
 * every lift change handed `solveTerms` a fresh `ground` array, every hull missed, and a 2 → 400 m
 * altitude drag paid **39 `buildHulls` per frame** against a plan that pins the number at **0**.
 * The hulls were already eye-invariant — the residency contract was correct in the kernel and
 * thrown away one layer up.
 *
 * `reuseTerms` is a separate axis and is not a micro-optimisation toggle: with it TRUE the solve
 * writes into the RESIDENT term buffer for that cell size, which is right for a ladder climb (the
 * rung is being replaced) and WRONG for R6's lift probes, which run at the coarse rung's cell size
 * AT A DIFFERENT LIFT. A probe that aliased the buffer would leave the landed R0 rung holding
 * numbers for a lift the user never asked for — invisible until something recomposed it. The
 * probes DO still re-use the sources and the hulls, because that is precisely the invariant they
 * are exercising.
 */
export function solveRung(
  job: BestSpotSolveJob,
  res: Resident,
  cellM: number,
  reuseTerms = true,
): (RungState & {
  hullBuilds: number;
  openSkyUncredited: number;
  canopyUncredited: number;
  refusedShortReach: number;
}) | null {
  const geo = discGeometry(job.radiusM, cellM, job.collarM);
  const prev = res.rungs.get(cellM);
  // ── T1: the sources survive a lift change, a scrub and a day step. See the docstring. ───────
  const sourcesFresh = prev !== undefined && prev.sourcesKey === res.sourcesKey;
  const dsm = sourcesFresh
    ? prev.dsm
    : buildDsm(geo, res.frame, res.terrain, res.built, res.canopies).dsm;
  const land = sourcesFresh
    ? prev.land
    : buildLandGrid(
        {
          centreLatDeg: res.centreLatDeg,
          centreLonDeg: res.centreLonDeg,
          halfSpanM: job.radiusM + job.collarM,
          cellM,
        },
        res.tiles,
        job.ribbonWidths,
      );
  if (!res.track) return null;

  // T1/T0.5 hull re-use: assemble a SPARSE positional array from the azimuth-keyed cache. The
  // solver builds only the holes (`bestSpotSolver.ts` — `input.hulls[i]` undefined ⇒ build),
  // which is exactly what makes the absolute-lattice snapping pay: +1 day shares 37 of 39
  // azimuths, and without the sparse assemble that measurement buys nothing.
  const samples = res.track.samples;
  const hulls: RayHulls[] = new Array(samples.length);
  let hullHits = 0;
  if (job.mode !== "stream" && prev) {
    for (let i = 0; i < samples.length; i++) {
      const hit = prev.hullByAz.get(snapAz(samples[i].azDeg));
      if (hit) {
        hulls[i] = hit;
        hullHits++;
      }
    }
  }

  const out = solveTerms({
    dsm,
    land,
    track: res.track,
    geo,
    eyeM: job.eyeM,
    liftM: job.liftM,
    refractionK: job.refractionK,
    scoring: job.scoring,
    frameAltM: res.frameAltM,
    mode: job.mode,
    hulls: hullHits > 0 ? hulls : null,
    terms: reuseTerms ? prev?.terms : undefined,
    refuseBelowReachM: job.refuseBelowReachM,
    // S7's prior. The worker measured the density; the FLOOR rode the job.
    builtEvidence: !res.terrainOnly,
  });

  // The hull map is REPLACED only when this solve produced hulls; in `"stream"` mode
  // `out.hulls` is null and the previous map (which is still valid — hulls are lift- and
  // time-free) survives rather than being blanked.
  const hullByAz = out.hulls ? new Map<number, RayHulls>() : (prev?.hullByAz ?? new Map());
  if (out.hulls) {
    for (let i = 0; i < out.hulls.length && i < samples.length; i++) {
      hullByAz.set(snapAz(samples[i].azDeg), out.hulls[i]);
    }
  }
  return {
    cellM,
    geo,
    dsm,
    land,
    sourcesKey: res.sourcesKey,
    terms: out.terms,
    hullByAz,
    coverage: out.coverage,
    unmappedFrac: out.unmappedFrac,
    minReachM: out.minReachM,
    centreGroundM: out.centreGroundM,
    conformM: out.conformM,
    sheetAltM: job.eyeM + job.liftM,
    hullBuilds: out.hullBuilds,
    openSkyUncredited: out.openSkyUncredited,
    canopyUncredited: out.canopyUncredited,
    refusedShortReach: out.refusedShortReach,
  };
}

/**
 * R8 half one — the RESIDENT 1 m accessibility grid, built at most once per `sourcesKey`.
 *
 * Over the SCORED disc only: landcover is a per-cell property, so the 400 m collar (which exists
 * for RAYS) would cost 5.4× the cells for nothing. At the R3 default that is `oddSpanCells(300, 1)`
 * = 601² against the 3 m sweep grid's 469², i.e. 1.64× the cells at 9× the fill density — the
 * measured +52–59 ms.
 */
function ensureFineLand(job: BestSpotSolveJob, res: Resident): LandGrid | null {
  if (job.shortlistCandidates <= 0 || job.shortlistCellM <= 0) return null;
  const key = `${res.sourcesKey}|${job.shortlistCellM}|${job.radiusM}`;
  if (res.fineLand && res.fineLandKey === key) return res.fineLand;
  res.fineLand = buildLandGrid(
    {
      centreLatDeg: res.centreLatDeg,
      centreLonDeg: res.centreLonDeg,
      halfSpanM: job.radiusM,
      cellM: job.shortlistCellM,
    },
    res.tiles,
    job.ribbonWidths,
  );
  res.fineLandKey = key;
  return res.fineLand;
}

/** The hull cache key. 1e-4° is far finer than the 0.25° lattice and far coarser than the ~1e-9°
 *  the inversion carries, so two SNAPPED samples of the same absolute lattice point collide and
 *  two genuinely different azimuths never do. */
export function snapAz(azDeg: number): number {
  return Math.round(azDeg * 1e4);
}

// ---------------------------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------------------------

async function runSolve(job: BestSpotSolveJob): Promise<void> {
  assertHash(job.scoring, job.scoringHash);
  const t0 = nowMs();
  const key = residentKeyOf(job);
  const halfSpanM = job.radiusM + job.collarM;

  // T0: a centre or radius change drops the GEOMETRY and keeps the worker (and its tile cache).
  if (!resident || resident.key !== key) {
    resident = {
      key,
      centreLatDeg: job.centreLatDeg,
      centreLonDeg: job.centreLonDeg,
      radiusM: job.radiusM,
      collarM: job.collarM,
      frame: enuFrameAt(job.centreLatDeg, job.centreLonDeg, job.frameAltM),
      frameAltM: job.frameAltM,
      terrain: job.terrain,
      built: job.built,
      canopies: job.canopies ?? [],
      heightProvenance: job.heightProvenance,
      sourcesKey: "",
      tiles: [],
      tilesNeeded: 0,
      builtDensityPerKm2: 0,
      terrainOnly: false,
      fineLand: null,
      fineLandKey: "",
      track: null,
      trackKey: "",
      rungs: new Map(),
      finestCellM: Number.POSITIVE_INFINITY,
      eyeM: job.eyeM,
      liftM: job.liftM,
      refractionK: job.refractionK,
      kind: job.kind,
      moonWorth: 1,
      terrainPostingM: 0,
    };
  } else {
    // Same centre: the TIN is the newest the main thread has, and a refinement job exists to
    // replace it. Everything else survives.
    resident.terrain = job.terrain;
    resident.built = job.built;
    resident.canopies = job.canopies ?? [];
    resident.heightProvenance = job.heightProvenance;
    resident.eyeM = job.eyeM;
    resident.liftM = job.liftM;
    resident.refractionK = job.refractionK;
    resident.kind = job.kind;
  }
  const res = resident;

  // MVT — the only leg that can fail and the only one longer than a frame.
  const { tiles, needed } = await fetchTiles(job, halfSpanM, (parsed, want) =>
    post({ type: "tiles", jobId: job.jobId, pending: true, parsed, needed: want }),
  );
  if (cancelled.has(job.jobId) || job.jobId !== currentJobId) return;
  res.tiles = tiles;
  res.tilesNeeded = needed;
  res.builtDensityPerKm2 = builtDensityOf(tiles, job.centreLatDeg, job.tileZ);
  // ── S7's BUILT-DENSITY PRIOR (§3.2 case 3, the plan's "single most dangerous failure mode") ──
  // The threshold rode the job (`BESTSPOT.builtDensityFloorPerKm2`, with its derivation there);
  // the verdict is measured here, off tiles that were parsed anyway, and applied inside the solver
  // as an EVIDENCE gate rather than as a score penalty — UNKNOWN is a render class, never a low
  // score. `tiles.length > 0` is load-bearing: zero parsed tiles is the tile-coverage REFUSAL a
  // few lines below, a different and louder failure, and the prior must not pre-empt it.
  res.terrainOnly = terrainOnlyVerdict({
    tilesParsed: tiles.length,
    builtDensityPerKm2: res.builtDensityPerKm2,
    floorPerKm2: job.builtDensityFloorPerKm2,
    builtMeshes: res.heightProvenance.enriched + res.heightProvenance.osm,
  });
  // ── THE T1 KEY (S6). Everything downstream re-uses the DSM/LandGrid while this holds still. ──
  // `terrainOnly` is deliberately NOT part of it: the prior is an argument to `solveTerms`, which
  // re-runs on every job anyway, and the DSM and the LandGrid do not depend on it. Folding it in
  // would force a hull rebuild the first time a disc's density crossed the floor, for nothing.
  res.sourcesKey = `${job.sourcesEpoch}|${tiles.length}`;
  post({
    type: "tiles",
    jobId: job.jobId,
    pending: false,
    parsed: tiles.length,
    needed,
  });

  // T0.5 — see `trackKeyOf`. A scene-time scrub inside one local day still re-uses the track and
  // re-runs NOTHING (`SPEC_V2 §2.2` T1′, 0 ms, asserted in `bestSpotResidency.test.ts`).
  const trackKey = trackKeyOf(job);
  if (res.trackKey !== trackKey) {
    res.trackKey = trackKey;
    res.track = eventTrack(
      {
        latDeg: job.centreLatDeg,
        lonDeg: job.centreLonDeg,
        groundAltM: job.frameAltM,
        eyeAboveGroundM: job.eyeM + job.liftM,
      },
      job.kind,
      job.sceneMs,
      {
        refractionK: job.refractionK,
        scoring: job.scoring,
        // The T0.5 lever: an ABSOLUTE 0.25° lattice, so a DAY step's window is a subset of the
        // same lattice the previous day's was and the hull cache hits (37/39 measured). Without
        // it exact azimuth matches between consecutive days are 0 of 40.
        snapAzLattice: true,
      },
    );
    // A day change invalidates every rung's HULLS by azimuth, but the DSM and LandGrid are
    // eye- and time-free, so the rungs themselves stay — the sparse assemble in `solveRung`
    // takes it from there.
    res.moonWorth = moonWorth(
      job.sceneMs,
      {
        latDeg: job.centreLatDeg,
        lonDeg: job.centreLonDeg,
        groundAltM: job.frameAltM,
        eyeAboveGroundM: job.eyeM + job.liftM,
      },
      job.kind,
      job.scoring,
    );
  }

  // §3.4 item 6 — THE TILE-COVERAGE REFUSAL. Below the floor the disc renders ENTIRELY UNMAPPED.
  // It does NOT paint an all-`unknown` grid: `buildLandGrid` with zero sources returns `hard = 1`
  // for EVERY cell (`landcoverRaster.ts:182`), i.e. the water mask disappears and the top-K would
  // tell a photographer to stand in the middle of the Dnipro.
  if (tiles.length < job.minTilesForSolve) {
    postRefusal(job, res, "no-tiles", nowMs() - t0);
    return;
  }
  // ── §3.4 item 6's SIBLING: THE MAP KNOWS OF BUILDINGS AND THE DSM HAS NONE OF THEM. ──────────
  //
  // Withholding open-sky credit (the prior's arm 2 above) is the right response where the horizon
  // is set by SKY, and it is not enough here: over a city with real relief every ray hits terrain,
  // so the credit is never withheld and the disc still paints a warm, uniform, confident field.
  // MEASURED with the building tilesets detached at the owner's hero pin — 54.74 buildings/km² in
  // the parsed tiles, zero meshes flattened — the disc came back with all 31,417 scored cells at
  // score byte 187 (S ≈ 0.6991) and a shortlist spanning 0.003. That is `BESTSPOT_PLAN §11`'s
  // "single most dangerous failure mode" verbatim, and no amount of ray bookkeeping fixes it,
  // because the evidence that is missing is the OBSTRUCTION MASS ITSELF.
  //
  // So it refuses, exactly as a disc with no landcover refuses: `unmappedFieldPack`, every cell
  // `STAND_G.unknown`, `unmappedFrac` 1. UNKNOWN is a render class, never a low score (§3.1).
  // It is self-healing rather than sticky: `BestSpotFeedCtx.builtEpoch` re-solves ~1.5 s after the
  // building tiles land, so the streaming race resolves itself into the real field, and with
  // `▦ 3D DETAIL` off it stays refused — which is the honest answer to "solve a city I have
  // switched the city off in".
  if (
    noBuiltGeometry({
      builtDensityPerKm2: res.builtDensityPerKm2,
      floorPerKm2: job.builtDensityFloorPerKm2,
      builtMeshes: res.heightProvenance.enriched + res.heightProvenance.osm,
    })
  ) {
    postRefusal(job, res, "no-built-geometry", nowMs() - t0);
    return;
  }
  if (!res.track) {
    postRefusal(job, res, null, nowMs() - t0);
    return;
  }

  const rungs = job.ladderCellsM;
  for (let r = 0; r < rungs.length; r++) {
    if (cancelled.has(job.jobId) || job.jobId !== currentJobId) return;
    const cellM = rungs[r];
    const tRung = nowMs();
    const rung = solveRung(job, res, cellM);
    if (!rung) {
      postRefusal(job, res, null, nowMs() - t0);
      return;
    }
    res.rungs.set(cellM, rung);
    res.finestCellM = Math.min(res.finestCellM, cellM);
    // R8 half one — 1 m ACCESSIBILITY, on the FINEST rung only. Running it per rung would pay the
    // grid four times for a list the panel greys out until the last rung lands anyway (§2.3: the
    // coarse FIELD is honest, the coarse TOP-K is not).
    const fineLand = r === rungs.length - 1 ? ensureFineLand(job, res) : null;
    // `fineLand.cellM` and NOT `job.shortlistCellM`: the published pitch has to be the one the grid
    // was actually BUILT at, or the row claims a resolution nobody solved at (the named "two
    // conventions that look alike" class, and the exact shape of a C2 violation).
    const fine: FineAccess | null = fineLand
      ? { land: fineLand, cellM: fineLand.cellM, candidates: job.shortlistCandidates }
      : null;
    // Effective TERRAIN posting under this disc — √(footprint area / TIN VERTICES in it), NOT a
    // function of the grid (see `tinPostingM`, which replaced a formula that always returned
    // `cellM`). It is a property of the resident TIN and the footprint, so it is computed ONCE per
    // solve rather than per rung: four rungs of the same disc share one answer.
    if (r === 0) res.terrainPostingM = tinPostingM(res.terrain, res.frame, halfSpanM);

    const composed = composeRung(
      rung,
      res,
      job.scoring,
      job.displayLo,
      job.displayHi,
      job.topK,
      job.topKMinSepM,
      fine,
    );
    const msg: BestSpotRungMsg = {
      type: "rung",
      jobId: job.jobId,
      epoch: job.epoch,
      scoringHash: job.scoringHash,
      rungIndex: r,
      rungCount: rungs.length,
      cellM,
      field: composed.field,
      spots: composed.spots,
      verdictCounts: composed.census,
      reachM: rung.minReachM,
      trackNull: false,
      refusal: null,
      tilesParsed: tiles.length,
      tilesNeeded: needed,
      builtDensityPerKm2: res.builtDensityPerKm2,
      terrainOnly: res.terrainOnly,
      openSkyUncredited: rung.openSkyUncredited,
      canopyUncredited: rung.canopyUncredited,
      refusedShortReach: rung.refusedShortReach,
      heightProvenance: res.heightProvenance,
      shortlistCellM: fine ? fine.cellM : cellM,
      hullBuilds: rung.hullBuilds,
      terrainPostingM: res.terrainPostingM,
      moonWorth: res.moonWorth,
      contactAzDeg: res.track.setAzDeg,
      contactMs: res.track.t0Ms,
      ms: nowMs() - tRung,
    };
    post(msg, transfersOf(composed.field));

    // R6 — probe only once, at the COARSE rung, and only when the field came back empty. Each
    // probe is a 24 m re-solve (~21 ms); four of them is ~85 ms, paid once, off the critical path
    // of the finer rungs because it runs before them.
    if (r === 0 && job.liftProbesM.length > 0 && inkFractionOf(composed.field) < job.emptyFieldFrac) {
      post({ type: "lift", jobId: job.jobId, suggestedLiftM: probeLift(job, res) });
    }
  }
}

/**
 * The bytes of a pack that may be TRANSFERRED rather than copied.
 *
 * **`rg8` ONLY, and the exclusion of `conformM` is the fix for a shipped blocker.** A buffer may be
 * transferred exactly once, and only if the worker will never touch it again. That is true of
 * `rg8`: `composeField` and `unmappedFieldPack` each allocate a FRESH `Uint8Array` per message. It
 * is NOT true of `conformM` — `composeField` hands out `ctx.conformM` BY REFERENCE, and that
 * reference is the resident `RungState.conformM`, which survives for the life of the rung so a
 * recompose can re-publish it. Transferring it detached the worker's own copy the first time the
 * rung was posted, and the SECOND post of the same rung then threw
 *
 *     Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope':
 *     An ArrayBuffer is detached and could not be cloned.
 *
 * — measured in the browser, 2026-08-24. The visible symptom was §5.6's whole point failing: a
 * `weights` taste patch was correctly classed `recompose`, `runApply` recomposed it in 0.3 ms, and
 * then the reply never left the worker, so `scoringHashLive` stayed on the OLD hash and THE PICTURE
 * DISAGREED WITH THE NUMBERS until an unrelated streaming rebuild happened to re-solve. `.ab(A, B)`
 * was dead for the same reason (three 4 s timeouts). It could not be caught by a unit test: vitest's
 * `postMessage` has no transfer semantics at all.
 *
 * `conformM` is 17 kB, so the structured clone it now pays is ~2 µs against a 595 ms rung.
 */
export function transfersOf(field: BestSpotFieldPack): Transferable[] {
  return [field.rg8.buffer as ArrayBuffer];
}

/**
 * The EFFECTIVE TERRAIN POSTING (m) under this disc — √(footprint area / TIN vertices in it).
 *
 * **THIS REPLACES A FORMULA THAT ALWAYS RETURNED THE GRID CELL SIZE.** The shipped one was
 *
 *     sqrt((cellCount · cellM² · known) / cellCount / max(1, known))
 *
 * whose `known` factors CANCEL algebraically, leaving `sqrt(cellM²) = cellM` for every input. It
 * read 3.0 m in Dnipro and 3.0 m at Everest — i.e. it was reporting the request, not the evidence —
 * and the panel printed it verbatim as `OVER TERRAIN AT ~3 m`, a C2 violation (the plan's §8 says
 * an unqualified fine-resolution claim is a bug).
 *
 * The honest quantity is the TIN's OWN vertex spacing, which is what "posting" means for a DEM: the
 * baked Dnipro city-centre tile decodes to 188 vertices over 3.965 km², i.e. √(3.965e6/188) ≈ 145 m,
 * and plain Cesium World Terrain outside the bake is ~2 km. A rasterised CELL is not a vertex, which
 * is exactly why the old cell-counting form could never see the difference.
 *
 * Counted over the DSM's own square footprint (the grid the rays are cast on) rather than the
 * inscribed circle, because that is the region the vertices were flattened for; the two differ by
 * 4/π and a posting is a length, so the effect is a fixed 12.8 % — recorded here rather than
 * corrected, since correcting it would imply a precision the count does not carry.
 *
 * Returns 0 when nothing landed, which the store documents as "not measured yet".
 */
export function tinPostingM(
  meshes: readonly TinMeshWire[],
  frame: EnuFrame,
  halfSpanM: number,
): number {
  let verts = 0;
  const ox = frame.originEcef[0];
  const oy = frame.originEcef[1];
  const oz = frame.originEcef[2];
  for (const m of meshes) {
    const p = m.positions;
    const e = m.matrixWorld;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      // Column-major 4×4 (three's `Matrix4.elements`) — `localDsm.applyMat4`'s arithmetic inline.
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const dx = wx - ox;
      const dy = wy - oy;
      const dz = wz - oz;
      const ee = dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2];
      if (ee < -halfSpanM || ee > halfSpanM) continue;
      const nn = dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2];
      if (nn < -halfSpanM || nn > halfSpanM) continue;
      verts++;
    }
  }
  if (verts === 0) return 0;
  return Math.sqrt((4 * halfSpanM * halfSpanM) / verts);
}

/**
 * R6 — probe `liftProbesM` at the coarse rung and publish the LOWEST that clears the floor.
 * COMPUTED, never a constant: the panel renders whatever comes back, so a hard-coded 40 m here
 * would be a claim about a city nobody measured.
 */
function probeLift(job: BestSpotSolveJob, res: Resident): number | null {
  for (const liftM of job.liftProbesM) {
    // The probes exercise the T1 invariant rather than working around it: the sources AND the
    // hulls are lift-free, so a probe re-uses both and pays only the sweep. `reuseTerms: false` is
    // the one thing it may not share — see `solveRung`.
    const probe = solveRung({ ...job, liftM }, res, job.liftProbeCellM, false);
    if (!probe) continue;
    const composed = composeRung(
      probe,
      res,
      job.scoring,
      job.displayLo,
      job.displayHi,
      0,
      job.topKMinSepM,
    );
    if (inkFractionOf(composed.field) >= job.emptyFieldFrac) return liftM;
  }
  return null;
}

/**
 * The ENTIRELY UNMAPPED pack — `SPEC_V2 §3.4` item 6's refusal, made explicit and testable.
 *
 * **It does NOT paint a grid.** With zero parsed sources `buildLandGrid` costs 0.03 ms and returns
 * every cell `unknown / soft 0.45 / hard 1` (`landcoverRaster.ts:182`) — i.e. THE WATER MASK
 * DISAPPEARS and the top-K would rank a cell in the middle of the Dnipro. So below the tile floor
 * the solver is never called at all and this pack goes out instead: `rg8` all zero, which is score
 * 0 AND `STAND_G.unknown`, the render class the sheet already knows how to draw as "nobody looked".
 * `unmappedFrac` reads 1 and `coverage` 0, so every panel line says the same thing.
 */
export function unmappedFieldPack(
  geo: DiscGeometry,
  centreLatDeg: number,
  centreLonDeg: number,
  sheetAltM: number,
  displayLo: number,
  displayHi: number,
  hash: string,
): BestSpotFieldPack {
  return {
    n: geo.n,
    cellM: geo.cellM,
    centreLatDeg,
    centreLonDeg,
    centreGroundM: Number.NaN,
    radiusM: geo.radiusM,
    sheetAltM,
    rg8: new Uint8Array(geo.n * geo.n * 2), // all zero = UNKNOWN score AND UNKNOWN class
    conformN: CONFORM_N,
    conformM: null,
    displayLo,
    displayHi,
    coverage: 0,
    unmappedFrac: 1,
    minReachM: 0,
    scoringHash: hash,
  };
}

function postRefusal(
  job: BestSpotSolveJob,
  res: Resident,
  refusal: SolveRefusal | "no-tiles" | "no-built-geometry" | null,
  ms: number,
): void {
  const cellM = job.ladderCellsM[0] ?? 24;
  const geo = discGeometry(job.radiusM, cellM, job.collarM);
  const field = unmappedFieldPack(
    geo,
    job.centreLatDeg,
    job.centreLonDeg,
    job.eyeM + job.liftM,
    job.displayLo,
    job.displayHi,
    job.scoringHash,
  );
  post(
    {
      type: "rung",
      jobId: job.jobId,
      epoch: job.epoch,
      scoringHash: job.scoringHash,
      rungIndex: 0,
      rungCount: 1,
      cellM,
      field,
      spots: [],
      verdictCounts: { scored: 0, unknown: geo.n * geo.n, blocked: 0, total: geo.n * geo.n },
      reachM: 0,
      trackNull: res.track === null,
      refusal,
      tilesParsed: res.tiles.length,
      tilesNeeded: res.tilesNeeded,
      builtDensityPerKm2: res.builtDensityPerKm2,
      terrainOnly: res.terrainOnly,
      openSkyUncredited: 0,
      canopyUncredited: 0,
      refusedShortReach: 0,
      heightProvenance: res.heightProvenance,
      shortlistCellM: cellM,
      hullBuilds: 0,
      terrainPostingM: res.terrainPostingM,
      moonWorth: res.moonWorth,
      contactAzDeg: res.track?.setAzDeg ?? 0,
      contactMs: res.track?.t0Ms ?? 0,
      ms,
    },
    transfersOf(field),
  );
}

/** §5.6's T2 — recompose the resident term buffer. 0.272 ms at 201², 1,260× cheaper than the
 *  cheapest achievable re-solve, and the entire answer to owner requirement (vii). */
function runApply(job: BestSpotApplyJob): void {
  assertHash(job.scoring, job.scoringHash);
  const res = resident;
  const rung = res?.rungs.get(res.finestCellM);
  if (!res || !rung) return;
  // Three classes are answerable from the resident term buffer alone — `repaint` (nothing about
  // the score moved), `recompose` (§5.3's whole point) and `reweigh` (the weights are read at
  // COMPOSE time). `rescore` and above need the sweep evidence, which is deliberately NOT resident
  // (a stored `(H,D)` slab is 139 MB), so the client must re-post a `solve`.
  if (INVALIDATION_RANK[job.from] > INVALIDATION_RANK.reweigh) {
    post({
      type: "error",
      jobId: job.jobId,
      message: `apply refused: class "${job.from}" needs a re-solve, not a recompose`,
    });
    return;
  }
  const t0 = nowMs();
  // R8 half one survives a taste patch: the 1 m accessibility grid is RESIDENT, so the recompose
  // re-ranks against it for free instead of silently dropping the shortlist back to 3 m.
  const fine: FineAccess | null =
    res.fineLand && job.shortlistCandidates > 0
      ? { land: res.fineLand, cellM: res.fineLand.cellM, candidates: job.shortlistCandidates }
      : null;
  const composed = composeRung(
    rung,
    res,
    job.scoring,
    job.displayLo,
    job.displayHi,
    job.topK,
    job.topKMinSepM,
    fine,
  );
  post(
    {
      type: "rung",
      jobId: job.jobId,
      epoch: job.epoch,
      scoringHash: job.scoringHash,
      rungIndex: 0,
      rungCount: 1,
      cellM: rung.cellM,
      field: composed.field,
      spots: composed.spots,
      verdictCounts: composed.census,
      reachM: rung.minReachM,
      trackNull: false,
      refusal: null,
      tilesParsed: res.tiles.length,
      tilesNeeded: res.tilesNeeded,
      builtDensityPerKm2: res.builtDensityPerKm2,
      terrainOnly: res.terrainOnly,
      openSkyUncredited: 0,
      canopyUncredited: 0,
      refusedShortReach: 0,
      heightProvenance: res.heightProvenance,
      shortlistCellM: fine ? fine.cellM : rung.cellM,
      // A recompose builds NO hulls by construction — it never touches the sweep. Publishing the
      // zero rather than omitting the field is what lets S6's counter be a running total.
      hullBuilds: 0,
      terrainPostingM: res.terrainPostingM,
      moonWorth: res.moonWorth,
      contactAzDeg: res.track?.setAzDeg ?? 0,
      contactMs: res.track?.t0Ms ?? 0,
      ms: nowMs() - t0,
    },
    transfersOf(composed.field),
  );
}

/** R8 — one cell, 1 m, on demand. The ONE place in this feature a spinner is justified. */
function runRefine(job: BestSpotRefineJob): void {
  assertHash(job.scoring, job.scoringHash);
  const res = resident;
  const rung = res?.rungs.get(res.finestCellM);
  if (!res || !rung || !res.track) {
    post({ type: "error", jobId: job.jobId, message: "refine: nothing resident to refine" });
    return;
  }
  const t0 = nowMs();
  const [colS, rowS] = job.key.split(":");
  const col = Number(colS);
  const row = Number(rowS);
  const half = (rung.terms.n - 1) / 2;
  const e = (col - half) * rung.geo.cellM;
  const nn = (row - half) * rung.geo.cellM;
  const ll = lonLatOfEnu(res.frame, e, nn);

  const geo = discGeometry(job.radiusM, 1, res.collarM);
  const frame = enuFrameAt(ll.latDeg, ll.lonDeg, res.frameAltM);
  const { dsm } = buildDsm(geo, frame, res.terrain, res.built, res.canopies);
  const land = buildLandGrid(
    {
      centreLatDeg: ll.latDeg,
      centreLonDeg: ll.lonDeg,
      halfSpanM: job.radiusM + res.collarM,
      cellM: 1,
    },
    res.tiles,
    // The refine job carries no widths: it re-uses the ones the RESIDENT grid was painted with, so
    // a 1 m answer can never disagree with the 3 m field it is refining.
    residentWidths,
  );
  const out = solveTerms({
    dsm,
    land,
    track: res.track,
    geo,
    eyeM: job.eyeM,
    liftM: job.liftM,
    refractionK: job.refractionK,
    scoring: job.scoring,
    frameAltM: res.frameAltM,
    // 1 m hulls are 899 MiB at K = 40 and CANNOT be resident (`horizonSweep`'s ledger). THIS is
    // R8's second half — the 1 m OBSTRUCTION re-solve, ~1.0-1.6 s, and the one place in the whole
    // feature a spinner is justified.
    mode: "stream",
    refuseBelowReachM: job.refuseBelowReachM,
    // The prior is a property of the SITE, not of the disc size — a 40 m patch inside an
    // unsurveyed region is just as unsurveyed.
    builtEvidence: !res.terrainOnly,
  });
  const centre = ((geo.n - 1) / 2) * geo.n + (geo.n - 1) / 2;
  const ctx = {
    cellM: 1,
    radiusM: job.radiusM,
    centreLatDeg: ll.latDeg,
    centreLonDeg: ll.lonDeg,
    centreGroundM: out.centreGroundM,
    sheetAltM: job.eyeM + job.liftM,
    dipFloorDeg: horizonDipDeg(job.eyeM + job.liftM, job.refractionK),
    kind: res.kind,
    worthParts: {
      sunAltAtT0Deg: res.track.sunAltAtT0Deg ?? 0,
      moonPhaseAngleDeg: res.track.moonPhaseAngleDeg ?? 0,
    },
    coverage: out.coverage,
    unmappedFrac: out.unmappedFrac,
    minReachM: out.minReachM,
    conformM: out.conformM,
    displayLo: job.displayLo,
    displayHi: job.displayHi,
  };
  const scores = composeScores(out.terms, ctx, job.scoring);
  const tables = compileAccessTables(job.scoring);
  const access: CellAccess = { hard: 1, soft: 1, cls: "unknown", groundReachable: true };
  accessFromTermByte(out.terms.cls[centre], out.terms.flags[centre], ctx.sheetAltM, tables, access);
  const verdict =
    out.terms.c[centre] < job.scoring.gates.minCoverage
      ? "unknown"
      : access.hard === 0
        ? "blocked"
        : "scored";
  post({
    type: "refined",
    jobId: job.jobId,
    scoringHash: job.scoringHash,
    key: job.key,
    score: verdict === "scored" ? scores[centre] : 0,
    verdict,
    cellM: ULTRA_CELL_M,
    ms: nowMs() - t0,
  });
}

/** The widths the resident LandGrid was painted with — captured on every `solve` so `refine` can
 *  reproduce them exactly without the client having to carry them twice. */
let residentWidths: BestSpotRibbonWidths | undefined;

// ---------------------------------------------------------------------------------------------
// The message shell
// ---------------------------------------------------------------------------------------------

/**
 * Install the shell.
 *
 * GUARDED, because this module is also the home of the pure helpers above and `npm test` runs in
 * NODE, where `self` does not exist — an unguarded assignment would make the whole file
 * unimportable by vitest and every rule below would have to be verified in a browser. The guard is
 * a `typeof` check and nothing else: inside a real worker it is always true.
 */
function installShell(): void {
  if (typeof self === "undefined" || typeof (self as unknown as Worker).postMessage !== "function") {
    return;
  }
  self.onmessage = (event: MessageEvent<BestSpotWorkerRequest>) => {
    const msg = event.data;
    if (msg.type === "cancel") {
      cancelled.add(msg.jobId);
      return;
    }
    currentJobId = msg.jobId;
    pruneCancelled();
    try {
      if (msg.type === "solve") {
        residentWidths = msg.ribbonWidths;
        // `runSolve` is async only for the MVT fetch; every rejection lands here.
        void runSolve(msg).catch((err: unknown) =>
          post({
            type: "error",
            jobId: msg.jobId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
      if (msg.type === "apply") {
        runApply(msg);
        return;
      }
      runRefine(msg);
    } catch (err) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

installShell();

