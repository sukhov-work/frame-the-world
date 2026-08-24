#!/usr/bin/env node
/**
 * verify-proofs.mjs — the machine-checked-math gate.
 *
 * Builds `formal/` (Lean 4 + Mathlib) and then AUDITS THE AXIOMS of every theorem. The build
 * alone is not the gate: a proof stubbed with `sorry` still BUILDS, it just emits a warning that
 * is easy to miss in 2,000 lines of Lake output. So this script fails on three things:
 *
 *   1. the build failing at all
 *   2. any `sorry` / `admit` / `native_decide` in the sources (the last extends the trusted base —
 *      it is banned in Mathlib for the same reason)
 *   3. any theorem in the audit list depending on `sorryAx`, or on an axiom outside the three
 *      Lean standard ones (`propext`, `Classical.choice`, `Quot.sound`)
 *
 * Cost: ~4 s warm. Not wired into `npm test` — vitest must stay fast and must not require a
 * 7.4 GB Mathlib tree. Run it when `formal/**` or the math it mirrors changes.
 *
 *   node scripts/verify-proofs.mjs          # build + audit
 *   node scripts/verify-proofs.mjs --list   # just print what is proved
 *
 * Setup on a fresh machine (elan is NOT on the default non-login PATH):
 *   curl https://elan.lean-lang.org/elan-init.sh -sSf | sh
 *   lake exe cache get && lake build   # from the REPO ROOT
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMAL = join(ROOT, "formal");
const ELAN_BIN = join(homedir(), ".elan", "bin");
const LAKE = join(ELAN_BIN, "lake");

/** The three axioms every honest Lean proof is allowed to rest on. */
const STANDARD_AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);

/** Source-level bans. `native_decide` compiles the claim and trusts the compiler's answer. */
const BANNED = [/\bsorry\b/, /\badmit\b/, /\bnative_decide\b/];

let failures = 0;
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`PASS  ${msg}`);

if (!existsSync(LAKE)) {
  console.error(
    `lake not found at ${LAKE}.\n` +
      `Install the Lean toolchain:  curl https://elan.lean-lang.org/elan-init.sh -sSf | sh`,
  );
  process.exit(2);
}
if (!existsSync(join(ROOT, ".lake", "packages", "mathlib"))) {
  console.error(
    `Mathlib is not fetched. Run:  lake exe cache get && lake build   # from the REPO ROOT\n` +
      `(~7.4 GB of prebuilt .olean; it is gitignored and regenerated, never committed.)`,
  );
  process.exit(2);
}

const env = { ...process.env, PATH: `${ELAN_BIN}:${process.env.PATH ?? ""}` };
// cwd is the REPO ROOT: the Lake workspace root lives there (see lakefile.toml's header for why),
// while srcDir/buildDir/packagesDir keep every source and artifact under formal/.
const run = (args, opts = {}) =>
  execFileSync(LAKE, args, { cwd: ROOT, env, encoding: "utf8", ...opts });

// ── 1. source-level bans ────────────────────────────────────────────────────────────────────────
const leanFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".lake") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".lean") && e.name !== "Audit.lean") leanFiles.push(p);
  }
};
walk(FORMAL);

for (const f of leanFiles) {
  // strip /- block -/ and -- line comments so a PROSE mention of "sorry" is not a false positive
  const src = readFileSync(f, "utf8")
    .replace(/\/-[\s\S]*?-\//g, " ")
    .replace(/--[^\n]*/g, " ");
  for (const re of BANNED) {
    if (re.test(src)) fail(`${f.replace(ROOT + "/", "")} contains ${re}`);
  }
}
if (!failures) pass(`no sorry / admit / native_decide in ${leanFiles.length} Lean sources`);

// ── 2. build ────────────────────────────────────────────────────────────────────────────────────
try {
  const out = run(["build"]);
  if (/error/i.test(out)) fail(`lake build reported errors:\n${out}`);
  else pass("lake build (Ftw + Mathlib)");
} catch (e) {
  fail(`lake build failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  process.exit(1);
}

// ── 3. axiom audit ──────────────────────────────────────────────────────────────────────────────
// Enumerate every `theorem` declared in the sources, then ask Lean what each one depends on.
const theorems = [];
for (const f of leanFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^theorem\s+([A-Za-z_][A-Za-z0-9_'.]*)/gm)) {
    theorems.push(m[1]);
  }
}
if (theorems.length === 0) fail("no theorems found to audit — the regex or the layout changed");

if (process.argv.includes("--list")) {
  console.log(`\n${theorems.length} theorems:`);
  for (const t of theorems) console.log(`  Ftw.${t}`);
  process.exit(0);
}

const auditSrc =
  "import Ftw\n" + theorems.map((t) => `#print axioms Ftw.${t}`).join("\n") + "\n";
const auditPath = join(ROOT, ".lake", "audit-generated.lean");
const { writeFileSync } = await import("node:fs");
writeFileSync(auditPath, auditSrc);

let auditOut = "";
try {
  auditOut = run(["env", "lean", auditPath]);
} catch (e) {
  fail(`axiom audit could not run:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  process.exit(1);
}

let audited = 0;
for (const line of auditOut.split("\n")) {
  const m = line.match(/^'([^']+)' depends on axioms: \[(.*)\]$/);
  if (!m) continue;
  audited++;
  const [, name, axiomList] = m;
  const axioms = axiomList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rogue = axioms.filter((a) => !STANDARD_AXIOMS.has(a));
  if (rogue.length) fail(`${name} depends on non-standard axioms: ${rogue.join(", ")}`);
}
// A theorem proved with NO axioms at all prints "does not depend on any axioms" — also fine.
audited += (auditOut.match(/does not depend on any axioms/g) ?? []).length;

if (audited !== theorems.length) {
  fail(`audited ${audited} of ${theorems.length} theorems — some produced no axiom line`);
} else if (!failures) {
  pass(`${audited} theorems rest on only [propext, Classical.choice, Quot.sound]`);
}

console.log(
  failures === 0
    ? `\n${theorems.length} PASS / 0 FAIL — the machine-checked math holds.`
    : `\n${failures} FAILURE(S).`,
);
process.exit(failures === 0 ? 0 : 1);
