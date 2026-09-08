import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SceneActions, { SAVE_COPY } from "../../src/components/mobile/SceneActions";
import { useCameraStore } from "../../src/store/camera";
import { useMemberStore } from "../../src/store/member";

/**
 * ◎ SAVE on /m (owner 2026-09-08b): the old full-width ◎ SIGN IN TO SAVE pill is a 44 px ICON
 * cell in the altitude nudges' geometry; signed out it is DIMMED (`aria-disabled`) and a tap
 * shows a one-line hint through the column note instead of bouncing to the hosted login.
 * Rendering is `renderToStaticMarkup` with the live store mirrored onto zustand's server snapshot
 * (this repo's vitest has no DOM).
 */

const CAM_BOOT = { ...useCameraStore.getState() };
const MEM_BOOT = { ...useMemberStore.getState() };
const SRC = readFileSync(join(process.cwd(), "src/components/mobile/SceneActions.tsx"), "utf8");
const CSS = readFileSync(join(process.cwd(), "src/styles/mobile/chrome.css"), "utf8");

const marker = { visible: false, xNorm: 0, yNorm: 0, altDeg: 0, azDeg: 0, inFrame: false } as never;
const enterFpv = () => {
  useCameraStore.getState()._syncFpvHud({
    headingDeg: 90,
    pitchDeg: 0,
    fovDeg: 40,
    aspect: 0.5,
    eyeAboveGroundM: 1.7,
    sun: marker,
    moon: marker,
  } as never);
  useCameraStore.getState()._syncCamGeo({ latDeg: 48.46, lonDeg: 35.04, groundAltM: 100 });
};
const render = () => {
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  Object.assign(useMemberStore.getInitialState(), useMemberStore.getState());
  return renderToStaticMarkup(createElement(SceneActions as never));
};

beforeEach(() => {
  useCameraStore.setState(CAM_BOOT, true);
  useMemberStore.setState(MEM_BOOT, true);
});

describe("◎ SAVE — the icon cell (owner 2026-09-08b)", () => {
  it("signed out: a dimmed 44 px cell that still takes the tap, and no login redirect", () => {
    enterFpv();
    useMemberStore.setState({ phase: "anonymous" });
    const html = render();
    expect(html).toMatch(/class="m-act m-act--icon" aria-disabled="true"/);
    expect(html).toContain("◎");
    expect(html).not.toContain("SIGN IN TO SAVE");
    expect(html).not.toContain("SAVE VIEW");
    // the tap goes to the hint channel, never to the hosted login
    expect(SRC).not.toMatch(/loginUrl|returnHereUrl/);
    expect(SRC).toMatch(/onClick=\{\(\) => onHint\(SAVE_COPY\.signIn\)\}/);
    expect(SAVE_COPY.signIn).toMatch(/SIGN IN/);
    // `aria-disabled`, never the attribute — `disabled` swallows the tap and the hint with it
    const anon = SRC.slice(SRC.indexOf('if (phase !== "member") {'), SRC.indexOf("const save = async"));
    expect(anon).not.toMatch(/(?<!aria-)disabled=/);
  });

  it("member: the same cell with the glyph states, and the ⏱ mark when the scene time is pinned", () => {
    enterFpv();
    useMemberStore.setState({ phase: "member" });
    const html = render();
    expect(html).toMatch(/class="m-act m-act--icon"/);
    expect(html).toContain("◎");
    expect(html).not.toMatch(/aria-disabled/);
    const member = SRC.slice(SRC.indexOf("const save = async"));
    expect(member).toMatch(/mode === "saved" \? "✓" : mode === "error" \? "↻" : mode === "busy" \? "◌" : "◎"/);
    expect(member).toMatch(/`SAVE\$\{live \? "" : "⏱"\}`/);
  });

  it("out of FPV the cell is absent — a view is what gets saved", () => {
    useMemberStore.setState({ phase: "member" });
    expect(render()).not.toContain("m-act--icon");
  });

  it("the cell is the altitude nudges' geometry (44 px round) and the dimmed state is styled", () => {
    const icon = CSS.slice(CSS.indexOf(".m-act--icon {"), CSS.indexOf(".m-act__glyph"));
    expect(icon).toMatch(/width: 44px;/);
    expect(icon).toMatch(/height: 44px;/);
    expect(icon).toMatch(/border-radius: 50%;/);
    expect(CSS).toMatch(/\.m-act\[aria-disabled="true"\] \{\s*opacity: 0\.45;/);
    const fpv = readFileSync(join(process.cwd(), "src/styles/mobile/fpv.css"), "utf8");
    const alt = fpv.slice(fpv.indexOf(".m-alt {"), fpv.indexOf(".m-alt:active"));
    expect(alt).toMatch(/width: 44px;/); // the size the owner named
  });
});
