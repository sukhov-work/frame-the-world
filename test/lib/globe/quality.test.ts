import { describe, it, expect } from "vitest";
import {
  detectDeviceTier,
  lruCapBytesForTier,
  lruCapBytesForUltra,
  lruFloorBytesForCap,
  makeGovernor,
  ultraTileLevers,
  peripheryErrorTarget,
  queueCapsForTier,
  stickyOverlayPx,
  TIER_ORDER,
  type FoveationTierCfg,
  type GovernorConfig,
} from "../../../src/lib/globe/quality";
import { FOVEATION, LOADING, QUALITY, RENDERER, SHADOWS, GROUND, TILESETS, VECTOR, STREETS } from "../../../src/components/globe/tuning";

describe("detectDeviceTier", () => {
  it("returns high for a strong GPU with ample memory + cores", () => {
    expect(
      detectDeviceTier({
        rendererString: "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)",
        deviceMemoryGB: 8,
        cores: 12,
        maxTextureSize: 16384,
      }),
    ).toBe("high");
  });

  it("returns low for software/blocked GL regardless of other signals", () => {
    expect(
      detectDeviceTier({ softwareGL: true, rendererString: "Apple M3 Pro", maxTextureSize: 16384 }),
    ).toBe("low");
  });

  it("returns low for a known-weak GPU family", () => {
    expect(
      detectDeviceTier({
        rendererString: "Mali-400 MP",
        deviceMemoryGB: 8,
        cores: 8,
        maxTextureSize: 8192,
      }),
    ).toBe("low");
  });

  it("returns low for a SwiftShader/llvmpipe software renderer string", () => {
    expect(detectDeviceTier({ rendererString: "Google SwiftShader" })).toBe("low");
    expect(detectDeviceTier({ rendererString: "llvmpipe (LLVM 15.0.7, 256 bits)" })).toBe("low");
  });

  it("returns low when the GPU cannot even carry the 8k earth texture", () => {
    expect(detectDeviceTier({ rendererString: "Apple M3 Pro", maxTextureSize: 4096 })).toBe("low");
  });

  it("returns low for a low-memory device even with an unknown GPU", () => {
    expect(detectDeviceTier({ deviceMemoryGB: 4, cores: 4, maxTextureSize: 8192 })).toBe("low");
  });

  it("returns mid for unknown hardware (the governor is the backstop)", () => {
    expect(
      detectDeviceTier({ rendererString: "Some Unknown GPU 1000", maxTextureSize: 8192 }),
    ).toBe("mid");
  });

  it("does not over-promote a strong GPU that is starved of memory", () => {
    expect(
      detectDeviceTier({ rendererString: "NVIDIA GeForce RTX 4090", deviceMemoryGB: 4, cores: 16 }),
    ).toBe("low");
  });

  it("assumes a capable desktop when Chrome-only signals are absent", () => {
    // deviceMemory/cores undefined off Chrome → assumed 8; a strong string still reaches high.
    expect(detectDeviceTier({ rendererString: "Apple M2", maxTextureSize: 16384 })).toBe("high");
  });

  it("caps a strong-GPU coarse-pointer device (phone/tablet) at mid — MOBILE_PLAN M0", () => {
    // The exact iPhone shape: "Apple GPU" passes STRONG_GPU, deviceMemory is absent on iOS
    // Safari (→ assumed 8), and modern phones report maxTextureSize ≥ 8192 — without the
    // coarse-pointer cap this would detect `high` (dprCap 2 + bloom + the 8k texture budget).
    expect(
      detectDeviceTier({ rendererString: "Apple GPU", maxTextureSize: 16384, coarsePointer: true }),
    ).toBe("mid");
  });

  it("keeps a coarse-pointer weak device at low (the cap never lifts a tier)", () => {
    expect(
      detectDeviceTier({ rendererString: "Mali-400 MP", maxTextureSize: 8192, coarsePointer: true }),
    ).toBe("low");
  });

  it("leaves fine-pointer detection unchanged when coarsePointer is explicitly false", () => {
    expect(
      detectDeviceTier({ rendererString: "Apple M2", maxTextureSize: 16384, coarsePointer: false }),
    ).toBe("high");
  });
});

