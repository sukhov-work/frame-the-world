import { describe, expect, it } from "vitest";
import {
  lambdaToMs,
  meteorRateSeries,
  radiantAt,
  radiantAzAlt,
  SHOWER_DARK_SUN_DEG,
  SHOWERS,
  showerActive,
  showerByCode,
  showerNights,
  sunLambdaJ2000,
  upcomingShowerPeaks,
  visibleRateAt,
  zhrAt,
} from "../../../src/lib/ephemeris/showers";
import { showerTarget, targetAzAlt, targetShortName } from "../../../src/lib/ephemeris/targets";
import { horizontal } from "../../../src/lib/ephemeris/bodies";
import type { PlanObserver } from "../../../src/lib/ephemeris/planner";

const DNIPRO: PlanObserver = { latDeg: 48.4647, lonDeg: 35.0462, groundAltM: 0, eyeAboveGroundM: 1.6 };
const utc = (iso: string) => Date.parse(iso);

const PER = showerByCode("PER")!;
const GEM = showerByCode("GEM")!;
const QUA = showerByCode("QUA")!;
const JBO = showerByCode("JBO")!;

describe("sunLambdaJ2000 — the IMO equinox-J2000 frame", () => {
  it("is ~0° at the J2000-era March equinox (2000-03-20 07:35 UT)", () => {
    expect(Math.abs(sunLambdaJ2000(utc("2000-03-20T07:35:00Z")))).toBeLessThan(0.01);
  });

  it("matches the research-validated 2026 anchor (2026-01-03 19:00 UT → 283.048°)", () => {
    // The QUA-peak validation point: J2000 λ☉ = 283.048 vs SunPosition's of-date 283.413 —
    // the 0.365° gap IS the accumulated precession since 2000 (≈9 h of peak timing).
    expect(sunLambdaJ2000(utc("2026-01-03T19:00:00Z"))).toBeCloseTo(283.048, 2);
  });

  it("shows the precession offset at a 2026 equinox instead of reading 0 (frame honesty)", () => {
    // Of-date λ☉ = 0 by definition at the equinox; the J2000 frame reads ≈ −0.368°.
    const lam = sunLambdaJ2000(utc("2026-03-20T14:46:00Z"));
    expect(lam).toBeGreaterThan(359.6);
    expect(lam).toBeLessThan(359.67);
  });
});

describe("lambdaToMs — the peak-date solver", () => {
  it("round-trips: λ☉(lambdaToMs(λ)) = λ to sub-arcminute", () => {
    for (const lam of [140.0, 262.2, 283.15, 32.32]) {
      const ms = lambdaToMs(lam, utc("2026-06-01T00:00:00Z"));
      let d = Math.abs(sunLambdaJ2000(ms) - lam) % 360;
      if (d > 180) d = 360 - d;
      expect(d).toBeLessThan(1e-4);
    }
  });

  it("puts the 2026 Perseid maximum (λ☉ 140.0) on Aug 12-13 (IMO calendar)", () => {
    const ms = lambdaToMs(PER.lamPeak, utc("2026-06-01T00:00:00Z"));
    expect(ms).toBeGreaterThan(utc("2026-08-12T00:00:00Z"));
    expect(ms).toBeLessThan(utc("2026-08-14T00:00:00Z"));
  });

  it("always solves forward from the anchor", () => {
    // Asking for the QUA peak (early January) in June must land the NEXT January.
    const ms = lambdaToMs(QUA.lamPeak, utc("2026-06-01T00:00:00Z"));
    expect(ms).toBeGreaterThan(utc("2026-12-25T00:00:00Z"));
    expect(ms).toBeLessThan(utc("2027-01-06T00:00:00Z"));
  });
});

describe("radiant drift", () => {
  it("returns the table radiant exactly at the peak instant", () => {
    const peakMs = lambdaToMs(PER.lamPeak, utc("2026-06-01T00:00:00Z"));
    const r = radiantAt(PER, peakMs);
    expect(r.raDeg).toBeCloseTo(PER.raDeg, 3);
    expect(r.decDeg).toBeCloseTo(PER.decDeg, 3);
  });

  it("applies the per-day IMO drift away from the peak", () => {
    const peakMs = lambdaToMs(PER.lamPeak, utc("2026-06-01T00:00:00Z"));
    const fiveDays = peakMs + 5 * 24 * 3600_000;
    const r = radiantAt(PER, fiveDays);
    // The day count is λ☉-derived, not calendar-derived (August runs ~3% under the mean
    // rate near aphelion) — assert within half a drift-day.
    expect(r.raDeg - PER.raDeg).toBeCloseTo(5 * PER.driftRa, 0);
    expect(r.decDeg - PER.decDeg).toBeCloseTo(5 * PER.driftDec, 0);
  });
});

