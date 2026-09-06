/**
 * T77 slice C-1 (2026-09-06j) — STREAMING QUIET: the pure decisions the enriched seat drain makes
 * once the ground stops moving.
 *
 * Why this module exists. Browser-attributed at the Dnipro FPV eye AFTER the tile queues emptied
 * (`scripts/probe-cpu-profile.mjs --pose fpv`, plus a per-frame `__globe.seatSettle()` recorder):
 * **100 % of frames still wrote seats** — ~103 features a frame, forever. The refresh round-robin
 * in `scene/enrichedBuildings.ts` re-asked 104 already-seated footprints a frame whether or not
 * the ground under them had moved, and the answers came back millimetres apart; `seatSnapM` is
 * 5 mm, so each wander restarted and landed an ease, dirtied a position/edge buffer and cost an
 * upload. In the profile `bufferSubData` was **56.7 %** of the main thread and `applyFeatureSeats`
 * a further 7.9 %.
 *
 * Three decisions fix that, and all three are pure functions of numbers — so they live here,
 * where they can be tested without a tileset, a renderer or a camera:
 *
 *   • `seatFreezeM`  (5b) — the deadband under which a REFRESHED terrain answer is discarded.
 *   • `idleSweepNow` (5d) — whether the refresh round-robin runs on this frame at all.
 *   • `regionArmsCell` (5e) — whether a drained terrain dirty region covers a cell's footprint.
 *
 * T101 (2026-09-06n) adds a fourth, for the STREAMING side of the same drain:
 *
 *   • `deepAnswerVerdict` — what to do with a footprint answer that is implausible against its
 *     cell plane but came from a DEEPER tile than the plane: correct the plane, HOLD the cell
 *     until something else does, or reject the sample outright.
 *
 * The scene module owns the state (which cell, which frame, which queues); this module owns the
 * arithmetic. Tunables are passed in rather than imported so a test can sweep them.
 */

/**
 * 5b — the SUB-PIXEL SEAT FREEZE deadband, in metres.
 *
 * The smaller of two bounds:
 *  • **screen space** — `minSeatPx` pixels at this cell's own distance from the eye. A seat move
 *    the viewer cannot see does not justify a vertex write plus a buffer upload. The conversion
 *    is `metresPerPixelPerM · distM`, where `metresPerPixelPerM = 2·tan(fovY/2) / heightPx` is the
 *    vertical metres one pixel spans at 1 m from the eye (constant for a frame — the caller
 *    computes it once).
 *  • **relief** — `freezeReliefK` of the relief this cell has actually SHOWN (`reliefM`, or
 *    `expectedReliefM` before it has shown any). Without it, a far pose (a pixel is ≈15 m at the
 *    700 m orbit) would freeze away the whole ±10 m within-cell relief the per-feature seat exists
 *    to remove — the freeze would have become a silent accuracy regression at altitude rather
 *    than a cost saving at the eye.
 *
 * Returns 0 — "never freeze" — whenever an input is missing or non-finite (no camera yet, a
 * stubbed renderer, a cell at the eye). 0 restores the pre-slice behaviour exactly, so the failure
 * mode of this function is *correct and slow*, never *fast and wrong*.
 */
export function seatFreezeM(
  minSeatPx: number,
  metresPerPixelPerM: number,
  distM: number,
  reliefM: number,
  expectedReliefM: number,
  freezeReliefK: number,
): number {
  if (!(minSeatPx > 0) || !(metresPerPixelPerM > 0) || !(distM > 0)) return 0;
  if (!Number.isFinite(distM) || !Number.isFinite(metresPerPixelPerM)) return 0;
  const relief = Number.isFinite(reliefM) && reliefM > 0 ? reliefM : expectedReliefM;
  const reliefBound = Number.isFinite(relief) && relief > 0 ? relief * freezeReliefK : 0;
  const pixelBound = minSeatPx * metresPerPixelPerM * distM;
  if (!(reliefBound > 0)) return Math.max(0, pixelBound);
  return Math.max(0, Math.min(pixelBound, reliefBound));
}

/**
 * 5d — may the REFRESH round-robin run on this frame?
 *
 * `everyFrames <= 1` restores the every-frame sweep (the pre-slice behaviour, and the escape
 * hatch if the idle rate ever hides a real drift). Anything larger is a rate: one sweep every N
 * frames, phase-locked to the frame counter so the cost lands on one frame in N rather than
 * smearing. A cell that is still draining, or whose ground just changed, bypasses this entirely
 * in the caller — the rate governs SPECULATIVE work only.
 */
