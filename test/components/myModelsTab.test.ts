import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MyModelsTabView,
  modelRowBadges,
  modelRowResettable,
  modelRowSub,
  type MyModelsActions,
  type MyModelsViewState,
} from "../../src/components/panels/MyModelsTab";
import type { ModelListItem } from "../../src/lib/wix/modelRecords";

// MESH SUITE MS6 — the MY PINS · MODELS tab: the row anatomy (our thumbnail or the glyph, the
// title, the size × scale + tris line, the badges), the trailing rename / hide / delete group,
// the inline rename row, the empty / loading / error states and the hidden-models foot note.
// The view takes its state as props (zustand 5 serves a hook its INITIAL state under
// renderToStaticMarkup).

const noop = () => {};
const actions: MyModelsActions = {
  open: noop,
  goto: noop,
  reset: noop,
  beginRename: noop,
  cancelRename: noop,
  setDraft: noop,
  commitRename: noop,
  toggleHidden: noop,
  remove: noop,
};
const item = (id: string, over: Partial<ModelListItem> = {}): ModelListItem => ({
  id,
  title: `Model ${id}`,
  url: `https://static.wixstatic.com/3d/${id}.glb`,
  thumbnailUrl: null,
  fileName: null,
  sourceFormat: "glb",
  glbBytes: 5000,
  tris: 84_000,
  meshes: 1,
  textures: 0,
  decimatedFromTris: null,
  bbox: [12.4, 31.2, 8],
  readiness: "READY",
  hidden: false,
  lat: 48.4647,
  lon: 35.0462,
  rotDeg: 0,
  scale: 1,
  tU: 0,
  pitchDeg: 0,
  rollDeg: 0,
  createdAt: null,
  updatedAt: null,
  editedByOther: false,
  ...over,
});
const state = (over: Partial<MyModelsViewState> = {}): MyModelsViewState => ({
  models: [],
  phase: "ready",
  error: null,
  armedDeleteId: null,
  busyId: null,
  renamingId: null,
  draft: "",
  ...over,
});
const view = (s: MyModelsViewState) => renderToStaticMarkup(createElement(MyModelsTabView, { state: s, actions }));

