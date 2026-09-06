/**
 * shadowArms — the pure argument algebra behind `verify-temporal-stability.mjs`'s shadow A/B
 * (T77 slice A-rest, 2026-09-06).
 *
 * It lives here, importable and unit-tested (`test/scripts/shadowArms.test.ts`), because the two
 * mistakes it prevents are both SILENT — a run finishes, prints numbers, and the numbers answer a
 * different question than the one asked:
 *
 *  1. **Arm bleed.** `__globe.shadowRig()` is a LIVE seam and each arm is a write on the same
 *     boot. Merging arm N over "whatever the engine currently holds" leaves arm N−1's levers on,
 *     so a `{"cascades":false}` arm poisons every arm after it. Every arm is therefore built from
 *     the full NULL IDENTITY, then the run-wide `--rig` / `--rig-json`, then the arm's own keys —
 *     so the same JSON always produces the same write, whatever ran before it.
 *  2. **A typo that measures the stock picture.** The engine takes an override only when the key
 *     is present (`if ("cascades" in opts)`), so `{"cascade":false}` writes nothing at all and the
 *     arm reports the stock numbers under an A/B label. Unknown keys are a hard error here.
 *
 * Nothing in this module touches CDP, the filesystem or the clock.
 */

/**
 * The writable half of `__globe.shadowRig(opts)`, at its identity — `null` on every key means
 * "take the tier's value", which is the shipped render path. Kept in ONE place so a new lever is
 * added to the seam and to the harness in the same edit; the harness fence asserts the two agree.
 */
export const RIG_IDENTITY = Object.freeze({
  keySnapTexels: null,
  moveTexels: null,
  biasTexels: null,
  normalBiasTexels: null,
  cascades: null,
});

/** The legs `shimmerLeg` can run, in the order it runs them. */
export const LEG_NAMES = Object.freeze(["control", "scrub", "scrub4x", "pan"]);

/** The implicit first arm: no write at all, so its rows keep the bare leg names. */
export const STOCK = "stock";

const RIG_KEYS = Object.keys(RIG_IDENTITY);

/** Throw on any key the engine seam would silently ignore. `where` names the flag in the message. */
export function assertRigKeys(opts, where) {
  if (opts === null || opts === undefined) return opts;
  if (typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error(`${where}: expected a JSON object of shadowRig options, got ${JSON.stringify(opts)}`);
  }
  for (const k of Object.keys(opts)) {
    if (!RIG_KEYS.includes(k)) {
      throw new Error(`${where}: unknown shadowRig option "${k}" (of ${RIG_KEYS.join(", ")}) — the engine ignores it, so the arm would measure the STOCK picture under an A/B label`);
    }
  }
  return opts;
}

/** `--rig-json '<json>'` → an options object (or null). Validated, so a typo fails at parse time. */
export function parseRigJson(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const o = typeof raw === "string" ? JSON.parse(raw) : raw;
  return assertRigKeys(o, "--rig-json");
}

/**
 * `--arms '{"ladderOff":{"cascades":false}}'` → `[{ name: "stock", opts: null }, …]`.
 * `stock` is always first and is never a write; an arm may not be called `stock`, and a name may
 * not contain `/` (the leg keys are `<arm>/<leg>` and would become ambiguous).
 */
export function parseArms(raw) {
  const spec = raw === null || raw === undefined || raw === "" ? {} : typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new Error(`--arms: expected a JSON object of { name: shadowRigOptions }, got ${JSON.stringify(spec)}`);
  }
  const arms = [{ name: STOCK, opts: null }];
  for (const [name, opts] of Object.entries(spec)) {
    if (name === STOCK) throw new Error(`--arms: "${STOCK}" is the implicit no-write arm and cannot be redefined`);
    if (name.includes("/")) throw new Error(`--arms: arm name "${name}" may not contain "/" (leg keys are <arm>/<leg>)`);
    assertRigKeys(opts, `--arms.${name}`);
    arms.push({ name, opts });
  }
  return arms;
}

/**
 * The write for one arm: the null identity, then the run-wide options, then the arm's own. Always
 * carries every key, so a lever the previous arm turned on is explicitly turned back off.
 */
export function armOptions(runWide, armOpts) {
  return { ...RIG_IDENTITY, ...(runWide ?? {}), ...(armOpts ?? {}) };
}

/** `--legs control,scrub` → the leg names to run, in `LEG_NAMES` order. Unknown name = hard error. */
export function selectLegs(raw) {
  if (raw === null || raw === undefined || raw === "") return [...LEG_NAMES];
  const wanted = String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (wanted.length === 0) throw new Error("--legs: no legs named");
  for (const l of wanted) {
    if (!LEG_NAMES.includes(l)) throw new Error(`--legs: unknown leg "${l}" (of ${LEG_NAMES.join(",")})`);
  }
  return LEG_NAMES.filter((l) => wanted.includes(l));
}

/**
 * The stored key for one (arm, leg). The stock arm keeps the BARE leg name so a run made with
 * `--arms` stays readable against every run stored before the flag existed.
 */
export function legKey(armName, legName) {
  return armName === STOCK ? legName : `${armName}/${legName}`;
}
