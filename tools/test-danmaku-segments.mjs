import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDanmakuSegment, createDanmakuSegments } from '../app/src/player/danmakuSegments.js';
const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS',name);}
const tick=()=>new Promise(r=>setTimeout(r,0));
const vi=n=>{const b=[];do{let v=n%128;n=Math.floor(n/128);b.push(v|(n?128:0));}while(n);return b;};
const str=(field,s)=>{const b=Buffer.from(s);return [...vi(field*8+2),...vi(b.length),...b];};
const entry=(time,id='90071992547409999')=>{const b=[16,...vi(time),24,5,32,28,40,...vi(16711680),...str(7,'测试😀'),...str(12,id)];return [10,...vi(b.length),...b];};
await test('protobuf preserves time, Unicode, modes, colors and int64 string IDs',()=>{
 const r=parseDanmakuSegment(new Uint8Array([...entry(370000),...entry(1000,'2')]));
 assert.deepEqual(r.map(x=>x.time),[1,370]);assert.equal(r[1].id,'90071992547409999');assert.equal(r[0].text,'测试😀');assert.equal(r[0].mode,5);assert.equal(r[0].color,'#ff0000');
});
await test('malformed, oversized, JSON and unavailable responses fail without loops',()=>{
 for(const bytes of [[10,128],[0],[10,99,1],[16,1],[255,255,255],[123,34,99,111,100,101,34]])assert.throws(()=>parseDanmakuSegment(new Uint8Array(bytes)));
 assert.throws(()=>parseDanmakuSegment(new Uint8Array(4*1024*1024+1)));
 assert.deepEqual(parseDanmakuSegment(new Uint8Array()),[]);
});
await test('large authenticated segments retain bounded samples across the full timeline',()=>{
 const records=Array.from({length:24000},(_,i)=>{
  const b=[16,...vi(i*15),...str(7,'弹幕'.repeat(18)),...str(12,String(i+1))];
  return Buffer.from([10,...vi(b.length),...b]);
 });
 const bytes=Buffer.concat(records);assert.ok(bytes.length>2*1024*1024&&bytes.length<4*1024*1024);
 const items=parseDanmakuSegment(bytes);assert.equal(items.length,20000);
 assert.equal(items[0].time,0);assert.ok(items.at(-1).time>359);
 assert.equal(new Set(items.map(x=>x.id)).size,20000);
});
await test('late segment result after seek cannot replace target; prefetch stays bounded',async()=>{
 const calls=[],pending=[],published=[];
 const loader=createDanmakuSegments({fetchSegment:n=>{calls.push(n);return new Promise(r=>pending.push({n,r}));},fetchFallback:async()=>[],onItems:x=>published.push(x)});
 loader.update(0,3600);loader.update(1800,3600);
 pending.shift().r([{time:0,id:'old',text:'old'}]);await tick();assert.deepEqual(calls,[1,6]);
 pending.shift().r([{time:1801,id:'new',text:'new'}]);await tick();assert.equal(published.at(-1)[0].id,'new');
 pending.shift().r([{time:2161,id:'next',text:'next'}]);await tick();assert.equal(loader.stats().cached,2);assert.equal(loader.stats().pending,0);
 assert.equal(published.at(-1).length,1,'prefetch does not replace on-screen list');
 loader.update(2161,3600);assert.equal(published.at(-1).length,2);
 loader.dispose();pending.shift().r([]);await tick();assert.equal(loader.stats().cached,0);
});
await test('fallback is once, retry has cooldown, empty successful segments remain empty',async()=>{
 let time=0,fallbacks=0,calls=0,items;
 const loader=createDanmakuSegments({now:()=>time,fetchSegment:async()=>{calls++;if(calls<3)throw Error('403');return [];},fetchFallback:async()=>{fallbacks++;return [{time:1,text:'xml'}];},onItems:x=>items=x});
 loader.update(0,500);await tick();await tick();assert.equal(calls,2);assert.equal(fallbacks,1);assert.equal(items.length,1);
 for(let i=0;i<20;i++)loader.update(i,500);await tick();assert.equal(calls,2);
 time=30001;loader.update(10,500);await tick();await tick();assert.equal(calls,4);assert.deepEqual(items,[]);assert.equal(fallbacks,1);loader.dispose();
});
await test('disabled and disposed loaders never publish late fallback or fetch repeatedly',async()=>{
 let resolve,publishes=0,calls=0;
 const loader=createDanmakuSegments({fetchSegment:async()=>{calls++;throw Error('offline');},fetchFallback:()=>new Promise(r=>resolve=r),onItems:()=>publishes++});
 loader.update(0,600,false);assert.equal(calls,0);loader.update(0,600,true);await tick();const before=publishes;loader.dispose();resolve([{time:0,text:'late'}]);await tick();assert.equal(publishes,before);assert.equal(loader.stats().cached,0);
});
await test('80-minute simulated timeline bounds caches and deduplicates repeated IDs',async()=>{
 let now=0,max=0,published=[];
 const loader=createDanmakuSegments({now:()=>now,fetchSegment:async n=>Array.from({length:100},(_,i)=>({time:(n-1)*360+i,id:String(n)+'-'+Math.floor(i/2),text:'fixture'})),fetchFallback:async()=>[],onItems:x=>published=x});
 for(let t=0;t<4800;t+=5){now=t*1000;loader.update(t,4800);await tick();max=Math.max(max,loader.stats().cached);assert.ok(published.length<=150);}
 assert.ok(max<=3);assert.equal(loader.stats().requests,14);loader.dispose();
});
if(process.env.DM_REAL_SEGMENT){await test('real public protobuf fixture parses',()=>{const items=parseDanmakuSegment(new Uint8Array(readFileSync(process.env.DM_REAL_SEGMENT)));assert.ok(items.length>100);console.log('Real fixture comments:',items.length);});}
console.log(results.length+'/'+results.length+' passed');
