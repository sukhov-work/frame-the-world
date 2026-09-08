import { describe, expect, it } from "vitest";
import {
  bldgTarget,
  createJournal,
  dropSteps,
  forgetTarget,
  hasSessionEdits,
  JOURNAL_CAP,
  modelTarget,
  peekUndo,
  rebaseWhere,
  recordEntry,
  sessionEditedTargets,
  stableJson,
  takeUndo,
  targetKey,
  undoableCount,
  type EditJournal,
} from "../../../src/lib/edit/editJournal";

/**
 * T126 (owner 2026-09-08b) — the per-session edit journal (MESH_SUITE_PLAN §16): one entry per
 * COMMIT, full-state steps, per-target UNDO with the unchanged-since guard, the baseline that
 * re-bases onto non-dirty states, the DROP as one undoable entry.
 */

type Row = { sy: number; t: number; s?: number };
/** The buildings' comparator: the stamps `t` / `s` are not edits — a handle clicked without movement
 *  re-stamps `t`, a SYNC stamps `s` (the orchestrator passes `sameOverrideState`, the same rule). */
const sameRow = (_t: string, a: Row | null, b: Row | null): boolean =>
  a === null || b === null ? a === b : stableJson({ ...a, t: undefined, s: undefined }) === stableJson({ ...b, t: undefined, s: undefined });
const A = bldgTarget("dnipro|cell-1|7");
const B = bldgTarget("dnipro|cell-1|9");
const M = modelTarget("m-1");

/** A tiny "world": the live state per target, the thing `current()` reads. */
function world(init: Record<string, Row | null> = {}) {
  const state = new Map<string, Row | null>(Object.entries(init));
  return {
    current: (t: string) => state.get(t) ?? null,
    set: (t: string, v: Row | null) => void state.set(t, v),
    /** Commit through the journal exactly as the orchestrator does: snapshot, mutate, record. */
    commit(j: EditJournal<Row>, label: string, t: string, v: Row | null, at = 1) {
      const before = state.get(t) ?? null;
      state.set(t, v);
      return recordEntry(j, label, [{ target: t, before, after: v }], at);
    },
    /** Apply the restores UNDO / DROP hand back. */
    restore(rs: Array<{ target: string; to: Row | null }>) {
      for (const r of rs) state.set(r.target, r.to);
    },
  };
}

describe("editJournal — targets + stable comparison", () => {
  it("target strings round-trip their domain key", () => {
    expect(targetKey(bldgTarget("v|c|1"))).toBe("v|c|1");
    expect(targetKey(modelTarget("abc"))).toBe("abc");
  });
  it("stableJson ignores key order and undefined fields; null is null", () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    expect(stableJson({ a: 1, s: undefined })).toBe(stableJson({ a: 1 }));
    expect(stableJson(null)).toBe("null");
  });
});

describe("editJournal — recording", () => {
  it("one entry per commit; a no-op commit (before = after) records nothing", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    expect(w.commit(j, "extrude", A, { sy: 1.5, t: 10 })).toBe(true);
    expect(w.commit(j, "extrude", A, { sy: 1.5, t: 10 })).toBe(false); // same row again
    expect(j.entries).toHaveLength(1);
    expect(peekUndo(j)?.label).toBe("extrude");
  });
  it("the baseline is the state at a target's FIRST commit (null when there was no row)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world({ [B]: { sy: 2, t: 1, s: 1 } });
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 });
    w.commit(j, "extrude", A, { sy: 1.8, t: 11 });
    w.commit(j, "scale", B, { sy: 2.5, t: 12 });
    expect(j.baselines.get(A)).toBeNull();
    expect(j.baselines.get(B)).toEqual({ sy: 2, t: 1, s: 1 });
  });
  it("snapshots are copies — mutating the live row later does not rewrite history", () => {
    const j = createJournal<Row>(sameRow);
    const row: Row = { sy: 1.5, t: 10 };
    recordEntry(j, "extrude", [{ target: A, before: null, after: row }], 1);
    row.sy = 9;
    expect(j.entries[0].steps[0].after).toEqual({ sy: 1.5, t: 10 });
  });
  it("the cap drops the oldest entries", () => {
    const j = createJournal<Row>(sameRow);
    for (let i = 0; i < JOURNAL_CAP + 5; i++)
      recordEntry(j, "e", [{ target: A, before: { sy: i, t: i }, after: { sy: i + 1, t: i + 1 } }], i);
    expect(j.entries).toHaveLength(JOURNAL_CAP);
    expect(j.entries[0].steps[0].before).toEqual({ sy: 5, t: 5 });
  });
});

