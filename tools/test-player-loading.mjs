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
 configure(){} addEventListener(){} getNetworkingEngine(){return {registerRequestFilter(){},registerResponseFilter(){},addEventListener(){}}}
 getVariantTracks(){return []} retryStreaming(){window.__probe.retries++;return true} getStats(){return {}}
 async load(url,position){window.__probe.loads++;
 const mpd=await (await fetch(url)).text();window.__probe.mpds.push(mpd);window.__probe.positions.push(position);
 if(window.__mode==='premium-fallback' && /codecs="(ec-3|fLaC)"/.test(mpd)) throw Object.assign(new Error('unsupported decoder'),{category:3});
 if(window.__mode==='dolby-fallback' && /codecs="dvh1/.test(mpd)) throw Object.assign(new Error('DV decoder failed'),{category:3}); if(window.__mode==='cancel') return new Promise((r,j)=>{this.reject=j});
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
   delete window.webOS;window.__mode=mode;window.__probe={loads:0,destroyed:0,retries:0,mpds:[],positions:[]};
   localStorage.setItem('bili_settings',JSON.stringify({language:'zh',gridCols:3,subtitle:true,danmaku:true,subtitleScale:scale?.sub||1,danmakuScale:scale?.dm||1}));
   localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
   HTMLMediaElement.prototype.play=()=>Promise.resolve();
   if (/premium|dolby/.test(mode)) MediaSource.isTypeSupported=type=>!type.includes('av01');
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
  if(u.pathname.endsWith('/playurl')){
    calls.playurl++;
    const qn=mode.startsWith('dolby')?126:80;
    data={quality:qn,accept_quality:[qn,16],dash:{duration:100,video:[{id:qn,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:qn===126?'hvc1.2.4.L156.90':'avc1.640028',width:1920,height:1080,SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
    if(mode.startsWith('premium')) {
      const rep=(id,codecs)=>({id,codecs,mimeType:'audio/mp4',bandwidth:1000,baseUrl:'https://media.bilivideo.com/audio',SegmentBase:{Initialization:'0-1',indexRange:'2-3'}});
      data.dash.dolby={audio:[rep(30250,'ec-3')]};data.dash.flac={audio:rep(30251,'fLaC')};data.dash.audio=[rep(30280,'mp4a.40.2')];
      data.dash.video.push({...data.dash.video[0],codecs:'av01.0.08M.08',bandwidth:100000});
    }
  }
  if(u.pathname.endsWith('/video')&&mode.startsWith('dolby')) {
    const init=Buffer.from('000000006876633100000000687663430000000000000020647676430100104d4000000000000000000000000000000000000000','hex');
    return route.fulfill({status:206,body:init,headers:{'content-range':`bytes 0-${init.length-1}/1000`,'content-length':String(init.length),'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range, Content-Length'}});
  }
  if(u.pathname.endsWith('/v2'))data={subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/test.json'}]}};
  if(u.pathname.endsWith('/test.json'))return route.fulfill({json:{body:[{from:0,to:20,content:'字幕字号验证'}]}});
  if(u.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i><d p="1,1,28,16777215,0,0,0,0">弹幕字号验证</d></i>'});
  if(u.pathname.endsWith('/x/v2/reply')) data={page:{count:3},replies:Array.from({length:3},(_,i)=>({rpid:i+1,member:{uname:'测试用户'},content:{message:'评论内容 '+i},like:1}))};
  return route.fulfill({json:{code:0,data}});
 });
 try {await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);await fn(page,calls);results.push({name,pass:true});console.log('PASS',name);}
 catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
const open=page=>page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
await run('comment rail renders one state and keeps controls unobscured','comments',async page=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);
 await page.keyboard.press('ArrowUp');
 await page.locator('.player-btn').filter({hasText:'评论'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.comment-card').length===3);
 const text=await page.locator('.comment-rail-body').innerText();
 assert.ok(!text.includes('comments.length'), 'JSX expression must not leak as visible text');
 assert.ok(!text.includes('暂无评论'), 'empty state must not accompany loaded comments');
 const layout=await page.evaluate(()=>{
   const controls=document.querySelector('.player-controls').getBoundingClientRect();
   const rail=document.querySelector('.comment-rail-body').getBoundingClientRect();
   return {controlsRight:controls.right,railLeft:rail.left,duplicate:!!document.querySelector('.player-comment-metadata')};
 });
 assert.ok(layout.controlsRight<=layout.railLeft,JSON.stringify(layout));
 assert.equal(layout.duplicate,false,'metadata must not overlap visible controls');
 await page.screenshot({path:`${output}/comment-rail.png`});
});
await run('buffer exhaustion is visible and retried without skipping video','stall',async page=>{
 await page.clock.install();
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);
 await page.waitForTimeout(200);
 await page.evaluate(()=>{
   const v=document.querySelector('video');
   Object.defineProperty(v,'paused',{configurable:true,get:()=>false});
   Object.defineProperty(v,'readyState',{configurable:true,get:()=>1});
   v.dispatchEvent(new Event('waiting'));
 });
 await page.clock.runFor(5500);
 assert.equal(await page.locator('.player-buffering').count(),1);
 assert.ok(await page.evaluate(()=>window.__probe.retries)>0);
 assert.equal(await page.locator('video').evaluate(v=>v.currentTime),1);
 await page.evaluate(()=>{
   const v=document.querySelector('video');
   Object.defineProperty(v,'paused',{configurable:true,get:()=>true});
   v.dispatchEvent(new Event('pause'));
 });
 await page.clock.runFor(1500);
 assert.equal(await page.locator('.player-buffering').count(),0);
 const count=await page.evaluate(()=>window.__probe.retries);
 await page.clock.runFor(5000);
 assert.equal(await page.evaluate(()=>window.__probe.retries),count);
});
for (const mode of ['premium', 'premium-fallback', 'dolby', 'dolby-fallback']) {
 await run('actual manifest and codec fallback: '+mode,mode,async page=>{
  await open(page);
  const count=mode==='premium-fallback'?3:mode==='dolby-fallback'?2:1;
  await page.waitForFunction(n=>window.__probe.loads===n,count);
  await page.waitForTimeout(300);
  const mpds=await page.evaluate(()=>window.__probe.mpds);
  assert.equal(mpds.length,count);
  assert.ok(!mpds.at(-1).includes('av01'), 'unsupported higher bitrate AV1 must not win');
  if(mode==='premium') assert.match(mpds[0],/codecs="ec-3"/);
  if(mode==='premium-fallback') {
    assert.match(mpds[0],/codecs="ec-3"/);assert.match(mpds[1],/codecs="fLaC"/);assert.match(mpds[2],/codecs="mp4a.40.2"/);
  }
  if(mode.startsWith('dolby')) {
    assert.match(mpds[0],/codecs="dvh1.08.09"/);
    if(mode==='dolby-fallback') assert.match(mpds[1],/codecs="hvc1.2.4.L156.90"/);
  }
  assert.equal(await page.locator('.player-page .loading').count(),0);
 });
}

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
