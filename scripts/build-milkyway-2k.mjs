#!/usr/bin/env node
/**
 * Bake the 2k mobile milky-way haze (MOBILE_PLAN M0 texture tier) from the 8k SVS original.
 * Requires `sharp` — NOT a package.json dep by design (one-shot dev script; keeping it out of
 * the install tree is deliberate — audit-2 B3 rider, depcheck flags it): `npm i --no-save sharp`
 * before a regen.
 *
 * TRAP (DECISIONS 2026-07-15, the 4k→8k upgrade): SVS Deep Star Maps are FLUX-PER-PIXEL and much
 * of the flux hides in sub-texel star speckle; the runtime samples with mips OFF (RA-wrap safety),
 * so a naive sRGB downscale reads dark and speckly. Fix here = resize in LINEAR light
 * (sharp's gamma-corrected resize: decode → x^2.2 → Lanczos area-integration → x^(1/2.2) → encode),
 * which integrates the speckle exactly the way the offline gaussian pre-blur did for the 8k bake.
 * Verification = PATCH MEANS in linear space (never single pixels) at the documented landmarks
 * (galactic bulge / LMC, scene/stars.ts haze notes) + the whole-map mean; expect ratios ≈ 1.
 *
 * Usage: node scripts/build-milkyway-2k.mjs   (re-run safe; overwrites the 2k output)
 */
import sharp from "sharp";
import { statSync } from "node:fs";

const SRC = new URL("../public/textures/milkyway-2020.jpg", import.meta.url).pathname;
const OUT = new URL("../public/textures/milkyway-2020-2k.jpg", import.meta.url).pathname;
const OUT_W = 2048;
const OUT_H = 1024;

const srgbToLinear = (v8) => {
  const v = v8 / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Mean LINEAR luminance of a square patch centred at (cx, cy). */
async function patchMean(file, cx, cy, half) {
  const { data, info } = await sharp(file)
    .extract({ left: cx - half, top: cy - half, width: half * 2, height: half * 2 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * info.channels;
    // Rec.709 luma weights on linearized channels
    sum +=
      0.2126 * srgbToLinear(data[o]) +
      0.7152 * srgbToLinear(data[o + 1]) +
      0.0722 * srgbToLinear(data[o + 2]);
  }
  return sum / px;
}

const meta = await sharp(SRC).metadata();
if (meta.width !== 8192 || meta.height !== 4096) {
  throw new Error(`expected the 8k source, got ${meta.width}x${meta.height}`);
}

await sharp(SRC)
  .gamma(2.2, 2.2) // linear-light resize: darken pre-resize, brighten post — the flux fix
  .resize(OUT_W, OUT_H, { kernel: "lanczos3" })
  .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
  .toFile(OUT);

// Landmarks documented on the 4k grid (scene/stars.ts + tuning MILKYWAY notes):
// bulge px (3064,1351) · LMC px (1140,1815). 8k = x2, 2k = /2. Same angular patch both sides.
const landmarks = [
  { name: "bulge", x4k: 3064, y4k: 1351 },
  { name: "LMC", x4k: 1140, y4k: 1815 },
  { name: "dark (N gal pole)", x4k: 3220, y4k: 700 },
];
let worst = 0;
for (const { name, x4k, y4k } of landmarks) {
  const m8 = await patchMean(SRC, x4k * 2, y4k * 2, 64);
  const m2 = await patchMean(OUT, Math.round(x4k / 2), Math.round(y4k / 2), 16);
  const ratio = m2 / m8;
  worst = Math.max(worst, Math.abs(1 - ratio));
  console.log(`${name.padEnd(18)} 8k=${m8.toFixed(5)}  2k=${m2.toFixed(5)}  ratio=${ratio.toFixed(3)}`);
}
const stats8 = await sharp(SRC).stats();
const stats2 = await sharp(OUT).stats();
const mean8 = stats8.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
const mean2 = stats2.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
console.log(`whole-map sRGB mean   8k=${mean8.toFixed(2)}  2k=${mean2.toFixed(2)}  ratio=${(mean2 / mean8).toFixed(3)}`);
console.log(`output ${OUT_W}x${OUT_H} · ${(statSync(OUT).size / 1024).toFixed(0)} KB → ${OUT}`);
if (worst > 0.12) {
  console.error(`FAIL: a landmark patch drifted ${(worst * 100).toFixed(1)}% (>12%) — do not ship this bake.`);
  process.exit(1);
}
console.log("PASS: all landmark patch means within 12% of the 8k source.");
