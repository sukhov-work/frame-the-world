import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFacadeSaveStore, isFacadeSaveBusy, type FacadeSavePhase } from "../../src/store/facadeSave";
import { useFacadePhotoStore } from "../../src/store/facadePhoto";
import type { ExtractedPhoto, PhotoExif } from "../../src/lib/decode/extract";
import type { FacadeListItem, FacadePose } from "../../src/lib/wix/facadeRecords";
import { registerFacadeTargetProbe } from "../../src/lib/globe/facadeTargets";

/**
 * F2 (T169) — the facade SAVE / UPDATE / DELETE pipeline against the CONTRACTS of the modules the
 * other slices own: `lib/save/uploadMedia` (A1 — the three uploads + the three record writes),
 * `lib/save/facadeBody` (A1 — the body builders + exifPoseOf) and `store/facades` (agent C — the
 * residency). All three are mocked here; the integrator verifies the real ones honour the shapes.
 */

const media = vi.hoisted(() => ({
  uploadOriginal: vi.fn(),
  makeFacadeDerivatives: vi.fn(),
  uploadFacadeImage: vi.fn(),
  postFacadeRecord: vi.fn(),
  patchFacadeRecord: vi.fn(),
  deleteFacadeRecord: vi.fn(),
}));
const body = vi.hoisted(() => ({
  buildSaveFacadeBody: vi.fn(),
  buildUpdateFacadeBody: vi.fn(),
}));
const residency = vi.hoisted(() => ({
  upsertMine: vi.fn(),
  removeMine: vi.fn(),
  setEditing: vi.fn(),
}));

vi.mock("../../src/lib/save/uploadMedia", () => media);
vi.mock("../../src/lib/save/facadeBody", () => ({
  ...body,
  exifPoseOf: (exif: PhotoExif, placement: { latDeg: number; lonDeg: number }, apexAltM: number, hFovDeg: number): FacadePose => ({
    lat: placement.latDeg,
    lon: placement.lonDeg,
    apexAltM,
    altitudeM: exif.gpsAltitudeM ?? null,
    headingDeg: exif.headingDeg ?? 0,
    pitchDeg: exif.pitchDeg ?? 0,
    rollDeg: exif.rollDeg ?? 0,
    focalLengthMm: exif.focalLengthMm ?? null,
    hFovDeg,
    fovEstimated: false,
    textureWidth: exif.width ?? null,
    textureHeight: exif.height ?? null,
  }),
}));
vi.mock("../../src/store/facades", () => ({
  useFacadesStore: { getState: () => residency },
}));

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

const FACADE: FacadeListItem = {
  id: "fac_1",
  title: "FACADE_0001",
  displayUrl: "https://static.wixstatic.com/media/x-display.jpg",
  thumbUrl: "https://static.wixstatic.com/media/x-thumb.jpg",
  updatedAt: "2026-10-21T10:00:00.000Z",
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
  textureWidth: 4032,
  textureHeight: 3024,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  targetFeatureIds: [],
  alignment: {},
  capturedAt: null,
  cameraMake: "Apple",
  cameraModel: "iPhone 15 Pro",
  lensModel: null,
  fileName: "FACADE_0001.JPG",
  fileSizeBytes: 4 * 1024 * 1024,
  poseSource: "EXIF",
  exifPose: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  isPublic: false,
  moderation: "PRIVATE",
};

function extracted(exif: PhotoExif): ExtractedPhoto {
  return {
    fileName: "FACADE_0001.JPG",
    fileSizeBytes: 4 * 1024 * 1024,
    previewUrl: "blob:preview",
    previewSource: "decoded",
    exif,
    textureWidth: 4032,
    textureHeight: 3024,
  };
}

const f = () => useFacadePhotoStore.getState();
const save = () => useFacadeSaveStore.getState();

/** A placed draft with a File; `seated` adds the globe's apex write. */
function placeDraft(seated = true): void {
  f().ingest(extracted(EXIF_GPS));
  useFacadePhotoStore.setState({ file: new Blob(["raw"]) as unknown as File });
  f().place();
  if (seated) f()._syncApex(101.5, 1.7);
}

