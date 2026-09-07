/**
 * WMM2025 — the World Magnetic Model, declination only (owner order 2026-09-07g: AR look-around
 * needs TRUE north; every phone compass reports MAGNETIC north — iOS `webkitCompassHeading` per
 * Apple's WebKit JS docs, Android's `TYPE_ROTATION_VECTOR` per the SensorEvent docs — and at Dnipro
 * the difference is +8.58° E in 2026 (NOAA calculator, WMM2025; BGS agrees to 0.001°)).
 *
 * THE DATA. `COEFFS` is the official `WMM.COF` (epoch 2025.0, dated 2024-11-13, valid 2025.0–2030.0),
 * 90 Gauss rows `[n, m, g, h, gdot, hdot]` in nT and nT/yr, downloaded 2026-09-07 from
 * https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip. NCEI: "The WMM source code
 * is in the public domain and not licensed or under copyright" (17 U.S.C. 403 notice: this table is
 * U.S. government work, reproduced verbatim). Refresh in December 2029 by swapping the 90 rows for
 * WMM2030 and re-running `test/lib/geo/wmm.test.ts` against the new test-value file.
 *
 * THE ALGORITHM is the WMM Technical Report §1.2 (Chulliat et al. 2025, doi:10.25923/prbc-s316) as
 * implemented in NOAA's public-domain `GeomagnetismLibrary.c`: geodetic → geocentric on WGS 84,
 * Schmidt semi-normalised associated Legendre functions by the `MAG_PcupLow` recursion (derivative
 * with respect to LATITUDE — the sign flip at the end is theirs), the degree-12 summation with
 * `(a/r)^(n+2)`, the rotation back to the geodetic frame, `D = atan2(Y, X)`. Pure, three-free, no
 * dependency (`geomagnetism@0.2.0` is the only npm package that carries WMM2025 and it is CommonJS
 * with four bundled models; `geomag@1.0.0` is still WMM2020 — the recorded decision, DECISIONS
 * 2026-09-07h).
 *
 * ACCURACY: the model's own declination error is 0.36° RMS globally at 2025.0 (Tech Report Table
 * 16), ~0.37° 1σ at Dnipro (δD = √(0.26² + (5417/H)²), H = 20,482 nT) — an order of magnitude under
 * a phone compass's own error, so the high-resolution WMMHR (0.03° better) is not worth its 18,210
 * coefficients. Pinned by the official 100-row test-value file to 0.01°.
 */

/** WGS 84 semi-major axis (km) and flattening; the WMM reference sphere radius (km). */
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WMM_RE_KM = 6371.2;
/** The model's epoch and its validity window (decimal years). */
export const WMM_EPOCH = 2025.0;
export const WMM_VALID_UNTIL = 2030.0;
const N_MAX = 12;

