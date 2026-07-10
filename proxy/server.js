import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';

// Prevent crash on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[Proxy] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Proxy] Unhandled rejection:', err);
});

const PORT = 9527;
const BILI_HOSTS = [
  'api.bilibili.com',
  'passport.bilibili.com',
  'api.live.bilibili.com',
  's1.hdslb.com',
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'comment.bilibili.com',
  // Video CDN domains
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

// Allow any bilivideo.com or hdslb.com subdomain; bili credentials/disguise
// headers only ever go to these (see isBiliHost below).
function isAllowedHost(host) {
  return isBiliHost(host) || host === 'translate.googleapis.com';
}

function isBiliHost(host) {
  return BILI_HOSTS.some(h => host === h || host.endsWith('.' + h))
    || host.endsWith('.bilivideo.com')
    || host.endsWith('.bilivideo.cn')
    || host.endsWith('.hdslb.com')
    || host.endsWith('.akamaized.net');
}

// Cookie storage - persisted to file so restart doesn't lose login
import { existsSync, readFileSync as readSync, writeFileSync as writeSync } from 'node:fs';
const COOKIE_FILE = new URL('./cookies.json', import.meta.url).pathname;
let storedCookies = {};
try { if (existsSync(COOKIE_FILE)) storedCookies = JSON.parse(readSync(COOKIE_FILE, 'utf-8')); } catch {}
function saveCookies() { try { writeSync(COOKIE_FILE, JSON.stringify(storedCookies)); } catch {} }

function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function serializeCookies(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

const server = http.createServer((req, res) => {
  // CORS headers for TV app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cookie, X-Set-Cookie');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const path = reqUrl.pathname;

  // Health check
  if (path === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', cookies: Object.keys(storedCookies) }));
    return;
  }

  // Cookie management
  if (path === '/cookies') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(storedCookies));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          storedCookies = { ...storedCookies, ...JSON.parse(body) };
          saveCookies();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
      return;
    }
  }

  // Clear cookies (logout)
  if (path === '/cookies/clear') {
    storedCookies = {};
    saveCookies();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Proxy: /proxy/api.bilibili.com/x/web-interface/popular?ps=20
  if (path.startsWith('/proxy/')) {
    const targetPath = path.slice(7); // Remove "/proxy/"
    const slashIdx = targetPath.indexOf('/');
    const hostWithPort = slashIdx > 0 ? targetPath.slice(0, slashIdx) : targetPath;
    const apiPath = slashIdx > 0 ? targetPath.slice(slashIdx) : '/';

    // Parse host and port (e.g., "cdn.bilivideo.cn:8082")
    const [hostname, portStr] = hostWithPort.split(':');
    const port = portStr ? parseInt(portStr) : 443;

    if (!isAllowedHost(hostname)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Host not allowed: ' + hostname }));
      return;
    }

    const query = reqUrl.search || '';
    const fullPath = apiPath + query;

    // Merge cookies from client header and stored cookies
    const clientCookies = parseCookies(req.headers['x-cookie'] || '');
    const allCookies = { ...storedCookies, ...clientCookies };

    // Detect if this is a CDN/video segment request
    const isCDN = hostname.includes('bilivideo') || hostname.includes('akamaized');

    const options = {
      hostname: hostname,
      port: port,
      path: fullPath,
      method: req.method,
      rejectUnauthorized: false, // Some CDN nodes have non-standard certs
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': isCDN ? '*/*' : 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': isCDN ? 'identity' : 'gzip, deflate',
      }
    };

    // Bili credentials + disguise headers go ONLY to the bilibili family —
    // never to third-party hosts (the translator must not see our cookies).
    if (isBiliHost(hostname)) {
      options.headers['Referer'] = 'https://www.bilibili.com/';
      options.headers['Cookie'] = serializeCookies(allCookies);
      // CDN requests should not send Origin (causes 403)
      if (!isCDN) options.headers['Origin'] = 'https://www.bilibili.com';
    }

    // Forward Range header for video segment requests
    if (req.headers['range']) {
      options.headers['Range'] = req.headers['range'];
    }

    // Forward content-type for POST
    if (req.headers['content-type']) {
      options.headers['Content-Type'] = req.headers['content-type'];
    }

    const proxyReq = https.request(options, (proxyRes) => {
      // Capture set-cookie from Bilibili and store them
      const setCookieHeaders = proxyRes.headers['set-cookie'];
      if (setCookieHeaders) {
        const newCookies = {};
        setCookieHeaders.forEach(sc => {
          const parts = sc.split(';')[0];
          const [k, ...v] = parts.split('=');
          if (k) newCookies[k.trim()] = v.join('=').trim();
        });
        storedCookies = { ...storedCookies, ...newCookies };
        saveCookies();
        // Send cookies back to client for storage
        res.setHeader('X-Set-Cookie', JSON.stringify(newCookies));
      }

      // Forward response, decompressing if needed
      const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
      const encoding = proxyRes.headers['content-encoding'];

      const responseHeaders = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Set-Cookie, Content-Range, Content-Length',
      };

      // Forward relevant headers for CDN/video responses
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }
      if (proxyRes.headers['content-length'] && !encoding) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['accept-ranges']) {
        responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
      }

      res.writeHead(proxyRes.statusCode, responseHeaders);

      let stream = proxyRes;
      if (encoding === 'gzip') {
        stream = proxyRes.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        // Bilibili uses raw deflate (not zlib-wrapped), so try inflateRaw first
        // by collecting chunks and decompressing manually
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          const buf = Buffer.concat(chunks);
          // Try zlib inflate first, fall back to raw inflate
          zlib.inflate(buf, (err, result) => {
            if (!err) {
              res.end(result);
            } else {
              zlib.inflateRaw(buf, (err2, result2) => {
                if (!err2) {
                  res.end(result2);
                } else {
                  console.error('Deflate decompress failed:', err2.message);
                  res.end(buf); // Forward raw as fallback
                }
              });
            }
          });
        });
        return; // Don't pipe below
      } else if (encoding === 'br') {
        stream = proxyRes.pipe(zlib.createBrotliDecompress());
      }

      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('Decompress error:', err.message);
        res.end();
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', host, fullPath, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    // Forward POST body
    if (req.method === 'POST') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🚀 Bilibili proxy server running at http://0.0.0.0:${PORT}`);
  console.log(`  TV app should connect to: http://<your-mac-ip>:${PORT}\n`);
  // Show local IP
  import('node:os').then(os => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  Local IP: http://${net.address}:${PORT}`);
        }
      }
    }
    console.log('');
  });
});
