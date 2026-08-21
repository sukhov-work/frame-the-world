import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TILESETS, STREETS } from "../src/components/globe/tuning";

/**
 * #15 (owner batch #4 S3) — the iOS-directed tile service worker's URL POLICY, fenced as text
 * (the mobileFence idiom: public/sw.js is a standalone worker file — it cannot import lib code,
 * so its policy constants are duplicated there and locked HERE against the tuning source of
 * truth). The rules under test are the ones whose violation is a correctness/ToS bug:
 *   · mutable manifests (tileset.json / layer.json / the OpenFreeMap /planet TileJSON) must
 *     keep revalidating — never served cache-first;
 *   · the token-bearing api.cesium.com endpoint must never be in the allowlist;
 *   · every allowlisted host must actually be one the app fetches (tuning.ts);
 *   · entries must expire (Esri ToS posture: performance cache, not an offline extract).
 */
const sw = readFileSync("public/sw.js", "utf8");

describe("public/sw.js — #15 tile-cache policy fence", () => {
  it("allowlists exactly the app's tile hosts (from tuning.ts)", () => {
    const esriHost = new URL(TILESETS.esriImageryUrl.replace(/\{[xyz]\}/g, "0")).hostname;
    const cartoHost = new URL(TILESETS.cartoDarkUrl.replace(/\{[xyz]\}/g, "0")).hostname;
    const ofmHost = new URL(STREETS.tileJsonUrl).hostname;
    for (const host of [esriHost, cartoHost, ofmHost, "assets.ion.cesium.com"]) {
      expect(sw).toContain(`"${host}"`);
    }
    expect(sw).toContain('.workers.dev'); // R2 enriched/terrain (env-driven subdomain suffix)
  });
  it("NEVER caches the token-bearing ion endpoint or mutable manifests", () => {
    expect(sw).not.toContain('"api.cesium.com"'); // not in any allowlist
    expect(sw).toContain("tileset.json"); // manifest exclusion present…
    expect(sw).toContain("layer.json");
    expect(sw).toMatch(/tileset\.json[\s\S]{0,120}return false/); // …and it DECLINES, not caches
    expect(sw).toContain('"/planet"'); // the OpenFreeMap TileJSON pointer stays mutable
  });
  it("is a performance cache, not an archive: bounded entries + max age + GET-only", () => {
    expect(sw).toMatch(/MAX_ENTRIES\s*=\s*\d+/);
    expect(sw).toMatch(/MAX_AGE_MS\s*=\s*\d/);
    expect(sw).toContain('method !== "GET"');
  });
  it("both layouts register it iOS-gated and dev-gated", () => {
    for (const layout of ["src/layouts/Layout.astro", "src/layouts/MobileLayout.astro"]) {
      const src = readFileSync(layout, "utf8");
      expect(src).toContain('navigator.serviceWorker.register("/sw.js")');
      expect(src).toMatch(/iPhone\|iPod\|iPad/); // iOS-directed (incl. iPadOS-as-Mac below)
      expect(src).toContain("Macintosh"); // iPadOS masquerades as a Mac UA with touch points
      expect(src).toContain("localhost"); // dev-gate
    }
  });
});