// prettier-ignore
const COEFFS: readonly (readonly [number, number, number, number, number, number])[] = [
  [1,0,-29351.8,0.0,12.0,0.0], [1,1,-1410.8,4545.4,9.7,-21.5], [2,0,-2556.6,0.0,-11.6,0.0],
  [2,1,2951.1,-3133.6,-5.2,-27.7], [2,2,1649.3,-815.1,-8.0,-12.1], [3,0,1361.0,0.0,-1.3,0.0],
  [3,1,-2404.1,-56.6,-4.2,4.0], [3,2,1243.8,237.5,0.4,-0.3], [3,3,453.6,-549.5,-15.6,-4.1],
  [4,0,895.0,0.0,-1.6,0.0], [4,1,799.5,278.6,-2.4,-1.1], [4,2,55.7,-133.9,-6.0,4.1],
  [4,3,-281.1,212.0,5.6,1.6], [4,4,12.1,-375.6,-7.0,-4.4], [5,0,-233.2,0.0,0.6,0.0],
  [5,1,368.9,45.4,1.4,-0.5], [5,2,187.2,220.2,0.0,2.2], [5,3,-138.7,-122.9,0.6,0.4],
  [5,4,-142.0,43.0,2.2,1.7], [5,5,20.9,106.1,0.9,1.9], [6,0,64.4,0.0,-0.2,0.0],
  [6,1,63.8,-18.4,-0.4,0.3], [6,2,76.9,16.8,0.9,-1.6], [6,3,-115.7,48.8,1.2,-0.4],
  [6,4,-40.9,-59.8,-0.9,0.9], [6,5,14.9,10.9,0.3,0.7], [6,6,-60.7,72.7,0.9,0.9],
  [7,0,79.5,0.0,-0.0,0.0], [7,1,-77.0,-48.9,-0.1,0.6], [7,2,-8.8,-14.4,-0.1,0.5],
  [7,3,59.3,-1.0,0.5,-0.8], [7,4,15.8,23.4,-0.1,0.0], [7,5,2.5,-7.4,-0.8,-1.0],
  [7,6,-11.1,-25.1,-0.8,0.6], [7,7,14.2,-2.3,0.8,-0.2], [8,0,23.2,0.0,-0.1,0.0],
  [8,1,10.8,7.1,0.2,-0.2], [8,2,-17.5,-12.6,0.0,0.5], [8,3,2.0,11.4,0.5,-0.4],
  [8,4,-21.7,-9.7,-0.1,0.4], [8,5,16.9,12.7,0.3,-0.5], [8,6,15.0,0.7,0.2,-0.6],
  [8,7,-16.8,-5.2,-0.0,0.3], [8,8,0.9,3.9,0.2,0.2], [9,0,4.6,0.0,-0.0,0.0],
  [9,1,7.8,-24.8,-0.1,-0.3], [9,2,3.0,12.2,0.1,0.3], [9,3,-0.2,8.3,0.3,-0.3],
  [9,4,-2.5,-3.3,-0.3,0.3], [9,5,-13.1,-5.2,0.0,0.2], [9,6,2.4,7.2,0.3,-0.1],
  [9,7,8.6,-0.6,-0.1,-0.2], [9,8,-8.7,0.8,0.1,0.4], [9,9,-12.9,10.0,-0.1,0.1],
  [10,0,-1.3,0.0,0.1,0.0], [10,1,-6.4,3.3,0.0,0.0], [10,2,0.2,0.0,0.1,-0.0],
  [10,3,2.0,2.4,0.1,-0.2], [10,4,-1.0,5.3,-0.0,0.1], [10,5,-0.6,-9.1,-0.3,-0.1],
  [10,6,-0.9,0.4,0.0,0.1], [10,7,1.5,-4.2,-0.1,0.0], [10,8,0.9,-3.8,-0.1,-0.1],
  [10,9,-2.7,0.9,-0.0,0.2], [10,10,-3.9,-9.1,-0.0,-0.0], [11,0,2.9,0.0,0.0,0.0],
  [11,1,-1.5,0.0,-0.0,-0.0], [11,2,-2.5,2.9,0.0,0.1], [11,3,2.4,-0.6,0.0,-0.0],
  [11,4,-0.6,0.2,0.0,0.1], [11,5,-0.1,0.5,-0.1,-0.0], [11,6,-0.6,-0.3,0.0,-0.0],
  [11,7,-0.1,-1.2,-0.0,0.1], [11,8,1.1,-1.7,-0.1,-0.0], [11,9,-1.0,-2.9,-0.1,0.0],
  [11,10,-0.2,-1.8,-0.1,0.0], [11,11,2.6,-2.3,-0.1,0.0], [12,0,-2.0,0.0,0.0,0.0],
  [12,1,-0.2,-1.3,0.0,-0.0], [12,2,0.3,0.7,-0.0,0.0], [12,3,1.2,1.0,-0.0,-0.1],
  [12,4,-1.3,-1.4,-0.0,0.1], [12,5,0.6,-0.0,-0.0,-0.0], [12,6,0.6,0.6,0.1,-0.0],
  [12,7,0.5,-0.1,-0.0,-0.0], [12,8,-0.1,0.8,0.0,0.0], [12,9,-0.4,0.1,0.0,-0.0],
  [12,10,-0.2,-1.0,-0.1,-0.0], [12,11,-1.3,0.1,-0.0,0.0], [12,12,-0.7,0.2,-0.1,-0.1],
];

/** A civil date → decimal year, the WMM convention (day-of-year fraction over the year's length). */
export function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Magnetic declination (degrees, POSITIVE EAST of true north) at a geodetic position and date.
 * `trueHeading = magneticHeading + declination` — Android's `GeomagneticField.getDeclination`
 * convention ("positive means the magnetic field is rotated east that much from true north").
 *
 * `altKm` is height above the WGS 84 ellipsoid in km (0 is fine for a photographer on the ground:
 * the test vectors at 30–100 km move D by hundredths). Outside 2025.0–2030.0 the model is
 * extrapolated linearly with its secular-variation terms — honest to a few tenths for a year or
 * two, and the caller can read `WMM_VALID_UNTIL` to say so.
 */
export function declinationDeg(latDeg: number, lonDeg: number, altKm: number, yearDecimal: number): number {
  const { X, Y } = fieldXY(latDeg, lonDeg, altKm, yearDecimal);
  return (Math.atan2(Y, X) * 180) / Math.PI;
}

