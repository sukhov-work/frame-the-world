import { describe, it, expect } from "vitest";
import { read, stripComments, ruleBody } from "../styles/_css";

/**
 * F1 / F2 (2026-10-21) — the facade panel's STATIC fences: the data-hooks the browser harness
 * drives, the lens control reading the ONE effective H-FOV, the writes staying in the stores, and
 * the two UI rules every panel honours (no autoFocus, no form POST). Source-as-text on purpose
 * (the `mobileFence` idiom): the island portals to <body> and reads four stores, so a static
 * render would prove less than these shapes do.
 */

const SRC = "src/components/panels/FacadePhotoFlow.tsx";
const CSS = "src/styles/facade-photo.css";

describe("the facade panel's harness hooks", () => {
  const code = stripComments(read(SRC));

  it("carries the GIZMO chips, UNDO, SAVE / UPDATE / DELETE and the MY FACADES rows", () => {
    expect(code).toMatch(/data-facade-op=\{c\.op\}/);
    for (const op of ["none", "move", "rotate", "scale"]) expect(code).toMatch(new RegExp(`op: "${op}"`));
    expect(code).toMatch(/data-facade-undo/);
    expect(code).toMatch(/data-facade-save/);
    expect(code).toMatch(/data-facade-update/);
    expect(code).toMatch(/data-facade-delete/);
    expect(code).toMatch(/data-facade-row=\{item\.id\}/);
    expect(code).toMatch(/className="pd-save__nameinput pd-save__title uf-mono"/);
  });

  it("keeps the overlay contracts the harness already relies on", () => {
    expect(code).toMatch(/className="uf ff"/);
    expect(code).toMatch(/data-open-facade/);
    expect(code).toMatch(/className="pd ff-panel"/);
    expect(code).toMatch(/type="file"/);
  });

  it("the chips write the store op; UNDO requests the facade scope on the journal", () => {
    expect(code).toMatch(/setGizmoOp\(c\.op\)/);
    expect(code).toMatch(/requestUndo\("facade"\)/);
    expect(code).toMatch(/undoableCount\(editJournal, target\)/);
    expect(code).toMatch(/facadeTarget\(store\.savedFacadeId \?\? "draft"\)/);
    expect(code).toMatch(/useEditJournalStore\(\(s\) => s\.undoable\)/);
  });
});

describe("the lens control is the H-FOV (F1 — SCALE = the H-FOV)", () => {
  const code = stripComments(read(SRC));

  it("reads effectiveHFovDeg with the override and writes setHFovDeg — never the focal", () => {
    expect(code).toMatch(/effectiveHFovDeg\(exif, store\.params, store\.hFovDeg\)/);
    expect(code).toMatch(/label="LENS · H-FOV"/);
    expect(code).toMatch(/onChange=\{\(v\) => facade\(\)\.setHFovDeg\(v\)\}/);
    expect(code).toMatch(/onReset=\{\(\) => facade\(\)\.setHFovDeg\(undefined\)\}/);
    expect(code).toMatch(/focalFromHorizontalFov\(hFov\)/);
    // the placed panel has no focal slider any more (the review overlay keeps its own)
    const panel = code.slice(code.indexOf("function FacadeDetailPanel"));
    expect(panel).not.toMatch(/setParam\("focalLengthMm"/);
  });

  it("takes the slider bands from the tunables", () => {
    for (const knob of ["hFovMinDeg", "hFovMaxDeg", "pitchMaxDeg", "rollMaxDeg", "altMinM", "altMaxM"]) {
      expect(code).toMatch(new RegExp(`PHOTO_PROJECT\\.${knob}`));
    }
  });

  it("the override lights the changed dot", () => {
    expect(code).toMatch(/const dirty = isDirty\(exif, store\.params\) \|\| store\.rollDeg !== undefined \|\| hFovManual/);
  });
});

describe("the SAVE section + MY FACADES", () => {
  const code = stripComments(read(SRC));

  it("members only — a signed-out visitor gets the login link, never a dead button", () => {
    expect(code).toMatch(/memberPhase !== "member" \? \(/);
    expect(code).toMatch(/loginUrl\(returnHereUrl\(\)\)/);
  });

  it("the writes go through the stores — the component never fetches and never form-posts", () => {
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/method=["']post["']/i);
    expect(code).not.toMatch(/autoFocus/);
    expect(code).toMatch(/save\.saveFacade\(\)/);
    expect(code).toMatch(/save\.updateFacade\(\)/);
    expect(code).toMatch(/save\.deleteFacade\(\)/);
  });

  it("DELETE is a two-press confirm that disarms itself", () => {
    expect(code).toMatch(/if \(!confirmDelete\) return setConfirmDelete\(true\);/);
    expect(code).toMatch(/const DELETE_CONFIRM_MS = 4000;/);
  });

  it("MY FACADES loads the member's rows on open and a row re-opens through the store", () => {
    expect(code).toMatch(/useFacadesStore\.getState\(\)\.loadMine\(\)/);
    expect(code).toMatch(/facade\(\)\.openSaved\(item\)/);
    expect(code).toMatch(/loading="lazy"/);
    for (const note of ["LOADING…", "NO SAVED FACADE PHOTOS YET", "SIGN IN TO SEE YOUR FACADE PHOTOS"]) {
      expect(code).toContain(note);
    }
  });

  it("never reaches the upload/pin flow or the mobile shell", () => {
    expect(code).not.toMatch(/store\/upload["']/);
    expect(code).not.toMatch(/store\/save["']/);
    expect(code).not.toMatch(/components\/mobile\/|\.\.\/mobile\//);
  });
});

describe("the styles exist for the new rows", () => {
  const css = read(CSS);

  it("gizmo row, MY FACADES rows, the save notes", () => {
    for (const sel of [".ff-gizmo", ".ff-gizmo__ops", ".ff-mine", ".ff-mine__list", ".ff-mine__row", ".ff-mine__thumb", ".ff-mine__sub", ".ff-save__note"]) {
      ruleBody(css, sel);
    }
  });

  it("uses tokens only — no new literal colours", () => {
    const body = stripComments(css);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/rgba?\(/);
  });
});
