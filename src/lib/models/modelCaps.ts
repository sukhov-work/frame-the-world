/**
 * User-model upload contract (MESH SUITE MS4, D3 — 2026-09-02): the per-file technical caps, the
 * drop classifier that forks the UPLOAD modal between photos and models, the audit that turns a
 * loaded model's facts into a verdict, and the decimation plan. PURE — no three, no DOM — so every
 * rule here is unit-tested (`test/lib/models/modelCaps.test.ts`); the three-dependent loader /
 * normalizer is `normalizeModel.ts` (browser tier), and the server re-applies the byte rules
 * against the Media descriptor it fetched itself (`lib/wix/modelRecords.ts`).
 *
 * The caps are per-file HEALTH, not a quota (owner 2026-09-01c: "no limits" — the density warning
 * and the MDL deck chip arrive at MS5). Over-budget triangles are DECIMATED, not refused
 * (MeshoptSimplifier ships inside three); oversize textures are DOWNSCALED by the exporter
 * (`maxTextureSize`, then a 2048 → 1024 → 512 ladder until the GLB fits); animations are dropped
 * (the exporter writes none unless asked); the remaining rules refuse with a named reason.
 */

import { formatBytes } from "../format/readout";

export interface ModelCaps {
  /** Triangles after normalization; more → auto-decimate down to this. */
  readonly maxTris: number;
  /** Longest texture edge the exporter keeps on the first rung (free downscale). */
  readonly maxTextureEdge: number;
  /** Distinct textures across all materials. */
  readonly maxTextures: number;
  /** Mesh count (≈ draw calls) per model. */
  readonly maxMeshes: number;
  /** Source bytes across the whole drop (model + companions) — refused BEFORE parsing. */
  readonly maxRawBytes: number;
  /** The normalized GLB — the bytes Wix Media stores and every visitor streams. */
  readonly maxGlbBytes: number;
}

export const MODEL_CAPS: ModelCaps = {
  maxTris: 100_000,
  maxTextureEdge: 2048,
  maxTextures: 8,
  maxMeshes: 25,
  maxRawBytes: 15 * 1024 * 1024,
  maxGlbBytes: 8 * 1024 * 1024,
};

/** The texture-edge ladder the packer walks until the GLB fits under `maxGlbBytes`. */
export const TEXTURE_EDGE_LADDER: readonly number[] = [2048, 1024, 512];

export type ModelFormat = "glb" | "gltf" | "obj" | "fbx";
export const MODEL_FORMATS: readonly ModelFormat[] = ["glb", "gltf", "obj", "fbx"];

/** The file-input `accept` list for models — companions included so a multi-file pick works. */
export const MODEL_ACCEPT = ".glb,.gltf,.obj,.fbx,.bin,.mtl";

const ext = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
};

/** The model format a file name announces, or null for anything that is not a model. */
export function modelFormatOf(name: string): ModelFormat | null {
  const e = ext(name);
  return (MODEL_FORMATS as readonly string[]).includes(e) ? (e as ModelFormat) : null;
}

export type DropClassification =
  | { kind: "none" }
  /** The legacy photo path — the FIRST file, exactly as `DropStep.onFiles` always took it. */
  | { kind: "photo"; index: number }
  /** ONE model per drop; every other non-model file rides along as a companion (a `.bin`
   *  buffer, an `.mtl`, textures) resolved by basename; extra model files are named + ignored. */
  | { kind: "model"; index: number; format: ModelFormat; companions: number[]; ignored: string[] };

/**
 * Fork a dropped file list between the photo pipeline and the model pipeline. A drop that
 * carries ANY model file is a model drop (a stray photo beside a `.glb` is far likelier a
 * texture than a second intent); a drop with none keeps the photo path byte-identical.
 */
