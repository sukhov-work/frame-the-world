/**
 * exifr → PhotoExif mapping against REAL fixtures (no mocks — exifr runs fine in Node).
 *
 * - gps-heading.jpg: committed, generated with exiftool (iPhone-style EXIF incl. GPSImgDirection).
 * - gps-heading.heic / example-sony.arw: large/binary fixtures kept out of git — those tests skip
 *   when absent (regenerate per test/fixtures/README.md).
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseExif, toPhotoExif, exifDateToIso } from "../../../src/lib/decode/exif";

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));

describe("exifDateToIso", () => {
  it("converts the EXIF wall-clock string without touching Date", () => {
    expect(exifDateToIso("2026:05:03 07:15:02")).toBe("2026-05-03T07:15:02");
  });

  it("rejects garbage and non-strings", () => {
    expect(exifDateToIso(undefined)).toBeUndefined();
    expect(exifDateToIso(1234)).toBeUndefined();
    expect(exifDateToIso("not a date")).toBeUndefined();
  });
});

describe("toPhotoExif edge cases", () => {
  it("returns {} for undefined tags", () => {
    expect(toPhotoExif(undefined)).toEqual({});
  });

  it("negates altitude when GPSAltitudeRef says below sea level (byte-wrapper form)", () => {
    expect(toPhotoExif({ GPSAltitude: 12, GPSAltitudeRef: { 0: 1 } }).gpsAltitudeM).toBe(-12);
    expect(toPhotoExif({ GPSAltitude: 12, GPSAltitudeRef: { 0: 0 } }).gpsAltitudeM).toBe(12);
    expect(toPhotoExif({ GPSAltitude: 12 }).gpsAltitudeM).toBe(12);
  });

  it("drops blank strings and non-finite numbers", () => {
    expect(toPhotoExif({ Make: "  ", FocalLength: NaN })).toEqual({});
  });
});

describe("parseExif on the committed JPEG fixture", () => {
  it("maps the full iPhone-style tag set onto PhotoExif", async () => {
    const photo = await parseExif(await readFile(fixture("gps-heading.jpg")));
    expect(photo.make).toBe("Apple");
    expect(photo.model).toBe("iPhone 15 Pro");
    expect(photo.lensModel).toContain("back triple camera");
    expect(photo.focalLengthMm).toBeCloseTo(6.86, 2);
    expect(photo.focalLengthIn35mmMm).toBe(24);
    expect(photo.fNumber).toBeCloseTo(1.78, 2);
    expect(photo.exposureSec).toBeCloseTo(1 / 120, 4);
    expect(photo.iso).toBe(80);
    expect(photo.capturedAt).toBe("2026-05-03T07:15:02");
    expect(photo.gpsLat).toBeCloseTo(48.4647, 4);
    expect(photo.gpsLon).toBeCloseTo(35.0462, 4);
    expect(photo.gpsAltitudeM).toBeCloseTo(96, 0);
    expect(photo.headingDeg).toBe(214);
    expect(photo.pitchDeg).toBeUndefined(); // never in EXIF — the D4 nudge
  });

  it("returns {} for a buffer with no image structure", async () => {
    expect(await parseExif(new Uint8Array([1, 2, 3, 4]))).toEqual({});
  });
});

describe.skipIf(!existsSync(fixture("gps-heading.heic")))("parseExif on the HEIC fixture", () => {
  it("reads the same GPS + heading through the HEIC container", async () => {
    const photo = await parseExif(await readFile(fixture("gps-heading.heic")));
    expect(photo.make).toBe("Apple");
    expect(photo.headingDeg).toBe(214);
    expect(photo.gpsLat).toBeCloseTo(48.4647, 4);
    expect(photo.gpsAltitudeM).toBeCloseTo(96, 0);
    expect(photo.capturedAt).toBe("2026-05-03T07:15:02");
  });
});

describe.skipIf(!existsSync(fixture("example-sony.arw")))("parseExif on a real Sony ARW", () => {
  it("reads camera/exposure metadata straight from the TIFF-based RAW", async () => {
    const photo = await parseExif(await readFile(fixture("example-sony.arw")));
    expect(photo.make).toBe("SONY");
    expect(photo.model).toBe("ILME-FX30");
    expect(photo.lensModel).toBe("E 18-135mm F3.5-5.6 OSS");
    expect(photo.focalLengthMm).toBe(29);
    expect(photo.focalLengthIn35mmMm).toBe(43);
    expect(photo.iso).toBe(800);
    expect(photo.exposureSec).toBeCloseTo(0.008, 4);
    // exiftool-confirmed wall clock (a revived Date would have shifted this by the machine TZ —
    // exactly the trap reviveValues:false exists to avoid)
    expect(photo.capturedAt).toBe("2023-04-29T00:01:20");
    expect(photo.width).toBe(6192);
    // this file has no GPS block → the D4 manual path
    expect(photo.gpsLat).toBeUndefined();
    expect(photo.headingDeg).toBeUndefined();
  });
});
