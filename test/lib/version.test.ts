/**
 * The app version stamp (owner order 2026-09-08): one number, one writer, shown bottom-right on
 * both shells, bumped by every ship. These pin the contract, not the current value.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION, versionLabel } from "../../src/lib/version";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("app version", () => {
  it("is package.json's version, major 1, a plain semver", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^1\.\d+\.\d+$/);
    // package-lock.json carries the same number (npm version bumps both; a hand edit of one
    // would drift them and `npm ci` would complain later).
    const lock = JSON.parse(read("package-lock.json")) as { version: string };
    expect(lock.version).toBe(pkg.version);
  });

  it("labels a release `vX.Y.Z` and a dev page `vX.Y.Z-dev`", () => {
    expect(versionLabel(false)).toBe(`v${APP_VERSION}`);
    expect(versionLabel(true)).toBe(`v${APP_VERSION}-dev`);
  });

  it("is rendered by both shells from the one module", () => {
    const index = read("src/pages/index.astro");
    expect(index).toMatch(/import \{ versionLabel \} from "\.\.\/lib\/version"/);
    // Inside the attribution anchor, after the last source — so it rides the credit line through
    // both states (closed chip / map-open bar) and stays the same small font.
    expect(index).toMatch(/Natural Earth · <span class="map-version">\{versionLabel\(\)\}<\/span><\/a>/);
    const shell = read("src/components/mobile/MobileShell.tsx");
    expect(shell).toMatch(/import VersionStamp from "\.\.\/controls\/VersionStamp"/);
    // Inside the bottom column, after the tab bar (the corner under the SPOT tab).
    const bottom = /<div className="m-bottom">([\s\S]*?)<\/div>/.exec(shell);
    expect(bottom).not.toBeNull();
    expect(bottom![1]).toMatch(/<TabBar[\s\S]*<VersionStamp \/>/);
    const stamp = read("src/components/controls/VersionStamp.tsx");
    expect(stamp).toMatch(/from "\.\.\/\.\.\/lib\/version"/);
    // Inert on both: no pointer events, tiny type.
    const css = read("src/styles/version-stamp.css");
    expect(css).toMatch(/\.version-stamp\s*{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/font-size:\s*0\.4\d*rem/);
    const chrome = read("src/styles/mobile/chrome.css");
    expect(chrome).toMatch(/\.m-bottom \.version-stamp\s*{[^}]*position:\s*absolute[^}]*right:\s*calc\([^)]*safe-area-inset-right/);
  });

  it("is bumped by every ship — after the gates and the dry-run exit, before `git add -A`", () => {
    const hook = read(".claude/hooks/session-end-ship.sh");
    const bump = hook.indexOf("npm version patch --no-git-tag-version");
    expect(bump).toBeGreaterThan(0);
    expect(bump).toBeGreaterThan(hook.indexOf('log "gates green"'));
    expect(bump).toBeGreaterThan(hook.indexOf('log "DRY_RUN: would ship'));
    expect(bump).toBeLessThan(hook.indexOf("\ngit add -A"));
  });
});
