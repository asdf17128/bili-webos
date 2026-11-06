// Optional local visual check with a matching public video excerpt and mask.
// No account credentials, signed media URL, or external requests are used here.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const video=readFileSync(process.env.MASK_VIDEO||'/tmp/bili-mask-clip.mp4');
const mask=readFileSync(process.env.MASK_FILE||'/tmp/bili-mask-rick.webmask');
const out=process.env.MASK_REAL_OUTPUT||'/tmp/bili-mask-real';mkdirSync(out,{recursive:true});
const stillTimes=process.env.MASK_STILL_TIMES?process.env.MASK_STILL_TIMES.split(',').map(Number):[1,3,6];
assert.ok(stillTimes.length&&stillTimes.every(t=>Number.isFinite(t)&&t>=0&&t<60));
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
if(process.env.MASK_CPU_RATE){const rate=Number(process.env.MASK_CPU_RATE);assert.ok(rate>=1&&rate<=20);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate});}
await page.routeWebSocket('**/*',s=>s.close());
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/mask-clip.mp4'){
  const r=route.request().headers().range;
  if(r){const parts=r.slice(6).split('-'),a=Number(parts[0]),b=parts[1]?Math.min(Number(parts[1]),video.length-1):video.length-1;return route.fulfill({status:206,body:video.subarray(a,b+1),contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${a}-${b}/${video.length}`}});}
  return route.fulfill({body:video,contentType:'video/mp4',headers:{'accept-ranges':'bytes'}});
 }
 if(u.pathname.includes('/cmaskboss/')){const [a,b]=route.request().headers().range.slice(6).split('-').map(Number);return route.fulfill({status:206,body:mask.subarray(a,b+1),contentType:'application/octet-stream',headers:{'access-control-allow-origin':'*'}});}
 if(u.origin==='http://127.0.0.1:5173')return route.continue();return route.abort();
});
await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);
await page.evaluate(async initialTime=>{
 const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:Layer}=await import('/src/player/DanmakuLayer.jsx');
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;background:black;z-index:99999';document.body.append(host);
 const video=document.createElement('video');video.src='/mask-clip.mp4';video.muted=true;video.style.cssText='position:absolute;width:1920px;height:1080px;object-fit:contain';host.append(video);window.__realMaskVideo=video;
 await new Promise((r,j)=>{const timeout=setTimeout(()=>j(Error('Video readiness '+video.readyState+' network '+video.networkState+' error '+video.error?.code)),10000);video.onloadeddata=()=>{clearTimeout(timeout);r()};video.onerror=()=>{clearTimeout(timeout);j(Error('Video error '+video.error?.code))};video.preload='auto';video.load();});
 await new Promise(r=>setTimeout(r,300));video.currentTime=initialTime;
 await new Promise((r,j)=>{const id=setTimeout(()=>j(Error('Initial seek timeout')),10000);video.onseeked=()=>{clearTimeout(id);r()};});
 const node=document.createElement('div');host.append(node);const root=createRoot(node),ref={current:video};
 const props={danmakus:[],currentTime:0,enabled:true,videoRef:ref,maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/real.webmask'},onMaskStatus:value=>{window.__realMaskStatus=value}};window.__setRealMask=enabled=>root.render(React.createElement(Layer,{...props,settings:{danmakuMask:enabled}}));window.__setRealMask(true);
},stillTimes[0]);
await page.waitForFunction(()=>(['active','unprotected'].includes(window.__danmakuMaskStats?.().state)||window.__realMaskStatus==='gap')).catch(async e=>{console.log('mask state',await page.evaluate(()=>({stats:window.__danmakuMaskStats?.(),time:window.__realMaskVideo?.currentTime,ready:window.__realMaskVideo?.readyState,seeking:window.__realMaskVideo?.seeking,width:window.__realMaskVideo?.videoWidth})));throw e;});
await page.evaluate(()=>{
 window.__addMaskTestText=()=>{const layer=[...document.querySelectorAll('.danmaku-container')].at(-1);layer.textContent='';
 for(let i=0;i<14;i++){const text=document.createElement('div');text.textContent='智能防挡人物 · 弹幕从人物身后经过 '.repeat(6);text.style.cssText=`position:absolute;top:${i*70}px;left:0;color:white;font-size:42px;white-space:nowrap;text-shadow:2px 2px black`;layer.append(text);}};window.__addMaskTestText();
});
const samples=[],loopSamples=[],performanceComparison=[];
for(const time of stillTimes){
 await page.evaluate(time=>{window.__realMaskVideo.currentTime=time;},time);
 await page.waitForFunction(time=>!window.__realMaskVideo.seeking&&Math.abs(window.__realMaskVideo.currentTime-time)<.1&&(['active','unprotected'].includes(window.__danmakuMaskStats?.().state)||window.__realMaskStatus==='gap'),time);
 await page.waitForTimeout(150);await page.screenshot({path:out+'/frame-'+time+'.png'});
 if(process.env.MASK_CAPTURE_BASE==='1'){
  await page.evaluate(()=>{document.querySelectorAll('.danmaku-container').forEach(e=>e.style.visibility='hidden');});
  await page.screenshot({path:out+'/base-'+time+'.png'});
  await page.evaluate(()=>{document.querySelectorAll('.danmaku-container').forEach(e=>e.style.visibility='');});
 }
 samples.push(await page.evaluate(()=>({time:window.__realMaskVideo.currentTime,width:window.__realMaskVideo.videoWidth,height:window.__realMaskVideo.videoHeight,mask:window.__danmakuMaskStats(),maskStatus:window.__realMaskStatus})));
}
if(process.env.MASK_REAL_SOAK_SECONDS){
 const seconds=Number(process.env.MASK_REAL_SOAK_SECONDS);assert.ok(seconds>0&&seconds<=3600);
 const loopEnd=Number(process.env.MASK_LOOP_END||0);assert.ok(!loopEnd||(loopEnd>1&&loopEnd<=60));
 await page.evaluate(loopEnd=>{const v=window.__realMaskVideo;v.loop=!loopEnd;if(loopEnd)v.addEventListener('timeupdate',()=>{if(!v.seeking&&v.currentTime>=loopEnd)v.currentTime=.25;});return v.play();},loopEnd);
 const end=Date.now()+seconds*1000;let prior=null,advances=0;
 while(Date.now()<end){
  await page.waitForTimeout(1000);
  const sample=await page.evaluate(()=>({time:window.__realMaskVideo.currentTime,paused:window.__realMaskVideo.paused,error:window.__realMaskVideo.error?.code||0,ready:window.__realMaskVideo.readyState,mask:window.__danmakuMaskStats(),quality:window.__realMaskVideo.getVideoPlaybackQuality().droppedVideoFrames,totalFrames:window.__realMaskVideo.getVideoPlaybackQuality().totalVideoFrames}));
  assert.equal(sample.error,0);assert.equal(sample.paused,false);assert.equal(sample.mask.failures,0);assert.ok(sample.mask.cached<=2);
  if(process.env.MASK_SCREENSHOTS==='1'){
   sample.screenshot=`playing-${String(loopSamples.length+1).padStart(3,'0')}.png`;
   await page.screenshot({path:out+'/'+sample.screenshot});
   sample.timeAfterScreenshot=await page.evaluate(()=>window.__realMaskVideo.currentTime);
  }
  if(prior!==null&&Math.abs(sample.time-prior)>.1)advances++;prior=sample.time;loopSamples.push(sample);
 }
 assert.ok(loopSamples.length>=Math.floor(seconds*.5));assert.ok(advances>=Math.max(1,(loopSamples.length-1)*.9));await page.evaluate(()=>window.__realMaskVideo.pause());
 console.log('PASS real video loop',seconds,'seconds, progress samples',advances);
}
if(process.env.MASK_PERF_SECONDS){
 const seconds=Number(process.env.MASK_PERF_SECONDS);assert.ok(seconds>=5&&seconds<=20);
 for(const enabled of [false,true]){
  await page.evaluate(enabled=>{window.__realMaskVideo.pause();window.__realMaskVideo.currentTime=3;window.__setRealMask(enabled);},enabled);
  await page.waitForFunction(()=>!window.__realMaskVideo.seeking);
  if(enabled)await page.waitForFunction(()=>['active','unprotected'].includes(window.__danmakuMaskStats?.().state)||window.__realMaskStatus==='gap');
  else await page.waitForFunction(()=>!window.__danmakuMaskStats);
  await page.waitForTimeout(200);await page.evaluate(()=>{window.__addMaskTestText();return window.__realMaskVideo.play();});
  const get=()=>page.evaluate(()=>{const v=window.__realMaskVideo,q=v.getVideoPlaybackQuality();return {time:v.currentTime,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,error:v.error?.code||0,mask:window.__danmakuMaskStats?.()};});
  const start=await get();await page.waitForTimeout(seconds*1000);const end=await get();
  await page.evaluate(()=>window.__realMaskVideo.pause());assert.equal(end.error,0);assert.ok(end.time-start.time>seconds*.9);
  performanceComparison.push({maskEnabled:enabled,durationSeconds:seconds,totalFrames:end.total-start.total,droppedFrames:end.dropped-start.dropped,mask:end.mask});
 }
 console.log('PERF',JSON.stringify(performanceComparison));
}
assert.deepEqual(errors,[]);assert.ok(samples.every(s=>(['active','unprotected'].includes(s.mask.state)||s.maskStatus==='gap')&&s.mask.failures===0&&s.width>0));writeFileSync(out+'/results.json',JSON.stringify({samples,loopSamples,performanceComparison,cpuRate:Number(process.env.MASK_CPU_RATE||1),errors},null,2));await browser.close();console.log('PASS decoded-video runtime checks at',stillTimes.join(', '),'seconds; visual inspection is still required');
