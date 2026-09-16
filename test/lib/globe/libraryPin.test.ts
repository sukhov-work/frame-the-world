import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE ONE LIBRARY-BUMP FENCE (audit #4 A1/A2 → T136, 2026-09-17). Nine source-verified patch
 * seams ride `3d-tiles-renderer` exactly as 0.4.28 shipped it (the grade chain, the aniso stamp,
 * the `_onTileVisibilityChange` re-wire, the terrain-patch createChild wrap, the Esri placeholder
 * fetch, overlayFetchPriority's queue + plugin init, virtualSplitGuard's expandVirtualChildren,
 * compositeCanvasRelease's `_init`, detachedRelease's drain). A caret range let any
 * lockfile-regenerating install bump inside ^0.4.x silently; the pin is EXACT now and this test
 * fails the moment either the declared or the installed version moves — bump both on purpose,
 * re-verify the nine seams (each has its own shape test), then re-pin here.
 */
const root = join(__dirname, "..", "..", "..");
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8")) as Record<string, unknown>;

const PINNED = "0.4.28";

describe("3d-tiles-renderer is pinned EXACTLY (no caret, no tilde) and the install matches", () => {
  it("package.json declares the exact version", () => {
    const deps = read("package.json").dependencies as Record<string, string>;
    expect(deps["3d-tiles-renderer"]).toBe(PINNED);
  });

  it("the installed package is that version (the lockfile and node_modules agree with the pin)", () => {
    expect(read("node_modules/3d-tiles-renderer/package.json").version).toBe(PINNED);
    const lock = read("package-lock.json") as { packages?: Record<string, { version?: string }> };
    expect(lock.packages?.["node_modules/3d-tiles-renderer"]?.version).toBe(PINNED);
  });

  it("libraw-wasm keeps its exact pin too (the same class: a WASM ABI the worker was verified against)", () => {
    const deps = read("package.json").dependencies as Record<string, string>;
    expect(deps["libraw-wasm"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
