import { describe, expect, it } from "vitest";
import { arrivalAltM, parseNominatim, parsePhoton } from "../../../src/lib/geo/geocode";
import { SEARCH } from "../../../src/components/globe/tuning";

/** Trimmed real-shape Photon response: a city with an extent + an extent-less POI. */
const PHOTON_FIXTURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [35.0462, 48.4647] },
      properties: {
        name: "Dnipro",
        country: "Ukraine",
        state: "Dnipropetrovsk Oblast",
        // [minLon, maxLat, maxLon, minLat] — Photon's order
        extent: [34.7539, 48.5577, 35.2643, 48.3577],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.2945, 48.8583] },
      properties: {
        name: "Eiffel Tower",
        city: "Paris",
        country: "France",
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: ["garbage", null] },
      properties: { name: "Broken row — must be skipped" },
    },
  ],
};

/** Trimmed real-shape Nominatim jsonv2 response (strings for lat/lon + boundingbox). */
const NOMINATIM_FIXTURE = [
  {
    lat: "40.7484",
    lon: "-73.9967",
    display_name: "10001, Manhattan, New York, United States",
    // [latMin, latMax, lonMin, lonMax] — Nominatim's order
    boundingbox: ["40.7392", "40.7576", "-74.0083", "-73.9851"],
  },
  { lat: "not-a-number", lon: "0", display_name: "Broken row" },
];

describe("parsePhoton", () => {
  const hits = parsePhoton(PHOTON_FIXTURE);

  it("maps [lon, lat] coordinates and composes the detail line (deduped, ordered)", () => {
    expect(hits).toHaveLength(2); // broken row dropped
    expect(hits[0]).toMatchObject({ name: "Dnipro", latDeg: 48.4647, lonDeg: 35.0462 });
    expect(hits[0].detail).toBe("Dnipropetrovsk Oblast, Ukraine");
    expect(hits[1].detail).toBe("Paris, France");
  });

  it("derives spanDeg from the extent (lon span cos-corrected) and omits it without one", () => {
    // latSpan = 0.2, lonSpan = 0.5104 × cos(48.46°) ≈ 0.3386 → max = latSpan? No: 0.3386 > 0.2
    expect(hits[0].spanDeg).toBeCloseTo(0.3386, 3);
    expect(hits[1].spanDeg).toBeUndefined();
  });

  it("returns [] on malformed payloads instead of throwing", () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({})).toEqual([]);
    expect(parsePhoton({ features: "nope" })).toEqual([]);
  });

  it("caps at the requested limit", () => {
    expect(parsePhoton(PHOTON_FIXTURE, 1)).toHaveLength(1);
  });
});

describe("parseNominatim", () => {
  const hits = parseNominatim(NOMINATIM_FIXTURE);

  it("parses string lat/lon, splits display_name into name + trailing context", () => {
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("10001");
    expect(hits[0].detail).toBe("Manhattan, New York, United States");
    expect(hits[0].latDeg).toBeCloseTo(40.7484);
    expect(hits[0].lonDeg).toBeCloseTo(-73.9967);
  });

  it("derives spanDeg from boundingbox [latMin, latMax, lonMin, lonMax]", () => {
    // latSpan 0.0184; lonSpan 0.0232 × cos(40.75°) ≈ 0.01758 → max = latSpan 0.0184
    expect(hits[0].spanDeg).toBeCloseTo(0.0184, 3);
  });

  it("returns [] on malformed payloads", () => {
    expect(parseNominatim(null)).toEqual([]);
    expect(parseNominatim({ not: "an array" })).toEqual([]);
  });
});

describe("arrivalAltM", () => {
  it("uses the default altitude when the result has no extent", () => {
    expect(arrivalAltM(undefined)).toBe(SEARCH.altDefaultM);
    expect(arrivalAltM(0)).toBe(SEARCH.altDefaultM);
    expect(arrivalAltM(Number.NaN)).toBe(SEARCH.altDefaultM);
  });

  it("clamps tiny extents to the terrain-safe floor (flight is terrain-blind until S2)", () => {
    expect(arrivalAltM(0.001)).toBe(SEARCH.altMinM); // ~111 m extent → floor
  });

  it("scales city extents into kilometres of altitude", () => {
    // Dnipro fixture span ≈ 0.3386° ≈ 37.7 km → × factor 1.1 ≈ 41.5 km
    const alt = arrivalAltM(0.3386);
    expect(alt).toBeGreaterThan(30_000);
    expect(alt).toBeLessThan(60_000);
  });

  it("caps whole-country extents below orbit", () => {
    expect(arrivalAltM(40)).toBe(SEARCH.altMaxM);
  });
});
