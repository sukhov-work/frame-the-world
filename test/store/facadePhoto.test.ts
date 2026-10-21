import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFacadePhotoStore, FACADE_GIZMO_OPS } from "../../src/store/facadePhoto";
import { effectiveHFovDeg } from "../../src/lib/decode/params";
import { PHOTO_PROJECT } from "../../src/components/globe/tuning";
import type { ExtractedPhoto, PhotoExif } from "../../src/lib/decode/extract";
import type { FacadeListItem, FacadePose } from "../../src/lib/wix/facadeRecords";
import { read, stripComments } from "../styles/_css";

// The residency store (`store/facades`) is mocked to its CONTRACT — the photo store reaches it
// through a lazy import only (the editing row), and a spy proves the hand-off without the world
// read's machinery. `lib/save/facadeBody` is the REAL module: `exifPoseOf` is the one derivation
// the record stores, so the capture test runs against it, not a copy.
const residency = vi.hoisted(() => ({ setEditing: vi.fn() }));
vi.mock("../../src/store/facades", () => ({
  useFacadesStore: { getState: () => ({ setEditing: residency.setEditing }) },
}));

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

const SAVED_POSE: FacadePose = {
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 101.5,
  altitudeM: 96,
  headingDeg: 214,
  pitchDeg: 0,
  rollDeg: 1.5,
  focalLengthMm: 6.86,
  hFovDeg: 69.4,
  fovEstimated: false,
  textureWidth: 2048,
  textureHeight: 1536,
};

/** A MY FACADES row as the residency read returns it (the contract shape). */
const ITEM: FacadeListItem = {
  id: "fac_1",
  title: "Kyiv facade",
  displayUrl: "https://static.wixstatic.com/media/x-display.jpg",
  thumbUrl: "https://static.wixstatic.com/media/x-thumb.jpg",
  updatedAt: "2026-10-21T10:00:00.000Z",
  lat: 48.4651,
  lon: 35.0470,
  apexAltM: 103.2,
  altitudeM: 1.7,
  headingDeg: 230.5,
  pitchDeg: 3.5,
  rollDeg: -1,
  focalLengthMm: 6.86,
  hFovDeg: 69.4,
  fovEstimated: false,
  textureWidth: 2048,
  textureHeight: 1536,
  strength: 0.8,
  ownLight: 0.4,
  rangeM: 450,
  targetFeatureIds: [],
  alignment: {},
  capturedAt: "2026-06-21T18:42:17",
  cameraMake: "Apple",
  cameraModel: "iPhone 15 Pro",
  lensModel: null,
  fileName: "IMG_0001.HEIC",
  fileSizeBytes: 3_000_000,
  poseSource: "MANUAL",
  exifPose: SAVED_POSE,
  createdAt: "2026-10-20T09:00:00.000Z",
  isPublic: false,
  moderation: "PRIVATE",
};

const DEFAULT_PROJECTION = { enabled: true, strength: 1, ownLight: 0.6, rangeM: null };

function extracted(exif: PhotoExif, overrides: Partial<ExtractedPhoto> = {}): ExtractedPhoto {
  return { fileName: "FACADE_0001.JPG", fileSizeBytes: 4 * 1024 * 1024, previewSource: "none", exif, ...overrides };
}

const s = () => useFacadePhotoStore.getState();

/** A placed + seated draft (the state the save flow and the journal read). */
function placedAndSeated(exif: PhotoExif = EXIF_GPS): void {
  s().ingest(extracted(exif, { previewUrl: "blob:preview", textureWidth: 4032, textureHeight: 3024 }));
  s().place();
  s()._syncApex(101.5, 1.7);
}

beforeEach(() => {
  s().clear();
  useFacadePhotoStore.setState({ open: false });
  residency.setEditing.mockClear();
});

