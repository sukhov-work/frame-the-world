import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The VERIFY HARNESS's own fences (audit #3 C11 / C16 → F6, 2026-08-22).
 *
 * Track C's finding class was "checks that could not fail" — five of them, four written in the
 * session that shipped the feature they claimed to verify. These pin the two harness rules that
 * came out of it, in the one place a browser is not needed to check them: the source.
 *
 *  • **C11 — every CDP target a script opens, it closes.** An abandoned target holds a live
 *    WebGL context, and the owner's persistent Chrome (which the harness ATTACHES to and must
 *    never kill) exhausts contexts after ~5 suites. The discipline was operational ("restart
 *    Chrome between suites"); this makes it structural.
 *  • **C16 — no vacuous escape arm.** `getComputedStyle(el).visibility : "absent"` followed by
 *    `x === "hidden" || x === "absent"` passes when the element is GONE — on the exact rule the
 *    check exists to pin.
 *
 * Mutation that makes these RED: add a `/json/new` without a `trackTarget`, end a script on a
 * bare `process.exit`, or reintroduce an `|| "absent"`-shaped acceptance.
 */

const root = join(__dirname, "..");
const scriptsDir = join(root, "scripts");

/**
 * Verify scripts that are NOT CDP scripts. C11 is about returning browser targets, so a script
 * that never opens one is outside its scope — the rules below would be cargo-culting.
 *
 *  • `verify-chrome.mjs`   — the LAUNCHER (it starts the browser; it never opens a target)
 *  • `verify-cdp-cleanup.mjs` — the helper these rules are implemented in
 *  • `verify-proofs.mjs`   — the Lean/Mathlib proof gate (2026-08-24d). No browser at all: it
 *    shells out to `lake`, and it legitimately ends on `process.exit(code)` because a CLI gate's
 *    whole output IS its exit code.
 *
 * **This list cannot be used to smuggle a real CDP script out of the fence** — every member is
 * asserted target-free below, on the same `/json/new` marker the fence itself keys on. Adding a
 * name here that opens a target turns that test RED.
 */
const NON_CDP = new Set(["verify-chrome.mjs", "verify-cdp-cleanup.mjs", "verify-proofs.mjs"]);

const allVerifyScripts = readdirSync(scriptsDir).filter(
  (f) => f.startsWith("verify-") && f.endsWith(".mjs"),
);
const verifyScripts = allVerifyScripts.filter((f) => !NON_CDP.has(f));

const src = (f: string) => readFileSync(join(scriptsDir, f), "utf8");
// Strip comments before matching — but NOT the "//" inside a URL scheme. The naive
// `//[^\n]*` ate everything after `http://`, which silently DELETED the `/json/new` marker on
// any script that inlines its CDP URL: the C11 opener check below then never fired for that
// file. Measured on arrival: 22 of 24 scripts open a target and 21 were fenced — the one blind
// spot was the newest script, i.e. the fence was decaying exactly as new scripts were added.
// That is precisely the "checks that could not fail" class this file was written to kill, so the
// fence had quietly become an instance of its own finding. The lookbehind keeps every real
// line-comment stripped (positive control below).
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:\\])\/\/[^\n]*/g, "");

