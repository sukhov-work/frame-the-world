/**
 * CDP TARGET CLEANUP for the verify harness (audit #3 C11 → F6, 2026-08-22).
 *
 * Every `verify-*.mjs` opens one or two CDP targets with `/json/new` and — with the single
 * exception of `verify-pin-reframe.mjs` — never closed them. Each abandoned target holds a live
 * WebGL context, and environment class (a) (the owner's persistent chrome-playwright instance,
 * which the harness ATTACHES to and must never kill) exhausts contexts after roughly five
 * suites. The discipline held operationally — "restart Chrome between suites" — but the leak
 * was real, and this session's desktop leg doubled it to two targets per run.
 *
 * Usage in a verify script:
 *
 *   import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
 *   // inside attach(), right after `/json/new` returns:
 *   trackTarget(PORT, target.id);
 *   // …and instead of `process.exit(failures === 0 ? 0 : 1)`:
 *   await finishVerify(failures === 0 ? 0 : 1);
 *
 * `finishVerify` is also wired to `uncaughtException` / `unhandledRejection`, which is the only
 * `finally` a top-level-await module has: a script that throws half way through still closes
 * what it opened. Closing goes over plain HTTP (`/json/close/<id>`) so it works even when the
 * WebSocket is already dead — which is exactly the case a crashed script leaves behind.
 */

/**
 * A verify script's own assertion failure, as opposed to a crash. Scripts whose `fail()` is
 * called synchronously from `if (cond) fail(...)` THROW this instead of calling `process.exit`
 * — an `await finishVerify()` there would let the script carry on past its own failure, and a
 * bare `process.exit` skips the cleanup. The handler below prints it without a stack.
 */
export class VerifyFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "VerifyFailure";
  }
}

/** @type {{port: string, id: string}[]} */
const open = [];
let finishing = false;

/** Register a target for cleanup. Call it the moment `/json/new` returns. */
export function trackTarget(port, id) {
  if (id) open.push({ port: String(port), id });
}

/** Close every tracked target. Never throws — a dead browser is not a test failure. */
export async function closeTrackedTargets() {
  const targets = open.splice(0, open.length);
  await Promise.all(
    targets.map(({ port, id }) =>
      fetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => {}),
    ),
  );
  return targets.length;
}

/** Close, report, and exit with `code`. The one exit point a verify script should use. */
export async function finishVerify(code) {
  if (finishing) return;
  finishing = true;
  const n = await closeTrackedTargets();
  if (n > 0) console.log(`\ncleanup  closed ${n} CDP target(s)`);
  process.exit(code);
}

// The top-level-await module's `finally`: a throw anywhere still returns the contexts.
const report = (label, e) => {
  // A VerifyFailure is the script's OWN assertion — print the reason, not a stack trace.
  if (e instanceof VerifyFailure) console.error(`\nFAIL: ${e.message}`);
  else console.error(`\n${label}:`, e?.stack ?? e);
};
process.on("uncaughtException", (e) => {
  report("UNCAUGHT", e);
  void finishVerify(1);
});
process.on("unhandledRejection", (e) => {
  report("UNHANDLED REJECTION", e);
  void finishVerify(1);
});
