/**
 * BEST SPOT — the pure scoring kernel (`BESTSPOT_PLAN.md` §3, slice S1a).
 *
 * EVERY test here is written to FAIL against the pre-correction design. This repo has been bitten
 * five times by done-checks that could not fail, so each `it(...)` title names the BUG CLASS rather
 * than the code path: when one goes red the failure message should tell the next session which
 * mistake came back.
 *
 * The five mandatory pins of §10 S1 are the `PIN n —` describes below. Everything else is the
 * arithmetic those pins stand on (band unions, the analytic half-disc, gate endpoints, weight
 * normalisation) — a pin that rests on unpinned arithmetic is decoration.
 *
 * All synthetic. No ephemeris, no fixtures, no network: the whole kernel is reproducible from the
 * hand-written profiles below, which is the point of slice S1a.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BESTSPOT_METRIC_DEFAULTS,
  cellScore,
  clamp01,
  contactLowness,
  depthOfDistM,
  depthTerm,
  discVisibleFraction,
  grazeSample,
  isBuiltSrc,
  nearestEdgeDeltaDeg,
  notchAt,
  NOTCH_SALIENCE_DEG,
  smoothstep,
  unblockedSpanDeg,
  visibilityGate,
  V_GATE_HI,
  V_GATE_LO,
  type ColumnRayAt,
} from "../../../src/lib/geo/bestSpotMetric";
import {
  BESTSPOT_SCORING_V1,
  resolveScoring,
} from "../../../src/lib/geo/bestSpotScoring";
import { BESTSPOT_WEIGHTS } from "../../../src/lib/geo/bestSpotTypes";
import type {
  CellAccess,
  EventTrack,
  OccluderSrc,
  RayEvidence,
  TrackSample,
} from "../../../src/lib/geo/bestSpotTypes";
import { horizonDipDeg, R_MEAN_M } from "../../../src/lib/geo/horizonProfile";

// ---------------------------------------------------------------------------------------------
// Fixtures — the synthetic sky and the synthetic skyline
// ---------------------------------------------------------------------------------------------

/** Standard terrestrial refraction coefficient (`PLAN.refractionK`). */
const K = 0.13;

/** Solar angular radius at 1 AU-ish, mid of the shipped 0.262–0.271° band (`TrackSample.rhoDeg`). */
const RHO = 0.2635;

/** The pedestrian eye's own geometric horizon (−0.03904°) — GRAZE's relief ramp is anchored HERE
 *  and not at 0, which is what makes an open sea horizon score exactly 0 for the right reason. */
const DIP = horizonDipDeg(1.7, K);

/**
 * Measured at Dnipro (§3.1): the sun descends 0.1608°/min while its azimuth sweeps 5.5–7.5° over
 * the ~30 min window ⇒ ~1.45° of azimuth per degree of altitude. Reparameterising the track by
 * AZIMUTH (rather than by time) is what collapses the time index and the azimuth index into one,
 * and it is what removes the F_sil sampling aliasing — so the fixtures honour it exactly.
 */
const AZ_PER_ALT = 1.4509;

/**
 * Bennett's closed-form refraction, deg: `1 / (60·tan(h + 7.31/(h + 4.4)))`.
 *
 * The SHIPPED path uses astronomy-engine's exported `Refraction("normal", altAirless)`. This test
 * deliberately does NOT import it: pin 1 is about the ~0.5° SHIFT between an airless and an
 * apparent altitude, not about which refraction model produced it, and S1a must stay
 * ephemeris-free. Bennett gives 0.5746° at the horizon vs the standard 34′ = 0.5667° — within 0.008°
 * of each other, and both are ~2 solar radii, which is the whole finding.
 */
function bennettRefractionDeg(hDeg: number): number {
  return 1 / (60 * Math.tan((hDeg + 7.31 / (hDeg + 4.4)) * (Math.PI / 180)));
}

interface TrackSpec {
  /** Apparent altitude of the first sample (deg) — the top of the window. */
  topAltDeg: number;
  /** Apparent altitude of the last sample (deg) — the bottom of the window (usually negative). */
  bottomAltDeg: number;
  /** Azimuth step (deg). The shipped sweep is 0.25°; the fixtures run finer so the pins measure
   *  the METRIC and not the quadrature. */
  azStepDeg?: number;
  /** Subtract refraction from every altitude, i.e. hand the kernel an AIRLESS track (pin 1). */
  airless?: boolean;
  rhoDeg?: number;
  worth?: number;
}

interface Fixture {
  track: EventTrack;
  azs: number[];
}

/** A synthetic SUNSET track: azimuth ascending, apparent altitude descending, weights per §3.1
 *  (`|dt/daz|` is constant here and cancels in the normalisation; `exp(-max(0,alt)/2.5°)` does
 *  not — the last ~2° of the descent is what the photograph is about). */
function makeTrack(spec: TrackSpec): Fixture {
  const azStepDeg = spec.azStepDeg ?? 0.05;
  const rhoDeg = spec.rhoDeg ?? RHO;
  const altStep = azStepDeg / AZ_PER_ALT;
  const az0 = 250; // a plausible Dnipro sunset bearing; nothing depends on the absolute value
  const samples: TrackSample[] = [];
  const azs: number[] = [];
  let i = 0;
  for (let alt = spec.topAltDeg; alt >= spec.bottomAltDeg - 1e-9; alt -= altStep, i++) {
    const az = az0 + i * azStepDeg;
    samples.push({
      utcMs: 1_700_000_000_000 + Math.round((i * altStep * 60_000) / 0.1608),
      azDeg: az,
      altAppDeg: spec.airless ? alt - bennettRefractionDeg(alt) : alt,
      rhoDeg,
      w: Math.exp(-Math.max(0, alt) / 2.5),
    });
    azs.push(az);
  }
  return {
    track: {
      kind: "sunset",
      t0Ms: samples[0].utcMs,
      samples,
      // A synthetic track is ALL WINDOW — it carries no notch shoulders, so `V` sees every sample it
      // has (bestSpotTypes pin 6). Set explicitly rather than defaulted, so a fixture can never claim
      // shoulder samples the metric would then silently drop.
      windowLo: 0,
      windowHi: samples.length - 1,
      setAzDeg: az0,
      worth: spec.worth ?? 1,
    },
    azs,
  };
}

/** One ray, everything defaulted to "open, sampled, terrain". The two channels (ground + bands) are
 *  both spelled out: `src`/`blockerDistM` are the ray's HEADLINE (the nearest of the two), and a
 *  fixture that sets only the headline is describing a ray the sweep cannot emit. */
function ray(azDeg: number, o: Partial<RayEvidence> = {}): RayEvidence {
  const base: RayEvidence = {
    azDeg,
    groundAltAppDeg: -0.039,
    groundSrc: "terrain",
    groundDistM: 200_000,
    bands: [],
    bandSrc: [],
    bandDistM: [],
    blockerDistM: 200_000,
    src: "terrain",
    known: 1,
    // S3c — the ray SAYS HOW FAR IT LOOKED. A fixture that leaves this out is describing exactly
    // the defect `reachM` exists to close (bestSpotTypes pin 7): "the sweep found something" is not
    // "the sweep reached the trust radius". The default matches `groundDistM` — this base ray is a
    // clean 200 km horizon, so it looked 200 km.
    reachM: 200_000,
    openSky: true,
  };
  // `src`/`blockerDistM` follow the ground channel unless the caller overrides them explicitly, so a
  // one-line `{ src: "building" }` override still describes a coherent ray.
  const merged = { ...base, ...o };
  if (o.groundSrc !== undefined && o.src === undefined) merged.src = o.groundSrc;
  if (o.groundDistM !== undefined && o.blockerDistM === undefined) {
    merged.blockerDistM = o.groundDistM;
  }
  if (o.src !== undefined && o.groundSrc === undefined) merged.groundSrc = o.src;
  if (o.blockerDistM !== undefined && o.groundDistM === undefined) {
    merged.groundDistM = o.blockerDistM;
  }
  return merged;
}

/** A uniform skyline across a whole azimuth list. */
function uniformRays(azs: number[], o: Partial<RayEvidence>): RayEvidence[] {
  return azs.map((az) => ray(az, o));
}

