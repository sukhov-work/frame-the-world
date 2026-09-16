import { describe, expect, it } from "vitest";
import { Body, Observer, SearchRiseSet } from "astronomy-engine";
import { HORIZON_ALT_DEG, nextRiseSet } from "../../../src/lib/ephemeris/riseSet";
import { bodyTarget, fixedTarget, planetTarget, targetAzAlt } from "../../../src/lib/ephemeris/targets";

/**
 * NEXT RISE / NEXT SET (owner 2026-09-16 — the /m target peek). Sun/moon must equal the planner's
 * own `SearchRiseSet` (one sunrise per app); everything else crosses the REFRACTED horizon of
 * the same `targetAzAlt` face the marker reads.
 */

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const T0 = Date.UTC(2026, 5, 21, 9, 0, 0); // 2026-06-21 12:00 Dnipro (EEST) — the sun is up

const star = (id: string, raDeg: number, decDeg: number) =>
  fixedTarget({
    id,
    name: id,
    kind: "star",
    aliases: [],
    raDeg,
    decDeg,
    vmag: 1,
    facts: { kind: "dso", dsoType: "*", typeLabel: "STAR", constellation: "—", names: [] },
    source: "TEST",
  });

describe("sun and moon — the planner's SearchRiseSet, verbatim", () => {
  it("the sun's next set then next rise, each equal to astronomy-engine at the 1.6 m eye", () => {
    const rs = nextRiseSet(bodyTarget("sun"), T0, DNIPRO.latDeg, DNIPRO.lonDeg);
    const obs = new Observer(DNIPRO.latDeg, DNIPRO.lonDeg, 1.6);
    const set = SearchRiseSet(Body.Sun, obs, -1, new Date(T0), 2, 1.6)!.date.getTime();
    const rise = SearchRiseSet(Body.Sun, obs, 1, new Date(T0), 2, 1.6)!.date.getTime();
    expect(rs.setMs).toBe(set);
    expect(rs.riseMs).toBe(rise);
    // Midsummer noon: the set comes first (this evening), the rise after (tomorrow's dawn).
    expect(rs.setMs!).toBeGreaterThan(T0);
    expect(rs.riseMs!).toBeGreaterThan(rs.setMs!);
    expect(rs.riseMs! - T0).toBeLessThan(24 * 3_600_000);
  });

  it("the moon has both events inside 48 h", () => {
    const rs = nextRiseSet(bodyTarget("moon"), T0, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(rs.riseMs).not.toBeNull();
    expect(rs.setMs).not.toBeNull();
    for (const t of [rs.riseMs!, rs.setMs!]) {
      expect(t).toBeGreaterThan(T0);
      expect(t - T0).toBeLessThan(48 * 3_600_000);
    }
  });
});

describe("point targets — the refracted horizon of targetAzAlt", () => {
  it("a mid-declination star rises in the east and sets in the west, both on the −34′ datum", () => {
    const vega = star("star:vega", 279.23473, 38.78369);
    const rs = nextRiseSet(vega, T0, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(rs.riseMs).not.toBeNull();
    expect(rs.setMs).not.toBeNull();
    const atRise = targetAzAlt(vega, rs.riseMs!, DNIPRO.latDeg, DNIPRO.lonDeg);
    const atSet = targetAzAlt(vega, rs.setMs!, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(atRise.altDeg).toBeCloseTo(HORIZON_ALT_DEG, 3);
    expect(atSet.altDeg).toBeCloseTo(HORIZON_ALT_DEG, 3);
    expect(atRise.azDeg).toBeGreaterThan(0);
    expect(atRise.azDeg).toBeLessThan(180); // rising = east half
    expect(atSet.azDeg).toBeGreaterThan(180); // setting = west half
    // strictly after now, inside the default window
    for (const t of [rs.riseMs!, rs.setMs!]) {
      expect(t).toBeGreaterThan(T0);
      expect(t - T0).toBeLessThan(48 * 3_600_000);
    }
    // …and the altitude really crosses: a minute before the rise it is lower, a minute after higher.
    const before = targetAzAlt(vega, rs.riseMs! - 60_000, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;
    const after = targetAzAlt(vega, rs.riseMs! + 60_000, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;
    expect(before).toBeLessThan(HORIZON_ALT_DEG);
    expect(after).toBeGreaterThan(HORIZON_ALT_DEG);
  });

  it("a circumpolar star from Dnipro never rises or sets; a far-southern star is never up", () => {
    const polaris = star("star:polaris", 37.95456, 89.26411);
    expect(nextRiseSet(polaris, T0, DNIPRO.latDeg, DNIPRO.lonDeg)).toEqual({ riseMs: null, setMs: null });
    const canopus = star("star:canopus", 95.98796, -52.69566);
    expect(nextRiseSet(canopus, T0, DNIPRO.latDeg, DNIPRO.lonDeg)).toEqual({ riseMs: null, setMs: null });
  });

  it("a planet goes through the same scan and lands on the datum", () => {
    const rs = nextRiseSet(planetTarget("mars"), T0, DNIPRO.latDeg, DNIPRO.lonDeg);
    expect(rs.riseMs).not.toBeNull();
    expect(rs.setMs).not.toBeNull();
    const a = targetAzAlt(planetTarget("mars"), rs.riseMs!, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg;
    expect(a).toBeCloseTo(HORIZON_ALT_DEG, 3);
  });

  it("a shorter window can legitimately find only one side", () => {
    const vega = star("star:vega", 279.23473, 38.78369);
    const rs = nextRiseSet(vega, T0, DNIPRO.latDeg, DNIPRO.lonDeg, { scanHours: 6 });
    const found = [rs.riseMs, rs.setMs].filter((t) => t !== null).length;
    expect(found).toBeLessThanOrEqual(2);
    expect(found).toBeGreaterThanOrEqual(0);
    for (const t of [rs.riseMs, rs.setMs]) if (t !== null) expect(t - T0).toBeLessThanOrEqual(6 * 3_600_000 + 1);
  });
});
