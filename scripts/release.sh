#!/bin/zsh
# PLUX — the whole release ritual in one command (owner order 2026-09-10).
#
# `wix build` + `wix release` alone deploy; they do NOT run what makes a release reliable. This
# script chains the ritual from `.claude/conventions/wix-headless.md` §4 and the 2026-07-16
# prod-asset-outage lesson (`mem:project/wip-2026-07-16-prod-asset-outage`):
#
#   1. clean tree      — `wix release` ships the WORKING TREE, not HEAD (a dirty tree once shipped
#                        unreleased phase work); refuse unless --allow-dirty
#   2. auth + env      — `wix whoami` (exit 0) · `wix env pull --json` (WIX_CLIENT_ID, else the build fails)
#   3. the gates       — `npm test` + `npx astro check` (skip with --skip-gates; never ship red)
#   4. build + release — `wix build` · `wix release -c <comment> [-t major|minor]`
#   5. the canary      — GET + POST (JSON body!) /api/ping must both read 200 on the live URL
#   6. warm            — `scripts/warm-prod-assets.mjs`: every release resets the chunk hashes,
#                        the cold origin served 500s per edge node until warmed; re-releasing
#                        does NOT fix it (Node ≥ 22)
#   7. verify          — `scripts/verify-prod-globe.mjs`: a cold-profile headless smoke check of
#                        the live globe (spawns + kills its own Chrome); then close any house Chrome
#
# Usage: scripts/release.sh -c "<comment>" [-t major|minor] [--site-url https://www.plux.today]
#                          [--skip-gates] [--allow-dirty] [--no-verify] [--dry-run]
#   or:  npm run release:full -- -c "<comment>"
set -u
cd "$(dirname "$0")/.." || exit 1

COMMENT=""; VTYPE=""; SITE_URL="${FTW_SITE_URL:-https://www.plux.today}"
SKIP_GATES=0; ALLOW_DIRTY=0; NO_VERIFY=0; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--comment) COMMENT="$2"; shift 2 ;;
    -t|--version-type) VTYPE="$2"; shift 2 ;;
    --site-url) SITE_URL="$2"; shift 2 ;;
    --skip-gates) SKIP_GATES=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --no-verify) NO_VERIFY=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,24p "$0"; exit 0 ;;
    *) echo "release.sh: unknown argument $1 (see --help)"; exit 2 ;;
  esac
done
[[ -z "$COMMENT" ]] && { echo "release.sh: a release comment is required: -c \"what shipped\""; exit 2; }
SITE_URL="${SITE_URL%/}"

step() { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }
run() { echo "+ $*"; [[ $DRY -eq 1 ]] && return 0; "$@"; }
fail() { echo "\nrelease.sh: FAILED at: $1"; exit 1; }

step "1/7 clean tree"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short | head -20
  if [[ $ALLOW_DIRTY -eq 1 ]]; then echo "tree is DIRTY — continuing under --allow-dirty (the working tree is what ships)"
  else fail "the working tree is dirty; commit (or let the session ship land) or pass --allow-dirty"; fi
else echo "clean · HEAD $(git rev-parse --short HEAD) on $(git branch --show-current)"; fi

step "2/7 auth + env"
run npx @wix/cli@latest whoami || fail "not logged in — run: npx @wix/cli@latest login"
run npx @wix/cli@latest env pull --json || fail "env pull"
[[ $DRY -eq 0 && ! -s .env.local ]] && fail ".env.local is empty after env pull"

step "3/7 the gates"
if [[ $SKIP_GATES -eq 1 ]]; then echo "skipped (--skip-gates)"
else
  run npm test || fail "vitest"
  run npx astro check || fail "astro check"
fi

step "4/7 build + release"
run npx @wix/cli@latest build || fail "wix build"
REL=(npx @wix/cli@latest release -c "$COMMENT"); [[ -n "$VTYPE" ]] && REL+=(-t "$VTYPE")
run "${REL[@]}" || fail "wix release"

[[ $DRY -eq 1 ]] && { echo "\n(dry run — stopping before the live checks)"; exit 0; }

step "5/7 the canary on $SITE_URL"
ok=0
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL/api/ping")
  if [[ "$code" == "200" ]]; then ok=1; break; fi
  echo "  GET /api/ping → $code (attempt $i/30, the release is still propagating) …"; sleep 10
done
[[ $ok -eq 1 ]] || fail "GET /api/ping never read 200 within 5 min"
post=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'content-type: application/json' -d '{"canary":true}' "$SITE_URL/api/ping")
[[ "$post" == "200" ]] || fail "POST /api/ping read $post (the save flow rides app-defined POST routes)"
echo "GET 200 · POST 200"

step "6/7 warm the edge (every release resets the chunk hashes)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
  || fail "warm-prod-assets needs Node >= 22 (global WebSocket) — nvm use 24"
run node scripts/warm-prod-assets.mjs "$SITE_URL" || fail "warm-prod-assets (re-run it: node scripts/warm-prod-assets.mjs $SITE_URL)"

step "7/7 verify the live globe"
if [[ $NO_VERIFY -eq 1 ]]; then echo "skipped (--no-verify)"
else
  run node scripts/verify-prod-globe.mjs "$SITE_URL/" "verify-shots/release-$(date +%Y%m%d-%H%M%S).jpeg" || fail "verify-prod-globe (the Wix edge is sharded — reload until clean before diagnosing)"
fi
node scripts/close-verify-chrome.mjs --keep 9222 >/dev/null 2>&1 || true

echo "\nrelease.sh: DONE — $SITE_URL released (\"$COMMENT\"). Live HTML hash sets can flap for a few minutes; reload before calling anything broken."