/** Every phase the store passes through, in order (the panel's status line reads these). */
function recordPhases(): FacadeSavePhase[] {
  const phases: FacadeSavePhase[] = [];
  useFacadeSaveStore.subscribe((st, prev) => {
    if (st.phase !== prev.phase) phases.push(st.phase);
  });
  return phases;
}

beforeEach(() => {
  f().clear();
  save().reset();
  save().setTitle(null);
  vi.clearAllMocks();
  media.uploadOriginal.mockImplementation(async (_file: File, onProgress: (p: number) => void) => {
    onProgress(0.5);
    onProgress(1);
    return { fileId: "orig_1", url: "https://static.wixstatic.com/media/orig" };
  });
  media.makeFacadeDerivatives.mockResolvedValue({ display: new Blob(["d"]), thumb: new Blob(["t"]) });
  media.uploadFacadeImage.mockImplementation(async (_blob: Blob, name: string) => ({
    fileId: name.endsWith("-display.jpg") ? "disp_1" : "thumb_1",
    url: `https://static.wixstatic.com/media/${name}`,
  }));
  media.postFacadeRecord.mockResolvedValue({ facadeId: "fac_1", facade: FACADE });
  media.patchFacadeRecord.mockResolvedValue({ facadeId: "fac_1", facade: { ...FACADE, headingDeg: 300 } });
  media.deleteFacadeRecord.mockResolvedValue({ deleted: true, mediaDeleted: true });
  body.buildSaveFacadeBody.mockImplementation((snapshot, ids) => ({ kind: "save", snapshot, ...ids }));
  body.buildUpdateFacadeBody.mockImplementation((snapshot, facadeId) => ({ kind: "update", snapshot, facadeId }));
});

describe("defaults + the busy vocabulary", () => {
  it("starts idle with no title", () => {
    expect(save().phase).toBe("idle");
    expect(save().progress).toBe(0);
    expect(save().title).toBeNull();
    expect(save().facadeId).toBeUndefined();
  });

  it("isFacadeSaveBusy covers every in-flight phase and nothing else", () => {
    const busy: FacadeSavePhase[] = ["uploading-original", "deriving", "uploading-display", "uploading-thumb", "saving", "updating", "deleting"];
    const rest: FacadeSavePhase[] = ["idle", "saved", "updated", "error"];
    for (const p of busy) expect(isFacadeSaveBusy(p)).toBe(true);
    for (const p of rest) expect(isFacadeSaveBusy(p)).toBe(false);
  });
});

