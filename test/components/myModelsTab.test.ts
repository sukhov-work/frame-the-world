import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MyModelsTabView,
  modelRowBadges,
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

  it("a row carries the thumbnail or the glyph, the title, the size at the committed scale, the tris and the three actions", () => {
    const html = view(state({ models: [item("a", { thumbnailUrl: "https://static.wixstatic.com/media/t.png" }), item("b", { scale: 2 })] }));
    expect(html).toContain('src="https://static.wixstatic.com/media/t.png"');
    expect(html).toContain("mp-thumb--model"); // b has no thumbnail
    expect(html).toContain("Model a");
    expect(html).toContain("12.4 × 8.00 × 31.2 m · 84.0K TRIS"); // w × d × h from bbox [x, y, z]
    expect(html).toContain("24.8 × 16.0 × 62.4 m · 84.0K TRIS"); // × 2
    expect(html).toContain('data-act="rename"');
    expect(html).toContain('data-act="hide"');
    expect(html).toContain('data-act="delete"');
    expect(html).toContain("HIDE");
    expect(html).not.toContain("SHOW");
    expect(html).not.toContain('data-note="hidden"');
    expect(html).toContain('title="Stand beside it in first-person view"');
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
