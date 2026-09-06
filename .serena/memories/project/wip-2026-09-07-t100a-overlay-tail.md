# wip 2026-09-07a — T100 (a): the ground overlay's own extinction tail

Mode: implement (`/frame` under investigate-design-v3). Owner order: proceed with
`NEXT_SESSION_PROMPT.md` (T100 (a) first; Android device + AWS farm available). 2026-09-06
23:10 → 2026-09-07 local (UTC+3).

## Boot findings
- Session n's ship hook ABORTED at 23:07 (vitest red): two `bestSpotHonesty` MEASURED tests hit
  the 5 s default under the full suite while ANOTHER Claude session's `find /` held the load at
  12–18. They pass alone in ~1 s; gave them the 60 s timeout every sibling MEASURED test has.
  Session n's whole tree (five rulings) was still uncommitted — it ships with this session.
- Trap: timing-ratio tests (`bestSpotSolver` "≥ 1.7× faster") flake under foreign load; the ship
  hook's gate is the full suite, so a loaded machine can block a ship. Re-run when quiet.
- VPN IE, ion 401, budget 0/1 · 0/1 · 83 %; `wix dev` with `.vite` aside; house Chrome :9333.

## The finding that decided the shape (MEASUREMENTS §18.1)
§17.2's four arms differ only in the FIELD at 0 / −0.14 / −0.5°, and the band luma barely moves
with it: the ground twins are a stock `ShadowMaterial`, mask `mix(1, shadow, intensity)` PER
LIGHT, three nested cascade lights → delivered darkening `opacity × (1 − (1 − field)³)`. So the
field band is nearly irrelevant to T66 above field 0.5, and a band ending at −0.33° (ruling b)
zeroes the overlay at −0.5° — every arm's 75.0 there. The lever is the overlay's opacity (F1's
bound on the key's authored tail), and the field must be non-zero at −0.5° to carry it.

## Built
- `lib/globe/duskLight.overlayReleaseK(sinElev, startSin, gateSin, pow, levelAtStart)`:
  `levelAtStart × x^pow`, 0 at/below the gate, identity when `start ≤ gate`. `StylizedTiles`:
  `shadowDirectShareK(max(ultraDirectK, tail))` on `ultraOn && shadowCascades.length > 0`
  (the T96 allow-list gained `? overlayReleaseK(`); `OVERLAY_TAIL_TOP` = `keyExtinctCurve` at the
  start, read at boot. Seams: `ultraLook().shadow.overlayTailK`, DBG `ultra.shadow.overlayTailK`.
- `ULTRA.overlayReleaseStartSin` 0.00349 (+0.2°) · `overlayReleasePow` 0.9 ·
  `shadowReleaseStartSin` = `-0.014544 + 0.0093` (the identity: the disc band, −0.30° → gate).
- Tests: `duskLight` +7 · `keyHandoff` T100 block rewritten (identity + the (b) knob still
  pinned) · `duskShadeRatio` chip arm +5 (mask product, length guard WITH the gate as horizon —
  omit it and the field is 0 below 0°) · `fences` +1 · `debugCatalog` +1 row.
- `verify-ultra-dusk`: T100 checks re-pointed (disc band both rigs) + the (a) tail check;
  positionals option-safe (T105: `9333 --ladder …` had written shots into `./--ladder`).

## Measured (house :9333, alone; §18.3–18.4)
| pow | overlay at −0.5° | series +0.5 → −0.9 | T66 |
|---|---|---|---|
| (b) | 0 | 67.4 68.4 69.3 73.5 75.0 73.0 | 4.23 |
| 1.4 | 0.047 | … 70.1 73.1 73.0 | 3.01 |
| 1.0 | 0.075 | … 70.1 71.9 73.0 | 1.85 |
| **0.9** | 0.084 | 67.4 68.4 68.6 70.1 **71.5** 73.0 | **1.48** ✓ 19/19 |
The −0.5° rung takes only ~55 % of the added opacity (the band is not fully under the masks) —
the model's 1.4 was walked down on the ladder. `--ultra 0` 19/19, §17.6 digits · charter 84/85
(RC2 chip-off) · ultra 30/30 · sweep 13/14 (`legacy-m`) sheets read · vitest 2,761/175 ·
astro 0/0/10 · knip 0. Reversal: `overlayReleaseStartSin ≤ shadowGateSin`.

## Then: the phone re-measure + the streaming columns (MEASUREMENTS §19, §20)
- **iPhone 17 Pro on Device Farm** (`tools/devicefarm/ios-baseline.mjs --label t100a-remeasure`,
  ~10 device minutes; `cloudflared --protocol http2` — QUIC → 530, now in the README): orbit /
  city / everest **9–13 fps (CPU 74–91 ms) → 60 / 50 / 60 at `mid`, 3–4 ms CPU** — T79 reached the
  phone, no demotion; FPV eye at the cap; `/m` 9 → 34 fps but 26 ms CPU of its own. **T83
  REPRODUCED**: ramp step 1 (6 rows seeded, reload `#f=`) died inside 120 s twice; T80's −245 MB
  did not move it. Session `…/ed840495-122f-4465-82a0-cb803fc13d7a/00000` — its console
  video + syslog decide kill vs hang (the API lists no artifacts while STOPPING). **The Pixel was
  NOT attached over adb** — its half is owed.
- **The streaming columns** in `verify-visual-sweep`'s descent leg (`dlLen/dlJobs/parseLen/
  parseJobs/lru*MB/inCache/cpuMs` per frame via `__globe.u5()` + `__debugFeed.read("tiles")` +
  `series("frame.cpu")`; `streaming.json`). One `high` leg: 616 frames, busy 169, download-only 5,
  parse-phase 164; **all 22 hitches (> 33 ms; p95 37.6, max 78.4) are parse-phase and `frame.cpu`
  is 5–11 ms in the worst** → the time is OUTSIDE the orchestrator (glTF parse landing / first-draw
  upload). LRU peak gnd 308 MB / enr 207 / bld 9; queue peak 749; inCache 805. Lever 10 is aimed
  right IF it is the parse — `probe-cpu-profile` over the descent leg decides; 9 re-aimed/parked.

## Not done: T83's diagnosis (the console session) · the descent CPU profile · the Pixel · `/m` 26 ms.
