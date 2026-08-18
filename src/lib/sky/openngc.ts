/**
 * Full OpenNGC catalog — runtime side of `scripts/build-openngc-catalog.mjs` (phase B).
 *
 * `public/data/openngc.bin` packs 13,263 non-Messier deep-sky objects (Dup/NonEx dropped; the
 * 110 Messier live in `messier.ts`) as 20-byte LE records behind a 12-byte header
 * ("ONGC" + u32 version + u32 count):
 *   u8 catalog (0=NGC · 1=IC · 2=extra → NGC_EXTRA_NAMES) · u16 number · u8 suffixIdx (1-based
 *   into NGC_SUFFIXES, 0=none) · u8 typeIdx (NGC_TYPE_CODES) · u8 constIdx (NGC_CONST_CODES) ·
 *   f32 raDeg · f32 decDeg · u8 mag ((mag+2)·10, 255=none, V else B) · u8 pa (deg 0..180,
 *   255=none) · u16 majAx (0.1′ units, 0=none) · u16 minAx.
 *
 * Search philosophy: the ~150 common-named objects join the fuzzy index like everything else;
 * the 13k anonymous records are reachable ONLY through the catalog-id pattern branch
 * (`searchNgcById` — "NGC 891", "ic434", "b33") so an average query is never flooded by
 * anonymous field galaxies. Pure parsing/query here; the fetch lives in `catalog.ts`.
 *
 * Data: OpenNGC (mattiaverga, CC-BY-SA-4.0). Baked: 2026-08-10 (`public/data/openngc.bin`,
 * git-dated — audit-2 B3; the generator now stamps ngcNames.ts automatically on regen).
 */

import { fixedTarget, type SkyTarget, type TargetKind } from "../ephemeris/targets";
import {
  NGC_COMMON_NAMES,
  NGC_CONST_CODES,
  NGC_EXTRA_NAMES,
  NGC_SUFFIXES,
  NGC_TYPE_CODES,
} from "./ngcNames";
import { normalizeSky, type SkyIndexEntry } from "./searchIndex";

export interface NgcRecord {
  /** Verbatim OpenNGC Name — "NGC0891" · "IC0434" · "NGC0545 NED01" · "B033". */
  name: string;
  /** OpenNGC type code ("G", "OCl", "HII", …). */
  type: string;
  constellation: string | null;
  raDeg: number;
  decDeg: number;
  vmag: number | null;
  paDeg: number | null;
  majArcmin: number | null;
  minArcmin: number | null;
}

export interface NgcCatalog {
  records: NgcRecord[];
  /** normalized compact name ("ngc891", "ngc545 ned01" → "ngc545ned01", "b033") → record. */
  byKey: Map<string, NgcRecord>;
}

const RECORD_BYTES = 20;
const HEADER_BYTES = 12;

/** Compact lookup key for a verbatim OpenNGC Name: lowercase, digits unpadded, no spaces. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^(ngc|ic|b|mel)0*(\d)/, "$1$2");
}

/** Parse the packed asset. Throws on a malformed header/length (truncated fetch). */
export function parseOpenNgc(buffer: ArrayBuffer): NgcCatalog {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "ONGC") throw new Error(`openngc: bad magic "${magic}"`);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`openngc: unsupported version ${version}`);
  const count = dv.getUint32(8, true);
  if (buffer.byteLength !== HEADER_BYTES + count * RECORD_BYTES) {
    throw new Error(`openngc: bad byte length ${buffer.byteLength} for ${count} records`);
  }
  const records: NgcRecord[] = [];
  const byKey = new Map<string, NgcRecord>();
  for (let i = 0; i < count; i++) {
    const o = HEADER_BYTES + i * RECORD_BYTES;
    const catalog = dv.getUint8(o);
    const number = dv.getUint16(o + 1, true);
    const suffixIdx = dv.getUint8(o + 3);
    const typeIdx = dv.getUint8(o + 4);
    const constIdx = dv.getUint8(o + 5);
    const raDeg = dv.getFloat32(o + 6, true);
    const decDeg = dv.getFloat32(o + 10, true);
    const magEnc = dv.getUint8(o + 14);
    const paEnc = dv.getUint8(o + 15);
    const majEnc = dv.getUint16(o + 16, true);
    const minEnc = dv.getUint16(o + 18, true);
    const suffix = suffixIdx > 0 ? NGC_SUFFIXES[suffixIdx - 1] : "";
    const name =
      catalog === 2
        ? NGC_EXTRA_NAMES[number]
        : `${catalog === 0 ? "NGC" : "IC"}${String(number).padStart(4, "0")}${suffix}`;
    const rec: NgcRecord = {
      name,
      type: NGC_TYPE_CODES[typeIdx],
      constellation: NGC_CONST_CODES[constIdx] || null,
      raDeg,
      decDeg,
      vmag: magEnc === 255 ? null : magEnc / 10 - 2,
      paDeg: paEnc === 255 ? null : paEnc,
      majArcmin: majEnc === 0 ? null : majEnc / 10,
      minArcmin: minEnc === 0 ? null : minEnc / 10,
    };
    records.push(rec);
    byKey.set(nameKey(name), rec);
  }
  return { records, byKey };
}

