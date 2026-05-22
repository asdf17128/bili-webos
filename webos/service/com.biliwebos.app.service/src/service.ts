// Bilibili API proxy service for webOS TV
// Runs as background Node.js service, communicates via Luna bus
// Also starts a local HTTP proxy for video segments and images
// Node.js v16.19.1 on webOS TV 24

import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { CastController } from './cast/castController.js';
import { createDeviceProfile } from './cast/deviceProfile.js';
import { rewriteHlsPlaylist } from './cast/hlsPlaylist.js';
import { CastLanServer } from './cast/ssdpServer.js';
import WebOSServiceStub from './webos-service-stub.js';

let WebOSService = WebOSServiceStub;
try {
  const require = createRequire(import.meta.url);
  const serviceNodeModules = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'node_modules',
  );
  const serviceShimModules = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'shims',
  );
  process.env.NODE_PATH = [
    '/usr/lib/nodejs',
    '/usr/lib/iotjs',
    serviceShimModules,
    serviceNodeModules,
    process.env.NODE_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  (Module as any)._initPaths();
  const module = require('webos-service');
  WebOSService = module.default || module;
} catch {}

export const service = new WebOSService('com.biliwebos.app.service');

const COOKIE_FILE = path.join('/media/internal', 'bili_cookies.json');
let storedCookies: Record<string, string> = {};
try {
  if (fs.existsSync(COOKIE_FILE)) {
    storedCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  }
} catch {}

function saveCookies() {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(storedCookies));
  } catch {}
}

const CAST_CONFIG_FILE = path.join('/media/internal', 'bili_cast_config.json');
let castConfig: { friendlyName?: string; uuid?: string; [key: string]: any } =
  {};
try {
  if (fs.existsSync(CAST_CONFIG_FILE)) {
    castConfig = JSON.parse(fs.readFileSync(CAST_CONFIG_FILE, 'utf-8'));
  }
} catch {}

if (castConfig.friendlyName === 'B站 webOS') {
  castConfig.friendlyName = '我的小电视';
}

function saveCastConfig() {
  try {
    fs.writeFileSync(CAST_CONFIG_FILE, JSON.stringify(castConfig));
  } catch {}
}

function serializeCookies(cookies) {
  return Object.keys(cookies)
    .map((k) => `${k}=${cookies[k]}`)
    .join('; ');
}

export { rewriteHlsPlaylist };

export function isAllowedHost(host) {
  const allowed = [
    'api.bilibili.com',
    'passport.bilibili.com',
    'api.live.bilibili.com',
    'archive.biliimg.com',
    's1.hdslb.com',
    'i0.hdslb.com',
    'i1.hdslb.com',
    'i2.hdslb.com',
    'comment.bilibili.com',
  ];
  for (let i = 0; i < allowed.length; i += 1) {
    if (host === allowed[i]) return true;
  }
  return (
    host.indexOf('.bilivideo.') >= 0 ||
    host.indexOf('.hdslb.com') >= 0 ||
    host.indexOf('.akamaized.net') >= 0
  );
}

function makeRequest(parsedUrl, method, body, contentType, range, callback) {
  const hostname = parsedUrl.hostname;
  const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : 443;
  const isCDN =
    hostname.indexOf('bilivideo') >= 0 || hostname.indexOf('akamaized') >= 0;

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://www.bilibili.com/',
    Accept: isCDN ? '*/*' : 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': isCDN ? 'identity' : 'gzip, deflate',
    Cookie: serializeCookies(storedCookies),
  };
  if (!isCDN) headers.Origin = 'https://www.bilibili.com';
  if (contentType) headers['Content-Type'] = contentType;
  if (range) headers.Range = range;

  const options = {
    hostname,
    port,
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    method: method || 'GET',
    headers,
    rejectUnauthorized: false,
  };

  const req = https.request(options, (res) => {
    const setCookieHeaders = res.headers['set-cookie'];
    if (setCookieHeaders) {
      setCookieHeaders.forEach((sc) => {
        const parts = sc.split(';')[0];
        const eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          storedCookies[parts.substring(0, eqIdx).trim()] = parts
            .substring(eqIdx + 1)
            .trim();
        }
      });
      saveCookies();
    }
    callback(null, res);
  });

  req.on('error', (err) => {
    callback(err);
  });
  if (body) req.write(body);
  req.end();
}

