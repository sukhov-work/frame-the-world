import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/lib/geo/geohash";
import { MODEL_CAPS } from "../../../src/lib/models/modelCaps";
import { MODEL_LIFT_MAX_M } from "../../../src/lib/models/modelPlacement";
import {
  GH5_RE,
  MODEL_MIME,
  MODEL_PAGE,
  MODEL_WORLD_MAX_CELLS,
  MODELS_COLLECTION,
  MODEL_TITLE_MAX,
  applyModelManage,
  applyModelPlacement,
  checkModelUploadRequest,
  isPlacementPatch,
  modelListItem,
  modelRecord,
  parseCreateModelBody,
  parseManageBody,
  parsePlacementBody,
  parseWorldCells,
  publicModel,
  safeModelFileName,
  verifyModelDescriptor,
  verifyThumbnailDescriptor,
  type VerifiedModelFile,
} from "../../../src/lib/wix/modelRecords";

// MESH SUITE MS4 — the UserModels contract: body parsing, the mint allowlist, the descriptor
// verdict (against the REAL descriptor the MS0 probe read back), the record and the list row.

/** Verbatim from verify-shots/probe-model3d-2026-09-01T21-00-30-609Z.json (the PUBLIC upload). */
const PROBE_DESCRIPTOR = {
  id: "166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb",
  displayName: "plux-probe-public-2026-09-01T21-00-30-609Z.glb",
  url: "https://static.wixstatic.com/3d/166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb",
  parentFolderId: "media-root",
  hash: "edf47b084b10c6c09222fa59069d0f2c",
  sizeInBytes: "117888",
  private: false,
  mediaType: "MODEL3D",
  media: {
    model3d: {
      id: "166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb",
      url: "https://static.wixstatic.com/3d/166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb",
      thumbnail: {
        id: "image.preview",
        url: "https://static.wixstatic.com/media/48c4fbc47d7298cd4406936291111111.png",
        height: 256,
        width: 256,
      },
      filename: "plux-probe-public-2026-09-01T21-00-30-609Z.glb",
      sizeInBytes: "117888",
    },
  },
  operationStatus: "READY",
  thumbnailUrl: "https://static.wixstatic.com/media/48c4fbc47d7298cd4406936291111111.png",
  mimeType: "model/gltf-binary",
};

/** An IMAGE descriptor as the preview PUT returns it (the pins flow's shape — `~mv2` ids). */
const THUMB_DESCRIPTOR = {
  id: "166a86_0f3c6f1a9d2e4b7c8a1d2e3f4a5b6c7d~mv2.png",
  url: "https://static.wixstatic.com/media/166a86_0f3c6f1a9d2e4b7c8a1d2e3f4a5b6c7d~mv2.png",
  sizeInBytes: "48213",
  private: false,
  mediaType: "IMAGE",
  operationStatus: "READY",
};

const validBody = {
  fileId: "166a86_a0a4cbd3cd044e278d9d8f4484c3f38d.glb",
  thumbnailFileId: THUMB_DESCRIPTOR.id,
  title: "Water tower",
  fileName: "water-tower.fbx",
  sourceFormat: "fbx",
  rawBytes: 4_200_000,
  glbBytes: 1_900_000,
  tris: 84_000,
  meshes: 4,
  textures: 2,
  decimatedFromTris: 260_000,
  bbox: [12.4, 31.2, 8],
  lat: 48.4647,
  lon: 35.0462,
};

const verified: VerifiedModelFile = {
  fileId: PROBE_DESCRIPTOR.id,
  url: PROBE_DESCRIPTOR.url,
  thumbnailFileId: THUMB_DESCRIPTOR.id,
  thumbnailUrl: THUMB_DESCRIPTOR.url,
  sizeBytes: 117_888,
  readiness: "READY",
};

