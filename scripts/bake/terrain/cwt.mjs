// Cesium World Terrain reference sampler for the rim blend — resolves ion asset 1 via
// PUBLIC_CESIUM_ION_TOKEN (the U7 probe method, UPLIFT_PLAN Appendix A), fetches + disk-caches
// quantized-mesh tiles, and answers ellipsoidal heights at (lon, lat) from the deepest available
// level. CWT heights are already WGS84-ellipsoidal — the same datum the preprocessed GLO-30
// mosaic is shifted into, so blending is datum-consistent by construction.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeQuantizedMesh, sampleQuantizedHeight } from "./qmesh.mjs";
import { tileAt, tileBbox } from "./tiling.mjs";

/**
 * Run `fn`, retrying on a file-descriptor exhaustion error with a short backoff.
 *
 * The rim blend makes one fetch + one cache write per CWT tile and needs on the order of a
 * thousand of them, all serial — so it holds barely any descriptors itself and still died on
 * 2026-08-26 with `ENFILE: file table overflow` partway through the Chernobyl blend, because
 * ENFILE is the SYSTEM-WIDE table (a `lake serve` language server on the same machine was
 * holding ~16k). EMFILE (per-process) is included for symmetry. Retrying is the right response
 * to both: the squeeze is someone else's and it passes. This matters more than a normal
 * transient because `blendRim` is deliberately NOT idempotent — a crash mid-blend cannot be
 * resumed, only re-baked from scratch.
 */
export async function withFdRetry(fn, { tries = 6, baseMs = 400 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if ((err?.code !== "ENFILE" && err?.code !== "EMFILE") || i >= tries - 1) throw err;
      const wait = baseMs * 2 ** i;
      console.warn(`  (${err.code} — file table squeezed; retry ${i + 1}/${tries - 1} in ${wait} ms)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function makeCwtSampler({ ionToken, cacheDir, maxLevel = 13 }) {
  await mkdir(cacheDir, { recursive: true });
  const ep = await (await fetch(`https://api.cesium.com/v1/assets/1/endpoint?access_token=${ionToken}`)).json();
  if (!ep.url) throw new Error(`ion endpoint resolve failed: ${JSON.stringify(ep).slice(0, 200)}`);
  const layer = await (
    await fetch(new URL("layer.json", ep.url), { headers: { authorization: `Bearer ${ep.accessToken}` } })
  ).json();
  const version = layer.version ?? "1.2.0";
  const available = layer.available ?? [];
  const meshes = new Map(); // "z/x/y" -> decoded mesh | null (miss)

  const inAvailable = (z, x, y) =>
    z < available.length && (available[z] ?? []).some((r) => x >= r.startX && x <= r.endX && y >= r.startY && y <= r.endY);

  async function meshFor(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (meshes.has(key)) return meshes.get(key);
    const file = join(cacheDir, `cwt-${z}-${x}-${y}.terrain`);
    // `.catch(() => null)` here means "not cached yet" — but it also used to swallow an ENFILE
    // into a spurious cache miss and a redundant refetch, so the read is narrowed to ENOENT.
    let buf = await withFdRetry(() => readFile(file).catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e))));
    if (!buf) {
      const res = await withFdRetry(() =>
        fetch(new URL(`${z}/${x}/${y}.terrain?v=${version}`, ep.url), {
          headers: {
            authorization: `Bearer ${ep.accessToken}`,
            accept: "application/vnd.quantized-mesh,application/octet-stream;q=0.9",
          },
        }),
      );
      if (!res.ok) {
        meshes.set(key, null);
        return null;
      }
      buf = Buffer.from(await res.arrayBuffer());
      await withFdRetry(() => writeFile(file, buf));
    }
    const mesh = decodeQuantizedMesh(buf);
    meshes.set(key, mesh);
    return mesh;
  }

  /** Ellipsoidal height at (lonDeg, latDeg) from the deepest available CWT tile ≤ maxLevel. */
  return async function cwtHeight(lonDeg, latDeg) {
    for (let z = maxLevel; z >= 0; z--) {
      const { x, y } = tileAt(lonDeg, latDeg, z);
      if (z > 0 && !inAvailable(z, x, y)) continue;
      const mesh = await meshFor(z, x, y);
      if (!mesh) continue;
      const [w, s, e, n] = tileBbox(z, x, y);
      return sampleQuantizedHeight(mesh, (lonDeg - w) / (e - w), (latDeg - s) / (n - s));
    }
    throw new Error(`no CWT tile answered at ${lonDeg},${latDeg}`);
  };
}
