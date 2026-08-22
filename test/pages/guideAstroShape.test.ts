/**
 * `/guide` SOURCE-SHAPE GUARD — the machine half of tracked-backlog T24 (guide finalization
 * G-A, 2026-08-22g).
 *
 * T24 is an ACCEPTED RISK, not a fixed bug: astro@5.18.2 carries five XSS advisories whose
 * fixes land only in 7.x, and C4 pins this repo to Astro 5. Audit #1 + #2 verified the risk is
 * unreachable because of a small set of SOURCE PROPERTIES, and the row's stated trigger is
 * "re-check on ANY .astro growth". That re-check has been a human read of the file every time.
 * This test makes it cheap: the three properties that make `set:html` safe here become
 * assertions, so a change that breaks one goes red in `npm test` instead of waiting for the
 * next audit.
 *
 * The properties (audit-2 B2, restated):
 *   (a) every `set:html` sink is fed by the compile-time `guideContent` module through
 *       `inlineHtml(...)` — never a request value, never a raw content string;
 *   (b) `inlineHtml` escapes every text run and every link LABEL via `escapeHtml`;
 *   (c) the one emitted attribute is `href="#${target}"`, and `target` is group 1 of
 *       `LINK_RE = /\[\[([a-z0-9-]+)…/` (`src/lib/guide/inline.ts:24`), so an injected quote
 *       cannot match the grammar at all — `[[a" onmouseover=x|L]]` stays a plain text run.
 *
 * SCOPE NOTE, deliberate: this targets `server:defer` and `define:vars`, NOT `client:`.
 * The row's "zero island components" means zero SERVER islands — the `/_server-islands/[name]`
 * sink. Client islands already ship in this repo (`src/pages/index.astro` renders
 * `<MemberBadge client:only="react" />`), and a bundled `<script type="module">` is neither.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { read, stripComments } from "../styles/_css";

const GUIDE = "src/pages/guide.astro";

/** Every .astro file under src/, repo-relative — the row's trigger is ".astro growth". */
function astroFiles(): string[] {
  const root = join(__dirname, "../..");
  return readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".astro"))
    .map((p) => `src/${p}`);
}

/**
 * Source with comments stripped — the docblocks deliberately NAME what the fences probe.
 * SHARED with the parity fence (test/styles/_css.ts) so the line-comments-first ORDER cannot
 * diverge between two copies: stripping block comments first lets a `//` line that merely
 * contains `/*` open a phantom block and swallow live code.
 */
const code = (path: string): string => stripComments(read(path));

describe("T24 — /guide is the only set:html site, and its shape is pinned", () => {
  it("no other .astro file in src/ uses set:html", () => {
    const others = ["src/pages/index.astro", "src/pages/m.astro", "src/layouts/Layout.astro", "src/layouts/MobileLayout.astro"];
    for (const f of others) expect(code(f), f).not.toMatch(/set:html/);
  });

  it("guide.astro carries exactly four set:html sinks", () => {
    const hits = code(GUIDE).match(/set:html/g) ?? [];
    // lead · body · each step · tip. A FIFTH sink is the thing this test exists to catch:
    // search hits, list items, badges and route steps must render as plain text nodes.
    expect(hits.length).toBe(4);
  });

  it("every set:html sink is fed by inlineHtml(), never a raw string", () => {
    const src = code(GUIDE);
    const fed = src.match(/set:html=\{inlineHtml\(/g) ?? [];
    expect(fed.length).toBe(4);
  });

  it("inlineHtml escapes text runs and link labels, and emits only a regex-locked href", () => {
    const src = read(GUIDE);
    const body = src.slice(src.indexOf("function inlineHtml"), src.indexOf("function shotClass"));
    // (b) both branches escape.
    expect(body).toMatch(/kind === "text"\).*?escapeHtml\(run\.text\)/s);
    expect(body).toMatch(/escapeHtml\(label\)/);
    // (c) the sole attribute is the anchored fragment href — no other attribute is emitted.
    // The value must be a `#` + one interpolation and nothing else: `href="#${run.target}"`.
    const attrs = body.match(/\s[a-zA-Z-]+="[^"]*\$\{/g) ?? [];
    expect(attrs.map((a) => a.trim())).toEqual(['href="#${']);
    expect(body).toMatch(/href="#\$\{run\.target\}"/);
    // escapeHtml itself still covers the three characters the text path relies on.
    const esc = src.slice(src.indexOf("function escapeHtml"), src.indexOf("function shotClass"));
    for (const ch of ["&", "<", ">"]) expect(esc).toContain(`/${ch}/g`);
  });

  it("the crosslink grammar cannot carry an attribute break-out", () => {
    const inline = read("src/lib/guide/inline.ts");
    // Group 1 is the href payload; it must stay [a-z0-9-] with no escape hatch.
    expect(inline).toMatch(/LINK_RE\s*=\s*\/\\\[\\\[\(\[a-z0-9-\]\+\)/);
  });

  it("guide.astro ships no server island and no define:vars", () => {
    const src = code(GUIDE);
    // `server:defer` is the /_server-islands/[name] sink the advisory needs; `define:vars`
    // injects a value into a script's scope unescaped. Neither may appear.
    expect(src).not.toMatch(/server:defer/);
    expect(src).not.toMatch(/define:vars/);
  });

  it("no .astro file anywhere in src/ opts into server islands", () => {
    // The whole-repo half of the row's formula, kept next to the property it protects.
    // GLOBBED, not listed: the row's trigger is ".astro GROWTH", so a NEW page must be
    // covered the day it lands — a hardcoded list would pass by simply not looking at it.
    const files = astroFiles();
    expect(files.length, "zero-result probe — the glob found no .astro files").toBeGreaterThan(3);
    for (const f of files) {
      // `transition:animate|name|persist` are the Astro view-transition DIRECTIVES. Plain
      // CSS `transition: color .2s` is not one of them and must not trip this.
      expect(code(f), f).not.toMatch(/server:defer|define:vars|transition:(animate|name|persist)/);
    }
  });
});