// Deliberately tiny thresholds so the state machine is exercised in a handful of frames.
const CFG: GovernorConfig = {
  budgetMs: 20,
  restoreMs: 12,
  emaAlpha: 1, // no smoothing — EMA == the latest dt, so transitions are deterministic
  downFrames: 3,
  upFrames: 3,
  cooldownMs: 0,
};

describe("makeGovernor", () => {
  it("starts at the initial tier and reports it", () => {
    expect(makeGovernor("high", CFG).tier).toBe("high");
  });

  it("steps down one rung after sustained over-budget frames", () => {
    const g = makeGovernor("high", CFG, "high");
    let changed = false;
    for (let i = 0; i < 3; i++) changed = g.step(30).changed; // 30 ms > budget
    expect(changed).toBe(true);
    expect(g.tier).toBe("mid");
  });

  it("does not drop before the hysteresis count is met", () => {
    const g = makeGovernor("high", CFG, "high");
    g.step(30);
    g.step(30);
    expect(g.tier).toBe("high"); // only 2 of 3 required over-budget frames
  });

  it("steps back up after sustained headroom, never above the ceiling", () => {
    const g = makeGovernor("low", CFG, "mid"); // ceiling = mid (a mid device)
    for (let i = 0; i < 3; i++) g.step(5); // fast frames → step up
    expect(g.tier).toBe("mid");
    for (let i = 0; i < 6; i++) g.step(5); // keep going — must NOT exceed the ceiling
    expect(g.tier).toBe("mid");
  });

  it("never drops below the lowest tier", () => {
    const g = makeGovernor("low", CFG, "low");
    for (let i = 0; i < 10; i++) g.step(50);
    expect(g.tier).toBe("low");
  });

  it("never drops below the floor — a strong (high) device stops at mid, not low", () => {
    // Regression guard (2026-07-13): an M3 Pro governed to `low` at retina DPR lost shadows + bloom.
    // A `high`-detected device floors at `mid` so the core look survives frame-rate throttling.
    const g = makeGovernor("high", CFG, "high", "mid");
    for (let i = 0; i < 30; i++) g.step(50); // sustained over-budget — would reach `low` without a floor
    expect(g.tier).toBe("mid");
  });

  it("respects the cooldown between changes", () => {
    const cfg: GovernorConfig = { ...CFG, downFrames: 1, cooldownMs: 100 };
    const g = makeGovernor("high", cfg, "high");
    // First step is allowed immediately (init grants the first correction): high → mid, resets the
    // cooldown timer to 0.
    expect(g.step(30).changed).toBe(true);
    // The next over-budget frames are within the 100 ms cooldown → no change (30, 60, 90 ms).
    expect(g.step(30).changed).toBe(false);
    g.step(30);
    g.step(30);
    expect(g.tier).toBe("mid");
    // The frame that crosses 100 ms of accumulated cooldown is free to drop again: mid → low.
    expect(g.step(30).changed).toBe(true);
    expect(g.tier).toBe("low");
  });

  it("force() jumps to a tier and clears counters", () => {
    const g = makeGovernor("high", CFG, "high");
    g.force("low");
    expect(g.tier).toBe("low");
  });

  it("emaMs() exposes the live smoothed frame time (U5 probe)", () => {
    const g = makeGovernor("high", CFG, "high"); // emaAlpha 1 → EMA == latest dt
    expect(g.emaMs()).toBe(0);
    g.step(16);
    expect(g.emaMs()).toBe(16);
  });

  it("hitchCount() counts RAW frames above hitchMs, not the EMA (U5 A/B metric)", () => {
    const g = makeGovernor("high", { ...CFG, emaAlpha: 0.01, hitchMs: 40 }, "high");
    g.step(60); // hitch — even though the EMA barely moves
    g.step(16);
    g.step(41); // hitch
    g.step(40); // exactly at the threshold — not a hitch
    expect(g.hitchCount()).toBe(2);
  });

  it("hitchMs defaults to 50 ms when the config omits it", () => {
    const g = makeGovernor("high", CFG, "high"); // CFG has no hitchMs
    g.step(51);
    g.step(49);
    expect(g.hitchCount()).toBe(1);
  });

  it("is a no-op on comfortable frame times (strong hardware stays put)", () => {
    const g = makeGovernor("high", CFG, "high");
    for (let i = 0; i < 100; i++) expect(g.step(16).changed).toBe(false); // 12 < 16 < 20 = neutral band
    expect(g.tier).toBe("high");
  });
});

