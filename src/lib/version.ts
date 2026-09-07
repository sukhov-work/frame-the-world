/**
 * The app version stamp (owner order 2026-09-08) — ONE writer for the string both shells show.
 *
 * `package.json`'s `version` is the source of truth: major 1 since 2026-09-08 (the minor/patch
 * were set by rough approximation that day — the era count and the PRs since), and the
 * session-end ship hook (`.claude/hooks/session-end-ship.sh`) bumps the PATCH on every ship
 * (`npm version patch --no-git-tag-version`, after the gates and before `git add -A`), so every
 * landed commit carries its own number. The named JSON import is tree-shaken by Vite's JSON
 * plugin — only the string reaches the client chunk, never the dependency list.
 *
 * The stamp is troubleshooting-only (which build is a screenshot from?): the "-dev" suffix is
 * `import.meta.env.DEV`, so a `wix dev` page says `v1.36.1-dev` and a release says `v1.36.1`.
 * Rendered by `pages/index.astro` (inside the attribution chip, bottom-right) and by
 * `controls/VersionStamp.tsx` (the `/m` bottom column's corner) — `test/lib/version.test.ts`.
 */
import { version } from "../../package.json";

export const APP_VERSION: string = version;

/** `v1.36.1` for a release build, `v1.36.1-dev` under `wix dev`. */
export function versionLabel(dev: boolean = import.meta.env.DEV): string {
  return `v${APP_VERSION}${dev ? "-dev" : ""}`;
}
