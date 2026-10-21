import { describe, it, expect, beforeEach } from "vitest";
import { useFacadePhotoStore } from "../../src/store/facadePhoto";
import type { ExtractedPhoto, PhotoExif } from "../../src/lib/decode/extract";
import { read, stripComments } from "../styles/_css";

/** Phone-style street photo: GPS + heading + altitude + roll, pitch missing. */
const EXIF_GPS: PhotoExif = {
  make: "Apple",
  model: "iPhone 15 Pro",
  focalLengthMm: 6.86,
  gpsLat: 48.4647,
  gpsLon: 35.0462,
  gpsAltitudeM: 96,
  headingDeg: 214,
  rollDeg: 1.5,
};

/** ILC file without GPS — the SET ON GLOBE path. */
const EXIF_NO_GPS: PhotoExif = { make: "SONY", model: "ILCE-7RM4", focalLengthMm: 35, focalLengthIn35mmMm: 35 };

function extracted(exif: PhotoExif, overrides: Partial<ExtractedPhoto> = {}): ExtractedPhoto {
  return { fileName: "FACADE_0001.JPG", fileSizeBytes: 4 * 1024 * 1024, previewSource: "none", exif, ...overrides };
}

const s = () => useFacadePhotoStore.getState();

beforeEach(() => {
  s().clear();
  useFacadePhotoStore.setState({ open: false });
});

describe("defaults", () => {
  it("starts idle with the default projection and no extra fields", () => {
    expect(s().phase).toBe("idle");
    expect(s().open).toBe(false);
    expect(s().params).toEqual({});
    expect(s().projection).toEqual({ enabled: true, strength: 1, ownLight: 0.6 });
    expect(s().rollDeg).toBeUndefined();
    expect(s().planeOpacity).toBeUndefined();
    expect("viewMode" in s()).toBe(false);
    expect("pendingPlacement" in s()).toBe(false);
  });
});

