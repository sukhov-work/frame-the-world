/**
 * BEST SPOT — the EVENT TRACK (`BESTSPOT_PLAN.md` §3.1, slice S1b).
 *
 * Every test here is written to FAIL against the naive form of the thing it pins. The plan's own
 * build rule (§10) is "each done-check must be able to FAIL — this repo has been bitten five times
 * by checks that could not", so the test names carry the BUG CLASS, not the method name.
 *
 * The five mandated pins live in the `PIN a` … `PIN e` titles; the rest guard the window geometry,
 * the weights and the shipped-face fences the track is built on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Body, Equator, Horizon, Observer } from "astronomy-engine";
import {
  apparentAltDeg,
  eventInstantMs,
  eventTrack,
  moonWorth,
  trackWeightShape,
  twilightGate,
  unwrapTrackAzDeg,
} from "../../../src/lib/geo/bestSpotTrack";
import { bodyStatesAt, horizontal } from "../../../src/lib/ephemeris/bodies";
import { localDayWindow } from "../../../src/lib/ephemeris/dayArc";
import { moonPhaseIntensity } from "../../../src/lib/ephemeris/moonlight";
import type { PlanObserver } from "../../../src/lib/ephemeris/planner";
import { sunAltDeg } from "../../../src/lib/ephemeris/twilight";
import type {
  BestSpotKind,
  CellAccess,
  EventTrack,
  RayEvidence,
} from "../../../src/lib/geo/bestSpotTypes";
// LENS B: the consumer of the track. Imported so the S1 acceptance number (`V ≥ 0.95` over a
// perfect open horizon) can be measured on the track this module ACTUALLY emits, rather than on a
// synthetic one whose window happens to stop at the horizon.
import {
  BESTSPOT_METRIC_DEFAULTS,
  cellScore,
  visibilityGate,
} from "../../../src/lib/geo/bestSpotMetric";
import { horizonDipDeg } from "../../../src/lib/geo/horizonProfile";

const DAY_MS = 86_400_000;
const KINDS: readonly BestSpotKind[] = ["sunrise", "sunset", "moonrise", "moonset"];

/** The house Dnipro fixture, byte-identical to `planner.test.ts:23-28` so the refraction pins in
 *  this file and the shipped ones there are talking about the same observer. */
const DNIPRO: PlanObserver = {
  latDeg: 48.4647,
  lonDeg: 35.0462,
  groundAltM: 100,
  eyeAboveGroundM: 2,
};
/** Same place at the SEA-LEVEL datum with a zero eye — the only configuration in which
 *  `bodies.horizontal()` (which pins `Observer` height to 0) is exactly comparable. */
const DNIPRO_SEA: PlanObserver = { ...DNIPRO, groundAltM: 0, eyeAboveGroundM: 0 };

const REYKJAVIK: PlanObserver = {
  latDeg: 64.1466,
  lonDeg: -21.9426,
  groundAltM: 0,
  eyeAboveGroundM: 1.7,
};
const TROMSO: PlanObserver = { latDeg: 69.6492, lonDeg: 18.9553, groundAltM: 0, eyeAboveGroundM: 1.7 };
const SYDNEY: PlanObserver = {
  latDeg: -33.8688,
  lonDeg: 151.2093,
  groundAltM: 0,
  eyeAboveGroundM: 1.7,
};

/** A quiet late-August day at Dnipro — all four kinds exist. */
const AUG_MS = Date.UTC(2026, 7, 24, 12);
/** A local solar day at Dnipro with NO moonrise — the first of 2026's 13 skips (measured). The
 *  local day runs 2026-01-09T22:00Z → 2026-01-10T22:00Z, so the probe instant is inside it. */
const SKIPPED_MOONRISE_MS = Date.parse("2026-01-10T12:00:00Z");

const bodyOf = (k: BestSpotKind) => (k === "sunrise" || k === "sunset" ? "sun" : "moon");

/** Strictly-ascending check on the UNWRAPPED azimuths (the 0°/360° seam is real — see PIN c). */
function assertAzimuthStrictlyAscending(track: EventTrack): number[] {
  const u = unwrapTrackAzDeg(track.samples);
  for (let i = 1; i < u.length; i++) {
    expect(
      u[i] > u[i - 1],
      `azimuth folded back at sample ${i}: ${u[i - 1]} → ${u[i]}`,
    ).toBe(true);
  }
  return u;
}

/** Strict monotonicity of the APPARENT altitude, direction inferred from the first pair. */
function assertAltitudeStrictlyMonotone(track: EventTrack): void {
  const s = track.samples;
  const rising = s[1].altAppDeg > s[0].altAppDeg;
  for (let i = 1; i < s.length; i++) {
    const ok = rising ? s[i].altAppDeg > s[i - 1].altAppDeg : s[i].altAppDeg < s[i - 1].altAppDeg;
    expect(
      ok,
      `altitude folded back at sample ${i}: ${s[i - 1].altAppDeg} → ${s[i].altAppDeg}`,
    ).toBe(true);
  }
}

// =================================================================================================
// F2 — the refraction conversion
// =================================================================================================

describe("apparentAltDeg — plan F2: mixing AIRLESS and APPARENT is a 2.37-solar-radii lie", () => {
  it("F2 — airless −0.87° reads APPARENT −0.245°: the 0.6243° lift the naive comparison silently drops", () => {
    const lift = apparentAltDeg(-0.87) - -0.87;
    // The plan's own F2 figure, reproduced from the library rather than quoted.
    expect(lift).toBeCloseTo(0.6243, 3);
    expect(apparentAltDeg(-0.87)).toBeCloseTo(-0.2455, 4);
    // The naive form (`altApp = altAirless`) would leave the input untouched. That is the bug.
    expect(Math.abs(apparentAltDeg(-0.87) - -0.87)).toBeGreaterThan(0.6);
    // 0.6243° against a solar radius of ~0.2634° — 2.37 disc radii, in a 0–2° feature.
    expect(lift / 0.2634).toBeCloseTo(2.37, 1);
  });

  it("F2 — is astronomy-engine's OWN Refraction, not a second convention: matches Horizon(…, \"normal\") to 1e-12", () => {
    // A hand-rolled Bennett/Saemundsson would agree to a few arcseconds and disagree here. Two
    // refraction implementations = two conventions, which is this repo's costliest bug class.
    const obs = new Observer(DNIPRO.latDeg, DNIPRO.lonDeg, 0);
    for (const offsetMin of [-40, -20, 0, 20, 40]) {
      const when = new Date(Date.UTC(2026, 7, 24, 16, 38) + offsetMin * 60_000);
      const eq = Equator(Body.Sun, when, obs, true, true);
      const airless = Horizon(when, obs, eq.ra, eq.dec).altitude;
      const libraryApparent = Horizon(when, obs, eq.ra, eq.dec, "normal").altitude;
      expect(apparentAltDeg(airless)).toBeCloseTo(libraryApparent, 12);
    }
  });

  it("F2 — the lift is altitude-DEPENDENT, so a constant 34′ fudge cannot stand in for it", () => {
    const atHorizon = apparentAltDeg(0) - 0;
    const atFour = apparentAltDeg(4) - 4;
    expect(atHorizon).toBeCloseTo(0.4830, 4);
    expect(atFour).toBeCloseTo(0.1893, 4);
    // A fixed 34′ = 0.5667° offset is wrong at BOTH ends of this feature's 0–4° band.
    expect(atHorizon).toBeLessThan(0.5667);
    expect(atFour).toBeLessThan(atHorizon / 2);
  });
});

