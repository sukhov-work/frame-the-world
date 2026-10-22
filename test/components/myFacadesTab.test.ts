import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MyFacadesTabView,
  facadeRowSub,
  type MyFacadesActions,
  type MyFacadesViewState,
} from "../../src/components/panels/MyFacadesTab";
import type { FacadeListItem } from "../../src/lib/wix/facadeRecords";
import { read } from "../styles/_css";

// T179 (owner 2026-10-22) — the MY CONTENT · TEXTURES tab: the saved facade photos on the panel's
// row rhythm, the MODELS tab's split (a pure view with injected actions — zustand 5 serves a hook
// its INITIAL state under renderToStaticMarkup — + a connected default export).

const noop = () => {};
const actions: MyFacadesActions = { open: noop, remove: noop, retry: noop };
const item = (id: string, over: Partial<FacadeListItem> = {}): FacadeListItem => ({
  id,
  title: `Facade ${id}`,
  displayUrl: `https://static.wixstatic.com/media/${id}-display.jpg`,
  thumbUrl: `https://static.wixstatic.com/media/${id}-thumb.jpg`,
  updatedAt: "2026-10-22T10:00:00.000Z",
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 160,
  altitudeM: null,
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 24,
  hFovDeg: 73.7,
  fovEstimated: false,
  textureWidth: 2048,
  textureHeight: 1365,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  targetFeatureIds: [],
  alignment: {},
  capturedAt: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  fileName: null,
  fileSizeBytes: null,
  poseSource: "EXIF",
  exifPose: null,
  createdAt: "2026-10-21T18:30:00.000Z",
  isPublic: false,
  moderation: "PRIVATE",
  ...over,
});
const state = (over: Partial<MyFacadesViewState> = {}): MyFacadesViewState => ({
  facades: [],
  phase: "ready",
  loadError: null,
  error: null,
  armedDeleteId: null,
  busyId: null,
  ...over,
});
const view = (s: MyFacadesViewState) => renderToStaticMarkup(createElement(MyFacadesTabView, { state: s, actions }));

describe("MyFacadesTab (T179)", () => {
  it("renders the states: loading, load error with RETRY, signed out, empty", () => {
    expect(view(state({ phase: "loading" }))).toContain("LOADING…");
    expect(view(state({ phase: "idle" }))).toContain("LOADING…");
    const err = view(state({ phase: "error", loadError: "HTTP 500" }));
    expect(err).toContain("COULD NOT LOAD — HTTP 500");
    expect(err).toMatch(/<button[^>]*data-act="retry"[^>]*>RETRY<\/button>/);
    expect(view(state({ phase: "anonymous" }))).toContain("SIGN IN");
    const empty = view(state());
    expect(empty).toContain('data-note="empty"');
    expect(empty).toContain("No textures yet — drop a facade photo in Upload");
  });

  it("a row: the thumb (thumbUrl, else displayUrl, lazy), the title, the date + pose line, OPEN and ✕", () => {
    const html = view(state({ facades: [item("a"), item("b", { thumbUrl: null })] }));
    expect(html).toContain('data-facade-row="a"');
    expect(html).toContain('data-facade-row="b"');
    expect(html).toContain('src="https://static.wixstatic.com/media/a-thumb.jpg"');
    expect(html).toContain('src="https://static.wixstatic.com/media/b-display.jpg"'); // the thumb fallback
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
    expect(html).toContain("Facade a");
    expect(html).toContain("2026-10-21 · N 48.46470 E 35.04620 · 90.0°");
    expect(html).toContain('<ul class="mp-list" data-tab="textures">');
    expect(html.match(/class="mp-acts"/g)?.length).toBe(2);
    expect(html).toMatch(/<button[^>]*class="mp-act"[^>]*data-act="open"[^>]*>OPEN<\/button>/);
    expect(html).toMatch(/<button[^>]*class="mp-del"[^>]*data-act="delete"[^>]*>✕<\/button>/);
  });

  it("the two-press delete: an armed row says SURE?; a busy row shows … and freezes every ✕", () => {
    const armed = view(state({ facades: [item("a"), item("b")], armedDeleteId: "a" }));
    expect(armed).toContain("mp-del is-armed");
    expect(armed).toContain("SURE?");
    expect(armed.match(/SURE\?/g)?.length).toBe(1);
    const busy = view(state({ facades: [item("a"), item("b")], busyId: "a" }));
    expect(busy).toContain(">…</button>");
    expect(busy.match(/<button[^>]*class="mp-del"[^>]*disabled=""/g)?.length).toBe(2);
  });

  it("a failed action is a note ABOVE the list — the rows stay (the models' 2026-09-19 lesson)", () => {
    const html = view(state({ facades: [item("a")], error: "delete failed" }));
    expect(html).toContain('data-note="action-error"');
    expect(html).toContain("DELETE FAILED — TRY AGAIN");
    expect(html.indexOf('data-note="action-error"')).toBeLessThan(html.indexOf("<ul"));
    expect(html.match(/<li/g)?.length).toBe(1);
  });

  it("facadeRowSub: the date then the shared pose line (southern / western hemispheres signed by letter)", () => {
    expect(facadeRowSub(item("a"))).toBe("2026-10-21 · N 48.46470 E 35.04620 · 90.0°");
    expect(facadeRowSub(item("s", { lat: -33.8568, lon: -151.2153, headingDeg: 214 }))).toBe(
      "2026-10-21 · S 33.85680 W 151.21530 · 214.0°",
    );
  });

  it("facadeRowSub: `· N BLDG` once the record knows the buildings it paints (T172), nothing otherwise", () => {
    expect(facadeRowSub(item("b", { targetFeatureIds: ["osm:w1", "osm:w2", "v|c|3"] }))).toBe(
      "2026-10-21 · N 48.46470 E 35.04620 · 90.0° · 3 BLDG",
    );
    expect(facadeRowSub(item("e", { targetFeatureIds: [] }))).toBe("2026-10-21 · N 48.46470 E 35.04620 · 90.0°");
  });

  it("the connected tab wires OPEN to openSaved + close, ✕ to deleteFacadeById, RETRY to loadMine", () => {
    const src = read("src/components/panels/MyFacadesTab.tsx");
    expect(src).toMatch(/useFacadePhotoStore\.getState\(\)\.openSaved\(item\);\s*onClose\(\);/);
    expect(src).toMatch(/if \(armedDeleteId !== item\.id\) \{\s*setArmedDeleteId\(item\.id\);\s*return;/);
    expect(src).toMatch(/await save\.deleteFacadeById\(item\.id\);/);
    expect(src).toMatch(/useFacadesStore\.getState\(\)\.loadMine\(\)/);
    expect(src).toMatch(/useFacadesStore\(\(s\) => s\.mine\)/);
  });
});
