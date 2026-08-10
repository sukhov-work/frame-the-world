import { describe, expect, it } from "vitest";
import {
  editDistance,
  kindGlyph,
  normalizeSky,
  searchSky,
} from "../../../src/lib/sky/searchIndex";
import { searchSkyCatalog, skyIndex, targetById } from "../../../src/lib/sky/catalog";
import { MESSIER } from "../../../src/lib/sky/messier";

/**
 * SKY search — the owner's requirement 2 grammar, run against the REAL phase-A catalog
 * (planets + Pluto + 110 Messier + 10P). Every case here is a query a stargazer actually types.
 */

const first = (q: string) => searchSkyCatalog(q)[0]?.id;
const topIds = (q: string, n = 3) => searchSkyCatalog(q, n).map((e) => e.id);

describe("normalizeSky", () => {
  it("folds case, diacritics, greek letters and spacing", () => {
    expect(normalizeSky("  Α Lyrae ")).toBe("alpha lyrae");
    expect(normalizeSky("α Lyr")).toBe("alpha lyr");
    expect(normalizeSky("Ptolemy's Cluster")).toBe("ptolemy s cluster");
    expect(normalizeSky("NGC—224")).toBe("ngc 224");
  });
});

describe("editDistance (OSA, capped)", () => {
  it("counts substitutions, insertions and adjacent transpositions", () => {
    expect(editDistance("jupiter", "jupiter")).toBe(0);
    expect(editDistance("jupitre", "jupiter")).toBe(1); // transposition
    expect(editDistance("andromedia", "andromeda")).toBe(1); // insertion
    expect(editDistance("saturm", "saturn")).toBe(1); // substitution
  });
  it("caps early instead of scanning hopeless pairs", () => {
    expect(editDistance("mercury", "andromeda")).toBeGreaterThan(2);
    expect(editDistance("ab", "abcdefgh")).toBeGreaterThan(2);
  });
});

describe("the query grammar (catalog end to end)", () => {
  it("catalog ids in any spacing", () => {
    expect(first("m31")).toBe("dso:M31");
    expect(first("M 31")).toBe("dso:M31");
    expect(first("messier 31")).toBe("dso:M31");
    expect(first("ngc 224")).toBe("dso:M31");
    expect(first("ngc224")).toBe("dso:M31");
  });

  it("common names and partial names", () => {
    // Phase B: "andromeda" is now the CONSTELLATION's exact name — it wins the top row, with
    // the galaxy right behind it (both must surface; the exact name outranks the prefix).
    expect(first("andromeda")).toBe("constellation:And");
    expect(topIds("andromeda").slice(0, 3)).toContain("dso:M31");
    expect(first("andromeda galaxy")).toBe("dso:M31");
    expect(first("orion nebula")).toBe("dso:M42");
    expect(first("pleiades")).toBe("dso:M45");
    expect(first("crab")).toBe("dso:M1");
  });

  it("planets, including typos", () => {
    expect(first("jupiter")).toBe("planet:jupiter");
    expect(first("saturm")).toBe("planet:saturn");
    expect(first("jupitre")).toBe("planet:jupiter");
    expect(first("pluto")).toBe("planet:pluto");
  });

  it("the comet, by designation or name", () => {
    expect(first("10p")).toBe("comet:10P");
    expect(first("tempel")).toBe("comet:10P");
  });

  it("typos in DSO names still surface the right object", () => {
    expect(topIds("andromedia")).toContain("dso:M31");
  });

  it("m1 ranks the exact id above the m1x prefix family", () => {
    expect(first("m1")).toBe("dso:M1");
  });

  it("short or empty queries return nothing", () => {
    expect(searchSkyCatalog("")).toHaveLength(0);
    expect(searchSky(skyIndex(), "   ")).toHaveLength(0);
  });
});

describe("catalog integrity", () => {
  it("carries every baked source (phase B: 8 planets + 10P + 110 M + 451 stars + 88 const + MPC comets + asteroids)", () => {
    expect(MESSIER).toHaveLength(110);
    expect(MESSIER.map((e) => e.m)).toEqual(Array.from({ length: 110 }, (_, i) => i + 1));
    const byPrefix = (p: string) => skyIndex().filter((e) => e.id.startsWith(p)).length;
    expect(byPrefix("planet:")).toBe(8);
    expect(byPrefix("dso:M")).toBe(110);
    expect(byPrefix("star:")).toBe(451);
    expect(byPrefix("constellation:")).toBe(88);
    expect(byPrefix("comet:")).toBeGreaterThanOrEqual(900); // 10P + the MPC fleet (re-bakes drift)
    expect(byPrefix("asteroid:")).toBeGreaterThanOrEqual(300);
    expect(skyIndex().length).toBeGreaterThanOrEqual(1900);
  });

  it("resolves every index entry to a working SkyTarget", () => {
    const t = Date.parse("2026-08-03T21:00:00Z");
    // Full resolution for the hand-curated sets; the big baked fleets sample every 13th (each
    // resolve propagates an orbit — 1,947 full evals would slow the suite for no extra proof).
    const all = skyIndex();
    const curated = all.filter(
      (e) => !e.id.startsWith("comet:") && !e.id.startsWith("asteroid:"),
    );
    const fleets = all.filter((e) => e.id.startsWith("comet:") || e.id.startsWith("asteroid:"));
    const sample = [...curated, ...fleets.filter((_, i) => i % 13 === 0)];
    for (const e of sample) {
      const target = targetById(e.id);
      expect(target, e.id).not.toBeNull();
      const s = target!.stateAt(t);
      expect(Math.hypot(...s.dir), e.id).toBeCloseTo(1, 9);
      expect(Number.isFinite(s.raDeg) && Number.isFinite(s.decDeg), e.id).toBe(true);
    }
  });

  it("M31 rides the fixed provider with its real extents", () => {
    const m31 = targetById("dso:M31")!;
    expect(m31.kind).toBe("galaxy");
    expect(m31.apparent?.majorArcmin).toBeCloseTo(177.83, 1);
    const s = m31.stateAt(Date.parse("2026-08-03T21:00:00Z"));
    expect(s.raDeg).toBeCloseTo(10.68479, 4);
    expect(s.magnitude).toBeCloseTo(3.44, 2);
    expect(s.magnitudeModel).toBe("catalog");
  });

  it("M102 keeps OpenNGC's contested-id stance visible", () => {
    const m102 = targetById("dso:M102")!;
    expect(m102.facts.kind).toBe("dso");
    expect(m102.facts.kind === "dso" && m102.facts.dsoType).toBe("Dup");
  });

  it("every kind renders a glyph", () => {
    for (const e of skyIndex()) expect(kindGlyph(e.kind)).not.toBe("");
  });
});
