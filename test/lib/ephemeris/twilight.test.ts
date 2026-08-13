import { describe, expect, it } from "vitest";
import {
  TWILIGHT_DEG,
  darkWindows,
  sunAltDeg,
  twilightPhaseAt,
  twilightSegments,
  type TwilightPhase,
} from "../../../src/lib/ephemeris/twilight";

// Dnipro (the app's home city) and analytic solstice vectors. The lower-culmination altitude is
// closed-form: minAlt = lat + dec − 90 (upper-branch: maxAlt = 90 − lat + dec) — the same
// first-principles style as bodies.test.ts' subsolar-at-tropic check.
const DNIPRO = { lat: 48.4647, lon: 35.0462 };

const utc = (iso: string) => Date.parse(iso);
const DAY_MS = 24 * 3600_000;

const phaseSet = (segs: Array<{ phase: TwilightPhase }>) => new Set(segs.map((s) => s.phase));

describe("twilightPhaseAt", () => {
  it("is day at Dnipro summer noon and night at winter midnight", () => {
    // 2026-06-21 ~10:00Z ≈ local solar noon (lon 35° → UTC+2h20m solar).
    expect(twilightPhaseAt(utc("2026-06-21T10:00:00Z"), DNIPRO.lat, DNIPRO.lon)).toBe("day");
    // 2026-12-21 ~21:40Z ≈ local solar midnight; minAlt = 48.46 − 23.44 − 90 ≈ −65° → deep night.
    expect(twilightPhaseAt(utc("2026-12-21T21:40:00Z"), DNIPRO.lat, DNIPRO.lon)).toBe("night");
  });

  it("matches the threshold classification of the raw altitude", () => {
    const t = utc("2026-08-13T19:00:00Z");
    const alt = sunAltDeg(t, DNIPRO.lat, DNIPRO.lon);
    const phase = twilightPhaseAt(t, DNIPRO.lat, DNIPRO.lon);
    const expected: TwilightPhase =
      alt >= 0 ? "day" : alt >= -6 ? "civil" : alt >= -12 ? "nautical" : alt >= -18 ? "astro" : "night";
    expect(phase).toBe(expected);
  });
});

describe("twilightSegments", () => {
  it("tiles the window exactly, with no gaps and alternating phases", () => {
    const start = utc("2026-08-12T12:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, DNIPRO.lat, DNIPRO.lon);
    expect(segs[0].startMs).toBe(start);
    expect(segs[segs.length - 1].endMs).toBe(start + DAY_MS);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startMs).toBe(segs[i - 1].endMs);
      expect(segs[i].phase).not.toBe(segs[i - 1].phase);
    }
  });

  it("walks the full ladder day→…→night→…→day across a mid-August Dnipro night", () => {
    const start = utc("2026-08-12T12:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, DNIPRO.lat, DNIPRO.lon);
    const phases = segs.map((s) => s.phase);
    // Descent and ascent both pass through every band (mid-latitude, mid-August: real night exists).
    expect(phases).toEqual([
      "day",
      "civil",
      "nautical",
      "astro",
      "night",
      "astro",
      "nautical",
      "civil",
      "day",
    ]);
  });

  it("refines each boundary to the defining sun altitude (≤1 s bisection → ≤~0.01°)", () => {
    const start = utc("2026-08-12T12:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, DNIPRO.lat, DNIPRO.lon);
    // The boundary between two adjacent phases = the darker phase's upper-edge altitude.
    const upperEdge: Record<TwilightPhase, number> = {
      day: Number.NaN, // never the darker side of a boundary
      civil: TWILIGHT_DEG.day,
      nautical: TWILIGHT_DEG.civil,
      astro: TWILIGHT_DEG.nautical,
      night: TWILIGHT_DEG.astro,
    };
    const order: TwilightPhase[] = ["day", "civil", "nautical", "astro", "night"];
    for (let i = 1; i < segs.length; i++) {
      const darker =
        order.indexOf(segs[i].phase) > order.indexOf(segs[i - 1].phase) ? segs[i].phase : segs[i - 1].phase;
      const alt = sunAltDeg(segs[i].startMs, DNIPRO.lat, DNIPRO.lon);
      // 1 s of time ≈ ≤0.004° of sun altitude; allow generous slack.
      expect(Math.abs(alt - upperEdge[darker])).toBeLessThan(0.05);
    }
  });

  it("midnight sun: 70°N at June solstice is a single day segment", () => {
    // minAlt = 70 + 23.44 − 90 = +3.44° — the sun never sets.
    const start = utc("2026-06-20T12:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, 70, 0);
    expect(segs).toHaveLength(1);
    expect(segs[0].phase).toBe("day");
  });

  it("60°N June solstice: civil twilight but never nautical (analytic: minAlt ≈ −6.56°… just below −6°)", () => {
    // minAlt = 60 + 23.44 − 90 = −6.56°: dips barely past civil into nautical, never to −12°.
    const start = utc("2026-06-20T12:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, 60, 0);
    const seen = phaseSet(segs);
    expect(seen.has("civil")).toBe(true);
    expect(seen.has("astro")).toBe(false);
    expect(seen.has("night")).toBe(false);
  });

  it("equatorial twilight is short: civil band ≈ 21–28 min at the equinox", () => {
    // Sun altitude rate at the equator ≈ 15°/h ⇒ the 6° civil band lasts ~24 min (literature rule).
    const start = utc("2026-03-20T00:00:00Z");
    const segs = twilightSegments(start, start + DAY_MS, 0, 0);
    const civil = segs.filter((s) => s.phase === "civil");
    expect(civil.length).toBeGreaterThan(0);
    for (const seg of civil) {
      const minutes = (seg.endMs - seg.startMs) / 60_000;
      expect(minutes).toBeGreaterThan(20);
      expect(minutes).toBeLessThan(29);
    }
  });

  it("returns [] for an empty window", () => {
    const t = utc("2026-08-12T12:00:00Z");
    expect(twilightSegments(t, t, DNIPRO.lat, DNIPRO.lon)).toEqual([]);
  });
});

describe("darkWindows", () => {
  it("Dnipro mid-August: one astronomical-darkness window overnight, none at 60°N solstice", () => {
    const start = utc("2026-08-12T12:00:00Z");
    const dark = darkWindows(start, start + DAY_MS, DNIPRO.lat, DNIPRO.lon);
    expect(dark).toHaveLength(1);
    // Sanity: the window brackets local solar midnight (~21:40Z at lon 35°).
    const midnight = utc("2026-08-12T21:40:00Z");
    expect(dark[0].startMs).toBeLessThan(midnight);
    expect(dark[0].endMs).toBeGreaterThan(midnight);

    expect(darkWindows(start, start + DAY_MS, 60, 0)).toHaveLength(0);
  });
});
