import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FacadeMarkerMenu, { FacadeMarkerMenuView, REMOVE_CONFIRM_MS } from "../../src/components/panels/FacadeMarkerMenu";
import { _resetFacadesStore, facadeRowById, useFacadesStore } from "../../src/store/facades";
import type { FacadeListItem, FacadeWorldItem } from "../../src/lib/wix/facadeRecords";
import { read, stripComments, ruleBody } from "../styles/_css";

// T178 (owner ask 2026-10-22): the saved-facade marker's context menu — EDIT (re-open in the
// editor, own rows only) · REMOVE (two-press, auto-disarm). The view takes its state as props
// (zustand 5 serves a hook its INITIAL state under renderToStaticMarkup); the wiring to the
// stores is pinned by source scans.

const SRC = "src/components/panels/FacadeMarkerMenu.tsx";
const CSS = "src/styles/facade-markers.css";

const world = (id: string, over: Partial<FacadeWorldItem> = {}): FacadeWorldItem => ({
  id,
  title: `Facade ${id}`,
  displayUrl: `https://static.wixstatic.com/media/${id}-display.jpg`,
  thumbUrl: null,
  updatedAt: "2026-10-21T10:00:00.000Z",
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 137.5,
  altitudeM: 1.7,
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  ...over,
});
const mine = (id: string, over: Partial<FacadeListItem> = {}): FacadeListItem => ({
  ...world(id),
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
  createdAt: "2026-10-21T10:00:00.000Z",
  isPublic: false,
  moderation: "PRIVATE",
  ...over,
});

const noop = () => {};
const actions = { edit: noop, remove: noop };

/** Render the view from the store's CURRENT state (the wrapper's resolution: own = in `mine`). */
const renderFromStore = (armed = false, busy = false) => {
  const s = useFacadesStore.getState();
  const item = s.menu ? facadeRowById(s, s.menu.id) : null;
  const own = s.menu ? s.mine.some((m) => m.id === s.menu!.id) : false;
  return renderToStaticMarkup(createElement(FacadeMarkerMenuView, { menu: s.menu, item, own, armed, busy, actions }));
};

afterEach(() => _resetFacadesStore());

describe("FacadeMarkerMenu — the view", () => {
  it("no menu → nothing; the store-bound island is empty at the initial state", () => {
    expect(renderFromStore()).toBe("");
    expect(renderToStaticMarkup(createElement(FacadeMarkerMenu))).toBe("");
  });

  it("an own row: role=menu at the press point, the title header, EDIT + REMOVE enabled", () => {
    useFacadesStore.setState({ mine: [mine("a", { title: "Sobornyi facade" })] });
    useFacadesStore.getState()._setMenu({ id: "a", screenX: 300, screenY: 200 });
    const html = renderFromStore();
    expect(html).toContain('class="fmenu"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('data-facade-menu="a"');
    expect(html).toMatch(/left:300px/);
    expect(html).toMatch(/top:200px/);
    expect(html).toContain('<span class="fmenu__name">Sobornyi facade</span>');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*data-act="edit"[^>]*>EDIT<\/button>/);
    expect(html).toMatch(/<button[^>]*data-act="remove"[^>]*>REMOVE<\/button>/);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("not yours");
  });

  it("a world-only row: both items disabled, titled 'not yours'", () => {
    useFacadesStore.setState({ world: [world("w")] });
    useFacadesStore.getState()._setMenu({ id: "w", screenX: 1, screenY: 2 });
    const html = renderFromStore();
    expect(html).toMatch(/<button[^>]*data-act="edit"[^>]*disabled=""[^>]*>/);
    expect(html).toMatch(/<button[^>]*data-act="remove"[^>]*disabled=""[^>]*>/);
    expect(html.match(/title="not yours"/g)).toHaveLength(2);
  });

  it("armed → 'SURE? REMOVE' + is-armed; a busy save disables REMOVE only", () => {
    useFacadesStore.setState({ mine: [mine("a")] });
    useFacadesStore.getState()._setMenu({ id: "a", screenX: 1, screenY: 2 });
    const armed = renderFromStore(true);
    expect(armed).toContain("SURE? REMOVE");
    expect(armed).toMatch(/class="fmenu__item fmenu__item--danger is-armed"/);
    const busy = renderFromStore(false, true);
    expect(busy).toMatch(/<button[^>]*data-act="remove"[^>]*disabled=""/);
    expect(busy).not.toMatch(/<button[^>]*data-act="edit"[^>]*disabled=""/);
  });

  it("a menu on a row that is gone → nothing", () => {
    useFacadesStore.getState()._setMenu({ id: "gone", screenX: 1, screenY: 2 });
    expect(renderFromStore()).toBe("");
  });
});

describe("FacadeMarkerMenu — the wiring (source scan)", () => {
  const code = stripComments(read(SRC));

  it("EDIT re-opens the OWN row in the editor, then closes", () => {
    expect(code).toMatch(/useFacadePhotoStore\.getState\(\)\.openSaved\(ownItem\)/);
    expect(code).toMatch(/mine\.find\(\(m\) => m\.id === menu\.id\)/);
  });

  it("REMOVE arms first, auto-disarms after 4 s, the second press deletes by id", () => {
    expect(REMOVE_CONFIRM_MS).toBe(4000);
    expect(code).toMatch(/"SURE\? REMOVE"/);
    expect(code).toMatch(/setTimeout\(\(\) => setArmed\(false\), REMOVE_CONFIRM_MS\)/);
    expect(code).toMatch(/useFacadeSaveStore\.getState\(\)\.deleteFacadeById\(ownItem\.id\)/);
  });

  it("closes on Escape and on a captured press outside .fmenu (the canvas included); clamps to the viewport", () => {
    expect(code).toMatch(/e\.key === "Escape"/);
    expect(code).toMatch(/closest\?\.\("\.fmenu"\)/);
    expect(code).toMatch(/addEventListener\("pointerdown", onDown, true\)/);
    expect(code).not.toMatch(/CANVAS/);
    expect(code).toMatch(/const pad = 8/);
    expect(code.match(/closeMenu\(\)/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("never reaches the mobile shell, never posts a form, no autoFocus", () => {
    expect(code).not.toMatch(/components\/mobile\/|\.\.\/mobile\//);
    expect(code).not.toMatch(/<form/);
    expect(code).not.toMatch(/autoFocus/);
  });
});

describe("facade-markers.css", () => {
  const css = read(CSS);

  it("carries the card and the menu rules", () => {
    for (const sel of [".fhover", ".fhover__thumb", ".fhover__title", ".fhover__meta", ".fmenu", ".fmenu__head", ".fmenu__name", ".fmenu__item"]) {
      ruleBody(css, sel);
    }
    expect(ruleBody(css, ".fhover")).toMatch(/pointer-events:\s*none/);
    expect(ruleBody(css, ".fmenu")).toMatch(/pointer-events:\s*auto/);
  });

  it("uses tokens only — no literal colours", () => {
    const body = stripComments(css);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/rgba?\(/);
    expect(body).not.toMatch(/hsla?\(/);
  });
});
