import { describe, expect, it } from "vitest";
import type { PhotoExif } from "../../../src/lib/decode/extract";
import { derivedFov, effectiveHFovDeg, exifBaselineParams } from "../../../src/lib/decode/params";
import { buildSaveFacadeBody, buildUpdateFacadeBody, exifPoseOf, type FacadeSnapshot } from "../../../src/lib/save/facadeBody";
import { parseSaveFacadeBody, parseUpdateFacadeBody } from "../../../src/lib/wix/facadeRecords";

// PHOTO PROJECTION F2 persist (T169, 2026-10-21) — the snapshot → body mapping: the ONE H-FOV
// derivation (`effectiveHFovDeg`), the roll / heading / pitch fallbacks, the title fallback, the
// update body without file fields — and both bodies pass the server parsers (the wire is one contract).

const exif: PhotoExif = {
  make: "Apple",
  model: "iPhone 15 Pro",
  lensModel: "wide",
  focalLengthMm: 6.86,
  focalLengthIn35mmMm: 24,
  gpsLat: 48.4647,
  gpsLon: 35.0462,
  gpsAltitudeM: 96,
  headingDeg: 214,
  rollDeg: 0.5,
  capturedAt: "2026-05-03T07:15:02",
  width: 4032,
  height: 3024,
};

const DISPLAY_ID = "166a86_0f3c6f1a9d2e4b7c8a1d2e3f4a5b6c7d~mv2.jpg";
const THUMB_ID = "166a86_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d~mv2.jpg";
const ORIGINAL_ID = "166a86_11112222333344445555666677778888.arw";
const files = { originalFileId: ORIGINAL_ID, displayFileId: DISPLAY_ID, thumbFileId: THUMB_ID };

const placement = { latDeg: 48.4647, lonDeg: 35.0462 };
const baselineFov = derivedFov(exif, exifBaselineParams(exif)).hFovDeg;
const exifPose = exifPoseOf(exif, placement, 112.4, baselineFov);

const snapshot: FacadeSnapshot = {
  exif,
  params: { focalLengthMm: 6.86, headingDeg: 214, altitudeM: 96 },
  placement,
  projection: { strength: 1, ownLight: 0.6, rangeM: null },
  textureWidth: 2016,
  textureHeight: 1512,
  fileName: "IMG_0412.jpg",
  fileSizeBytes: 2500,
  apexAltM: 112.4,
  exifPose,
  title: null,
};

describe("exifPoseOf — the EXIF baseline the store captures", () => {
  it("reads the placement, the EXIF numbers (level / north when absent), the given apex + H-FOV, the EXIF frame dims", () => {
    expect(exifPose).toEqual({
      lat: 48.4647,
      lon: 35.0462,
      apexAltM: 112.4,
      altitudeM: 96,
      headingDeg: 214,
      pitchDeg: 0,
      rollDeg: 0.5,
      focalLengthMm: 6.86,
      hFovDeg: baselineFov,
      fovEstimated: derivedFov(exif, exifBaselineParams(exif)).estimated,
      textureWidth: 4032,
      textureHeight: 3024,
    });
    const bare = exifPoseOf({}, { latDeg: 1, lonDeg: 2 }, 10, 60);
    expect(bare).toMatchObject({ altitudeM: null, headingDeg: 0, pitchDeg: 0, rollDeg: 0, focalLengthMm: null, hFovDeg: 60, textureWidth: null });
    expect(bare.fovEstimated).toBe(true); // no focal at all → the sensor-DB default is an estimate
  });
});