function decompressResponse(res, callback) {
  const chunks = [];
  res.on('data', (c) => {
    chunks.push(c);
  });
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    const encoding = res.headers['content-encoding'];
    if (encoding === 'gzip') {
      zlib.gunzip(buf, (err, r) => {
        callback(err ? buf : r);
      });
    } else if (encoding === 'deflate') {
      zlib.inflate(buf, (err, r) => {
        if (!err) {
          callback(r);
          return;
        }
        zlib.inflateRaw(buf, (err2, r2) => {
          callback(err2 ? buf : r2);
        });
      });
    } else {
      callback(buf);
    }
  });
}

function getLanIp() {
  const nets = os.networkInterfaces();
  const names = Object.keys(nets);
  for (let i = 0; i < names.length; i += 1) {
    const rows = nets[names[i]] || [];
    for (let j = 0; j < rows.length; j += 1) {
      const row = rows[j];
      if (row && row.family === 'IPv4' && !row.internal) return row.address;
    }
  }
  return '127.0.0.1';
}

function getCastFriendlyName() {
  return castConfig.friendlyName || '我的小电视';
}

export const castController = new CastController();
let castSubscribers = [];
let pendingCastEvent = null;
const castProfile = createDeviceProfile({
  uuid: castConfig.uuid,
  friendlyName: getCastFriendlyName(),
  ip: getLanIp(),
  httpPort: 9958,
});

castConfig.uuid = castProfile.uuid;
saveCastConfig();

function notifyCastSubscribers(event) {
  pendingCastEvent = event;
  castSubscribers = castSubscribers.filter((message) => {
    try {
      message.respond({
        returnValue: true,
        subscribed: true,
        event,
        status: castController.getStatus(),
      });
      pendingCastEvent = null;
      return true;
    } catch {
      return false;
    }
  });
}

function launchAppForCast() {
  childProcess.execFile(
    'luna-send-pub',
    [
      '-n',
      '1',
      '-f',
      'luna://com.webos.service.applicationmanager/launch',
      '{"id":"com.biliwebos.app"}',
    ],
    (err, stdout, stderr) => {
      if (err) {
        console.error('[Cast] launch app failed:', err.message);
        return;
      }
      if (stderr) console.log('[Cast] launch stderr:', stderr.trim());
      if (stdout) console.log('[Cast] launch:', stdout.trim());
    },
  );
}

castController.onIntent((intent) => {
  launchAppForCast();
  notifyCastSubscribers({ kind: 'command', command: intent });
});

const castLanServer = new CastLanServer({
  profile: castProfile,
  controller: castController,
  onFrame(session, frame) {
    if (frame.action === 'GetVolume') {
      session.sendReply({ volume: 30 });
      return;
    }
    if (frame.type !== 'command') return;

    const intent = castController.handleCommand(
      session.id,
      frame.action,
      frame.body,
    );

    if (intent) {
      session.sendEmpty();
    } else {
      session.sendReply({});
    }
  },
});

const disableNetworkServers =
  process.env.BILI_SERVICE_DISABLE_NETWORK_SERVERS === '1';

if (!disableNetworkServers) {
  castLanServer.start(() => {
    castController.setNetworkInfo(castProfile.ip, castProfile.httpPort);
    console.log(
      `[BiliService] Cast server on ${castProfile.ip}:${castProfile.httpPort}`,
    );
  });
}

let localProxyPort = 7654;

export function createLocalProxyHandler({
  localProxyPort,
  isAllowedHost,
  makeRequest,
  rewriteHlsPlaylist,
  decompressResponse,
}) {
  return (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${localProxyPort}`);
      const pathMatch = url.pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
      if (!pathMatch) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const host = pathMatch[1];
      if (!isAllowedHost(host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      const upstreamPath = (pathMatch[2] || '/') + (url.search || '');
      const parsedUrl = new URL(`https://${host}${upstreamPath}`);
      const range = req.headers.range || '';

      makeRequest(parsedUrl, req.method, '', '', range, (err, proxyRes) => {
        if (err) {
          console.error('[LocalProxy] request failed:', err.message);
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
          return;
        }

        const contentType = String(proxyRes.headers['content-type'] || '');
        const isPlaylist =
          contentType.indexOf('application/vnd.apple.mpegurl') >= 0 ||
          parsedUrl.pathname.endsWith('.m3u8');

        if (!isPlaylist) {
          Object.keys(proxyRes.headers).forEach((key) => {
            const value = proxyRes.headers[key];
            if (value != null) res.setHeader(key, value);
          });
          res.writeHead(proxyRes.statusCode || 200);
          proxyRes.pipe(res);
          return;
        }

        decompressResponse(proxyRes, (bodyBuffer) => {
          try {
            const rewritten = rewriteHlsPlaylist(
              bodyBuffer.toString('utf8'),
              parsedUrl.toString(),
              `http://127.0.0.1:${localProxyPort}`,
            );
            res.writeHead(proxyRes.statusCode || 200, {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Content-Length': Buffer.byteLength(rewritten),
              'Cache-Control': 'no-cache',
            });
            res.end(rewritten);
          } catch (playlistError) {
            console.error(
              '[LocalProxy] playlist rewrite failed:',
              playlistError.message,
            );
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Playlist rewrite failed');
          }
        });
      });
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(error.message);
    }
  };
}

