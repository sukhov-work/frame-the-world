/**
 * BEST SPOT — THE COMPOSITION TEST (LENS B gate, 2026-08-24).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A DUPLICATE OF THE FOUR SLICE SUITES
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * The BEST SPOT libs were built by four agents, one slice each. Every slice suite went green and
 * the whole gate read 1527/1527 — while the COMPOSITION was broken in two independent places:
 *
 *   · a real swept bridge deck published `RayEvidence.src = "terrain"`, so `F_sil` — the term §3.4
 *     was written FOR the owner's hero geometry — was structurally unreachable, and the bridge cell
 *     scored BELOW the same cell with no bridge at all (0.60799 vs 0.62306, measured);
 *   · `V` integrated the track's azimuth shoulders and its below-horizon tail, so a PERFECT open
 *     horizon measured `V = 0.5138` against §10 S1's own `V ≥ 0.95` done-check.
 *
 * NEITHER was visible to any slice suite, because every slice was tested against a fixture that
 * stood in for its neighbour: `bestSpotMetric`'s deck pin HAND-WROTE `src: "deck"` on a ray the
 * producer cannot emit, and `horizonSweep`'s acceptance test HAND-BUILT a track with
 * `windowLo = 0, windowHi = n − 1` and hand-made weights. Each fixture encoded what its author
 * BELIEVED the neighbour produced. The bug lived exactly in the gap between belief and product.
 *
 * So this file is allowed NO hand-written fixture on any seam. It runs the real chain:
 *
 *     eventTrack (real astronomy-engine ephemeris, real window markers, real weights)
 *          → localDsm  (real grid, real floating solid over water)
 *          → buildHulls + sweepAzimuth  (real sweep, one ray per track sample)
 *          → rayEvidenceAt             (the real published contract shape)
 *          → cellScore                 (the real metric)
 *
 * and asserts the one thing the owner actually asked for: **the bridge cell beats the same cell
 * with the bridge removed.** The two scenes differ by ONE `addFloatingSolid` call, so nothing but
 * the deck can move the number.
 *
 * NAMED BUG CLASS — A FIXTURE IS A BELIEF ABOUT A NEIGHBOUR. Any assertion on this seam that reads
 * an object literal instead of a producer's output is re-opening the LENS B defect. The only
 * literals below are scene geometry (where the deck is) and the observer; every ANGLE, every
 * DISTANCE, every TAG and every WEIGHT is computed by the module that owns it.
 *
 * Pure: no three, no store, no DOM, no `Date.now()` — the scene epoch is an explicit constant.
 */

import { describe, expect, it } from "vitest";
import type { PlanObserver } from "../../../src/lib/ephemeris/planner";
import { eventTrack } from "../../../src/lib/geo/bestSpotTrack";
import { BESTSPOT_METRIC_DEFAULTS, cellScore, visibilityGate } from "../../../src/lib/geo/bestSpotMetric";
import type { CellAccess, EventTrack, OccluderSrc, RayEvidence } from "../../../src/lib/geo/bestSpotTypes";
import {
  addFloatingSolid,
  cellAtEnu,
  cellIndexAt,
  createLocalDsm,
  discGridSpec,
  insideSolidInterior,
  sealDsm,
  SRC_BUILDING,
  SRC_DECK,
  stampSolid,
  type LocalDsm,
} from "../../../src/lib/geo/localDsm";
import { buildHulls, createSweepOut, rayEvidenceAt, sweepAzimuth } from "../../../src/lib/geo/horizonSweep";

// ---------------------------------------------------------------------------------------------
// The scene — the owner's hero case, stated once
// ---------------------------------------------------------------------------------------------

/** The house Dnipro fixture at the sea-level datum, byte-identical to `bestSpotTrack.test.ts`. */
const DNIPRO_SEA: PlanObserver = {
  latDeg: 48.4647,
  lonDeg: 35.0462,
  groundAltM: 0,
  eyeAboveGroundM: 0,
};

/** The scene epoch. An explicit constant — this module never reads a clock (house rule). */
const DAY_MS = Date.UTC(2026, 7, 24, 12);

/** Terrestrial refraction k, the shipped surveyor's standard, threaded through BOTH the track and
 *  the hulls so the sky and the skyline are quoted in ONE refraction (bestSpotTypes pin 1). */