describe("parseCreateModelBody", () => {
  it("accepts a full valid body verbatim", () => {
    const parsed = parseCreateModelBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body).toEqual(validBody);
  });

  it("defaults the title from the file name and tolerates absent optionals", () => {
    const { title: _t, rawBytes: _r, decimatedFromTris: _d, bbox: _b, lat: _la, lon: _lo, thumbnailFileId: _th, ...rest } = validBody;
    const parsed = parseCreateModelBody(rest);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.body.title).toBe("water-tower");
    expect(parsed.body.thumbnailFileId).toBeNull();
    expect(parsed.body.rawBytes).toBeNull();
    expect(parsed.body.decimatedFromTris).toBeNull();
    expect(parsed.body.bbox).toBeNull();
    expect(parsed.body.lat).toBeNull();
    expect(parsed.body.lon).toBeNull();
  });

  it("names the offending field", () => {
    const err = (b: Record<string, unknown>) => {
      const p = parseCreateModelBody(b);
      return "error" in p ? p.error : null;
    };
    expect(err({ ...validBody, fileId: "../etc" })).toMatch(/fileId/);
    expect(err({ ...validBody, thumbnailFileId: "x y" })).toMatch(/thumbnailFileId/);
    expect(err({ ...validBody, sourceFormat: "stl" })).toMatch(/sourceFormat/);
    expect(err({ ...validBody, glbBytes: MODEL_CAPS.maxGlbBytes + 1 })).toMatch(/glbBytes/);
    expect(err({ ...validBody, tris: MODEL_CAPS.maxTris + 1 })).toMatch(/tris/);
    expect(err({ ...validBody, tris: 0 })).toMatch(/tris/);
    expect(err({ ...validBody, meshes: 0 })).toMatch(/meshes/);
    expect(err({ ...validBody, textures: -1 })).toMatch(/textures/);
    expect(err({ ...validBody, bbox: [1, 2] })).toMatch(/bbox/);
    expect(err({ ...validBody, lon: undefined })).toMatch(/lat and lon/);
    expect(err({ ...validBody, lon: 181 })).toMatch(/lat\/lon/);
    expect(err({ ...validBody, decimatedFromTris: 10 })).toMatch(/decimatedFromTris/);
    expect(err(null as unknown as Record<string, unknown>)).toMatch(/JSON object/);
  });
});

describe("checkModelUploadRequest — the repo's first server-side mime allowlist", () => {
  it("admits exactly one mime type, a .glb name and a size inside the packed cap", () => {
    expect(checkModelUploadRequest("water-tower.glb", MODEL_MIME, 1_900_000)).toEqual({
      ok: true,
      fileName: "water-tower.glb",
    });
  });

  it("refuses images, JSON glTF, empty and over-cap sizes", () => {
    expect(checkModelUploadRequest("x.glb", "image/jpeg", 100).ok).toBe(false);
    expect(checkModelUploadRequest("x.glb", "model/gltf+json", 100).ok).toBe(false);
    expect(checkModelUploadRequest("x.gltf", MODEL_MIME, 100).ok).toBe(false);
    expect(checkModelUploadRequest("x.glb", MODEL_MIME, 0).ok).toBe(false);
    expect(checkModelUploadRequest("x.glb", MODEL_MIME, MODEL_CAPS.maxGlbBytes + 1).ok).toBe(false);
    expect(checkModelUploadRequest("x.glb", MODEL_MIME, MODEL_CAPS.maxGlbBytes).ok).toBe(true);
  });

  it("sanitizes the file name: basename only, safe characters, forced .glb", () => {
    expect(safeModelFileName("../../etc/passwd.glb")).toBe("passwd.glb");
    expect(safeModelFileName("Дніпро tower (v2).GLB")).toBe("tower-v2.glb");
    expect(safeModelFileName("   .glb")).toBe("model.glb");
    expect(safeModelFileName("thing.fbx")).toBeNull();
    expect(safeModelFileName("a".repeat(300) + ".glb")!.length).toBeLessThanOrEqual(200);
  });
});