describe("defaults", () => {
  it("starts idle with the default projection and no extra fields", () => {
    expect(s().phase).toBe("idle");
    expect(s().open).toBe(false);
    expect(s().params).toEqual({});
    expect(s().projection).toEqual(DEFAULT_PROJECTION);
    expect(s().rollDeg).toBeUndefined();
    expect(s().planeOpacity).toBeUndefined();
    expect(s().hFovDeg).toBeUndefined();
    expect(s().gizmoOp).toBe("none");
    expect(s().apexAltM).toBeUndefined();
    expect(s().exifPose).toBeUndefined();
    expect(s().savedFacadeId).toBeUndefined();
    expect("viewMode" in s()).toBe(false);
    expect("pendingPlacement" in s()).toBe(false);
  });

  it("exports the gizmo op vocabulary", () => {
    expect(FACADE_GIZMO_OPS).toEqual(["none", "move", "rotate", "scale"]);
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

  it("resets the H-FOV override (a new photo starts on its own baseline)", () => {
    s().ingest(extracted(EXIF_GPS));
    s().setHFovDeg(40);
    s().ingest(extracted(EXIF_NO_GPS));
    expect(s().hFovDeg).toBeUndefined();
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
    placedAndSeated();
    s().setRollDeg(3);
    s().setHFovDeg(50);
    s().setGizmoOp("move");
    s().setPlaneOpacity(0.2);
    s().setProjection({ strength: 0.3, rangeM: 300 });
    s()._markSaved("fac_9");
    s().clear();
    expect(s().phase).toBe("idle");
    expect(s().exif).toBeUndefined();
    expect(s().placement).toBeUndefined();
    expect(s().params).toEqual({});
    expect(s().rollDeg).toBeUndefined();
    expect(s().hFovDeg).toBeUndefined();
    expect(s().gizmoOp).toBe("none");
    expect(s().planeOpacity).toBeUndefined();
    expect(s().projection).toEqual(DEFAULT_PROJECTION);
    expect(s().apexAltM).toBeUndefined();
    expect(s().apexAboveGroundM).toBeUndefined();
    expect(s().exifPose).toBeUndefined();
    expect(s().savedFacadeId).toBeUndefined();
  });

  it("clear on a saved row releases the residency's editing row (lazy, fire-and-forget)", async () => {
    placedAndSeated();
    s()._markSaved("fac_9");
    s().clear();
    await vi.waitFor(() => expect(residency.setEditing).toHaveBeenCalledWith(null));
  });

  it("clear on an unsaved draft never touches the residency", async () => {
    placedAndSeated();
    s().clear();
    await new Promise((r) => setTimeout(r, 20)); // give a (wrongly fired) lazy import time to land
    expect(residency.setEditing).not.toHaveBeenCalled();
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

  it("resetAll returns params to the EXIF baseline, rollDeg AND the H-FOV override to undefined", () => {
    s().setParam("focalLengthMm", 50);
    s().setParam("altitudeM", 2);
    s().setRollDeg(4);
    s().setHFovDeg(33);
    s().resetAll();
    expect(s().params).toEqual({ focalLengthMm: 6.86, headingDeg: 214, pitchDeg: undefined, altitudeM: 96 });
    expect(s().rollDeg).toBeUndefined();
    expect(s().hFovDeg).toBeUndefined();
  });
});

describe("hFovDeg (F1 — SCALE = the H-FOV, the lens slider writes the same number)", () => {
  beforeEach(() => s().ingest(extracted(EXIF_GPS)));

  it("sets the override and effectiveHFovDeg reads it back verbatim", () => {
    s().setHFovDeg(42.5);
    expect(s().hFovDeg).toBe(42.5);
    expect(effectiveHFovDeg(s().exif!, s().params, s().hFovDeg)).toBe(42.5);
  });

  it("clamps to the tunable band", () => {
    s().setHFovDeg(1);
    expect(s().hFovDeg).toBe(PHOTO_PROJECT.hFovMinDeg);
    s().setHFovDeg(500);
    expect(s().hFovDeg).toBe(PHOTO_PROJECT.hFovMaxDeg);
  });

  it("undefined / NaN clear the override back to the derived baseline", () => {
    s().setHFovDeg(42.5);
    s().setHFovDeg(undefined);
    expect(s().hFovDeg).toBeUndefined();
    s().setHFovDeg(42.5);
    s().setHFovDeg(Number.NaN);
    expect(s().hFovDeg).toBeUndefined();
    expect(effectiveHFovDeg(s().exif!, s().params, s().hFovDeg)).toBeGreaterThan(0);
  });

  it("never writes the focal — the params stay on their EXIF baseline", () => {
    s().setHFovDeg(42.5);
    expect(s().params.focalLengthMm).toBe(6.86);
  });
});

describe("gizmoOp", () => {
  it("sets any op and resets to none on backToReview, openSaved and clear", () => {
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s().setGizmoOp("rotate");
    expect(s().gizmoOp).toBe("rotate");
    s().backToReview();
    expect(s().gizmoOp).toBe("none");
    s().place();
    s().setGizmoOp("scale");
    s().openSaved(ITEM);
    expect(s().gizmoOp).toBe("none");
    s().setGizmoOp("move");
    s().clear();
    expect(s().gizmoOp).toBe("none");
  });
});

describe("setProjection / setPlaneOpacity", () => {
  it("merges and clamps strength + ownLight to [0,1]", () => {
    s().setProjection({ strength: 1.7 });
    expect(s().projection).toEqual({ ...DEFAULT_PROJECTION, strength: 1 });
    s().setProjection({ ownLight: -0.4, enabled: false });
    expect(s().projection).toEqual({ enabled: false, strength: 1, ownLight: 0, rangeM: null });
    s().setProjection({ strength: 0.35 });
    expect(s().projection).toEqual({ enabled: false, strength: 0.35, ownLight: 0, rangeM: null });
  });

  it("rangeM clamps to [10, 5000] and null means the tunable", () => {
    s().setProjection({ rangeM: 3 });
    expect(s().projection.rangeM).toBe(10);
    s().setProjection({ rangeM: 9000 });
    expect(s().projection.rangeM).toBe(5000);
    s().setProjection({ rangeM: 250 });
    expect(s().projection.rangeM).toBe(250);
    s().setProjection({ rangeM: null });
    expect(s().projection.rangeM).toBeNull();
    s().setProjection({ rangeM: Number.NaN });
    expect(s().projection.rangeM).toBeNull();
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

describe("_syncApex + the lazy exifPose capture (F2)", () => {
  it("writes both heights", () => {
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s()._syncApex(101.5, 1.7);
    expect(s().apexAltM).toBe(101.5);
    expect(s().apexAboveGroundM).toBe(1.7);
    s()._syncApex(102, 2.2);
    expect(s().apexAltM).toBe(102);
    expect(s().apexAboveGroundM).toBe(2.2);
  });

  it("captures exifPose ONCE, on the first landing while placed — from the EXIF baseline, not the edited params", () => {
    s().ingest(extracted(EXIF_GPS, { textureWidth: 4032, textureHeight: 3024 }));
    s().setParam("headingDeg", 10); // a review-step edit must not leak into the RESET baseline
    s().place();
    expect(s().exifPose).toBeUndefined(); // placement alone never captures — the apex is not seated
    s()._syncApex(101.5, 1.7);
    const pose = s().exifPose!;
    expect(pose.lat).toBe(48.4647);
    expect(pose.lon).toBe(35.0462);
    expect(pose.apexAltM).toBe(101.5);
    expect(pose.headingDeg).toBe(214);
    expect(pose.altitudeM).toBe(96);
    expect(pose.hFovDeg).toBeCloseTo(effectiveHFovDeg(EXIF_GPS, { focalLengthMm: 6.86 }), 12);
    s()._syncApex(140, 40); // a later re-seat never rewrites the baseline
    expect(s().exifPose).toBe(pose);
  });

  it("never captures before the placement, and a re-opened row keeps the record's own", () => {
    s().ingest(extracted(EXIF_GPS));
    s()._syncApex(101.5, 1.7); // review — no frustum yet
    expect(s().exifPose).toBeUndefined();
    s().openSaved({ ...ITEM, exifPose: null });
    s()._syncApex(103.2, 1.7);
    expect(s().exifPose).toBeUndefined(); // the row had none; the saved pose is not the EXIF one
  });

  it("captures after a no-GPS photo is placed by a globe click", () => {
    s().ingest(extracted(EXIF_NO_GPS));
    s().place();
    s().setPlacement(48.46, 35.04);
    s()._syncApex(120, 1.6);
    expect(s().exifPose?.lat).toBe(48.46);
    expect(s().exifPose?.hFovDeg).toBeCloseTo(effectiveHFovDeg(EXIF_NO_GPS, { focalLengthMm: 35 }), 12);
  });
});

describe("_markSaved", () => {
  it("records the row id this draft became", () => {
    placedAndSeated();
    s()._markSaved("fac_7");
    expect(s().savedFacadeId).toBe("fac_7");
  });
});

describe("openSaved (the openSavedPin twin)", () => {
  it("lands the row as the placed photo with the overlay closed", () => {
    s().openPanel();
    s().openSaved(ITEM);
    expect(s().phase).toBe("placed");
    expect(s().open).toBe(false);
    expect(s().fileName).toBe("Kyiv facade");
    expect(s().fileSizeBytes).toBe(3_000_000);
    expect(s().file).toBeUndefined();
    expect(s().previewUrl).toBe(ITEM.displayUrl);
    expect(s().previewSource).toBe("decoded");
    expect(s().decodeProgress).toBe(1);
    expect(s().placement).toEqual({ latDeg: 48.4651, lonDeg: 35.047 });
    expect(s().textureWidth).toBe(2048);
    expect(s().textureHeight).toBe(1536);
    expect(s().savedFacadeId).toBe("fac_1");
    expect(s().exifPose).toEqual(SAVED_POSE);
    expect(s().gizmoOp).toBe("none");
    expect(s().rollDeg).toBeUndefined();
    expect(s().hFovDeg).toBeUndefined();
    expect(s().apexAltM).toBeUndefined(); // the globe re-seats it
    expect(s().projection).toEqual({ enabled: true, strength: 0.8, ownLight: 0.4, rangeM: 450 });
  });

  it("synthesizes the EXIF so the shared derivations reproduce the record", () => {
    s().openSaved(ITEM);
    const exif = s().exif!;
    expect(exif.make).toBe("Apple");
    expect(exif.model).toBe("iPhone 15 Pro");
    expect(exif.lensModel).toBeUndefined();
    expect(exif.capturedAt).toBe("2026-06-21T18:42:17");
    expect(exif.gpsLat).toBe(48.4651);
    expect(exif.gpsLon).toBe(35.047);
    expect(exif.gpsAltitudeM).toBe(103.2); // the APEX — EXIF-sourced = absolute in PhotoFrustum.rebuild
    expect(exif.headingDeg).toBe(230.5);
    expect(exif.pitchDeg).toBe(3.5);
    expect(exif.rollDeg).toBe(-1);
    expect(s().params).toEqual({ focalLengthMm: 6.86, headingDeg: 230.5, pitchDeg: 3.5, altitudeM: 103.2 });
    // The stored H-FOV comes back EXACTLY through the focal35 shortcut (f = 18 / tan(hFov/2)).
    expect(Math.abs(effectiveHFovDeg(exif, s().params, s().hFovDeg) - 69.4)).toBeLessThan(1e-9);
  });

  it("tells the residency which row is under edit (lazy, fire-and-forget)", async () => {
    s().openSaved(ITEM);
    await vi.waitFor(() => expect(residency.setEditing).toHaveBeenCalledWith("fac_1"));
  });

  it("supersedes a loaded draft entirely", () => {
    placedAndSeated();
    s().setHFovDeg(30);
    s().setRollDeg(5);
    s().openSaved(ITEM);
    expect(s().hFovDeg).toBeUndefined();
    expect(s().rollDeg).toBeUndefined();
    expect(s().exifPose).toEqual(SAVED_POSE);
  });
});

describe("poseSnapshot / restorePose (the journal's read + restore)", () => {
  it("poseSnapshot is null unless placed", () => {
    expect(s().poseSnapshot()).toBeNull();
    s().ingest(extracted(EXIF_GPS));
    expect(s().poseSnapshot()).toBeNull();
    s().place();
    expect(s().poseSnapshot()).toEqual({
      lat: 48.4647,
      lon: 35.0462,
      altitudeM: 96,
      headingDeg: 214,
      pitchDeg: null,
      rollDeg: null,
      hFovDeg: null,
    });
  });

  it("restorePose round-trips a snapshot through poseSnapshot", () => {
    placedAndSeated();
    s().setParam("pitchDeg", -3);
    s().setRollDeg(2.5);
    s().setHFovDeg(55);
    s().nudgePlacement(10, -5);
    const snap = s().poseSnapshot()!;
    s().setParam("headingDeg", 90);
    s().setParam("pitchDeg", 12);
    s().setRollDeg(undefined);
    s().setHFovDeg(undefined);
    s().nudgePlacement(-50, 50);
    expect(s().poseSnapshot()).not.toEqual(snap);
    s().restorePose(snap);
    expect(s().poseSnapshot()).toEqual(snap);
    expect(s().params.focalLengthMm).toBe(6.86); // untouched — not part of the pose
  });

  it("null fields restore to UNSET (the key is removed, never written as null)", () => {
    placedAndSeated();
    s().setParam("pitchDeg", -3);
    s().setRollDeg(2.5);
    s().setHFovDeg(55);
    s().restorePose({ lat: 48.46, lon: 35.04, altitudeM: null, headingDeg: 200, pitchDeg: null, rollDeg: null, hFovDeg: null });
    expect(s().placement).toEqual({ latDeg: 48.46, lonDeg: 35.04 });
    expect(s().params.headingDeg).toBe(200);
    expect("pitchDeg" in s().params).toBe(false);
    expect("altitudeM" in s().params).toBe(false);
    expect(s().rollDeg).toBeUndefined();
    expect(s().hFovDeg).toBeUndefined();
  });

  it("restorePose is a no-op without a photo", () => {
    s().restorePose({ lat: 1, lon: 2, altitudeM: null, headingDeg: null, pitchDeg: null, rollDeg: null, hFovDeg: null });
    expect(s().placement).toBeUndefined();
  });
});

describe("isolation fences (zero regression to the upload/pin flow)", () => {
  it("the store never imports store/camera (no temp-pin side effect) and reaches the residency lazily only", () => {
    const src = read("src/store/facadePhoto.ts");
    expect(src).not.toMatch(/from "\.\/camera"/);
    const code = stripComments(src);
    expect(code).not.toMatch(/from "\.\/upload"/);
    expect(code).not.toMatch(/from "\.\/facades"/);
    expect(code).toMatch(/import\("\.\/facades"\)/);
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
    // T181: no `?facade` flag, no nav link — the island renders only its portalled surfaces
    expect(code).not.toMatch(/URLSearchParams/);
    expect(code).not.toMatch(/ff-navlink/);
  });

  it("T181: the fork lives in the Upload overlay — its LOWER half feeds this store, one-way", () => {
    const upload = stripComments(read("src/components/panels/UploadFlow.tsx"));
    expect(upload).toMatch(/from "\.\.\/\.\.\/store\/facadePhoto"/);
    // the harness hook `.uf-dropzone--facade input[type=file]`: the half + its own input
    const half = upload.slice(upload.indexOf("uf-dropzone uf-dropzone--facade"));
    expect(half).toMatch(/ref=\{facadeInputRef\}[\s\S]*?type="file"[\s\S]*?accept=\{PHOTO_ACCEPT\}/);
    expect(upload).toMatch(/facade\.openPanel\(\);\s*void facade\.loadFile\(files\[0\]\);/);
    // …and the facade side still never reaches back into store/upload
    expect(stripComments(read("src/components/panels/FacadePhotoFlow.tsx"))).not.toMatch(/store\/upload["']/);
    expect(stripComments(read("src/store/facadePhoto.ts"))).not.toMatch(/store\/upload["']|from "\.\/upload"/);
  });

  it("is mounted on the desktop shell only", () => {
    expect(read("src/pages/index.astro")).toMatch(/<FacadePhotoFlow client:only="react" \/>/);
    expect(read("src/pages/m.astro")).not.toMatch(/FacadePhotoFlow/);
  });
});
