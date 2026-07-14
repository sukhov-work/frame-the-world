/**
 * Frame the World — R2 tiles gateway Worker (Cloudflare Workers, ES module).
 *
 * Fronts a PRIVATE R2 bucket (`frame-the-world-bucket`) and serves the baked 3D-Tiles
 * (`enriched/<city>/tileset.json` + `cell-<i>-<j>.glb`) with the CORS + Range semantics that
 * `3d-tiles-renderer` needs when it streams them CROSS-ORIGIN from the Wix app host. This replaces
 * the pass-through starter Worker, whose responses carried NO `Access-Control-Allow-Origin` — so
 * every cross-origin tile fetch was blocked by the browser.
 *
 * Why a Worker (not an R2 custom domain): `r2.dev` public URLs serve no CORS, and the owner has no
 * domain to bind — a Worker in front of a private bucket gives full header control on the free tier
 * (100k req/day) while keeping the bucket private. Deploy with `scripts/bake/deploy-worker.mjs`
 * (preserves the `R2_BUCKET` binding).
 *
 * CITY-AGNOSTIC / EXTENSIBLE: it serves ANY object key from the bucket, so onboarding city #2
 * (`enriched/kyiv/…`, uploaded with `upload-r2.mjs --city kyiv`) needs ZERO Worker changes — only a
 * new `PUBLIC_ENRICHED_TILES_URL`. Switching to a custom domain later is just a client URL swap.
 *
 * Binding (preserved on redeploy): R2_BUCKET → frame-the-world-bucket.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*", // ODbL-licensed public tiles; C6-sensitive geometry is excluded at bake time
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-Match, If-None-Match, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const contentTypeByExt = (key) =>
  key.endsWith(".json") ? "application/json"
  : key.endsWith(".glb") ? "model/gltf-binary"
  : key.endsWith(".b3dm") || key.endsWith(".cmpt") || key.endsWith(".pnts") ? "application/octet-stream"
  : key.endsWith(".ktx2") ? "image/ktx2"
  : "application/octet-stream";

// Immutable-ish binary tiles cache hard (re-bakes reuse filenames → purge or version-bump the
// prefix to bust); keep tileset.json short so a re-uploaded manifest is picked up quickly.
const cacheControlFor = (key) =>
  key.endsWith(".json") ? "public, max-age=300, must-revalidate"
  : "public, max-age=31536000, immutable";

/** Parse a single `bytes=start-end` range into an R2 get() range option. */
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!m) return null;
  const start = m[1] === "" ? undefined : Number(m[1]);
  const end = m[2] === "" ? undefined : Number(m[2]);
  if (start !== undefined && end !== undefined) return { offset: start, length: end - start + 1 };
  if (start !== undefined) return { offset: start };
  if (end !== undefined) return { suffix: end };
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...CORS, Allow: "GET, HEAD, OPTIONS", "Content-Type": "text/plain" },
      });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    // Root: a tiny health payload (doubles as a pre-release canary), not a bucket lookup.
    if (key === "" || key === "index.html") {
      return new Response(JSON.stringify({ service: "frame-the-world-tiles", ok: true }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (request.method === "HEAD") {
      const head = await env.R2_BUCKET.head(key);
      if (!head) return new Response(null, { status: 404, headers: CORS });
      const headers = new Headers(CORS);
      headers.set("Content-Type", head.httpMetadata?.contentType || contentTypeByExt(key));
      headers.set("Content-Length", String(head.size));
      headers.set("Cache-Control", cacheControlFor(key));
      headers.set("ETag", head.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      return new Response(null, { status: 200, headers });
    }

    const rangeHeader = request.headers.get("range");
    const range = rangeHeader ? parseRange(rangeHeader) : null;
    const object = await env.R2_BUCKET.get(key, range ? { range } : undefined);
    if (!object) {
      return new Response(`404 - ${key} not found`, {
        status: 404,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || contentTypeByExt(key));
    headers.set("Cache-Control", cacheControlFor(key));
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");

    // Partial content when a valid Range resolved.
    if (object.range && rangeHeader) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? object.size - offset;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      return new Response(object.body, { status: 206, headers });
    }

    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  },
};
