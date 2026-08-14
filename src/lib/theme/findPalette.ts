import { tokens } from "./tokens";

/**
 * FIND v2 per-hit highlight palette (owner rework 2026-08-14): every in-frame standing gets its
 * own hue so the panel row and its ghost projection read as ONE object. Colours flow through the
 * token bridge (ADR D14 — no literals here); the order interleaves warm/cool so CONSECUTIVE hits
 * (adjacent days, adjacent ghosts) contrast maximally. Deliberately excluded: sunCore/sunGlow and
 * moonlight — a ghost must never wear the real body's colour (the anti-confusion contract).
 * Beyond 10 hits the wheel cycles — the panel-row swatch + hover sync disambiguate repeats.
 */
export interface FindHitColor {
  /** CSS custom-property reference — the panel swatch. */
  css: string;
  /** Hex from the GL token bridge — the ghost instance colour. */
  gl: string;
}

export const FIND_PALETTE: readonly FindHitColor[] = [
  { css: "var(--color-accent)", gl: tokens.accent }, // teal — the signal anchor
  { css: "var(--color-pin-warm)", gl: tokens.pinWarm }, // amber
  { css: "var(--color-pin-ice)", gl: tokens.pinIce }, // ice blue
  { css: "var(--color-comet-coma)", gl: tokens.cometComa }, // comet green
  { css: "var(--color-pin-lavender)", gl: tokens.pinLavender }, // lavender
  { css: "var(--color-golden-hour)", gl: tokens.goldenHour }, // golden orange
  { css: "var(--color-sky-day)", gl: tokens.skyDay }, // day-sky blue
  { css: "var(--color-pin-mint)", gl: tokens.pinMint }, // mint
  { css: "var(--color-city-lights)", gl: tokens.cityLights }, // sodium warm
  { css: "var(--color-comet-tail)", gl: tokens.cometTail }, // plasma blue
] as const;

/** Cycled palette pick — safe for any integer index. */
export function findHitColor(i: number): FindHitColor {
  const n = FIND_PALETTE.length;
  return FIND_PALETTE[((i % n) + n) % n];
}
