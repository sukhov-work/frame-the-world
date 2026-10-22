import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FacadeEditChip, {
  FACADE_EDIT_OPS,
  FACADE_OP_KEY,
  FACADE_OP_LABEL,
  FacadeEditChipView,
  facadeOffsetM,
  facadeOpEdited,
  facadeOpOriginal,
  facadeOpReadout,
  facadeOpRows,
  facadeResolvedPoses,
  facadeRevertedPose,
  type FacadeEditActions,
  type FacadeEditView,
  type FacadeOpRow,
  type FacadeResolvedPose,
} from "../../src/components/panels/FacadeEditChip";
import { useFacadePhotoStore } from "../../src/store/facadePhoto";
import type { EditScope } from "../../src/store/editJournal";
import type { FacadePoseSnapshot } from "../../src/lib/wix/facadeRecords";

// T175 (owner 2026-10-22) — the facade chip: the placed facade photo's quick gizmo ops
// (OFF · MOVE · ROTATE · SCALE) beside ↶ UNDO / DROP SESSION, on the shared `.bldg-edit-chip` /
// `.bec-*` chrome with a `data-kind="facade"` root (+ `data-facade-chip` for harnesses). The view
// takes the state as props (zustand 5 serves a hook its INITIAL state under renderToStaticMarkup)
// — the modelEditChip.test.ts idiom.