// =================================================================================================
// PIN b — the moon skips days
// =================================================================================================

describe("eventTrack — PIN b: the moon SKIPS days, so a track is never guaranteed", () => {
  it("PIN b — 2026 at Dnipro: 366 local days, 366 sunrises, only 353 moonrises (the 24 h 50 m lunar day)", () => {
    const seen = new Set<number>();
    let sunrises = 0;
    let moonrises = 0;
    for (let d = 0; d < 400; d++) {
      const w = localDayWindow(Date.UTC(2026, 0, 1, 12) + d * DAY_MS, DNIPRO.lonDeg);
      if (w.startMs >= Date.UTC(2027, 0, 1)) break;
      if (seen.has(w.startMs)) continue;
      seen.add(w.startMs);
      if (eventInstantMs("sunrise", w.startMs + 1, DNIPRO) != null) sunrises++;
      if (eventInstantMs("moonrise", w.startMs + 1, DNIPRO) != null) moonrises++;
    }
    expect(seen.size).toBe(366);
    expect(sunrises).toBe(366);
    // The plan's "~353". A finder that dropped the half-open in-window test would report 366 here
    // and the feature would offer a moonrise on a day the moon does not rise.
    expect(moonrises).toBe(353);
  });

  it("PIN b — a skipped day returns null (the documented ABSENT result) and does not throw", () => {
    // The local solar day starting 2026-01-09T22:00Z at Dnipro carries NO moonrise (measured —
    // the first of the 13 skips in 2026). `eventTrack` must be absent, not a stub.
    const skipped = SKIPPED_MOONRISE_MS;
    expect(eventInstantMs("moonrise", skipped, DNIPRO)).toBeNull();
    expect(() => eventTrack(DNIPRO, "moonrise", skipped)).not.toThrow();
    expect(eventTrack(DNIPRO, "moonrise", skipped)).toBeNull();
    // …and the very next day it is back, so this is a real skip and not a broken finder.
    expect(eventTrack(DNIPRO, "moonrise", skipped + DAY_MS)).not.toBeNull();
    // Non-finite input is absent too, never NaN times.
    expect(eventTrack(DNIPRO, "moonrise", Number.NaN)).toBeNull();
  });

  it("PIN b — `moonWorth` on a skipped day is 0, not NaN", () => {
    expect(moonWorth(SKIPPED_MOONRISE_MS, DNIPRO, "moonrise")).toBe(0);
  });

  it("PIN b — the instant a track reports belongs to the LOCAL SOLAR DAY it was asked about, not the next one", () => {
    // `dayArc.localDayWindow` is the same framing `planner.dayEvents` uses, so a BEST SPOT day and
    // an almanac chip can never disagree about which day an event belongs to. A finder that just
    // searched forward "until it found one" would drift into tomorrow on the 13 skipped days.
    for (let d = 0; d < 40; d++) {
      const probe = Date.UTC(2026, 2, 1, 12) + d * DAY_MS;
      const w = localDayWindow(probe, DNIPRO.lonDeg);
      for (const kind of KINDS) {
        const track = eventTrack(DNIPRO, kind, probe);
        if (track === null) continue;
        expect(track.t0Ms).toBeGreaterThanOrEqual(w.startMs);
        expect(track.t0Ms).toBeLessThan(w.endMs);
      }
    }
  });
});

// =================================================================================================
// PIN a — refracted label, apparent geometry
// =================================================================================================

