import dgram from 'node:dgram';
import net from 'node:net';
import {
  getSsdpNotifyPackets,
  getSsdpSearchResponse,
  renderAvTransportScpd,
  renderDescriptionXml,
  renderNirvanaScpd,
} from './deviceProfile.js';
import { NvaSession } from './nvaSession.js';

function parseHeaders(raw) {
  const lines = raw.split('\r\n');
  const requestLine = lines.shift() || '';
  const parts = requestLine.split(' ');
  const headers = {};
  lines.forEach((line) => {
    if (!line) return;
    const idx = line.indexOf(':');
    if (idx <= 0) return;
    headers[line.slice(0, idx).trim().toLowerCase()] = line
      .slice(idx + 1)
      .trim();
  });
  return {
    method: parts[0] || '',
    path: parts[1] || '/',
    version: parts[2] || 'HTTP/1.1',
    headers,
  };
}

function httpResponse(statusCode, statusText, headers, body) {
  const lines = [`HTTP/1.1 ${statusCode} ${statusText}`];
  Object.keys(headers || {}).forEach((key) => {
    lines.push(`${key}: ${headers[key]}`);
  });
  lines.push('', body || '');
  return lines.join('\r\n');
}

export class CastLanServer {
  profile: any;
  controller: any;
  onFrame: any;
  tcpPort: number;
  udpServer: dgram.Socket | null;
  tcpServer: net.Server | null;
  broadcastTimer: ReturnType<typeof setInterval> | null;
  nextSessionId: number;

  constructor(options) {
    options = options || {};
    this.profile = options.profile;
    this.controller = options.controller;
    this.onFrame = options.onFrame;
    this.tcpPort = this.profile.httpPort;
    this.udpServer = null;
    this.tcpServer = null;
    this.broadcastTimer = null;
    this.nextSessionId = 1;
  }

  start(callback) {
    this.startUdp();
    this.startTcp(() => {
      this.broadcastAlive();
      this.broadcastTimer = setInterval(() => {
        this.broadcastAlive();
      }, 1000);
      if (callback) callback();
    });
  }

  startUdp() {
    this.udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udpServer.on('message', (msg, rinfo) => {
      const str = msg.toString('utf8');
      if (str.toLowerCase().indexOf('ssdp:discover') < 0) return;
      let st = 'urn:schemas-upnp-org:device:MediaRenderer:1';
      const match = str.match(/\r\nST:\s*(.+)\r\n/i);
      if (match) st = match[1].trim();
      const response = getSsdpSearchResponse(this.profile, st);
      this.udpServer.send(Buffer.from(response), rinfo.port, rinfo.address);
    });
    this.udpServer.on('error', (err) => {
      console.error('[Cast][SSDP] error:', err.message);
    });
    this.udpServer.bind(1900, () => {
      try {
        this.udpServer.addMembership('239.255.255.250');
      } catch {}
      try {
        this.udpServer.setBroadcast(true);
      } catch {}
      try {
        this.udpServer.setMulticastTTL(2);
      } catch {}
    });
  }

  startTcp(callback) {
    this.tcpServer = net.createServer((socket) => {
      this.handleSocket(socket);
    });
    this.tcpServer.on('error', (err: NodeJS.ErrnoException) => {
      console.error('[Cast][TCP] error:', err.message);
      if (err.code === 'EADDRINUSE') {
        this.tcpPort += 1;
        this.profile.httpPort = this.tcpPort;
        this.startTcp(callback);
      }
    });
    this.tcpServer.listen(this.tcpPort, '0.0.0.0', callback);
  }

  handleSocket(socket) {
    let headerBuffer = '';
    let handled = false;

    const onData = (chunk) => {
      if (handled) return;
      headerBuffer += chunk.toString('utf8');
      const idx = headerBuffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      handled = true;

      const raw = headerBuffer.slice(0, idx);
      const request = parseHeaders(raw);
      socket.removeListener('data', onData);
      this.routeRequest(socket, request);
    };

    socket.on('data', onData);
  }

  routeRequest(socket, request) {
    const requestPath = request.path || '/';
    if (request.method === 'SETUP' && requestPath === '/projection') {
      const session = new NvaSession(
        `session-${this.nextSessionId++}`,
        socket,
        this.onFrame,
        this.handleSessionClose.bind(this),
      );
      this.controller.attachSession(session);
      session.startPing();
      socket.write(
        [
          'NVA/1.0 200 OK',
          `Session: ${request.headers.session || session.id}`,
          'NvaVersion: 1',
          'Connection: Keep-Alive',
          `UUID: ${this.profile.uuid}`,
          `User-Agent: ${this.profile.serverName.replace(',', '')}`,
          '',
          '',
        ].join('\r\n'),
      );
      return;
    }

    let body = '';
    let status = 200;
    let statusText = 'OK';
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      Connection: 'close',
    };

    if (request.method === 'GET' && requestPath === '/description.xml') {
      body = renderDescriptionXml(this.profile);
      headers['Content-Type'] = 'text/xml; charset=utf-8';
    } else if (
      request.method === 'GET' &&
      requestPath === '/dlna/AVTransport.xml'
    ) {
      body = renderAvTransportScpd();
      headers['Content-Type'] = 'text/xml; charset=utf-8';
    } else if (
      request.method === 'GET' &&
      requestPath === '/dlna/NirvanaControl.xml'
    ) {
      body = renderNirvanaScpd();
      headers['Content-Type'] = 'text/xml; charset=utf-8';
    } else if (
      request.method === 'POST' &&
      (requestPath === '/AVTransport/action' ||
        requestPath === '/NirvanaControl/action')
    ) {
      body = '';
    } else {
      status = 404;
      statusText = 'Not Found';
      body = 'Not Found';
    }

    headers['Content-Length'] = Buffer.byteLength(body);
    socket.end(httpResponse(status, statusText, headers, body));
  }

  handleSessionClose(session) {
    this.controller.detachSession(session.id);
  }

  broadcastAlive() {
    if (!this.udpServer) return;
    getSsdpNotifyPackets(this.profile).forEach((packet) => {
      this.udpServer.send(Buffer.from(packet), 1900, '239.255.255.250');
    });
  }

  stop() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.udpServer) {
      try {
        this.udpServer.close();
      } catch {}
    }
    if (this.tcpServer) {
      try {
        this.tcpServer.close();
      } catch {}
    }
  }
}