describe("verifyModelDescriptor — the descriptor is the allowlist", () => {
  it("accepts the probe's real PUBLIC MODEL3D descriptor and reads url / size / READY — and NO thumbnail", () => {
    // The descriptor's own `thumbnailUrl` / `media.model3d.thumbnail.url` is a permanent 403
    // (measured 2026-09-02h, a day after the MS0 upload) — it must never reach a record.
    const v = verifyModelDescriptor(PROBE_DESCRIPTOR);
    expect(v).toEqual({ ok: true, file: { ...verified, thumbnailFileId: null, thumbnailUrl: null } });
  });

  it("verifies OUR uploaded thumbnail as a public, bounded IMAGE with a static URL", () => {
    expect(verifyThumbnailDescriptor(THUMB_DESCRIPTOR)).toEqual({ ok: true, fileId: THUMB_DESCRIPTOR.id, url: THUMB_DESCRIPTOR.url });
    expect(verifyThumbnailDescriptor({ ...THUMB_DESCRIPTOR, mediaType: "MODEL3D" }).ok).toBe(false);
    expect(verifyThumbnailDescriptor({ ...THUMB_DESCRIPTOR, private: true }).ok).toBe(false);
    expect(verifyThumbnailDescriptor({ ...THUMB_DESCRIPTOR, sizeInBytes: String(3 * 1024 * 1024) }).ok).toBe(false);
    expect(verifyThumbnailDescriptor({ ...THUMB_DESCRIPTOR, url: "http://x/y.png" }).ok).toBe(false);
    expect(verifyThumbnailDescriptor(null).ok).toBe(false);
  });

  it("reads the SDK's `_id` spelling too", () => {
    const { id: _i, ...rest } = PROBE_DESCRIPTOR;
    const v = verifyModelDescriptor({ ...rest, _id: PROBE_DESCRIPTOR.id });
    expect(v.ok).toBe(true);
  });

  it("refuses anything that is not a public, GLB-typed, size-capped model with a URL", () => {
    const code = (patch: Record<string, unknown>) => {
      const v = verifyModelDescriptor({ ...PROBE_DESCRIPTOR, ...patch });
      return v.ok ? "OK" : v.code;
    };
    expect(code({ mediaType: "IMAGE" })).toBe("NOT_A_MODEL");
    expect(code({ mimeType: "model/gltf+json" })).toBe("WRONG_MIME");
    expect(code({ private: true })).toBe("PRIVATE_FILE");
    expect(code({ sizeInBytes: String(MODEL_CAPS.maxGlbBytes + 1) })).toBe("TOO_LARGE");
    expect(code({ url: "http://evil.example/x.glb", media: {} })).toBe("NO_URL");
    expect(code({ operationStatus: "FAILED" })).toBe("INGEST_FAILED");
    expect(verifyModelDescriptor(null).ok).toBe(false);
  });

  it("a still-ingesting file is accepted as PENDING; a missing mimeType is tolerated", () => {
    const { mimeType: _m, ...noMime } = PROBE_DESCRIPTOR;
    const v = verifyModelDescriptor({ ...noMime, operationStatus: "PENDING" });
    expect(v.ok && v.file.readiness).toBe("PENDING");
  });
});

