/**
 * T126 (owner 2026-09-08b) — the per-session EDIT JOURNAL behind UNDO and "drop this session's
 * edits", for buildings AND user models (MESH_SUITE_PLAN §16). Pure + three-free: the data shape
 * and the reducers; the orchestrator (buildings) and the user-models store (models) own the
 * instance and the restore paths.
 *
 * The model, in three sentences. An ENTRY is one user ACTION — a gizmo release, a U8 height
 * release, a per-op ↺, a RESET ALL, a DROP — never a drag frame; it carries 1..N STEPS, each the
 * FULL persisted state of one target before and after (a building's raw override row, a model's
 * placement), so restoring a step is a verbatim put-back, not a re-edit. The BASELINE of a target
 * is its state at its first commit this session, re-based onto any later NON-dirty state (a
 * synced copy IS the persisted state the drop must leave alone) — "session edits" = current ≠
 * baseline, and the drop restores the baseline as one undoable entry.
 *
 * Targets are strings so the journal never imports either domain: `bldg|<overrideKey>` and
 * `model|<id>`. Snapshots are `unknown` here and compared by a stable JSON of their own keys
 * (rows and placements are flat objects of finite numbers / short strings — ordering is the only
 * hazard, and `stableJson` sorts).
 */

export type EditTarget = string;

export const bldgTarget = (overrideKey: string): EditTarget => `bldg|${overrideKey}`;
export const modelTarget = (id: string): EditTarget => `model|${id}`;
export const isBldgTarget = (t: EditTarget): boolean => t.startsWith("bldg|");
/** The domain key back out of a target (`overrideKey` for a building, the id for a model). */
export const targetKey = (t: EditTarget): string => t.slice(t.indexOf("|") + 1);

export interface EditStep<S = unknown> {
  target: EditTarget;
  /** The target's persisted state before the action (null = no row / not placed). */
  before: S | null;
  /** …and after it. */
  after: S | null;
}

export interface EditEntry<S = unknown> {
  /** Epoch ms. */
  at: number;
  /** What the action was, for the UNDO title: "extrude" · "move" · "reset" · "drop" … */
  label: string;
  steps: EditStep<S>[];
}

export interface EditJournal<S = unknown> {
  /** Chronological; the last is the next UNDO. */
  entries: EditEntry<S>[];
  /** Per target: the state at its first commit this session, re-based on non-dirty states. */
  baselines: Map<EditTarget, S | null>;
  /** "Same persisted state" — the guard and the baseline test use it; it receives the target so
   *  ONE journal can hold both domains (buildings compare rows without the `t` / `s` stamps — a
   *  re-stamp is not an edit and UNDO must work past a SYNC; models compare the placement fields).
   *  The default is a stable JSON compare. */
  same: (target: EditTarget, a: S | null, b: S | null) => boolean;
}

export type SameState<S> = (target: EditTarget, a: S | null, b: S | null) => boolean;

export function createJournal<S = unknown>(same: SameState<S> = (_t, a, b) => sameState(a, b)): EditJournal<S> {
  return { entries: [], baselines: new Map(), same };
}

/** Deterministic JSON — top-level keys sorted; nested values as-is (snapshots are flat). */
export function stableJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

export const sameState = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);

/** Max entries kept — the oldest fall off (a runaway session cannot grow without bound). */
export const JOURNAL_CAP = 200;

/**
 * Record one action. A step whose before equals its after is dropped (a no-op commit — a release
 * without movement); an entry with no steps left is not recorded. Baselines are set on a
 * target's FIRST appearance only. Mutates and returns the journal.
 */
export function recordEntry<S>(j: EditJournal<S>, label: string, steps: EditStep<S>[], at: number): boolean {
  const kept = steps.filter((s) => !j.same(s.target, s.before, s.after));
  if (kept.length === 0) return false;
  for (const s of kept) if (!j.baselines.has(s.target)) j.baselines.set(s.target, clone(s.before));
  j.entries.push({ at, label, steps: kept.map((s) => ({ target: s.target, before: clone(s.before), after: clone(s.after) })) });
  if (j.entries.length > JOURNAL_CAP) j.entries.splice(0, j.entries.length - JOURNAL_CAP);
  return true;
}

