import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FacadeEditChip, {
  FACADE_OP_LABEL,
  FacadeEditChipView,
  type FacadeEditActions,
  type FacadeEditView,
} from "../../src/components/panels/FacadeEditChip";
import { useFacadePhotoStore } from "../../src/store/facadePhoto";
import type { EditScope } from "../../src/store/editJournal";

// T175 (owner 2026-10-22) — the facade chip: the placed facade photo's quick gizmo ops
// (OFF · MOVE · ROTATE · SCALE) beside ↶ UNDO / DROP SESSION, on the shared `.bldg-edit-chip` /
// `.bec-*` chrome with a `data-kind="facade"` root (+ `data-facade-chip` for harnesses). The view
// takes the state as props (zustand 5 serves a hook its INITIAL state under renderToStaticMarkup)
// — the modelEditChip.test.ts idiom.

const calls: string[] = [];
const actions: FacadeEditActions = {
  setGizmoOp: (op) => calls.push(`op:${op}`),
  requestUndo: (s: EditScope) => calls.push(`undo:${s}`),
  requestDrop: (s: EditScope) => calls.push(`drop:${s}`),
};
const v = (over: Partial<FacadeEditView> = {}): FacadeEditView => ({
  gizmoOp: "none",
  undoable: 0,
  undoLabel: null,
  sessionEdited: false,
  ...over,
});
const view = (vv: FacadeEditView) => renderToStaticMarkup(createElement(FacadeEditChipView, { view: vv, actions }));

