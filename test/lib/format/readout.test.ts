import { describe, it, expect } from "vitest";
import {
  formatLatLon,
  formatFocal,
  formatAperture,
  formatShutter,
  formatIso,
  formatHeading,
  formatPitch,
  formatAltitude,
  formatMegapixels,
  formatBytes,
  formatCaptureDateTime,
  formatAltM,
  formatEyeM,
  cardinal,
  formatSigned,
  EM_DASH,
} from "../../../src/lib/format/readout";

describe("formatAltM / formatEyeM — unit-switching height readouts", () => {
  it("formatAltM switches m → km with the right precision", () => {
    expect(formatAltM(500)).toBe("500 m");
    expect(formatAltM(12_340)).toBe("12.3 km");
    expect(formatAltM(150_000)).toBe("150 km");
  });
  it("formatEyeM keeps a decimal under 10 m", () => {
    expect(formatEyeM(1.7)).toBe("1.7 m");
    expect(formatEyeM(115)).toBe("115 m");
    expect(formatEyeM(1_200)).toBe("1.2 km");
  });
});

describe("cardinal / formatSigned", () => {
  it("maps headings to the 8-point compass and wraps negatives", () => {
    expect(cardinal(0)).toBe("N");
    expect(cardinal(90)).toBe("E");
    expect(cardinal(225)).toBe("SW");
    expect(cardinal(359)).toBe("N");
    expect(cardinal(-90)).toBe("W");
  });
  it("formatSigned always shows a sign with a typographic minus", () => {
    expect(formatSigned(4)).toBe("+4.0°");
    expect(formatSigned(-4)).toBe("−4.0°");
    expect(formatSigned(0)).toBe("+0.0°");
  });
});

describe("formatLatLon", () => {
  it("renders the board-05 Paris readout", () => {
    expect(formatLatLon(48.8583, 2.2923)).toBe("48.8583° N · 2.2923° E");
  });
  it("southern / western hemispheres", () => {
    expect(formatLatLon(-33.8568, -151.2153)).toBe("33.8568° S · 151.2153° W");
  });
  it("em-dash when absent", () => {
    expect(formatLatLon(undefined, 2)).toBe(EM_DASH);
  });
});

describe("focal / aperture / shutter / iso", () => {
  it("focal ≥10mm rounds to integer", () => {
    expect(formatFocal(35)).toBe("35 MM");
  });
  it("phone focal keeps a decimal", () => {
    expect(formatFocal(6.86)).toBe("6.9 MM");
  });
  it("aperture drops a trailing .0", () => {
    expect(formatAperture(2.8)).toBe("F/2.8");
    expect(formatAperture(4)).toBe("F/4");
  });
  it("shutter fractions and long exposures", () => {
    expect(formatShutter(1 / 250)).toBe("1/250");
    expect(formatShutter(1.6)).toBe("1.6 S");
    expect(formatShutter(2)).toBe("2 S");
  });
  it("iso", () => {
    expect(formatIso(100)).toBe("ISO 100");
  });
});

describe("heading / pitch / altitude", () => {
  it("heading normalises into [0,360)", () => {
    expect(formatHeading(128)).toBe("128°");
    expect(formatHeading(-46)).toBe("314°");
    expect(formatHeading(360)).toBe("0°");
  });
  it("pitch is signed with a typographic minus and one decimal", () => {
    expect(formatPitch(-4)).toBe("−4.0°");
    expect(formatPitch(12.25)).toBe("12.3°");
  });
  it("altitude in whole metres", () => {
    expect(formatAltitude(96.4)).toBe("96 M");
  });
});

describe("megapixels / bytes / datetime", () => {
  it("α7R IV pixel dimensions read 60.2 MP", () => {
    expect(formatMegapixels(9504, 6336)).toBe("60.2 MP");
  });
  it("bytes ladder", () => {
    expect(formatBytes(812 * 1024)).toBe("812 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(118 * 1024 * 1024)).toBe("118 MB");
  });
  it("capture datetime is string surgery on the TZ-naive ISO", () => {
    expect(formatCaptureDateTime("2026-06-21T18:42:17")).toBe("2026-06-21 · 18:42");
    expect(formatCaptureDateTime(undefined)).toBe(EM_DASH);
  });
});