/** The per-column evidence lookup `discVisibleFraction` wants — nearest ray by azimuth. */
function nearestRayLookup(rays: readonly RayEvidence[]): ColumnRayAt {
  return (azDeg) => {
    let best = rays[0];
    let bestD = Infinity;
    for (const r of rays) {
      const d = Math.abs(r.azDeg - azDeg);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  };
}

/** Perfectly accessible ground — pin the METRIC, not the landcover. */
const OPEN_ACCESS: CellAccess = { hard: 1, soft: 1, cls: "green", groundReachable: true };

const OPTS = BESTSPOT_METRIC_DEFAULTS;

/** The closed form the spec forbids: the horizontal-chord segment of a disc cut at `u` radii. */
function chordFraction(u: number): number {
  const c = Math.max(-1, Math.min(1, u));
  return (Math.acos(c) - c * Math.sqrt(1 - c * c)) / Math.PI;
}

/**
 * Re-sweep ONE physical skyline (a uniform ring ridge) at a new eye height.
 *
 * WHY THE TEST MUST DO THIS: `RayEvidence` is APPARENT, so a skyline's angles are a function of the
 * eye. Holding the ray array fixed while sliding the altitude slider is not "one fixed skyline" —
 * it is a physically impossible skyline that stays at the same angle as you climb, and under it
 * `L` is *provably* monotonically DECREASING (the dip anchor deepens while `alt*` does not move).
 * See the reported spec defect: §10 S1 pin 5 only means anything against a RE-SWEPT skyline.
 */
function sweepRidge(
  azs: number[],
  o: { distM: number; heightM: number; eyeM: number },
): RayEvidence[] {
  const drop = (o.distM * o.distM * (1 - K)) / (2 * R_MEAN_M);
  const ridgeDeg = (Math.atan2(o.heightM - o.eyeM - drop, o.distM) * 180) / Math.PI;
  const dipDeg = horizonDipDeg(o.eyeM, K);
  // Beyond the ridge the plain asymptotes to the eye's own dip, so the horizon is whichever is
  // higher. Below the ridge the cell is looking DOWN onto its horizon — signed, never floored.
  const ridgeWins = ridgeDeg > dipDeg;
  return uniformRays(azs, {
    groundAltAppDeg: ridgeWins ? ridgeDeg : dipDeg,
    blockerDistM: ridgeWins ? o.distM : Math.sqrt((2 * o.eyeM * R_MEAN_M) / (1 - K)),
    src: "terrain",
    openSky: !ridgeWins,
  });
}

// ---------------------------------------------------------------------------------------------
// §3.3 — the visibility atom
// ---------------------------------------------------------------------------------------------

describe("bestSpotMetric §3.3 — the disc is integrated over COLUMNS, not read from a chord", () => {
  it("a horizontal cut through the centre is exactly half the AREA at ANY column count", () => {
    const ev = ray(0, { groundAltAppDeg: 1.0, openSky: false });
    for (const columns of [1, 2, 3, 8, 64, 4096]) {
      expect(discVisibleFraction(ev, 1.0, RHO, columns)).toBeCloseTo(0.5, 12);
    }
  });

  it("converges to the analytic segment (acos u − u√(1−u²))/π for a purely HORIZONTAL occluder", () => {
    for (const u of [-0.9, -0.5, -0.25, 0, 0.25, 0.5, 0.9]) {
      const hg = u * RHO; // disc centre at 0, ground horizon u radii above/below it
      const ev = ray(0, { groundAltAppDeg: hg, openSky: false });
      expect(discVisibleFraction(ev, 0, RHO, 4096)).toBeCloseTo(chordFraction(u), 4);
    }
  });

  it("PIN — a VERTICAL edge is not a chord: the closed form flips 0→1 across one bin, columns do not", () => {
    // A tower flank between the 0.00° and 0.25° rays — the shipped azimuth step (§8), at which a
    // 2ρ = 0.527° solar disc spans ~2.1 columns of EVIDENCE.
    const rays = [
      ray(-0.25, { groundAltAppDeg: -1 }),
      ray(0, { groundAltAppDeg: -1 }),
      ray(0.25, { groundAltAppDeg: 5, src: "building", openSky: false, blockerDistM: 400 }),
      ray(0.5, { groundAltAppDeg: 5, src: "building", openSky: false, blockerDistM: 400 }),
    ];
    const lookup = nearestRayLookup(rays);

    // The COLUMN form: the nearest-ray boundary sits half a step (0.125°) right of the centre, so
    // the flank eats the outer 0.4744ρ of the disc — about a fifth of its area.
    const columns = discVisibleFraction(rays[1], 0, RHO, 8192, lookup);
    expect(columns).toBeCloseTo(1 - chordFraction(0.125 / RHO), 3);
    expect(columns).toBeGreaterThan(0.75);
    expect(columns).toBeLessThan(0.83);

    // The CHORD form — one centre sample, no neighbours — cannot see the flank at all.
    expect(discVisibleFraction(rays[1], 0, RHO, 8192, null)).toBe(1);
    // ...and one bin later it reads a total blackout. 0 → 1 in one bin is the defect.
    expect(discVisibleFraction(rays[2], 0, RHO, 8192, null)).toBe(0);
    const nextColumns = discVisibleFraction(rays[2], 0, RHO, 8192, lookup);
    expect(nextColumns).toBeCloseTo(chordFraction(0.125 / RHO), 3);
    expect(nextColumns).toBeGreaterThan(0.17);
  });

  it("a ZERO-radius body degrades to the point test rather than to 0/0", () => {
    const ev = ray(0, { groundAltAppDeg: 0.2, bands: [[1, 2]], openSky: false });
    expect(discVisibleFraction(ev, 0.1, 0, 8)).toBe(0); // under the ground horizon
    expect(discVisibleFraction(ev, 1.5, 0, 8)).toBe(0); // inside the band
    expect(discVisibleFraction(ev, 0.5, 0, 8)).toBe(1); // in the sky under the deck
  });
});

describe("bestSpotMetric §3.3 — band union arithmetic (a MAX is not a silhouette, F3)", () => {
  it("a floating deck subtracts a slab and leaves sky BOTH above and below it", () => {
    const deck = ray(0, {
      groundAltAppDeg: -0.04,
      bands: [[0.31, 0.38]],
      src: "deck",
      openSky: false,
      blockerDistM: 1500,
    });
    // [−0.04, 1] minus [0.31, 0.38] = 1.04 − 0.07
    expect(unblockedSpanDeg(deck, -1, 1)).toBeCloseTo(1.04 - 0.07, 12);
    // Sky under the deck exists — a per-bin MAX profile cannot express this, which is precisely
    // how "the sun setting behind the bridge" and "a blank 15-storey wall" became one object.
    expect(unblockedSpanDeg(deck, -0.04, 0.31)).toBeCloseTo(0.35, 12);
    expect(isBuiltSrc(deck.src)).toBe(true);
  });

  it("overlapping bands merge; a band swallowed by the ground horizon costs nothing", () => {
    const two = ray(0, {
      groundAltAppDeg: 0,
      bands: [
        [0.2, 0.6],
        [0.4, 0.9],
      ],
      openSky: false,
    });
    expect(unblockedSpanDeg(two, 0, 2)).toBeCloseTo(2 - 0.9 + 0.2 - 0 - 0.2 + 0.2, 12); // = 1.3
    expect(unblockedSpanDeg(two, 0, 2)).toBeCloseTo(1.3, 12);

    const drowned = ray(0, { groundAltAppDeg: 1, bands: [[0.2, 0.6]], openSky: false });
    expect(unblockedSpanDeg(drowned, 0, 2)).toBeCloseTo(1, 12);
  });

  it("an interval entirely below the ground horizon has zero open measure", () => {
    const ev = ray(0, { groundAltAppDeg: 2, openSky: false });
    expect(unblockedSpanDeg(ev, -1, 1)).toBe(0);
    expect(unblockedSpanDeg(ev, 2, 2)).toBe(0);
  });

  it("nearestEdgeDeltaDeg sees BOTH deck edges, not just the ground horizon", () => {
    const deck = ray(0, { groundAltAppDeg: -0.04, bands: [[0.31, 0.38]], src: "deck" });
    expect(nearestEdgeDeltaDeg(deck, 0.32)).toBeCloseTo(0.01, 12); // underside
    expect(nearestEdgeDeltaDeg(deck, 0.4)).toBeCloseTo(0.02, 12); // topside
    expect(nearestEdgeDeltaDeg(deck, -0.05)).toBeCloseTo(0.01, 12); // the water line
  });
});

// ---------------------------------------------------------------------------------------------
// Gate + term endpoints
// ---------------------------------------------------------------------------------------------

describe("bestSpotMetric — gate and term endpoints", () => {
  it("smoothstep pins its edges exactly and is NaN-safe", () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
    expect(smoothstep(1, 1, 0.5)).toBe(0); // degenerate edges become a hard step, never NaN
    expect(smoothstep(1, 1, 1)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });

  it("G(V) is SOFT — 0 at 0.15, 1 at 0.75, strictly between in between", () => {
    expect(visibilityGate(V_GATE_LO)).toBe(0);
    expect(visibilityGate(V_GATE_HI)).toBe(1);
    expect(visibilityGate(0.45)).toBeCloseTo(0.5, 12);
    // NOT a step: the F_sil hero case intentionally occults the disc for part of the track, so a
    // hard `V == 1` test would delete every silhouette shot the feature exists to find.
    expect(visibilityGate(0.3)).toBeGreaterThan(0);
    expect(visibilityGate(0.3)).toBeLessThan(0.5);
    expect(visibilityGate(0.6)).toBeGreaterThan(0.5);
    expect(visibilityGate(0.6)).toBeLessThan(1);
  });

  it("P is log-scaled: 0 at 30 m, 1 at the trust radius, 1 for open sky", () => {
    const at = (m: number) => depthTerm(ray(0, { blockerDistM: m, openSky: false }), 3000);
    expect(at(30)).toBeCloseTo(0, 12);
    expect(at(3000)).toBeCloseTo(1, 12);
    expect(at(4)).toBe(0); // the fence 4 m away is not "far in the distance"
    expect(at(1500)).toBeCloseTo(Math.log(50) / Math.log(100), 9);
    expect(at(1500)).toBeCloseTo(0.8495, 4);
    // The log's shape is the point: halving the distance is a fixed penalty, not a linear one.
    expect(at(300) - at(30)).toBeCloseTo(at(3000) - at(300), 9);
    expect(depthTerm(ray(0, { openSky: true, blockerDistM: 4 }), 3000)).toBe(1);
  });

  /**
   * S3b, owner ruling **R5** — this describe REPLACED the one that pinned `F_sil` as *"a TRIANGULAR
   * tangency kernel of half-width ρ, **gated on a BUILT setter**"*, asserting `terrain → 0` and
   * `tree → 0`. That gate IS what the owner asked to remove: measured, it scored a grazing 8 km
   * mountain ridge at 0.0000, below a blank wall and below empty sea. Provenance survives as `Conf`,
   * a soft weight, and the shipped triangular kernel survives as ONE OF TWO ARMS of `cut`.
   */
  it("GRAZE `cut` — the TANGENT arm is the shipped triangular kernel, kept as a FLOOR", () => {
    const built = ray(0, {
      groundAltAppDeg: 0.5,
      src: "building",
      openSky: false,
      blockerDistM: 3000,
    });
    // `discFrac = 1` (the disc fully clear) parks the AREA arm at exactly 0, so what is measured
    // here is the tangent arm alone — the same triangle, at the same half-width, as `silTangency`.
    const cutAt = (offset: number): number =>
      grazeSample(built, 0.5 + offset, RHO, DIP, BESTSPOT_SCORING_V1, 1).cut;
    expect(cutAt(0)).toBeCloseTo(1, 12); // dead tangent
    expect(cutAt(RHO / 2)).toBeCloseTo(0.5, 12); // triangular
    expect(cutAt(RHO)).toBeCloseTo(0, 12); // one radius out
    expect(cutAt(2 * RHO)).toBe(0);
    // …and an unsampled ray is not a frame.
    const unknown = ray(0, { groundAltAppDeg: 0.5, src: "building", known: 0 });
    expect(grazeSample(unknown, 0.5, RHO, DIP, BESTSPOT_SCORING_V1, 1).cut).toBe(0);
  });

  it("GRAZE `cut` — the AREA arm `4f(1−f)` fires where the tangent arm CANNOT: a vertical flank", () => {
    // A 5° tower flank the body's centre never comes within a radius of: δ = 5° = 19 ρ, so the
    // tangent arm is exactly 0 at every sample. The disc is still being cut in HALF by the flank's
    // vertical edge, which is what `f` from the column integral knows and no angle on the centre
    // ray can express.
    const flank = ray(0, { groundAltAppDeg: 5, src: "building", groundDistM: 400, openSky: false });
    expect(grazeSample(flank, 0, RHO, DIP, BESTSPOT_SCORING_V1, 0.5).cut).toBe(1); // exactly half
    expect(grazeSample(flank, 0, RHO, DIP, BESTSPOT_SCORING_V1, 1).cut).toBe(0); // fully clear
    expect(grazeSample(flank, 0, RHO, DIP, BESTSPOT_SCORING_V1, 0).cut).toBe(0); // fully hidden
    expect(grazeSample(flank, 0, RHO, DIP, BESTSPOT_SCORING_V1, 0.85).cut).toBeCloseTo(0.51, 12);
    // Both arms are individually switchable, and `max` means either can carry a sample alone.
    const areaOff = resolveScoring({ graze: { areaArm: false } });
    expect(grazeSample(flank, 0, RHO, DIP, areaOff, 0.5).cut).toBe(0);
  });

  it("GRAZE `Q` — provenance is a WEIGHT now, not a gate: terrain 1.00 · building 0.90 · tree 0.45", () => {
    const at = (src: OccluderSrc): number =>
      grazeSample(
        ray(0, { groundAltAppDeg: 0.5, src, groundDistM: 3000, openSky: false }),
        0.5,
        RHO,
        DIP,
        BESTSPOT_SCORING_V1,
        1,
      ).q;
    // Relief is saturated (0.54° above the dip) and Depth is 1 at the trust radius, so `Q` here IS
    // `Conf`. TERRAIN — the case the shipped gate scored 0 — is now the MOST trusted source there is.
    expect(at("terrain")).toBeCloseTo(1, 12);
    expect(at("building")).toBeCloseTo(0.9, 12);
    expect(at("deck")).toBeCloseTo(0.9, 12);
    // A tree is a DISCOUNT, not a veto: 151,046 of Dnipro's 161,823 canopies are seeded scatter with
    // jittered class-default heights (§8), so framing must not fire on fiction at full confidence —
    // but a real tree line IS a silhouette, and the shipped hard 0 is what R5 deleted.
    expect(at("tree")).toBeCloseTo(0.45, 12);
    expect(BESTSPOT_SCORING_V1.graze.conf.tree).toBeLessThanOrEqual(0.6); // BESTSPOT_SAFETY
    expect(at("none")).toBe(0); // an untagged edge is ignorance, not a frame
  });

  it("GRAZE `Q` — RELIEF is why an open horizon scores 0, and it is measured above the DIP", () => {
    // THE replacement reason. A flat sea horizon sits AT the observer's own dip, so `e − dipFloor`
    // is 0 and `smoothstep(0.05, 0.40, 0)` is a hard 0 — no edge stands above the horizon to ride.
    // This survives when the same water is tagged `deck` by a bridge overhead, which the old
    // provenance gate did not.
    const sea = ray(0, { groundAltAppDeg: horizonDipDeg(1.7, K), src: "terrain" });
    expect(grazeSample(sea, horizonDipDeg(1.7, K), RHO, DIP, BESTSPOT_SCORING_V1, 0.5).q).toBe(0);
    const water = ray(0, { groundAltAppDeg: horizonDipDeg(1.7, K), src: "deck" });
    expect(grazeSample(water, horizonDipDeg(1.7, K), RHO, DIP, BESTSPOT_SCORING_V1, 0.5).q).toBe(0);
    // …and it is a RAMP, not a step: 0.05° above the dip is mesh noise, 0.40° is a silhouette.
    const q = (heightAboveDip: number): number =>
      grazeSample(
        ray(0, {
          groundAltAppDeg: DIP + heightAboveDip,
          src: "terrain",
          groundDistM: 3000,
          openSky: false,
        }),
        DIP + heightAboveDip,
        RHO,
        DIP,
        BESTSPOT_SCORING_V1,
        1,
      ).q;
    expect(q(0.05)).toBe(0);
    expect(q(0.4)).toBeCloseTo(1, 12);
    expect(q(0.225)).toBeCloseTo(0.5, 12); // the ramp's midpoint
    expect(q(0.15)).toBeGreaterThan(0);
    expect(q(0.15)).toBeLessThan(0.5);
  });

  it("GRAZE `Q` — the edge carries its OWN tag and its OWN distance, per EDGE and not per ray", () => {
    // The owner's hero ray: water at −0.04° tagged `terrain` 1700 m out, a deck slab floating at
    // [0.31, 0.38]° 1500 m out, headline `deck`. Three probes, three different answers — a per-ray
    // read cannot produce them.
    const deck = ray(0, {
      groundAltAppDeg: -0.04,
      groundSrc: "terrain",
      groundDistM: 1700,
      bands: [[0.31, 0.38]],
      bandSrc: ["deck"],
      bandDistM: [1500],
      src: "deck",
      blockerDistM: 1500,
      openSky: false,
    });
    const under = grazeSample(deck, 0.31, RHO, DIP, BESTSPOT_SCORING_V1, 0.5);
    expect(under.src).toBe<OccluderSrc>("deck");
    expect(under.distM).toBe(1500); // NOT the far bank's 1700
    // `Q = Relief · Conf · Depth`, all three of them the DECK's own: relief off the underside's
    // 0.349° above the dip (still on the ramp), conf 0.90, depth at 1500 m and not at 1700 m.
    expect(under.q).toBeCloseTo(
      smoothstep(0.05, 0.4, 0.31 - DIP) * 0.9 * depthOfDistM(1500, 3000),
      12,
    );
    expect(under.q).toBeCloseTo(0.7206, 4);
    // The WATER LINE on the same ray is terrain, and it has no relief — the mirror-image bug.
    const water = grazeSample(deck, -0.05, RHO, DIP, BESTSPOT_SCORING_V1, 0.5);
    expect(water.src).toBe<OccluderSrc>("terrain");
    expect(water.distM).toBe(1700);
    expect(water.q).toBe(0);
    // …and the winning edge is exactly the one `nearestEdgeDeltaDeg` reports the angle of.
    expect(nearestEdgeDeltaDeg(deck, 0.4)).toBeCloseTo(0.02, 12);
    expect(grazeSample(deck, 0.4, RHO, DIP, BESTSPOT_SCORING_V1, 0.5).src).toBe<OccluderSrc>("deck");
  });
});

// ---------------------------------------------------------------------------------------------
// PIN 1 — F2
// ---------------------------------------------------------------------------------------------

describe("PIN 1 — an AIRLESS track is a 2.37-solar-radii lie (F2, would have shipped silently)", () => {
  // A flat OPEN horizon at a 1.7 m pedestrian eye: Hg = the dip, −0.0390°.
  const FLAT_DIP = horizonDipDeg(1.7, K);
  const WINDOW = { topAltDeg: 3, bottomAltDeg: -0.1 };

  function vOverOpenHorizon(airless: boolean, window = WINDOW): number {
    const { track, azs } = makeTrack({ ...window, airless });
    const rays = uniformRays(azs, { groundAltAppDeg: FLAT_DIP, src: "terrain", openSky: true });
    return cellScore(rays, track, OPEN_ACCESS, { ...OPTS, eyeM: 1.7, liftM: 0 }).v;
  }

  it("the caller CONVERTED: an apparent track over a perfect open horizon reaches V ≥ 0.95", () => {
    const v = vOverOpenHorizon(false);
    expect(v).toBeGreaterThanOrEqual(0.95);
    expect(v).toBeCloseTo(0.9566, 3);
    // …and therefore SATURATES the gate. That is what "a perfect horizon" has to mean.
    expect(visibilityGate(v)).toBe(1);
  });

  it("the caller did NOT convert: the same geometry collapses, and G's 0.75 edge becomes unreachable", () => {
    const v = vOverOpenHorizon(true);
    expect(v).toBeLessThan(V_GATE_HI); // 0.75 — a PERFECT open horizon can no longer saturate G
    expect(v).toBeCloseTo(0.7313, 3);
    expect(visibilityGate(v)).toBeLessThan(1);
    // The whole finding in one number: ~0.5° of systematic under-report inside a 0–2° band.
    expect(vOverOpenHorizon(false) - v).toBeGreaterThan(0.2);
    expect(bennettRefractionDeg(0) / RHO).toBeGreaterThan(2); // > 2 solar RADII at the horizon
  });

  it("HONESTY — the spec's own §3.1 window makes V ≈ 0.68 for EVERY ground cell (see report)", () => {
    // `[airless +4° .. 3ρ below the crossing]` = apparent +4.20° .. −1.054°. About a third of the
    // track then sits BELOW the horizon at flat weight (`exp(-max(0,alt)/2.5)` does not decay for
    // alt < 0), so no ground cell can reach 0.95 no matter how clean its horizon is. F2's quoted
    // "0.698 airless symptom" is reproducible here as the APPARENT full-window value.
    const full = { topAltDeg: 4 + bennettRefractionDeg(4), bottomAltDeg: -4 * RHO };
    expect(vOverOpenHorizon(false, full)).toBeCloseTo(0.671, 2);
    expect(vOverOpenHorizon(false, full)).toBeLessThan(V_GATE_HI);
    expect(vOverOpenHorizon(true, full)).toBeCloseTo(0.526, 2);
    // The pin still holds in RELATIVE terms under either window — that is the robust claim.
    expect(vOverOpenHorizon(false, full)).toBeGreaterThan(vOverOpenHorizon(true, full) + 0.13);
  });
});

// ---------------------------------------------------------------------------------------------
// PIN 2 — F_notch
// ---------------------------------------------------------------------------------------------

describe("PIN 2 — F_notch is NOT identically zero", () => {
  /** A rectangular canyon: floor 0°, shoulders 4°, `widthDeg` wide, centred in the swept span. */
  function canyon(azs: number[], widthDeg: number, floorDeg = 0, shoulderDeg = 4): RayEvidence[] {
    const centre = (azs[0] + azs[azs.length - 1]) / 2;
    return azs.map((az) =>
      ray(az, {
        groundAltAppDeg: Math.abs(az - centre) <= widthDeg / 2 - 1e-9 ? floorDeg : shoulderDeg,
        src: "building",
        openSky: false,
        blockerDistM: 1500,
      }),
    );
  }

  const { azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });
  const centreIdx = Math.floor(azs.length / 2);

  it("a 4°-deep canyon crossed at floor + 2ρ scores a REAL notch (not zero, not saturated)", () => {
    const rays = canyon(azs, 1.5);
    const n = notchAt(rays, centreIdx, 0 + 2 * RHO, RHO);
    expect(n.floorDeg).toBe(0);
    expect(n.shoulderLDeg).toBe(4);
    expect(n.shoulderRDeg).toBe(4);
    expect(n.depthDeg).toBe(4);
    expect(n.widthDeg).toBeCloseTo(1.46, 1);
    expect(n.f).toBeGreaterThan(0); // ← the pin's name, and the thing that was identically 0
    expect(n.f).toBeCloseTo(0.3644, 3);
  });

  it("…and a 1.2° canyon clears 0.5 — the width kernel is the only reason 1.5° does not", () => {
    // §10 S1 asserts `> 0.5` for the 1.5° canyon. That is arithmetically impossible under §3.4's
    // own width kernel: `(2° − 1.5°)/(2° − 2ρ)` = 0.5/1.473 = 0.34 before any other factor. The
    // break-even width is 1.264°. Reported as a spec defect; the BAND is pinned here instead.
    expect(notchAt(canyon(azs, 1.2), centreIdx, 2 * RHO, RHO).f).toBeGreaterThan(0.5);
    expect(notchAt(canyon(azs, 1.0), centreIdx, 2 * RHO, RHO).f).toBeCloseTo(0.7039, 3);
    // Monotone in width — narrower gaps frame harder, and 2° stops being a gap at all.
    const widths = [0.8, 1.0, 1.2, 1.5, 1.9].map(
      (w) => notchAt(canyon(azs, w), centreIdx, 2 * RHO, RHO).f,
    );
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
  });

  it("THE DEGENERATE FORM — alt* taken AT the floor makes alt*−floor exactly 0 and F_notch ≡ 0", () => {
    const rays = canyon(azs, 1.2);
    const measured = notchAt(rays, centreIdx, 2 * RHO, RHO);
    expect(measured.f).toBeGreaterThan(0.5);
    // If `alt*` is read off the SKYLINE at az* instead of off the BODY (the pre-correction shape),
    // the clearance gate `[alt* − floor >= ρ]` can never open — for ANY geometry, at every cell on
    // the map. A term that cannot fire is indistinguishable from a term nobody wrote.
    expect(measured.floorDeg - measured.floorDeg).toBe(0);
    expect(notchAt(rays, centreIdx, measured.floorDeg, RHO).f).toBe(0);
    // …and it stays 0 right up to one full disc radius of clearance.
    expect(notchAt(rays, centreIdx, measured.floorDeg + RHO * 0.999, RHO).f).toBe(0);
    expect(notchAt(rays, centreIdx, measured.floorDeg + RHO, RHO).f).toBeGreaterThan(0);
  });

  it("THE FLOOR COMES FROM UNDER THE DISC — az* straddles a flank BY CONSTRUCTION", () => {
    // az* is the last azimuth at which the disc is still half visible, i.e. exactly the azimuth at
    // which it is cut by a wall. Measured: `Hg(az*) = 4°` on this canyon, so the spec's literal
    // `floor = Hg(az*)` gives depth 0 and F_notch = 0 in the composition — while the standalone
    // kernel returns 0.36 for the same geometry. This test fails if that correction is reverted.
    const { track, azs: a } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });
    const rays = canyon(a, 1.5);
    const r = cellScore(rays, track, OPEN_ACCESS, OPTS);
    const starIdx = a.findIndex(
      (_az, i) => Math.abs(track.samples[i].altAppDeg - r.altStarDeg) < 1e-9,
    );
    expect(starIdx).toBeGreaterThan(0);
    expect(rays[starIdx].groundAltAppDeg).toBe(4); // ← az* IS on the wall
    // ← and the notch still fires. S3b, THE NINTH CHANGED ASSERTION (SPEC_V2 §7 forecast this one
    // would survive; measured, it does not): `F` is `max(GRAZE, GAP)` now, and on this canyon the
    // two are 0.29842 and 0.27337 — GRAZE wins, because the disc is cut in HALF by the canyon's own
    // wall edges as it slides across them. The claim the pin exists for is unchanged and is now
    // asserted DIRECTLY on the published `fGap` rather than inferred from the composite.
    expect(r.fGap).toBeCloseTo(0.2734, 3);
    expect(r.fGap).toBeGreaterThan(0.25);
    expect(r.f).toBeCloseTo(0.2984, 3);
    expect(r.f).toBe(Math.max(r.fGraze, r.fGap));
  });

  it("the 0.1° salience floor is honoured — and is DEAD at solar/lunar ρ (see report)", () => {
    // §8: Dnipro's terrain posts at ~145 m effective (the river tile decodes to 29 vertices), so a
    // sub-0.1° dip is a triangle, not a gap. Without the floor the map speckles. The kernel
    // honours it — shown here with a deliberately tiny body so the CLEARANCE gate does not fire
    // first:
    const tiny = 0.02;
    expect(notchAt(canyon(azs, 1.0, 0, 0.05), centreIdx, 2 * tiny, tiny).f).toBe(0);
    expect(notchAt(canyon(azs, 1.0, 0, 0.1), centreIdx, 2 * tiny, tiny).f).toBe(0); // exactly at it
    expect(notchAt(canyon(azs, 1.0, 0, 0.4), centreIdx, 2 * tiny, tiny).f).toBeGreaterThan(0);

    // MEASURED FINDING: for the sun and the moon the floor can never bind. `[alt* − floor >= ρ]`
    // already forces alt* at least 0.245° above the floor, and the width is only bounded when the
    // shoulders stand ABOVE alt* — so any notch that survives the width kernel is ≥ 2.45× deeper
    // than the salience floor. Keep the floor (it is free, and ρ is a body property), but do not
    // believe it is what suppresses terrain speckle at these ρ.
    expect(NOTCH_SALIENCE_DEG).toBeLessThan(RHO);
    expect(notchAt(canyon(azs, 1.0, 0, 0.05), centreIdx, 2 * RHO, RHO).f).toBe(0);
  });

  it("a UNIFORM skyline has no notch at any height, and one flank is a corner not a gap", () => {
    const flat = notchAt(uniformRays(azs, { groundAltAppDeg: 2, openSky: false }), centreIdx, 3, RHO);
    expect(flat.f).toBe(0);
    // An "unbounded gap" is open sky, not a frame — and it must report Infinity rather than a
    // wrapped azimuth measure, which on a wide sweep could fold back into a small (firing) width.
    expect(flat.widthDeg).toBe(Infinity);
    expect(notchAt(canyon(azs, 10), centreIdx, 2 * RHO, RHO).widthDeg).toBe(Infinity);
    // One tall flank only: min(sL, sR) = the low side ⇒ depth ≈ 0.
    const centre = (azs[0] + azs[azs.length - 1]) / 2;
    const oneSided = azs.map((az) =>
      ray(az, { groundAltAppDeg: az < centre - 0.6 ? 4 : 0, openSky: false, src: "building" }),
    );
    expect(notchAt(oneSided, centreIdx, 2 * RHO, RHO).f).toBe(0);
  });

  it("an UNSAMPLED shoulder is not a notch (ignorance is not depth)", () => {
    // The right shoulder window is `[az* + ρ, az* + 3°]` = index offsets 6…60 at the 0.05° step.
    const rays = canyon(azs, 1.0).map((r, i) =>
      i >= centreIdx + 6 ? { ...r, known: 0 as const } : r,
    );
    const n = notchAt(rays, centreIdx, 2 * RHO, RHO);
    expect(n.shoulderRDeg).toBe(-Infinity);
    expect(n.f).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// PIN 3 — F3, the owner's hero case
// ---------------------------------------------------------------------------------------------

describe("PIN 3 — a deck is NOT a wall (F3; the owner's hero location IS a bridge deck)", () => {
  const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });

  /** A: sky under the bridge. The river horizon is at −0.04°; the deck floats at [0.31, 0.38]°
   *  — a 10 m deck 1.5 km away, measured on the Central Bridge in Dnipro (F3).
   *
   *  THE PROVENANCE IS SPELLED OUT PER CHANNEL because LENS B caught this fixture hand-writing
   *  `src: "deck"` on a ray the producer could not emit: `localDsm` keeps floating solids out of the
   *  surface, so the GROUND channel of a real deck ray reports the water/far bank as `"terrain"` and
   *  only `bandSrc` can say "deck". The headline `src`/`blockerDistM` are then §3.2's nearest rule —
   *  the deck at 1500 m beats the bank at 1700 m — which is exactly what `horizonSweep.rayEvidenceAt`
   *  now emits for this geometry. */
  const DECK = uniformRays(azs, {
    groundAltAppDeg: -0.04,
    groundSrc: "terrain",
    groundDistM: 1700,
    bands: [[0.31, 0.38]],
    bandSrc: ["deck"],
    bandDistM: [1500],
    src: "deck",
    blockerDistM: 1500,
    openSky: false,
  });

  /** B: the blank 15-storey wall — the SAME top edge, no sky under it. */
  const WALL = uniformRays(azs, {
    groundAltAppDeg: 0.38,
    groundSrc: "building",
    groundDistM: 1500,
    src: "building",
    blockerDistM: 1500,
    openSky: false,
  });

  it("the bridge deck scores STRICTLY HIGHER than the wall with the same top edge", () => {
    const a = cellScore(DECK, track, OPEN_ACCESS, OPTS);
    const b = cellScore(WALL, track, OPEN_ACCESS, OPTS);
    expect(a.verdict).toBe("scored");
    expect(b.verdict).toBe("scored");
    expect(a.score).toBeGreaterThan(b.score);
    // …and by a margin that survives a weight tweak, not by 1e-9. Measured: 0.905 vs 0.875, a
    // 3.4 % relative lead for the deck over the wall that shares its top edge.
    expect(a.score - b.score).toBeGreaterThan(0.025);
    // S3b: 0.0299 → 0.03575. The `> 0.025` guard above SURVIVES — only the pinned literal moved,
    // and it moved UP: under GRAZE the deck's two band edges out-dwell the wall's single crossing
    // (τ 0.9407 against 0.8830), where the shipped kernel gave both of them the same saturated F.
    expect(a.score - b.score).toBeCloseTo(0.0357, 3);
    // The two channels that carry it: the body is visible far longer, and it reaches the WATER.
    expect(a.v).toBeGreaterThan(b.v + 0.15);
    expect(a.altStarDeg).toBeLessThan(b.altStarDeg);
    expect(a.altStarDeg).toBeCloseTo(-0.04, 2);
    expect(b.altStarDeg).toBeCloseTo(0.38, 2);
    // Both are BUILT and both are 1.5 km out, so F and P cannot be what separates them.
    expect(a.p).toBeCloseTo(b.p, 12);
    expect(a.srcStar).toBe<OccluderSrc>("deck");
    expect(b.srcStar).toBe<OccluderSrc>("building");
  });

  it("MAX-ONLY: folding the band into the ground horizon makes the deck and the wall ONE object", () => {
    // This is F3 verbatim. A per-bin MAX declares everything below 0.382° blocked, so "the sun
    // setting behind the bridge" and "a blank 15-storey wall" become byte-identical inputs — and
    // the wall then outscores an open river horizon. Reverting the band channel makes this pass
    // with `toEqual` and the test above go red, which is exactly the alarm we want.
    const maxOnly = uniformRays(azs, {
      groundAltAppDeg: 0.38, // max(−0.04, hi of [0.31, 0.38])
      src: "deck",
      blockerDistM: 1500,
      openSky: false,
    });
    const collapsed = cellScore(maxOnly, track, OPEN_ACCESS, OPTS);
    const wall = cellScore(WALL, track, OPEN_ACCESS, OPTS);
    expect(collapsed.score).toBeCloseTo(wall.score, 12);
    expect(collapsed.v).toBeCloseTo(wall.v, 12);
    expect(collapsed.altStarDeg).toBeCloseTo(wall.altStarDeg, 12);
    // …and the real deck beats its own max-only collapse — the information the max threw away.
    expect(cellScore(DECK, track, OPEN_ACCESS, OPTS).score).toBeGreaterThan(collapsed.score);
  });
});

