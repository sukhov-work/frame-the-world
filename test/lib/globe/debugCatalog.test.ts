import { describe, expect, it } from "vitest";
import {
  DEBUG_ACTIONS,
  DEBUG_GROUPS,
  DEBUG_METRICS,
} from "../../../src/lib/globe/debugCatalog";

describe("debugCatalog — the DBG window's display contract", () => {
  const groupIds = new Set(DEBUG_GROUPS.map((g) => g.id));

  it("metric ids are unique (an id collision silently merges two rows)", () => {
    const seen = new Set<string>();
    for (const m of DEBUG_METRICS) {
      expect(seen.has(m.id), `duplicate metric id: ${m.id}`).toBe(false);
      seen.add(m.id);
    }
  });

  it("every metric belongs to a declared group", () => {
    for (const m of DEBUG_METRICS) {
      expect(groupIds.has(m.group), `${m.id} → unknown group ${m.group}`).toBe(true);
    }
  });

  it("every group renders at least one metric or action (no empty sections)", () => {
    const used = new Set<string>([
      ...DEBUG_METRICS.map((m) => m.group),
      ...DEBUG_ACTIONS.map((a) => a.group),
    ]);
    for (const g of DEBUG_GROUPS) {
      expect(used.has(g.id), `group ${g.id} has no metrics or actions`).toBe(true);
    }
  });

  it("every metric and action carries a non-trivial technical note", () => {
    for (const m of DEBUG_METRICS) {
      expect(m.note.trim().length, `${m.id} note too short`).toBeGreaterThanOrEqual(30);
      expect(m.label.trim().length, `${m.id} label empty`).toBeGreaterThan(0);
    }
    for (const a of DEBUG_ACTIONS) {
      expect(a.note.trim().length, `${a.id} note too short`).toBeGreaterThanOrEqual(30);
      expect(groupIds.has(a.group)).toBe(true);
    }
  });

  it("id grammar: provider-dotted, series:<frame ring>, or a panel-local source", () => {
    const providers = new Set([
      "canvas",
      "system",
      "tiles",
      "ultra",
      "astro",
      "camera",
      "terrain",
      "buildings",
      "models",
      "vector",
      "planning",
      // Panel-local sources (stores / browser APIs read by DebugPanel itself):
      "time",
      "workers",
      "mem",
    ]);
    for (const m of DEBUG_METRICS) {
      if (m.id.startsWith("series:")) {
        expect(m.id).toMatch(/^series:frame\.(dt|cpu|draw|gpu|calls|tris)$/);
        continue;
      }
      const head = m.id.split(".")[0];
      expect(providers.has(head), `${m.id} → unknown source "${head}"`).toBe(true);
      expect(m.id.includes("."), `${m.id} must be <source>.<key>`).toBe(true);
    }
  });

  it("thresholds are sane: warnAbove/budget are finite when present", () => {
    for (const m of DEBUG_METRICS) {
      if (m.budget !== undefined) expect(Number.isFinite(m.budget)).toBe(true);
      if (m.warnAbove !== undefined) expect(Number.isFinite(m.warnAbove)).toBe(true);
      if (m.warnBelow !== undefined) expect(Number.isFinite(m.warnBelow)).toBe(true);
    }
  });

  it("the brand fence's spirit: notes say PLUX-internal names, never the old product name", () => {
    for (const m of DEBUG_METRICS) {
      expect(m.note).not.toMatch(/frame\s+the\s+world/i);
    }
  });
});