/** The entry UNDO would take: the last one overall, or the last that touched `target`. */
export function peekUndo<S>(j: EditJournal<S>, target?: EditTarget): EditEntry<S> | null {
  for (let i = j.entries.length - 1; i >= 0; i--) {
    const e = j.entries[i];
    if (!target || e.steps.some((s) => s.target === target)) return e;
  }
  return null;
}

/** How many entries touch `target` (the chip's UNDO count), or all of them. */
export function undoableCount<S>(j: EditJournal<S>, target?: EditTarget): number {
  if (!target) return j.entries.length;
  let n = 0;
  for (const e of j.entries) if (e.steps.some((s) => s.target === target)) n++;
  return n;
}

/**
 * Pop the entry UNDO takes and return the steps to RESTORE — each as `{ target, to }` where `to`
 * is the step's `before` — filtered by the unchanged-since guard: a step is restored only when the
 * target's CURRENT state still equals the step's `after` (a target edited by a LATER entry is left
 * to that entry). `current(target)` reads the live state. Null when nothing to undo.
 */
export function takeUndo<S>(
  j: EditJournal<S>,
  current: (target: EditTarget) => S | null,
  target?: EditTarget,
): { entry: EditEntry<S>; restores: Array<{ target: EditTarget; to: S | null }> } | null {
  const entry = peekUndo(j, target);
  if (!entry) return null;
  j.entries.splice(j.entries.indexOf(entry), 1);
  const restores: Array<{ target: EditTarget; to: S | null }> = [];
  for (const s of entry.steps) {
    if (!j.same(s.target, current(s.target), s.after)) continue;
    restores.push({ target: s.target, to: clone(s.before) });
  }
  return { entry, restores };
}

/** Targets with SESSION EDITS — a baseline exists and the current state differs from it. */
export function sessionEditedTargets<S>(
  j: EditJournal<S>,
  current: (target: EditTarget) => S | null,
  filter?: (target: EditTarget) => boolean,
): EditTarget[] {
  const out: EditTarget[] = [];
  for (const [t, base] of j.baselines) {
    if (filter && !filter(t)) continue;
    if (!j.same(t, current(t), base)) out.push(t);
  }
  return out;
}

export const hasSessionEdits = <S>(j: EditJournal<S>, current: (t: EditTarget) => S | null, target: EditTarget): boolean =>
  j.baselines.has(target) && !j.same(target, current(target), j.baselines.get(target) ?? null);

/**
 * The DROP: the steps that take each session-edited target (one, or every one) back to its
 * baseline — `{ target, before: current, after: baseline }`, ready to be applied AND recorded as
 * one entry (`recordEntry(j, "drop", steps, now)` after the caller restored them). Empty when
 * nothing to drop.
 */
export function dropSteps<S>(
  j: EditJournal<S>,
  current: (target: EditTarget) => S | null,
  target?: EditTarget,
): EditStep<S>[] {
  const targets = target ? (hasSessionEdits(j, current, target) ? [target] : []) : sessionEditedTargets(j, current);
  return targets.map((t) => ({ target: t, before: clone(current(t)), after: clone(j.baselines.get(t) ?? null) }));
}

/**
 * Re-base: for every target `pred` accepts, the baseline becomes its current state. The callers
 * pass "the local row is not dirty" (buildings, after a SYNC or a world fetch) — a synced copy or
 * an absent row IS the persisted state, so the drop must treat it as the floor.
 */
export function rebaseWhere<S>(
  j: EditJournal<S>,
  current: (target: EditTarget) => S | null,
  pred: (target: EditTarget, cur: S | null) => boolean,
): number {
  let n = 0;
  for (const t of j.baselines.keys()) {
    const cur = current(t);
    if (!pred(t, cur)) continue;
    if (j.same(t, cur, j.baselines.get(t) ?? null)) continue;
    j.baselines.set(t, clone(cur));
    n++;
  }
  return n;
}

/** Forget a target entirely (its row was invalidated by a re-bake, its model deleted). */
export function forgetTarget<S>(j: EditJournal<S>, target: EditTarget): void {
  j.baselines.delete(target);
  for (let i = j.entries.length - 1; i >= 0; i--) {
    const e = j.entries[i];
    e.steps = e.steps.filter((s) => s.target !== target);
    if (e.steps.length === 0) j.entries.splice(i, 1);
  }
}

function clone<S>(v: S | null): S | null {
  return v === null || v === undefined ? null : typeof v === "object" ? ({ ...(v as object) } as S) : v;
}