// ---------------------------------------------------------------------------------------------
// PIN 4 — honesty
// ---------------------------------------------------------------------------------------------

describe("PIN 4 — ignorance is NOT clear sky", () => {
  const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });
  const FLAT_DIP = horizonDipDeg(1.7, K);

  /** Perfect open horizon, but the last `frac` of the swept azimuths were never sampled. The
   *  shipped convention is that an unsampled bin REPORTS THE OPEN-SKY FLOOR with `known = 0`
   *  (`createProfile` fills `altDeg` with `openSkyAltDeg`), so a consumer that reads the value and
   *  ignores the flag converts ignorance into the best possible score. */
  function partial(frac: number): RayEvidence[] {
    const cut = Math.floor(azs.length * (1 - frac));
    return azs.map((az, i) =>
      ray(az, { groundAltAppDeg: FLAT_DIP, known: i < cut ? 1 : 0, openSky: true }),
    );
  }

  it("the last 40 % of the azimuths unsampled ⇒ verdict UNKNOWN, never a number", () => {
    const r = cellScore(partial(0.4), track, OPEN_ACCESS, OPTS);
    expect(r.verdict).toBe("unknown");
    expect(r.c).toBeLessThan(OPTS.scoring.gates.minCoverage);
    // …and it is the WEIGHTING that makes 40 % of the azimuths more than 50 % of the evidence:
    // `exp(-max(0,alt)/2.5°)` puts the mass at the bottom of the track, which is exactly the part
    // an unswept far-side azimuth removes. C over the FULL swept span, not ±3° around contact.
    expect(r.c).toBeCloseTo(0.45, 2);
  });

  it("the unknown samples are dropped from BOTH sums of V — 60 % coverage ≠ V = 0.6", () => {
    const r = cellScore(partial(0.4), track, OPEN_ACCESS, OPTS);
    // Perfect visibility across everything that WAS sampled. The naive form (unknown scored as
    // f = 0, i.e. left in the denominator) reads 0.45 here; the "reports open sky" form reads 1
    // and calls the cell excellent. Both are lies; only the drop is honest.
    expect(r.v).toBeCloseTo(1, 6);
    expect(r.v).not.toBeCloseTo(r.c, 2);
  });

  it("exactly at the floor the cell is scored again — the gate is a threshold, not a mood", () => {
    // Coverage is a continuous channel: nudge the unswept fraction down until C crosses 0.5.
    const scored = cellScore(partial(0.3), track, OPEN_ACCESS, OPTS);
    expect(scored.c).toBeGreaterThanOrEqual(OPTS.scoring.gates.minCoverage);
    expect(scored.verdict).toBe("scored");
    expect(scored.v).toBeCloseTo(1, 6);
    expect(scored.score).toBeGreaterThan(0);
    // A fully-swept twin of the same geometry is the positive control.
    const full = cellScore(
      uniformRays(azs, { groundAltAppDeg: FLAT_DIP, openSky: true }),
      track,
      OPEN_ACCESS,
      OPTS,
    );
    expect(full.c).toBe(1);
    expect(full.verdict).toBe("scored");
  });

  it("UNKNOWN is a render CLASS: the preference terms are not evaluated, and score is not a rank", () => {
    const r = cellScore(partial(0.6), track, OPEN_ACCESS, OPTS);
    expect(r.verdict).toBe("unknown");
    expect(r.l).toBe(0);
    expect(r.p).toBe(0);
    expect(r.f).toBe(0);
    // The coverage channel still reports the truth at any value — the panel prints "% UNMAPPED".
    expect(r.c).toBeGreaterThan(0);
    expect(r.c).toBeLessThan(OPTS.scoring.gates.minCoverage);
  });
});

