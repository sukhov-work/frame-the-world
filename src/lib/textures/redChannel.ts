/**
 * Single-channel texture extraction (Phase 5.5 S5, §Item 8 — Black Marble city lights).
 *
 * A grayscale JPEG decodes on a canvas to RGBA (4 bytes/px); the GPU only needs one channel.
 * This pulls the R channel into a tight Uint8Array for a THREE.DataTexture(RedFormat) —
 * 8192×4096 drops from ~134 MB RGBA to ~34 MB R8 on the GPU.
 *
 * `flipY`: canvas ImageData rows run top→bottom while three's sphere UVs put v=0 at the
 * bottom — and WebGL's UNPACK_FLIP_Y does NOT apply to typed-array uploads, so the flip must
 * happen in the data itself. Pure (unit-tested); the caller owns canvas/bitmap lifecycle.
 */
export function extractRedChannel(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: { flipY?: boolean } = {},
): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `extractRedChannel: expected ${width * height * 4} RGBA bytes, got ${rgba.length}`,
    );
  }
  const out = new Uint8Array(width * height);
  const flip = opts.flipY ?? false;
  for (let y = 0; y < height; y++) {
    const srcRow = flip ? height - 1 - y : y;
    let src = srcRow * width * 4;
    let dst = y * width;
    for (let x = 0; x < width; x++, src += 4, dst++) out[dst] = rgba[src];
  }
  return out;
}
