import { describe, expect, it } from "vitest";
import * as cat from "../../scripts/lib/poses.mjs";

/**
 * THE POSE CATALOGUE's fence (`scripts/lib/poses.mjs`).
 *
 * The catalogue exists because the owner ruled (2026-09-06) that every past visual/perf session
 * measured "very contained bland views, often without any details or in dull spots and angles",
 * and supplied the poses himself. Two things can silently undo that, and this file pins both:
 *
 *  • **A pose quietly disappears.** Ids are the golden-set key and the artefact filename; a
 *    dropped or renamed id makes a sweep pass while no longer covering the view it was written
 *    for. Every owner id is named literally below — a rename turns this RED.
 *  • **A hash gets "tidied" into something that no longer parses.** The hashes were read off a
 *    real address bar; a hand edit that loses a decimal or a comma boots the DEFAULT view and the
 *    screenshot still looks like a globe. Every hash is re-parsed under the grammar of
 *    `.claude/conventions/contracts.md` §1 / `src/lib/geo/urlPose.ts:38-119`.
 *
 * Mutation that makes this RED: delete a pose, rename an id, drop a `t`, break a hash, or point
 * an fpv pose at a `#p=` hash.
 *
 * The catalogue is a dependency-free `.mjs` (it must stay importable by plain `node`, which is
 * how `scripts/verify-visual-sweep.mjs` consumes it), so it ships no `.d.ts`. The shapes are
 * declared here instead and the module's exports are bound to them once, below — that keeps
 * `astro check` honest about this file without adding a build step to the harness.
 */

interface HashFields {
  latDeg: number;
  lonDeg: number;
  altM?: number;
  eyeM?: number;
  headingDeg: number;
  tiltDeg?: number;
  pitchDeg?: number;
  fovDeg?: number;
}
interface Parsed {
  form: "p" | "f";
  nums: number[];
  t: number | null;
  fields: HashFields;
}
interface FpvBase {
  latDeg: number;
  lonDeg: number;
  eyeM: number;
  pitchDeg: number;
  fovDeg: number;
}
interface Leg {
  type: "descent" | "zoomSweep" | "timeSweep";
  drive?: string;
  endHash?: string;
  end?: { latDeg: number; lonDeg: number; altM: number; headingDeg: number; tiltDeg: number };
  shotEveryMs?: number;
  maxShots?: number;
  afterArrivalS?: number;
  maxLegS?: number;
  headings?: number[];
  base?: FpvBase;
  settleS?: number;
  stops?: number[];
  ownerFrames?: number[];
  lightKeys?: string[];
}
interface Pose {
  id: string;
  kind: "orbit" | "fpv" | "m";
  tags: string[];
  hash: string;
  t: number;
  path?: string;
  region: "dnipro" | "everest";
  note: string;
  leg?: Leg;
}

const POSES = cat.POSES as unknown as Pose[];
const parseHash = cat.parseHash as unknown as (hash: string) => Parsed | null;
const byId = cat.byId as unknown as (id: string) => Pose | null;
const byTag = cat.byTag as unknown as (tag: string) => Pose[];
const allTags = cat.allTags as unknown as () => string[];
const fpvHash = cat.fpvHash as unknown as (
  f: FpvBase & { headingDeg: number },
  timeMs?: number | null,
) => string;
const poseUrl = cat.poseUrl as unknown as (
  pose: Pose,
  opts?: { dev?: string; ultra?: boolean; timeMs?: number },
) => { url: string; hash: string; t: number | null; ultra: boolean };
const select = cat.select as unknown as (sel: { ids?: string[]; tags?: string[] }) => {
  poses: Pose[];
  missing: string[];
};

/** Narrow away the null the tests have already asserted, with a message if it ever fires. */
const mustParse = (hash: string): Parsed => {
  const p = parseHash(hash);
  if (!p) throw new Error(`hash does not parse: ${hash}`);
  return p;
};
const mustPose = (id: string): Pose => {
  const p = byId(id);
  if (!p) throw new Error(`no pose with id ${id}`);
  return p;
};
const mustLeg = (id: string): Leg => {
  const p = mustPose(id);
  if (!p.leg) throw new Error(`pose ${id} carries no leg`);
  return p.leg;
};

/** The owner's supplied views, by id. Written out literally — this list IS the contract. */
const OWNER_IDS = [
  "dnipro-descent",
  "dnipro-cityscape",
  "dnipro-fpv-west-sunset",
  "dnipro-fpv-south",
  "dnipro-fpv-zoom-sweep",
  "everest-orbit-52",
  "everest-orbit-73",
  "everest-fpv-sunset",
  "everest-fpv-sunset-ab",
];
const LEGACY_IDS = ["legacy-fpv-eye", "legacy-orbit", "legacy-city", "legacy-everest", "legacy-m"];

