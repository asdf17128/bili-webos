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

test('auth/settings helpers roundtrip values', () => {
  withMockLocalStorage(() => {
    storage.setAuth({ token: 'abc' });
    expect(storage.getAuth()).toEqual({ token: 'abc' });

    storage.setSettings({ danmaku: false, quality: 64 });
    expect(storage.getSettings()).toEqual({ danmaku: false, quality: 64 });

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

test('getSettings returns defaults when missing', () => {
  withMockLocalStorage((map) => {
    map.delete('bili_settings');
    expect(storage.getSettings()).toEqual({ danmaku: true, quality: 80 });
  });
});

test('getSettings tolerates invalid stored payloads', () => {
  withMockLocalStorage((map) => {
    map.set('bili_settings', '{oops');
    expect(storage.getSettings()).toEqual({ danmaku: true, quality: 80 });
  });
});
