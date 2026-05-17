const { afterEach, beforeEach, expect, mock, test } = require('bun:test');
const { EventEmitter } = require('events');
const fs = require('fs');
const https = require('https');
const childProcess = require('child_process');
const WebOSService = require('../webos-service-stub');

const serviceModule = require('../service.js');

function respondOnce(invoker) {
  return new Promise((resolve) => {
    invoker({
      payload: {},
      isSubscription: false,
      respond(value) {
        resolve(value);
      },
    });
  });
}

function createProxyRes(statusCode, headers, chunks) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  res.pipe = mock((target) => {
    target.piped = true;
  });
  queueMicrotask(() => {
    for (const chunk of chunks || []) res.emit('data', Buffer.from(chunk));
    res.emit('end');
  });
  return res;
}

function createHttpResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    piped: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers || null;
    },
    end(body) {
      this.body = body == null ? '' : String(body);
    },
  };
}

let originalHttpsRequest;
let originalWriteFileSync;
let originalExecFile;
let originalConsoleError;
let originalConsoleLog;

beforeEach(() => {
  WebOSService.__instances.length = 0;
  originalHttpsRequest = https.request;
  originalWriteFileSync = fs.writeFileSync;
  originalExecFile = childProcess.execFile;
  originalConsoleError = console.error;
  originalConsoleLog = console.log;

  console.error = (...args) => {
    const first = String(args[0] || '');
    if (first.startsWith('[Cast]') || first.startsWith('[LocalProxy]')) return;
    originalConsoleError(...args);
  };
  console.log = (...args) => {
    const first = String(args[0] || '');
    if (first.startsWith('[BiliService]') || first.startsWith('[Cast]')) return;
    originalConsoleLog(...args);
  };
});

