# riskfix.3: diagnostic QR navigation

2026-10-27. Reports #58 and #60 are from the same C1 user. #58 photo shows Generate QR not activated and focus on Language: Down skipped export at row 9 col 1. #60 has previous recovery final=ok and startup ready (~2767 ms), while the reference-video probe still gets a voucher-only response. This proves at least one successful playback, not a universal fix or a restart cause.

Changed D-pad navigation through export in both directions; retained Right access. Scroll generated QR into view and provide explicit generation-error fallback. Explain reference probe versus latest actual playback in all three UI languages.

Validation: npm test 227 passed, 1 external Dolby corpus skipped; tools/test-diagnostic-privacy.mjs 11 scenarios plus maximum report passed, including D-pad traversal, QR viewport bounds, pixel decoding and preview equality. Synthetic risk351-export.png inspected. Production build and IPK packaging passed. No TV testing or affected-account reproduction this round.

Evidence: /tmp/bili-riskfix3-diag, /tmp/bili-riskfix3-unit.log, /tmp/bili-riskfix3-build.log. Request one working and one failing BV/link, official-client result on same account/network, and diagnostic immediately after failure before playing another video or restarting. Do not request credentials, signed media URLs or login QR.
