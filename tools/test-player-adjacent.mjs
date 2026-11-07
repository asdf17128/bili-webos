// Actual React controls and trusted remote/pointer input, controlled decoder.
// All media/accounts are synthetic; every non-Vite HTTP/WS request is intercepted.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.env.ADJACENT_URL || 'http://127.0.0.1:5173';
assert.equal(new URL(baseURL).hostname, '127.0.0.1');
const output = process.env.ADJACENT_OUTPUT || '/tmp/bili-player-adjacent';
await mkdir(output, { recursive: true });
const sourcePaths = ['app/src/player/PlayerPage.jsx', 'app/src/player/adjacentVideo.js', 'app/src/player/playIntent.js', 'app/src/utils/library.js'];
const hashSources = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const sources = await hashSources();
const browser = await chromium.launch();
const results = [];
const A = { bvid: 'BVAdjacentA', aid: 1, cid: 11, title: 'Synthetic A', duration: 100 };
const B = { bvid: 'BVAdjacentB', aid: 2, cid: 22, title: 'Synthetic B', duration: 100 };
const C = { bvid: 'BVAdjacentC', aid: 3, cid: 33, title: 'Synthetic C', duration: 100 };
const episodes = [1, 2, 3].map(id => ({ id, epid: id, cid: id * 100, title: String(id), isBangumi: true }));
const stub = `class Player {
 static isBrowserSupported(){return true}
 async attach(video){this.video=video;void video.currentTime}
 configure(){} addEventListener(name,fn){(this.events||(this.events={}))[name]=fn}
 getNetworkingEngine(){return this.net||(this.net={registerRequestFilter(){},registerResponseFilter(){},addEventListener(){}})}
 getVariantTracks(){return []} getStats(){return {}} retryStreaming(){return true}
 async load(url,position,mime){
  const mpd=await(await fetch(url)).text(),cid=Number(mpd.match(/video-([0-9]+)/)?.[1]);
  if(!cid)throw new Error('Synthetic MPD has no CID');
  const state=this.video.__adjacentMedia;state.time=position||0;state.ready=4;state.finished=false;state.load=window.__adjacentProbe.loads.length;
  window.__adjacentProbe.loads.push({cid,position:position??null,mime});
  for(const event of ['loadedmetadata','loadeddata','canplay'])this.video.dispatchEvent(new Event(event));
 }
 async unload(){this.video.__adjacentMedia.ready=0}
 async destroy(){window.__adjacentProbe.destroyed++}
}
export default {Player,polyfill:{installAll(){}}};`;

