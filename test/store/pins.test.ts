import { describe, expect, it } from "vitest";
import {
  needsRequery,
  pinFromItem,
  planPinsQuery,
  usePinsStore,
  viewportBounds,
  viewportSpanDeg,
  type Viewport,
} from "../../src/store/pins";
import { PINS } from "../../src/components/globe/tuning";
import { encodeGeohash } from "../../src/lib/geo/geohash";

const dnipro = (altM: number): Viewport => ({ latDeg: 48.4647, lonDeg: 35.0462, altM });

describe("viewportSpanDeg", () => {
  it("grows with altitude and clamps at both ends", () => {
    expect(viewportSpanDeg(100)).toBe(PINS.spanMinDeg);
    expect(viewportSpanDeg(80_000)).toBeCloseTo(80 * PINS.spanDegPerKm, 6);
    expect(viewportSpanDeg(1e9)).toBe(PINS.spanMaxDeg);
  });

  it("bounds clamp to the valid lat/lon domain", () => {
    const b = viewportBounds({ latDeg: 89.9, lonDeg: 179.95, altM: 80_000 });
    expect(b.latMax).toBe(90);
    expect(b.lonMax).toBe(180);
  });
});

describe("planPinsQuery", () => {
  it("goes global at LEO — a hemisphere cannot be cell-covered", () => {
    expect(planPinsQuery(dnipro(1_100_000))).toEqual({ mode: "global" });
    expect(planPinsQuery(dnipro(PINS.queryGlobalAltM))).toEqual({ mode: "global" });
  });

  it("uses gh4 cells at city scale with a sane cell count", () => {
    const plan = planPinsQuery(dnipro(50_000));
    if (plan.mode !== "cells") throw new Error("expected cells");
    expect(plan.precision).toBe(4);
    expect(plan.cells.length).toBeGreaterThan(0);
    expect(plan.cells.length).toBeLessThanOrEqual(120);
    expect(plan.cells.every((c) => c.length === 4)).toBe(true);
    // the viewport centre's own cell is part of the cover
    expect(plan.cells).toContain(encodeGeohash(48.4647, 35.0462, 4));
  });

  it("upgrades to gh6 at street level", () => {
    const plan = planPinsQuery(dnipro(1_500));
    if (plan.mode !== "cells") throw new Error("expected cells");
    expect(plan.precision).toBe(6);
    expect(plan.cells.every((c) => c.length === 6)).toBe(true);
  });
});

describe("needsRequery", () => {
  it("always queries the first viewport", () => {
    expect(needsRequery(null, dnipro(50_000))).toBe(true);
  });

  it("ignores small drift (the LEO idle drift must not spam Wix Data)", () => {
    const prev = dnipro(50_000);
    const next = { ...prev, latDeg: prev.latDeg + 0.01 }; // span at 50 km ≈ 0.55°
    expect(needsRequery(prev, next)).toBe(false);
  });

  it("fires on a real pan, a big zoom, and a tier flip", () => {
    const prev = dnipro(50_000);
    expect(needsRequery(prev, { ...prev, lonDeg: prev.lonDeg + 1 })).toBe(true);
    expect(needsRequery(prev, { ...prev, altM: 90_000 })).toBe(true); // >30% alt change
    expect(needsRequery(prev, { ...prev, altM: 2_000 })).toBe(true); // gh4 → gh6 tier
    expect(needsRequery(dnipro(200_000), dnipro(80_000))).toBe(true); // global → cells
  });

  it("never re-queries while both viewports are global", () => {
    expect(needsRequery(dnipro(500_000), { latDeg: -30, lonDeg: 100, altM: 900_000 })).toBe(false);
  });
});

describe("pinFromItem", () => {
  it("maps a well-formed item and defaults display + pose fields", () => {
    const pin = pinFromItem({ _id: "p1", latReduced: 48.46, lonReduced: 35.04, headingDeg: 214 });
    expect(pin).toMatchObject({
      id: "p1",
      title: "Untitled",
      lat: 48.46,
      lon: 35.04,
      precision: "1km",
      previewUrl: null,
      capturedAt: null,
      headingDeg: 214,
      pitchDeg: null,
      hFovDeg: null,
      cameraMake: null,
    });
  });

  it("drops rows without coordinates or id", () => {
    expect(pinFromItem({ _id: "p1", latReduced: "48" })).toBeNull();
    expect(pinFromItem({ latReduced: 1, lonReduced: 2 })).toBeNull();
  });
});

describe("Phase 5.5 S3 — authorName + highlight seam", () => {
  it("pinFromItem carries authorName (null on pre-S3 rows)", () => {
    const pin = pinFromItem({
      _id: "p1",
      latReduced: 48.46,
      lonReduced: 35.04,
      authorName: "Yevhen",
    });
    expect(pin?.authorName).toBe("Yevhen");
    const old = pinFromItem({ _id: "p2", latReduced: 48.46, lonReduced: 35.04 });
    expect(old?.authorName).toBeNull();
  });

  it("highlight() mirrors the pin id for the globe layer and clears with null", () => {
    usePinsStore.getState().highlight("pin-9");
    expect(usePinsStore.getState().highlightId).toBe("pin-9");
    usePinsStore.getState().highlight(null);
    expect(usePinsStore.getState().highlightId).toBeNull();
  });
});
