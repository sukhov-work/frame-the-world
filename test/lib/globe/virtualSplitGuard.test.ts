import { describe, expect, it } from "vitest";
import {
  installVirtualSplitGuard,
  sceneTriangles,
  splitVerdict,
  virtualLineage,
} from "../../../src/lib/globe/virtualSplitGuard";

/**
 * 2026-09-10b — the fence around ImageOverlayPlugin.expandVirtualChildren. The runaway it
 * exists for: virtual splits whose cost DOUBLED per level (0.7 → 95 s rAF gaps on the Everest
 * zoom pose) because a child carried more triangles than its parent. Pure verdicts + the
 * install on a fake plugin/scene.
 */

const OPTS = { maxDepth: 6, maxMs: 80, growthMinTri: 512 };

const scene = (tris: number, indexed = true) => ({
  traverse(cb: (c: any) => void) {
    cb({
      isMesh: true,
      geometry: indexed ? { index: { count: tris * 3 }, attributes: {} } : { index: null, attributes: { position: { count: tris * 3 } } },
    });
  },
});

describe("sceneTriangles", () => {
  it("counts indexed and non-indexed meshes, ignoring non-meshes", () => {
    expect(sceneTriangles(scene(100))).toBe(100);
    expect(sceneTriangles(scene(7, false))).toBe(7);
    expect(sceneTriangles({ traverse: (cb) => cb({ isMesh: false }) })).toBe(0);
  });
});

describe("virtualLineage", () => {
  it("a real tile is depth 0 with no parent count", () => {
    expect(virtualLineage({ parent: null, internal: {} })).toEqual({ depth: 0, slowAncestor: false, parentTri: null });
  });

  it("counts the virtual levels below the nearest real tile and reads the parent's stored count", () => {
    const real = { parent: null, internal: {}, __ftwSplitTri: 2500 };
    const v1 = { parent: real, internal: { isVirtual: true }, __ftwSplitTri: 700 };
    const v2 = { parent: v1, internal: { isVirtual: true } };
    expect(virtualLineage(v1)).toEqual({ depth: 1, slowAncestor: false, parentTri: 2500 });
    expect(virtualLineage(v2)).toEqual({ depth: 2, slowAncestor: false, parentTri: 700 });
  });

  it("a slow ancestor anywhere up the virtual chain is seen", () => {
    const real = { parent: null, internal: {}, __ftwSplitSlow: true };
    const v1 = { parent: real, internal: { isVirtual: true } };
    const v2 = { parent: v1, internal: { isVirtual: true } };
    expect(virtualLineage(v2).slowAncestor).toBe(true);
  });
});

describe("splitVerdict", () => {
  it("a healthy subdivision splits (child a quarter of the parent)", () => {
    expect(splitVerdict({ depth: 1, slowAncestor: false, parentTri: 2564 }, 620, OPTS)).toBeNull();
  });

  it("GROWTH: a child with more triangles than its parent is refused — above the floor only", () => {
    expect(splitVerdict({ depth: 1, slowAncestor: false, parentTri: 2564 }, 5000, OPTS)).toBe("growth");
    // a cut adds a few triangles along its edge: tiny tiles legitimately grow and still split
    expect(splitVerdict({ depth: 4, slowAncestor: false, parentTri: 31, }, 40, OPTS)).toBeNull();
    expect(splitVerdict({ depth: 4, slowAncestor: false, parentTri: 400 }, 512, OPTS)).toBeNull();
    expect(splitVerdict({ depth: 4, slowAncestor: false, parentTri: 400 }, 513, OPTS)).toBe("growth");
  });

  it("DEPTH: past maxDepth nothing splits", () => {
    expect(splitVerdict({ depth: 7, slowAncestor: false, parentTri: 100 }, 20, OPTS)).toBe("depth");
    expect(splitVerdict({ depth: 6, slowAncestor: false, parentTri: 100 }, 20, OPTS)).toBeNull();
  });

  it("TIME: a slow ancestor caps its whole subtree, before any other fence", () => {
    expect(splitVerdict({ depth: 1, slowAncestor: true, parentTri: 2564 }, 100, OPTS)).toBe("time");
  });
});

describe("installVirtualSplitGuard", () => {
  it("wraps the plugin, stores each tile's count, refuses growth and flags slow splits", () => {
    let calls = 0;
    let slowNext = false;
    const plugin = {
      expandVirtualChildren(_scene: unknown, _tile: unknown) {
        calls++;
        if (slowNext) {
          const t0 = performance.now();
          while (performance.now() - t0 < 2) {
            /* spin ~2 ms */
          }
        }
        return "split";
      },
    };
    const h = installVirtualSplitGuard(plugin, { maxDepth: 6, maxMs: 1, growthMinTri: 512 });
    expect(h.installed).toBe(true);
    const real: any = { parent: null, internal: {} };
    expect(plugin.expandVirtualChildren(scene(2500), real)).toBe("split");
    expect(real.__ftwSplitTri).toBe(2500);
    // an exploded child → refused, never reaches the library
    const bad: any = { parent: real, internal: { isVirtual: true } };
    expect(plugin.expandVirtualChildren(scene(6000), bad)).toBeUndefined();
    expect(h.stats.growthCapped).toBe(1);
    expect(calls).toBe(1);
    // a slow split flags its tile; its children are then refused by TIME
    slowNext = true;
    const good: any = { parent: real, internal: { isVirtual: true } };
    plugin.expandVirtualChildren(scene(600), good);
    expect(good.__ftwSplitSlow).toBe(true);
    expect(h.stats.worstMs).toBeGreaterThan(1);
    slowNext = false;
    const under: any = { parent: good, internal: { isVirtual: true } };
    expect(plugin.expandVirtualChildren(scene(150), under)).toBeUndefined();
    expect(h.stats.timeCapped).toBe(1);
    expect(h.stats.calls).toBe(4);
  });

  it("installs nothing on a plugin without the method and dispose() restores", () => {
    expect(installVirtualSplitGuard({}, OPTS).installed).toBe(false);
    const f = () => "x";
    const plugin = { expandVirtualChildren: f };
    const h = installVirtualSplitGuard(plugin, OPTS);
    expect(plugin.expandVirtualChildren).not.toBe(f);
    h.dispose();
    expect(plugin.expandVirtualChildren).toBe(f);
  });
});
