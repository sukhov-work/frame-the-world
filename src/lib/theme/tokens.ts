/**
 * GL token bridge (ADR D14). The single source of colour for the WebGL scene, so the DOM chrome and
 * the globe never drift apart. SOURCE OF TRUTH is `src/styles/tokens.css` — after a Claude Design
 * import, REGENERATE this file to match those custom properties (see CLAUDE_DESIGN_MEMO.md).
 *
 * Seeded from the Claude Design brief palette (dark space-neutral + single cyan-teal accent).
 */
export const tokens = {
  bg: '#05070B', // near-black deep space
  surface: '#12161C',
  border: '#232935',
  textPrimary: '#E8ECF2',
  textSecondary: '#9AA4B2',
  textMuted: '#5B6472',
  accent: '#38E1D0', // luminous cyan-teal — pin emissive / frustum / active states
  land: '#2E3A44', // desaturated slate for the stylized globe
  landHi: '#3C4A57', // lighter cool grey — buildings / graticule
  water: '#0C141C',
  goldenHour: '#FFB865', // warm sun-driven tint
} as const;

export type ThemeTokens = typeof tokens;
