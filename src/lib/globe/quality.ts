/**
 * Adaptive rendering quality — device-tier detection + a runtime frame-time governor.
 *
 * The keystone of the rendering quality pass (`.claude/claude-docs/rendering/RENDERING_QUALITY_PASS.md` WS1):
 * the scene had NO adaptive quality — DPR was a static `min(DPR, 2)` and the composer rendered full
 * quality every frame, so anything weaker than the author's M3 Pro had no way to shed load. This
 * module is the pure DECISION core: pick an initial tier from device capabilities, then step it
 * up/down at runtime from a smoothed frame time. GlobeCanvas owns APPLYING a tier to the renderer
 * (DPR, bloom, shadows); a later pass wires the tiles (error targets, LRU, vector budgets).
 *
 * INVARIANT: the `high` tier reproduces the pre-pass behaviour exactly (see `tuning.QUALITY`;
 * `quality.test.ts` locks it against the live constants), so a capable machine is byte-identical to
 * before and ONLY weaker hardware ever degrades — which is why this is safe to land without a
 * browser pass. Pure + three-free + DOM-free → unit-tested. The browser capability read lives in
 * GlobeCanvas (it needs the GL context + navigator); everything here is a pure function of inputs.
 */
export type QualityTier = "low" | "mid" | "high";

/** Ascending capability order — the governor moves one rung at a time along this. */
export const TIER_ORDER: readonly QualityTier[] = ["low", "mid", "high"];

/**
 * Per-renderer LRU byte cap for a tier (RENDERING_QUALITY_PASS WS1). Returns `null` on `high` —
 * meaning "restore the renderer's OWN library default" — so a capable machine is byte-identical to
 * before the quality pass (the whole safety property); mid/low convert their MiB budget to raw bytes
 * (3d-tiles-renderer's `LRUCache.maxBytesSize` is raw bytes, default 0.4·2³⁰). The scene modules
 * apply it as `maxBytesSize = cap ?? capturedDefault`. Pure → unit-tested.
 */
export function lruCapBytesForTier(tier: QualityTier, lruBytesMB: number): number | null {
  return tier === "high" ? null : Math.round(lruBytesMB * 1024 * 1024);
}

/**
 * The matching `LRUCache.minBytesSize` floor for a capped tier (UPLIFT U2/A9). The library ships
 * min=0.3·2³⁰ / max=0.4·2³⁰ as a PAIR: eviction rests the cache at `min`, and a freshly parsed
 * tile is DISCARDED outright when `cachedBytes >= maxBytesSize` (TilesRendererBase "cache full →
 * remove; it will be loaded again later"). Our mid/low caps (256/160 MB) sat UNDER the untouched
 * 0.3 GiB default floor, inverting the band: the cache could never rest below the cap, so in FPV
 * (working set ≥ cap) every parse landed on a full cache → discard → re-download — the visible
 * "full re-render" loop. The floor keeps the library's own 0.75 ratio; `null` in / `null` out
 * mirrors lruCapBytesForTier (high → restore BOTH captured defaults). Pure → unit-tested.
 */
export function lruFloorBytesForCap(capBytes: number | null): number | null {
  return capBytes === null ? null : Math.round(capBytes * 0.75);
}

// GPU-family heuristics. Deliberately conservative: an unknown string falls through to `mid`, and
// the runtime governor is the real backstop — this only sets a sane STARTING tier so the first
// seconds aren't jank while the governor settles. Strings come from WEBGL_debug_renderer_info.
const WEAK_GPU =
  /(swiftshader|llvmpipe|softwarerasterizer|basic render|mali-[t4]|mali-4|adreno \(tm\) [1-5]\d\d|powervr|intel.*(hd|uhd) graphics (3000|4000|5|6)|geforce (8|9|gt \d))/;
const STRONG_GPU =
  /(apple m[1-9]|apple gpu|rtx|radeon (rx|pro) |geforce (gtx 1[6-9]|rtx)|adreno \(tm\) 6[5-9]\d|adreno \(tm\) [7-9]\d\d)/;

/** Plain, duck-typed device signals (all optional so this is testable without a GL context). */
export interface DeviceCaps {
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL (case-insensitive; matched lower-cased). */
  rendererString?: string;
  /** navigator.deviceMemory (GB; Chrome-only, capped at 8; undefined elsewhere → assumed 8). */
  deviceMemoryGB?: number;
  /** navigator.hardwareConcurrency (logical cores; undefined → assumed 8). */
  cores?: number;
  /** renderer.capabilities.maxTextureSize. */
  maxTextureSize?: number;
  /** A failIfMajorPerformanceCaveat probe returned no context → software/blocked GL. */
  softwareGL?: boolean;
  /** matchMedia("(pointer: coarse)") — the primary input is a touchscreen (phone/tablet). Phones
   *  lie UPWARD on every other signal (iOS Safari exposes no deviceMemory and reports "Apple GPU"
   *  → STRONG_GPU, so an iPhone would detect `high`: dprCap 2 + bloom + 4096² shadows + the 8k
   *  texture budget). Coarse pointer caps the tier at `mid` (MOBILE_PLAN M0 texture tier). */
  coarsePointer?: boolean;
}