/** The horizontal field components (nT) in the geodetic frame — X north, Y east. Exported for the
 *  test file's H / inclination cross-checks; `declinationDeg` is the product. */
export function fieldXY(
  latDeg: number,
  lonDeg: number,
  altKm: number,
  yearDecimal: number,
): { X: number; Y: number; Z: number } {
  const dt = yearDecimal - WMM_EPOCH;
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;

  // Geodetic → geocentric spherical (MAG_GeodeticToSpherical).
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const rc = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const xp = (rc + altKm) * cosPhi;
  const zp = (rc * (1 - WGS84_E2) + altKm) * sinPhi;
  const r = Math.sqrt(xp * xp + zp * zp);
  const phiG = Math.asin(zp / r);

  // Schmidt semi-normalised P(n,m)(sin φ') and dP/dφ' (MAG_PcupLow, index n(n+1)/2 + m).
  const x = Math.sin(phiG);
  const z = Math.sqrt((1 - x) * (1 + x));
  const size = ((N_MAX + 1) * (N_MAX + 2)) / 2;
  const P = new Float64Array(size);
  const dP = new Float64Array(size);
  const norm = new Float64Array(size);
  P[0] = 1;
  dP[0] = 0;
  norm[0] = 1;
  for (let n = 1; n <= N_MAX; n++) {
    for (let m = 0; m <= n; m++) {
      const idx = (n * (n + 1)) / 2 + m;
      if (n === m) {
        const i1 = ((n - 1) * n) / 2 + m - 1;
        P[idx] = z * P[i1];
        dP[idx] = z * dP[i1] + x * P[i1];
      } else if (n === 1 && m === 0) {
        const i1 = ((n - 1) * n) / 2 + m;
        P[idx] = x * P[i1];
        dP[idx] = x * dP[i1] - z * P[i1];
      } else {
        const i1 = ((n - 2) * (n - 1)) / 2 + m;
        const i2 = ((n - 1) * n) / 2 + m;
        if (m > n - 2) {
          P[idx] = x * P[i2];
          dP[idx] = x * dP[i2] - z * P[i2];
        } else {
          const k = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
          P[idx] = x * P[i2] - k * P[i1];
          dP[idx] = x * dP[i2] - z * P[i2] - k * dP[i1];
        }
      }
    }
  }
  for (let n = 1; n <= N_MAX; n++) {
    const i0 = (n * (n + 1)) / 2;
    norm[i0] = (norm[((n - 1) * n) / 2] * (2 * n - 1)) / n;
    for (let m = 1; m <= n; m++) {
      norm[i0 + m] = norm[i0 + m - 1] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
    }
  }
  for (let i = 1; i < size; i++) {
    P[i] *= norm[i];
    dP[i] = -dP[i] * norm[i]; // derivative with respect to LATITUDE (the NOAA sign flip)
  }

  // The summation (MAG_Summation) with the time-adjusted coefficients.
  const ratio = WMM_RE_KM / r;
  let rp = ratio * ratio; // (a/r)^(n+2), n = 0 → ratio²; multiplied up per degree
  let Bx = 0;
  let By = 0;
  let Bz = 0;
  const cosM = new Float64Array(N_MAX + 1);
  const sinM = new Float64Array(N_MAX + 1);
  for (let m = 0; m <= N_MAX; m++) {
    cosM[m] = Math.cos(m * lambda);
    sinM[m] = Math.sin(m * lambda);
  }
  let ci = 0;
  for (let n = 1; n <= N_MAX; n++) {
    rp *= ratio;
    for (let m = 0; m <= n; m++) {
      const row = COEFFS[ci++];
      const g = row[2] + row[4] * dt;
      const h = row[3] + row[5] * dt;
      const idx = (n * (n + 1)) / 2 + m;
      const gc = g * cosM[m] + h * sinM[m];
      Bz -= rp * gc * (n + 1) * P[idx];
      By += rp * (g * sinM[m] - h * cosM[m]) * m * P[idx];
      Bx -= rp * gc * dP[idx];
    }
  }
  const cosPhiG = Math.cos(phiG);
  // Near the geographic poles cos φ' → 0; the NOAA code switches to a series there. A photographer
  // at |lat| > 89.99° is outside this product's world (C6 says the owner is in Dnipro).
  By = cosPhiG > 1e-10 ? By / cosPhiG : 0;

  // Rotate from the geocentric to the geodetic frame (MAG_RotateMagneticVector).
  const psi = phiG - phi;
  const X = Bx * Math.cos(psi) - Bz * Math.sin(psi);
  const Z = Bx * Math.sin(psi) + Bz * Math.cos(psi);
  return { X, Y: By, Z };
}
