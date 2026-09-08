import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TabBar from "../../src/components/mobile/TabBar";
import { tabLive, tabLongPress, type TabLiveSnapshot } from "../../src/components/mobile/tabLive";

/**
 * LIVE tabs + the long press (owner 2026-09-08b): FIND and SPOT glow while their feature is
 * WORKING (a frame scan running in FPV, a heatmap armed), and a long press toggles the feature
 * without opening the sheet — or opens the sheet when a precondition is missing.
 */

const base: TabLiveSnapshot = {
  find: { open: true, anyBody: true },
  spot: { open: true, heatmapOn: true, hasCentre: true },
  fpv: true,
};

describe("tabLive — what 'working' means", () => {
  it("FIND is live only while the scan RUNS: open + a body chip + a live FPV pose", () => {
    expect(tabLive(base).find).toBe(true);
    expect(tabLive({ ...base, fpv: false }).find).toBe(false); // out of FPV nothing scans
    expect(tabLive({ ...base, find: { open: true, anyBody: false } }).find).toBe(false);
    expect(tabLive({ ...base, find: { open: false, anyBody: true } }).find).toBe(false);
  });

  it("SPOT is live on the engine's own armed term — open AND heatmapOn, never open alone", () => {
    expect(tabLive(base).spot).toBe(true);
    // `open` is sticky on /m after the first visit — it must not glow forever
    expect(tabLive({ ...base, spot: { open: true, heatmapOn: false, hasCentre: true } }).spot).toBe(false);
    expect(tabLive({ ...base, spot: { open: false, heatmapOn: true, hasCentre: true } }).spot).toBe(false);
    // a centre is not part of "armed" (ARMED — NO CENTRE is a legitimate state, and it glows)
    expect(tabLive({ ...base, spot: { open: true, heatmapOn: true, hasCentre: false } }).spot).toBe(true);
    // the term is the engine's, verbatim
    const orch = readFileSync(join(process.cwd(), "src/components/globe/StylizedTiles.ts"), "utf8");
    expect(orch).toMatch(/bestSpotAllowed && bs\.open && bs\.heatmapOn/);
  });
});

describe("tabLongPress — toggle without the sheet, or open the sheet that explains", () => {
  it("FIND live → off, collapsing the sheet only when it is the one showing", () => {
    expect(tabLongPress("find", base, null)).toEqual({ kind: "find-off", collapse: false });
    expect(tabLongPress("find", base, "find")).toEqual({ kind: "find-off", collapse: true });
    expect(tabLongPress("find", base, "spot")).toEqual({ kind: "find-off", collapse: false });
  });

  it("FIND off → on when the scan would run; otherwise the sheet says what is missing", () => {
    expect(tabLongPress("find", { ...base, find: { open: false, anyBody: true } }, null)).toEqual({ kind: "find-on" });
    expect(tabLongPress("find", { ...base, find: { open: false, anyBody: true }, fpv: false }, null)).toEqual({
      kind: "open-sheet",
      tab: "find",
    });
    expect(tabLongPress("find", { ...base, find: { open: true, anyBody: false } }, null)).toEqual({
      kind: "open-sheet",
      tab: "find",
    });
  });

  it("SPOT armed → disarm; disarmed → arm when a centre exists, else the sheet with ◎ CENTRE HERE", () => {
    expect(tabLongPress("spot", base, null)).toEqual({ kind: "spot-off" });
    expect(tabLongPress("spot", { ...base, spot: { open: true, heatmapOn: false, hasCentre: true } }, null)).toEqual({
      kind: "spot-on",
    });
    expect(tabLongPress("spot", { ...base, spot: { open: false, heatmapOn: false, hasCentre: true } }, null)).toEqual({
      kind: "spot-on",
    });
    expect(tabLongPress("spot", { ...base, spot: { open: false, heatmapOn: false, hasCentre: false } }, null)).toEqual({
      kind: "open-sheet",
      tab: "spot",
    });
  });

  it("the other tabs have no long press", () => {
    expect(tabLongPress("scene", base, null)).toEqual({ kind: "none" });
    expect(tabLongPress("plan", base, null)).toEqual({ kind: "none" });
    expect(tabLongPress("search", base, null)).toEqual({ kind: "none" });
  });
});

