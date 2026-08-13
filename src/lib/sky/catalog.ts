/**
 * SKY catalog (phase B, 2026-08-10 — replaces the phase-A hardcoded index) — every baked source
 * behind ONE flat fuzzy index + the id → SkyTarget resolver:
 *
 *   planets (8+Pluto) · 10P (the hand-baked reference comet) · 110 Messier · 451 IAU star names
 *   · 88 constellations · ~950 MPC comets · ~340 bright asteroids (H<9) · ~150 common-named
 *   OpenNGC objects — plus the 13k anonymous NGC/IC records via the catalog-id pattern branch
 *   (`openngc.ts`), SIMBAD TAP for the fixed-object long tail and `/api/sbdb` for small bodies
 *   (both cached in localStorage — `simbad.ts` / `sbdb.ts`).
 *
 * LAZY BY CONTRACT: this module (and every data module behind it) must only ever be reached
 * through `await import(...)` — the first SKY interaction pays the catalog chunk, the boot chunk
 * never does (the 14-island boot lesson). The OpenNGC BINARY additionally fetches on first use
 * (`ensureNgc`), so even the catalog chunk stays lean.
 */

import {
  asteroidTarget,
  cometTarget,
  fixedTarget,
  GALACTIC_CENTRE_ID,
  galacticCentreTarget,
  PLANETS,
  planetTarget,
  type PlanetId,
  type SkyTarget,
  type TargetKind,
} from "../ephemeris/targets";
import { TEMPEL2, type CometProfile } from "../ephemeris/comet";
import { MESSIER, type MessierEntry } from "./messier";
import { STAR_NAMES, type StarNameEntry } from "./starNames";
import { CONSTELLATIONS, type ConstellationEntry } from "./constellations";
import { COMETS, type CometRow } from "./comets";
import { ASTEROIDS, type AsteroidRow } from "./asteroids";
import {
  ngcIndexEntries,
  ngcTarget,
  parseOpenNgc,
  searchNgcById,
  type NgcCatalog,
} from "./openngc";
import { simbadTargetById } from "./simbad";
import { sbdbTargetById } from "./sbdb";
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

