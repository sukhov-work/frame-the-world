import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The two-shell drift guard (MOBILE_PLAN §2 / §7), promoted from a comment to a fence:
 *
 *  1. `src/components/mobile/**` consumes stores + `lib/**` (+ globe tunables + the shared
 *     `components/controls/**` instruments) ONLY — it must never import a desktop panel
 *     (`components/panels/**`) or desktop chrome (`components/ui/**`). The compact mobile
 *     surfaces re-consume the same stores/libs; importing the panels would silently couple
 *     the frozen desktop to the phone shell.
 *  2. Nothing OUTSIDE `src/components/mobile/**` (except the /m page itself) may import from
 *     it — the frozen desktop must stay byte-independent of the mobile track.
 *  3. `src/components/controls/**` (batch #4 S2 — input instruments whose FEEL must never
 *     fork between shells, e.g. the joystick) is a LEAF both shells may import. It keeps the
 *     independence guarantee by consuming ONLY react + stores + lib/** + globe tunables +
 *     styles — never panels/ui/mobile/globe scene modules.
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

  it("controls/ stays a pure leaf: react + stores + lib + globe tunables + styles only", () => {
    const controlsFiles = all.filter((f) => f.includes(join("components", "controls")));
    expect(controlsFiles.length).toBeGreaterThan(0); // zero-result probe
    // NAMED zero-result probe (BESTSPOT S5, 2026-08-24): the glob above would keep passing if a
    // shared instrument were quietly moved back into `panels/` or `ui/`, which is precisely the
    // drift rule 3 exists to stop. `InstrumentSlider` in particular is a deliberate
    // RE-IMPLEMENTATION of `ui/Slider`'s `.uf-slider` grammar — the day someone "de-duplicates" it
    // by importing `ui/Slider`, the offender list below goes red AND this list goes short.
    const names = controlsFiles.map((f) => f.split(/[/\\]/).pop());
    for (const expected of ["Joystick.tsx", "InstrumentSlider.tsx", "ChipRow.tsx"]) {
      expect(names, `components/controls/${expected} left the shared tier`).toContain(expected);
    }
    const offenders: string[] = [];
    for (const file of controlsFiles) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const allowed =
          spec === "react" ||
          /(?:^|\/)store\//.test(spec) ||
          /(?:^|\/)lib\//.test(spec) ||
          /(?:^|\/)styles\//.test(spec) ||
          /(?:^|\.\.\/)globe\/tuning$/.test(spec);
        if (!allowed) offenders.push(`${file} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * AUDIT #3 A1-9 → the iOS SHEET-FOCUS fence (2026-08-22).
 *
 * The trap: an input focused while its sheet is still at `translateY(100%)` makes iOS Safari
 * scroll the LAYOUT viewport to an off-screen element — dark scrim + keyboard, no way back but
 * a tap. The QA batch fixed `MobileSearch`; the audit found it STILL ARMED in two siblings
 * (React `autoFocus` in `SceneActions`'s SAVE VIEW sheet, and a bare re-`focus()` on the search
 * mode switch). The fix is `useSheetInputFocus` / `focusInSheet`.
 *
 * Mutation that makes this RED: add `autoFocus` to any `/m` input, or call `.focus()` without
 * `preventScroll` anywhere in the mobile shell.
 */
describe("rule 4 — /m inputs never focus themselves into the iOS scroll trap", () => {
  const mobileFiles = () =>
    walk(join(SRC, MOBILE_DIR)).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  /** The rule is about CODE — the hook's docblock and the fix notes at the call sites both
   *  name `autoFocus` and `.focus()` on purpose, and a probe that fired on prose would just
   *  get the prose reworded. */
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("no React autoFocus anywhere in the mobile shell", () => {
    const offenders = mobileFiles().filter((f) =>
      /\bautoFocus\b/.test(code(readFileSync(f, "utf8"))),
    );
    expect(offenders.map((f) => f.replace(SRC, "src"))).toEqual([]);
  });

  it("every .focus() in the mobile shell goes through the hook or carries preventScroll", () => {
    const offenders: string[] = [];
    for (const f of mobileFiles()) {
      const src = code(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\.focus\(([^)]*)\)/g)) {
        if (!/preventScroll/.test(m[1])) offenders.push(`${f.replace(SRC, "src")} → ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: the probes can match, and the hook really is the one home", () => {
    expect(/\bautoFocus\b/.test(code("<input autoFocus />"))).toBe(true);
    expect(/\.focus\(([^)]*)\)/.exec(code("el.focus()"))![1]).toBe("");
    // The stripper removes prose but never code on a following line.
    expect(/\bautoFocus\b/.test(code("// mentions autoFocus\n<input autoFocus />"))).toBe(true);
    expect(/\bautoFocus\b/.test(code("/* mentions autoFocus */"))).toBe(false);
    const hook = readFileSync(join(SRC, MOBILE_DIR, "useSheetInputFocus.ts"), "utf8");
    expect(hook).toMatch(/preventScroll:\s*true/);
    // …and the three parts of the documented fix are all still there.
    expect(hook).toMatch(/useLayoutEffect/); // same-commit focus keeps the user activation
    expect(hook).toMatch(/visualViewport\?\.addEventListener\("resize"/); // keyboard settle
    expect(hook).toMatch(/window\.scrollTo\(0, 0\)/); // the layout-viewport pin
  });
});