describe("MyModelsTab (MS6)", () => {
  it("renders the states: loading, error, empty", () => {
    expect(view(state({ phase: "loading" }))).toContain("LOADING…");
    expect(view(state({ error: "HTTP 502" }))).toContain("COULD NOT LOAD — HTTP 502");
    expect(view(state())).toContain("No models yet");
  });

  it("a row carries the thumbnail or the glyph, the title, the size at the committed scale, the tris and the five actions", () => {
    const html = view(state({ models: [item("a", { thumbnailUrl: "https://static.wixstatic.com/media/t.png" }), item("b", { scale: 2 })] }));
    expect(html).toContain('src="https://static.wixstatic.com/media/t.png"');
    expect(html).toContain("mp-thumb--model"); // b has no thumbnail
    expect(html).toContain("Model a");
    expect(html).toContain("12.4 × 8.00 × 31.2 m · 84.0K TRIS"); // w × d × h from bbox [x, y, z]
    expect(html).toContain("24.8 × 16.0 × 62.4 m · 84.0K TRIS"); // × 2
    expect(html).toContain('data-act="rename"');
    expect(html).toContain('data-act="goto"');
    expect(html).toContain('data-act="reset"');
    expect(html).toContain('data-act="hide"');
    expect(html).toContain('data-act="delete"');
    expect(html).toContain("HIDE");
    expect(html).not.toContain("SHOW");
    expect(html).not.toContain('data-note="hidden"');
    expect(html).toContain('title="Stand beside it in first-person view"');
  });

  it("MS7 — GOTO and RESET: GOTO needs a placement, RESET needs an edit; the fact line says when a model is lifted or sunk", () => {
    const act = (html: string, id: string, act: string) => {
      const row = html.slice(html.indexOf(`data-model-id="${id}"`));
      const i = row.indexOf(`data-act="${act}"`);
      const open = row.lastIndexOf("<button", i);
      return row.slice(open, row.indexOf(">", i) + 1);
    };
    const html = view(state({ models: [item("a"), item("b", { scale: 2 }), item("u", { lat: null, lon: null }), item("s", { tU: -1.5 }), item("l", { tU: 12 })] }));
    // As uploaded: GOTO live, RESET dark.
    expect(act(html, "a", "goto")).not.toContain("disabled");
    expect(act(html, "a", "reset")).toContain("disabled");
    // Resized: RESET live.
    expect(act(html, "b", "reset")).not.toContain("disabled");
    // Unplaced: neither.
    expect(act(html, "u", "goto")).toContain("disabled");
    expect(act(html, "u", "reset")).toContain("disabled");
    // Sunk / lifted: RESET live, the fact line carries the signed lift.
    expect(act(html, "s", "reset")).not.toContain("disabled");
    expect(modelRowSub(item("s", { tU: -1.5 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS · ↑ −1.50");
    expect(modelRowSub(item("l", { tU: 12 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS · ↑ +12.0");
    expect(modelRowSub(item("g", { tU: 0.004 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS"); // under the 1 cm eps
    // MS8: the tilt on the fact line only when tilted (integer degrees, signed).
    expect(modelRowSub(item("t", { pitchDeg: 30.4, rollDeg: -5 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS · ⟲ +30° · −5°");
    expect(modelRowSub(item("t2", { tU: 12, pitchDeg: 0, rollDeg: 180 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS · ↑ +12.0 · ⟲ 0° · +180°");
    expect(modelRowSub(item("u", { pitchDeg: 0.02 }))).toBe("12.4 × 8.00 × 31.2 m · 84.0K TRIS");
    expect(modelRowResettable(item("a"))).toBe(false);
    expect(modelRowResettable(item("a", { rotDeg: 15 }))).toBe(true);
    expect(modelRowResettable(item("a", { tU: -0.5 }))).toBe(true);
    expect(modelRowResettable(item("a", { rollDeg: 90 }))).toBe(true); // MS8: a tilt alone lights RESET
    expect(modelRowResettable(item("a", { scale: 2, lat: null, lon: null }))).toBe(false);
  });

  it("badges: HIDDEN (+ the foot note and SHOW), PROCESSING, FAILED, NOT PLACED, EDITED", () => {
    const html = view(
      state({
        models: [
          item("h", { hidden: true }),
          item("p", { readiness: "PENDING" }),
          item("f", { readiness: "FAILED" }),
          item("u", { lat: null, lon: null }),
          item("e", { editedByOther: true }),
        ],
      }),
    );
    expect(html).toContain("HIDDEN");
    expect(html).toContain("SHOW");
    expect(html).toContain('data-note="hidden"');
    expect(html).toContain("PROCESSING");
    expect(html).toContain("FAILED");
    expect(html).toContain("NOT PLACED");
    expect(html).toContain('title="Place it on the globe"');
    expect(html).toContain("EDITED");
    expect(html).toContain('data-hidden="true"');
    expect(modelRowBadges(item("x")).length).toBe(0);
    expect(modelRowBadges(item("x", { hidden: true, editedByOther: true })).map((b) => b.label)).toEqual(["HIDDEN", "EDITED"]);
  });

  it("the two-press delete arms (SURE?), a busy row shows …, and the rename row swaps in an input with the draft", () => {
    expect(view(state({ models: [item("a")], armedDeleteId: "a" }))).toContain("SURE?");
    const busy = view(state({ models: [item("a")], busyId: "a" }));
    expect(busy).toContain("…");
    expect(busy).toContain("disabled");
    const renaming = view(state({ models: [item("a")], renamingId: "a", draft: "Water tower" }));
    expect(renaming).toContain("mp-rename__input");
    expect(renaming).toContain('value="Water tower"');
    expect(renaming).toContain('data-act="rename-ok"');
    expect(renaming).toContain('maxLength="120"');
    expect(renaming).not.toContain('data-act="hide"'); // the action group yields to the rename row
  });

  it("the fact line degrades gracefully", () => {
    expect(modelRowSub(item("a", { bbox: null }))).toBe("84.0K TRIS");
    expect(modelRowSub(item("a", { bbox: null, tris: null }))).toBe("");
    expect(modelRowSub(item("a", { bbox: [3, 5, 3] }))).toBe("3.00 × 3.00 × 5.00 m · 84.0K TRIS");
  });
});
