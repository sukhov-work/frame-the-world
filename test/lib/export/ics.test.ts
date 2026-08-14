import { describe, expect, it } from "vitest";
import { buildIcs, icsEscape, icsUtc, type IcsEvent } from "../../../src/lib/export/ics";

const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

const EVENT: IcsEvent = {
  startMs: Date.UTC(2026, 7, 14, 17, 4, 0),
  endMs: Date.UTC(2026, 7, 14, 17, 32, 0),
  summary: "☀ enters frame · golden · CLEAR",
  description: "Line one\nLine two; with, chars\\end",
  geo: { latDeg: 48.4647, lonDeg: 35.0462 },
};

describe("icsUtc", () => {
  it("formats UTC basic form", () => {
    expect(icsUtc(Date.UTC(2026, 7, 14, 17, 4, 9))).toBe("20260814T170409Z");
    expect(icsUtc(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe("20260101T000000Z");
  });
});

describe("icsEscape", () => {
  it("escapes backslash, semicolon, comma, newline — in the RFC order", () => {
    expect(icsEscape("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs([EVENT], NOW);
  const lines = ics.split("\r\n");

  it("wraps a valid VCALENDAR with CRLF endings", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("\n") && !ics.replace(/\r\n/g, "").includes("\n")).toBe(true);
  });

  it("carries the event times, geo and escaped text", () => {
    expect(ics).toContain("DTSTART:20260814T170400Z");
    expect(ics).toContain("DTEND:20260814T173200Z");
    expect(ics).toContain(`DTSTAMP:${icsUtc(NOW)}`);
    expect(ics).toContain("GEO:48.464700;35.046200");
    expect(ics).toContain("Line one\\nLine two\\; with\\, chars\\\\end");
  });

  it("UIDs are deterministic and content-keyed", () => {
    const again = buildIcs([EVENT], NOW + 60_000); // different DTSTAMP, same event
    const uid = lines.find((l) => l.startsWith("UID:"));
    expect(uid).toBeDefined();
    expect(again).toContain(uid!);
    const other = buildIcs([{ ...EVENT, summary: "different" }], NOW);
    expect(other).not.toContain(uid!);
  });

  it("clamps DTEND to DTSTART for point events", () => {
    const point = buildIcs([{ ...EVENT, endMs: EVENT.startMs - 1 }], NOW);
    expect(point).toContain("DTEND:20260814T170400Z");
  });

  it("folds long lines with CRLF + space continuation", () => {
    const long = buildIcs(
      [{ ...EVENT, description: "x".repeat(300), geo: null }],
      NOW,
    );
    const descStart = long.indexOf("DESCRIPTION:");
    const folded = long.slice(descStart).split("END:VEVENT")[0];
    for (const l of folded.split("\r\n")) expect(l.length).toBeLessThanOrEqual(74);
    expect(folded).toContain("\r\n x");
  });
});
