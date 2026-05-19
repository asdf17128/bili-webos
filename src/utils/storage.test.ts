import { test, expect } from 'bun:test';
import { storage } from './storage.ts';

function withMockLocalStorage(fn) {
  const original = globalThis.localStorage;
  const map = new Map();
  const mock = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  globalThis.localStorage = mock;
  try {
    fn(map, mock);
  } finally {
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

    mock.setItem = () => {
      throw new Error('quota');
    };
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

test('resume progress helpers roundtrip entries and enforce cid matching', () => {
  withMockLocalStorage(() => {
    storage.setResumeProgress({
      bvid: 'BV1',
      cid: 7,
      progress: 48,
      duration: 120,
      updatedAt: 111,
    });

    expect(storage.getResumeProgress('BV1', 7)).toEqual({
      bvid: 'BV1',
      cid: 7,
      progress: 48,
      duration: 120,
      updatedAt: 111,
    });
    expect(storage.getResumeProgress('BV1', 8)).toBeNull();

    storage.clearResumeProgress('BV1');
    expect(storage.getResumeProgress('BV1', 7)).toBeNull();
  });
});

test('resume progress helpers normalize values and detect near-end playback', () => {
  withMockLocalStorage(() => {
    storage.setResumeProgress({
      bvid: 'BV2',
      cid: '',
      progress: '15.8',
      duration: '100',
    });

    expect(storage.getResumeProgress('BV2')).toEqual({
      bvid: 'BV2',
      cid: null,
      progress: 15.8,
      duration: 100,
      updatedAt: expect.any(Number),
    });
    expect(storage.shouldClearResumeProgress(98, 100)).toBe(true);
    expect(storage.shouldClearResumeProgress(90, 100)).toBe(false);
    expect(storage.shouldClearResumeProgress(5, 0)).toBe(false);
  });
});
