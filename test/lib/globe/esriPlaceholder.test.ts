import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ancestorOf,
  ESRI_PLACEHOLDER,
  fnv1a32,
  installEsriPlaceholderFallback,
  isPlaceholderBytes,
  makeXyzUrlCodec,
  PlaceholderMemo,
  quadrantOf,
  tileKey,
  type QuadrantRect,
} from "../../../src/lib/globe/esriPlaceholder";
import { TILESETS } from "../../../src/components/globe/tuning";

/**
 * RC5 / owner bug B1 (2026-08-25) — "Map data not available" tiles at close zoom.
 *
 * The defect is that Esri reports SUCCESS for a tile it does not have, so nothing in the stack
 * treats it as missing. Everything here is about the two halves of the fix: recognising a
 * success that isn't one, and standing a real ancestor in its place without ever asking twice.
 */

const TEMPLATE = TILESETS.esriImageryUrl;
const codec = makeXyzUrlCodec(TEMPLATE);

/** The live sentinel, probed 2026-08-25 (see test/fixtures/README.md). */
const FIXTURE = "test/fixtures/esri-placeholder.jpg";
const sentinelBytes = existsSync(FIXTURE)
  ? new Uint8Array(readFileSync(FIXTURE)).buffer
  : null;

describe("sentinel detection", () => {
  it.runIf(sentinelBytes)("recognises the real bytes Esri serves", () => {
    expect(sentinelBytes!.byteLength).toBe(ESRI_PLACEHOLDER.byteLength);
    expect(isPlaceholderBytes(sentinelBytes!)).toBe(true);
  });

  it.runIf(sentinelBytes)(
    "pins the fingerprint constant against the fixture, not against itself",
    () => {
      expect(fnv1a32(new Uint8Array(sentinelBytes!))).toBe(ESRI_PLACEHOLDER.fnv1a32);
    },
  );

  it("rejects a body of the same length with different bytes", () => {
    const decoy = new Uint8Array(ESRI_PLACEHOLDER.byteLength).fill(0x42);
    expect(isPlaceholderBytes(decoy.buffer)).toBe(false);
  });

  it("rejects bodies of any other length outright (the cheap first gate)", () => {
    for (const n of [0, 1, 2520, 2522, 11556]) {
      expect(isPlaceholderBytes(new Uint8Array(n).buffer)).toBe(false);
    }
  });

  it("fnv1a32 is the textbook 32-bit variant", () => {
    expect(fnv1a32(new TextEncoder().encode(""))).toBe(0x811c9dc5);
    expect(fnv1a32(new TextEncoder().encode("a"))).toBe(0xe40c292c);
    expect(fnv1a32(new TextEncoder().encode("foobar"))).toBe(0xbf9cf968);
  });
});

describe("URL codec — token ORDER comes from the template", () => {
  it("round-trips Esri's {z}/{y}/{x} order", () => {
    const t = { z: 19, x: 388737, y: 219658 };
    const url = codec.build(t);
    expect(url).toContain("/19/219658/388737");
    expect(codec.parse(url)).toEqual(t);
  });

  it("does not confuse x and y (CARTO's {z}/{x}/{y} is the other way round)", () => {
    const carto = makeXyzUrlCodec(TILESETS.cartoDarkUrl);
    const t = { z: 12, x: 7, y: 9 };
    expect(carto.build(t)).toContain("/12/7/9");
    expect(codec.build(t)).toContain("/12/9/7");
  });

  it("tolerates a query string and rejects anything that isn't this template", () => {
    expect(codec.parse(`${codec.build({ z: 3, x: 1, y: 2 })}?v=7`)).toEqual({ z: 3, x: 1, y: 2 });
    expect(codec.parse("https://example.com/whatever.png")).toBeNull();
    expect(codec.parse("https://basemaps.cartocdn.com/rastertiles/dark_nolabels/3/1/2.png")).toBeNull();
  });
});