describe("saveFacade — the happy path", () => {
  it("walks original → deriving → display → thumb → saving → saved, marks the draft and tells the residency", async () => {
    placeDraft();
    save().setTitle("  Kyiv facade ");
    const phases = recordPhases();
    await save().saveFacade();

    expect(phases).toEqual(["uploading-original", "deriving", "uploading-display", "uploading-thumb", "saving", "saved"]);
    expect(save().phase).toBe("saved");
    expect(save().facadeId).toBe("fac_1");
    expect(save().progress).toBe(1);
    expect(save().warning).toBeUndefined();
    expect(save().error).toBeUndefined();

    // the three uploads, named after the (trimmed) custom title
    expect(media.uploadOriginal).toHaveBeenCalledTimes(1);
    expect(media.makeFacadeDerivatives).toHaveBeenCalledWith("blob:preview");
    expect(media.uploadFacadeImage).toHaveBeenNthCalledWith(1, expect.any(Blob), "Kyiv facade-display.jpg");
    expect(media.uploadFacadeImage).toHaveBeenNthCalledWith(2, expect.any(Blob), "Kyiv facade-thumb.jpg");

    // the body: the snapshot carries the seated apex, the trimmed title, the projection + the
    // captured EXIF pose; the ids are the three uploads'
    const [snapshot, ids] = body.buildSaveFacadeBody.mock.calls[0];
    expect(ids).toEqual({ originalFileId: "orig_1", displayFileId: "disp_1", thumbFileId: "thumb_1" });
    expect(snapshot.apexAltM).toBe(101.5);
    expect(snapshot.title).toBe("Kyiv facade");
    expect(snapshot.placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
    expect(snapshot.projection).toEqual({ strength: 1, ownLight: 0.6, rangeM: null });
    expect(snapshot.exifPose?.apexAltM).toBe(101.5);
    expect(snapshot.fileName).toBe("FACADE_0001.JPG");
    expect(snapshot.textureWidth).toBe(4032);
    expect(media.postFacadeRecord).toHaveBeenCalledWith({ kind: "save", snapshot, ...ids });

    // SAVE becomes UPDATE; the residency gets the row and hides it while it is the draft
    expect(f().savedFacadeId).toBe("fac_1");
    expect(residency.upsertMine).toHaveBeenCalledWith(FACADE);
    expect(residency.setEditing).toHaveBeenCalledWith("fac_1");
  });

  it("T194: a 409 FILE_NOT_READY on the record POST is retried with the SAME body until the image settles; a stale descriptor gives up after the budget", async () => {
    const { FACADE_SAVE_RETRY } = await import("../../src/store/facadeSave");
    const prev = { ...FACADE_SAVE_RETRY };
    FACADE_SAVE_RETRY.attempts = 3;
    FACADE_SAVE_RETRY.delayMs = 1;
    try {
      const notReady = () => Object.assign(new Error("the display image is still being processed"), { code: "FILE_NOT_READY" });
      media.postFacadeRecord.mockReset();
      media.postFacadeRecord.mockRejectedValueOnce(notReady()).mockRejectedValueOnce(notReady()).mockResolvedValueOnce({ facadeId: "fac_1", facade: FACADE });
      placeDraft();
      await save().saveFacade();
      expect(save().phase).toBe("saved");
      expect(media.postFacadeRecord).toHaveBeenCalledTimes(3);
      expect(media.postFacadeRecord.mock.calls[0][0]).toBe(media.postFacadeRecord.mock.calls[2][0]); // the same body, never re-uploaded
      expect(media.uploadFacadeImage).toHaveBeenCalledTimes(2); // display + thumb once
      // Never ready: the budget ends in the error the panel shows, with the code.
      media.postFacadeRecord.mockReset();
      media.postFacadeRecord.mockRejectedValue(notReady());
      save().reset();
      placeDraft();
      await save().saveFacade();
      expect(save().phase).toBe("error");
      expect(save().errorCode).toBe("FILE_NOT_READY");
      expect(media.postFacadeRecord).toHaveBeenCalledTimes(3);
      // Any other failure is NOT retried.
      media.postFacadeRecord.mockReset();
      media.postFacadeRecord.mockRejectedValue(Object.assign(new Error("boom"), { code: "LIST_FAILED" }));
      save().reset();
      placeDraft();
      await save().saveFacade();
      expect(save().phase).toBe("error");
      expect(media.postFacadeRecord).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(FACADE_SAVE_RETRY, prev);
    }
  });

  it("a null title reaches the body as null and names the files after the file name", async () => {
    placeDraft();
    await save().saveFacade();
    expect(body.buildSaveFacadeBody.mock.calls[0][0].title).toBeNull();
    expect(media.uploadFacadeImage).toHaveBeenNthCalledWith(1, expect.any(Blob), "FACADE_0001-display.jpg");
  });

  it("carries the H-FOV override, the roll nudge and the range into the snapshot", async () => {
    placeDraft();
    f().setHFovDeg(50);
    f().setRollDeg(-2);
    f().setProjection({ strength: 0.7, ownLight: 0.2, rangeM: 300 });
    await save().saveFacade();
    const snapshot = body.buildSaveFacadeBody.mock.calls[0][0];
    expect(snapshot.hFovDeg).toBe(50);
    expect(snapshot.rollDeg).toBe(-2);
    expect(snapshot.projection).toEqual({ strength: 0.7, ownLight: 0.2, rangeM: 300 });
  });
});

describe("saveFacade — the refusals", () => {
  it("NOT_PLACED when nothing is placed (idle)", async () => {
    await save().saveFacade();
    expect(save().phase).toBe("error");
    expect(save().errorCode).toBe("NOT_PLACED");
    expect(media.uploadOriginal).not.toHaveBeenCalled();
  });

  it("NOT_PLACED while still in review", async () => {
    f().ingest(extracted(EXIF_GPS));
    await save().saveFacade();
    expect(save().errorCode).toBe("NOT_PLACED");
  });

  it("NOT_SEATED when the globe has not written the apex yet", async () => {
    placeDraft(false);
    await save().saveFacade();
    expect(save().phase).toBe("error");
    expect(save().errorCode).toBe("NOT_SEATED");
    expect(save().error).toMatch(/seated/);
    expect(media.uploadOriginal).not.toHaveBeenCalled();
  });

  it("refuses to start while busy", async () => {
    placeDraft();
    useFacadeSaveStore.setState({ phase: "uploading-display" });
    await save().saveFacade();
    expect(media.uploadOriginal).not.toHaveBeenCalled();
    expect(save().phase).toBe("uploading-display");
  });
});

describe("saveFacade — degradations and failures", () => {
  it("the original's failure DEGRADES to a warning — the pose is still saved", async () => {
    placeDraft();
    media.uploadOriginal.mockRejectedValue(new Error("TUS hiccup"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await save().saveFacade();
    warn.mockRestore();
    expect(save().phase).toBe("saved");
    expect(save().warning).toMatch(/original upload failed/);
    expect(body.buildSaveFacadeBody.mock.calls[0][1].originalFileId).toBeNull();
    expect(f().savedFacadeId).toBe("fac_1");
  });

  it("no File (a re-opened record) skips the original with a warning", async () => {
    placeDraft();
    useFacadePhotoStore.setState({ file: undefined });
    await save().saveFacade();
    expect(media.uploadOriginal).not.toHaveBeenCalled();
    expect(save().phase).toBe("saved");
    expect(save().warning).toMatch(/no longer available/);
  });

  it("the display upload's failure IS the error (the record cannot exist without it)", async () => {
    placeDraft();
    media.uploadFacadeImage.mockImplementation(async (_b: Blob, name: string) => {
      if (name.endsWith("-display.jpg")) {
        const e = new Error("display rejected") as Error & { code?: string };
        e.code = "IMAGE_TOO_LARGE";
        throw e;
      }
      return { fileId: "thumb_1", url: "u" };
    });
    const phases = recordPhases();
    await save().saveFacade();
    expect(phases).toEqual(["uploading-original", "deriving", "uploading-display", "error"]);
    expect(save().error).toBe("display rejected");
    expect(save().errorCode).toBe("IMAGE_TOO_LARGE");
    expect(media.postFacadeRecord).not.toHaveBeenCalled();
    expect(f().savedFacadeId).toBeUndefined();
    expect(residency.upsertMine).not.toHaveBeenCalled();
  });

  it("a derivative failure is the error too", async () => {
    placeDraft();
    media.makeFacadeDerivatives.mockRejectedValue(new Error("canvas lost"));
    await save().saveFacade();
    expect(save().phase).toBe("error");
    expect(save().error).toBe("canvas lost");
    expect(media.uploadFacadeImage).not.toHaveBeenCalled();
  });

  it("the thumb's failure DEGRADES to a warning", async () => {
    placeDraft();
    media.uploadFacadeImage.mockImplementation(async (_b: Blob, name: string) => {
      if (name.endsWith("-thumb.jpg")) throw new Error("thumb rejected");
      return { fileId: "disp_1", url: "u" };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await save().saveFacade();
    warn.mockRestore();
    expect(save().phase).toBe("saved");
    expect(save().warning).toMatch(/thumb upload failed/);
    expect(body.buildSaveFacadeBody.mock.calls[0][1]).toEqual({ originalFileId: "orig_1", displayFileId: "disp_1", thumbFileId: null });
  });

  it("the endpoint's rejection lands as error + errorCode", async () => {
    placeDraft();
    const e = new Error("too many facade photos") as Error & { code?: string };
    e.code = "QUOTA_EXCEEDED";
    media.postFacadeRecord.mockRejectedValue(e);
    await save().saveFacade();
    expect(save().phase).toBe("error");
    expect(save().error).toBe("too many facade photos");
    expect(save().errorCode).toBe("QUOTA_EXCEEDED");
    expect(f().savedFacadeId).toBeUndefined();
  });
});

describe("updateFacade", () => {
  it("requires a saved row (NOT_SAVED)", async () => {
    placeDraft();
    await save().updateFacade();
    expect(save().phase).toBe("error");
    expect(save().errorCode).toBe("NOT_SAVED");
    expect(media.patchFacadeRecord).not.toHaveBeenCalled();
  });

  it("PATCHes the current pose + projection for the saved row and refreshes the residency", async () => {
    placeDraft();
    await save().saveFacade();
    f().setParam("headingDeg", 300);
    f().setProjection({ rangeM: 420 });
    const phases = recordPhases();
    await save().updateFacade();
    expect(phases).toEqual(["updating", "updated"]);
    expect(save().facadeId).toBe("fac_1");
    const [snapshot, facadeId] = body.buildUpdateFacadeBody.mock.calls[0];
    expect(facadeId).toBe("fac_1");
    expect(snapshot.params.headingDeg).toBe(300);
    expect(snapshot.projection.rangeM).toBe(420);
    expect(snapshot.apexAltM).toBe(101.5);
    expect(media.patchFacadeRecord).toHaveBeenCalledWith({ kind: "update", snapshot, facadeId: "fac_1" });
    expect(residency.upsertMine).toHaveBeenLastCalledWith({ ...FACADE, headingDeg: 300 });
    expect(media.uploadOriginal).toHaveBeenCalledTimes(1); // the save's — no media re-upload on update
  });

  it("a re-opened row updates before the globe re-seats it — the stored apex is the fallback", async () => {
    f().openSaved(FACADE);
    expect(f().apexAltM).toBeUndefined();
    await save().updateFacade();
    expect(save().phase).toBe("updated");
    expect(body.buildUpdateFacadeBody.mock.calls[0][0].apexAltM).toBe(101.5);
  });

  it("a failure lands as error", async () => {
    f().openSaved(FACADE);
    media.patchFacadeRecord.mockRejectedValue(new Error("not yours"));
    await save().updateFacade();
    expect(save().phase).toBe("error");
    expect(save().error).toBe("not yours");
  });
});

describe("deleteFacade", () => {
  it("requires a saved row (NOT_SAVED)", async () => {
    placeDraft();
    await save().deleteFacade();
    expect(save().errorCode).toBe("NOT_SAVED");
    expect(media.deleteFacadeRecord).not.toHaveBeenCalled();
  });

  it("deletes the row, forgets it in the residency and clears the placed photo", async () => {
    f().openSaved(FACADE);
    const phases = recordPhases();
    await save().deleteFacade();
    expect(phases).toEqual(["deleting", "idle"]);
    expect(media.deleteFacadeRecord).toHaveBeenCalledWith("fac_1");
    expect(residency.removeMine).toHaveBeenCalledWith("fac_1");
    expect(f().phase).toBe("idle");
    expect(f().savedFacadeId).toBeUndefined();
    expect(save().facadeId).toBeUndefined();
  });

  it("a failure keeps the photo placed", async () => {
    f().openSaved(FACADE);
    media.deleteFacadeRecord.mockRejectedValue(new Error("HTTP 500"));
    await save().deleteFacade();
    expect(save().phase).toBe("error");
    expect(f().phase).toBe("placed");
    expect(f().savedFacadeId).toBe("fac_1");
  });

  it("deleteFacadeById (T178 / T179): another row deletes without touching the placed photo", async () => {
    f().openSaved(FACADE);
    const phases = recordPhases();
    await save().deleteFacadeById("fac_other");
    expect(phases).toEqual(["deleting", "idle"]);
    expect(media.deleteFacadeRecord).toHaveBeenCalledWith("fac_other");
    expect(residency.removeMine).toHaveBeenCalledWith("fac_other");
    expect(f().phase).toBe("placed");
    expect(f().savedFacadeId).toBe("fac_1");
  });

  it("deleteFacadeById on the placed row clears it; an empty id is NOT_SAVED; busy is refused", async () => {
    f().openSaved(FACADE);
    await save().deleteFacadeById("");
    expect(save().errorCode).toBe("NOT_SAVED");
    expect(media.deleteFacadeRecord).not.toHaveBeenCalled();
    await save().deleteFacadeById("fac_1");
    expect(media.deleteFacadeRecord).toHaveBeenCalledWith("fac_1");
    expect(f().phase).toBe("idle");
    expect(f().savedFacadeId).toBeUndefined();
    useFacadeSaveStore.setState({ phase: "deleting" });
    media.deleteFacadeRecord.mockClear();
    await save().deleteFacadeById("fac_2");
    expect(media.deleteFacadeRecord).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("returns to idle and keeps the title (the panel re-seeds it per identity)", async () => {
    placeDraft();
    save().setTitle("Kept");
    await save().saveFacade();
    save().reset();
    expect(save().phase).toBe("idle");
    expect(save().progress).toBe(0);
    expect(save().facadeId).toBeUndefined();
    expect(save().warning).toBeUndefined();
    expect(save().title).toBe("Kept");
  });
});

describe("the target probe (T172 / F5) — pulled once per write, right before the body", () => {
  let unreg: (() => void) | null = null;
  afterEach(() => {
    unreg?.();
    unreg = null;
  });

  it("SAVE: the probe's ids reach the POST body's snapshot; the probe runs once, in the saving phase", async () => {
    const seenPhases: FacadeSavePhase[] = [];
    unreg = registerFacadeTargetProbe(() => {
      seenPhases.push(save().phase);
      return ["osm:w132547176", "osm:r1067316"];
    });
    placeDraft();
    await save().saveFacade();
    expect(save().phase).toBe("saved");
    expect(seenPhases).toEqual(["saving"]);
    const snapshot = body.buildSaveFacadeBody.mock.calls[0][0];
    expect(snapshot.targetFeatureIds).toEqual(["osm:w132547176", "osm:r1067316"]);
    expect(media.postFacadeRecord.mock.calls[0][0].snapshot.targetFeatureIds).toEqual(["osm:w132547176", "osm:r1067316"]);
  });

  it("SAVE without a globe (no probe) or with a throwing one still lands — the snapshot carries null", async () => {
    placeDraft();
    await save().saveFacade();
    expect(save().phase).toBe("saved");
    expect(body.buildSaveFacadeBody.mock.calls[0][0].targetFeatureIds).toBeNull();

    f().clear();
    save().reset();
    vi.clearAllMocks();
    unreg = registerFacadeTargetProbe(() => {
      throw new Error("no scene");
    });
    placeDraft();
    await save().saveFacade();
    expect(save().phase).toBe("saved");
    expect(body.buildSaveFacadeBody.mock.calls[0][0].targetFeatureIds).toBeNull();
  });

  it("UPDATE: the re-probed ids reach the PATCH body's snapshot", async () => {
    f().openSaved(FACADE);
    unreg = registerFacadeTargetProbe(() => ["osm:w1"]);
    await save().updateFacade();
    expect(save().phase).toBe("updated");
    expect(body.buildUpdateFacadeBody.mock.calls[0][0].targetFeatureIds).toEqual(["osm:w1"]);
    expect(media.patchFacadeRecord.mock.calls[0][0].snapshot.targetFeatureIds).toEqual(["osm:w1"]);
  });
});

describe("F5 (T172, 2026-10-24) — the alignment record rides the snapshot", () => {
  it("the save snapshot carries the pairs + origin as `alignment`; without pairs it is `{}` (the store's state is the truth — a CLEAR + UPDATE wipes a stored set)", async () => {
    placeDraft();
    await save().saveFacade();
    expect(body.buildSaveFacadeBody.mock.calls[0][0].alignment).toEqual({});
    f().startPairPick();
    f().setPendingUv([0.25, 0.5]);
    f().completePair([3.123456, -2.5, 4.0004], "osm:w1");
    f()._setSolved({ pose: f().poseSnapshot()!, rmsPx: 0.7, n: 1, fovSolved: false, planar: true, at: "2026-10-24T12:00:00.000Z" });
    await save().updateFacade();
    const snap = body.buildUpdateFacadeBody.mock.calls.at(-1)![0];
    expect(snap.alignment).toEqual({
      pairs: [{ uv: [0.25, 0.5], enu: [3.123, -2.5, 4], target: "osm:w1" }],
      origin: { lat: 48.4647, lon: 35.0462, altM: 101.5 },
      solved: { pose: f().poseSnapshot(), rmsPx: 0.7, n: 1, fovSolved: false, planar: true, at: "2026-10-24T12:00:00.000Z" },
    });
  });
});
