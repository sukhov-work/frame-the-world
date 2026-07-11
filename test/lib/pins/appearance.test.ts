import { describe, expect, it } from "vitest";
import {
  clusterLayout,
  hash01,
  hashString,
  pinHueIndex,
  proximityFactor,
  ringRadiusM,
  trueBlend,
  type StaggerPin,
} from "../../../src/lib/pins/appearance";

describe("hashString / hash01", () => {
  it("is deterministic and spread across inputs", () => {
    expect(hashString("Yevhen Sukhov")).toBe(hashString("Yevhen Sukhov"));
    expect(hashString("Yevhen Sukhov")).not.toBe(hashString("Svitlana Berlova"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("maps to [0, 1)", () => {
    for (const s of ["", "a", "frame-p5-tester", "Свiтлана", "🌍"]) {
      const h = hash01(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("pinHueIndex", () => {
  const WEIGHTS = [3.5, 2, 2, 2, 0.5] as const; // teal-heavy, warm rare (mirrors tuning)
  const SALT = "pin:"; // the tuned palette seed (mirrors PINS.hueSalt)

  it("is stable per author and anchors anonymous pins at 0", () => {
    expect(pinHueIndex("Yevhen Sukhov", WEIGHTS, SALT)).toBe(pinHueIndex("Yevhen Sukhov", WEIGHTS, SALT));
    expect(pinHueIndex(null, WEIGHTS, SALT)).toBe(0);
    expect(pinHueIndex("", WEIGHTS, SALT)).toBe(0);
  });

  it("always lands inside the palette", () => {
    for (let i = 0; i < 200; i++) {
      const idx = pinHueIndex(`author-${i}`, WEIGHTS, SALT);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(WEIGHTS.length);
    }
  });

  it("respects the weighting (teal common, warm rare)", () => {
    const counts = new Array(WEIGHTS.length).fill(0);
    for (let i = 0; i < 500; i++) counts[pinHueIndex(`member ${i}`, WEIGHTS, SALT)]++;
    expect(counts[0]).toBeGreaterThan(counts[4]); // anchor beats the rare warm
    expect(counts[4]).toBeGreaterThan(0); // …but the warm voice does exist
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });

  it("the three live authors resolve to distinct hues (DoD fixture)", () => {
    // The S3 back-fill's real author labels — S4's DoD wants them visually distinct.
    const live = ["Svitlana Berlova", "Yevhen Sukhov", "frame-p5-tester"];
    const picks = new Set(live.map((a) => pinHueIndex(a, WEIGHTS, SALT)));
    expect(picks.size).toBe(live.length);
  });
});

describe("clusterLayout", () => {
  const pin = (id: string, lat: number, lon: number): StaggerPin => ({ id, lat, lon });

  it("keeps a lone pin at its own hash height, unscattered", () => {
    const l = clusterLayout([pin("solo", 48.4647, 35.0462)]);
    expect(l.stagger01).toEqual([hash01("solo")]);
    expect(l.offsetE).toEqual([0]);
    expect(l.offsetN).toEqual([0]);
  });

  it("de-levels pins sharing a gh6 cell to evenly spaced height slots", () => {
    // Same spot → same gh6 cell, guaranteed.
    const l = clusterLayout([
      pin("aaa", 48.4647, 35.0462),
      pin("bbb", 48.4647, 35.0462),
      pin("ccc", 48.4647, 35.0462),
    ]);
    const sorted = [...l.stagger01].sort((x, y) => x - y);
    expect(sorted).toEqual([0.5 / 3, 1.5 / 3, 2.5 / 3]);
    // Adjacent pins never level: minimum separation is the full slot width.
    expect(sorted[1] - sorted[0]).toBeCloseTo(1 / 3, 10);
    expect(sorted[2] - sorted[1]).toBeCloseTo(1 / 3, 10);
  });

  it("gives same-cell pins unit ring slots at distinct angles + cluster membership", () => {
    const l = clusterLayout([
      pin("aaa", 48.4647, 35.0462),
      pin("bbb", 48.4647, 35.0462),
      pin("ccc", 48.4647, 35.0462),
    ]);
    const angles = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const r = Math.hypot(l.offsetE[i], l.offsetN[i]);
      expect(r).toBeCloseTo(1, 10); // unit slot — the render layer applies the adaptive radius
      angles.add(Math.round((Math.atan2(l.offsetE[i], l.offsetN[i]) * 180) / Math.PI));
      expect(l.clusterOf[i]).toBe(0); // all three in the one cluster
    }
    expect(angles.size).toBe(3); // evenly spaced — no two pins share a bearing
    expect(l.clusters).toHaveLength(1);
    expect([...l.clusters[0]].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("is input-order independent (layout depends on the set, not the array)", () => {
    const ps = [
      pin("p1", 50.45, 30.52),
      pin("p2", 50.45, 30.52),
      pin("p3", 50.45, 30.52),
      pin("far", 48.46, 35.05),
    ];
    const l1 = clusterLayout(ps);
    const rev = [...ps].reverse();
    const l2 = clusterLayout(rev);
    for (let i = 0; i < ps.length; i++) {
      const j = rev.indexOf(ps[i]);
      expect(l2.stagger01[j]).toBe(l1.stagger01[i]);
      expect(l2.offsetE[j]).toBe(l1.offsetE[i]);
      expect(l2.offsetN[j]).toBe(l1.offsetN[i]);
    }
  });

  it("pins in different cells stay solo: hash heights, no slots, no cluster", () => {
    const l = clusterLayout([pin("aaa", 48.46, 35.05), pin("bbb", 50.45, 30.52)]);
    expect(l.stagger01).toEqual([hash01("aaa"), hash01("bbb")]);
    expect(l.offsetE).toEqual([0, 0]);
    expect(l.offsetN).toEqual([0, 0]);
    expect(l.clusterOf).toEqual([-1, -1]);
    expect(l.clusters).toEqual([]);
  });

  it("stays in [0, 1) for many colocated pins", () => {
    const l = clusterLayout(Array.from({ length: 40 }, (_, i) => pin(`p${i}`, 41.0, 29.0)));
    for (const h of l.stagger01) {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("adaptive de-cluster math (owner 2026-07-11)", () => {
  it("ringRadiusM spaces n heads at least sepM apart (neighbor chord)", () => {
    // n=2: opposite slots → chord = 2r → r = sep/2.
    expect(ringRadiusM(2, 100)).toBeCloseTo(50, 10);
    // n=3: chord = 2r·sin(60°) → r = sep/√3.
    expect(ringRadiusM(3, 100)).toBeCloseTo(100 / Math.sqrt(3), 10);
    // Solo needs no ring.
    expect(ringRadiusM(1, 100)).toBe(0);
    // The neighbor chord always covers sepM.
    for (const n of [2, 3, 5, 12]) {
      const r = ringRadiusM(n, 80);
      expect(2 * r * Math.sin(Math.PI / n)).toBeCloseTo(80, 8);
    }
  });

  it("proximityFactor: 1 below lo, 0 above hi, monotone between", () => {
    expect(proximityFactor(200_000, 250_000, 300_000)).toBe(1); // fully spread below lo
    expect(proximityFactor(350_000, 250_000, 300_000)).toBe(0); // collapsed above hi
    const mid = proximityFactor(275_000, 250_000, 300_000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(proximityFactor(260_000, 250_000, 300_000)).toBeGreaterThan(mid);
  });

  it("trueBlend hands over to truth once real separation covers the required one", () => {
    expect(trueBlend(0, 100)).toBe(0); // identical coords never separate on their own
    expect(trueBlend(50, 100)).toBeCloseTo(0.5, 10);
    expect(trueBlend(150, 100)).toBe(1); // enough room — truthful placement
    expect(trueBlend(10, 0)).toBe(1); // degenerate required-sep → truth
  });
});
