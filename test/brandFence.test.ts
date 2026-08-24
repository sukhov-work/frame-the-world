import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./styles/_css";

/**
 * BRAND FENCE (owner ruling 2026-08-25) — **PLUX is the product; "Frame the World" is the repo.**
 *
 * The UI-facing name became PLUX on 2026-08-19 (superseding the working title SIDERA), and the
 * repo, the git remote and every INTERNAL identifier deliberately keep the old name: the six
 * `ftw:*` localStorage keys hold persisted user state (view prefs, building-height overrides, the
 * desktop opt-out, dismissed banners), and the ~20 `uFtw*` / `vFtw*` / `FTW_*` shader identifiers
 * are a large GLSL surface where a missed rename fails SILENTLY — the injected-header trap. So the
 * ruling is a SPLIT, not a sweep, and a split needs a fence or it rots in the visible direction.
 *
 * What this pins: no string that a person can SEE may say "Frame the World".
 *
 * Comments are stripped first, because several of them legitimately EXPLAIN this very rule (and
 * `tokens.ts` / `tokens.css` cite the Claude Design board, which is genuinely named "Frame the
 * World" — rewriting that would make a provenance pointer wrong). The zero-result validation below
 * proves the probe can still match once the comments are gone.
 *
 * Found by this fence's absence, 2026-08-25: `PRODID:-//Frame the World//Shot Planner//EN` and
 * `UID:ftw-…@frame-the-world` shipped inside every exported .ics calendar file.
 */

const root = join(__dirname, "..");

const SCAN_DIRS = ["src", "public"];
const SCAN_EXT = /\.(ts|tsx|astro|js|css)$/;
/** The build tree and vendored assets are not ours to rename. */
const SKIP_DIR = /node_modules|\.lake|dist|\.astro|wasm/;

const BANNED = [/frame\s+the\s+world/i, /frame-the-world/i];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(name)) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(root, d)));

describe("brand fence — PLUX is the product, 'Frame the World' is the repo", () => {
  it("there is a corpus to scan (probe validated)", () => {
    // If a refactor moves src/ or changes extensions, an empty sweep would pass vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it("the comment-stripper does not blind the probe (zero-result validation)", () => {
    // Both directions matter. A stripper that eats code makes the sweep vacuous; one that stops
    // stripping makes it fire on the comments that document this very ruling.
    expect(stripComments('const p = "Frame the World";')).toContain("Frame the World");
    expect(stripComments("// the repo stays Frame the World")).not.toContain("Frame the World");
    expect(stripComments("/* Frame the World */ const a = 1;")).not.toContain("Frame the World");
    // …and the corpus must really contain the brand somewhere, or "no hits" proves nothing about
    // the scan. PLUX is everywhere a user can see, so assert on THAT.
    const plux = files.filter((f) => /plux/i.test(readFileSync(f, "utf8")));
    expect(plux.length).toBeGreaterThan(3);
  });

  it("no user-visible string says 'Frame the World'", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const re of BANNED) {
        if (re.test(code)) offenders.push(`${relative(root, f)} → ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: the probe matches the exact shape that shipped", () => {
    // The two real leaks, verbatim as they were in src/lib/export/ics.ts before 2026-08-25.
    const shipped = [
      'const l = "PRODID:-//Frame the World//Shot Planner//EN";',
      "return `ftw-${x}@frame-the-world`;",
    ];
    for (const s of shipped) {
      expect(BANNED.some((re) => re.test(stripComments(s)))).toBe(true);
    }
  });

  it("the internal identifiers are deliberately UNTOUCHED — this fence is a split, not a sweep", () => {
    // Guard the other direction too: an over-eager future sweep that renames the persisted keys
    // silently wipes every existing browser's saved state. Pin that they still exist.
    const prefs = readFileSync(join(root, "src/lib/prefs.ts"), "utf8");
    expect(prefs).toContain("ftw:view-prefs:v1");
    const glsl = readFileSync(join(root, "src/components/globe/scene/glsl.ts"), "utf8");
    expect(glsl).toContain("FTW_AERIAL_GLSL");
    const buildings = readFileSync(join(root, "src/components/globe/scene/buildings.ts"), "utf8");
    expect(buildings).toMatch(/uFtw[A-Z]/);
  });
});
