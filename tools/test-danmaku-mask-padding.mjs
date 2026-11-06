import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { erodeMaskAlpha } from '../app/src/player/danmakuMaskImage.js';
const output = process.env.MASK_PADDING_OUTPUT || '/tmp/bili-mask-padding';
mkdirSync(output, { recursive: true });
const results=[];
const record=(name,data)=>{results.push({name,pass:true,...data});console.log('PASS',name);};
// Compare the optimized separable implementation to a direct square minimum.
for(const radius of [0,1,2,6]){
 const w=19,h=13,source=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3?(i*73+19)%256:0),actual=source.slice();
 erodeMaskAlpha(actual,w,h,radius);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let expected=255;for(let py=Math.max(0,y-radius);py<=Math.min(h-1,y+radius);py++)for(let px=Math.max(0,x-radius);px<=Math.min(w-1,x+radius);px++)expected=Math.min(expected,source[(py*w+px)*4+3]);
  assert.equal(actual[(y*w+x)*4+3],expected);
 }
}
assert.throws(()=>erodeMaskAlpha(new Uint8Array(4),1,1,7));
assert.throws(()=>erodeMaskAlpha(new Uint8Array(4),1000,1000,2));
record('bounded alpha erosion matches a square kernel, including soft alpha and borders');
const browser=await chromium.launch(),page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.routeWebSocket('**/*',s=>s.close());
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5173'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5173');
 const pixels=await page.evaluate(async()=>{
  const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');
  const source='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><path fill="black" fill-rule="evenodd" d="M0 0H320V180H0Z M140 40H180V140H140Z"/></svg>';
  const prepared=await prepareDanmakuMaskImage('data:image/svg+xml;base64,'+btoa(source));
  const image=new Image();image.src=prepared.uri;await new Promise((r,j)=>{image.onload=r;image.onerror=j;});
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,320,180).data;
  const a=(x,y)=>data[(y*320+x)*4+3];
  prepared.dispose();
  return {radius:prepared.radius,width:prepared.width,height:prepared.height,ratio:prepared.sourceProtectedRatio,alpha:[a(0,90),a(1,90),a(137,90),a(138,90),a(139,90),a(140,90),a(181,90),a(182,90)]};
 });
 assert.equal(pixels.radius,2);assert.deepEqual(pixels.alpha,[255,255,255,0,0,0,0,255]);assert.ok(pixels.ratio>0.05&&pixels.ratio<0.1);
 record('small bitmap grows the person hole by 12px at 1080p without erasing viewport borders',{pixels});
 const extra=await page.evaluate(async()=>{
  const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');const make=s=>'data:image/svg+xml;base64,'+btoa(s);
  const opaque=await prepareDanmakuMaskImage(make('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="black"/></svg>'));
  const large=await prepareDanmakuMaskImage(make('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="2160"><rect width="4096" height="2160" fill="black"/></svg>'));
  const invalid=[];
  for(const svg of ['<svg xmlns="http://www.w3.org/2000/svg" width="0" height="1"/>','<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><filter id="x"/></svg>']){try{await prepareDanmakuMaskImage(make(svg));invalid.push(false)}catch{invalid.push(true)}}
  opaque.dispose();large.dispose();
  return {opaque:opaque.sourceProtectedRatio,width:large.width,height:large.height,invalid};
 });
 assert.equal(extra.opaque,0);assert.ok(extra.width*extra.height<=65536);assert.ok(extra.invalid.every(Boolean));record('source without a silhouette stays unchanged; large masks are bounded and remote filters remain rejected',{extra});
 const cancellation=await page.evaluate(async()=>{
  const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');
  const uri='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="black"/></svg>');
  const RealImage=window.Image,images=[];let made=0;
  class PendingImage {
   constructor(){made++;images.push(this);this.onload=null;this.onerror=null;this.values=[];}
   set src(value){this.values.push(value);}get src(){return this.values[this.values.length-1];}
  }
  const makeSignal=()=>{
   const controller=new AbortController(),listeners=new Set(),signal={get aborted(){return controller.signal.aborted;},addEventListener(type,fn,options){listeners.add(fn);controller.signal.addEventListener(type,fn,options);},removeEventListener(type,fn){listeners.delete(fn);controller.signal.removeEventListener(type,fn);}};
   return {controller,signal,listeners};
  };
  try{
   window.Image=PendingImage;
   const pre=makeSignal();pre.controller.abort();let early='';try{await prepareDanmakuMaskImage(uri,{signal:pre.signal});}catch(e){early=e.name;}
   const createdBefore=made;
   const mid=makeSignal(),started=performance.now();const pending=prepareDanmakuMaskImage(uri,{signal:mid.signal}).catch(e=>e.name);
   const lateLoad=images[0].onload;mid.controller.abort();const cancelled=await pending;lateLoad();
   const during={name:cancelled,elapsed:performance.now()-started,listeners:mid.listeners.size,sourceCleared:images[0].src==='',handlersCleared:images[0].onload===null&&images[0].onerror===null};
   const after=makeSignal(),afterPromise=prepareDanmakuMaskImage(uri,{signal:after.signal}).catch(e=>e.name);
   images[1].onload();after.controller.abort();const afterDecode=await afterPromise;
   return {early,createdBefore,during,afterDecode,afterListeners:after.listeners.size,afterCleared:images[1].src===''};
  }finally{window.Image=RealImage;}
 });
 assert.equal(cancellation.early,'AbortError');assert.equal(cancellation.createdBefore,0);assert.equal(cancellation.during.name,'AbortError');assert.ok(cancellation.during.elapsed<500);assert.equal(cancellation.during.listeners,0);assert.ok(cancellation.during.sourceCleared&&cancellation.during.handlersCleared);assert.equal(cancellation.afterDecode,'AbortError');assert.equal(cancellation.afterListeners,0);assert.ok(cancellation.afterCleared);
 record('abort before decode, during decode and after load clears images, handlers and listeners',{cancellation});
 const ownership=await page.evaluate(async()=>{
  const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');
  const uri='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="black"/></svg>');
  const RealImage=window.Image,images=[];let calls=0,fallback=false;
  try{
   window.Image=function(){const image=new RealImage();images.push(image);const decode=image.decode?.bind(image);if(fallback)image.decode=undefined;else if(decode)image.decode=()=>{calls++;return decode();};return image;};
   const result=await prepareDanmakuMaskImage(uri);
   const decoded={same:result.image===images[1],ready:result.image.complete&&result.image.naturalWidth===320,sourceCleared:images[0].getAttribute('src')==='',calls};
   result.dispose();result.dispose();const released=images[1].getAttribute('src')==='';
   fallback=true;const legacy=await prepareDanmakuMaskImage(uri);const legacyReady=legacy.image.complete&&legacy.image.naturalWidth===320;legacy.dispose();
   return {decoded,released,legacyReady,legacyReleased:images[3].getAttribute('src')===''};
  }finally{window.Image=RealImage;}
 });
 assert.ok(ownership.decoded.same&&ownership.decoded.ready&&ownership.decoded.sourceCleared);assert.equal(ownership.decoded.calls,2);assert.ok(ownership.released&&ownership.legacyReady&&ownership.legacyReleased);
 record('returned PNG is decoded and owned until idempotent dispose; old browsers use onload',{ownership});
 const outputCleanup=await page.evaluate(async()=>{
  const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');
  const uri='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="black"/></svg>');
  const RealImage=window.Image,results=[];
  for(const mode of ['abort','failure','timeout']){
   const images=[];let made=0,lateResolve,created;const ready=new Promise(r=>created=r);
   class OutputImage{constructor(){this.onload=null;this.onerror=null;this.value='';}set src(v){this.value=v;}get src(){return this.value;}decode(){return mode==='failure'?Promise.reject(Error('broken')):new Promise(r=>lateResolve=r);}}
   try{
    window.Image=function(){const image=++made===1?new RealImage():new OutputImage();images.push(image);if(made===2)created();return image;};
    const controller=new AbortController(),started=performance.now();
    const pending=prepareDanmakuMaskImage(uri,{signal:controller.signal}).then(()=>({unexpected:true}),error=>({name:error.name,message:error.message}));
    await ready;if(mode==='abort')controller.abort();const outcome=await pending;
    lateResolve?.();await Promise.resolve();
    results.push({mode,outcome,elapsed:performance.now()-started,sourceCleared:images[0].getAttribute('src')==='',outputCleared:images[1].src==='',handlersCleared:images[1].onload===null&&images[1].onerror===null});
   }finally{window.Image=RealImage;}
  }
  return results;
 });
 assert.ok(outputCleanup.every(r=>r.sourceCleared&&r.outputCleared&&r.handlersCleared&&!r.outcome.unexpected));
 assert.equal(outputCleanup[0].outcome.name,'AbortError');assert.ok(outputCleanup[0].elapsed<500);assert.equal(outputCleanup[1].outcome.message,'Mask bitmap decode failed');assert.equal(outputCleanup[2].outcome.message,'Mask bitmap decode timeout');assert.ok(outputCleanup[2].elapsed>=1200&&outputCleanup[2].elapsed<2500);
 record('output decode cancellation, failure and shared deadline release both images; late completion cannot revive them',{outputCleanup});
 if(process.env.MASK_PADDING_REAL_SEGMENT){
  const {decodeMaskSegment}=await import('../app/src/player/danmakuMask.js');
  const frames=decodeMaskSegment(new Uint8Array(readFileSync(process.env.MASK_PADDING_REAL_SEGMENT)),0,10000).filter((_,i)=>i%30===0).slice(0,10);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  const durations=await page.evaluate(async frames=>{const {prepareDanmakuMaskImage}=await import('/src/player/danmakuMaskImage.js');const measurements=[];for(const frame of frames){const start=performance.now();const image=await prepareDanmakuMaskImage(frame.uri);measurements.push({ms:performance.now()-start,width:image.width,height:image.height,ratio:image.sourceProtectedRatio});image.dispose();}return measurements;},frames);
  assert.ok(durations.every(x=>x.width*x.height<=65536));record('real SVG preparation under 6x CPU throttle',{durations});
 }
 assert.deepEqual(errors,[]);
 writeFileSync(output+'/results.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
