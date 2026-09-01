// AWS Signature V4 for S3-compatible endpoints (Cloudflare R2: region "auto", service "s3") —
// pure node:crypto, no SDK (public npm is blocked in this environment; the same constraint that
// made the baker pure-Node). Only what a PUT/HEAD of baked tiles needs: path-style URLs, three
// signed headers (host, x-amz-content-sha256, x-amz-date), real payload hashes.
import { createHash, createHmac } from "node:crypto";

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 canonical-URI encode, preserving "/" between segments (the S3 canonical form —
 *  encodeURIComponent alone leaves !'()* unencoded, which SigV4 rejects). */
export function encodeS3Path(path) {
  return path
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()),
    )
    .join("/");
}

/** Content types the baked artifacts actually contain (3D Tiles 1.1: JSON tree + glb cells;
 *  terrain patches: quantized-mesh tiles + layer.json). */
export function contentTypeFor(name) {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".glb")) return "model/gltf-binary";
  if (name.endsWith(".terrain")) return "application/vnd.quantized-mesh";
  return "application/octet-stream";
}

/**
 * SigV4 request headers for one S3-compatible call. `path` is the path-style resource
 * (`/<bucket>/<key>`), `payloadHash` = sha256Hex(body) (or sha256Hex("") for HEAD/GET).
 * Returns the three headers to send verbatim; content-type may be sent unsigned.
 */
export function sigV4Headers({
  method,
  host,
  path,
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region = "auto",
  service = "s3",
  now = new Date(),
  /** Already-CANONICAL query string (`k=v&k2=v2`, keys sorted, RFC 3986-encoded), or "" —
   *  ListObjectsV2 (`list-type=2&prefix=…`) needs it signed; every PUT/DELETE sends none. */
  query = "",
}) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const shortDate = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    encodeS3Path(path),
    query, // "" for PUT/DELETE; the canonical query for a signed list
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "", // end of canonical headers
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${shortDate}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, shortDate), region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