// ---------------------------------------------------------------------------------------------
// PIN 5 — lift
// ---------------------------------------------------------------------------------------------

describe("PIN 5 — lift is monotone, and L is DIP-normalised", () => {
  const LIFTS = [1.7, 100, 400, 2000];

  it("the dip anchors are the spec's own numbers", () => {
    expect(horizonDipDeg(1.7, K)).toBeCloseTo(-0.039, 3);
    expect(horizonDipDeg(100, K)).toBeCloseTo(-0.299, 3);
    expect(horizonDipDeg(400, K)).toBeCloseTo(-0.599, 3);
    expect(horizonDipDeg(2000, K)).toBeCloseTo(-1.339, 3);
  });

  it("S is NON-DECREASING across 1.7 / 100 / 400 / 2000 m for ONE re-swept skyline", () => {
    // The window must reach BELOW the deepest dip (−1.339° at 2000 m), otherwise `alt*` is pinned
    // at the track's floor while the anchor keeps sinking and L falls at altitude. §3.1's lower
    // extension exists for exactly this — see the reported defect on its fixed 3ρ size.
    const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -1.75 });
    const scores: number[] = [];
    const ls: number[] = [];
    const vs: number[] = [];
    for (const eyeM of LIFTS) {
      const rays = sweepRidge(azs, { distM: 3000, heightM: 92, eyeM });
      const r = cellScore(rays, track, OPEN_ACCESS, {
        ...OPTS,
        eyeM: 1.7,
        liftM: eyeM - 1.7,
      });
      expect(r.verdict).toBe("scored");
      scores.push(r.score);
      ls.push(r.l);
      vs.push(r.v);
    }
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      expect(ls[i]).toBeGreaterThanOrEqual(ls[i - 1] - 1e-12);
      expect(vs[i]).toBeGreaterThanOrEqual(vs[i - 1] - 1e-12);
    }
    // Not a degenerate pass — the climb has to actually buy something.
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0] + 0.1);
  });

  it("THE ANCHOR — a 2000 m sheet reading alt* = 0 must NOT report L = 1", () => {
    // With `dipFloor = horizonDipDeg(eye + lift)` the whole [dip, 0] band still ranks: at 2000 m
    // that band is 1.339° wide and a cell that only reaches alt* = 0 is 0.115 of L worse than one
    // that reaches its own horizon. A FIXED 0 ANCHOR returns exactly 1 for both and the altitude
    // slider stops discriminating. This assertion is the difference.
    const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -1.75 });
    const rays = uniformRays(azs, {
      groundAltAppDeg: 0,
      src: "terrain",
      openSky: false,
      blockerDistM: 3000,
    });
    const r = cellScore(rays, track, OPEN_ACCESS, { ...OPTS, eyeM: 1.7, liftM: 1998.3 });
    expect(r.altStarDeg).toBeCloseTo(0, 2);
    expect(r.l).toBeLessThan(0.9); // ← a fixed 0 anchor gives EXACTLY 1 here
    expect(r.l).toBeCloseTo(contactLowness(r.altStarDeg, horizonDipDeg(2000, K)), 6);
    expect(r.l).toBeCloseTo(0.885, 2);
  });

  it("…and at 1.7 m the two anchors agree to 2e-4, which is why this only bites the slider", () => {
    const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -1.75 });
    const rays = uniformRays(azs, {
      groundAltAppDeg: 0,
      src: "terrain",
      openSky: false,
      blockerDistM: 3000,
    });
    const r = cellScore(rays, track, OPEN_ACCESS, { ...OPTS, eyeM: 1.7, liftM: 0 });
    expect(r.l).toBeCloseTo(1, 3);
    expect(1 - r.l).toBeLessThan(2e-3);
  });

  it("L reaches exactly 1 at the cell's OWN horizon and 0 above the 5° ceiling", () => {
    expect(contactLowness(horizonDipDeg(400, K), horizonDipDeg(400, K))).toBe(1);
    expect(contactLowness(-2, horizonDipDeg(400, K))).toBe(1); // a bluff looks further DOWN
    expect(contactLowness(5, horizonDipDeg(400, K))).toBe(0);
    expect(contactLowness(9, horizonDipDeg(1.7, K))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// §3.5 — composition
// ---------------------------------------------------------------------------------------------

describe("bestSpotMetric §3.5 — gates MULTIPLY, preferences SUM", () => {
  const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });
  const GOOD = uniformRays(azs, { groundAltAppDeg: horizonDipDeg(1.7, K), openSky: true });

  it("A_hard multiplies: standing in the Dnipro is not a spot at ANY framing score", () => {
    const wet: CellAccess = { hard: 0, soft: 1, cls: "water", groundReachable: false };
    expect(cellScore(GOOD, track, wet, OPTS).score).toBe(0);
    // …but the cell is still SCORED, not UNKNOWN — we know exactly why it is bad.
    expect(cellScore(GOOD, track, wet, OPTS).verdict).toBe("scored");
    expect(cellScore(GOOD, track, wet, OPTS).v).toBeGreaterThan(0.9);
  });

  it("A_soft enters as a SQUARE ROOT — landcover penalises, it does not decide", () => {
    const base = cellScore(GOOD, track, OPEN_ACCESS, OPTS).score;
    const unknownLand: CellAccess = { hard: 1, soft: 0.45, cls: "unknown", groundReachable: true };
    const got = cellScore(GOOD, track, unknownLand, OPTS).score;
    expect(got).toBeCloseTo(base * Math.sqrt(0.45), 12);
    // 36.1 % of a dense Dnipro box is UNKNOWN landcover (measured, 600 m @ 1 m): raw multiplication
    // at 0.45 makes the map read as a landcover map; ^0.5 gives 0.67, a real but survivable dent.
    expect(Math.sqrt(0.45)).toBeCloseTo(0.67, 2);
  });

  it("M (track.worth) multiplies THROUGH R7's floor — a 9 %-lit quarter moon still ranks low", () => {
    // OWNER RULING R7 (`BESTSPOT_PLAN.md:29`), the one deliberate behaviour change of S3a. `M` still
    // MULTIPLIES — but through `M_eff = effectiveFloor + (1 − effectiveFloor)·M`, because raw it made
    // the moon map black ~26 nights in 30 (measured: worth median 0.0290 over 30 days at Dnipro, so
    // the best possible cell scored ~0.020, 25× under the sheet's legibility floor).
    //
    // BEFORE this line asserted `full * 0.09`. It now asserts `full * 0.4085` — a bad night DIMS
    // instead of VANISHING. The ordering claim the pin exists for is unchanged and asserted below.
    const quarter: EventTrack = { ...track, kind: "moonrise", worth: 0.09 };
    const full = cellScore(GOOD, track, OPEN_ACCESS, OPTS).score;
    const ef = BESTSPOT_SCORING_V1.worth.effectiveFloor;
    expect(ef).toBe(0.35);
    expect(cellScore(GOOD, quarter, OPEN_ACCESS, OPTS).score).toBeCloseTo(
      full * (ef + (1 - ef) * 0.09),
      12,
    );
    // …and it is still a real penalty, not a rounding: 0.4085 of the full-moon score.
    expect(cellScore(GOOD, quarter, OPEN_ACCESS, OPTS).score).toBeLessThan(full * 0.42);
    expect(cellScore(GOOD, quarter, OPEN_ACCESS, OPTS).score).toBeGreaterThan(full * 0.4);

    // THE INVARIANT THAT MAKES R7 SAFE: a sun kind carries `worth = 1`, and `0.35 + 0.65·1` is
    // EXACTLY 1 in IEEE doubles — so not one sun number anywhere in this suite moved.
    expect(ef + (1 - ef) * 1).toBe(1);
    const sun: EventTrack = { ...track, worth: 1 };
    expect(cellScore(GOOD, sun, OPEN_ACCESS, OPTS).score).toBe(full);
  });

  it("R7's `badge` mode takes M out of the per-cell product entirely (§8 Q1 option c)", () => {
    const quarter: EventTrack = { ...track, kind: "moonrise", worth: 0.09 };
    const badge = resolveScoring({ worth: { mode: "badge" } });
    const full = cellScore(GOOD, track, OPEN_ACCESS, OPTS).score;
    expect(cellScore(GOOD, quarter, OPEN_ACCESS, { ...OPTS, scoring: badge }).score).toBe(full);
  });

  it("G(V) multiplies but is SOFT — a heavily occulted cell is damped, not deleted", () => {
    const half = uniformRays(azs, {
      groundAltAppDeg: 1.4,
      src: "building",
      openSky: false,
      blockerDistM: 1500,
    });
    const r = cellScore(half, track, OPEN_ACCESS, OPTS);
    expect(r.v).toBeGreaterThan(0);
    expect(r.v).toBeLessThan(V_GATE_HI);
    expect(r.score).toBeGreaterThan(0); // a silhouette shot survives the gate
    expect(r.score).toBeLessThan(cellScore(GOOD, track, OPEN_ACCESS, OPTS).score);
  });

  it("the preference weights are NORMALISED — a non-normalised blend cannot inflate S past 1", () => {
    expect(BESTSPOT_WEIGHTS.v + BESTSPOT_WEIGHTS.l + BESTSPOT_WEIGHTS.p + BESTSPOT_WEIGHTS.f)
      .toBeCloseTo(1, 12);
    // S3a: the weights moved from `CellScoreOptions` into the scoring PROFILE (they are taste, not
    // situation), so the override now goes through `resolveScoring` — which is also the path the
    // hot-swap seam uses, so this pin now exercises the real one.
    const doubled = cellScore(GOOD, track, OPEN_ACCESS, {
      ...OPTS,
      scoring: resolveScoring({ weights: { v: 0.3, l: 0.6, p: 0.5, f: 0.6 } }), // the blend ×2
    });
    expect(doubled.score).toBeCloseTo(cellScore(GOOD, track, OPEN_ACCESS, OPTS).score, 12);
    expect(doubled.score).toBeLessThanOrEqual(1);
  });

  it("a clean far horizon and a bridge silhouette are BOTH good — L, P, F sum, they do not gate", () => {
    // §3.5: multiplying these would zero the clean-horizon case the owner explicitly listed as
    // good (F = 0 there), and zero the silhouette case (P < 1, V occulted).
    const clean = cellScore(GOOD, track, OPEN_ACCESS, OPTS);
    expect(clean.f).toBe(0);
    expect(clean.p).toBe(1);
    expect(clean.score).toBeGreaterThan(0.5);

    // FIXTURE REPAIRED (S3b). As written this fixture had `bands: [[0.31, 0.38]]` with NO
    // `bandSrc`/`bandDistM`, and the `ray()` helper above then silently retagged the GROUND edge as
    // `"deck"` (`if (o.src !== undefined && o.groundSrc === undefined) merged.groundSrc = o.src`).
    // So it described a ray no producer can emit: a water horizon labelled `deck` under an untagged
    // slab. Measured against the repaired kernel it scored `f = 0` — the band edges are `none`
    // (conf 0) and the ground edge has no relief. Spelled out per channel now, exactly like PIN 3.
    const bridge = cellScore(
      uniformRays(azs, {
        groundAltAppDeg: -0.04,
        groundSrc: "terrain",
        groundDistM: 1700,
        bands: [[0.31, 0.38]],
        bandSrc: ["deck"],
        bandDistM: [1500],
        src: "deck",
        blockerDistM: 1500,
        openSky: false,
      }),
      track,
      OPEN_ACCESS,
      OPTS,
    );
    // S3b: `> 0.8` → `> 0.4` (measured 0.41582). The shipped kernel returned 0.8465 for ANY built
    // edge the body's centre crossed, which is precisely the saturation R5 removed.
    expect(bridge.f).toBeGreaterThan(0.4);
    expect(bridge.f).toBeCloseTo(0.4158, 4);
    expect(bridge.p).toBeLessThan(1);
    expect(bridge.score).toBeGreaterThan(0.5);
  });

  it("a RISE track (altitude ascending) resolves the same alt* as its mirrored SET twin", () => {
    // `alt*` is "the LOWEST apparent centre altitude at which the disc is still ≥50 % visible"
    // (`CellScore.altStarDeg`), which is direction-agnostic. §3.4's literal "the LARGEST a with
    // f >= 0.5" silently assumes a northern-hemisphere SET; reported as a spec defect.
    const set = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });
    const rise: EventTrack = {
      ...set.track,
      kind: "moonrise",
      samples: [...set.track.samples]
        .reverse()
        .map((s, i) => ({ ...s, azDeg: set.azs[i], utcMs: set.track.t0Ms + i * 60_000 })),
    };
    const skyline = { groundAltAppDeg: 0.6, src: "building" as const, openSky: false, blockerDistM: 900 };
    const a = cellScore(uniformRays(set.azs, skyline), set.track, OPEN_ACCESS, OPTS);
    const b = cellScore(uniformRays(set.azs, skyline), rise, OPEN_ACCESS, OPTS);
    expect(b.altStarDeg).toBeCloseTo(a.altStarDeg, 6);
    expect(b.l).toBeCloseTo(a.l, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
  });

  it("a total blackout scores 0 without inventing a contact altitude", () => {
    const walled = uniformRays(azs, {
      groundAltAppDeg: 30,
      src: "building",
      openSky: false,
      blockerDistM: 20,
    });
    const r = cellScore(walled, track, OPEN_ACCESS, OPTS);
    expect(r.v).toBe(0);
    expect(r.score).toBe(0);
    expect(r.l).toBe(0);
    expect(r.srcStar).toBe<OccluderSrc>("none");
    expect(r.altStarDeg).toBeCloseTo(3, 6); // the track's ceiling — "never clears", not a fake number
  });

  it("the rays and the track share ONE azimuth index — a mismatch throws, never scores", () => {
    expect(() => cellScore(GOOD.slice(0, 5), track, OPEN_ACCESS, OPTS)).toThrow(/azimuth index/);
  });
});

