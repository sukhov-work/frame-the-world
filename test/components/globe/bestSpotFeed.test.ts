import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BESTSPOT } from "../../../src/components/globe/tuning";
import { discGeometry } from "../../../src/lib/geo/bestSpotSolver";
import { scoringHash } from "../../../src/lib/geo/bestSpotScoring";
import type {
  BestSpotRungMsg,
  BestSpotWorkerRequest,
} from "../../../src/lib/geo/bestSpotWorker";
import { unmappedFieldPack } from "../../../src/lib/geo/bestSpotWorker";
import { attachBestSpotFeed } from "../../../src/components/globe/scene/bestSpotFeed";
import { useBestSpotStore } from "../../../src/store/bestSpot";
import { enuFrameAt } from "../../../src/lib/geo/localDsm";

/**
 * BEST SPOT — THE FEED'S RESIDENCY LADDER AND ITS TWO HONESTY GATES (`SPEC_V2 §7 S3d`).
 *
 * The worker is stubbed, because what is under test here is **which jobs the feed decides to
 * post** — the six residency tiers, the streaming debounce and the `scoringHash` drop. Every one
 * of those is a decision made on the main thread from monotone integers, so a real thread would
 * add nothing but flake.
 *
 * Each block names the defect it keeps dead. The two that are pure cost:
 *  · a scrub inside one local day re-running a 490 ms rebuild (T1′);
 *  · a streaming burst re-running a 680 ms solve every frame (§3.4 item 2).
 * The two that are honesty:
 *  · a stale result landing after a newer taste patch and painting the wrong picture;
 *  · a disposed feed leaving a GHOST disc in the panel.
 */

// ── the stub ─────────────────────────────────────────────────────────────────────────────────
const posted: BestSpotWorkerRequest[] = [];
let liveWorker: StubWorker | null = null;

class StubWorker {
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = 0;
  constructor() {
    liveWorker = this;
  }
  postMessage(msg: BestSpotWorkerRequest): void {
    posted.push(msg);
  }
  terminate(): void {
    this.terminated++;
  }
  /** Deliver a result the way the real worker would. */
  deliver(msg: unknown): void {
    this.onmessage?.({ data: msg } as MessageEvent<unknown>);
  }
}

const solves = () => posted.filter((m) => m.type === "solve");
const applies = () => posted.filter((m) => m.type === "apply");

/** A landed final rung for the job the feed most recently posted. */
function rungFor(jobId: number, hash: string): BestSpotRungMsg {
  const geo = discGeometry(BESTSPOT.defaultRadiusM, BESTSPOT.ladderCellsM[0], BESTSPOT.collarM);
  const field = unmappedFieldPack(geo, 48.4647, 35.0462, BESTSPOT.eyeM, 0.15, 0.9, hash);
  return {
    type: "rung",
    jobId,
    epoch: 0,
    scoringHash: hash,
    rungIndex: 0,
    rungCount: 1,
    cellM: BESTSPOT.ladderCellsM[0],
    field,
    spots: [],
    verdictCounts: { scored: 12, unknown: 3, blocked: 1, total: 16 },
    reachM: 700,
    trackNull: false,
    refusal: null,
    tilesParsed: 4,
    tilesNeeded: 4,
    builtDensityPerKm2: 212,
    terrainOnly: false,
    openSkyUncredited: 0,
    canopyUncredited: 0,
    refusedShortReach: 0,
    heightProvenance: { enriched: 3, osm: 11 },
    shortlistCellM: 1,
    hullBuilds: 0,
    terrainPostingM: 145,
    moonWorth: 1,
    contactAzDeg: 287.6,
    contactMs: NOON + 8 * 3_600_000,
    ms: 11,
  };
}

const NOON = Date.UTC(2026, 7, 24, 12, 0, 0);
const baseCtx = {
  sceneMs: NOON,
  allowed: true,
  centreLatDeg: 48.4647,
  centreLonDeg: 35.0462,
  hasCentre: true,
  terrainEpoch: 1,
  vectorVersion: 1,
  seatEpoch: 0,
  builtEpoch: 0,
};

/** A fresh feed over empty scene groups. The module is imported STATICALLY because the worker is
 *  constructed LAZILY, at the first post — long after `beforeEach` installs the stub. */
function mountSync() {
  return attachBestSpotFeed({
    terrainHeightAt: () => 120,
    groundGroup: new THREE.Group(),
    buildingsGroup: new THREE.Group(),
    enrichedGroup: null,
  });
}

