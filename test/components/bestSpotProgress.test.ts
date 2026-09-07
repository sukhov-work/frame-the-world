/**
 * T118 + owner order 2026-09-08 — the ONE status chip on both shells (`bestSpotProgress`):
 * LOADING THE SCENE… · COMPUTING… · ✓ DONE, and nothing while the heatmap is off.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bestSpotProgress } from "../../src/components/controls/bestSpotCopy";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const base = { heatmapOn: true, held: false, solving: false, tilesPending: false, refining: false, ladderRung: 3 };

describe("bestSpotProgress", () => {
  it("is silent while the heatmap is off — the OFF line already says nothing is computed", () => {
    expect(bestSpotProgress({ ...base, heatmapOn: false, held: true, solving: true })).toBeNull();
  });
  it("names the hold first, then any running work, then done", () => {
    expect(bestSpotProgress({ ...base, held: true, solving: true })).toEqual({ key: "hold", label: "LOADING THE SCENE…" });
    expect(bestSpotProgress({ ...base, solving: true })).toEqual({ key: "computing", label: "COMPUTING…" });
    expect(bestSpotProgress({ ...base, tilesPending: true })).toEqual({ key: "computing", label: "COMPUTING…" });
    expect(bestSpotProgress({ ...base, refining: true })).toEqual({ key: "computing", label: "COMPUTING…" });
    expect(bestSpotProgress(base)).toEqual({ key: "done", label: "✓ DONE" });
  });
  it("says nothing before anything was asked — armed with no centre, or the frames before the first mirror", () => {
    // Measured on the phone twin: the poll right after the switch read `✓ DONE` before the hold
    // reached the store. Silence there; the switch already says ARMED — NO CENTRE when that is why.
    expect(bestSpotProgress({ ...base, ladderRung: -1 })).toBeNull();
    // …but a hold or a running job still speaks before first ink.
    expect(bestSpotProgress({ ...base, ladderRung: -1, held: true })?.key).toBe("hold");
    expect(bestSpotProgress({ ...base, ladderRung: -1, solving: true })?.key).toBe("computing");
  });
  it("is rendered by BOTH shells from the shared copy, as a live status region with the ◌ on busy states", () => {
    for (const f of ["src/components/panels/BestSpotPanel.tsx", "src/components/mobile/BestSpotSheet.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/bestSpotProgress\(s\)/);
      expect(src, f).toMatch(/role="status"/);
      expect(src, f).toMatch(/data-busy=\{progress\.key === "done" \? "0" : "1"\}/);
      expect(src, f).toMatch(/progress\.key !== "done" && <i aria-hidden="true">◌<\/i>/);
      // The label is the copy module's, never a literal here (comments stripped — they may cite it).
      const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/LOADING THE SCENE|COMPUTING…|✓ DONE/);
    }
    // The store field the hold writes, and the orchestrator's term that drives it.
    expect(read("src/store/bestSpot.ts")).toMatch(/\| "held"/);
    expect(read("src/components/globe/StylizedTiles.ts")).toMatch(/streamPending: sceneStreamPending,/);
  });
});
