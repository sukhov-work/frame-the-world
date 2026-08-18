import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `[hidden]` display trap (audit-2 C2(f); pinchHardening idiom): any authored
 * `display: flex|grid|block` on a selector whose element JS toggles via the `hidden`
 * attribute BEATS the attribute's UA `display: none` — the element stays visible while
 * every DOM probe (`el.hidden`) swears it is hidden (the 2026-08-13 verification trap).
 * Each such element needs the explicit `[hidden] { display: none }` companion rule.
 * List-based like the touch-action fence: extend the list when a new hidden-toggled,
 * display-styled element ships.
 */

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("[hidden] companion rules — audited pair list", () => {
  const pairs: Array<[file: string, selector: string]> = [
    ["src/pages/index.astro", ".m-banner"], // mobile-suggestion banner (M0 2026-08-13)
  ];

  it.each(pairs)("%s: %s[hidden] forces display:none", (file, selector) => {
    const css = read(file);
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(css).toMatch(new RegExp(`${esc}\\[hidden\\]\\s*{[^}]*display:\\s*none`));
  });

  it("the pair list covers every hidden-toggled element that gets a display style (index.astro)", () => {
    // Discovery guard: if a new `hidden` attribute appears in index.astro alongside a display
    // style on its class, it must join the list above. Cheap heuristic: count `hidden`
    // attributes on elements with a class= in the same tag.
    const html = read("src/pages/index.astro");
    const hiddenTagged = [...html.matchAll(/class="([\w- ]+)"[^>]*\bhidden\b|\bhidden\b[^>]*class="([\w- ]+)"/g)]
      .map((m) => (m[1] ?? m[2]).split(" ")[0]);
    for (const cls of hiddenTagged) {
      const styled = new RegExp(`\\.${cls}\\s*{[^}]*display:\\s*(flex|grid|block|inline)`).test(html);
      if (styled) {
        expect(new RegExp(`\\.${cls}\\[hidden\\]`).test(html)).toBe(true);
      }
    }
  });
});
