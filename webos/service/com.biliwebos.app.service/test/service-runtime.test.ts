import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import WebOSService from '../src/webos-service-stub.ts';
import * as serviceModule from '../src/service.ts';

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

let originalHttpsRequest;
let originalWriteFileSync;
let originalExecFile;

beforeEach(() => {
  WebOSService.__instances.length = 0;
  originalHttpsRequest = https.request;
  originalWriteFileSync = fs.writeFileSync;
  originalExecFile = childProcess.execFile;
});

afterEach(() => {
  https.request = originalHttpsRequest;
  fs.writeFileSync = originalWriteFileSync;
  childProcess.execFile = originalExecFile;
});

test('service runtime registers handlers and supports fetch/cast/config flows', async () => {
  const handlers = serviceModule.service.handlers;
  expect(Object.keys(handlers)).toEqual(
    expect.arrayContaining(['fetch', 'getCookies', 'setCookies', 'clearCookies', 'ping']),
  );

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
  fs.writeFileSync = mock(() => {});

  requestPlan.push((_options, cb) => {
    cb(createProxyRes(200, { 'content-type': 'application/json' }, ['{"ok":1}']));
  });
  const jsonFetch = await new Promise((resolve) =>
    handlers.fetch({ payload: { url: 'https://api.bilibili.com/x' }, respond: resolve }),
  );
  expect(jsonFetch.returnValue).toBe(true);

  const ping = await respondOnce(handlers.ping);
  expect(ping.returnValue).toBe(true);
});
