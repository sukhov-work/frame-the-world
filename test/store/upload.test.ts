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

describe("placement machine (Phase 3 — PLACE / SET ON GLOBE)", () => {
  it("ingest seeds placement from GPS and carries the texture dimensions", () => {
    useUploadStore.getState().ingest(extracted(EXIF_PHONE, { textureWidth: 3136, textureHeight: 2084 }));
    const s = useUploadStore.getState();
    expect(s.placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
    expect(s.textureWidth).toBe(3136);
    expect(s.textureHeight).toBe(2084);
  });

  it("falls back to EXIF pixel dimensions when no decoded texture exists", () => {
    useUploadStore.getState().ingest(extracted({ ...EXIF_RAW, width: 9504, height: 6336 }));
    const s = useUploadStore.getState();
    expect(s.textureWidth).toBe(9504);
    expect(s.textureHeight).toBe(6336);
  });

  it("place() with GPS goes straight to placed and closes the overlay", () => {
    useUploadStore.setState({ open: true });
    useUploadStore.getState().ingest(extracted(EXIF_PHONE));
    useUploadStore.getState().place();
    const s = useUploadStore.getState();
    expect(s.phase).toBe("placed");
    expect(s.open).toBe(false);
    expect(s.placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
  });

  it("place() without GPS enters placing mode and waits for a globe click", () => {
    const noGps: PhotoExif = { ...EXIF_RAW, gpsLat: undefined, gpsLon: undefined };
    useUploadStore.getState().ingest(extracted(noGps));
    useUploadStore.getState().place();
    let s = useUploadStore.getState();
    expect(s.phase).toBe("placing");
    expect(s.placement).toBeUndefined();

    useUploadStore.getState().setPlacement(48.47, 35.05);
    s = useUploadStore.getState();
    expect(s.phase).toBe("placed");
    expect(s.placement).toEqual({ latDeg: 48.47, lonDeg: 35.05 });
  });

  it("place() is a no-op before review", () => {
    useUploadStore.getState().place();
    expect(useUploadStore.getState().phase).toBe("idle");
  });

  it("setPlacement while placed moves the pin (re-place)", () => {
    useUploadStore.getState().ingest(extracted(EXIF_PHONE));
    useUploadStore.getState().place();
    useUploadStore.getState().setPlacement(50.45, 30.52);
    expect(useUploadStore.getState().placement).toEqual({ latDeg: 50.45, lonDeg: 30.52 });
    expect(useUploadStore.getState().phase).toBe("placed");
  });

  it("backToReview reopens the overlay; params + placement survive", () => {
    useUploadStore.getState().ingest(extracted(EXIF_PHONE));
    useUploadStore.getState().setParam("headingDeg", 300);
    useUploadStore.getState().place();
    useUploadStore.getState().backToReview();
    const s = useUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.open).toBe(true);
    expect(s.params.headingDeg).toBe(300);
    expect(s.placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
  });

  it("clear wipes placement + texture dims", () => {
    useUploadStore.getState().ingest(extracted(EXIF_PHONE, { textureWidth: 100, textureHeight: 50 }));
    useUploadStore.getState().place();
    useUploadStore.getState().clear();
    const s = useUploadStore.getState();
    expect(s.placement).toBeUndefined();
    expect(s.textureWidth).toBeUndefined();
    expect(s.phase).toBe("idle");
  });
});

describe("FPV view mode (Phase 5.5 S2)", () => {
  it("defaults to orbit and refuses fpv unless a photo is placed", () => {
    expect(useUploadStore.getState().viewMode).toBe("orbit");
    useUploadStore.getState().setViewMode("fpv"); // idle — refused
    expect(useUploadStore.getState().viewMode).toBe("orbit");
    useUploadStore.getState().ingest(extracted(EXIF_PHONE));
    useUploadStore.getState().setViewMode("fpv"); // review — still refused
    expect(useUploadStore.getState().viewMode).toBe("orbit");
    useUploadStore.getState().place();
    expect(useUploadStore.getState().phase).toBe("placed");
    useUploadStore.getState().setViewMode("fpv");
    expect(useUploadStore.getState().viewMode).toBe("fpv");
  });

  it("every exit from the placed state drops back to orbit", () => {
    const enterFpv = () => {
      useUploadStore.getState().ingest(extracted(EXIF_PHONE));
      useUploadStore.getState().place();
      useUploadStore.getState().setViewMode("fpv");
      expect(useUploadStore.getState().viewMode).toBe("fpv");
    };
    enterFpv();
    useUploadStore.getState().backToReview();
    expect(useUploadStore.getState().viewMode).toBe("orbit");
    enterFpv();
    useUploadStore.getState().clear();
    expect(useUploadStore.getState().viewMode).toBe("orbit");
    enterFpv();
    useUploadStore.getState().ingest(extracted(EXIF_RAW)); // a new file supersedes the view
    expect(useUploadStore.getState().viewMode).toBe("orbit");
  });
});

describe("Phase 5.5 S3 — uploadAt / pendingPlacement (temp-pin UPLOAD HERE)", () => {
  const NO_GPS: PhotoExif = { make: "SONY", model: "ILCE-7RM4", focalLengthMm: 35 };

  it("uploadAt opens the overlay and stores the seed", () => {
    useUploadStore.getState().uploadAt(48.46, 35.05);
    const s = useUploadStore.getState();
    expect(s.open).toBe(true);
    expect(s.pendingPlacement).toEqual({ latDeg: 48.46, lonDeg: 35.05 });
  });

  it("a GPS-less file ingests placed at the seed (and consumes it)", () => {
    useUploadStore.getState().uploadAt(48.46, 35.05);
    useUploadStore.getState().ingest(extracted(NO_GPS));
    const s = useUploadStore.getState();
    expect(s.placement).toEqual({ latDeg: 48.46, lonDeg: 35.05 });
    expect(s.pendingPlacement).toBeUndefined();
  });

  it("EXIF GPS wins over the seed — it is the real capture location", () => {
    useUploadStore.getState().uploadAt(10, 20);
    useUploadStore.getState().ingest(extracted(EXIF_PHONE));
    const s = useUploadStore.getState();
    expect(s.placement).toEqual({ latDeg: EXIF_PHONE.gpsLat, lonDeg: EXIF_PHONE.gpsLon });
    expect(s.pendingPlacement).toBeUndefined();
  });

  it("closing the overlay without a file abandons the seed", () => {
    useUploadStore.getState().uploadAt(48.46, 35.05);
    useUploadStore.getState().closePanel();
    expect(useUploadStore.getState().pendingPlacement).toBeUndefined();
  });
});

describe("Phase 5.5 S3 — own-pin identity + re-place path", () => {
  const OWN_VIEW = {
    pinId: "photo-1",
    ownPhotoId: "photo-1",
    title: "Dnipro rooftop",
    lat: 48.4647,
    lon: 35.0462,
    previewUrl: null,
    capturedAt: null,
    isPublic: true,
    publicPrecision: "1km",
    headingDeg: 214,
    hFovDeg: 73.7,
  };

  it("openSavedPin from MY PINS carries ownPhotoId + save-time choices", () => {
    useUploadStore.getState().openSavedPin(OWN_VIEW);
    const s = useUploadStore.getState();
    expect(s.ownPhotoId).toBe("photo-1");
    expect(s.ownPinMeta).toEqual({ isPublic: true, precision: "1km" });
  });

  it("a globe pin click (no ownPhotoId) stays a foreign view", () => {
    useUploadStore.getState().openSavedPin({ ...OWN_VIEW, ownPhotoId: undefined });
    const s = useUploadStore.getState();
    expect(s.viewingPinId).toBe("photo-1");
    expect(s.ownPhotoId).toBeUndefined();
    expect(s.ownPinMeta).toBeUndefined();
  });

  it("rePlace enters placing only for a viewed pin and keeps the old placement", () => {
    useUploadStore.getState().ingest(extracted(EXIF_PHONE)); // fresh upload, not a viewed pin
    useUploadStore.getState().place();
    useUploadStore.getState().rePlace();
    expect(useUploadStore.getState().phase).toBe("placed"); // refused — not a viewed pin

    useUploadStore.getState().openSavedPin(OWN_VIEW);
    useUploadStore.getState().rePlace();
    const s = useUploadStore.getState();
    expect(s.phase).toBe("placing");
    expect(s.placement).toEqual({ latDeg: OWN_VIEW.lat, lonDeg: OWN_VIEW.lon });
  });

  it("cancelPlacing returns a viewed pin to placed and a fresh upload to review", () => {
    useUploadStore.getState().openSavedPin(OWN_VIEW);
    useUploadStore.getState().rePlace();
    useUploadStore.getState().cancelPlacing();
    expect(useUploadStore.getState().phase).toBe("placed");

    const noGps: PhotoExif = { make: "SONY", model: "ILCE-7RM4", focalLengthMm: 35 };
    useUploadStore.getState().ingest(extracted(noGps));
    useUploadStore.getState().place(); // no GPS → placing
    expect(useUploadStore.getState().phase).toBe("placing");
    useUploadStore.getState().cancelPlacing();
    const s = useUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.open).toBe(true);
  });

  it("setPlacement completes a re-place with the new location", () => {
    useUploadStore.getState().openSavedPin(OWN_VIEW);
    useUploadStore.getState().rePlace();
    useUploadStore.getState().setPlacement(50.45, 30.52);
    const s = useUploadStore.getState();
    expect(s.phase).toBe("placed");
    expect(s.placement).toEqual({ latDeg: 50.45, lonDeg: 30.52 });
    expect(s.ownPhotoId).toBe("photo-1"); // still the same pin being edited
  });

  it("clear() drops the S3 fields", () => {
    useUploadStore.getState().openSavedPin(OWN_VIEW);
    useUploadStore.getState().clear();
    const s = useUploadStore.getState();
    expect(s.ownPhotoId).toBeUndefined();
    expect(s.ownPinMeta).toBeUndefined();
    expect(s.pendingPlacement).toBeUndefined();
  });
});
