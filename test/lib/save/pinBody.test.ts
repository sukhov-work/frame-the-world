import { describe, expect, it } from "vitest";
import { buildSavePinBody, titleFromFileName } from "../../../src/lib/save/pinBody";
import type { PhotoExif } from "../../../src/lib/decode/extract";
import { derivedFov } from "../../../src/store/upload";

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

const snapshot = {
  exif,
  params: { focalLengthMm: 6.86, headingDeg: 214, altitudeM: 96 },
  placement: { latDeg: 48.4647, lonDeg: 35.0462 },
  textureWidth: 4032,
  textureHeight: 3024,
  fileName: "gps-heading.jpg",
  fileSizeBytes: 2500,
};

const opts = {
  isPublic: true,
  precision: "1km" as const,
  originalFileId: "orig-1",
  previewFileId: "prev-1",
  previewUrl: "https://static.wixstatic.com/media/prev-1.jpg",
};

describe("titleFromFileName", () => {
  it("strips the extension and survives odd names", () => {
    expect(titleFromFileName("gps-heading.jpg")).toBe("gps-heading");
    expect(titleFromFileName("archive.tar.gz")).toBe("archive.tar");
    expect(titleFromFileName(".hidden")).toBe(".hidden");
    expect(titleFromFileName(undefined)).toBe("Untitled");
    expect(titleFromFileName("")).toBe("Untitled");
  });
});

describe("buildSavePinBody", () => {
  it("maps placement, params and exif to the endpoint contract", () => {
    const body = buildSavePinBody(snapshot, opts);
    expect(body.lat).toBe(48.4647);
    expect(body.lon).toBe(35.0462);
    expect(body.headingDeg).toBe(214);
    expect(body.rollDeg).toBe(0.5); // roll has no slider — EXIF only
    expect(body.capturedAt).toBe("2026-05-03T07:15:02"); // TZ-naive, verbatim
    expect(body.title).toBe("gps-heading");
    expect(body.isPublic).toBe(true);
    expect(body.precision).toBe("1km");
    expect(body.originalFileId).toBe("orig-1");
    expect(body.previewUrl).toBe(opts.previewUrl);
  });

  it("hFov comes from the ONE shared derivation (readout ≡ frustum ≡ record)", () => {
    const body = buildSavePinBody(snapshot, opts);
    const fov = derivedFov(exif, snapshot.params);
    expect(body.hFovDeg).toBe(fov.hFovDeg);
    expect(body.fovEstimated).toBe(fov.estimated);
  });

  it("nulls missing optionals instead of sending undefined", () => {
    const bare = buildSavePinBody(
      {
        exif: { ...exif, rollDeg: undefined, capturedAt: undefined, lensModel: undefined },
        params: {},
        placement: { latDeg: 1, lonDeg: 2 },
        fileName: undefined,
        fileSizeBytes: undefined,
      },
      { ...opts, originalFileId: null, previewFileId: null, previewUrl: null },
    );
    expect(bare.rollDeg).toBeNull();
    expect(bare.capturedAt).toBeNull();
    expect(bare.lensModel).toBeNull();
    expect(bare.fileName).toBeNull();
    expect(bare.title).toBe("Untitled");
    expect(bare.originalFileId).toBeNull();
    // JSON round-trip must not drop keys (undefined would)
    const keys = Object.keys(JSON.parse(JSON.stringify(bare)));
    expect(keys).toContain("rollDeg");
    expect(keys).toContain("originalFileId");
  });
});
