/**
 * BEST SPOT — the FEED (`BESTSPOT_SPEC_V2.md` §7 S3d).
 *
 * The scene-side owner of the disc: it resolves the six residency tiers, drives the progressive
 * ladder through the long-lived worker, watches terrain/vector streaming for refinement, publishes
 * the solved field to the GL sheet and mirrors the honesty channels into `store/bestSpot`. It owns
 * NO scene objects — `scene/bestSpotSheet` draws, this decides what there is to draw.
 *
 * It is the THIRD sanctioned store bridge in `scene/**` (`fences.test.ts`'s `SANCTIONED` map, after
 * `planFeed` and `minimapFeed`), and it is one for the same reason they are: the panel's REQUEST
 * (kind, radius, lift, ULTRA, the scoring profile) and the engine's ANSWER live in one store, and
 * a per-frame push of eleven request fields through the orchestrator would be a second copy of the
 * store with its own staleness.
 *
 * =============================================================================================
 * THE SIX RESIDENCY TIERS (§2.2) — WHAT RE-RUNS, AND WHAT DELIBERATELY DOES NOT
 * =============================================================================================
 * | tier | key | what re-runs | measured |
 * |---|---|---|---|
 * | **T0**  | centre · radius · terrainEpoch · vectorVersion · seatEpoch | tiles + land grid + DSM | 58 ms warm |
 * | **T0.5**| KIND or the LOCAL DAY | track + hulls + sweep + score | 490 ms |
 * | **T1**  | lift (and eye) | sweep + score, hulls re-used by snapped azimuth | 343 ms |
 * | **T1′** | scene time INSIDE the same local day | **NOTHING** | **0 ms — asserted** |
 * | **T2**  | a scoring patch of class ≤ `reweigh` | COMPOSE from the resident term buffer | 0.272 ms |
 * | **T3**  | a render/look tunable | the sheet's LUT + one uniform (not this file) | <0.1 ms |
 *
 * T1′ is a PROPERTY, not an optimisation: `eventTrack` frames on `localDayWindow`, so two scene
 * times inside one local day produce a byte-identical track, and the hulls are eye- AND time-free.
 * The feed therefore keys the track on `kind|localDay` and a scrub inside a day posts no job at
 * all. `test/components/globe/bestSpotFeed.test.ts` asserts the job count does not move.
 *
 * =============================================================================================
 * THE LADDER, AND WHY THERE IS NO SPINNER (§2.3)
 * =============================================================================================
 * `BESTSPOT.ladderCellsM = [24, 12, 6, 3]`, coarse → fine, climbed inside ONE job so the parsed
 * tiles, the flattened TIN and the track are paid once (measured prep 44.6 ms; first ink at 55 ms,
 * fully refined at 731–948 ms). The coarse FIELD is honest (mean S identical to 4 dp at every
 * rung); the coarse TOP-K is not (12 m keeps 10 of the top 20), so `ladderRung` is published and
 * the panel greys the list until the last rung lands.
 *
 * **The drag tier is the ladder's own first rung.** `BESTSPOT.dragCellM` is 24 m and so is
 * `ladderCellsM[0]`, which means a live altitude drag needs no second code path: each lift change
 * cancels the in-flight job and re-posts from R0, so the user sees a 21 ms rung per drag frame and
 * the finer rungs only run once the drag stops moving. Cancellation is checked BETWEEN rungs, so
 * the worst-case latency of a drag frame is one coarse rung, not one 680 ms rung.
 *
 * =============================================================================================
 * REFINEMENT (§3.4) — six items, and the two that are counter-intuitive
 * =============================================================================================
 * `terrainEpoch` (a counter on `imageryGround`'s `load-model`), `vtiles.version()` and the enriched
 * `seatState().epoch` are compared PER FRAME (the `minimapFeed.ts:160-161` idiom). On any change
 * the disc is marked stale and a quiet-frame counter restarts; only after `BESTSPOT.
 * rebuildQuietFrames = 90` quiet frames (≈1.5 s, `PLAN.reseatQuietFrames`'s value) does ONE
 * re-solve go out. Without that debounce a streaming burst triggers a 680 ms solve every frame.
 *  · **It re-climbs from R0, not from R3** — the user gets ink back in 55 ms instead of staring at
 *    a stale field for 700 ms.
 *  · **The DSM is REBUILT, never accumulated** — `rasterizeTinGround` merges by MAX for
 *    order-independence, so a refined (LOWER) LOD can never bring the ground back down. A fresh
 *    `createLocalDsm` is 16 ms; a permanently-too-high roof is not recoverable at any price.
 *
 * =============================================================================================
 * THE `scoringHash` DROP — the one integer that stops "the picture disagrees with the numbers"
 * =============================================================================================
 * Every result echoes the hash it was computed with. Before ANY field is published or any store
 * write happens, that echo is compared against `scoringHash(store.scoring)`. A mismatch means a
 * stale job landed after a newer patch, and it is DROPPED — silently for the sheet, loudly for the
 * DEV probe (`__globe.bestSpot().drops`).
 */

import * as THREE from "three";

