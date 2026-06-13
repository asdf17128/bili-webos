var dgram = require('dgram');
var net = require('net');

var deviceProfile = require('./deviceProfile');
var nvaSession = require('./nvaSession');

function parseHeaders(raw) {
  var lines = raw.split('\r\n');
  var requestLine = lines.shift() || '';
  var parts = requestLine.split(' ');
  var headers = {};
  lines.forEach(function (line) {
    if (!line) return;
    var idx = line.indexOf(':');
    if (idx <= 0) return;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  });
  return {
    method: parts[0] || '',
    path: parts[1] || '/',
    version: parts[2] || 'HTTP/1.1',
    headers: headers,
  };
}

function httpResponse(statusCode, statusText, headers, body) {
  var lines = ['HTTP/1.1 ' + statusCode + ' ' + statusText];
  Object.keys(headers || {}).forEach(function (key) {
    lines.push(key + ': ' + headers[key]);
  });
  lines.push('', body || '');
  return lines.join('\r\n');
}

function CastLanServer(options) {
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

CastLanServer.prototype.start = function (callback) {
  var self = this;
  self.startUdp();
  self.startTcp(function () {
    self.broadcastAlive();
    // ssdp:alive only needs to refresh well within the advertised max-age (30s).
    // Re-broadcasting every second floods the LAN multicast group for no gain;
    // ~10s keeps the device discoverable without the spam.
    self.broadcastTimer = setInterval(function () {
      self.broadcastAlive();
    }, 10000);
    if (callback) callback();
  });
};

CastLanServer.prototype.startUdp = function () {
  var self = this;
  self.udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  self.udpServer.on('message', function (msg, rinfo) {
    var str = msg.toString('utf8');
    if (str.toLowerCase().indexOf('ssdp:discover') < 0) return;
    var st = 'urn:schemas-upnp-org:device:MediaRenderer:1';
    var match = str.match(/\r\nST:\s*(.+)\r\n/i);
    if (match) st = match[1].trim();
    var response = deviceProfile.getSsdpSearchResponse(self.profile, st);
    self.udpServer.send(Buffer.from(response), rinfo.port, rinfo.address);
  });
  self.udpServer.on('error', function (err) {
    console.error('[Cast][SSDP] error:', err.message);
  });
  self.udpServer.bind(1900, function () {
    try { self.udpServer.addMembership('239.255.255.250'); } catch (e) {}
    try { self.udpServer.setBroadcast(true); } catch (e) {}
    try { self.udpServer.setMulticastTTL(2); } catch (e) {}
  });
};

CastLanServer.prototype.startTcp = function (callback) {
  var self = this;
  self.tcpServer = net.createServer(function (socket) {
    self.handleSocket(socket);
  });
  self.tcpServer.on('error', function (err) {
    console.error('[Cast][TCP] error:', err.message);
    if (err.code === 'EADDRINUSE') {
      self.tcpPort += 1;
      self.profile.httpPort = self.tcpPort;
      self.startTcp(callback);
    }
  });
  self.tcpServer.listen(self.tcpPort, '0.0.0.0', callback);
};

CastLanServer.prototype.handleSocket = function (socket) {
  var self = this;
  var headerBuffer = '';
  var handled = false;
  var MAX_HEADER_BYTES = 64 * 1024;

  // Drop idle/half-open connections so a client that opens a socket and never
  // finishes a request can't pin a session/fd forever.
  socket.setTimeout(30000, function () {
    try { socket.destroy(); } catch (e) {}
  });

  function onData(chunk) {
    if (handled) return;
    headerBuffer += chunk.toString('utf8');
    // Cap pre-header buffering: a malicious/buggy client that never sends the
    // \r\n\r\n terminator must not be able to grow this string unbounded.
    if (headerBuffer.length > MAX_HEADER_BYTES) {
      socket.removeListener('data', onData);
      try { socket.destroy(); } catch (e) {}
      return;
    }
    var idx = headerBuffer.indexOf('\r\n\r\n');
    if (idx < 0) return;
    handled = true;

    var raw = headerBuffer.slice(0, idx);
    var request = parseHeaders(raw);
    socket.removeListener('data', onData);
    self.routeRequest(socket, request);
  }

  socket.on('data', onData);
};

CastLanServer.prototype.routeRequest = function (socket, request) {
  var path = request.path || '/';
  if (request.method === 'SETUP' && path === '/projection') {
    // Hand the socket off to a long-lived NVA session, which keeps it alive
    // with its own 10s ping. Clear the short pre-request idle timeout so the
    // session isn't torn down during a quiet stretch of an active cast.
    try { socket.setTimeout(0); } catch (e) {}
    var session = new nvaSession.NvaSession(
      'session-' + (this.nextSessionId++),
      socket,
      this.onFrame,
      this.handleSessionClose.bind(this)
    );
    this.controller.attachSession(session);
    session.startPing();
    socket.write([
      'NVA/1.0 200 OK',
      'Session: ' + (request.headers.session || session.id),
      'NvaVersion: 1',
      'Connection: Keep-Alive',
      'UUID: ' + this.profile.uuid,
      'User-Agent: ' + this.profile.serverName.replace(',', ''),
      '',
      ''
    ].join('\r\n'));
    return;
  }

  var body = '';
  var status = 200;
  var statusText = 'OK';
  var headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' };

  if (request.method === 'GET' && path === '/description.xml') {
    body = deviceProfile.renderDescriptionXml(this.profile);
    headers['Content-Type'] = 'text/xml; charset=utf-8';
  } else if (request.method === 'GET' && path === '/dlna/AVTransport.xml') {
    body = deviceProfile.renderAvTransportScpd();
    headers['Content-Type'] = 'text/xml; charset=utf-8';
  } else if (request.method === 'GET' && path === '/dlna/NirvanaControl.xml') {
    body = deviceProfile.renderNirvanaScpd();
    headers['Content-Type'] = 'text/xml; charset=utf-8';
  } else if (request.method === 'POST' && (path === '/AVTransport/action' || path === '/NirvanaControl/action')) {
    body = '';
  } else {
    status = 404;
    statusText = 'Not Found';
    body = 'Not Found';
  }

  headers['Content-Length'] = Buffer.byteLength(body);
  socket.end(httpResponse(status, statusText, headers, body));
};

CastLanServer.prototype.handleSessionClose = function (session) {
  this.controller.detachSession(session.id);
};

CastLanServer.prototype.broadcastAlive = function () {
  var self = this;
  if (!self.udpServer) return;
  deviceProfile.getSsdpNotifyPackets(self.profile).forEach(function (packet) {
    self.udpServer.send(Buffer.from(packet), 1900, '239.255.255.250');
  });
};

CastLanServer.prototype.stop = function () {
  if (this.broadcastTimer) clearInterval(this.broadcastTimer);
  if (this.udpServer) {
    try { this.udpServer.close(); } catch (e) {}
  }
  if (this.tcpServer) {
    try { this.tcpServer.close(); } catch (e) {}
  }
};

module.exports = {
  CastLanServer: CastLanServer,
};
