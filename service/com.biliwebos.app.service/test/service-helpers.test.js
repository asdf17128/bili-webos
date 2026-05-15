const { describe, it, expect } = require('bun:test');
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

describe('service helpers', () => {
  it('serializeCookies formats cookie object', () => {
    expect(serializeCookies({ SESSDATA: 'a', bili_jct: 'b' })).toBe('SESSDATA=a; bili_jct=b');
  });

  it('isAllowedHost permits whitelisted and bilivideo domains', () => {
    expect(isAllowedHost('api.bilibili.com')).toBe(true);
    expect(isAllowedHost('cn-gotcha204-2.bilivideo.com')).toBe(true);
    expect(isAllowedHost('example.com')).toBe(false);
  });

  it('decompressResponse handles plain and gzip payloads', async () => {
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
  });
});
