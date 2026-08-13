import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The two-shell drift guard (MOBILE_PLAN §2 / §7), promoted from a comment to a fence:
 *
 *  1. `src/components/mobile/**` consumes stores + `lib/**` (+ globe tunables) ONLY — it must
 *     never import a desktop panel (`components/panels/**`) or desktop chrome
 *     (`components/ui/**`). The compact mobile surfaces re-consume the same stores/libs;
 *     importing the panels would silently couple the frozen desktop to the phone shell.
 *  2. Nothing OUTSIDE `src/components/mobile/**` (except the /m page itself) may import from
 *     it — the frozen desktop must stay byte-independent of the mobile track.
 *
 * Same walking idiom as test/lib/sky/lazyContract.test.ts (which separately guarantees the
 * mobile shell keeps the sky catalog dynamic-import-only).
 */

const SRC = join(process.cwd(), "src");
const MOBILE_DIR = join("components", "mobile");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|astro)$/.test(name) ? [full] : [];
  });
}

/** Static import/export/side-effect specifiers in a source file (type-only imports included —
 *  a type import of a panel is still a coupling the fence forbids). */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

describe("mobile shell fence (MOBILE_PLAN §2)", () => {
  const all = walk(SRC);
  const mobileFiles = all.filter((f) => f.includes(MOBILE_DIR));
  const desktopFiles = all.filter((f) => !f.includes(MOBILE_DIR) && !f.endsWith(join("pages", "m.astro")));

  it("finds the mobile shell (zero-result probe)", () => {
    expect(mobileFiles.length).toBeGreaterThan(0);
  });

  it("mobile components never import desktop panels or ui chrome", () => {
    const offenders: string[] = [];
    for (const file of mobileFiles) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (/components\/(panels|ui)\//.test(spec) || /\.\.\/(panels|ui)\//.test(spec)) {
          offenders.push(`${file} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the desktop shell never imports from components/mobile", () => {
    const offenders: string[] = [];
    for (const file of desktopFiles) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (spec.includes("components/mobile/") || /\.\.?\/mobile\//.test(spec)) {
          offenders.push(`${file} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
