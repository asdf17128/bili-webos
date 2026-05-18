import { afterEach, beforeEach, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { CastLanServer } from '../src/cast/ssdpServer.ts';

let udpSockets;
let tcpServers;
let intervalFns;
let originalCreateSocket;
let originalCreateServer;

function createUdpSocket() {
  const handlers = {};
  return {
    handlers,
    sent: [],
    on(event, handler) {
      handlers[event] = handler;
    },
    bind(_port, cb) {
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
    close() {},
  };
}

function createTcpServer() {
  const handlers = {};
  return {
    handlers,
    listenCalls: [],
    on(event, handler) {
      handlers[event] = handler;
    },
    listen(port, host, cb) {
      this.listenCalls.push({ port, host });
      if (cb) cb();
    },
    close() {},
  };
}

beforeEach(() => {
  udpSockets = [];
  tcpServers = [];
  intervalFns = [];
  originalCreateSocket = dgram.createSocket;
  originalCreateServer = net.createServer;
  dgram.createSocket = function () {
    const socket = createUdpSocket();
    udpSockets.push(socket);
    return socket;
  };
  net.createServer = function () {
    const server = createTcpServer();
    tcpServers.push(server);
    return server;
  };
  global.setInterval = (fn) => {
    intervalFns.push(fn);
    return { fn };
  };
  global.clearInterval = () => {};
});

afterEach(() => {
  dgram.createSocket = originalCreateSocket;
  net.createServer = originalCreateServer;
});

test('CastLanServer handles UDP discovery, TCP startup, alive broadcast, and stop', () => {
  const server = new CastLanServer({
    profile: {
      httpPort: 9000,
      uuid: 'uuid-1',
      serverName: 'Bili,TV',
      friendlyName: 'TV',
      ip: '192.168.1.2',
    },
    controller: { attachSession() {}, detachSession() {} },
    onFrame() {},
  });
  server.start(() => {});
  assert.equal(udpSockets[0].membership, '239.255.255.250');
  intervalFns[0]();
  expect(udpSockets[0].sent.some((entry) => entry.address === '239.255.255.250')).toBe(true);
});
