// @ts-nocheck
function buildUrl(codec) {
  const info = (codec.url_info || [{}])[0];
  return (info.host || '') + (codec.base_url || '') + (info.extra || '');
}

function findPreferredCodec(streams, protocolName, preferredFormats) {
  for (const formatName of preferredFormats) {
    for (const stream of streams || []) {
      if (stream.protocol_name !== protocolName) continue;
      for (const format of stream.format || []) {
        if (format.format_name !== formatName) continue;
        for (const codec of format.codec || []) {
          if (codec.codec_name === 'avc') return codec;
        }
      }
    }
  }
  return null;
}

export function selectLiveStreamSource(streams) {
  const flvCodec = findPreferredCodec(streams, 'http_stream', ['flv']);
  if (flvCodec) {
    return { type: 'flv', url: buildUrl(flvCodec) };
  }

  const hlsCodec = findPreferredCodec(streams, 'http_hls', ['fmp4', 'ts']);
  if (hlsCodec) {
    return { type: 'hls', url: buildUrl(hlsCodec) };
  }

  return null;
}

export function selectLiveStreamUrl(streams) {
  return selectLiveStreamSource(streams)?.url || null;
}
