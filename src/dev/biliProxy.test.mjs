import { createRequire } from 'node:module';
import { afterEach, expect, mock, test } from 'bun:test';
import {
  extractProxyTarget,
  isAllowedHost,
  isHlsPlaylistResponse,
  toCookieBridge,
} from './biliProxy.js';

const require = createRequire(import.meta.url);
const { rewriteHlsPlaylist } = require('../../webos/service/com.biliwebos.app.service/cast/hlsPlaylist.js');

afterEach(() => {
  mock.restore();
});

test('extractProxyTarget parses host and upstream path from /proxy requests', () => {
  expect(extractProxyTarget('/proxy/api.bilibili.com/x/web-interface/nav?pn=1')).toEqual({
    host: 'api.bilibili.com',
    hostname: 'api.bilibili.com',
    port: 443,
    upstreamPath: '/x/web-interface/nav?pn=1',
  });
});

test('isAllowedHost accepts bilivideo and hdslb domains but rejects others', () => {
  expect(isAllowedHost('i0.hdslb.com')).toBe(true);
  expect(isAllowedHost('upos-sz-static.bilivideo.com')).toBe(true);
  expect(isAllowedHost('example.com')).toBe(false);
});

test('toCookieBridge serializes Set-Cookie headers into the existing JSON bridge', () => {
  expect(toCookieBridge([
    'SESSDATA=abc; Path=/; HttpOnly',
    'DedeUserID=100; Path=/',
  ])).toBe('{"SESSDATA":"abc","DedeUserID":"100"}');
});

test('isHlsPlaylistResponse matches both content type and .m3u8 paths', () => {
  expect(isHlsPlaylistResponse('application/vnd.apple.mpegurl', '/live/index.m3u8')).toBe(true);
  expect(isHlsPlaylistResponse('text/plain', '/live/index.m3u8')).toBe(true);
  expect(isHlsPlaylistResponse('video/mp2t', '/live/segment.ts')).toBe(false);
});

test('vite proxy middleware preserves upstream path when forwarding /proxy requests', async () => {
  const proxyEvents = {};
  const webCalls = [];

  mock.module('http-proxy', () => ({
    default: {
      createProxyServer(options) {
        return {
          options,
          on(event, handler) {
            proxyEvents[event] = handler;
          },
          web(req, _res, forwardOptions) {
            webCalls.push({
              reqUrl: req.url,
              forwardOptions,
            });
          },
        };
      },
    },
  }));

  mock.module('node:module', () => ({
    createRequire() {
      return () => ({ rewriteHlsPlaylist });
    },
  }));

  const fresh = await import(`./biliProxy.js?middleware-path-test=${Date.now()}`);
  const plugin = fresh.createBiliDevProxyPlugin();

  let middleware;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });

  const req = {
    originalUrl: '/proxy/api.bilibili.com/x/web-interface/nav?pn=1',
    headers: { host: 'localhost:5173' },
  };
  const res = {
    writeHead() {},
    end() {},
    setHeader() {},
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  expect(nextCalled).toBe(false);
  expect(req.url).toBe('/x/web-interface/nav?pn=1');
  expect(webCalls).toHaveLength(1);
  expect(webCalls[0]).toEqual({
    reqUrl: '/x/web-interface/nav?pn=1',
    forwardOptions: {
      target: 'https://api.bilibili.com',
    },
  });
});