import {
  scoringDiff,
  scoringHash,
  scoringInvalidation,
  type BestSpotScoring,
  type InvalidationClass,
} from "../../../lib/geo/bestSpotScoring";
import type { BestSpotFieldPack } from "../../../lib/geo/bestSpotSolver";
import type { BestSpotKind } from "../../../lib/geo/bestSpotTypes";
import {
  createBestSpotWorkerClient,
  type BestSpotWorkerHandle,
} from "../../../lib/geo/bestSpotWorkerClient";
import type {
  BestSpotHeightProvenance,
  BestSpotRungMsg,
  BestSpotWireSpot,
  TinMeshWire,
} from "../../../lib/geo/bestSpotWorker";
import { localDayWindow } from "../../../lib/ephemeris/dayArc";
import { geodeticToEcef } from "../../../lib/geo/projection";
import {
  useBestSpotStore,
  type BestSpotSpot,
  type BestSpotVerdictCounts,
} from "../../../store/bestSpot";
import { BESTSPOT, PLAN, STREETS, VECTOR } from "../tuning";
import type { BestSpotSheetMarker } from "./bestSpotSheet";

// ---------------------------------------------------------------------------------------------
// The orchestrator's per-frame push
// ---------------------------------------------------------------------------------------------

export interface BestSpotFeedCtx {
  sceneMs: number;
  /**
   * The feature may run at all. **ALREADY AND-ed with the desktop shell gate by the orchestrator**
   * — this module never names `isMobileShell` / `coarsePointerShell`, which is what keeps the gate
   * in exactly ONE engine file (`fences.test.ts`).
   */
  allowed: boolean;
  /**
   * The shared aim ladder's answer (`lib/geo/aimAnchor.aimAnchorFor`) — never a fresh ladder, and
   * never a hand-written copy of one (the precise defect T36 removed on three surfaces at once).
   *
   * **Owner R2 is resolved ENTIRELY upstream of here**, which is why this module has no
   * `fpvActive` field: rung 1 of that ladder is the walked FPV eye (the camera NADIR while flying,
   * which is exactly what R2 asks for), and "the viewfinder renders nothing" is the SHEET's gate,
   * not the solver's. A second `fpvActive` read here would be a second place for the two to
   * disagree about which eye the disc is about.
   */
  centreLatDeg: number;
  centreLonDeg: number;
  /** R2's enable source: a scratch pin exists, or FPV is live. */
  hasCentre: boolean;
  /** Bumped by `imageryGround`'s `load-model` listener — §3.4 item 1. */
  terrainEpoch: number;
  /**
   * §3.4 item 1's MISSING RENDERER — bumped by the BUILDING tilesets' own `load-model` /
   * `dispose-model` (OSM + enriched).
   *
   * It did not exist until the 2026-08-24 fix pass, and its absence was half of D1: the three
   * epochs the feed watched were the GROUND tileset, the MVT version and the enriched RE-SEAT
   * counter, so a building tile arriving after the first solve marked nothing stale and the disc
   * kept a terrain-only DSM forever. `seatEpoch` looks like it covers the enriched set and does
   * not — it counts re-seats of already-loaded features, not arrivals.
   */
  builtEpoch: number;
  /** `vtiles.version()` — the shipped monotone counter. */
  vectorVersion: number;
  /** `enriched.seatState().epoch` — a ready-made fourth epoch source that needs no new listener. */
  seatEpoch: number;
}

export interface BestSpotFeedHandle {
  update(ctx: BestSpotFeedCtx): void;
  /** The field the sheet paints. Object IDENTITY drives its rebuild, so this is stable across a
   *  no-op scrub by construction: T1′ posts no job, so no new pack is ever produced. */
  field(): BestSpotFieldPack | null;
  /** Top-K markers for the sheet — the structural subset of `BestSpotSpot` it declares. */
  markers(): readonly BestSpotSheetMarker[];
  /** The event's contact bearing (deg) — the scale spoke reads it. */
  contactAzDeg(): number;
  /** §5.6's DEV seam. */
  debug(): BestSpotDebug;
  /**
   * §5.6's `.ab(A, B)` — recompose under each profile and answer the question the owner actually
   * has ("did the RANKING change?") rather than the one the console answers ("did the number
   * change?"). Two recomposes are 0.54 ms, which is what earns it its twenty lines.
   */
  ab(a: BestSpotScoring, b: BestSpotScoring): Promise<BestSpotAbResult>;
  dispose(): void;
}

/** What `.ab(A, B)` answers. */
export interface BestSpotAbResult {
  /** Spearman ρ over the cells BOTH shortlists contain. */
  rho: number;
  /** Fraction of A's top 10 that survives into B's top 10. */
  top10Survival: number;
  /** How many of A's ranks are occupied by a different cell in B. */
  moved: number;
  a: { key: string; score: number }[];
  b: { key: string; score: number }[];
}

