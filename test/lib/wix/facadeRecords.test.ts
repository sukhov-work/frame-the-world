import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/lib/geo/geohash";
import {
  FACADE_ALIGNMENT_MAX_BYTES,
  FACADE_COVER_PRECISION,
  FACADE_IMAGE_MAX_BYTES,
  FACADE_IMAGE_MIME,
  FACADE_MAX_PER_MEMBER,
  FACADE_PAGE,
  FACADE_TARGET_IDS_MAX,
  FACADE_URL_PREFIX,
  FACADES_COLLECTION,
  applyFacadeUpdate,
  checkFacadeUploadRequest,
  derivePoseSource,
  facadeListItem,
  facadeRecord,
  facadeWorldItem,
  parseFacadePose,
  parseSaveFacadeBody,
  parseSkip,
  parseUpdateFacadeBody,
  safeFacadeFileName,
  sameFacadePose,
  verifyFacadeImageDescriptor,
  wrapHeadingDeg,
  type FacadePose,
  type SaveFacadeBody,
} from "../../../src/lib/wix/facadeRecords";

// PHOTO PROJECTION F2 persist (T169 / T172, 2026-10-21) — the FacadePhotos contract: the body
// parsers (every rejection names the field), the descriptor verdict, the record derivation, the
// read-modify-write PATCH and the row mappers' round trip through the JSON-in-TEXT columns.

const DISPLAY_ID = "166a86_0f3c6f1a9d2e4b7c8a1d2e3f4a5b6c7d~mv2.jpg";
const THUMB_ID = "166a86_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d~mv2.jpg";
const ORIGINAL_ID = "166a86_11112222333344445555666677778888.arw";

/** An IMAGE descriptor as the facade PUT returns it (the pins' `~mv2` shape, the thumb precedent). */
const DISPLAY_DESCRIPTOR = {
  id: DISPLAY_ID,
  url: `${FACADE_URL_PREFIX}${DISPLAY_ID}`,
  sizeInBytes: "482113",
  private: false,
  mediaType: "IMAGE",
  operationStatus: "READY",
};

const exifPose: FacadePose = {
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 112.4,
  altitudeM: 96,
  headingDeg: 214,
  pitchDeg: 4,
  rollDeg: 0.5,
  focalLengthMm: 6.86,
  hFovDeg: 69.4,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
};

const validBody = {
  ...exifPose,
  title: "  Kyiv facade ",
  strength: 0.9,
  ownLight: 0.4,
  rangeM: 450,
  capturedAt: "2026-05-03T07:15:02",
  cameraMake: "Apple",
  cameraModel: "iPhone 15 Pro",
  lensModel: "wide",
  fileName: "IMG_0412.jpg",
  fileSizeBytes: 2_500_000,
  originalFileId: ORIGINAL_ID,
  displayFileId: DISPLAY_ID,
  thumbFileId: THUMB_ID,
  targetFeatureIds: ["osm:123", "v3|cell-1|42"],
  alignment: { pairs: [] },
  exifPose,
};

const parse = (b: unknown): SaveFacadeBody => {
  const p = parseSaveFacadeBody(b);
  if ("error" in p) throw new Error(p.error);
  return p.body;
};
const err = (b: unknown): string | null => {
  const p = parseSaveFacadeBody(b);
  return "error" in p ? p.error : null;
};

/** A solve's output (T172 / F5): a pose off the EXIF baseline with unrounded doubles, and the
 *  alignment record carrying it verbatim in `solved.pose` (the `alignmentRecordOf` shape). */
const solvedPose = {
  lat: 48.464712345678901,
  lon: 35.046187654321098,
  altitudeM: 1.6180339887,
  headingDeg: 217.31415926535897,
  pitchDeg: 3.2718281828459,
  rollDeg: -0.41421356237,
  hFovDeg: 66.6066066066,
};
const poseFields = (p: typeof solvedPose) => ({ lat: p.lat, lon: p.lon, altitudeM: p.altitudeM, headingDeg: p.headingDeg, pitchDeg: p.pitchDeg, rollDeg: p.rollDeg, hFovDeg: p.hFovDeg });
const alignmentWith = (pose: Record<string, unknown>) => ({
  pairs: [
    { uv: [0.1, 0.2], enu: [10.5, 20.25, 3], target: "osm:w1" },
    { uv: [0.9, 0.2], enu: [14.5, 20.25, 3] },
    { uv: [0.1, 0.8], enu: [10.5, 20.25, 0] },
    { uv: [0.9, 0.8], enu: [14.5, 22.25, 0] },
  ],
  origin: { lat: 48.4647, lon: 35.0462, altM: 112.4 },
  solved: { pose, rmsPx: 1.25, n: 4, fovSolved: false, planar: false, at: "2026-10-24T10:00:00.000Z" },
});

