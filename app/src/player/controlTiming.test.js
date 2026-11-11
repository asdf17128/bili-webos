import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlTiming} from './controlTiming.js';
test('control timings bound paired callbacks and separate timer from frame delay',()=>{
 let time=0;const frames=[],timers=[];const t=createControlTiming(()=>time,f=>frames.push(f),f=>timers.push(f));
 t.record('accept',2,false);t.handled(4,false);time=10;timers.shift()();time=1400;frames.shift()();
 assert.deepEqual(t.snapshot().playing,{keys:1,stale:0,coalesced:0,ageMax:2,frameMax:1400,frames:1,timerMax:10,timers:1,handlerMax:4});
 for(let i=0;i<200;i++)t.record('stale',300,false);
 assert.equal(frames.length,1);assert.equal(timers.length,1);assert.equal(t.snapshot().playing.keys,120);
 time=1450;frames.shift()();timers.shift()();
 t.record('accept',2,true);time=1466;frames.shift()();timers.shift()();assert.equal(t.snapshot().paused.frameMax,16);
 const copy=t.snapshot();copy.playing.keys=0;assert.equal(t.snapshot().playing.keys,120);
});
test('reset invalidates both pending callbacks without contaminating next video',()=>{
 const frames=[],timers=[];const t=createControlTiming(()=>0,f=>frames.push(f),f=>timers.push(f));t.record('accept',0,false);t.reset();frames.shift()();timers.shift()();assert.deepEqual(t.snapshot(),{});
 t.record('accept',Infinity,true);assert.equal(frames.length,1);assert.equal(timers.length,1);assert.equal(t.snapshot().paused.ageMax,0);
});
