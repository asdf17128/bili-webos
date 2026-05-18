import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  buildProxyUrl,
  rewriteHlsPlaylist,
} from '../src/cast/hlsPlaylist.ts';

test('rewrites relative hls segment urls to keep them on the proxy', () => {
  const sourceUrl =
    'https://d1--ov-gotcha207.bilivideo.com/live-bvc/950683/live_12939237_4978623_2500/index.m3u8?token=abc';
  const proxyBase = 'http://127.0.0.1:7654';
  const playlist = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="h1778564777.m4s"',
    '#EXTINF:1.00,',
    '1778568917.m4s',
    '',
  ].join('\n');

  const rewritten = rewriteHlsPlaylist(playlist, sourceUrl, proxyBase);
  assert.match(
    rewritten,
    new RegExp(
      buildProxyUrl(
        proxyBase,
        'd1--ov-gotcha207.bilivideo.com',
        '/live-bvc/950683/live_12939237_4978623_2500/h1778564777.m4s',
      ),
    ),
  );
});