const URLS = { displayUrl: DISPLAY_DESCRIPTOR.url, thumbUrl: `${FACADE_URL_PREFIX}${THUMB_ID}` };

describe("the constants", () => {
  it("the collection, the page, the rail, the cell precision, the URL prefix", () => {
    expect(FACADES_COLLECTION).toBe("FacadePhotos");
    expect(FACADE_PAGE).toBe(200);
    expect(FACADE_MAX_PER_MEMBER).toBe(5000);
    expect(FACADE_COVER_PRECISION).toBe(5);
    expect(FACADE_URL_PREFIX).toBe("https://static.wixstatic.com/media/");
  });
});

describe("wrapHeadingDeg", () => {
  it("wraps onto [0, 360) and folds -0", () => {
    expect(wrapHeadingDeg(-90)).toBe(270);
    expect(wrapHeadingDeg(360)).toBe(0);
    expect(wrapHeadingDeg(725)).toBe(5);
    expect(Object.is(wrapHeadingDeg(-0), 0)).toBe(true);
    expect(wrapHeadingDeg(214)).toBe(214);
  });
});

describe("parseSaveFacadeBody", () => {
  it("accepts a full valid body — the title trimmed, everything else verbatim", () => {
    expect(parse(validBody)).toEqual({ ...validBody, title: "Kyiv facade" });
  });

  it("defaults: projection 1 / 0.6 / null, empty seats, no EXIF pose, the file-name title, null optionals", () => {
    const {
      title: _t, strength: _s, ownLight: _o, rangeM: _r, targetFeatureIds: _ids, alignment: _a, exifPose: _e,
      thumbFileId: _th, originalFileId: _or, capturedAt: _c, altitudeM: _alt, focalLengthMm: _f, fovEstimated: _fe,
      textureWidth: _w, textureHeight: _h, fileSizeBytes: _fs, ...rest
    } = validBody;
    const body = parse(rest);
    expect(body.title).toBe("IMG_0412");
    expect(body.strength).toBe(1);
    expect(body.ownLight).toBe(0.6);
    expect(body.rangeM).toBeNull();
    expect(body.targetFeatureIds).toEqual([]);
    expect(body.alignment).toEqual({});
    expect(body.exifPose).toBeNull();
    expect(body.thumbFileId).toBeNull();
    expect(body.originalFileId).toBeNull();
    expect(body.capturedAt).toBeNull();
    expect(body.altitudeM).toBeNull();
    expect(body.focalLengthMm).toBeNull();
    expect(body.fovEstimated).toBe(false);
    expect(body.textureWidth).toBeNull();
    expect(body.fileSizeBytes).toBeNull();
    // A blank title and no file name → "Untitled" (the pin precedent).
    expect(parse({ ...rest, title: "   ", fileName: null }).title).toBe("Untitled");
  });

  it("wraps the heading onto [0, 360) — on the pose AND on the EXIF pose", () => {
    const body = parse({ ...validBody, headingDeg: -90, exifPose: { ...exifPose, headingDeg: 360 } });
    expect(body.headingDeg).toBe(270);
    expect(body.exifPose?.headingDeg).toBe(0);
  });

  it("names the offending field — every rail", () => {
    expect(err(null)).toMatch(/JSON object/);
    expect(err([])).toMatch(/JSON object/);
    const { lat: _l, ...noLat } = validBody;
    expect(err(noLat)).toMatch(/^lat is required/);
    expect(err({ ...validBody, lat: 91 })).toMatch(/^lat must/);
    expect(err({ ...validBody, lon: -181 })).toMatch(/^lon must/);
    expect(err({ ...validBody, apexAltM: 30_000 })).toMatch(/^apexAltM/);
    expect(err({ ...validBody, apexAltM: null })).toMatch(/^apexAltM/);
    expect(err({ ...validBody, altitudeM: "high" })).toMatch(/^altitudeM/);
    expect(err({ ...validBody, headingDeg: "north" })).toMatch(/^headingDeg/);
    expect(err({ ...validBody, headingDeg: Number.NaN })).toMatch(/^headingDeg/);
    expect(err({ ...validBody, pitchDeg: 91 })).toMatch(/^pitchDeg/);
    expect(err({ ...validBody, rollDeg: -181 })).toMatch(/^rollDeg/);
    expect(err({ ...validBody, focalLengthMm: 0 })).toMatch(/^focalLengthMm/);
    expect(err({ ...validBody, focalLengthMm: 5001 })).toMatch(/^focalLengthMm/);
    expect(err({ ...validBody, hFovDeg: 0.5 })).toMatch(/^hFovDeg/); // the interval is OPEN
    expect(err({ ...validBody, hFovDeg: 179.5 })).toMatch(/^hFovDeg/);
    expect(err({ ...validBody, fovEstimated: "yes" })).toMatch(/^fovEstimated/);
    expect(err({ ...validBody, textureWidth: 0 })).toMatch(/^textureWidth/);
    expect(err({ ...validBody, textureHeight: 100_001 })).toMatch(/^textureHeight/);
    expect(err({ ...validBody, strength: 1.1 })).toMatch(/^strength/);
    expect(err({ ...validBody, ownLight: -0.1 })).toMatch(/^ownLight/);
    expect(err({ ...validBody, rangeM: 5 })).toMatch(/^rangeM/);
    expect(err({ ...validBody, rangeM: 5001 })).toMatch(/^rangeM/);
    expect(err({ ...validBody, title: 7 })).toMatch(/^title/);
    expect(err({ ...validBody, title: "x".repeat(121) })).toMatch(/^title/);
    expect(err({ ...validBody, capturedAt: "x".repeat(41) })).toMatch(/^capturedAt/);
    expect(err({ ...validBody, cameraMake: "x".repeat(81) })).toMatch(/^cameraMake/);
    expect(err({ ...validBody, cameraModel: "x".repeat(81) })).toMatch(/^cameraModel/);
    expect(err({ ...validBody, lensModel: "x".repeat(121) })).toMatch(/^lensModel/);
    expect(err({ ...validBody, fileName: "x".repeat(256) })).toMatch(/^fileName/);
    expect(err({ ...validBody, fileSizeBytes: -1 })).toMatch(/^fileSizeBytes/);
    expect(err({ ...validBody, originalFileId: "x y" })).toMatch(/^originalFileId/);
    const { displayFileId: _d, ...noDisplay } = validBody;
    expect(err(noDisplay)).toMatch(/^displayFileId/);
    expect(err({ ...validBody, displayFileId: "../etc" })).toMatch(/^displayFileId/);
    expect(err({ ...validBody, thumbFileId: "bad id" })).toMatch(/^thumbFileId/);
    expect(err({ ...validBody, targetFeatureIds: "osm:1" })).toMatch(/^targetFeatureIds/);
    expect(err({ ...validBody, targetFeatureIds: [""] })).toMatch(/^targetFeatureIds/);
    expect(err({ ...validBody, targetFeatureIds: ["x".repeat(81)] })).toMatch(/^targetFeatureIds/);
    expect(err({ ...validBody, targetFeatureIds: Array.from({ length: FACADE_TARGET_IDS_MAX + 1 }, (_, i) => `osm:${i}`) })).toMatch(/^targetFeatureIds/);
    expect(err({ ...validBody, alignment: [] })).toMatch(/^alignment/);
    expect(err({ ...validBody, alignment: null })).toMatch(/^alignment/);
    expect(err({ ...validBody, alignment: { blob: "x".repeat(FACADE_ALIGNMENT_MAX_BYTES) } })).toMatch(/^alignment/);
    expect(err({ ...validBody, exifPose: "exif" })).toMatch(/^exifPose/);
    expect(err({ ...validBody, exifPose: { ...exifPose, lon: undefined } })).toMatch(/^exifPose\.lon is required/);
    expect(err({ ...validBody, exifPose: { ...exifPose, hFovDeg: 200 } })).toMatch(/^exifPose\.hFovDeg/);
  });

  it("the serialized-size rail on the seats measures UTF-8 bytes (200 ids × 80 chars overflows 8 KB)", () => {
    const ids = Array.from({ length: FACADE_TARGET_IDS_MAX }, (_, i) => `k${i}`.padEnd(80, "x"));
    expect(err({ ...validBody, targetFeatureIds: ids })).toMatch(/targetFeatureIds must serialize/);
  });
});

