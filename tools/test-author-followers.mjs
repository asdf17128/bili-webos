// Actual React + production hook/store, with a mock API boundary. No server,
// account, TV, storage or external request is used, including the positive control.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
async function bundle(mutant = false) {
  const result = await build({
    stdin: { resolveDir: new URL('../app/', import.meta.url).pathname, contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { useAuthorFollowers } from './src/hooks/useAuthorFollowers.js';
      const root = createRoot(document.getElementById('root'));
      window.__calls = []; window.__renders = [];
      window.__requestFollowers = (path, params) => new Promise((resolve, reject) => {
        window.__calls.push({ path, params, resolve, reject, settled: false });
      });
      window.__settle = (mid, response, fail = false) => {
        const call = window.__calls.find(c => c.params.vmid === String(mid) && !c.settled);
        if (!call) throw new Error('No pending mock for author ' + mid);
        call.settled = true;
        if (fail) call.reject(new Error('mock transport failed')); else call.resolve(response);
      };
      function Harness({ mid, enabled = true, videoKey = null }) {
        const count = useAuthorFollowers(mid, enabled, videoKey);
        window.__renders.push({ mid, enabled, videoKey, count });
        return React.createElement('output', {}, count == null ? 'unknown' : String(count));
      }
      window.__render = props => flushSync(() => root.render(React.createElement(Harness, props)));
      window.__unmount = () => flushSync(() => root.unmount());
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2016',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-follower-api', setup(api) {
      api.onResolve({ filter: /^\.\.\/api\/client$/ }, () => ({ path: 'client-fixture', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
        'export const apiFetch = (path, params) => window.__requestFollowers(path, params);' }));
      if (mutant) api.onLoad({ filter: /useAuthorFollowers\.js$/ }, async args => {
        const source = await readFile(args.path, 'utf8');
        const gate = 'return state.mid === author && state.videoKey === videoKey ? state.count : null;';
        assert.ok(source.includes(gate), 'positive-control mutation must target the real render guard');
        return { contents: source.replace(gate, 'return state.count;') };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

const browser = await chromium.launch({ headless: true });
const reports = [];
async function fixture(source) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const network = [], errors = [];
  await context.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  await context.routeWebSocket('**/*', socket => { network.push(socket.url()); socket.close(); });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: source });
  return {
    page,
    render: props => page.evaluate(props => window.__render(props), props),
    settle: (mid, count) => page.evaluate(({ mid, count }) => window.__settle(mid, { code: 0, data: { follower: count } }), { mid, count }),
    wait: value => page.waitForFunction(value => document.querySelector('output')?.textContent === String(value), value),
    async close() { assert.deepEqual(network, []); assert.deepEqual(errors, []); await context.close(); },
  };
}

try {
  const source = await bundle();
  const f = await fixture(source);
  try {
    await f.render({ mid: 1, enabled: false, videoKey: 'video-a' });
    await f.wait('unknown');
    assert.equal(await f.page.evaluate(() => window.__calls.length), 0);
    await f.render({ mid: 1, videoKey: 'video-a' });
    await f.settle(1, 0);
    await f.wait(0);
    reports.push('zero displayed; disabled hook did not request');
    const beforeHide = await f.page.evaluate(() => window.__renders.length);
    await f.render({ mid: 1, enabled: false, videoKey: 'video-a' });
    await f.wait(0);
    await f.render({ mid: 1, videoKey: 'video-a' });
    await f.wait(0);
    assert.equal(await f.page.evaluate(start => window.__renders.slice(start).some(r => r.count !== 0), beforeHide), false);
    assert.equal(await f.page.evaluate(() => window.__calls.length), 1);
    reports.push('resolved zero count survives hide/reopen without a blank render or refetch');


    await f.render({ mid: 2, videoKey: 'video-b' });
    await f.wait('unknown');
    assert.equal(await f.page.evaluate(() => window.__renders.some(r => r.mid === 2 && r.count != null)), false);
    await f.settle(2, 222);
    await f.wait(222);
    reports.push('author change hides old count on its first render');

    await f.render({ mid: 3, videoKey: 'video-c' });
    await f.render({ mid: 4, videoKey: 'video-d' });
    await f.settle(4, 444);
    await f.wait(444);
    await f.settle(3, 333);
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await f.wait(444);
    assert.equal(await f.page.evaluate(() => window.__renders.some(r => r.mid === 4 && r.count === 333)), false);
    reports.push('late previous-author response cannot replace current result');

    await f.render({ mid: 4, videoKey: 'video-e' });
    const switched = await f.page.evaluate(() => window.__renders.filter(r => r.videoKey === 'video-e'));
    assert.equal(switched[0].count, null);
    await f.wait(444);
    assert.equal(await f.page.evaluate(() => window.__calls.filter(c => c.params.vmid === '4').length), 1);
    reports.push('same author in a new video gets a clean first render and reuses the cache');

    await f.render({ mid: 5, videoKey: 'video-f' });
    await f.render({ mid: 5, enabled: false, videoKey: 'video-f' });
    await f.settle(5, 555);
    await f.wait('unknown');
    await f.render({ mid: 5, videoKey: 'video-f' });
    await f.wait(555);
    assert.equal(await f.page.evaluate(() => window.__calls.filter(c => c.params.vmid === '5').length), 1);
    reports.push('closing during a request blocks UI delivery while preserving shared count cache');

    for (const [mid, mode] of [[6, 'missing'], [7, 'rejected'], [8, 'transport']]) {
      await f.render({ mid, videoKey: 'failure-' + mid });
      await f.page.evaluate(({ mid, mode }) => window.__settle(mid,
        mode === 'missing' ? { code: 0, data: {} } : { code: -412, data: { follower: 5 } }, mode === 'transport'), { mid, mode });
      await f.wait('unknown');
    }
    await f.render({ mid: 'author-name', videoKey: 'invalid' });
    await f.wait('unknown');
    assert.equal(await f.page.evaluate(() => window.__calls.length), 8);
    assert.equal(await f.page.evaluate(() => window.__calls.every(c => c.path === '/x/relation/stat' &&
      Object.keys(c.params).join(',') === 'vmid')), true);
    reports.push('unknown, rejected, network-failed and invalid author counts stay hidden');

    await f.render({ mid: 9, videoKey: 'unmount' });
    await f.page.evaluate(() => window.__unmount());
    const renders = await f.page.evaluate(() => window.__renders.length);
    await f.settle(9, 999);
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await f.page.evaluate(() => window.__renders.length), renders);
    reports.push('unmount ignores late completion');
  } finally { await f.close(); }

  const bad = await fixture(await bundle(true));
  try {
    await bad.render({ mid: 1, videoKey: 'old' });
    await bad.settle(1, 111);
    await bad.wait(111);
    await bad.render({ mid: 2, videoKey: 'new' });
    assert.equal(await bad.page.evaluate(() => window.__renders.some(r => r.mid === 2 && r.count === 111)), true,
      'same observer must catch the stale first render with the production guard removed');
    reports.push('positive control caught stale first render after in-memory guard removal');
  } finally { await bad.close(); }
  console.log(JSON.stringify({ status: 'passed', checks: reports.length, reports,
    externalRequests: 0, realAccounts: false, tvAccess: false }, null, 2));
} finally { await browser.close(); }
