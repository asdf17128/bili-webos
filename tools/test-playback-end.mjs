// Real React player and settings, controlled API + decoder; TV suite verifies real EOS.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.END_OUTPUT || '/tmp/bili-playback-end';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const first = { bvid: 'BVfirst', aid: 1, cid: 11, title: '第一集' };
const second = { bvid: 'BVsecond', aid: 2, cid: 22, title: '第二集' };
const stub = `class Player {
 static isBrowserSupported(){return true} async attach(v){this.video=v}
 configure(){} addEventListener(){} getVariantTracks(){return []} getStats(){return {}}
 getNetworkingEngine(){return {registerRequestFilter(){},registerResponseFilter(){},addEventListener(){}}}
 async load(){window.__probe.loads++;const v=this.video;v.__time=20;v.__paused=true;
 for(const [name,get] of Object.entries({currentTime:()=>v.__time,duration:()=>100,paused:()=>v.__paused,ended:()=>v.__time===100,readyState:()=>4}))
 Object.defineProperty(v,name,{configurable:true,get,set:name==='currentTime'?x=>{v.__time=x}:undefined});}
 retryStreaming(){return true} async destroy(){}
}
export default {Player,polyfill:{installAll(){}}};`;

async function run(name, settings, kind, fn) {
 if (process.env.END_FILTER && !new RegExp(process.env.END_FILTER).test(name)) return;
 const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
 await context.addInitScript(({settings}) => {
   delete window.webOS;
   if (!localStorage.getItem('bili_settings')) localStorage.setItem('bili_settings', JSON.stringify({language:'zh',...settings}));
   localStorage.setItem('bili_proxyUrl', JSON.stringify('http://127.0.0.1:9527'));
   localStorage.setItem('bili_perfopt', JSON.stringify({prefetchPage:false,warmPlayer:false}));
   window.__probe={loads:0,plays:0,rejectReplay:false};
   HTMLMediaElement.prototype.play=function(){
     window.__probe.plays++;
     if(window.__probe.rejectReplay)return Promise.reject(new Error('replay rejected'));
     this.__paused=false;this.dispatchEvent(new Event('play'));return Promise.resolve();
   };
   HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new Event('pause'));};
 }, {settings});
 const page=await context.newPage();page.setDefaultTimeout(5000);
 const calls={view:[],pages:0,deletes:0};const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let releasePage;
 const pageGate=new Promise(r=>{releasePage=r});
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.includes('shaka-player'))return route.fulfill({contentType:'application/javascript',body:stub});
   if(u.port==='5173')return route.continue();
   if(u.port==='9528')return route.abort();
   let data={};
   if(u.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://a/abcdefghijklmnopqrstuvwxyz123456.png'}};
   if(u.pathname.endsWith('/view')) {
     const item=u.searchParams.get('bvid')==='BVsecond'?second:first;calls.view.push(item.bvid);
     data={...item,pages:[{cid:item.cid,part:item.title}],owner:{mid:1,name:'测试'},stat:{}};
     if(kind==='parts')data.pages=[{cid:11,part:'第一P'},{cid:12,part:'第二P'}];
     if(kind==='season')data.ugc_season={sections:[{episodes:[first,second]}]};
   }
   if(u.pathname.endsWith('/playurl')) {
     if(kind==='load-error'&&u.searchParams.get('bvid')==='BVfirst')return route.fulfill({json:{code:-404,message:'unavailable'}});
     data={quality:80,accept_quality:[80],dash:{duration:100,video:[{id:80,bandwidth:1000,baseUrl:'https://media.bilivideo.com/video',codecs:'avc1.640028',width:1920,height:1080,SegmentBase:{Initialization:'0-1',indexRange:'2-3'}}],audio:[]}};
   }
   if(u.pathname.endsWith('/related'))data=[second];
   if(u.pathname.endsWith('/list.so'))return route.fulfill({contentType:'text/xml',body:'<i/>'});
   if(u.pathname.endsWith('/toview/del'))calls.deletes++;
   if(u.pathname.endsWith('/resource/list')){
     calls.pages++;
     if(kind==='pending')await pageGate;
     if(kind==='page-error')return route.fulfill({json:{code:-500,message:'failed'}});
     data={medias:[second],has_more:false};
   }
   return route.fulfill({json:{code:0,data}});
 });
 try {
   await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!!window.__openVideo);
   await page.clock.install();
   const item={...first,resumeMode:'none'};
   if(['playlist','watchlater','load-error'].includes(kind))Object.assign(item,{playlist:[first,second],playlistIndex:0});
   if(kind==='watchlater')item.fromToView=true;
   if(['paged','pending','page-error'].includes(kind))Object.assign(item,{playlist:[first],playlistIndex:0,playlistSource:{id:1,type:11,hasMore:true,nextPage:2}});
   const open=async()=>{
     await page.evaluate(v=>window.__openVideo(v),item);
     if(kind==='load-error')return;
     await page.waitForFunction(()=>window.__probe.loads===1);
     await page.waitForTimeout(150);
   };
   const end=()=>page.evaluate(()=>{const v=document.querySelector('video');v.__time=100;v.__paused=true;v.dispatchEvent(new Event('pause'));v.dispatchEvent(new Event('ended'));});
   const state=()=>page.evaluate(()=>({ ...window.__probe,time:document.querySelector('video')?.currentTime,paused:document.querySelector('video')?.paused,countdown:/秒后自动播放/.test(document.body.textContent),error:document.body.textContent.includes('去网络诊断') }));
   await fn({page,open,end,state,calls,releasePage});
   assert.deepEqual(errors,[],'no uncaught browser errors');results.push({name,pass:true});console.log('PASS',name);
 }catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);await page.screenshot({path:`${output}/failure-${results.length}.png`});}
 finally{releasePage();await context.close();}
}