describe("parseUpdateFacadeBody", () => {
  it("requires the id and at least one editable field; file fields are simply not read", () => {
    const p = parseUpdateFacadeBody({ facadeId: "f1", lat: 48.5, title: " Wall ", rangeM: null, altitudeM: null, displayFileId: "evil", displayUrl: "https://evil" });
    if ("error" in p) throw new Error(p.error);
    expect(p.facadeId).toBe("f1");
    expect(p.body).toEqual({ lat: 48.5, title: "Wall", rangeM: null, altitudeM: null });
    expect("displayFileId" in p.body).toBe(false);
  });

  it("names the offending field under the SAVE rules", () => {
    const e = (b: unknown) => {
      const p = parseUpdateFacadeBody(b);
      return "error" in p ? p.error : null;
    };
    expect(e({ lat: 1 })).toMatch(/facadeId/);
    expect(e({ facadeId: "f1" })).toMatch(/nothing to change/);
    expect(e({ facadeId: "f1", displayFileId: "x" })).toMatch(/nothing to change/);
    expect(e({ facadeId: "f1", lat: 91 })).toMatch(/^lat/);
    expect(e({ facadeId: "f1", lat: null })).toMatch(/^lat/); // not nullable
    expect(e({ facadeId: "f1", hFovDeg: 0.5 })).toMatch(/^hFovDeg/);
    expect(e({ facadeId: "f1", title: "   " })).toMatch(/^title/);
    expect(e({ facadeId: "f1", strength: 2 })).toMatch(/^strength/);
    expect(e({ facadeId: "f1", alignment: 1 })).toMatch(/^alignment/);
    expect(e({ facadeId: "f1", headingDeg: -1 })).toBeNull();
  });
});

