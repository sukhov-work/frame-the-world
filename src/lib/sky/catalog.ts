/**
 * SKY catalog — the phase-A hardcoded target index (planets + Pluto · the 110 Messier objects ·
 * comet 10P) and the id → SkyTarget resolver behind it.
 *
 * LAZY BY CONTRACT: this module (and `messier.ts` behind it) must only ever be reached through
 * `await import(...)` — the first SKY interaction pays the ~10 KB, the boot chunk never does
 * (the 14-island boot lesson; the plan's own risk line). `LocationFinder` and `store/sky` both
 * load it that way; adding a static import from any boot-path module is a regression.
 *
 * Phase B replaces the hardcoded list with the baked OpenNGC/star-name/asteroid sets + SIMBAD
 * fallback; the shapes here (`SkyIndexEntry`, `targetById`) are already the phase-B contract.
 */

import {
  cometTarget,
  fixedTarget,
  PLANETS,
  planetTarget,
  type PlanetId,
  type SkyTarget,
  type TargetKind,
} from "../ephemeris/targets";
import { TEMPEL2 } from "../ephemeris/comet";
import { MESSIER, type MessierEntry } from "./messier";
import { normalizeSky, searchSky, type SkyIndexEntry } from "./searchIndex";

/** Typical naked-eye/binocular magnitudes for the row display (live mag varies — the panel
 *  shows the real one; the search row only needs "how findable is this"). */
const PLANET_ROW_MAG: Record<PlanetId, number> = {
  mercury: 0.2,
  venus: -4.2,
  mars: 0.9,
  jupiter: -2.2,
  saturn: 0.6,
  uranus: 5.7,
  neptune: 7.8,
  pluto: 14.4,
};

function planetEntry(id: PlanetId): SkyIndexEntry {
  const spec = PLANETS[id];
  return {
    id: `planet:${id}`,
    name: spec.name.toUpperCase(),
    detail: `PLANET · MAG ~${PLANET_ROW_MAG[id]}`,
    kind: "planet",
    keys: [...new Set([normalizeSky(spec.name), ...spec.aliases.map(normalizeSky)])],
    mag: PLANET_ROW_MAG[id],
    boost: 1,
  };
}

function messierName(e: MessierEntry): string {
  return e.names[0] ? `M${e.m} · ${e.names[0].toUpperCase()}` : `M${e.m}`;
}

function messierEntry(e: MessierEntry): SkyIndexEntry {
  const keys = new Set<string>([
    `m${e.m}`,
    `m ${e.m}`,
    `messier ${e.m}`,
    ...e.names.map(normalizeSky),
  ]);
  if (e.ngc) {
    const n = normalizeSky(e.ngc);
    keys.add(n);
    keys.add(n.replace(/ /g, ""));
  }
  const mag = e.vmag;
  // Fame + brightness prior: a common name is fame; brightness tops up (mag 4 ≈ +0.2, mag 9 ≈ 0).
  const boost =
    0.4 + (e.names.length ? 0.2 : 0) + Math.max(0, Math.min(0.2, (9 - (mag ?? 12)) * 0.04));
  return {
    id: `dso:M${e.m}`,
    name: messierName(e),
    detail: [e.typeLabel, e.constellation?.toUpperCase(), mag != null ? `MAG ${mag.toFixed(1)}` : null]
      .filter(Boolean)
      .join(" · "),
    kind: e.kind as TargetKind,
    keys: [...keys],
    mag,
    boost,
  };
}

function cometEntry(): SkyIndexEntry {
  return {
    id: "comet:10P",
    name: "10P/TEMPEL 2",
    detail: "COMET · PERIHELION 2026-08-02",
    kind: "comet",
    keys: ["10p", "10p tempel 2", "tempel 2", "tempel", "comet 10p", "comet"],
    mag: 8.4,
    boost: 0.9,
  };
}

let indexMemo: SkyIndexEntry[] | null = null;

/** The flat search index — built once per session. */
export function skyIndex(): SkyIndexEntry[] {
  if (!indexMemo) {
    indexMemo = [
      ...(Object.keys(PLANETS) as PlanetId[]).map(planetEntry),
      cometEntry(),
      ...MESSIER.map(messierEntry),
    ];
  }
  return indexMemo;
}

/** Rank the catalog against a query — the LocationFinder SKY path. */
export function searchSkyCatalog(query: string, limit = 8): SkyIndexEntry[] {
  return searchSky(skyIndex(), query, limit);
}

const targetMemo = new Map<string, SkyTarget>();

/** Resolve an index id to a live SkyTarget — memoized (targets are stateless closures). */
export function targetById(id: string): SkyTarget | null {
  const hit = targetMemo.get(id);
  if (hit) return hit;
  let t: SkyTarget | null = null;
  if (id.startsWith("planet:")) {
    const p = id.slice(7) as PlanetId;
    if (PLANETS[p]) t = planetTarget(p);
  } else if (id === "comet:10P") {
    t = cometTarget(TEMPEL2);
  } else if (id.startsWith("dso:M")) {
    const m = Number(id.slice(5));
    const e = MESSIER[m - 1];
    if (e && e.m === m) t = messierTarget(e);
  }
  if (t) targetMemo.set(id, t);
  return t;
}

/** Messier entry → fixed-provider SkyTarget (J2000 catalog position, catalog magnitude). */
export function messierTarget(e: MessierEntry): SkyTarget {
  return fixedTarget({
    id: `dso:M${e.m}`,
    name: messierName(e),
    kind: e.kind as TargetKind,
    aliases: [`m${e.m}`, ...(e.ngc ? [e.ngc.toLowerCase()] : []), ...e.names.map((n) => n.toLowerCase())],
    raDeg: e.raDeg,
    decDeg: e.decDeg,
    vmag: e.vmag,
    apparent:
      e.majArcmin != null
        ? {
            majorArcmin: e.majArcmin,
            minorArcmin: e.minArcmin ?? e.majArcmin,
            paDeg: e.paDeg ?? 0,
          }
        : undefined,
    facts: {
      kind: "dso",
      dsoType: e.dsoType,
      typeLabel: e.typeLabel,
      constellation: e.constellation,
      names: e.names,
    },
    source: "OPENNGC (CC-BY-SA-4.0) · J2000",
  });
}
