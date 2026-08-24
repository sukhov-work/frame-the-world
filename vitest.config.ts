import { defineConfig } from "vitest/config";

/**
 * The repo's FIRST vitest config (BESTSPOT S5, 2026-08-24) — and it exists for exactly one reason.
 *
 * `tsconfig.json` extends `astro/tsconfigs/strict`, which pins `"jsx": "preserve"` because Astro
 * compiles `.astro` itself and `@astrojs/react` installs the automatic runtime at BUILD time. vitest
 * never loads `astro.config.mjs`, so it transformed `.tsx` with esbuild's CLASSIC fallback and every
 * React component imported into a test died on `ReferenceError: React is not defined`. Until S5 no
 * test imported a `.tsx` module at all (`mobileFence` / `guideParity` read sources as TEXT), so the
 * gap was invisible.
 *
 * This says "use the same automatic runtime the app is built with" and nothing else: the include
 * globs, the environment (node — there is no jsdom in this repo, by choice) and the reporters all
 * stay at their defaults, so `npm test` runs the same suite it ran yesterday.
 */
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
