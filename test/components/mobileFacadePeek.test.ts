import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FacadePeek, { FacadePeekView } from "../../src/components/mobile/FacadePeek";
import { _resetFacadesStore, useFacadesStore, type FacadePeek as FacadePeekState } from "../../src/store/facades";
import { useMemberStore } from "../../src/store/member";
import type { FacadeWorldItem } from "../../src/lib/wix/facadeRecords";

/**
 * F6 (2026-10-23, owner 2026-10-22g: view-only textures on /m): the TAP PEEK — the orchestrator
 * mirrors the tapped saved-facade row + the apex pose into `useFacadesStore.peek`; the /m row shows
 * the thumb / title / pose and offers ◎ LOOK (the FPV jump at the apex) + ✕. No edit verbs.
 */
const item: FacadeWorldItem = {
  id: "f1", title: "Soborna 1", displayUrl: "https://static.wixstatic.com/media/d.jpg", thumbUrl: "https://static.wixstatic.com/media/t.jpg",
  updatedAt: "2026-10-22T10:00:00.000Z", lat: 48.4647, lon: 35.0462, apexAltM: 112.4, altitudeM: 96, headingDeg: 214, pitchDeg: 4, rollDeg: 0.5,
  focalLengthMm: 6.86, hFovDeg: 69.4, fovEstimated: false, textureWidth: 4032, textureHeight: 3024, strength: 0.9, ownLight: 0.4, rangeM: 450,
};
const peek: FacadePeekState = { id: "f1", jump: { latDeg: 48.4647, lonDeg: 35.0462, eyeM: 12, headingDeg: 214, pitchDeg: 4, fovDeg: 50 } };

describe("FacadePeek (F6)", () => {
  beforeEach(() => {
    _resetFacadesStore();
    useMemberStore.setState({ phase: "anonymous", member: null });
  });

  it("renders nothing without a peek (the island) and nothing when the row is unknown", () => {
    expect(renderToStaticMarkup(createElement(FacadePeek))).toBe("");
    expect(renderToStaticMarkup(createElement(FacadePeekView, { peek, item: null, onLook: () => {}, onClose: () => {} }))).toBe("");
  });

  it("the row: thumb, title, pose line + H-FOV, ◎ LOOK and ✕ — no EDIT / REMOVE / UNDO", () => {
    const html = renderToStaticMarkup(createElement(FacadePeekView, { peek, item, onLook: () => {}, onClose: () => {} }));
    expect(html).toContain('class="m-fpeek"');
    expect(html).toContain('data-facade-peek="f1"');
    expect(html).toContain('src="https://static.wixstatic.com/media/t.jpg"');
    expect(html).toContain("Soborna 1");
    expect(html).toContain("N 48.46470 E 35.04620 · 214.0° · 69°");
    expect(html).toContain('data-act="look"');
    expect(html).toContain('data-act="close"');
    expect(html).not.toMatch(/EDIT|REMOVE|UNDO|DROP/);
  });

  it("the store: _setPeek mirrors the id + a COPY of the jump and clears hover / menu; closePeek clears; a sign-out clears; the reset clears", () => {
    const s = useFacadesStore.getState();
    s._syncHover("f1", { x: 1, y: 2 });
    s._setPeek(peek);
    expect(useFacadesStore.getState().peek).toEqual(peek);
    expect(useFacadesStore.getState().peek).not.toBe(peek);
    expect(useFacadesStore.getState().hover).toBeNull();
    s.closePeek();
    expect(useFacadesStore.getState().peek).toBeNull();
    s._setPeek(peek);
    useMemberStore.setState({ phase: "member", member: { id: "m1", nickname: null, loginEmail: null } });
    useMemberStore.setState({ phase: "anonymous", member: null });
    expect(useFacadesStore.getState().peek).toBeNull();
    s._setPeek(peek);
    _resetFacadesStore();
    expect(useFacadesStore.getState().peek).toBeNull();
  });

  it("source fences: the shell mounts the peek above the target's row; the peek imports stores + lib only; LOOK is the FPV jump with the mirrored pose", () => {
    const root = join(__dirname, "../..");
    const shell = readFileSync(join(root, "src/components/mobile/MobileShell.tsx"), "utf8");
    expect(shell).toMatch(/<div className="m-bottom">[\s\S]{0,300}<FacadePeek \/>\s*<TargetPeek/);
    const src = readFileSync(join(root, "src/components/mobile/FacadePeek.tsx"), "utf8");
    expect(src).not.toMatch(/components\/(panels|ui)\//);
    expect(src).toMatch(/useCameraStore\.getState\(\)\.requestFpvJump\(peek\.jump\)/);
    // The orchestrator: the view-only tier PEEKS on a marker tap (the T186 apex math off the row), the editing tier opens the editor.
    const orch = readFileSync(join(root, "src/components/globe/StylizedTiles.ts"), "utf8");
    // The orbit click rung — the LAST pick with these args (`tryFacadePeekTap` picks the same way earlier in the file).
    const i = orch.lastIndexOf("const fid = facadeMarkers.pick(ndcX, ndcY, camera);");
    const rung = orch.slice(i, i + 400);
    expect(rung).toMatch(/if \(isMobileShell\) \{\s*if \(peekFacadeAt\(fid\)\) return;/);
    expect(rung.indexOf("peekFacadeAt")).toBeLessThan(rung.indexOf("openSaved(item)"));
    const j = orch.indexOf("const peekFacadeAt = (fid: string): boolean => {");
    expect(orch.slice(j, j + 900)).toMatch(/_setPeek\(\{[\s\S]*?eyeM: Math\.max\(0\.5, row\.apexAltM - groundM\)[\s\S]*?fovDeg: verticalFovDeg\(row\.hFovDeg, camera\.aspect\)/);
    // …and in FPV too (a phone walks): the tap rung tries the facade peek between the places and the FIND ghosts.
    expect(orch).toMatch(/!tryPlaceMarkerClick\(ndcX, ndcY\) && !tryFacadePeekTap\(ndcX, ndcY\) && !tryFindGhostClick\(ndcX, ndcY\)/);
    expect(orch).toMatch(/const tryFacadePeekTap = [\s\S]{0,300}if \(!isMobileShell \|\| !facadeMarkers\) return false;/);
    // The /m fullscreen map hides the peek row with the target's row and the tabs (codebot on PR #155).
    const fpvCss = readFileSync(join(root, "src/styles/mobile/fpv.css"), "utf8");
    expect(fpvCss).toMatch(/body\.m\.mw-open \.m-bottom \.m-peek,\s*body\.m\.mw-open \.m-bottom \.m-fpeek,\s*body\.m\.mw-open \.m-bottom \.m-tabs \{\s*display: none;/);
  });
});
