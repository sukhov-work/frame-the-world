/**
 * EXIF capture time → scene time (Phase 4 scrubber seeding).
 *
 * EXIF timestamps are TZ-NAIVE local wall-clock strings ("2026-06-21T18:42:17" — see
 * `lib/decode/extract.ts`). To relight the scene the ephemeris needs a UTC instant, so v1
 * interprets the stamp as LOCAL SOLAR TIME at the placement longitude: offset = round(lon / 15°)
 * hours. That reproduces the sun the photographer actually saw (golden hour at capture time reads
 * correctly) and is wrong by at most ~1 h where civil time (DST, wide zones) diverges from solar
 * time — a documented v1 trade-off (NEXT_SESSION_PROMPT 2026-07-10; the alternative, plain UTC,
 * is wrong by up to 12 h). Revisit with a real TZ lookup if pins ever need civil-time display.
 */

/** "YYYY-MM-DD(T| )HH:MM(:SS(.fff)?)?" — exifr emits the ISO form; raw EXIF uses a space. */
const CAPTURED_AT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/;

/**
 * UTC epoch ms for a TZ-naive EXIF capture stamp read as solar time at `lonDeg`.
 * Returns null when the stamp doesn't parse (CR3/RAF metadata gaps → no seeding).
 */
export function capturedAtToUtcMs(capturedAt: string, lonDeg: number): number | null {
  const m = CAPTURED_AT_RE.exec(capturedAt.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  if (Number.isNaN(asUtc)) return null;
  // Solar-time offset: 15° of longitude per hour, rounded to whole hours (±12 at the antimeridian).
  const offsetHours = Math.round(Math.max(-180, Math.min(180, lonDeg)) / 15);
  return asUtc - offsetHours * 3_600_000;
}