for(const kind of ['home','playlist','watchlater','parts','season','paged']) {
 await run(`legacy off stops ${kind}`,{autoplayNext:false},kind,async({page,open,end,state,calls})=>{
   await open();await end();await page.waitForTimeout(300);await page.clock.runFor(11000);
   const s=await state();assert.equal(s.loads,1);assert.equal(s.time,100);assert.equal(s.paused,true);assert.equal(s.countdown,false);assert.equal(calls.pages,0);
 });
 await run(`repeat stays on current ${kind}`,{playbackMode:'repeat'},kind,async({page,open,end,state,calls})=>{
   await open();await end();await page.waitForTimeout(300);
   const s=await state();assert.equal(s.loads,1);assert.equal(s.time,0);assert.equal(s.paused,false);assert.equal(s.countdown,false);assert.equal(calls.pages,0);
 });
}
for(const kind of ['playlist','watchlater','parts','season','paged'])await run(`next advances ${kind}`,{},kind,async({page,open,end,state})=>{
 await open();await end();await page.waitForFunction(()=>window.__probe.loads===2);assert.equal((await state()).loads,2);
});
await run('next keeps related countdown',{},'home',async({page,open,end,state})=>{
 await open();await end();await page.waitForFunction(()=>/秒后自动播放/.test(document.body.textContent));
 await page.clock.runFor(11000);await page.waitForFunction(()=>window.__probe.loads===2);assert.equal((await state()).loads,2);
});
await run('explicit stop overrides legacy on',{playbackMode:'stop',autoplayNext:true},'playlist',async({page,open,end,state})=>{
 await open();await end();await page.waitForTimeout(300);assert.equal((await state()).loads,1);
});
await run('repeat rejection stops with replay controls',{playbackMode:'repeat'},'playlist',async({page,open,end,state})=>{
 await open();await page.evaluate(()=>window.__probe.rejectReplay=true);await end();await page.waitForTimeout(300);
 const s=await state();assert.equal(s.loads,1);assert.equal(s.paused,true);assert.equal(s.countdown,false);
 assert.ok(await page.locator('.player-controls').isVisible());
});
await run('watch later removal still occurs once while repeating',{playbackMode:'repeat',toviewAutoRemove:true},'watchlater',async({page,open,end,state,calls})=>{
 await open();await end();await page.waitForTimeout(150);await end();await page.waitForTimeout(150);
 assert.equal(calls.deletes,1);assert.equal((await state()).loads,1);
});
for(const action of ['leave','stop'])await run(`pending playlist respects ${action}`,{},'pending',async({page,open,end,state,calls,releasePage})=>{
 await open();await end();await page.waitForTimeout(150);assert.equal(calls.pages,1);
 if(action==='leave')await page.keyboard.press('Escape');
 else await page.evaluate(()=>localStorage.setItem('bili_settings',JSON.stringify({playbackMode:'stop'})));
 releasePage();await page.waitForTimeout(300);assert.equal((await state()).loads,1);
 if(action==='leave')assert.equal(await page.locator('.player-page').count(),0);
});
await run('playlist request failure stops without related countdown',{},'page-error',async({page,open,end,state})=>{
 await open();await end();await page.waitForTimeout(300);const s=await state();assert.equal(s.loads,1);assert.equal(s.countdown,false);
 assert.ok((await page.locator('body').innerText()).includes('连播列表加载失败'));
});
await run('stop does not skip an unavailable playlist video',{autoplayNext:false},'load-error',async({page,open,state,calls})=>{
 await open();await page.clock.runFor(10000);await page.waitForFunction(()=>document.body.textContent.includes('去网络诊断'));
 assert.ok(!calls.view.includes('BVsecond'));assert.equal((await state()).loads,0);
});
await run('settings picker persists modes and cancels with Back',{},'home',async({page})=>{
 await page.locator('.sidebar-item').filter({hasText:'设置'}).click();
 const row=page.locator('.settings-row').filter({hasText:'播放结束后'});
 await row.click();await page.locator('.settings-picker').waitFor();
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await row.locator('.settings-row-value').innerText(),'播完停止');
 await row.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Backspace');
 assert.equal(await row.locator('.settings-row-value').innerText(),'播完停止');
 await row.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await row.locator('.settings-row-value').innerText(),'单集循环');
 await page.screenshot({path:`${output}/settings-repeat.png`});
 await page.reload();await page.locator('.sidebar-item').filter({hasText:'设置'}).click();
 assert.equal(await row.locator('.settings-row-value').innerText(),'单集循环');
 await row.click();await page.screenshot({path:`${output}/settings-picker.png`});
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
 assert.equal(await row.locator('.settings-row-value').innerText(),'自动连播');
});

await browser.close();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);process.exitCode=results.some(r=>!r.pass)?1:0;
