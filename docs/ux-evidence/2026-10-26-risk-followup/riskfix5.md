# riskfix.5: PGC v2, media keys, activation experiment

2026-10-29. #63 provides ep301087, PGC -351 while reference WBI/CDN succeeds. #64 confirms Dolby works and requests media buttons. #51 supplied separated activation observations, but on one account/video/network and spoofed desktop profile.

## Implementation

Use /pgc/player/web/v2/playurl and normalize result/data.video_info without discarding top-level status or envelope vouchers. Service risk detection and bounded diagnostics share ES5 envelope parsing and identify pgc_v2. Preserve qn/fnval/fnver/fourk, authentication and existing retry ceiling. No anonymous fallback.

Media keys recognize LG 415/19, combined 179 and DOM MediaPlay/MediaPause/MediaPlayPause. Dedicated commands do not toggle; repeated keydowns ignored. Commands also work while buffering; playback promise rejection does not falsely set playing. Existing UI events reflect media state.

References: https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py (PGC v2 and video_info); https://webostv.developer.lge.com/develop/guides/magic-remote (LG media keys).

## Validation

235 unit passes, 1 external Dolby corpus skip. 20 selected controlled-player cases, including nested PGC success/refusal and remote commands, plus final buffering-key rerun. 22 isolated service risk tests include nested voucher and stream cases. 11 diagnostic scenarios plus maximum QR pixel decoding passed. Production build and packaging passed. No TV testing.

Anonymous live signed requests for ep301087 using client quality parameters and site-root Referer returned code=0 and streams on both old and v2 endpoints; only v2 had nested video_info. Does not reproduce affected-account failure or prove the fix.

## Activation evaluation

Added tools/probe-device-activation.mjs requiring --live. Reads no app or TV credentials, writes no identity; uses fresh anonymous SPI IDs and a random _uuid, actual temporary Chromium UA/platform/screen/language/timezone fields. Does not invent buvid_fp/b_nut or copy a desktop/GPU/canvas fingerprint. One activation returned code=0; three signed UGC probes before and three after all returned streams without voucher. Thus it verifies acceptance of this minimal desktop payload, not effectiveness against risk control, persistence or TV compatibility. Not connected to app recovery. No automatic activation ships.

Evidence: /tmp/bili-riskfix5-{unit,player,service,diag,keys,build}.log; redacted live results alongside this document. Keep issues open pending reporters' confirmation; stable channel unchanged.