describe("TabBar — the live class, the hold affordance, the swallowed click", () => {
  const SRC = readFileSync(join(process.cwd(), "src/components/mobile/TabBar.tsx"), "utf8");
  const SHELL = readFileSync(join(process.cwd(), "src/components/mobile/MobileShell.tsx"), "utf8");
  const CSS = readFileSync(join(process.cwd(), "src/styles/mobile/chrome.css"), "utf8");

  it("renders `.m-tab--live` on a working tab whether or not it is selected, and says hold-to-switch", () => {
    const html = renderToStaticMarkup(
      createElement(TabBar, { active: "scene", onSelect: () => {}, live: { spot: true }, onLongPress: () => {} }),
    );
    expect(html).toMatch(/class="m-tab m-tab--live" aria-pressed="false" aria-label="SPOT — working; hold to switch off"/);
    expect(html).toMatch(/class="m-tab" aria-pressed="false" aria-label="FIND — hold to switch on"/);
    // the label text still sits right after the glyph span (the sheet test's regex)
    expect(html).toMatch(/<\/span>SPOT<\/button>/);
    const both = renderToStaticMarkup(
      createElement(TabBar, { active: "spot", onSelect: () => {}, live: { spot: true }, onLongPress: () => {} }),
    );
    expect(both).toMatch(/class="m-tab m-tab--live m-tab--on" aria-pressed="true"/);
    // without the props nothing changes for the plain tab bar
    const plain = renderToStaticMarkup(createElement(TabBar, { active: "spot", onSelect: () => {} }));
    expect(plain).toMatch(/class="m-tab m-tab--on" aria-pressed="true"/);
    expect(plain).not.toContain("aria-label=\"SPOT");
  });

  it("the gesture is the ORCH long-press shape: touch only, ORCH.longPressMs, clickDragPx move-cancel, the trailing click swallowed", () => {
    expect(SRC).toMatch(/e\.pointerType !== "touch"\) return;/);
    expect(SRC).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]*?onLongPress\(tab\);[\s\S]*?\}, ORCH\.longPressMs\)/);
    expect(SRC).toMatch(/Math\.hypot\(dx, dy\) > ORCH\.clickDragPx\) cancelPress\(\)/);
    expect(SRC).toMatch(/if \(pressFired\.current\) \{\s*pressFired\.current = false;\s*return;\s*\}/);
    expect(SRC).toMatch(/onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/); // Android's long-press menu
    expect(CSS).toMatch(/\.m-tab \{[^}]*-webkit-touch-callout: none;/); // iOS's
  });

  it("the shell arms SPOT in the safe order (open BEFORE heatmapOn) and stands FIND down fully", () => {
    const spotOn = SHELL.slice(SHELL.indexOf('case "spot-on"'), SHELL.indexOf('case "open-sheet"'));
    expect(spotOn.indexOf("setOpen(true)")).toBeLessThan(spotOn.indexOf("setHeatmapOn(true)"));
    const findOff = SHELL.slice(SHELL.indexOf('case "find-off"'), SHELL.indexOf('case "find-on"'));
    expect(findOff).toMatch(/setOpen\(false\)/);
    expect(findOff).toMatch(/publishGhosts\(null, \[\]\)/);
    expect(findOff).toMatch(/if \(a\.collapse\) setSheet\(null\)/);
    // spot-off never closes the store window (the sheet is a TAB — collapsing is not disarming)
    const spotOff = SHELL.slice(SHELL.indexOf('case "spot-off"'), SHELL.indexOf('case "spot-on"'));
    expect(spotOff).not.toMatch(/setOpen\(false\)/);
    expect(SHELL).toMatch(/<TabBar active=\{activeTab\} onSelect=\{onTab\} live=\{live\} onLongPress=\{onTabLongPress\} \/>/);
  });

  it("the live dot is a pseudo-element (no markup between glyph and label)", () => {
    expect(CSS).toMatch(/\.m-tab--live \.m-tab__glyph::after \{[^}]*border-radius: 50%;/);
  });
});
