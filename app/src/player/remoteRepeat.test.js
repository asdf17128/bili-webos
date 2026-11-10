import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteRepeat } from './remoteRepeat.js';
const event=(timeStamp,repeat=false,key='ArrowRight')=>({timeStamp,repeat,key});
test('held key is bounded; fresh taps and reversing direction stay immediate',()=>{
 const g=createRemoteRepeat();assert.equal(g.inspect(event(100),100,10000),'accept');
 for(let n=101;n<220;n++)assert.equal(g.inspect(event(n,true),n,10000),'repeat');
 assert.equal(g.inspect(event(220,true),220,10000),'accept');
 assert.equal(g.inspect(event(221,false,'ArrowLeft'),221,10000),'accept');
 g.release('ArrowLeft');assert.equal(g.inspect(event(222),222,10000),'accept');
});
test('stalled event backlog is discarded instead of replayed, including epoch timestamps',()=>{
 const g=createRemoteRepeat();g.inspect(event(100),100,10000);
 for(let n=110;n<500;n+=10)assert.equal(g.inspect(event(n,true),900,10000),'stale');
 assert.equal(g.inspect(event(900,true),900,10000),'accept');
 assert.equal(g.inspect(event(1700000000000,true),950,1700000001000),'stale');
});
test('release and blur discard orphan repeats and do not block the next tap',()=>{
 const g=createRemoteRepeat();g.inspect(event(100),100,10000);g.release();
 assert.equal(g.isHeld(),false);assert.equal(g.inspect(event(110,true),110,10000),'stale');
 assert.equal(g.inspect(event(111),111,10000),'accept');
 g.release('ArrowLeft');assert.equal(g.isHeld(),true);g.release('ArrowRight');assert.equal(g.isHeld(),false);
});