describe("verifyFacadeImageDescriptor — the descriptor is the allowlist", () => {
  it("accepts a public, bounded IMAGE under the static prefix and reads id + url", () => {
    expect(verifyFacadeImageDescriptor(DISPLAY_DESCRIPTOR)).toEqual({ ok: true, fileId: DISPLAY_ID, url: DISPLAY_DESCRIPTOR.url });
    const { id: _i, ...rest } = DISPLAY_DESCRIPTOR;
    expect(verifyFacadeImageDescriptor({ ...rest, _id: DISPLAY_ID }).ok).toBe(true);
  });

  it("refuses with a named verdict; NO_URL (async ingest) is the retryable one", () => {
    const code = (patch: Record<string, unknown>) => {
      const v = verifyFacadeImageDescriptor({ ...DISPLAY_DESCRIPTOR, ...patch });
      return v.ok ? "OK" : v.code;
    };
    expect(code({ mediaType: "MODEL3D" })).toBe("NOT_AN_IMAGE");
    expect(code({ private: true })).toBe("PRIVATE_FILE");
    expect(code({ sizeInBytes: String(FACADE_IMAGE_MAX_BYTES + 1) })).toBe("TOO_LARGE");
    expect(code({ sizeInBytes: FACADE_IMAGE_MAX_BYTES })).toBe("OK");
    expect(code({ operationStatus: "FAILED" })).toBe("INGEST_FAILED");
    expect(code({ url: undefined })).toBe("NO_URL");
    expect(code({ url: "https://evil.example/x.jpg" })).toBe("NO_URL");
    expect(code({ url: "http://static.wixstatic.com/media/x.jpg" })).toBe("NO_URL");
    expect(verifyFacadeImageDescriptor(null).ok).toBe(false);
  });
});

describe("checkFacadeUploadRequest — the kind:\"facade\" mint gate", () => {
  it("admits JPEG inside the cap with a sanitized .jpg name", () => {
    expect(checkFacadeUploadRequest("IMG_0412 display.jpeg", FACADE_IMAGE_MIME, 480_000)).toEqual({ ok: true, fileName: "IMG_0412-display.jpg" });
    expect(checkFacadeUploadRequest("x.jpg", "image/png", 100).ok).toBe(false);
    expect(checkFacadeUploadRequest("x.jpg", FACADE_IMAGE_MIME, 0).ok).toBe(false);
    expect(checkFacadeUploadRequest("x.jpg", FACADE_IMAGE_MIME, FACADE_IMAGE_MAX_BYTES + 1).ok).toBe(false);
  });

  it("safeFacadeFileName: basename only, safe characters, forced .jpg, bounded", () => {
    expect(safeFacadeFileName("../../etc/passwd.JPG")).toBe("passwd.jpg");
    expect(safeFacadeFileName("Дніпро wall (v2).png")).toBe("wall-v2.jpg");
    expect(safeFacadeFileName("IMG_0412")).toBe("IMG_0412.jpg");
    expect(safeFacadeFileName("   ")).toBe("facade.jpg");
    expect(safeFacadeFileName("a".repeat(300) + ".jpg").length).toBeLessThanOrEqual(200);
  });
});