describe("buildSaveFacadeBody", () => {
  it("hFov comes from the ONE shared derivation (frustum ≡ projector ≡ gizmo ≡ record) — no override", () => {
    const body = buildSaveFacadeBody(snapshot, files);
    const fov = derivedFov(exif, snapshot.params);
    expect(body.hFovDeg).toBe(fov.hFovDeg);
    expect(body.hFovDeg).toBe(effectiveHFovDeg(exif, snapshot.params, undefined));
    expect(body.fovEstimated).toBe(fov.estimated);
  });

  it("an H-FOV override (F1 SCALE) IS the recorded H-FOV and is never an estimate; an out-of-band one is not in effect", () => {
    const body = buildSaveFacadeBody({ ...snapshot, hFovDeg: 80 }, files);
    expect(body.hFovDeg).toBe(80);
    expect(body.fovEstimated).toBe(false);
    const noFocal = { ...snapshot, exif: { ...exif, focalLengthMm: undefined, focalLengthIn35mmMm: undefined, make: undefined, model: undefined }, params: {} };
    expect(buildSaveFacadeBody(noFocal, files).fovEstimated).toBe(true);
    const nonsense = buildSaveFacadeBody({ ...noFocal, hFovDeg: 0 }, files);
    expect(nonsense.hFovDeg).toBe(derivedFov(noFocal.exif, {}).hFovDeg);
    expect(nonsense.fovEstimated).toBe(true);
  });

  it("roll: the gizmo nudge, else the EXIF roll, else level; heading / pitch: params, else EXIF, else 0", () => {
    expect(buildSaveFacadeBody({ ...snapshot, rollDeg: 3 }, files).rollDeg).toBe(3);
    expect(buildSaveFacadeBody(snapshot, files).rollDeg).toBe(0.5);
    expect(buildSaveFacadeBody({ ...snapshot, exif: { ...exif, rollDeg: undefined } }, files).rollDeg).toBe(0);
    const b = buildSaveFacadeBody({ ...snapshot, params: {}, exif: { ...exif, headingDeg: undefined, pitchDeg: undefined } }, files);
    expect(b.headingDeg).toBe(0);
    expect(b.pitchDeg).toBe(0);
    expect(b.altitudeM).toBeNull(); // the slider value only — never the EXIF altitude by proxy
    expect(buildSaveFacadeBody({ ...snapshot, params: { pitchDeg: -7 } }, files).pitchDeg).toBe(-7);
    expect(buildSaveFacadeBody({ ...snapshot, params: {} }, files).headingDeg).toBe(214);
  });

  it("maps the rest: the placement, the apex, the projection, the EXIF facts, the three file ids, the EXIF pose, empty seats", () => {
    const body = buildSaveFacadeBody({ ...snapshot, projection: { strength: 0.7, ownLight: 0.2, rangeM: 300 } }, files);
    expect(body.lat).toBe(48.4647);
    expect(body.lon).toBe(35.0462);
    expect(body.apexAltM).toBe(112.4);
    expect(body.altitudeM).toBe(96);
    expect(body.focalLengthMm).toBe(6.86);
    expect(body.strength).toBe(0.7);
    expect(body.ownLight).toBe(0.2);
    expect(body.rangeM).toBe(300);
    expect(body.capturedAt).toBe("2026-05-03T07:15:02"); // TZ-naive, verbatim
    expect(body.cameraMake).toBe("Apple");
    expect(body.lensModel).toBe("wide");
    expect(body.textureWidth).toBe(2016); // the DECODED texture's dims, not the EXIF frame's
    expect(body.fileName).toBe("IMG_0412.jpg");
    expect(body.fileSizeBytes).toBe(2500);
    expect(body.originalFileId).toBe(ORIGINAL_ID);
    expect(body.displayFileId).toBe(DISPLAY_ID);
    expect(body.thumbFileId).toBe(THUMB_ID);
    expect(body.exifPose).toEqual(exifPose);
    expect(body.targetFeatureIds).toEqual([]);
    expect(body.alignment).toEqual({});
  });

  it("title: the custom title trimmed, else the file-name title, else Untitled", () => {
    expect(buildSaveFacadeBody(snapshot, files).title).toBe("IMG_0412");
    expect(buildSaveFacadeBody({ ...snapshot, title: "  Opera house " }, files).title).toBe("Opera house");
    expect(buildSaveFacadeBody({ ...snapshot, title: "   " }, files).title).toBe("IMG_0412");
    expect(buildSaveFacadeBody({ ...snapshot, title: null, fileName: undefined }, files).title).toBe("Untitled");
  });

  it("nulls missing optionals instead of sending undefined (a JSON round trip keeps every key)", () => {
    const bare = buildSaveFacadeBody(
      { ...snapshot, exif: { ...exif, capturedAt: undefined, lensModel: undefined }, fileName: undefined, fileSizeBytes: undefined, textureWidth: undefined, textureHeight: undefined, exifPose: null },
      { ...files, originalFileId: null, thumbFileId: null },
    );
    expect(bare.capturedAt).toBeNull();
    expect(bare.lensModel).toBeNull();
    expect(bare.fileName).toBeNull();
    expect(bare.textureWidth).toBeNull();
    expect(bare.exifPose).toBeNull();
    expect(bare.originalFileId).toBeNull();
    const keys = Object.keys(JSON.parse(JSON.stringify(bare)));
    for (const k of ["originalFileId", "thumbFileId", "rangeM", "exifPose", "altitudeM", "capturedAt", "textureWidth"]) expect(keys).toContain(k);
  });

  it("the wire is ONE contract: the save body passes the server parser verbatim (the EXIF badge reads EXIF)", () => {
    const body = buildSaveFacadeBody(snapshot, files);
    const parsed = parseSaveFacadeBody(JSON.parse(JSON.stringify(body)));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body).toEqual(body);
  });
});