// ---------------------------------------------------------------------------------------------
// The tuning cross-check — a drift in either direction must be RED, not silent
// ---------------------------------------------------------------------------------------------

describe("bestSpotMetric — the module is WORKER-CLEAN", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "..", "src", "lib", "geo", "bestSpotMetric.ts"),
    "utf8",
  );
  // Comments are stripped first: the file's own docstring NAMES the banned APIs (that is the
  // point of the docstring), and a fence that a comment can trip is a fence people delete.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("no three, no store, no DOM, no wall clock — §5 runs this inside a long-lived module worker", () => {
    // The one shipped worker in this repo is single-shot-and-terminate; this kernel is the first
    // thing to live inside a long-lived one, so "it happens to work on the main thread" is not
    // evidence. A static fence is: `three` alone would drag WebGL into the worker bundle, and a
    // `Date.now()` would make the score depend on when it was asked rather than on the scrubber.
    expect(code).not.toMatch(/from ["'](three|zustand)/);
    expect(code).not.toMatch(/\/store\//);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/\b(document|window|localStorage|requestAnimationFrame)\b/);
  });

  it("its only cross-module edges are horizonProfile, the shared contract and the profile", () => {
    const specifiers = [...source.matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)].map((m) => m[1]);
    // `./bestSpotScoring` joined the list in S3a. It is a PURE SIBLING LIB with zero imports of its
    // own except `import type` — so the kernel is still three-free, store-free, DOM-free and
    // clock-free, and the worker bundle still gains no `components/` edge. The point of this
    // assertion is that the list stays SHORT and every entry is deliberate, not that it is frozen:
    // if a fourth specifier appears, someone must come here and justify it.
    expect([...new Set(specifiers)].sort()).toEqual([
      "./bestSpotScoring",
      "./bestSpotTypes",
      "./horizonProfile",
    ]);
  });
});

