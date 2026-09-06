/**
 * The SHIMMER leg's summary arithmetic, extracted so it can be re-run OFFLINE (T77 slice A0,
 * 2026-09-06).
 *
 * `verify-temporal-stability.mjs` is a top-level-await CDP script: importing it opens a browser
 * target. That made the summary un-re-derivable — the baseline in `MEASUREMENTS` §8 could only
 * ever be reproduced by re-running the harness against a live `wix dev`, which is exactly the
 * property a BASELINE must not have. Every number the harness reports is now computed here, from
 * the per-frame rows the run already stores in `verify-shots/perf/temporal-*.json`, so an amended
 * summary can be proved against a stored run before it is ever trusted on a new one.
 *
 * Two additions this split exists to carry, both about the same weakness in the original summary:
 * a p50 over per-frame RATIOS is not the fraction of the mask that flipped over the leg. A leg
 * whose mask collapses (which is exactly what a shadow fix might do) can post a *higher* p50 churn
 * on far fewer flipped pixels, because the denominator shrank with it.
 *
 *  · `churnMean` / `flipsTotal` / `unionTotal` — the leg-level truth. `flipsTotal / unionTotal` is
 *    the pooled churn; `churnMean` is what the 4×/1× rate-linearity ratio is now taken over,
 *    because a mean responds to the whole distribution while a p50 can sit still while the tail
 *    doubles (measured on the stored baseline: the FPV leg's p95/p50 is 1.43).
 *  · `speckleWeighted` — Σisolated / Σflips, i.e. the share of ALL flipped pixels that were
 *    isolated, rather than the median of per-frame shares. The per-frame share is undefined on a
 *    zero-flip frame and is dominated by the quietest frames when flips are rare, which is the
 *    regime a fixed rig is supposed to reach.
 *
 * `casRefresh` is stamped per row rather than computed in the browser so that it, too, is
 * re-derivable from any stored run: a cascade's `ageMs` RESETS when its depth map is re-rendered,
 * so a drop against the previous row is a refresh. It is the discriminator behind the §8 reading
 * that the ULTRA cascade refresh does not cause the city control leg's pops (17 of 18 refreshes
 * produce zero flips).
 */

/** Percentile over the finite numbers in `arr` (p in [0,1]); null when there are none. */
export function pct(arr, p) {
  const s = arr.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
}

