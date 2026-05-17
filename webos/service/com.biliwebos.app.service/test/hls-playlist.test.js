const { test } = require('bun:test');
const assert = require('node:assert/strict');

const {
  rewriteHlsPlaylist,
  buildProxyUrl,
} = require('../cast/hlsPlaylist');

test('rewrites relative hls segment urls to keep them on the proxy', () => {
  const sourceUrl = 'https://d1--ov-gotcha207.bilivideo.com/live-bvc/950683/live_12939237_4978623_2500/index.m3u8?token=abc';
  const proxyBase = 'http://127.0.0.1:7654';
  const playlist = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="h1778564777.m4s"',
    '#EXTINF:1.00,',
    '1778568917.m4s',
    ''
  ].join('\n');

  const rewritten = rewriteHlsPlaylist(playlist, sourceUrl, proxyBase);

  assert.match(rewritten, new RegExp(buildProxyUrl(proxyBase, 'd1--ov-gotcha207.bilivideo.com', '/live-bvc/950683/live_12939237_4978623_2500/h1778564777.m4s')));
  assert.match(rewritten, new RegExp(buildProxyUrl(proxyBase, 'd1--ov-gotcha207.bilivideo.com', '/live-bvc/950683/live_12939237_4978623_2500/1778568917.m4s')));
});

test('rewrites absolute hls urls but leaves comments untouched', () => {
  const sourceUrl = 'https://example.bilivideo.com/a/b/index.m3u8?foo=1';
  const proxyBase = 'http://127.0.0.1:7654';
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1280000',
    'https://cdn.bilivideo.com/live/alt.m3u8?bar=2',
    '#EXTINF:1.0,',
    '/live/seg-1.ts',
    ''
  ].join('\n');

  const rewritten = rewriteHlsPlaylist(playlist, sourceUrl, proxyBase);

  assert.match(rewritten, /^#EXTM3U/m);
  assert.ok(rewritten.includes(buildProxyUrl(proxyBase, 'cdn.bilivideo.com', '/live/alt.m3u8?bar=2')));
  assert.ok(rewritten.includes(buildProxyUrl(proxyBase, 'example.bilivideo.com', '/live/seg-1.ts')));
});