beforeEach(() => {
  posted.length = 0;
  liveWorker = null;
  vi.stubGlobal("Worker", StubWorker);
  // ARMED means BOTH now (owner batch 2026-08-26, item 4): the window open AND the heatmap switch
  // on. `open` alone used to be the arming condition, which is exactly the defect item 4 reports —
  // opening the window committed to a ~700 ms solve before the request had been composed.
  useBestSpotStore.setState({
    open: true,
    heatmapOn: true,
    selectedKey: null,
    liftM: 0,
    radiusM: BESTSPOT.defaultRadiusM,
    kind: "sunset",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useBestSpotStore.getState().setScoring(null);
  useBestSpotStore.setState({ open: false, heatmapOn: false });
});

describe("the residency tiers decide WHICH jobs exist", () => {
  it("the first armed frame posts exactly ONE solve, and it climbs the whole ladder", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    const job = solves()[0];
    expect(job.type === "solve" && job.ladderCellsM).toEqual([...BESTSPOT.ladderCellsM]);
    // The tunables RIDE THE JOB — this is the fence's runtime half.
    expect(job.type === "solve" && job.ribbonWidths.roadWidthM.motorway).toBeGreaterThan(0);
    expect(job.type === "solve" && job.displayLo).toBe(BESTSPOT.displayLo);
    feed.dispose();
  });

  it("T1′ — a +3 h scrub INSIDE the same local day posts NOTHING", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    for (const dt of [10 * 60_000, 3 * 3_600_000, -2 * 3_600_000]) {
      feed.update({ ...baseCtx, sceneMs: NOON + dt });
    }
    // THE ASSERTION, and it is the measured 0 ms: the hulls are eye- AND time-free and the track
    // frames on the local day, so a scrub inside a day has nothing to re-run.
    expect(solves()).toHaveLength(1);
    feed.dispose();
  });

  it("T0.5 — a DAY step re-solves, and so does a KIND change", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    feed.update({ ...baseCtx, sceneMs: NOON + 26 * 3_600_000 });
    expect(solves()).toHaveLength(2);
    useBestSpotStore.setState({ kind: "moonrise" });
    feed.update({ ...baseCtx, sceneMs: NOON + 26 * 3_600_000 });
    expect(solves()).toHaveLength(3);
    feed.dispose();
  });

  it("T1 — a LIFT change re-solves and the ladder still starts at the 24 m drag rung", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    useBestSpotStore.setState({ liftM: 40 });
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(2);
    const job = solves()[1];
    expect(job.type === "solve" && job.liftM).toBe(40);
    expect(job.type === "solve" && job.ladderCellsM[0]).toBe(BESTSPOT.dragCellM);
    feed.dispose();
  });

  it("T2 — a RECOMPOSE-class patch posts an `apply`, never a solve", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    // `weights.*` is the table's own recompose row: 0.272 ms against a 343 ms re-solve.
    useBestSpotStore.getState().setScoring({ weights: { p: 0.4, f: 0.15 } });
    feed.update({ ...baseCtx });
    expect(applies()).toHaveLength(1);
    expect(solves()).toHaveLength(1); // …and NOT a second solve. That ratio is requirement (vii).
    feed.dispose();
  });

  it("a disarmed feed (panel closed, the switch off, or the wrong shell) posts nothing at all", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx, allowed: false });
    useBestSpotStore.setState({ open: false });
    feed.update({ ...baseCtx });
    // ITEM 4's third term: the window may be WIDE OPEN and the switch still off, and that must post
    // nothing at all — that is the whole point of arming being a separate act from opening.
    useBestSpotStore.setState({ open: true, heatmapOn: false });
    feed.update({ ...baseCtx });
    expect(posted).toHaveLength(0);
    // POSITIVE CONTROL: arming it DOES post, so the zero above is the gate and not a dead harness.
    useBestSpotStore.setState({ open: true, heatmapOn: true });
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    feed.dispose();
  });

  it("ITEM 4 — disarming CLEARS the disc, and re-arming solves the NEW request, not the old job", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    liveWorker?.deliver(rungFor(1, scoringHash(useBestSpotStore.getState().scoring)));
    expect(feed.field()).not.toBeNull();
    // OFF: the field is dropped and the panel's mirror zeroed — "closing the whole best spot window
    // behaves ok" is the behaviour the owner asked the SWITCH to have too, without the closing.
    useBestSpotStore.setState({ heatmapOn: false });
    feed.update({ ...baseCtx });
    expect(feed.field()).toBeNull();
    expect(useBestSpotStore.getState().topK).toEqual([]);
    // …then change the radius WHILE OFF, and re-arm. The re-solve must carry the NEW radius —
    // the owner's wording is "if i disabled it, then changed spot, or radius etc, after enabled it
    // should recalculate according to new params". Nothing was posted while it was off.
    posted.length = 0;
    useBestSpotStore.setState({ radiusM: 100 });
    feed.update({ ...baseCtx });
    expect(posted).toHaveLength(0);
    useBestSpotStore.setState({ heatmapOn: true });
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    expect((solves()[0] as unknown as { radiusM: number }).radiusM).toBe(100);
    feed.dispose();
  });

  it("R2 — with no centre source the last field SURVIVES; it is not cleared", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    liveWorker?.deliver(rungFor(1, scoringHash(useBestSpotStore.getState().scoring)));
    expect(feed.field()).not.toBeNull();
    // Leaving FPV with no pin behind: armed, but nothing to centre on.
    feed.update({ ...baseCtx, hasCentre: false });
    expect(feed.field()).not.toBeNull();
    expect(solves()).toHaveLength(1);
    feed.dispose();
  });
});