describe("ancestor + quadrant geometry", () => {
  it("walks up in URL token space (verified top-left at Esri)", () => {
    // Probed 2026-08-25: z19 388737/219658 (Everest summit) is real, and its z18 parent
    // 194368/109829 is real too — computed exactly this way.
    expect(ancestorOf({ z: 19, x: 389037, y: 219658 }, 1)).toEqual({
      z: 18,
      x: 194518,
      y: 109829,
    });
    expect(ancestorOf({ z: 1, x: 1, y: 1 }, 1)).toEqual({ z: 0, x: 0, y: 0 });
    expect(ancestorOf({ z: 0, x: 0, y: 0 }, 1)).toBeNull();
    expect(ancestorOf({ z: 5, x: 3, y: 3 }, 0)).toBeNull();
  });

  it("the four children of a tile tile its parent exactly, with no gap or overlap", () => {
    const parent = { z: 10, x: 4, y: 6 };
    const rects: QuadrantRect[] = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        rects.push(quadrantOf({ z: 11, x: parent.x * 2 + dx, y: parent.y * 2 + dy }, 1, 256));
      }
    }
    expect(rects.every((r) => r.size === 128)).toBe(true);
    const corners = new Set(rects.map((r) => `${r.sx},${r.sy}`));
    expect(corners).toEqual(new Set(["0,0", "0,128", "128,0", "128,128"]));
  });

  it("stays inside the source image at the deepest walk we allow", () => {
    for (let up = 1; up <= 3; up++) {
      for (const x of [0, 1, 5, 7, 388737]) {
        const r = quadrantOf({ z: 19, x, y: x + 3 }, up, 256);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.size).toBeLessThanOrEqual(256);
        expect(r.sy + r.size).toBeLessThanOrEqual(256);
      }
    }
    expect(quadrantOf({ z: 19, x: 0, y: 0 }, 3, 256).size).toBe(32); // 8× upscale at the cap
  });
});

describe("PlaceholderMemo — the learned cap must never blank real imagery", () => {
  const t = (x: number, y: number) => ({ z: 19, x, y });

  it("remembers exact sentinels", () => {
    const m = new PlaceholderMemo();
    expect(m.isCapped(t(10, 10))).toBe(false);
    m.noteSentinel(t(10, 10));
    expect(m.isCapped(t(10, 10))).toBe(true);
    expect(m.isCapped(t(11, 10))).toBe(false);
  });

  it("caps a block only after enough sentinels AND no real tile in it", () => {
    const m = new PlaceholderMemo();
    for (let i = 0; i < PlaceholderMemo.BLOCK_MIN; i++) m.noteSentinel(t(i, 0));
    expect(m.isCapped(t(7, 7))).toBe(true); // same 8×8 block, never itself requested
    expect(m.isCapped(t(8, 0))).toBe(false); // the next block is untouched
  });

  it("ONE real tile opens its block permanently — the sub-kilometre Everest boundary", () => {
    const m = new PlaceholderMemo();
    for (let i = 0; i < PlaceholderMemo.BLOCK_MIN; i++) m.noteSentinel(t(i, 0));
    expect(m.isCapped(t(7, 7))).toBe(true);
    m.noteReal(t(3, 3)); // the summit tile, inside the same block
    expect(m.isCapped(t(7, 7))).toBe(false);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) m.noteSentinel(t(x, y));
    expect(m.isCapped(t(7, 7))).toBe(false); // and it stays open
  });

  it("a tile seen real is no longer an exact sentinel", () => {
    const m = new PlaceholderMemo();
    m.noteSentinel(t(1, 1));
    m.noteReal(t(1, 1));
    expect(m.isCapped(t(1, 1))).toBe(false);
  });

  it("blocks are per LEVEL — a capped z19 block says nothing about z18", () => {
    const m = new PlaceholderMemo();
    for (let i = 0; i < PlaceholderMemo.BLOCK_MIN; i++) m.noteSentinel({ z: 19, x: i, y: 0 });
    expect(m.isCapped({ z: 18, x: 0, y: 0 })).toBe(false);
  });
});

/** A scriptable Esri: `real` lists the tiles that have imagery; everything else is the sentinel —
 *  and the sentinel it serves is the REAL body, so the wrapper's own detector is under test too. */