describe("pose catalogue — the owner's views are all present", () => {
  it("has poses at all (probe validated)", () => {
    expect(POSES.length).toBeGreaterThanOrEqual(OWNER_IDS.length + LEGACY_IDS.length);
  });

  it.each(OWNER_IDS)("owner pose %s is in the catalogue", (id) => {
    expect(byId(id), `${id} is missing from POSES`).not.toBeNull();
  });

  it.each(LEGACY_IDS)("legacy pose %s is in the catalogue", (id) => {
    expect(byId(id), `${id} is missing from POSES`).not.toBeNull();
  });

  it("ids are unique and stable-shaped (kebab-case, filename-safe)", () => {
    const ids = POSES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, `${id} is not a safe artefact filename`).toMatch(/^[a-z0-9-]+$/);
  });

  it("byId returns null for an unknown id (no vacuous hit)", () => {
    expect(byId("no-such-pose")).toBeNull();
  });
});

describe("pose catalogue — every hash parses under the grammar", () => {
  it.each(POSES.map((p) => [p.id, p] as const))("%s parses", (_id, p) => {
    expect(parseHash(p.hash), `${p.id}: hash does not parse — ${p.hash}`).not.toBeNull();
    const parsed = mustParse(p.hash);
    // The hash FORM must match the declared kind: an fpv pose booted from a `#p=` hash never
    // reaches `__globe.fpv().active` and the harness would sit in a 60 s wait for nothing.
    const wantForm = p.kind === "fpv" ? "f" : "p";
    expect(parsed.form, `${p.id}: kind ${p.kind} wants a #${wantForm}= hash`).toBe(wantForm);
    expect(parsed.nums.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("every pose pins an instant (a live clock is never comparable)", () => {
    for (const p of POSES) {
      expect(typeof p.t, `${p.id}: no pinned t`).toBe("number");
      expect(p.t).toBeGreaterThan(0);
      // …and when the verbatim hash carries its own `&t=`, the two must agree, or the harness
      // and the report disagree about which instant was measured.
      const inHash = mustParse(p.hash).t;
      if (inHash !== null) expect(inHash, `${p.id}: t disagrees with the hash`).toBe(p.t);
    }
  });

  it("orbit tilts are inside 0–88 except the legacy pose whose clamp is the point", () => {
    // `parsePoseHash` CLAMPS rather than rejects (`urlPose.ts:71`), so an out-of-band tilt is a
    // legal hash. Only `legacy-city` (tilt 300, verbatim from verify-perf-baseline.mjs:139) is
    // allowed to rely on that — a NEW pose with a 300 is a typo, not a contract.
    for (const p of POSES) {
      const parsed = mustParse(p.hash);
      if (parsed.form !== "p") continue;
      const tilt = parsed.fields.tiltDeg as number;
      if (p.id === "legacy-city") {
        expect(tilt).toBe(300);
        continue;
      }
      expect(tilt, `${p.id}: tilt out of band`).toBeGreaterThanOrEqual(0);
      expect(tilt, `${p.id}: tilt out of band`).toBeLessThanOrEqual(88);
    }
  });

  it("POSITIVE CONTROL: the grammar probe rejects malformed hashes", () => {
    expect(parseHash("#p=48.46,35.07,553,276.7")).toBeNull(); // 4 fields, not 5
    expect(parseHash("#f=48.46,35.07,90,266,-14")).toBeNull(); // 5 fields, not 6
    expect(parseHash("#p=,,,,")).toBeNull();
    expect(parseHash("#q=1,2,3,4,5")).toBeNull();
    expect(parseHash("")).toBeNull();
    expect(parseHash("#p=48.46008,35.07720,553,276.7,74.9&t=1788707940553")).not.toBeNull();
  });
});

describe("pose catalogue — the legs the harness drives", () => {
  it("dnipro-descent carries a descent leg with a parsable END pose", () => {
    const leg = mustLeg("dnipro-descent");
    expect(leg.type).toBe("descent");
    expect(parseHash(leg.endHash as string), "descent endHash does not parse").not.toBeNull();
    const end = mustParse(leg.endHash as string);
    // The declared `end` fields must equal what the END hash says — the harness flies to the
    // fields, the report cites the hash; a drift between them is a silent lie.
    expect(leg.end).toEqual(end.fields);
    // The owner's leg is a DESCENT: it must end lower than it starts, and arrive tilted 35–55°.
    const start = mustParse(mustPose("dnipro-descent").hash);
    expect(leg.end?.altM as number).toBeLessThan(start.fields.altM as number);
    expect(leg.end?.tiltDeg as number).toBeGreaterThanOrEqual(35);
    expect(leg.end?.tiltDeg as number).toBeLessThanOrEqual(55);
  });

  it("dnipro-fpv-zoom-sweep walks the horizon at a long-lens fov", () => {
    const pose = mustPose("dnipro-fpv-zoom-sweep");
    const leg = mustLeg("dnipro-fpv-zoom-sweep");
    const base = leg.base as FpvBase;
    expect(leg.type).toBe("zoomSweep");
    expect(leg.headings).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(base.fovDeg).toBeCloseTo(7.2, 5); // ≈200 mm — the owner's stated lens
    expect(base.pitchDeg).toBeCloseTo(-1.4, 5);
    // Each stop's composed hash must itself parse, or the leg boots the default view.
    for (const h of leg.headings as number[]) {
      const hash = fpvHash({ ...base, headingDeg: h }, pose.t);
      expect(parseHash(hash), `zoom stop ${h}° → ${hash}`).not.toBeNull();
      const parsed = mustParse(hash);
      expect(parsed.fields.headingDeg).toBeCloseTo(h, 5);
      expect(parsed.t).toBe(pose.t);
    }
  });

  it("everest-fpv-sunset-ab samples both of the owner's exact instants", () => {
    const leg = mustLeg("everest-fpv-sunset-ab");
    expect(leg.type).toBe("timeSweep");
    const stops = leg.stops as number[];
    expect(stops.length).toBe(8);
    // Strictly increasing, inside the owner's band, and carrying his two frames EXACTLY.
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
    expect(new Set(stops).size).toBe(stops.length);
    expect(stops[0]).toBeGreaterThanOrEqual(1788696500000);
    expect(stops[stops.length - 1]).toBeLessThanOrEqual(1788697900000);
    for (const owner of leg.ownerFrames as number[]) {
      expect(stops, `owner frame ${owner} is not a stop`).toContain(owner);
    }
  });
});

describe("pose catalogue — the helpers a harness calls", () => {
  it("poseUrl builds a dev URL that keeps the pinned instant", () => {
    const { url, t } = poseUrl(mustPose("dnipro-cityscape"), { dev: "http://localhost:4321" });
    expect(url).toBe("http://localhost:4321/#p=48.46008,35.07720,553,276.7,74.9&t=1788707940553");
    expect(t).toBe(1788707940553);
    // A hash the owner gave WITHOUT a `t` still gets the catalogue's pinned instant appended.
    const d = mustPose("dnipro-descent");
    expect(poseUrl(d).url).toContain(`&t=${d.t}`);
    expect(parseHash(poseUrl(d).hash)).not.toBeNull();
    // `/m` rides its own path.
    expect(poseUrl(mustPose("legacy-m")).url).toContain("localhost:4321/m#p=");
    // `timeMs` overrides the pin (the time sweep's per-stop URL) without duplicating `&t=`.
    const stopUrl = poseUrl(mustPose("everest-fpv-sunset-ab"), { timeMs: 1788697093370 });
    expect(stopUrl.url).toContain("&t=1788697093370");
    expect(stopUrl.url.match(/&t=/g)?.length).toBe(1);
  });

  it("poseUrl echoes ultra without touching the URL (ULTRA is a boot PREF, not a param)", () => {
    const p = mustPose("everest-orbit-73");
    const off = poseUrl(p, { ultra: false });
    const on = poseUrl(p, { ultra: true });
    expect(on.url).toBe(off.url);
    expect(on.ultra).toBe(true);
    expect(off.ultra).toBe(false);
  });

  it("byTag / select resolve the way --ids and --tags do", () => {
    expect(byTag("mountains").map((p) => p.id)).toEqual([
      "everest-orbit-52",
      "everest-orbit-73",
      "everest-fpv-sunset",
      "everest-fpv-sunset-ab",
      "legacy-everest",
    ]);
    expect(byTag("nope")).toEqual([]);
    // A selection is catalogue-ordered and de-duplicated across ids ∪ tags…
    const sel = select({ ids: ["everest-orbit-73"], tags: ["sunset"] });
    expect(sel.poses.map((p) => p.id)).toEqual([
      "dnipro-fpv-west-sunset",
      "everest-orbit-73",
      "everest-fpv-sunset",
    ]);
    expect(sel.missing).toEqual([]);
    // …and a typo is REPORTED, never silently reduced to a zero-pose pass.
    expect(select({ ids: ["dnipro-cityscape", "typo"] }).missing).toEqual(["typo"]);
    expect(select({ tags: ["typo"] }).missing).toEqual(["#typo"]);
    // No selection = the whole catalogue.
    expect(select({}).poses.length).toBe(POSES.length);
  });

  it("every tag in allTags() actually selects something", () => {
    for (const tag of allTags()) expect(byTag(tag).length).toBeGreaterThan(0);
  });
});
