import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyMapClickAction } from "../../../src/lib/globe/emptyMapClick";

/**
 * T127 (owner 2026-09-08b): on the `/m` map a stray touch must NOT clear the set look-from-here
 * pin — ✕ CLEAR PIN is the clear; a drag leaves it (the orchestrator's `clickDragPx` gate, before
 * this rule runs); a double-tap sets a new place (native `dblclick` lands after both pointerups).
 * The desktop keeps its 2026-07 follow-up: an empty-map click clears the temp pin, then deselects
 * a viewed saved pin.
 */
describe("emptyMapClickAction — the T127 rule", () => {
  it("desktop: a click on empty ground clears the temp pin first", () => {
    expect(emptyMapClickAction({ isMobileShell: false, hasTempPin: true, viewingSavedPin: true })).toBe("clear-pin");
    expect(emptyMapClickAction({ isMobileShell: false, hasTempPin: true, viewingSavedPin: false })).toBe("clear-pin");
  });
  it("/m: a stray tap KEEPS the pin — and still shadows the deselect, as the desktop's clear did", () => {
    expect(emptyMapClickAction({ isMobileShell: true, hasTempPin: true, viewingSavedPin: false })).toBe("keep-pin");
    expect(emptyMapClickAction({ isMobileShell: true, hasTempPin: true, viewingSavedPin: true })).toBe("keep-pin");
  });
  it("no temp pin: a viewed saved pin deselects on both shells, otherwise nothing", () => {
    for (const isMobileShell of [false, true]) {
      expect(emptyMapClickAction({ isMobileShell, hasTempPin: false, viewingSavedPin: true })).toBe("deselect");
      expect(emptyMapClickAction({ isMobileShell, hasTempPin: false, viewingSavedPin: false })).toBe("none");
    }
  });
});

describe("StylizedTiles.onPointerUp — the empty-map branch goes through the rule", () => {
  const root = join(__dirname, "..", "..", "..");
  const src = readFileSync(join(root, "src", "components", "globe", "StylizedTiles.ts"), "utf8");
  const start = src.indexOf("const onPointerUp = (e: PointerEvent) => {");
  const end = src.indexOf('dom.addEventListener("pointerdown", notePointerDown);', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);

  it("calls emptyMapClickAction with the shell flag, and clears the pin ONLY on its verdict", () => {
    expect(body).toContain("emptyMapClickAction({");
    expect(body).toContain("isMobileShell,");
    // The only `setTempPin(null)` left in the handler outside the rule is the "a real pin
    // supersedes the temp one" line of the pin-pick branch.
    const clears = body.match(/setTempPin\(null\)/g) ?? [];
    expect(clears).toHaveLength(2);
    expect(body).toMatch(/if \(action === "clear-pin"\) camS\.setTempPin\(null\);/);
    expect(body).toMatch(/else if \(action === "deselect"\) up\.clear\(\);/);
  });
});