/**
 * Pick the initial tier from device capabilities. Precedence: hard-fail signals (software GL, a
 * texture size that can't even carry the 8k earth) → `low`; then GPU family gated by memory/cores.
 * Unknown hardware → `mid` (the governor corrects from there).
 */
export function detectDeviceTier(caps: DeviceCaps): QualityTier {
  if (caps.softwareGL) return "low";
  const tex = caps.maxTextureSize ?? 8192;
  if (tex < 8192) return "low";

  const s = (caps.rendererString ?? "").toLowerCase();
  const mem = caps.deviceMemoryGB ?? 8; // undefined off Chrome → assume a typical desktop
  const cores = caps.cores ?? 8;

  if (WEAK_GPU.test(s) || mem <= 4 || cores <= 3) return "low";
  // A coarse-pointer (touch-primary) device never STARTS above `mid` — phone GPU strings pass
  // STRONG_GPU and their memory signals default upward, but the VRAM/thermal envelope doesn't
  // carry the `high` budget (M0 rule; the ceiling in GlobeCanvas keeps the governor from
  // promoting past this either).
  if (STRONG_GPU.test(s) && mem >= 8 && cores >= 8) return caps.coarsePointer ? "mid" : "high";
  return "mid";
}

/** Frame-governor thresholds (ms of smoothed frame time) + hysteresis. Injected from tuning. */
export interface GovernorConfig {
  /** Step DOWN a tier when the EMA frame time stays above this (≈ below the target fps). */
  budgetMs: number;
  /** Step UP a tier when the EMA frame time stays below this (comfortable headroom). */
  restoreMs: number;
  /** EMA smoothing factor per frame (0..1). */
  emaAlpha: number;
  /** Consecutive over-budget frames before a step-down (debounce a transient hitch). */
  downFrames: number;
  /** Consecutive under-restore frames before a step-up (asymmetric: slow to re-add load). */
  upFrames: number;
  /** Minimum ms between tier changes (a DPR change reallocates targets — never thrash). */
  cooldownMs: number;
}

interface GovernorStep {
  tier: QualityTier;
  /** True on the frame the tier actually changed (the only time the caller re-applies). */
  changed: boolean;
}

export interface TierGovernor {
  readonly tier: QualityTier;
  /** Feed one frame's dt (ms); returns the current tier + whether it changed this frame. */
  step(dtMs: number): GovernorStep;
  /** DEV: jump to a tier (verification / A-B); resets the hysteresis + cooldown. */
  force(tier: QualityTier): void;
}

/**
 * A runtime tier governor seeded at `initial`, never rising above `ceiling` (the detected device
 * class — hardware can't be exceeded) nor falling below `floor`. Hysteresis (`downFrames`/`upFrames`)
 * + a `cooldownMs` gap prevent oscillation. On capable hardware the EMA never exceeds `budgetMs`, so
 * it is a no-op and the scene stays at the device tier — this is what keeps a strong machine unchanged.
 *
 * `floor` exists because a CONFIRMED-strong device (detected `high`) that can't hold the frame budget
 * at retina DPR should shed DPR/bloom/tile-detail — but NOT collapse to the weakest tier, which drops
 * bloom AND (historically) shadows and reads as broken on a flagship (owner-confirmed 2026-07-13: an
 * M3 Pro governed to `low` lost every shadow + bloom). A `high` device floors at `mid`; a `low`/`mid`
 * device may still bottom out.
 */
export function makeGovernor(
  initial: QualityTier,
  cfg: GovernorConfig,
  ceiling: QualityTier = initial,
  floor: QualityTier = "low",
): TierGovernor {
  let idx = TIER_ORDER.indexOf(initial);
  const ceilIdx = TIER_ORDER.indexOf(ceiling);
  const floorIdx = TIER_ORDER.indexOf(floor);
  let ema = 0;
  let over = 0;
  let under = 0;
  let sinceChangeMs = cfg.cooldownMs; // allow the first correction immediately

  return {
    get tier() {
      return TIER_ORDER[idx];
    },
    step(dtMs) {
      ema = ema === 0 ? dtMs : ema + cfg.emaAlpha * (dtMs - ema);
      sinceChangeMs += dtMs;

      if (ema > cfg.budgetMs) {
        over += 1;
        under = 0;
      } else if (ema < cfg.restoreMs) {
        under += 1;
        over = 0;
      } else {
        over = 0;
        under = 0;
      }

      let changed = false;
      if (sinceChangeMs >= cfg.cooldownMs) {
        if (over >= cfg.downFrames && idx > floorIdx) {
          idx -= 1;
          changed = true;
        } else if (under >= cfg.upFrames && idx < ceilIdx) {
          idx += 1;
          changed = true;
        }
      }
      if (changed) {
        sinceChangeMs = 0;
        over = 0;
        under = 0;
      }
      return { tier: TIER_ORDER[idx], changed };
    },
    force(tier) {
      idx = TIER_ORDER.indexOf(tier);
      over = 0;
      under = 0;
      sinceChangeMs = 0;
    },
  };
}