describe("modelRecord + modelListItem", () => {
  it("copies url / thumbnail / bytes from the VERIFIED file, never from the body, and geohashes the seed", () => {
    const parsed = parseCreateModelBody({ ...validBody, url: "https://evil.example/x.glb" });
    if ("error" in parsed) throw new Error(parsed.error);
    const row = modelRecord(parsed.body, verified, "member-1");
    expect(row.url).toBe(verified.url);
    expect(row.thumbnailFileId).toBe(THUMB_DESCRIPTOR.id);
    expect(row.thumbnailUrl).toBe(verified.thumbnailUrl);
    expect(row.glbBytes).toBe(117_888);
    expect(row.ownerMemberId).toBe("member-1");
    expect(row.fileId).toBe(verified.fileId);
    expect(row.readiness).toBe("READY");
    expect(row.hidden).toBe(false);
    expect(row.geohash9).toBe(encodeGeohash(48.4647, 35.0462, 9));
    expect(row.bboxX).toBe(12.4);
    expect(row.bboxY).toBe(31.2);
    expect(row.bboxZ).toBe(8);
    expect(row.rotDeg).toBeNull();
    expect(row.scale).toBeNull();
    expect(row.tU).toBeNull(); // MS7: born on the ground
    expect(row.editorMemberId).toBe("member-1"); // MS6: born owner-edited
    expect(Object.keys(row)).toEqual([
      "title", "ownerMemberId", "fileId", "url", "thumbnailFileId", "thumbnailUrl", "fileName", "sourceFormat",
      "rawBytes", "glbBytes", "tris", "meshes", "textures", "decimatedFromTris",
      "bboxX", "bboxY", "bboxZ", "readiness", "hidden", "lat", "lon", "geohash9", "gh5", "rotDeg", "scale", "tU",
      "editorMemberId",
    ]);
  });

  it("an unplaced upload stores null placement and no geohash; the client's byte count fills a missing platform size", () => {
    const parsed = parseCreateModelBody({ ...validBody, lat: null, lon: null });
    if ("error" in parsed) throw new Error(parsed.error);
    const row = modelRecord(parsed.body, { ...verified, sizeBytes: null }, "m");
    expect(row.lat).toBeNull();
    expect(row.lon).toBeNull();
    expect(row.geohash9).toBeNull();
    expect(row.glbBytes).toBe(validBody.glbBytes);
  });

  it("round-trips a stored row into the owner list item and drops a row without a URL", () => {
    const parsed = parseCreateModelBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    const stored = {
      ...modelRecord(parsed.body, verified, "member-1"),
      _id: "row-1",
      _createdDate: new Date("2026-09-02T12:00:00.000Z"),
    };
    const item = modelListItem(stored)!;
    expect(item).toMatchObject({
      id: "row-1",
      title: "Water tower",
      url: verified.url,
      thumbnailUrl: verified.thumbnailUrl,
      sourceFormat: "fbx",
      tris: 84_000,
      decimatedFromTris: 260_000,
      bbox: [12.4, 31.2, 8],
      readiness: "READY",
      hidden: false,
      lat: 48.4647,
      lon: 35.0462,
      createdAt: "2026-09-02T12:00:00.000Z",
      updatedAt: null,
      editedByOther: false,
    });
    expect(modelListItem({ ...stored, url: null })).toBeNull();
    expect(modelListItem({ ...stored, readiness: "weird" })!.readiness).toBe("PENDING");
    expect(MODELS_COLLECTION).toBe("UserModels");
    expect(MODEL_PAGE).toBe(200);
  });
});

