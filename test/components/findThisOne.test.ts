import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TargetSheet from "../../src/components/mobile/TargetSheet";
import { useFindStore, FIND_RANGES } from "../../src/store/find";
import { useSkyStore } from "../../src/store/sky";
import { useCameraStore } from "../../src/store/camera";
import { bodyTarget } from "../../src/lib/ephemeris/targets";

/**
 * FIND THIS ONE + the range row (owner 2026-10-10, Pixel screenshots): tapping ⌖ FIND IN FRAME
 * in the SUN's properties left BOTH the sun and the moon scanning (the moon is the FIND default),
 * and the period could only be set from the FIND tab. Now the button scans the named object
 * alone (`soloBody`) and the 1W · 1M · 6M · 1Y chips share its row — the button the left half,
 * the chips the right, disabled until this object's scan is on. Rendered with
 * `renderToStaticMarkup` over the live store mirrored onto zustand's server snapshot (the
 * mobileSaveChip idiom — no DOM in this repo's vitest); the desktop twin is read from source.
 */

const FIND_BOOT = { ...useFindStore.getState() };
const SKY_BOOT = { ...useSkyStore.getState() };
const CAM_BOOT = { ...useCameraStore.getState() };
const SRC = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const render = () => {
  Object.assign(useFindStore.getInitialState(), useFindStore.getState());
  Object.assign(useSkyStore.getInitialState(), useSkyStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  return renderToStaticMarkup(createElement(TargetSheet as never, { onClose: () => {} }));
};
/** The range chips' rendered state, in order. */
const chips = (html: string) =>
  [...html.matchAll(/<button[^>]*class="m-toggle m-toggle--range[^"]*"[^>]*>([^<]*)<\/button>/g)].map(
    (m) => ({ label: m[1], disabled: /\bdisabled=""/.test(m[0]), on: /m-toggle--on/.test(m[0]) }),
  );

beforeEach(() => {
  useFindStore.setState(FIND_BOOT, true);
  useSkyStore.setState(SKY_BOOT, true);
  useCameraStore.setState(CAM_BOOT, true);
  useSkyStore.setState({ target: bodyTarget("sun") });
  useCameraStore.setState({ focusLatDeg: 48.46, focusLonDeg: 35.04 });
});

describe("the /m target sheet — FIND IN FRAME scans THIS object alone, the range chips share its row", () => {
  it("renders the row: the button, then four range chips DISABLED while this object's scan is off", () => {
    useFindStore.setState({ open: false, bodies: { sun: false, moon: true, target: false }, rangeDays: 30 });
    const html = render();
    expect(html).toContain('class="m-findrow"');
    expect(html).toMatch(/class="m-findframe"[^>]*aria-pressed="false"/);
    expect(html).toContain("⌖ FIND IN FRAME");
    const c = chips(html);
    expect(c.map((x) => x.label)).toEqual(FIND_RANGES.map((r) => r.label));
    expect(c.every((x) => x.disabled)).toBe(true);
    // the row sits ABOVE unfollow (the eclipseParity contract keeps its order)
    expect(html.indexOf('class="m-findrow"')).toBeLessThan(html.indexOf('class="m-unfollow"'));
  });

  it("the tap: ONLY the sun scans (the moon's default-on chip stands down), FIND opens, the chips go live with 1M on", () => {
    useFindStore.setState({ open: false, bodies: { sun: false, moon: true, target: false }, rangeDays: 30 });
    // the sheet's handler, replayed through the store it calls
    const f = useFindStore.getState();
    f.soloBody("sun");
    f.setOpen(true);
    expect(useFindStore.getState().bodies).toEqual({ sun: true, moon: false, target: false });
    const html = render();
    expect(html).toMatch(/class="m-findframe m-findframe--on"[^>]*aria-pressed="true"/);
    expect(html).toContain("✓ FIND IN FRAME");
    const c = chips(html);
    expect(c.every((x) => !x.disabled)).toBe(true);
    expect(c.find((x) => x.on)?.label).toBe("1M");
  });

  it("a range tap writes the shared rangeDays the FIND sheet reads", () => {
    useFindStore.setState({ open: true, bodies: { sun: true, moon: false, target: false }, rangeDays: 30 });
    useFindStore.getState().setRangeDays(365);
    const c = chips(render());
    expect(c.find((x) => x.on)?.label).toBe("1Y");
  });

  it("the handler is solo-on / plain-off in source (never the additive setBody on the way on)", () => {
    const src = code(SRC("src/components/mobile/TargetSheet.tsx"));
    const row = src.slice(src.indexOf('className="m-findrow"'), src.indexOf('className="m-unfollow"'));
    expect(row).toMatch(/f\.soloBody\(findBody\)/);
    expect(row).toMatch(/f\.setBody\(findBody, false\)/);
    expect(row).not.toMatch(/setBody\(findBody, true\)|setBody\(findBody, !findOn\)/);
    expect(row).toMatch(/disabled=\{!findOn\}/);
    expect(row).toMatch(/FIND_RANGES\.map/);
  });
});

describe("the desktop TARGET panel — the same row, the same solo rule (parity)", () => {
  const src = code(SRC("src/components/panels/TargetPanel.tsx"));
  it("renders the tp-findrow with the button and the tp-range chips gated on findOn", () => {
    const row = src.slice(src.indexOf('className="tp-findrow"'), src.indexOf('className="tp-unfollow"'));
    expect(row.length).toBeGreaterThan(0);
    expect(row).toMatch(/f\.soloBody\(findBody\)/);
    expect(row).toMatch(/f\.setBody\(findBody, false\)/);
    expect(row).not.toMatch(/setBody\(findBody, !findOn\)/);
    expect(row).toMatch(/FIND_RANGES\.map/);
    expect(row).toMatch(/disabled=\{!findOn\}/);
    expect(row).toMatch(/className=\{`tp-range /);
  });
  it("PLAN still yields to FIND on the desktop (the shared-window rule survived the rewrite)", () => {
    expect(src).toMatch(/usePlanStore\.getState\(\)\.setOpen\(false\)/);
  });
  it("both shells import the ONE range list from the store (no second copy)", () => {
    expect(src).toMatch(/FIND_RANGES.*from "\.\.\/\.\.\/store\/find"/);
    const sheet = code(SRC("src/components/mobile/FindSheet.tsx"));
    expect(sheet).toMatch(/FIND_RANGES.*from "\.\.\/\.\.\/store\/find"/);
    expect(sheet).not.toMatch(/const FIND_RANGES =/);
  });
  it("the sky menu's quick-toggle stays ADDITIVE — only the object panels are solo", () => {
    const menu = code(SRC("src/components/panels/SkyContextMenu.tsx"));
    expect(menu).toMatch(/f\.setBody\(findBody, !findOn\)/);
    expect(menu).not.toMatch(/soloBody/);
  });
});
