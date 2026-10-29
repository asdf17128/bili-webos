# riskfix.6: bounded activation recovery

2026-10-30. #65 confirms PGC and remote keys fixed but UGC voucher-only persists. #51 supplied real TV environment observations supporting a controlled implementation; this is not universal proof.

Activation runs only for real playback code=0/voucher-only risk, after validating a WebView environment passed through Luna or dev bridge. No environment means existing recovery behavior remains. Diagnostic probes never activate. Sends current buvid3/4 and random _uuid only; no account cookies, fabricated buvid_fp/b_nut, desktop/GPU/canvas constants, extra telemetry or persistent environment snapshot. Fixed HTTPS endpoint, certificate verification enabled, 8s request timeout / 9s operation deadline, 64 KiB compressed input cap, numeric code=0 success required. Client playback deadline also includes PGC v2.

Activation has its own durable 5-minute attempt cooldown; an earlier identity-rotation cooldown does not prevent the first activation. Shared flight and mutual exclusion with identity repair; account/identity epoch checked before commit. UUID and existing cookies are saved via exclusive 0600 temp, full writes, fsync and atomic rename before memory update. Failures leave original identity/account. Logout preserves device UUID; identity replacement drops it. Pending stale operations cannot restore an old account. Success is reported as accepted, not proof of playable media. At most one replay of the rejected playback request.

Validation: 243 unit pass / 1 external corpus skip; 7 service activation integration scenarios (success/rejection/logout/diagnostic/concurrency/disk failure/account switch); 22 legacy recovery cases; 20 controlled-player cases; 13 WBI transport cases; 11 QR scenarios plus bounded maximum; 7 report privacy units. Production build/package pass. No TV or real old Node runtime verification this round. Test prerelease only.

Evidence in /tmp/bili-riskfix6-{unit,activation,service,player,wbi,diag,report,build}.log. Await #65/#51 actual playback and activation status; ask #57 to use this package's PGC v2 rather than riskfix.4.
