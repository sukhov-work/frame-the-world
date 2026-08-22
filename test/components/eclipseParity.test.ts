import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Desktop/mobile parity for the PREDICTED ECLIPSES section (owner 2026-08-22k) — the
 * `guideParity` idiom. The two shells are DELIBERATELY separate components ("same stores + lib
 * calls as the desktop TargetPanel, never the panel itself"), and the standing rule is
 * desktop-first with a /m twin. That is exactly the shape where a field lands on one shell and
 * quietly never reaches the other.
 *
 * Source-text fences, not renders: these are cheap, they run in the vitest gate, and every one of
 * them encodes a mistake that was actually available to make here.
 */

const root = join(__dirname, "..", "..");
const DESKTOP = join(root, "src", "components", "panels", "TargetPanel.tsx");
const MOBILE = join(root, "src", "components", "mobile", "TargetSheet.tsx");
const desktop = readFileSync(DESKTOP, "utf8");
const mobile = readFileSync(MOBILE, "utf8");
const SHELLS: Array<[string, string]> = [
  ["TargetPanel.tsx", desktop],
  ["TargetSheet.tsx", mobile],
];

describe("eclipse section parity — both shells or neither", () => {
  it.each(SHELLS)("%s calls the ONE eclipse lib", (_name, src) => {
    expect(src).toMatch(/from "\.\.\/\.\.\/lib\/ephemeris\/eclipse"/);
    for (const fn of ["nextSolarEclipses", "nextLunarEclipses", "solarEclipseAt", "lunarEclipseAt"])
      expect(src).toContain(fn);
  });

  it.each(SHELLS)("%s gates on target.kind, NEVER on facts.kind", (_name, src) => {
    // `bodyTarget` gives the sun and the moon `facts.kind === "planet"` (they reuse the planet
    // fact shape), so a facts gate would print eclipse rows on Mars and Pluto.
    expect(src).toContain('target.kind === "sun"');
    expect(src).toContain('target.kind === "moon"');
    expect(src).not.toMatch(/facts\.kind === "(sun|moon)"/);
  });

  it.each(SHELLS)("%s renders both section headers", (_name, src) => {
    expect(src).toContain("ECLIPSES · FROM THIS ANCHOR");
    expect(src).toContain("ECLIPSES · MOON IN EARTH'S SHADOW");
  });

  it.each(SHELLS)("%s prints the YEAR on eclipse rows", (_name, src) => {
    // The next five solar eclipses at one site span a decade. `dateLabel` is month+day — right
    // for the 8-night window list it was written for, a factual error here.
    expect(src).toContain("eclipseDateLabel");
    expect(src).toMatch(/eclipseDateLabel[\s\S]{0,320}year: "numeric"/);
    expect(src).not.toMatch(/win__date">\{dateLabel\(row\.peakMs\)\}/);
  });

  it.each(SHELLS)("%s shows a dash, not a false 0%%, for penumbral rows", (_name, src) => {
    // astronomy-engine reports obscuration 0 for a penumbral eclipse BY DEFINITION (no umbral
    // contact) — printing "0%" reads as "nothing happens" for a real, visible event.
    expect(src).toMatch(/row\.phase === "penumbral" \? "—"/);
  });

  it.each(SHELLS)("%s keys the eclipse walk to the DAY, never to nowMs or a raw focus", (_name, src) => {
    // An ungated scan keyed on the churning camera focus froze the boot flight solid once
    // (FindPanel). Day bucket + 0.05°-quantized anchor, the house pattern.
    expect(src).toContain("const dayKey = Math.floor(nowMs / 86_400_000)");
    expect(src).toMatch(/\[[^\]]*dayKey[^\]]*latKey[^\]]*lonKey[^\]]*\]/);
  });

  it.each(SHELLS)("%s caps the row count", (_name, src) => {
    expect(src).toMatch(/const ECLIPSE_ROWS = \d+;/);
    expect(src).toMatch(/nextSolarEclipses\([^)]*ECLIPSE_ROWS\)/);
    expect(src).toMatch(/nextLunarEclipses\([^)]*ECLIPSE_ROWS\)/);
  });

  it.each(SHELLS)("%s mounts the eclipse section AFTER the unfollow button", (name, src) => {
    // verify-uxbatch4.mjs proves FIND IN FRAME sits directly above UNFOLLOW with
    // compareDocumentPosition on BOTH shells. The eclipse section mounts after unfollow precisely
    // so that script stays green — anchored on the unfollow CLASSNAME, which is unique per shell
    // (the button labels appear in comments and docblocks too).
    const cls = name === "TargetSheet.tsx" ? "m-unfollow" : "tp-unfollow";
    const unfollow = src.indexOf(`className="${cls}"`);
    expect(unfollow).toBeGreaterThan(-1);
    // Every RENDERED "ECLIPSES" header must come after it. (The desktop shell also defines
    // EclipseFacts earlier in the file — that is a definition, not a mount, so compare against
    // the mount site: the <EclipseFacts .../> element or the inline JSX block.)
    const mount =
      name === "TargetSheet.tsx"
        ? src.indexOf("ECLIPSES · FROM THIS ANCHOR")
        : src.indexOf("<EclipseFacts");
    expect(mount).toBeGreaterThan(unfollow);
  });

  it("does not let the mobile sheet import from components/panels", () => {
    // The mobile fence (test/components/mobileFence.test.ts) owns this rule; asserted here too
    // because THIS section is the one that would tempt a shared-component shortcut.
    expect(mobile).not.toMatch(/from "\.\.\/panels\//);
  });

  it("mobile no longer claims it drops every per-kind fact block", () => {
    // Stale contract prose is what the fences exist to catch — the header asserted the sheet has
    // no fact blocks, which stopped being true the moment the eclipse section landed.
    expect(mobile).toMatch(/PREDICTED ECLIPSES|ONE exception/i);
  });
});
