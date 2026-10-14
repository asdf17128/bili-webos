# Candidate 3: final local stability gates

Both required local commands passed against `2.3.0 stability-test.3`. The production source remained unchanged throughout the completed runs. This report does not substitute for the separately recorded television soak/lifecycle tests.

| Command | Start (Asia/Shanghai) | End | Result |
| --- | --- | --- | --- |
| `bash tools/verify.sh --no-tv --ux` | 2026-10-13 14:36:12 | 14:40:38 | PASS, exit 0 |
| `bash tools/verify.sh --sim --no-tv` | 2026-10-13 14:41:50 | 14:45:16 | PASS, exit 0; simulator 54 pass / 0 fail / 3 account skips |

Raw logs: [UX](verify-ux.log), [simulator](verify-sim.log). Precise UTC timestamps and environment are in [source.json](source.json); machine-readable counts and limits are in [summary.json](summary.json).

## Evidence by suite

| Suite | Result |
| --- | --- |
| bridge-subscriptions | 3 pass |
| buvid | 8 pass |
| cdn | 7 pass |
| danmaku | 2 measurement, 6 pass |
| dev-subscriptions | 4 pass |
| diagnostic-cdn | 4 pass |
| live-loading | 9 pass |
| live-monitor | 2 pass |
| playback-end | 26 pass |
| player-loading | 70 pass |
| relay-reconnect | 6 pass |
| sdk-subscriptions | 6 pass |
| service-stress | 20 pass |
| service-subscriptions | 5 pass |
| sessions | 9 pass |
| simulator | 54 pass, 3 skip |
| soak-monitor | 8 pass |
| transport | 17 pass |
| ui | 68 pass |

The shared static layer also passed the service ES5 gate, app ES2016 output parse, existing logic/unit tests, real Node 0.12.2 and 8.17.0 Docker service tests, and production build. UX additionally passed proxy logout/Range behavior, playback health, manifest MIME, and region-probe contract checks. Counts above are not added into a misleading combined total; some shared assertions run in both commands.

HTTP inventory robustness was extended while the first static stage was already complete. Its final 17/17 version was run separately ([log](transport-inventory.log)) and again by the simulator command. Second-command fault-boundary results are preserved in `sim-gates/`.

## First failure retained and explained

The initial candidate 3 UX run (14:27:52–14:31:31) ended 69/70 with `undefined !== 47` in paused media recovery. The test stub increments `loads` before asynchronously reading its Blob MPD and recording the resume position; the old assertion read the position too soon. A controlled gate reproduced the old observation as 0/1, and the corrected completion wait passed 2/2. The final full run then passed all 70 loading cases. No production code changed for this test correction. [Explanation and before/after evidence](observer-race.md); [original failed log](verify-ux-first-failure.log).

Candidate 2's earlier local PASS is retained in `../final-2/`, marked superseded because its real TV paused native-to-DASH transition failed. Candidate 3 contains that production fix; the observation race described above is a separate fixture defect.

## Isolation, skips and limits

The simulator used a fresh anonymous state directory and `SIM_ACCOUNT_WRITES=0`. Like/coin/favorite surface, Watch Later, and follow badges were explicitly skipped because there was no logged-in session. The optional full 35-fragment copyrighted Dolby 120 fps corpus was absent and remains one explicit skip. Small checked-in media fixtures and other Dolby tests passed; the full corpus was not claimed as tested.

The live room returned zero historical messages; its history check is only evidence of empty-history/UI handling. The real TV live tool separately verifies subscription acknowledgements, frames and cancellation. Modern Chromium cannot prove legacy webOS decode or hardware performance.

Inspected screenshots: [home](simulator-home.png) shows aligned three-column cards with a fully visible focused top card; the player-comments original (public commenter details; retained only in local `/tmp/bili-stability-20261013/private-reviewed-images/`) shows the docked right rail and unclipped controls. The player screenshot is layout evidence, not physical-frame decode evidence.

The test-started Vite and dev service were stopped. Ports 5173 and 9528 had no listeners after completion. This regression run did not connect to or modify the television, mutate an account, publish, commit, or push.

## Version provenance

Base commit: `4eb77e0c14ee04c51ba07739d92dd6bd9a650e73`.

Production diff scope: `app/src` and `service/com.biliwebos.app.service`; SHA256 before and after both final commands: `491d0ebc498f910fb41c739fd8201c30244530d54aedca94a53b624f0215c69a`.

All 12 source/bundle hashes still match the root-created candidate 3 package manifest after the final simulator build: [verification](manifest-verification.json). Candidate IPK SHA256: `f260b91c6e4ff63bc99b6d2a92f89bc305af7d3ae4bea1d17f587e1f19ac48b8`. Test-tool hashes are recorded separately in [test-file-sha256.json](test-file-sha256.json).