export function classifyDrop(files: ReadonlyArray<{ name: string }>): DropClassification {
  if (files.length === 0) return { kind: "none" };
  let index = -1;
  let format: ModelFormat | null = null;
  const ignored: string[] = [];
  const companions: number[] = [];
  files.forEach((f, i) => {
    const fmt = modelFormatOf(f.name);
    if (fmt && index < 0) {
      index = i;
      format = fmt;
    } else if (fmt) {
      ignored.push(f.name);
    } else {
      companions.push(i);
    }
  });
  if (index < 0 || !format) return { kind: "photo", index: 0 };
  return { kind: "model", index, format, companions, ignored };
}

/** What the inspector read off a loaded model (bounds already in metres — unit scale applied). */
export interface ModelStats {
  tris: number;
  meshes: number;
  textures: number;
  /** Longest edge among the textures (0 = untextured). */
  maxTextureEdge: number;
  animations: number;
  skinned: boolean;
  morphs: boolean;
  /** Axis-aligned extent in metres: [x, y (up), z]. */
  bbox: [number, number, number];
}

export type ModelViolation =
  | { code: "RAW_TOO_LARGE"; bytes: number; max: number }
  | { code: "GLB_TOO_LARGE"; bytes: number; max: number; edge: number }
  | { code: "TOO_MANY_MESHES"; count: number; max: number }
  | { code: "TOO_MANY_TEXTURES"; count: number; max: number }
  | { code: "TOO_MANY_TRIS"; count: number; max: number }
  | { code: "RIGGED" }
  | { code: "EMPTY" }
  | { code: "UNSUPPORTED_COMPRESSION" };

export interface ModelAudit {
  violations: ModelViolation[];
  /** Triangle budget to decimate down to (null = already within budget). */
  decimateTo: number | null;
  /** Non-blocking notes the review card shows (downscaled textures, dropped animations). */
  warnings: string[];
}

/** The verdict on a loaded model's facts. Refusals are named; triangles over budget become a
 *  decimation target rather than a refusal (the §1 "auto-decimate instead of rejecting" call). */
export function auditModelStats(stats: ModelStats, caps: ModelCaps = MODEL_CAPS): ModelAudit {
  const violations: ModelViolation[] = [];
  const warnings: string[] = [];
  if (!(stats.tris > 0)) violations.push({ code: "EMPTY" });
  if (stats.meshes > caps.maxMeshes)
    violations.push({ code: "TOO_MANY_MESHES", count: stats.meshes, max: caps.maxMeshes });
  if (stats.textures > caps.maxTextures)
    violations.push({ code: "TOO_MANY_TEXTURES", count: stats.textures, max: caps.maxTextures });
  if (stats.skinned || stats.morphs) violations.push({ code: "RIGGED" });
  if (stats.maxTextureEdge > caps.maxTextureEdge)
    warnings.push(`TEXTURES DOWNSCALED TO ${caps.maxTextureEdge}² (WAS ${stats.maxTextureEdge}²)`);
  if (stats.animations > 0)
    warnings.push(
      `${stats.animations} ANIMATION${stats.animations === 1 ? "" : "S"} DROPPED — MODELS ARE STATIC`,
    );
  return {
    violations,
    decimateTo: stats.tris > caps.maxTris ? caps.maxTris : null,
    warnings,
  };
}

/** Source-size gate — runs on the drop, before a single byte is parsed. */
export function auditRawSize(bytes: number, caps: ModelCaps = MODEL_CAPS): ModelViolation | null {
  return bytes > caps.maxRawBytes ? { code: "RAW_TOO_LARGE", bytes, max: caps.maxRawBytes } : null;
}

/** Packed-size gate — the exporter's output at the LAST rung of the texture ladder. */
export function auditGlbSize(
  bytes: number,
  edge: number,
  caps: ModelCaps = MODEL_CAPS,
): ModelViolation | null {
  return bytes > caps.maxGlbBytes ? { code: "GLB_TOO_LARGE", bytes, max: caps.maxGlbBytes, edge } : null;
}

/**
 * Per-mesh triangle targets that bring the total under `maxTris`, proportional to each mesh's
 * share (a hero mesh keeps most of its detail; a bolt keeps at least one triangle). `locked`
 * meshes (multi-material groups — simplifying them scrambles the group ranges) keep their
 * count and shrink the budget for the others; null = impossible (the locked meshes alone bust
 * the cap), which the audit reports as TOO_MANY_TRIS.
 */
