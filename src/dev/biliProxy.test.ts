// @ts-nocheck
import { afterEach, expect, mock, test } from 'bun:test';
import https from 'node:https';
import zlib from 'node:zlib';
import {
  __testing,
  createBiliDevProxyPlugin,
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
  expect(isAllowedHost('archive.biliimg.com')).toBe(true);
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

  const plugin = createBiliDevProxyPlugin();

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

test('bili proxy helpers decode deflate payloads and rewrite response headers for playlists', async () => {
  const compressed = zlib.deflateRawSync(Buffer.from('playlist-body'));
  const decoded = await __testing.decompressBuffer(compressed, 'deflate');
  expect(decoded.toString()).toBe('playlist-body');

  const headerValues = {};
  __testing.copyResponseHeaders(
    {
      headers: {
        'content-length': '999',
        'set-cookie': ['SESSDATA=abc'],
        'content-type': 'application/vnd.apple.mpegurl',
      },
    },
    {
      setHeader(key, value) {
        headerValues[key] = value;
      },
    },
    { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': 14 },
  );

  expect(headerValues['set-cookie']).toBeUndefined();
  expect(headerValues['Content-Length']).toBe(14);
  expect(headerValues['content-length']).toBeUndefined();
});

test('vite proxy middleware handles ping next and forbidden host branches', () => {
  const plugin = createBiliDevProxyPlugin();
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });

  const pingRes = {
    statusCode: 0,
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    end(chunk) {
      this.body = String(chunk);
    },
    setHeader() {},
  };
  middleware({ originalUrl: '/ping', headers: {} }, pingRes, () => {});
  expect(pingRes.statusCode).toBe(200);
  expect(pingRes.body).toContain('"status":"ok"');

  let nextCalled = false;
  middleware(
    { originalUrl: '/not-proxy', headers: {} },
    { writeHead() {}, end() {}, setHeader() {} },
    () => {
      nextCalled = true;
    },
  );
  expect(nextCalled).toBe(true);

  const deniedRes = {
    statusCode: 0,
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    end(chunk) {
      this.body = String(chunk);
    },
    setHeader() {},
  };
  middleware(
    { originalUrl: '/proxy/example.com/x', headers: {} },
    deniedRes,
    () => {},
  );
  expect(deniedRes.statusCode).toBe(403);
  expect(deniedRes.body).toContain('Host not allowed');
});

test('sendProxyRequest reports upstream request errors as json', async () => {
  const originalRequest = https.request;
  https.request = mock((_options, _cb) => {
    const upstreamReq = new EventEmitter();
    upstreamReq.write = mock(() => {});
    upstreamReq.end = () => {
      upstreamReq.emit('error', new Error('boom'));
    };
    upstreamReq.destroy = mock(() => {});
    return upstreamReq;
  });

  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:5173' };
  const res = {
    headersSent: false,
    statusCode: 0,
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    end(chunk) {
      this.body = String(chunk);
    },
    setHeader() {},
  };

  __testing.sendProxyRequest(req, res, {
    host: 'api.bilibili.com',
    hostname: 'api.bilibili.com',
    port: 443,
    upstreamPath: '/x',
  });
  req.emit('end');
  await new Promise((resolve) => queueMicrotask(resolve));

  expect(res.statusCode).toBe(502);
  expect(res.body).toContain('"error":"boom"');
  https.request = originalRequest;
});

test('bili proxy testing helpers parse cookies build proxy base and read streams', async () => {
  expect(__testing.parseCookies('SESSDATA=abc; bili_jct=xyz')).toEqual({
    SESSDATA: 'abc',
    bili_jct: 'xyz',
  });
  expect(
    __testing.serializeCookies({
      SESSDATA: 'abc',
      empty: '',
      skip: null,
      bili_jct: 'xyz',
    }),
  ).toBe('SESSDATA=abc; bili_jct=xyz');
  expect(
    __testing.mergeCookieBridge([
      'SESSDATA=abc; Path=/',
      'bili_jct=xyz; Path=/',
    ]),
  ).toEqual({
    SESSDATA: 'abc',
    bili_jct: 'xyz',
  });
  expect(__testing.buildProxyBase({ headers: { host: 'tv.local:5173' } })).toBe(
    'http://tv.local:5173',
  );

  const stream = new EventEmitter();
  const streamPromise = __testing.readStream(stream);
  stream.emit('data', Buffer.from('hello '));
  stream.emit('data', Buffer.from('world'));
  stream.emit('end');
  expect((await streamPromise).toString()).toBe('hello world');
});

test('sendProxyRequest rewrites HLS playlists and exposes bridged cookies', async () => {
  const originalRequest = https.request;
  https.request = mock((_options, cb) => {
    const upstreamRes = new EventEmitter();
    upstreamRes.headers = {
      'content-type': 'application/vnd.apple.mpegurl',
      'content-encoding': 'identity',
      'set-cookie': ['SESSDATA=abc; Path=/'],
    };
    upstreamRes.statusCode = 200;

    const upstreamReq = new EventEmitter();
    upstreamReq.write = mock(() => {});
    upstreamReq.end = () => {
      cb(upstreamRes);
      queueMicrotask(() => {
        upstreamRes.emit('data', Buffer.from('#EXTM3U\nsegment.ts\n'));
        upstreamRes.emit('end');
      });
    };
    upstreamReq.destroy = mock(() => {});
    return upstreamReq;
  });

  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:5173' };
  let resolveResponse;
  const responseEnded = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const res = {
    headersSent: false,
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    writeHead(code) {
      this.statusCode = code;
    },
    end(chunk) {
      this.body = String(chunk);
      resolveResponse();
    },
  };

  __testing.sendProxyRequest(req, res, {
    host: 'api.live.bilibili.com',
    hostname: 'api.live.bilibili.com',
    port: 443,
    upstreamPath: '/live/test.m3u8',
  });
  req.emit('end');
  await responseEnded;

  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('http://localhost:5173/proxy/api.live.bilibili.com/live/segment.ts');
  expect(res.headers['X-Set-Cookie']).toContain('SESSDATA');
  https.request = originalRequest;
});

test('sendProxyRequest forwards request chunks and destroys upstream on request errors', () => {
  const originalRequest = https.request;
  const writes = [];
  const destroys = [];
  const requestOptions = [];

  https.request = mock((options, _cb) => {
    requestOptions.push(options);
    const upstreamReq = new EventEmitter();
    upstreamReq.write = (chunk) => {
      writes.push(String(chunk));
    };
    upstreamReq.end = mock(() => {});
    upstreamReq.destroy = () => {
      destroys.push('destroyed');
    };
    return upstreamReq;
  });

  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = {
    host: 'localhost:5173',
    'x-cookie': 'DedeUserID=100',
  };
  const res = {
    headersSent: false,
    writeHead() {},
    end() {},
    setHeader() {},
  };

  __testing.sendProxyRequest(req, res, {
    host: 'api.bilibili.com',
    hostname: 'api.bilibili.com',
    port: 443,
    upstreamPath: '/x/web-interface/nav',
  });

  req.emit('data', Buffer.from('body-part'));
  req.emit('error', new Error('request broke'));

  expect(writes).toEqual(['body-part']);
  expect(destroys).toEqual(['destroyed']);
  expect(requestOptions[0].headers.origin).toBe('https://www.bilibili.com');
  expect(requestOptions[0].headers.cookie).toContain('DedeUserID=100');
  https.request = originalRequest;
});
