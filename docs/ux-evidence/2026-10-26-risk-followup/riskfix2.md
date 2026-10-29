# 2.5.1 riskfix.2

#57's first candidate report confirms a completed automatic recovery followed by another -351. The cooldown fix alone does not solve playback.

## Changes

Normal UGC DASH playback now sends its WBI-signed request to /x/player/wbi/playurl, retaining the exact cid, video identifier, quality and feature flags. PGC and the separate legacy HTML5 speed transport are unchanged. No anonymous fallback or extra client retry was added.

Diagnostics use the same UGC helper at qn=127/fnval=4048. If the reference WBI request returns an unusable response, one observational legacy request uses the same video and parameters. The report labels endpoint=wbi/legacy, separately from reference/recommendation source. Both probes bypass identity recovery.

## Evidence and limits

- Live anonymous public-video comparison: old and WBI endpoints both returned HTTP 200/code 0, six video tracks, no voucher. This establishes local endpoint availability only, not an affected-account fix.
- WBI browser transport/signature tests: 13 passed, including request-path/quality assertions, invalid signing metadata, preserved risk response, and account generation changes.
- Diagnostic browser scenarios: 11 passed plus maximum-report QR check. Includes WBI rejected/legacy accepted, WBI accepted without a legacy request, and identical comparison parameters.
- Playback browser fixtures: 14 passed covering premium quality selection, 4K/8K limits, quality failure restoration, decoder fallback and bounded network/risk errors. Decoder is controlled; these are not hardware decoding tests.
- Full unit suite: 227 passed, 1 external Dolby corpus skip.
- Production-service risk fixtures: 19 passed.
- Production legacy build and app/service packaging passed.

Early development runs caught an extra closing brace and a missing diagnostic import; both were corrected before the passing final browser suites and production build.

No television was accessed. The affected account's playback remains unverified. Keep #57/#58 open and this candidate outside stable/Homebrew.

IPK SHA-256: acb78f0f01183ef5dc1a91c32d531036905c585c0934d0c70704e3d671b849f1
