const { afterEach, beforeEach, expect, test } = require('bun:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dgram = require('dgram');
const net = require('net');

const serverPath = path.join(__dirname, '..', 'cast', 'ssdpServer.js');

let udpSockets;
let tcpServers;
let intervalFns;
let originalCreateSocket;
let originalCreateServer;
let originalConsoleError;

function createUdpSocket() {
  const handlers = {};
  return {
    handlers,
    sent: [],
    closed: false,
    on(event, handler) {
      handlers[event] = handler;
    },
    bind(port, cb) {
      this.boundPort = port;
      cb();
    },
    addMembership(addr) {
      this.membership = addr;
    },
    setBroadcast(value) {
      this.broadcast = value;
    },
    setMulticastTTL(value) {
      this.ttl = value;
    },
    send(buffer, port, address) {
      this.sent.push({ buffer: buffer.toString(), port, address });
    },
    close() {
      this.closed = true;
    },
  };
}

function createTcpServer() {
  const handlers = {};
  return {
    handlers,
    listenCalls: [],
    closed: false,
    on(event, handler) {
      handlers[event] = handler;
    },
    listen(port, host, cb) {
      this.listenCalls.push({ port, host });
      if (cb) cb();
    },
    close() {
      this.closed = true;
    },
  };
}

function loadServerModule() {
  return require(serverPath);
}

beforeEach(() => {
  udpSockets = [];
  tcpServers = [];
  intervalFns = [];
  originalCreateSocket = dgram.createSocket;
  originalCreateServer = net.createServer;
  originalConsoleError = console.error;
  dgram.createSocket = function () {
    const socket = createUdpSocket();
    udpSockets.push(socket);
    return socket;
  };
  net.createServer = function (handler) {
    const server = createTcpServer();
    server.connectionHandler = handler;
    tcpServers.push(server);
    return server;
  };
  console.error = (...args) => {
    const first = String(args[0] || '');
    if (first.startsWith('[Cast][TCP] error:')) return;
    originalConsoleError(...args);
  };

  global.setInterval = (fn, _delay) => {
    intervalFns.push(fn);
    return { fn };
  };
  global.clearInterval = () => {};
});

afterEach(() => {
  dgram.createSocket = originalCreateSocket;
  net.createServer = originalCreateServer;
  console.error = originalConsoleError;
});

test('CastLanServer handles UDP discovery, TCP startup, alive broadcast, and stop', () => {
  const { CastLanServer } = loadServerModule();
  const profile = {
    httpPort: 9000,
    uuid: 'uuid-1',
    serverName: 'Bili,TV',
    friendlyName: 'TV',
    ip: '192.168.1.2',
  };
  const controller = { attachSession() {}, detachSession() {} };
  const server = new CastLanServer({ profile, controller, onFrame() {} });

  server.start(() => {});
  assert.equal(udpSockets.length, 1);
  assert.equal(tcpServers.length, 1);
  assert.equal(udpSockets[0].membership, '239.255.255.250');
  assert.equal(udpSockets[0].broadcast, true);
  assert.equal(udpSockets[0].ttl, 2);

  const beforeDiscover = udpSockets[0].sent.length;
  udpSockets[0].handlers.message(Buffer.from('M-SEARCH * HTTP/1.1\r\nST: urn:test\r\nMAN: "ssdp:discover"\r\n\r\n'), { port: 1900, address: '10.0.0.8' });
  expect(udpSockets[0].sent[beforeDiscover]).toMatchObject({ port: 1900, address: '10.0.0.8' });
  expect(udpSockets[0].sent[beforeDiscover].buffer).toContain('HTTP/1.1 200 OK');

  udpSockets[0].handlers.message(Buffer.from('NOTIFY * HTTP/1.1\r\n\r\n'), { port: 1, address: 'x' });
  assert.equal(udpSockets[0].sent.length >= 1, true);

  intervalFns[0]();
  expect(udpSockets[0].sent.some((entry) => entry.address === '239.255.255.250')).toBe(true);

  server.stop();
  assert.equal(udpSockets[0].closed, true);
  assert.equal(tcpServers[0].closed, true);
});

test('CastLanServer retries TCP port on EADDRINUSE and routes HTTP requests', () => {
  const { CastLanServer } = loadServerModule();
  const attached = [];
  const detached = [];
  const server = new CastLanServer({
    profile: { httpPort: 9100, uuid: 'uuid-2', serverName: 'TV,Name', friendlyName: 'TV', ip: '127.0.0.1' },
    controller: {
      attachSession(session) {
        attached.push(session);
      },
      detachSession(id) {
        detached.push(id);
      },
    },
    onFrame() {},
  });

  server.startTcp(() => {});
  tcpServers[0].handlers.error({ code: 'EADDRINUSE', message: 'busy' });
  assert.equal(server.tcpPort, 9101);
  assert.equal(tcpServers[1].listenCalls[0].port, 9101);

  const ended = [];
  function makeSocket() {
    return {
      writes: [],
      ended: [],
      removed: [],
      handlers: {},
      on(event, handler) {
        this.handlers[event] = handler;
      },
      removeListener(event) {
        this.removed.push(event);
      },
      write(chunk) {
        this.writes.push(String(chunk));
      },
      end(chunk) {
        this.ended.push(String(chunk));
      },
      destroy() {},
    };
  }

  const descriptionSocket = makeSocket();
  server.routeRequest(descriptionSocket, { method: 'GET', path: '/description.xml', headers: {} });
  expect(descriptionSocket.ended[0]).toContain('<friendlyName>');

  const avSocket = makeSocket();
  server.routeRequest(avSocket, { method: 'GET', path: '/dlna/AVTransport.xml', headers: {} });
  expect(avSocket.ended[0]).toContain('Play');

  const nvaSocket = makeSocket();
  server.routeRequest(nvaSocket, { method: 'GET', path: '/dlna/NirvanaControl.xml', headers: {} });
  expect(nvaSocket.ended[0]).toContain('GetAppInfo');

  const postSocket = makeSocket();
  server.routeRequest(postSocket, { method: 'POST', path: '/AVTransport/action', headers: {} });
  expect(postSocket.ended[0]).toContain('200 OK');

  const missingSocket = makeSocket();
  server.routeRequest(missingSocket, { method: 'GET', path: '/missing', headers: {} });
  expect(missingSocket.ended[0]).toContain('404 Not Found');

  const setupSocket = makeSocket();
  server.routeRequest(setupSocket, { method: 'SETUP', path: '/projection', headers: { session: 'abc' } });
  expect(setupSocket.writes[0]).toContain('NVA/1.0 200 OK');
  assert.equal(attached.length, 1);
  attached[0].close();
  expect(detached).toEqual([attached[0].id]);
  ended.push(true);
  assert.equal(ended.length, 1);
});

test('CastLanServer parses socket headers before routing requests', () => {
  const { CastLanServer } = loadServerModule();
  const server = new CastLanServer({
    profile: { httpPort: 9200, uuid: 'uuid-3', serverName: 'TV', friendlyName: 'TV', ip: '127.0.0.1' },
    controller: { attachSession() {}, detachSession() {} },
    onFrame() {},
  });

  const routed = [];
  server.routeRequest = function (_socket, request) {
    routed.push(request);
  };

  const socket = {
    handlers: {},
    removed: [],
    on(event, handler) {
      this.handlers[event] = handler;
    },
    removeListener(event) {
      this.removed.push(event);
    },
  };

  server.handleSocket(socket);
  socket.handlers.data(Buffer.from('GET /description.xml HTTP/1.1\r\nHost: localhost\r\nX-Test: 1\r\n\r\n'));
  expect(routed[0]).toMatchObject({
    method: 'GET',
    path: '/description.xml',
    version: 'HTTP/1.1',
    headers: { host: 'localhost', 'x-test': '1' },
  });
  expect(socket.removed).toContain('data');
});
