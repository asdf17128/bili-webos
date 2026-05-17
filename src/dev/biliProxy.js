import httpProxy from 'http-proxy';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rewriteHlsPlaylist } = require('../../webos/service/com.biliwebos.app.service/cast/hlsPlaylist.js');

const ALLOWED_HOSTS = [
  'api.bilibili.com',
  'passport.bilibili.com',
  'api.live.bilibili.com',
  's1.hdslb.com',
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'comment.bilibili.com',
  'upos-sz-static.bilivideo.com',
  'upos-sz-mirror.bilivideo.com',
  'upos-sz-mirrorcos.bilivideo.com',
  'upos-sz-mirrorhw.bilivideo.com',
  'upos-sz-mirrorali.bilivideo.com',
  'upos-sz-mirroraliov.bilivideo.com',
  'upos-hz-mirrorakam.akamaized.net',
  'cn-hk-eq-bcache-01.bilivideo.com',
  'xy220x145x.mcdn.bilivideo.com',
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const storedCookies = {};

function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  String(cookieStr).split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  });
  return cookies;
}

function serializeCookies(cookies) {
  return Object.entries(cookies)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookieBridge(setCookieHeaders = []) {
  const merged = {};
  for (const entry of setCookieHeaders) {
    const parts = String(entry).split(';')[0];
    const [key, ...rest] = parts.split('=');
    if (key) merged[key.trim()] = rest.join('=').trim();
  }
  Object.assign(storedCookies, merged);
  return merged;
}

function buildProxyBase(req) {
  const host = req.headers.host || 'localhost:5173';
  return `http://${host}`;
}

function copyResponseHeaders(proxyRes, res, extras = {}) {
  const forwarded = { ...proxyRes.headers, ...extras };
  delete forwarded['set-cookie'];
  if (extras['Content-Length'] == null) {
    delete forwarded['content-length'];
    delete forwarded['Content-Length'];
  }
  Object.entries(forwarded).forEach(([key, value]) => {
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  });
}

function decompressBuffer(buffer, encoding) {
  return new Promise((resolve, reject) => {
    if (!encoding || encoding === 'identity') {
      resolve(buffer);
      return;
    }
    if (encoding === 'gzip') {
      zlib.gunzip(buffer, (err, result) => (err ? reject(err) : resolve(result)));
      return;
    }
    if (encoding === 'br') {
      zlib.brotliDecompress(buffer, (err, result) => (err ? reject(err) : resolve(result)));
      return;
    }
    if (encoding === 'deflate') {
      zlib.inflate(buffer, (err, result) => {
        if (!err) {
          resolve(result);
          return;
        }
        zlib.inflateRaw(buffer, (rawErr, rawResult) => (rawErr ? reject(rawErr) : resolve(rawResult)));
      });
      return;
    }
    resolve(buffer);
  });
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function isAllowedHost(host) {
  return ALLOWED_HOSTS.some((item) => host === item || host.endsWith('.' + item))
    || host.endsWith('.bilivideo.com')
    || host.endsWith('.bilivideo.cn')
    || host.endsWith('.hdslb.com')
    || host.endsWith('.akamaized.net');
}

export function extractProxyTarget(url) {
  const reqUrl = new URL(url, 'http://localhost:5173');
  const targetPath = reqUrl.pathname.slice('/proxy/'.length);
  const slashIdx = targetPath.indexOf('/');
  const host = slashIdx >= 0 ? targetPath.slice(0, slashIdx) : targetPath;
  const pathname = slashIdx >= 0 ? targetPath.slice(slashIdx) : '/';
  const [hostname, portRaw] = host.split(':');
  return {
    host,
    hostname,
    port: portRaw ? parseInt(portRaw, 10) : 443,
    upstreamPath: pathname + reqUrl.search,
  };
}

export function toCookieBridge(setCookieHeaders = []) {
  return JSON.stringify(mergeCookieBridge(setCookieHeaders));
}

export function isHlsPlaylistResponse(contentType = '', upstreamPath = '') {
  return contentType.includes('mpegurl') || upstreamPath.endsWith('.m3u8');
}

export function createBiliDevProxyPlugin() {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
  });

  proxy.on('proxyReq', (proxyReq, req) => {
    const { hostname } = req.__biliProxyTarget || {};
    const isCdn = hostname?.includes('bilivideo') || hostname?.includes('akamaized');
    proxyReq.setHeader('User-Agent', USER_AGENT);
    proxyReq.setHeader('Referer', 'https://www.bilibili.com/');
    proxyReq.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    proxyReq.setHeader('Accept', isCdn ? '*/*' : 'application/json, text/plain, */*');
    proxyReq.setHeader('Accept-Encoding', isCdn ? 'identity' : 'gzip, deflate, br');

    if (!isCdn) {
      proxyReq.setHeader('Origin', 'https://www.bilibili.com');
    } else {
      proxyReq.removeHeader('Origin');
    }

    if (req.headers.range) {
      proxyReq.setHeader('Range', req.headers.range);
    }

    const clientCookies = parseCookies(req.headers['x-cookie']);
    const cookieHeader = serializeCookies({ ...storedCookies, ...clientCookies });
    if (cookieHeader) {
      proxyReq.setHeader('Cookie', cookieHeader);
    }
  });

  proxy.on('proxyRes', async (proxyRes, req, res) => {
    const target = req.__biliProxyTarget;
    const contentType = String(proxyRes.headers['content-type'] || 'application/octet-stream');
    const encoding = proxyRes.headers['content-encoding'];
    const bridge = toCookieBridge(proxyRes.headers['set-cookie'] || []);
    const extraHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Set-Cookie, Content-Range, Content-Length',
      Pragma: 'no-cache',
      Expires: '0',
    };
    if (bridge !== '{}') {
      extraHeaders['X-Set-Cookie'] = bridge;
    }

    try {
      if (isHlsPlaylistResponse(contentType, target?.upstreamPath || '')) {
        const body = await readStream(proxyRes);
        const decoded = await decompressBuffer(body, encoding);
        const playlist = rewriteHlsPlaylist(
          decoded.toString('utf-8'),
          `https://${target.host}${target.upstreamPath}`,
          buildProxyBase(req),
        );
        copyResponseHeaders(proxyRes, res, {
          ...extraHeaders,
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(playlist),
        });
        res.writeHead(proxyRes.statusCode || 200);
        res.end(playlist);
        return;
      }

      copyResponseHeaders(proxyRes, res, extraHeaders);
      res.writeHead(proxyRes.statusCode || 200);
      proxyRes.pipe(res);
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  proxy.on('error', (error, _req, res) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: error.message }));
  });

  return {
    name: 'bili-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.originalUrl || req.url || '';

        if (requestUrl === '/ping') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', cookies: Object.keys(storedCookies) }));
          return;
        }

        if (!requestUrl.startsWith('/proxy/')) {
          next();
          return;
        }

        const target = extractProxyTarget(requestUrl);
        if (!isAllowedHost(target.hostname)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Host not allowed: ' + target.hostname }));
          return;
        }

        req.__biliProxyTarget = target;
        req.url = target.upstreamPath;
        proxy.web(req, res, {
          target: `https://${target.host}`,
        });
      });
    },
  };
}
