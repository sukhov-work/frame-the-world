import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

/**
 * Shared helpers for the style/text fences (audit #3 C18 — `read`/`esc`/`ruleBody` were
 * triplicated across `test/styles/*`; C14 — the fences themselves were brittle).
 *
 * The C14 lesson is encoded in what this file offers: fences must pin STRUCTURE (which rule
 * carries which token, which element is whose sibling), never formatting. A regex keyed on
 * indentation, on comment prose, on a unit (`96px` → `6rem`) or on a taste literal goes red on a
 * harmless reformat, and a red fence nobody believes gets deleted. So the extractors below are
 * brace-matching rather than pattern-matching, and value assertions use `VALUE`.
 */

const root = join(__dirname, "..", "..");

/** Read a repo-relative file. */
export const read = (p: string): string => readFileSync(join(root, p), "utf8");

/** Escape a literal for use inside a RegExp. */
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches ANY CSS value — the C14 rule: fence that a declaration EXISTS, not what it says. */
export const VALUE = "[^;}]+";

/**
 * The body of the first CSS rule whose selector STARTS A LINE and equals `selector`. The line
 * anchor matters: a bare `.m-altcol` pattern otherwise matches inside `body.mw-open .m-altcol`
 * and returns the wrong rule's body.
 */
export function ruleBody(css: string, selector: string): string {
  const m = new RegExp(`(?:^|\\n)[ \\t]*${esc(selector)}\\s*{([^}]*)}`).exec(css);
  expect(m, `rule "${selector}" is missing`).not.toBeNull();
  return m![1];
}

/** A single declaration's value from a rule body, or null. Whitespace-trimmed. */
export function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;|{)\\s*${esc(prop)}\\s*:\\s*(${VALUE})`).exec(body);
  return m ? m[1].trim() : null;
}

/** The first number in a CSS value, unit-agnostic (`32vw` → 32, `1.5rem` → 1.5). */
export function num(value: string | null): number | null {
  const m = value ? /-?[\d.]+/.exec(value) : null;
  return m ? Number(m[0]) : null;
}

/**
 * The body of a balanced `{ … }` block starting at the first `{` at or after `from`. Used to
 * lift a JS/TS function body out of a source file WITHOUT keying on indentation — the shape
 * `/const draw = \(\) => {([\s\S]*?)\n {4}};/` silently stops matching the day the file is
 * re-indented, and a fence that stops matching stops fencing.
 */
export function braceBlock(src: string, from: number): string {
  const start = src.indexOf("{", from);
  expect(start, "no block found").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start + 1, i);
  }
  throw new Error("unbalanced block");
}

/** The body of the function/arrow assigned to `name` (`const name = … {…}`). */
export function fnBody(src: string, name: string): string {
  const at = new RegExp(`(?:const|let|function)\\s+${esc(name)}\\b`).exec(src);
  expect(at, `no declaration of "${name}"`).not.toBeNull();
  return braceBlock(src, at!.index);
}

/**
 * Index just past the closing tag of the JSX element opened at `openIdx`, by DEPTH — so
 * "element B is a SIBLING of element A, not a descendant" can be proven structurally instead
 * of by matching a comment that happens to follow the close (C14: that pattern pinned prose).
 * Counts `<tag …>` opens and `</tag>` closes for the given tag, ignoring self-closing tags.
 */
export function jsxElementEnd(src: string, openIdx: number, tag = "div"): number {
  const token = new RegExp(`<${esc(tag)}(?=[\\s>])|</${esc(tag)}>|/>`, "g");
  token.lastIndex = openIdx;
  let depth = 0;
  for (let m = token.exec(src); m; m = token.exec(src)) {
    if (m[0] === "/>") continue; // self-closing: never opened a level here
    if (m[0].startsWith("</")) {
      if (--depth === 0) return m.index + m[0].length;
    } else depth++;
  }
  throw new Error(`unbalanced <${tag}> from ${openIdx}`);
}
