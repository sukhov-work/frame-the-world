# T77 phone baseline — AWS Device Farm (iPhone 17 Pro) + the Pixel 6 Pro over adb

The two real-device paths for `rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` §B. Both read the
same seam the desktop harness reads (`window.__debugFeed.snapshot()`), so the phone numbers land in
the same columns as `rendering/MEASUREMENTS_2026-09-05.md` §2.

## A. iPhone 17 Pro on AWS Device Farm — `ios-baseline.mjs`

**How it works (each fact from the Device Farm developer guide, 2026-09-06):** a Remote Access
session on a public device exposes an **Appium endpoint** (`GetRemoteAccessSession →
endpoints.remoteDriverEndpoint`); "test a web app by specifying the `browserName` capability …
`Safari` on iOS"; the session lasts up to **150 minutes**, ends after **5 idle minutes**, every
Appium command has a **4-minute** limit, and the endpoint supports the XCUITest driver only (no
BiDi, no plugins). Billing is per device minute while the session runs (metered $0.17/min list; the
one-time trial is 1,000 free minutes). The device is on AWS's network, so the page comes through a
tunnel to this Mac's `wix dev` — a DEV build, so every `window.__*` seam is present on the phone.

```bash
# once
cd tools/devicefarm && npm install

# every session — three terminals on the Mac
cloudflared tunnel --url http://localhost:4321          # → https://<random>.trycloudflare.com  (no interstitial)
npx wix dev --allowed-hosts <random>.trycloudflare.com  # the Host allowlist; restart wix dev if it was up
AWS_PROFILE=plux node tools/devicefarm/ios-baseline.mjs --dry-run                                  # project + device resolve; no session, no minutes
AWS_PROFILE=plux node tools/devicefarm/ios-baseline.mjs --host https://<random>.trycloudflare.com  # ~25–35 min of device time
```

What the run does: preflight (`/api/ping` locally AND through the tunnel — the seeds go to the same
`wix dev` the phone reads), create the remote access session (`appium:version 3`, the fleet's
"iPhone 17 Pro"), wait for RUNNING, open Safari at each pose (FPV eye · orbit · city · Everest ·
`/m`), settle on the tile queues, read the snapshot + a screenshot; the **kill ramp** at the FPV eye
(seed 6 → 12 → 24 → 36 rows from the Mac, reload, 20 s, read; a vanished boot marker = Safari
reloaded the page = the jetsam kill); the **soak** (8 min at the FPV eye, a synthetic look-around,
a snapshot every 30 s); `finally` removes every seeded row and STOPS the session (billing) unless
`--keep-session`. Output: `verify-shots/perf/devicefarm-<label>-<stamp>.json` + PNGs; the console
session page keeps the video and the device syslog (a WebContent jetsam shows there).

Flags: `--project-arn` (else the account's first project) · `--device "iPhone 17 Pro"` (a fleet
MODEL substring; a 16 Pro is a stricter stand-in) · `--session-arn <RUNNING session>` (reuse one
you opened in the console) · `--poses fpv,orbit,city,everest,m` · `--ramp 6,12,24,36` · `--soak-min 8`
· `--settle 30` · `--label farm` · `--keep-session` · `--dry-run`.

**Credentials (set up by the owner 2026-09-06):** the AWS CLI profile **`plux`** in `~/.aws/credentials`
(region `us-west-2`, output `json`) — run every command as `AWS_PROFILE=plux node …`. The dry run
resolved, read-only: project `arn:aws:devicefarm:us-west-2:<acct>:project:69e9a004-b773-4e76-87d5-259381e752df`,
the owner's pool "Iphone 17pro" naming device `…:device:6200F380A4874FEB9C72EED72B863B67` = **Apple
iPhone 17 Pro, iOS 26.3.1, 1206×2622, HIGHLY_AVAILABLE, remote access enabled** (a 17 Pro Max is in
the fleet too). **The profile carries the account's ROOT access key** (the owner's choice, flagged
"be careful"): this tool calls only `devicefarm:ListProjects / ListDevicePools / ListDevices /
CreateRemoteAccessSession / GetRemoteAccessSession / StopRemoteAccessSession`, never prints, copies
or stores a credential, and nothing in the repo reads `~/.aws`. Recommended when convenient: replace
the root key with an IAM user carrying `AWSDeviceFarmFullAccess` (or the five actions above) and
delete the root key — a root key on a laptop is the one credential that cannot be scoped.

