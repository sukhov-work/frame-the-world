import { describe, expect, it } from "vitest";
import {
  applyPinUpdate,
  authorLabel,
  parseSavePinBody,
  parseUpdatePinBody,
  photoListItem,
  photoRecord,
  PIN_QUOTA_FREE,
  PIN_QUOTA_PREMIUM,
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

  it("defaults the marketplace listing fields to null (a fresh pin is not for sale)", () => {
    const rec = publicPinRecord(valid(), "photo-1");
    expect(rec.productId).toBeNull();
    expect(rec.productVariantId).toBeNull();
    expect(rec.priceAmount).toBeNull();
    expect(rec.currency).toBeNull();
  });

  it("carries a supplied listing through (Phase 6 — a PATCH rebuild must not drop 'for sale')", () => {
    const rec = publicPinRecord(valid(), "photo-1", "Yevhen", {
      productId: "prod-1",
      variantId: "var-1",
      priceAmount: 12.5,
      currency: "USD",
    });
    expect(rec.productId).toBe("prod-1");
    // variantId is REQUIRED at checkout — it must survive a PATCH rebuild onto the public row.
    expect(rec.productVariantId).toBe("var-1");
    expect(rec.priceAmount).toBe(12.5);
    expect(rec.currency).toBe("USD");
  });

  it("references the photo and carries display fields", () => {
    const rec = publicPinRecord(valid(), "photo-1");
    expect(rec.photoRef).toBe("photo-1");
    expect(rec.title).toBe("Dnipro rooftop");
    expect(rec.previewUrl).toBe(validRaw.previewUrl);
    expect(rec.capturedAt).toBe(validRaw.capturedAt);
  });
});

describe("quota constants", () => {
  it("free tier is 100 pins (owner re-ruling 2026-07-17, supersedes D8's 10)", () => {
    expect(PIN_QUOTA_FREE).toBe(100);
  });

  it("premium tier is a 1000-pin hard ceiling (was 'unlimited')", () => {
    expect(PIN_QUOTA_PREMIUM).toBe(1000);
    expect(PIN_QUOTA_PREMIUM).toBeGreaterThan(PIN_QUOTA_FREE);
  });
});

describe("photoListItem (GET /api/photos rows)", () => {
  it("maps a stored Photos item to the owner list row (incl. pose for re-opening)", () => {
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
      headingDeg: 214,
      hFovDeg: 73.7,
      textureWidth: 4032,
    });
    expect(row).toMatchObject({
      id: "p1",
      title: "gps-heading",
      previewUrl: "https://static.wixstatic.com/media/x.jpg",
      capturedAt: "2026-05-03T07:15:02",
      lat: 48.4647,
      lon: 35.0462,
      isPublic: true,
      publicPrecision: "1km",
      createdAt: "2026-07-10T15:43:00.737Z",
      headingDeg: 214,
      hFovDeg: 73.7,
      textureWidth: 4032,
      pitchDeg: null,
      cameraMake: null,
    });
  });

  it("publicPinRecord carries pose (orientation, never exact coordinates)", () => {
    const rec = publicPinRecord(valid(), "photo-1");
    expect(rec.headingDeg).toBe(214);
    expect(rec.hFovDeg).toBe(73.7);
    expect(rec.textureWidth).toBe(3136);
    expect(rec.cameraModel).toBe("iPhone 15 Pro");
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

describe("authorLabel (Phase 5.5 S3)", () => {
  it("prefers nickname, then the email user part, then the generic label", () => {
    expect(authorLabel("Yevhen", "y@example.com")).toBe("Yevhen");
    expect(authorLabel(null, "frame-p5-tester@example.com")).toBe("frame-p5-tester");
    expect(authorLabel(undefined, undefined)).toBe("Member");
    expect(authorLabel("", "")).toBe("Member");
  });

  it("publicPinRecord denormalizes it (and defaults to null)", () => {
    expect(publicPinRecord(valid(), "photo-1", "Yevhen").authorName).toBe("Yevhen");
    expect(publicPinRecord(valid(), "photo-1").authorName).toBeNull();
  });
});

describe("parseUpdatePinBody (PATCH /api/photos)", () => {
  it("requires photoId on top of a valid save body", () => {
    expect(parseUpdatePinBody({ ...validRaw })).toHaveProperty("error");
    expect(parseUpdatePinBody(null)).toHaveProperty("error");
    const parsed = parseUpdatePinBody({ ...validRaw, photoId: "p1" });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.photoId).toBe("p1");
    expect(parsed.body.lat).toBe(LAT);
  });

  it("still rejects invalid pin fields", () => {
    expect(parseUpdatePinBody({ ...validRaw, photoId: "p1", lat: 91 })).toHaveProperty("error");
  });
});

describe("applyPinUpdate (PATCH merge — media continuity + C6 re-reduction)", () => {
  const existing = {
    _id: "p1",
    _createdDate: "2026-07-10T15:43:00.737Z",
    ownerMemberId: "member-1",
    title: "old name",
    lat: 48.0,
    lon: 35.0,
    fileName: "gps-heading.jpg",
    fileSizeBytes: 2500,
    originalFileId: "orig-stored",
    previewFileId: "prev-stored",
    previewUrl: "https://static.wixstatic.com/media/stored.jpg",
    isPublic: true,
    publicPrecision: "1km",
    publicPinId: "pin-1",
  };

  function updateBody(overrides: Record<string, unknown> = {}): SavePinBody {
    // The client edit flow sends no media fields — they arrive null from the parser.
    const parsed = parseSavePinBody({
      ...validRaw,
      originalFileId: undefined,
      previewFileId: undefined,
      previewUrl: undefined,
      fileName: undefined,
      fileSizeBytes: undefined,
      ...overrides,
    });
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed.body;
  }

  it("keeps stored media/file fields when the patch carries none", () => {
    const { record, effective } = applyPinUpdate(existing, updateBody());
    expect(record.originalFileId).toBe("orig-stored");
    expect(record.previewFileId).toBe("prev-stored");
    expect(record.previewUrl).toBe("https://static.wixstatic.com/media/stored.jpg");
    expect(record.fileName).toBe("gps-heading.jpg");
    expect(record.fileSizeBytes).toBe(2500);
    expect(effective.previewUrl).toBe("https://static.wixstatic.com/media/stored.jpg");
  });

  it("keeps identity (_id, owner, publicPinId) while applying edits", () => {
    const { record } = applyPinUpdate(existing, updateBody({ title: "new name" }));
    expect(record._id).toBe("p1");
    expect(record.ownerMemberId).toBe("member-1");
    expect(record.publicPinId).toBe("pin-1");
    expect(record.title).toBe("new name");
    expect(record.lat).toBe(LAT); // the moved location lands in the private row
  });

  it("a location edit re-reduces the public row to the new cell centre (C6)", () => {
    const { effective } = applyPinUpdate(existing, updateBody());
    const rec = publicPinRecord(effective, "p1", "Yevhen");
    const reduced = reduceLocation(LAT, LON, "1km");
    expect(rec.latReduced).toBe(reduced.latReduced);
    expect(rec.lonReduced).toBe(reduced.lonReduced);
    expect(JSON.stringify(rec)).not.toContain(String(LAT));
  });

  it("going private clears publicPrecision on the row", () => {
    const { record } = applyPinUpdate(existing, updateBody({ isPublic: false }));
    expect(record.publicPrecision).toBeNull();
    expect(record.isPublic).toBe(false);
  });
});
