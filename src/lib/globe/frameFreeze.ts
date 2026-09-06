/**
 * THE DETERMINISTIC-CAPTURE SEAM (T77 / T94, 2026-09-06) — one module-level latch that makes two
 * captures of one settled boot BYTE-IDENTICAL, so `verify-visual-sweep --compare --tolerance 0`
 * can gate pixels instead of only the UI chrome.
 *
 * ── Why a clock and not a pile of pause flags ────────────────────────────────────────────────
 * The canvas has no per-frame randomness (`Math.random()` appears only in CONSTRUCTION — star
 * positions/phases, `scene/stars.ts:73-80,203`; that is a BOOT-to-BOOT source, T95, and no freeze
 * can touch it). Everything that moves between two frames of a parked camera is driven by ONE of
 * three things:
 *
 *   1. a wall clock — `uNowMs` (the F1 screen-door building reveal, `scene/buildingMaterial.ts:54`),
 *      the stars'/Milky Way's `uTime` twinkle (`scene/stars.ts:547`), the pins' shimmer
 *      (`Pins.ts:393`), and every dt-driven ease (the orchestrator's `dtMs`, the ground's reveal /
 *      drape / 2D grade, the ULTRA look, the eclipse darkness);
 *   2. tile STREAMING — a tile that lands between the two captures changes the picture, and
 *      (through `terrainEpoch`) re-arms every enriched seat;
 *   3. the shadow rig's REFRESH — the demand-driven cascade re-renders its depth map on a
 *      `maxStaleMs` timer as well as on movement (`StylizedTiles.ts:6494`, `:6594`).
 *
 * So the seam holds a CLOCK, holds STREAMING, and latches the SHADOW rig. Holding the clock is
 * what makes every ease a no-op: `dtMs` becomes 0 and `x += (target − x) * easeK(0, τ)` is an
 * identity. Nothing is overwritten and nothing has to be "restored" field by field.
 *
 * ── The clock is SKEWED, not stopped ─────────────────────────────────────────────────────────
 * `frameNow()` subtracts the total wall time spent frozen. Unfreezing therefore resumes exactly
 * where the freeze started: no ease sees the freeze as one giant frame, no twinkle jumps, and the
 * `last*Ms` fields every consumer keeps stay valid without being written back. That is the whole
 * of "turning it off restores every held value and resumes".
 *
 * ── The OFF state is the production path, provably ───────────────────────────────────────────
 * `frameNow()` returns `performance.now()` — the same expression, not an equivalent one — on the
 * only state a shipped build can be in (never frozen ⇒ `skewMs === 0`). Every other contribution
 * is an `if (frameHeld(...))` whose branch is never taken. `test/lib/globe/frameFreeze.test.ts`
 * locks both. `window.__globe.freezeFrame` — the ONLY way to reach `setFrameFrozen(true)` — is
 * DEV-only (`import.meta.env.DEV`), so a shipped build can never arm the seam. The one call a
 * production bundle does make is the orchestrator's `setFrameFrozen(false)` on dispose, and on a
 * never-frozen seam that is an early return that writes nothing.
 *
 * Contract owner: the rendering track (T77). Registered in `.claude/conventions/contracts.md` §3.
 */

/** The three independent halves of a freeze — separable so a harness can ATTRIBUTE the residual. */
export type FreezePart = "clock" | "streaming" | "shadow";

/** Every part, in the order a report should print them. */
export const FREEZE_PARTS: readonly FreezePart[] = ["clock", "streaming", "shadow"];

export type FreezeParts = Record<FreezePart, boolean>;

export type FreezeSnapshot = {
  frozen: boolean;
  /** `performance.now()` at the freeze instant (the value `frameNow()` is pinned to). */
  frozenAtMs: number;
  /** Total wall ms this page has spent frozen — the skew `frameNow()` subtracts. */
  skewMs: number;
  parts: FreezeParts;
  /** What the freeze is actually holding: the registered per-frame clocks plus every hold a
   *  module has REPORTED taking since the freeze began. Empty parts contribute nothing. */
  held: string[];
  /** Clocks registered by the live scene — the upper bound on the `clock` half of `held`. */
  clocks: string[];
};

