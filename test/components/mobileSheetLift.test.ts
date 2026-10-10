import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  keyboardInsetPx,
  KEYBOARD_POLL_FOR_MS,
  KEYBOARD_POLL_MS,
  sheetLiftPx,
  SHEET_TOP_GUARD_PX,
} from "../../src/components/mobile/Sheet";

/**
 * THE KEYBOARD LIFT (owner 2026-10-10 — "the keyboard obscures the actual dialog and input as it
 * is at the bottom of the screen … hard to even understand that something is hiding behind it").
 * The /m SAVE VIEW sheet sat at the layout viewport's bottom, exactly where the soft keyboard
 * lands; iOS Safari and Android Chrome shrink only the VISUAL viewport, so the sheet vanished
 * under the keys. `Sheet` now rides `bottom: <inset>` from the visualViewport, clamped so its
 * head stays on the glass. The two rules are pure and pinned here; the wiring is read from the
 * sources (this repo's vitest has no DOM, and no DOM has a soft keyboard).
 */

const SRC = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("keyboardInsetPx — the layout viewport's bottom minus the visual viewport's", () => {
  it("an iPhone 17 Pro keyboard: 874 tall layout, 574 tall visual, no pan → 300", () => {
    expect(keyboardInsetPx(874, 574, 0)).toBe(300);
  });
  it("Safari pans the visual viewport (offsetTop) — the inset shrinks by the pan, never double-counted", () => {
    expect(keyboardInsetPx(874, 574, 120)).toBe(180);
  });
  it("a browser that resized the LAYOUT viewport (innerHeight shrank with it) → 0, no double lift", () => {
    expect(keyboardInsetPx(574, 574, 0)).toBe(0);
  });
  it("never negative, always an integer", () => {
    expect(keyboardInsetPx(874, 900, 0)).toBe(0);
    expect(keyboardInsetPx(874, 573.6, 0.2)).toBe(300);
  });
});

describe("sheetLiftPx — the inset, clamped so the head stays on the glass", () => {
  it("the SAVE VIEW sheet (≈140 px) over a 300 px keyboard lifts the full inset", () => {
    expect(sheetLiftPx(300, 874, 140, SHEET_TOP_GUARD_PX)).toBe(300);
  });
  it("a 62dvh sheet (542 px) lifts only as far as the room above it allows", () => {
    expect(sheetLiftPx(300, 874, 542, SHEET_TOP_GUARD_PX)).toBe(874 - 542 - SHEET_TOP_GUARD_PX);
  });
  it("a near-full sheet cannot lift at all — never negative", () => {
    expect(sheetLiftPx(300, 874, 830, SHEET_TOP_GUARD_PX)).toBe(0);
  });
  it("no keyboard → no lift", () => {
    expect(sheetLiftPx(0, 874, 140, SHEET_TOP_GUARD_PX)).toBe(0);
  });
  it("the guard is a real band (the status strip), not a token", () => {
    expect(SHEET_TOP_GUARD_PX).toBeGreaterThanOrEqual(40);
  });
});

describe("the wiring (source fences)", () => {
  const sheet = code(SRC("src/components/mobile/Sheet.tsx"));
  it("Sheet lifts through `bottom`, never a transform (the drag and the slide-in own transform)", () => {
    expect(sheet).toMatch(/style\.bottom = lift/);
    expect(sheet).toMatch(/visualViewport/);
    expect(sheet).toMatch(/addEventListener\("resize", measure\)/);
    expect(sheet).toMatch(/addEventListener\("scroll", measure\)/);
    expect(sheet).not.toMatch(/translateY\(-?\$\{lift/);
  });
  it("the lift is ON for every sheet that is not `full`, OFF for a full one", () => {
    expect(sheet).toMatch(/keyboardLift = !full/);
  });
  it("the lift POLLS through focus changes and at mount — iOS Safari 26 sent no resize on the real iPhone (the farm, 2026-10-10)", () => {
    expect(sheet).toMatch(/addEventListener\("focusin", burst\)/);
    expect(sheet).toMatch(/addEventListener\("focusout", burst\)/);
    expect(sheet).toMatch(/measure\(\);\s*burst\(\);/);
    expect(sheet).toMatch(/window\.addEventListener\("resize", measure\)/);
    // the burst is bounded — never a forever timer on a phone
    expect(sheet).toMatch(/performance\.now\(\) < until \? window\.setTimeout\(poll, KEYBOARD_POLL_MS\) : 0/);
    expect(KEYBOARD_POLL_FOR_MS).toBeGreaterThanOrEqual(1500);
    expect(KEYBOARD_POLL_FOR_MS).toBeLessThanOrEqual(5000);
    expect(KEYBOARD_POLL_MS).toBeGreaterThanOrEqual(60);
  });
  it("the SAVE VIEW sheet is not `full` — it rides the lift by default", () => {
    const sa = code(SRC("src/components/mobile/SceneActions.tsx"));
    const m = sa.match(/<Sheet title="SAVE VIEW"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/\bfull\b/);
  });
  it("SEARCH and GUIDE stay full (their input is at the top; a lift would push the head off)", () => {
    const shell = code(SRC("src/components/mobile/MobileShell.tsx"));
    expect(shell).toMatch(/<Sheet title="SEARCH" full/);
    expect(shell).toMatch(/<Sheet title="GUIDE" full/);
  });
  it("the sheet CSS eases `bottom` so the lift follows the keys instead of jumping", () => {
    const css = SRC("src/styles/mobile/chrome.css");
    const rule = css.slice(css.indexOf("\n.m-sheet {"), css.indexOf(".m-sheet--full"));
    expect(rule).toMatch(/transition:\s*bottom/);
  });
});
