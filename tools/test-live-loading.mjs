// Controlled native-media events exercise the real React live player. TV
// measurements separately establish startup latency and actual playback.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output=process.env.LIVE_TEST_OUTPUT || '/tmp/bili-live-loading';
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const results=[];
async function test(name,fn,mode='normal') {
 if(process.env.LIVE_FILTER&&!new RegExp(process.env.LIVE_FILTER).test(name))return;
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(()=>{
  delete window.webOS;
  localStorage.setItem('bili_settings',JSON.stringify({language:'zh',liveQn:10000,danmaku:false}));
  window.__sources=[];
  HTMLMediaElement.prototype.canPlayType=()=> 'probably';
  HTMLMediaElement.prototype.play=()=>Promise.resolve();
  HTMLMediaElement.prototype.pause=()=>{};
  HTMLMediaElement.prototype.load=()=>{};
  Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,get(){return this.__src||'';},set(v){this.__src=v;window.__sources.push(v);}});
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);
 let infoCalls=0;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.port==='5173')return route.continue();
  if(u.port==='9528')return route.abort();
  if(u.pathname.endsWith('/getRoomPlayInfo')) {
   infoCalls++;
   if(mode==='slow')await new Promise(r=>setTimeout(r,800));
   if(mode==='empty')return route.fulfill({json:{code:0,data:{}}});
   const qn=Number(u.searchParams.get('qn')||250);
   const ladder=mode==='ladder'?[10000,400,250,150,80]:[10000,250];
   return route.fulfill({json:{code:0,data:{playurl_info:{playurl:{g_qn_desc:[{qn:10000,desc:'原画'},{qn:250,desc:'超清'}],stream:[{format:['ts','fmp4'].map(format=>({format_name:format,codec:[{codec_name:'avc',current_qn:qn,accept_qn:ladder,base_url:`/${format}.m3u8`,url_info:[{host:'https://live.bilivideo.com',extra:`?qn=${qn}`}]}]}))}]}}}}});
  }
  return route.fulfill({json:{code:0,data:{}}});
 });
 try {
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openLive);
  await fn(page,()=>infoCalls);
  results.push({name,pass:true});console.log('PASS',name);
 }catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
const open=page=>page.evaluate(()=>window.__openLive({roomid:1,title:'直播加载验证'}));
const loaded=page=>page.waitForFunction(()=>window.__sources.length>0);
await test('one request selects fast HLS without lowering saved quality',async(page,calls)=>{
 await open(page);await loaded(page);await page.waitForTimeout(200);
 assert.equal(calls(),1,'stream and quality ladder must share one response');
 assert.match(await page.evaluate(()=>window.__sources[0]),/fmp4\.m3u8\?qn=10000/);
});
await test('loading remains until actual playing event',async page=>{
 await open(page);await loaded(page);
 assert.equal(await page.locator('.loading').count(),1);
 await page.screenshot({path:`${output}/live-loading.png`});
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('playing')));
 await page.waitForFunction(()=>!document.querySelector('.loading'));
});
await test('unsupported fast HLS falls back to TS at the same quality',async page=>{
 await page.clock.install();await open(page);await loaded(page);
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'error',{configurable:true,value:{code:4,message:'unsupported container'}});v.dispatchEvent(new Event('error'));});
 await page.clock.runFor(1000);
 await page.waitForFunction(()=>window.__sources.length===2);
 const sources=await page.evaluate(()=>window.__sources);
 assert.match(sources[0],/fmp4\.m3u8\?qn=10000/);assert.match(sources[1],/ts\.m3u8\?qn=10000/);
});
await test('startup timeout cannot remain black indefinitely',async page=>{
 await page.clock.install();await open(page);await loaded(page);
 for(let i=0;i<4;i++){await page.clock.runFor(14000);await page.waitForTimeout(100);}
 await page.getByText('加载失败，按确认重试',{exact:true}).waitFor();
 assert.equal(await page.locator('.loading').count(),0);
 assert.ok(await page.evaluate(()=>window.__sources.length)<=3,'bounded initial attempts');
 await page.screenshot({path:`${output}/live-retry.png`});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.__sources.length===4);
});
await test('decode fallback keeps the original quality preference',async page=>{
 await page.clock.install();await open(page);await loaded(page);
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'error',{configurable:true,value:{code:3,message:'decode failed'}});v.dispatchEvent(new Event('error'));});
 await page.clock.runFor(1000);
 await page.waitForFunction(()=>window.__sources.length===2);
 assert.match(await page.evaluate(()=>window.__sources[1]),/qn=250/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bili_settings')).liveQn),10000);
});
await test('exit cancels a queued live retry',async(page,calls)=>{
 await page.clock.install();await open(page);await loaded(page);
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('error')));
 await page.keyboard.press('Backspace');
 await page.clock.runFor(20000);
 assert.equal(calls(),1);assert.equal(await page.locator('video').count(),0);
});
await test('startup budget preserves every decoder quality rung',async page=>{
 await page.clock.install();await open(page);await loaded(page);
 for(let i=0;i<4;i++) {
  await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'error',{configurable:true,value:{code:3}});v.dispatchEvent(new Event('error'));});
  await page.clock.runFor(4000);
  await page.waitForFunction(n=>window.__sources.length===n,i+2);
 }
 assert.match(await page.evaluate(()=>window.__sources[4]),/qn=80/);
},'ladder');
await test('late stream response after exit cannot attach media',async page=>{
 await open(page);await page.keyboard.press('Backspace');await page.waitForTimeout(1000);
 assert.equal(await page.evaluate(()=>window.__sources.length),0);
},'slow');
await test('empty play info ends with retryable error',async page=>{
 await page.clock.install();await open(page);
 for(let i=0;i<4;i++){await page.clock.runFor(4000);await page.waitForTimeout(100);}
 await page.getByText('加载失败，按确认重试',{exact:true}).waitFor();
 assert.equal(await page.locator('.loading').count(),0);
},'empty');
await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
console.log(`${results.filter(r=>r.pass).length}/${results.length} live loading tests passed`);
process.exitCode=results.some(r=>!r.pass)?1:0;
