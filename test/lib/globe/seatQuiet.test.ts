import { describe, it, expect } from "vitest";
import {
  deepAnswerVerdict,
  idleSweepNow,
  regionArmsCell,
  seatFreezeM,
} from "../../../src/lib/globe/seatQuiet";
import { ENRICHED } from "../../../src/components/globe/tuning";

/**
 * T77 slice C-1 (2026-09-06j) — the STREAMING-QUIET decisions.
 *
 * The defect these encode, measured in the browser at the Dnipro FPV eye AFTER the tile queues
 * emptied: 100 % of frames still wrote seats (~103 features a frame), because the refresh
 * round-robin re-asked 104 already-seated footprints a frame and the answers wandered by
 * millimetres — above `seatSnapM` (5 mm), so each wander restarted and landed an ease and dirtied
 * a buffer. `bufferSubData` was 56.7 % of the main thread in the CPU profile.
 *
 * Each block below states the mutation that turns it red, because a test that cannot be broken
 * by the obvious wrong implementation is not a gate.
 */

// The FPV eye: a 60° camera on a 950-CSS-px viewport at DPR 2 → 1900 device px.
const MPP_FPV = (2 * Math.tan((60 * Math.PI) / 360)) / 1900; // ≈ 6.1e-4 m per px per m

describe("seatQuiet 5b — the sub-pixel seat freeze", () => {
  it("a first sample is the caller's business: the deadband itself is a pure number, 0 when unknown", () => {
    // No pixel scale yet (no camera / a stubbed renderer) → never freeze. The failure mode of the
    // freeze must be "correct and slow", never "fast and wrong".
    expect(seatFreezeM(0.5, 0, 500, 12, 14, 0.01)).toBe(0);
    expect(seatFreezeM(0.5, MPP_FPV, 0, 12, 14, 0.01)).toBe(0);
    expect(seatFreezeM(0, MPP_FPV, 500, 12, 14, 0.01)).toBe(0); // knob off
    expect(seatFreezeM(0.5, MPP_FPV, Number.NaN, 12, 14, 0.01)).toBe(0);
    expect(seatFreezeM(0.5, Number.POSITIVE_INFINITY, 500, 12, 14, 0.01)).toBe(0);
  });

  it("at the FPV eye the pixel bound is millimetres — exactly the wander that was writing", () => {
    // A street cell 300 m away: half a pixel is ~9 cm... but the relief bound is the binding one
    // (0.01 × 12 m = 12 cm), so the freeze is the smaller of the two. Either way it is well above
    // the 5 mm `seatSnapM` that let a millimetre wander restart an ease.
    const fz = seatFreezeM(0.5, MPP_FPV, 300, 12, 14, 0.01);
    expect(fz).toBeGreaterThan(ENRICHED.seatSnapM); // the wander is frozen
    expect(fz).toBeLessThan(0.2); // and a real refinement (metres) still lands
  });

  it("the RELIEF bound is what stops the freeze becoming an accuracy regression at altitude", () => {
    // At the 700 m orbit a pixel is ~0.4 m and at 30 km it is ~18 m. Without the relief cap the
    // freeze would swallow the whole ±10 m within-cell relief the per-feature seat exists to
    // remove — a silent accuracy loss dressed up as a cost saving.
    const far = seatFreezeM(0.5, MPP_FPV, 30_000, 12, 14, 0.01);
    const pixelBoundFar = 0.5 * MPP_FPV * 30_000;
    expect(pixelBoundFar).toBeGreaterThan(9); // the pixel really is metres wide up there
    expect(far).toBeCloseTo(12 * 0.01, 10); // …and the relief bound wins
    expect(far).toBeLessThan(0.2);
  });

  it("falls back to the expected relief until a cell has shown its own", () => {
    // reliefHiM − reliefLoM is −Infinity … +Infinity before the first accepted sample.
    const unseen = seatFreezeM(0.5, MPP_FPV, 30_000, Number.NEGATIVE_INFINITY, 14, 0.01);
    expect(unseen).toBeCloseTo(14 * 0.01, 10);
    expect(seatFreezeM(0.5, MPP_FPV, 30_000, 0, 14, 0.01)).toBeCloseTo(14 * 0.01, 10);
    expect(seatFreezeM(0.5, MPP_FPV, 30_000, Number.NaN, 14, 0.01)).toBeCloseTo(14 * 0.01, 10);
  });

  it("grows with distance and shrinks with resolution — it is a SCREEN measure, not a metre one", () => {
    // Mutation that makes this red: a flat metre deadband (ignore mpp/dist), which would either
    // do nothing at the eye or destroy the seat at altitude.
    const near = seatFreezeM(0.5, MPP_FPV, 50, 100, 14, 0.01);
    const far = seatFreezeM(0.5, MPP_FPV, 400, 100, 14, 0.01);
    expect(far).toBeGreaterThan(near);
    const dense = seatFreezeM(0.5, MPP_FPV / 2, 400, 100, 14, 0.01); // twice the pixels
    expect(dense).toBeLessThan(far);
  });

  it("never returns a negative deadband for any sign of input", () => {
    expect(seatFreezeM(0.5, MPP_FPV, 300, -5, -14, -0.01)).toBeGreaterThanOrEqual(0);
    expect(seatFreezeM(0.5, MPP_FPV, -300, 12, 14, 0.01)).toBe(0);
  });

  it("the shipped tunables leave the eye's deadband under a decimetre", () => {
    const fz = seatFreezeM(
      ENRICHED.reseatMinSeatPx,
      MPP_FPV,
      250,
      12,
      ENRICHED.reseatExpectedReliefM,
      ENRICHED.reseatFreezeReliefK,
    );
    expect(fz).toBeGreaterThan(ENRICHED.seatSnapM);
    expect(fz).toBeLessThanOrEqual(0.15);
  });
});

