// Browser failure-path tests with the real React player/API and a controlled
// decoder. Actual decoding is covered separately by the simulator + TV suites.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const baseURL = process.env.LOADING_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.LOADING_TEST_OUTPUT || '/tmp/bili-player-loading';
await mkdir(output, { recursive:true });
const browser = await chromium.launch();
const results = [];
const stub = `class Player {
 static isBrowserSupported(){return true}
 async attach(v){this.video=v}
 async unload(initializeMediaSource=true){window.__probe.unloads=(window.__probe.unloads||0)+1;window.__probe.unloading=true;if(window.__holdUnload)await new Promise(r=>window.__releaseUnload=r);if(window.__nativeClock){window.__nativeClock.position=0;window.__nativeClock.paused=true}this.video.__fixtureSrc='';Object.defineProperty(this.video,'readyState',{configurable:true,get:()=>0});window.__probe.unloading=false}
 configure(config){window.__probe.configs=(window.__probe.configs||[]).concat(config)} addEventListener(n,f){(this.events||(this.events={}))[n]=f} getNetworkingEngine(){return this.net||(this.net={registerRequestFilter(f){this.request=f},registerResponseFilter(f){this.response=f},addEventListener(n,f){this.retry=f}})}
 getVariantTracks(){return []} retryStreaming(){window.__probe.retries++;return true} getStats(){return {}}
 async load(url,position,mime){const stalePausedNative=window.__mode==='native-speed-paused-boundary'&&this.video.__fixtureSrc?.startsWith('http')&&this.video.paused&&this.video.readyState>=1;if(window.__probe.unloading)window.__probe.loadDuringUnload=true;window.__probe.loads++;window.__probe.mimes.push(mime);
 if(window.__mode==='runtime-media'&&window.__probe.loads===2)await new Promise(resolve=>window.__releasePausedRecovery=resolve);
 if(window.__mode==='quality-restore'&&window.__probe.loads===2)throw Object.assign(new Error('network failed'),{category:1});
 const mpd=await (await fetch(url)).text();window.__probe.mpds.push(mpd);window.__probe.positions.push(position);
 if(window.__mode==='codec-fallback' && /codecs="hvc1/.test(mpd)){this.events.error({detail:{category:3,code:3016,severity:2}});throw Object.assign(new Error('HEVC decode failed'),{category:3});}
 if(window.__mode==='premium-fallback' && /codecs="(ec-3|fLaC)"/.test(mpd)) throw Object.assign(new Error('unsupported decoder'),{category:3});
 if(window.__mode==='dolby-fallback' && /codecs="dvh1/.test(mpd)) throw Object.assign(new Error('DV decoder failed'),{category:3}); if(window.__mode==='cancel') return new Promise((r,j)=>{this.reject=j});
 if(window.__mode==='network') throw Object.assign(new Error('network unavailable'),{code:1001,category:1});
 if(window.__mode==='retry'&&window.__probe.loads===1) throw Object.assign(new Error('transient network'),{code:1001,category:1});
 if(window.__mode==='trace-media'){
 this.net.request(1,{uris:['https://media.bilivideo.com/video']});
 this.net.retry({error:{code:1001,data:['https://media.bilivideo.com/video',502,'secret',{},1]}});
 await new Promise(r=>setTimeout(r,400));
 this.net.response(1,{timeMs:400,uri:'https://media.bilivideo.com/video'}, {stream:{type:'video'}});
 this.video.dispatchEvent(new Event('loadedmetadata'));
 this.events?.segmentappended?.({contentType:'video'});
 await new Promise(r=>setTimeout(r,650));
 }
 if(window.__mode==='native-speed-paused-boundary'&&window.__nativeClock){window.__nativeClock.position=stalePausedNative?0:position||0;Object.defineProperty(this.video,'currentTime',{configurable:true,get:()=>window.__nativeClock.position,set:value=>window.__nativeClock.position=value});}else Object.defineProperty(this.video,'currentTime',{configurable:true,get:()=>1,set:()=>{}});
 Object.defineProperty(this.video,'duration',{configurable:true,get:()=>100});
 const ready=()=>{Object.defineProperty(this.video,'readyState',{configurable:true,get:()=>4});this.video.dispatchEvent(new Event('loadeddata'));if(window.__mode==='native-speed-paused-boundary')this.video.dispatchEvent(new Event('loadedmetadata'));};
 if(window.__mode.startsWith('frame-'))window.__releaseFrame=ready;else ready();
 }
 async destroy(){this.reject?.(Object.assign(new Error('load interrupted'),{code:7000}));window.__probe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;
async function run(name, mode, fn, scale) {
 if(process.env.LOADING_FILTER&&!new RegExp(process.env.LOADING_FILTER).test(name))return;
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(({mode,scale})=>{
   delete window.webOS;window.__mode=mode;window.__probe={loads:0,destroyed:0,retries:0,mpds:[],positions:[],mimes:[]};
   localStorage.setItem('bili_settings',JSON.stringify({language:mode.startsWith('subtitle-lifecycle')?'en':'zh',uiScale:scale?.ui||1,gridCols:3,subtitle:true,danmaku:!mode.startsWith('subtitle-lifecycle'),subtitleScale:scale?.sub||1,danmakuScale:scale?.dm||1,quality:80,qualityMode:'manual'}));
   if(mode.startsWith('member-')){const settings=JSON.parse(localStorage.getItem('bili_settings'));delete settings.qualityMode;localStorage.setItem('bili_settings',JSON.stringify(settings));}
   if(mode.startsWith('member-')||mode.startsWith('layout')||mode.startsWith('follow'))localStorage.setItem('bili_auth',JSON.stringify({SESSDATA:'fixture'}));
   localStorage.setItem('bili_perfopt',JSON.stringify({prefetchPage:false,warmPlayer:false}));
   HTMLMediaElement.prototype.play=function(){if(this.readyState>=2)this.dispatchEvent(new Event('playing'));return Promise.resolve()};
   if (/premium|dolby|codec|resolution/.test(mode)) MediaSource.isTypeSupported=type=>!type.includes('av01');
 },{mode,scale});
 const page=await context.newPage();page.setDefaultTimeout(7000);
 const calls={playurl:0,info:0,meta:0,extras:0,events:[]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('shaka-player')) { if(mode==='startup-overlap')await new Promise(r=>setTimeout(r,650));calls.events.push({type:'shaka',at:Date.now()});return route.fulfill({contentType:'application/javascript',body:stub}); }
  if(u.origin===new URL(baseURL).origin) {
    if(mode==='layout-legacy' && /\.css$/.test(u.pathname)) {
      const response=await route.fetch();
      return route.fulfill({response,body:(await response.text()).replace('@supports not (display: grid)','@supports (display: grid)')});
    }
    return route.continue();
  }
  if(u.port==='9528')return route.abort();
  if(calls.fail)return route.abort();
  let data={};
  if(u.pathname.endsWith('/x/relation'))data={attribute:0};
  if(u.pathname.endsWith('/x/relation/modify')) { calls.follow=(calls.follow||0)+1; const form=new URLSearchParams(route.request().postData()); assert.equal(form.get('fid'),'1'); assert.equal(form.get('act'),'1'); }
  if(u.pathname.endsWith('/nav'))data={...(mode.startsWith('member-')?{isLogin:true,uname:'Member fixture',mid:1,vipStatus:1,vipType:2}:{}),wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view')){calls.info++;calls.events.push({type:'view',at:Date.now()});if(mode==='slow-info')await new Promise(r=>setTimeout(r,1200));data={aid:1,cid:2,bvid:'BVtest',pages:mode==='startup-part'?[{cid:2},{cid:3}]:[{cid:2}],title:mode.startsWith('layout')?'日本有钱人的小别墅能有多离谱！超迷你设计成这样就问你敢住吗':'加载回归',owner:{mid:1,name:mode.startsWith('layout')?'11区小豪的故事':'测试'},pubdate:1790323200,stat:{}};}
  if(u.pathname.endsWith('/playurl')){
    calls.playurl++;(calls.requestedQualities||(calls.requestedQualities=[])).push(Number(u.searchParams.get('qn')));calls.events.push({type:'playurl',cid:u.searchParams.get('cid'),at:Date.now()});if(mode.startsWith('startup'))await new Promise(r=>setTimeout(r,500));
    const qn=mode==='quality-restore'||mode.startsWith('native-speed')?Number(u.searchParams.get('qn')||80):mode==='resolution-8k'?127:mode==='codec-fallback'?120:mode.startsWith('dolby')?126:80;
    data={quality:qn,accept_quality:[qn,16],dash:{duration:100,video:[{id:qn,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:qn===126?'hvc1.2.4.L156.90':'avc1.640028',width:1920,height:1080,frameRate:mode==='dolby-120'?'120000/1001':mode==='dolby-unknown'?'':'60000/1001',SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
    if(mode.startsWith('member-')) {
      const requested=Number(u.searchParams.get('qn'));data.quality=requested===80?80:120;data.accept_quality=mode==='member-tall'?[127,126,125,120,116,112,100,80,74,64,32,16]:[120,80];
      data.dash.video=[{...data.dash.video[0],id:120,width:3840,height:2160},{...data.dash.video[0],id:80}];
    }
    if(mode==='dolby-signed-route') {
      data.dash.video[0].baseUrl='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/video?upsig=primary';
      data.dash.video[0].backupUrl=['https://upos-sz-mirrorhwo1.bilivideo.com/upgcxcode/native/video?upsig=native%2Bsignature'];
    }
    if(mode==='resolution-8k') {
      data.dash.video[0]={...data.dash.video[0],codecs:'hvc1.1.6.L180.90',width:7680,height:4320};
      data.dash.video.push({...data.dash.video[0],id:125,codecs:'hvc1.2.4.L153.90',width:3840,height:2160});
    }
    if(mode==='codec-fallback') {
      data.dash.video[0].bandwidth=17000000;
      data.dash.video.push({...data.dash.video[0],codecs:'hvc1.1.6.L153.90',bandwidth:7800000});
    }
    if(mode.startsWith('premium')) {
      const rep=(id,codecs)=>({id,codecs,mimeType:'audio/mp4',bandwidth:1000,baseUrl:'https://media.bilivideo.com/audio',SegmentBase:{Initialization:'0-1',indexRange:'2-3'}});
      data.dash.dolby={audio:[rep(30250,'ec-3')]};data.dash.flac={audio:rep(30251,'fLaC')};data.dash.audio=[rep(30280,'mp4a.40.2')];
      data.dash.video.push({...data.dash.video[0],codecs:'av01.0.08M.08',bandwidth:100000});
    }
  }
  if(u.pathname.endsWith('/video')&&mode.startsWith('dolby')) {
    if(mode==='dolby-signed-route') {
      const signed=u.pathname.includes('/native/video')&&u.search==='?upsig=native%2Bsignature';
      calls.dolbyProbeSigned=signed;
      if(!signed)return route.fulfill({status:403,body:''});
    }
    const init=Buffer.from('000000006876633100000000687663430000000000000020647676430100104d4000000000000000000000000000000000000000','hex');
    return route.fulfill({status:206,body:init,headers:{'content-range':`bytes 0-${init.length-1}/1000`,'content-length':String(init.length),'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range, Content-Length'}});
  }
  if(/videoshot|list.so|archive\/related/.test(u.pathname))calls.extras++;
  if(u.pathname.endsWith('/v2')) { calls.meta++;calls.events.push({type:'meta-start',cid:u.searchParams.get('cid'),at:Date.now()});if(mode.startsWith('startup'))await new Promise(r=>setTimeout(r,500));calls.events.push({type:'meta-end',at:Date.now()});if(mode==='startup-meta-error' && calls.meta===1)return route.fulfill({json:{code:-352}});data={last_play_cid:mode==='startup-part'?3:2,last_play_time:12000,subtitle:{subtitles:[{lan:'zh-CN',lan_doc:'中文',subtitle_url:'https://aisubtitle.hdslb.com/test.json'}]}}; }
  if(u.pathname.endsWith('/test.json')){
   if(mode==='subtitle-lifecycle-body')await new Promise(r=>calls.releaseSubtitle=r);
   return route.fulfill({json:{body:mode.startsWith('subtitle-lifecycle')?Array.from({length:800},(_,i)=>({from:i,to:i+.99,content:'稳定字幕 '+i})):[{from:0,to:20,content:'字幕字号验证'}]}});
  }
  if(u.pathname.endsWith('/translate_a/t')){
   const texts=new URLSearchParams(route.request().postData()).getAll('q');
   if(texts[0]?.startsWith('稳定字幕')){
    calls.translations=(calls.translations||0)+1;
    if(mode==='subtitle-lifecycle-batches'&&!calls.translationReleased)await new Promise(r=>(calls.releaseTranslations||(calls.releaseTranslations=[])).push(r));
   }
   return route.fulfill({json:texts.map(text=>'EN:'+text)});
  }
  if(u.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i><d p="1,1,28,16777215,0,0,0,0">弹幕字号验证</d></i>'});
  if(u.pathname.endsWith('/archive/related') && mode.startsWith('layout'))data=Array.from({length:30},(_,i)=>({bvid:'BVrelated'+i,title:'推荐视频 '+i,owner:{name:'测试UP'},duration:553}));
  if(u.pathname.endsWith('/x/v2/reply')) data={page:{count:3},replies:Array.from({length:3},(_,i)=>({rpid:i+1,member:{uname:'测试用户'},content:{message:'评论内容 '+i},like:1}))};
  return route.fulfill({json:{code:0,data}});
 });
 try {await page.goto(baseURL);await page.waitForFunction(()=>!!window.__openVideo);await fn(page,calls);assert.ok((await page.evaluate(()=>window.__probe.mimes)).every(m=>'application/dash+xml'===m),'every generated MPD load, including recovery, supplies DASH MIME');results.push({name,pass:true});console.log('PASS',name);}
 catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{await context.close();}
}
const report=page=>page.evaluate(async()=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/player/playbackHealth.js').name;return (await import(url)).getPlaybackReport()});
const open=page=>page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
for(const stage of ['body','batches','success'])await run('subtitle lifecycle cancels obsolete translation: '+stage,'subtitle-lifecycle-'+stage,async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);
 const deadline=Date.now()+5000;
 if(stage==='body'){
  while(!calls.releaseSubtitle&&Date.now()<deadline)await page.waitForTimeout(20);
  assert.equal(typeof calls.releaseSubtitle,'function','subtitle body request is actually held');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('video'));
  calls.releaseSubtitle();await page.waitForTimeout(400);
  assert.equal(calls.translations||0,0,'late body must not start translation after exit');
 }else if(stage==='batches'){
  while((calls.releaseTranslations?.length||0)<4&&Date.now()<deadline)await page.waitForTimeout(20);
  assert.equal(calls.translations,4,'initial four workers reached the real translation API');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('video'));
  calls.translationReleased=true;calls.releaseTranslations.forEach(r=>r());await page.waitForTimeout(400);
  assert.equal(calls.translations,4,'exit must not schedule the remaining four batches');
  assert.equal(await page.evaluate(()=>localStorage.getItem('bili_subtr:2:en')),null,'cancelled track must not write a complete cache');
 }else{
  await page.waitForFunction(()=>document.querySelector('.subtitle-text')?.textContent.startsWith('EN:稳定字幕'));
  assert.equal(calls.translations,8);assert.ok(await page.evaluate(()=>localStorage.getItem('bili_subtr:2:en')));
 }
});
async function nativeFixture(page) {
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);
 await page.evaluate(()=>{
  window.__probe.nativeSources=[];window.__probe.rateCalls=[];window.__speedPending=[];window.__speedFailures=[];
  const source=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
  Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,get(){return this.__fixtureSrc||source.get.call(this)},set(value){this.__fixtureSrc=value;window.__probe.nativeSources.push({connected:this.isConnected,value})}});
  Object.defineProperty(HTMLMediaElement.prototype,'mediaId',{configurable:true,get(){return 'fixture-media'}});
  window.PalmServiceBridge=function(){};
  window.webOS={service:{request(uri,opts){
   let cancelled=false;const deliver=data=>{if(!cancelled)opts.onSuccess?.(data)};
   if(opts.method==='fetch'){
    const url=new URL(opts.parameters.url);
    if(url.searchParams.get('platform')==='html5'){window.__speedFailures.push(()=>deliver({returnValue:true,status:200,body:JSON.stringify({code:-1,message:'fixture html5 unavailable'})}));window.__speedPending.push(()=>deliver({returnValue:true,status:200,body:JSON.stringify({code:0,data:{durl:[{url:'https://media.bilivideo.com/native-'+window.__speedPending.length+'.mp4'}]}})}));}
    else fetch(url.href).then(r=>r.text()).then(body=>deliver({returnValue:true,status:200,body}));
   }else{if(opts.method==='setPlayRate')window.__probe.rateCalls.push(opts.parameters.playRate);queueMicrotask(()=>deliver({returnValue:true}));}
   return {cancel(){cancelled=true}};
  }}};
 });
 await page.keyboard.press('ArrowUp');
}
async function chooseSpeed(page,label) {
 await page.locator('.player-btn').filter({hasText:/倍速|^[0-9.]+x$/}).click();
 await page.locator('.quality-option').filter({hasText:new RegExp('^'+label.replace('.','\\.')+'$')}).click();
}
for(const scenario of ['exit','normal','newer-speed','new-video','quality','exit-unloading','normal-unloading','success']) await run('native speed lifecycle: '+scenario,'native-speed-'+scenario,async page=>{
 await nativeFixture(page);
 if(scenario.endsWith('unloading'))await page.evaluate(()=>window.__holdUnload=true);
 await chooseSpeed(page,'2x');await page.waitForFunction(()=>window.__speedPending.length===1);
 if(scenario.endsWith('unloading')){await page.evaluate(()=>window.__speedPending[0]());await page.waitForFunction(()=>!!window.__releaseUnload);}
 if(scenario==='exit'||scenario==='exit-unloading'){
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('video'));
 }else if(scenario==='normal'||scenario==='normal-unloading')await chooseSpeed(page,'正常');
 else if(scenario==='newer-speed'){
  await chooseSpeed(page,'1.5x');await page.waitForFunction(()=>window.__speedPending.length===2);
  await page.evaluate(()=>window.__speedPending[1]());await page.waitForFunction(()=>window.__probe.rateCalls.length===1);
 }else if(scenario==='new-video'){
  await page.evaluate(()=>window.__openVideo({bvid:'BVnext',resumeMode:'none'}));
  await page.waitForFunction(()=>window.__probe.destroyed===1&&window.__probe.loads===2);
 }else if(scenario==='quality'){
  await page.locator('.player-btn').filter({hasText:'1080P'}).click();
  await page.locator('.quality-option').filter({hasText:'360P'}).click();
  await page.waitForFunction(()=>window.__probe.loads===2);
 }
 await page.evaluate(unloading=>unloading?window.__releaseUnload():window.__speedPending[0](),scenario.endsWith('unloading'));
 await page.waitForTimeout(300);
 const observed=await page.evaluate(()=>({sources:window.__probe.nativeSources,rates:window.__probe.rateCalls,loads:window.__probe.loads,unloads:window.__probe.unloads||0}));
 if(scenario==='success'){
  assert.equal(observed.sources.length,1);assert.equal(observed.sources[0].connected,true);assert.deepEqual(observed.rates,[2]);
  await chooseSpeed(page,'正常');await page.waitForFunction(()=>window.__probe.loads===2);
 }else if(scenario==='newer-speed'){
  assert.equal(observed.sources.length,1,'older URL must not replace newer native source');assert.deepEqual(observed.rates,[1.5]);
 }else{
  assert.equal(observed.sources.length,0,'cancelled native switch must not assign a media URL: '+JSON.stringify(observed));
  assert.deepEqual(observed.rates,[]);
  if(scenario==='normal-unloading')assert.equal(observed.loads,2,'returning to 1x during unload must restore DASH');
 }
});
for(const order of ['before-unload','after-unload','normal','quality','normal-before-metadata'])for(const paused of [false,true])await run('native speed unload recovery: '+order+' paused='+paused,'native-speed-unload-recovery-'+order,async page=>{
 await nativeFixture(page);
 await page.evaluate(paused=>{
  const v=document.querySelector('video');window.__holdUnload=true;
  window.__nativeClock={position:37,paused,plays:0};
  Object.defineProperty(v,'currentTime',{configurable:true,get:()=>window.__nativeClock.position,set:value=>window.__nativeClock.position=value});
  Object.defineProperty(v,'paused',{configurable:true,get:()=>window.__nativeClock.paused});
  v.play=()=>{window.__nativeClock.paused=false;window.__nativeClock.plays++;return Promise.resolve()};
 },paused);
 await chooseSpeed(page,'2x');await page.waitForFunction(()=>window.__speedPending.length===1);
 await page.evaluate(()=>window.__speedPending[0]());await page.waitForFunction(()=>!!window.__releaseUnload);
 if(order==='normal-before-metadata'){
  await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});await page.waitForFunction(()=>window.__probe.rateCalls.length===1);
  await chooseSpeed(page,'正常');
 }else if(order==='normal'||order==='quality'){
  if(order==='normal')await chooseSpeed(page,'正常');
  else {await chooseSpeed(page,'正常');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__probe.loads),1,'replacement load waits for old unload');
  await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});
 }else{
  await chooseSpeed(page,'1.5x');await page.waitForFunction(()=>window.__speedPending.length===2);
  if(order==='before-unload'){
   await page.evaluate(()=>window.__speedFailures[1]());await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>window.__probe.loads),1,'failure recovery waits for old unload');
   await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});
  }else{
   await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});await page.waitForTimeout(100);
   await page.evaluate(()=>window.__speedFailures[1]());
  }
 }
 await page.waitForTimeout(400);
 const observed=await page.evaluate(()=>({loads:window.__probe.loads,positions:window.__probe.positions,loadDuringUnload:window.__probe.loadDuringUnload||false,sources:window.__probe.nativeSources,rates:window.__probe.rateCalls,clock:window.__nativeClock}));
 assert.equal(observed.loads,2,'latest intent must restore unloaded DASH: '+JSON.stringify(observed));
 assert.equal(observed.loadDuringUnload,false,'late unload cannot clear replacement DASH');
 assert.equal(observed.positions[1],37,'restore position captured before unload resets currentTime');
 assert.equal(observed.clock.paused,paused,'preserve user pause/play intent');
 if(order!=='normal-before-metadata'){assert.equal(observed.sources.length,0,'stale old native URL must stay discarded');assert.deepEqual(observed.rates,[]);}
 else {assert.equal(observed.sources.length,1);assert.deepEqual(observed.rates,[2]);}
});
await run('native speed unload recovery: newer native supersedes waiting 1x','native-speed-unload-newer-native',async page=>{
 await nativeFixture(page);await page.evaluate(()=>window.__holdUnload=true);
 await chooseSpeed(page,'2x');await page.waitForFunction(()=>window.__speedPending.length===1);
 await page.evaluate(()=>window.__speedPending[0]());await page.waitForFunction(()=>!!window.__releaseUnload);
 await chooseSpeed(page,'正常');await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__speedPending.length===2);
 await page.evaluate(()=>window.__speedPending[1]());await page.waitForTimeout(50);
 await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});await page.waitForTimeout(400);
 const observed=await page.evaluate(()=>({loads:window.__probe.loads,unloads:window.__probe.unloads,sources:window.__probe.nativeSources,rates:window.__probe.rateCalls}));
 assert.equal(observed.loads,1,'obsolete waiting 1x must not reload DASH after newer native intent: '+JSON.stringify(observed));
 assert.equal(observed.unloads,1,'newer native intent reuses one pending unload');
 assert.equal(observed.sources.length,1);assert.deepEqual(observed.rates,[1.5]);
 await chooseSpeed(page,'正常');await page.waitForFunction(()=>window.__probe.loads===2);
});
// The C4 trace shows native readyState can remain 4 at load() entry, then
// reset to 0 before new metadata. Model that decoder boundary explicitly;
// passing startTime alone must not count as a successful paused restore.
for(const paused of [false,true])await run('native speed restores actual time after metadata paused='+paused,'native-speed-paused-boundary',async page=>{
 await nativeFixture(page);
 await page.evaluate(paused=>{
  const v=document.querySelector('video');window.__nativeClock={position:14.9,paused,plays:0};
  Object.defineProperty(v,'currentTime',{configurable:true,get:()=>window.__nativeClock.position,set:value=>window.__nativeClock.position=value});
  Object.defineProperty(v,'paused',{configurable:true,get:()=>window.__nativeClock.paused});
  v.play=()=>{window.__nativeClock.paused=false;window.__nativeClock.plays++;return Promise.resolve()};
 },paused);
 await chooseSpeed(page,'2x');await page.waitForFunction(()=>window.__speedPending.length===1);
 await page.evaluate(()=>window.__speedPending[0]());await page.waitForFunction(()=>window.__probe.rateCalls.length===1);
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'readyState',{configurable:true,get:()=>4});v.dispatchEvent(new Event('loadedmetadata'));});
 assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),14.9,'native metadata applies original position');
 await chooseSpeed(page,'正常');await page.waitForFunction(()=>window.__probe.loads===2);await page.waitForTimeout(200);
 const observed=await page.evaluate(()=>({time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused,ready:document.querySelector('video').readyState,positions:window.__probe.positions,unloads:window.__probe.unloads}));
 assert.equal(observed.time,14.9,'new DASH metadata must retain actual position, not just load startTime: '+JSON.stringify(observed));
 assert.equal(observed.paused,paused,'native round trip preserves pause/play');
 assert.equal(observed.ready,4);
});
for(const intent of ['exit','newer-native'])await run('native speed explicit detach honors '+intent,'native-speed-paused-boundary',async page=>{
 await nativeFixture(page);
 await page.evaluate(()=>{
  const v=document.querySelector('video');window.__nativeClock={position:14.9,paused:true,plays:0};
  Object.defineProperty(v,'currentTime',{configurable:true,get:()=>window.__nativeClock.position,set:value=>window.__nativeClock.position=value});
  Object.defineProperty(v,'paused',{configurable:true,get:()=>window.__nativeClock.paused});
  v.play=()=>{window.__nativeClock.paused=false;window.__nativeClock.plays++;return Promise.resolve()};
 });
 await chooseSpeed(page,'2x');await page.waitForFunction(()=>window.__speedPending.length===1);
 await page.evaluate(()=>window.__speedPending[0]());await page.waitForFunction(()=>window.__probe.rateCalls.length===1);
 await page.evaluate(()=>{const v=document.querySelector('video');Object.defineProperty(v,'readyState',{configurable:true,get:()=>4});v.dispatchEvent(new Event('loadedmetadata'));window.__holdUnload=true});
 await chooseSpeed(page,'正常');await page.waitForFunction(()=>window.__probe.unloads===2&&!!window.__releaseUnload);
 if(intent==='exit'){
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('video'));
 }else{
  await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__speedPending.length===2);
  await page.evaluate(()=>window.__speedPending[1]());await page.waitForTimeout(50);
 }
 await page.evaluate(()=>{window.__holdUnload=false;window.__releaseUnload()});await page.waitForTimeout(200);
 const observed=await page.evaluate(()=>({loads:window.__probe.loads,unloads:window.__probe.unloads,sources:window.__probe.nativeSources,rates:window.__probe.rateCalls}));
 assert.equal(observed.loads,1,'obsolete DASH restore must not load after a newer intent: '+JSON.stringify(observed));
 assert.equal(observed.unloads,2,'newer intent shares the ongoing native detach');
 if(intent==='exit'){assert.equal(observed.sources.length,1);assert.deepEqual(observed.rates,[2]);}
 else{
  assert.equal(observed.sources.length,2);assert.deepEqual(observed.rates,[2,1.5]);
  await chooseSpeed(page,'正常');await page.waitForFunction(()=>window.__probe.loads===2);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),14.9);
  assert.equal(await page.evaluate(()=>document.querySelector('video').paused),true);
 }
});
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
await run('Dolby inspection uses selected native signed backup without hostname substitution','dolby-signed-route',async(page,calls)=>{
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('bili_settings'));localStorage.setItem('bili_settings',JSON.stringify({...s,cdnRoute:'hwo1'}))});
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);
 assert.equal(calls.dolbyProbeSigned,true);
 assert.match(await page.evaluate(()=>window.__probe.mpds[0]),/codecs="dvh1.08.09"/);
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
// Real React player, controlled decoder: no online event is emitted when a
// temporary DNS failure ends. Preserve both the current part and position.
for (const action of ['automatic', 'manual', 'exit', 'new-intent']) await run('outage recovery: '+action,'recovery',async(page,calls)=>{
 await page.clock.install();
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',cid:3,resumeMode:'at',progress:47}));
 await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(200);
 await page.evaluate(()=>{
  const v=document.querySelector('video');window.__paused=false;
  Object.defineProperty(v,'currentTime',{configurable:true,get:()=>47});
  Object.defineProperty(v,'paused',{configurable:true,get:()=>window.__paused});
  Object.defineProperty(v,'readyState',{configurable:true,get:()=>1});
  v.pause=function(){window.__paused=true;this.dispatchEvent(new Event('pause'));};
  v.dispatchEvent(new Event('waiting'));
 });
 await page.clock.runFor(2000);await page.clock.fastForward(31000);
 assert.equal(await page.getByText('播放暂时中断，请检查网络或切换线路',{exact:true}).isVisible(),true);
 if(action==='exit'){
  await page.keyboard.press('Escape');await page.clock.fastForward(25000);
  assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>window.__probe.loads),1);return;
 }
 if(action==='manual')await page.keyboard.press('Enter');
 else await page.clock.fastForward(9000);
 await page.waitForFunction(()=>window.__probe.loads===2);
 assert.equal(await page.getByText('播放暂时中断，请检查网络或切换线路',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.__probe.positions[1]),47);
 assert.equal(calls.events.filter(x=>x.type==='playurl').pop().cid,'3');
 assert.ok(await page.evaluate(()=>window.__probe.destroyed)>=1);
 if(action==='new-intent'){
  await page.evaluate(()=>window.__openVideo({bvid:'BVtest',cid:3,resumeMode:'at',progress:73}));
  await page.waitForFunction(()=>window.__probe.loads===3);
  assert.equal(await page.evaluate(()=>window.__probe.positions[2]),73);
 }
});
for (const kind of ['media', 'network']) await run('critical runtime error while paused: '+kind,'runtime-'+kind,async(page,calls)=>{
 await page.clock.install();
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',cid:3,resumeMode:'at',progress:47}));
 await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(200);
 await page.evaluate(kind=>{
  const v=document.querySelector('video');
  Object.defineProperty(v,'currentTime',{configurable:true,get:()=>47});
  Object.defineProperty(v,'paused',{configurable:true,get:()=>true});
  for(let i=0;i<2;i++)window.__shakaPlayer.events.error({detail:{category:kind==='media'?3:1,code:kind==='media'?3016:1001,severity:2,data:['https://media.bilivideo.com/video?upsig=private-signature']}});
 },kind);
 await page.getByText('重试播放',{exact:true}).waitFor();
 assert.equal(await page.locator('.player-page .loading').count(),0);
 const errors=await page.evaluate(async()=>{return (await import('/src/utils/errlog.js')).getErrors().filter(e=>e.tag==='playback-error')});
 assert.equal(errors.length,1,'duplicate notification only records one failure');
 assert.match(errors[0].d,new RegExp('code='+(kind==='media'?3016:1001)));
 assert.doesNotMatch(JSON.stringify(errors),/upsig|private-signature/);
 await page.screenshot({path:output+'/runtime-'+kind+'.png'});
 await page.clock.fastForward(8100);
 if(kind==='media'){
  // Deliberately hold the replacement load before reading its Blob MPD. The
  // load-call counter alone must never be used as proof of completed recovery.
  await page.waitForFunction(()=>typeof window.__releasePausedRecovery==='function');
  assert.equal(await page.evaluate(()=>window.__probe.positions.length),1,'second load is still pending');
  await page.evaluate(()=>window.__releasePausedRecovery());
 }
 await page.waitForFunction(()=>window.__probe.loads===2&&window.__probe.positions.length===2&&!document.querySelector('.player-page .loading'));
 assert.equal(await page.evaluate(()=>window.__probe.positions[1]),47);
 assert.equal(calls.events.filter(x=>x.type==='playurl').pop().cid,'3');
 assert.equal(await page.getByText('重试播放',{exact:true}).count(),0);
});
await run('recoverable runtime network error keeps player and retries streaming','runtime-warning',async page=>{
 await page.clock.install();await open(page);await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(200);
 await page.evaluate(()=>window.__shakaPlayer.events.error({detail:{category:1,code:1001,severity:1}}));
 await page.clock.fastForward(25000);
 assert.equal(await page.evaluate(()=>window.__probe.loads),1);
 assert.equal(await page.evaluate(()=>window.__probe.retries),1);
 assert.equal(await page.getByText('重试播放',{exact:true}).count(),0);
});
await run('leaving after fatal runtime error cancels delayed recovery','runtime-exit',async page=>{
 await page.clock.install();await open(page);await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(200);
 await page.evaluate(()=>{window.__lateError=window.__shakaPlayer.events.error;window.__lateError({detail:{category:3,code:3016,severity:2}})});
 await page.getByText('重试播放',{exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__lateError({detail:{category:3,code:3016,severity:2}}));
 await page.clock.fastForward(25000);
 assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>window.__probe.loads),1);
});
await run('repeated fatal runtime errors exhaust bounded remount budget','runtime-budget',async page=>{
 await page.clock.install();await open(page);
 for(let i=0;i<3;i++) {
  await page.waitForFunction(n=>window.__probe.loads===n,i+1);await page.waitForTimeout(200);
  await page.evaluate(()=>window.__shakaPlayer.events.error({detail:{category:3,code:3016,severity:2}}));
  await page.getByText('重试播放',{exact:true}).waitFor();
  if(i<2)await page.clock.fastForward((i+1)*8000+100);
 }
 await page.getByText('自动重试已停止，按 OK 重试或返回退出',{exact:true}).waitFor();
 await page.clock.fastForward(120000);assert.equal(await page.evaluate(()=>window.__probe.loads),3);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__probe.loads===4);
});
await run('creator follow from player control bar','follow',async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1);await page.waitForTimeout(200);
 assert.equal(calls.follow||0,0);
 await page.keyboard.press('ArrowUp');
 await page.getByText('关注 UP 主',{exact:true}).click();
 await page.getByText('取消关注 UP 主',{exact:true}).waitFor();
 assert.equal(calls.follow,1);
});
await run('outage recovery: permanent outage has a finite retry budget','network',async(page,calls)=>{
 await page.clock.install();await open(page);
 await page.getByText('重试播放',{exact:true}).waitFor();
 for (const delay of [8100,16100]) {
  await page.clock.fastForward(delay);await page.getByText('重试播放',{exact:true}).waitFor();
 }
 await page.getByText('自动重试已停止，按 OK 重试或返回退出',{exact:true}).waitFor();
 const count=await page.evaluate(()=>window.__probe.loads);
 await page.clock.fastForward(120000);
 assert.equal(await page.evaluate(()=>window.__probe.loads),count);
 assert.equal(count,6,'two initial attempts and two bounded recovery rounds');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!document.querySelector('video'));
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
await run('failed quality load restores original stream with explicit DASH MIME','quality-restore',async page=>{
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);
 await page.keyboard.press('ArrowUp');
 await page.locator('.player-btn').filter({hasText:'1080P'}).click();
 await page.locator('.quality-option').filter({hasText:'360P'}).click();
 await page.waitForFunction(()=>window.__probe.loads===3);
 await page.waitForFunction(()=>!document.querySelector('.player-page .loading'));
 assert.deepEqual(await page.evaluate(()=>window.__probe.mimes),Array(3).fill('application/dash+xml'));
 assert.equal(await page.locator('.player-page .player-error').count(),0);
});
await run('missing requested quality keeps existing stream and never blames membership','quality-missing',async page=>{
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
 await page.waitForFunction(()=>window.__probe.loads===1);
 await page.keyboard.press('ArrowUp');
 await page.locator('.player-btn').filter({hasText:'1080P'}).click();
 await page.locator('.quality-option').filter({hasText:'360P'}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('画质切换失败'));
 assert.equal(await page.evaluate(()=>window.__probe.loads),1);
 assert.ok(!(await page.locator('body').innerText()).includes('该画质需要大会员'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bili_settings')).quality),80);
});
await run('4K TV starts 8K source at available HDR tier without loading stuck 8K','resolution-8k',async(page,calls)=>{
 await page.evaluate(()=>{window.PalmSystem={deviceInfo:JSON.stringify({screenWidth:3840,screenHeight:2160})}});
 await open(page);await page.waitForFunction(()=>window.__probe.mpds.length===1);
 const p=await page.evaluate(()=>window.__probe);assert.match(p.mpds[0],/Representation id="125"/);
 assert.doesNotMatch(p.mpds[0],/width="7680"/);assert.equal(calls.playurl,1);
});
await run('same-quality HEVC decoder failure tries AVC without dropping to 1080p','codec-fallback',async(page,calls)=>{
 await page.evaluate(()=>window.__openVideo({bvid:'BVtest',resumeMode:'none'}));
 await page.waitForFunction(()=>window.__probe.mpds.length===2);
 const p=await page.evaluate(()=>window.__probe);
 assert.match(p.mpds[0],/codecs="hvc1/);assert.match(p.mpds[1],/codecs="avc1/);
 assert.ok(p.mpds.every(m=>m.includes('Representation id="120"')));
 assert.ok(p.configs.some(c=>c.ignoreHardwareResolution===true));assert.equal(calls.playurl,1);
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
 assert.ok(trace.stages.load.start<=trace.points.request);
 assert.ok(trace.points.vappend>=trace.points.metadata&&trace.points.vappend<trace.points.data);
 assert.equal(trace.hosts.request,'media.bilivideo.com');assert.equal(trace.hosts.video,'media.bilivideo.com');
 assert.equal(trace.retryKinds[0].kind,'media');assert.equal(trace.retryKinds[0].code,1001);
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
await run('member identity displays active annual badge','member-identity',async page=>{
 await page.waitForFunction(()=>document.querySelector('.membership-badge')?.textContent==='年度大会员');
 await page.locator('.sidebar-item').filter({hasText:'我的'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.membership-badge').length===2);
 await page.waitForTimeout(250); // let drawer opacity transition finish before visual evidence
 await page.screenshot({path:output+'/member-identity.png'});
});
await run('member default requests highest and supports explicit manual and automatic choices','member-auto',async(page,calls)=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1&&!document.querySelector('.loading'));
 assert.equal(calls.requestedQualities[0],127);
 assert.match(await page.evaluate(()=>window.__lastMpd),/id="120"/);
 await page.keyboard.press('ArrowUp');await page.locator('.player-btn').filter({hasText:'4K'}).click();
 assert.equal(await page.locator('.quality-option.active').textContent(),'自动 · 最高可用');
 await page.locator('.quality-option').filter({hasText:'1080P'}).click();
 await page.waitForFunction(()=>window.__appStorage.getSettings().quality===80&&window.__appStorage.getSettings().qualityMode==='manual');
 await page.locator('.player-btn').filter({hasText:'1080P'}).click();
 await page.locator('.quality-option').filter({hasText:'自动 · 最高可用'}).click();
 await page.waitForFunction(()=>window.__appStorage.getSettings().quality==='auto');
 assert.deepEqual(calls.requestedQualities,[127,80,127]);
 assert.match(await page.evaluate(()=>window.__lastMpd),/id="120"/);
});
await run('member full quality ladder scrolls with remote at large UI size','member-tall',async page=>{
 await open(page);await page.waitForFunction(()=>window.__probe.loads===1&&!document.querySelector('.loading'));
 await page.keyboard.press('ArrowUp');await page.locator('.player-btn').filter({hasText:'4K'}).click();
 for(let i=0;i<12;i++)await page.keyboard.press('ArrowDown');
 const bounds=await page.locator('.quality-popup .focused').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {top:r.top,bottom:r.bottom,parentTop:p.top,parentBottom:p.bottom,text:el.textContent}});
 assert.match(bounds.text,/360P/);assert.ok(bounds.top>=bounds.parentTop&&bounds.bottom<=bounds.parentBottom+1&&bounds.parentTop>=0,JSON.stringify(bounds));
 await page.screenshot({path:output+'/member-quality-menu.png'});
},{ui:1.25});
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));await browser.close();
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