describe("editJournal — UNDO", () => {
  it("undoes the last entry overall, restoring the step's full BEFORE state (a synced copy stays synced)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world({ [A]: { sy: 1.2, t: 1, s: 5 } }); // synced at boot
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 });
    const u = takeUndo(j, w.current);
    expect(u?.entry.label).toBe("extrude");
    expect(u?.restores).toEqual([{ target: A, to: { sy: 1.2, t: 1, s: 5 } }]);
    w.restore(u!.restores);
    expect(w.current(A)).toEqual({ sy: 1.2, t: 1, s: 5 });
    expect(j.entries).toHaveLength(0);
    expect(takeUndo(j, w.current)).toBeNull();
  });
  it("per-target UNDO takes the armed mesh's last entry, not another mesh's later one", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 });
    w.commit(j, "extrude", B, { sy: 2, t: 11 });
    expect(undoableCount(j, A)).toBe(1);
    expect(undoableCount(j, B)).toBe(1);
    expect(undoableCount(j)).toBe(2);
    const u = takeUndo(j, w.current, A);
    expect(u?.restores).toEqual([{ target: A, to: null }]);
    w.restore(u!.restores);
    expect(w.current(A)).toBeNull();
    expect(w.current(B)).toEqual({ sy: 2, t: 11 }); // untouched
    expect(peekUndo(j)?.steps[0].target).toBe(B);
  });
  it("repeated UNDO walks back through history (no redo, an undo is not journaled)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.commit(j, "extrude", A, { sy: 1.8, t: 11 }, 2);
    expect(w.commit(j, "rotate", A, { sy: 1.8, t: 12 }, 3)).toBe(false); // a re-stamp only — not an action
    w.commit(j, "rotate", A, { sy: 2.2, t: 13 }, 3);
    w.restore(takeUndo(j, w.current, A)!.restores);
    expect(w.current(A)).toEqual({ sy: 1.8, t: 12 }); // the un-journaled re-stamp is what stood before 2.2
    w.restore(takeUndo(j, w.current, A)!.restores);
    expect(w.current(A)).toEqual({ sy: 1.5, t: 10 });
    w.restore(takeUndo(j, w.current, A)!.restores);
    expect(w.current(A)).toBeNull();
    expect(takeUndo(j, w.current, A)).toBeNull();
  });
  it("the unchanged-since guard: a multi-step entry restores only the targets a later entry did not own", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.commit(j, "extrude", B, { sy: 2, t: 11 }, 2);
    // A DROP ALL: one entry, two steps back to the baselines (null, null).
    const steps = dropSteps(j, w.current);
    expect(steps.map((s) => s.target).sort()).toEqual([A, B].sort());
    for (const s of steps) w.set(s.target, s.after);
    recordEntry(j, "drop", steps, 3);
    // Then A is edited again by a LATER entry.
    w.commit(j, "extrude", A, { sy: 3, t: 20 }, 4);
    // Arm B, UNDO → the drop entry: B comes back, A is left to its later entry.
    const u = takeUndo(j, w.current, B);
    expect(u?.entry.label).toBe("drop");
    expect(u?.restores).toEqual([{ target: B, to: { sy: 2, t: 11 } }]);
    w.restore(u!.restores);
    expect(w.current(A)).toEqual({ sy: 3, t: 20 });
  });
});

