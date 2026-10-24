const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../playbackDiagnostics');
const url = () => new URL('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1xx411c7mD&cid=2&qn=127&SESSDATA=SECRET');
test('retains original failure and successful recovery, ignores diagnostic probes', () => {
  const d = create(), r = d.begin(url(), false);
  d.response(r, 200, Buffer.from('{"code":-352,"data":{"v_voucher":"SECRET"}}'), null, Date.now());
  d.recovery(r, 'retried');
  d.response(r, 200, Buffer.from('{"code":0,"data":{"dash":{"video":[{"baseUrl":"SECRET"}]}}}'), null, Date.now());
  const p = d.begin(url(), true);
  d.response(p, null, null, new Error('SECRET'), Date.now());
  const f = d.snapshot().lastFailure;
  assert.equal(f.attempts[0].code, -352);
  assert.equal(f.attempts[1].stream, true);
  assert.equal(f.outcome, 'ok');
  assert.equal(f.recovery, 'retried');
  assert.ok(!JSON.stringify(d.snapshot()).includes('SECRET'));
});
test('bounds history, classifies transport errors and detaches snapshots', () => {
  const d = create();
  for (let i=0;i<20;i++) d.response(d.begin(url(), false), null, null, {code:'ETIMEDOUT'}, Date.now());
  const s=d.snapshot(); assert.equal(s.recent.length,8);
  assert.equal(s.lastFailure.attempts[0].http,null);
  assert.equal(s.lastFailure.attempts[0].error,'timeout');
  s.lastFailure.kind='mutated'; assert.equal(d.snapshot().lastFailure.kind,'wbi');
  assert.equal(d.begin(new URL('https://evil.example/x/player/playurl'),false),null);
});
test('HTTP failures and malformed bodies remain distinguishable', () => {
 const d=create(), r=d.begin(url(), false);
 d.response(r,503,Buffer.from('<html>private gateway</html>'),null,Date.now());
 const f=d.snapshot().lastFailure;
 assert.equal(f.attempts[0].http,503); assert.equal(f.attempts[0].error,'non_json');
 d.recovery(r,'pending',new Error('identity cooldown'));
 assert.equal(d.snapshot().lastFailure.recovery,'cooldown');
 assert.ok(!JSON.stringify(d.snapshot()).includes('private gateway'));
});
