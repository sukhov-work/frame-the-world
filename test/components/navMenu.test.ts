import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NavMenuButton, isRowClick, NAV_MENU_ID, NAV_MENU_SELECTOR } from "../../src/components/panels/NavMenu";
import { read, ruleBody, stripComments } from "../styles/_css";

/**
 * T180 (owner 2026-10-22) — the collapsed MENU. What must not regress: the button is a real menu
 * button in the PLAN pill's look, LEFT of PLAN; the right side keeps ONLY Upload; the dropdown is
 * page markup wrapping the existing rows (static links + the islands), toggled by a class — never
 * the `hidden` attribute, which would take the rows' own fixed windows down with it.
 */

const INDEX = "src/pages/index.astro";
const SRC = "src/components/panels/NavMenu.tsx";
const CSS = "src/styles/nav-menu.css";

const html = read(INDEX);
const markup = html.slice(0, html.indexOf("<style>"));
const header = markup.slice(markup.indexOf('<header class="topnav">'), markup.indexOf("</header>"));
const left = header.slice(header.indexOf('<div class="topnav-left">'), header.indexOf("<nav>"));
const nav = header.slice(header.indexOf("<nav>"), header.indexOf("</nav>"));
const menu = left.slice(left.indexOf('<div class="topnav-menu" ')); // the trailing space skips .topnav-menuwrap

describe("the MENU button (pure view)", () => {
  it("is a menu button with a three-bar sandwich icon", () => {
    const closed = renderToStaticMarkup(createElement(NavMenuButton, { open: false }));
    expect(closed).toContain('aria-haspopup="menu"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain(`aria-controls="${NAV_MENU_ID}"`);
    expect(closed).toContain('type="button"');
    expect(closed).toMatch(/class="nm-btn tip"/);
    expect((closed.match(/<rect /g) ?? []).length).toBe(3);
    expect(closed).toContain(">MENU<");
    const open = renderToStaticMarkup(createElement(NavMenuButton, { open: true }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/class="nm-btn tip is-on"/);
  });
});

describe("isRowClick — what closes the menu", () => {
  const el = (hits: Record<string, boolean>) =>
    ({ closest: (sel: string) => (hits[sel] ? {} : null) }) as unknown as Element;

  it("a link / button row closes it; a click inside a window a row opened does not", () => {
    expect(isRowClick(el({ "a, button": true }))).toBe(true);
    expect(isRowClick(el({ '[role="dialog"]': true, "a, button": true }))).toBe(false);
    expect(isRowClick(el({}))).toBe(false);
    expect(isRowClick(null)).toBe(false);
  });
});

describe("the island's wiring (source fence)", () => {
  const code = stripComments(read(SRC));

  it("toggles the page container by its hook + class, never the hidden attribute", () => {
    expect(NAV_MENU_SELECTOR).toBe("[data-nav-menu]");
    expect(code).toMatch(/classList\.toggle\("is-open", open\)/);
    expect(code).not.toMatch(/\.hidden\s*=/);
  });

  it("dismisses on Escape, a capture pointerdown outside, and a row click", () => {
    expect(code).toMatch(/addEventListener\("pointerdown", onPointerDown, true\)/);
    expect(code).toMatch(/e\.key !== "Escape"/);
    expect(code).toMatch(/menu\.addEventListener\("click", onClick\)/);
  });

  it("never imports the mobile shell or the BEST SPOT store", () => {
    expect(code).not.toMatch(/components\/mobile\/|\.\.\/mobile\//);
    expect(code).not.toMatch(/store\/bestSpot/);
    expect(code).not.toMatch(/method=["']post["']/i);
  });
});

describe("index.astro — the collapsed nav", () => {
  it("the MENU pill sits in .topnav-left between the wordmark and PLAN", () => {
    const logo = left.indexOf('id="logo-home"');
    const btn = left.indexOf('<NavMenu client:only="react" />');
    const pft = left.indexOf('<PlanFindToggle client:only="react" />');
    expect(logo).toBeGreaterThan(-1);
    expect(btn).toBeGreaterThan(logo);
    expect(pft).toBeGreaterThan(btn);
  });

  it("the right side keeps ONLY Upload (with its hello chip)", () => {
    expect(nav).toMatch(/class="nav-upload tip" data-open-upload/);
    expect((nav.match(/<a\b/g) ?? []).length).toBe(1);
    expect(nav).not.toMatch(/client:only/);
  });

  it("the dropdown wraps Explore · Mobile · Docs · My content · Marketplace · Guide · the badge", () => {
    expect(menu).toMatch(/<div class="topnav-menu" id="topnav-menu" role="menu" aria-label="PLUX menu" data-nav-menu>/);
    const order = [
      "data-explore",
      'href="/m"',
      'href="/guide"',
      "<MyPins client:only",
      "<Marketplace client:only",
      "<Guide client:only",
      "<MemberBadge client:only",
    ].map((s) => menu.indexOf(s));
    for (const ix of order) expect(ix).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the container is never `hidden` — closed is visibility, and the rows' windows opt back in", () => {
    const tag = menu.slice(0, menu.indexOf(">") + 1);
    expect(tag).not.toMatch(/\bhidden\b/);
    const css = html.slice(html.indexOf("<style>"));
    expect(ruleBody(css, ".topnav-menu:not(.is-open)")).toMatch(/visibility:\s*hidden/);
    expect(css).toMatch(/\.topnav-menu :global\(\[role="dialog"\]\),\s*\.topnav-menu :global\(\[role="status"\]\)\s*{\s*visibility:\s*visible;/);
    // the S2 trap: nothing on the container may become the windows' containing block
    const body = ruleBody(css, ".topnav-menu");
    expect(body).not.toMatch(/backdrop-filter|transform|filter|opacity/);
  });

  it("MY SPOT left the nav; the logo clean-boot and the /m pose script stay", () => {
    expect(html).not.toMatch(/<MyLocation\b/);
    expect(html).not.toMatch(/import MyLocation/);
    expect(html).toMatch(/document\.getElementById\("logo-home"\)/);
    expect(html).toMatch(/querySelectorAll\('a\[href="\/m"\]'\)/);
    expect(html).toMatch(/animation: nav-upload-hello/);
  });
});

describe("nav-menu.css", () => {
  const css = read(CSS);

  it("twins the PLAN pill and restyles the island toggles as rows", () => {
    for (const sel of [".nm", ".nm-btn", ".nm-btn.is-on", ".nm-icon", "body.welcome-active .nm"]) ruleBody(css, sel);
    for (const t of [".mp-toggle", ".mk-toggle", ".gd-toggle"]) expect(css).toContain(`.topnav-menu ${t}`);
    expect(ruleBody(css, "body.welcome-active .nm")).toMatch(/display:\s*none/);
  });

  it("uses tokens only — no literal colours", () => {
    const body = stripComments(css);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/rgba?\(/);
  });
});
