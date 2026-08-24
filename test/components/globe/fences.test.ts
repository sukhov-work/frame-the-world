import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BESTSPOT, PLAN } from "../../../src/components/globe/tuning";

/**
 * Static fences for trap classes that are cheap to pin at write time (audit-2 C2 — the
 * heightAt-consumer class showed a fence here would have caught A1 the day it was written).
 * Style: file-content guards, the pinchHardening idiom.
 */

const root = join(__dirname, "..", "..", "..");
const sceneDir = join(root, "src", "components", "globe", "scene");

describe("mirror-never-seats — scene modules don't read stores directly", () => {
  // The ONLY sanctioned VALUE-imports of src/store/* inside scene/*: the two feed modules
  // (they are store bridges BY DESIGN). Type-only imports are erased and allowed anywhere.
  // Everything else gets its data PUSHED per-frame by the orchestrator — a scene module that
  // starts reading a store invites the deadband-mirror-seat bug (2026-08-18h, DECISIONS §Traps).
  const SANCTIONED: Record<string, string[]> = {
    "planFeed.ts": ["store/plan", "store/sky"],
    "minimapFeed.ts": ["store/minimap"],
    // THE THIRD ENTRY, added 2026-08-24 (BEST SPOT S3d) — deliberate and reviewed, not incidental.
    //
    // `store/bestSpot` carries BOTH halves of one seam: the panel's REQUEST (kind, radius, lift,
    // ULTRA, ramp, and the resolved scoring profile behind `scoringEpoch`) and the engine's ANSWER
    // (`_syncBestSpot`'s eleven honesty channels). `bestSpotFeed` needs all of the first group on
    // the frame it decides whether to post a job, and it is the ONE writer of the second — exactly
    // the two properties that made `planFeed` and `minimapFeed` bridges. Pushing the request half
    // through the orchestrator instead would be a per-frame copy of eleven store fields with its
    // own staleness, which is the deadband-mirror-seat bug this whole fence exists to prevent.
    //
    // What is NOT sanctioned and is separately fenced below: reading `store/bestSpot` from any
    // OTHER engine module. That is how the desktop shell gate could be bypassed.
    "bestSpotFeed.ts": ["store/bestSpot"],
  };

  it("no unsanctioned value-import of src/store/* in scene/*", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(sceneDir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(sceneDir, file), "utf8");
      const importRe = /import\s+(type\s+)?({[^}]*}|[\w*\s,]+)\s+from\s+"([^"]*\/store\/[^"]+)"/g;
      for (const m of src.matchAll(importRe)) {
        const isTypeOnly = m[1] !== undefined || /^{\s*type\s[^}]*}$/.test(m[2].trim());
        const target = m[3].replace(/^.*\/store\//, "store/");
        if (isTypeOnly) continue;
        if (!(SANCTIONED[file] ?? []).includes(target)) offenders.push(`${file} → ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("setClearColor fence — the navy-night-sky trap stays dead", () => {
  // setClearColor encodes to the renderer OUTPUT space and lands sRGB values in the LINEAR
  // composer buffer (DECISIONS §Traps GL). Fix has always been scene.background. Zero call
  // sites today — this fence keeps it that way.
  it("no .setClearColor( call anywhere under src/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|astro)$/.test(e.name) && readFileSync(p, "utf8").match(/\.setClearColor\(/))
          offenders.push(p.slice(root.length + 1));
      }
    };
    walk(join(root, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("InstancedMesh.boundingSphere caching — the Pins raycast trap (three regression)", () => {
  // three caches boundingSphere on first raycast. GlobeControls raycasts BEFORE pins load
  // (count 0 → EMPTY sphere); without invalidation every later pick misses. Pins.ts
  // invalidateBounds() nulls the sphere on instance changes — this test pins the THREE
  // behaviour that makes that necessary, so a three upgrade that fixes it tells us.
  const makeMesh = () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 8),
      new THREE.MeshBasicMaterial(),
      4,
    );
    mesh.count = 0;
    return mesh;
  };
  const rayAtOrigin = () => {
    const rc = new THREE.Raycaster();
    rc.set(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    return rc;
  };

  it("a count-0 first raycast caches an empty sphere; instances added later are missed", () => {
    const mesh = makeMesh();
    expect(rayAtOrigin().intersectObject(mesh)).toHaveLength(0); // caches the empty sphere
    mesh.count = 1;
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    expect(rayAtOrigin().intersectObject(mesh)).toHaveLength(0); // the trap: still missed
  });

  it("nulling boundingSphere (the Pins invalidateBounds fix) restores picking", () => {
    const mesh = makeMesh();
    rayAtOrigin().intersectObject(mesh);
    mesh.count = 1;
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
    expect(rayAtOrigin().intersectObject(mesh).length).toBeGreaterThan(0);
  });
});

/**
 * PER-FRAME WASTE fences (audit #3 T38 — A1-10 / A1-11 / A2-2, fixed 2026-08-22).
 *
 * All three regressions are invisible in a screenshot and cheap in a unit test: they are
 * *source shapes*, not values. Each block below names the mutation that turns it red.
 */
describe("per-frame waste (T38)", () => {
  const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

  it("focalCone allocates its wedge geometry ONCE and rewrites in place (A1-10)", () => {
    const src = read("src", "components", "globe", "scene", "focalCone.ts");
    // RED if `rebuild()` goes back to `new THREE.BufferGeometry()` per call: HFOV_EPS_DEG 0.1
    // sits below the aim stick's sweep rate, so "per rebuild" meant "per frame while held".
    const rebuild = src.slice(src.indexOf("function rebuild("), src.indexOf("return {"));
    expect(rebuild).not.toMatch(/new THREE\.BufferGeometry\(/);
    expect(rebuild).not.toMatch(/\.geometry\.dispose\(\)/);
    expect(rebuild).toMatch(/needsUpdate\s*=\s*true/);
    // POSITIVE CONTROL: the slice really is the rebuild body, not an empty string.
    expect(rebuild).toMatch(/builtHFovDeg\s*=\s*hFovDeg/);
  });

  it("neither canvas radar calls getComputedStyle in its paint (A1-11)", () => {
    // RED if either surface goes back to resolving tokens inline: ~320 forced style recalcs a
    // second between them at 20 Hz, for values declared once on :root.
    for (const file of ["MapWindow.tsx", "MiniMap.tsx"]) {
      const src = read("src", "components", "panels", file);
      expect({ file, hits: [...src.matchAll(/getComputedStyle/g)].length }).toEqual({
        file,
        hits: 0,
      });
      expect(src).toMatch(/from "\.\.\/\.\.\/lib\/theme\/cssInk"/);
    }
    // POSITIVE CONTROL: the probe CAN match — a module that legitimately resolves style inline.
    expect(read("src", "components", "globe", "scene", "streetNames.ts")).toMatch(
      /getComputedStyle/,
    );
  });

  it("the /m PiP's second render brackets the shadow map (A2-2)", () => {
    const src = read("src", "components", "globe", "GlobeCanvas.tsx");
    const pip = src.slice(src.indexOf("const pip = tilesHandle?.pipRect()"));
    // RED if the bracket is dropped: three re-renders the whole 1024² depth pass per frame on
    // the most heat-constrained surface (mid tier — the coarse-pointer ceiling — has shadows on).
    expect(pip).toMatch(/shadowMap\.autoUpdate\s*=\s*false;[\s\S]{0,400}?renderer\.render\(/);
    // …and RESTORES it, so nothing downstream silently inherits a frozen shadow map.
    expect(pip).toMatch(/renderer\.render\([\s\S]{0,200}?shadowMap\.autoUpdate\s*=\s*shadowAuto/);
  });
});

/**
 * `tuning.ts` IS PURE DATA — no `three`, no colour (the file's own contract at :11-16 and
 * `conventions/globe-tuning.md`). Colour flows ONLY through the GL token bridge
 * `lib/theme/tokens.ts` (ADR D14), so a tuning entry may NAME which token/ramp a module uses and
 * may never define the value. Pinned when BEST SPOT's render block landed (SPEC_V2 §6.11): a heat
 * map is the single most tempting place in this repo to paste an 11-stop palette, and the ramp is
 * carried as an ID (`rampId "inferno"`) precisely so it cannot be.
 */
describe("tuning.ts — three-free and colour-free", () => {
  const src = readFileSync(join(root, "src", "components", "globe", "tuning.ts"), "utf8");
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

  it("no three import anywhere in the file", () => {
    expect(src).not.toMatch(/from\s+"three(\/|")/);
    expect(src).not.toMatch(/require\(\s*"three"/);
  });

  it("no colour literal anywhere in the file", () => {
    // POSITIVE CONTROL: the probe really does match colours (audit-2's zero-result rule).
    expect('{ ink: "#ff8800", veil: "rgb(0,0,0)" }'.match(COLOUR)).toHaveLength(2);
    expect(src.match(COLOUR)).toBeNull();
  });

  it("the BESTSPOT block carries RAMP IDS, not stops", () => {
    const start = src.indexOf("export const BESTSPOT = {");
    expect(start).toBeGreaterThan(0); // the block exists — the assertions below are not vacuous
    const block = src.slice(start, src.indexOf("} as const;", start));
    expect(block.match(COLOUR)).toBeNull();
    expect(block).toMatch(/rampId:\s*"inferno"/);
    expect(block).toMatch(/rampAltId:\s*"turbo"/);
    // §6.10: the sheet is depth-TESTED, so it must stay OUT of the depth-free planning band (9,
    // `tangentOverlay.OVERLAY_RENDER_ORDER`) or it sorts non-deterministically against the radar.
    expect(block).toMatch(/renderOrder:\s*4,/);
    expect(block).toMatch(/markerRenderOrder:\s*5,/);
  });
});

/**
 * DESKTOP EXPERIMENTAL TOGGLES — the mobile fence (owner 2026-08-22h: "nothing must change on
 * mobile", said three times).
 *
 * Hiding the chips is NOT isolation. `ftw:view-prefs:v1` is ONE localStorage blob shared by
 * both shells on the same origin, `useCameraStore` is one store, and /m mounts the SAME
 * GlobeCanvas + StylizedTiles modules — so a user who enables a chip on desktop genuinely has
 * `hq3dMap: true` in their store when they open /m in that browser. The only thing that can
 * stop the engine acting on it is a gate on the read itself, which is why these two rules pin
 * WHERE the flags may be named and WHAT must be on the line when they are.
 */
describe("ULTRA HQ — desktop-only, fenced at the read", () => {
  const FLAGS = ["ultraQuality"];
  const srcDir = join(root, "src");
  /** Files allowed to name the flags at all, and why. */
  const OWNERS: Record<string, string> = {
    "lib/prefs.ts": "the persisted key + its sanitiser clause",
    "store/camera.ts": "the store field + setter",
    "components/globe/StylizedTiles.ts": "the ONE engine reader — every read AND-ed with hqAllowed",
    "components/panels/CameraTiltPanel.tsx": "the desktop chips (rendered behind the same predicate)",
    // Added 2026-08-22j (T45 S5). The shadow rig's map size and `shadowMap.enabled` are
    // CONSTRUCTION-TIME — three latches the depth target on first render and a live
    // `shadowMap.enabled` flip recompiles every material — so they are read from the PERSISTED
    // pref at boot, before any island has mounted and therefore before the store exists. That is
    // the second (and only other) sanctioned path in ULTRA_PLAN.md §2. It earns its place here
    // by folding the shell gate into the same expression as the read; the test below pins that.
    "lib/globe/ultraBoot.ts": "the BOOT-time reader for construction-time levers — read AND-ed with ultraShellAllowed()",
  };

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|astro)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk(srcDir);

  it("only the sanctioned owner files may name the flag at all", () => {
    // POSITIVE CONTROL first: the probe must be able to match, or an empty offender list below
    // would prove nothing (audit-2's zero-result-validation rule).
    const named = files.filter((f) => FLAGS.some((k) => readFileSync(f, "utf8").includes(k)));
    expect(named.length).toBeGreaterThan(0);
    const offenders = named
      .map((f) => f.slice(srcDir.length + 1).replace(/\\/g, "/"))
      .filter((rel) => !(rel in OWNERS));
    expect(offenders).toEqual([]);
    // …and every sanctioned owner really does still carry one (a stale allow-list is a fence
    // that has quietly stopped fencing).
    const relNamed = new Set(named.map((f) => f.slice(srcDir.length + 1).replace(/\\/g, "/")));
    expect([...Object.keys(OWNERS)].filter((k) => !relNamed.has(k))).toEqual([]);
  });

  it("every ENGINE read sits on a line that also names the shell gate", () => {
    const orch = readFileSync(join(srcDir, "components/globe/StylizedTiles.ts"), "utf8");
    // `hqAllowed` is `!isMobileShell && !coarsePointerShell`; both terms are load-bearing —
    // the /m ROUTE alone is not enough (index.astro keeps touch laptops on desktop, and /m's
    // DESKTOP chip sends a phone to /?d=1 permanently).
    expect(orch).toMatch(/const hqAllowed =\s*!isMobileShell && !coarsePointerShell;/);
    const unguarded = orch
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      // The declaration lines in the docblock/interface are prose, not reads: require an
      // actual store access on the line.
      .filter(({ line }) => /getState\(\)\.ultraQuality|camStore\.ultraQuality/.test(line))
      .filter(({ line }) => !line.includes("hqAllowed"));
    // The DEV probe prints the RAW pref deliberately (that is how /m proves `pref:true` with
    // `on:false`), so it is the one exemption — and it must live inside the probe.
    const probeOnly = unguarded.filter(({ n }) => {
      const ctx = orch.split("\n").slice(Math.max(0, n - 12), n).join("\n");
      return ctx.includes("ultra: () => ({");
    });
    expect(unguarded.filter((u) => !probeOnly.includes(u)).map((u) => `:${u.n} ${u.line.trim()}`)).toEqual([]);
    expect(probeOnly.length).toBeGreaterThan(0); // the exemption is real, not a dead clause
  });

  // --- the SECOND reader (T45 S5, 2026-08-22j) -----------------------------------------------
  // `lib/globe/ultraBoot.ts` exists because three latches a shadow map's size on first render
  // and recompiles every material on a live `shadowMap.enabled` flip, so those two levers have
  // to be decided at boot — before any island has mounted, i.e. before the store exists. A
  // second reader is a second chance to leak the flag onto `/m`, so it carries the same two
  // obligations as the orchestrator, machine-checked.
  it("the BOOT reader gates its flag read on the same line", () => {
    const src = readFileSync(join(srcDir, "lib/globe/ultraBoot.ts"), "utf8");
    const reads = src
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /ultraQuality/.test(line) && !/^\s*\*/.test(line));
    // POSITIVE CONTROL: an empty `reads` would make the assertion below vacuously true.
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.filter((r) => !r.line.includes("ultraShellAllowed")).map((r) => `:${r.n} ${r.line.trim()}`),
    ).toEqual([]);
  });

  it("the BOOT gate and the engine gate test the SAME two terms", () => {
    // Two expressions of one rule is a drift risk, and the failure mode is invisible: a shell
    // where one gate opens and the other does not is a `/m` session running ULTRA's shadow rig
    // with none of its look, or the reverse. Neither can be expressed as one function — the
    // orchestrator's must stay the literal the test above pins, and this one runs before the
    // orchestrator module is even imported — so pin that both name both terms instead.
    const boot = readFileSync(join(srcDir, "lib/globe/ultraBoot.ts"), "utf8");
    const gate = boot.slice(boot.indexOf("export function ultraShellAllowed"));
    expect(gate).toMatch(/classList\.contains\("m"\)/); // the /m ROUTE
    expect(gate).toMatch(/matchMedia\("\(pointer: coarse\)"\)/); // the HARDWARE
    expect(gate).toMatch(/!isMobileShell && !coarsePointerShell/); // …AND-ed, not OR-ed
    const orch = readFileSync(join(srcDir, "components/globe/StylizedTiles.ts"), "utf8");
    expect(orch).toMatch(/const hqAllowed =\s*!isMobileShell && !coarsePointerShell;/);
  });
});

/**
 * BEST SPOT — the LONG-LIVED WORKER's fences (`BESTSPOT_SPEC_V2.md` §5.6 / §7 S3d).
 *
 * A long-lived module worker latches module scope AT SPAWN. A tunable read inside it would be
 * frozen at the first toggle and invisibly stale for the rest of the session: the taste pass would
 * move the panel's numbers and not the picture, which is the one failure mode with no symptom. The
 * profile, the display window and the ribbon widths therefore RIDE THE JOB, and these rules are
 * what keep that true after the next refactor.
 *
 * Mutation that makes these RED: add `import { BESTSPOT } from "../../components/globe/tuning"` to
 * the worker or the solver; add a `lib/geo` module that imports tuning into the worker's graph
 * without an entry in the allow-list; introduce a `SharedArrayBuffer`; drop the webworker triple-
 * slash reference (which also breaks `astro check`).
 */
describe("BEST SPOT worker — no tuning latch, no SharedArrayBuffer", () => {
  const srcRoot = join(root, "src");
  const geo = join(srcRoot, "lib", "geo");
  const readSrc = (p: string) => readFileSync(p, "utf8");
  /** Comments stripped, URL schemes kept — `verifyHarness.test.ts`'s stripper verbatim. Without it
   *  these probes fire on the very DOCSTRINGS that explain the rules (the worker's header names
   *  `await import(...)` and the solver's names SharedArrayBuffer, both to say "never do this"),
   *  which is a fence that has become an instance of its own finding. */
  const code = (str: string) =>
    str.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:\\])\/\/[^\n]*/g, "");

  /** Static `from "…"` specifiers of a module, resolved to absolute src paths (bare specifiers and
   *  type-only imports of external packages fall out — they cannot reach `tuning.ts`). */
  const importsOf = (file: string): string[] => {
    const src = readSrc(file);
    const out: string[] = [];
    for (const m of code(src).matchAll(/from\s+"(\.[^"]*)"/g)) {
      const rel = m[1];
      const base = join(file, "..", rel);
      for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        try {
          readFileSync(cand, "utf8");
          out.push(cand);
          break;
        } catch {
          /* next candidate */
        }
      }
    }
    return out;
  };

  /** Every src module reachable from an entry by STATIC import. */
  const graphOf = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const dep of importsOf(f)) stack.push(dep);
    }
    return seen;
  };

  const WORKER = join(geo, "bestSpotWorker.ts");
  const SOLVER = join(geo, "bestSpotSolver.ts");
  const TUNING = join(srcRoot, "components", "globe", "tuning.ts");
  /** RESOLVED, not textual: `scene/vectorTiles.ts` reaches the same module as `"../tuning"`, and a
   *  path-shaped regex silently misses it — which is exactly the blind spot that would let a
   *  tunable latch into the worker through the parser. */
  const importsTuning = (f: string) => importsOf(f).includes(TUNING);

  it("the worker and the solver import components/globe/tuning DIRECTLY nowhere", () => {
    // POSITIVE CONTROL: the probe really does match files that legitimately import tuning, by BOTH
    // spellings of the specifier.
    expect(importsTuning(join(geo, "landcoverRaster.ts"))).toBe(true);
    expect(importsTuning(join(srcRoot, "components", "globe", "scene", "vectorTiles.ts"))).toBe(true);
    expect(importsTuning(WORKER)).toBe(false);
    expect(importsTuning(SOLVER)).toBe(false);
  });

  it("every TRANSITIVE tuning edge in the worker's graph is on the written allow-list", () => {
    // The direct rule above is true by the letter and would be false in effect if a module UNDER
    // the worker read a tunable at module scope. So the whole static graph is walked and the set of
    // tuning importers must equal this list EXACTLY — a new edge is red, and a removed one is red
    // too (a stale allow-list is a fence that has quietly stopped fencing).
    const ALLOWED: Record<string, string> = {
      "lib/geo/landcoverRaster.ts":
        "VECTOR ribbon widths — NEUTRALISED: buildLandGrid takes `widths` and the worker passes " +
        "the pair that rode its job; the import survives only as the default for shipped callers.",
      "components/globe/scene/vectorTiles.ts":
        "STREETS.classPriority inside parseVectorTile (LABEL ranks — BEST SPOT ignores `labels` " +
        "entirely) and VECTOR.tileCacheMax inside attachVectorTiles, which the worker never calls. " +
        "Imported rather than forked because two MVT parsers that look alike is this repo's most " +
        "expensive recurring bug class; tileZ and tileJsonUrl ride the job.",
    };
    const hits = [...graphOf(WORKER)]
      .filter(importsTuning)
      .map((f) => f.slice(srcRoot.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(hits).toEqual(Object.keys(ALLOWED).sort());
  });

  it("the worker declares the webworker lib on its FIRST line", () => {
    // Without it `astro check` cannot type `self.onmessage` and the whole file goes untypechecked.
    expect(readSrc(WORKER).split("\n")[0].trim()).toBe('/// <reference lib="webworker" />');
  });

  it("no SharedArrayBuffer and no dynamic import anywhere in the worker's own graph", () => {
    // SAB: COOP/COEP is UNVERIFIED on Wix hosting (`lib/decode/worker.ts:8-9`), so the wire is
    // transferable ArrayBuffers only. Dynamic import: a runtime `await import(...)` inside a worker
    // is what triggered the libheif "optimized dependencies changed" full-page reload in dev.
    const offenders: string[] = [];
    for (const f of graphOf(WORKER)) {
      const src = code(readSrc(f));
      if (/\bSharedArrayBuffer\b/.test(src)) offenders.push(`SAB in ${f}`);
      if (/\bawait import\(/.test(src)) offenders.push(`dynamic import in ${f}`);
    }
    expect(offenders).toEqual([]);
    // POSITIVE CONTROL: the probes can match.
    expect(/\bSharedArrayBuffer\b/.test("new SharedArrayBuffer(8)")).toBe(true);
    expect(/\bawait import\(/.test('const m = await import("x")')).toBe(true);
  });

  it("the worker spawns as an ES module off import.meta.url (astro.config's worker.format)", () => {
    const client = readSrc(join(geo, "bestSpotWorkerClient.ts"));
    expect(client).toMatch(
      /new Worker\(new URL\("\.\/bestSpotWorker\.ts", import\.meta\.url\), \{ type: "module" \}\)/,
    );
    // …and it is TERMINATED exactly once, in dispose() — the long-lived half of the lifecycle.
    expect([...client.matchAll(/\.terminate\(\)/g)]).toHaveLength(1);
    expect(client.slice(client.indexOf("dispose()"))).toMatch(/terminate\(\)/);
  });
});

/**
 * BEST SPOT — DESKTOP-ONLY, FENCED AT THE READ (plan §7, owner "nothing must change on mobile").
 *
 * The same rule ULTRA HQ carries, for the same reason: `/m` mounts the SAME `GlobeCanvas` and
 * `ftw:view-prefs:v1` is ONE localStorage blob shared by both shells on the same origin, so a
 * desktop session that opened the panel genuinely has `open: true` in the store when that browser
 * loads `/m`. Hiding the panel is not isolation; only a gate ON THE READ is.
 */
describe("BEST SPOT — desktop-only, fenced at the read", () => {
  const srcDir = join(root, "src");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|astro)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk(srcDir);
  const rel = (f: string) => f.slice(srcDir.length + 1).replace(/\\/g, "/");
  const orch = readFileSync(join(srcDir, "components/globe/StylizedTiles.ts"), "utf8");

  it("the gate is declared with BOTH terms, AND-ed, in the orchestrator", () => {
    expect(orch).toMatch(/const bestSpotAllowed =\s*!isMobileShell && !coarsePointerShell;/);
  });

  it("EXACTLY ONE engine file may name the gate", () => {
    const named = files.filter((f) => readFileSync(f, "utf8").includes("bestSpotAllowed"));
    // POSITIVE CONTROL first: an empty list below would otherwise prove nothing.
    expect(named.length).toBeGreaterThan(0);
    expect(named.map(rel)).toEqual(["components/globe/StylizedTiles.ts"]);
  });

  it("every enable read inside stepBestSpotFeed sits on a line that names the gate", () => {
    const step = orch.slice(orch.indexOf("const stepBestSpotFeed = () => {"));
    const body = step.slice(0, step.indexOf("\n  };"));
    expect(body.length).toBeGreaterThan(200); // the slice really is the step body
    const reads = body
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^\s*(allowed|enabled):/.test(line));
    // POSITIVE CONTROL: there ARE such lines (the feed's `allowed` and the sheet's `enabled`).
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(
      reads.filter((r) => !r.line.includes("bestSpotAllowed")).map((r) => `:${r.n} ${r.line.trim()}`),
    ).toEqual([]);
  });

  it("only the seam's own owners may VALUE-import store/bestSpot", () => {
    // An engine module that read the store directly would bypass the gate entirely, which is the
    // whole point of keeping the gate at the read.
    const OWNERS = new Set([
      // (the store itself is the module, not an importer of it — it is excluded from both halves)
      "components/globe/scene/bestSpotFeed.ts",
      // The orchestrator reads `open`/`hoverKey` for the SHEET — both AND-ed with the gate on
      // their own line (pinned by the test above) — and owns the `bestSpotTuning` DEV seam.
      "components/globe/StylizedTiles.ts",
      "components/panels/BestSpotPanel.tsx",
      "components/panels/PlanFindToggle.tsx",
    ]);
    const importRe = /import\s+(type\s+)?({[^}]*}|[\w*\s,]+)\s+from\s+"([^"]*store\/bestSpot)"/g;
    const offenders: string[] = [];
    let seen = 0;
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(importRe)) {
        const isTypeOnly = m[1] !== undefined || /^{\s*type\s[^}]*}$/.test(m[2].trim());
        if (isTypeOnly) continue;
        seen++;
        if (!OWNERS.has(rel(f))) offenders.push(rel(f));
      }
    }
    expect(seen).toBeGreaterThan(0); // the probe can match
    expect(offenders).toEqual([]);
    // …and the BIDIRECTIONAL half (the `hqAllowed` OWNERS rule): every listed owner must still
    // carry one. A stale allow-list is a fence that has quietly stopped fencing.
    const importers = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(importRe)) {
        const isTypeOnly = m[1] !== undefined || /^{\s*type\s[^}]*}$/.test(m[2].trim());
        if (!isTypeOnly) importers.add(rel(f));
      }
    }
    expect([...OWNERS].filter((o) => !importers.has(o))).toEqual([]);
  });
});

/**
 * BEST SPOT — the per-frame ORDER contract and the ratified drag rung (S3d).
 *
 * `StylizedTiles.ts`'s own rule is "ORDER IS THE CONTRACT — never a count or numbering here"
 * (both re-staled twice), so this pins the ADJACENCY the spec requires rather than an index.
 */
describe("BEST SPOT — step order and the drag rung", () => {
  const orch = readFileSync(join(root, "src/components/globe/StylizedTiles.ts"), "utf8");

  it("stepBestSpotFeed is called IMMEDIATELY after stepPlanFeed, and LAST in the try-chain", () => {
    // Not near stepKeyLightAndShadow: that is ~20 steps earlier and on the other side of
    // `++frameCount` (inside stepFrustumResnapAndTick), which splits every cadence gate into
    // pre/post groups — the two plan-family mirrors would then land on ALTERNATING frames.
    expect(orch).toMatch(/stepPlanFeed\(\);\s*\n\s*stepBestSpotFeed\(\);\s*\n\s*\} catch \(err\)/);
    // …and the roster doc comment names the same three, in the same order.
    expect(orch).toMatch(/MinimapFeed → PlanFeed → BestSpotFeed/);
  });

  it("the coarse-during-drag rung IS the ladder's first rung — no second code path", () => {
    // `SPEC_V2 §2.3` re-pins the p95 < 33 ms coarse-solve target to 24 m (21 ms); 12 m is 54-83 ms
    // and cannot meet it. Because `dragCellM === ladderCellsM[0]`, a live drag needs no separate
    // job shape at all: each lift change re-posts from R0 and the finer rungs only run once the
    // drag stops. If the two ever diverge, that identity silently stops holding.
    expect(BESTSPOT.dragCellM).toBe(BESTSPOT.ladderCellsM[0]);
    expect(BESTSPOT.dragCellM).toBe(24);
    // …and the ladder really is coarse → fine, which is what makes R0 "first ink".
    for (let i = 1; i < BESTSPOT.ladderCellsM.length; i++) {
      expect(BESTSPOT.ladderCellsM[i]).toBeLessThan(BESTSPOT.ladderCellsM[i - 1]);
    }
  });

  it("the two planning feeds mirror on ONE cadence", () => {
    // Deliberately shared (`BESTSPOT.mirrorEveryFrames: PLAN.mirrorEveryFrames`) so the panel's
    // two halves can never update out of phase; the adjacency test above is the other half of it.
    expect(BESTSPOT.mirrorEveryFrames).toBe(PLAN.mirrorEveryFrames);
  });
});