describe("QUALITY.tiers.high INVARIANT — must equal the pre-pass constants", () => {
  // Locks the safety property: a capable machine renders byte-identical to before the quality pass.
  const high = QUALITY.tiers.high;
  it("dprCap == RENDERER.maxPixelRatio", () => {
    expect(high.dprCap).toBe(RENDERER.maxPixelRatio);
  });
  it("shadowMapSize == SHADOWS.mapSize", () => {
    expect(high.shadowMapSize).toBe(SHADOWS.mapSize);
  });
  it("groundErrorNear == GROUND.errorTargetNear", () => {
    expect(high.groundErrorNear).toBe(GROUND.errorTargetNear);
  });
  it("vectorLatticeBudget == VECTOR.latticeBudgetPerFrame", () => {
    expect(high.vectorLatticeBudget).toBe(VECTOR.latticeBudgetPerFrame);
  });
  it("maxStreetNames == STREETS.maxVisible", () => {
    expect(high.maxStreetNames).toBe(STREETS.maxVisible);
  });
  it("keeps bloom + shadows on and the library-default 16 SSE / 0.4 GB LRU", () => {
    expect(high.bloom).toBe(true);
    expect(high.shadowsEnabled).toBe(true);
    expect(high.buildingErrorTarget).toBe(16); // 3d-tiles-renderer default errorTarget
    expect(high.lruBytesMB).toBe(400); // LRUCache default maxBytesSize (0.4 GB)
  });
  it("U6: foveation is OFF on high (null — a capable machine stays byte-identical)", () => {
    expect(high.foveation).toBeNull();
  });
  it("#15 overlayResolutionPx: high == GROUND.overlayResolution (byte-identical); mid/low shrink", () => {
    expect(high.overlayResolutionPx).toBe(GROUND.overlayResolution);
    expect(QUALITY.tiers.mid.overlayResolutionPx).toBe(256);
    expect(QUALITY.tiers.low.overlayResolutionPx).toBe(256);
  });
  it("#15 groundLruBytesMB: high == lruBytesMB (null-restore path); mid/low raise is GROUND-only and modest", () => {
    expect(high.groundLruBytesMB).toBe(high.lruBytesMB);
    for (const t of ["mid", "low"] as const) {
      const tier = QUALITY.tiers[t];
      expect(tier.groundLruBytesMB).toBeGreaterThanOrEqual(tier.lruBytesMB); // a raise, never a cut
      expect(tier.groundLruBytesMB).toBeLessThanOrEqual(tier.lruBytesMB * 1.3); // modest — jetsam guard
    }
  });
  it("#5 lean-mobile overrides only ever CLAMP below the coarse-pointer ceiling (mid)", () => {
    // The lean profile is a coarse-pointer-only override on top of the running tier — it must
    // never exceed what mid grants (else 'lean' could accidentally UPGRADE a governed device),
    // and bloom-off is its point (the ~12 fullscreen draws are the phone heat driver).
    const lean = QUALITY.leanMobile;
    expect(lean.dprCap).toBeLessThanOrEqual(QUALITY.tiers.mid.dprCap);
    expect(lean.shadowMapSize).toBeLessThanOrEqual(QUALITY.tiers.mid.shadowMapSize);
    expect(lean.bloom).toBe(false);
    // QA-7b: the flat-2D-chart relaxation may spend heat on crispness but never exceed what
    // the mid ceiling grants — and it must actually be a relaxation, not a second cut.
    expect(lean.dprCap2d).toBeLessThanOrEqual(QUALITY.tiers.mid.dprCap);
    expect(lean.dprCap2d).toBeGreaterThanOrEqual(lean.dprCap);
    // QA-7b: the coarse Esri ceiling stays a demand SHRINK (≤ desktop z19) and can never
    // exceed the tileset's real refinement; QA-7a's de-grade strength is a proper blend.
    expect(TILESETS.esriMaxLevelCoarse).toBeLessThanOrEqual(TILESETS.esriMaxLevel);
    expect(GROUND.flat2dPhotoK).toBeGreaterThanOrEqual(0);
    expect(GROUND.flat2dPhotoK).toBeLessThanOrEqual(1);
  });
  it("degrades monotonically across tiers (each lever eases toward low)", () => {
    const { high: h, mid: m, low: l } = QUALITY.tiers;
    expect(h.dprCap).toBeGreaterThanOrEqual(m.dprCap);
    expect(m.dprCap).toBeGreaterThanOrEqual(l.dprCap);
    expect(h.buildingErrorTarget).toBeLessThanOrEqual(m.buildingErrorTarget);
    expect(m.buildingErrorTarget).toBeLessThanOrEqual(l.buildingErrorTarget);
    expect(h.groundErrorNear).toBeLessThanOrEqual(m.groundErrorNear);
    expect(m.groundErrorNear).toBeLessThanOrEqual(l.groundErrorNear);
    expect(h.maxStreetNames).toBeGreaterThanOrEqual(m.maxStreetNames);
    expect(m.maxStreetNames).toBeGreaterThanOrEqual(l.maxStreetNames);
    expect(h.vectorLatticeBudget).toBeGreaterThanOrEqual(m.vectorLatticeBudget);
    expect(m.vectorLatticeBudget).toBeGreaterThanOrEqual(l.vectorLatticeBudget);
    expect(h.lruBytesMB).toBeGreaterThanOrEqual(m.lruBytesMB);
    expect(m.lruBytesMB).toBeGreaterThanOrEqual(l.lruBytesMB);
    expect(TIER_ORDER).toEqual(["low", "mid", "high"]);
  });
});

