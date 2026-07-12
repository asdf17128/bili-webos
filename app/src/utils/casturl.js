// DLNA cast URL rewriting. Huya's DLNA sender hands out FLV; this TV's FLV
// demuxer is unreliable (one stream played, the next threw MEDIA_ERR code 4
// "Format error" — owner, 2026-07-12). Huya's CDN serves the SAME stream,
// same wsSecret signature, over HLS: swap the host segment and the extension.
// Verified twice against real signed URLs (both answered 200 + valid m3u8).
export function rewriteCastUrl(url) {
  if (!url) return url;
  if (/\.flv\.huya\.com\//.test(url) && /\.flv(\?|$)/.test(url)) {
    return url
      .replace('.flv.huya.com', '.hls.huya.com')
      .replace(/\.flv(\?|$)/, '.m3u8$1');
  }
  return url;
}
