const { describe, it, expect, mock } = require('bun:test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { EventEmitter } = require('events');

const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'service.js'), 'utf8');

function extractFunction(name) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n}`);
  const m = serviceSource.match(re);
  if (!m) throw new Error(`missing function ${name}`);
  return m[0];
}

const serializeCookies = new Function(`${extractFunction('serializeCookies')}; return serializeCookies;`)();
const isAllowedHost = new Function(`${extractFunction('isAllowedHost')}; return isAllowedHost;`)();
const decompressResponse = new Function('zlib', `${extractFunction('decompressResponse')}; return decompressResponse;`)(zlib);
const getLanIp = new Function('os', `${extractFunction('getLanIp')}; return getLanIp;`)({
  networkInterfaces: () => ({
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.0.8' }],
  }),
});
const getCastFriendlyName = new Function('castConfig', `${extractFunction('getCastFriendlyName')}; return getCastFriendlyName;`)({ friendlyName: '客厅电视' });

const makeRequest = new Function(
  'https', 'serializeCookies', 'storedCookies', 'saveCookies',
  `${extractFunction('makeRequest')}; return makeRequest;`
);

describe('service helpers', () => {
  it('serializeCookies formats cookie object', () => {
    expect(serializeCookies({ SESSDATA: 'a', bili_jct: 'b' })).toBe('SESSDATA=a; bili_jct=b');
  });

  it('isAllowedHost permits whitelisted and bilivideo domains', () => {
    expect(isAllowedHost('api.bilibili.com')).toBe(true);
    expect(isAllowedHost('cn-gotcha204-2.bilivideo.com')).toBe(true);
    expect(isAllowedHost('example.com')).toBe(false);
  });

  it('decompressResponse handles plain/gzip/deflate payloads', async () => {
    const plain = new EventEmitter();
    plain.headers = {};
    const plainPromise = new Promise((resolve) => decompressResponse(plain, resolve));
    plain.emit('data', Buffer.from('hello'));
    plain.emit('end');
    expect((await plainPromise).toString()).toBe('hello');

    const gz = new EventEmitter();
    gz.headers = { 'content-encoding': 'gzip' };
    const gzPromise = new Promise((resolve) => decompressResponse(gz, resolve));
    gz.emit('data', zlib.gzipSync(Buffer.from('world')));
    gz.emit('end');
    expect((await gzPromise).toString()).toBe('world');

    const def = new EventEmitter();
    def.headers = { 'content-encoding': 'deflate' };
    const defPromise = new Promise((resolve) => decompressResponse(def, resolve));
    def.emit('data', zlib.deflateSync(Buffer.from('ok')));
    def.emit('end');
    expect((await defPromise).toString()).toBe('ok');
  });

  it('getLanIp and getCastFriendlyName return expected values', () => {
    expect(getLanIp()).toBe('192.168.0.8');
    expect(getCastFriendlyName()).toBe('客厅电视');
  });

  it('makeRequest writes body, parses set-cookie, and reports errors', async () => {
    const storedCookies = { SESSDATA: 'x' };
    let saved = 0;
    let capturedOptions = null;
    const req = new EventEmitter();
    req.write = mock(() => {});
    req.end = mock(() => {});

    const fakeHttps = {
      request: (options, cb) => {
        capturedOptions = options;
        queueMicrotask(() => {
          cb({ headers: { 'set-cookie': ['bili_jct=token; Path=/'] } });
        });
        return req;
      }
    };

    const runRequest = makeRequest(fakeHttps, serializeCookies, storedCookies, () => { saved += 1; });

    await new Promise((resolve) => {
      runRequest(new URL('https://api.bilibili.com/x?a=1'), 'POST', 'hello', 'application/json', 'bytes=0-10', (err) => {
        expect(err).toBeNull();
        resolve();
      });
    });

    expect(capturedOptions.method).toBe('POST');
    expect(capturedOptions.headers.Range).toBe('bytes=0-10');
    expect(capturedOptions.headers.Cookie).toContain('SESSDATA=x');
    expect(storedCookies.bili_jct).toBe('token');
    expect(saved).toBe(1);
    expect(req.write).toHaveBeenCalled();

    await new Promise((resolve) => {
      const badReq = new EventEmitter();
      badReq.write = () => {};
      badReq.end = () => queueMicrotask(() => badReq.emit('error', new Error('boom')));
      const badHttps = { request: () => badReq };
      makeRequest(badHttps, serializeCookies, storedCookies, () => {})
        (new URL('https://api.bilibili.com/x'), 'GET', '', '', '', (err) => {
          expect(err.message).toBe('boom');
          resolve();
        });
    });
  });
});
