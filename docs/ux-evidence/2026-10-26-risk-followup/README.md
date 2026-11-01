# #57 / #58 follow-up — 2.5.1 riskfix.1

This is a local test candidate, not a stable release. Playback recovery on the reporters' televisions is **unverified**. No TV was accessed, and no Homebrew metadata was changed.

## Confirmed defects addressed

- The account repair panel kept a fixed cooldown snapshot. It now counts down and re-reads local service status before enabling repair; a renewed cooldown or failed read cannot unlock it. Closing the panel cancels scheduled checks. Status checks do not request account APIs or initiate repairs.
- Diagnostic playurl probes previously initiated automatic identity recovery. They now observe the response without rotating identity or consuming the cooldown; normal playback retains its bounded recovery.
- A subsequent cooldown failure erased evidence of the actual recovery attempt. Diagnostics now retain the latest actual recovery and its before/after responses separately (in memory, for the service lifetime).
- An unchanged SPI identity is no longer treated as a successful replacement.
- CDN checks can use a recommended video different from the reference playurl probe. Reports now identify reference/recommendation sources without exporting video IDs.

## Local validation

- Full unit suite: 225 passed, 1 external Dolby corpus skip.
- Account controller / diagnostic targeted suite: 82 passed.
- Isolated production-service risk suite: 19 passed, including probes with zero identity writes and persistent -351 before/after recovery.
- React account-repair suite: 24 passed, followed by 4 focused cooldown checks (including added stale-clock/error and unmount cases).
- Real browser diagnostic fixtures: 8 scenarios plus maximum QR report passed; additional mixed-source case passed.
- Account repair ES5 fixtures: 14 passed on host Node v25.4.0 (not a legacy-runtime claim).
- Account transport fixtures: 45 passed.
- Production legacy bundle build and app + service IPK packaging passed.

An initial diagnostic export test caught field-order changes; field order was made backward compatible and the suite passed afterward. An initial new service test used the wrong fixture method name; corrected to getDiagnostics before its passing run.

Package SHA-256: 5ec63f99da982415c36ab8f11e1a3fa5f9bc12c7ef5fc916df3c9600133069c6

## Required affected-device check

Install the candidate; wait for the shared cooldown to finish. Reproduce one logged-in playback failure, then collect diagnostics without restarting the app/service. Inspect previous-recovery and previous-attempt1/2 to distinguish identity acquisition failure, unchanged identity, and continued -351 after a completed refresh. The report must not be interpreted as proving a generic account ban or CDN failure. Do not repeatedly reset identifiers.

Keep #57 and #58 open until the affected devices confirm playback.
