import { describe, expect, it } from "vitest";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import {
  azElHits,
  azElHitsInDay,
  type AzElQuery,
  type FrameSampler,
} from "../../../src/lib/ephemeris/frameFinder";

const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };
const DAY = Date.UTC(2026, 7, 14, 0, 0, 0);
const R8: Pick<AzElQuery, "azTolDeg" | "elTolDeg"> = { azTolDeg: 3, elTolDeg: 0.5 };

const sun: FrameSampler = (ms) => horizontal("sun", ms, DNIPRO.latDeg, DNIPRO.lonDeg);

describe("azElHitsInDay", () => {
  it("finds the sun standing at a known az/el and the crossing is az-exact", () => {
    // From the scan probes: 2026-08-14 ~10:00 UTC the sun is near az 156 / el 55.7 at Dnipro.
    const probe = sun(Date.UTC(2026, 7, 14, 10, 0, 0));
    const hits = azElHitsInDay(sun, { azDeg: probe.azDeg, elDeg: probe.altDeg, ...R8 }, DAY, DNIPRO);
    expect(hits.length).toBe(1);
    const h = hits[0];
    expect(Math.abs(h.utcMs - Date.UTC(2026, 7, 14, 10, 0, 0))).toBeLessThan(90_000);
    expect(Math.abs(sun(h.utcMs).azDeg - probe.azDeg)).toBeLessThan(0.02);
    expect(Math.abs(h.elDeg - probe.altDeg)).toBeLessThanOrEqual(0.5);
    expect(h.light).toBe("day");
    // The joint box window brackets the crossing and is minutes-long, not hours.
    expect(h.startMs).toBeLessThanOrEqual(h.utcMs);
    expect(h.endMs).toBeGreaterThanOrEqual(h.utcMs);
    expect(h.endMs - h.startMs).toBeLessThan(60 * 60_000);
    expect(h.endMs - h.startMs).toBeGreaterThan(30_000);
  });

  it("misses when the elevation is out of tolerance at the az crossing", () => {
    const probe = sun(Date.UTC(2026, 7, 14, 10, 0, 0));
    const hits = azElHitsInDay(
      sun,
      { azDeg: probe.azDeg, elDeg: probe.altDeg + 5, ...R8 },
      DAY,
      DNIPRO,
    );
    expect(hits).toHaveLength(0);
  });

  it("skyline filter: a wall above the target elevation flags the hit blocked", () => {
    const probe = sun(Date.UTC(2026, 7, 14, 10, 0, 0));
    const q = { azDeg: probe.azDeg, elDeg: probe.altDeg, ...R8 };
    const blocked = azElHitsInDay(sun, q, DAY, DNIPRO, () => 80);
    const clear = azElHitsInDay(sun, q, DAY, DNIPRO, () => 0);
    expect(blocked[0]?.skyline).toBe("blocked");
    expect(clear[0]?.skyline).toBe("clear");
  });

  it("a northern azimuth the sun never reaches at elevation yields nothing", () => {
    const hits = azElHitsInDay(sun, { azDeg: 0, elDeg: 30, ...R8 }, DAY, DNIPRO);
    expect(hits).toHaveLength(0);
  });
});

describe("azElHits (range face)", () => {
  it("one standing per day for a repeating solar geometry, chronologically", () => {
    const probe = sun(Date.UTC(2026, 7, 14, 10, 0, 0));
    // el sinks day over day in August; ±0.5° tol keeps ~a few days around the anchor
    const hits = azElHits(sun, { azDeg: probe.azDeg, elDeg: probe.altDeg, ...R8 }, DAY, 6, DNIPRO);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < hits.length; i++)
      expect(hits[i].utcMs).toBeGreaterThan(hits[i - 1].utcMs);
    // successive standings drift by ~24 h ± a few minutes
    const dt = hits[1].utcMs - hits[0].utcMs;
    expect(Math.abs(dt - 86_400_000)).toBeLessThan(15 * 60_000);
  });
});
