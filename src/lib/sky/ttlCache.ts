/**
 * localStorage TTL cache with cached-miss support — ONE implementation (audit A6, 2026-08-13:
 * this was copy-pasted in simbad.ts and sbdb.ts). Hits and misses age separately; the blob is
 * capped by insertion order; storage failure degrades silently (the cache is an optimization
 * only, never a failure).
 *
 * CONTRACT (contracts.md §2): the persisted blobs `ftw:simbad:v1` / `ftw:sbdb:v1` predate this
 * module with per-file value keys (`o` / `body`) — reads tolerate the old row shapes (read-old-
 * keys precedent, Phase C); writes use the unified `v` key and the blob heals on next set.
 */

interface Row<T> {
  t: number;
  v?: T | null;
  /** Legacy simbad value key (pre-2026-08-13 blobs). */
  o?: T | null;
  /** Legacy sbdb value key (pre-2026-08-13 blobs). */
  body?: T | null;
}

const rowValue = <T>(row: Row<T>): T | null =>
  row.v !== undefined ? row.v : row.o !== undefined ? (row.o ?? null) : (row.body ?? null);

export interface TtlCache<T> {
  /** The value · null = cached definitive miss · undefined = never asked / expired. */
  get(key: string): T | null | undefined;
  /** Cache a value (or null = definitive miss). */
  set(key: string, value: T | null): void;
  /** Every live value in the blob (for reload-persistence id scans). */
  values(): (T | null)[];
}

export function makeTtlCache<T>(opts: {
  storageKey: string;
  hitTtlMs: number;
  missTtlMs: number;
  cap: number;
}): TtlCache<T> {
  const read = (): Record<string, Row<T>> => {
    try {
      return JSON.parse(localStorage.getItem(opts.storageKey) ?? "{}") as Record<string, Row<T>>;
    } catch {
      return {};
    }
  };
  const write = (c: Record<string, Row<T>>): void => {
    try {
      const keys = Object.keys(c);
      if (keys.length > opts.cap)
        for (const k of keys.slice(0, keys.length - opts.cap)) delete c[k];
      localStorage.setItem(opts.storageKey, JSON.stringify(c));
    } catch {
      /* storage full/unavailable — the cache is an optimization, never a failure */
    }
  };
  return {
    get(key) {
      const row = read()[key];
      if (!row) return undefined;
      const v = rowValue(row);
      if (Date.now() - row.t > (v ? opts.hitTtlMs : opts.missTtlMs)) return undefined;
      return v;
    },
    set(key, value) {
      const c = read();
      c[key] = { t: Date.now(), v: value };
      write(c);
    },
    values() {
      return Object.values(read()).map(rowValue);
    },
  };
}