export interface BestSpotDebug {
  scoring: BestSpotScoring;
  hash: string;
  /** Leaves that differ from the shipped default — `scoringDiff` against the resolved profile. */
  diff: { path: string; from: unknown; to: unknown }[];
  verdictCounts: BestSpotVerdictCounts;
  /** The invalidation class of the LAST accepted scoring change — what actually re-ran. */
  lastClass: InvalidationClass | null;
  timings: {
    /** ms of the last rung that landed, by cell size. */
    rungMs: Record<string, number>;
    /** ms from the solve post to the FIRST rung landing — §7's ≤ 120 ms warm done-check. */
    firstInkMs: number;
    /** …to the LAST rung — the ≤ 1,200 ms half. */
    refinedMs: number;
  };
  /** How many jobs were posted, and how many results were DROPPED on a `scoringHash` mismatch. */
  jobs: number;
  drops: number;
  /** The tier keys, so a verify script can prove T1′ re-ran nothing instead of inferring it. */
  keys: { t0: string; t05: string; t1: string; epoch: number; sources: number };
  ladderRung: number;
  workerSpawned: boolean;
  inFlight: number;
  /**
   * The CONTACT INSTANT the disc was solved for (`EventTrack.t0Ms`, ms UTC), 0 before the first
   * result. Published because it is the ONE instant every score on the sheet is a statement about,
   * and nothing outside the worker can re-derive it without a second ephemeris. The measured cost
   * of its absence: `scripts/verify-bestspot.mjs`'s cross-model check asked the planner about the
   * SCRUBBER's instant, where the sun sat 7.35° below the horizon, so "blocked" was trivially true
   * at the best cell and the worst cell alike and the only independent opinion in the whole script
   * proved nothing.
   */
  contactMs: number;
  /**
   * **S6's falsifiable pin, published rather than inferred.**
   *
   * `hullBuilds` is the RUNNING TOTAL of `buildHulls` calls every landed rung has reported, and
   * `hullBuildEvents` counts the rungs that paid more than zero of them. Both are here and not
   * reached for through a closure precisely because the plan's pin is a statement about a NUMBER:
   * *0 for a within-day scrub and for a 2 → 400 m lift drag · ≤ ceil(Δaz/azStep) for a day step ·
   * one event on a radius change.* A test that asserted "the feed posted no job" would pass for the
   * wrong reason the day someone restores an `(H,D)` slab and re-solves anyway.
   */
  hullBuilds: number;
  hullBuildEvents: number;
  /** How many frames `update` has run, and how many of them wrote the store mirror. S6 pins the
   *  ratio under 1 in 8; the shipped cadence is `BESTSPOT.mirrorEveryFrames` = 12. */
  frames: number;
  mirrorWrites: number;
  /**
   * S7's two POLICY costs, from the last rung that landed — published for the same reason
   * `hullBuilds` is: both are decisions to withhold an answer, and a feature that quietly withheld
   * more of the map than it meant to would look exactly like a feature that was being careful.
   * `terrainOnly` is the prior's verdict, `openSkyUncredited` is how many (cell, azimuth) visits it
   * cost, and `refusedShortReach` is how many cells `refuseBelowReachM` turned UNMAPPED (0 on any
   * fully-mapped disc — that is the whole calibration).
   */
  honesty: {
    terrainOnly: boolean;
    builtDensityPerKm2: number;
    openSkyUncredited: number;
    refusedShortReach: number;
    shortlistCellM: number;
  };
}

// ---------------------------------------------------------------------------------------------
// TIN flattening — main thread, COPIES, never a live attribute
// ---------------------------------------------------------------------------------------------

/**
 * Positions of a geometry as a plain stride-3 float array — the `planFeed.ts:204` idiom verbatim.
 * The fast path reads `.array`; interleaved / normalized / non-float32 attributes (quantized b3dm
 * pipelines) go through `getX/getY/getZ`, which apply the normalization the raw array would skip.
 */
