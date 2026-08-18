// Copernicus GLO-30 fetcher — anonymous HTTPS GETs against the AWS Open Data bucket
// (registry.opendata.aws/copernicus-dem, bucket copernicus-dem-30m, eu-central-1; keys proven
// live 2026-08-18: 200 + ~42 MB per 1x1 deg COG). DEM = COG GeoTIFF, DEFLATE + float predictor,
// 3600x3600 px, horizontal EPSG:4326, vertical EGM2008 orthometric. AUXFILES/<name>_WBM.tif is
// the 8-bit water-body mask (~140 KB) — cached alongside for future use, not consumed by v1.
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BUCKET = "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com";

/** 1x1 deg GLO-30 tile names covering bbox [w,s,e,n] (names key the tile's SW corner). */
export function glo30TileNames(bbox) {
  const [w, s, e, n] = bbox;
  const names = [];
  for (let lat = Math.floor(s); lat < Math.ceil(n); lat++) {
    for (let lon = Math.floor(w); lon < Math.ceil(e); lon++) {
      const ns = lat >= 0 ? "N" : "S";
      const ew = lon >= 0 ? "E" : "W";
      const alat = String(Math.abs(lat)).padStart(2, "0");
      const alon = String(Math.abs(lon)).padStart(3, "0");
      names.push(`Copernicus_DSM_COG_10_${ns}${alat}_00_${ew}${alon}_00_DEM`);
    }
  }
  return names;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/** Ensure DEM (+WBM aux) tiles for bbox are in cacheDir; returns absolute DEM paths. */
export async function ensureGlo30(bbox, cacheDir, { refresh = false } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const dems = [];
  for (const name of glo30TileNames(bbox)) {
    const dem = join(cacheDir, `${name}.tif`);
    const wbm = join(cacheDir, `${name.replace(/_DEM$/, "_WBM")}.tif`);
    if (refresh || !(await stat(dem).catch(() => null))) {
      console.log(`  ↓ ${name}.tif`);
      await download(`${BUCKET}/${name}/${name}.tif`, dem);
    }
    if (refresh || !(await stat(wbm).catch(() => null))) {
      const wbmKey = `${name}/AUXFILES/${name.replace(/_DEM$/, "_WBM")}.tif`;
      await download(`${BUCKET}/${wbmKey}`, wbm).catch((e) => console.warn(`  (wbm skip: ${e.message})`));
    }
    dems.push(dem);
  }
  return dems;
}
