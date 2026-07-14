import { describe, it, expect } from "vitest";
import {
  resolveEnrichedUrl,
  isVariantActive,
  toggleVariantUrl,
  ENRICHED_VARIANT_NAME,
} from "../../../src/lib/globe/enrichedVariant";

// The ?enriched= A/B compare seam between parallel Dnipro bakes (default extruder vs OSM2World).
// Load-bearing invariant: with NO param the resolver returns the env URL untouched — the default
// pipeline must stay byte-identical.

const ENV = "https://frame-the-world.example.workers.dev/enriched/dnipro/tileset.json";

describe("resolveEnrichedUrl", () => {
  it("no param → the env URL exactly (byte-identical default)", () => {
    expect(resolveEnrichedUrl(ENV, "")).toBe(ENV);
    expect(resolveEnrichedUrl(ENV, "?foo=bar")).toBe(ENV);
    expect(resolveEnrichedUrl(undefined, "")).toBeUndefined();
    expect(resolveEnrichedUrl("", "")).toBeUndefined(); // empty env behaves as unset
  });

  it("off/none/0 → undefined (drops the tileset AND the OSM mask)", () => {
    expect(resolveEnrichedUrl(ENV, "?enriched=off")).toBeUndefined();
    expect(resolveEnrichedUrl(ENV, "?enriched=NONE")).toBeUndefined();
    expect(resolveEnrichedUrl(ENV, "?enriched=0")).toBeUndefined();
  });

  it("variant name → swaps the second-to-last path segment", () => {
    expect(resolveEnrichedUrl(ENV, "?enriched=dnipro-o2w")).toBe(
      "https://frame-the-world.example.workers.dev/enriched/dnipro-o2w/tileset.json",
    );
    expect(resolveEnrichedUrl("/enriched/dnipro/tileset.json", "?enriched=dnipro-o2w")).toBe(
      "/enriched/dnipro-o2w/tileset.json",
    );
  });

  it("variant name with no env URL → same-origin public dir (local pre-upload A/B)", () => {
    expect(resolveEnrichedUrl(undefined, "?enriched=dnipro-o2w")).toBe("/enriched/dnipro-o2w/tileset.json");
  });

  it("value containing '/' → used verbatim", () => {
    expect(resolveEnrichedUrl(ENV, "?enriched=/enriched-sample/dnipro-o2w/tileset.json")).toBe(
      "/enriched-sample/dnipro-o2w/tileset.json",
    );
    expect(resolveEnrichedUrl(undefined, "?enriched=https://x.test/t/tileset.json")).toBe(
      "https://x.test/t/tileset.json",
    );
  });

  it("other params coexist; empty value falls back to env", () => {
    expect(resolveEnrichedUrl(ENV, "?a=1&enriched=dnipro-o2w&b=2")).toContain("dnipro-o2w");
    expect(resolveEnrichedUrl(ENV, "?enriched=")).toBe(ENV);
  });
});

// The BLD chip (CameraTiltPanel) — reload-based buildings-source toggle. The hash carries the
// #p pose, so preserving it through the toggle IS the "keeps the view" guarantee.
describe("isVariantActive / toggleVariantUrl", () => {
  const PAGE = "http://localhost:4321/#p=48.464,35.046,650,25,55";

  it("detects the variant by name and by verbatim path", () => {
    expect(isVariantActive("")).toBe(false);
    expect(isVariantActive("?enriched=dnipro-o2w")).toBe(true);
    expect(isVariantActive("?enriched=/enriched/dnipro-o2w/tileset.json")).toBe(true);
    expect(isVariantActive("?enriched=off")).toBe(false);
  });

  it("toggles ON: sets the param and PRESERVES the pose hash", () => {
    const on = toggleVariantUrl(PAGE);
    const u = new URL(on);
    expect(u.searchParams.get("enriched")).toBe(ENRICHED_VARIANT_NAME);
    expect(u.hash).toBe("#p=48.464,35.046,650,25,55");
  });

  it("toggles OFF: removes the param, hash intact, back to the clean URL", () => {
    const off = toggleVariantUrl(`http://localhost:4321/?enriched=${ENRICHED_VARIANT_NAME}#p=1,2,3,4,5`);
    const u = new URL(off);
    expect(u.searchParams.get("enriched")).toBeNull();
    expect(u.hash).toBe("#p=1,2,3,4,5");
  });

  it("round-trips: toggle twice returns to no param", () => {
    const twice = new URL(toggleVariantUrl(toggleVariantUrl(PAGE)));
    expect(twice.searchParams.get("enriched")).toBeNull();
  });

  it("keeps unrelated params", () => {
    const on = new URL(toggleVariantUrl("http://localhost:4321/?foo=1#p=1,2,3,4,5"));
    expect(on.searchParams.get("foo")).toBe("1");
    expect(on.searchParams.get("enriched")).toBe(ENRICHED_VARIANT_NAME);
  });
});