function positionsOf(geom: THREE.BufferGeometry): ArrayLike<number> | null {
  const attr = geom.getAttribute("position");
  if (!attr) return null;
  const direct =
    !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    !attr.normalized &&
    (attr as THREE.BufferAttribute).array instanceof Float32Array;
  if (direct) return (attr as THREE.BufferAttribute).array as ArrayLike<number>;
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

/**
 * Flatten every mesh of a group that reaches within `radiusM` of the disc centre into transferable
 * COPIES.
 *
 * COPIES, and the word is load-bearing: `positions.slice()` allocates a fresh buffer that the
 * worker may take ownership of. Handing over the live `BufferAttribute.array` would DETACH the
 * buffer three is still rendering from — the whole reason the wire is defined as a copy.
 */
function flattenTin(
  root: THREE.Object3D | null,
  centreEcef: THREE.Vector3,
  radiusM: number,
  budget: number,
  out: TinMeshWire[],
  sphere: THREE.Sphere,
): void {
  if (!root) return;
  root.traverse((c) => {
    if (out.length >= budget) return;
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !mesh.parent) return;
    const geom = mesh.geometry;
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    if (!geom.boundingSphere) return;
    sphere.copy(geom.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (sphere.center.distanceTo(centreEcef) - sphere.radius > radiusM) return;
    const positions = positionsOf(geom);
    if (!positions) return;
    const idx = geom.index?.array ?? null;
    out.push({
      positions: positions instanceof Float32Array ? positions.slice() : Float32Array.from(positions),
      index: idx ? Uint32Array.from(idx as ArrayLike<number>) : null,
      matrixWorld: Float64Array.from(mesh.matrixWorld.elements),
    });
  });
}

// ---------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------

/** How many meshes of each kind are flattened per solve. Bounded so a pathological tile stream
 *  cannot turn one job into a 200 MB `postMessage`; 512 terrain tiles is ~40× what a 700 m disc
 *  ever overlaps at any LOD, so the cap is a safety rail rather than a policy. */
const MESH_BUDGET = 512;

/**
 * R8 half two — the half-span (m) of the 1 m disc `REFINE THIS SPOT` solves around one cell.
 *
 * `topKMinSepM + 15` = 40 m: big enough that the answer is about a PLACE rather than one square
 * metre (and never smaller than the separation that made the rows eight PLACES in the first
 * place), small enough to solve in ~1.0-1.6 s (81² = 6,561 cells against the 1 m/300 m tier's
 * 361,201). DERIVED and not a literal 40, because the number appears twice: it sizes the refine
 * job AND the TIN FLATTEN RADIUS, and those two disagreeing is invisible. A row 300 m from the
 * centre needs geometry out to `radius + refine + collar`; flattening only to `radius + collar`
 * would leave the refine's own rim unmapped and make `refuseBelowReachM` report `unknown` for a
 * cell that is perfectly well surveyed.
 */
const REFINE_RADIUS_M = BESTSPOT.topKMinSepM + 15;

/** The pre-solve provenance reading. Frozen for the `ZERO_COUNTS` reason — it is a shared default
 *  and a consumer that mutated it would poison every later clear. */
const ZERO_PROVENANCE: BestSpotHeightProvenance = Object.freeze({ enriched: 0, osm: 0 });

export function attachBestSpotFeed(opts: {
  /** Rendered terrain height (m above the ellipsoid) at a location — the disc's datum bridge. */
  terrainHeightAt(latDeg: number, lonDeg: number): number | null;
  groundGroup: THREE.Object3D;
  buildingsGroup: THREE.Object3D;
  enrichedGroup: THREE.Object3D | null;
}): BestSpotFeedHandle {
  // ── worker + its results ────────────────────────────────────────────────────────────────────
  let livePack: BestSpotFieldPack | null = null;
  let liveSpots: readonly BestSpotWireSpot[] = [];
  let liveMarkers: readonly BestSpotSheetMarker[] = [];
  let contactAz = 0;
  let lastMsg: BestSpotRungMsg | null = null;
  let ladderRung = -1;
  let tilesPending = false;
  let suggestedLiftM: number | null = null;
  let refining = false;
  let jobs = 0;
  let drops = 0;
  // S6's counters — see `BestSpotDebug.hullBuilds`.
  let hullBuilds = 0;
  let hullBuildEvents = 0;
  let frames = 0;
  let mirrorWrites = 0;
  let lastClass: InvalidationClass | null = null;
  const rungMs: Record<string, number> = {};
  let solvePostedMs = 0;
  let firstInkMs = 0;
  let refinedMs = 0;
  let activeJobId = -1;
  let refineJobId = -1;

  /** The hash the store had when the CURRENT job was posted. §5.6's drop test compares against the
   *  store's LIVE hash at landing time — this is only kept for the DEV probe. */
  let postedHash = "";

  const client: BestSpotWorkerHandle = createBestSpotWorkerClient({
    onRung(msg) {
      // ── THE DROP (§5.6). One integer, checked before anything is published. ─────────────────
      if (msg.scoringHash !== scoringHash(useBestSpotStore.getState().scoring)) {
        drops++;
        return;
      }
      if (msg.jobId !== activeJobId) return; // a cancelled job that slipped past a rung boundary
      lastMsg = msg;
      livePack = msg.field;
      liveSpots = msg.spots;
      liveMarkers = msg.spots.map((s) => ({
        key: s.key,
        rank: s.rank,
        latDeg: s.latDeg,
        lonDeg: s.lonDeg,
      }));
      contactAz = msg.contactAzDeg;
      ladderRung = msg.rungIndex;
      rungMs[String(msg.cellM)] = msg.ms;
      hullBuilds += msg.hullBuilds;
      if (msg.hullBuilds > 0) hullBuildEvents++;
      const now = performance.now();
      if (msg.rungIndex === 0) firstInkMs = now - solvePostedMs;
      if (msg.rungIndex >= msg.rungCount - 1) refinedMs = now - solvePostedMs;
      mirrorDirty = true;
      const waiters = rungWaiters;
      rungWaiters = [];
      for (const w of waiters) w();
    },
    onTiles(msg) {
      if (msg.jobId !== activeJobId) return;
      tilesPending = msg.pending;
      mirrorDirty = true;
    },
    onLift(msg) {
      if (msg.jobId !== activeJobId) return;
      suggestedLiftM = msg.suggestedLiftM;
      mirrorDirty = true;
    },
    onRefined(msg) {
      refining = false;
      if (msg.jobId !== refineJobId) return;
      if (msg.scoringHash !== scoringHash(useBestSpotStore.getState().scoring)) {
        drops++;
        return;
      }
      // The refined row keeps its rank and its place; only the ABSOLUTE score moves, which is what
      // R8 asked for — a 1 m answer for one cell, not a re-ranked list built from mixed tiers.
      // `obstructionRefined` is what lets the row say WHICH of the two 1 m halves it has had: the
      // accessibility one runs on every solve, the obstruction one only here.
      liveSpots = liveSpots.map((s) =>
        s.key === msg.key
          ? {
              ...s,
              score: msg.verdict === "scored" ? msg.score : 0,
              gridCellM: msg.cellM,
              obstructionRefined: true,
            }
          : s,
      );
      mirrorDirty = true;
    },
    onError(msg) {
      if (msg.jobId === refineJobId) refining = false;
      console.warn(`[bestSpot] worker job ${msg.jobId}: ${msg.message}`);
      mirrorDirty = true;
    },
  });

  // ── tier keys ───────────────────────────────────────────────────────────────────────────────
  let keyT0 = "";
  let keyT05 = "";
  let keyT1 = "";
  let builtEpoch = -1;
  /**
   * **THE T1 KEY (S6).** Bumped ONLY when the geometry sources genuinely move — a new T0 (centre or
   * radius) or a streaming refinement past the quiet window. A lift change, a day step and a taste
   * patch all leave it alone, which is what lets the worker re-use the DSM and the LandGrid and,
   * through them, the hull cache. Without it every lift frame rebuilt 39 hulls.
   */
  let sourcesEpoch = 0;

  // ── refinement debounce (§3.4 item 2) ───────────────────────────────────────────────────────
  let builtTerrainEpoch = -1;
  let builtVectorVersion = -1;
  let builtSeatEpoch = -1;
  let builtBuiltEpoch = -1;
  let streamStale = false;
  let quietFrames = 0;

  // ── mirror ──────────────────────────────────────────────────────────────────────────────────
  let frameCount = 0;
  let mirrorDirty = true;
  let lastMirrorSig = "";
  /** ALLOCATE-ONCE (the `planFeed.binsMirror` identity rule): the panel's `topK` array identity is
   *  load-bearing for React memos, so it is replaced only when the quantized signature moves. */
  let topKMirror: readonly BestSpotSpot[] = [];
  let countsMirror: BestSpotVerdictCounts = { scored: 0, unknown: 0, blocked: 0, total: 0 };

  /** The profile the last accepted result was computed under — `scoringInvalidation`'s `prev`. */
  let lastAcceptedScoring: BestSpotScoring | null = null;
  /** One-shot waiters resolved by the next LANDED rung — the `.ab(A, B)` seam's only plumbing. */
  let rungWaiters: (() => void)[] = [];

  const _centre = new THREE.Vector3();
  const _sphere = new THREE.Sphere();

  /** The LOCAL-day key the track is a function of. `localDayWindow` is the SAME framing
   *  `eventTrack` and `planner.dayEvents` use, so a BEST SPOT day and an almanac chip can never
   *  disagree about which day an event belongs to. */
  const dayKeyOf = (sceneMs: number, lonDeg: number): string =>
    String(localDayWindow(sceneMs, lonDeg).startMs);

  const postSolve = (ctx: BestSpotFeedCtx, kind: BestSpotKind): void => {
    const st = useBestSpotStore.getState();
    const groundM = opts.terrainHeightAt(ctx.centreLatDeg, ctx.centreLonDeg) ?? 0;
    // `+ REFINE_RADIUS_M`: R8's 1 m re-solve is centred on a SHORTLIST ROW, up to `radiusM` from
    // here, and needs its own collar around that. See `REFINE_RADIUS_M`.
    const halfSpanM = st.radiusM + BESTSPOT.collarM + REFINE_RADIUS_M;
    const ecef = geodeticToEcef(ctx.centreLatDeg, ctx.centreLonDeg, groundM);
    _centre.set(ecef[0], ecef[1], ecef[2]);

    const terrain: TinMeshWire[] = [];
    const built: TinMeshWire[] = [];
    flattenTin(opts.groundGroup, _centre, halfSpanM, MESH_BUDGET, terrain, _sphere);
    flattenTin(opts.buildingsGroup, _centre, halfSpanM, MESH_BUDGET, built, _sphere);
    const osmMeshes = built.length;
    flattenTin(opts.enrichedGroup, _centre, halfSpanM, MESH_BUDGET, built, _sphere);
    // S7's provenance badge, counted at the ONE place the two tilesets are still distinguishable:
    // once they are in `built` they are anonymous TIN, and nothing in `lib/**` can tell a surveyed
    // roof from an extruded footprint with a class-default height (~78 % of the OSM set).
    const heightProvenance: BestSpotHeightProvenance = {
      enriched: built.length - osmMeshes,
      osm: osmMeshes,
    };

    const transfer: Transferable[] = [];
    for (const m of [...terrain, ...built]) {
      transfer.push(m.positions.buffer as ArrayBuffer, m.matrixWorld.buffer as ArrayBuffer);
      if (m.index) transfer.push(m.index.buffer as ArrayBuffer);
    }

    // ULTRA cannot hold its hulls: 899 MiB at 1 m / K = 40 (`horizonSweep`'s ledger).
    const ultra = st.ultra && st.radiusM <= BESTSPOT.ultraMaxRadiusM;
    const ladderCellsM = ultra
      ? [...BESTSPOT.ladderCellsM, BESTSPOT.ultraCellM]
      : [...BESTSPOT.ladderCellsM];

    client.cancel(activeJobId);
    postedHash = scoringHash(st.scoring);
    solvePostedMs = performance.now();
    firstInkMs = 0;
    refinedMs = 0;
    ladderRung = -1;
    jobs++;
    activeJobId = client.solve(
      {
        epoch: st.scoringEpoch,
        scoring: st.scoring,
        scoringHash: postedHash,
        centreLatDeg: ctx.centreLatDeg,
        centreLonDeg: ctx.centreLonDeg,
        frameAltM: groundM,
        radiusM: st.radiusM,
        collarM: BESTSPOT.collarM,
        ladderCellsM,
        kind,
        sceneMs: ctx.sceneMs,
        eyeM: BESTSPOT.eyeM,
        liftM: st.liftM,
        refractionK: PLAN.refractionK,
        displayLo: BESTSPOT.displayLo,
        displayHi: BESTSPOT.displayHi,
        // The ribbon widths RIDE THE JOB — the worker may not read `components/globe/tuning`.
        ribbonWidths: { roadWidthM: VECTOR.roadWidthM, waterwayWidthM: VECTOR.waterwayWidthM },
        tileJsonUrl: STREETS.tileJsonUrl,
        tileZ: STREETS.tileZ,
        minTilesForSolve: BESTSPOT.minTilesForSolve,
        terrain,
        built,
        heightProvenance,
        sourcesEpoch,
        mode: ultra ? "stream" : "resident",
        liftProbesM: [...BESTSPOT.liftProbesM],
        liftProbeCellM: BESTSPOT.liftProbeCellM,
        emptyFieldFrac: BESTSPOT.emptyFieldFrac,
        topK: BESTSPOT.topK,
        topKMinSepM: BESTSPOT.topKMinSepM,
        // §3.4 item 5's POLICY half, ON since S7 measured its ceiling: `BESTSPOT.refuseBelowReachM`
        // IS the collar, and at the collar a fully-mapped 300 m disc refuses **0** of its 31,417
        // cells while the §3.1 truncation fixture withdraws its claim entirely (0.5530 → unknown).
        refuseBelowReachM: BESTSPOT.refuseBelowReachM,
        builtDensityFloorPerKm2: BESTSPOT.builtDensityFloorPerKm2,
        shortlistCandidates: BESTSPOT.shortlistCandidates,
        shortlistCellM: BESTSPOT.ultraCellM,
      },
      transfer,
    );
  };

  const rankUnder = (scoring: BestSpotScoring): Promise<readonly BestSpotWireSpot[]> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(liveSpots), 4000); // never hang a console call
      rungWaiters.push(() => {
        clearTimeout(timer);
        resolve(liveSpots);
      });
      postedHash = scoringHash(scoring);
      activeJobId = client.apply({
        epoch: useBestSpotStore.getState().scoringEpoch,
        scoring,
        scoringHash: postedHash,
        displayLo: BESTSPOT.displayLo,
        displayHi: BESTSPOT.displayHi,
        from: "recompose",
        topK: BESTSPOT.topK,
        topKMinSepM: BESTSPOT.topKMinSepM,
        shortlistCandidates: BESTSPOT.shortlistCandidates,
        shortlistCellM: BESTSPOT.ultraCellM,
      });
    });

  /**
   * R8 — the explicit 1 m obstruction re-solve of one shortlisted cell, installed into the store as
   * `refineSpot` so the panel can call it without a globe import. **The one place in this feature a
   * spinner is justified** (~1.0–1.6 s); everything else uses the coarse sheet as its own progress.
   */
  const refineSpot = (key: string): void => {
    const st = useBestSpotStore.getState();
    if (refining || livePack === null) return;
    refining = true;
    mirrorDirty = true;
    postedHash = scoringHash(st.scoring);
    refineJobId = client.refine({
      epoch: st.scoringEpoch,
      scoring: st.scoring,
      scoringHash: postedHash,
      displayLo: BESTSPOT.displayLo,
      displayHi: BESTSPOT.displayHi,
      key,
      // A 1 m disc big enough to answer "is THIS square metre clear" and small enough to answer it
      // in ~1.0-1.6 s: 40 m is 81² = 6,561 cells against the 1 m/300 m tier's 361,201. The TIN was
      // flattened out to `radiusM + collarM + REFINE_RADIUS_M` for exactly this call.
      radiusM: REFINE_RADIUS_M,
      eyeM: BESTSPOT.eyeM,
      liftM: st.liftM,
      refractionK: PLAN.refractionK,
      refuseBelowReachM: BESTSPOT.refuseBelowReachM,
    });
  };

  const clearMirror = (): void => {
    livePack = null;
    liveSpots = [];
    liveMarkers = [];
    lastMsg = null;
    ladderRung = -1;
    tilesPending = false;
    suggestedLiftM = null;
    keyT0 = "";
    keyT05 = "";
    keyT1 = "";
    topKMirror = [];
    countsMirror = { scored: 0, unknown: 0, blocked: 0, total: 0 };
    lastMirrorSig = "";
    useBestSpotStore.getState()._syncBestSpot({
      verdictCounts: countsMirror,
      coverage: 0,
      unmappedFrac: 0,
      reachM: 0,
      topK: topKMirror,
      solving: false,
      ladderRung: -1,
      tilesPending: false,
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
      // R8's entry point stays installed across a clear: the panel may call it the frame after a
      // re-solve lands, and re-installing per mirror would hand React a new function identity at
      // every cadence tick.
      refineSpot,
    });
  };

  const update = (ctx: BestSpotFeedCtx): void => {
    frameCount++;
    frames++;
    const st = useBestSpotStore.getState();
    const armed = ctx.allowed && st.open;

    if (!armed) {
      if (livePack !== null || lastMirrorSig !== "") {
        client.cancelAll();
        activeJobId = -1;
        clearMirror();
      }
      return;
    }

    // ── §3.4 items 1–2: the three streaming epochs, compared PER FRAME, then DEBOUNCED ─────────
    // The `minimapFeed.ts:160-161` / `streetNames.ts:361-365` idiom: monotone integers, never a
    // deep compare. A burst of 20 `load-model` events latches the newest value 20 times and
    // restarts ONE quiet counter — so it costs exactly ONE re-solve, which is the done-check.
    if (
      ctx.terrainEpoch !== builtTerrainEpoch ||
      ctx.vectorVersion !== builtVectorVersion ||
      ctx.seatEpoch !== builtSeatEpoch ||
      ctx.builtEpoch !== builtBuiltEpoch
    ) {
      builtTerrainEpoch = ctx.terrainEpoch;
      builtVectorVersion = ctx.vectorVersion;
      builtSeatEpoch = ctx.seatEpoch;
      builtBuiltEpoch = ctx.builtEpoch;
      // Before the first solve there is nothing to invalidate — the first job will read the
      // newest geometry anyway, and marking stale here would debounce the FIRST ink by 1.5 s.
      if (keyT0 !== "") streamStale = true;
      quietFrames = 0;
    } else if (streamStale) {
      quietFrames++;
    }
    let streamRebuild = false;
    if (streamStale && quietFrames >= BESTSPOT.rebuildQuietFrames) {
      streamStale = false;
      quietFrames = 0;
      streamRebuild = true;
    }

    if (ctx.hasCentre) {
      // ── the tier keys ────────────────────────────────────────────────────────────────────────
      const t0 = [
        ctx.centreLatDeg.toFixed(7),
        ctx.centreLonDeg.toFixed(7),
        st.radiusM,
        st.ultra ? 1 : 0,
      ].join("|");
      const t05 = `${st.kind}|${dayKeyOf(ctx.sceneMs, ctx.centreLonDeg)}`;
      const t1 = String(st.liftM);

      if (t0 !== keyT0 || t05 !== keyT05 || t1 !== keyT1 || streamRebuild) {
        // ── THE T1 KEY. Bumped ONLY by a T0 move or a streaming refinement — never by the lift
        // and never by the day, which is precisely what makes S6's `hullBuilds = 0` reachable.
        if (t0 !== keyT0 || streamRebuild) sourcesEpoch++;
        keyT0 = t0;
        keyT05 = t05;
        keyT1 = t1;
        builtEpoch = st.scoringEpoch;
        postSolve(ctx, st.kind);
      } else if (st.scoringEpoch !== builtEpoch) {
        // ── T2: the §5.6 hot swap. The class decides whether this is 0.272 ms or 490 ms. ───────
        builtEpoch = st.scoringEpoch;
        const cls = lastAcceptedScoring ? scoringInvalidation(lastAcceptedScoring, st.scoring) : "rebuild";
        lastClass = cls;
        if (cls === "repaint" || cls === "recompose" || cls === "reweigh") {
          postedHash = scoringHash(st.scoring);
          jobs++;
          activeJobId = client.apply({
            epoch: st.scoringEpoch,
            scoring: st.scoring,
            scoringHash: postedHash,
            displayLo: BESTSPOT.displayLo,
            displayHi: BESTSPOT.displayHi,
            from: cls,
            topK: BESTSPOT.topK,
            topKMinSepM: BESTSPOT.topKMinSepM,
            shortlistCandidates: BESTSPOT.shortlistCandidates,
            shortlistCellM: BESTSPOT.ultraCellM,
          });
        } else {
          postSolve(ctx, st.kind);
        }
        lastAcceptedScoring = st.scoring;
      }
      if (lastAcceptedScoring === null) lastAcceptedScoring = st.scoring;
    }

    // ── the mirror, at `BESTSPOT.mirrorEveryFrames` behind a QUANTIZED signature ───────────────
    if (frameCount % BESTSPOT.mirrorEveryFrames !== 1) return;
    if (!mirrorDirty) return;
    mirrorDirty = false;

    const m = lastMsg;
    const solving = client.inFlight() > 0;
    // THE SIGNATURE READS `liveSpots`, NOT `m.spots` — see the mirror write below. `scoringHash` is
    // in it for the same reason: a recompose can leave the census, the coverage and the reach
    // byte-identical, and the ONE thing it always moves is the hash the screen must carry.
    const sig = [
      m ? m.cellM : 0,
      ladderRung,
      m ? m.verdictCounts.scored : 0,
      m ? m.verdictCounts.unknown : 0,
      m ? m.verdictCounts.blocked : 0,
      m ? m.field.coverage.toFixed(3) : "-",
      m ? m.field.unmappedFrac.toFixed(3) : "-",
      m ? Math.round(m.reachM) : 0,
      m ? m.scoringHash : "-",
      liveSpots.map((s) => `${s.key}:${s.score.toFixed(4)}:${s.obstructionRefined ? 1 : 0}`).join(","),
      solving ? 1 : 0,
      tilesPending ? 1 : 0,
      suggestedLiftM ?? "-",
      refining ? 1 : 0,
      st.liftM,
    ].join("|");
    if (sig === lastMirrorSig) return;
    lastMirrorSig = sig;
    mirrorWrites++;

    if (m) {
      // `liveSpots` AND NOT `m.spots`. They are the same array on every rung landing, and they
      // DIVERGE on exactly one event: R8's `refine`, whose `onRefined` handler patches the refined
      // row into `liveSpots`. Mirroring `m.spots` threw that patch away every time — measured
      // 2026-08-24: `refining` went true for ~610 ms, the worker returned a real 1 m answer, and
      // the row's `obstructionRefined` stayed FALSE forever because the very next mirror rebuilt it
      // from the last RUNG message. The refine was never broken; the mirror was reading the wrong
      // array, and `.ab()` was the only consumer that ever saw the patched one.
      topKMirror = liveSpots.map((s) => ({ ...s }) as BestSpotSpot);
      countsMirror = { ...m.verdictCounts };
    }
    useBestSpotStore.getState()._syncBestSpot({
      verdictCounts: countsMirror,
      coverage: m ? m.field.coverage : 0,
      unmappedFrac: m ? m.field.unmappedFrac : 0,
      reachM: m ? m.reachM : 0,
      topK: topKMirror,
      solving,
      ladderRung,
      tilesPending,
      gridCellM: m ? m.cellM : BESTSPOT.defaultCellM,
      sheetAltM: BESTSPOT.eyeM + st.liftM,
      suggestedLiftM,
      trackNull: m ? m.trackNull : false,
      builtDensityPerKm2: m ? m.builtDensityPerKm2 : 0,
      // S7's three honesty channels, mirrored so the panel prints the ENGINE's verdict rather
      // than re-deriving one from the density it happens to see.
      terrainOnly: m ? m.terrainOnly : false,
      heightProvenance: m ? m.heightProvenance : ZERO_PROVENANCE,
      shortlistCellM: m ? m.shortlistCellM : BESTSPOT.defaultCellM,
      scoringHashLive: m ? m.scoringHash : null,
      // The four fields the panel already reads through its optional seam.
      centreLatDeg: m ? m.field.centreLatDeg : null,
      centreLonDeg: m ? m.field.centreLonDeg : null,
      moonWorth: m ? m.moonWorth : 1,
      terrainPostingM: m ? m.terrainPostingM : 0,
      refining,
      refineSpot,
    });
  };

  /** Recompose the resident field under one profile and return its shortlist. Used only by the
   *  DEV `.ab` seam; it goes through the SAME `apply` path the hot swap does, so what it measures
   *  is what the owner would see. */
  return {
    update,
    field: () => livePack,
    markers: () => liveMarkers,
    contactAzDeg: () => contactAz,
    async ab(a, b) {
      const rankA = await rankUnder(a);
      const rankB = await rankUnder(b);
      // Restore whatever the store is actually holding, so an A/B is a MEASUREMENT and not a
      // silent mutation of the owner's tune.
      await rankUnder(useBestSpotStore.getState().scoring);
      const keysA = rankA.map((s) => s.key);
      const keysB = rankB.map((s) => s.key);
      const shared = keysA.filter((k) => keysB.includes(k));
      // Spearman over the cells BOTH rankings contain — a cell only one of them ranks has no rank
      // difference to take, and pretending it does is how a rank metric invents agreement.
      let d2 = 0;
      for (const k of shared) d2 += (keysA.indexOf(k) - keysB.indexOf(k)) ** 2;
      const n = shared.length;
      const rho = n > 1 ? 1 - (6 * d2) / (n * (n * n - 1)) : 1;
      const top10 = keysA.slice(0, 10);
      return {
        rho,
        top10Survival: top10.length > 0 ? top10.filter((k) => keysB.slice(0, 10).includes(k)).length / top10.length : 1,
        a: rankA.map((s) => ({ key: s.key, score: s.score })),
        b: rankB.map((s) => ({ key: s.key, score: s.score })),
        moved: keysA.filter((k, i) => keysB[i] !== k).length,
      };
    },
    debug: () => {
      const st = useBestSpotStore.getState();
      return {
        scoring: st.scoring,
        hash: scoringHash(st.scoring),
        // Against the SHIPPED DEFAULT, which is the question a taste pass actually asks
        // ("what have I changed?"). `scoringDiff`'s baseline defaults to `BESTSPOT_SCORING_V1`.
        diff: scoringDiff(st.scoring),
        verdictCounts: countsMirror,
        lastClass,
        timings: { rungMs: { ...rungMs }, firstInkMs, refinedMs },
        jobs,
        drops,
        keys: { t0: keyT0, t05: keyT05, t1: keyT1, epoch: builtEpoch, sources: sourcesEpoch },
        ladderRung,
        workerSpawned: client.spawned(),
        inFlight: client.inFlight(),
        contactMs: lastMsg ? lastMsg.contactMs : 0,
        hullBuilds,
        hullBuildEvents,
        frames,
        mirrorWrites,
        honesty: {
          terrainOnly: lastMsg ? lastMsg.terrainOnly : false,
          builtDensityPerKm2: lastMsg ? lastMsg.builtDensityPerKm2 : 0,
          openSkyUncredited: lastMsg ? lastMsg.openSkyUncredited : 0,
          refusedShortReach: lastMsg ? lastMsg.refusedShortReach : 0,
          shortlistCellM: lastMsg ? lastMsg.shortlistCellM : 0,
        },
      };
    },
    dispose() {
      client.dispose();
      // …and write the NULL mirror, so a panel that outlives the canvas does not render a ghost
      // disc (the `planFeed.dispose` rule).
      clearMirror();
    },
  };
}
