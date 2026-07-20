# Dolby Vision and premium audio

The production player supports Bilibili's separate DASH video and audio
representations. Media-byte transformation is limited to one audited 120 fps
Dolby Vision representation; every other media fragment passes through
unchanged.

## Dolby Vision signaling

Bilibili qn 126 may advertise a generic `hvc1` codec even when its MP4 init
segment contains a `dvcC`, `dvvC`, or `dvwC` Dolby Vision configuration box.
On LG webOS this can play only the HDR-compatible base layer.

For qn 126, the player reads only the initialization range, derives the exact
Dolby codec (for example `dvh1.08.09`), verifies MSE support, and uses that codec
in the synthetic MPD. If probing or capability detection fails, playback keeps
the API's original codec as a safe fallback. If `dvh1` is advertised as
supported but fails during the real load, the player retries the same qn 126
stream with its original base-layer signaling before dropping video quality.

`ignoreHardwareResolution: true` is intentional: some cinema masters are 4096
pixels wide while the television reports a 3840-pixel panel limit to Shaka.
The tested OLED42C6PCA/webOS 26 decoder accepts the verified 4096-wide streams.

## Audited 120 fps compatibility path

The tested OLED42C6PCA/webOS 26 decoder cannot reliably consume the known qn
126 4K/120 Profile 8 source directly. For that source only, the player
recognizes the exact bvid/aid, cid,
representation metadata, init/index ranges, complete hvcC record, complete
SIDX, and all 35 byte ranges. It then removes the independently proven-safe
temporal pictures in the compressed HEVC domain and rewrites the fMP4 sample
table and SPS VUI timing to 60 fps. This is not decode/re-encode transcoding,
does not lower qn or resolution, and retains one self-contained Dolby RPU for
every retained picture.

The transformation is fail-closed. A mismatched index, range, sample count,
GOP dependency, RPU, timing value, or output postcondition is never sent to a
Dolby Vision SourceBuffer. The player immediately reloads the same qn 126
`hvc1` representation as its HLG base layer, preserving the selected audio
kind and playback position. Other videos do not enter this path.

The local validation build was verified on an LG OLED42C6PCA running webOS 26
across multiple regular segments and the shorter final segment. The browser
reported 3840x2160,
`readyState=4`, advancing playback and no media error; LG reported H.265,
E-AC-3/Atmos and active Dolby Vision, and manual visual validation confirmed
the rendered picture was normal. A separate, previously working Dolby Vision
source still
played at 4096x1890 after the source-specific change.

## Audio selection

Audio is selected independently from video quality in this order:

1. Dolby E-AC-3 (`dash.dolby.audio`)
2. Hi-Res FLAC (`dash.flac.audio`)
3. The highest-bitrate standard AAC representation (`dash.audio`)

Each premium codec is selected only when the exact MSE content type is
supported. An empty Dolby list never falls through while retaining a Dolby
label. Switching Dolby Vision to SDR 4K therefore keeps Atmos or Hi-Res audio
when the video actually provides it. A runtime decoder failure advances one
real audio kind at a time (E-AC-3 → FLAC → AAC); an AAC-only stream is never
loaded twice as a pretend premium-audio retry.

## Quality selection

Manual quality changes are strict: a requested qn must exist, otherwise the
existing stream and label are retained. Startup fallback tries lower qn values
explicitly and records the representation that actually loaded. This prevents
the UI from displaying 4K while a lower stream is playing.

Automated coverage lives in `app/src/player/*.test.js`. The synthetic fixtures
run in every checkout; setting `BILI_DOLBY_120_CORPUS` to a local copy of the
audited full stream additionally validates all 35 real fragments without
committing copyrighted media. End-to-end verification must also check the HTML
video dimensions, advancing playback, the requested media representation, and
LG's media pipeline logs.
