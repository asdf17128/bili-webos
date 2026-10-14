// Production client bundle + the shipped webOSTV.js SDK. Only PalmServiceBridge
// is replaced, so this detects retained SDK requests instead of mocking cancel().
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = require('esbuild');
const root = new URL('../', import.meta.url).pathname;
const bundled = await build({ entryPoints: [root + 'app/src/api/client.js'], bundle: true, write: false,
  format: 'iife', globalName: '__clientUnderTest', platform: 'browser', target: 'es2016', define: { 'import.meta.env.DEV': 'false' } });
const sdk = readFileSync(root + 'app/public/webOSTVjs-1.2.13/webOSTV.js', 'utf8');
const output = process.env.SUBSCRIPTION_OUTPUT || '/tmp/bili-subscription-cleanup';
mkdirSync(output, { recursive: true });
const results = [];
function fixture({ throwingCancel = false, missingHandle = false } = {}) {
  let tick = 1000000;
  const bridges = [];
  const values = new Map();
  const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams,
    Date: class extends Date { static now() { return ++tick; } },
    localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) },
    navigator: { userAgent: 'fixture SmartTV Chrome/120.0.0.0' }, addEventListener() {}, removeEventListener() {},
    PalmServiceBridge: function () {
      this.cancelCalls = 0;
      this.call = (uri, body) => { this.method = uri.split('/').pop(); this.subscribe = !!JSON.parse(body).subscribe;
        this.onservicecallback(JSON.stringify({ returnValue: true, subscribed: true })); };
      this.cancel = () => { this.cancelCalls++; if (throwingCancel) throw new Error('fixture closed bridge'); };
      this.deliver = value => this.onservicecallback(JSON.stringify(value));
      bridges.push(this);
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(sdk, context, { filename: 'webOSTV.js' });
  vm.runInContext(bundled.outputFiles[0].text, context, { filename: 'production-client.bundle.js' });
  if (missingHandle) {
    const original = context.webOS.service.request;
    context.webOS.service.request = (...args) => { original(...args); return {}; };
  }
  return { client: context.__clientUnderTest, bridges };
}
async function run(name, fn) {
  try { const detail = await fn(); results.push({ name, pass: true, detail }); console.log('PASS', name, JSON.stringify(detail || {})); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
}
for (const kind of ['danmaku', 'cast']) {
  await run(`${kind}: 20 real SDK subscriptions release every bridge exactly once`, () => {
    const f = fixture(); let received = 0, failures = 0;
    for (let i = 0; i < 20; i++) {
      const stop = kind === 'danmaku' ? f.client.danmakuSubscribe({ roomid: 1, token: 'fixture-only' }, () => received++, () => received++) :
        f.client.castSubscribe(() => received++, () => failures++);
      const bridge = f.bridges.at(-1);
      assert.equal(bridge.subscribe, true);
      const payload = kind === 'danmaku' ? { returnValue: true, danmaku: 'fixture text' } : { returnValue: true, event: { type: 'play' } };
      bridge.deliver(payload);
      assert.equal(received, i + 1, 'active subscription must deliver');
      stop(); stop();
      bridge.deliver(payload);
      bridge.deliver({ returnValue: false, errorCode: 1 });
      assert.equal(received, i + 1, 'late success must be ignored');
    }
    assert.equal(failures, 0, 'late errors must be ignored');
    const cancelled = f.bridges.reduce((n, bridge) => n + bridge.cancelCalls, 0);
    assert.equal(cancelled, 20, `created=${f.bridges.length}, cancelled=${cancelled}`);
    assert.ok(f.bridges.every(bridge => bridge.cancelCalls === 1));
    return { created: f.bridges.length, cancelled, delivered: received, lateFailures: failures };
  });
  for (const mode of ['throwingCancel', 'missingHandle']) {
    await run(`${kind}: cleanup tolerates ${mode} and still ignores late callbacks`, () => {
      const f = fixture({ [mode]: true }); let received = 0;
      const stop = kind === 'danmaku' ? f.client.danmakuSubscribe({ roomid: 1 }, () => received++, () => received++) : f.client.castSubscribe(() => received++);
      assert.doesNotThrow(() => { stop(); stop(); });
      f.bridges[0].deliver({ returnValue: true, danmaku: 'late', event: { type: 'play' } });
      assert.equal(received, 0);
      return { cancelled: f.bridges[0].cancelCalls, lateDelivered: received };
    });
  }
}
writeFileSync(`${output}/results.json`, JSON.stringify({ sdk: 'webOSTV.js 1.2.13', productionModule: 'app/src/api/client.js', results }, null, 2) + '\n');
if (results.some(row => !row.pass)) process.exitCode = 1;