describe("seatQuiet 5d — the idle sweep rate", () => {
  it("1 (or 0, or a negative) restores the every-frame refresh sweep", () => {
    for (let f = 0; f < 10; f++) {
      expect(idleSweepNow(f, 1)).toBe(true);
      expect(idleSweepNow(f, 0)).toBe(true);
      expect(idleSweepNow(f, -3)).toBe(true);
    }
  });

  it("N fires exactly once every N frames", () => {
    const fired = [];
    for (let f = 0; f < 300; f++) if (idleSweepNow(f, 30)) fired.push(f);
    expect(fired).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270]);
  });

  it("the shipped rate sweeps at least twice a second at 60 Hz", () => {
    let fired = 0;
    for (let f = 0; f < 60; f++) if (idleSweepNow(f, ENRICHED.reseatIdleSweepEveryFrames)) fired++;
    expect(fired).toBeGreaterThanOrEqual(2);
    // …and costs at most a tenth of what the every-frame sweep did.
    expect(fired).toBeLessThanOrEqual(6);
  });
});

describe("seatQuiet 5e — a dirty terrain region arms a cell", () => {
  const DNIPRO_LAT = 48.4647;
  const DNIPRO_LON = 35.0462;
  const HALF = ENRICHED.cellHalfSpanM;

  it("a region containing the cell centre arms it", () => {
    expect(regionArmsCell([35.04, 48.46, 35.05, 48.47], DNIPRO_LAT, DNIPRO_LON, HALF)).toBe(true);
  });

  it("a region that only touches the cell's EDGE still arms it (the half-span pad)", () => {
    // A tile 300 m west of the centre: its region misses the point but covers the cell's buildings.
    const padLon = HALF / 111_320 / Math.cos((DNIPRO_LAT * Math.PI) / 180);
    const west = DNIPRO_LON - padLon * 0.5;
    expect(regionArmsCell([west - 0.001, 48.46, west, 48.47], DNIPRO_LAT, DNIPRO_LON, HALF)).toBe(
      true,
    );
    // Mutation that makes this red: test the bare centre point with no pad — every tile that lands
    // on a cell boundary then fails to arm the cell whose buildings it moved.
    expect(regionArmsCell([west - 0.001, 48.46, west, 48.47], DNIPRO_LAT, DNIPRO_LON, 0)).toBe(
      false,
    );
  });

  it("a region a kilometre away does not arm it", () => {
    expect(regionArmsCell([35.08, 48.46, 35.09, 48.47], DNIPRO_LAT, DNIPRO_LON, HALF)).toBe(false);
    expect(regionArmsCell([35.04, 48.50, 35.05, 48.51], DNIPRO_LAT, DNIPRO_LON, HALF)).toBe(false);
  });

  it("the longitude pad widens with latitude and stays finite at the pole", () => {
    // The SAME metre half-span must reach further in DEGREES the further north you go, because a
    // degree of longitude is shorter there. Measured as the widest longitude gap that still arms.
    const reach = (latDeg: number): number => {
      let lo = 0;
      let hi = 20;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        // a region that ENDS `mid` degrees west of the cell centre
        if (regionArmsCell([10 - mid - 1, latDeg - 1, 10 - mid, latDeg + 1], latDeg, 10, 5_000))
          lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const atEquator = reach(0);
    const at80 = reach(80);
    expect(atEquator).toBeCloseTo(5_000 / 111_320, 6);
    expect(at80).toBeGreaterThan(atEquator * 5); // 1/cos(80°) ≈ 5.76
    // The cosine is clamped, so the pole is finite rather than an infinite pad.
    expect(Number.isFinite(reach(90))).toBe(true);
    expect(reach(90)).toBeLessThanOrEqual((5_000 / 111_320) / 0.05 + 1e-9);
  });
});

/**
 * The SHIPPED knobs, as a set. Each of the three decisions above is provably right for its own
 * arguments; these are the relations BETWEEN them, which is where a plausible-looking retune goes
 * wrong silently — the freeze swallowing a real refinement, the idle rate outliving the arming
 * window, or a per-cell bound that is not a per-frame COST bound.
 */
describe("seatQuiet — the shipped ENRICHED knobs hold together", () => {
  it("the arming window outlives the idle sweep period (5e ⊃ 5d)", () => {
    // A cell armed by a dirty region must stay armed long enough for the refresh sweep to visit
    // it at least once even if 5e's bypass were removed; otherwise a newly arrived tile could
    // land, arm, expire and be swept only by luck.
    expect(ENRICHED.reseatDirtyArmFrames).toBeGreaterThan(ENRICHED.reseatIdleSweepEveryFrames);
  });

  it("the idle rate is a whole number of frames ≥ 1 (a rate, not a probability)", () => {
    expect(Number.isInteger(ENRICHED.reseatIdleSweepEveryFrames)).toBe(true);
    expect(ENRICHED.reseatIdleSweepEveryFrames).toBeGreaterThanOrEqual(1);
    expect(idleSweepNow(0, ENRICHED.reseatIdleSweepEveryFrames)).toBe(true);
  });

  it("the deep-answer plane correction is bounded PER FRAME, not only per cell", () => {
    // "At most once per cell per frame" bounds the loop, not the cost: at the boot every resident
    // cell can qualify at once. The per-frame cap must be the same order as the ordinary plane
    // sweep, or the fix costs more main thread than the rejections it removes.
    expect(ENRICHED.reseatDeepResampleMaxPerFrame).toBeGreaterThan(0);
    expect(ENRICHED.reseatDeepResampleMaxPerFrame).toBeLessThanOrEqual(
      2 * ENRICHED.reseatSamplesPerFrame,
    );
  });

  it("the freeze deadband is strictly above the snap that made the wander write", () => {
    // `seatSnapM` is what lands an ease; a freeze at or below it would freeze nothing.
    const fz = seatFreezeM(
      ENRICHED.reseatMinSeatPx,
      MPP_FPV,
      300,
      ENRICHED.reseatExpectedReliefM,
      ENRICHED.reseatExpectedReliefM,
      ENRICHED.reseatFreezeReliefK,
    );
    expect(fz).toBeGreaterThan(ENRICHED.seatSnapM);
    // …and strictly below the cell plausibility gate, so the freeze can never hide a collapse.
    expect(fz).toBeLessThan(ENRICHED.reseatFeatureMaxDeltaM);
  });

  it("both quiet levers ship ON, and each has an OFF that restores the old behaviour", () => {
    expect(ENRICHED.reseatIdleSkip).toBe(true);
    expect(ENRICHED.reseatDirtyRegions).toBe(true);
    expect(ENRICHED.reseatResampleCellOnDeep).toBe(true);
    // The documented escape hatches really are no-ops rather than merely smaller numbers.
    expect(idleSweepNow(7, 1)).toBe(true);
    expect(seatFreezeM(0, MPP_FPV, 300, 12, 14, 0.01)).toBe(0);
  });
});

/**
 * T101 (2026-09-06n, owner ruling 2026-09-06m option (a)) — the DEEP-PENDING HOLD.
 *
 * The defect, measured at the orbit ARRIVAL (2026-09-06k2): the C-1 deep-answer rule corrects a
 * stale cell plane at most 6 times a frame, and a deeper answer the cap could not serve fell
 * through to `rejected` — the feature went back into its queue and was raycast and rejected again
 * every frame against the same stale plane until the 6-per-frame round-robin reached its cell.
 * `rejected` climbed +39,629 over the 479-frame leg (0 before C-1) for no accuracy (end 0.000 m,
 * collapses 0, city p95 29.7 m — unchanged). The ruling: such a cell WAITS — one flag per cell,
 * set when the deep rule could not run, cleared when the plane next re-samples — and a held
 * sample is not a rejection.
 *
 * The four pins the brief names, each stated against the mutation that turns it red.
 */
describe("seatQuiet T101 — the deep-answer verdict", () => {
  const MAX = ENRICHED.reseatDeepResampleMaxPerFrame;

  it("(a) with the cap exhausted a deeper answer is HELD, not rejected", () => {
    // Mutation that makes this red: the C-1 fall-through (return "reject" whenever the cap is
    // spent), which is exactly the per-frame re-rejection.
    expect(deepAnswerVerdict(true, true, 15, 7, false, MAX, MAX)).toBe("hold");
    expect(deepAnswerVerdict(true, true, 15, 7, false, MAX + 3, MAX)).toBe("hold");
    // …and so is a cell the rule already corrected once this frame whose plane still disagrees.
    expect(deepAnswerVerdict(true, true, 17, 15, true, 1, MAX)).toBe("hold");
    // Budget unspent and not yet corrected this frame → the C-1 correction runs.
    expect(deepAnswerVerdict(true, true, 15, 7, false, 0, MAX)).toBe("resample");
    expect(deepAnswerVerdict(true, true, 15, 7, false, MAX - 1, MAX)).toBe("resample");
  });

  it("(c) the hold never speaks for a plane that is already at the answer's depth", () => {
    // Same depth, or a plane FINER than the sample: the answer is not evidence of staleness, so
    // it is an ordinary plausibility rejection whatever the budget says. Mutation that makes this
    // red: dropping the `depth > planeDepth` test — every implausible sample would then park its
    // cell, and a single garbage raycast would stall a street.
    for (const spent of [0, MAX]) {
      expect(deepAnswerVerdict(true, true, 15, 15, false, spent, MAX)).toBe("reject");
      expect(deepAnswerVerdict(true, true, 12, 15, false, spent, MAX)).toBe("reject");
    }
    // An unknown depth on either side (the plain sampler, a never-sampled plane) is not "deeper".
    expect(deepAnswerVerdict(true, true, -1, 7, false, 0, MAX)).toBe("reject");
    expect(deepAnswerVerdict(true, true, 15, -1, false, 0, MAX)).toBe("reject");
    expect(deepAnswerVerdict(true, true, Number.NaN, 7, false, 0, MAX)).toBe("reject");
    // The rule itself off → nothing is ever corrected OR held.
    expect(deepAnswerVerdict(false, true, 15, 7, false, 0, MAX)).toBe("reject");
  });

  it("(d) `reseatDeepPendingHold: false` reproduces the per-frame rejection exactly", () => {
    // Every input that would HOLD with the knob on REJECTS with it off; every other verdict is
    // unchanged — the knob only ever renames one outcome.
    const cases: Array<[number, number, boolean, number]> = [
      [15, 7, false, MAX],
      [15, 7, false, MAX + 3],
      [17, 15, true, 1],
      [15, 7, false, 0],
      [15, 15, false, 0],
      [12, 15, false, MAX],
      [-1, 7, false, 0],
    ];
    for (const [d, pd, again, spent] of cases) {
      const on = deepAnswerVerdict(true, true, d, pd, again, spent, MAX);
      const off = deepAnswerVerdict(true, false, d, pd, again, spent, MAX);
      expect(off).not.toBe("hold");
      expect(off).toBe(on === "hold" ? "reject" : on);
    }
  });

  it("a cap of 0 holds every deeper-disagreeing cell (the documented OFF of the correction, cheaper)", () => {
    expect(deepAnswerVerdict(true, true, 15, 7, false, 0, 0)).toBe("hold");
    expect(deepAnswerVerdict(true, false, 15, 7, false, 0, 0)).toBe("reject");
  });

  it("the hold ships ON, and the cap it protects is unchanged at 6", () => {
    expect(ENRICHED.reseatDeepPendingHold).toBe(true);
    expect(ENRICHED.reseatDeepResampleMaxPerFrame).toBe(6);
  });
});

/**
 * (b) — and the whole loop, as a MODEL of the scene module's wiring: cells whose plane sits at a
 * stale depth, a 6-per-frame plane round-robin, a 6-per-frame deep-correction cap, and a drain
 * that samples every feature of every unheld cell each frame. The model is the contract the
 * fences in `test/components/globe/fences.test.ts` pin the source to: a held cell is skipped, the
 * plane sweep releases it, its features are then accepted against the corrected plane, and
 * `rejected` never moves. With the hold off the same model reproduces the thrash.
 */
describe("seatQuiet T101 — the arrival burst, modelled", () => {
  interface Cell {
    planeDepth: number;
    deepResampleFrame: number;
    deepPending: boolean;
    seated: boolean[];
  }
  const PLANE_SWEEP = ENRICHED.reseatSamplesPerFrame;
  const MAX = ENRICHED.reseatDeepResampleMaxPerFrame;
  const FINE = 15;

  const run = (cellCount: number, holdOn: boolean, frames: number) => {
    const cells: Cell[] = Array.from({ length: cellCount }, () => ({
      planeDepth: 7, // every plane stale at once — the arrival
      deepResampleFrame: -1,
      deepPending: false,
      seated: [false, false, false],
    }));
    let rejected = 0;
    let held = 0;
    let raycasts = 0;
    let rr = 0;
    let firstFrameAllSeated = -1;
    const refreshCellPlane = (cell: Cell): void => {
      if (cell.deepPending) cell.deepPending = false; // the release, on the attempt
      cell.planeDepth = FINE; // the terrain under the centre has refined
    };
    for (let frame = 1; frame <= frames; frame++) {
      let spent = 0;
      // The plane round-robin, ahead of the drain (as in update()).
      for (let i = 0; i < Math.min(PLANE_SWEEP, cells.length); i++)
        refreshCellPlane(cells[rr++ % cells.length]);
      // The drain: every feature of every cell, unless the cell is held.
      for (const cell of cells) {
        if (holdOn && cell.deepPending) continue;
        for (let f = 0; f < cell.seated.length; f++) {
          if (cell.seated[f]) continue;
          raycasts++;
          // A fine answer disagrees with a stale plane; it agrees once the plane is fine.
          const implausible = cell.planeDepth < FINE;
          if (!implausible) {
            cell.seated[f] = true;
            continue;
          }
          const v = deepAnswerVerdict(
            true,
            holdOn,
            FINE,
            cell.planeDepth,
            cell.deepResampleFrame === frame,
            spent,
            MAX,
          );
          if (v === "resample") {
            cell.deepResampleFrame = frame;
            spent++;
            refreshCellPlane(cell);
            cell.seated[f] = true; // re-tested against the corrected plane: accepted
          } else if (v === "hold") {
            cell.deepPending = true;
            held++;
            break; // the rest of this cell is skipped from here on
          } else rejected++;
        }
      }
      if (firstFrameAllSeated < 0 && cells.every((c) => c.seated.every(Boolean)))
        firstFrameAllSeated = frame;
    }
    return { rejected, held, raycasts, firstFrameAllSeated, pending: cells.filter((c) => c.deepPending).length };
  };

  it("hold ON: no rejection at all, every cell released within one plane-sweep rotation", () => {
    const cells = 101; // the orbit's resident count
    const r = run(cells, true, 60);
    expect(r.rejected).toBe(0);
    expect(r.held).toBeGreaterThan(0);
    expect(r.held).toBeLessThanOrEqual(cells); // at most one hold per cell per stale plane
    expect(r.pending).toBe(0); // nothing left held after quiet
    // A held cell waits at most ⌈cells / reseatSamplesPerFrame⌉ frames — the round-robin's own
    // rotation — so the burst is fully seated inside it (+1 for the frame that seats them).
    expect(r.firstFrameAllSeated).toBeGreaterThan(0);
    expect(r.firstFrameAllSeated).toBeLessThanOrEqual(Math.ceil(cells / PLANE_SWEEP) + 1);
  });

  it("hold OFF: the same burst re-rejects every frame until the round-robin arrives (the +39,629)", () => {
    const on = run(101, true, 60);
    const off = run(101, false, 60);
    expect(off.rejected).toBeGreaterThan(101); // more than one per cell: per FRAME, per feature
    expect(off.held).toBe(0);
    expect(off.raycasts).toBeGreaterThan(on.raycasts); // the budget the hold gives back
    // Same accuracy either way — the hold trades nothing but wasted raycasts.
    expect(on.firstFrameAllSeated).toBeGreaterThan(0);
    expect(off.firstFrameAllSeated).toBeGreaterThan(0);
  });

  it("a plane that is already fine is never held (the FPV eye after quiet: rejected +0, held +0)", () => {
    const cells = 20;
    const r = run(cells, true, 5);
    // Second pass over the SAME model with every plane already fine: nothing to hold, nothing
    // to reject, every feature seats on its first sample.
    const quiet = (() => {
      const cs: Cell[] = Array.from({ length: cells }, () => ({
        planeDepth: FINE,
        deepResampleFrame: -1,
        deepPending: false,
        seated: [false, false, false],
      }));
      let held = 0;
      let rejected = 0;
      for (const cell of cs)
        for (let f = 0; f < 3; f++) {
          const v = deepAnswerVerdict(true, true, FINE, cell.planeDepth, false, 0, MAX);
          if (cell.planeDepth < FINE) {
            if (v === "hold") held++;
            else rejected++;
          } else cell.seated[f] = true;
        }
      return { held, rejected, seated: cs.every((c) => c.seated.every(Boolean)) };
    })();
    expect(quiet).toEqual({ held: 0, rejected: 0, seated: true });
    expect(r.pending).toBe(0);
  });
});