const K = 0.13;

/** Pedestrian eye (m). The whole S1 acceptance criterion is stated at 1.7 m. */
const EYE_M = 1.7;

/** Deck geometry. A Central-Bridge-shaped span: 400 m long, 16 m wide, its underside 10 m over the
 *  water and its deck 16 m — so the sun passes UNDER it before it passes BEHIND it, which is the
 *  entire reason `bands` exists (bestSpotTypes pin 2). */
const DECK_DIST_M = 1500;
const DECK_HALF_LEN_M = 200;
const DECK_HALF_WIDTH_M = 8;
const DECK_BASE_M = 10;
const DECK_TOP_M = 16;

/** Grid half-span (m) — comfortably beyond the deck so the far horizon is genuinely open water. */
const HALF_SPAN_M = 1700;
const CELL_M = 10;

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

/** Flat water at the sea-level datum, everywhere known. The bare scene is a PERFECT open horizon,
 *  which is what makes the deck the only thing that can move any number. */
function waterDsm(): LocalDsm {
  const dsm = createLocalDsm(discGridSpec(HALF_SPAN_M, CELL_M));
  dsm.ground.fill(0);
  dsm.groundKnown.fill(1);
  return dsm;
}

/**
 * Place the deck ACROSS the setting azimuth at `DECK_DIST_M`, computed from the track's own
 * `setAzDeg` rather than hard-coded — a bridge the sun does not set behind is not the hero case,
 * and a literal here would silently stop being the hero case if the ephemeris ever moved.
 */
function addDeck(dsm: LocalDsm, setAzDeg: number): void {
  const rad = (setAzDeg * Math.PI) / 180;
  const ue = Math.sin(rad); // ENU east component of the bearing (N=0, E=90)
  const un = Math.cos(rad);
  const ce = ue * DECK_DIST_M;
  const cn = un * DECK_DIST_M;
  // Centreline runs PERPENDICULAR to the bearing, so the deck crosses the ray rather than lying
  // along it — an along-ray deck would be a tunnel, not a silhouette.
  const pe = un;
  const pn = -ue;
  addFloatingSolid(dsm, {
    e0: ce - pe * DECK_HALF_LEN_M,
    n0: cn - pn * DECK_HALF_LEN_M,
    e1: ce + pe * DECK_HALF_LEN_M,
    n1: cn + pn * DECK_HALF_LEN_M,
    halfWidthM: DECK_HALF_WIDTH_M,
    baseM: DECK_BASE_M,
    topM: DECK_TOP_M,
    src: SRC_DECK,
  });
}

/**
 * The REAL sweep, one ray per track sample. `cellScore`'s index contract is that `rays[i]` and
 * `track.samples[i]` describe the SAME azimuth (§3.1) — honoured here by construction rather than
 * by a comment, which is the seam the slice suites each faked from their own side.
 */
function sweepCentre(track: EventTrack, withDeck: boolean): { rays: RayEvidence[]; dsm: LocalDsm } {
  const dsm = waterDsm();
  if (withDeck) addDeck(dsm, track.setAzDeg);
  sealDsm(dsm);
  const centre = cellAtEnu(dsm, 0, 0);
  const out = createSweepOut(dsm.cellCount, 1 << 16);
  const rays = track.samples.map((s) => {
    sweepAzimuth(dsm, buildHulls(dsm, s.azDeg, { refractionK: K }), s.azDeg, EYE_M, out);
    return rayEvidenceAt(out, centre);
  });
  return { rays, dsm };
}

/** Identical in both arms, so accessibility can never be what moves the score. */
const ACCESS: CellAccess = { hard: 1, soft: 1, cls: "deck", groundReachable: true };
const OPTS = { ...BESTSPOT_METRIC_DEFAULTS, eyeM: EYE_M };

function realTrack(): EventTrack {
  const t = eventTrack(DNIPRO_SEA, "sunset", DAY_MS);
  if (t === null) throw new Error("composition fixture: the Dnipro sunset track must exist");
  return t;
}