/** Arithmetic mean over the finite numbers in `arr`; null when there are none. */
export function mean(arr) {
  const s = arr.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

/**
 * Isolated-flip COUNT for one row.
 *
 * Rows written from 2026-09-06 carry it directly. Older runs — including the §8 baseline
 * `temporal-warm-2026-09-05T20-50-21.json`, which is the whole reason this fallback exists —
 * carry only `speckle = isolated / flips`, so reconstruct the integer. `flips` is at most
 * W×H = 243,200 and `speckle` is a float64 ratio of integers, so the round-trip is exact well
 * past this scale.
 */
export function isolatedOf(row) {
  if (typeof row.isolated === "number") return row.isolated;
  if (typeof row.speckle === "number" && typeof row.flips === "number") {
    return Math.round(row.speckle * row.flips);
  }
  return 0;
}

/**
 * How many cascades re-rendered their depth map between `prev` and `row`.
 *
 * A cascade's `ageMs` is "ms since this map was last rendered", so it climbs monotonically and
 * DROPS on a refresh. A cascade that was inactive (`null`) and now reports an age has just come
 * back, which is also a refresh. Everything else — both null, or a climbing age — is not.
 */
export function cascadeRefreshCount(prev, row) {
  let n = 0;
  for (const k of ["cas1Age", "cas2Age"]) {
    const a = prev[k];
    const b = row[k];
    if (typeof b !== "number") continue;
    if (typeof a !== "number" || b < a) n++;
  }
  return n;
}

/** Stamp `casRefresh` onto every row in place (null on the first row — no predecessor). */
export function stampCascadeRefresh(rows) {
  for (let i = 0; i < rows.length; i++) {
    rows[i].casRefresh = i > 0 ? cascadeRefreshCount(rows[i - 1], rows[i]) : null;
  }
  return rows;
}

/**
 * Summarize one shimmer leg from its RAW rows (row 0 included — it is dropped here, because it has
 * no predecessor and therefore no churn). Mutates the rows to stamp `casRefresh`.
 *
 * Returns only the row-derived half of the summary; the caller merges the probe-level facts
 * (`camFrozen`, `lights`, `W`, `H`) it already has.
 */
export function summarizeShimmer(allRows) {
  stampCascadeRefresh(allRows);
  const rows = allRows.slice(1);
  const churn = rows.map((x) => x.churn);
  const nz = churn.filter((c) => c !== null && c > 0);
  const speckle = rows.map((x) => x.speckle).filter((x) => x !== null);
  const sunMoved = rows.length > 1 ? rows[rows.length - 1].sunElev - rows[0].sunElev : 0;
  const resamples = rows.filter((x, i) => i > 0 && x.sampleMs !== rows[i - 1].sampleMs).length;
  const boundsSteps = rows.filter((x, i) => i > 0 && x.boundsM !== rows[i - 1].boundsM).length;
  const p50 = pct(churn, 0.5);
  const p95 = pct(churn, 0.95);
  const max = pct(churn, 1);
  const flipsTotal = rows.reduce((a, x) => a + (x.flips ?? 0), 0);
  const unionTotal = rows.reduce((a, x) => a + (x.union ?? 0), 0);
  const isolatedTotal = rows.reduce((a, x) => a + isolatedOf(x), 0);
  const casRefreshes = rows.reduce((a, x) => a + (x.casRefresh ?? 0), 0);
  // The cascade-refresh discriminator: of the frames where a cascade re-rendered, how many flipped
  // a pixel at all. §8's reading ("a refresh may not pop") is this number being 0.
  const casRefreshFrames = rows.filter((x) => (x.casRefresh ?? 0) > 0).length;
  const casRefreshPops = rows.filter((x) => (x.casRefresh ?? 0) > 0 && (x.flips ?? 0) > 0).length;
  return {
    frames: rows.length,
    maskFracP50: pct(rows.map((x) => x.maskFrac), 0.5),
    churnP50: p50,
    churnP95: p95,
    churnMax: max,
    /** Mean over rows — the rate-linearity denominator (see the header). */
    churnMean: mean(churn),
    /** Pooled over the whole leg: the fraction of all union pixels that ever flipped. */
    churnPooled: unionTotal > 0 ? flipsTotal / unionTotal : null,
    flipsTotal,
    unionTotal,
    p95OverP50: p50 ? p95 / p50 : null,
    maxOverP50: p50 ? max / p50 : null,
    framesWithFlips: nz.length,
    speckleP50: pct(speckle, 0.5),
    /** Σisolated / Σflips — the leg's real speckle share, not the median of per-frame shares. */
    speckleWeighted: flipsTotal > 0 ? isolatedTotal / flipsTotal : null,
    isolatedTotal,
    sunMovedDeg: sunMoved,
    resamples,
    boundsSteps,
    casRefreshes,
    casRefreshFrames,
    casRefreshPops,
    /** Achieved camera yaw per frame (deg) — null on every leg but `pan`. */
    panDegP50: pct(rows.map((x) => x.panDeg), 0.5),
    panDegTotal: rows.reduce((a, x) => a + (x.panDeg ?? 0), 0),
    abMsP50: pct(rows.map((x) => x.abMs), 0.5),
  };
}

/**
 * The rate-linearity pair: how much more the mask churns when the sun is stepped 4× as fast.
 *
 * ≈4 means the churn tracks the sun (the shadow is moving); ≈1 means it does not (the RIG is
 * moving, and the sun is only the trigger). The baseline measured 1.24–1.64 on p50, which is what
 * put "the rig, not the sun" in §8. The MEAN is the headline now — see the header on why a p50 of
 * per-frame ratios understates a change in the tail — and the p50 ratio is kept beside it so the
 * amended number can be read against the baseline table as it stands.
 */
export function rateLinearity(s1, s4) {
  return {
    rateLinearity: s1?.churnMean ? s4.churnMean / s1.churnMean : null,
    rateLinearityP50: s1?.churnP50 ? s4.churnP50 / s1.churnP50 : null,
  };
}