async function fixture(config = {}) {
 const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
 const calls = { streams: [], views: [], pages: 0, pageArguments: [], unexpectedWrites: [], intercepted: 0 };
 const errors = []; let releasePage;
 const pageGate = new Promise(resolve => { releasePage = resolve; });
 await context.addInitScript(({ guest, playbackMode }) => {
  delete window.webOS; delete window.PalmServiceBridge; localStorage.clear();
  if (!guest) localStorage.setItem('bili_auth', JSON.stringify({ SESSDATA: 'synthetic-adjacent-session', DedeUserID: '7', bili_jct: 'synthetic-adjacent-csrf' }));
  localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
  localStorage.setItem('bili_perfopt', JSON.stringify({ prefetchPage: false, warmPlayer: false }));
  localStorage.setItem('bili_settings', JSON.stringify({ language: 'zh', quality: 80, qualityMode: 'manual', subtitle: false, danmaku: false, playbackMode: playbackMode || 'stop' }));
  window.__adjacentProbe = { loads: [], seeks: [], destroyed: 0, plays: 0, untrustedInput: 0 };
  for (const type of ['keydown','keyup','click','mousedown','mouseup']) window.addEventListener(type, event => { if (!event.isTrusted) window.__adjacentProbe.untrustedInput++; }, true);
  const media = video => video.__adjacentMedia || (video.__adjacentMedia = { time: 0, paused: true, finished: false, ready: 0, load: -1 });
  Object.defineProperties(HTMLMediaElement.prototype, {
   currentTime: { configurable: true, get(){return media(this).time;}, set(value){const state=media(this);state.time=Number(value);state.finished=false;window.__adjacentProbe.seeks.push({load:state.load,target:Number(value)});this.dispatchEvent(new Event('timeupdate'));} },
   duration: { configurable: true, get(){return 100;} }, paused: { configurable: true, get(){return media(this).paused;} },
   ended: { configurable: true, get(){return media(this).finished;} }, readyState: { configurable: true, get(){return media(this).ready;} },
   buffered: { configurable: true, get(){return {length:1,start(){return 0;},end(){return 100;}};} },
   videoWidth: { configurable: true, get(){return 1920;} }, videoHeight: { configurable: true, get(){return 1080;} },
  });
  HTMLMediaElement.prototype.play=function(){media(this).paused=false;window.__adjacentProbe.plays++;this.dispatchEvent(new Event('play'));if(media(this).ready)this.dispatchEvent(new Event('playing'));return Promise.resolve();};
  HTMLMediaElement.prototype.pause=function(){media(this).paused=true;this.dispatchEvent(new Event('pause'));};
 }, config);
 await context.routeWebSocket('**/*', socket => socket.close());
 await context.route('**/*', async route => {
  const request=route.request(), url=new URL(request.url());
  if(url.origin===new URL(baseURL).origin){
   if(url.pathname.includes('shaka-player'))return route.fulfill({contentType:'application/javascript',body:stub});
   return route.continue();
  }
  calls.intercepted++;
  if(url.port==='9528')return route.abort();
  const fulfill=data=>route.fulfill({json:data,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(request.method()==='OPTIONS')return fulfill({});
  if(request.method()!=='GET'){
   if(!url.pathname.endsWith('/heartbeat'))calls.unexpectedWrites.push(url.pathname);
   return fulfill({code:0,data:{}});
  }
  let data={};
  if(url.pathname.endsWith('/nav'))data={isLogin:!config.guest,mid:7,wbi_img:{img_url:'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://fixture.invalid/abcdefghijklmnopqrstuvwxyz123456.png'}};
  if(url.pathname.endsWith('/history/cursor'))data={list:[]};
  if(url.pathname.includes('/top/feed/rcmd'))data={item:[]};
  if(url.pathname.endsWith('/view')){
   const item=[A,B,C].find(item=>item.bvid===url.searchParams.get('bvid'))||A;calls.views.push(item.bvid);
   data={...item,pages:config.kind==='parts'?[{cid:11,part:'P1',page:1},{cid:12,part:'P2',page:2},{cid:13,part:'P3',page:3}]:[{cid:item.cid}],owner:{mid:70,name:'Synthetic UP'},stat:{}};
   if(config.kind==='collection')data.ugc_season={sections:[{episodes:[A,B,C]}]};
  }
  if(url.pathname.endsWith('/v2'))data={last_play_cid:config.kind==='parts'?12:Number(url.searchParams.get('cid')),last_play_time:47000,subtitle:{subtitles:[]}};
  if(url.pathname.endsWith('/playurl')){
   const cid=Number(url.searchParams.get('cid'));assert.ok([11,12,13,22,33,100,200,300].includes(cid),'only fixture CIDs may load');calls.streams.push(cid);
   data={quality:80,accept_quality:[80],dash:{duration:100,video:[{id:80,bandwidth:1000,baseUrl:`https://media.fixture.invalid/video-${cid}`,codecs:'avc1.640028',width:1920,height:1080,frameRate:'30',SegmentBase:{Initialization:'0-51',indexRange:'52-70'}}],audio:[]}};
   if(url.pathname.includes('/pgc/'))return fulfill({code:0,result:{video_info:data}});
  }
  if(url.pathname.endsWith('/season'))return fulfill({code:0,result:{season_id:1,episodes}});
  if(url.pathname.endsWith('/archive/related'))data=config.emptyRelated?[]:[A,B,C];
  if(url.pathname.endsWith('/resource/list')){
   calls.pages++;calls.pageArguments.push({pn:Number(url.searchParams.get('pn')),mediaId:url.searchParams.get('media_id')});
   if(['pending','pending-retry'].includes(config.kind)&&calls.pages===1)await pageGate;
   if(['retry','pending-retry'].includes(config.kind)&&calls.pages===1)return fulfill({code:-500,message:'synthetic page failure'});
   data={medias:config.kind==='empty-page'?[]:[config.pageItem==='C'?C:B],has_more:false};
  }
  if(url.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i/>'});
  if(url.pathname.endsWith('/relation/stat'))data={follower:10};
  if(url.pathname.endsWith('/x/relation'))data={attribute:0};
  return fulfill({code:0,data});
 });
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(baseURL);await page.waitForFunction(()=>!!window.__openVideo);
 const open=async item=>{
  await page.evaluate(item=>window.__openVideo(item),item||A);
  await waitLoad(page,1);await showControls(page);
  assert.equal(await focused(page),'play','new controls start at central playback action');
 };
 const close=async()=>{for(let n=0;n<4&&await page.locator('.player-page').count();n++)await page.keyboard.press('Escape');await page.locator('.player-page').waitFor({state:'detached'});};
 return {context,page,calls,errors,open,close,releasePage};
}

async function waitLoad(page,count,cid,position=0){
 await page.waitForFunction(count=>window.__adjacentProbe.loads.length===count&&!document.querySelector('.player-page .loading')&&!document.querySelector('video').paused,count);
 await page.waitForTimeout(100);
 if(cid!==undefined){
  const snapshot=await page.evaluate(()=>({...window.__adjacentProbe,time:document.querySelector('video').currentTime}));
  const load=snapshot.loads[count-1];assert.equal(load.cid,cid);assert.equal(load.position??0,position,'manual previous/next loads from zero');
  assert.equal(snapshot.time,position,'final media time is not restored to saved progress');
  assert.ok(snapshot.seeks.filter(seek=>seek.load===count-1).every(seek=>seek.target===position),'no delayed seek to old progress');
 }
}
const focused=page=>page.locator('.player-control.focused').getAttribute('data-control');
async function showControls(page){
 if(await page.locator('.player-controls.hidden').count())await page.keyboard.press('ArrowUp');
 await page.waitForFunction(()=>!document.querySelector('.player-controls').classList.contains('hidden'));
}
async function focus(page,id){
 await showControls(page);await page.waitForFunction(id=>!document.querySelector(`.player-control[data-control="${id}"]`).disabled,id);
 for(let n=0;n<10&&await focused(page)!==id;n++)await page.keyboard.press('ArrowRight');
 assert.equal(await focused(page),id);
}
async function activate(page,id){await focus(page,id);await page.keyboard.press('Enter');}
async function inertPointer(page,id){const box=await page.locator(`.player-control[data-control="${id}"]`).boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(150);}
const paged=()=>({...A,playlist:[A],playlistIndex:0,playlistSource:{id:8,type:11,nextPage:2,hasMore:true},fromToView:true,resumeMode:'at',progress:47});
const end=page=>page.evaluate(()=>{const video=document.querySelector('video');video.__adjacentMedia.time=100;video.__adjacentMedia.finished=true;video.__adjacentMedia.paused=true;video.dispatchEvent(new Event('pause'));video.dispatchEvent(new Event('ended'));});
async function waitPage(f,count){const until=Date.now()+5000;while(f.calls.pages<count&&Date.now()<until)await f.page.waitForTimeout(20);assert.equal(f.calls.pages,count);}
async function run(name,config,fn){
 if(process.env.ADJACENT_FILTER&&!new RegExp(process.env.ADJACENT_FILTER).test(name))return;
 let f;
 try{f=await fixture(config);await fn(f);assert.deepEqual(f.errors,[]);assert.deepEqual(f.calls.unexpectedWrites,[]);const probe=await f.page.evaluate(()=>window.__adjacentProbe);assert.equal(probe.untrustedInput,0);results.push({name,pass:true,probe,calls:f.calls});console.log('PASS',name);}
 catch(error){results.push({name,pass:false,error:error.message,probe:f?await f.page.evaluate(()=>window.__adjacentProbe).catch(()=>null):null,calls:f?.calls});console.log('FAIL',name,error.message.split('\n')[0]);if(f)await f.page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{if(f){f.releasePage();await f.context.close();}}
}

await run('single video skips disabled previous and chooses first different recommendation',{},async f=>{
 await f.open({...A,resumeMode:'at',progress:47});
 assert.equal(await f.page.locator('[data-control="prev"]').isDisabled(),true);
 await f.page.keyboard.press('ArrowLeft');assert.equal(await focused(f.page),'later');
 await f.page.keyboard.press('ArrowRight');assert.equal(await focused(f.page),'play');
 await inertPointer(f.page,'prev');assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 await activate(f.page,'next');await waitLoad(f.page,2,22);
});
await run('playlist previous and next preserve order and start from zero without wrapping',{},async f=>{
 const playlist=[{...A,progress:68},{...B,progress:70},{...C,progress:75}];
 await f.open({...B,playlist,playlistIndex:1,resumeMode:'at',progress:47});
 await activate(f.page,'prev');await waitLoad(f.page,2,11);await showControls(f.page);assert.equal(await f.page.locator('[data-control="prev"]').isDisabled(),true);
 await activate(f.page,'next');await waitLoad(f.page,3,22);
 await activate(f.page,'next');await waitLoad(f.page,4,33);await showControls(f.page);assert.equal(await f.page.locator('[data-control="next"]').isDisabled(),true);
 await inertPointer(f.page,'next');assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),4);
 assert.equal(f.calls.pages,0);
});
await run('multi-part transport follows resolved resumed part rather than original card', {kind:'parts'},async f=>{
 await f.open({...A,resumeMode:'auto'});await waitLoad(f.page,1,12,47);
 await activate(f.page,'next');await waitLoad(f.page,2,13);
 await activate(f.page,'prev');await waitLoad(f.page,3,12);
});
await run('UGC collection transport follows its ordered episode list', {kind:'collection'},async f=>{
 await f.open({...B,resumeMode:'at',progress:47});
 await activate(f.page,'prev');await waitLoad(f.page,2,11);
 await activate(f.page,'next');await waitLoad(f.page,3,22);
});
await run('PGC episode transport navigates both directions from zero',{},async f=>{
 await f.open({isBangumi:true,epid:2,cid:200,seasonId:1,resumeMode:'at',progress:47});
 await activate(f.page,'prev');await waitLoad(f.page,2,100);
 await activate(f.page,'next');await waitLoad(f.page,3,200);
});
await run('pending next page cannot submit duplicate requests and preserves previous context',{kind:'pending'},async f=>{
 await f.open(paged());await activate(f.page,'next');
 await f.page.waitForFunction(()=>document.querySelector('[data-control="next"]').disabled);
 for(let n=0;n<3;n++)await f.page.keyboard.press('Enter');await f.page.waitForTimeout(120);
 assert.equal(f.calls.pages,1);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 f.releasePage();await waitLoad(f.page,2,22);assert.deepEqual(f.calls.pageArguments,[{pn:2,mediaId:'8'}]);
 await activate(f.page,'prev');await waitLoad(f.page,3,11);assert.equal(f.calls.pages,1);
});
await run('failed next page leaves current video and permits explicit retry',{kind:'retry'},async f=>{
 await f.open(paged());await activate(f.page,'next');await f.page.locator('.player-toast').filter({hasText:'连播列表加载失败'}).waitFor();
 assert.equal(f.calls.pages,1);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 await activate(f.page,'next');await waitLoad(f.page,2,22);assert.equal(f.calls.pages,2);
});
await run('empty next page disables the action instead of looping or refetching',{kind:'empty-page'},async f=>{
 await f.open(paged());await activate(f.page,'next');await f.page.waitForTimeout(300);
 assert.equal(f.calls.pages,1);assert.equal(await f.page.locator('[data-control="next"]').isDisabled(),true);
 await f.page.keyboard.press('Enter');await inertPointer(f.page,'next');
 assert.equal(f.calls.pages,1);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
});
await run('leaving during a next-page request never starts a late video',{kind:'pending'},async f=>{
 await f.open(paged());await activate(f.page,'next');await f.page.waitForTimeout(150);assert.equal(f.calls.pages,1);
 await f.close();f.releasePage();await f.page.waitForTimeout(300);
 assert.equal(await f.page.locator('.player-page').count(),0);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
});
await run('guest with no neighbors skips disabled actions without changing video',{guest:true,emptyRelated:true},async f=>{
 await f.open({...A,resumeMode:'at',progress:47});
 assert.equal(await f.page.locator('[data-control="prev"]').isDisabled(),true);assert.equal(await f.page.locator('[data-control="next"]').isDisabled(),true);
 await f.page.keyboard.press('ArrowLeft');assert.equal(await focused(f.page),'settings');
 await f.page.keyboard.press('ArrowRight');assert.equal(await focused(f.page),'play');
 await f.page.keyboard.press('ArrowRight');assert.equal(await focused(f.page),'comments');
 await inertPointer(f.page,'next');assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 assert.equal(await f.page.evaluate(()=>document.querySelector('video').currentTime),47);
});

for(const playbackMode of ['next','repeat'])await run('manual pending Next owns EOS instead of '+playbackMode,{kind:'pending',playbackMode},async f=>{
 await f.open(paged());await activate(f.page,'next');await waitPage(f,1);
 const plays=await f.page.evaluate(()=>window.__adjacentProbe.plays);
 await end(f.page);await f.page.waitForFunction(()=>document.querySelector('[data-control="play"]').getAttribute('aria-label')==='重播');
 await f.page.waitForTimeout(200);assert.equal(f.calls.pages,1,'EOS must not race the manual next-page request');
 assert.equal(await f.page.locator('[data-control="next"]').isDisabled(),true,'manual request retains its lock after EOS finishes');
 assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.plays),plays,'repeat must not restart the old video during manual navigation');
 assert.ok(!(await f.page.locator('body').innerText()).includes('秒后自动播放'),'manual navigation suppresses unrelated countdown');
 f.releasePage();await waitLoad(f.page,2,22);assert.equal(f.calls.pages,1);
});

