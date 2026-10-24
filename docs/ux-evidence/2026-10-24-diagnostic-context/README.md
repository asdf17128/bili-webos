# Diagnostic context validation

- New deterministic tests: 5 passed (bounded capture, recovery outcomes, probe isolation, malformed/HTTP/transport failures, safe export).
- Production-service recovery suite: 16 passed.
- Real macOS Node 0.12.2 and 8.17.0: production service with isolated disk/Luna/upstream passed, including original -351 and final success evidence. This is not old-TV TLS validation.
- Browser QR tests: 3 passed. Injected two-attempt failures (HTTP/API codes, voucher boolean, requested quality and recovery outcome); decoded rendered pixels. Both -351 and voucher-only errors, plus complete network failure, are covered.
- TV: installed local test package, opened diagnostics and decoded a CDP screenshot; report contained new session/identity context (404 characters). Initial screenshot was clipped below the viewport because the test clicked without scrolling; after scrolling the panel into view the QR decoded. This does not establish a new remote-navigation fix or a long-running playback test. TV screenshot remains private because it displays the signed-in nickname.
- Records are in-memory and are cleared on service restart. No automatic upload. No new release was created by these checks.

- Full local pipeline `bash tools/verify.sh --no-tv --ux`: exit 0. UI 70/70, session 10/10, player 77/77, playback-end 26/26, live 15/15, CDN 7/7 and diagnostic CDN 4/4 passed. Docker unavailable (explicit skip); actual Mac runtimes tested separately as noted above.
