// DLNA cast URL rewriting (Huya).
//
// Two measured facts (2026-07-12, real signed URLs from the owner's casts):
// 1. This TV's FLV demux is flaky (one stream played, the next threw
//    MEDIA_ERR 4) — the same stream over HLS always played. Huya's CDN serves
//    HLS at the same path with the same wsSecret: swap host segment + extension.
// 2. The `ratio` (bitrate) parameter is NOT covered by the signature — the
//    sender caps casts at ratio=2000 (~"超清"), but rewriting it to 8000 gets
//    the 蓝光 stream (segment bitrate measured 3× higher). Above the
//    streamer's top tier the CDN answers 404/403, which trips the player's
//    retry → we step down the ladder.
//
// attempt 0: HLS + ratio=8000 (蓝光 if the streamer has it)
// attempt 1: HLS + the sender's original ratio
// attempt 2+: the untouched original URL (FLV fallback)
export function rewriteCastUrl(url, attempt) {
  if (!url) return url;
  const a = attempt || 0;
  if (a >= 2) return url;
  if (/\.flv\.huya\.com\//.test(url) && /\.flv(\?|$)/.test(url)) {
    let out = url
      .replace('.flv.huya.com', '.hls.huya.com')
      .replace(/\.flv(\?|$)/, '.m3u8$1');
    if (a === 0) {
      out = /[?&]ratio=\d+/.test(out)
        ? out.replace(/([?&]ratio=)\d+/, '$18000')
        : out + (out.indexOf('?') >= 0 ? '&' : '?') + 'ratio=8000';
    }
    return out;
  }
  return url;
}