await run('automatic EOS owns pagination before manual previous or next',{kind:'pending',playbackMode:'next',pageItem:'C'},async f=>{
 await f.open({...B,playlist:[A,B],playlistIndex:1,playlistSource:{id:8,type:11,nextPage:2,hasMore:true},resumeMode:'at',progress:47});
 await focus(f.page,'next');assert.equal(await f.page.locator('[data-control="prev"]').isDisabled(),false);
 await end(f.page);await waitPage(f,1);
 await f.page.waitForFunction(()=>document.querySelector('[data-control="prev"]').disabled&&document.querySelector('[data-control="next"]').disabled);
 for(let n=0;n<3;n++)await f.page.keyboard.press('Enter');await inertPointer(f.page,'prev');
 assert.equal(f.calls.pages,1);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 f.releasePage();await waitLoad(f.page,2,33);assert.equal(f.calls.pages,1);
});

await run('manual pending EOS failure releases lock for retry without autoplay',{kind:'pending-retry',playbackMode:'next'},async f=>{
 await f.open(paged());await activate(f.page,'next');await waitPage(f,1);await end(f.page);
 await f.page.waitForFunction(()=>document.querySelector('[data-control="play"]').getAttribute('aria-label')==='重播');
 f.releasePage();await f.page.locator('.player-toast').filter({hasText:'连播列表加载失败'}).waitFor();
 assert.equal(f.calls.pages,1);assert.equal(await f.page.evaluate(()=>window.__adjacentProbe.loads.length),1);
 await f.page.waitForFunction(()=>!document.querySelector('[data-control="next"]').disabled);
 assert.ok(!(await f.page.locator('body').innerText()).includes('秒后自动播放'));
 // EOS has placed focus in its recommendations. Return through the shelf
 // tabs to the primary row before retrying the same transport action.
 await f.page.keyboard.press('ArrowUp');await f.page.keyboard.press('ArrowUp');
 await activate(f.page,'next');await waitLoad(f.page,2,22);assert.equal(f.calls.pages,2);
});

await browser.close();
const sourcesEnd=await hashSources(),sourcesStable=JSON.stringify(sources)===JSON.stringify(sourcesEnd);
await writeFile(`${output}/results.json`,JSON.stringify({boundary:'Real React with controlled media/decoder; trusted input, synthetic accounts, intercepted non-Vite HTTP/WS. No TV or actual account actions.',sources,sourcesEnd,sourcesStable,results},null,2));
console.log(`${results.filter(result=>result.pass).length}/${results.length} passed; ${output}/results.json`);
if(!sourcesStable)console.log('INVALIDATED: production sources changed during this run');
process.exitCode=results.some(result=>!result.pass)||!sourcesStable?1:0;
