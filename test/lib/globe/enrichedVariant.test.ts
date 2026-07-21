import { describe, it, expect } from "vitest";
import {
  resolveEnrichedUrl,
  resolveEnrichedBbox,
  isVariantActive,
  toggleVariantUrl,
  applyStoredVariant,
  setVariantUrl,
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

// Cross-city variants (?enriched=st-albans-o2w) are baked over their OWN box — the OSM mask and
// re-seat extent must follow the variant. Load-bearing invariant: every non-listed value returns
// the default bbox OBJECT ITSELF (identity), so the default path stays byte-identical.
describe("resolveEnrichedBbox", () => {
  const DNIPRO = { west: 34.915, south: 48.37, east: 35.185, north: 48.55 };
  const ST_ALBANS = { west: -0.3692, south: 51.7244, east: -0.2821, north: 51.7787 };
  const VARIANTS = { "st-albans-o2w": ST_ALBANS };

  it("no param / unknown / off / same-box variant → the default bbox IDENTITY", () => {
    expect(resolveEnrichedBbox(DNIPRO, "", VARIANTS)).toBe(DNIPRO);
    expect(resolveEnrichedBbox(DNIPRO, "?foo=bar", VARIANTS)).toBe(DNIPRO);
    expect(resolveEnrichedBbox(DNIPRO, "?enriched=dnipro-o2w", VARIANTS)).toBe(DNIPRO);
    expect(resolveEnrichedBbox(DNIPRO, "?enriched=off", VARIANTS)).toBe(DNIPRO);
    expect(resolveEnrichedBbox(DNIPRO, "?enriched=/x/y/tileset.json", VARIANTS)).toBe(DNIPRO);
  });

  it("a listed cross-city variant → its own bbox", () => {
    expect(resolveEnrichedBbox(DNIPRO, "?enriched=st-albans-o2w", VARIANTS)).toBe(ST_ALBANS);
    expect(resolveEnrichedBbox(DNIPRO, "?a=1&enriched=st-albans-o2w&b=2", VARIANTS)).toBe(ST_ALBANS);
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

// Persisted BLD chip (owner 2026-07-21): the stored preference makes the variant survive a plain
// reload of `/`. Load-bearing invariant: an explicit `?enriched=` in the URL ALWAYS wins verbatim
// (incl. off and cross-city variants) — the pref only speaks when the URL is silent.
describe("applyStoredVariant / setVariantUrl (BLD persistence)", () => {
  const PAGE = "http://localhost:4321/#p=48.464,35.046,650,25,55";

  it("stored ON injects the variant only when the URL is silent", () => {
    expect(applyStoredVariant("", true)).toBe(`?enriched=${ENRICHED_VARIANT_NAME}`);
    const withOther = applyStoredVariant("?foo=1", true);
    expect(withOther).toContain("foo=1");
    expect(withOther).toContain(`enriched=${ENRICHED_VARIANT_NAME}`);
  });

  it("an explicit URL param wins verbatim — off, other variants, even empty", () => {
    expect(applyStoredVariant("?enriched=off", true)).toBe("?enriched=off");
    expect(applyStoredVariant("?enriched=st-albans-o2w", true)).toBe("?enriched=st-albans-o2w");
    expect(applyStoredVariant("?enriched=", true)).toBe("?enriched=");
  });

  it("stored OFF / unset leaves the search untouched", () => {
    expect(applyStoredVariant("", false)).toBe("");
    expect(applyStoredVariant("?a=1", undefined)).toBe("?a=1");
  });

  it("setVariantUrl writes the EXPLICIT state and preserves the pose hash", () => {
    const on = new URL(setVariantUrl(PAGE, true));
    expect(on.searchParams.get("enriched")).toBe(ENRICHED_VARIANT_NAME);
    expect(on.hash).toBe("#p=48.464,35.046,650,25,55");
    const off = new URL(
      setVariantUrl(`http://localhost:4321/?enriched=${ENRICHED_VARIANT_NAME}#p=1,2,3,4,5`, false),
    );
    expect(off.searchParams.get("enriched")).toBeNull();
    expect(off.hash).toBe("#p=1,2,3,4,5");
  });

  it("chip flow: pref-active page (no URL param) turns OFF, not double-ON", () => {
    // The BLD chip computes the EFFECTIVE state through the pref, then writes it explicitly.
    const effective = isVariantActive(applyStoredVariant("", true));
    expect(effective).toBe(true);
    const next = new URL(setVariantUrl(PAGE, !effective));
    expect(next.searchParams.get("enriched")).toBeNull(); // OFF — a raw toggle would have set it
  });
});
