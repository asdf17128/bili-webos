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
   localStorage.setItem('bili_settings',JSON.stringify({language:mode.startsWith('subtitle-lifecycle')?'en':'zh',uiScale:scale?.ui||1,gridCols:3,subtitle:true,danmaku:!mode.startsWith('subtitle-lifecycle'),subtitleScale:scale?.sub||1,danmakuScale:scale?.dm||1}));
   if(mode.startsWith('layout')||mode.startsWith('follow'))localStorage.setItem('bili_auth',JSON.stringify({SESSDATA:'fixture'}));
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
  if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(u.pathname.endsWith('/view')){calls.info++;calls.events.push({type:'view',at:Date.now()});if(mode==='slow-info')await new Promise(r=>setTimeout(r,1200));data={aid:1,cid:2,bvid:'BVtest',pages:mode==='startup-part'?[{cid:2},{cid:3}]:[{cid:2}],title:mode.startsWith('layout')?'日本有钱人的小别墅能有多离谱！超迷你设计成这样就问你敢住吗':'加载回归',owner:{mid:1,name:mode.startsWith('layout')?'11区小豪的故事':'测试'},pubdate:1790323200,stat:{}};}
  if(u.pathname.endsWith('/playurl')){
    calls.playurl++;calls.events.push({type:'playurl',cid:u.searchParams.get('cid'),at:Date.now()});if(mode.startsWith('startup'))await new Promise(r=>setTimeout(r,500));
    const qn=mode==='quality-restore'||mode.startsWith('native-speed')?Number(u.searchParams.get('qn')||80):mode==='resolution-8k'?127:mode==='codec-fallback'?120:mode.startsWith('dolby')?126:80;
    data={quality:qn,accept_quality:[qn,16],dash:{duration:100,video:[{id:qn,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:qn===126?'hvc1.2.4.L156.90':'avc1.640028',width:1920,height:1080,frameRate:mode==='dolby-120'?'120000/1001':mode==='dolby-unknown'?'':'60000/1001',SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
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

await run('same document heap investigation with controlled decoder','heap-study',async page=>{
 const cdp=await page.context().newCDPSession(page);const checkpoints=[];
 async function snapshot(label){
  await page.waitForTimeout(3500);await cdp.send('HeapProfiler.collectGarbage');
  const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
  const chunks=[];const fn=e=>chunks.push(e.chunk);cdp.on('HeapProfiler.addHeapSnapshotChunk',fn);
  try{await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false})}finally{cdp.off('HeapProfiler.addHeapSnapshotChunk',fn)}
  await writeFile(`${output}/${label}.heapsnapshot`,chunks.join(''),{mode:0o600});
  checkpoints.push({label,heap,dom});await writeFile(`${output}/summary.json`,JSON.stringify({checkpoints,scope:'Real React, controlled decoder; not TV memory or real Shaka decoder validation'},null,2));
  console.log('SNAPSHOT',label,heap.usedSize,JSON.stringify(dom));
 }
 for(let n=-2;n<=40;n++){
  await page.evaluate(()=>{window.__probe={loads:0,destroyed:0,retries:0,mpds:[],positions:[],mimes:[]};window.__openVideo({bvid:'BVtest',resumeMode:'none'})});
  await page.waitForFunction(()=>document.querySelector('video')?.readyState===4&&!document.querySelector('.loading'));
  await page.keyboard.press('Backspace');await page.waitForFunction(()=>!document.querySelector('video')&&!window.__shakaPlayer);
  await page.waitForTimeout(250);
  if([0,10,20,40].includes(n))await snapshot('cycle-'+n);
 }
 await cdp.send('Runtime.discardConsoleEntries');await snapshot('after-console-discard');
 await cdp.detach();
});
await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));process.exitCode=results.some(x=>!x.pass)?1:0;