describe("bestSpotMetric — the kernel defaults still agree with the shipped planner", () => {
  it("refraction k, trust radius and the coverage floor mirror tuning.ts PLAN.*", async () => {
    const { PLAN } = await import("../../../src/components/globe/tuning");
    // S1a keeps these as explicit parameters (a pure lib, testable from a fixture), so nothing
    // enforces the agreement at compile time. This test is that enforcement: if the planner's
    // refraction or trust radius moves, the worker's kernel must move with it or say why.
    expect(BESTSPOT_METRIC_DEFAULTS.refractionK).toBe(PLAN.refractionK);
    // S3a: the trust radius and the coverage floor are TASTE and moved into the scoring profile;
    // `refractionK` is BESTSPOT_PHYSICS and stayed on the SITUATION half. The cross-check is the
    // same check, one level deeper.
    expect(BESTSPOT_METRIC_DEFAULTS.scoring.curves.depthTrustRadiusM).toBe(PLAN.trustRadiusM);
    expect(BESTSPOT_METRIC_DEFAULTS.scoring.gates.minCoverage).toBe(PLAN.minCoverageForGaps);
    expect(K).toBe(PLAN.refractionK);
  });
});

// ---------------------------------------------------------------------------------------------
// MEASURED (LENS B, 2026-08-24) — F_sil was very nearly a copy of P. GRAZE fixed it (S3b).
// ---------------------------------------------------------------------------------------------

