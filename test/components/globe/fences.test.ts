import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

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

  it("only four files may name the flag at all", () => {
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
});
