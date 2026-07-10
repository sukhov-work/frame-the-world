import { describe, expect, it } from "vitest";
import {
  parseSavePinBody,
  photoListItem,
  photoRecord,
  PIN_QUOTA_FREE,
  publicPinRecord,
  type SavePinBody,
} from "../../../src/lib/wix/pinRecords";
import { reduceLocation } from "../../../src/lib/geo/precision";

const LAT = 48.4647;
const LON = 35.0462;

const validRaw = {
  title: "Dnipro rooftop",
  lat: LAT,
  lon: LON,
  altitudeM: 96,
  headingDeg: 214,
  pitchDeg: 2,
  rollDeg: 0.5,
  focalLengthMm: 6.86,
  hFovDeg: 73.7,
  fovEstimated: false,
  capturedAt: "2026-05-03T07:15:02",
  cameraMake: "Apple",
  cameraModel: "iPhone 15 Pro",
  lensModel: "wide",
  textureWidth: 3136,
  textureHeight: 2084,
  fileName: "gps-heading.jpg",
  fileSizeBytes: 2500,
  originalFileId: "orig-1",
  previewFileId: "prev-1",
  previewUrl: "https://static.wixstatic.com/media/prev-1.jpg",
  isPublic: true,
  precision: "1km",
};

function valid(): SavePinBody {
  const parsed = parseSavePinBody(validRaw);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.body;
}

describe("parseSavePinBody", () => {
  it("accepts a full valid body", () => {
    const body = valid();
    expect(body.lat).toBe(LAT);
    expect(body.precision).toBe("1km");
    expect(body.isPublic).toBe(true);
  });

  it("rejects non-object, bad lat/lon, and bad tier", () => {
    expect(parseSavePinBody(null)).toHaveProperty("error");
    expect(parseSavePinBody("x")).toHaveProperty("error");
    expect(parseSavePinBody({ ...validRaw, lat: 91 })).toHaveProperty("error");
    expect(parseSavePinBody({ ...validRaw, lon: "35" })).toHaveProperty("error");
    expect(parseSavePinBody({ ...validRaw, precision: "street" })).toHaveProperty("error");
  });

  it("nulls out-of-range optionals instead of failing the save", () => {
    const parsed = parseSavePinBody({ ...validRaw, headingDeg: 9999, cameraMake: "" });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.headingDeg).toBeNull();
    expect(parsed.body.cameraMake).toBeNull();
  });

  it("defaults a missing title", () => {
    const parsed = parseSavePinBody({ ...validRaw, title: undefined });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.title).toBe("Untitled");
  });
});

describe("photoRecord (private)", () => {
  it("keeps EXACT gps + owner and derives geohash9", () => {
    const rec = photoRecord(valid(), "member-1");
    expect(rec.lat).toBe(LAT);
    expect(rec.lon).toBe(LON);
    expect(rec.ownerMemberId).toBe("member-1");
    expect(rec.geohash9).toHaveLength(9);
    expect(rec.publicPrecision).toBe("1km");
  });

  it("clears publicPrecision when the pin is private", () => {
    const rec = photoRecord({ ...valid(), isPublic: false }, "member-1");
    expect(rec.publicPrecision).toBeNull();
  });
});

describe("publicPinRecord (C6 — BINDING)", () => {
  it("emits ONLY reduced-derived location fields for a reduced tier", () => {
    const rec = publicPinRecord(valid(), "photo-1");
    const reduced = reduceLocation(LAT, LON, "1km");
    expect(rec.latReduced).toBe(reduced.latReduced);
    expect(rec.lonReduced).toBe(reduced.lonReduced);
    expect(rec.geohash).toBe(reduced.geohash);
    // the exact capture coordinates appear NOWHERE in the public record
    const flat = JSON.stringify(rec);
    expect(flat).not.toContain(String(LAT));
    expect(flat).not.toContain(String(LON));
    // and no un-reduced field names leak through
    expect(rec).not.toHaveProperty("lat");
    expect(rec).not.toHaveProperty("lon");
    expect(rec).not.toHaveProperty("geohash9");
    expect(rec).not.toHaveProperty("ownerMemberId");
  });

  it("cannot be fooled by client-supplied 'reduced' fields", () => {
    const parsed = parseSavePinBody({
      ...validRaw,
      latReduced: LAT, // attacker-style extras must be dropped by the parser
      lonReduced: LON,
      gh6: "attack",
    });
    if ("error" in parsed) throw new Error(parsed.error);
    const rec = publicPinRecord(parsed.body, "photo-1");
    const reduced = reduceLocation(LAT, LON, "1km");
    expect(rec.latReduced).toBe(reduced.latReduced);
    expect(rec.gh6).toBe(reduced.gh6);
  });

  it("exact tier is an explicit opt-in that passes coordinates through", () => {
    const rec = publicPinRecord({ ...valid(), precision: "exact" }, "photo-1");
    expect(rec.latReduced).toBe(LAT);
    expect(rec.precision).toBe("exact");
  });

  it("references the photo and carries display fields", () => {
    const rec = publicPinRecord(valid(), "photo-1");
    expect(rec.photoRef).toBe("photo-1");
    expect(rec.title).toBe("Dnipro rooftop");
    expect(rec.previewUrl).toBe(validRaw.previewUrl);
    expect(rec.capturedAt).toBe(validRaw.capturedAt);
  });
});

describe("quota constant", () => {
  it("free tier is 10 pins (plan §Phase 5)", () => {
    expect(PIN_QUOTA_FREE).toBe(10);
  });
});

describe("photoListItem (GET /api/photos rows)", () => {
  it("maps a stored Photos item to the slim owner list row", () => {
    const row = photoListItem({
      _id: "p1",
      _createdDate: new Date("2026-07-10T15:43:00.737Z"),
      title: "gps-heading",
      previewUrl: "https://static.wixstatic.com/media/x.jpg",
      capturedAt: "2026-05-03T07:15:02",
      lat: 48.4647,
      lon: 35.0462,
      isPublic: true,
      publicPrecision: "1km",
    });
    expect(row).toEqual({
      id: "p1",
      title: "gps-heading",
      previewUrl: "https://static.wixstatic.com/media/x.jpg",
      capturedAt: "2026-05-03T07:15:02",
      lat: 48.4647,
      lon: 35.0462,
      isPublic: true,
      publicPrecision: "1km",
      createdAt: "2026-07-10T15:43:00.737Z",
    });
  });

  it("defaults missing fields and drops id-less rows", () => {
    const row = photoListItem({ _id: "p2" });
    expect(row).toMatchObject({
      title: "Untitled",
      previewUrl: null,
      isPublic: false,
      publicPrecision: null,
      createdAt: null,
    });
    expect(photoListItem({ title: "no id" })).toBeNull();
  });
});
