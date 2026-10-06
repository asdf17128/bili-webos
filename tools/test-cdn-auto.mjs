// Production React request-filter integration with a minimal Shaka adapter and
// controlled decoder/API/network timing. Real Shaka and decoding run on TV.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.CDN_TEST_OUTPUT || '/tmp/bili-cdn-auto/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(), results = [];
const ALI = 'upos-sz-mirrorali.bilivideo.com', FAST = 'upos-sz-mirrorhwo1.bilivideo.com';
const shaka = `class Player {
 static isBrowserSupported(){return true}
 async attach(v){this.video=v;for(const [key,get] of Object.entries({readyState:()=>4,currentTime:()=>1,duration:()=>100,paused:()=>window.__media.paused,ended:()=>false,seeking:()=>false,buffered:()=>({length:1,start:()=>0,end:()=>1+window.__media.buffer})}))Object.defineProperty(v,key,{configurable:true,get});}
 configure(){} addEventListener(){} getVariantTracks(){return []} getStats(){return {}} retryStreaming(){}
 getNetworkingEngine(){return {registerRequestFilter:f=>window.__filter=f,registerResponseFilter(){},addEventListener:(name,fn)=>{if(name==='retry')window.__retry=fn}}}
 async load(url){window.__loads++;const mpd=await(await fetch(url)).text();window.__mpd=mpd;
 const doc=new DOMParser().parseFromString(mpd,'text/xml');
 window.__uris=Array.from(doc.querySelectorAll('AdaptationSet[contentType="video"] BaseURL')).map(x=>x.textContent);
 window.__segment=async()=>{const request={uris:window.__uris.slice()};window.__filter(1,request);window.__lastRequest=request.uris;await fetch(request.uris[0],{headers:{Range:'bytes=900000-900031'}});return request.uris;};
 if(window.__deferLoad)await new Promise(r=>window.__finishLoad=r);
 }
 async destroy(){}
}
export default {Player,polyfill:{installAll(){}}};`;
async function run(name, fn, options = {}) {
 if(process.env.CDN_FILTER&&!new RegExp(process.env.CDN_FILTER).test(name))return;
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(({options,ALI,FAST})=>{
  delete window.webOS;window.__loads=0;window.__media={paused:false,buffer:options.buffer??30};window.__deferLoad=!!options.defer;
  HTMLMediaElement.prototype.play=()=>Promise.resolve();HTMLMediaElement.prototype.pause=()=>{};
  localStorage.setItem('bili_settings',JSON.stringify({language:'zh',cdnRoute:options.route||'auto',danmaku:false}));
  localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
  if(options.cached)localStorage.setItem('bili_cdn_health_v1',JSON.stringify({version:1,entries:{[ALI]:{ok:true,rateMbps:1,at:Date.now()},[FAST]:{ok:true,rateMbps:30,at:Date.now()}}}));
 },{options,ALI,FAST});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const probes=[],segments=[];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('shaka-player'))return route.fulfill({contentType:'application/javascript',body:shaka});
  if(u.port==='5173')return route.continue();
  if(u.port==='9528')return route.abort();
  if(u.pathname.includes('/upgcxcode/')) {
   const host=u.pathname.split('/proxy/')[1]?.split('/')[0]||u.hostname;
   const range=route.request().headers().range||'bytes=0-31';
   const [start,end]=range.slice(6).split('-').map(Number);
   const row={host,start,end};(start===900000?segments:probes).push(row);
   if(options.hang&&start!==900000){await new Promise(r=>setTimeout(r,1000));}
   else if(start!==900000)await new Promise(r=>setTimeout(r,host===FAST?10:160));
   try{return await route.fulfill({status:options.fail?503:206,body:Buffer.alloc(end-start+1,7),headers:{'content-range':`bytes ${start}-${end}/4000000`,'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range'}});}catch{return;}
  }
  let data={};
  if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view'))data={aid:1,cid:2,bvid:'BVtest',pages:[{cid:2}],title:'自动线路验证',owner:{mid:1,name:'测试'},stat:{}};
  if(u.pathname.endsWith('/playurl'))data={quality:80,accept_quality:[80],dash:{duration:100,video:[{id:80,bandwidth:1000,baseUrl:`https://${ALI}/upgcxcode/fixture.m4s?upsig=fixture%2Fonly&x=1&x=2`,codecs:'avc1.640028',width:1920,height:1080,SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
  return route.fulfill({json:{code:0,data}});
 });
 try{
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);
  await page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));await page.waitForFunction(()=>window.__uris?.length);
  await fn(page,{probes,segments});results.push({name,pass:true});console.log('PASS',name);
 }catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
