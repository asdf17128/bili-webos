const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'service.js'), 'utf8');

function extractFunction(name) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n}`);
  const m = source.match(re);
  if (!m) throw new Error(`missing function ${name}`);
  return m[0];
}

const getLanIp = new Function('os', `${extractFunction('getLanIp')}; return getLanIp;`);
const getCastFriendlyName = new Function('castConfig', `${extractFunction('getCastFriendlyName')}; return getCastFriendlyName;`);

describe('service core utils', () => {
  it('getLanIp picks first non-internal IPv4', () => {
    const fn = getLanIp({
      networkInterfaces: () => ({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }],
      }),
    });
    expect(fn()).toBe('192.168.1.9');
  });

  it('getLanIp falls back to localhost', () => {
    const fn = getLanIp({ networkInterfaces: () => ({ lo: [{ family: 'IPv6', internal: true }] }) });
    expect(fn()).toBe('127.0.0.1');
  });

  it('getCastFriendlyName returns configured name or default', () => {
    expect(getCastFriendlyName({ friendlyName: '客厅电视' })()).toBe('客厅电视');
    expect(getCastFriendlyName({})()).toBe('我的小电视');
  });
});
