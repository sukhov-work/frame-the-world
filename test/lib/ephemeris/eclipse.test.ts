import { describe, expect, it } from "vitest";
import {
  NextLunarEclipse,
  Observer,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
} from "astronomy-engine";
import {
  discCoverage,
  eclipseDaylightK,
  lunarEclipseAt,
  nextLunarEclipses,
  nextSolarEclipses,
  solarEclipseAt,
  solarEclipseFromDiscs,
  unitAngleRad,
} from "../../../src/lib/ephemeris/eclipse";
import { bodyStatesAt } from "../../../src/lib/ephemeris/bodies";

// The owner's repro: the REAL total solar eclipse of 2026-08-12 seen from Burgos, Spain — the
// event this whole feature was built for. Greatest eclipse there is 18:29:07.9Z; the hash the
// owner reported with sits at 18:35:22.5Z, six minutes later, deep in the receding partial phase.
const BURGOS = { latDeg: 42.354484, lonDeg: -3.69824 };
const OBS = { ...BURGOS, groundAltM: 0, eyeAboveGroundM: 0 };
const OWNER_HASH_MS = 1_786_559_722_469; // 2026-08-12T18:35:22.469Z
const TOTALITY_MS = Date.parse("2026-08-12T18:29:07.887Z");
const DEG = 180 / Math.PI;

describe("discCoverage", () => {
  it("is 0 when the discs are disjoint and 1 when the occulter swallows the target", () => {
    expect(discCoverage(3, 1, 1)).toBe(0);
    expect(discCoverage(2, 1, 1)).toBe(0); // exactly tangent
    expect(discCoverage(0, 1, 2)).toBe(1);
    expect(discCoverage(0.5, 1, 2)).toBe(1); // fully engulfed, still 1
  });

  it("caps at the AREA RATIO when the target is bigger — the annular regime", () => {
    // A moon 0.9 the sun's radius can never hide more than 81% of it, however well centred.
    expect(discCoverage(0, 1, 0.9)).toBeCloseTo(0.81, 12);
    expect(discCoverage(0.05, 1, 0.9)).toBeCloseTo(0.81, 12);
  });

  it("is exactly half at the equal-radius half-cover separation", () => {
    // Two unit circles overlapping in a lens of half a disc's area: d ≈ 0.8079455 (numeric root).
    expect(discCoverage(0.807944, 1, 1)).toBeCloseTo(0.5, 5);
  });

  it("is monotone decreasing in separation", () => {
    let prev = Infinity;
    for (let d = 0; d <= 2.2; d += 0.05) {
      const c = discCoverage(d, 1, 1.05);
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      prev = c;
    }
  });

  it("rejects degenerate input rather than returning NaN", () => {
    expect(discCoverage(NaN, 1, 1)).toBe(0);
    expect(discCoverage(1, 0, 1)).toBe(0);
  });
});

