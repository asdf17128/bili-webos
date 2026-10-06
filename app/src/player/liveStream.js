// Keep source and quality metadata from the same response. The API normally
// lists TS first; C4 measurements favored the fMP4 source at unchanged quality.
// Retain TS for devices/streams that cannot start the preferred source.
export function selectLivePlayback(response, preferredFormat = 'fmp4') {
  if (response?.code && response.code !== 0) throw new Error('Live API: ' + response.code);
  const playurl = response?.data?.playurl_info?.playurl;
  const names = {};
  for (const q of playurl?.g_qn_desc || []) names[q.qn] = q.desc;
  const order = preferredFormat === 'ts' ? ['ts', 'fmp4'] : ['fmp4', 'ts'];
  for (const format of order) {
    for (const stream of playurl?.stream || []) {
      for (const entry of stream.format || []) {
        if (entry.format_name !== format) continue;
        for (const codec of entry.codec || []) {
          if (codec.codec_name !== 'avc' || !codec.base_url) continue;
          const info = (codec.url_info || []).find(item => /^https?:\/\//.test(item.host || ''));
          if (!info) continue;
          return {
            url: info.host + codec.base_url + (info.extra || ''), format,
            qn: codec.current_qn || 0,
            accept: (codec.accept_qn || []).slice().sort((a, b) => b - a).map(qn => ({ qn, label: names[qn] || String(qn) })),
          };
        }
      }
    }
  }
  throw new Error('No playable live HLS stream');
}
