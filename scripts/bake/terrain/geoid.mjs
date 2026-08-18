// EGM2008 geoid undulation N over the Dnipro terrain extent — 0.5-deg grid sampled from
// GeographicLib GeoidEval (EGM2008 2.5' model) on 2026-08-18, bilinear in between. N varies
// smoothly (~5.7 m across the 1x2 deg extent) so bilinear on this grid is within ~dm of the
// full model — negligible vs the 30 m raster (<4 m LE90). ellipsoidal = orthometric + N.
// Source rows (lat: lon 34.0 34.5 35.0 35.5 36.0):
//   48.0: 22.8930 22.2237 21.5827 20.6217 20.0251
//   48.5: 22.2327 21.3571 20.4179 19.5264 19.0739
//   49.0: 21.0122 19.7937 18.6689 17.6549 17.1451
const LATS = [48.0, 48.5, 49.0];
const LONS = [34.0, 34.5, 35.0, 35.5, 36.0];
const N = [
  [22.893, 22.2237, 21.5827, 20.6217, 20.0251],
  [22.2327, 21.3571, 20.4179, 19.5264, 19.0739],
  [21.0122, 19.7937, 18.6689, 17.6549, 17.1451],
];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Geoid height N (m) at (lonDeg, latDeg) — bilinear over the embedded grid, clamped to it. */
export function geoidN(lonDeg, latDeg) {
  const fy = clamp((latDeg - LATS[0]) / 0.5, 0, LATS.length - 1 - 1e-9);
  const fx = clamp((lonDeg - LONS[0]) / 0.5, 0, LONS.length - 1 - 1e-9);
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);
  const ty = fy - y0;
  const tx = fx - x0;
  const a = N[y0][x0] * (1 - tx) + N[y0][x0 + 1] * tx;
  const b = N[y0 + 1][x0] * (1 - tx) + N[y0 + 1][x0 + 1] * tx;
  return a * (1 - ty) + b * ty;
}
