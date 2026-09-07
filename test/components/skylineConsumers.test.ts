import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * T112 (owner ruling 2026-09-07d, "best effort even below 50 %") — the one-gate fence for
 * every React consumer of the horizon profile.
 *
 * Audit `audits/audit-occlusion-2026-09-07.md` B3 found six components reading
 * `store/plan.profileBins` RAW through `sampleBins`, skipping the gate the three radars
 * honoured. The ruling replaced the whole-profile coverage floor with the per-bin answer
 * (`sampleBinsKnown` / `skylineSamplerFor` / `mirrorSampler`), so the invariant is now:
 * a component that reads `profileBins` also reads `profileKnown` and samples through one of
 * the known-aware entry points — never `sampleBins` on the mirror, which would read an
 * unswept bin's open-sky floor as "clear".
 */

const SRC = join(process.cwd(), "src", "components");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("horizon-profile consumers go through the per-bin gate (T112)", () => {
  const readers = walk(SRC).filter((f) => /s\.profileBins\b/.test(readFileSync(f, "utf8")));

  it("the profile has React readers (the probe can match)", () => {
    expect(readers.length).toBeGreaterThanOrEqual(6);
  });

  it.each(readers.map((f) => [f.replace(process.cwd() + "/", ""), f]))(
    "%s reads profileKnown beside profileBins and samples through a known-aware entry point",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/s\.profileKnown\b/);
      expect(src).toMatch(/mirrorSampler\(|skylineSamplerFor\(/);
      // the raw core is for the lib and the scene, never a component over the mirror
      expect(src).not.toMatch(/\bsampleBins\(/);
    },
  );

  it("no component under src/components calls the raw sampleBins on anything", () => {
    for (const f of walk(SRC)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bsampleBins\(/);
    }
  });
});