export function idleSweepNow(frameNo: number, everyFrames: number): boolean {
  const every = Math.max(1, Math.round(everyFrames));
  if (every <= 1) return true;
  return frameNo % every === 0;
}

/**
 * 5e — does a drained terrain dirty region `[west, south, east, north]` (degrees) cover a cell?
 *
 * A baked cell is stored as a POINT (its centre) but is really a `halfSpanM`-ish square, so the
 * region is padded by that half-span before the test: a tile that lands on a cell's edge changes
 * the ground under that cell's buildings and must arm it. The longitude pad widens with latitude
 * (a degree of longitude is shorter there), clamped so it stays finite at the poles.
 */
export function regionArmsCell(
  region: readonly [number, number, number, number],
  cellLatDeg: number,
  cellLonDeg: number,
  halfSpanM: number,
): boolean {
  const padLat = halfSpanM / 111_320;
  const padLon = padLat / Math.max(0.05, Math.cos((cellLatDeg * Math.PI) / 180));
  return (
    cellLonDeg >= region[0] - padLon &&
    cellLonDeg <= region[2] + padLon &&
    cellLatDeg >= region[1] - padLat &&
    cellLatDeg <= region[3] + padLat
  );
}

/**
 * T101 (2026-09-06n, owner ruling 2026-09-06m option (a)) — the DEEP-ANSWER verdict.
 *
 * The C-1 deep-answer rule (`reseatResampleCellOnDeep`) is right about WHAT a deeper
 * implausible answer means — the cell PLANE is stale, not the sample — and it corrects the plane
 * out of turn, at most once per cell per frame and at most `maxPerFrame` raycasts a frame. What
 * it got wrong is the fall-through: a sample the cap could not serve was counted as a REJECTION,
 * the feature went back into its queue, and the next frame raycast it and rejected it again,
 * against the same stale plane, until the 6-per-frame round-robin finally reached the cell. At
 * the orbit ARRIVAL every resident cell's plane refines at once, so the cap is saturated for the
 * whole burst and the drain burns its budget on re-rejections: `rejected` climbed **+39,629**
 * over the 479-frame leg (measured 2026-09-06k2; it was 0 before C-1), with no accuracy to show
 * for it (end residual 0.000 m, collapses 0, city p95 29.7 m — all unchanged).
 *
 * The verdict, for an answer ALREADY known to be implausible against the plane:
 *
 *   • `"reject"`   — not a deeper answer at all (the rule is off, a depth is unknown, or the
 *                    sample is no finer than the plane): the ordinary plausibility rejection.
 *                    A plane that is already at the sample's depth is never held — the answer
 *                    is not evidence of staleness, so the hold has no say (T101 pin (c)).
 *   • `"resample"` — deeper, the cell has not been corrected this frame and the frame's budget
 *                    is unspent: re-sample the plane NOW and re-test (the C-1 behaviour).
 *   • `"hold"`     — deeper, but the budget is spent or the cell was already corrected this
 *                    frame without satisfying this sample: the cell WAITS. The caller parks the
 *                    whole cell (no raycast until its plane is next re-sampled through any path)
 *                    and does NOT count a rejection — `rejected` keeps meaning "implausible
 *                    against a CURRENT plane". With `holdOn` false this is `"reject"`, which is
 *                    exactly the pre-T101 per-frame re-rejection.
 *
 * Depth −1 means "unknown" on either side (the plain sampler, a never-sampled plane). `spent`
 * and `maxPerFrame` are raycast counts for THIS frame; a cap of 0 disables correction entirely,
 * and with the hold on it parks every deeper-disagreeing cell until the round-robin, which is the
 * documented meaning of `reseatDeepResampleMaxPerFrame: 0` made cheaper rather than changed.
 */
export function deepAnswerVerdict(
  resampleOn: boolean,
  holdOn: boolean,
  depth: number,
  planeDepth: number,
  resampledThisFrame: boolean,
  spent: number,
  maxPerFrame: number,
): "resample" | "hold" | "reject" {
  if (!resampleOn) return "reject";
  if (!(depth >= 0) || !(planeDepth >= 0) || !(depth > planeDepth)) return "reject";
  if (!resampledThisFrame && spent < maxPerFrame) return "resample";
  return holdOn ? "hold" : "reject";
}
