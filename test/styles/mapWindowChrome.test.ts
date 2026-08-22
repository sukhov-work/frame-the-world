import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// audit #3 C18: read/esc/ruleBody were triplicated across test/styles/*; C14: the fences were
// keyed on prose, indentation, units and taste literals. Both live in _css.ts now.
import { decl, fnBody, jsxElementEnd, num, read, ruleBody, VALUE } from "./_css";

/**
 * Owner micro-slice 2026-08-22 — the expanded-map chrome contract, fenced as text (the
 * swTileCache / hiddenPairs idiom: these are cross-FILE layout agreements no unit test of a
 * pure function can reach, and each one's violation is a real bug the owner already reported
 * once).
 *
 * 1. The manual-pan override is PERMANENT. Walking must never recentre the chart — not even
 *    when the eye leaves the visible bounds — so `MapWindow.tsx` may carry NO eye-motion
 *    re-arm, and the ◉ RE-CENTRE button must be the ONE path back to following.
 * 2/3. The attribution line owns the screen's bottom strip and the two bottom-anchored TIME
 *    surfaces (the /m dock, the desktop TimeScrubber) are LIFTED by `--mw-credit-h` rather
 *    than stacked under a z-bump — three files that must move together, and the safe-area
 *    inset must be paid exactly once (the credit bar owns it now, the dock no longer does).
 */
const root = join(__dirname, "..", "..");

const tsx = read("src/components/panels/MapWindow.tsx");
const mwCss = read("src/styles/map-window.css");
const tsCss = read("src/styles/time-scrubber.css");
const fpvCss = read("src/styles/mobile/fpv.css");
const index = read("src/pages/index.astro");

