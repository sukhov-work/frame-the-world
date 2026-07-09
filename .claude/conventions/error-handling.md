# Convention — Error Handling

## Client (decode / render)
- **Progressive degradation.** exifr preview must show even if `libraw-wasm` full decode fails — surface a
  clear "couldn't fully decode this RAW" state, keep the embedded JPEG. Never blank the screen.
- **Memory pressure.** Free RAW `ArrayBuffer`s immediately after generating the display texture; on mobile
  cap concurrent decodes to 1 and default to half-size. Guard the wasm32 4GB ceiling.
- **Missing EXIF** (heading/pitch/GPS absent — normal for ILCs) is **not an error** — flag the field for
  manual entry with a sensible default (heading 0/north, pitch 0 horizon, altitude → terrain-snap). Design
  path D4: nudge-to-align is core, not a fallback.
- **HEIC**: feature-detect Safari-native `createImageBitmap` via try/catch (zero-cost); fall back to
  `libheif-js` (dynamic import). A decode failure downgrades to metadata-only, not a crash.
- **WebGL/WebGPU**: WebGL2 primary; probe WebGPU and fall back automatically (`three/webgpu`). No WebGL2 →
  friendly "this device can't render the globe" notice, not a white screen.

## Wix backend (endpoints)
- Map Wix errors to user-facing states, don't leak raw bodies: `FILE_SIZE_OVER_LIMIT` / `SITE_QUOTA_EXCEEDED`
  (media), `403` (missing `elevate()` or permission), `429` (endpoint quota — back off), `504` (timeout — the
  call is too heavy for an endpoint; move work to the client per C1).
- **Quota rejection** (free member, insert #11) is an **expected** business outcome → return a typed
  "upgrade to save more" response, not a 500.
- **Auth recovery** (401 on REST): retry once with the cached token; persistent → re-auth. See
  `conventions/wix-headless.md § 3`.

## Privacy failures are bugs (C6)
- Any code path that could expose exact GPS on a public low-res pin is a **hard bug**. Public pins carry
  only `latReduced`/`lonReduced` per the member's `publicPrecision`. Publication passes the moderation gate.

## General
- Fail loud in dev, degrade gracefully in prod. Type errors from the SDK → check the method via Wix MCP,
  never cast around them. Every `catch` either recovers meaningfully or re-throws with context — no silent swallow.
