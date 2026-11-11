import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlTiming} from './controlTiming.js';
test('control timings are bounded, grouped and keep one frame callback',()=>{
 let time=0;const frames=[];const t=createControlTiming(()=>time,f=>frames.push(f));
 for(let i=0;i<200;i++)t.record('stale',300,false);
 assert.equal(frames.length,1);time=450;frames.shift()();
 assert.deepEqual(t.snapshot().playing,{keys:120,stale:120,coalesced:0,ageMax:300,frameMax:450,frames:1});
 t.record('accept',2,true);time=466;frames.shift()();assert.equal(t.snapshot().paused.frameMax,16);
 const copy=t.snapshot();copy.playing.keys=0;assert.equal(t.snapshot().playing.keys,120);
});
test('reset invalidates pending timing without contaminating next video',()=>{
 const frames=[];const t=createControlTiming(()=>0,f=>frames.push(f));t.record('accept',0,false);t.reset();frames.shift()();assert.deepEqual(t.snapshot(),{});
 t.record('accept',Infinity,true);assert.equal(frames.length,1);assert.equal(t.snapshot().paused.ageMax,0);
});