export function decimationPlan(
  triCounts: readonly number[],
  locked: readonly boolean[],
  maxTris: number,
): number[] | null {
  const total = triCounts.reduce((a, b) => a + b, 0);
  if (total <= maxTris) return [...triCounts];
  let lockedTotal = 0;
  let freeTotal = 0;
  triCounts.forEach((t, i) => (locked[i] ? (lockedTotal += t) : (freeTotal += t)));
  const budget = maxTris - lockedTotal;
  if (budget < triCounts.filter((t, i) => !locked[i] && t > 0).length) return null;
  const ratio = freeTotal > 0 ? budget / freeTotal : 0;
  const targets = triCounts.map((t, i) => (locked[i] || t === 0 ? t : Math.max(1, Math.floor(t * ratio))));
  // The 1-triangle floors can push the sum past the budget on a swarm of tiny meshes — shave
  // the largest free targets until it fits (always terminates: the floors were checked above).
  let sum = targets.reduce((a, b) => a + b, 0);
  while (sum > maxTris) {
    let big = -1;
    targets.forEach((t, i) => {
      if (!locked[i] && t > 1 && (big < 0 || t > targets[big])) big = i;
    });
    if (big < 0) return null;
    targets[big]--;
    sum--;
  }
  return targets;
}

export type ModelUnit = "m" | "cm" | "mm" | "in" | "ft";
export const MODEL_UNITS: readonly ModelUnit[] = ["m", "cm", "mm", "in", "ft"];
/** Metres per source unit. */
export const UNIT_SCALE: Record<ModelUnit, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

/**
 * A units guess from the raw longest extent: glTF is metres by spec, but OBJ/FBX carry whatever
 * the authoring tool used and a centimetre building reads as a 3 km monolith. Heuristic — the
 * review card lets the member override it (raw ≤ 600 → m · ≤ 60 000 → cm · else mm).
 */
export function suggestUnit(maxExtentRaw: number): ModelUnit {
  if (!(maxExtentRaw > 0)) return "m";
  if (maxExtentRaw <= 600) return "m";
  if (maxExtentRaw <= 60_000) return "cm";
  return "mm";
}

/** Compact triangle counts for the card: 312K · 98.4K · 7,300. */
export function formatTris(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100_000) return `${Math.round(n / 1000)}K`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** Member-facing copy for a refusal (house style: uppercase instrument labels). */
export function violationMessage(v: ModelViolation): string {
  switch (v.code) {
    case "RAW_TOO_LARGE":
      return `FILE IS ${formatBytes(v.bytes)} — THE LIMIT IS ${formatBytes(v.max)}`;
    case "GLB_TOO_LARGE":
      return `PACKED MODEL IS ${formatBytes(v.bytes)} — OVER THE ${formatBytes(v.max)} LIMIT EVEN AT ${v.edge}² TEXTURES. SIMPLIFY OR STRIP TEXTURES`;
    case "TOO_MANY_MESHES":
      return `${v.count} MESHES — JOIN THEM DOWN TO ${v.max} OR FEWER`;
    case "TOO_MANY_TEXTURES":
      return `${v.count} TEXTURES — THE LIMIT IS ${v.max} (BAKE AN ATLAS)`;
    case "TOO_MANY_TRIS":
      return `${formatTris(v.count)} TRIANGLES IN MULTI-MATERIAL MESHES CANNOT BE DECIMATED — SPLIT BY MATERIAL OR SIMPLIFY TO ${formatTris(v.max)}`;
    case "RIGGED":
      return "RIGGED / MORPHING MODELS ARE NOT SUPPORTED YET — EXPORT A STATIC MESH";
    case "EMPTY":
      return "NO TRIANGLES FOUND — IS THIS A POINT CLOUD OR AN EMPTY SCENE?";
    case "UNSUPPORTED_COMPRESSION":
      return "DRACO / KTX2 COMPRESSED FILES ARE NOT SUPPORTED YET — EXPORT UNCOMPRESSED";
  }
}
