import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * U1 pinch hardening (UPLIFT_PLAN §2/U1, owner point 5): "pinch must never zoom the browser
 * page". The engine never preventDefaults touch, so the viewport meta + CSS `touch-action`
 * are the ONLY lines of defence — and they are plain declarations a refactor can silently
 * drop. This test pins the audited leak list (UPLIFT_PLAN §1.2) file-by-file, the same
 * file-content guard style as the guide image cross-check.
 */

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("U1 pinch hardening — viewport meta (/m only)", () => {
  it("MobileLayout pins the viewport scale and guards iOS gestures", () => {
    const layout = read("src/layouts/MobileLayout.astro");
    expect(layout).toMatch(/maximum-scale=1/);
    expect(layout).toMatch(/user-scalable=no/);
    // iOS ≥10 ignores user-scalable — the proprietary gesturestart guard carries Safari.
    expect(layout).toMatch(/gesturestart/);
  });

  it("desktop + guide layouts stay browser-zoomable (accessibility)", () => {
    expect(read("src/layouts/Layout.astro")).not.toMatch(/maximum-scale/);
    expect(read("src/pages/guide.astro")).not.toMatch(/maximum-scale/);
  });
});

describe("U1 pinch hardening — the audited touch-action leak list", () => {
  // selector → the file that must carry its touch-action declaration
  const mustDeclare: Array<[file: string, selector: string, action: "none" | "pan-y"]> = [
    ["src/styles/global.css", ".globe-canvas", "none"], // desktop canvas (touch laptops)
    ["src/styles/mobile/mobile.css", ".globe-canvas", "none"], // /m canvas
    ["src/styles/mobile/chrome.css", ".m-bottom", "none"], // tab bar + dock wrap
    ["src/styles/mobile/chrome.css", ".m-actions", "none"], // scene action chips
    ["src/styles/mobile/chrome.css", ".m-scrim", "none"], // sheet dismiss scrim
    ["src/styles/mobile/chrome.css", ".m-sheet__body", "pan-y"], // sheets scroll, never zoom
    ["src/styles/mini-map.css", ".mm", "none"], // FPV mini-map patch
    ["src/styles/sky-menu.css", ".skymenu", "none"], // sky context menu
    ["src/styles/mobile/mobile.css", ".m-status a,", "none"], // status-strip chips
  ];

  for (const [file, selector, action] of mustDeclare) {
    it(`${file} → ${selector} declares touch-action: ${action}`, () => {
      const css = read(file);
      const start = css.indexOf(selector);
      expect(start, `selector ${selector} missing from ${file}`).toBeGreaterThanOrEqual(0);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, `${selector} in ${file} lost its touch-action`).toMatch(
        new RegExp(`touch-action:\\s*${action}`),
      );
    });
  }
});
