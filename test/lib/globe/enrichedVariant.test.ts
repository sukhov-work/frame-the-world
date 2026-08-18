import { describe, it, expect } from "vitest";
import { resolveEnrichedSelection } from "../../../src/lib/globe/enrichedVariant";

// Best-variant-by-default selection (owner rule 2026-08-18): with NO ?enriched= param the BOOT
// REGION's best bake streams (regions.ts variants[0]); the param survives as the DEV seam only.
// Load-bearing invariant: URL and mask bbox come from ONE resolver call and can never disagree.

const ENV = "https://frame-the-world.example.workers.dev/enriched/dnipro/tileset.json";
const DNIPRO_BBOX = { west: 34.915, south: 48.37, east: 35.185, north: 48.55 };
const ST_ALBANS_BBOX = { west: -0.3692, south: 51.7244, east: -0.2821, north: 51.7787 };

describe("resolveEnrichedSelection — defaults", () => {
  it("no param → the env-anchored region's BEST variant (dnipro-o2w), bbox follows", () => {
    const sel = resolveEnrichedSelection(ENV, "");
    expect(sel.url).toBe("https://frame-the-world.example.workers.dev/enriched/dnipro-o2w/tileset.json");
    expect(sel.variant).toBe("dnipro-o2w");
    expect(sel.regionId).toBe("dnipro");
    expect(sel.bbox).toEqual(DNIPRO_BBOX);
  });

  it("no env URL → nothing streams (byte-identical pre-enrichment app)", () => {
    const sel = resolveEnrichedSelection(undefined, "");
    expect(sel.url).toBeUndefined();
    expect(sel.bbox).toBeNull();
    expect(resolveEnrichedSelection("", "").url).toBeUndefined(); // empty env behaves as unset
  });

  it("a boot point inside ANOTHER baked region wins the default (a #p share into St Albans)", () => {
    const sel = resolveEnrichedSelection(ENV, "", 51.75, -0.33);
    expect(sel.url).toBe("https://frame-the-world.example.workers.dev/enriched/st-albans-o2w/tileset.json");
    expect(sel.variant).toBe("st-albans-o2w");
    expect(sel.regionId).toBe("st-albans");
    expect(sel.bbox).toEqual(ST_ALBANS_BBOX);
  });

  it("a boot point inside NO baked region falls back to the env anchor", () => {
    const sel = resolveEnrichedSelection(ENV, "", 50.45, 30.52); // Kyiv — no bake
    expect(sel.regionId).toBe("dnipro");
    expect(sel.variant).toBe("dnipro-o2w");
  });

  it("other params / empty value do not disturb the default", () => {
    expect(resolveEnrichedSelection(ENV, "?foo=bar").variant).toBe("dnipro-o2w");
    expect(resolveEnrichedSelection(ENV, "?enriched=").variant).toBe("dnipro-o2w");
  });
});

describe("resolveEnrichedSelection — the ?enriched= dev seam", () => {
  it("off/none/0 → no tileset AND no mask", () => {
    for (const v of ["off", "NONE", "0"]) {
      const sel = resolveEnrichedSelection(ENV, `?enriched=${v}`);
      expect(sel.url).toBeUndefined();
      expect(sel.bbox).toBeNull();
      expect(sel.regionId).toBeNull();
    }
  });

  it("explicit variant name → that bake verbatim, bbox follows the OWNING region", () => {
    const classic = resolveEnrichedSelection(ENV, "?enriched=dnipro");
    expect(classic.url).toBe(ENV); // the classic extruder bake stays reachable
    expect(classic.bbox).toEqual(DNIPRO_BBOX);
    const cross = resolveEnrichedSelection(ENV, "?enriched=st-albans-o2w");
    expect(cross.url).toBe(
      "https://frame-the-world.example.workers.dev/enriched/st-albans-o2w/tileset.json",
    );
    expect(cross.bbox).toEqual(ST_ALBANS_BBOX);
    expect(cross.regionId).toBe("st-albans");
  });

  it("unknown variant name → URL swap still happens, bbox falls back to the default region", () => {
    const sel = resolveEnrichedSelection(ENV, "?enriched=nowhere-x");
    expect(sel.url).toBe("https://frame-the-world.example.workers.dev/enriched/nowhere-x/tileset.json");
    expect(sel.bbox).toEqual(DNIPRO_BBOX);
  });

  it("variant name with no env URL → same-origin public dir (local pre-upload A/B)", () => {
    expect(resolveEnrichedSelection(undefined, "?enriched=dnipro-o2w").url).toBe(
      "/enriched/dnipro-o2w/tileset.json",
    );
  });

  it("value containing '/' → used verbatim", () => {
    expect(resolveEnrichedSelection(ENV, "?enriched=/enriched/sample/x/tileset.json").url).toBe(
      "/enriched/sample/x/tileset.json",
    );
    expect(resolveEnrichedSelection(undefined, "?enriched=https://x.test/t/tileset.json").url).toBe(
      "https://x.test/t/tileset.json",
    );
  });
});