describe("unitAngleRad", () => {
  it("matches acos(dot) for well-conditioned angles", () => {
    expect(unitAngleRad([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 12);
    expect(unitAngleRad([1, 0, 0], [-1, 0, 0])).toBeCloseTo(Math.PI, 12);
    expect(unitAngleRad([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 12);
  });
});

describe("solarEclipseAt — the Burgos 2026-08-12 totality", () => {
  it("reports TOTAL with full coverage at greatest eclipse", () => {
    const s = solarEclipseAt(TOTALITY_MS, BURGOS.latDeg, BURGOS.lonDeg);
    expect(s.phase).toBe("total");
    expect(s.coverage).toBe(1);
    expect(s.magnitude).toBeGreaterThan(1);
    // astronomy-engine's own local-circumstances search agrees on kind + obscuration.
    const lib = SearchLocalSolarEclipse(new Date(TOTALITY_MS - 3 * 86_400_000), OBS_ENGINE());
    expect(lib.kind).toBe("total");
    expect(lib.obscuration).toBeCloseTo(1, 6);
    expect(lib.peak.time.date.getTime()).toBeCloseTo(TOTALITY_MS, -2); // within 100 ms
  });

  it("reports the owner's hash instant as a DEEP PARTIAL — 88% covered, not totality", () => {
    const s = solarEclipseAt(OWNER_HASH_MS, BURGOS.latDeg, BURGOS.lonDeg);
    expect(s.phase).toBe("partial");
    expect(s.coverage).toBeCloseTo(0.8802, 3);
    expect(s.magnitude).toBeCloseTo(0.8988, 3);
    expect(s.sepRad * DEG).toBeCloseTo(0.06206, 4);
    expect(s.sunRadRad * DEG).toBeCloseTo(0.26296, 4);
    expect(s.moonRadRad * DEG).toBeCloseTo(0.27181, 4);
  });

  it("REGRESSION — a GEOCENTRIC test sees no eclipse at all at that same instant", () => {
    // This is the bug's root: lunar parallax (~1°) is the same size as the whole phenomenon.
    // If this ever starts reporting an eclipse, someone has made the scene geocentric again.
    const g = bodyStatesAt(OWNER_HASH_MS);
    const geoSepDeg = unitAngleRad(g.sunDir, g.moonDir) * DEG;
    expect(geoSepDeg).toBeCloseTo(1.0058, 3);
    const geo = solarEclipseFromDiscs(
      unitAngleRad(g.sunDir, g.moonDir),
      0.26296 / DEG,
      0.27181 / DEG,
    );
    expect(geo.phase).toBe("none");
    expect(geo.coverage).toBe(0);
  });

  it("opens and closes on the almanac's own contact times", () => {
    const lib = SearchLocalSolarEclipse(new Date(TOTALITY_MS - 3 * 86_400_000), OBS_ENGINE());
    const before = solarEclipseAt(lib.partial_begin.time.date.getTime() - 60_000, BURGOS.latDeg, BURGOS.lonDeg);
    const after = solarEclipseAt(lib.partial_end.time.date.getTime() + 60_000, BURGOS.latDeg, BURGOS.lonDeg);
    expect(before.phase).toBe("none");
    expect(after.phase).toBe("none");
    const inside = solarEclipseAt(lib.partial_begin.time.date.getTime() + 60_000, BURGOS.latDeg, BURGOS.lonDeg);
    expect(inside.coverage).toBeGreaterThan(0);
  });

  it("classifies annular geometry as annular, never total", () => {
    // Moon smaller than the sun, perfectly centred — the defining annular case.
    const a = solarEclipseFromDiscs(0, 0.0047, 0.0044);
    expect(a.phase).toBe("annular");
    expect(a.coverage).toBeLessThan(1);
    expect(a.coverage).toBeCloseTo((0.0044 / 0.0047) ** 2, 12);
  });
});

/** astronomy-engine Observer for the fixture site (the lib builds its own from PlanObserver). */
function OBS_ENGINE() {
  return new Observer(BURGOS.latDeg, BURGOS.lonDeg, 0);
}

describe("lunarEclipseAt", () => {
  it("matches astronomy-engine's obscuration across the 2025-2028 series", () => {
    let e = SearchLunarEclipse(new Date(Date.UTC(2025, 0, 1)));
    for (let i = 0; i < 8; i++) {
      const mine = lunarEclipseAt(e.peak.date.getTime());
      expect(mine.phase, `event ${e.peak.toString()}`).toBe(e.kind);
      // The 1.02 shadow enlargement is an empirical model, so allow 0.01 of absolute drift.
      expect(mine.umbralCoverage, `event ${e.peak.toString()}`).toBeCloseTo(e.obscuration, 2);
      e = NextLunarEclipse(e.peak);
    }
  });

  it("puts totality of the 2025-03-14 eclipse on its published contact times", () => {
    // Published: partial umbral 05:09Z, totality 06:26Z → 07:31Z, greatest 06:58Z.
    const at = (iso: string) => lunarEclipseAt(Date.parse(iso));
    expect(at("2025-03-14T06:58Z").umbralMag).toBeGreaterThan(1);
    expect(at("2025-03-14T06:58Z").phase).toBe("total");
    expect(at("2025-03-14T06:26Z").umbralMag).toBeCloseTo(1, 1);
    expect(at("2025-03-14T07:31Z").umbralMag).toBeCloseTo(1, 1);
    // Just outside totality it is a partial; well before first umbral contact, penumbral only.
    expect(at("2025-03-14T06:00Z").phase).toBe("partial");
    expect(at("2025-03-14T04:30Z").phase).toBe("penumbral");
    expect(at("2025-03-14T02:00Z").phase).toBe("none");
  });

  it("keeps a penumbral event visible even though the library reports obscuration 0", () => {
    const p = lunarEclipseAt(Date.parse("2027-02-20T23:12:00Z"));
    expect(p.phase).toBe("penumbral");
    expect(p.umbralCoverage).toBe(0); // no umbra contact — same as the library
    expect(p.penumbralMag).toBeGreaterThan(0.5); // ...but a real, drivable dimming
  });

  it("puts the umbra at roughly 2.7 lunar radii and the penumbra at ~4.8", () => {
    const s = lunarEclipseAt(Date.parse("2025-03-14T06:58Z"));
    expect(s.umbraRadRad / s.moonRadRad).toBeGreaterThan(2.3);
    expect(s.umbraRadRad / s.moonRadRad).toBeLessThan(3.0);
    expect(s.penumbraRadRad).toBeGreaterThan(s.umbraRadRad);
    // The shadow axis is the antisolar point.
    const st = bodyStatesAt(Date.parse("2025-03-14T06:58Z"));
    expect(s.axisDir[0]).toBeCloseTo(-st.sunDir[0], 12);
  });

  it("reports no eclipse at a random first-quarter moon", () => {
    expect(lunarEclipseAt(Date.parse("2026-05-24T12:00Z")).phase).toBe("none");
  });
});

describe("predictions", () => {
  it("lists the next solar eclipses at Burgos with sane, ordered rows", () => {
    const rows = nextSolarEclipses(OWNER_HASH_MS, OBS, 4);
    expect(rows.length).toBe(4);
    for (let i = 1; i < rows.length; i++) expect(rows[i].peakMs).toBeGreaterThan(rows[i - 1].peakMs);
    for (const r of rows) {
      expect(r.body).toBe("sun");
      expect(r.startMs).toBeLessThan(r.peakMs);
      expect(r.endMs).toBeGreaterThan(r.peakMs);
      expect(r.coverage).toBeGreaterThanOrEqual(0);
      expect(r.coverage).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.peakAltDeg)).toBe(true);
      // A non-total row must not claim a totality window.
      if (r.phase === "partial") expect(r.totalStartMs).toBeNull();
    }
    // The next one visible from Burgos after the 2026 totality is the 2027-08-02 partial.
    expect(new Date(rows[0].peakMs).toISOString().slice(0, 7)).toBe("2027-08");
  });

  it("lists lunar eclipses with DOUBLED semi-durations and a horizon verdict", () => {
    const rows = nextLunarEclipses(OWNER_HASH_MS, OBS, 4);
    expect(rows.length).toBe(4);
    const first = rows[0];
    // 2026-08-28 partial, sd_penum 169.2 min → the full penumbral span is ~338 min.
    expect(new Date(first.peakMs).toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(first.phase).toBe("partial");
    expect((first.endMs - first.startMs) / 60_000).toBeCloseTo(2 * 169.218, 0);
    expect(first.totalStartMs).toBeNull(); // sd_total is 0 for a partial
    expect(first.visible).toBe(true); // moon is 14° up at Burgos
    for (const r of rows) expect(r.body).toBe("moon");
  });

  it("returns nothing rather than throwing for a zero/negative count", () => {
    expect(nextSolarEclipses(OWNER_HASH_MS, OBS, 0)).toEqual([]);
    expect(nextLunarEclipses(OWNER_HASH_MS, OBS, -1)).toEqual([]);
  });

  it("survives a polar site where solar eclipses are sparse", () => {
    const polar = { latDeg: -89.9, lonDeg: 0, groundAltM: 2800, eyeAboveGroundM: 1.7 };
    expect(() => nextSolarEclipses(OWNER_HASH_MS, polar, 2)).not.toThrow();
    expect(() => nextLunarEclipses(OWNER_HASH_MS, polar, 2)).not.toThrow();
  });
});

describe("eclipseDaylightK", () => {
  it("is 1 uneclipsed and the floor at totality", () => {
    expect(eclipseDaylightK(0, 0.8, 0.04)).toBeCloseTo(1, 12);
    expect(eclipseDaylightK(1, 0.8, 0.04)).toBeCloseTo(0.04, 12);
  });

  it("holds light through the partial phases, then collapses (limb darkening)", () => {
    // The lived shape: half-covered is barely noticeable, and the light goes at the very end.
    expect(eclipseDaylightK(0.5, 0.8, 0.04)).toBeGreaterThan(0.5);
    // ...and it always sits ABOVE the naive 1 − coverage line, which is the whole point of gamma.
    expect(eclipseDaylightK(0.9, 0.8, 0.04)).toBeGreaterThan(0.1);
    expect(eclipseDaylightK(0.9, 0.8, 0.04)).toBeLessThan(0.25);
    expect(eclipseDaylightK(0.99, 0.8, 0.04)).toBeLessThan(0.08);
  });

  it("is monotone and stays inside [floor, 1] for out-of-range input", () => {
    let prev = Infinity;
    for (let c = 0; c <= 1.0001; c += 0.02) {
      const k = eclipseDaylightK(c, 0.8, 0.04);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      expect(k).toBeGreaterThanOrEqual(0.04 - 1e-12);
      prev = k;
    }
    expect(eclipseDaylightK(-1, 0.8, 0.04)).toBeCloseTo(1, 12);
    expect(eclipseDaylightK(2, 0.8, 0.04)).toBeCloseTo(0.04, 12);
  });
});