describe("FacadeEditChip (T175)", () => {
  beforeEach(() => {
    calls.length = 0;
    useFacadePhotoStore.setState({ phase: "idle", gizmoOp: "none" });
  });

  it("renders nothing unless a facade photo is placed (the island)", () => {
    expect(renderToStaticMarkup(createElement(FacadeEditChip))).toBe("");
  });

  it("a facade root on the shared chip chrome, the four ops as tabs, the store's op lit", () => {
    const html = view(v({ gizmoOp: "rotate" }));
    expect(html).toContain('class="bldg-edit-chip"');
    expect(html).toContain('data-kind="facade"');
    expect(html).toContain("data-facade-chip");
    expect(html).toContain('class="bec-ops" role="tablist"');
    for (const op of ["none", "move", "rotate", "scale"] as const) {
      expect(html).toContain(`data-op="${op}"`);
      expect(html).toContain(FACADE_OP_LABEL[op]);
    }
    expect(FACADE_OP_LABEL).toEqual({ none: "OFF", move: "MOVE", rotate: "ROTATE", scale: "SCALE" });
    expect(html).toMatch(/aria-selected="true" class="bec-op is-on" data-op="rotate"/);
    expect((html.match(/is-on/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-selected="false" class="bec-op" data-op="move"/);
    // No per-op rows (the panel owns the readouts), no RESET ALL.
    expect(html).not.toContain("bec-rows");
    expect(html).not.toContain("RESET ALL");
  });

  it("the foot shows ↶ UNDO / DROP SESSION only when this facade has them", () => {
    const clean = view(v());
    expect(clean).not.toContain('data-act="undo"');
    expect(clean).not.toContain('data-act="drop-session"');
    const html = view(v({ undoable: 2, undoLabel: "scale", sessionEdited: true }));
    expect(html).toContain('class="bec-undo" data-act="undo"');
    expect(html).toContain("Undo the scale change (Ctrl+Z)");
    expect(html).toContain('class="bec-drop" data-act="drop-session"');
    expect(html).toContain("DROP SESSION");
  });

  it("the buttons write the store op and the facade-scoped journal one-shots", () => {
    // Drive the handlers through the view's element tree (no DOM in this repo — node env).
    const tree = FacadeEditChipView({ view: v({ undoable: 1, undoLabel: "move", sessionEdited: true }), actions });
    const walk = (n: unknown, out: { props: Record<string, unknown> }[] = []) => {
      if (Array.isArray(n)) n.forEach((c) => walk(c, out));
      else if (n && typeof n === "object" && "props" in n) {
        const p = (n as { props: Record<string, unknown> }).props;
        out.push(n as { props: Record<string, unknown> });
        walk(p.children, out);
      }
      return out;
    };
    const els = walk(tree);
    const click = (pred: (p: Record<string, unknown>) => boolean) => (els.find((e) => pred(e.props))!.props.onClick as () => void)();
    click((p) => p["data-op"] === "scale");
    click((p) => p["data-op"] === "none");
    click((p) => p["data-act"] === "undo");
    click((p) => p["data-act"] === "drop-session");
    expect(calls).toEqual(["op:scale", "op:none", "undo:facade", "drop:facade"]);
  });
});

describe("FacadeEditChip — source fences", () => {
  const root = join(__dirname, "../..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  it("the connected chip reads the facade store's phase + gizmoOp and yields to an armed mesh", () => {
    const src = read("src/components/panels/FacadeEditChip.tsx");
    expect(src).toMatch(/useFacadePhotoStore\(\(s\) => s\.phase === "placed"\)/);
    expect(src).toMatch(/useFacadePhotoStore\(\(s\) => s\.gizmoOp\)/);
    expect(src).toMatch(/if \(!placed \|\| bldgArmed \|\| modelArmed\) return null;/);
    expect(src).toMatch(/requestUndo\("facade"\)/);
    expect(src).toMatch(/requestDrop\("facade"\)/);
    expect(src).not.toMatch(/store\/upload|components\/mobile/);
  });

  it("the building pill yields while a facade photo is placed", () => {
    const src = read("src/components/panels/BuildingEditChip.tsx");
    expect(src).toMatch(/pillShows\(sync, journal, modelArmed, facadePlaced\)/);
  });

  it("the facade CSS adds only what data-kind=facade needs, tokens only", () => {
    const css = read("src/styles/building-edit.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.bldg-edit-chip\[data-kind="facade"\]\s*\{/);
    expect(css).toMatch(/\.bec-kind\s*\{/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
  });
});

// T182 — the TEX chip must ship LIT: the lit state is a hand-kept selector list in
// camera-tilt.css (chips have twice shipped with `is-on` and no pixels — that file's comment).
describe("TEX chip (T182) + MY SPOT icon (T180) — source fences", () => {
  const root = join(__dirname, "../..");
  const panel = readFileSync(join(root, "src/components/panels/CameraTiltPanel.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/camera-tilt.css"), "utf8");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("the panel renders a ct-tex chip wired to the store field, after VEC", () => {
    expect(panel).toMatch(/className=\{`ct-mode ct-tex tip\$\{on \? " is-on" : ""\}`\}/);
    expect(panel).toMatch(/useCameraStore\(\(s\) => s\.texturesVisible\)/);
    expect(panel).toMatch(/useCameraStore\(\(s\) => s\.setTexturesVisible\)/);
    expect(panel).toMatch(/>\s*TEX\s*</);
    expect(panel.indexOf("<TexturesChip />")).toBeGreaterThan(panel.indexOf("VEC\n"));
  });

  it(".ct-tex.is-on is in the hand-kept lit-state list", () => {
    const lit = bare.match(/((?:\.ct-[a-z]+\.is-on,\s*)+\.ct-[a-z]+\.is-on)\s*\{[^}]*--color-accent/);
    expect(lit).not.toBeNull();
    expect(lit![1]).toContain(".ct-tex.is-on");
  });

  it("MY SPOT sits right after the compass, runs the shared geolocation hook, and is styled", () => {
    const compassEnd = panel.indexOf('<circle className="ct-compass__pin"');
    const mySpot = panel.indexOf("<MySpotButton />");
    expect(mySpot).toBeGreaterThan(compassEnd);
    expect(mySpot).toBeLessThan(panel.indexOf('className={`ct-mode tip${is2D'));
    expect(panel).toMatch(/import \{ useMyLocation \} from "\.\/MyLocation";/);
    expect(panel).toMatch(/className=\{`ct-myspot tip\$\{busy \? " is-busy" : ""\}`\}/);
    expect(panel).toMatch(/aria-label="My spot"/);
    expect(bare).toMatch(/\.ct-myspot\s*\{/);
    expect(bare).toMatch(/\.ct-myspot\.is-busy\s*\{/);
    expect(bare).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(bare).not.toMatch(/rgba?\(/);
    const ml = readFileSync(join(root, "src/components/panels/MyLocation.tsx"), "utf8");
    expect(ml).toMatch(/export function useMyLocation\(\)/);
    expect(ml).toMatch(/export default function MyLocation\(\)/);
  });

  it("the /m LAYERS row carries the ▣ TEXTURES toggle on the same store field", () => {
    const sa = readFileSync(join(root, "src/components/mobile/SceneActions.tsx"), "utf8");
    expect(sa).toMatch(/className=\{toggleCls\(texturesVisible\)\}[\s\S]{0,160}setTexturesVisible\(!texturesVisible\)[\s\S]{0,40}▣ TEXTURES/);
  });
});