const calls: string[] = [];
const actions: FacadeEditActions = {
  setGizmoOp: (op) => calls.push(`op:${op}`),
  requestRevert: (op) => calls.push(`revert:${op}`),
  requestUndo: (s: EditScope) => calls.push(`undo:${s}`),
  requestDrop: (s: EditScope) => calls.push(`drop:${s}`),
};
const BASE: FacadeResolvedPose = { lat: 48.4647, lon: 35.0462, altitudeM: 87.5, headingDeg: 25, pitchDeg: 0, rollDeg: 0, hFovDeg: 69.4 };
const row = (op: FacadeOpRow["op"], over: Partial<FacadeOpRow> = {}): FacadeOpRow => ({
  op,
  value: facadeOpReadout(op, BASE, BASE),
  was: facadeOpOriginal(op, BASE),
  edited: false,
  ...over,
});
const ROWS: readonly FacadeOpRow[] = [row("move"), row("rotate"), row("scale")];
const v = (over: Partial<FacadeEditView> = {}): FacadeEditView => ({
  gizmoOp: "none",
  rows: ROWS,
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
    expect((html.match(/class="bec-op is-on/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-selected="false" class="bec-op" data-op="move"/);
    // T188: the hotkey letters on the three ops (the meshes' <kbd> idiom), none on OFF.
    for (const op of FACADE_EDIT_OPS) expect(html).toContain(`${FACADE_OP_LABEL[op]}<kbd>${FACADE_OP_KEY[op]}</kbd>`);
    expect(FACADE_OP_KEY).toEqual({ move: "G", rotate: "R", scale: "S" });
    expect(html).not.toMatch(/OFF<kbd>/);
    // T188: one row per op (the meshes' shape) — label · value · was; no RESET ALL.
    expect(html).toContain('class="bec-rows"');
    expect((html.match(/class="bec-row[ "]/g) ?? []).length).toBe(3);
    expect(html).toMatch(/class="bec-row is-on" data-op="rotate"/);
    expect(html).toContain("was 0.0 E · 0.0 N · ↑87.5 m");
    expect(html).toContain("25.0° · 0.0° · 0.0°");
    expect(html).toContain("69.4° H-FOV");
    expect(html).not.toContain("RESET ALL");
    // Nothing edited → no ↺ (void spacers keep the grid).
    expect(html).not.toContain('class="bec-revert" data-op');
    expect((html.match(/bec-revert--void/g) ?? []).length).toBe(3);
  });

  it("T188: an edited op lights its tab + row and shows ↺; a missing baseline prints 'was —' and nothing edited", () => {
    const cur: FacadeResolvedPose = { ...BASE, lat: BASE.lat + 0.0001, hFovDeg: 60 };
    const html = view(v({ gizmoOp: "move", rows: facadeOpRows(cur, BASE) }));
    expect(html).toMatch(/class="bec-op is-on is-edited" data-op="move"/);
    expect(html).toMatch(/class="bec-op is-edited" data-op="scale"/);
    expect(html).toMatch(/class="bec-op" data-op="rotate"/);
    expect(html).toMatch(/class="bec-row is-on is-edited" data-op="move"/);
    expect(html).toMatch(/class="bec-revert" data-op="move"/);
    expect(html).toMatch(/class="bec-revert" data-op="scale"/);
    expect(html).toContain("Revert scale to the EXIF pose");
    expect(html).toContain("0.0 E · +11.1 N · ↑87.5 m");
    const none = view(v({ rows: facadeOpRows(cur, null) }));
    expect(none).toContain("was —");
    expect(none).toContain("48.46480, 35.04620 · ↑87.5 m");
    expect(none).not.toContain("is-edited");
  });

  it("T188: the readouts — east / north metres from the baseline, signed angles, the H-FOV; the edited epsilons", () => {
    const off = facadeOffsetM({ lat: 48.4647 + 0.0001, lon: 35.0462 + 0.0001 }, BASE);
    expect(off.northM).toBeCloseTo(11.132, 2);
    expect(off.eastM).toBeCloseTo(11.132 * Math.cos((48.4647 * Math.PI) / 180), 2);
    expect(facadeOpReadout("rotate", { ...BASE, headingDeg: 190.26, pitchDeg: -3.2, rollDeg: 1.5 }, BASE)).toBe("190.3° · -3.2° · +1.5°");
    expect(facadeOpReadout("scale", { ...BASE, hFovDeg: 46.75 }, BASE)).toBe("46.8° H-FOV");
    expect(facadeOpOriginal("move", { ...BASE, altitudeM: null })).toBe("0.0 E · 0.0 N");
    expect(facadeOpEdited("move", BASE, BASE)).toBe(false);
    expect(facadeOpEdited("move", { ...BASE, altitudeM: 87.6 }, BASE)).toBe(true);
    expect(facadeOpEdited("move", { ...BASE, altitudeM: null }, BASE)).toBe(true);
    expect(facadeOpEdited("rotate", { ...BASE, rollDeg: 1e-7 }, BASE)).toBe(false);
    expect(facadeOpEdited("rotate", { ...BASE, pitchDeg: 0.5 }, BASE)).toBe(true);
    expect(facadeOpEdited("scale", { ...BASE, hFovDeg: 69.5 }, BASE)).toBe(true);
  });

  it("T188: a ↺ snapshot puts ONE op back (unset = the EXIF default; MOVE to the baseline placement) and leaves the rest", () => {
    const before: FacadePoseSnapshot = { lat: 48.5, lon: 35.1, altitudeM: 90, headingDeg: 30, pitchDeg: 2, rollDeg: 1, hFovDeg: 50 };
    expect(facadeRevertedPose(before, "move", { lat: 48.4647, lon: 35.0462 })).toEqual({ ...before, lat: 48.4647, lon: 35.0462, altitudeM: null });
    expect(facadeRevertedPose(before, "move", null)).toEqual({ ...before, altitudeM: null });
    expect(facadeRevertedPose(before, "rotate", null)).toEqual({ ...before, headingDeg: null, pitchDeg: null, rollDeg: null });
    expect(facadeRevertedPose(before, "scale", null)).toEqual({ ...before, hFovDeg: null });
  });

  it("T188: the resolved poses — unset fields resolve through the EXIF pose, else the EXIF-seeded params", () => {
    const exif = { headingDeg: 25, pitchDeg: 0, rollDeg: 0, gpsAltitudeM: 87.5, focalLengthMm: 26, focalLengthIn35mmMm: 26, width: 1600, height: 1200 };
    const snap: FacadePoseSnapshot = { lat: 48.4647, lon: 35.0462, altitudeM: null, headingDeg: null, pitchDeg: null, rollDeg: null, hFovDeg: null };
    const noBase = facadeResolvedPoses({ poseSnapshot: () => snap, exif, exifPose: undefined, params: { focalLengthMm: 26 } } as never);
    expect(noBase?.base).toBeNull();
    expect(noBase?.cur).toMatchObject({ lat: 48.4647, lon: 35.0462, altitudeM: 87.5, headingDeg: 25, pitchDeg: 0, rollDeg: 0 });
    expect(noBase?.cur.hFovDeg).toBeGreaterThan(60); // the derived H-FOV of a 26 mm-eq frame
    const exifPose = { lat: 48.4647, lon: 35.0462, apexAltM: 87.55, altitudeM: 87.5, headingDeg: 25, pitchDeg: 0, rollDeg: 0, focalLengthMm: 26, hFovDeg: 69.4, fovEstimated: false, textureWidth: 1600, textureHeight: 1200 };
    const withBase = facadeResolvedPoses({ poseSnapshot: () => ({ ...snap, headingDeg: 40, hFovDeg: 50 }), exif, exifPose, params: { focalLengthMm: 26 } } as never);
    expect(withBase?.base).toMatchObject({ headingDeg: 25, hFovDeg: 69.4, altitudeM: 87.5 });
    expect(withBase?.cur).toMatchObject({ headingDeg: 40, hFovDeg: 50, pitchDeg: 0, rollDeg: 0, altitudeM: 87.5 });
    expect(facadeResolvedPoses({ poseSnapshot: () => null, exif, exifPose: undefined, params: {} } as never)).toBeNull();
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
    click((p) => p["data-op"] === "scale" && p.role === "tab");
    click((p) => p["data-op"] === "none");
    click((p) => p["data-act"] === "undo");
    click((p) => p["data-act"] === "drop-session");
    expect(calls).toEqual(["op:scale", "op:none", "undo:facade", "drop:facade"]);
    // T188: the row's ↺ asks for that op's revert.
    calls.length = 0;
    const edited = FacadeEditChipView({ view: v({ rows: facadeOpRows({ ...BASE, hFovDeg: 50 }, BASE) }), actions });
    const els2 = walk(edited);
    (els2.find((e) => e.props["data-op"] === "scale" && e.props.className === "bec-revert")!.props.onClick as () => void)();
    expect(calls).toEqual(["revert:scale"]);
  });
});