describe("buildUpdateFacadeBody", () => {
  it("carries the id, the pose, the projection and the title — NEVER a file field, a seat or the texture dims", () => {
    const body = buildUpdateFacadeBody({ ...snapshot, hFovDeg: 75, rollDeg: 2, title: "Edited" }, "f1");
    expect(body.facadeId).toBe("f1");
    expect(body.hFovDeg).toBe(75);
    expect(body.rollDeg).toBe(2);
    expect(body.title).toBe("Edited");
    expect(body.strength).toBe(1);
    expect(body.rangeM).toBeNull();
    expect(body.apexAltM).toBe(112.4);
    for (const k of ["originalFileId", "displayFileId", "thumbFileId", "displayUrl", "thumbUrl", "exifPose", "targetFeatureIds", "alignment", "textureWidth", "textureHeight", "capturedAt", "fileName"]) {
      expect(k in body).toBe(false);
    }
  });

  it("passes the server's PATCH parser", () => {
    const body = buildUpdateFacadeBody(snapshot, "f1");
    const parsed = parseUpdateFacadeBody(JSON.parse(JSON.stringify(body)));
    if ("error" in parsed) throw new Error(parsed.error);
    const { facadeId, ...rest } = body;
    expect(parsed.facadeId).toBe(facadeId);
    expect(parsed.body).toEqual(rest);
  });
});

describe("the target seats (T172 / F5) — the probe's buildings ride the bodies", () => {
  const ids = ["osm:w132547176", "dnipro-v3|cells/12_34.glb|7"];

  it("the save body carries the probed ids; none (undefined / null) → []", () => {
    expect(buildSaveFacadeBody({ ...snapshot, targetFeatureIds: ids }, files).targetFeatureIds).toEqual(ids);
    expect(buildSaveFacadeBody({ ...snapshot, targetFeatureIds: null }, files).targetFeatureIds).toEqual([]);
    expect(buildSaveFacadeBody(snapshot, files).targetFeatureIds).toEqual([]);
    const parsed = parseSaveFacadeBody(JSON.parse(JSON.stringify(buildSaveFacadeBody({ ...snapshot, targetFeatureIds: ids }, files))));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.targetFeatureIds).toEqual(ids);
  });

  it("the update body carries them ONLY when non-empty — an empty / null probe keeps the stored set; alignment never", () => {
    const body = buildUpdateFacadeBody({ ...snapshot, targetFeatureIds: ids }, "f1");
    expect(body.targetFeatureIds).toEqual(ids);
    expect("alignment" in body).toBe(false);
    const parsed = parseUpdateFacadeBody(JSON.parse(JSON.stringify(body)));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.targetFeatureIds).toEqual(ids);
    expect("targetFeatureIds" in buildUpdateFacadeBody({ ...snapshot, targetFeatureIds: [] }, "f1")).toBe(false);
    expect("targetFeatureIds" in buildUpdateFacadeBody({ ...snapshot, targetFeatureIds: null }, "f1")).toBe(false);
  });
});