describe("BEST SPOT — COMPOSITION: the whole chain on the owner's hero case", () => {
  it("the track under test is the REAL one — shoulders, below-horizon tail and all", () => {
    const track = realTrack();
    // If any of these stop holding, the composition below has quietly become a synthetic fixture
    // again and the assertions that follow stop meaning what their names say.
    expect(track.samples.length).toBeGreaterThan(20);
    // There ARE shoulders outside the window — the thing `V` must not integrate (pin 6).
    expect(track.windowLo).toBeGreaterThan(0);
    expect(track.windowHi).toBeLessThan(track.samples.length - 1);
    // The track really does run BELOW the horizon — the other half of pin 6.
    expect(track.samples[track.samples.length - 1].altAppDeg).toBeLessThan(-1);
    // …and it really is a sunset descending through the deck's band.
    expect(track.samples[0].altAppDeg).toBeGreaterThan(track.samples[track.samples.length - 1].altAppDeg);
    expect(track.worth).toBe(1); // sun kinds are worth exactly 1 (M is a scene scalar)
  });

  /**
   * MEASURED ON THIS FIXTURE (2026-08-24, the real chain end to end):
   *
   *   FIXED      withDeck S=0.88853  v=0.87300  l=1  p=0.84832  f=0.81832  src="deck"     d*=1491.95 m
   *              bare     S=0.69606  v=0.97371  l=1  p=1.00000  f=0        src="terrain"  d*=1780.76 m
   *              margin  +0.19247
   *
   *   S3b — GRAZE replaces the saturating tangency (owner ruling R5). Re-measured on the same chain:
   *              withDeck S=0.82219  f=0.59720  fGraze=0.59720  fGap=0  tau=1.5913 ρ  grazeSrc="deck"
   *              bare     S=0.69606  f=0        (relief 0 — the water horizon is BELOW the dip)
   *              margin  +0.12613   ⇒ smaller, and still a photographic lead. Every other term is
   *              byte-identical: GRAZE touches `F` and nothing else.
   *
   *   BLOCKER 1 REVERTED (the shipped pre-LENS-B state: `src` bound to the ground setter AND
   *   `silTangency` gated on that headline with no band walk):
   *              withDeck S=0.65264  f=0  src="terrain"      bare S=0.69606
   *              margin  −0.04342   ⇒ THE BRIDGE WAS A LIABILITY, on the real chain.
   *
   * That sign flip is this file's whole reason to exist, and it reproduces the reviewer's finding
   * independently: they measured −0.01507 on a hand-built track, this measures −0.04342 on the real
   * ephemeris. Same defect, same direction, a fixture the producer can actually emit.
   */
  it("THE CLAIM — the bridge cell beats the same cell with the bridge removed", () => {
    const track = realTrack();
    const withDeck = cellScore(sweepCentre(track, true).rays, track, ACCESS, OPTS);
    const bare = cellScore(sweepCentre(track, false).rays, track, ACCESS, OPTS);

    expect(withDeck.verdict).toBe("scored");
    expect(bare.verdict).toBe("scored");

    // ── THE assertion this whole file exists for. Before the LENS B fixes this ran the other way.
    expect(withDeck.score).toBeGreaterThan(bare.score);
    // …by a photographic margin, not by 1e-9.
    expect(withDeck.score - bare.score).toBeGreaterThan(0.1);

    // The CHANNEL that carries it: the framing term fires on the deck's own band edge. `F` is the
    // term that was structurally dead on this exact geometry.
    //
    // S3b: `> 0.8` → `> 0.5`, measured **0.59720** (SPEC_V2 §1.1's independent forecast: 0.5972).
    // The shipped `silTangency` returned 0.81832 here because its triangular kernel SATURATED on any
    // built edge the body's centre crossed — a blank wall scored the same. GRAZE prices the deck by
    // how long the sun rides it, and 0.597 is what a 6 m slab 1.5 km out is actually worth. Relaxing
    // the threshold rather than dropping `graze.scaleRadii` to 1.00 is deliberate: discrimination
    // between a deck and a wall is the whole point, and a scale that re-saturates would delete it.
    expect(withDeck.f).toBeGreaterThan(0.5);
    // …and the BARE cell is still EXACTLY 0 — for a better reason than before. It used to be 0
    // because `isBuiltSrc("terrain")` was false; it is 0 now because the flat-water horizon sits at
    // −0.0616° against a dip of −0.03904°, so `e − dipFloor` is −0.0226° and `smoothstep(0.05, 0.40)`
    // is a hard 0. RELIEF, not provenance: there is no edge standing above the horizon to ride.
    expect(bare.f).toBe(0);
    expect(bare.fGraze).toBe(0);
    expect(bare.fGap).toBe(0);
    // The deck is the HEADLINE occluder — the tag the panel's "BEHIND A BRIDGE" row reads.
    expect(withDeck.srcStar).toBe<OccluderSrc>("deck");
    expect(bare.srcStar).toBe<OccluderSrc>("terrain");

    // …and the contact DISTANCE the panel prints is the DECK's, not the far bank's. This is the
    // half of BLOCKER 1 that `srcStar` alone does not cover: `depthTerm` was weighting the deck's
    // silhouette by the water horizon 289 m beyond it.
    expect(withDeck.dStarM).toBeLessThan(bare.dStarM);
    expect(withDeck.dStarM).toBeGreaterThan(DECK_DIST_M - 20);
    expect(withDeck.dStarM).toBeLessThan(DECK_DIST_M);

    // The bridge DOES cost visibility — it really is in the way for part of the descent. The point
    // of the composition is that it prices that against the frame it buys, not only the loss.
    expect(withDeck.v).toBeLessThan(bare.v);
  });

  it("BOTH LENS B fixes are required TOGETHER: the deck cell clears §6's legibility floor", () => {
    const track = realTrack();
    const withDeck = cellScore(sweepCentre(track, true).rays, track, ACCESS, OPTS);
    const bare = cellScore(sweepCentre(track, false).rays, track, ACCESS, OPTS);

    // THE cross-slice claim, and the reason neither fix is sufficient alone. `S = A·M·G(V)·[…]`:
    // the deck can only pay if `G(V)` is not throttling it. With the track's below-horizon tail in
    // `V`, `G(V) = 0.657` multiplied EVERY term — so even a perfect `F` could not lift the cell over
    // §6's ~50 % legibility floor. `F_sil` alone (BLOCKER 1) fixes the numerator; the track weight
    // and window marker (BLOCKER 2) fix the multiplier. This asserts BOTH ends at once.
    // Measured: bare v = 0.97371, withDeck v = 0.87300. With BLOCKER 2 reverted (§3.1's bare
    // exponential, no horizon ceiling) bare v falls to 0.68485 and this first line goes red.
    expect(bare.v).toBeGreaterThan(0.95); // a perfect open horizon really is perfect (S1 check 1)
    expect(visibilityGate(bare.v)).toBe(1); // …and the gate SATURATES rather than throttling
    expect(withDeck.v).toBeGreaterThan(0.75); // the deck cell is still fully through the gate
    expect(visibilityGate(withDeck.v)).toBe(1);
    // Both cells are legible on §6's ABSOLUTE ramp, and the bridge is the better one.
    expect(bare.score).toBeGreaterThan(0.5);
    expect(withDeck.score).toBeGreaterThan(0.5);
  });

  it("the deck is priced at the DECK's distance, not at the far bank's", () => {
    const track = realTrack();
    const { rays } = sweepCentre(track, true);
    // The ray at the contact bearing — the one the sun actually sets on.
    const contact = rays.reduce((best, r) =>
      Math.abs(r.azDeg - track.setAzDeg) < Math.abs(best.azDeg - track.setAzDeg) ? r : best,
    );

    // The two channels are published SEPARATELY, and they disagree — which is the whole point.
    expect(contact.bands.length).toBeGreaterThanOrEqual(1);
    expect(contact.bandSrc[0]).toBe<OccluderSrc>("deck");
    // The GROUND under the deck is water out to the far edge of the grid: terrain, and FARTHER.
    expect(contact.groundSrc).toBe<OccluderSrc>("terrain");
    expect(contact.groundDistM).toBeGreaterThan(DECK_DIST_M);
    // The HEADLINE is the NEAREST of the two — the deck — and it is quoted at the deck's own range.
    expect(contact.src).toBe<OccluderSrc>("deck");
    expect(contact.blockerDistM).toBeLessThan(contact.groundDistM);
    expect(contact.blockerDistM).toBeGreaterThan(DECK_DIST_M - 100);
    expect(contact.blockerDistM).toBeLessThan(DECK_DIST_M + 100);

    // …and the band really does straddle the sun's descent, which is what makes the tangency real
    // rather than a number that happens to be positive.
    const [lo, hi] = contact.bands[0];
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    const alts = track.samples.map((s) => s.altAppDeg);
    expect(Math.min(...alts)).toBeLessThan(lo); // the sun gets below the underside
    expect(Math.max(...alts)).toBeGreaterThan(hi); // …and starts above the deck
  });

  /**
   * REPORTED GAP, PINNED RATHER THAN FIXED (LENS B gate, 2026-08-24) — **R1's AERIAL GATE IS BLIND
   * TO FLOATING SOLIDS.**
   *
   * `insideSolidInterior` reads the RASTER layer (`solidMask`/`solidBase`/`solidTop`), and
   * `addFloatingSolid` deliberately writes NONE of it (localDsm pin 2: a deck's whole value is the
   * sky under it, which no single-valued height field can carry). The two facts are individually
   * correct and jointly leave a hole: a drone parked at 12 m INSIDE the Central Bridge's deck slab
   * reads as free air, because the only channel that knows the deck is there is the sweep's
   * analytic `floating` list, which the accessibility layer never consults.
   *
   * This is NOT fixed here — the producer that would populate both channels (§10 S3's feed) does
   * not exist yet, and whether a deck should be double-represented is an owner/design call, not a
   * gate call. It is pinned so the next pass reads it as known: the POSITIVE CONTROL below proves
   * the gate itself works on a ground-resting solid in the very same scene, which isolates the gap
   * to the floating channel and nowhere else.
   */
  it("REPORTED GAP — R1's aerial gate cannot see a FLOATING deck (the sweep can); a stamped solid it can", () => {
    const track = realTrack();
    const { dsm } = sweepCentre(track, true);
    const rad = (track.setAzDeg * Math.PI) / 180;
    const de = Math.sin(rad) * DECK_DIST_M;
    const dn = Math.cos(rad) * DECK_DIST_M;
    const underDeck = cellAtEnu(dsm, de, dn);

    // The SWEEP sees the deck at this bearing — established by the band assertions above, so the
    // object genuinely is there.
    expect(dsm.floating.length).toBe(1);
    // …but the RASTER layer has no record of it at all, at any height inside its own envelope.
    expect(dsm.solidMask[underDeck]).toBe(0);
    expect(insideSolidInterior(dsm, underDeck, DECK_BASE_M)).toBe(false);
    expect(insideSolidInterior(dsm, underDeck, (DECK_BASE_M + DECK_TOP_M) / 2)).toBe(false);

    // POSITIVE CONTROL — the gate is not simply broken. A GROUND-RESTING solid stamped into the
    // same scene at the same place is seen, with R1's half-open interval intact.
    const stamped = createLocalDsm(discGridSpec(HALF_SPAN_M, CELL_M));
    stamped.ground.fill(0);
    stamped.groundKnown.fill(1);
    stampSolid(stamped, {
      ring: [de - 40, dn - 40, de + 40, dn - 40, de + 40, dn + 40, de - 40, dn + 40],
      baseM: DECK_BASE_M,
      topM: DECK_TOP_M,
      datum: "aboveGround",
      src: SRC_BUILDING,
    });
    sealDsm(stamped);
    const inMass = cellAtEnu(stamped, de, dn);
    expect(stamped.solidMask[inMass]).toBe(1);
    expect(insideSolidInterior(stamped, inMass, DECK_BASE_M)).toBe(true);
    expect(insideSolidInterior(stamped, inMass, DECK_TOP_M - 0.01)).toBe(true);
    // Half-open: the roof is standable, so `h === solidTop` is OUTSIDE (that is the R1 ruling).
    expect(insideSolidInterior(stamped, inMass, DECK_TOP_M)).toBe(false);
    // …and below the underside is air, not solid — the base is not assumed 0.
    expect(insideSolidInterior(stamped, inMass, DECK_BASE_M - 0.01)).toBe(false);

    // The observer's own cell is 1.5 km away over open water — never an interior, on either grid.
    const centre = cellAtEnu(dsm, 0, 0);
    expect(centre).toBe(cellIndexAt(dsm, (dsm.nx - 1) / 2, (dsm.ny - 1) / 2));
    expect(insideSolidInterior(stamped, centre, EYE_M)).toBe(false);
    expect(insideSolidInterior(stamped, centre, DECK_BASE_M + 1)).toBe(false);
  });
});