describe("ingest", () => {
  it("seeds params from EXIF and the placement from GPS", () => {
    s().ingest(extracted(EXIF_GPS, { textureWidth: 4032, textureHeight: 3024 }), 120);
    expect(s().phase).toBe("review");
    expect(s().params).toEqual({ focalLengthMm: 6.86, headingDeg: 214, pitchDeg: undefined, altitudeM: 96 });
    expect(s().placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
    expect(s().textureWidth).toBe(4032);
    expect(s().decodeMs).toBe(120);
    expect(s().rollDeg).toBeUndefined();
  });

  it("leaves the placement unset without GPS", () => {
    s().ingest(extracted(EXIF_NO_GPS));
    expect(s().placement).toBeUndefined();
  });
});

describe("place / setPlacement / backToReview / cancelPlacing / clear", () => {
  it("GPS → place() → placed with the overlay closed", () => {
    s().openPanel();
    s().ingest(extracted(EXIF_GPS));
    s().place();
    expect(s().phase).toBe("placed");
    expect(s().open).toBe(false);
  });

  it("no GPS → place() → placing; setPlacement → placed", () => {
    s().openPanel();
    s().ingest(extracted(EXIF_NO_GPS));
    s().place();
    expect(s().phase).toBe("placing");
    expect(s().open).toBe(false);
    s().setPlacement(48.46, 35.04);
    expect(s().phase).toBe("placed");
    expect(s().placement).toEqual({ latDeg: 48.46, lonDeg: 35.04 });
  });

  it("place() is a no-op from idle; setPlacement needs EXIF", () => {
    s().place();
    expect(s().phase).toBe("idle");
    s().setPlacement(1, 2);
    expect(s().phase).toBe("idle");
    expect(s().placement).toBeUndefined();
  });

  it("backToReview from placed reopens the review overlay", () => {
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s().backToReview();
    expect(s().phase).toBe("review");
    expect(s().open).toBe(true);
  });

  it("backToReview from placing reopens the review overlay", () => {
    s().ingest(extracted(EXIF_NO_GPS));
    s().place();
    s().backToReview();
    expect(s().phase).toBe("review");
    expect(s().open).toBe(true);
  });

  it("cancelPlacing returns placing → review (open), and is a no-op elsewhere", () => {
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s().cancelPlacing();
    expect(s().phase).toBe("placed");
    s().clear();
    s().ingest(extracted(EXIF_NO_GPS));
    s().place();
    s().cancelPlacing();
    expect(s().phase).toBe("review");
    expect(s().open).toBe(true);
  });

  it("clear returns to idle and resets everything", () => {
    s().ingest(extracted(EXIF_GPS));
    s().setRollDeg(3);
    s().setPlaneOpacity(0.2);
    s().setProjection({ strength: 0.3 });
    s().place();
    s().clear();
    expect(s().phase).toBe("idle");
    expect(s().exif).toBeUndefined();
    expect(s().placement).toBeUndefined();
    expect(s().params).toEqual({});
    expect(s().rollDeg).toBeUndefined();
    expect(s().planeOpacity).toBeUndefined();
    expect(s().projection).toEqual({ enabled: true, strength: 1, ownLight: 0.6 });
  });
});

describe("params + roll", () => {
  beforeEach(() => s().ingest(extracted(EXIF_GPS)));

  it("setParam / resetParam", () => {
    s().setParam("headingDeg", 300);
    s().setParam("pitchDeg", -4);
    expect(s().params.headingDeg).toBe(300);
    s().resetParam("headingDeg");
    expect(s().params.headingDeg).toBe(214);
    s().resetParam("pitchDeg");
    expect(s().params.pitchDeg).toBeUndefined();
  });

  it("setRollDeg sets and clears the nudge", () => {
    s().setRollDeg(-2.5);
    expect(s().rollDeg).toBe(-2.5);
    s().setRollDeg(undefined);
    expect(s().rollDeg).toBeUndefined();
  });

  it("resetAll returns params to the EXIF baseline AND rollDeg to undefined", () => {
    s().setParam("focalLengthMm", 50);
    s().setParam("altitudeM", 2);
    s().setRollDeg(4);
    s().resetAll();
    expect(s().params).toEqual({ focalLengthMm: 6.86, headingDeg: 214, pitchDeg: undefined, altitudeM: 96 });
    expect(s().rollDeg).toBeUndefined();
  });
});

describe("setProjection / setPlaneOpacity", () => {
  it("merges and clamps strength + ownLight to [0,1]", () => {
    s().setProjection({ strength: 1.7 });
    expect(s().projection).toEqual({ enabled: true, strength: 1, ownLight: 0.6 });
    s().setProjection({ ownLight: -0.4, enabled: false });
    expect(s().projection).toEqual({ enabled: false, strength: 1, ownLight: 0 });
    s().setProjection({ strength: 0.35 });
    expect(s().projection).toEqual({ enabled: false, strength: 0.35, ownLight: 0 });
  });

  it("setPlaneOpacity sets and resets the override", () => {
    s().setPlaneOpacity(0);
    expect(s().planeOpacity).toBe(0);
    s().setPlaneOpacity(undefined);
    expect(s().planeOpacity).toBeUndefined();
  });
});

describe("nudgePlacement", () => {
  it("is a no-op without a placement", () => {
    s().ingest(extracted(EXIF_NO_GPS));
    s().nudgePlacement(1, 1);
    expect(s().placement).toBeUndefined();
  });

  it("moves north by 1/111320° per metre", () => {
    s().ingest(extracted(EXIF_GPS));
    s().nudgePlacement(1, 0);
    expect(s().placement!.latDeg).toBeCloseTo(48.4647 + 1 / 111_320, 12);
    expect(s().placement!.lonDeg).toBe(35.0462);
    s().nudgePlacement(-1, 0);
    expect(s().placement!.latDeg).toBeCloseTo(48.4647, 12);
  });

  it("moves east scaled by cos(lat)", () => {
    s().ingest(extracted(EXIF_GPS));
    s().nudgePlacement(0, 5);
    const expected = 35.0462 + 5 / (111_320 * Math.cos((48.4647 * Math.PI) / 180));
    expect(s().placement!.lonDeg).toBeCloseTo(expected, 12);
    expect(s().placement!.latDeg).toBe(48.4647);
  });
});

describe("isolation fences (zero regression to the upload/pin flow)", () => {
  it("the store never imports store/camera (no temp-pin side effect)", () => {
    const src = read("src/store/facadePhoto.ts");
    expect(src).not.toMatch(/from "\.\/camera"/);
    expect(stripComments(src)).not.toMatch(/from "\.\/upload"/);
  });

  it("the component never imports store/upload or components/mobile", () => {
    const code = stripComments(read("src/components/panels/FacadePhotoFlow.tsx"));
    expect(code).not.toMatch(/store\/upload["']/);
    expect(code).not.toMatch(/components\/mobile\/|\.\.\/mobile\//);
    expect(code).not.toMatch(/method=["']post["']/i);
    expect(code).not.toMatch(/autoFocus/);
  });

  it("the overlay root carries .ff and the file input lives inside it", () => {
    const code = stripComments(read("src/components/panels/FacadePhotoFlow.tsx"));
    expect(code).toMatch(/className="uf ff"/);
    expect(code).toMatch(/data-open-facade/);
    expect(code).toMatch(/usePanelDrag\("facade-photo"\)/);
  });

  it("is mounted on the desktop shell only", () => {
    expect(read("src/pages/index.astro")).toMatch(/<FacadePhotoFlow client:only="react" \/>/);
    expect(read("src/pages/m.astro")).not.toMatch(/FacadePhotoFlow/);
  });
});