await run('cached fastest route reaches actual media request without reloading',async(page,{segments})=>{
 const urls=await page.evaluate(()=>window.__segment());
 assert.ok(urls[0].includes(FAST),urls[0].split('?')[0]);assert.equal(segments[0].host,FAST);
 assert.ok(urls.some(u=>u.includes(ALI)));assert.equal(await page.evaluate(()=>window.__loads),1);
},{cached:true,buffer:0});
await run('cold start stays immediate then spare-buffer probes improve later requests',async(page,{probes,segments})=>{
 await page.evaluate(()=>window.__segment());assert.equal(segments[0].host,ALI);
 await page.waitForFunction(host=>window.__cdnAuto?.()?.candidates?.find(c=>c.host===host)?.ok,FAST);
 await page.evaluate(()=>window.__segment());assert.equal(segments[1].host,FAST);
 assert.equal(await page.evaluate(()=>window.__loads),1);
 assert.ok(probes.filter(x=>x.host===FAST).length===2);
 const cache=await page.evaluate(()=>localStorage.getItem('bili_cdn_health_v1'));
 assert.ok(!/upsig|fixture|https|SESSDATA/.test(cache));
});
await run('pending load and low buffer do not trigger probes; pause enables them',async(page,{probes})=>{
 await page.waitForTimeout(1300);assert.equal(probes.length,0);
 await page.evaluate(()=>window.__finishLoad());await page.waitForTimeout(1300);assert.equal(probes.length,0);
 await page.evaluate(()=>window.__media.paused=true);
 await page.waitForFunction(()=>window.__cdnAuto?.()?.candidates?.some(c=>c.ok!==null));
 assert.ok(probes.length>=2);
},{defer:true,buffer:0});
await run('manual CDN keeps priority and avoids automatic probes',async(page,{probes,segments})=>{
 await page.evaluate(()=>window.__segment());await page.waitForTimeout(1500);
 assert.equal(segments[0].host,ALI);assert.equal(probes.length,0);
},{cached:true,route:'ali'});
await run('all probe failures retain original media route',async(page,{segments})=>{
 await page.waitForFunction(()=>window.__cdnAuto?.()?.candidates?.every(c=>c.ok===false));
 await page.evaluate(()=>window.__segment());assert.equal(segments[0].host,ALI);
},{fail:true});
await run('network reconnect invalidates stale cached winner',async(page,{segments})=>{
 await page.evaluate(()=>window.__segment());assert.equal(segments[0].host,FAST);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.evaluate(()=>window.__segment());assert.equal(segments[1].host,ALI);
},{cached:true,buffer:0});
await run('exit cancels in-flight probe without caching a failure',async(page,{probes})=>{
 await page.waitForFunction(()=>window.__cdnAuto?.()?.state==='testing');
 await page.keyboard.press('Escape');await page.waitForTimeout(1800);
 assert.equal(await page.locator('.player-page').count(),0);
 assert.equal(probes.length,1);
 assert.equal(await page.evaluate(()=>localStorage.getItem('bili_cdn_health_v1')),null);
},{hang:true});
await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
console.log(`${results.filter(x=>x.pass).length}/${results.length} passed`);if(results.some(x=>!x.pass))process.exitCode=1;