describe("eventTrack — PIN a: REFRACTED label, APPARENT geometry", () => {
  it("PIN a — the AIRLESS centre at t0 is −0.87° (the shipped planner/sunEventFrame band) while THIS module reports the APPARENT centre at −0.25°: two quantities, both correct", () => {
    for (const kind of KINDS) {
      const track = eventTrack(DNIPRO, kind, AUG_MS);
      expect(track, `${kind} track`).not.toBeNull();
      const airless = horizontal(bodyOf(kind), track!.t0Ms, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;

      // (1) The LABEL instant. Cross-checked against the shipped pins, which must not be
      //     contradicted: planner.test.ts:79-82 and sunEventFrame.test.ts:50-51 both bracket the
      //     airless centre at the refracted rise/set instant at −1.1 < alt < −0.6.
      expect(airless).toBeGreaterThan(-1.1);
      expect(airless).toBeLessThan(-0.6);

      // (2) The GEOMETRY this module hands the sweep. Refraction lifts the same instant to
      //     ≈ −0.25°, and THAT is the number the apparent skyline may be compared against.
      const apparent = apparentAltDeg(airless);
      expect(apparent).toBeGreaterThan(-0.35);
      expect(apparent).toBeLessThan(0);

      // (3) The two differ by ~0.62° — more than two solar radii. If this ever collapses to 0 the
      //     module has stopped converting and F2 is back.
      expect(apparent - airless).toBeGreaterThan(0.6);

      // (4) The crossing is INTERIOR to the track, and the sample nearest it reports the apparent
      //     centre, not the airless one. (An airless track would read ≈ −0.87° here.)
      let best = 0;
      const s = track!.samples;
      for (let i = 1; i < s.length; i++)
        if (Math.abs(s[i].utcMs - track!.t0Ms) < Math.abs(s[best].utcMs - track!.t0Ms)) best = i;
      expect(best).toBeGreaterThan(0);
      expect(best).toBeLessThan(s.length - 1);
      expect(s[best].altAppDeg).toBeGreaterThan(-0.45);
      expect(s[best].altAppDeg).toBeLessThan(0.1);
    }
  });

  it("PIN a — every sample is exactly `apparentAltDeg(bodies.horizontal())` at its own instant: the observer-height copy inside this module cannot drift from the shipped AIRLESS face", () => {
    // `bodies.horizontal()` pins its Observer to height 0; this module must use the T32-clamped
    // elevation instead, so it re-states the recipe. At the sea-level datum the two are the same
    // call and must agree to the last bit — that is what makes the copy safe.
    for (const kind of KINDS) {
      const track = eventTrack(DNIPRO_SEA, kind, AUG_MS)!;
      expect(track).not.toBeNull();
      for (const s of track.samples) {
        const ref = horizontal(bodyOf(kind), s.utcMs, DNIPRO_SEA.latDeg, DNIPRO_SEA.lonDeg);
        expect(s.altAppDeg).toBeCloseTo(apparentAltDeg(ref.altDeg), 12);
        expect(s.azDeg).toBeCloseTo(ref.azDeg, 12);
      }
      const ref0 = horizontal(bodyOf(kind), track.t0Ms, DNIPRO_SEA.latDeg, DNIPRO_SEA.lonDeg);
      expect(track.setAzDeg).toBeCloseTo(ref0.azDeg, 12);
      // …and the contract's wrap: every azimuth inside [0,360).
      for (const s of track.samples) {
        expect(s.azDeg).toBeGreaterThanOrEqual(0);
        expect(s.azDeg).toBeLessThan(360);
      }
    }
  });
});

// =================================================================================================
// The window (§3.1)
// =================================================================================================

describe("eventTrack — the window: +4° above down to 3ρ below the crossing", () => {
  it("reaches airless +4° at the top and 3ρ BELOW the crossing at the bottom — a track clipped at the horizon fails the lower half", () => {
    const track = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const airless0 = horizontal("sun", track.t0Ms, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;
    const rho = track.samples[0].rhoDeg;
    const alts = track.samples.map((s) => s.altAppDeg);

    // Top: the window edge is airless +4°, i.e. apparent 4.189°. The shoulder carries it further.
    expect(Math.max(...alts)).toBeGreaterThanOrEqual(apparentAltDeg(4) - 1e-6);
    // Bottom: 3ρ below the CROSSING, expressed apparent. A window that stopped at the refracted
    // horizon would bottom out near −0.25° and could never score a lifted sheet or a bluff.
    expect(Math.min(...alts)).toBeLessThanOrEqual(apparentAltDeg(airless0 - 3 * rho) + 1e-6);
    expect(Math.min(...alts)).toBeLessThan(-0.9);
    // The crossing itself is interior — the disc is scored on both sides of contact.
    expect(Math.max(...alts)).toBeGreaterThan(apparentAltDeg(airless0));
    expect(Math.min(...alts)).toBeLessThan(apparentAltDeg(airless0));
    // §3.1's measured Dnipro figures: ~30 min, azimuth sweep 5.5–7.5° over the WINDOW.
    const spanMin = Math.abs(track.samples[track.samples.length - 1].utcMs - track.samples[0].utcMs) / 60_000;
    expect(spanMin).toBeGreaterThan(30);
    expect(spanMin).toBeLessThan(90);
  });

  it("azimuth spacing is ≤0.25° over the window and exactly 0.5° over the ±3° shoulders (§8: 2ρ spans ~2.1 columns)", () => {
    const track = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const u = unwrapTrackAzDeg(track.samples);
    const gaps = u.slice(1).map((v, i) => v - u[i]);
    // 1e-4 tolerance, not 1e-9: `new Date(ms)` truncates to whole milliseconds, so every emitted
    // azimuth carries a ±3e-6° quantum. Tighter than that is testing the clock, not the design.
    const isShoulder = (g: number) => Math.abs(g - 0.5) < 1e-4;
    // Six 0.5° steps on each side = 3° of shoulder, both sides — exactly the span `F_notch`
    // measures sL/sR over. A track built without shoulders reports 0 here.
    expect(gaps.filter(isShoulder).length).toBe(12);
    for (const g of gaps) {
      if (isShoulder(g)) continue;
      // The step is a RESOLUTION GUARANTEE: never coarser than the spec's 0.25°.
      expect(g).toBeLessThanOrEqual(0.25 + 1e-4);
      expect(g).toBeGreaterThan(0.12); // …and never a degenerate near-zero gap either
    }
    // Total sweep = window + 3° of shoulder on each side; §3.1 measured the Dnipro window at 5.5–7.5°.
    expect(u[u.length - 1] - u[0] - 6).toBeGreaterThan(5.5);
    expect(u[u.length - 1] - u[0] - 6).toBeLessThan(7.5);
  });

  it("the azimuth step is a parameter: 0.125° (the §8 desktop-high option) roughly doubles the window samples", () => {
    const coarse = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const fine = eventTrack(DNIPRO, "sunset", AUG_MS, { azStepDeg: 0.125 })!;
    const winCoarse = coarse.samples.length - 12;
    const winFine = fine.samples.length - 12;
    expect(winFine / winCoarse).toBeGreaterThan(1.8);
    expect(winFine / winCoarse).toBeLessThan(2.2);
  });

  it("`maxSamples` decimates the lattice UNIFORMLY and keeps both ends — a track that truncated would lose a whole notch shoulder", () => {
    const full = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const capped = eventTrack(DNIPRO, "sunset", AUG_MS, { maxSamples: 13 })!;
    expect(capped.samples.length).toBeLessThanOrEqual(13);
    expect(capped.samples.length).toBeGreaterThanOrEqual(5);
    assertAzimuthStrictlyAscending(capped);
    assertAltitudeStrictlyMonotone(capped);
    expect(capped.samples.reduce((a, s) => a + s.w, 0)).toBeCloseTo(1, 12);
    // The SWEPT SPAN is what `C` integrates over; decimation must not shrink it.
    const spanOf = (t: typeof full) => {
      const u = unwrapTrackAzDeg(t.samples);
      return u[u.length - 1] - u[0];
    };
    expect(spanOf(capped)).toBeCloseTo(spanOf(full), 3);
  });

  it("ρ is PER-SAMPLE and per-date: the sun is 0.271° at perihelion and 0.262° at aphelion (a constant ρ fails)", () => {
    const jan = eventTrack(DNIPRO, "sunset", Date.UTC(2026, 0, 4, 12))!;
    const jul = eventTrack(DNIPRO, "sunset", Date.UTC(2026, 6, 6, 12))!;
    expect(jan.samples[0].rhoDeg).toBeCloseTo(0.27098, 4);
    expect(jul.samples[0].rhoDeg).toBeCloseTo(0.26209, 4);
    // The plan's own quoted ranges (§3.1): sun 0.262–0.271°, moon 0.245–0.279°.
    for (const t of [jan, jul]) {
      for (const s of t.samples) {
        expect(s.rhoDeg).toBeGreaterThan(0.262 - 1e-4);
        expect(s.rhoDeg).toBeLessThan(0.271 + 1e-4);
      }
    }
    for (const kind of ["moonrise", "moonset"] as BestSpotKind[]) {
      for (const s of eventTrack(DNIPRO, kind, AUG_MS)!.samples) {
        expect(s.rhoDeg).toBeGreaterThan(0.245);
        expect(s.rhoDeg).toBeLessThan(0.279);
      }
    }
  });
});

// =================================================================================================
// PIN c — azimuth monotonicity
// =================================================================================================

describe("eventTrack — PIN c: azimuth is monotone over the window (one crossing per swept ray)", () => {
  it("PIN c — all four kinds at Dnipro sweep strictly ascending in azimuth with strictly monotone apparent altitude", () => {
    for (const kind of KINDS) {
      const track = eventTrack(DNIPRO, kind, AUG_MS);
      expect(track, kind).not.toBeNull();
      assertAzimuthStrictlyAscending(track!);
      assertAltitudeStrictlyMonotone(track!);
      expect(track!.samples.length).toBeGreaterThan(20);
    }
  });

  it("PIN c — Reykjavík at the solstice NEARLY violates it: the descent collapses to ~0.04°/min so the window widens to ~30° of azimuth and the sun's own nightly minimum sits barely below the window floor — still exactly one crossing", () => {
    const track = eventTrack(REYKJAVIK, "sunset", Date.UTC(2026, 5, 21, 12));
    expect(track).not.toBeNull();
    const u = assertAzimuthStrictlyAscending(track!);
    assertAltitudeStrictlyMonotone(track!);
    // ~10× the Dnipro azimuth sweep for the same altitude drop — this is the reparameterisation
    // working, not failing.
    expect(u[u.length - 1] - u[0]).toBeGreaterThan(25);
    // The margin that makes it "nearly": the sun bottoms out at −2.42° airless that night, and the
    // track floor sits within ~1° of it. Extend the window and it folds back — which is why the
    // march stops at the turning point instead of trusting a root-finder.
    const minApp = Math.min(...track!.samples.map((s) => s.altAppDeg));
    expect(minApp).toBeLessThan(-1);
    expect(minApp).toBeGreaterThan(apparentAltDeg(-2.42) - 1e-6);
  });

  it("PIN c — Tromsø sweeps THROUGH the 0°/360° seam: `azDeg` wraps by contract, the SEQUENCE does not", () => {
    // 2026-05-15 sunrise at Tromsø: the track runs 359.97° → 404.60° unwrapped. Read the raw
    // `azDeg` field and it looks like a 360° jump backwards; that is exactly the bug
    // `unwrapTrackAzDeg` exists to make impossible.
    const track = eventTrack(TROMSO, "sunrise", Date.UTC(2026, 4, 15, 12));
    expect(track).not.toBeNull();
    const raw = track!.samples.map((s) => s.azDeg);
    expect(Math.max(...raw)).toBeGreaterThan(300); // …samples on both sides of the seam
    expect(Math.min(...raw)).toBeLessThan(60);
    const u = assertAzimuthStrictlyAscending(track!);
    assertAltitudeStrictlyMonotone(track!);
    expect(u[u.length - 1] - u[0]).toBeGreaterThan(40);
    // A naive `azDeg[i] > azDeg[i-1]` sweep would see a fold here. Prove one exists.
    expect(raw.some((a, i) => i > 0 && a < raw[i - 1])).toBe(true);
  });

  it("PIN c — Sydney sweeps azimuth the OTHER way round the sky: samples stay azimuth-ASCENDING, which makes them reverse-chronological", () => {
    // Southern hemisphere: the sun culminates NORTH, so azimuth DECREASES with time. Emitting in
    // time order would hand the fused sweep of §5 a descending azimuth index and silently invert
    // every running maximum.
    for (const kind of KINDS) {
      const track = eventTrack(SYDNEY, kind, Date.UTC(2026, 7, 24, 2));
      expect(track, kind).not.toBeNull();
      assertAzimuthStrictlyAscending(track!);
      assertAltitudeStrictlyMonotone(track!);
    }
    const sunset = eventTrack(SYDNEY, "sunset", Date.UTC(2026, 7, 24, 2))!;
    expect(sunset.samples[sunset.samples.length - 1].utcMs).toBeLessThan(sunset.samples[0].utcMs);
    // The northern twin is chronological — same code, opposite hemisphere.
    const north = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    expect(north.samples[north.samples.length - 1].utcMs).toBeGreaterThan(north.samples[0].utcMs);
  });

  it("PIN c — polar day and polar night DEGENERATE to null, never to a malformed track", () => {
    // Midnight sun: no sunset at Tromsø on the June solstice.
    expect(() => eventTrack(TROMSO, "sunset", Date.UTC(2026, 5, 21, 12))).not.toThrow();
    expect(eventTrack(TROMSO, "sunset", Date.UTC(2026, 5, 21, 12))).toBeNull();
    // Polar night: no sunrise on the December solstice.
    expect(eventTrack(TROMSO, "sunrise", Date.UTC(2026, 11, 21, 12))).toBeNull();
    // The pole itself, both ways.
    const POLE: PlanObserver = { latDeg: 89.9, lonDeg: 0, groundAltM: 0, eyeAboveGroundM: 1.7 };
    for (const kind of KINDS) {
      expect(() => eventTrack(POLE, kind, Date.UTC(2026, 5, 21, 12))).not.toThrow();
      expect(() => eventTrack(POLE, kind, Date.UTC(2026, 11, 21, 12))).not.toThrow();
    }
  });

  it("PIN c — the TROPICS are where the reparameterisation really breaks, and 10–14° was an AVOIDABLE bug, not physics (LENS B)", () => {
    const at = (latDeg: number): PlanObserver => ({
      latDeg,
      lonDeg: 0,
      groundAltM: 0,
      eyeAboveGroundM: 1.7,
    });
    const SOLSTICES = [Date.UTC(2026, 5, 21, 12), Date.UTC(2026, 11, 21, 12)];

    // THE BUG. At these latitudes the WINDOW is perfectly monotone — `{ shoulderSpanDeg: 0 }` already
    // returned 6 and 7 samples — but the 3°-of-azimuth SHOULDER march asked for azimuth the sun never
    // reaches on that branch. `marchEdgeMs` only ever watched ALTITUDE, so it walked straight past the
    // azimuth extremum near 26° of altitude, the inversion grid folded, and a good track was killed.
    for (const day of SOLSTICES) {
      for (const latDeg of [10, 12, 14]) {
        for (const kind of ["sunrise", "sunset"] as const) {
          const track = eventTrack(at(latDeg), kind, day);
          expect(track, `${kind} at lat ${latDeg} on ${new Date(day).toISOString()}`).not.toBeNull();
          assertAzimuthStrictlyAscending(track!);
          assertAltitudeStrictlyMonotone(track!);
          // ASYMMETRIC BUT VALID: the unreachable shoulder TRUNCATES the span instead of poisoning
          // the grid, which is the whole point of clamping at the turning point.
          expect(track!.samples.length).toBeGreaterThanOrEqual(5);
          expect(track!.windowHi).toBeGreaterThan(track!.windowLo);
        }
      }
    }
    // …and the recovery reaches all the way down to 2°, where the shipped code also returned null.
    for (const day of SOLSTICES) {
      expect(eventTrack(at(2), "sunset", day)).not.toBeNull();
      expect(eventTrack(at(5), "sunset", day)).not.toBeNull();
    }

    // THE PHYSICS, which no clamp can recover and which must stay null. At the equator on a solstice
    // the SETTING AZIMUTH IS STATIONARY at the horizon — measured 293.44° at t0 on 2026-06-21 and
    // RISING on both sides — so `az(t)` is not invertible and there is no "exactly one crossing per
    // swept ray" to be had. This is the case the panel must state out loud (§10 S5), not the poles.
    for (const day of SOLSTICES) {
      for (const kind of ["sunrise", "sunset"] as const) {
        expect(eventTrack(at(0), kind, day)).toBeNull();
      }
    }
    // The equinox is fine at the same place — so it is the SOLSTICE geometry, not the latitude alone.
    expect(eventTrack(at(0), "sunset", Date.UTC(2026, 2, 20, 12))).not.toBeNull();
  });
});

// =================================================================================================
// Weights (§3.1)
// =================================================================================================

describe("eventTrack — weights: |dt/daz| · exp(−max(0,altApp)/2.5°) · horizon ceiling, normalised", () => {
  it("reproduces the formula EXACTLY and sums to 1 — dropping the density, the exponential, the CEILING or the normalisation all fail here", () => {
    for (const kind of KINDS) {
      const track = eventTrack(DNIPRO, kind, AUG_MS)!;
      const u = unwrapTrackAzDeg(track.samples);
      const n = track.samples.length;
      const dip = horizonDipDeg(DNIPRO.eyeAboveGroundM, 0.13);
      const raw: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const s = track.samples[i];
        const density = Math.abs(track.samples[b].utcMs - track.samples[a].utcMs) / (u[b] - u[a]);
        raw.push(density * trackWeightShape(s.altAppDeg, s.rhoDeg, dip, 2.5));
      }
      const sum = raw.reduce((x, y) => x + y, 0);
      for (let i = 0; i < n; i++) expect(track.samples[i].w).toBeCloseTo(raw[i] / sum, 10);
      expect(track.samples.reduce((x, s) => x + s.w, 0)).toBeCloseTo(1, 12);
      // Every sample keeps a POSITIVE weight, floor included: `C = Σ w·known / Σ w` is the honesty
      // channel over the FULL swept span, and a zero-weight shoulder would drop out of it silently.
      for (const s of track.samples) expect(s.w).toBeGreaterThan(0);
    }
  });

  it("the HORIZON CEILING is the disc's own geometry — 1 a radius up, exactly ½ at the dip, floored below", () => {
    const rho = 0.2635;
    const dip = -0.039;
    // Above the dip by one full radius: the whole disc is up, so the ceiling is inert and only
    // §3.1's exponential remains.
    expect(trackWeightShape(dip + rho, rho, dip, 2.5)).toBeCloseTo(
      Math.exp(-Math.max(0, dip + rho) / 2.5),
      12,
    );
    // AT the dip: exactly half the disc is above the horizon. This is the value an e-folding decay
    // would have had to be hand-tuned to reach; here it is the chord integral, with no free scale.
    expect(trackWeightShape(dip, rho, dip, 2.5)).toBeCloseTo(0.5, 12);
    // One radius BELOW: the disc has fully set and only the `C`-honesty floor is left.
    expect(trackWeightShape(dip - rho, rho, dip, 2.5)).toBeCloseTo(1e-3, 12);
    expect(trackWeightShape(dip - 3 * rho, rho, dip, 2.5)).toBeCloseTo(1e-3, 12);
    // The anchor MOVES WITH THE EYE — that is what makes §3.1's lower extension pay for a lifted
    // sheet instead of being dead weight. At a 2000 m eye (dip −1.339°) the sample that a
    // pedestrian's ceiling has already floored is still at full value.
    const lifted = horizonDipDeg(2000, 0.13);
    expect(lifted).toBeCloseTo(-1.339, 3);
    expect(trackWeightShape(-1.0, rho, lifted, 2.5)).toBe(1);
    expect(trackWeightShape(-1.0, rho, dip, 2.5)).toBeCloseTo(1e-3, 12);
  });

  it("the last ~2° carries the track, and the tail BELOW the horizon does not (LENS B)", () => {
    const track = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const dip = horizonDipDeg(DNIPRO.eyeAboveGroundM, 0.13);
    let lowBand = 0; // [0°, +2°] — the photograph
    let high = 0; // ≥ +3°       — "the sun is still well up"
    let below = 0; // under the eye's own dip — where f = 0 is guaranteed by geometry
    let nLow = 0;
    let nHigh = 0;
    for (const s of track.samples) {
      if (s.altAppDeg >= 0 && s.altAppDeg <= 2) {
        lowBand += s.w;
        nLow++;
      }
      if (s.altAppDeg >= 3) {
        high += s.w;
        nHigh++;
      }
      if (s.altAppDeg <= dip) below += s.w;
    }
    // THE ASSERTION THIS REPLACES read `Σ w over altApp ≤ 0` and demanded it exceed 0.45 — which is
    // to say it was PASSING BECAUSE OF the below-horizon tail LENS B found. It could not coexist
    // with "the tail is a tail": `low(≤0) ⊇ below`, so `below < 0.1` forces `low < 0.18`. Restated
    // over the band the photograph actually lives in, which is what §3.1's prose says.
    expect(lowBand).toBeGreaterThan(0.55);
    expect(lowBand).toBeGreaterThan(3 * high);
    // …and it is the EXPONENTIAL that does it, not the sampling: uniform weights over the same two
    // bands read below 1. Drop `exp(−max(0,altApp)/2.5°)` and this comparison collapses onto that.
    expect(nLow / nHigh).toBeLessThan(1);
    expect(lowBand / high).toBeGreaterThan(3 * (nLow / nHigh));
    // The tail is a tail (the RED assertion's twin, on a DIFFERENT observer + eye height — this one
    // reads the dip the track itself was anchored at, so it is the WORST case for the ceiling).
    // TWO-SIDED ON PURPOSE. Above: 0.469 before the fix — half the integral in a region where `f = 0`
    // is guaranteed by the curvature of the earth. Below: it must NOT be zero either. The residue is
    // the sample sitting just under the dip with half its disc still up, and a hard cut there would
    // throw away a real half-visible sun — which is why the ceiling is the chord integral and not a
    // step. Deleting the ceiling fails the upper bound; replacing it with a cut fails the lower one.
    expect(below).toBeLessThan(0.06);
    expect(below).toBeGreaterThan(0.02);
  });
});

// =================================================================================================
// PIN d — the Krisciunas–Schaefer curve
// =================================================================================================

describe("moonWorth / twilightGate — PIN d: a quarter moon is 9 % of full, NOT 50 %", () => {
  /** 2026-07-21 is a first quarter (phase angle 89.4°); 2026-08-28 is a full moon (3.9°). */
  const Q1_MS = Date.parse("2026-07-21T12:00:00Z");
  const FULL_MS = Date.parse("2026-08-28T12:00:00Z");

  it("PIN d — first quarter is under 15 % of full moon; the illuminated-FRACTION form gives 50 % and fails this", () => {
    const q = moonWorth(Q1_MS, DNIPRO, "moonrise");
    const f = moonWorth(FULL_MS, DNIPRO, "moonrise");
    expect(f).toBeGreaterThan(0.5);
    expect(q).toBeGreaterThan(0);
    expect(q / f).toBeLessThan(0.15);

    // …and with the twilight gate divided out, so the pin lands on the CURVE and not on the fact
    // that a first-quarter moon happens to rise in daylight. Krisciunas–Schaefer: 0.091 at α = 90°.
    const gateAt = (dayMs: number) => {
      const t0 = eventInstantMs("moonrise", dayMs, DNIPRO)!;
      return twilightGate(sunAltDeg(t0, DNIPRO.latDeg, DNIPRO.lonDeg));
    };
    const phaseOnly = (dayMs: number) => moonWorth(dayMs, DNIPRO, "moonrise") / gateAt(dayMs);
    expect(phaseOnly(Q1_MS) / phaseOnly(FULL_MS)).toBeLessThan(0.15);
    expect(phaseOnly(Q1_MS)).toBeCloseTo(moonPhaseIntensity(bodyStatesAt(eventInstantMs("moonrise", Q1_MS, DNIPRO)!).moonPhaseAngleDeg), 10);
    expect(phaseOnly(Q1_MS)).toBeGreaterThan(0.07);
    expect(phaseOnly(Q1_MS)).toBeLessThan(0.12);
    // The form this replaces: a linear illuminated-fraction scale reads 0.5 at first quarter.
    expect(phaseOnly(Q1_MS)).toBeLessThan(0.5 / 3);
  });

  it("PIN d — the twilight gate is 1 across [+0.5°, −6°] and ramps to a FLOOR of 0.25, never to 0", () => {
    for (const alt of [0.5, 0, -1, -3, -5.9, -6]) expect(twilightGate(alt)).toBe(1);
    // Upper ramp: +0.5° → +6° (the photographic golden ceiling, `LIGHT_DEG.goldenHi`).
    expect(twilightGate(2)).toBeCloseTo(0.7955, 4);
    expect(twilightGate(6)).toBeCloseTo(0.25, 10);
    expect(twilightGate(45)).toBe(0.25);
    // Lower ramp: −6° → −12° (nautical twilight, `LIGHT_DEG.nautical`).
    expect(twilightGate(-9)).toBeCloseTo(0.625, 10);
    expect(twilightGate(-12)).toBeCloseTo(0.25, 10);
    expect(twilightGate(-90)).toBe(0.25);
    // A hard gate (0 outside the plateau) would delete whole months of the moon map. NEVER 0.
    for (const alt of [-90, -30, 0, 30, 90]) expect(twilightGate(alt)).toBeGreaterThanOrEqual(0.25);
    // Monotone away from the plateau in both directions.
    for (const [a, b] of [[1, 3], [3, 5], [-7, -9], [-9, -11]]) expect(twilightGate(a)).toBeGreaterThan(twilightGate(b));
    expect(twilightGate(Number.NaN)).toBe(0.25);
  });

  it("worth is EXACTLY 1 for sun kinds — `M` ranks moon days against each other, not against sun days", () => {
    for (const kind of ["sunrise", "sunset"] as BestSpotKind[]) {
      expect(moonWorth(AUG_MS, DNIPRO, kind)).toBe(1);
      expect(eventTrack(DNIPRO, kind, AUG_MS)!.worth).toBe(1);
    }
    for (const kind of ["moonrise", "moonset"] as BestSpotKind[]) {
      const track = eventTrack(DNIPRO, kind, AUG_MS)!;
      expect(track.worth).toBeCloseTo(moonWorth(AUG_MS, DNIPRO, kind), 12);
      expect(track.worth).toBeLessThan(1);
      expect(track.worth).toBeGreaterThan(0);
    }
    // A full moon rising at sunset is the best possible moon day — worth near 1, not near 0.09.
    expect(eventTrack(DNIPRO, "moonrise", FULL_MS)!.worth).toBeGreaterThan(0.8);
  });
});

// =================================================================================================
// PIN e — the T32 observer clamp
// =================================================================================================

describe("eventTrack — PIN e: the T32 observer clamp holds", () => {
  it("PIN e — a 10 km eye does not throw: `Atmosphere()` throws outside [−500, +100000] m and `SearchRiseSet` builds a SECOND observer at height − metersAboveGround", () => {
    const high: PlanObserver = { ...DNIPRO, eyeAboveGroundM: 10_000 };
    expect(() => eventTrack(high, "sunset", AUG_MS)).not.toThrow();
    const track = eventTrack(high, "sunset", AUG_MS);
    expect(track).not.toBeNull();
    // The dip at 10 km is ~−2.96°, so the refracted set instant is genuinely later and lower than
    // the 2 m one — the clamp must not have flattened the eye to the ground.
    const ground = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    expect(track!.t0Ms).toBeGreaterThan(ground.t0Ms + 8 * 60_000);
    const airless = horizontal("sun", track!.t0Ms, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;
    expect(airless).toBeLessThan(-3);
  });

  it("PIN e — an ORBITAL eye (the shipped 2D-shell LEO case that first caught T32) clamps to the aerial ceiling instead of throwing", () => {
    for (const eye of [6_371_000, 1e9, Number.POSITIVE_INFINITY, Number.NaN]) {
      const o: PlanObserver = { ...DNIPRO, eyeAboveGroundM: eye };
      expect(() => eventTrack(o, "sunset", AUG_MS), `eye ${eye}`).not.toThrow();
      expect(eventTrack(o, "sunset", AUG_MS)).not.toBeNull();
    }
    // A 6,371 km eye and a 10 km eye must land on the SAME clamped observer.
    const orbital = eventTrack({ ...DNIPRO, eyeAboveGroundM: 6_371_000 }, "sunset", AUG_MS)!;
    const ceiling = eventTrack({ ...DNIPRO, eyeAboveGroundM: 10_000 }, "sunset", AUG_MS)!;
    expect(orbital.t0Ms).toBe(ceiling.t0Ms);
  });

  it("PIN e — Everest ground plus a 10 km eye still lands inside the library's band (obsM − eyeM must stay ≥ −500)", () => {
    const everest: PlanObserver = {
      latDeg: 27.9881,
      lonDeg: 86.925,
      groundAltM: 8_848,
      eyeAboveGroundM: 10_000,
    };
    expect(() => eventTrack(everest, "sunset", AUG_MS)).not.toThrow();
    expect(eventTrack(everest, "sunset", AUG_MS)).not.toBeNull();
    // …and the Dead Sea floor, the other end of the clamp.
    const deadSea: PlanObserver = { latDeg: 31.5, lonDeg: 35.5, groundAltM: -430, eyeAboveGroundM: 1.7 };
    expect(() => eventTrack(deadSea, "sunrise", AUG_MS)).not.toThrow();
    expect(eventTrack(deadSea, "sunrise", AUG_MS)).not.toBeNull();
  });
});

// =================================================================================================
// The unwrap helper
// =================================================================================================

// =================================================================================================
// Worker purity — §5 runs this module inside a long-lived module worker
// =================================================================================================

describe("bestSpotTrack — purity fence: the §5 worker has no three, no store, no DOM, no clock", () => {
  it("imports nothing that would break inside a Web Worker, and reads no ambient time", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/geo/bestSpotTrack.ts"),
      "utf8",
    ).replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, ""); // strip comment lines so prose cannot trip the fence
    // The `horizonProfile`/`occlusion` contract: pure geo lib, three-free, importable in a worker.
    expect(src).not.toMatch(/from\s+["']three/);
    expect(src).not.toMatch(/from\s+["'].*\/store\//);
    expect(src).not.toMatch(/from\s+["'].*\/components\/(?!globe\/tuning)/);
    // All time is an explicit epoch-ms parameter — a `Date.now()` here would make the track
    // non-reproducible under the scrubber and unusable from a cached worker result.
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/\bperformance\.now\(/);
    expect(src).not.toMatch(/\b(document|localStorage|navigator)\b/);
    // `window` is a DOM global; the only legal use of the word here is "event window" in prose,
    // which the comment strip above already removed.
    expect(src).not.toMatch(/\bwindow\./);
  });
});

describe("unwrapTrackAzDeg — the 0°/360° seam", () => {
  it("makes a seam-crossing sequence continuous and leaves a non-crossing one untouched", () => {
    expect(unwrapTrackAzDeg([{ azDeg: 358 }, { azDeg: 359 }, { azDeg: 0.5 }, { azDeg: 1.5 }])).toEqual([
      358, 359, 360.5, 361.5,
    ]);
    expect(unwrapTrackAzDeg([{ azDeg: 280 }, { azDeg: 281 }, { azDeg: 282 }])).toEqual([280, 281, 282]);
    expect(unwrapTrackAzDeg([])).toEqual([]);
    // Descending across the seam unwraps downward, so a southern-hemisphere-style read still works.
    expect(unwrapTrackAzDeg([{ azDeg: 2 }, { azDeg: 1 }, { azDeg: 359 }])).toEqual([2, 1, -1]);
  });
});

// =============================================================================================
// LENS B (2026-08-24) — LEFT RED ON PURPOSE. See the audit report.
// =============================================================================================

/**
 * THE BUG CLASS: **F2's symptom is still shipped, one layer down.** §10 S1's first done-check is
 * "a flat open horizon at 1.7 m yields `V ≥ 0.95`", and F2 names the failure mode out loud: "a gate
 * anchored at 0.75 is unreachable and every cell reads mediocre".
 *
 * The refraction half of F2 IS fixed — `altAppDeg` is apparent, the skyline is apparent, they agree.
 * But `eventTrack` emits the window (down to `alt(t0) − 3ρ`) PLUS a 3°-of-azimuth bottom shoulder,
 * so the last sample of a Dnipro sunset sits at **−3.5° apparent**, and `w = |dt/daz|·exp(−max(0,
 * alt)/2.5°)` does **not** decay below 0. MEASURED on the shipped track: **47 % of the normalised
 * weight is at altitudes below a 1.7 m eye's own dip (−0.039°)**, where `f = 0` is guaranteed by
 * geometry for every ground cell on earth.
 *
 * ⇒ `V = 0.514` over a PERFECT open horizon (not ≥ 0.95), `G(V) = 0.657` (never 1), and the best
 * possible pedestrian cell scores `S ≈ 0.41` on a ramp §6 says is "indistinguishable from the map"
 * below ~50 %. `bestSpotMetric.test.ts`'s PIN 1 reaches 0.9566 only because its synthetic track stops
 * at −0.1°; the composed system never sees that track.
 *
 * The shoulders exist for `F_notch`'s sL/sR and for `C` (§3.4 says C is over the FULL span BECAUSE
 * az* sits at the window's end) — they were never meant to be in the visibility integral, and
 * `EventTrack` carries no window/shoulder flag with which the metric could exclude them.
 */
describe("BEST SPOT — RED: the shipped track's below-horizon tail caps V at ~0.5 (F2's symptom, S1 check 1)", () => {
  const DAY = Date.UTC(2026, 7, 24, 12);
  const EYE_M = 1.7;

  function openHorizonCell(track: EventTrack, liftM: number) {
    const dip = horizonDipDeg(EYE_M + liftM, 0.13);
    const rays: RayEvidence[] = track.samples.map((s) => ({
      azDeg: s.azDeg,
      groundAltAppDeg: dip, // a PERFECT open horizon: the cell sees down to its own dip everywhere
      groundSrc: "terrain",
      groundDistM: 30_000,
      bands: [],
      bandSrc: [],
      bandDistM: [],
      blockerDistM: 30_000,
      src: "terrain",
      known: 1,
      openSky: true,
    }));
    const access: CellAccess = { hard: 1, soft: 1, cls: "green", groundReachable: true };
    return cellScore(rays, track, access, {
      ...BESTSPOT_METRIC_DEFAULTS,
      eyeM: EYE_M,
      liftM,
    });
  }

  it("a PERFECT open horizon at 1.7 m reaches V ≥ 0.95 and SATURATES the gate", () => {
    const track = eventTrack(DNIPRO_SEA, "sunset", DAY);
    expect(track).not.toBeNull();
    const cs = openHorizonCell(track as EventTrack, 0);
    // RED: 0.514. The number the plan's own S1 done-check names.
    expect(cs.v).toBeGreaterThanOrEqual(0.95);
    expect(visibilityGate(cs.v)).toBe(1);
    // …and therefore the best cell on the map must not read as "mediocre" on an ABSOLUTE ramp.
    expect(cs.score).toBeGreaterThan(0.5);
  });

  it("the weight below the eye's own dip is a tail, not half the integral", () => {
    const track = eventTrack(DNIPRO_SEA, "sunset", DAY) as EventTrack;
    const dip = horizonDipDeg(EYE_M, 0.13);
    let below = 0;
    for (const s of track.samples) if (s.altAppDeg <= dip) below += s.w;
    // `f = 0` is structurally guaranteed for every ground cell at those samples, so whatever
    // fraction this is, it is an upper bound on how far V can ever fall short of 1. RED: 0.469.
    expect(below).toBeLessThan(0.1);
  });
});


// =============================================================================================
// LENS B ACCEPTANCE — the window marker is load-bearing, and the gate still gates
// =============================================================================================

/**
 * The RED pair above proves `V ≥ 0.95` and `Σ w below the dip < 0.1` on the real track. These two
 * prove the parts of the fix that a future refactor could quietly undo without either RED going red:
 * that `windowLo`/`windowHi` actually EXCLUDE the shoulders from the visibility integral, and that
 * lifting `V` off the floor did not simply lift EVERY cell off the floor.
 */
describe("BEST SPOT — ACCEPTANCE: the shoulders stay out of V, and a blocked cell still scores low", () => {
  const DAY = Date.UTC(2026, 7, 24, 12);
  const EYE_M = 1.7;
  const ACCESS: CellAccess = { hard: 1, soft: 1, cls: "green", groundReachable: true };

  function raysFor(track: EventTrack, groundAt: (i: number) => number): RayEvidence[] {
    return track.samples.map((s, i) => {
      const g = groundAt(i);
      return {
        azDeg: s.azDeg,
        groundAltAppDeg: g,
        groundSrc: "terrain",
        groundDistM: 30_000,
        bands: [],
        bandSrc: [],
        bandDistM: [],
        blockerDistM: 30_000,
        src: "terrain",
        known: 1,
        openSky: g <= horizonDipDeg(EYE_M, 0.13) + 0.01,
      };
    });
  }

  it("blocking ONLY the SHOULDER azimuths leaves V untouched — that is what the markers are for", () => {
    const track = eventTrack(DNIPRO_SEA, "sunset", DAY) as EventTrack;
    const dip = horizonDipDeg(EYE_M, 0.13);
    expect(track.windowLo).toBeGreaterThan(0); // there IS a shoulder to exclude
    expect(track.windowHi).toBeLessThan(track.samples.length - 1);

    const open = cellScore(raysFor(track, () => dip), track, ACCESS, {
      ...BESTSPOT_METRIC_DEFAULTS,
      eyeM: EYE_M,
    });
    // A 40°-high wall standing across every SHOULDER azimuth and nothing else. Those samples are
    // outside the window by construction, so the visibility integral must not notice.
    const shouldersWalled = cellScore(
      raysFor(track, (i) => (i < track.windowLo || i > track.windowHi ? 40 : dip)),
      track,
      ACCESS,
      { ...BESTSPOT_METRIC_DEFAULTS, eyeM: EYE_M },
    );
    expect(shouldersWalled.v).toBeCloseTo(open.v, 12);
    // The shoulder weight is NOT negligible — this comparison would move if the markers were
    // dropped, which is what makes the assertion above able to fail.
    let shoulderW = 0;
    for (let i = 0; i < track.samples.length; i++) {
      if (i < track.windowLo || i > track.windowHi) shoulderW += track.samples[i].w;
    }
    expect(shoulderW).toBeGreaterThan(0.04);
    // …and the same wall INSIDE the window does move it, by about that much. (Not a tautology: it
    // proves the rays are wired to the samples and that `f` responds at all.)
    const windowWalled = cellScore(
      raysFor(track, (i) => (i >= track.windowLo && i <= track.windowLo + 5 ? 40 : dip)),
      track,
      ACCESS,
      { ...BESTSPOT_METRIC_DEFAULTS, eyeM: EYE_M },
    );
    expect(windowWalled.v).toBeLessThan(open.v - 0.01);
  });

  it("a genuinely blocked cell still scores low — the fix lifted the GOOD cell, not the floor", () => {
    const track = eventTrack(DNIPRO_SEA, "sunset", DAY) as EventTrack;
    const dip = horizonDipDeg(EYE_M, 0.13);
    const open = cellScore(raysFor(track, () => dip), track, ACCESS, {
      ...BESTSPOT_METRIC_DEFAULTS,
      eyeM: EYE_M,
    });
    // A courtyard: 15° of skyline in every direction, which the sun never climbs back over inside
    // this window (it tops out at 6.79° apparent).
    const courtyard = cellScore(raysFor(track, () => 15), track, ACCESS, {
      ...BESTSPOT_METRIC_DEFAULTS,
      eyeM: EYE_M,
    });
    expect(courtyard.v).toBe(0);
    expect(visibilityGate(courtyard.v)).toBe(0);
    expect(courtyard.score).toBe(0);
    // And the separation is the whole point: the best pedestrian cell now reads well above §6's
    // ~50 % legibility floor while the blocked one reads zero.
    expect(open.score).toBeGreaterThan(0.5);
    expect(open.score - courtyard.score).toBeGreaterThan(0.5);
  });
});
