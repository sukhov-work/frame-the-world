// EGM2008 geoid undulation N — the bake's INDEPENDENT verification reference (step 6 of
// bake-terrain.mjs). `ellipsoidal = orthometric + N`, so this is what converts a GLO-30 COG
// reading (orthometric, EGM2008) into the datum mago-3d-terrainer writes, WITHOUT asking mago
// what it did. It is deliberately not a general geoid model: it is a set of small sampled
// grids, one per baked region, checked in so the verification needs no external tool at bake time.
//
// Sampled with GeographicLib `GeoidEval -n egm2008-5` (2026-08-22h; the dnipro rows were taken
// from the 2.5' model on 2026-08-18 and the 5' model reproduces all fifteen of them to within
// 1.6 mm, so the two vintages are interchangeable at this precision).
//
// **A LOOKUP OUTSIDE EVERY GRID THROWS.** It used to clamp to the nearest grid corner, and that
// silent fallback cost a whole bake: the Everest probe (27.99 N, 86.93 E) was answered with the
// Dnipro grid's 36 E / 48 N corner, +20.025 m, when the true value there is −28.341 m. The bake
// was correct; the reference was 48 m wrong and looked like a plausible number, so the failure
// read as "the terrain is 39 m too low" — a datum fault that did not exist. Out-of-range must be
// loud, because an out-of-range geoid lookup has no defensible answer.
//
// Adding a region: sample a grid that COVERS the bake's extentBbox and append it below.
//   for lat in …; do for lon in …; do echo "$lat $lon" | GeoidEval -n egm2008-5; done; done

/**
 * One region's sampled grid. `n[i][j]` is N at (lat0 + i·step, lon0 + j·step) — rows run
 * SOUTH→NORTH, columns WEST→EAST, and the grid must cover its region's whole extentBbox.
 */
const GRIDS = [
  {
    // Dnipro, extentBbox [34,48,36,49]. Verbatim from the 2026-08-18 bake — N moves only ~5.7 m
    // across the whole extent, so 0.5° is far finer than it needs to be.
    id: "dnipro",
    lat0: 48.0,
    lon0: 34.0,
    step: 0.5,
    n: [
      [22.893, 22.2237, 21.5827, 20.6217, 20.0251],
      [22.2327, 21.3571, 20.4179, 19.5264, 19.0739],
      [21.0122, 19.7937, 18.6689, 17.6549, 17.1451],
    ],
  },
  {
    // Everest, extentBbox [86,27,88,29]. 0.25° — HALF Dnipro's spacing, because the Himalayan
    // geoid is nothing like the Ukrainian one: N runs from −59.1 m at the southern edge (the
    // Ganges plain) to −27.2 m under the range, a 32 m swing with real curvature in it. The
    // spacing was chosen by measurement, not taste — `--check-geoid` reports the residual of
    // this bilinear grid against dense GeoidEval samples.
    id: "everest",
    lat0: 27.0,
    lon0: 86.0,
    step: 0.25,
    n: [
      [-59.0792, -56.6371, -54.1431, -52.4802, -51.2317, -50.5179, -49.0459, -47.7531, -46.6797],
      [-53.2065, -50.4496, -48.2509, -46.6968, -45.1284, -45.7445, -44.0785, -43.7715, -41.3405],
      [-46.6186, -43.7974, -40.7869, -39.9588, -39.1944, -40.6432, -39.314, -38.5434, -35.8274],
      [-40.6205, -37.7329, -33.8096, -32.4031, -31.8487, -34.4831, -35.123, -33.207, -31.1742],
      [-33.4156, -31.9155, -29.4547, -27.7885, -27.7842, -30.1479, -31.3484, -30.0505, -29.4012],
      [-27.9252, -27.4082, -27.2759, -26.9595, -27.526, -29.2267, -29.893, -29.7219, -29.968],
      [-27.4609, -27.2033, -27.7463, -28.3188, -28.7865, -29.4333, -30.0731, -30.3827, -30.3924],
      [-27.4401, -28.2275, -28.8369, -29.0017, -29.1746, -29.5455, -29.7771, -30.3264, -30.7839],
      [-28.5123, -29.417, -29.8756, -29.6032, -29.6844, -30.0861, -30.4491, -31.1609, -31.7481],
    ],
  },
  {
    // Chernobyl / Pripyat, extentBbox [30,51,31,52]. 0.25° — finer than this smooth a geoid
    // needs (N moves only 3.5 m across the whole 1°×1° extent, 21.96 → 25.41), but the extent is
    // one GLO-30 tile so a 5×5 grid is 25 samples and the residual is negligible: bilinear here
    // reproduces GeoidEval at the bake's own probe point (51.397, 30.078) to 3.9 mm
    // (24.0212 vs 24.0251). Sampled 2026-08-26 with `GeoidEval -n egm2008-5`.
    id: "chernobyl",
    lat0: 51.0,
    lon0: 30.0,
    step: 0.25,
    n: [
      [24.6269, 24.7635, 24.849, 25.0132, 25.0705],
      [24.0804, 24.5251, 24.9893, 25.3185, 25.3401],
      [23.6595, 24.3744, 24.8252, 25.2242, 25.4132],
      [23.0488, 23.9403, 24.534, 24.8879, 24.8573],
      [21.9566, 22.632, 23.2913, 23.5955, 23.4637],
    ],
  },
];

/** The grid whose sampled extent contains (lon, lat), or null. */
function gridFor(lonDeg, latDeg) {
  for (const g of GRIDS) {
    const latN = g.lat0 + (g.n.length - 1) * g.step;
    const lonE = g.lon0 + (g.n[0].length - 1) * g.step;
    if (latDeg >= g.lat0 && latDeg <= latN && lonDeg >= g.lon0 && lonDeg <= lonE) return g;
  }
  return null;
}

/** Geoid height N (m) at (lonDeg, latDeg), bilinear over the covering region grid. THROWS when
 *  no grid covers the point — see the header: a clamped answer here is a wrong answer. */
export function geoidN(lonDeg, latDeg) {
  const g = gridFor(lonDeg, latDeg);
  if (!g) {
    throw new Error(
      `geoidN: no EGM2008 sample grid covers ${latDeg.toFixed(4)}, ${lonDeg.toFixed(4)} ` +
        `(have: ${GRIDS.map((x) => x.id).join(", ")}) — sample one for this region, never clamp`,
    );
  }
  const fy = (latDeg - g.lat0) / g.step;
  const fx = (lonDeg - g.lon0) / g.step;
  const y0 = Math.min(Math.floor(fy), g.n.length - 2);
  const x0 = Math.min(Math.floor(fx), g.n[0].length - 2);
  const ty = fy - y0;
  const tx = fx - x0;
  const a = g.n[y0][x0] * (1 - tx) + g.n[y0][x0 + 1] * tx;
  const b = g.n[y0 + 1][x0] * (1 - tx) + g.n[y0 + 1][x0 + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** Region ids with a sampled grid — used by the bake's pre-flight coverage check. */
export const geoidGridIds = () => GRIDS.map((g) => g.id);

/** Does a grid cover this whole bbox [w,s,e,n]? The bake asserts this BEFORE meshing, so a
 *  missing grid costs a second rather than a four-minute bake plus a misleading probe failure. */
export function geoidCovers([w, s, e, n]) {
  return !!(gridFor(w, s) && gridFor(e, s) && gridFor(w, n) && gridFor(e, n));
}
