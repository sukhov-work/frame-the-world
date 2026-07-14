// @ts-check
import { defineConfig } from 'astro/config';
import wix from "@wix/astro";
import wixPages from "@wix/astro-pages";

import react from "@astrojs/react";
import cloudProviderFetchAdapter from "@wix/cloud-provider-fetch-adapter";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
const isBuild = process.env.NODE_ENV == "production";

/** DEV-ONLY (`apply: "serve"` — never part of a build): serve the git-ignored baked city tilesets
 *  from `bakes/enriched/<city>/` at `/enriched/<city>/…`, so LOCAL DEV STREAMS TILES FROM THIS
 *  MACHINE and never hits the R2 Worker (.env.development.local points the client here; build/
 *  release keep the R2 URL from .env.local). The bakes live OUTSIDE `public/` precisely so a
 *  build bundle never ships hundreds of MB of derived tiles — R2 is production's only source. */
/** @returns {import("vite").Plugin} */
function ftwLocalTiles() {
  return {
    name: "ftw-local-tiles",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/enriched", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^[/\\]+/, "");
        if (rel.split(/[/\\]/).includes("..")) return next();
        const file = join(process.cwd(), "bakes", "enriched", rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", file.endsWith(".glb") ? "model/gltf-binary" : "application/json");
        res.setHeader("Content-Length", String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

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
    plugins: [ftwLocalTiles()],
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