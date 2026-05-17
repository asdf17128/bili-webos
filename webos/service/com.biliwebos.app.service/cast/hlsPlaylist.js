function buildProxyUrl(proxyBase, host, pathWithSearch) {
  return proxyBase.replace(/\/$/, '') + '/proxy/' + host + pathWithSearch;
}

function shouldRewriteLine(line) {
  if (!line) return false;
  var trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed[0] === '#') return false;
  return true;
}

function rewriteAttributeUri(line, sourceUrl, proxyBase) {
  return line.replace(/URI="([^"]+)"/g, function (_, uri) {
    var resolved = new URL(uri, sourceUrl);
    return 'URI="' + buildProxyUrl(proxyBase, resolved.host, resolved.pathname + resolved.search) + '"';
  });
}

function rewriteHlsPlaylist(playlistText, sourceUrl, proxyBase) {
  return String(playlistText || '')
    .split('\n')
    .map(function (line) {
      if (line.indexOf('URI="') >= 0) {
        return rewriteAttributeUri(line, sourceUrl, proxyBase);
      }
      if (!shouldRewriteLine(line)) return line;
      var resolved = new URL(line.trim(), sourceUrl);
      return buildProxyUrl(proxyBase, resolved.host, resolved.pathname + resolved.search);
    })
    .join('\n');
}

module.exports = {
  buildProxyUrl: buildProxyUrl,
  rewriteHlsPlaylist: rewriteHlsPlaylist,
};
