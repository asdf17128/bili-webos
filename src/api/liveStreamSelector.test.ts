import { test, expect } from 'bun:test';

import {
  selectLiveStreamSource,
  selectLiveStreamUrl,
} from './liveStreamSelector.ts';

test('prefers avc flv live stream over hls variants when available', () => {
  const source = selectLiveStreamSource([
    {
      protocol_name: 'http_stream',
      format: [
        {
          format_name: 'flv',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/a.flv',
              url_info: [{ host: 'https://stream.example.com' }],
            },
          ],
        },
      ],
    },
    {
      protocol_name: 'http_hls',
      format: [
        {
          format_name: 'ts',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/b.m3u8',
              url_info: [{ host: 'https://ts.example.com' }],
            },
          ],
        },
        {
          format_name: 'fmp4',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/c/index.m3u8',
              url_info: [{ host: 'https://fmp4.example.com' }],
            },
          ],
        },
      ],
    },
  ]);

  expect(source).toEqual({
    type: 'flv',
    url: 'https://stream.example.com/a.flv',
  });
});

test('prefers avc fmp4 hls when flv is unavailable', () => {
  const source = selectLiveStreamSource([
    {
      protocol_name: 'http_hls',
      format: [
        {
          format_name: 'ts',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/b.m3u8',
              url_info: [{ host: 'https://ts.example.com' }],
            },
          ],
        },
        {
          format_name: 'fmp4',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/c/index.m3u8',
              url_info: [{ host: 'https://fmp4.example.com' }],
            },
          ],
        },
      ],
    },
  ]);

  expect(source).toEqual({
    type: 'hls',
    url: 'https://fmp4.example.com/c/index.m3u8',
  });
});

test('falls back to avc ts hls when fmp4 is unavailable', () => {
  const source = selectLiveStreamSource([
    {
      protocol_name: 'http_hls',
      format: [
        {
          format_name: 'ts',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/b.m3u8',
              url_info: [{ host: 'https://ts.example.com' }],
            },
          ],
        },
      ],
    },
  ]);

  expect(source).toEqual({
    type: 'hls',
    url: 'https://ts.example.com/b.m3u8',
  });
});

test('selectLiveStreamUrl preserves existing url-only API', () => {
  const url = selectLiveStreamUrl([
    {
      protocol_name: 'http_stream',
      format: [
        {
          format_name: 'flv',
          codec: [
            {
              codec_name: 'avc',
              base_url: '/fast.flv',
              url_info: [{ host: 'https://stream.example.com' }],
            },
          ],
        },
      ],
    },
  ]);

  expect(url).toBe('https://stream.example.com/fast.flv');
});

test('returns null when no supported live source exists', () => {
  const source = selectLiveStreamSource([
    {
      protocol_name: 'http_hls',
      format: [
        {
          format_name: 'fmp4',
          codec: [
            {
              codec_name: 'hevc',
              base_url: '/bad.m3u8',
              url_info: [{ host: 'https://bad.example.com' }],
            },
          ],
        },
      ],
    },
  ]);

  expect(source).toBeNull();
});
