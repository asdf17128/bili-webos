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
 configure(){} addEventListener(){} getNetworkingEngine(){return this.net||(this.net={registerRequestFilter(f){this.request=f},registerResponseFilter(f){this.response=f},addEventListener(n,f){this.retry=f}})}
 getVariantTracks(){return []} retryStreaming(){window.__probe.retries++;return true} getStats(){return {}}
 async load(url,position){window.__probe.loads++;
 const mpd=await (await fetch(url)).text();window.__probe.mpds.push(mpd);window.__probe.positions.push(position);
 if(window.__mode==='premium-fallback' && /codecs="(ec-3|fLaC)"/.test(mpd)) throw Object.assign(new Error('unsupported decoder'),{category:3});
 if(window.__mode==='dolby-fallback' && /codecs="dvh1/.test(mpd)) throw Object.assign(new Error('DV decoder failed'),{category:3}); if(window.__mode==='cancel') return new Promise((r,j)=>{this.reject=j});
 if(window.__mode==='network') throw Object.assign(new Error('network unavailable'),{code:1001,category:1});
 if(window.__mode==='retry'&&window.__probe.loads===1) throw Object.assign(new Error('transient network'),{code:1001,category:1});
 if(window.__mode==='trace-media'){
 this.net.request(1,{uris:['https://media.bilivideo.com/video']});
 this.net.retry({error:{code:1001,data:['https://media.bilivideo.com/video']}});
 await new Promise(r=>setTimeout(r,400));
 this.net.response(1,{timeMs:400,uri:'https://media.bilivideo.com/video'}, {stream:{type:'video'}});
 this.video.dispatchEvent(new Event('loadedmetadata'));
 await new Promise(r=>setTimeout(r,650));
 }
 Object.defineProperty(this.video,'currentTime',{configurable:true,get:()=>1,set:()=>{}});
 Object.defineProperty(this.video,'duration',{configurable:true,get:()=>100});
 const ready=()=>{Object.defineProperty(this.video,'readyState',{configurable:true,get:()=>4});this.video.dispatchEvent(new Event('loadeddata'));};
 if(window.__mode.startsWith('frame-'))window.__releaseFrame=ready;else ready();
 }
 async destroy(){this.reject?.(Object.assign(new Error('load interrupted'),{code:7000}));window.__probe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;
async function run(name, mode, fn, scale) {
 if(process.env.LOADING_FILTER&&!new RegExp(process.env.LOADING_FILTER).test(name))return;
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(({mode,scale})=>{
   delete window.webOS;window.__mode=mode;window.__probe={loads:0,destroyed:0,retries:0,mpds:[],positions:[]};
   localStorage.setItem('bili_settings',JSON.stringify({language:'zh',uiScale:scale?.ui||1,gridCols:3,subtitle:true,danmaku:true,subtitleScale:scale?.sub||1,danmakuScale:scale?.dm||1}));
   if(mode.startsWith('layout'))localStorage.setItem('bili_auth',JSON.stringify({SESSDATA:'fixture'}));
   localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
   HTMLMediaElement.prototype.play=function(){if(this.readyState>=2)this.dispatchEvent(new Event('playing'));return Promise.resolve()};
   if (/premium|dolby/.test(mode)) MediaSource.isTypeSupported=type=>!type.includes('av01');
 },{mode,scale});
 const page=await context.newPage();page.setDefaultTimeout(7000);
 const calls={playurl:0,info:0,meta:0,extras:0,events:[]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('shaka-player')) { if(mode==='startup-overlap')await new Promise(r=>setTimeout(r,650));calls.events.push({type:'shaka',at:Date.now()});return route.fulfill({contentType:'application/javascript',body:stub}); }
  if(u.port==='5173') {
    if(mode==='layout-legacy' && /\.css$/.test(u.pathname)) {
      const response=await route.fetch();
      return route.fulfill({response,body:(await response.text()).replace('@supports not (display: grid)','@supports (display: grid)')});
    }
    return route.continue();
  }
  if(u.port==='9528')return route.abort();
  if(calls.fail)return route.abort();
  let data={};
  if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view')){calls.info++;calls.events.push({type:'view',at:Date.now()});if(mode==='slow-info')await new Promise(r=>setTimeout(r,1200));data={aid:1,cid:2,bvid:'BVtest',pages:mode==='startup-part'?[{cid:2},{cid:3}]:[{cid:2}],title:mode.startsWith('layout')?'日本有钱人的小别墅能有多离谱！超迷你设计成这样就问你敢住吗':'加载回归',owner:{mid:1,name:mode.startsWith('layout')?'11区小豪的故事':'测试'},pubdate:1790323200,stat:{}};}
  if(u.pathname.endsWith('/playurl')){
    calls.playurl++;calls.events.push({type:'playurl',cid:u.searchParams.get('cid'),at:Date.now()});if(mode.startsWith('startup'))await new Promise(r=>setTimeout(r,500));
    const qn=mode.startsWith('dolby')?126:80;
    data={quality:qn,accept_quality:[qn,16],dash:{duration:100,video:[{id:qn,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:qn===126?'hvc1.2.4.L156.90':'avc1.640028',width:1920,height:1080,frameRate:mode==='dolby-120'?'120000/1001':mode==='dolby-unknown'?'':'60000/1001',SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
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
  if(/videoshot|list.so|archive\/related/.test(u.pathname))calls.extras++;
  if(u.pathname.endsWith('/v2')) { calls.meta++;calls.events.push({type:'meta-start',cid:u.searchParams.get('cid'),at:Date.now()});if(mode.startsWith('startup'))await new Promise(r=>setTimeout(r,500));calls.events.push({type:'meta-end',at:Date.now()});if(mode==='startup-meta-error' && calls.meta===1)return route.fulfill({json:{code:-352}});data={last_play_cid:mode==='startup-part'?3:2,last_play_time:12000,subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/test.json'}]}}; }
  if(u.pathname.endsWith('/test.json'))return route.fulfill({json:{body:[{from:0,to:20,content:'字幕字号验证'}]}});
  if(u.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i><d p="1,1,28,16777215,0,0,0,0">弹幕字号验证</d></i>'});
  if(u.pathname.endsWith('/archive/related') && mode.startsWith('layout'))data=Array.from({length:30},(_,i)=>({bvid:'BVrelated'+i,title:'推荐视频 '+i,owner:{name:'测试UP'},duration:553}));
  if(u.pathname.endsWith('/x/v2/reply')) data={page:{count:3},replies:Array.from({length:3},(_,i)=>({rpid:i+1,member:{uname:'测试用户'},content:{message:'评论内容 '+i},like:1}))};
  return route.fulfill({json:{code:0,data}});
 });
 try {await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);await fn(page,calls);results.push({name,pass:true});console.log('PASS',name);}
 catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
const report=page=>page.evaluate(async()=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/player/playbackHealth.js').name;return (await import(url)).getPlaybackReport()});
const open=page=>page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
for (const mode of ['layout-legacy','layout-modern']) for(const ui of [1,1.4]) await run('player shelf separates progress, controls and recommendation tabs: '+mode+' scale='+ui,mode,async page=>{
 if(mode==='layout-legacy')await page.addStyleTag({content:'.player-controls,.panel-tab-row {gap:0!important}'});
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);await page.waitForTimeout(200);
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
 await page.waitForFunction(()=>document.querySelectorAll('.related-card').length>=12);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='1');
 const layout=await page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
  return {progress:box('.player-progress-bar'),buttons:box('.player-btns'),tabs:box('.panel-tab-row'),title:box('.player-title'),firstButton:box('.player-btn'),grid:box('.related-grid')};
 });
 await page.screenshot({path:output+'/'+mode+'-'+ui+'.png'});
 assert.ok(layout.progress.height>=6,JSON.stringify(layout));
 assert.ok(layout.buttons.top>=layout.progress.bottom+8,JSON.stringify(layout));
 assert.ok(layout.tabs.top>=layout.buttons.bottom+8,JSON.stringify(layout));
 assert.ok(layout.buttons.height>=layout.firstButton.height,JSON.stringify(layout));
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');
 await page.waitForFunction(()=>{const b=document.querySelector('.player-btn.focused'),c=document.querySelector('.player-controls');if(!b)return false;const x=b.getBoundingClientRect(),y=c.getBoundingClientRect();return x.top>=y.top&&x.bottom<=y.bottom;});
}, {ui});
for (const mode of ['frame-ready','frame-cancel']) await run('auxiliary requests wait for real media data: '+mode,mode,async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>!!window.__releaseFrame);await page.waitForTimeout(250);
 assert.equal(calls.meta,0);assert.equal(calls.extras,0);
 if(mode==='frame-cancel')await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__releaseFrame());await page.waitForTimeout(350);
 if(mode==='frame-cancel'){assert.equal(calls.meta,0);assert.equal(calls.extras,0);}
 else {assert.equal(calls.meta,1);assert.ok(calls.extras>=3);}
});
await run('failed resume metadata is retried for subtitles after media data','startup-meta-error',async(page,calls)=>{
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'auto'}));
 await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(750);
 assert.equal(calls.meta,2);assert.equal(calls.playurl,1);
 assert.equal(await page.evaluate(()=>window.__probe.positions[0]),undefined);
});
for (const mode of ['startup-overlap','startup-part']) await run('startup overlaps independent requests and preserves resume: '+mode,mode,async(page,calls)=>{
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'auto'}));
 await page.waitForFunction(()=>window.__probe.loads===1);
 await page.waitForTimeout(650);
 const events=calls.events;
 const firstPu=events.find(x=>x.type==='playurl'),metaEnd=events.find(x=>x.type==='meta-end');
 assert.ok(firstPu.at<metaEnd.at,JSON.stringify(events));
 if(mode==='startup-overlap') {
   assert.ok(events.find(x=>x.type==='view').at<events.find(x=>x.type==='shaka').at,JSON.stringify(events));
   const trace=(await report(page)).startup;
   assert.ok(trace.stages.engine.ms>=600&&trace.stages.view.ms<600,JSON.stringify(trace));
   assert.ok(trace.stages.url.ms>=450&&trace.stages.resume.ms>=450,JSON.stringify(trace));
   assert.equal(calls.meta,1,'resume and subtitle metadata share the same response');
   assert.equal(calls.playurl,1);
 } else {
   assert.deepEqual(events.filter(x=>x.type==='playurl').map(x=>x.cid),['2','3'],'resume to another part must fetch that part');
   assert.equal(calls.meta,2,'chapters/subtitles belong to final part');
 }
 assert.equal(await page.evaluate(()=>window.__probe.positions[0]),12);
});
for (const mode of ['dolby-120', 'dolby-unknown']) await run('unverified Dolby frame rate keeps the original base layer: '+mode, mode, async page => {
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);
 const mpd=await page.evaluate(()=>window.__probe.mpds[0]);
 assert.match(mpd,/codecs="hvc1.2.4.L156.90"/);
 assert.doesNotMatch(mpd,/codecs="dvh1/);
 assert.match(mpd,/<Representation id="126"/);
});
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
 assert.equal((await report(page)).startup.state,'cancelled');
});
await run('leaving while video information is pending prevents later streaming','slow-info',async(page,calls)=>{
 await open(page);await page.waitForTimeout(400);await page.keyboard.press('Escape');await page.waitForTimeout(1500);
 assert.equal(calls.playurl,0);assert.equal(await page.evaluate(()=>window.__probe.loads),0);
});
await run('network failure stops after two outer attempts instead of trying every quality','network',async(page,calls)=>{
 await open(page);await page.waitForTimeout(2000);assert.equal(calls.playurl,2);
 const trace=(await report(page)).startup;assert.equal(trace.state,'failed');assert.equal(trace.stages.load.errors,2);assert.equal(trace.stages.url.count,2);assert.equal(trace.points.data,undefined);
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

await run('startup report separates slow media readiness and stays visible when diagnostics APIs fail','trace-media',async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);
 await page.waitForTimeout(1500);
 const r=await report(page),trace=r.startup;
 assert.equal(trace.state,'ready');
 assert.equal(trace.requests,1);assert.equal(trace.responses,1);assert.equal(trace.retries,1);
 assert.ok(trace.points.response-trace.points.request>=350,JSON.stringify(trace));
 assert.ok(trace.points.data-trace.points.metadata>=600,JSON.stringify(trace));
 assert.ok(trace.points.playing>=trace.points.data,JSON.stringify(trace));
 assert.ok(Math.abs(r.startupMs-trace.points.data)<=5);
 assert.equal(trace.stages.load.count,1);assert.equal(trace.stages.load.pending,0);
 await page.keyboard.press('Escape');calls.fail=true;
 await page.locator('[data-focus-id="sidebar-13-0"]').click();
 await page.locator('[data-focus-id="content-9-0"]').click();
 const summary=page.locator('.startup-summary');await summary.scrollIntoViewIfNeeded();
 assert.match(await summary.innerText(),/最近一次起播.*[0-9]+\.[0-9]+s/);
 assert.match(await summary.innerText(),/首个媒体响应.*媒体就绪.*播放事件/);
 await page.waitForFunction(()=>!!document.querySelector('.diagnostic-report svg'));
 assert.match(await page.locator('.diagnostic-panel').innerText(),/❌/);
 await page.locator('.diagnostic-panel').screenshot({path:output+'/diagnostics-api-failure.png'});
});
await run('diagnostics without a previous video explains how to obtain startup evidence','trace-empty',async(page,calls)=>{
 calls.fail=true;
 await page.locator('[data-focus-id="sidebar-13-0"]').click();
 await page.locator('[data-focus-id="content-9-0"]').click();
 assert.match(await page.locator('.startup-summary').innerText(),/先播放一个视频/);
});
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
