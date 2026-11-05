// Optional local visual check with a matching public video excerpt and mask.
// No account credentials, signed media URL, or external requests are used here.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const video=readFileSync(process.env.MASK_VIDEO||'/tmp/bili-mask-clip.mp4');
const mask=readFileSync(process.env.MASK_FILE||'/tmp/bili-mask-rick.webmask');
const out=process.env.MASK_REAL_OUTPUT||'/tmp/bili-mask-real';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
await page.evaluate(async()=>{
 const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:Layer}=await import('/src/player/DanmakuLayer.jsx');
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;background:black;z-index:99999';document.body.append(host);
 const video=document.createElement('video');video.src='/mask-clip.mp4';video.muted=true;video.style.cssText='position:absolute;width:1920px;height:1080px;object-fit:contain';host.append(video);window.__realMaskVideo=video;
 await new Promise((r,j)=>{const timeout=setTimeout(()=>j(Error('Video readiness '+video.readyState+' network '+video.networkState+' error '+video.error?.code)),10000);video.onloadeddata=()=>{clearTimeout(timeout);r()};video.onerror=()=>{clearTimeout(timeout);j(Error('Video error '+video.error?.code))};video.preload='auto';video.load();});
 await new Promise(r=>setTimeout(r,300));video.currentTime=1;
 await new Promise((r,j)=>{const id=setTimeout(()=>j(Error('Initial seek timeout')),10000);video.onseeked=()=>{clearTimeout(id);r()};});
 const node=document.createElement('div');host.append(node);const root=createRoot(node),ref={current:video};
 root.render(React.createElement(Layer,{danmakus:[],currentTime:0,enabled:true,settings:{danmakuMask:true},videoRef:ref,maskSource:{mask_url:'https://a.bilivideo.com/cmaskboss/real.webmask'}}));
});
await page.waitForFunction(()=>window.__danmakuMaskStats?.().state==='active').catch(async e=>{console.log('mask state',await page.evaluate(()=>({stats:window.__danmakuMaskStats?.(),time:window.__realMaskVideo?.currentTime,ready:window.__realMaskVideo?.readyState,seeking:window.__realMaskVideo?.seeking,width:window.__realMaskVideo?.videoWidth})));throw e;});
await page.evaluate(()=>{
 const layer=[...document.querySelectorAll('.danmaku-container')].at(-1);
 for(let i=0;i<14;i++){const text=document.createElement('div');text.textContent='智能防挡人物 · 弹幕从人物身后经过 '.repeat(6);text.style.cssText=`position:absolute;top:${i*70}px;left:0;color:white;font-size:42px;white-space:nowrap;text-shadow:2px 2px black`;layer.append(text);}
});
const samples=[];
for(const time of [1,3,6]){
 await page.evaluate(time=>{window.__realMaskVideo.currentTime=time;},time);
 await page.waitForFunction(time=>!window.__realMaskVideo.seeking&&Math.abs(window.__realMaskVideo.currentTime-time)<.1&&window.__danmakuMaskStats?.().state==='active',time);
 await page.waitForTimeout(150);await page.screenshot({path:out+'/frame-'+time+'.png'});
 samples.push(await page.evaluate(()=>({time:window.__realMaskVideo.currentTime,width:window.__realMaskVideo.videoWidth,height:window.__realMaskVideo.videoHeight,mask:window.__danmakuMaskStats()})));
}
assert.deepEqual(errors,[]);assert.ok(samples.every(s=>s.mask.state==='active'&&s.mask.failures===0&&s.width>0));writeFileSync(out+'/results.json',JSON.stringify({samples,errors},null,2));await browser.close();console.log('PASS real decoded video with matching mask at 1, 3 and 6 seconds');