describe("lruCapBytesForTier — the byte-identical-on-high LRU rule (WS1)", () => {
  const LIBRARY_DEFAULT_BYTES = 0.4 * 2 ** 30; // 3d-tiles-renderer LRUCache.maxBytesSize default

  it("returns null on high so each renderer keeps its captured library default (byte-identical)", () => {
    expect(lruCapBytesForTier("high", QUALITY.tiers.high.lruBytesMB)).toBeNull();
  });

  it("converts mid/low MiB budgets to raw bytes (the units LRUCache.maxBytesSize expects)", () => {
    expect(lruCapBytesForTier("mid", QUALITY.tiers.mid.lruBytesMB)).toBe(
      Math.round(QUALITY.tiers.mid.lruBytesMB * 1024 * 1024),
    );
    expect(lruCapBytesForTier("low", 160)).toBe(160 * 1024 * 1024);
  });

  it("mid/low caps sit below the library default — they actually tighten memory", () => {
    expect(lruCapBytesForTier("mid", QUALITY.tiers.mid.lruBytesMB)!).toBeLessThan(LIBRARY_DEFAULT_BYTES);
    expect(lruCapBytesForTier("low", QUALITY.tiers.low.lruBytesMB)!).toBeLessThan(LIBRARY_DEFAULT_BYTES);
  });
});

describe("queueCapsForTier — the U5 null-on-high concurrency rule", () => {
  // 3d-tiles-renderer 0.4.28 ships downloadQueue.maxJobs 25 / parseQueue.maxJobs 5.
  const LIB_DOWNLOAD_JOBS = 25;
  const LIB_PARSE_JOBS = 5;

  it("returns null on high so each renderer keeps its captured library defaults", () => {
    expect(queueCapsForTier("high", LOADING.queueCaps)).toBeNull();
  });

  it("returns the tier's caps on mid/low", () => {
    expect(queueCapsForTier("mid", LOADING.queueCaps)).toEqual(LOADING.queueCaps.mid);
    expect(queueCapsForTier("low", LOADING.queueCaps)).toEqual(LOADING.queueCaps.low);
  });

  it("mid/low caps sit below the library defaults and degrade monotonically", () => {
    for (const tier of ["mid", "low"] as const) {
      const caps = queueCapsForTier(tier, LOADING.queueCaps)!;
      expect(caps.download).toBeLessThan(LIB_DOWNLOAD_JOBS);
      expect(caps.parse).toBeLessThan(LIB_PARSE_JOBS);
      expect(caps.download).toBeGreaterThan(0);
      expect(caps.parse).toBeGreaterThan(0);
    }
    expect(LOADING.queueCaps.mid.download).toBeGreaterThanOrEqual(LOADING.queueCaps.low.download);
    expect(LOADING.queueCaps.mid.parse).toBeGreaterThanOrEqual(LOADING.queueCaps.low.parse);
  });
});