// MESH SUITE MS5 — placement: the PATCH body, the row after a placement, the world read's cell
// list, and the PUBLIC shape (C6: never the owner's member id, never a file id).
describe("modelRecords (MS5 placement + the public world read)", () => {
  const stored = (): Record<string, unknown> => {
    const parsed = parseCreateModelBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    return {
      ...modelRecord(parsed.body, verified, "member-1"),
      _id: "row-1",
      _createdDate: new Date("2026-09-02T12:00:00.000Z"),
      _updatedDate: new Date("2026-09-02T12:30:00.000Z"),
    };
  };

  it("a placed record carries BOTH geohash columns; an unplaced one neither", () => {
    const row = stored();
    expect(row.gh5).toBe(encodeGeohash(48.4647, 35.0462, 5));
    expect((row.gh5 as string).length).toBe(5);
    const parsed = parseCreateModelBody({ ...validBody, lat: null, lon: null });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(modelRecord(parsed.body, verified, "m").gh5).toBeNull();
  });

  it("parses a placement body: id + both coordinates required, seats optional and CLAMPED", () => {
    expect(parsePlacementBody(null)).toEqual({ error: "body must be a JSON object" });
    expect("error" in parsePlacementBody({ lat: 1, lon: 2 })).toBe(true);
    expect("error" in parsePlacementBody({ id: "r", lat: 91, lon: 2 })).toBe(true);
    expect("error" in parsePlacementBody({ id: "r", lat: 1 })).toBe(true);
    expect("error" in parsePlacementBody({ id: "r", lat: 1, lon: 2, rotDeg: "x" })).toBe(true);
    expect("error" in parsePlacementBody({ id: "r", lat: 1, lon: 2, scale: 0 })).toBe(true);
    expect(parsePlacementBody({ id: "r", lat: 1, lon: 2 })).toEqual({ body: { id: "r", lat: 1, lon: 2 } });
    expect(parsePlacementBody({ id: "r", lat: 1, lon: 2, rotDeg: 370, scale: 5000 })).toEqual({
      body: { id: "r", lat: 1, lon: 2, rotDeg: 10, scale: 1000 }, // the loose sanity rail (MS5b)
    });
    // MS7: the lift — finite, clamped onto the absolute rail here (the floor needs the row's height).
    expect("error" in parsePlacementBody({ id: "r", lat: 1, lon: 2, tU: "up" })).toBe(true);
    expect(parsePlacementBody({ id: "r", lat: 1, lon: 2, tU: -3.5 })).toEqual({ body: { id: "r", lat: 1, lon: 2, tU: -3.5 } });
    expect(parsePlacementBody({ id: "r", lat: 1, lon: 2, tU: 900 })).toEqual({ body: { id: "r", lat: 1, lon: 2, tU: MODEL_LIFT_MAX_M } });
    expect(parsePlacementBody({ id: "r", lat: 1, lon: 2, tU: -900 })).toEqual({ body: { id: "r", lat: 1, lon: 2, tU: -MODEL_LIFT_MAX_M } });
  });

  it("applies a placement: coordinates + both cells re-derived, seats replaced, identity stored as null", () => {
    const row = stored();
    const moved = applyModelPlacement(row, { id: "row-1", lat: 51.75, lon: -0.34, rotDeg: 90, scale: 2 });
    expect(moved.lat).toBe(51.75);
    expect(moved.lon).toBe(-0.34);
    expect(moved.geohash9).toBe(encodeGeohash(51.75, -0.34, 9));
    expect(moved.gh5).toBe(encodeGeohash(51.75, -0.34, 5));
    expect(moved.rotDeg).toBe(90);
    expect(moved.scale).toBe(2);
    expect(moved.ownerMemberId).toBe("member-1"); // the rest of the row rides along
    expect(moved._id).toBe("row-1");
    // A placement-only PATCH leaves the seats alone; a reset writes null.
    const seated = { ...row, rotDeg: 45, scale: 1.5 };
    expect(applyModelPlacement(seated, { id: "row-1", lat: 1, lon: 2 })).toMatchObject({ rotDeg: 45, scale: 1.5 });
    expect(applyModelPlacement(seated, { id: "row-1", lat: 1, lon: 2, rotDeg: 0, scale: 1 })).toMatchObject({ rotDeg: null, scale: null });
    expect(applyModelPlacement(seated, { id: "row-1", lat: 1, lon: 2, rotDeg: 0 })).toMatchObject({ rotDeg: null, scale: 1.5 });
  });

  it("MS7 — applies a lift: the floor is the row's bboxY × the NEW scale, identity stored as null, unknown height pins", () => {
    const row = stored(); // bbox [12.4, 31.2, 8] → 31.2 m tall at 1×
    expect(applyModelPlacement(row, { id: "row-1", lat: 1, lon: 2, tU: -5 })).toMatchObject({ tU: -5 });
    // Too deep: the floor keeps a quarter of 31.2 m above the seat → −23.4.
    expect(applyModelPlacement(row, { id: "row-1", lat: 1, lon: 2, tU: -30 })).toMatchObject({ tU: -23.4 });
    // A shrink re-rails the STORED lift: 31.2 m sunk 20 m, scaled to 0.1× (3.12 m tall) → −2.34.
    const sunk = { ...row, tU: -20 };
    expect(applyModelPlacement(sunk, { id: "row-1", lat: 1, lon: 2, scale: 0.1 })).toMatchObject({ scale: 0.1, tU: -2.34 });
    // A placement-only PATCH leaves the lift alone; back on the ground writes null.
    expect(applyModelPlacement(sunk, { id: "row-1", lat: 1, lon: 2 })).toMatchObject({ tU: -20 });
    expect(applyModelPlacement(sunk, { id: "row-1", lat: 1, lon: 2, tU: 0 })).toMatchObject({ tU: null });
    expect(applyModelPlacement(sunk, { id: "row-1", lat: 1, lon: 2, rotDeg: 0, scale: 1, tU: 0 })).toMatchObject({ rotDeg: null, scale: null, tU: null });
    // No bbox on the row → nothing proves the model would stay visible → pinned to the ground.
    expect(applyModelPlacement({ ...row, bboxY: null }, { id: "row-1", lat: 1, lon: 2, tU: -5 })).toMatchObject({ tU: null });
    expect(applyModelPlacement({ ...row, bboxY: null }, { id: "row-1", lat: 1, lon: 2, tU: 5 })).toMatchObject({ tU: 5 });
    // Born on the ground.
    expect(row.tU).toBeNull();
  });

  it("parses the world read's cell list: 1..N distinct p5 cells, lower-cased", () => {
    expect("error" in parseWorldCells(null)).toBe(true);
    expect("error" in parseWorldCells("")).toBe(true);
    expect("error" in parseWorldCells("u8vw")).toBe(true); // p4
    expect("error" in parseWorldCells("u8vwa")).toBe(true); // 'a' is not base-32
    expect(parseWorldCells("U8VWX, u8vwx ,u8vwy")).toEqual({ cells: ["u8vwx", "u8vwy"] });
    expect("error" in parseWorldCells(Array.from({ length: MODEL_WORLD_MAX_CELLS + 1 }, (_, i) => `u8vw${"0123456789bcdefghjkmnp"[i]}`).join(","))).toBe(true);
    expect(GH5_RE.test(encodeGeohash(48.4647, 35.0462, 5))).toBe(true);
  });

  it("the public shape carries the placement, the seats and the facts — never the owner or a file id", () => {
    const row = { ...stored(), rotDeg: 30, scale: 1.5 };
    const pub = publicModel(row)!;
    expect(pub).toEqual({
      id: "row-1",
      title: "Water tower",
      url: verified.url,
      thumbnailUrl: verified.thumbnailUrl,
      tris: 84_000,
      glbBytes: verified.sizeBytes,
      bbox: [12.4, 31.2, 8],
      lat: 48.4647,
      lon: 35.0462,
      rotDeg: 30,
      scale: 1.5,
      tU: 0,
      updatedAt: "2026-09-02T12:30:00.000Z",
    });
    // MS7: the lift rides the public row, railed on read against the row's height × scale.
    expect(publicModel({ ...row, tU: -4 })!.tU).toBe(-4);
    expect(publicModel({ ...row, tU: -400 })!.tU).toBe(-(31.2 * 1.5 - 0.25 * 31.2 * 1.5)); // the floor at 1.5×
    expect(Object.keys(pub)).not.toContain("ownerMemberId");
    expect(Object.keys(pub)).not.toContain("fileId");
    expect(Object.keys(pub)).not.toContain("thumbnailFileId");
    expect(publicModel({ ...row, rotDeg: null, scale: null, tU: null })).toMatchObject({ rotDeg: 0, scale: 1, tU: 0 });
    // Anything the world must not stream is dropped even if the query let it through.
    expect(publicModel({ ...row, hidden: true })).toBeNull();
    expect(publicModel({ ...row, readiness: "PENDING" })).toBeNull();
    expect(publicModel({ ...row, lat: null, lon: null })).toBeNull();
    expect(publicModel({ ...row, url: null })).toBeNull();
  });

  it("the owner list row surfaces the seats (identity when the row holds null)", () => {
    const row = stored();
    expect(modelListItem(row)).toMatchObject({ rotDeg: 0, scale: 1, tU: 0 });
    expect(modelListItem({ ...row, rotDeg: -20, scale: 0.5 })).toMatchObject({ rotDeg: -20, scale: 0.5 });
    expect(modelListItem({ ...row, tU: -6 })).toMatchObject({ tU: -6 });
    expect(modelListItem({ ...row, tU: -60 })).toMatchObject({ tU: -23.4 }); // railed on read (31.2 m tall)
  });
});