describe("derivePoseSource — the D4 badge", () => {
  it("EXIF within 1e-9 on the six camera numbers; the heights are not compared; no baseline = MANUAL", () => {
    expect(derivePoseSource(exifPose, exifPose)).toBe("EXIF");
    expect(derivePoseSource({ ...exifPose, lat: exifPose.lat + 1e-12, apexAltM: 500, altitudeM: null }, exifPose)).toBe("EXIF");
    expect(derivePoseSource({ ...exifPose, headingDeg: 215 }, exifPose)).toBe("MANUAL");
    expect(derivePoseSource({ ...exifPose, hFovDeg: 70 }, exifPose)).toBe("MANUAL");
    expect(derivePoseSource(exifPose, null)).toBe("MANUAL");
  });

  it("SOLVED when the six numbers equal the solve's pose (T172 / F5); one angle 1e-6 off falls back to EXIF / MANUAL; null = the old answers", () => {
    const posed: FacadePose = { ...exifPose, ...poseFields(solvedPose), apexAltM: 120 };
    expect(derivePoseSource(posed, exifPose, solvedPose)).toBe("SOLVED");
    expect(derivePoseSource(posed, null, solvedPose)).toBe("SOLVED");
    // The heights are not compared (the solve's altitudeM is metres above the ground NOW).
    expect(derivePoseSource({ ...posed, altitudeM: null, apexAltM: 0 }, exifPose, solvedPose)).toBe("SOLVED");
    expect(derivePoseSource({ ...posed, headingDeg: posed.headingDeg + 1e-6 }, exifPose, solvedPose)).toBe("MANUAL");
    // A solve that landed exactly on the EXIF pose: off the solve by 1e-6 but ON the EXIF → EXIF.
    const onExif = { ...poseFields(solvedPose), lat: exifPose.lat, lon: exifPose.lon, headingDeg: exifPose.headingDeg, pitchDeg: exifPose.pitchDeg, rollDeg: exifPose.rollDeg + 1e-6, hFovDeg: exifPose.hFovDeg };
    expect(derivePoseSource(exifPose, exifPose, onExif)).toBe("EXIF");
    expect(derivePoseSource(posed, exifPose, null)).toBe("MANUAL");
    expect(derivePoseSource(posed, exifPose, undefined)).toBe("MANUAL");
    expect(derivePoseSource(exifPose, exifPose, null)).toBe("EXIF");
  });
});

