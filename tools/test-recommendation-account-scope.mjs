// Actual HomePage, storage and local preference stores; only React's scheduler,
// surrounding UI and API boundaries are fixtures. No server or browser starts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
const mocks = {
  react: `
    const h = globalThis.fixtureHooks;
    export const useState = h.useState, useRef = h.useRef, useMemo = h.useMemo;
    export const useCallback = h.useCallback, useEffect = h.useEffect, useLayoutEffect = h.useEffect;
    export default { createElement() { return null; } };
  `,
  '../api/client': `
    export const getRecommend = (...args) => globalThis.fixtureApi.recommend(...args);
    const forbidden = () => { throw new Error('Unexpected API boundary'); };
    export const getPopular = forbidden, getRanking = forbidden, getFollowFeed = forbidden, getLiveList = forbidden;
  `,
  '../components/VideoGrid': 'export default function VideoGrid() {}',
  '../components/PageState': 'export default function PageState() {}; export function GridSkeleton() {}; export function FocusButton() {}',
  '../hooks/useFocus': `
    export const onFocusChange = () => () => {}, isHoverDriven = () => false, getCurrentFocusId = () => null;
    export function focusSidebar() {} export function resetContentMemory() {}
    export function focusFirstContent() {} export function setFocus() {}
  `,
  '../utils/follow': 'export const loadFollowedMids = async () => new Set();',
  '../i18n': 'export const t = text => text;',
  '../utils/perf': 'export function markAfterPaint() {}',
  '../utils/perfFlags': 'export const perfFlag = () => false, canPrefetch = () => false, trackPrefetch = value => value;',
  '../components/ContinueWatching': 'export default function ContinueWatching() {}; export const useContinueWatching = () => [];',
};
const result = await build({
  stdin: {
    contents: `
      export { default as HomePage } from './src/pages/HomePage.jsx';
      export { storage } from './src/utils/storage.js';
      export * from './src/utils/hiddenRecommendations.js';
      export * from './src/utils/hiddenRecommendationAuthors.js';
    `,
    resolveDir: new URL('../app/', import.meta.url).pathname,
  },
  bundle: true, write: false, format: 'iife', globalName: 'scopeHarness', platform: 'browser', target: 'es2018',
  plugins: [{ name: 'isolated-home-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'fixture' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }],
});
const bundle = result.outputFiles[0].text;
const MAX_TURNS = 20;
const clone = value => JSON.parse(JSON.stringify(value));
const fixtureSession = 'account-scope-session-fixture';
const initialDevice = { buvid3: 'scope-device-three-fixture', buvid4: 'scope-device-four-fixture', b_nut: '1700000000' };

function fixture({ uid, cookieReply = 'none' } = {}) {
  const auth = { SESSDATA: fixtureSession, ...initialDevice, ...(uid == null ? {} : { DedeUserID: uid }) };
  const values = new Map([['bili_auth', JSON.stringify(auth)]]);
  const slots = [], pendingEffects = [], listeners = new Map();
  let dirty = true, cursor = 0, requests = 0, renders = 0, disposed = false;
  const changed = (previous, next) => !previous || !next || previous.length !== next.length
    || previous.some((value, index) => !Object.is(value, next[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        if (disposed) return;
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: value };
      return slots[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  let api;
  const sandbox = {
    fixtureHooks: hooks,
    fixtureApi: { async recommend() {
      requests++;
      // Match client.lunaFetch's ordinary response behavior: the service returns
      // its entire cookie jar, which is merged through the actual setAuth.
      await Promise.resolve();
      if (cookieReply !== 'none') {
        const next = { ...api.storage.getAuth() };
        if (cookieReply === 'device') next.b_nut = String(1700000000 + requests);
        api.storage.setAuth(next);
      }
      return { code: 0, data: { item: [{ bvid: 'BV1234567890', owner: { mid: 456 } }] } };
    } },
    console, performance: { now: () => 0 },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
    setTimeout() { throw new Error('Unexpected timer: fixture disables prefetch'); },
    clearTimeout() {},
    fetch() { throw new Error('Network access is prohibited in this fixture'); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundle, context);
  api = context.scopeHarness;
  return {
    get requests() { return requests; },
    auth: () => clone(api.storage.getAuth()),
    setAuth: auth => api.storage.setAuth(auth),
    async settle() {
      // Bounded even if a cookie callback causes an infinite request cycle.
      // Exhausting the bound is a failure, never an implicit successful settle.
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (dirty) {
          dirty = false; cursor = 0; renders++;
          api.HomePage({ refreshKey: 0 });
          while (pendingEffects.length) pendingEffects.shift()();
        }
        for (let tick = 0; tick < 8; tick++) await Promise.resolve();
      }
      assert.equal(dirty, false, `did not settle in ${MAX_TURNS} turns (${requests} requests, ${renders} renders)`);
    },
    dispose() {
      disposed = true;
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

let passed = 0, failed = 0;
async function test(name, options, run) {
  const f = fixture(options);
  try { await run(f); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  finally { f.dispose(); }
}

for (const cookieReply of ['same', 'device']) {
  await test(`missing UID: ${cookieReply} response cookies do not reload`, { cookieReply }, async f => {
    await f.settle(); assert.equal(f.requests, 1);
  });
  await test(`valid UID: ${cookieReply} response cookies do not reload`, { uid: '123', cookieReply }, async f => {
    await f.settle(); assert.equal(f.requests, 1);
  });
}

await test('missing UID: changed SESSDATA reloads once', {}, async f => {
  await f.settle(); assert.equal(f.requests, 1);
  f.setAuth({ ...f.auth(), SESSDATA: 'next-account-scope-session-fixture' });
  await f.settle(); assert.equal(f.requests, 2);
});

await test('valid same UID: token refresh does not reload', { uid: '123' }, async f => {
  await f.settle(); assert.equal(f.requests, 1);
  f.setAuth({ ...f.auth(), SESSDATA: 'refreshed-account-scope-session-fixture' });
  await f.settle(); assert.equal(f.requests, 1);
});

await test('changed valid UID reloads once', { uid: '123' }, async f => {
  await f.settle(); assert.equal(f.requests, 1);
  f.setAuth({ ...f.auth(), DedeUserID: '789' });
  await f.settle(); assert.equal(f.requests, 2);
});

await test('missing UID becomes valid and reloads once', {}, async f => {
  await f.settle(); assert.equal(f.requests, 1);
  f.setAuth({ ...f.auth(), DedeUserID: '123' });
  await f.settle(); assert.equal(f.requests, 2);
});

await test('valid UID becomes missing and reloads once', { uid: '123' }, async f => {
  await f.settle(); assert.equal(f.requests, 1);
  const next = f.auth(); delete next.DedeUserID; f.setAuth(next);
  await f.settle(); assert.equal(f.requests, 2);
});

console.log(`Recommendation account scope: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
