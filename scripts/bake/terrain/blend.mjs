// POST-BAKE rim blend — the seam-stitching step (design ruling 2026-08-18, revised same day:
// the original raster-side blend died on geotiff.js's writer producing georeferencing mago
// ignored; operating on the BAKED tiles keeps mago's own COG reading + EGM2008 shift intact).
//
// For every served tile whose bbox comes within blendKm of the bake-extent edge, every vertex
// closer than blendKm to the edge is pulled toward the decoded CWT surface:
//   w = smoothstep(d / blendKm)   h' = w·hPatch + (1−w)·hCWT
// so a served tile's outermost vertices sit EXACTLY on CWT (w→0 at the edge) and the patch↔CWT
// spatial seam is height-continuous at every level. The blend is a pure function of (lon,lat,h),
// so parents, children and virtual-upsampled neighbours all converge to the same surface — the
// pyramid stays self-consistent. Only the h stream + header min/max are rewritten (spliceHeights).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFdRetry } from "./cwt.mjs";
import { decodeQuantizedMesh, spliceHeights } from "./qmesh.mjs";
import { tileBbox, tileRangeInside } from "./tiling.mjs";

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const LAT_KM = 111.2;

/** Blend every rim tile of the bake under outDir. Returns {tiles, verts} counts. */
export async function blendRim({ outDir, extentBbox, extentMaxDepth, blendKm, cwtHeight }) {
  const [W, S, E, N] = extentBbox;
  let tilesTouched = 0;
  let vertsBlended = 0;
  for (let z = 0; z <= extentMaxDepth; z++) {
    const range = tileRangeInside(extentBbox, z);
    if (!range) continue;
    for (let x = range.startX; x <= range.endX; x++) {
      for (let y = range.startY; y <= range.endY; y++) {
        const [w, s, e, n] = tileBbox(z, x, y);
        const lonKm = LAT_KM * Math.cos(((s + n) / 2 / 180) * Math.PI);
        // Min distance from this tile's bbox to the extent edge — skip interior tiles fast.
        const dTile = Math.min((w - W) * lonKm, (E - e) * lonKm, (s - S) * LAT_KM, (N - n) * LAT_KM);
        if (dTile >= blendKm) continue;
        const file = join(outDir, String(z), String(x), `${y}.terrain`);
        // ENOENT only: a missing tile is a straddler-adjacent gap and legitimately skipped, but
        // an ENFILE swallowed here would silently leave a rim tile UNBLENDED — a height step at
        // the seam that nothing downstream would flag.
        const buf = await withFdRetry(() =>
          readFile(file).catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e))),
        );
        if (!buf) continue; // straddler-adjacent gap — not part of the serve set anyway
        const mesh = decodeQuantizedMesh(buf);
        const heights = Float64Array.from(mesh.heights);
        let touched = 0;
        for (let i = 0; i < mesh.vertexCount; i++) {
          const lon = w + (mesh.u[i] / 32767) * (e - w);
          const lat = s + (mesh.v[i] / 32767) * (n - s);
          const d = Math.min((lon - W) * lonKm, (E - lon) * lonKm, (lat - S) * LAT_KM, (N - lat) * LAT_KM);
          if (d >= blendKm) continue;
          const wgt = smoothstep(d / blendKm);
          heights[i] = wgt * heights[i] + (1 - wgt) * (await cwtHeight(lon, lat));
          touched++;
        }
        if (touched > 0) {
          await withFdRetry(() => writeFile(file, spliceHeights(buf, mesh, heights)));
          tilesTouched++;
          vertsBlended += touched;
        }
      }
    }
  }
  return { tiles: tilesTouched, verts: vertsBlended };
}
