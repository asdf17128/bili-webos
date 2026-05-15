import { test, expect } from 'bun:test';
import { storage } from './storage.js';

function withMockLocalStorage(fn) {
  const original = globalThis.localStorage;
  const map = new Map();
  const mock = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  globalThis.localStorage = mock;
  try { fn(map, mock); } finally {
    if (typeof original === 'undefined') delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

test('storage.remove does not throw when localStorage is unavailable', () => {
  const originalLocalStorage = globalThis.localStorage;
  try {
    delete globalThis.localStorage;
  } catch {}

  expect(() => {
    storage.remove('auth');
  }).not.toThrow();

  if (typeof originalLocalStorage !== 'undefined') {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('auth/settings/proxy helpers roundtrip values', () => {
  withMockLocalStorage(() => {
    storage.setAuth({ token: 'abc' });
    expect(storage.getAuth()).toEqual({ token: 'abc' });

    storage.setSettings({ danmaku: false, quality: 64 });
    expect(storage.getSettings()).toEqual({ danmaku: false, quality: 64 });

    storage.setProxyUrl('http://10.0.0.1:9527');
    expect(storage.getProxyUrl()).toBe('http://10.0.0.1:9527');

    storage.clearAuth();
    expect(storage.getAuth()).toBeNull();
  });
});

test('get returns null for invalid json and set tolerates quota errors', () => {
  withMockLocalStorage((map, mock) => {
    map.set('bili_auth', '{oops');
    expect(storage.get('auth')).toBeNull();

    mock.setItem = () => { throw new Error('quota'); };
    expect(() => storage.set('x', { a: 1 })).not.toThrow();
  });
});

test('getProxyUrl falls back to default in non-browser or localhost environments', () => {
  withMockLocalStorage((map) => {
    map.delete('bili_proxyUrl');

    const originalWindow = globalThis.window;
    try {
      delete globalThis.window;
    } catch {}
    expect(storage.getProxyUrl()).toBe('http://127.0.0.1:9527');

    globalThis.window = { location: { hostname: 'localhost' } };
    expect(storage.getProxyUrl()).toBe('http://127.0.0.1:9527');

    globalThis.window = { location: { hostname: '192.168.10.2' } };
    expect(storage.getProxyUrl()).toBe('http://192.168.10.2:9527');

    if (typeof originalWindow === 'undefined') delete globalThis.window;
    else globalThis.window = originalWindow;
  });
});

test('getSettings returns defaults and getProxyUrl supports env/127 localhost fallback', () => {
  withMockLocalStorage((map) => {
    map.delete('bili_settings');
    map.delete('bili_proxyUrl');

    expect(storage.getSettings()).toEqual({ danmaku: true, quality: 80 });

    const originalWindow = globalThis.window;
    globalThis.window = { location: { hostname: '127.0.0.1' } };
    expect(storage.getProxyUrl()).toBe('http://127.0.0.1:9527');

    globalThis.window = { location: { hostname: '' } };
    expect(storage.getProxyUrl()).toBe('http://127.0.0.1:9527');

    if (typeof originalWindow === 'undefined') delete globalThis.window;
    else globalThis.window = originalWindow;
  });
});