describe("lruFloorBytesForCap — the U2/A9 min/max pair rule", () => {
  const LIBRARY_DEFAULT_MIN_BYTES = 0.3 * 2 ** 30; // LRUCache.minBytesSize default

  it("returns null for null (high tier restores BOTH captured library defaults)", () => {
    expect(lruFloorBytesForCap(null)).toBeNull();
  });

  it("keeps the library's own 0.75 min/max ratio", () => {
    expect(lruFloorBytesForCap(400 * 1024 * 1024)).toBe(300 * 1024 * 1024);
  });

  it("floor < cap for every capped tier — the eviction band is never inverted", () => {
    for (const tier of ["mid", "low"] as const) {
      const cap = lruCapBytesForTier(tier, QUALITY.tiers[tier].lruBytesMB)!;
      const floor = lruFloorBytesForCap(cap)!;
      expect(floor).toBeLessThan(cap);
      expect(floor).toBeGreaterThan(0);
    }
  });

  it("the ACTUAL mid/low caps sit under the library's default MIN floor — the A9 defect this fixes", () => {
    // Pinned as documentation: without the paired floor, `unloadUnusedContent` could never rest
    // the cache below the cap (excessBytes = cached − min stayed negative), so `isFull()` held at
    // the cap boundary and every freshly parsed tile was discarded → the FPV re-stream loop.
    for (const tier of ["mid", "low"] as const) {
      const cap = lruCapBytesForTier(tier, QUALITY.tiers[tier].lruBytesMB)!;
      expect(cap).toBeLessThan(LIBRARY_DEFAULT_MIN_BYTES);
      expect(lruFloorBytesForCap(cap)!).toBeLessThan(cap); // the paired floor restores min < max
    }
  });
});

describe("peripheryErrorTarget — the U6 foveation base-relax rule", () => {
  const cfg: FoveationTierCfg = { rayRangeM: 1400, eyeRadiusM: 160, peripheryFactor: 1.5 };

  it("returns the base unchanged while foveation is not engaged (orbit/2D)", () => {
    expect(peripheryErrorTarget(24, cfg, false)).toBe(24);
  });

  it("returns the base unchanged when the tier has no foveation cfg (high / disabled)", () => {
    expect(peripheryErrorTarget(24, null, true)).toBe(24);
  });

  it("relaxes the base by peripheryFactor (rounded) while engaged", () => {
    expect(peripheryErrorTarget(24, cfg, true)).toBe(36); // mid buildings 24 × 1.5
    expect(peripheryErrorTarget(40, { ...cfg, peripheryFactor: 1.6 }, true)).toBe(64); // low × 1.6
  });

  it("factor 1 is a no-op even while engaged (regions-only mode)", () => {
    expect(peripheryErrorTarget(24, { ...cfg, peripheryFactor: 1 }, true)).toBe(24);
  });
});

