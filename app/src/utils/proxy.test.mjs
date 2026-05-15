import test from 'node:test';
import assert from 'node:assert/strict';
import { getProxyBase, buildProxyUrl, LOCAL_PROXY_BASE, shouldUseExternalProxy } from './proxy.js';

test('shouldUseExternalProxy only depends on VITE_USE_PROXY', () => {
  assert.equal(shouldUseExternalProxy({ VITE_USE_PROXY: 'true' }), true);
  assert.equal(shouldUseExternalProxy({ VITE_USE_PROXY: 'false' }), false);
  assert.equal(shouldUseExternalProxy({}), false);
});

test('getProxyBase returns local proxy when VITE_USE_PROXY not true', () => {
  assert.equal(getProxyBase({ env: { VITE_USE_PROXY: 'false' }, proxyUrl: 'http://localhost:9527' }), LOCAL_PROXY_BASE);
});

test('getProxyBase returns external proxy when VITE_USE_PROXY is true', () => {
  assert.equal(getProxyBase({ env: { VITE_USE_PROXY: 'true' }, proxyUrl: 'http://localhost:9527' }), 'http://localhost:9527');
});

test('buildProxyUrl rewrites target url through selected proxy', () => {
  const rewritten = buildProxyUrl('https://i0.hdslb.com/bfs/archive/a.png?x=1', {
    env: { VITE_USE_PROXY: 'true' },
    proxyUrl: 'http://localhost:9527',
  });
  assert.equal(rewritten, 'http://localhost:9527/proxy/i0.hdslb.com/bfs/archive/a.png?x=1');
});
