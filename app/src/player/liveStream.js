// Keep source and quality metadata from the same response. The API normally
// lists TS first; C4 measurements favored the fMP4 source at unchanged quality.
// Retain TS for devices/streams that cannot start the preferred source.
export function selectLivePlayback(response, preferredFormat = 'fmp4', avoidedHosts = []) {
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
          const infos = (codec.url_info || []).map(info => {
            try {
              const parsed = new URL(info.host);
              return /^https?:$/.test(parsed.protocol) ? { info, host: parsed.host } : null;
            } catch { return null; }
          }).filter(Boolean);
          // Choose only URLs supplied together by the live API. Never rewrite
          // a signed live URL using VOD mirrors or another candidate's query.
          // Failure history is oldest first. If every host failed, rotate to
          // the least recently tried host instead of repeatedly pinning primary.
          const candidate = infos.find(item => !avoidedHosts.includes(item.host))
            || avoidedHosts.map(host => infos.find(item => item.host === host)).find(Boolean)
            || infos[0];
          const info = candidate?.info;
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