afterEach(() => {
  https.request = originalHttpsRequest;
  fs.writeFileSync = originalWriteFileSync;
  childProcess.execFile = originalExecFile;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

test('service runtime registers handlers and supports fetch/cast/config flows', async () => {
  const service = serviceModule.service;
  const handlers = service.handlers;
  expect(service.name).toBe('com.biliwebos.app.service');
  expect(Object.keys(handlers)).toEqual(expect.arrayContaining([
    'fetch', 'getCookies', 'setCookies', 'clearCookies', 'ping',
    'castSubscribe', 'castAck', 'castReportState', 'castReportProgress', 'castGetStatus', 'castSetConfig',
  ]));

  let requestPlan = [];
  https.request = function (options, cb) {
    const req = new EventEmitter();
    req.write = mock((body) => {
      req.body = body;
    });
    req.end = mock(() => {
      const next = requestPlan.shift();
      if (!next) throw new Error('missing request plan');
      next(options, cb, req);
    });
    return req;
  };

  fs.writeFileSync = mock(() => {});

  const noUrl = await new Promise((resolve) => handlers.fetch({
    payload: {},
    respond: resolve,
  }));
  expect(noUrl).toEqual({ returnValue: false, error: 'No URL' });

  const invalid = await new Promise((resolve) => handlers.fetch({
    payload: { url: '::bad::' },
    respond: resolve,
  }));
  expect(invalid).toEqual({ returnValue: false, error: 'Invalid URL' });

  const blocked = await new Promise((resolve) => handlers.fetch({
    payload: { url: 'https://example.com/x' },
    respond: resolve,
  }));
  expect(blocked).toEqual({ returnValue: false, error: 'Host not allowed' });

  requestPlan.push((_options, cb) => {
    cb(createProxyRes(200, {
      'content-type': 'application/json',
      'set-cookie': ['SESSDATA=abc; Path=/', 'bili_jct=token; Path=/'],
    }, ['{"ok":1}']));
  });
  const jsonFetch = await new Promise((resolve) => handlers.fetch({
    payload: { url: 'https://api.bilibili.com/x', method: 'POST', body: 'hello', contentType: 'application/json' },
    respond: resolve,
  }));
  expect(jsonFetch.returnValue).toBe(true);
  expect(jsonFetch.body).toBe('{"ok":1}');
  expect(jsonFetch.newCookies).toMatchObject({ SESSDATA: 'abc', bili_jct: 'token' });

  requestPlan.push((_options, cb) => {
    cb(createProxyRes(206, { 'content-type': 'video/mp4' }, ['abc']));
  });
  const binaryFetch = await new Promise((resolve) => handlers.fetch({
    payload: { url: 'https://i0.hdslb.com/x.jpg', range: 'bytes=0-2' },
    respond: resolve,
  }));
  expect(binaryFetch.bodyBase64).toBe(Buffer.from('abc').toString('base64'));

  expect(await respondOnce(handlers.getCookies)).toMatchObject({ returnValue: true });

  const setCookies = await new Promise((resolve) => handlers.setCookies({
    payload: { cookies: { DedeUserID: '42' } },
    respond: resolve,
  }));
  expect(setCookies).toEqual({ returnValue: true });
  expect(serviceModule.__testing.getStoredCookies().DedeUserID).toBe('42');

  const cleared = await respondOnce(handlers.clearCookies);
  expect(cleared).toEqual({ returnValue: true });
  expect(serviceModule.__testing.getStoredCookies()).toEqual({});

  const ping = await respondOnce(handlers.ping);
  expect(ping.returnValue).toBe(true);
  expect(ping.localProxyPort).toBe(serviceModule.__testing.getLocalProxyPort());

  const subscriberEvents = [];
  const subscriptionMessage = {
    payload: { subscribe: true },
    isSubscription: true,
    respond(value) {
      subscriberEvents.push(value);
    },
  };
  handlers.castSubscribe(subscriptionMessage);
  expect(subscriberEvents[0].event.kind).toBe('ready');

  const childCalls = [];
  childProcess.execFile = (...args) => {
    childCalls.push(args);
    args.at(-1)?.(null, '{"returnValue":true}', '');
  };
  serviceModule.castController.emitIntent({ type: 'play', bvid: 'BV1' });
  expect(childCalls[0][0]).toBe('luna-send-pub');
  expect(subscriberEvents.at(-1).event).toEqual({ kind: 'command', command: { type: 'play', bvid: 'BV1' } });

  const ack = await new Promise((resolve) => handlers.castAck({
    payload: { accepted: true },
    respond: resolve,
  }));
  expect(ack.returnValue).toBe(true);
  expect(serviceModule.castController.getStatus().lastAck.accepted).toBe(true);

  const state = await new Promise((resolve) => handlers.castReportState({
    payload: { playState: 'playing' },
    respond: resolve,
  }));
  expect(state).toEqual({ returnValue: true });
  expect(subscriberEvents.at(-1).event.kind).toBe('state');

  const progress = await new Promise((resolve) => handlers.castReportProgress({
    payload: { duration: 99, position: 12 },
    respond: resolve,
  }));
  expect(progress).toEqual({ returnValue: true });
  expect(serviceModule.castController.getStatus().progress).toBe(12);

  const status = await respondOnce(handlers.castGetStatus);
  expect(status.returnValue).toBe(true);
  expect(status.status.playState).toBe('playing');

  const config = await new Promise((resolve) => handlers.castSetConfig({
    payload: { friendlyName: '卧室电视' },
    respond: resolve,
  }));
  expect(config.config.friendlyName).toBe('卧室电视');
  expect(fs.writeFileSync).toHaveBeenCalled();

  const noSub = await new Promise((resolve) => handlers.castSubscribe({
    payload: {},
    isSubscription: false,
    respond: resolve,
  }));
  expect(noSub.subscribed).toBe(false);
});

test('service runtime local proxy, cast frame bridge, and app launch error paths', async () => {
  let requestPlan = [];
  https.request = function (options, cb) {
    const req = new EventEmitter();
    req.write = mock(() => {});
    req.end = mock(() => {
      const next = requestPlan.shift();
      if (!next) throw new Error('missing request plan');
      next(options, cb, req);
    });
    return req;
  };

  const localServer = serviceModule.localServer;

  let res = createHttpResponse();
  localServer.emit('request', { url: '/x', method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toBe('Not found');

  res = createHttpResponse();
  localServer.emit('request', { url: '/proxy/example.com/x', method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(403);

  res = createHttpResponse();
  localServer.emit('request', { url: '/proxy/api.bilibili.com:bad/x', method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(400);

  requestPlan.push((_options, _cb, req) => {
    queueMicrotask(() => req.emit('error', new Error('boom')));
  });
  res = createHttpResponse();
  localServer.emit('request', { url: '/proxy/api.bilibili.com/x', method: 'GET', headers: {} }, res);
  await Promise.resolve();
  expect(res.statusCode).toBe(502);
  expect(res.body).toBe('boom');

  requestPlan.push((_options, cb) => {
    cb(createProxyRes(200, {
      'content-type': 'video/mp4',
      'content-length': '3',
      'accept-ranges': 'bytes',
      'content-range': 'bytes 0-2/3',
    }, []));
  });
  res = createHttpResponse();
  localServer.emit('request', { url: '/proxy/cn-gotcha204-2.bilivideo.com/video.m4s', method: 'GET', headers: {} }, res);
  await Promise.resolve();
  expect(res.statusCode).toBe(200);
  expect(res.piped).toBe(true);
  expect(res.headers['Accept-Ranges']).toBe('bytes');

  requestPlan.push((_options, cb) => {
    cb(createProxyRes(200, { 'content-type': 'application/vnd.apple.mpegurl' }, ['#EXTM3U\nseg.ts\n']));
  });
  res = createHttpResponse();
  localServer.emit('request', { url: '/proxy/api.live.bilibili.com/live/playlist.m3u8', method: 'GET', headers: {} }, res);
  await Promise.resolve();
  await Promise.resolve();
  expect(res.body).toContain('/proxy/api.live.bilibili.com/live/seg.ts');

  let listenedPort = null;
  const originalListen = localServer.listen.bind(localServer);
  localServer.listen = (port, host) => {
    listenedPort = { port, host };
    return localServer;
  };
  localServer.emit('error', { code: 'EADDRINUSE', message: 'busy' });
  expect(listenedPort.port).toBe(serviceModule.__testing.getLocalProxyPort());
  localServer.listen = originalListen;

  const session = {
    sentReply: null,
    emptied: 0,
    sendReply(payload) {
      this.sentReply = payload;
    },
    sendEmpty() {
      this.emptied += 1;
    },
  };

  serviceModule.castLanServer.onFrame(session, { action: 'GetVolume', type: 'command' });
  expect(session.sentReply).toEqual({ volume: 30 });

  const originalHandleCommand = serviceModule.castController.handleCommand.bind(serviceModule.castController);
  serviceModule.castController.handleCommand = () => null;
  serviceModule.castLanServer.onFrame(session, { action: 'PlayUrl', type: 'command', body: '{}' });
  expect(session.sentReply).toEqual({ accepted: false, reason: 'unsupported-playurl' });

  serviceModule.castController.handleCommand = () => ({ type: 'pause' });
  serviceModule.castLanServer.onFrame(session, { action: 'Pause', type: 'command', body: '{}' });
  expect(session.emptied).toBe(1);

  serviceModule.castLanServer.onFrame(session, { action: 'Pause', type: 'reply', body: '{}' });
  expect(session.emptied).toBe(1);
  serviceModule.castController.handleCommand = originalHandleCommand;

  childProcess.execFile = (...args) => {
    args.at(-1)?.(new Error('launch-fail'));
  };
  serviceModule.__testing.launchAppForCast();
});