/** OpenNGC type code → TargetKind (the messier bake's mapping, extended for the full set). */
function ngcKind(type: string): TargetKind {
  switch (type) {
    case "G":
    case "GPair":
    case "GTrpl":
    case "GGroup":
      return "galaxy";
    case "OCl":
    case "GCl":
    case "Cl+N":
    case "*Ass":
      return "cluster";
    case "PN":
    case "HII":
    case "Neb":
    case "RfN":
    case "EmN":
    case "DrkN":
    case "SNR":
      return "nebula";
    case "*":
    case "**":
      return "star";
    default:
      return "other";
  }
}

/** Human label for the panel — mirrors the messier bake's vocabulary. */
function ngcTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    G: "GALAXY",
    GPair: "GALAXY PAIR",
    GTrpl: "GALAXY TRIPLET",
    GGroup: "GALAXY GROUP",
    OCl: "OPEN CLUSTER",
    GCl: "GLOBULAR CLUSTER",
    "Cl+N": "CLUSTER + NEBULA",
    "*Ass": "STELLAR ASSOCIATION",
    PN: "PLANETARY NEBULA",
    HII: "HII REGION",
    Neb: "NEBULA",
    RfN: "REFLECTION NEBULA",
    EmN: "EMISSION NEBULA",
    DrkN: "DARK NEBULA",
    SNR: "SUPERNOVA REMNANT",
    "*": "STAR",
    "**": "DOUBLE STAR",
    Nova: "NOVA",
    Other: "OBJECT",
  };
  return labels[type] ?? type.toUpperCase();
}

/** Record → fixed-provider SkyTarget (same shape `messierTarget` produces). */
export function ngcTarget(rec: NgcRecord): SkyTarget {
  const names = NGC_COMMON_NAMES.filter((c) => c.ref === rec.name).map((c) => c.name);
  const display = names[0] ? `${rec.name} · ${names[0].toUpperCase()}` : rec.name;
  return fixedTarget({
    id: `ngc:${rec.name}`,
    name: display,
    kind: ngcKind(rec.type),
    aliases: [rec.name.toLowerCase(), ...names.map((n) => n.toLowerCase())],
    raDeg: rec.raDeg,
    decDeg: rec.decDeg,
    vmag: rec.vmag,
    apparent:
      rec.majArcmin != null
        ? {
            majorArcmin: rec.majArcmin,
            minorArcmin: rec.minArcmin ?? rec.majArcmin,
            paDeg: rec.paDeg ?? 0,
          }
        : undefined,
    facts: {
      kind: "dso",
      dsoType: rec.type,
      typeLabel: ngcTypeLabel(rec.type),
      constellation: rec.constellation,
      names,
    },
    source: "OPENNGC (CC-BY-SA-4.0) · J2000",
  });
}

/** Fuzzy-index entries for the common-named objects (the anonymous 13k stay pattern-only). */
export function ngcIndexEntries(cat: NgcCatalog): SkyIndexEntry[] {
  const out: SkyIndexEntry[] = [];
  for (const { name, ref } of NGC_COMMON_NAMES) {
    const rec = cat.byKey.get(nameKey(ref));
    if (!rec) continue;
    const keys = new Set<string>([normalizeSky(name), normalizeSky(rec.name)]);
    keys.add(normalizeSky(rec.name).replace(/ /g, ""));
    out.push({
      id: `ngc:${rec.name}`,
      name: `${rec.name} · ${name.toUpperCase()}`,
      detail: [
        ngcTypeLabel(rec.type),
        rec.constellation?.toUpperCase(),
        rec.vmag != null ? `MAG ${rec.vmag.toFixed(1)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      kind: ngcKind(rec.type),
      keys: [...keys],
      mag: rec.vmag,
      boost: 0.45 + Math.max(0, Math.min(0.15, (9 - (rec.vmag ?? 12)) * 0.03)),
    });
  }
  return out;
}

/** Catalog-id pattern search: "ngc 891" · "ic434" · "ngc 545 ned01" · "b33". One exact hit +
 *  its neighbours when the number has suffixed siblings. Returns [] for non-id queries. */
export function searchNgcById(cat: NgcCatalog, query: string, limit = 8): SkyIndexEntry[] {
  const m = normalizeSky(query)
    .replace(/\s+/g, "")
    .match(/^(ngc|ic|b|mel)0*(\d{1,4})([a-z0-9]*)$/);
  if (!m) return [];
  const [, prefix, num, suffix] = m;
  const out: SkyIndexEntry[] = [];
  const push = (rec: NgcRecord | undefined) => {
    if (!rec || out.some((e) => e.id === `ngc:${rec.name}`)) return;
    out.push({
      id: `ngc:${rec.name}`,
      name: rec.name,
      detail: [
        ngcTypeLabel(rec.type),
        rec.constellation?.toUpperCase(),
        rec.vmag != null ? `MAG ${rec.vmag.toFixed(1)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      kind: ngcKind(rec.type),
      keys: [],
      mag: rec.vmag,
      boost: 0,
    });
  };
  push(cat.byKey.get(`${prefix}${Number(num)}${suffix}`));
  if (!suffix) {
    // Bare number: surface suffixed siblings too (NGC 545 → NGC0545, NGC0545 NED01, …).
    for (const s of NGC_SUFFIXES) {
      if (out.length >= limit) break;
      push(cat.byKey.get(`${prefix}${Number(num)}${s.toLowerCase().replace(/\s+/g, "")}`));
    }
  }
  return out.slice(0, limit);
}