/**
 * **INVERTED IN S3b. This describe used to be a BASELINE and is now a REGRESSION GUARD.**
 *
 * The finding it recorded: `F_sil = (1 − clamp01(|altApp − edge|/ρ)) · P` reached its ceiling for ANY
 * built skyline whose edge the body's centre crossed — which, over a track descending through the
 * whole 0–3° band, is essentially every built cell in a city. What was left after the kernel
 * saturated was `P`, so the 0.30-weighted FRAMING term reproduced the 0.25-weighted DEPTH term and
 * 0.55 of the preference weight rode on one signal: distance.
 *
 * THE RECORDED BEFORE, on this exact 66-cell fixture: `F ∈ [0.1993, 0.9976]`, `F/P ∈ [0.936, 0.998]`,
 * ratio spread **0.0619**, `corr(F, P)` **0.9985** — r² 0.997.
 *
 * THE MEASURED AFTER, same fixture, GRAZE: `F ∈ [0.0038, 0.4479]`, `F/P ∈ [0.0179, 0.5580]`, ratio
 * spread **0.5401**, `corr(F, P)` **0.6268** — r² 0.393. (SPEC_V2 §1.1's independent forecast for
 * the same three numbers: 0.0171, 0.5408, 0.6260.) The assertions below are the OLD ones with their
 * inequalities turned around, so a regression to a saturating kernel goes red here first.
 */