describe("facadeRecord", () => {
  it("derives both geohash columns, stamps PRIVATE + the badge, serializes the JSON seats, copies the VERIFIED urls", () => {
    const row = facadeRecord(parse(validBody), "member-1", URLS);
    expect(row.ownerMemberId).toBe("member-1");
    expect(row.geohash9).toBe(encodeGeohash(validBody.lat, validBody.lon, 9));
    expect((row.geohash9 as string).length).toBe(9);
    expect(row.gh5).toBe(encodeGeohash(validBody.lat, validBody.lon, FACADE_COVER_PRECISION));
    expect((row.gh5 as string).length).toBe(5);
    expect(row.isPublic).toBe(false);
    expect(row.moderation).toBe("PRIVATE");
    expect(row.poseSource).toBe("EXIF");
    expect(row.displayUrl).toBe(URLS.displayUrl);
    expect(row.thumbUrl).toBe(URLS.thumbUrl);
    expect(row.displayFileId).toBe(DISPLAY_ID);
    expect(row.thumbFileId).toBe(THUMB_ID);
    expect(row.originalFileId).toBe(ORIGINAL_ID);
    expect(typeof row.targetFeatureIds).toBe("string");
    expect(JSON.parse(row.targetFeatureIds as string)).toEqual(validBody.targetFeatureIds);
    expect(JSON.parse(row.alignment as string)).toEqual(validBody.alignment);
    expect(JSON.parse(row.exifPose as string)).toEqual(exifPose);
    expect(row.title).toBe("Kyiv facade");
    expect(row.hFovDeg).toBe(69.4);
    expect(row.apexAltM).toBe(112.4);
    // A body cannot flip the C6 flags.
    const forced = facadeRecord(parse({ ...validBody, isPublic: true, moderation: "APPROVED" }), "member-1", URLS);
    expect(forced.isPublic).toBe(false);
    expect(forced.moderation).toBe("PRIVATE");
  });

  it("MANUAL when the pose departs from the EXIF baseline or there is none; a refused thumb stores NO thumb", () => {
    expect(facadeRecord(parse({ ...validBody, pitchDeg: 10 }), "m", URLS).poseSource).toBe("MANUAL");
    expect(facadeRecord(parse({ ...validBody, exifPose: null }), "m", URLS).poseSource).toBe("MANUAL");
    expect(facadeRecord(parse({ ...validBody, exifPose: null }), "m", URLS).exifPose).toBeNull();
    const noThumb = facadeRecord(parse(validBody), "m", { displayUrl: URLS.displayUrl, thumbUrl: null });
    expect(noThumb.thumbFileId).toBeNull();
    expect(noThumb.thumbUrl).toBeNull();
  });

  it("SOLVED when the body's pose equals its alignment's solved.pose; the alignment JSON round-trips; a NaN / missing solve field is not SOLVED", () => {
    const alignment = alignmentWith(poseFields(solvedPose));
    const row = facadeRecord(parse({ ...validBody, ...poseFields(solvedPose), alignment }), "m", URLS);
    expect(row.poseSource).toBe("SOLVED");
    expect(JSON.parse(row.alignment as string)).toEqual(alignment);
    expect(facadeListItem({ ...row, _id: "f9", _updatedDate: "2026-10-24T10:00:00.000Z", _createdDate: "2026-10-24T10:00:00.000Z" })?.alignment).toEqual(alignment);
    // The solve is a different pose than the body → the old rule (off the EXIF → MANUAL).
    expect(facadeRecord(parse({ ...validBody, ...poseFields(solvedPose), headingDeg: 1, alignment }), "m", URLS).poseSource).toBe("MANUAL");
    // A broken solve block never stamps SOLVED (NaN does not survive JSON — the parse sees null / a missing key).
    const { hFovDeg: _h, ...noFov } = poseFields(solvedPose);
    expect(facadeRecord(parse({ ...validBody, ...poseFields(solvedPose), alignment: alignmentWith(noFov) }), "m", URLS).poseSource).toBe("MANUAL");
    expect(facadeRecord({ ...parse({ ...validBody, ...poseFields(solvedPose) }), alignment: alignmentWith({ ...poseFields(solvedPose), pitchDeg: Number.NaN }) }, "m", URLS).poseSource).toBe("MANUAL");
    expect(facadeRecord(parse({ ...validBody, ...poseFields(solvedPose), alignment: alignmentWith({ ...poseFields(solvedPose), rollDeg: "0" }) }), "m", URLS).poseSource).toBe("MANUAL");
    // The fixture's `{ pairs: [] }` / `{}` carry no solve: EXIF as before.
    expect(facadeRecord(parse({ ...validBody, alignment: {} }), "m", URLS).poseSource).toBe("EXIF");
  });
});

const storedRow = (): Record<string, unknown> => ({
  ...facadeRecord(parse(validBody), "member-1", URLS),
  _id: "f1",
  _createdDate: new Date("2026-10-21T10:00:00Z"),
  _updatedDate: "2026-10-21T11:00:00.000Z",
});

