// Real TV/CDP controls and real media; engagement API results are isolated before
// Luna sends them. No likes, coins, favorites or triple calls reach Bilibili.
// Entry: foreground BiliTV, logged in, no player open. Finally returns to browse.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';

const output = process.env.TV_ENGAGEMENT_OUTPUT || '/tmp/bili-engagement-tv';
const fixture = process.env.TV_ENGAGEMENT_BVID || 'BV1MTKp6bExe';
assert.match(fixture, /^BV[0-9A-Za-z]+$/);
mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), boundary: 'Real TV media, DOM and trusted CDP keys; Like/Coin/Favorite/Triple and relation responses intercepted before Luna dispatch. Not real account-write acceptance or physical-screen confirmation.', checks: [], screenshots: [], pass: false };
let tv, guardInstalled = false, opened = false;
const save = () => writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) }); save();
  assert.ok(pass, name); console.log('PASS', name);
}
async function shot(name) {
  const image = await tv.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${output}/${name}.png`, Buffer.from(image.data, 'base64'));
  report.screenshots.push(name + '.png'); save();
}
const primary = '.player-controls-vod .player-control';
const stateExpression = `(() => {
  const v=document.querySelector('video');
  return { visible:!!document.querySelector('.player-controls-vod:not(.hidden)'),
    focused:document.querySelector('${primary}.focused')?.getAttribute('data-control'),
    controls:[...document.querySelectorAll('${primary}')].map(b=>({id:b.dataset.control,disabled:b.disabled,pressed:b.getAttribute('aria-pressed'),feedback:b.dataset.feedback||null,count:b.querySelector('.player-control-value')?.textContent||null,badge:b.querySelector('.player-control-status')?.textContent||null})),
    media:v?{paused:v.paused,time:v.currentTime,duration:v.duration,width:v.videoWidth,height:v.videoHeight,ready:v.readyState,error:v.error?.code||0}:null,
    caption:document.querySelector('.player-control-caption')?.textContent||'',
    expanded:!!document.querySelector('.player-controls-vod.recommendations-open') };
})()`;
const state = () => tv.evaluate(stateExpression);
async function focus(id) {
  for (let i=0;i<12;i++) {
    const s=await state();
    if (!s.visible) { await tv.key('ArrowUp'); continue; }
    if (s.focused===id) return;
    const ids=s.controls.map(x=>x.id), current=ids.indexOf(s.focused), target=ids.indexOf(id);
    assert.ok(target>=0 && !s.controls[target].disabled, 'target available: '+id);
    assert.ok(current>=0, 'primary control has remote focus');
    await tv.key(current<target?'ArrowRight':'ArrowLeft',80);
  }
  throw Error('Remote focus did not reach '+id);
}
async function phase(id, value) {
  await tv.wait(`document.querySelector('${primary}[data-control="${id}"]')?.dataset.feedback===${JSON.stringify(value)}`,8000);
}
async function count(id) { return tv.evaluate(`window.__engagementTv.calls[${JSON.stringify(id)}]||0`); }
async function release(id) { await tv.evaluate(`window.__engagementTv.release(${JSON.stringify(id)})`); }
async function pressPending(id) { await focus(id); await tv.key('Enter',60); await phase(id,'pending'); }
const button = (s,id) => s.controls.find(b=>b.id===id);

try {
  tv=await connectTv();
  check('entry is foreground browse with no active player', await tv.evaluate("document.visibilityState==='visible' && !document.querySelector('video') && typeof window.__openVideo==='function'"));
  await tv.evaluate(`(() => {
    if(window.__engagementTv)throw Error('Engagement test guard already installed');
    const original=webOS.service.request;
    const g={original,calls:{},blocked:0,violations:0,heartbeatWrites:0,aid:null,rel:{like:false,coin:0,favorite:false},pending:{},rejectNext:{},timers:[]};
    const ids={
      '/x/web-interface/archive/relation':'relation',
      '/x/web-interface/archive/like':'like',
      '/x/web-interface/coin/add':'coin',
      '/x/v3/fav/folder/created/list-all':'folders',
      '/x/v3/fav/resource/deal':'fav',
      '/x/web-interface/archive/like/triple':'triple'
    };
    const answer=(options,data)=>options.onSuccess({returnValue:true,statusCode:200,body:JSON.stringify(data)});
    const immediate=(options,data)=>{const timer=setTimeout(()=>answer(options,data),40);g.timers.push(timer);return{cancel(){clearTimeout(timer)}}};
    g.release=id=>{const job=g.pending[id];if(!job)throw Error('No pending '+id);delete g.pending[id];job();};
    g.wrapper=function(uri,options){
      const p=options?.parameters||{};
      if(/repairDeviceIdentity|resetDeviceIdentity|setCookies|clearCookies/.test(options?.method||'')){
        g.blocked++;return immediate(options,{code:-403,message:'Test blocked an unrelated account change'});
      }
      if(options?.method!=='fetch')return original.apply(this,arguments);
      let u;try{u=new URL(p.url)}catch{return original.apply(this,arguments)}
      const id=ids[u.pathname], method=String(p.method||'GET').toUpperCase();
      if(u.pathname==='/x/web-interface/view' && u.searchParams.get('bvid')===${JSON.stringify(fixture)}){
        const success=options.onSuccess;
        const wrapped={...options,onSuccess:response=>{try{const result=JSON.parse(response.body);if(result.code===0&&result.data?.aid)g.aid=String(result.data.aid)}catch{};success(response)}};
        return original.call(this,uri,wrapped);
      }
      if(id){
        g.calls[id]=(g.calls[id]||0)+1;
        const form=new URLSearchParams(p.body||''), aid=id==='fav'?form.get('rid'):method==='GET'?u.searchParams.get(id==='folders'?'rid':'aid'):form.get('aid');
        if(!g.aid||String(aid)!==g.aid){g.violations++;return immediate(options,{code:-403,message:'Test fixture identity mismatch'});}
        if(id==='relation')return immediate(options,{code:0,data:{...g.rel}});
        if(id==='folders')return immediate(options,{code:0,data:{list:[{id:987654,title:'Synthetic test folder',fav_state:g.rel.favorite?1:0}]}});
        if(g.pending[id]){g.violations++;return immediate(options,{code:-403,message:'Duplicate test request'});}
        let cancelled=false;
        g.pending[id]=()=>{
          if(cancelled)return;
          if(g.rejectNext[id]){delete g.rejectNext[id];answer(options,{code:-400,message:'测试接口拒绝，请重试'});return;}
          const before={...g.rel};
          if(id==='like')g.rel.like=form.get('like')!=='2';
          if(id==='coin')g.rel.coin=Math.min(2,g.rel.coin+1);
          if(id==='fav')g.rel.favorite=!!form.get('add_media_ids');
          if(id==='triple')g.rel={like:true,coin:2,favorite:true};
          answer(options,{code:0,data:id==='triple'?{like:!before.like,coin:before.coin<2,fav:!before.favorite,multiply:2-before.coin}:{}});
        };
        return{cancel(){cancelled=true;delete g.pending[id]}};
      }
      // Playback heartbeats may proceed. No other HTTP mutation is allowed.
      if(!['GET','HEAD'].includes(method)&&u.pathname!=='/x/click-interface/web/heartbeat'){
        g.blocked++;return immediate(options,{code:-403,message:'Test blocked an unrelated write'});
      }
      if(method!=='GET'&&method!=='HEAD'&&u.pathname==='/x/click-interface/web/heartbeat')g.heartbeatWrites++;
      return original.apply(this,arguments);
    };
    webOS.service.request=g.wrapper;window.__engagementTv=g;
  })()`);
  guardInstalled=true;
  await tv.evaluate(`window.__openVideo({bvid:${JSON.stringify(fixture)},resumeMode:'none'})`); opened=true;
  await tv.wait("document.querySelector('video')?.videoWidth>0 && document.querySelector('video').currentTime>1 && document.querySelector('video').readyState>=2",60000);
  await tv.wait('window.__engagementTv.calls.relation>0',15000);
  await sleep(200);
  let s=await state();
  check('real playback is advancing with decoded dimensions', s.media&&!s.media.paused&&!s.media.error&&s.media.width>0,s.media);
  if(s.visible)await tv.key('GoBack');
  await tv.wait("!!document.querySelector('.player-controls-vod.hidden')");
  await tv.key('ArrowUp');
  s=await state();
  check('opening controls starts at Play/Pause',s.focused==='play');
  check('primary order has all three requested groups',JSON.stringify(s.controls.map(x=>x.id))===JSON.stringify(['like','coin','fav','later','prev','play','next','comments','settings']));
  check('engagement controls are available', ['like','coin','fav'].every(id=>!button(s,id).disabled));
  await shot('controls-default-play');
  await tv.key('Enter'); await tv.wait("document.querySelector('video').paused");
  const pausedTime=await tv.evaluate("document.querySelector('video').currentTime");
  await sleep(700);check('remote pause stops media time',Math.abs(await tv.evaluate("document.querySelector('video').currentTime")-pausedTime)<.2);
  await tv.key('Enter'); await tv.wait(`!document.querySelector('video').paused && document.querySelector('video').currentTime>${pausedTime+.4}`,15000);
  check('remote Play resumes media',true);
  await focus('settings');await tv.key('Enter');await tv.wait("!!document.querySelector('.player-more-panel')");
  const settings=await tv.evaluate("[...document.querySelectorAll('.player-more-action')].map(x=>x.dataset.control)");
  check('playback settings retain the main actions',['quality','speed','danmaku','danmakuSettings'].every(id=>settings.includes(id)),settings);
  await shot('playback-settings');await tv.key('GoBack');
  await tv.wait("!document.querySelector('.player-more-panel')");check('Back restores Settings focus',(await state()).focused==='settings');

  await focus('play');await tv.key('ArrowDown');await tv.wait("!!document.querySelector('.player-controls-vod.recommendations-open')");await sleep(650);
  const shelf=await tv.evaluate(`(()=>{const list=document.querySelector('.player-related-scroll'),view=list.getBoundingClientRect();const cards=[...list.querySelectorAll('.related-card')].map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,width:r.width,height:r.height,shared:!!e.querySelector('.video-card-info')}});const rows=[...new Set(cards.map(c=>Math.round(c.top)))];return{cards:cards.length,rows:rows.length,visibleRows:rows.filter(y=>cards.some(c=>Math.abs(c.top-y)<1&&c.top>=view.top-2&&c.bottom<=Math.min(view.bottom,innerHeight)+2)).length,shared:cards.every(c=>c.shared),card:cards[0],viewport:{top:view.top,bottom:view.bottom}}})()`);
  check('recommendation shelf uses full cards and displays two available rows',shelf.cards>0&&shelf.shared&&(shelf.rows<2||shelf.visibleRows>=2),shelf);
  if(shelf.rows<2)report.checks.push({name:'two recommendation rows',skipped:true,reason:'Live fixture has fewer than two rows; full two-row geometry not verified'});
  await tv.wait("[...document.querySelectorAll('.related-card')].slice(0,8).every(c=>!c.querySelector('img')||c.querySelector('img').complete)",15000);
  const covers=await tv.evaluate(`(()=>{const cards=[...document.querySelectorAll('.related-card')].slice(0,8);return cards.map(c=>{const img=c.querySelector('img'),fallback=c.querySelector(img?'.video-card-placeholder':'.video-card-missing');return {hasImage:!!img,loaded:!!img&&img.naturalWidth>0,imageHidden:!!img&&getComputedStyle(img).visibility==='hidden',ready:!!img&&img.classList.contains('image-ready'),fallbackVisible:!!fallback&&getComputedStyle(fallback).visibility==='visible'}})})()`);
  check('recommendation covers show loaded images or a readable failure placeholder',covers.length>0&&covers.every(c=>c.loaded?c.ready:((!c.hasImage||c.imageHidden)&&c.fallbackVisible)),{covers,failedImages:covers.filter(c=>c.hasImage&&!c.loaded).length});
  await shot('recommendations-expanded');await tv.key('GoBack');await tv.wait("!document.querySelector('.player-controls-vod.recommendations-open')");
  check('Back collapses recommendations and keeps playback',!!(await state()).media);

  // Each held response gives the real TV renderer time to show pending state.
  await pressPending('like');const before=await state();await shot('like-pending');
  for(let n=0;n<3;n++)await tv.key('Enter',30);
  await focus('coin');await tv.key('Enter',30);
  check('pending like blocks repeated OK and another engagement action',(await count('like'))===1&&(await count('coin'))===0);
  check('pending does not claim a successful like',button(before,'like').pressed==='false');
  await focus('like');await release('like');await phase('like','success');
  s=await state();check('like success lights the focused button',button(s,'like').pressed==='true'&&/已点赞/.test(s.caption));await shot('like-success');
  await sleep(2350);check('like badge persists after temporary feedback',await tv.evaluate("!!document.querySelector('[data-control=like][aria-pressed=true] .player-control-status')"));
  await pressPending('like');await release('like');await phase('like','success');s=await state();check('like cancellation is explicit',button(s,'like').pressed==='false'&&/取消/.test(s.caption));
  const initialLikeCount=button(s,'like').count;
  await tv.evaluate("window.__engagementTv.rejectNext.like=true");await pressPending('like');await release('like');await phase('like','error');s=await state();
  check('failed like leaves state and count unchanged',button(s,'like').pressed==='false'&&button(s,'like').count===initialLikeCount);await shot('like-error');
  await pressPending('like');await release('like');await phase('like','success');check('explicit retry succeeds',button(await state(),'like').pressed==='true');

  await pressPending('fav');await tv.key('Enter',30);check('pending favorite submits once',(await count('fav'))===1);await release('fav');await phase('fav','success');
  s=await state();check('favorite success shows a persistent check',button(s,'fav').pressed==='true'&&await tv.evaluate("!!document.querySelector('[data-control=fav] .player-control-status svg')"));await shot('favorite-success');
  await pressPending('fav');await release('fav');await phase('fav','success');check('favorite cancellation is explicit',button(await state(),'fav').pressed==='false'&&/取消/.test((await state()).caption));

  for(const n of [1,2]){
    await pressPending('coin');await tv.key('Enter',30);check('pending coin '+n+' submits once',(await count('coin'))===n);await release('coin');await phase('coin','success');
    s=await state();check('confirmed coin '+n+' remains visible',button(s,'coin').pressed==='true'&&button(s,'coin').badge===String(n));
  }
  await shot('coin-two');await tv.key('Enter');check('two-coin limit prevents another submission',(await count('coin'))===2&&(await state()).caption.includes('两枚'));
  await focus('like');
  await tv.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await sleep(2150);
  await tv.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await phase('like','pending');
  await focus('fav');await tv.key('Enter',30);check('pending triple blocks separate actions',(await count('triple'))===1&&(await count('fav'))===2);
  await focus('like');await release('triple');await phase('like','success');
  s=await state();check('triple success preserves all three active markers',['like','coin','fav'].every(id=>button(s,id).pressed==='true'));await shot('triple-success');
  report.guard=await tv.evaluate("({calls:window.__engagementTv.calls,blocked:window.__engagementTv.blocked,heartbeatWrites:window.__engagementTv.heartbeatWrites,violations:window.__engagementTv.violations,pending:Object.keys(window.__engagementTv.pending).length})");
  check('isolated engagement contract had no unexpected writes',report.guard.blocked===0&&report.guard.violations===0&&report.guard.pending===0,report.guard);
  check('no uncaught page exceptions',tv.errors.length===0,{count:tv.errors.length});
  report.mediaEnd=(await state()).media;check('media remains healthy after control interactions',report.mediaEnd&&!report.mediaEnd.paused&&!report.mediaEnd.error&&report.mediaEnd.ready>=2,report.mediaEnd);
  report.pass=true;
}catch(error){
  report.error=error.message;console.error('FAIL',error.message);
  if(tv){try{report.failureState=await state()}catch{};try{await shot('failure')}catch{}}
}finally{
  if(tv){
    const cleanupErrors=[];
    // Exit, remove instrumentation and inspect cleanup independently: a failed
    // Back must never skip restoration of the service bridge.
    try{if(opened)await tv.back()}catch(error){cleanupErrors.push('Back: '+error.message)}
    try{
      if(guardInstalled){
        const finalGuard=await tv.evaluate(`(()=>{const g=window.__engagementTv;if(!g)return null;const result={calls:g.calls,blocked:g.blocked,heartbeatWrites:g.heartbeatWrites,violations:g.violations,pending:Object.keys(g.pending).length};if(webOS.service.request!==g.wrapper)throw Error('Bridge wrapper changed during test');g.timers.forEach(clearTimeout);Object.keys(g.pending).forEach(k=>delete g.pending[k]);webOS.service.request=g.original;delete window.__engagementTv;return result})()`);
        if(finalGuard)report.guard=finalGuard;
      }
    }catch(error){cleanupErrors.push('Bridge: '+error.message)}
    try{
      report.cleanup=await tv.evaluate("({noPlayer:!document.querySelector('video'),guardRemoved:!window.__engagementTv,visible:document.visibilityState==='visible'})");
      if(!report.cleanup.noPlayer||!report.cleanup.guardRemoved)cleanupErrors.push('Cleanup incomplete');
    }catch(error){cleanupErrors.push('Inspect: '+error.message)}
    if(cleanupErrors.length){report.pass=false;report.cleanupErrors=cleanupErrors}
    report.pageErrors=tv.errors;report.network=tv.network();tv.close();
  }
  report.finishedAt=new Date().toISOString();save();console.log('RESULT',JSON.stringify({pass:report.pass,checks:report.checks.length,error:report.error,cleanup:report.cleanup,output}));
  if(!report.pass)process.exitCode=1;
}
