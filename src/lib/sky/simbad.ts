/**
 * SIMBAD TAP long-tail fallback (phase B, plan §Search "miss" arrow) — resolves identifiers the
 * baked catalogs don't carry ("PGC 143", "Sh2-155", "Barnard 68", any of SIMBAD's ~20M ids)
 * straight from the client: the CDS sync TAP endpoint sends `Access-Control-Allow-Origin: *`
 * (verified 2026-08-10), so no Wix proxy is needed (C1 stays clean).
 *
 * Courtesy contract (CDS FAQ: >10 req/s → 1 min ban): ONE query per user pause — the caller
 * debounces; this module additionally memoizes in-flight promises and caches results (hits AND
 * misses) in localStorage so a repeat search is instant and offline.
 *
 * SIMBAD normalizes identifiers server-side ("andromeda galaxy" → M 31, case/spacing-insensitive)
 * — no client-side canonicalization beyond trimming.
 */

import { fixedTarget, type SkyTarget, type TargetKind } from "../ephemeris/targets";
import { normalizeSky, type SkyIndexEntry } from "./searchIndex";
import { makeTtlCache } from "./ttlCache";

export interface SimbadObject {
  mainId: string;
  raDeg: number;
  decDeg: number;
  /** SIMBAD condensed otype ("G", "PN", "Cl*", "V*", …). */
  otype: string;
  vmag: number | null;
  majArcmin: number | null;
  minArcmin: number | null;
}

/** SIMBAD otype → TargetKind. Suffix `*` marks stellar types; galaxy subtypes carry "G". */
export function simbadKind(otype: string): TargetKind {
  const t = otype.trim();
  if (t === "G" || t.endsWith("G") || ["AGN", "QSO", "Sy1", "Sy2", "SyG", "LIN", "IG"].includes(t))
    return "galaxy";
  if (["Cl*", "OpC", "GlC", "As*", "C?*"].includes(t)) return "cluster";
  if (["PN", "HII", "Neb", "RNe", "SNR", "EmO", "DNe", "MoC", "ISM", "GNe", "sh"].includes(t))
    return "nebula";
  if (t === "*" || t.endsWith("*")) return "star";
  return "other";
}

const OTYPE_LABEL: Record<TargetKind, string> = {
  planet: "PLANET",
  moon: "MOON",
  star: "STAR",
  comet: "COMET",
  asteroid: "ASTEROID",
  galaxy: "GALAXY",
  nebula: "NEBULA",
  cluster: "CLUSTER",
  constellation: "CONSTELLATION",
  shower: "METEOR SHOWER",
  other: "OBJECT",
};

/** SIMBAD row → fixed-provider SkyTarget (`simbad:` id namespace). */
export function simbadTarget(o: SimbadObject): SkyTarget {
  const kind = simbadKind(o.otype);
  return fixedTarget({
    id: `simbad:${o.mainId}`,
    name: o.mainId.replace(/\s+/g, " ").toUpperCase(),
    kind,
    aliases: [o.mainId.toLowerCase()],
    raDeg: o.raDeg,
    decDeg: o.decDeg,
    vmag: o.vmag,
    apparent:
      o.majArcmin != null
        ? { majorArcmin: o.majArcmin, minorArcmin: o.minArcmin ?? o.majArcmin, paDeg: 0 }
        : undefined,
    facts: {
      kind: "dso",
      dsoType: o.otype,
      typeLabel: `${OTYPE_LABEL[kind]} (SIMBAD ${o.otype})`,
      constellation: null,
      names: [],
    },
    source: "SIMBAD (CDS STRASBOURG) · J2000",
  });
}

/** Result row for the finder dropdown. */
export function simbadIndexEntry(o: SimbadObject): SkyIndexEntry {
  const kind = simbadKind(o.otype);
  return {
    id: `simbad:${o.mainId}`,
    name: o.mainId.replace(/\s+/g, " ").toUpperCase(),
    detail: [
      `${OTYPE_LABEL[kind]} · SIMBAD`,
      o.vmag != null ? `MAG ${o.vmag.toFixed(1)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    kind,
    keys: [],
    mag: o.vmag,
    boost: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Cache — one localStorage blob; hits live 30 days, misses 1 day; capped by insertion order.
// ---------------------------------------------------------------------------------------------

// ONE TTL-cache implementation — lib/sky/ttlCache.ts (audit A6); old `o`-key blobs read fine.
const cache = makeTtlCache<SimbadObject>({
  storageKey: "ftw:simbad:v1",
  hitTtlMs: 30 * 86_400_000,
  missTtlMs: 86_400_000,
  cap: 200,
});

/** Cached resolution: the object, null (cached miss), or undefined (never asked / expired). */
export function cachedSimbad(query: string): SimbadObject | null | undefined {
  return cache.get(normalizeSky(query));
}

/** Resolve a persisted `simbad:<mainId>` target id from cached objects (reload persistence). */
export function simbadTargetById(id: string): SkyTarget | null {
  if (!id.startsWith("simbad:")) return null;
  const mainId = id.slice(7);
  for (const o of cache.values()) {
    if (o && o.mainId === mainId) return simbadTarget(o);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// TAP query — sync endpoint, JSON output, in-flight dedupe.
// ---------------------------------------------------------------------------------------------

const TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
const inflight = new Map<string, Promise<SimbadObject | null>>();

function adqlFor(identifier: string): string {
  const escaped = identifier.replace(/'/g, "''");
  return (
    "SELECT basic.main_id, basic.ra, basic.dec, basic.otype, allfluxes.V, " +
    "basic.galdim_majaxis, basic.galdim_minaxis " +
    "FROM ident JOIN basic ON ident.oidref = basic.oid " +
    "LEFT JOIN allfluxes ON allfluxes.oidref = basic.oid " +
    `WHERE ident.id = '${escaped}'`
  );
}

/**
 * Resolve one identifier via SIMBAD TAP. Returns null on a definitive miss; throws only on
 * network/HTTP failure (the caller treats that as "no fallback right now", never as a miss).
 * Caches both outcomes.
 */
export async function resolveSimbad(query: string): Promise<SimbadObject | null> {
  const key = normalizeSky(query);
  if (!key) return null;
  const cached = cachedSimbad(query);
  if (cached !== undefined) return cached;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const params = new URLSearchParams({
      request: "doQuery",
      lang: "adql",
      format: "json",
      query: adqlFor(query.trim()),
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(TAP_URL, { method: "POST", body: params, signal: ctrl.signal });
      if (!res.ok) throw new Error(`SIMBAD TAP ${res.status}`);
      const json = (await res.json()) as { data?: Array<Array<unknown>> };
      const row = json.data?.[0];
      const o: SimbadObject | null =
        row && typeof row[1] === "number" && typeof row[2] === "number"
          ? {
              mainId: String(row[0]).replace(/\s+/g, " ").trim(),
              raDeg: row[1],
              decDeg: row[2],
              otype: String(row[3] ?? "?"),
              vmag: typeof row[4] === "number" ? row[4] : null,
              majArcmin: typeof row[5] === "number" ? row[5] : null,
              minArcmin: typeof row[6] === "number" ? row[6] : null,
            }
          : null;
      cache.set(key, o);
      return o;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
