// C-DM-01: danmaku MT rolling window (app/src/player/dmTranslate.js).
// Window selection, DEDUP (danmaku repeat massively — one request per unique
// text), global cross-video cache, engine-failure retry, batch cap.
// Run: node tools/test-dmtranslate.mjs   (exit 0 = pass)
import { strict as assert } from 'assert';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createDmTranslator, _cacheClear, _cacheSize } =
  await import('file://' + join(ROOT, 'app/src/player/dmTranslate.js'));

let n = 0;
const ok = (name) => { n++; console.log('  ✓ ' + name); };
const mkEngine = (log) => async (texts, tl) => { log.push(texts.slice()); return texts.map(x => 'E:' + x); };

// --- window + dedup ---
{
  _cacheClear();
  const dms = [
    { time: 1, text: '哈哈哈' }, { time: 5, text: '666' }, { time: 6, text: '哈哈哈' },
    { time: 30, text: '泪目' }, { time: 100, text: '窗外' },
  ];
  const log = [];
  const tr = createDmTranslator(dms, 'en', mkEngine(log));
  const sent = await tr.tick(2); // window [0, 42]
  assert.equal(sent, 3); // 哈哈哈(去重)+666+泪目;窗外(t=100)不在窗口
  assert.deepEqual(log[0].sort(), ['666', '哈哈哈', '泪目']);
  assert.equal(tr.get(0), 'E:哈哈哈');
  assert.equal(tr.get(2), 'E:哈哈哈'); // 重复文本一次请求全填
  assert.equal(tr.get(4), null);      // 窗外未译
  ok('window + dedup: unique texts once, dupes filled, out-of-window skipped');
}

// --- global cache reused across translators (= across videos) ---
{
  const log = [];
  const tr2 = createDmTranslator([{ time: 2, text: '哈哈哈' }, { time: 3, text: '新词' }], 'en', mkEngine(log));
  const sent = await tr2.tick(2);
  assert.equal(sent, 1);              // 哈哈哈 命中全局缓存,只发 新词
  assert.deepEqual(log[0], ['新词']);
  assert.equal(tr2.get(0), 'E:哈哈哈');
  assert.ok(_cacheSize() >= 4);
  ok('global text cache: repeated memes translate once across videos');
}

// --- engine failure → untranslated → retried on next tick ---
{
  _cacheClear();
  let fail = true;
  const log = [];
  const engine = async (texts) => { if (fail) throw new Error('net'); log.push(texts); return texts.map(x => 'E:' + x); };
  const dms = [{ time: 1, text: '一' }];
  const tr = createDmTranslator(dms, 'en', engine);
  await tr.tick(1);
  assert.equal(tr.get(0), null);
  fail = false;
  await tr.tick(1);
  assert.equal(tr.get(0), 'E:一');
  ok('engine failure leaves item untranslated; next tick retries');
}

// --- batch cap + stop ---
{
  _cacheClear();
  const dms = Array.from({ length: 150 }, (_, i) => ({ time: 1 + i * 0.1, text: '句' + i }));
  const log = [];
  const tr = createDmTranslator(dms, 'en', mkEngine(log), { horizon: 60, maxBatch: 100 });
  assert.equal(await tr.tick(1), 100); // capped
  assert.equal(await tr.tick(1), 50);  // remainder next tick
  tr.stop();
  assert.equal(await tr.tick(1), 0);   // stopped → inert
  ok('batch cap honored; stop() makes it inert');
}

console.log(`PASS test-dmtranslate (${n} groups)`);