function fakeEsri(real: Set<string>, onGet?: (url: string, n: number) => void) {
  const gets: string[] = [];
  const sentinel = () =>
    new Response(sentinelBytes!.slice(0), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  const overlay = {
    async fetch(url: string, _options?: RequestInit): Promise<Response> {
      gets.push(url);
      onGet?.(url, gets.length);
      const t = codec.parse(url);
      if (t && real.has(tileKey(t))) {
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      }
      return sentinel();
    },
  };
  return { overlay, gets };
}

describe.runIf(sentinelBytes)("installEsriPlaceholderFallback", () => {
  const crop = async (_b: ArrayBuffer, _r: QuadrantRect, _px: number) =>
    new Uint8Array([9, 9, 9]).buffer;

  it("replaces a sentinel with an upscaled ancestor — the placeholder never draws", async () => {
    {
      const { overlay, gets } = fakeEsri(new Set(["18/194518/109829"]));
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      const res = await overlay.fetch(codec.build({ z: 19, x: 389037, y: 219658 }));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));
      expect(stats.sentinels).toBe(1);
      expect(stats.substituted).toBe(1);
      expect(stats.drawn).toBe(0);
      // child GET, one heal re-issue, then the parent — and nothing beyond it.
      expect(gets.length).toBe(3);
    }
  });

  it("walks further up when the parent is a sentinel too", async () => {
    {
      const { overlay } = fakeEsri(new Set(["17/97259/54914"]));
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      await overlay.fetch(codec.build({ z: 19, x: 389037, y: 219658 }));
      expect(stats.substituted).toBe(1);
      expect(stats.drawn).toBe(0);
    }
  });

  it("fails soft: no real ancestor within the cap → the original response, exactly as before", async () => {
    {
      const { overlay } = fakeEsri(new Set());
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      const res = await overlay.fetch(codec.build({ z: 19, x: 389037, y: 219658 }));
      expect(res.ok).toBe(true);
      expect((await res.arrayBuffer()).byteLength).toBe(ESRI_PLACEHOLDER.byteLength);
      expect(stats.drawn).toBe(1);
      expect(stats.substituted).toBe(0);
    }
  });

  it("fails soft when the crop pipeline is unavailable (no OffscreenCanvas)", async () => {
    {
      const { overlay } = fakeEsri(new Set(["18/194518/109829"]));
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: async () => null,
      });
      const res = await overlay.fetch(codec.build({ z: 19, x: 389037, y: 219658 }));
      expect((await res.arrayBuffer()).byteLength).toBe(ESRI_PLACEHOLDER.byteLength);
      expect(stats.drawn).toBe(1);
    }
  });

  it("passes real imagery straight through and never touches a non-tile URL", async () => {
    {
      const { overlay, gets } = fakeEsri(new Set(["19/389037/219658"]));
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      const res = await overlay.fetch(codec.build({ z: 19, x: 389037, y: 219658 }));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(stats.sentinels).toBe(0);
      await overlay.fetch("https://example.com/not-a-tile.png");
      expect(gets.length).toBe(2);
    }
  });

  it("heals once per tile per session when the network has since published imagery", async () => {
    {
      const real = new Set<string>();
      // Esri publishes the tile between the first GET and the `cache: "default"` re-issue.
      const { overlay, gets } = fakeEsri(real, (_u, n) => {
        if (n === 2) real.add("19/389037/219658");
      });
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      const url = codec.build({ z: 19, x: 389037, y: 219658 });
      const res = await overlay.fetch(url);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(stats.healed).toBe(1);
      expect(gets.length).toBe(2); // child, then the heal — no parent walk needed
    }
  });

  it("stops re-asking: the learned table collapses repeat GETs to the parent", async () => {
    {
      const { overlay, gets } = fakeEsri(new Set(["18/194518/109829"]));
      const { stats } = installEsriPlaceholderFallback(overlay, {
        urlTemplate: TEMPLATE,
        cropUpscale: crop,
      });
      const url = codec.build({ z: 19, x: 389037, y: 219658 });
      await overlay.fetch(url);
      const afterFirst = gets.length;
      await overlay.fetch(url);
      await overlay.fetch(url);
      // Each repeat costs ONE parent GET and no z19 GET at all.
      expect(gets.length - afterFirst).toBe(2);
      expect(gets.slice(afterFirst).every((u) => u.includes("/18/"))).toBe(true);
      expect(stats.skippedGets).toBe(2);
      expect(stats.sentinels).toBe(1); // the sentinel was fetched exactly once, ever
    }
  });

  it("leaves genuine network failures to the existing load-error retry", async () => {
    const overlay = {
      async fetch() {
        return new Response(null, { status: 503 });
      },
    };
    const { stats } = installEsriPlaceholderFallback(overlay, {
      urlTemplate: TEMPLATE,
      cropUpscale: crop,
    });
    const res = await overlay.fetch();
    expect(res.status).toBe(503);
    expect(stats.sentinels).toBe(0);
  });
});