describe("bestSpotMetric — GRAZE: F carries ranking signal P does not (was: F ≈ P, r² 0.997)", () => {
  const { track, azs } = makeTrack({ topAltDeg: 3, bottomAltDeg: -0.1 });

  /** Pearson correlation — written out so the r² claim stands on arithmetic this file can be read
   *  to verify rather than on a library. */
  function correlation(a: readonly number[], b: readonly number[]): number {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
  }

  it("across a 66-cell city fixture F/P now SPREADS by 0.54 and corr(F,P) falls to 0.63", () => {
    const ratios: number[] = [];
    const fs: number[] = [];
    const ps: number[] = [];
    // Skylines spanning the whole band the track crosses, at distances from a courtyard wall to the
    // trust radius: 11 heights × 6 distances. Unchanged from the baseline, deliberately.
    for (const heightDeg of [0.05, 0.1, 0.2, 0.4, 0.6, 0.9, 1.2, 1.6, 2.0, 2.5, 2.9]) {
      for (const distM of [80, 200, 400, 800, 1500, 3000]) {
        const rays = uniformRays(azs, {
          groundAltAppDeg: heightDeg,
          groundSrc: "building",
          groundDistM: distM,
          openSky: false,
        });
        const r = cellScore(rays, track, OPEN_ACCESS, OPTS);
        const p = depthTerm(rays[0], OPTS.scoring.curves.depthTrustRadiusM);
        fs.push(r.f);
        ps.push(p);
        ratios.push(r.f / p);
      }
    }
    expect(ratios).toHaveLength(66);
    // F no longer spans "nearly its whole range on every cell": a 0.05° kerb 3 km out is 0.0038 and
    // a 2.9° tower block 80 m away is 0.1184 — two cells the old kernel could not tell apart.
    expect(Math.min(...fs)).toBeCloseTo(0.0038, 4);
    expect(Math.max(...fs)).toBeCloseTo(0.4479, 4);
    expect(Math.min(...ps)).toBeCloseTo(0.213, 3);
    expect(Math.max(...ps)).toBeCloseTo(1, 6);
    // THE INVERSION. Was: `min ratio > 0.93`, `max − min < 0.065`.
    expect(Math.min(...ratios)).toBeCloseTo(0.0179, 4);
    expect(Math.max(...ratios)).toBeCloseTo(0.558, 4);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.3);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeCloseTo(0.5401, 4);
    // …and the correlation, which is the claim that actually matters for ranking. Was 0.9985.
    expect(correlation(fs, ps)).toBeLessThan(0.8);
    expect(correlation(fs, ps)).toBeCloseTo(0.6268, 4);
  });

  it("…so the DECK and the WALL — the two objects F3 exists to separate — now get DIFFERENT F", () => {
    // The PIN 3 pair, rebuilt here so this finding stands on its own fixture.
    const deck = uniformRays(azs, {
      groundAltAppDeg: -0.04,
      groundSrc: "terrain",
      groundDistM: 1700,
      bands: [[0.31, 0.38]],
      bandSrc: ["deck"],
      bandDistM: [1500],
      src: "deck",
      blockerDistM: 1500,
      openSky: false,
    });
    const wall = uniformRays(azs, {
      groundAltAppDeg: 0.38,
      groundSrc: "building",
      groundDistM: 1500,
      openSky: false,
    });
    // WAS: 0.8465 for both, to the last bit — `expect(wallF).toBeCloseTo(deckF, 15)`. The deck was
    // still ranked higher overall, but by `V` and by `alt*` (PIN 3), NOT by the term named FRAMING.
    // NOW the deck wins on FRAMING too: two band edges to dwell on against the wall's one crossing.
    const deckF = cellScore(deck, track, OPEN_ACCESS, OPTS).f;
    const wallF = cellScore(wall, track, OPEN_ACCESS, OPTS).f;
    expect(deckF).toBeCloseTo(0.4158, 4);
    expect(wallF).toBeCloseTo(0.3962, 4);
    expect(deckF).toBeGreaterThan(wallF);
  });
});