describe("verify harness — CDP target hygiene (C11)", () => {
  it("there are verify scripts to check (probe validated)", () => {
    expect(verifyScripts.length).toBeGreaterThan(10);
  });

  it("the NON_CDP exclusions really are CDP-free — the list cannot hide a browser script", () => {
    // Zero-result validation on the EXCLUSION itself, or "just exclude it" becomes the way this
    // fence dies.
    //
    // The marker cannot be `/json/new`: both structural exemptions NAME that endpoint without
    // ever calling it — `verify-chrome.mjs:132` prints the curl recipe as help text, and
    // `verify-cdp-cleanup.mjs` quotes it in its docblock while only ever calling `/json/close`.
    // Naming an endpoint is not driving a browser. The marker that separates them is whether the
    // script SPEAKS the protocol. Measured 2026-08-24d: a real CDP script (`verify-bestspot.mjs`)
    // scores 7, `verify-cdp-cleanup.mjs` 7 (it is the helper), `verify-chrome.mjs` 1 (it is the
    // launcher), and `verify-proofs.mjs` **0**.
    const CDP_DRIVING = /webSocketDebuggerUrl|Runtime\.evaluate|Page\.navigate|trackTarget\(|finishVerify\(/g;
    // The two STRUCTURAL exemptions predate this check and are exempt by role, not by score.
    const STRUCTURAL = new Set(["verify-chrome.mjs", "verify-cdp-cleanup.mjs"]);
    for (const f of NON_CDP) {
      expect(allVerifyScripts, `${f} is listed but does not exist`).toContain(f);
      if (STRUCTURAL.has(f)) continue;
      const hits = (code(src(f)).match(CDP_DRIVING) ?? []).length;
      expect(hits, `${f} speaks CDP and may not be excluded from C11`).toBe(0);
    }
    // POSITIVE CONTROL: the probe must fire on a script that really does drive a browser, or
    // "0 hits" proves nothing about the exclusions above.
    expect((code(src("verify-bestspot.mjs")).match(CDP_DRIVING) ?? []).length).toBeGreaterThan(0);
  });

  it("the comment-stripper does not blind the probe (zero-result validation)", () => {
    // Both halves matter: a stripper that eats URLs makes the opener check vacuous, and one that
    // stops stripping comments makes it fire on prose. Pin both directions.
    expect(code('const u = `http://127.0.0.1:${P}/json/new?about:blank`;')).toContain("/json/new");
    expect(code('await http("/json/new?about:blank", "PUT");')).toContain("/json/new");
    expect(code("const a = 1; // trackTarget( mentioned only in a comment")).not.toContain(
      "trackTarget(",
    );
    expect(code("/* block\n trackTarget( */ const b = 2;")).not.toContain("trackTarget(");
    // ...and the probe must actually SEE openers in the real corpus, or [] proves nothing.
    const openers = verifyScripts.filter((f) => /\/json\/new/.test(code(src(f))));
    expect(openers.length).toBeGreaterThan(10);
  });

  it("every script that OPENS a target registers it for cleanup", () => {
    const offenders: string[] = [];
    for (const f of verifyScripts) {
      const s = code(src(f));
      const opens = (s.match(/\/json\/new/g) ?? []).length;
      if (opens > 0 && !/trackTarget\(/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("no verify script ends on a bare process.exit — cleanup would be skipped", () => {
    const offenders: string[] = [];
    for (const f of verifyScripts) {
      if (/\bprocess\.exit\(/.test(code(src(f)))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("every script that opens a target EXITS through finishVerify", () => {
    // conventions/verify.md class (a) claims three things — imports the helper, calls
    // trackTarget, and "ends on `await finishVerify(code)`". The first two were fenced here; the
    // third was not, so a script could track its target and then fall off the end without ever
    // closing it. This is the missing half.
    const offenders: string[] = [];
    for (const f of verifyScripts) {
      const s = code(src(f));
      if (/\/json\/new/.test(s) && !/finishVerify\(/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("every script imports the cleanup module, so a THROW still returns its targets", () => {
    // The `finally` a top-level-await module doesn't have: importing the module installs the
    // uncaughtException / unhandledRejection handlers.
    const offenders = verifyScripts.filter((f) => !/verify-cdp-cleanup\.mjs/.test(src(f)));
    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: the probes can match", () => {
    expect(/\/json\/new/.test('await http("/json/new?about:blank", "PUT")')).toBe(true);
    expect(/\bprocess\.exit\(/.test(code("process.exit(1);"))).toBe(true);
    expect(/\bprocess\.exit\(/.test(code("// process.exit(1);"))).toBe(false);
    // …and the helper really implements what the fence assumes.
    const helper = readFileSync(join(scriptsDir, "verify-cdp-cleanup.mjs"), "utf8");
    expect(helper).toMatch(/json\/close/);
    expect(helper).toMatch(/process\.on\("uncaughtException"/);
    expect(helper).toMatch(/process\.on\("unhandledRejection"/);
  });
});

describe("verify harness — no vacuous acceptance arms (C16)", () => {
  it('no check accepts an "absent"/"missing" fallback as a pass', () => {
    const offenders: string[] = [];
    for (const f of verifyScripts) {
      const s = code(src(f));
      for (const m of s.matchAll(/:\s*"(absent|missing|none|null)"/g)) {
        // Reporting a sentinel in a DETAIL string is fine; accepting it as a pass is not.
        const tail = s.slice(m.index, m.index + 400);
        if (new RegExp(`===\\s*"${m[1]}"`).test(tail)) offenders.push(`${f} → ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: the probe matches the exact shape C16 found", () => {
    const bad = `const v = el ? getComputedStyle(el).visibility : "absent";
      check("hidden", v === "hidden" || v === "absent", v);`;
    const m = [...bad.matchAll(/:\s*"(absent|missing|none|null)"/g)];
    expect(m).toHaveLength(1);
    expect(new RegExp(`===\\s*"${m[0][1]}"`).test(bad.slice(m[0].index))).toBe(true);
  });
});