describe("zhrAt — the Jenniskens activity profile", () => {
  const gemPeakMs = lambdaToMs(GEM.lamPeak, utc("2026-06-01T00:00:00Z"));

  it("equals the table ZHR at the peak and 0 outside the activity window", () => {
    // lambdaToMs solves λ☉ to <1e-4° — through 10^(−b·Δλ) that is ±0.02 on ZHR 150.
    expect(zhrAt(GEM, gemPeakMs)).toBeCloseTo(GEM.zhr!, 1);
    expect(zhrAt(GEM, utc("2026-06-15T00:00:00Z"))).toBe(0);
    expect(showerActive(GEM, utc("2026-06-15T00:00:00Z"))).toBe(false);
  });

  it("is asymmetric for the Geminids (shallow rise b=0.39, fast drop b=0.72)", () => {
    // Re-derive Δλ from the REAL λ☉ — December runs ~3% over the mean rate (perihelion).
    const wrap = (d: number) => ((((d % 360) + 540) % 360) - 180);
    const beforeMs = gemPeakMs - 2 * 24 * 3600_000;
    const afterMs = gemPeakMs + 2 * 24 * 3600_000;
    const before = zhrAt(GEM, beforeMs);
    const after = zhrAt(GEM, afterMs);
    expect(before).toBeGreaterThan(after);
    const dBefore = Math.abs(wrap(sunLambdaJ2000(beforeMs) - GEM.lamPeak));
    const dAfter = Math.abs(wrap(sunLambdaJ2000(afterMs) - GEM.lamPeak));
    expect(before).toBeCloseTo(GEM.zhr! * 10 ** (-GEM.bAsc! * dBefore), 6);
    expect(after).toBeCloseTo(GEM.zhr! * 10 ** (-GEM.bDesc! * dAfter), 6);
  });

  it("gives the Var outburst showers no curve (zhr null → 0 even at their peak)", () => {
    const jboPeak = lambdaToMs(JBO.lamPeak, utc("2026-06-01T00:00:00Z"));
    expect(zhrAt(JBO, jboPeak)).toBe(0);
    expect(showerActive(JBO, jboPeak)).toBe(true); // still active — the card shows the date
  });
});

describe("visibleRateAt — ZHR × sin(radiant alt)", () => {
  it("is 0 below the horizon and the sin-scaled ZHR above (identity re-derivation)", () => {
    const peakMs = lambdaToMs(GEM.lamPeak, utc("2026-06-01T00:00:00Z"));
    let seenUp = 0;
    for (let h = 0; h < 24; h++) {
      const ms = peakMs + h * 3600_000;
      const { altDeg } = radiantAzAlt(GEM, ms, DNIPRO.latDeg, DNIPRO.lonDeg);
      const rate = visibleRateAt(GEM, ms, DNIPRO.latDeg, DNIPRO.lonDeg);
      if (altDeg <= 0) {
        expect(rate).toBe(0);
      } else {
        seenUp++;
        const expected = zhrAt(GEM, ms) * Math.sin((altDeg * Math.PI) / 180);
        expect(rate).toBeCloseTo(expected, 9);
      }
    }
    expect(seenUp).toBeGreaterThan(0); // the radiant does rise from 48°N in December
  });
});

describe("meteorRateSeries — the rail-trace feed", () => {
  it("keeps the elevationSeries cadence contract", () => {
    const start = utc("2026-12-14T00:00:00Z");
    const s = meteorRateSeries(GEM, start, start + 6 * 3600_000, DNIPRO.latDeg, DNIPRO.lonDeg, 10);
    expect(s.length).toBe(37); // inclusive ends, 10-min step
    expect(s[1].utcMs - s[0].utcMs).toBe(600_000);
    expect(s.every((x) => x.rate >= 0)).toBe(true);
  });
});

