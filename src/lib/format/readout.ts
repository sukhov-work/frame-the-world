/**
 * Mono-readout formatting (design board 02 · TYPE: "lat/lon + focal + heading + time always render in
 * IBM Plex Mono", e.g. `48.8583° N  2.2923° E · 35 MM · 128° · 18:42`). Pure + deterministic — the
 * capture timestamp is treated as a TZ-naive ISO string (EXIF has no timezone), never a Date.
 */

export const EM_DASH = "—";
const MINUS = "−"; // typographic minus, per the design canvas ("e.g. −4.0°")

/** `48.8583° N · 2.2923° E` */
export function formatLatLon(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return EM_DASH;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns} · ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** `35 MM` — focal lengths under 10 mm keep one decimal (phone lenses, e.g. `6.9 MM`). */
export function formatFocal(mm?: number): string {
  if (mm === undefined) return EM_DASH;
  return `${mm < 10 ? mm.toFixed(1) : Math.round(mm).toString()} MM`;
}

/** `F/2.8` */
export function formatAperture(fNumber?: number): string {
  if (fNumber === undefined) return EM_DASH;
  return `F/${fNumber.toFixed(1).replace(/\.0$/, "")}`;
}

/** `1/250` for sub-second exposures, `1.6 S` for long ones. */
export function formatShutter(sec?: number): string {
  if (sec === undefined || sec <= 0) return EM_DASH;
  if (sec >= 1) return `${sec.toFixed(1).replace(/\.0$/, "")} S`;
  return `1/${Math.round(1 / sec)}`;
}

/** `ISO 100` */
export function formatIso(iso?: number): string {
  return iso === undefined ? EM_DASH : `ISO ${Math.round(iso)}`;
}

/** `128°` — normalised into [0, 360). */
export function formatHeading(deg?: number): string {
  if (deg === undefined) return EM_DASH;
  const norm = ((deg % 360) + 360) % 360;
  return `${Math.round(norm)}°`;
}

/** `−4.0°` — signed, one decimal, typographic minus. */
export function formatPitch(deg?: number): string {
  if (deg === undefined) return EM_DASH;
  const abs = Math.abs(deg).toFixed(1);
  return deg < 0 ? `${MINUS}${abs}°` : `${abs}°`;
}

/** `96 M` */
export function formatAltitude(m?: number): string {
  return m === undefined ? EM_DASH : `${Math.round(m)} M`;
}

/** `60.2 MP` */
export function formatMegapixels(width?: number, height?: number): string {
  if (!width || !height) return EM_DASH;
  return `${((width * height) / 1e6).toFixed(1)} MP`;
}

/** `118 MB` / `3.4 MB` / `812 KB` */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return EM_DASH;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toString()} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** `2026-06-21 · 18:42` from a TZ-naive ISO string — string surgery, no Date (keeps tests + TZ sane). */
export function formatCaptureDateTime(iso?: string): string {
  if (!iso) return EM_DASH;
  const [date, time] = iso.split("T");
  if (!time) return date ?? EM_DASH;
  return `${date} · ${time.slice(0, 5)}`;
}
