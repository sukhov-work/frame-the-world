import { describe, it, expect } from "vitest";
import { contentTypeFor, encodeS3Path, sha256Hex, sigV4Headers } from "../../scripts/bake/lib/s3sign.mjs";

// The R2 upload signer (scripts/bake/upload-r2.mjs) — a bad canonical form fails ALL uploads with an
// opaque 403, so the pure pieces are unit-gated like the bake geometry.

describe("sha256Hex", () => {
  it("hashes the empty payload to the SigV4 well-known constant", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("encodeS3Path", () => {
  it("preserves slashes, encodes segments, uppercases the RFC-3986 extras", () => {
    expect(encodeS3Path("/bucket/enriched/dnipro/tileset.json")).toBe("/bucket/enriched/dnipro/tileset.json");
    expect(encodeS3Path("/b/a b/c'(1).glb")).toBe("/b/a%20b/c%27%281%29.glb");
  });
});

describe("contentTypeFor", () => {
  it("maps the tileset's two real types + a safe default", () => {
    expect(contentTypeFor("tileset.json")).toBe("application/json");
    expect(contentTypeFor("cell-3-4.glb")).toBe("model/gltf-binary");
    expect(contentTypeFor("README")).toBe("application/octet-stream");
  });
});

describe("sigV4Headers", () => {
  const req = {
    method: "PUT",
    host: "acct.r2.cloudflarestorage.com",
    path: "/bucket/enriched/dnipro/tileset.json",
    payloadHash: sha256Hex("{}"),
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
    now: new Date("2026-07-13T12:34:56.789Z"),
  };

  it("formats the amz date + scope and emits a 64-hex signature", () => {
    const h = sigV4Headers(req);
    expect(h["x-amz-date"]).toBe("20260713T123456Z");
    expect(h.authorization).toContain("Credential=AKID/20260713/auto/s3/aws4_request");
    expect(h.authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
    expect(h.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs, and the signature moves with the secret/path", () => {
    const a = sigV4Headers(req);
    const b = sigV4Headers({ ...req });
    expect(a.authorization).toBe(b.authorization);
    const otherSecret = sigV4Headers({ ...req, secretAccessKey: "SECRET2" });
    const otherPath = sigV4Headers({ ...req, path: "/bucket/enriched/dnipro/cell-0-0.glb" });
    expect(otherSecret.authorization).not.toBe(a.authorization);
    expect(otherPath.authorization).not.toBe(a.authorization);
  });
});