describe("showerNights — moon-scored peak nights", () => {
  const nights = showerNights(utc("2026-12-12T00:00:00Z"), DNIPRO, GEM, { days: 4 });

  it("finds dark radiant-up windows for the Geminids from Dnipro", () => {
    expect(nights.length).toBe(4);
    expect(nights.some((n) => n.peak != null)).toBe(true);
  });

  it("re-derives its own invariants from the primitives (the mwSeason test discipline)", () => {
    for (const n of nights) {
      if (!n.peak) continue;
      // The peak sample sits in astronomical darkness with the radiant up.
      expect(
        horizontal("sun", n.peak.utcMs, DNIPRO.latDeg, DNIPRO.lonDeg).altDeg,
      ).toBeLessThanOrEqual(SHOWER_DARK_SUN_DEG);
      expect(n.peak.altDeg).toBeGreaterThan(0);
      expect(n.moonInterference).toBeGreaterThanOrEqual(0);
      expect(n.moonInterference).toBeLessThanOrEqual(1);
      expect(n.score).toBeCloseTo(n.peak.rate * (1 - n.moonInterference), 9);
      expect(n.usableMinutes).toBeGreaterThan(0);
    }
  });
});

describe("upcomingShowerPeaks — the METEORS card feed", () => {
  const peaks = upcomingShowerPeaks(utc("2026-08-01T00:00:00Z"), DNIPRO, 120);

  it("returns the autumn ladder in date order (PER first, LEO/AMO by late November)", () => {
    const codes = peaks.map((p) => p.row.code);
    expect(codes[0]).toBe("PER");
    expect(codes).toContain("ORI");
    expect(codes).toContain("LEO");
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i].peakMs).toBeGreaterThanOrEqual(peaks[i - 1].peakMs);
    }
  });

  it("attaches a best night to curve-bearing showers and keeps Var rows date-only", () => {
    const per = peaks.find((p) => p.row.code === "PER")!;
    expect(per.night).not.toBeNull();
    expect(per.night!.peak).not.toBeNull();
    // Whatever night wins, it must be within the ±1.5-day neighbourhood scanned.
    expect(Math.abs(per.night!.peak!.utcMs - per.peakMs)).toBeLessThan(2.5 * 24 * 3600_000);
  });
});

describe("showerTarget — the radiant as a SkyTarget", () => {
  const target = showerTarget(PER);

  it("rides the generic machinery: id namespace, short name, null magnitude", () => {
    expect(target.id).toBe("shower:PER");
    expect(target.kind).toBe("shower");
    expect(targetShortName(target)).toBe("PER");
    const s = target.stateAt(utc("2026-08-12T22:00:00Z"));
    expect(s.magnitude).toBeNull();
    expect(s.distanceAu).toBeNull();
  });

  it("agrees with radiantAzAlt through the independent targetAzAlt path", () => {
    const ms = utc("2026-08-12T22:00:00Z");
    const a = targetAzAlt(target, ms, DNIPRO.latDeg, DNIPRO.lonDeg);
    const b = radiantAzAlt(PER, ms, DNIPRO.latDeg, DNIPRO.lonDeg);
    const dAz = (a.azDeg - b.azDeg) * Math.cos((a.altDeg * Math.PI) / 180);
    expect(Math.hypot(dAz, a.altDeg - b.altDeg)).toBeLessThan(0.05);
  });

  it("drifts: the tracked radiant moves day to day", () => {
    const d0 = target.stateAt(utc("2026-08-01T00:00:00Z"));
    const d1 = target.stateAt(utc("2026-08-11T00:00:00Z"));
    expect(d1.raDeg - d0.raDeg).toBeCloseTo(10 * PER.driftRa, 0);
  });
});

describe("showerByCode + table sanity", () => {
  it("resolves case-insensitively and rejects unknowns", () => {
    expect(showerByCode("gem")?.name).toBe("Geminids");
    expect(showerByCode("XXX")).toBeNull();
  });

  it("every row is internally coherent", () => {
    const codes = new Set<string>();
    for (const row of SHOWERS) {
      expect(row.code).toMatch(/^[A-Z]{3}$/);
      expect(codes.has(row.code)).toBe(false);
      codes.add(row.code);
      expect(row.lamPeak).toBeGreaterThanOrEqual(0);
      expect(row.lamPeak).toBeLessThan(360);
      // The peak sits inside the activity window (wrap-aware).
      const span = (((row.lamEnd - row.lamStart) % 360) + 360) % 360;
      const into = (((row.lamPeak - row.lamStart) % 360) + 360) % 360;
      expect(into).toBeLessThanOrEqual(span);
      if (row.zhr != null) expect(row.zhr).toBeGreaterThan(0);
      expect(row.rIndex).toBeGreaterThan(1.5);
      expect(row.rIndex).toBeLessThan(3.6);
      expect(Math.abs(row.decDeg)).toBeLessThanOrEqual(90);
    }
    expect(SHOWERS.length).toBe(21);
  });
});