**Honest limits:** iOS Safari has no `performance.memory` and no `EXT_disjoint_timer_query`, so the
phone rows carry no JS-heap and no GPU-ms column — the memory number is the kill ramp's last-good
count and the session's syslog; frame time is `frame.dt` from the app's own rAF ring. The synthetic
look-around dispatches pointer events on the canvas (the FPV gesture path) — if the phone shows no
camera motion in the video, the soak is a static soak and says so. **Status 2026-09-06 (later the same day — five sessions run):** the flow WORKS on the fleet's iPhone 17 Pro:
the tunnel served `wix dev`, Safari accepted the caps, the seam read and the boot marker held, and all
five poses were read (`MEASUREMENTS_2026-09-05.md` §11). Learned the hard way, now encoded here: **run
`cloudflared` with `--protocol http2`** (QUIC to the edge is blocked on the owner's network → HTTP 530);
a session bills 8–10 device minutes even when stopped a minute after RUNNING; **the `#f=` FPV page on
the 17 Pro dies 40–60 s after load** — with or without seeded models — after which every Appium command
stalls 120 s (backlog T83; the console session video + syslog classify kill vs hang), so the tool now
uses `connectionRetryCount: 0`, classifies a stalled debugger (`pageUnresponsive`), records a stalled
ramp step as its kill-class event, skips the soak on a dead page and never calls `deleteSession` on
one; `--poses fpv,fpv` boots a pose twice in one Safari session (slot `fpv#2`); `--ramp 0` skips the
ramp. Always launch it DETACHED (`nohup … &`): a tool timeout that kills it mid-run leaves a billing
session and seeded rows — stop stragglers with `aws devicefarm stop-remote-access-session --arn … --profile
plux` and `DELETE /api/dev-seed?kind=model&id=<id>` for each id in `verify-shots/perf/seeds-farm-<stamp>.json`.
The kill ramp and the soak curve are still UNMEASURED on iOS.

## B. Pixel 6 Pro over adb — the desktop harness, unchanged, pointed at the phone

Android Chrome speaks CDP over adb, and `adb reverse` makes the phone's `localhost:4321` this Mac's
`wix dev` — no tunnel, no Appium, the same `verify-perf-baseline.mjs` with `--device`:

```bash
# on the phone: Settings → About → tap Build number ×7 → Developer options → USB debugging ON;
# plug in, accept the RSA prompt; keep the screen awake while charging (Developer options → Stay awake)
adb devices                                                     # must list the Pixel as "device"
adb reverse tcp:4321 tcp:4321                                   # phone localhost:4321 → Mac wix dev
adb forward tcp:9444 localabstract:chrome_devtools_remote       # phone Chrome's CDP → Mac :9444
adb shell am start -a android.intent.action.VIEW -d "http://localhost:4321/" com.android.chrome
curl -s http://127.0.0.1:9444/json/version                      # Chrome/… on Android = attached
node scripts/verify-perf-baseline.mjs 9444 --device --label pixel6pro --quick    # ~6 boots
node scripts/verify-perf-baseline.mjs 9444 --device --label pixel6pro            # the full ladder + model ramp
node scripts/verify-temporal-stability.mjs 9444 --shimmer --label pixel6pro      # the shimmer on a Mali GPU
node scripts/probe-cpu-profile.mjs 9444 --pose orbit                             # the controls' raycast on a phone CPU
```

`--device` = no viewport/touch emulation, no tier override, the device's own detection (coarse
pointer → lean profile, tier capped `mid`; the ULTRA pref is REFUSED there and the boot asserts the
refusal). `performance.memory` exists on Android Chrome; `frame.gpu` is usually absent. Chrome must
be in the foreground with the screen on (the harness calls `Page.bringToFront`; Android throttles rAF
in background tabs). Run 2026-09-06 on the owner's Pixel 6 Pro (Android 16, Chrome 152): 15 cells / 0 failures in 6 min
(`MEASUREMENTS` §11). Two facts the recipe needed: **Android Chrome answers `PUT /json/new` with "Could
not create new page"** — so in `--device` mode the harness attaches to the tab the `am start` line
opened (any `localhost:4321` page tab) and re-navigates it per boot, never creating or closing tabs on
the phone; and the phone DOZES with its screen off — `adb shell input keyevent KEYCODE_WAKEUP` plus
`adb shell settings put global stay_on_while_plugged_in 7` before a run (set it back to 0 after).
`performance.memory` is QUANTIZED on Android Chrome (every cell read 202 MB) — not a measurement.
