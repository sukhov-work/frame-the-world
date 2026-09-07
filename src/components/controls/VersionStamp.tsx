/**
 * VersionStamp — the tiny build stamp (owner order 2026-09-08): "which build is this?" for
 * troubleshooting screenshots, nothing else. Shared tier (`components/controls`, mobileFence
 * rule 3): react + `lib/version` + a stylesheet, no store. The desktop page renders the same
 * label from `lib/version` inside its attribution chip (`pages/index.astro`); `/m` mounts this
 * in the bottom column's corner (`MobileShell.tsx`, positioned by `styles/mobile/chrome.css`).
 * Inert: `aria-hidden`, no pointer events, no layout of its own (absolute in its host).
 */
import { APP_VERSION, versionLabel } from "../../lib/version";
import "../../styles/version-stamp.css";

export default function VersionStamp() {
  return (
    <span className="version-stamp" aria-hidden="true" data-version={APP_VERSION}>
      {versionLabel()}
    </span>
  );
}