const localProxy = http.createServer(
  createLocalProxyHandler({
    localProxyPort,
    isAllowedHost,
    makeRequest,
    rewriteHlsPlaylist,
    decompressResponse,
  }),
);

if (!disableNetworkServers) {
  localProxy.listen(localProxyPort, '0.0.0.0', () => {
    console.log(`[BiliService] Local proxy on port ${localProxyPort}`);
  });
}

service.register('fetch', (message) => {
  const requestUrl = message.payload.url;
  if (!requestUrl) {
    message.respond({ returnValue: false, error: 'No URL' });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    message.respond({ returnValue: false, error: 'Invalid URL' });
    return;
  }

  if (!isAllowedHost(parsedUrl.hostname)) {
    message.respond({ returnValue: false, error: 'Host not allowed' });
    return;
  }

  makeRequest(
    parsedUrl,
    message.payload.method,
    message.payload.body,
    message.payload.contentType,
    message.payload.range,
    (err, res) => {
      if (err) {
        message.respond({ returnValue: false, error: err.message });
        return;
      }
      decompressResponse(res, (buf) => {
        const response: any = {
          returnValue: true,
          status: res.statusCode,
          headers: res.headers,
          newCookies: storedCookies,
        };

        const contentType = String(res.headers['content-type'] || '');
        const isText =
          contentType.indexOf('json') >= 0 ||
          contentType.indexOf('text') >= 0 ||
          contentType.indexOf('xml') >= 0;

        if (isText) {
          response.body = buf.toString('utf8');
        } else {
          response.bodyBase64 = buf.toString('base64');
        }

        message.respond(response);
      });
    },
  );
});

service.register('getCookies', (message) => {
  message.respond({ returnValue: true, cookies: storedCookies });
});

service.register('setCookies', (message) => {
  storedCookies = { ...storedCookies, ...(message.payload.cookies || {}) };
  saveCookies();
  message.respond({ returnValue: true });
});

service.register('clearCookies', (message) => {
  storedCookies = {};
  saveCookies();
  message.respond({ returnValue: true });
});

service.register('ping', (message) => {
  message.respond({
    returnValue: true,
    localProxyPort,
    cast: castController.getStatus(),
  });
});

service.register('castSubscribe', (message) => {
  if (!message.isSubscription) {
    message.respond({ returnValue: false, error: 'Subscription required' });
    return;
  }
  castSubscribers.push(message);
  message.respond({
    returnValue: true,
    subscribed: true,
    event: pendingCastEvent || { kind: 'ready' },
    status: castController.getStatus(),
  });
});

service.register('castAck', (message) => {
  castController.ack(message.payload);
  message.respond({ returnValue: true });
});

service.register('castReportState', (message) => {
  castController.reportState(message.payload);
  notifyCastSubscribers({ kind: 'state', payload: message.payload });
  message.respond({ returnValue: true });
});

service.register('castReportProgress', (message) => {
  castController.reportProgress(message.payload);
  notifyCastSubscribers({ kind: 'progress', payload: message.payload });
  message.respond({ returnValue: true });
});

service.register('castGetStatus', (message) => {
  message.respond({ returnValue: true, status: castController.getStatus() });
});

service.register('castSetConfig', (message) => {
  castConfig = { ...castConfig, ...(message.payload || {}) };
  if (castConfig.friendlyName === 'B站 webOS') {
    castConfig.friendlyName = '我的小电视';
  }
  saveCastConfig();
  message.respond({ returnValue: true, config: castConfig });
});

export const __testing = {
  getStoredCookies() {
    return storedCookies;
  },
  getLocalProxyPort() {
    return localProxyPort;
  },
  getCastConfig() {
    return castConfig;
  },
  getCastServer() {
    return castLanServer;
  },
  getLocalProxy() {
    return localProxy;
  },
};
