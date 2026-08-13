import { describe, it, expect } from "vitest";
import {
  detectDeviceTier,
  lruCapBytesForTier,
  makeGovernor,
  TIER_ORDER,
  type GovernorConfig,
} from "../../../src/lib/globe/quality";
import { QUALITY, RENDERER, SHADOWS, GROUND, VECTOR, STREETS } from "../../../src/components/globe/tuning";

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