function tempel2Entry(): SkyIndexEntry {
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

function gcEntry(): SkyIndexEntry {
  return {
    id: GALACTIC_CENTRE_ID,
    name: "GALACTIC CENTRE",
    detail: "MILKY WAY CORE · SGR A* · SAGITTARIUS",
    kind: "galaxy",
    keys: [
      "galactic centre",
      "galactic center",
      "milky way",
      "milkyway",
      "milky way core",
      "sgr a",
      "sagittarius a",
      "gc",
    ],
    mag: null,
    boost: 0.95,
  };
}

// ---------------------------------------------------------------------------------------------
// Stars (IAU WGSN names) — the bayer id expands so "alpha lyrae" and "α Lyr" both land on Vega.
// ---------------------------------------------------------------------------------------------

/** IAU-CSN greek abbreviations — the 24 forms actually present in the bake ("alf" not "alp",
 *  "tet" not "the", "ksi" not "xi"; dots pad 2-letter forms like "mu." and are stripped by
 *  normalize before this map applies). */
const GREEK_ABBR: Record<string, string> = {
  alf: "alpha",
  bet: "beta",
  gam: "gamma",
  del: "delta",
  eps: "epsilon",
  zet: "zeta",
  eta: "eta",
  tet: "theta",
  iot: "iota",
  kap: "kappa",
  lam: "lambda",
  mu: "mu",
  nu: "nu",
  ksi: "xi",
  omi: "omicron",
  pi: "pi",
  rho: "rho",
  sig: "sigma",
  tau: "tau",
  ups: "upsilon",
  phi: "phi",
  chi: "chi",
  psi: "psi",
  ome: "omega",
};

const CONST_BY_ABBR = new Map(CONSTELLATIONS.map((c) => [c.abbr.toLowerCase(), c]));

/** "tet01 Eri" → ["tet01 eri", "theta1 eri", "theta1 eridani", "theta eridani"]. */
function bayerKeys(bayer: string): string[] {
  const norm = normalizeSky(bayer);
  const keys = new Set<string>([norm]);
  const m = norm.match(/^([a-z]+?)\.?\s*0*(\d*)\s+(\w+)$/);
  if (m) {
    const [, abbr, idx, con] = m;
    const full = GREEK_ABBR[abbr] ?? abbr;
    const c = CONST_BY_ABBR.get(con);
    const cons = [con, c?.name && normalizeSky(c.name), c?.genitive && normalizeSky(c.genitive)]
      .filter(Boolean) as string[];
    for (const cn of cons) {
      if (idx) keys.add(`${full}${idx} ${cn}`);
      keys.add(`${full} ${cn}`);
    }
  }
  return [...keys];
}

function starEntry(s: StarNameEntry): SkyIndexEntry {
  const keys = new Set<string>([normalizeSky(s.name)]);
  const desig = normalizeSky(s.designation);
  keys.add(desig);
  keys.add(desig.replace(/ /g, ""));
  if (s.bayer) for (const k of bayerKeys(s.bayer)) keys.add(k);
  if (s.hip != null) keys.add(`hip ${s.hip}`);
  if (s.hd != null) keys.add(`hd ${s.hd}`);
  return {
    id: `star:${s.name}`,
    name: s.name.toUpperCase(),
    detail: [
      "STAR",
      s.bayer?.toUpperCase() ?? s.designation.toUpperCase(),
      s.vmag != null ? `MAG ${s.vmag.toFixed(1)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    kind: "star",
    keys: [...keys],
    mag: s.vmag,
    boost: 0.5 + Math.max(0, Math.min(0.3, (2.5 - (s.vmag ?? 6)) * 0.12)),
  };
}

const STAR_BY_NAME = new Map(STAR_NAMES.map((s) => [s.name, s]));

function starTarget(s: StarNameEntry): SkyTarget {
  return fixedTarget({
    id: `star:${s.name}`,
    name: s.name,
    kind: "star",
    aliases: [s.name.toLowerCase(), s.designation.toLowerCase(), ...(s.bayer ? [s.bayer.toLowerCase()] : [])],
    raDeg: s.raDeg,
    decDeg: s.decDeg,
    vmag: s.vmag,
    facts: {
      kind: "star",
      designation: s.designation,
      bayer: s.bayer,
      constellation: s.con,
      hr: s.hr,
      hip: s.hip,
      hd: s.hd,
    },
    source: "IAU WGSN · CSN 2022-04-04 · J2000",
  });
}

// ---------------------------------------------------------------------------------------------
// Constellations (d3-celestial, BSD-3) — the marker tracks the figure's label-anchor centre.
// ---------------------------------------------------------------------------------------------

function constellationEntry(c: ConstellationEntry): SkyIndexEntry {
  return {
    id: `constellation:${c.abbr}`,
    name: c.name.toUpperCase(),
    detail: `CONSTELLATION · ${c.genitive.toUpperCase()} · ${c.abbr.toUpperCase()}`,
    kind: "constellation",
    keys: [
      ...new Set([normalizeSky(c.name), normalizeSky(c.genitive), normalizeSky(c.abbr)]),
    ],
    mag: null,
    boost: c.rank === 1 ? 0.6 : c.rank === 2 ? 0.5 : 0.4,
  };
}

function constellationTarget(c: ConstellationEntry): SkyTarget {
  return fixedTarget({
    id: `constellation:${c.abbr}`,
    name: c.name,
    kind: "constellation",
    aliases: [c.name.toLowerCase(), c.genitive.toLowerCase(), c.abbr.toLowerCase()],
    raDeg: c.raDeg,
    decDeg: c.decDeg,
    vmag: null,
    facts: { kind: "constellation", abbr: c.abbr, genitive: c.genitive, rank: c.rank },
    source: "IAU CONSTELLATIONS · FIGURES: D3-CELESTIAL (BSD-3) · J2000",
  });
}

// ---------------------------------------------------------------------------------------------
// MPC comets + SBDB bright asteroids — the kepler providers' baked fleets.
// ---------------------------------------------------------------------------------------------

function mpcCometProfile(row: CometRow): CometProfile {
  return {
    designation: row.full,
    family:
      row.orbit === "P"
        ? "Periodic comet"
        : row.orbit === "D"
          ? "Defunct/lost comet"
          : row.e >= 1
            ? "Long-period comet (open orbit)"
            : "Long-period comet",
    discovery: null,
    nucleusKm: null,
    rotationHours: null,
    source: "MPC CometEls (Minor Planet Center)",
    elements: {
      epochJdTdb: row.epochJdTdb,
      e: row.e,
      aAu: row.aAu,
      qAu: row.qAu,
      iDeg: row.iDeg,
      nodeDeg: row.nodeDeg,
      periDeg: row.periDeg,
      tpJdTdb: row.tpJdTdb,
      nDegPerDay: row.nDegPerDay,
      periodDays: row.periodDays,
      m1: row.h ?? NaN, // NaN → the target maps magnitude to null (no honest model)
      k1: row.g != null ? 2.5 * row.g : 10,
    },
    lightCurve: null,
  };
}

const COMET_BY_DESIG = new Map(COMETS.map((r) => [r.desig, r]));

function mpcCometEntry(row: CometRow): SkyIndexEntry {
  const keys = new Set<string>([normalizeSky(row.desig), normalizeSky(row.desig).replace(/ /g, "")]);
  if (row.name) keys.add(normalizeSky(row.name));
  keys.add(normalizeSky(row.full));
  // "C/1995 O1" also findable as the bare provisional "1995 o1".
  const prov = row.desig.match(/^[A-Z]\/(.+)$/)?.[1];
  if (prov) keys.add(normalizeSky(prov));
  return {
    id: `comet:${row.desig}`,
    name: row.full.toUpperCase(),
    detail: [
      row.orbit === "P" ? "PERIODIC COMET" : row.orbit === "D" ? "COMET (LOST)" : "COMET",
      row.h != null ? `H ${row.h.toFixed(1)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    kind: "comet",
    keys: [...keys],
    mag: null,
    boost: row.name ? 0.55 : 0.2,
  };
}

const ASTEROID_BY_N = new Map(ASTEROIDS.map((r) => [r.n, r]));

function asteroidEntry(row: AsteroidRow): SkyIndexEntry {
  return {
    id: `asteroid:${row.n}`,
    name: `${row.n} ${row.name}`.toUpperCase(),
    detail: `ASTEROID · H ${row.h.toFixed(1)}`,
    kind: "asteroid",
    keys: [
      ...new Set([
        normalizeSky(row.name),
        normalizeSky(`${row.n} ${row.name}`),
        String(row.n),
      ]),
    ],
    mag: null,
    boost: 0.35 + Math.max(0, Math.min(0.25, (6 - row.h) * 0.06)),
  };
}

function mpcAsteroidProfileTarget(row: AsteroidRow): SkyTarget {
  return asteroidTarget({
    number: row.n,
    name: row.name,
    h: row.h,
    g: row.g,
    elements: {
      epochJdTdb: row.epochJdTdb,
      e: row.e,
      aAu: row.aAu,
      qAu: row.qAu,
      iDeg: row.iDeg,
      nodeDeg: row.nodeDeg,
      periDeg: row.periDeg,
      tpJdTdb: row.tpJdTdb,
      nDegPerDay: row.nDegPerDay,
      periodDays: row.periodDays,
    },
    source: "JPL SBDB (bake 2026-08-10)",
  });
}

// ---------------------------------------------------------------------------------------------
// The index + the resolver
// ---------------------------------------------------------------------------------------------

let indexMemo: SkyIndexEntry[] | null = null;

/** The flat fuzzy index over every SYNC source — built once per session. */
export function skyIndex(): SkyIndexEntry[] {
  if (!indexMemo) {
    indexMemo = [
      ...(Object.keys(PLANETS) as PlanetId[]).map(planetEntry),
      tempel2Entry(),
      gcEntry(),
      ...MESSIER.map(messierEntry),
      ...STAR_NAMES.map(starEntry),
      ...CONSTELLATIONS.map(constellationEntry),
      ...COMETS.map(mpcCometEntry),
      ...ASTEROIDS.map(asteroidEntry),
    ];
  }
  return indexMemo;
}

// OpenNGC binary — fetched once on first use; failure degrades to the sync index (honest, warned).
let ngcCat: NgcCatalog | null = null;
let ngcEntriesMemo: SkyIndexEntry[] = [];
let ngcPromise: Promise<void> | null = null;

function ensureNgc(): Promise<void> {
  ngcPromise ??= fetch("/data/openngc.bin")
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      ngcCat = parseOpenNgc(buf);
      ngcEntriesMemo = ngcIndexEntries(ngcCat);
    })
    .catch((e) => {
      console.warn("[sky] OpenNGC catalog unavailable — NGC/IC ids degrade to SIMBAD:", e);
      ngcPromise = null; // a later search retries the fetch
    });
  return ngcPromise;
}

/** DEV/test seam: feed the parsed binary directly (vitest has no /data fetch). */
export function _setNgcCatalog(cat: NgcCatalog): void {
  ngcCat = cat;
  ngcEntriesMemo = ngcIndexEntries(cat);
  ngcPromise = Promise.resolve();
}

/** Rank the SYNC catalog against a query — instant, no I/O (kept for tests + the fast path). */
export function searchSkyCatalog(query: string, limit = 8): SkyIndexEntry[] {
  return searchSky(skyIndex(), query, limit);
}

/**
 * The full search: ensures the OpenNGC binary (first call pays ~110 KB gz), then ranks the
 * catalog-id pattern branch (exact NGC/IC/B hits first) above the fuzzy index. Still no network
 * beyond the one local asset — SIMBAD/SBDB are the CALLER's explicit long-tail step
 * (LocationFinder debounces them; a keystroke must never hammer CDS).
 */
export async function searchSkyEnriched(query: string, limit = 8): Promise<SkyIndexEntry[]> {
  await ensureNgc();
  const byId = ngcCat ? searchNgcById(ngcCat, query, limit) : [];
  const fuzzy = searchSky([...skyIndex(), ...ngcEntriesMemo], query, limit);
  const seen = new Set(byId.map((e) => e.id));
  return [...byId, ...fuzzy.filter((e) => !seen.has(e.id))].slice(0, limit);
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
  } else if (id.startsWith("comet:")) {
    const row = COMET_BY_DESIG.get(id.slice(6));
    if (row) t = cometTarget(mpcCometProfile(row));
  } else if (id.startsWith("asteroid:")) {
    const row = ASTEROID_BY_N.get(Number(id.slice(9)));
    if (row) t = mpcAsteroidProfileTarget(row);
  } else if (id.startsWith("star:")) {
    const s = STAR_BY_NAME.get(id.slice(5));
    if (s) t = starTarget(s);
  } else if (id.startsWith("constellation:")) {
    const c = CONSTELLATIONS.find((x) => x.abbr === id.slice(14));
    if (c) t = constellationTarget(c);
  } else if (id === GALACTIC_CENTRE_ID) {
    t = galacticCentreTarget();
  } else if (id.startsWith("dso:M")) {
    const m = Number(id.slice(5));
    const e = MESSIER[m - 1];
    if (e && e.m === m) t = messierTarget(e);
  } else if (id.startsWith("ngc:")) {
    const rec = ngcCat?.records.find((r) => r.name === id.slice(4));
    if (rec) t = ngcTarget(rec);
  } else if (id.startsWith("simbad:")) {
    t = simbadTargetById(id);
  }
  if (!t && (id.startsWith("comet:") || id.startsWith("asteroid:"))) {
    t = sbdbTargetById(id); // live-looked-up small bodies persist through the sbdb cache
  }
  if (t) targetMemo.set(id, t);
  return t;
}

/** Async resolver for ids whose backing set loads lazily (`ngc:` needs the binary) — reload
 *  persistence path. Everything else falls through to the sync resolver. */
export async function targetByIdAsync(id: string): Promise<SkyTarget | null> {
  if (id.startsWith("ngc:")) await ensureNgc();
  return targetById(id);
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