describe("FOVEATION + QUALITY.tiers.foveation invariants (U6)", () => {
  it("mid and low both carry a cfg; positive radii; factor ≥ 1 (never TIGHTENS the periphery)", () => {
    for (const tier of ["mid", "low"] as const) {
      const f = QUALITY.tiers[tier].foveation;
      expect(f).not.toBeNull();
      expect(f.rayRangeM).toBeGreaterThan(0);
      expect(f.eyeRadiusM).toBeGreaterThan(0);
      expect(f.peripheryFactor).toBeGreaterThanOrEqual(1);
    }
  });

  it("degrades monotonically: low reaches no further than mid and softens at least as much", () => {
    const m = QUALITY.tiers.mid.foveation;
    const l = QUALITY.tiers.low.foveation;
    expect(l.rayRangeM).toBeLessThanOrEqual(m.rayRangeM);
    expect(l.eyeRadiusM).toBeLessThanOrEqual(m.eyeRadiusM);
    expect(l.peripheryFactor).toBeGreaterThanOrEqual(m.peripheryFactor);
  });

  it("the eye bubble sits inside the fovea reach (the ray extends the bubble, not vice versa)", () => {
    for (const tier of ["mid", "low"] as const) {
      const f = QUALITY.tiers[tier].foveation;
      expect(f.eyeRadiusM).toBeLessThan(f.rayRangeM);
    }
  });

  it("region errorTargets are positive geometric-error metres for all three renderers", () => {
    expect(FOVEATION.regionErrorTargetM.buildings).toBeGreaterThan(0);
    expect(FOVEATION.regionErrorTargetM.enriched).toBeGreaterThan(0);
    expect(FOVEATION.regionErrorTargetM.ground).toBeGreaterThan(0);
  });
});

describe("stickyOverlayPx — QA slice C: the composite px only ratchets up", () => {
  const FLAT2D = GROUND.overlayResolution2dPx;

  it("frame 1 in 3D ratchets from the 0 seed to the tier base (no-op vs the constructor px)", () => {
    expect(stickyOverlayPx(0, 256, false, FLAT2D)).toBe(256);
  });

  it("the first flat-chart frame raises to max(tier, flat2dPx)", () => {
    expect(stickyOverlayPx(256, 256, true, 512)).toBe(512);
    // high already composites at 512 — the chart never raises above the tier there
    expect(stickyOverlayPx(512, 512, true, 512)).toBe(512);
  });

  it("NEVER lowers when the chart drops (the QA-7b 2D↔FPV rebuild-storm regression)", () => {
    const raised = stickyOverlayPx(256, 256, true, 512); // chart visit → 512
    expect(stickyOverlayPx(raised, 256, false, 512)).toBe(512); // back to FPV — stays
  });

  it("NEVER lowers on a governor demote (the S3-era rebuild-on-demote folds under the same rule)", () => {
    expect(stickyOverlayPx(512, 256, false, 512)).toBe(512);
  });

  it("a governor promote to high raises once (the only other legitimate rebuild)", () => {
    expect(stickyOverlayPx(256, 512, false, 512)).toBe(512);
  });

  it("is monotonic non-decreasing over an arbitrary flip sequence, with ≤1 change per rung", () => {
    const tiers = [256, 256, 512, 256, 256, 512, 256];
    const flats = [false, true, false, true, false, false, true];
    let px = 0;
    let changes = 0;
    for (let i = 0; i < tiers.length; i++) {
      const next = stickyOverlayPx(px, tiers[i], flats[i], 512);
      expect(next).toBeGreaterThanOrEqual(px);
      if (next !== px) changes++;
      px = next;
    }
    // seed→256 (boot) + 256→512 (first chart visit) — nothing else may rebuild
    expect(changes).toBe(2);
    expect(px).toBe(512);
  });

  it("rollback knob: flat2dPx at the tier base disables the raise entirely (no post-boot rebuild)", () => {
    let px = stickyOverlayPx(0, 256, false, 256);
    for (const flat of [true, false, true, false]) {
      const next = stickyOverlayPx(px, 256, flat, 256);
      expect(next).toBe(256);
      px = next;
    }
  });

  it("the live knob still raises the chart above the lean tier base (QA-7b crispness intact)", () => {
    expect(stickyOverlayPx(256, 256, true, FLAT2D)).toBe(Math.max(256, FLAT2D));
  });
});

/**
 * ULTRA HQ (owner 2026-08-22h) — the "OFF == today" fence.
 *
 * ULTRA is deliberately NOT a fourth tier: `QualityTier`, `TIER_ORDER`, `detectDeviceTier` and
 * `makeGovernor` are untouched, and `QUALITY.tiers` is not edited. It is an override profile
 * layered on top of the running tier, the mirror of `QUALITY.leanMobile`. These assertions pin
 * the property the owner actually asked for — zero regression when off — as IDENTITY, which is
 * a stronger claim than equality and one no future refactor can satisfy by accident.
 */
