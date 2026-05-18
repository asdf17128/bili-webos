// @ts-nocheck
import { afterEach, expect, mock, test } from 'bun:test';
import https from 'node:https';
import {
  extractProxyTarget,
  isAllowedHost,
  isHlsPlaylistResponse,
  toCookieBridge,
} from './biliProxy.ts';
import { EventEmitter } from 'node:events';

afterEach(() => {
  mock.restore();
});

test('extractProxyTarget parses host and upstream path from /proxy requests', () => {
  expect(
    extractProxyTarget('/proxy/api.bilibili.com/x/web-interface/nav?pn=1'),
  ).toEqual({
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
  expect(
    toCookieBridge([
      'SESSDATA=abc; Path=/; HttpOnly',
      'DedeUserID=100; Path=/',
    ]),
  ).toBe('{"SESSDATA":"abc","DedeUserID":"100"}');
});

test('isHlsPlaylistResponse matches both content type and .m3u8 paths', () => {
  expect(
    isHlsPlaylistResponse('application/vnd.apple.mpegurl', '/live/index.m3u8'),
  ).toBe(true);
  expect(isHlsPlaylistResponse('text/plain', '/live/index.m3u8')).toBe(true);
  expect(isHlsPlaylistResponse('video/mp2t', '/live/segment.ts')).toBe(false);
});

test('vite proxy middleware preserves upstream path when forwarding /proxy requests', async () => {
  const webCalls = [];
  const originalRequest = https.request;
  https.request = mock((options, cb) => {
    webCalls.push(options);
    const upstreamRes = new EventEmitter();
    upstreamRes.headers = { 'content-type': 'application/json' };
    upstreamRes.statusCode = 200;
    upstreamRes.pipe = (_target) => {};

    const upstreamReq = new EventEmitter();
    upstreamReq.write = () => {};
    upstreamReq.end = () => {
      cb(upstreamRes);
    };
    upstreamReq.destroy = () => {};
    return upstreamReq;
  });

  const fresh = await import(
    `./biliProxy.ts?middleware-path-test=${Date.now()}`
  );
  const plugin = fresh.createBiliDevProxyPlugin();

  let middleware;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });

  const req = new EventEmitter();
  req.originalUrl = '/proxy/api.bilibili.com/x/web-interface/nav?pn=1';
  req.headers = { host: 'localhost:5173' };
  const res = {
    writeHead() {},
    end() {},
    setHeader() {},
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });
  req.emit('end');

  expect(nextCalled).toBe(false);
  expect(req.url).toBe('/x/web-interface/nav?pn=1');
  expect(webCalls).toHaveLength(1);
  expect(webCalls[0]).toMatchObject({
    hostname: 'api.bilibili.com',
    path: '/x/web-interface/nav?pn=1',
  });
  https.request = originalRequest;
});
