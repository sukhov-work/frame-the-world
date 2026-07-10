import { describe, it, expect, beforeEach } from "vitest";
import {
  useUploadStore,
  exifBaselineParams,
  missingParamKeys,
  paramSource,
  isDirty,
} from "../../src/store/upload";
import type { ExtractedPhoto, PhotoExif } from "../../src/lib/decode/extract";

/** Sony-style baseline: GPS but no heading/pitch/altitude — the full D4 manual-entry path. */
const EXIF_RAW: PhotoExif = {
  make: "SONY",
  model: "ILCE-7RM4",
  focalLengthMm: 35,
  focalLengthIn35mmMm: 35,
  gpsLat: 48.8583,
  gpsLon: 2.2923,
};

/** Phone-style baseline: heading + altitude present, pitch missing. */
const EXIF_PHONE: PhotoExif = {
  make: "Apple",
  model: "iPhone 15 Pro",
  focalLengthMm: 6.86,
  gpsLat: 48.4647,
  gpsLon: 35.0462,
  gpsAltitudeM: 96,
  headingDeg: 214,
};

function extracted(exif: PhotoExif, overrides: Partial<ExtractedPhoto> = {}): ExtractedPhoto {
  return {
    fileName: "DSC_4021.ARW",
    fileSizeBytes: 118 * 1024 * 1024,
    previewSource: "none",
    exif,
    ...overrides,
  };
}

beforeEach(() => {
  useUploadStore.getState().clear();
  useUploadStore.setState({ open: false });
});

describe("exifBaselineParams / missingParamKeys (D4)", () => {
  it("maps gpsAltitudeM onto the altitudeM param", () => {
    expect(exifBaselineParams(EXIF_PHONE)).toEqual({
      focalLengthMm: 6.86,
      headingDeg: 214,
      pitchDeg: undefined,
      altitudeM: 96,
    });
  });

  it("flags heading, pitch and altitude for a bare ILC file — in D4 order", () => {
    expect(missingParamKeys(EXIF_RAW)).toEqual(["headingDeg", "pitchDeg", "altitudeM"]);
  });

  it("flags only pitch when the phone wrote heading + altitude", () => {
    expect(missingParamKeys(EXIF_PHONE)).toEqual(["pitchDeg"]);
  });
});

describe("paramSource provenance", () => {
  it("exif when the current value equals the baseline", () => {
    expect(paramSource(EXIF_PHONE, exifBaselineParams(EXIF_PHONE), "headingDeg")).toBe("exif");
  });

  it("manual once the value departs from the baseline", () => {
    expect(paramSource(EXIF_PHONE, { ...exifBaselineParams(EXIF_PHONE), headingDeg: 300 }, "headingDeg")).toBe("manual");
  });

  it("missing when the file never had it and the user has not set it", () => {
    expect(paramSource(EXIF_RAW, exifBaselineParams(EXIF_RAW), "pitchDeg")).toBe("missing");
  });

  it("manual when the user fills a field the file never had", () => {
    expect(paramSource(EXIF_RAW, { ...exifBaselineParams(EXIF_RAW), pitchDeg: -4 }, "pitchDeg")).toBe("manual");
  });
});

describe("store ingest → adjust → reset", () => {
  it("ingest seeds params from the EXIF baseline and enters review", () => {
    useUploadStore.getState().ingest(extracted(EXIF_RAW), 3200);
    const s = useUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.params.focalLengthMm).toBe(35);
    expect(s.params.headingDeg).toBeUndefined();
    expect(s.decodeMs).toBe(3200);
  });

  it("ingest carries a decode failure through to the review card", () => {
    useUploadStore.getState().ingest(extracted(EXIF_RAW, { decodeError: "LibRaw produced no image data" }));
    expect(useUploadStore.getState().decodeError).toBe("LibRaw produced no image data");
    useUploadStore.getState().ingest(extracted(EXIF_RAW));
    expect(useUploadStore.getState().decodeError).toBeUndefined();
  });

  it("setParam marks the store dirty; resetParam returns to the baseline", () => {
    const st = useUploadStore.getState();
    st.ingest(extracted(EXIF_PHONE));
    st.setParam("headingDeg", 300);
    let s = useUploadStore.getState();
    expect(isDirty(s.exif!, s.params)).toBe(true);

    s.resetParam("headingDeg");
    s = useUploadStore.getState();
    expect(s.params.headingDeg).toBe(214);
    expect(isDirty(s.exif!, s.params)).toBe(false);
  });

  it("resetParam on a field the file never had clears it back to unset", () => {
    const st = useUploadStore.getState();
    st.ingest(extracted(EXIF_RAW));
    st.setParam("pitchDeg", -4);
    useUploadStore.getState().resetParam("pitchDeg");
    expect(useUploadStore.getState().params.pitchDeg).toBeUndefined();
  });

  it("resetAll restores every param at once", () => {
    const st = useUploadStore.getState();
    st.ingest(extracted(EXIF_PHONE));
    st.setParam("headingDeg", 10);
    st.setParam("focalLengthMm", 85);
    st.setParam("pitchDeg", 12);
    useUploadStore.getState().resetAll();
    expect(useUploadStore.getState().params).toEqual(exifBaselineParams(EXIF_PHONE));
  });

  it("clear returns to the empty dropzone", () => {
    const st = useUploadStore.getState();
    st.ingest(extracted(EXIF_RAW));
    useUploadStore.getState().clear();
    const s = useUploadStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.exif).toBeUndefined();
    expect(s.params).toEqual({});
    expect(s.decodeProgress).toBe(0);
  });
});