const ALL_ON: FreezeParts = { clock: true, streaming: true, shadow: true };

let frozen = false;
/** `performance.now()` at the freeze instant. */
let frozenAtRealMs = 0;
/** Total wall ms spent frozen, subtracted by `frameNow()` so unfreezing is seamless. */
let skewMs = 0;
let parts: FreezeParts = { ...ALL_ON };
/** Per-frame clocks the live scene reads through `frameNow()` (registered at construction). */
const clocks = new Set<string>();
/** Holds a module reported taking during THIS freeze. */
let holds = new Set<string>();

/**
 * The per-frame wall clock every animated LOOK reads instead of `performance.now()`.
 *
 * OFF (the only state a shipped build reaches): the identity — `performance.now()`.
 * FROZEN: the freeze instant, minus the skew, so it does not advance.
 * AFTER a freeze: `performance.now()` minus the time spent frozen, so consumers resume.
 */
export function frameNow(): number {
  if (!frozen && skewMs === 0) return performance.now(); // production: the identity path
  return (frozen && parts.clock ? frozenAtRealMs : performance.now()) - skewMs;
}

/** True while `part` is being held. The guard every non-clock contribution branches on. */
export function frameHeld(part: FreezePart): boolean {
  return frozen && parts[part];
}

/** Declare a per-frame clock this scene reads through `frameNow()`. Called ONCE, at construction
 *  — never per frame — so the snapshot can name what a clock freeze covers. */
export function registerFrameClock(id: string): () => void {
  clocks.add(id);
  return () => clocks.delete(id);
}

/** Report a hold actually taken. Only ever called from inside an `if (frameHeld(...))` branch, so
 *  it costs a shipped build nothing. */
export function noteFrameHold(id: string): void {
  if (frozen) holds.add(id);
}

function snapshot(): FreezeSnapshot {
  const held = [...holds];
  if (frozen && parts.clock) held.push(...[...clocks].map((c) => `clock:${c}`));
  held.sort();
  return {
    frozen,
    frozenAtMs: frozenAtRealMs,
    skewMs,
    parts: { ...parts },
    held,
    clocks: [...clocks].sort(),
  };
}

/** The read half — what the seam is holding right now. */
export function frameFreezeState(): FreezeSnapshot {
  return snapshot();
}

/**
 * Freeze / thaw. `want` selects the halves (default: all three); it exists so a harness can
 * attribute a residual to ONE source instead of guessing.
 *
 * Freezing twice re-arms (a fresh instant, a fresh `held` list). Thawing an already-thawed seam
 * is a no-op. Returns the snapshot at the moment of the call — after a thaw, `held` is what the
 * freeze actually held, which is the proof a harness records.
 */
export function setFrameFrozen(on: boolean, want?: Partial<FreezeParts>): FreezeSnapshot {
  const nowReal = performance.now();
  // Bank the elapsed freeze — but ONLY if the CLOCK half was actually held. A `{ clock: false }`
  // freeze (the attribution mode: hold streaming and the rig, let time run) never pinned
  // `frameNow()`, so adding its wall duration to the skew would step the clock BACKWARDS on
  // release — a negative `dtMs` in every ease, from a seam whose whole job is not to disturb them.
  const bank = () => {
    if (frozen && parts.clock) skewMs += nowReal - frozenAtRealMs;
  };
  if (on) {
    bank(); // re-arm: a second freeze banks the first one's elapsed time first
    frozen = true;
    frozenAtRealMs = nowReal;
    parts = { ...ALL_ON, ...want };
    holds = new Set();
    return snapshot();
  }
  if (!frozen) return snapshot();
  const out = snapshot(); // the proof: what was held, before the state is torn down
  bank();
  frozen = false;
  parts = { ...ALL_ON };
  holds = new Set();
  return { ...out, frozen: false, skewMs };
}

/** TEST-ONLY: return the module to its boot state (module state outlives a vitest case). */
export function __resetFrameFreeze(): void {
  frozen = false;
  frozenAtRealMs = 0;
  skewMs = 0;
  parts = { ...ALL_ON };
  holds = new Set();
  clocks.clear();
}
