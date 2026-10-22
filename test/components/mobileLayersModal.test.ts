import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_CELLS } from "../../src/components/mobile/SceneActions";

/**
 * T191 (owner 2026-10-22g): the /m LAYERS chip is ONE cell; its toggles live in a semi-transparent
 * modal (a scrim + a blurred panel) holding a 3-column GRID of icon cells — nothing in the chip
 * stack shifts. Source fences (the island renders through a portal; zustand serves initial state
 * under SSR, so the markup is read from the source, the mobileFpvRail idiom).
 */
const root = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const sa = read("src/components/mobile/SceneActions.tsx");
const css = read("src/styles/mobile/chrome.css");

describe("the LAYERS modal (T191)", () => {
  it("six cells, one per layer / setting, glyph + caption, in the owner's order", () => {
    expect(LAYER_CELLS.map((c) => c.key)).toEqual(["buildings3d", "places", "pins", "radar", "vectors", "textures"]);
    expect(LAYER_CELLS.map((c) => `${c.glyph} ${c.cap}`)).toEqual(["▦ 3D", "◎ PLACES", "⌖ PINS", "∠ RADAR", "▤ VECTOR", "▣ TEXTURES"]);
  });

  it("the anchor is one `m-act--layers` cell with the dialog affordance; the grid portals to <body>", () => {
    expect(sa).toMatch(/className=\{`m-act m-act--layers\$\{open \? " is-open" : ""\}`\}/);
    expect(sa).toMatch(/aria-haspopup="dialog"/);
    expect(sa).toMatch(/createPortal\(\s*<div className="m-layers" role="presentation" data-layers-modal>/);
    expect(sa).toMatch(/<section className="m-layers__panel" role="dialog" aria-label="Layers">/);
    expect(sa).toMatch(/<div className="m-layers__grid">/);
    expect(sa).toContain("document.body,");
    expect(sa).not.toContain("m-layersrow");
  });

  it("the scrim closes on CLICK (never pointerdown — the ghost-click retarget would re-open it)", () => {
    expect(sa).toMatch(/<div className="m-layers__scrim" onClick=\{\(\) => setOpen\(false\)\} aria-hidden="true" \/>/);
    const scrim = sa.slice(sa.indexOf('className="m-layers__scrim"'), sa.indexOf('className="m-layers__scrim"') + 120);
    expect(scrim).not.toContain("onPointerDown");
  });

  it("every cell writes the SAME store field the row wrote before; PINS still persists at the call site; 3D stands down in 2D", () => {
    expect(sa).toMatch(/buildings3d: \{ on: buildings3d, disabled: mapMode === "2d", toggle: \(\) => setBuildings3d\(!buildings3d\) \}/);
    expect(sa).toMatch(/places: \{ on: placesOn, toggle: \(\) => setPlacesOn\(!placesOn\) \}/);
    expect(sa).toMatch(/saveViewPref\("pinsVisible", !pinsVisible\);\s*setPinsVisible\(!pinsVisible\);/);
    expect(sa).toMatch(/radar: \{ on: aimVisible, toggle: \(\) => setAimVisible\(!aimVisible\) \}/);
    expect(sa).toMatch(/vectors: \{ on: vectorsVisible, toggle: \(\) => setVectorsVisible\(!vectorsVisible\) \}/);
    expect(sa).toMatch(/textures: \{ on: texturesVisible, toggle: \(\) => setTexturesVisible\(!texturesVisible\) \}/);
    expect(sa).toMatch(/className=\{`m-layers__cell\$\{st\.on \? " is-on" : ""\}`\}/);
    expect(sa).toMatch(/aria-pressed=\{st\.on\}/);
    expect(sa).toMatch(/data-layer=\{c\.key\}/);
  });

  it("the CSS: a fixed, filter-free root (touch-action none), the blur on the panel, a 3-column grid, ON = accent; tokens only; the old row rule is gone", () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => {
      const i = plain.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThan(0);
      return plain.slice(i, plain.indexOf("}", i));
    };
    expect(rule(".m-layers")).toMatch(/position: fixed/);
    expect(rule(".m-layers")).toMatch(/touch-action: none/);
    expect(rule(".m-layers")).not.toMatch(/backdrop-filter/);
    expect(rule(".m-layers__panel")).toMatch(/backdrop-filter: blur/);
    expect(rule(".m-layers__grid")).toMatch(/grid-template-columns: repeat\(3, 4rem\)/);
    expect(rule(".m-layers__cell.is-on")).toMatch(/var\(--color-accent\)/);
    expect(plain).not.toMatch(/\.m-layersrow\s*\{/);
    const modal = plain.slice(plain.indexOf(".m-layers {"));
    expect(modal).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(modal).not.toMatch(/rgba?\(/);
  });

  it("the mobile fence holds — the chip imports no panel / ui module", () => {
    expect(sa).not.toMatch(/components\/(panels|ui)\//);
  });
});
