// @ts-check
import { defineConfig } from 'astro/config';
import wix from "@wix/astro";
import wixPages from "@wix/astro-pages";

import react from "@astrojs/react";
import cloudProviderFetchAdapter from "@wix/cloud-provider-fetch-adapter";
const isBuild = process.env.NODE_ENV == "production";

// https://astro.build/config
export default defineConfig({
  integrations: [wix(), wixPages(), react()],
  security: { checkOrigin: false },
  ...(isBuild && { adapter: cloudProviderFetchAdapter({}) }),

  image: {
    domains: ["static.wixstatic.com"],
  },

  output: "server",

  vite: {
    // libraw-wasm resolves its .wasm sibling off import.meta.url at runtime; esbuild pre-bundling
    // would relocate the module and break that path in dev. The libheif bundle is only imported
    // inside the decode worker, which Vite's startup scanner never crawls — pre-bundle it here or
    // its first use mid-session triggers "optimized dependencies changed" and a full page reload.
    optimizeDeps: {
      exclude: ["libraw-wasm"],
      include: ["libheif-js/libheif-wasm/libheif-bundle.mjs"],
    },
    // The decode worker dynamic-imports its wasm decoders (code-split), which iife workers can't do.
    worker: { format: "es" },
  },
});