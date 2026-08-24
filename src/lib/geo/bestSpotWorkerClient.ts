/**
 * BEST SPOT — the MAIN-THREAD handle on the long-lived solve worker (`SPEC_V2 §7 S3d`).
 *
 * The split is the `decode/workerClient.ts` split: the worker is the message shell and owns the
 * resident state, this file owns the lifecycle and the `jobId` bookkeeping. The TYPING discipline
 * is copied verbatim — one discriminated union exported from the worker, TYPE-IMPORTED here, so
 * there is exactly one description of the wire and `astro check` enforces both ends of it. The
 * LIFECYCLE is deliberately the opposite:
 *
 * | | decode worker | BEST SPOT worker |
 * |---|---|---|
 * | spawn | per file | once, on the first job |
 * | terminate | on every settle (fresh wasm heap per RAW) | only in `dispose()` |
 * | state between jobs | none, by design | THE POINT (tiles, TIN, track, DSM, hulls, terms) |
 *
 * ── THE THREE LIFECYCLE DECISIONS, EACH WITH ITS REASON ──────────────────────────────────────
 *
 *  1. **SPAWN LAZILY, ON THE FIRST JOB.** The feature is off for most sessions and a module worker
 *     costs a real thread plus a chunk fetch. Nothing is spawned until the toggle actually posts.
 *
 *  2. **A CENTRE CHANGE CANCELS THE JOB AND KEEPS THE WORKER.** This was the open question in
 *     `BESTSPOT_PLAN §11` ("spawn on first toggle, terminate on panel close or centre change?").
 *     Terminating on a centre change is the wrong answer twice over: a pin nudged 40 m re-uses
 *     every z14 tile the worker already parsed (22 ms) and, on the panel-close half, a user who
 *     closes and re-opens the window would re-pay the whole T0 tier for nothing. The worker
 *     already drops the geometry itself when the centre key changes (`residentKeyOf`), so the
 *     memory is released without the thread being torn down. `terminate()` is reserved for
 *     `dispose()`, i.e. the globe going away.
 *
 *  3. **CANCELLATION IS COOPERATIVE, NOT `terminate()`.** A `postMessage` cannot interrupt a
 *     running 680 ms rung — only `terminate()` can, and that throws away the resident state the
 *     next job needs. So `cancel(jobId)` marks the job and the worker checks between rungs: the
 *     worst case is ONE extra rung of latency (10–680 ms depending on where it was), and the
 *     `scoringHash` echo catches anything that slips out anyway. The alternative — terminate and
 *     respawn on every pin drag — turns a 55 ms first ink into a 300 ms one.
 */

import type {
  BestSpotErrorMsg,
  BestSpotLiftMsg,
  BestSpotRefinedMsg,
  BestSpotRefineJob,
  BestSpotRungMsg,
  BestSpotSolveJob,
  BestSpotTilesMsg,
  BestSpotWorkerMessage,
  BestSpotWorkerRequest,
} from "./bestSpotWorker";

/** A job as the caller states it — `type` and `jobId` are the client's to assign. */
type SolveRequest = Omit<BestSpotSolveJob, "type" | "jobId">;
type ApplyRequest = Omit<import("./bestSpotWorker").BestSpotApplyJob, "type" | "jobId">;
type RefineRequest = Omit<BestSpotRefineJob, "type" | "jobId">;

export interface BestSpotWorkerHandlers {
  onRung(msg: BestSpotRungMsg): void;
  onTiles(msg: BestSpotTilesMsg): void;
  onLift(msg: BestSpotLiftMsg): void;
  onRefined(msg: BestSpotRefinedMsg): void;
  onError(msg: BestSpotErrorMsg): void;
}

export interface BestSpotWorkerHandle {
  /**
   * Post a full T0 solve and return its `jobId`.
   *
   * `transfer` carries the flattened TIN buffers. They are TRANSFERRED, never cloned — and never a
   * view onto a live `BufferAttribute`: the caller flattens a COPY per job, because transferring a
   * buffer three is still rendering from detaches it mid-frame. Re-flattening per job also happens
   * to be the honest thing: `SPEC_V2 §3.4` item 4 requires a FRESH DSM on every refinement, so a
   * cached wire would be exactly the stale-geometry accumulation the rule forbids.
   */
  solve(req: SolveRequest, transfer: Transferable[]): number;
  /** §5.6's hot-swap — recompose the resident term buffer at the finest landed rung. */
  apply(req: ApplyRequest): number;
  /** R8 — the explicit 1 m re-solve of one shortlisted cell. */
  refine(req: RefineRequest): number;
  /** Mark a job abandoned. Cooperative — see decision 3 in the header. */
  cancel(jobId: number): void;
  /** Cancel everything in flight (a centre change, a toggle off). Keeps the worker. */
  cancelAll(): void;
  /** How many jobs have been posted and not yet finished or cancelled — the DEV probe reads it. */
  inFlight(): number;
  /** Has the worker actually been spawned? False until the first post. */
  spawned(): boolean;
  dispose(): void;
}

export function createBestSpotWorkerClient(h: BestSpotWorkerHandlers): BestSpotWorkerHandle {
  let worker: Worker | null = null;
  let nextJobId = 1;
  /** Posted and not yet settled. A rung that is not the LAST does not settle its job. */
  const pending = new Set<number>();

  const ensure = (): Worker => {
    if (worker) return worker;
    // `astro.config.mjs` already sets `worker: { format: "es" }`, so no config change is needed
    // and Vite code-splits this into its own chunk at build.
    const w = new Worker(new URL("./bestSpotWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<BestSpotWorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "rung":
          // A `solve` settles only on its LAST rung; `apply` posts a single rung and settles on it.
          if (msg.rungIndex >= msg.rungCount - 1) pending.delete(msg.jobId);
          h.onRung(msg);
          break;
        case "tiles":
          h.onTiles(msg);
          break;
        case "lift":
          h.onLift(msg);
          break;
        case "refined":
          pending.delete(msg.jobId);
          h.onRefined(msg);
          break;
        case "error":
          pending.delete(msg.jobId);
          h.onError(msg);
          break;
      }
    };
    w.onerror = (event) => {
      // A worker-level crash settles EVERYTHING: the resident state is gone and no pending job can
      // ever answer. Reporting one error per orphaned job is what stops the panel showing a
      // permanent `SOLVING…` after a chunk fails to load.
      const orphans = [...pending];
      pending.clear();
      for (const jobId of orphans) {
        h.onError({ type: "error", jobId, message: event.message || "BEST SPOT worker crashed" });
      }
    };
    worker = w;
    return w;
  };

  const send = (req: BestSpotWorkerRequest, transfer: Transferable[] = []): number => {
    ensure().postMessage(req, transfer);
    pending.add(req.jobId);
    return req.jobId;
  };

  return {
    solve: (req, transfer) => send({ ...req, type: "solve", jobId: nextJobId++ }, transfer),
    apply: (req) => send({ ...req, type: "apply", jobId: nextJobId++ }),
    refine: (req) => send({ ...req, type: "refine", jobId: nextJobId++ }),
    cancel(jobId) {
      if (!pending.delete(jobId) || !worker) return;
      worker.postMessage({ type: "cancel", jobId } satisfies BestSpotWorkerRequest);
    },
    cancelAll() {
      if (!worker) {
        pending.clear();
        return;
      }
      for (const jobId of pending) worker.postMessage({ type: "cancel", jobId } satisfies BestSpotWorkerRequest);
      pending.clear();
    },
    inFlight: () => pending.size,
    spawned: () => worker !== null,
    dispose() {
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
