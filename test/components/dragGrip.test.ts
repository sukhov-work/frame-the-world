/**
 * DragGrip / ResizeGrip (owner report 2026-09-08: the debug window "somehow loses its drag
 * handle", and its resize handle sat at the TOP instead of the bottom-right corner).
 *
 * Two causes, both pinned here: (1) the cascade — the grips carry `.tip`, whose
 * `position: relative` shares specificity with the grips' `position: absolute`, and a BUILD
 * emits tips.css last (in-flow grips: ◢ at the top-left, ⠿ a panel-height off-screen);
 * (2) the clamps — the old drag floor let the panel's top reach 4 px, hiding the 14 px tab that
 * floats 3 px ABOVE the top edge, and a centre-anchored resize lifted the top edge by half the
 * growth with no bound at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GRIP_CLEAR_PX, clampDragOffset, clampResize } from "../../src/components/ui/DragGrip";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ruleBody = (css: string, selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*(?:,[^{]*)?{([^}]*)}`).exec(css);
  return m ? m[1] : "";
};

describe("the grips stay absolutely positioned whatever order the stylesheets land in", () => {
  it("pins position:absolute with a compound selector that outranks `.tip { position: relative }`", () => {
    const css = read("src/styles/drag-grip.css");
    const tips = read("src/styles/tips.css");
    expect(ruleBody(tips, ".tip")).toMatch(/position:\s*relative/); // the collision is real
    // The pin: `.drag-grip.tip, .resize-grip.tip { position: absolute }` — (0,2,0) beats (0,1,0)
    // regardless of source order.
    const pin = /\.drag-grip\.tip,\s*\.resize-grip\.tip\s*{([^}]*)}/.exec(css);
    expect(pin, "the compound-selector pin is gone").not.toBeNull();
    expect(pin![1]).toMatch(/position:\s*absolute/);
    // …and both grips still declare the class pair the pin targets.
    const tsx = read("src/components/ui/DragGrip.tsx");
    expect(tsx).toContain('className="drag-grip tip"');
    expect(tsx).toContain('className="resize-grip tip"');
  });

  it("keeps the move tab OUTSIDE the window above its top-right corner, the resize grip at the bottom-right", () => {
    const css = read("src/styles/drag-grip.css");
    expect(ruleBody(css, ".drag-grip")).toMatch(/bottom:\s*calc\(100% \+ 3px\)/);
    expect(ruleBody(css, ".drag-grip")).toMatch(/right:\s*0/);
    expect(ruleBody(css, ".resize-grip")).toMatch(/right:\s*1px/);
    expect(ruleBody(css, ".resize-grip")).toMatch(/bottom:\s*1px/);
  });
});

describe("the clamps keep the move tab reachable", () => {
  const view = { width: 1600, height: 950 };

  it("the tab (14 px, 3 px above the top edge) always fits above the panel", () => {
    expect(GRIP_CLEAR_PX).toBeGreaterThanOrEqual(17);
  });

  it("a drag cannot lift the panel's top edge above the clear line", () => {
    // A centred 544×779 window at (528, 85.5) — the debug window's dev rect — dragged up by 400 px.
    const base = { left: 528, top: 85.5, width: 544 };
    const { y } = clampDragOffset(0, -400, base, view);
    expect(base.top + y).toBeCloseTo(GRIP_CLEAR_PX, 5);
    // …and a modest drag is untouched.
    expect(clampDragOffset(30, -20, base, view)).toEqual({ x: 30, y: -20 });
    // The old sliver rules still hold on the other edges.
    expect(clampDragOffset(5000, 5000, base, view)).toEqual({ x: view.width - 48 - base.left, y: view.height - 48 - base.top });
  });

  it("a centre-anchored resize stops where its top edge would cross the clear line", () => {
    // Top at 200 → 178 px of room above the clear line → at most 356 px of extra height (the
    // window grows symmetrically: half of it goes up) — well under the 92 % viewport cap (874).
    const start = { top: 200, w: 544, h: 400 };
    const grown = clampResize(start, 0, 600, view);
    expect(grown.h).toBeCloseTo(400 + 2 * (200 - GRIP_CLEAR_PX), 5);
    expect(grown.w).toBe(544);
    // The debug window's own dev rect (top 85.5, h 779): the viewport cap binds first there.
    expect(clampResize({ top: 85.5, w: 544, h: 779 }, 0, 400, view).h).toBe(view.height * 0.92);
    // Shrinking is free (down to the floor), and the 92 % caps still apply.
    expect(clampResize(start, -1000, -1000, view)).toEqual({ w: 200, h: 130 });
    expect(clampResize({ top: 600, w: 300, h: 200 }, 5000, 5000, view)).toEqual({ w: view.width * 0.92, h: view.height * 0.92 });
    // A window whose top is already above the line may not grow at all.
    expect(clampResize({ top: 10, w: 300, h: 400 }, 0, 100, view).h).toBe(400);
  });
});
