import { test, expect } from 'bun:test';
import { getProxyBase, buildProxyUrl, LOCAL_PROXY_BASE } from './proxy.js';

test('getProxyBase uses current origin in localhost dev', () => {
  expect(getProxyBase({
    env: { DEV: true },
    location: { origin: 'http://localhost:5173', hostname: 'localhost' },
  })).toBe('http://localhost:5173');
});

test('getProxyBase keeps TV local proxy outside localhost dev', () => {
  expect(getProxyBase({
    env: { DEV: false },
    location: { origin: 'http://192.168.1.2:8080', hostname: '192.168.1.2' },
  })).toBe(LOCAL_PROXY_BASE);
});

test('buildProxyUrl rewrites through the active proxy base', () => {
  const rewritten = buildProxyUrl('https://i0.hdslb.com/bfs/archive/a.png?x=1', {
    env: { DEV: true },
    location: { origin: 'http://localhost:5173', hostname: 'localhost' },
  });
  expect(rewritten).toBe('http://localhost:5173/proxy/i0.hdslb.com/bfs/archive/a.png?x=1');
});