// MESH SUITE MS6 — management (title / hidden, owner-only) and the member-open placement: the
// dispatch on the body's shape, the manage parser, the editor stamp, the owner list's
// `updatedAt` / `editedByOther`, and the public shape still carrying no identity.
describe("modelRecords (MS6 management + the member-open placement)", () => {
  const stored = (): Record<string, unknown> => {
    const parsed = parseCreateModelBody(validBody);
    if ("error" in parsed) throw new Error(parsed.error);
    return {
      ...modelRecord(parsed.body, verified, "member-1"),
      _id: "row-1",
      _createdDate: new Date("2026-09-02T12:00:00.000Z"),
      _updatedDate: new Date("2026-09-02T12:30:00.000Z"),
    };
  };

  it("dispatches on the body's shape: coordinates → placement, otherwise management", () => {
    expect(isPlacementPatch({ id: "r", lat: 1, lon: 2 })).toBe(true);
    expect(isPlacementPatch({ id: "r", lat: 1 })).toBe(true); // a half body is still a placement (and fails its parser)
    expect(isPlacementPatch({ id: "r", title: "x" })).toBe(false);
    expect(isPlacementPatch({ id: "r", hidden: true, rotDeg: 3 })).toBe(false);
    expect(isPlacementPatch(null)).toBe(false);
  });

  it("parses a management body: the id, a trimmed 1..120-char title and/or a boolean hidden — never nothing", () => {
    expect(parseManageBody(null)).toEqual({ error: "body must be a JSON object" });
    expect("error" in parseManageBody({ title: "x" })).toBe(true);
    expect("error" in parseManageBody({ id: "r" })).toBe(true);
    expect("error" in parseManageBody({ id: "r", title: "   " })).toBe(true);
    expect("error" in parseManageBody({ id: "r", title: "x".repeat(MODEL_TITLE_MAX + 1) })).toBe(true);
    expect("error" in parseManageBody({ id: "r", title: 7 })).toBe(true);
    expect("error" in parseManageBody({ id: "r", hidden: "yes" })).toBe(true);
    expect(parseManageBody({ id: "r", title: "  Water tower  " })).toEqual({ body: { id: "r", title: "Water tower" } });
    expect(parseManageBody({ id: "r", hidden: true })).toEqual({ body: { id: "r", hidden: true } });
    expect(parseManageBody({ id: "r", title: "T", hidden: false })).toEqual({ body: { id: "r", title: "T", hidden: false } });
  });

  it("applies a management body: title / hidden replaced, the placement, seats and editor riding along", () => {
    const row = { ...stored(), rotDeg: 30, scale: 1.5, editorMemberId: "member-2" };
    const hidden = applyModelManage(row, { id: "row-1", hidden: true });
    expect(hidden).toMatchObject({ hidden: true, title: "Water tower", rotDeg: 30, scale: 1.5, editorMemberId: "member-2", lat: 48.4647 });
    const renamed = applyModelManage(row, { id: "row-1", title: "Tower" });
    expect(renamed).toMatchObject({ title: "Tower", hidden: false });
    expect(publicModel(hidden)).toBeNull(); // hidden = withdrawn from the world
    expect(publicModel(renamed)).toMatchObject({ title: "Tower" });
  });

  it("a placement PATCH stamps the editor; the owner list says another member edited it; a legacy row reads as the owner's", () => {
    const row = stored();
    const byOwner = applyModelPlacement(row, { id: "row-1", lat: 1, lon: 2, rotDeg: 10 }, "member-1");
    expect(byOwner.editorMemberId).toBe("member-1");
    expect(modelListItem(byOwner)!.editedByOther).toBe(false);
    const byOther = applyModelPlacement(row, { id: "row-1", lat: 1, lon: 2, rotDeg: 10 }, "member-2");
    expect(byOther.editorMemberId).toBe("member-2");
    expect(byOther.ownerMemberId).toBe("member-1");
    expect(modelListItem(byOther)!.editedByOther).toBe(true);
    // No editor given: the stamp is left as stored (the MS5 call shape).
    expect(applyModelPlacement({ ...row, editorMemberId: "member-2" }, { id: "row-1", lat: 1, lon: 2 }).editorMemberId).toBe("member-2");
    const { editorMemberId: _e, ...legacy } = row;
    expect(modelListItem(legacy)!.editedByOther).toBe(false);
  });

  it("the owner list row carries updatedAt; the public row still carries no identity at all", () => {
    const row = { ...stored(), editorMemberId: "member-2" };
    const item = modelListItem(row)!;
    expect(item.updatedAt).toBe("2026-09-02T12:30:00.000Z");
    expect(Object.keys(item)).not.toContain("editorMemberId");
    const pub = publicModel(row)!;
    expect(Object.keys(pub)).not.toContain("editorMemberId");
    expect(Object.keys(pub)).not.toContain("ownerMemberId");
    expect(Object.keys(pub)).not.toContain("editedByOther");
  });
});
