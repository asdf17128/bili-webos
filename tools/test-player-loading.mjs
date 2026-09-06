// Browser failure-path tests with the real React player/API and a controlled
// decoder. Actual decoding is covered separately by the simulator + TV suites.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.LOADING_TEST_OUTPUT || '/tmp/bili-player-loading';
await mkdir(output, { recursive:true });
const browser = await chromium.launch();
const results = [];
const stub = `class Player {
 static isBrowserSupported(){return true}
 async attach(v){this.video=v}
 configure(){} addEventListener(){} getNetworkingEngine(){return {registerRequestFilter(){}}}
 getVariantTracks(){return []} retryStreaming(){} getStats(){return {}}
 async load(){window.__probe.loads++; if(window.__mode==='cancel') return new Promise((r,j)=>{this.reject=j});
 if(window.__mode==='network') throw Object.assign(new Error('network unavailable'),{code:1001,category:1});
 if(window.__mode==='retry'&&window.__probe.loads===1) throw Object.assign(new Error('transient network'),{code:1001,category:1});
 Object.defineProperty(this.video,'currentTime',{configurable:true,get:()=>1,set:()=>{}});
 Object.defineProperty(this.video,'duration',{configurable:true,get:()=>100});
 }
 async destroy(){this.reject?.(Object.assign(new Error('load interrupted'),{code:7000}));window.__probe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;
async function run(name, mode, fn, scale) {
 if(process.env.LOADING_FILTER&&!new RegExp(process.env.LOADING_FILTER).test(name))return;
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(({mode,scale})=>{
   delete window.webOS;window.__mode=mode;window.__probe={loads:0,destroyed:0};
   localStorage.setItem('bili_settings',JSON.stringify({language:'zh',gridCols:3,subtitle:true,danmaku:true,subtitleScale:scale?.sub||1,danmakuScale:scale?.dm||1}));
   localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
   HTMLMediaElement.prototype.play=()=>Promise.resolve();
 },{mode,scale});
 const page=await context.newPage();page.setDefaultTimeout(7000);
 const calls={playurl:0,info:0};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('shaka-player'))return route.fulfill({contentType:'application/javascript',body:stub});
  if(u.port==='5173')return route.continue();
  if(u.port==='9528')return route.abort();
  let data={};
  if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view')){calls.info++;if(mode==='slow-info')await new Promise(r=>setTimeout(r,1200));data={aid:1,cid:2,bvid:'BVtest',pages:[{cid:2}],title:'加载回归',owner:{mid:1,name:'测试'},stat:{}};}
  if(u.pathname.endsWith('/playurl')){calls.playurl++;data={quality:80,accept_quality:[80,16],dash:{duration:100,video:[{id:80,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:'avc1.640028',width:1920,height:1080,SegmentBase:{Initialization:'0-1',indexRange:'2-3'}}],audio:[]}};}
  if(u.pathname.endsWith('/v2'))data={subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/test.json'}]}};
  if(u.pathname.endsWith('/test.json'))return route.fulfill({json:{body:[{from:0,to:20,content:'字幕字号验证'}]}});
  if(u.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i><d p="1,1,28,16777215,0,0,0,0">弹幕字号验证</d></i>'});
  return route.fulfill({json:{code:0,data}});
 });
 try {await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);await fn(page,calls);results.push({name,pass:true});console.log('PASS',name);}
 catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
const open=page=>page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
await run('cancelled load stops retries and releases the player','cancel',async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);
 await page.keyboard.press('Escape');await page.waitForTimeout(1600);
 assert.equal(await page.locator('.player-page').count(),0);
 assert.equal(calls.playurl,1);assert.equal(await page.evaluate(()=>window.__probe.loads),1);
});
await run('leaving while video information is pending prevents later streaming','slow-info',async(page,calls)=>{
 await open(page);await page.waitForTimeout(400);await page.keyboard.press('Escape');await page.waitForTimeout(1500);
 assert.equal(calls.playurl,0);assert.equal(await page.evaluate(()=>window.__probe.loads),0);
});
await run('network failure stops after two outer attempts instead of trying every quality','network',async(page,calls)=>{
 await open(page);await page.waitForTimeout(2000);assert.equal(calls.playurl,2);
 assert.equal(await page.locator('.player-page .loading').count(),0);
});
await run('transient network failure can recover on the second attempt','retry',async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===2);
 await page.waitForTimeout(300);assert.equal(calls.playurl,2);assert.equal(await page.locator('.player-page .loading').count(),0);
});
for(const [name,dm,sub] of [['small',.8,.85],['normal',1,1],['large',1.3,1.2],['largest',1.6,1.4]]){
 await run('actual danmaku and subtitle font sizes: '+name,'fonts',async(page)=>{
  await open(page);await page.locator('.danmaku-item').first().waitFor();await page.locator('.subtitle-text').waitFor();
  assert.equal(await page.locator('.danmaku-item').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),Math.round(28*dm));
  assert.equal(await page.locator('.subtitle-text').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),Math.round(34*sub));
 },{dm,sub});
}

await run('Luna requests time out, cancel their bridge and ignore late success','fonts',async page=>{
 await page.clock.install();
 await page.evaluate(async()=>{
  const { rawFetch }=await import('/src/api/client.js');
  window.PalmServiceBridge=function(){};
  window.__luna={cancels:0,result:null};
  window.webOS={service:{request:(uri,opts)=>{window.__late=opts.onSuccess;return {cancel(){window.__luna.cancels++}}}}};
  rawFetch('https://api.bilibili.com/test',{}).then(()=>window.__luna.result='success',e=>window.__luna.result=e.message);
 });
 await page.clock.fastForward(21000);
 assert.match(await page.evaluate(()=>window.__luna.result)||'',/timeout/i);
 assert.equal(await page.evaluate(()=>window.__luna.cancels),1);
 await page.evaluate(()=>window.__late({returnValue:true,newCookies:{shouldNeverBeSaved:true}}));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bili_auth')||'{}').shouldNeverBeSaved),undefined);
});
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));await browser.close();
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