describe("ULTRA HQ — off is byte-identical, on is bounded", () => {
  it("ultraTileLevers returns its input BY IDENTITY when off", () => {
    for (const tier of TIER_ORDER) {
      const base = QUALITY.tiers[tier];
      expect(ultraTileLevers(base, false, QUALITY.ultraDesktop)).toBe(base);
    }
  });

  it("ultraTileLevers overrides exactly the declared keys when on, and nothing else", () => {
    const base = QUALITY.tiers.high;
    const on = ultraTileLevers(base, true, QUALITY.ultraDesktop);
    expect(on).not.toBe(base); // a copy, so the frozen tuning object is never mutated
    expect(on.buildingErrorTarget).toBe(QUALITY.ultraDesktop.buildingErrorTarget);
    expect(on.maxStreetNames).toBe(QUALITY.ultraDesktop.maxStreetNames);
    expect(on.vectorLatticeBudget).toBe(QUALITY.ultraDesktop.vectorLatticeBudget);
    // Everything the exclusion list says must NOT move: DPR is inert behind
    // min(devicePixelRatio, …); shadows/AO/8k are construction-time; foveation must stay null
    // on high (a cfg there SOFTENS the periphery); the composite px is a one-way ratchet.
    expect(on.dprCap).toBe(base.dprCap);
    expect(on.shadowMapSize).toBe(base.shadowMapSize);
    expect(on.shadowsEnabled).toBe(base.shadowsEnabled);
    expect(on.bloom).toBe(base.bloom);
    expect(on.overlayResolutionPx).toBe(base.overlayResolutionPx);
    expect(on.foveation).toBe(base.foveation);
    expect(on.groundErrorNear).toBe(base.groundErrorNear);
  });

  it("ULTRA really is a RAISE — every override moves detail up, never down", () => {
    const h = QUALITY.tiers.high;
    const u = QUALITY.ultraDesktop;
    expect(u.buildingErrorTarget).toBeLessThan(h.buildingErrorTarget); // SSE: lower = finer
    expect(u.maxStreetNames).toBeGreaterThan(h.maxStreetNames);
    expect(u.vectorLatticeBudget).toBeGreaterThan(h.vectorLatticeBudget);
    // The one thing tier `high` can never do: exceed the library's own LRU default. `high`
    // resolves to null = "restore that default", so a raise has to come from here.
    expect(u.lruBytesMB).toBeGreaterThan(h.lruBytesMB);
    expect(u.groundLruBytesMB).toBeGreaterThan(h.groundLruBytesMB);
  });

  it("lruCapBytesForUltra off is DEFINED as lruCapBytesForTier — including the null-on-high path", () => {
    for (const tier of TIER_ORDER) {
      const mb = QUALITY.tiers[tier].lruBytesMB;
      expect(lruCapBytesForUltra(tier, mb, false, QUALITY.ultraDesktop.lruBytesMB)).toBe(
        lruCapBytesForTier(tier, mb),
      );
    }
    // `null` is the load-bearing case: it means "restore the renderer's captured library
    // default", which is the whole byte-identical-on-high property.
    expect(lruCapBytesForUltra("high", 400, false, 600)).toBeNull();
  });

  it("lruCapBytesForUltra on returns explicit bytes ABOVE the library default, with a paired floor", () => {
    const cap = lruCapBytesForUltra("high", 400, true, QUALITY.ultraDesktop.lruBytesMB);
    expect(cap).toBe(Math.round(QUALITY.ultraDesktop.lruBytesMB * 1024 * 1024));
    expect(cap!).toBeGreaterThan(0.4 * 2 ** 30); // the 3d-tiles-renderer default
    // U2/A9: a max-only raise inverts the library's min/max band and re-enters the
    // parse → cache-full → discard → re-download loop. The floor must travel with it.
    expect(lruFloorBytesForCap(cap)).toBe(Math.round(cap! * 0.75));
  });

  it("ULTRA is not a tier — the three-rung ladder is untouched", () => {
    expect(TIER_ORDER).toEqual(["low", "mid", "high"]);
    expect(Object.keys(QUALITY.tiers).sort()).toEqual(["high", "low", "mid"]);
  });
});