describe("§3.4 item 2 — a streaming BURST costs exactly ONE re-solve", () => {
  it("20 load-model events inside the quiet window trigger one solve, after the debounce", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);

    // The burst: 20 terrain arrivals on 20 consecutive frames. Each restarts the quiet counter.
    for (let i = 0; i < 20; i++) feed.update({ ...baseCtx, terrainEpoch: 2 + i });
    // …and the debounce is still holding. Without it this alone would be twenty 680 ms solves.
    expect(solves()).toHaveLength(1);

    // Quiet frames, one short of the threshold.
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames - 1; i++) feed.update({ ...baseCtx, terrainEpoch: 21 });
    expect(solves()).toHaveLength(1);
    // …and the one that crosses it.
    feed.update({ ...baseCtx, terrainEpoch: 21 });
    expect(solves()).toHaveLength(2);
    // EXACTLY one. A second re-solve here would mean the stale flag was not cleared.
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames * 2; i++) feed.update({ ...baseCtx, terrainEpoch: 21 });
    expect(solves()).toHaveLength(2);
    feed.dispose();
  });

  it("the vector version and the enriched seat epoch are the same kind of trigger", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    feed.update({ ...baseCtx, vectorVersion: 7 });
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames; i++) feed.update({ ...baseCtx, vectorVersion: 7 });
    expect(solves()).toHaveLength(2);
    feed.update({ ...baseCtx, vectorVersion: 7, seatEpoch: 3 });
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames; i++)
      feed.update({ ...baseCtx, vectorVersion: 7, seatEpoch: 3 });
    expect(solves()).toHaveLength(3);
    feed.dispose();
  });

  /**
   * **D1, half two — THE BUILDING TILESETS ARE A STREAMING SOURCE TOO, AND NOTHING WATCHED THEM.**
   *
   * The three epochs above are the GROUND tileset (`imageryGround.terrainEpoch`), the MVT version
   * and the enriched RE-SEAT counter. Not one of them moves when a BUILDING tile lands, so a disc
   * solved before the buildings streamed stayed terrain-only forever — and the whole obstruction
   * model of this feature is the building mass. Measured in the browser 2026-08-24 with the
   * tilesets detached (`▦ 3D DETAIL` off, a one-click shipped state): `heightProvenance
   * {enriched: 0, osm: 0}` over central Dnipro and all 31,417 scored cells carrying ONE score byte.
   *
   * `seatEpoch` looks like it covers the enriched half and does not: it counts re-seats of features
   * that are ALREADY loaded, which is why this is a separate integer rather than a reuse.
   */
  it("D1 — a BUILDING tile arrival invalidates the disc, exactly like a terrain tile", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(solves()).toHaveLength(1);
    // A burst of building arrivals — the same debounce, the same one re-solve.
    for (let i = 0; i < 12; i++) feed.update({ ...baseCtx, builtEpoch: 1 + i });
    expect(solves()).toHaveLength(1);
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames; i++) feed.update({ ...baseCtx, builtEpoch: 12 });
    expect(solves()).toHaveLength(2);
    // NEGATIVE CONTROL: with the counter frozen, nothing else re-solves.
    for (let i = 0; i < BESTSPOT.rebuildQuietFrames * 2; i++) feed.update({ ...baseCtx, builtEpoch: 12 });
    expect(solves()).toHaveLength(2);
    feed.dispose();
  });

  it("the FIRST solve is not debounced — the epochs only invalidate an existing disc", () => {
    // The trap: marking stale on the very first frame would put a 1.5 s debounce in front of the
    // 55 ms first ink, which is the number the whole ladder exists to hit.
    const feed = mountSync();
    feed.update({ ...baseCtx, terrainEpoch: 99, vectorVersion: 99, seatEpoch: 99, builtEpoch: 99 });
    expect(solves()).toHaveLength(1);
    feed.dispose();
  });
});

