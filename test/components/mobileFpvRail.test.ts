import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SceneActions from "../../src/components/mobile/SceneActions";
import { GATES, MOBILE2D } from "../../src/components/globe/tuning";
import { useCameraStore } from "../../src/store/camera";
import { useMemberStore } from "../../src/store/member";
import { read, ruleBody, stripComments } from "../styles/_css";

/**
 * The /m FPV right rail + the whole-planet boot (owner bug report + ruling, 2026-09-18).
 *
 * The rail under the altitude column (AR · ⤒ · ⤓) reads, top → bottom: ◎ SAVE · ▤ PLACES
 * (members) · ✕ EXIT VIEW. Before this fix the member's SAVED PLACES was a TEXT PILL rendered
 * BELOW EXIT VIEW, which made the signed-in stack one pill taller than the altitude column's
 * fixed seat allowed — ⤓ sat on top of ◎ SAVE. Now PLACES is a 44 px icon cell between SAVE and
 * EXIT VIEW, EXIT VIEW is always the LAST cell, and fpv.css lifts the column's seat by one cell
 * + gap while the third cell is rendered (`body.m:has(.m-actions .m-act--places)`).
 *
 * Rendering is `renderToStaticMarkup` with the live store mirrored onto zustand's server
 * snapshot (this repo's vitest has no DOM) — the mobileSaveChip idiom.
 */

const CAM_BOOT = { ...useCameraStore.getState() };
const MEM_BOOT = { ...useMemberStore.getState() };
const SRC = stripComments(read("src/components/mobile/SceneActions.tsx"));
const FPV_CSS = read("src/styles/mobile/fpv.css");

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
  // The temp FPV is the pin's view — the setter refuses to arm without a pin (store/camera).
  useCameraStore.getState().setTempPin({ latDeg: 48.46, lonDeg: 35.04 });
  useCameraStore.getState().setTempFpv(true);
};
const render = () => {
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  Object.assign(useMemberStore.getInitialState(), useMemberStore.getState());
  return renderToStaticMarkup(createElement(SceneActions as never, { onOpenPlaces: () => {} } as never));
};
/** The rail's buttons in DOM order: `{ cls, text }` per `<button …>…</button>`. */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    cls: /class="([^"]*)"/.exec(m[1])?.[1] ?? "",
    text: m[2].replace(/<[^>]+>/g, "").replace(/<!--.*?-->/g, "").trim(),
  }));

beforeEach(() => {
  useCameraStore.setState(CAM_BOOT, true);
  useMemberStore.setState(MEM_BOOT, true);
});

describe("the /m FPV rail (owner 2026-09-18)", () => {
  it("member in FPV: ◎ SAVE · ▤ PLACES (icon cell) · ✕ EXIT VIEW, in that order, EXIT VIEW last", () => {
    useMemberStore.setState({ phase: "member" });
    enterFpv();
    const b = buttons(render());
    expect(b.map((x) => x.text)).toEqual(["◎SAVE", "▤PLACES", "✕ EXIT VIEW"]);
    expect(b[0].cls).toBe("m-act m-act--icon");
    expect(b[1].cls).toBe("m-act m-act--icon m-act--places");
    expect(b[2].cls).toBe("m-act");
    // The old text pill never appears inside FPV.
    expect(b.some((x) => /SAVED PLACES/.test(x.text))).toBe(false);
  });

  it("signed out in FPV: the 2026-09-08b two-cell stack, byte for byte (no PLACES cell)", () => {
    useMemberStore.setState({ phase: "anonymous" });
    enterFpv();
    const b = buttons(render());
    expect(b.map((x) => x.text)).toEqual(["◎SAVE", "✕ EXIT VIEW"]);
    expect(render()).not.toContain("m-act--places");
  });

  it("member outside FPV: the ▤ SAVED PLACES pill above MY LOC stays, and no icon cell renders", () => {
    useMemberStore.setState({ phase: "member" });
    const html = render();
    const b = buttons(html);
    expect(b.some((x) => x.text === "▤ SAVED PLACES" && x.cls === "m-act")).toBe(true);
    expect(html).not.toContain("m-act--icon");
    expect(html).not.toContain("m-act--places");
    // …and the pill's gate names FPV explicitly — the two openers never coexist.
    expect(SRC).toMatch(/\{!tempFpv && memberPhase === "member" && onOpenPlaces && \(/);
  });

  it("the altitude column's seat lifts by one cell + gap while the PLACES cell is rendered (fpv.css)", () => {
    const root = ruleBody(FPV_CSS, ":root");
    expect(root).toMatch(/--m-altcol-bottom-base:\s*15\.2rem;/); // 16.4rem until the 2026-09-25 tab row (−1.2rem)
    expect(root).toMatch(/--m-altcol-bottom:\s*var\(--m-altcol-bottom-base\);/);
    const lifted = ruleBody(FPV_CSS, "body.m:has(.m-actions .m-act--places)");
    expect(lifted).toMatch(/--m-altcol-bottom:\s*calc\(var\(--m-altcol-bottom-base\) \+ 52px\);/);
    // 52 px = the 44 px icon cell (chrome.css .m-act--icon) + the 8 px column gap (.m-actions).
    const chrome = read("src/styles/mobile/chrome.css");
    expect(ruleBody(chrome, ".m-act--icon")).toMatch(/height: 44px;/);
    expect(ruleBody(chrome, ".m-actions")).toMatch(/gap: 8px;/);
    // The column keeps reading the token (the A1-2 contract the map window shares).
    expect(ruleBody(FPV_CSS, ".m-altcol")).toMatch(/bottom:\s*calc\(var\(--m-altcol-bottom\)/);
  });
});

describe("the /m whole-planet boot (owner ruling 2026-09-18)", () => {
  it("the bare /m boot altitude is 18,000 km — above the imagery gate, inside the pose grammar's cap", () => {
    expect(MOBILE2D.bootAltM).toBe(18_000_000);
    expect(MOBILE2D.bootAltM).toBeGreaterThan(GATES.groundActiveAlt); // nothing streams until a pinch in
    expect(MOBILE2D.bootAltM).toBeLessThanOrEqual(50_000_000); // urlPose ALT_MAX_M — a mirrored hash stays exact
    // The orchestrator's bare-boot branch reads the tunable, never a literal.
    const tiles = stripComments(read("src/components/globe/StylizedTiles.ts"));
    expect(tiles).toMatch(/geodeticToEcef\(MOBILE2D\.bootLatDeg, MOBILE2D\.bootLonDeg, MOBILE2D\.bootAltM\)/);
  });
});
