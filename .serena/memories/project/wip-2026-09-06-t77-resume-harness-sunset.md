# wip 2026-09-06h — T77 RESUMED: the owner's pose catalogue + visual sweep, T80 (moot), slice A A0–A3, slice B NEW-3/5/6/4a–4e/5c, the sunset release fixed — DONE

Mode: implement, Deep (`/frame` under the investigate-design-v3 spine). Owner order 2026-09-06h.
Method: five opus research/build agents in parallel, four opus implementation agents in git
WORKTREES (`../ftw-wt-{t80,seats,shadows,sunset}`, symlinked node_modules), integrated onto master
with `git apply --3way`; the main agent (fable) did the browser attribution and the seat fixes 4b–4e/5c.
Full record: DECISIONS 2026-09-06h · `rendering/MEASUREMENTS_2026-09-05.md` §14 · the T77 plan pointer.

## The standing owner order (every future session)
Poses come from `scripts/lib/poses.mjs` (the owner's real views); run `verify-visual-sweep.mjs --sheet`
and READ THE SHEETS. Rule + acceleration model: `conventions/verify.md` §The view catalogue.

## Established (numbers)
- Sun elevations (astronomy-engine): the owner's Everest frames A/B are refracted +1.63°/+0.36° =
  GEOMETRIC +1.30°/−0.14° (the code's sun is geometric, `bodies.ts:101,139`).
- Sunset: frames are ULTRA-on; in-shadow terrain brightened ×5.22 A→B because the field is released at
  +0.46° with 25 % direct sun left AND the ground overlay darkens the composite. Fixed ULTRA-only →
  ×1.16 (`shadowDirectShareK`, gate −0.833°, `shadowLengthK`, band 0.0093). Residual ×1.16 luma bump at
  0° = authored exposure/haze/afterglow rises (T66).
- T80: half-res mips recover 1.6 of 13 ms (fpv GPU 25.2 / 23.6 / 12.1); direction g next.
- Shimmer: the light FRAME rotates (0.29 texel/frame at the box edge vs 0.0009 true); the demand-driven
  ULTRA rig reads churn p50 0.000/0.001 at `--step 200` (rate-linearity 4.41), cannot register at the
  harness's 2000 ms step; A1 texel bias raised churn (parked at 0).
- Seats: stall gone (0.000 m); collapses 4,277 → 0 (4c hold + 4b freeze + 4e plane-shift carry through a
  separate `refine` queue); 4d depth guard parked OFF (orbit arrival p95 0.00 → 33.5 m); FPV city-wide
  gate not met while streaming (slice C); `frame.cpu` at the FPV eye 2.1 → 4.4 ms.
- Sheets exposed T92 (cityscape magenta wedge), T93 (Everest tilt-73 horizon band, zoom-sweep wedge),
  T94 (canvas non-deterministic: 30 % of pixels differ two rAF apart), T95 (run-to-run governor/seat noise).

## Gates end
vitest 2,584/2,584 (167) · astro 0/0/9 · knip 0 · charter 85/85 · ultra 29/29 · ultra-dusk 32/32 ·
meshedit/usermodels PASS · qaslice 65/65 · perf `--post-ab` 10 cells · sweep 28 goldens.

## Traps
ULTRA gate is frame-time-sensitive (parallel harnesses demote it) · `drawImage(WebGL canvas)` = zeros ·
`TaskOutput` on a running agent dumps its transcript · `504 Outdated Optimize Dep` after new imports →
restart `wix dev` with `.vite/deps` moved aside · goldens keyed `<id>.u0|u1` · the temporal harness's
2000 ms step is ×120 real time (`--step 200`, `--rig 0,0`).

## Owner rulings 2026-09-06i — ALL YES
T96 (the base rig takes the ULTRA light/shadow model; cost stays on the chip) · T66 (flatten the rises
through 0°) · the A2 one-texel cadence is the look. Slice BASE is the next session's W1 (`NEXT_SESSION_PROMPT.md`).
