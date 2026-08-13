# Audit report template (Frame the World)

Report lands in `.claude/claude-docs/audits/audit-<scope>-<date>.md`. Every cell honest:
"unmeasured" is a valid value; adjectives are not.

```
# Audit — {scope} — {date} — baseline {DECISIONS anchor}

## Verdict
{≤3 sentences: worst finding, overall state, fitness for the next ladder rung}
{one scope line vs the permanently-out list — the Zawinski guard}

## Gates baseline
{npm test N/N · astro check E/W/H · npm audit · build size — with the Track-E triage
 (my-change / pre-existing / flaky / infra) for anything red}

## Findings
| ID | Track | Severity | Conf | Anchor | Finding | Specific fix | Violated ruling | Tier |

## Verified clean
{checks/tracks that passed — named explicitly with their probes, never implied}

## Pre-existing / out-of-scope
{classified: pre-existing | flaky | infra | out-of-scope, each with its tracker row or a
 new tracked-backlog row proposal}

## Backlog status changes
{tracked-backlog.md rows whose state moved, with evidence}

## Fitness scorecard
{the seed's promises → best available proxy → value or "unmeasured":
 geo-accuracy (projection/ephemeris test vectors) · beauty (dated shots) · perf (tier/fps/
 decode ms/bundle size) · privacy C6 (probe results) · docs currency (stale-tag count) —
 no new machinery; unmeasured rows stay honest}

## Proposed convention / checklist amendments
{dated items to append; the Pesticide-Paradox harvest}

## Fix-session slicing
{ordered list; each slice sized S/M/L with dependencies and its gate (tests · astro check ·
 browser shots · release canary); frozen-chrome surfaces flagged}
```

Rules riding the template:
- Severity/confidence per `references/audit-mode.md`; every finding carries its verification
  tier (local-tested / browser-VERIFIED / wix-cloud-VERIFIED / UNVERIFIED).
- Findings sorted severity-first; ID = `{track}{n}` (A1, B3, …).
- "Specific fix" names files/commands — never "monitor closely" / "consider".
- The report is READ-ONLY output: no src/ edits ride an audit session.
