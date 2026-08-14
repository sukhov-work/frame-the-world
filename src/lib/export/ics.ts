// ICS calendar export (QoL-2, PLANNING_QOL_PLAN §3.2 / R15) — pure RFC 5545 formatter +
// a client-side Blob download. No cron, no endpoint: the browser writes the file (C1).
//
// The formatter is pure (explicit `nowMs` for DTSTAMP, deterministic UIDs from content) so it
// unit-tests byte-exactly. C6 note: the GEO/LOCATION lines carry the user's OWN planning spot
// into the user's OWN calendar — nothing is published; callers may still pass `geo: null`.

export interface IcsEvent {
  /** Event start (UTC epoch ms). */
  startMs: number;
  /** Event end (UTC epoch ms). Point events: pass startMs (a zero-length alarm-style event). */
  endMs: number;
  /** One-line summary — "☀ enters frame · golden · CLEAR". */
  summary: string;
  /** Optional longer description (newlines allowed — escaped per RFC). */
  description?: string;
  /** Optional geodetic anchor. */
  geo?: { latDeg: number; lonDeg: number } | null;
}

/** UTC basic format: 20260814T170400Z. */
export function icsUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 §3.3.11 text escaping: backslash, semicolon, comma, newline. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1 line folding: lines longer than 75 octets continue with CRLF + one space.
 *  Folds at 74 UTF-16 units — close enough below the octet limit for this module's ASCII-heavy
 *  content (glyphs cost a few bytes; consumers tolerate earlier folds by spec). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** Deterministic UID from content (djb2 over summary+times) — same event → same UID, so a
 *  re-download updates instead of duplicating in well-behaved calendars. */
function uidFor(e: IcsEvent): string {
  let h = 5381;
  const s = `${e.summary}|${e.startMs}|${e.endMs}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `ftw-${icsUtc(e.startMs)}-${h.toString(36)}@frame-the-world`;
}

/** Build a complete VCALENDAR (CRLF line endings — the RFC wire format). */
export function buildIcs(events: readonly IcsEvent[], nowMs: number): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Frame the World//Shot Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidFor(e)}`,
      `DTSTAMP:${icsUtc(nowMs)}`,
      `DTSTART:${icsUtc(e.startMs)}`,
      `DTEND:${icsUtc(Math.max(e.endMs, e.startMs))}`,
      fold(`SUMMARY:${icsEscape(e.summary)}`),
    );
    if (e.description) lines.push(fold(`DESCRIPTION:${icsEscape(e.description)}`));
    if (e.geo) {
      lines.push(`GEO:${e.geo.latDeg.toFixed(6)};${e.geo.lonDeg.toFixed(6)}`);
      lines.push(fold(`LOCATION:${icsEscape(`${e.geo.latDeg.toFixed(6)}, ${e.geo.lonDeg.toFixed(6)}`)}`));
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Client-side download (browser only — never imported by pure code paths). */
export function downloadIcs(filename: string, events: readonly IcsEvent[]): void {
  const blob = new Blob([buildIcs(events, Date.now())], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
