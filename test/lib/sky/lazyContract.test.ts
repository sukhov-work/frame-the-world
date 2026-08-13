import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LAZY BY CONTRACT guard (phase B — the contract was comment-enforced only, and the catalog
 * chunk has grown from ~24 KB to ~700 KB of baked data): no module outside `src/lib/sky/`
 * may STATICALLY import the sky data modules — only `await import(...)` (LocationFinder /
 * store-sky restore) keeps them off the boot chunk. `searchIndex.ts` alone is boot-safe
 * (pure ranking + glyphs; planFeed and the orchestrator import it for kindGlyph).
 */
const HEAVY = [
  "lib/sky/catalog",
  "lib/sky/messier",
  "lib/sky/starNames",
  "lib/sky/constellations",
  "lib/sky/comets",
  "lib/sky/asteroids",
  "lib/sky/ngcNames",
  "lib/sky/openngc",
  "lib/sky/simbad",
  "lib/sky/sbdb",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|astro)$/.test(name)) out.push(p);
  }
  return out;
}

describe("sky catalog stays off the boot chunk", () => {
  it("no static import of a heavy sky module from outside src/lib/sky", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("lib/sky/")) continue; // intra-chunk imports are the point
      const src = readFileSync(file, "utf8");
      for (const mod of HEAVY) {
        // Static: `import ... from "<path>"` / `export ... from "<path>"` / bare side-effect
        // `import "<path>"` (hardened 2026-08-13 audit C4). Dynamic `import("<path>")` is the
        // sanctioned route and must NOT match; `import type … from` is erased at build and is
        // excluded (the [^("]* body can't contain `type ` at position 0 check below).
        const re = new RegExp(
          `(^|\\n)\\s*(import(?!\\s+type\\b)[^("]*from\\s+["'][^"']*${mod}["']` +
            `|export(?!\\s+type\\b)[^("]*from\\s+["'][^"']*${mod}["']` +
            `|import\\s+["'][^"']*${mod}["'])`,
        );
        if (re.test(src)) offenders.push(`${file} → ${mod}`);
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});
