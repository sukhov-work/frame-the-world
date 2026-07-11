import { encodeGeohash } from "../geo/geohash";

/**
 * Pin appearance helpers (Phase 5.5 S4, §Item 6) — pure, unit-tested. Everything the pin layer
 * derives deterministically from pin identity lives here: the per-author hue pick and the
 * per-pin stem-height stagger (with neighbor de-leveling inside a gh6 cell). The actual colours
 * stay in `lib/theme/tokens.ts` (D14) — this module only returns INDICES and UNIT heights;
 * `globe/Pins.ts` maps them through tuning + tokens.
 */

/** Deterministic 32-bit FNV-1a hash of a string (stable across sessions/platforms). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** hashString mapped to [0, 1). */
export function hash01(s: string): number {
  return hashString(s) / 4294967296;
}

/**
 * Weighted hue pick for an author: hash(salt + authorName) lands in the cumulative weight span,
 * so an author keeps ONE hue everywhere, forever. Anonymous / pre-back-fill pins (null) take
 * index 0 — the teal anchor. Weights + salt come from tuning (teal-heavy, warm rare); the salt
 * is the palette SEED — reshuffles every author↔hue assignment at once, tuned so the launch
 * authors read distinct.
 */
export function pinHueIndex(
  authorName: string | null,
  weights: readonly number[],
  salt = "",
): number {
  if (!authorName || weights.length === 0) return 0;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = hash01(salt + authorName) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return 0; // float edge (hash01 ≈ 1): fall back to the anchor
}

export interface StaggerPin {
  id: string;
  lat: number;
  lon: number;
}

export interface ClusterLayout {
  /** Per-pin stem-height stagger, unit values in [0, 1). */
  stagger01: number[];
  /** Per-pin UNIT ring slot (evenly spaced angles, cell-hashed rotation): east / north.
   *  0 for solo pins — the render layer scales slots by the zoom-adaptive ring radius. */
  offsetE: number[];
  offsetN: number[];
  /** Per-pin cluster index into `clusters`; −1 for solo pins. */
  clusterOf: number[];
  /** Member index lists of every multi-pin cluster (same gh6 cell), each length ≥ 2;
   *  members are rank-ordered (member[0] = the cluster's collapsed representative). */
  clusters: number[][];
}

/**
 * Per-pin de-clustering layout (owner ask 2026-07-11: colocated pins were "hard to pick and
 * understand"). A lone pin keeps its own hash height; pins sharing a gh6 cell (~1.2 km ×
 * 0.6 km — the public-pin reduction cell) are de-leveled (rank-ordered by hash, snapped to
 * evenly spaced height slots) and get UNIT ring slots + cluster membership — the render layer
 * (globe/Pins.ts) drives the ADAPTIVE behaviour from these: collapsed single marker far out,
 * min-separation ring mid-band, true coordinates near. Order-independent: the layout depends
 * only on the SET of pins.
 */
export function clusterLayout(pins: readonly StaggerPin[]): ClusterLayout {
  const n = pins.length;
  const layout: ClusterLayout = {
    stagger01: new Array<number>(n),
    offsetE: new Array<number>(n).fill(0),
    offsetN: new Array<number>(n).fill(0),
    clusterOf: new Array<number>(n).fill(-1),
    clusters: [],
  };
  const cells = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const cell = encodeGeohash(pins[i].lat, pins[i].lon, 6);
    const members = cells.get(cell);
    if (members) members.push(i);
    else cells.set(cell, [i]);
  }
  for (const [cell, members] of cells) {
    if (members.length === 1) {
      const i = members[0];
      layout.stagger01[i] = hash01(pins[i].id);
      continue;
    }
    members.sort((a, b) => {
      const d = hash01(pins[a].id) - hash01(pins[b].id);
      return d !== 0 ? d : pins[a].id < pins[b].id ? -1 : 1;
    });
    const clusterIdx = layout.clusters.length;
    layout.clusters.push(members);
    const phase = hash01(cell) * Math.PI * 2; // ring rotation — clusters don't all align N
    for (let rank = 0; rank < members.length; rank++) {
      layout.stagger01[members[rank]] = (rank + 0.5) / members.length;
      const angle = phase + (Math.PI * 2 * rank) / members.length;
      layout.offsetE[members[rank]] = Math.sin(angle);
      layout.offsetN[members[rank]] = Math.cos(angle);
      layout.clusterOf[members[rank]] = clusterIdx;
    }
  }
  return layout;
}

/** Ring radius (m) so `n` evenly spaced heads sit ≥ `sepM` apart (neighbor chord = 2r·sin(π/n)). */
export function ringRadiusM(n: number, sepM: number): number {
  if (n < 2) return 0;
  return sepM / (2 * Math.sin(Math.PI / n));
}

/** Proximity ramp: 1 at/below `loM`, 0 at/above `hiM`, hermite-smooth between — the shape of
 *  both the cluster spread-in (crossing ~300 km) and the near-ground merge (crossing ~1 km). */
export function proximityFactor(distM: number, loM: number, hiM: number): number {
  const t = Math.min(1, Math.max(0, (distM - loM) / (hiM - loM)));
  return 1 - t * t * (3 - 2 * t);
}

/** How much cluster members sit at their TRUE coordinates: 1 once their real minimum
 *  separation covers the required separation at this zoom (fluid handover to truth). */
export function trueBlend(trueMinSepM: number, requiredSepM: number): number {
  if (requiredSepM <= 0) return 1;
  return Math.min(1, trueMinSepM / requiredSepM);
}