describe("§5.6 — the scoringHash drop is what stops 'the picture disagrees with the numbers'", () => {
  it("a result whose hash is not the store's CURRENT hash is dropped, and nothing is published", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(feed.field()).toBeNull();

    // A STALE job lands: it was computed under the shipped default, but the owner has since moved
    // a weight, so the store's live hash is different.
    const staleHash = scoringHash(useBestSpotStore.getState().scoring);
    useBestSpotStore.getState().setScoring({ weights: { p: 0.4, f: 0.15 } });
    expect(scoringHash(useBestSpotStore.getState().scoring)).not.toBe(staleHash);
    liveWorker?.deliver(rungFor(1, staleHash));

    // NOTHING was published — no texture upload, no store write, no marker move.
    expect(feed.field()).toBeNull();
    expect(feed.debug().drops).toBe(1);

    // POSITIVE CONTROL: the SAME message with the live hash IS accepted, so the drop above is the
    // hash test and not a broken harness.
    liveWorker?.deliver(rungFor(1, scoringHash(useBestSpotStore.getState().scoring)));
    expect(feed.field()).not.toBeNull();
    expect(feed.debug().drops).toBe(1);
    feed.dispose();
  });
});

describe("S6 — the cadence contract, read off the DEV seam rather than inferred", () => {
  const liveHash = () => scoringHash(useBestSpotStore.getState().scoring);

  it("the mirror writes FEWER than once per 8 frames, even with the field moving every rung", () => {
    // §7 S6. The mirror is the ONE per-frame edge from the engine to React, and a panel that
    // re-rendered per frame would put a 60 Hz zustand write in front of every DOM read on the
    // page. Two independent guards: a cadence (`BESTSPOT.mirrorEveryFrames` = 12) and a QUANTIZED
    // signature, so a field that is merely re-solved to the same numbers writes nothing at all.
    const feed = mountSync();
    feed.update({ ...baseCtx });
    const FRAMES = 240;
    for (let i = 0; i < FRAMES; i++) {
      // The adversarial case: a NEW result every single frame, each one different.
      const msg = rungFor(1, liveHash());
      msg.reachM = 400 + i;
      liveWorker?.deliver(msg);
      feed.update({ ...baseCtx });
    }
    const d = feed.debug();
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S6 mirror] ${d.mirrorWrites} writes over ${d.frames} frames = 1 per ${(d.frames / Math.max(1, d.mirrorWrites)).toFixed(1)}`,
    );
    expect(d.mirrorWrites).toBeGreaterThan(0); // …and it is not simply dead
    expect(d.mirrorWrites * 8).toBeLessThan(d.frames);
    feed.dispose();
  });

  it("the published grid's ArrayBuffer IDENTITY survives a no-op scrub", () => {
    // `planFeed`'s `binsMirror` rule, and it is load-bearing twice over: the GL sheet rebuilds its
    // texture on the PACK's identity, and the panel's `topK` array identity drives React memos. A
    // within-day scrub posts no job (T1′), so no new pack can exist — this pin is what says the
    // T1′ tier is visible all the way out at the wire rather than only inside the worker.
    const feed = mountSync();
    feed.update({ ...baseCtx });
    liveWorker?.deliver(rungFor(1, liveHash()));
    const pack = feed.field();
    expect(pack).not.toBeNull();
    const buf = pack!.rg8.buffer;
    // Let the mirror settle FIRST: the rung that just landed legitimately replaces the arrays once
    // (something moved). What the rule promises is that a NO-OP moves nothing after that.
    for (let i = 0; i < 3 * BESTSPOT.mirrorEveryFrames; i++) feed.update({ ...baseCtx });
    const topKBefore = useBestSpotStore.getState().topK;
    const countsBefore = useBestSpotStore.getState().verdictCounts;
    const writesBefore = feed.debug().mirrorWrites;

    for (const dt of [10 * 60_000, 3 * 3_600_000, -2 * 3_600_000]) {
      for (let i = 0; i < 20; i++) feed.update({ ...baseCtx, sceneMs: NOON + dt });
    }
    expect(feed.debug().mirrorWrites).toBe(writesBefore); // nothing moved, so nothing was written
    expect(useBestSpotStore.getState().verdictCounts).toBe(countsBefore);
    expect(feed.field()).toBe(pack); // the same OBJECT
    expect(feed.field()!.rg8.buffer).toBe(buf); // …over the same ArrayBuffer
    expect(useBestSpotStore.getState().topK).toBe(topKBefore); // …and the same array identity
    expect(feed.debug().hullBuilds).toBe(0);
    feed.dispose();
  });

  it("`hullBuilds` is a RUNNING TOTAL of what the worker reported, not a main-thread guess", () => {
    // S6's pin is a statement about a NUMBER. The feed cannot compute it — only the worker knows
    // how many `buildHulls` it paid — so the seam has to carry it, and this is what proves the
    // wire is actually connected rather than reporting a hopeful zero.
    const feed = mountSync();
    feed.update({ ...baseCtx });
    expect(feed.debug().hullBuilds).toBe(0);
    const cold = rungFor(1, liveHash());
    cold.hullBuilds = 39;
    liveWorker?.deliver(cold);
    expect(feed.debug().hullBuilds).toBe(39);
    expect(feed.debug().hullBuildEvents).toBe(1);
    // A lift re-solve that re-uses every hull adds NOTHING — the drag row of the S6 table.
    const warm = rungFor(1, liveHash());
    warm.reachM = 701;
    liveWorker?.deliver(warm);
    expect(feed.debug().hullBuilds).toBe(39);
    expect(feed.debug().hullBuildEvents).toBe(1);
    feed.dispose();
  });

  it("the T1 key moves for a SOURCES change and stands still for a lift or a day", () => {
    // The one integer that makes the drag pin reachable: bump it on a lift change and every hull
    // misses (`solveRung` rebuilds the DSM, and the cache is keyed on that array's identity).
    const feed = mountSync();
    feed.update({ ...baseCtx });
    const e0 = feed.debug().keys.sources;
    expect(solves()[0].type === "solve" && solves()[0]).toMatchObject({ sourcesEpoch: e0 });

    useBestSpotStore.setState({ liftM: 120 });
    feed.update({ ...baseCtx });
    expect(feed.debug().keys.sources).toBe(e0); // a LIFT is not a source change

    feed.update({ ...baseCtx, sceneMs: NOON + 26 * 3_600_000 });
    expect(feed.debug().keys.sources).toBe(e0); // …neither is a DAY step

    feed.update({ ...baseCtx, centreLatDeg: 48.47, sceneMs: NOON + 26 * 3_600_000 });
    expect(feed.debug().keys.sources).toBe(e0 + 1); // a CENTRE change is

    // …and so is a streaming refinement, once the quiet window has passed.
    const e1 = feed.debug().keys.sources;
    const ctx = { ...baseCtx, centreLatDeg: 48.47, sceneMs: NOON + 26 * 3_600_000, terrainEpoch: 9 };
    for (let i = 0; i <= BESTSPOT.rebuildQuietFrames; i++) feed.update(ctx);
    expect(feed.debug().keys.sources).toBe(e1 + 1);
    feed.dispose();
  });
});

/**
 * **D4 — THE REFINED ROW HAS TO SURVIVE THE MIRROR.**
 *
 * `onRefined` patches the answer into `liveSpots`; the store mirror used to rebuild `topK` from
 * `lastMsg.spots`, the last RUNG message, so the patch was overwritten on the very next cadence
 * tick and `obstructionRefined` was false forever. Measured in the browser: `refining` went true
 * for ~610 ms, the worker did the whole 1 m stream solve, and the panel never changed.
 *
 * It is a SEAM defect in the exact sense the AS-BUILT lesson names — the worker was right, the
 * client was right, the store was right, and the one line that joined them read the wrong array.
 * Nothing that tests any single one of those three can see it.
 */
describe("D4 — R8's refined row reaches the STORE, not just the feed's own copy", () => {
  const liveHash = () => scoringHash(useBestSpotStore.getState().scoring);

  /** Drive `update` past one mirror cadence tick, so the store really is written. */
  const flushMirror = (feed: ReturnType<typeof mountSync>) => {
    for (let i = 0; i <= BESTSPOT.mirrorEveryFrames * 2; i++) feed.update({ ...baseCtx });
  };

  it("obstructionRefined + the 1 m score land in `store.topK`, and `refining` bookends them", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    const rung = rungFor(1, liveHash());
    rung.spots = [
      {
        key: "100:100",
        rank: 1,
        score: 0.42,
        latDeg: 48.4647,
        lonDeg: 35.0462,
        distM: 12,
        bearingDeg: 90,
        contact: "gap",
        note: null,
        aerial: false,
        groundReachable: true,
        leadMs: 0,
        gridCellM: 1,
        obstructionRefined: false,
      },
    ];
    liveWorker?.deliver(rung);
    flushMirror(feed);
    expect(useBestSpotStore.getState().topK[0].obstructionRefined).toBe(false);
    expect(useBestSpotStore.getState().refining).toBe(false);

    // The shipped entry point — the panel's button, not a back door.
    useBestSpotStore.getState().refineSpot("100:100");
    flushMirror(feed);
    expect(useBestSpotStore.getState().refining).toBe(true);
    const refineJob = posted.filter((m) => m.type === "refine");
    expect(refineJob).toHaveLength(1);

    liveWorker?.deliver({
      type: "refined",
      jobId: refineJob[0].jobId,
      scoringHash: liveHash(),
      key: "100:100",
      score: 0.6137,
      verdict: "scored",
      cellM: 1,
      ms: 1180,
    });
    flushMirror(feed);
    const row = useBestSpotStore.getState().topK.find((r) => r.key === "100:100");
    expect(useBestSpotStore.getState().refining).toBe(false);
    expect(row?.obstructionRefined).toBe(true);
    expect(row?.score).toBeCloseTo(0.6137, 6);
    expect(row?.gridCellM).toBe(1);
    feed.dispose();
  });

  it("…and a LATER rung legitimately clears it — a re-solve is a new answer, not a stale flag", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    const rung = rungFor(1, liveHash());
    rung.spots = [
      {
        key: "100:100", rank: 1, score: 0.42, latDeg: 48.4647, lonDeg: 35.0462, distM: 12,
        bearingDeg: 90, contact: "gap", note: null, aerial: false, groundReachable: true,
        leadMs: 0, gridCellM: 1, obstructionRefined: false,
      },
    ];
    liveWorker?.deliver(rung);
    flushMirror(feed);
    useBestSpotStore.getState().refineSpot("100:100");
    const refineJob = posted.filter((m) => m.type === "refine").at(-1);
    expect(refineJob).toBeDefined();
    liveWorker?.deliver({
      type: "refined", jobId: refineJob!.jobId, scoringHash: liveHash(), key: "100:100",
      score: 0.61, verdict: "scored", cellM: 1, ms: 1180,
    });
    flushMirror(feed);
    expect(useBestSpotStore.getState().topK[0].obstructionRefined).toBe(true);

    const fresh = rungFor(1, liveHash());
    fresh.spots = rung.spots.map((sp) => ({ ...sp, score: 0.44 }));
    liveWorker?.deliver(fresh);
    flushMirror(feed);
    expect(useBestSpotStore.getState().topK[0].obstructionRefined).toBe(false);
    expect(useBestSpotStore.getState().topK[0].score).toBeCloseTo(0.44, 6);
    feed.dispose();
  });
});

describe("lifecycle — spawn late, terminate once, and never leave a ghost", () => {
  it("no Worker is spawned until the first job is actually posted", () => {
    const feed = mountSync();
    expect(liveWorker).toBeNull();
    expect(feed.debug().workerSpawned).toBe(false);
    feed.update({ ...baseCtx });
    expect(feed.debug().workerSpawned).toBe(true);
    feed.dispose();
  });

  it("dispose terminates the worker ONCE and writes the NULL mirror", () => {
    const feed = mountSync();
    feed.update({ ...baseCtx });
    liveWorker?.deliver(rungFor(1, scoringHash(useBestSpotStore.getState().scoring)));
    const w = liveWorker;
    feed.dispose();
    expect(w?.terminated).toBe(1);
    // …and the panel must not render a ghost disc over a canvas that is gone.
    const st = useBestSpotStore.getState();
    expect(st.topK).toEqual([]);
    expect(st.centreLatDeg).toBeNull();
    expect(st.solving).toBe(false);
    expect(st.verdictCounts.total).toBe(0);
  });

  it("a centre change CANCELS the in-flight job and keeps the worker alive", () => {
    // BESTSPOT_PLAN §11's open question, answered: terminating on a centre change would throw away
    // the parsed z14 tiles a pin nudged 40 m still needs (22 ms) and turn a 55 ms first ink into a
    // ~300 ms one.
    const feed = mountSync();
    feed.update({ ...baseCtx });
    const w = liveWorker;
    feed.update({ ...baseCtx, centreLatDeg: 48.47 });
    expect(posted.filter((m) => m.type === "cancel")).toHaveLength(1);
    expect(w?.terminated).toBe(0);
    expect(liveWorker).toBe(w); // the SAME worker, not a respawn
    feed.dispose();
  });
});

/**
 * =============================================================================================
 * **D1 — `InstancedMesh` IS A MESH, AND THAT COST US EVERY TREE.** (2026-08-26g)
 * =============================================================================================
 *
 * `flattenTin` traversed on `mesh.isMesh` alone. `THREE.InstancedMesh` satisfies it — the sibling
 * module says so in its own comment (`scene/enrichedBuildings.ts:691-693`) — so the baked trees
 * fell into the TIN path and BEST SPOT flattened the **shared unit prototype** at the cell's own
 * `matrixWorld`: one ~1 m phantom solid per cell, tagged as a BUILDING, with every real canopy
 * missing. `scene/planFeed.ts:239-251` had the correct branch the whole time.
 *
 * **No existing test could have caught it**, and the reason is right here in this file:
 * `mountSync()` mounts bare `THREE.Group`s, so nothing in the suite ever handed the feed an
 * instanced mesh. These three cases are that gap.
 */
describe("D1 — tree instances reach the worker as CANOPIES, not as phantom buildings", () => {
  /** A tree set in the slice-3 bake's own instance convention: yaw-only about +Y, scale
   *  `(r/0.5, heightM, r/0.5)`, translation in the cell frame. `occlusion.sweepTreeInstances`
   *  decodes exactly this, which is why the two feeds can be held to each other. */
  function treeSet(
    offsetsEnu: readonly [number, number][],
    heightM: number,
    radiusM: number,
    cellOriginEcef: readonly [number, number, number],
    frame: ReturnType<typeof enuFrameAt>,
  ): THREE.InstancedMesh {
    const geom = new THREE.BufferGeometry();
    // The PROTOTYPE is a unit tree at the origin — this is the shape whose bounding sphere used to
    // decide, wrongly, whether a whole cell was near the disc.
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(Float32Array.from([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]), 3),
    );
    const mesh = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial(), offsetsEnu.length);
    const m = new THREE.Matrix4();
    const s = radiusM / 0.5;
    offsetsEnu.forEach(([e, n], i) => {
      m.set(s, 0, 0, e, 0, heightM, 0, 0, 0, 0, s, n, 0, 0, 0, 1);
      // `Matrix4.set` is row-major; `elements` is column-major, which is the order the wire uses.
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Cell → ECEF: a rigid frame placed at `cellOriginEcef`, columns = the ENU basis.
    mesh.matrix.set(
      frame.east[0], frame.up[0], frame.north[0], cellOriginEcef[0],
      frame.east[1], frame.up[1], frame.north[1], cellOriginEcef[1],
      frame.east[2], frame.up[2], frame.north[2], cellOriginEcef[2],
      0, 0, 0, 1,
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorld.copy(mesh.matrix);
    return mesh;
  }

  const CENTRE_LAT = baseCtx.centreLatDeg;
  const CENTRE_LON = baseCtx.centreLonDeg;

  function mountWithTrees(inst: THREE.InstancedMesh, alsoPlainMesh: boolean) {
    const enriched = new THREE.Group();
    enriched.add(inst);
    if (alsoPlainMesh) {
      const g = new THREE.BufferGeometry();
      // A real building-ish TIN, comfortably inside the disc.
      const f = enuFrameAt(CENTRE_LAT, CENTRE_LON, 120);
      const p: number[] = [];
      for (const [e, n] of [[-20, -20], [20, -20], [0, 20]] as const) {
        p.push(
          f.originEcef[0] + e * f.east[0] + n * f.north[0],
          f.originEcef[1] + e * f.east[1] + n * f.north[1],
          f.originEcef[2] + e * f.east[2] + n * f.north[2],
        );
      }
      g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(p), 3));
      const plain = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      plain.matrixAutoUpdate = false;
      enriched.add(plain);
    }
    return attachBestSpotFeed({
      terrainHeightAt: () => 120,
      groundGroup: new THREE.Group(),
      buildingsGroup: new THREE.Group(),
      enrichedGroup: enriched,
    });
  }

  it("an instanced tree set yields CANOPIES and ZERO TIN — and a plain mesh still yields TIN", () => {
    const frame = enuFrameAt(CENTRE_LAT, CENTRE_LON, 120);
    const inst = treeSet([[10, 10], [-30, 5], [0, -40]], 9, 3, frame.originEcef, frame);
    const feed = mountWithTrees(inst, true);
    feed.update({ ...baseCtx });
    const job = solves()[0];
    if (job.type !== "solve") throw new Error("no solve");

    expect(job.canopies).toBeDefined();
    expect(job.canopies!.reduce((a, c) => a + c.count, 0)).toBe(3);
    // THE POSITIVE CONTROL — the plain mesh in the same group still becomes TIN, so "zero TIN from
    // the instanced set" is a statement about the branch and not about an empty scene.
    expect(job.built).toHaveLength(1);
    // …and the phantom is gone: the only TIN present is the plain mesh's 3 vertices.
    expect(job.built[0].positions.length).toBe(9);
    feed.dispose();
  });

  it("THE PER-INSTANCE CULL — a far cell whose TREES reach the disc still yields them", () => {
    // **This is the case a naive `isInstancedMesh` branch fails, and it is the whole point.**
    // `geom.boundingSphere` on an InstancedMesh is the PROTOTYPE's — a ~1 m ball at the cell root.
    // Enriched cells span hundreds of metres, so culling on that sphere (which is what the TIN path
    // does) deletes an entire tree set whose instances stand inside the disc. Here the cell root is
    // 1,200 m away and the trees are at the centre.
    const frame = enuFrameAt(CENTRE_LAT, CENTRE_LON, 120);
    const farOrigin: [number, number, number] = [
      frame.originEcef[0] + 1200 * frame.east[0],
      frame.originEcef[1] + 1200 * frame.east[1],
      frame.originEcef[2] + 1200 * frame.east[2],
    ];
    // Offsets are expressed in the CELL frame, so −1,200 m east puts the trees back at the disc.
    const inst = treeSet([[-1200, 0], [-1190, 12]], 11, 3.5, farOrigin, frame);
    const feed = mountWithTrees(inst, false);
    feed.update({ ...baseCtx });
    const job = solves()[0];
    if (job.type !== "solve") throw new Error("no solve");
    expect(job.canopies!.reduce((a, c) => a + c.count, 0)).toBe(2);
    feed.dispose();
  });

  it("`heightProvenance.enriched` counts BUILDINGS only — the tree sets no longer inflate it", () => {
    // A quiet correction to a user-visible number: the badge used to count every tree set as a
    // surveyed roof. Read a smaller `enriched` as the inflation being removed, not as a regression.
    const frame = enuFrameAt(CENTRE_LAT, CENTRE_LON, 120);
    const inst = treeSet([[5, 5], [6, 6]], 8, 2.5, frame.originEcef, frame);
    const feed = mountWithTrees(inst, true);
    feed.update({ ...baseCtx });
    const job = solves()[0];
    if (job.type !== "solve") throw new Error("no solve");
    expect(job.heightProvenance.enriched).toBe(1); // the plain mesh, and nothing else
    feed.dispose();
  });

  it("the canopy wire is a COPY — mutating the live instanceMatrix cannot reach the worker", () => {
    // `scene/enrichedBuildings.ts` writes `m13` into `instanceMatrix.array` during the tree re-seat
    // and three renders from it every frame. Transferring the live buffer would detach it; this is
    // the same rule, and the same reason, as `positions.slice()` on the TIN path.
    const frame = enuFrameAt(CENTRE_LAT, CENTRE_LON, 120);
    const inst = treeSet([[4, 4]], 7, 2, frame.originEcef, frame);
    const feed = mountWithTrees(inst, false);
    feed.update({ ...baseCtx });
    const job = solves()[0];
    if (job.type !== "solve") throw new Error("no solve");
    const before = job.canopies![0].instanceMatrices[5];
    (inst.instanceMatrix.array as Float32Array)[5] = 999;
    expect(job.canopies![0].instanceMatrices[5]).toBe(before);
    expect(before).toBeCloseTo(7, 6); // m5 IS the height, per the bake contract
    feed.dispose();
  });
});
