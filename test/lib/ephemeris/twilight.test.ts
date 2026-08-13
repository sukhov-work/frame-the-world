import { describe, expect, it } from "vitest";
import {
  LIGHT_DEG,
  TWILIGHT_DEG,
  darkWindows,
  lightSegments,
  sunAltDeg,
  twilightPhaseAt,
  twilightSegments,
  type LightPhase,
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

describe("lightSegments (QoL-1 scrubber v2)", () => {
  const winStart = utc("2026-03-20T00:00:00Z"); // Dnipro equinox: max alt ≈ +41°, min ≈ −41°
  const segs = () => lightSegments(winStart, winStart + DAY_MS, DNIPRO.lat, DNIPRO.lon);

  it("tiles the window exactly with no gaps", () => {
    const s = segs();
    expect(s[0].startMs).toBe(winStart);
    expect(s[s.length - 1].endMs).toBe(winStart + DAY_MS);
    for (let i = 1; i < s.length; i++) expect(s[i].startMs).toBe(s[i - 1].endMs);
  });

  it("shows all six phases on an equinox day and orders them brightest→darkest into night", () => {
    const phases = new Set(segs().map((seg) => seg.phase));
    for (const p of ["day", "golden", "blue", "nautical", "astro", "night"]) {
      expect(phases.has(p as LightPhase)).toBe(true);
    }
    // Around sunset the sequence must walk every band without skipping the blue sliver.
    const names = segs().map((seg) => seg.phase);
    const iDay = names.lastIndexOf("day");
    expect(names.slice(iDay, iDay + 5)).toEqual(["day", "golden", "blue", "nautical", "astro"]);
  });

  it("refines the photographic edges to the LIGHT_DEG thresholds", () => {
    for (const seg of segs()) {
      if (seg.phase !== "golden") continue;
      // Each golden segment is bounded by the day edge (+6°) on one side and the blue edge
      // (−4°) on the other; a boundary altitude must sit on one of them (≤1 s bisection ⇒
      // well under 0.05°).
      for (const edge of [seg.startMs, seg.endMs]) {
        if (edge === winStart || edge === winStart + DAY_MS) continue;
        const alt = sunAltDeg(edge, DNIPRO.lat, DNIPRO.lon);
        const nearest = Math.min(
          Math.abs(alt - LIGHT_DEG.goldenHi),
          Math.abs(alt - LIGHT_DEG.goldenLo),
        );
        expect(nearest).toBeLessThan(0.05);
      }
    }
  });

  it("keeps the blue-hour sliver (2° tall) — never skipped by the coarse scan", () => {
    const blue = segs().filter((seg) => seg.phase === "blue");
    expect(blue.length).toBe(2); // dawn + dusk
    for (const seg of blue) {
      const minutes = (seg.endMs - seg.startMs) / 60_000;
      expect(minutes).toBeGreaterThan(5);
      expect(minutes).toBeLessThan(60);
    }
  });

  it("degenerates naturally at the poles", () => {
    // Longyearbyen June: midnight sun — one giant "day" segment.
    const north = lightSegments(utc("2026-06-21T00:00:00Z"), utc("2026-06-22T00:00:00Z"), 78.2, 15.6);
    expect(new Set(north.map((s) => s.phase))).toEqual(new Set(["day"]));
    // Longyearbyen December: polar night — nothing brighter than nautical ever appears.
    const south = lightSegments(utc("2026-12-21T00:00:00Z"), utc("2026-12-22T00:00:00Z"), 78.2, 15.6);
    for (const seg of south) expect(["nautical", "astro", "night"]).toContain(seg.phase);
  });

  it("returns [] for an inverted window", () => {
    expect(lightSegments(winStart, winStart - 1, DNIPRO.lat, DNIPRO.lon)).toEqual([]);
  });
});