describe("the row mappers — a record round-trips through the JSON-in-TEXT columns", () => {
  it("facadeListItem: the owner's row with the parsed seats, the EXIF pose, the badge and the dates", () => {
    const item = facadeListItem(storedRow());
    expect(item).not.toBeNull();
    expect(item!.id).toBe("f1");
    expect(item!.title).toBe("Kyiv facade");
    expect(item!.displayUrl).toBe(URLS.displayUrl);
    expect(item!.thumbUrl).toBe(URLS.thumbUrl);
    expect(item!.targetFeatureIds).toEqual(validBody.targetFeatureIds);
    expect(item!.alignment).toEqual(validBody.alignment);
    expect(item!.exifPose).toEqual(exifPose);
    expect(item!.poseSource).toBe("EXIF");
    expect(item!.createdAt).toBe("2026-10-21T10:00:00.000Z");
    expect(item!.updatedAt).toBe("2026-10-21T11:00:00.000Z");
    expect(item!.isPublic).toBe(false);
    expect(item!.moderation).toBe("PRIVATE");
    expect(item!.strength).toBe(0.9);
    expect(item!.rangeM).toBe(450);
    expect(item!.capturedAt).toBe("2026-05-03T07:15:02");
    expect(item!.fileSizeBytes).toBe(2_500_000);
    // The pose block is the saved pose, bit for bit.
    for (const k of Object.keys(exifPose) as (keyof FacadePose)[]) expect(item![k]).toBe(exifPose[k]);
  });

  it("facadeWorldItem: the C6-clean slim row — no owner, no file id, no original, no seats", () => {
    const w = facadeWorldItem(storedRow())!;
    expect(w.id).toBe("f1");
    expect(w.displayUrl).toBe(URLS.displayUrl);
    expect(w.updatedAt).toBe("2026-10-21T11:00:00.000Z");
    for (const k of ["ownerMemberId", "originalFileId", "displayFileId", "thumbFileId", "exifPose", "targetFeatureIds", "alignment", "poseSource", "geohash9", "gh5"]) {
      expect(k in w).toBe(false);
    }
  });

  it("corrupt JSON columns read empty; a row without a display url or a pose or an id is dropped", () => {
    const item = facadeListItem({ ...storedRow(), targetFeatureIds: "{nope", alignment: "[1]", exifPose: "null" })!;
    expect(item.targetFeatureIds).toEqual([]);
    expect(item.alignment).toEqual({});
    expect(item.exifPose).toBeNull();
    expect(facadeWorldItem({ ...storedRow(), displayUrl: null })).toBeNull();
    expect(facadeWorldItem({ ...storedRow(), hFovDeg: null })).toBeNull();
    expect(facadeWorldItem({ ...storedRow(), _id: undefined })).toBeNull();
  });

  it("the dates: a Date, a string, or a fallback that is still an ISO string", () => {
    const w = facadeWorldItem({ ...storedRow(), _updatedDate: new Date("2026-10-21T12:00:00Z") })!;
    expect(w.updatedAt).toBe("2026-10-21T12:00:00.000Z");
    const noDates = facadeListItem({ ...storedRow(), _updatedDate: undefined, _createdDate: undefined })!;
    expect(new Date(noDates.updatedAt).toISOString()).toBe(noDates.updatedAt);
    expect(noDates.createdAt).toBe(noDates.updatedAt);
  });
});