describe("MapWindow — the permanent manual-pan override (owner 2026-08-22 item 1)", () => {
  it("carries NO eye-motion re-arm: the FOLLOW_REARM_M detector and its anchor are gone", () => {
    // The prose may cite the retired constant by name (supersession notes are the house rule);
    // what must not survive is the declaration and the anchor it compared against.
    expect(tsx).not.toMatch(/(?:const|let)\s+FOLLOW_REARM_M/);
    expect(tsx).not.toContain("manualAnchor");
  });

  it("the ◉ button is the only path back WITHIN an open session", () => {
    // Not the only path full stop (audit #3 C13 caught the over-claim, DECISIONS 2026-08-22b
    // §D): `manualPan` and `setPanned` both live in the [open] effect, so close+reopen also
    // resets — on /m a PiP tap IS close. What must hold is that nothing clears it IMPLICITLY.
    // Two sites may write `manualPan = false`: its declaration, and recenterOnMe(). A third
    // is by definition an implicit re-arm — exactly what the owner ruled out.
    const clears = tsx.match(/manualPan = false/g) ?? [];
    expect(clears.length).toBe(2);
    expect(tsx).toMatch(/recenterOnMe[\s\S]{0,400}manualPan = false/);
    // …and it centres on the SAME anchor the radar/cone use, never on a raw camGeo.
    expect(tsx).toMatch(/recenterOnMe = \(\) => {[\s\S]{0,200}aimAnchorNow\(/);
  });

  it("the follow block still yields to the latch, and both pan paths still arm it", () => {
    expect(tsx).toMatch(/pointers\.size === 0 && !manualPan/);
    // Two call sites: the past-threshold branch of onPointerMove (a real drag — A1-1 moved it
    // out of panBy) and the 2-pointer branch of onPointerDown (zoom/twist pinches, which pan
    // nothing but are unambiguously manual).
    expect((tsx.match(/latchManualPan\(\);/g) ?? []).length).toBe(2);
    expect(tsx).toMatch(/pointers\.size === 1 && dragging[\s\S]{0,600}latchManualPan\(\);/);
    expect(tsx).toMatch(/pointers\.size === 2[\s\S]{0,200}latchManualPan\(\);/);
    // Wheel/chip zoom must NOT latch (the 2026-08-21g ruling stands).
    expect(tsx).not.toMatch(/const zoomBy = \(dz: number\) => {[\s\S]{0,300}latchManualPan/);
  });

  it("arms on a real DRAG only — a press that drifts a pixel must not latch (A1-1)", () => {
    // panBy() runs on every pointer move, including the jitter of a 500 ms long-press. Latching
    // there armed a permanent override from a 1 px drift, with ◉ the only way out.
    expect(tsx).not.toMatch(/const panBy = \([^)]*\) => {\s*latchManualPan\(\)/);
    // The latch rides the SAME threshold that decides drag-vs-press, in the same branch.
    expect(tsx).toMatch(
      /Math\.hypot\(e\.clientX - downX, e\.clientY - downY\) > DRAG_CANCEL_PX\s*\)\s*{\s*cancelPress\(\);\s*latchManualPan\(\);/,
    );
  });

  it("mirrors the latch into React on TRANSITIONS only — never per pan event or per frame", () => {
    expect(tsx).toMatch(/latchManualPan = \(\) => {\s*if \(manualPan\) return;/);
    // draw() runs at ~20 Hz: no state write may live in it. Lifted by BRACE MATCHING (C14) —
    // the old pattern ended at a 4-space-indented `};` and would have stopped fencing on any
    // re-indent, silently.
    const draw = fnBody(tsx, "draw");
    expect(draw).not.toContain("setPanned");
    // POSITIVE CONTROL: that really is draw()'s body and not an empty string — an empty
    // capture would satisfy the assertion above for the wrong reason (the C4 class).
    expect(draw).toContain("canvas.getContext");
  });
});

describe("MapWindow — bottom-edge attribution (owner 2026-08-22 item 3)", () => {
  it("the credit bar is a SIBLING of .mw, not a descendant of its transformed box", () => {
    // .mw carries the centring + drag transform on desktop — a position:fixed descendant would
    // be trapped in it and could never reach the screen's bottom edge.
    // C14: proved by DEPTH, not by the comment that used to follow the close tag — that
    // pattern went red the moment the comment was reworded or the file re-indented.
    const mwOpen = tsx.indexOf('<div className="mw"');
    expect(mwOpen).toBeGreaterThan(-1);
    const mwClose = jsxElementEnd(tsx, mwOpen);
    const bar = tsx.indexOf('className="mw-creditbar"');
    expect(bar).toBeGreaterThan(mwClose);
    // POSITIVE CONTROL: the matcher CAN place something inside .mw — the canvas is in there.
    expect(tsx.indexOf('className="mw-canvas"')).toBeLessThan(mwClose);
  });

  it("/m: pins one full-bleed line to the bottom edge that can never steal a drag", () => {
    const bar = ruleBody(mwCss, "body.m .mw-creditbar");
    expect(bar).toMatch(/position:\s*fixed/);
    expect(bar).toMatch(/bottom:\s*0/);
    expect(bar).toMatch(/pointer-events:\s*none/);
    expect(bar).toMatch(/height:\s*var\(--mw-credit-h\)/);
    expect(bar).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/); // iOS home indicator
    // The lifts below are `--mw-credit-h + inset`, so the inset must ADD to the height.
    expect(bar).toMatch(/box-sizing:\s*content-box/);
    const credit = ruleBody(mwCss, ".mw-credit");
    expect(credit).toMatch(/pointer-events:\s*auto/);
    expect(credit).toMatch(/white-space:\s*nowrap/);
  });

  it("desktop shows exactly ONE bottom line — never MapWindow's bar over the page credit", () => {
    // index.astro's .map-credit already pins a line to the bottom edge whose source list is a
    // strict SUPERSET of the map window's; two bars there = one drawn over the other.
    expect(ruleBody(mwCss, ".mw-creditbar")).toMatch(/display:\s*none/);
    const pageBar = ruleBody(index, "body.mw-open .map-creditbar");
    expect(pageBar).toMatch(/position:\s*fixed/);
    expect(pageBar).toMatch(/bottom:\s*0/);
    expect(pageBar).toMatch(/box-sizing:\s*content-box/);
    expect(pageBar).toMatch(/height:\s*var\(--mw-credit-h/);
    expect(ruleBody(index, ".map-creditbar")).toMatch(/pointer-events:\s*none/);
    // …and the LINK re-enables itself on the BASE rule, so it stays clickable in BOTH states
    // (scoping it to body.mw-open silently killed the closed-state attribution link once).
    expect(ruleBody(index, ".map-credit")).toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the FULL contractual source list on both shells", () => {
    for (const src of ["Esri", "Maxar", "Earthstar", "CARTO", "OpenStreetMap"]) {
      expect(tsx).toContain(src); // /m bar
      expect(index).toContain(src); // desktop bar (plus the globe's own sources)
    }
    // The desktop line is the promoted one, so it must remain the superset.
    for (const src of ["Cesium ion", "OpenMapTiles", "Copernicus", "NASA"]) {
      expect(index).toContain(src);
    }
  });

  it("LIFTS both bottom-anchored time surfaces by the var — no z-bump, no double inset", () => {
    expect(mwCss).toMatch(new RegExp(`--mw-credit-h:\\s*${VALUE}`)); // the one definition
    expect(ruleBody(tsCss, "body.mw-open .ts")).toMatch(/bottom:\s*calc\([^)]*var\(--mw-credit-h/);
    expect(ruleBody(fpvCss, "body.m.mw-open .m-bottom")).toMatch(
      /bottom:\s*calc\([\s\S]*var\(--mw-credit-h/,
    );
    // The dock handed its safe-area duty to the credit bar — paying it twice would leave a
    // dead band above the line on every notched iPhone.
    expect(ruleBody(fpvCss, "body.m.mw-open .md")).not.toContain("safe-area-inset-bottom");
  });
});

describe("MapWindow — the ◉ RE-CENTRE seat (owner 2026-08-22 item 2)", () => {
  it("is round, right-edge, and labelled", () => {
    const btn = ruleBody(mwCss, ".mw-recenter");
    expect(decl(btn, "right")).not.toBeNull(); // right-edge seat; the exact inset is taste (C14)
    // Equal width/height under .mw-btn's border-radius:999px = a circle, not a pill.
    const w = /width:\s*([\d.]+)rem/.exec(btn);
    const h = /height:\s*([\d.]+)rem/.exec(btn);
    expect(w?.[1]).toBe(h?.[1]);
    expect(tsx).toMatch(/aria-label="Centre the map on me"/);
    // The lit/muted state must ride `panned`; how the template literal is spaced is not a
    // contract (C14).
    expect(tsx).toMatch(/mw-recenter[\s\S]{0,40}panned[\s\S]{0,40}is-panned/);
  });

  it("can never slide under the z-24 FPV altitude column (A1-2)", () => {
    // .m-altcol is lifted ABOVE this z-20 window while the map is open, so an occluded ◉ is
    // worse than a missing one: the tap nudges the eye's altitude. The seat carries a FLOOR.
    const mBtn = ruleBody(mwCss, "body.m .mw-recenter");
    expect(mBtn).toMatch(/top:\s*min\(/);
    expect(mBtn).toMatch(/var\(--m-altcol-bottom/);
    expect(mBtn).toMatch(/var\(--m-altcol-h/);
    // The tokens are published by the column's own rule, so the two cannot drift apart.
    // Unit-agnostic (C14): 96px → 6rem is a harmless reformat, not a contract break.
    expect(fpvCss).toMatch(new RegExp(`--m-altcol-bottom:\\s*${VALUE}`));
    expect(fpvCss).toMatch(new RegExp(`--m-altcol-h:\\s*${VALUE}`));
    expect(ruleBody(fpvCss, ".m-altcol")).toMatch(/bottom:\s*calc\(var\(--m-altcol-bottom\)/);
  });

  it("keeps the desktop attribution unclipped on narrow windows (A1-3)", () => {
    // The clamp floor stops the shrink long before the 265-char list stops needing width, so
    // below the breakpoint the line WRAPS and the bar grows — and --mw-credit-h grows with it
    // so time-scrubber.css's lift tracks automatically.
    expect(index).toMatch(/@media \(max-width: 60rem\)/);
    const narrow = /@media \(max-width: 60rem\) {([\s\S]*?)\n  }\n/.exec(index);
    expect(narrow).not.toBeNull();
    expect(narrow![1]).toMatch(new RegExp(`--mw-credit-h:\\s*${VALUE}`));
    expect(narrow![1]).toMatch(/white-space:\s*normal/);
  });

  it("lifts EVERY bottom-anchored desktop instrument, not just the scrubber (A1-15)", () => {
    // .tr is deliberately co-axial with the scrub rail; lifting one and not the other splits
    // them by exactly --mw-credit-h.
    const tr = read("src/styles/time-readout.css");
    expect(ruleBody(tr, "body.mw-open .tr")).toMatch(/bottom:\s*calc\([^)]*var\(--mw-credit-h/);
  });

  it("clears the /m PiP instead of colliding with it", () => {
    // The /m right rail is ONE stack — [+ −] · [PiP] · [◉] — expressed through two shared
    // tokens rather than repeated literals, so nudging the top row moves all three together
    // (owner 2026-08-22b top-aligned the PiP with the pills; three literals would have drifted).
    expect(mwCss).toMatch(new RegExp(`--mw-top-y:\\s*${VALUE}`));
    // The PiP is a TRUE miniature only while its vw and dvh fractions are EQUAL (equal
    // fractions ⇒ its aspect equals the viewport's, so the same camera needs no projection
    // swap). C14: pin that EQUALITY, not the taste value 32 — which the owner may retune.
    const pipH = num(decl(ruleBody(mwCss, ":root"), "--mw-pip-h"));
    const pipW = num(decl(ruleBody(mwCss, "body.m .mw-pip"), "width"));
    expect(pipH).not.toBeNull();
    expect(pipW).toBe(pipH);
    const top = ruleBody(mwCss, "body.m .mw-top");
    const pip = ruleBody(mwCss, "body.m .mw-pip");
    const mBtn = ruleBody(mwCss, "body.m .mw-recenter");
    // PiP top === top-row top: byte-identical expressions, which is the alignment contract.
    const rung = /top:\s*calc\(var\(--mw-top-y\) \+ env\(safe-area-inset-top\)\)/;
    expect(top).toMatch(rung);
    expect(pip).toMatch(rung);
    expect(pip).toMatch(/height:\s*var\(--mw-pip-h\)/);
    // …and the button hangs off the PiP's bottom edge, derived from the same two tokens
    // (inside the min() whose second arm is the .m-altcol floor — see the A1-2 test).
    // Derived from the SAME two tokens as the rung above it (C14: the tokens are the
    // contract; the gap literal between them is taste).
    const seat = decl(mBtn, "top") ?? "";
    for (const token of ["--mw-top-y", "--mw-pip-h", "safe-area-inset-top"]) {
      expect({ token, present: seat.includes(token) }).toEqual({ token, present: true });
    }
    // The full-width top row must stay click-through, or it would swallow taps on the PiP
    // now that the two share a rung.
    expect(ruleBody(mwCss, ".mw-top")).toMatch(/pointer-events:\s*none/);
  });

  it("hides every mid-stack surface the PiP hole now sits over", () => {
    // The PiP is a clearRect hole, so any fixed 1 ≤ z < 20 chrome overlapping it paints
    // INSIDE it (batch #5's "minimap inside minimap"). Top-aligning the PiP with .mw-top
    // moved the hole onto `.m-status` (Plux · account · GUIDE · DESKTOP, fixed at z 10).
    // Capture the WHOLE rule (selectors + body). The earlier form stopped at
    // `visibility: hidden`, which made the `display: none` assertion below structurally
    // unfalsifiable — the captured text could never contain it (audit #3 C4).
    const rule = /((?:body\.m\.mw-open\s+\.[\w-]+,\s*)+body\.m\.mw-open\s+\.[\w-]+)\s*{([^}]*)}/.exec(
      fpvCss,
    );
    expect(rule, "the mw-open hide group is missing").not.toBeNull();
    const selectors = [rule![1]];
    expect(rule![2]).toMatch(/visibility:\s*hidden/);
    // …and the z-2 DOM label layers, which are positioned for the FULL-SCREEN view while the
    // hole shows a scaled miniature — they can only ever paint in the wrong place inside it.
    for (const cls of [
      ".mm",
      ".m-fpvhud",
      ".fh-chip",
      ".m-status",
      ".sky-names",
      ".geo-labels",
      ".bldg-edit-label",
    ]) {
      expect(selectors![0]).toContain(`body.m.mw-open ${cls}`);
    }
    // Discovery guard: every DOM layer ANY scene module mounts must be in the list above.
    // Scans the directory rather than a hardcoded file list — that list happened to be
    // complete by coincidence, so a new module mounting a layer escaped it (audit #3 C15).
    const sceneDir = join(root, "src/components/globe/scene");
    const layerClasses = new Set<string>();
    for (const f of readdirSync(sceneDir).filter((n) => n.endsWith(".ts"))) {
      const src = read(`src/components/globe/scene/${f}`);
      for (const m of src.matchAll(/\.className = "([\w-]+)"/g)) layerClasses.add(m[1]);
    }
    expect(layerClasses.size).toBeGreaterThan(0); // probe validated: it CAN match
    for (const cls of layerClasses) {
      expect(selectors![0]).toContain(`body.m.mw-open .${cls}`);
    }
    // visibility, never display:none — the islands must stay mounted and subscribed. Asserted
    // against the rule BODY (group 2), which genuinely could carry it.
    expect(rule![2]).not.toMatch(/display:\s*none/);
  });
});
