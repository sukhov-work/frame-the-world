import { describe, expect, it } from "vitest";
import { capturedAtToUtcMs } from "../../../src/lib/ephemeris/captureTime";

/** TZ-naive EXIF stamp → UTC via the solar-time-at-longitude rule (round(lon/15) hours). */
describe("capturedAtToUtcMs", () => {
  it("interprets the stamp as solar time at the placement longitude (Dnipro ≈ UTC+2)", () => {
    // lon 35.0462° → round(2.336) = +2 h → 18:42:17 local solar = 16:42:17 UTC
    expect(capturedAtToUtcMs("2026-06-21T18:42:17", 35.0462)).toBe(
      Date.UTC(2026, 5, 21, 16, 42, 17),
    );
  });

  it("is plain UTC at the Greenwich meridian", () => {
    expect(capturedAtToUtcMs("2026-01-05T09:00:00", 0)).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
  });

  it("crosses midnight for western longitudes (California ≈ UTC−8)", () => {
    // 21:30 local solar at lon −120 → +8 h → 05:30 UTC next day
    expect(capturedAtToUtcMs("2026-03-10T21:30:00", -120)).toBe(
      Date.UTC(2026, 2, 11, 5, 30, 0),
    );
  });

  it("accepts the space-separated EXIF form and missing seconds", () => {
    expect(capturedAtToUtcMs("2026-06-21 18:42:17", 0)).toBe(Date.UTC(2026, 5, 21, 18, 42, 17));
    expect(capturedAtToUtcMs("2026-06-21T18:42", 0)).toBe(Date.UTC(2026, 5, 21, 18, 42, 0));
  });

  it("clamps the antimeridian to ±12 h", () => {
    expect(capturedAtToUtcMs("2026-06-21T12:00:00", 179.9)).toBe(Date.UTC(2026, 5, 21, 0, 0, 0));
    expect(capturedAtToUtcMs("2026-06-21T12:00:00", -179.9)).toBe(
      Date.UTC(2026, 5, 22, 0, 0, 0),
    );
  });

  it("returns null for unparseable stamps (CR3/RAF metadata gaps)", () => {
    expect(capturedAtToUtcMs("", 0)).toBeNull();
    expect(capturedAtToUtcMs("yesterday", 0)).toBeNull();
    expect(capturedAtToUtcMs("2026-06-21", 0)).toBeNull(); // date-only — no wall clock to pin
  });
});
