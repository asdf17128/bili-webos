import test from 'node:test';
import assert from 'node:assert/strict';

import { storage } from './storage.js';

test('storage.remove does not throw when localStorage is unavailable', () => {
  const originalLocalStorage = globalThis.localStorage;
  try {
    delete globalThis.localStorage;
  } catch {}

  assert.doesNotThrow(() => {
    storage.remove('auth');
  });

  if (typeof originalLocalStorage !== 'undefined') {
    globalThis.localStorage = originalLocalStorage;
  }
});
