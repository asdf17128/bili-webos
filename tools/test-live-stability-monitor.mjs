// Exercise the actual TV monitor injection in a local browser, including cleanup.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const source = readFileSync(new URL('./test-live-stability-tv.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function installMonitor() {');
const end = source.indexOf('// All response bodies and URLs', start);
assert.ok(start >= 0 && end > start);
const install = source.slice(start, end);
const output = process.env.LIVE_MONITOR_OUTPUT || '/tmp/bili-live-stability-monitor';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const forceFailure of [false, true]) {
    const page = await browser.newPage();
    try {
      await page.setContent('<body><main>Local monitor fixture</main></body>');
      await page.evaluate(forceFailure => {
        const observers = [], listeners = new Set(), intervals = new Set();
        const Observer = window.MutationObserver, add = document.addEventListener, remove = document.removeEventListener;
        const set = window.setInterval, clear = window.clearInterval;
        window.MutationObserver = class { constructor(fn) { this.inner = new Observer(fn); this.disconnected = false; observers.push(this); }
          observe(...args) { return this.inner.observe(...args); } disconnect() { this.disconnected = true; return this.inner.disconnect(); } };
        document.addEventListener = function(type, fn, options) { if (['playing','waiting','error','ended'].includes(type)) listeners.add(type); return add.call(this,type,fn,options); };
        document.removeEventListener = function(type, fn, options) { listeners.delete(type); return remove.call(this,type,fn,options); };
        window.setInterval = function(...args) { const id = set.apply(this,args); intervals.add(id); return id; };
        window.clearInterval = function(id) { intervals.delete(id); return clear.call(this,id); };
        const request = function(_uri, options) { window.__fixture.deliver = options.onSuccess; return { cancel() { window.__fixture.cancelled++; } }; };
        window.__fixture = { request, observers, listeners, intervals, cancelled: 0, forceFailure };
        window.webOS = { service: { request } };
        window.__liveDiag = [];
        if (forceFailure) window.__liveDiag.push = function(...rows) { return Array.prototype.push.apply(this,rows); };
        window.__fixture.push = window.__liveDiag.push;
        window.__fixture.hadOwnPush = Object.hasOwn(window.__liveDiag,'push');
      }, forceFailure);
      await page.evaluate(`(${install})()`);
      const observed = await page.evaluate(() => {
        const f=window.__fixture, state=window.__liveStability; let before, cleaned;
        try {
          state.begin(0);
          const handle=window.webOS.service.request('fixture', { method:'danmakuSubscribe' });
          f.deliver({danmaku:'PRIVATE_TEXT',event:{text:'PRIVATE_TEXT'}});
          if(!f.forceFailure)handle.cancel();
          window.__liveDiag.push({ why:'connect', reason:'initial', attempt:0, msg:'PRIVATE_TEXT' });
          window.__liveDiag.push({ why:'source-ready', url:'https://private.invalid/TOKEN' });
          window.__liveDiag.push({ why:'format-error', attempt:1, variant:0, msg:'PRIVATE_TEXT', url:'https://private.invalid/TOKEN' });
          window.__liveDiag.push({ why:'connect', attempt:1 }, { why:'playing' }, { why:'retry', attempt:2, variant:1 }, { why:'gave-up', after:2 });
          state.exit(); window.__liveDiag.push({ why:'connect', attempt:2 });
          before=state.snapshot().session;
          if(f.forceFailure)throw new Error('controlled tool failure');
        } catch(error) { if(!f.forceFailure)throw error; }
        finally { cleaned=state.clean(); }
        return { before, cleaned, requestRestored:window.webOS.service.request===f.request,
          pushRestored:window.__liveDiag.push===f.push, ownPushRestored:Object.hasOwn(window.__liveDiag,'push')===f.hadOwnPush,
          cancelled:f.cancelled, listenerCount:f.listeners.size, timerCount:f.intervals.size,
          observerCount:f.observers.filter(o=>!o.disconnected).length, monitorAbsent:!window.__liveStability };
      });
      assert.equal(observed.before.frames,1);assert.equal(observed.before.events,1);
      assert.ok(observed.before.lastFrameAt>=observed.before.openedAt && observed.before.lastEventAt>=observed.before.openedAt);
      assert.equal(observed.before.mediaConnects,3); assert.equal(observed.before.mediaRetries,2);
      assert.equal(observed.before.mediaGaveUps,1); assert.equal(observed.before.maxRetryAttempt,2);
      assert.equal(observed.before.maxConnectStreak,2); assert.equal(observed.before.postExitMediaAttempts,1);
      assert.ok(observed.before.mediaAttempts.every(r=>Object.keys(r).every(k=>['type','atMs','attempt','after'].includes(k))));
      assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_TEXT|private\.invalid|TOKEN/);
      assert.ok(observed.requestRestored && observed.pushRestored && observed.ownPushRestored && observed.monitorAbsent);
      assert.equal(observed.cancelled,1); assert.equal(observed.listenerCount,0); assert.equal(observed.timerCount,0); assert.equal(observed.observerCount,0);
      assert.equal(observed.cleaned.forcedCancels,forceFailure?1:0);
      results.push({ name:forceFailure?'mid-test failure cleanup':'normal cleanup', pass:true, observed });
      console.log('PASS',results.at(-1).name);
    } catch(error) { results.push({ name:forceFailure?'mid-test failure cleanup':'normal cleanup', pass:false, error:error.message });console.log('FAIL',results.at(-1).name,error.message); }
    finally { await page.close(); }
  }
  const helpers = source.slice(source.indexOf('function safeRelayState('), source.indexOf('// Runs in the page'));
  const { assessDelivery, safeRelayState, classifyOutcome } = new Function(helpers + ';return {assessDelivery,safeRelayState,classifyOutcome};')();
  const now = Date.parse('2026-10-13T07:08:12Z');
  const sample = (override = {}) => ({ observedAtMs: now, session: { openedAt: now-900000, frames:216, events:956, lastFrameAt:now-600000, lastEventAt:now-600000, ...override } });
  const recent = { observedAtMs:now, code:0, count:10, latestAt:now-1000 };
  const cases = [
    ['recent delivered chat is receiving', sample({lastFrameAt:now-1000}), null, null, 'receiving', false],
    ['active history proves relay delivery stalled', sample(), recent, null, 'active_room_relay_stale', true],
    ['quiet history is unverified rather than failed', sample(), {...recent,latestAt:now-700000}, null, 'quiet_or_unverified', false],
    ['empty history is unverified', sample(), {...recent,count:0,latestAt:null}, null, 'unverified', false],
    ['history API failure is unverified', sample(), {...recent,code:-412}, null, 'unverified', false],
    ['future server time alone does not prove activity', sample(), {...recent,latestAt:now+3600000}, null, 'quiet_or_unverified', false],
    ['history advancement during stall works despite clock skew', sample(), {...recent,latestAt:now+3600000}, {...recent,observedAtMs:now-60000,latestAt:now+3500000}, 'active_room_relay_stale', true],
    ['delivery recovering during history probe cancels stale verdict', sample({lastFrameAt:now-100}), recent, null, 'receiving', false],
    ['non-chat events cannot conceal fresh-room chat loss', sample({lastEventAt:now-100}), recent, null, 'active_room_relay_stale', true],
    ['no first chat despite active independent room fails', sample({lastFrameAt:null,frames:0}), recent, null, 'active_room_relay_stale', true],
  ];
  for (const [name, media, history, previous, expected, failed] of cases) {
    try { const observed=assessDelivery(media,history,previous); assert.equal(observed.status,expected);assert.equal(observed.failed,failed);
      if(expected.includes('unverified'))assert.equal(observed.verified,false);
      results.push({name,pass:true,observed});console.log('PASS',name);
    } catch(error) {results.push({name,pass:false,error:error.message});console.log('FAIL',name,error.message);}
  }
  try {
    const observed=safeRelayState({phase:'PRIVATE_TEXT',connected:true,connections:3,lastPacketAt:now,lastError:'https://private.invalid/TOKEN',unknown:'PRIVATE_TEXT'});
    assert.equal(observed.phase,'unknown');assert.equal(observed.connections,3);assert.equal(observed.hasError,true);
    assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_TEXT|private\.invalid|TOKEN/);
    results.push({name:'service connection diagnostics use explicit safe fields',pass:true,observed});console.log('PASS service connection diagnostics use explicit safe fields');
  }catch(error){results.push({name:'service connection diagnostics use explicit safe fields',pass:false,error:error.message});}
  for (const [name, checks, review, expected] of [
    ['healthy measured run passes', [{pass:true}], false, 'passed'],
    ['quiet or recovered run needs review instead of full pass', [{pass:true}], true, 'needs_review'],
    ['proven stale relay fails', [{pass:false}], true, 'failed'],
  ]) {
    try { const observed=classifyOutcome(checks,review);assert.equal(observed.status,expected);assert.equal(observed.pass,expected==='passed');
      results.push({name,pass:true,observed});console.log('PASS',name);
    }catch(error){results.push({name,pass:false,error:error.message});}
  }
  const historySource=source.slice(source.indexOf('async function sampleHistory('),source.indexOf('// Runs in the page'));
  for(const mode of ['success','malformed','failure','throw']){
    const page=await browser.newPage();
    try{
      await page.evaluate(mode=>{window.webOS={service:{request(_uri,options){
        if(mode==='throw')throw new Error('PRIVATE_TEXT https://private.invalid/TOKEN');
        queueMicrotask(()=>mode==='failure'?options.onFailure({errorText:'PRIVATE_TEXT'}):options.onSuccess({body:mode==='malformed'?'PRIVATE_TEXT':JSON.stringify({code:0,data:{room:[{timeline:'2026-10-13 15:08:00',text:'PRIVATE_TEXT',nickname:'PRIVATE_TEXT'},{timeline:'not a date',text:'PRIVATE_TEXT'}]}})}));
        return {cancel(){}};
      }}}},mode);
      const observed=await page.evaluate(`(${historySource})(1)`);
      assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_TEXT|private\.invalid|TOKEN|nickname/);
      if(mode==='success'){assert.equal(observed.latestAt,Date.parse('2026-10-13T07:08:00Z'));assert.equal(observed.count,2);assert.equal(observed.timestamps.length,1);}
      else assert.ok(observed.failed||observed.malformed);
      results.push({name:'history boundary '+mode,pass:true,observed});console.log('PASS history boundary',mode);
    }catch(error){results.push({name:'history boundary '+mode,pass:false,error:error.message});console.log('FAIL history boundary',mode,error.message);}
    finally{await page.close();}
  }
  {
    const page=await browser.newPage();
    try {
      await page.clock.install();
      await page.evaluate(()=>{window.__historyCancelled=0;window.webOS={service:{request(_uri,options){window.__historyLate=options.onSuccess;return {cancel(){window.__historyCancelled++}}}}}});
      const pending=page.evaluate(`(${historySource})(1)`);
      await page.waitForFunction(()=>typeof window.__historyLate==='function');
      await page.clock.fastForward(12001);
      const observed=await pending;assert.equal(observed.timeout,true);assert.equal(await page.evaluate(()=>window.__historyCancelled),1);
      await page.evaluate(()=>window.__historyLate({body:'PRIVATE_TEXT'}));
      results.push({name:'history timeout cancels once and ignores late body',pass:true,observed});console.log('PASS history timeout cancels once and ignores late body');
    }catch(error){results.push({name:'history timeout cancels once and ignores late body',pass:false,error:error.message});}
    finally{await page.close();}
  }
} finally { await browser.close(); }
writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2)+'\n');
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);
if(results.some(r=>!r.pass))process.exitCode=1;
