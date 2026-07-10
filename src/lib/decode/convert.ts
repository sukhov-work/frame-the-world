/**
 * Pure pixel-buffer conversion shared by the decode worker and its main-thread fallback.
 * Kept free of Worker/DOM globals so vitest can exercise it directly.
 */

/**
 * Interleave LibRaw/libheif channel output into the RGBA layout `ImageData` wants.
 * Accepts 1 (grey), 3 (RGB) or 4 (already-RGBA) channels; 16-bit samples are demoted to 8-bit.
 */
export function channelsToRgba(
  data: Uint8Array | Uint16Array,
  width: number,
  height: number,
  colors: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = width * height;
  if (pixels <= 0) throw new Error(`channelsToRgba: empty image (${width}x${height})`);
  if (colors !== 1 && colors !== 3 && colors !== 4) {
    throw new Error(`channelsToRgba: unsupported channel count ${colors}`);
  }
  if (data.length < pixels * colors) {
    throw new Error(`channelsToRgba: buffer too small (${data.length} < ${pixels * colors})`);
  }

  const shift = data instanceof Uint16Array ? 8 : 0;
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let p = 0, s = 0, d = 0; p < pixels; p++, s += colors, d += 4) {
    if (colors === 1) {
      const v = data[s] >> shift;
      rgba[d] = v;
      rgba[d + 1] = v;
      rgba[d + 2] = v;
      rgba[d + 3] = 255;
    } else {
      rgba[d] = data[s] >> shift;
      rgba[d + 1] = data[s + 1] >> shift;
      rgba[d + 2] = data[s + 2] >> shift;
      rgba[d + 3] = colors === 4 ? data[s + 3] >> shift : 255;
    }
  }
  return rgba;
}
