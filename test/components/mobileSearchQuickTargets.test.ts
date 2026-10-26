import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MobileSearch from "../../src/components/mobile/MobileSearch";
import { VIEW_PREFS_KEY } from "../../src/lib/prefs";
import { useMemberStore } from "../../src/store/member";
import { skyIndex } from "../../src/lib/sky/catalog";

/**
 * QUICK TARGETS + RECENT (owner 2026-10-27): "also pin them as quick search targets in search panel list
 * (sun, moon) and under them add 3 more recent sky searches (if any happened)". Mobile only.
 *
 * Pinned here: the idle SKY sheet renders ☀ SUN then ☾ MOON ABOVE the MY PLACES block, in the search-hit
 * row grammar; the pinned name/detail match the catalog's own index rows (copied, never imported — the
 * catalog stays lazy); RECENT appears only when there are recents, at most 3, newest first, never the
 * sun or the moon; every quick/recent row is a `track(` pick.
 */

const root = join(__dirname, "../..");
/** zustand v5 serves `getInitialState()` as the SERVER snapshot: mirror the live store onto it. An
 *  anonymous visitor so MY PLACES renders its block (the "unknown" boot phase renders nothing). */
const render = () => {
  useMemberStore.setState({ phase: "anonymous", member: null });
  Object.assign(useMemberStore.getInitialState(), useMemberStore.getState());
  return renderToStaticMarkup(createElement(MobileSearch, { onFly() {}, onTrack() {} }));
};
const quick = (html: string) => [...html.matchAll(/data-quick="(\w+)"/g)].map((m) => m[1]);
const recent = (html: string) => [...html.matchAll(/data-recent="([^"]+)"/g)].map((m) => m[1]);

/** Minimal Storage stand-in — the node test env has no localStorage (the prefs.test idiom). */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}
const row = (id: string, name: string, kind = "galaxy") => ({ id, name, detail: `${name} DETAIL`, kind });

describe("MobileSearch — the idle SKY sheet's QUICK TARGETS + RECENT", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("pins ☀ SUN then ☾ MOON, above MY PLACES", () => {
    const html = render();
    expect(quick(html)).toEqual(["sun", "moon"]);
    expect(html).toContain("QUICK TARGETS");
    expect(html).toContain("☀ SUN");
    expect(html).toContain("☾ MOON");
    expect(html.indexOf('data-quick="sun"')).toBeLessThan(html.indexOf('data-quick="moon"'));
    expect(html.indexOf('data-quick="moon"')).toBeLessThan(html.indexOf('class="m-places"'));
  });

  it("the pinned rows are search-hit rows and match the catalog's own index entries", () => {
    const html = render();
    for (const id of ["body:sun", "body:moon"]) {
      const e = skyIndex().find((x) => x.id === id)!;
      expect(html).toContain(`<span class="m-hit__detail">${e.detail.replace(/'/g, "&#x27;")}</span>`);
      expect(html).toContain(`${e.kind === "sun" ? "☀" : "☾"} ${e.name}</span>`);
    }
    // A plain button like the MY PLACES rows — never `role="option"` outside the results listbox.
    expect(html).toMatch(/<button type="button" class="m-hit" data-quick="sun">/);
    expect(html).not.toMatch(/role="option"[^>]*data-(quick|recent)=/);
  });

  it("no recents → no RECENT head", () => {
    const html = render();
    expect(html).not.toContain(">RECENT<");
    expect(recent(html)).toEqual([]);
  });

  it("shows at most 3 recents, newest first, never the sun or the moon", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        [VIEW_PREFS_KEY]: JSON.stringify({
          prefsRev: 2,
          recentSky: [
            row("m:31", "ANDROMEDA"),
            row("body:moon", "MOON", "moon"),
            row("m:31", "ANDROMEDA (DUP)"),
            row("star:vega", "VEGA", "star"),
            row("planet:jupiter", "JUPITER", "planet"),
            row("m:42", "ORION NEBULA", "nebula"),
          ],
        }),
      }),
    );
    const html = render();
    expect(html).toContain(">RECENT<");
    expect(recent(html)).toEqual(["m:31", "star:vega", "planet:jupiter"]);
    expect(html).toContain("❍ ANDROMEDA</span>");
    expect(html).not.toContain("ANDROMEDA (DUP)");
    // the pinned rows stay the only sun/moon rows
    expect(html.match(/☾ MOON/g)).toHaveLength(1);
    // RECENT sits under the pinned rows and above MY PLACES
    expect(html.indexOf('data-quick="moon"')).toBeLessThan(html.indexOf(">RECENT<"));
    expect(html.indexOf('data-recent="planet:jupiter"')).toBeLessThan(html.indexOf('class="m-places"'));
  });
});

describe("MobileSearch — source fences", () => {
  const src = readFileSync(join(root, "src/components/mobile/MobileSearch.tsx"), "utf8");
  it("never statically imports the sky catalog (lazy by contract)", () => {
    expect(src).not.toMatch(/from\s+["']\.\.\/\.\.\/lib\/sky\/catalog["']/);
  });
  it("the quick/recent rows are track( picks, and track records the recents", () => {
    expect(src).toMatch(/onClick=\{\(\) => track\(row\)\}/);
    expect(src).toMatch(/data-quick/);
    expect(src).toMatch(/data-recent/);
    expect(src).toMatch(/saveViewPref\("recentSky", /);
  });
});
