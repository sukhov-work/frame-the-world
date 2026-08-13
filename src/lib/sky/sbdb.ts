/**
 * JPL SBDB long-tail small-body lookup (phase B) — the client side of `/api/sbdb` (JPL sends no
 * CORS, so this one goes through the thin Wix relay; SIMBAD handles the fixed-object long tail
 * directly). Wires the phase-A tail: the proxy shipped with zero callers.
 *
 * Flow: a query that LOOKS like a small-body designation ("2024 YR4", "C/2023 A3", "433",
 * "99942 apophis") → `/api/sbdb?sstr=…` → osculating elements + H/G (or M1/k1) → a kepler
 * SkyTarget built with the SAME universal-variable propagator the baked comets/asteroids ride.
 * Results (hits and misses) cache in localStorage so a repeat search is instant and offline.
 */

import {
  asteroidTarget,
  cometTarget,
  type SkyTarget,
} from "../ephemeris/targets";
import type { CometElements, CometProfile } from "../ephemeris/comet";
import { looksLikeSmallBody, normalizeSky, type SkyIndexEntry } from "./searchIndex";
import { makeTtlCache } from "./ttlCache";

export { looksLikeSmallBody }; // canonical home moved to searchIndex (boot-safe) — re-exported

export interface SbdbParsed {
  target: SkyTarget;
  /** For the result row. */
  label: string;
  kindLabel: string;
}

/** Defensive pick of a named orbital element from SBDB's `orbit.elements` list. */
function elem(list: Array<{ name?: string; value?: unknown }>, name: string): number | null {
  const row = list.find((r) => r.name === name);
  const v = row?.value != null ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * SBDB payload → SkyTarget. Returns null when the payload lacks a usable element set — the
 * caller treats that as a miss, never as an error.
 */
export function sbdbToTarget(body: unknown): SbdbParsed | null {
  const b = body as {
    object?: { des?: string; fullname?: string; kind?: string; prefix?: string | null };
    orbit?: { epoch?: unknown; elements?: Array<{ name?: string; value?: unknown }> };
    phys_par?: Array<{ name?: string; value?: unknown }>;
  };
  const des = b?.object?.des;
  const els = b?.orbit?.elements;
  const epoch = Number(b?.orbit?.epoch);
  if (!des || !els || !Number.isFinite(epoch)) return null;
  const e = elem(els, "e");
  const q = elem(els, "q") ?? (elem(els, "a") != null && e != null ? elem(els, "a")! * (1 - e) : null);
  const i = elem(els, "i");
  const om = elem(els, "om");
  const w = elem(els, "w");
  const tp = elem(els, "tp");
  if (e == null || q == null || i == null || om == null || w == null || tp == null) return null;
  const aAu = e === 1 ? Infinity : q / (1 - e);
  const nDegPerDay = e < 1 ? 0.9856076686 / Math.pow(aAu, 1.5) : 0;
  const elements: CometElements = {
    epochJdTdb: epoch,
    e,
    aAu,
    qAu: q,
    iDeg: i,
    nodeDeg: om,
    periDeg: w,
    tpJdTdb: tp,
    nDegPerDay,
    periodDays: e < 1 ? 360 / nDegPerDay : Infinity,
    m1: NaN, // comets: filled below from phys_par M1/K1 when present
    k1: 10,
  };
  const phys = b.phys_par ?? [];
  const physVal = (name: string) => {
    const row = phys.find((p) => p.name === name);
    const v = row?.value != null ? Number(row.value) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const fullname = (b.object?.fullname ?? des).trim();
  const isComet = b.object?.kind?.startsWith("c") || /^[CPDI]\//.test(des) || /\d+P/.test(des);
  if (isComet) {
    elements.m1 = physVal("M1") ?? NaN;
    elements.k1 = physVal("K1") ?? 10;
    const profile: CometProfile = {
      designation: fullname,
      family: e >= 1 ? "Long-period comet (open orbit)" : "Periodic comet",
      discovery: null,
      nucleusKm: null,
      rotationHours: null,
      source: "JPL SBDB (live lookup)",
      elements,
      lightCurve: null,
    };
    return { target: cometTarget(profile), label: fullname, kindLabel: "COMET" };
  }
  const h = physVal("H");
  if (h == null) return null; // an asteroid with no H has no magnitude story — skip
  const numMatch = des.match(/^(\d+)$/);
  return {
    target: asteroidTarget({
      number: numMatch ? Number(numMatch[1]) : null,
      name: fullname.replace(/^\d+\s+/, ""),
      h,
      g: physVal("G") ?? 0.15,
      elements,
      source: "JPL SBDB (live lookup)",
    }),
    label: fullname,
    kindLabel: "ASTEROID",
  };
}

/** Result row for the finder dropdown. */
export function sbdbIndexEntry(p: SbdbParsed): SkyIndexEntry {
  return {
    id: p.target.id,
    name: p.label.toUpperCase(),
    detail: `${p.kindLabel} · JPL SBDB (LIVE)`,
    kind: p.target.kind,
    keys: [],
    mag: null,
    boost: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Fetch + cache (same discipline as lib/sky/simbad.ts).
// ---------------------------------------------------------------------------------------------

// ONE TTL-cache implementation — lib/sky/ttlCache.ts (audit A6); old `body`-key blobs read fine.
// Hit TTL stays a fortnight: elements age.
const cache = makeTtlCache<unknown>({
  storageKey: "ftw:sbdb:v1",
  hitTtlMs: 14 * 86_400_000,
  missTtlMs: 86_400_000,
  cap: 100,
});

const inflight = new Map<string, Promise<SbdbParsed | null>>();

/** Resolve a designation through the `/api/sbdb` relay. Null = definitive miss (cached). */
export async function resolveSbdb(query: string): Promise<SbdbParsed | null> {
  const key = normalizeSky(query);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached ? sbdbToTarget(cached) : null;
  }
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      // phys-par carries H/G (asteroid) and M1/K1 (comet); full-prec keeps elements honest.
      const res = await fetch(
        `/api/sbdb?sstr=${encodeURIComponent(query.trim())}&phys-par=1&full-prec=1`,
      );
      if (!res.ok) throw new Error(`sbdb relay ${res.status}`);
      const relay = (await res.json()) as { status: number; body: unknown };
      // 300 = ambiguity list, 404 = no match — both cache as misses at this layer (the search
      // UI shows its own "no matches" row; disambiguation is a future nicety).
      const hit = relay.status === 200 ? relay.body : null;
      cache.set(key, hit);
      return hit ? sbdbToTarget(hit) : null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Resolve a persisted small-body id from the cache (`comet:`/`asteroid:` ids the bakes don't
 *  know) — reload persistence for live-looked-up targets. */
export function sbdbTargetById(id: string): SkyTarget | null {
  for (const body of cache.values()) {
    if (!body) continue;
    const parsed = sbdbToTarget(body);
    if (parsed?.target.id === id) return parsed.target;
  }
  return null;
}