describe("T188 — the G / R / S hotkeys (the orchestrator)", () => {
  const root = join(__dirname, "../..");
  const src = readFileSync(join(root, "src/components/globe/StylizedTiles.ts"), "utf8");

  it("the placed facade's op switches on G / R / S in orbit AND FPV (before the FPV walk block), the same key again → OFF, an armed mesh owns the keys", () => {
    const i = src.indexOf("// T188 (owner 2026-10-22g");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 1400);
    expect(block).toMatch(/hqAllowed && !e\.metaKey && !e\.ctrlKey && !e\.altKey && !bldgArmed && !modelArmed && !typingTarget\(/); // the gizmo exists only on the editing tier
    expect(block).toMatch(/fs\.phase === "placed"/);
    expect(block).toMatch(/e\.code === "KeyG" \? "move" : e\.code === "KeyR" \? "rotate" : e\.code === "KeyS" \? "scale" : null/);
    expect(block).toMatch(/fs\.setGizmoOp\(fs\.gizmoOp === op \? "none" : op\)/);
    // The facade rung sits BEFORE the `fpvActive` walk / mesh-hotkey block — orbit edits take it too.
    expect(i).toBeLessThan(src.indexOf("if (fpvActive && !e.metaKey && !e.ctrlKey) {"));
    expect(i).toBeGreaterThan(src.indexOf("const onFpvKey = (e: KeyboardEvent) => {"));
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

  it("the /m LAYERS grid carries the ▣ TEXTURES cell on the same store field (T191 — the modal since 2026-10-23)", () => {
    const sa = readFileSync(join(root, "src/components/mobile/SceneActions.tsx"), "utf8");
    expect(sa).toMatch(/textures: \{ on: texturesVisible, toggle: \(\) => setTexturesVisible\(!texturesVisible\) \}/);
    expect(sa).toMatch(/\{ key: "textures", glyph: "▣", cap: "TEXTURES" \}/);
    expect(sa).not.toContain("m-layersrow");
  });
});
