// @ts-nocheck
export function buildProxyUrl(proxyBase, host, pathWithSearch) {
  return proxyBase.replace(/\/$/, '') + '/proxy/' + host + pathWithSearch;
}

function shouldRewriteLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed[0] === '#') return false;
  return true;
}

function rewriteAttributeUri(line, sourceUrl, proxyBase) {
  return line.replace(/URI="([^"]+)"/g, function (_, uri) {
    const resolved = new URL(uri, sourceUrl);
    return (
      'URI="' +
      buildProxyUrl(
        proxyBase,
        resolved.host,
        resolved.pathname + resolved.search,
      ) +
      '"'
    );
  });
}

export function rewriteHlsPlaylist(playlistText, sourceUrl, proxyBase) {
  return String(playlistText || '')
    .split('\n')
    .map(function (line) {
      if (line.indexOf('URI="') >= 0) {
        return rewriteAttributeUri(line, sourceUrl, proxyBase);
      }
      if (!shouldRewriteLine(line)) return line;
      const resolved = new URL(line.trim(), sourceUrl);
      return buildProxyUrl(
        proxyBase,
        resolved.host,
        resolved.pathname + resolved.search,
      );
    })
    .join('\n');
}