describe("applyFacadeUpdate — read-modify-write", () => {
  it("a lat change re-derives geohash9 + gh5 and stamps MANUAL; the file / owner / C6 columns never move", () => {
    const existing = storedRow();
    const { record, effective } = applyFacadeUpdate(existing, { lat: 48.9, title: "Moved" });
    expect(record._id).toBe("f1");
    expect(record.lat).toBe(48.9);
    expect(record.lon).toBe(validBody.lon);
    expect(record.geohash9).toBe(encodeGeohash(48.9, validBody.lon, 9));
    expect(record.gh5).toBe(encodeGeohash(48.9, validBody.lon, FACADE_COVER_PRECISION));
    expect(record.gh5).not.toBe(existing.gh5);
    expect(record.poseSource).toBe("MANUAL");
    expect(record.title).toBe("Moved");
    expect(effective.lat).toBe(48.9);
    expect(effective.hFovDeg).toBe(69.4);
    for (const k of ["ownerMemberId", "originalFileId", "displayFileId", "displayUrl", "thumbFileId", "thumbUrl", "exifPose", "isPublic", "moderation", "capturedAt", "fileName"]) {
      expect(record[k]).toEqual(existing[k]);
    }
  });

  it("a title-only patch keeps the stored badge (a SOLVED row stays SOLVED); back to the EXIF numbers reads EXIF again", () => {
    const solved = { ...storedRow(), poseSource: "SOLVED" };
    expect(applyFacadeUpdate(solved, { title: "Renamed" }).record.poseSource).toBe("SOLVED");
    expect(applyFacadeUpdate(solved, { strength: 0.5 }).record.poseSource).toBe("SOLVED");
    const moved = applyFacadeUpdate(storedRow(), { headingDeg: 300 }).record;
    expect(moved.poseSource).toBe("MANUAL");
    expect(applyFacadeUpdate(moved, { headingDeg: 214 }).record.poseSource).toBe("EXIF");
  });

  it("the JSON seats are re-serialized from the patch, and an untouched seat survives verbatim", () => {
    const { record } = applyFacadeUpdate(storedRow(), { targetFeatureIds: ["osm:9"] });
    expect(JSON.parse(record.targetFeatureIds as string)).toEqual(["osm:9"]);
    expect(JSON.parse(record.alignment as string)).toEqual(validBody.alignment);
    expect(record.poseSource).toBe("EXIF"); // a seat edit is not a pose edit
  });

  it("SOLVED (T172 / F5): pose + a matching alignment.solved → SOLVED; a later nudge → MANUAL; a title edit keeps it", () => {
    const solved = applyFacadeUpdate(storedRow(), { ...poseFields(solvedPose), alignment: alignmentWith(poseFields(solvedPose)) }).record;
    expect(solved.poseSource).toBe("SOLVED");
    expect(JSON.parse(solved.alignment as string)).toEqual(alignmentWith(poseFields(solvedPose)));
    // The stored alignment (parsed off the JSON column) is the effective one on a later edit.
    const nudged = applyFacadeUpdate(solved, { headingDeg: solvedPose.headingDeg + 0.5 }).record;
    expect(nudged.poseSource).toBe("MANUAL");
    expect(applyFacadeUpdate(nudged, { headingDeg: solvedPose.headingDeg }).record.poseSource).toBe("SOLVED");
    expect(applyFacadeUpdate(solved, { title: "Renamed" }).record.poseSource).toBe("SOLVED");
  });

  it("an alignment-only patch re-stamps against the STORED pose: a solve equal to it → SOLVED, any other → MANUAL", () => {
    const moved = applyFacadeUpdate(storedRow(), poseFields(solvedPose)).record;
    expect(moved.poseSource).toBe("MANUAL");
    expect(applyFacadeUpdate(moved, { alignment: alignmentWith(poseFields(solvedPose)) }).record.poseSource).toBe("SOLVED");
    expect(applyFacadeUpdate(moved, { alignment: alignmentWith({ ...poseFields(solvedPose), pitchDeg: 9 }) }).record.poseSource).toBe("MANUAL");
    // On an untouched EXIF row a non-matching solve leaves the EXIF badge.
    expect(applyFacadeUpdate(storedRow(), { alignment: alignmentWith(poseFields(solvedPose)) }).record.poseSource).toBe("EXIF");
  });
});

describe("parseFacadePose / sameFacadePose / parseSkip", () => {
  it("parseFacadePose labels nested errors and defaults the nullable fields", () => {
    const p = parseFacadePose({ lat: 1, lon: 2, apexAltM: 3, headingDeg: 4, pitchDeg: 5, rollDeg: 6, hFovDeg: 60 });
    if ("error" in p) throw new Error(p.error);
    expect(p.pose.altitudeM).toBeNull();
    expect(p.pose.fovEstimated).toBe(false);
    expect(p.pose.textureWidth).toBeNull();
    expect(parseFacadePose(null, "exifPose.")).toEqual({ error: "exifPose.must be an object" });
  });

  it("sameFacadePose compares every snapshot field exactly", () => {
    const a = { lat: 1, lon: 2, altitudeM: null, headingDeg: 3, pitchDeg: null, rollDeg: 0, hFovDeg: null };
    expect(sameFacadePose(a, { ...a })).toBe(true);
    expect(sameFacadePose(a, { ...a, pitchDeg: 0 })).toBe(false);
    expect(sameFacadePose(null, null)).toBe(true);
    expect(sameFacadePose(a, null)).toBe(false);
  });

  it("parseSkip: absent → 0, digits → the offset, anything else named", () => {
    expect(parseSkip(null)).toEqual({ skip: 0 });
    expect(parseSkip("")).toEqual({ skip: 0 });
    expect(parseSkip("400")).toEqual({ skip: 400 });
    expect("error" in parseSkip("-1")).toBe(true);
    expect("error" in parseSkip("1e3")).toBe(true);
  });
});
