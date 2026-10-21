import { describe, expect, it } from "vitest";
import { decl, read, ruleBody, stripComments } from "../styles/_css";

// T179 (owner 2026-10-22) — MY PINS → MY CONTENT: the rename, the Guide's centred resizable
// window, and the fifth TEXTURES tab (fetched on open). Source fences (the island needs a DOM +
// a member session to render, so the cross-file contract is checked as text).

const SRC = read("src/components/panels/MyPins.tsx");
const CSS = stripComments(read("src/styles/my-pins.css"));

describe("MyPins → My content (T179)", () => {
  it("the toggle and the dialog say My content; the PINS tab keeps its MY PINS label", () => {
    expect(SRC).toMatch(/className="mp-toggle tip"[\s\S]*?>\s*My content\s*<\/button>/);
    expect(SRC).not.toMatch(/>\s*My pins\s*</);
    expect(SRC).toContain('aria-label="My content: pins, places, models and textures"');
    expect(SRC).toMatch(/MY PINS\{tab === "pins"/);
  });

  it("the window is the Guide's: drag + resize on one style, a DragGrip and a ResizeGrip as direct children", () => {
    expect(SRC).toContain('usePanelDrag("my-pins")');
    expect(SRC).toContain('usePanelResize("my-pins")');
    expect(SRC).toContain("style={{ ...drag.style, ...resize.style }}");
    expect(SRC).toMatch(/<DragGrip drag=\{drag\}[^>]*\/>\s*<ResizeGrip resize=\{resize\}[^>]*\/>/);
  });

  it("the CSS centres the window, composes the drag in ONE transform and reads --win-w / --win-h", () => {
    const panel = ruleBody(CSS, ".mp-panel");
    expect(decl(panel, "top")).toBe("50%");
    expect(decl(panel, "left")).toBe("50%");
    expect(decl(panel, "right")).toBeNull();
    expect(decl(panel, "transform")).toBe("translate(calc(-50% + var(--drag-x, 0px)), calc(-50% + var(--drag-y, 0px)))");
    expect(decl(panel, "width")).toBe("var(--win-w, min(52rem, 92vw))");
    expect(decl(panel, "height")).toBe("var(--win-h, min(72vh, 42rem))");
    expect(decl(panel, "box-sizing")).toBe("border-box");
    expect(decl(ruleBody(CSS, ".mp-scroll"), "overflow-y")).toBe("auto");
    expect(decl(ruleBody(CSS, ".mp-scroll"), "flex")).toBe("1 1 auto");
    expect(decl(ruleBody(CSS, ".mp-tabs"), "flex-wrap")).toBe("nowrap");
  });

  it("TEXTURES is the fifth tab after MODELS, mounts MyFacadesTab, and re-asks loadMine on open", () => {
    const models = SRC.indexOf('data-tab="models"');
    const textures = SRC.indexOf('data-tab="textures"');
    expect(models).toBeGreaterThan(0);
    expect(textures).toBeGreaterThan(models);
    expect(SRC).toMatch(/role="tab"\s*aria-selected=\{tab === "textures"\}\s*data-tab="textures"/);
    expect(SRC).toContain('{tab === "textures" && <MyFacadesTab onClose={() => setOpen(false)} />}');
    expect(SRC).toMatch(/tab === "textures"\) \{[\s\S]*?useFacadesStore\.getState\(\)\.loadMine\(\);/);
  });

  it("Escape still closes the window", () => {
    expect(SRC).toMatch(/if \(e\.key === "Escape"\) setOpen\(false\);/);
  });
});