describe("editJournal — the baseline and the DROP", () => {
  it("session edits = current ≠ baseline; the drop takes each target back and is one undoable entry", () => {
    const j = createJournal<Row>(sameRow);
    const w = world({ [B]: { sy: 2, t: 1, s: 1 } });
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.commit(j, "scale", B, { sy: 2.5, t: 12 }, 2); // dirty again (s < t)
    w.commit(j, "move", M, { sy: 1, t: 13 }, 3);
    expect(hasSessionEdits(j, w.current, A)).toBe(true);
    expect(sessionEditedTargets(j, w.current)).toHaveLength(3);
    // The single-mesh drop.
    const one = dropSteps(j, w.current, A);
    expect(one).toEqual([{ target: A, before: { sy: 1.5, t: 10 }, after: null }]);
    for (const s of one) w.set(s.target, s.after);
    recordEntry(j, "drop", one, 4);
    expect(hasSessionEdits(j, w.current, A)).toBe(false);
    expect(dropSteps(j, w.current, A)).toEqual([]);
    // The global drop takes the rest (models included) — and UNDO brings it all back at once.
    const all = dropSteps(j, w.current);
    expect(all.map((s) => s.target).sort()).toEqual([B, M].sort());
    for (const s of all) w.set(s.target, s.after);
    recordEntry(j, "drop", all, 5);
    expect(sessionEditedTargets(j, w.current)).toEqual([]);
    expect(w.current(B)).toEqual({ sy: 2, t: 1, s: 1 });
    const u = takeUndo(j, w.current);
    expect(u?.restores).toHaveLength(2);
    w.restore(u!.restores);
    expect(w.current(B)).toEqual({ sy: 2.5, t: 12 });
    expect(w.current(M)).toEqual({ sy: 1, t: 13 });
  });
  it("rebaseWhere moves the baseline of NON-dirty targets to their current row (a SYNC landed)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.commit(j, "extrude", B, { sy: 2, t: 11 }, 2);
    // The SYNC stamps A synced; B stays dirty (edited while the push was in flight, say).
    w.set(A, { sy: 1.5, t: 10, s: 20 });
    const notDirty = (_t: string, cur: Row | null) => cur === null || (cur.s !== undefined && cur.s >= cur.t);
    expect(rebaseWhere(j, w.current, notDirty)).toBe(1);
    expect(hasSessionEdits(j, w.current, A)).toBe(false); // the drop leaves the synced state alone
    expect(hasSessionEdits(j, w.current, B)).toBe(true);
    // UNDO still works past the sync — and puts the pre-edit row (none) back, a dirty state.
    expect(undoableCount(j, A)).toBe(1);
    const u = takeUndo(j, w.current, A);
    expect(u?.restores).toEqual([{ target: A, to: null }]);
  });
  it("a SYNC stamp on the edited row is not an edit: UNDO still restores past it (the unchanged-since guard ignores `s`)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world({ [A]: { sy: 1.2, t: 1, s: 1 } });
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.set(A, { sy: 1.5, t: 10, s: 20 }); // the push landed
    const u = takeUndo(j, w.current, A);
    expect(u?.restores).toEqual([{ target: A, to: { sy: 1.2, t: 1, s: 1 } }]);
    // …but with the DEFAULT comparator the stamp would have blocked it — which is why the
    // orchestrator must pass `sameRow`.
    const j2 = createJournal<Row>();
    const w2 = world({ [A]: { sy: 1.2, t: 1, s: 1 } });
    w2.commit(j2, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w2.set(A, { sy: 1.5, t: 10, s: 20 });
    expect(takeUndo(j2, w2.current, A)?.restores).toEqual([]);
  });
  it("a world fetch that replaced my synced copy is not a session edit (the re-base covers absent rows too)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.set(A, { sy: 1.5, t: 10, s: 20 }); // synced
    const notDirty = (_t: string, cur: Row | null) => cur === null || (cur.s !== undefined && cur.s >= cur.t);
    rebaseWhere(j, w.current, notDirty);
    w.set(A, null); // the world reconcile deleted my synced copy (someone reset it)
    rebaseWhere(j, w.current, notDirty);
    expect(hasSessionEdits(j, w.current, A)).toBe(false);
  });
  it("forgetTarget drops a target from every entry and the baselines (a re-bake invalidated its row)", () => {
    const j = createJournal<Row>(sameRow);
    const w = world();
    w.commit(j, "extrude", A, { sy: 1.5, t: 10 }, 1);
    w.commit(j, "extrude", B, { sy: 2, t: 11 }, 2);
    const steps = dropSteps(j, w.current);
    for (const s of steps) w.set(s.target, s.after);
    recordEntry(j, "drop", steps, 3);
    forgetTarget(j, A);
    expect(j.baselines.has(A)).toBe(false);
    expect(j.entries.every((e) => e.steps.every((s) => s.target !== A))).toBe(true);
    expect(j.entries).toHaveLength(2); // B's commit + the drop (now B-only)
  });
});
