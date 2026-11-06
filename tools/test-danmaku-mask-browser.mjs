import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const base='http://127.0.0.1:5173',out=process.env.MASK_OUTPUT||'/tmp/bili-mask-browser';mkdirSync(out,{recursive:true});
const uri=(x)=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="black" fill-rule="evenodd" d="M0 0H100V100H0Z M${x} 20H${x+20}V80H${x}Z"/></svg>`).toString('base64');
const chunks=[0,1].map(n=>gzipSync(Buffer.concat(Array.from({length:100},(_,i)=>{const b=Buffer.from(uri(n?70:40));const h=Buffer.alloc(12);h.writeUInt32BE(b.length);h.writeBigUInt64BE(BigInt(n*10000+i*100),4);return Buffer.concat([h,b]);}))));
const index=Buffer.alloc(48);index.write('MASK');index.writeUInt32BE(1,4);index.writeUInt32BE(2,12);index.writeBigUInt64BE(48n,24);index.writeBigUInt64BE(10000n,32);index.writeBigUInt64BE(BigInt(48+chunks[0].length),40);const file=Buffer.concat([index,...chunks]);
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[],requests=[];let delay=0;
page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**/*',s=>s.close());
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.origin===base)return route.continue();
 if(u.pathname.includes('/cmaskboss/')){
  const range=route.request().headers().range;requests.push({path:u.pathname,range});
  if(delay)await new Promise(r=>setTimeout(r,delay));
  if(u.pathname.includes('ignored'))return route.fulfill({status:200,body:file,headers:{'access-control-allow-origin':'*'}});
  if(u.pathname.includes('corrupt'))return route.fulfill({status:206,body:Buffer.from('broken'),headers:{'access-control-allow-origin':'*'}});
  if(u.pathname.includes('bad'))return route.fulfill({status:503,body:'unavailable',headers:{'access-control-allow-origin':'*'}});
  assert.match(range,/^bytes=\d+-\d+$/);const [a,b]=range.slice(6).split('-').map(Number);
  return route.fulfill({status:206,body:file.subarray(a,b+1),contentType:'application/octet-stream',headers:{'access-control-allow-origin':'*'}});
 }
 return route.abort();
});
await page.goto(base);await page.waitForFunction(()=>!!window.__openVideo).catch(e=>{console.log('startup errors',errors);throw e});
await page.evaluate(async()=>{
 const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
 const {default:Layer}=await import('/src/player/DanmakuLayer.jsx');
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;background:rgb(0,0,255);z-index:9999';document.body.append(host);
 const v=document.createElement('video');v.style.cssText='position:absolute;left:0;top:0;width:1920px;height:1080px';host.append(v);
 window.__maskVideo=v;window.__maskTime=0;Object.defineProperties(v,{currentTime:{get:()=>window.__maskTime},videoWidth:{configurable:true,get:()=>window.__maskWidth||1280},videoHeight:{configurable:true,get:()=>window.__maskHeight||540},seeking:{get:()=>false}});
 const mount=document.createElement('div');host.append(mount);const root=createRoot(mount);const ref={current:v};
 window.__maskProps={onMaskStatus:value=>{window.__maskUIState=value},danmakus:[],currentTime:0,enabled:true,videoRef:ref,maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/test.webmask'},settings:{danmakuMask:true}};
 window.__drawMask=patch=>{Object.assign(window.__maskProps,patch);root.render(React.createElement(Layer,window.__maskProps));};window.__drawMask({});
});
const results=[];async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}}
const active=()=>page.waitForFunction(()=>window.__danmakuMaskStats?.().state==='active');
await test('actual CSS pixels hide the silhouette and preserve letterboxes',async()=>{
 await active();await page.evaluate(()=>{const c=document.querySelectorAll('.danmaku-container');const el=c[c.length-1];const fill=document.createElement('div');fill.style.cssText='position:absolute;left:0;top:0;width:1920px;height:1020px;background:rgb(255,0,0)';el.append(fill);});
 const png=PNG.sync.read(await page.screenshot({path:out+'/mask.png'}));const color=(x,y)=>Array.from(png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+3));
 assert.deepEqual(color(960,540),[0,0,255]);assert.deepEqual(color(300,540),[255,0,0]);assert.deepEqual(color(960,50),[255,0,0]);
 assert.ok(await page.evaluate(()=>window.__danmakuMaskStats().cached<=2));
});
await test('seek clears old mask synchronously and selects the target segment',async()=>{
 await page.evaluate(()=>{window.__maskTime=15;window.__maskVideo.dispatchEvent(new Event('seeking'));});
 assert.equal(await page.evaluate(()=>document.querySelectorAll('.danmaku-container')[0].style.maskImage),'none');
 await active();const png=PNG.sync.read(await page.screenshot({path:out+'/seek.png'}));assert.equal(png.data[(540*1920+960)*4],255);assert.equal(png.data[(540*1920+1536)*4+2],255);
});
await test('paused time keeps the frame stable and backward seek reloads the correct silhouette',async()=>{
 const before=await page.evaluate(()=>window.__danmakuMaskStats().applied);await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.__danmakuMaskStats().applied),before);
 await page.evaluate(()=>{window.__maskTime=1;window.__maskVideo.dispatchEvent(new Event('seeking'));});await active();
 await page.evaluate(()=>{const fill=document.createElement('div');fill.style.cssText='position:absolute;inset:0;background:rgb(255,0,0)';document.querySelector('.danmaku-container').append(fill);});
 const png=PNG.sync.read(await page.screenshot());assert.equal(png.data[(540*1920+960)*4+2],255);assert.ok(await page.evaluate(()=>window.__danmakuMaskStats().cached<=2));
});
await test('missing frames clear the silhouette and report a gap instead of endless loading',async()=>{
 await page.evaluate(()=>{window.__maskTime=25;window.__maskVideo.dispatchEvent(new Event('seeking'));});
 await page.waitForFunction(()=>window.__maskUIState==='gap');
 assert.equal(await page.evaluate(()=>document.querySelector('.danmaku-container').style.maskImage),'none');
});
await test('off clears the mask, stops requests, and late results cannot reapply it',async()=>{
 await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));await page.waitForFunction(()=>!window.__danmakuMaskStats);const before=requests.length;await page.waitForTimeout(300);assert.equal(requests.length,before);
 delay=300;await page.evaluate(()=>window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/late.webmask'},settings:{danmakuMask:true}}));await page.waitForTimeout(120);await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.danmaku-container')].every(e=>e.style.maskImage==='none')));delay=0;
});
await test('failure and unavailable metadata fall back without retry loops',async()=>{
 await page.evaluate(()=>window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/bad.webmask'},settings:{danmakuMask:true}}));await page.waitForFunction(()=>window.__danmakuMaskStats?.().state==='failed');const before=requests.length;await page.waitForTimeout(400);assert.equal(requests.length,before);
 await page.evaluate(()=>window.__drawMask({maskSource:null}));await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>!window.__danmakuMaskStats));
});
await test('ignored Range and truncated responses fail closed without retry storms',async()=>{
 for(const name of ['ignored','corrupt']){
  await page.evaluate(name=>window.__drawMask({maskSource:{mask_url:`https://a.bilivideo.com/cmaskboss/${name}.webmask`},settings:{danmakuMask:true}}),name);
  await page.waitForFunction(()=>window.__danmakuMaskStats?.().state==='failed');
  assert.equal(await page.evaluate(()=>document.querySelector('.danmaku-container').style.maskImage),'none');
  const count=requests.length;await page.waitForTimeout(350);assert.equal(requests.length,count);
 }
});
await test('video switch during an in-flight request cannot revive the old source',async()=>{
 delay=350;
 await page.evaluate(()=>{window.__maskTime=1;window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/switch.webmask'},settings:{danmakuMask:true}});});
 await page.waitForTimeout(120);await page.evaluate(()=>window.__drawMask({maskSource:null}));
 await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__maskUIState),'unavailable');
 assert.equal(await page.evaluate(()=>document.querySelector('.danmaku-container').style.maskImage),'none');
 assert.ok(await page.evaluate(()=>!window.__danmakuMaskStats));delay=0;
});
await test('request deadline falls back and a late response cannot restore the mask',async()=>{
 delay=6500;
 await page.evaluate(()=>window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/timeout.webmask'},settings:{danmakuMask:true}}));
 await page.waitForFunction(()=>window.__danmakuMaskStats?.().state==='failed');
 const count=requests.length;await page.waitForTimeout(2000);assert.equal(requests.length,count);
 assert.equal(await page.evaluate(()=>document.querySelector('.danmaku-container').style.maskImage),'none');delay=0;
});
await test('background visibility suspends masking and fetches, foreground resumes',async()=>{
 await page.evaluate(()=>{window.__maskTime=1;window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/visibility.webmask'},settings:{danmakuMask:true}});});await active();
 await page.waitForTimeout(300);
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
 await page.waitForTimeout(200);const count=requests.length;
 assert.equal(await page.evaluate(()=>document.querySelector('.danmaku-container').style.maskImage),'none');
 await page.waitForTimeout(300);assert.equal(requests.length,count);
 await page.evaluate(()=>delete document.hidden);await active();
});
await test('portrait video keeps pillarboxes visible and follows layout changes',async()=>{
 // Exercise portrait aspect ratio and pillarboxes using controlled video geometry.
 await page.evaluate(()=>{
  window.__maskWidth=540;window.__maskHeight=1080;
  window.__maskTime=1;window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/test.webmask'},settings:{danmakuMask:true}});
 });await active();
 await page.evaluate(()=>{const fill=document.createElement('div');fill.style.cssText='position:absolute;inset:0;background:rgb(255,0,0)';document.querySelector('.danmaku-container').append(fill);});
 const png=PNG.sync.read(await page.screenshot());
 assert.equal(png.data[(540*1920+960)*4+2],255);
 assert.equal(png.data[(540*1920+300)*4],255);
 await page.evaluate(()=>{window.__maskWidth=1280;window.__maskHeight=540;});
 await page.waitForTimeout(200);
 const after=PNG.sync.read(await page.screenshot());assert.equal(after.data[(540*1920+960)*4+2],255);
});
if(process.env.MASK_SOAK_SECONDS)await test('local lifecycle and seek soak retains bounded resources',async()=>{
 const seconds=Number(process.env.MASK_SOAK_SECONDS);assert.ok(seconds>=1 && seconds<=3600);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const measure=async()=>{await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));};
 await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));await page.waitForTimeout(150);
 const baseline=await measure(),started=Date.now();let cycles=0,maxCache=0;
 while(Date.now()-started<seconds*1000){
  await page.evaluate(n=>{window.__maskTime=n%2?15:1;window.__drawMask({settings:{danmakuMask:true}});},cycles);
  await active();
  for(const t of [19.9,0,10,1]){
   await page.evaluate(t=>{window.__maskTime=t;window.__maskVideo.dispatchEvent(new Event('seeking'));},t);
   await active();const stats=await page.evaluate(()=>window.__danmakuMaskStats());
   assert.equal(stats.failures,0);assert.ok(stats.cached<=2);maxCache=Math.max(maxCache,stats.cached);
  }
  await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));
  await page.waitForFunction(()=>!window.__danmakuMaskStats);
  const count=requests.length;await page.waitForTimeout(150);assert.equal(requests.length,count);
  cycles++;
 }
 const final=await measure();
 const measurement={durationSeconds:Math.round((Date.now()-started)/1000),cycles,seeks:cycles*4,maxCache,heapDelta:final.JSHeapUsedSize-baseline.JSHeapUsedSize,nodeDelta:final.Nodes-baseline.Nodes,listenerDelta:final.JSEventListeners-baseline.JSEventListeners};
 results.push({measurement});console.log('SOAK',JSON.stringify(measurement));
 assert.ok(measurement.heapDelta<8*1024*1024);assert.ok(measurement.nodeDelta<100);assert.ok(measurement.listenerDelta<=5);
});
await test('presented video frame time wins over playback clock and stale seek callbacks are ignored',async()=>{
 await page.evaluate(()=>{
  window.__maskTime=1;window.__frameCallbacks=new Map();window.__frameSerial=0;
  Object.defineProperty(window.__maskVideo,'paused',{configurable:true,get:()=>false});
  window.__maskVideo.requestVideoFrameCallback=cb=>{const id=++window.__frameSerial;window.__frameCallbacks.set(id,cb);return id;};
  window.__maskVideo.cancelVideoFrameCallback=id=>window.__frameCallbacks.delete(id);
  window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/frameclock.webmask'},settings:{danmakuMask:true}});
 });await active();await page.waitForFunction(()=>window.__danmakuMaskStats().cached===2);
 const state=await page.evaluate(()=>{
  const fire=time=>{const [id,cb]=window.__frameCallbacks.entries().next().value;window.__frameCallbacks.delete(id);cb(performance.now(),{mediaTime:time});};
  fire(15);const presented=window.__danmakuMaskStats();
  const stale=window.__frameCallbacks.values().next().value;
  window.__maskVideo.dispatchEvent(new Event('seeking'));
  const cleared=window.__danmakuMaskStats().frameTime===null;
  window.__maskVideo.dispatchEvent(new Event('seeked'));stale(performance.now(),{mediaTime:15});
  const staleIgnored=cleared&&window.__danmakuMaskStats().frameTime===1000;
  fire(1);const applied=window.__danmakuMaskStats().applied;fire(1.1);const duplicateAvoided=window.__danmakuMaskStats().applied===applied;
  window.__staleFrameAfterOff=window.__frameCallbacks.values().next().value;
  return {presented,staleIgnored,duplicateAvoided,resumed:window.__danmakuMaskStats(),callbacks:window.__frameCallbacks.size};
 });assert.equal(state.presented.frameTime,15000);assert.equal(state.presented.timelineTime,15000);assert.ok(state.staleIgnored);assert.equal(state.resumed.frameTime,1100);assert.ok(state.duplicateAvoided);assert.equal(state.callbacks,1);
 await page.evaluate(()=>window.__maskTime=15);await page.waitForFunction(()=>window.__danmakuMaskStats().frameTime===15000);
 await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));await page.waitForFunction(()=>!window.__danmakuMaskStats);
 assert.equal(await page.evaluate(()=>{window.__staleFrameAfterOff(performance.now(),{mediaTime:1});return window.__frameCallbacks.size;}),0);
 assert.ok(await page.evaluate(()=>!window.__danmakuMaskStats));
 await page.evaluate(()=>{delete window.__maskVideo.paused;delete window.__maskVideo.requestVideoFrameCallback;delete window.__maskVideo.cancelVideoFrameCallback;});
});
await test('older browsers follow playback via animation frames without video-frame callbacks',async()=>{
 await page.evaluate(()=>{
  window.__maskTime=1;Object.defineProperty(window.__maskVideo,'paused',{configurable:true,get:()=>false});
  window.__maskVideo.requestVideoFrameCallback=undefined;window.__maskVideo.cancelVideoFrameCallback=undefined;
  window.__drawMask({maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/raf.webmask'},settings:{danmakuMask:true}});
 });await active();await page.waitForFunction(()=>window.__danmakuMaskStats().cached===2);
 await page.evaluate(()=>window.__maskTime=15);await page.waitForFunction(()=>window.__danmakuMaskStats().frameTime===15000);
 await page.evaluate(()=>window.__drawMask({settings:{danmakuMask:false}}));await page.waitForFunction(()=>!window.__danmakuMaskStats);
 await page.evaluate(()=>{delete window.__maskVideo.paused;delete window.__maskVideo.requestVideoFrameCallback;delete window.__maskVideo.cancelVideoFrameCallback;});
});
await test('SVG allowlist rejects executable and external content',async()=>{
 const values=await page.evaluate(async()=>{const {safeMaskImage}=await import('/src/player/danmakuMask.js');return ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>','<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x"/></svg>','<!DOCTYPE svg [<!ENTITY a "bad">]><svg/>'].map(s=>{try{safeMaskImage('data:image/svg+xml;base64,'+btoa(s));return false}catch{return true}});});assert.ok(values.every(Boolean));
});
await test('Luna binary transport forwards Range and decodes bounded base64',async()=>{
 const r=await page.evaluate(async()=>{
  const oldWeb=window.webOS,oldBridge=window.PalmServiceBridge;const calls=[];
  try{
   window.PalmServiceBridge=function(){};window.webOS={service:{request:(url,options)=>{calls.push({method:options.method,range:options.parameters.range});setTimeout(()=>options.onSuccess({returnValue:true,status:206,bodyBase64:btoa('MASK')}),0);return {cancel(){}};}}};
   const {getDanmakuMaskRange}=await import('/src/api/client.js');
   const data=await getDanmakuMaskRange('https://a.bilivideo.com/cmaskboss/test.webmask',0,15);
   let rejected=false;try{await getDanmakuMaskRange('https://a.bilivideo.com/cmaskboss/test.webmask',0,1);}catch{rejected=true;}
   return {data:Array.from(data),calls,rejected};
  }finally{window.webOS=oldWeb;if(oldBridge===undefined)delete window.PalmServiceBridge;else window.PalmServiceBridge=oldBridge;}
 });assert.deepEqual(r.data,[77,65,83,75]);assert.equal(r.calls[0].range,'bytes=0-15');assert.ok(r.rejected);
});
if(process.env.MASK_REAL_SEGMENT) await test('real public mask SVGs decode and sanitize under CPU throttle',async()=>{
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
 const bytes=Array.from(readFileSync(process.env.MASK_REAL_SEGMENT));
 const timing=await page.evaluate(async bytes=>{const m=await import('/src/player/danmakuMask.js');const start=performance.now();const frames=m.decodeMaskSegment(new Uint8Array(bytes),0,10000);const decoded=performance.now()-start;for(const f of frames)m.safeMaskImage(f.uri);return {frames:frames.length,decodeMs:Math.round(decoded),sanitizeMs:Math.round(performance.now()-start-decoded)};},bytes);assert.ok(timing.frames>100);results.push({measurement:timing});
});
assert.deepEqual(errors,[]);writeFileSync(out+'/results.json',JSON.stringify({results,requests,errors},null,2));await browser.close();if(results.some(r=>r.pass===false))process.exitCode=1;
