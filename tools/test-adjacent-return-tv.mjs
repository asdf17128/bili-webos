// Real TV navigation and playback. Video identities stay in page memory only;
// the report exports comparisons, media measurements and request counts.
// Entry: foreground BiliTV browse page with no active player. Returns to browse.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';

const output=process.env.TV_ADJACENT_OUTPUT||'/tmp/bili-adjacent-return-tv';
const fixture='BV1MTKp6bExe';
mkdirSync(output,{recursive:true,mode:0o700});
const report={startedAt:new Date().toISOString(),boundary:'Real TV view API, playback and trusted remote navigation. Identities stay in page memory; report contains comparisons only. Account POSTs are blocked except ordinary playback heartbeats. Screenshots remain private.',checks:[],screenshots:[],pass:false};
let tv,opened=false,guardInstalled=false;
const save=()=>writeFileSync(output+'/results.json',JSON.stringify(report,null,2)+'\n');
function check(name,pass,detail){report.checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});save();assert.ok(pass,name);console.log('PASS',name);}
async function shot(name){const image=await tv.call('Page.captureScreenshot',{format:'png'});writeFileSync(output+'/'+name+'.png',Buffer.from(image.data,'base64'),{mode:0o600});report.screenshots.push(name+'.png');}
const mediaExpression=`(()=>{const g=window.__adjacentReturnTv,v=document.querySelector('video');return {time:v?.currentTime,paused:v?.paused,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight,error:v?.error?.code||0,sequence:g?.acceptedSequence,navigationMetadata:g?.navigationMetadata,focus:document.querySelector('.player-control.focused')?.dataset.control}})()`;
async function controls(){if(await tv.evaluate("!!document.querySelector('.player-controls-vod.hidden')"))await tv.key('ArrowUp');await tv.wait("!!document.querySelector('.player-controls-vod:not(.hidden)')");}
async function focus(id){
  await controls();
  await tv.wait(`!!document.querySelector('.player-control[data-control="${id}"]:not(:disabled)')`,20000);
  for(let i=0;i<12;i++){
    const state=await tv.evaluate("({id:document.querySelector('.player-control.focused')?.dataset.control,ids:[...document.querySelectorAll('.player-control')].map(b=>b.dataset.control),hidden:!!document.querySelector('.player-controls-vod.hidden')})");
    if(state.hidden){await controls();continue;}
    if(state.id===id)return;
    const from=state.ids.indexOf(state.id),to=state.ids.indexOf(id);
    assert.ok(from>=0&&to>=0,'adjacent action retains primary remote focus');
    await tv.key(from<to?'ArrowRight':'ArrowLeft',80);
  }
  throw Error('Adjacent action was not reachable by remote');
}
async function observe(label,previousSequence){
  await tv.wait(`(()=>{const g=window.__adjacentReturnTv,v=document.querySelector('video');return g.acceptedSequence>${previousSequence}&&g.video===v&&v&&v.readyState>=2&&v.videoWidth>0&&v.currentTime>.1&&!v.paused&&!v.error})()`,60000);
  const first=await tv.evaluate(mediaExpression);
  check(label+' starts near the beginning with decoded dimensions',first.time>=0&&first.time<10&&first.width>0&&first.height>0,first);
  await sleep(700);
  const second=await tv.evaluate(mediaExpression);
  check(label+' advances real media time',second.sequence===first.sequence&&second.time>first.time+.2&&!second.paused&&second.ready>=2&&!second.error,{advance:second.time-first.time,width:second.width,height:second.height,error:second.error});
  await controls();await shot(label);
  return second.sequence;
}
async function navigate(id,label,previousSequence){await focus(id);await tv.key('Enter',60);return observe(label,previousSequence);}

try{
  tv=await connectTv();
  check('entry is foreground browse without active playback',await tv.evaluate("document.visibilityState==='visible'&&!document.querySelector('video')&&typeof window.__openVideo==='function'"));
  await tv.evaluate(`(()=>{
    if(window.__adjacentReturnTv)throw Error('Adjacent-return guard already installed');
    const original=webOS.service.request;
    const g={original,sequence:0,acceptedSequence:0,viewReplies:0,lastViewCode:null,blocked:0,heartbeatWrites:0,current:null,navigationMetadata:null,video:null,A:null,B:null,timers:[]};
    const reject=options=>{g.blocked++;const timer=setTimeout(()=>options.onSuccess?.({returnValue:true,statusCode:200,body:JSON.stringify({code:-403,message:'Test blocked an unrelated account change'})}),0);g.timers.push(timer);return{cancel(){clearTimeout(timer)}}};
    g.wrapper=function(uri,options){
      if(/repairDeviceIdentity|resetDeviceIdentity|setCookies|clearCookies/.test(options?.method||''))return reject(options);
      if(options?.method!=='fetch')return original.apply(this,arguments);
      const p=options.parameters||{};let url;
      try{url=new URL(p.url)}catch{return original.apply(this,arguments)}
      const method=String(p.method||'GET').toUpperCase();
      if(!['GET','HEAD'].includes(method)){
        if(url.pathname!=='/x/click-interface/web/heartbeat')return reject(options);
        g.heartbeatWrites++;
      }
      if(url.pathname==='/x/web-interface/view'){
        const sequence=++g.sequence,success=options.onSuccess;
        return original.call(this,uri,{...options,onSuccess:response=>{
          g.viewReplies++;
          try{
            const result=typeof response.body==='string'?JSON.parse(response.body):response.body;
            g.lastViewCode=Number.isFinite(result?.code)?result.code:null;
            if(sequence===g.sequence&&result?.code===0&&result.data?.bvid&&result.data?.cid){
              const data=result.data,sections=Array.isArray(data.ugc_season?.sections)?data.ugc_season.sections:[];
              const episodes=sections.reduce((all,section)=>all.concat(Array.isArray(section.episodes)?section.episodes:[]),[]);
              let currentIndex=episodes.findIndex(episode=>episode.cid&&String(episode.cid)===String(data.cid));
              if(currentIndex<0)currentIndex=episodes.findIndex(episode=>(episode.bvid&&String(episode.bvid)===String(data.bvid))||(episode.aid&&String(episode.aid)===String(data.aid)));
              // Only counts and a zero-based position leave page memory. A
              // missing collection membership stays -1, never an invented 0.
              g.navigationMetadata={pageCount:Array.isArray(data.pages)?data.pages.length:0,ugcSeason:{episodeCount:episodes.length,currentIndex}};
              g.current={bvid:String(data.bvid),cid:String(data.cid),title:String(data.title||'')};
              g.acceptedSequence=sequence;g.video=document.querySelector('video');
            }
          }catch{}
          success?.(response);
        }});
      }
      return original.apply(this,arguments);
    };
    g.same=(a,b)=>!!a&&!!b&&a.bvid===b.bvid&&a.cid===b.cid;
    webOS.service.request=g.wrapper;window.__adjacentReturnTv=g;
  })()`);guardInstalled=true;

  await tv.evaluate(`window.__openVideo({bvid:${JSON.stringify(fixture)},resumeMode:'none'})`);opened=true;
  let sequence=await observe('initial-A',0);
  await tv.evaluate('window.__adjacentReturnTv.A={...window.__adjacentReturnTv.current}');
  check('fresh standalone entry has Previous disabled',await tv.evaluate("document.querySelector('.player-control[data-control=prev]')?.disabled===true"));

  sequence=await navigate('next','next-B',sequence);
  check('Next changes to a different real video',await tv.evaluate('!window.__adjacentReturnTv.same(window.__adjacentReturnTv.current,window.__adjacentReturnTv.A)'));
  await tv.evaluate('window.__adjacentReturnTv.B={...window.__adjacentReturnTv.current}');

  sequence=await navigate('prev','back-A',sequence);
  check('Previous returns to the original video',await tv.evaluate('window.__adjacentReturnTv.same(window.__adjacentReturnTv.current,window.__adjacentReturnTv.A)'));
  sequence=await navigate('next','forward-B',sequence);
  check('Next after returning reopens the same next video',await tv.evaluate('window.__adjacentReturnTv.same(window.__adjacentReturnTv.current,window.__adjacentReturnTv.B)'));
  sequence=await navigate('prev','back-A-again',sequence);
  check('a second Previous returns to the original video',await tv.evaluate('window.__adjacentReturnTv.same(window.__adjacentReturnTv.current,window.__adjacentReturnTv.A)'));

  await tv.back();
  await tv.evaluate(`window.__openVideo({bvid:${JSON.stringify(fixture)},resumeMode:'none'})`);
  await observe('fresh-session-A',sequence);
  check('reopened entry is the original video with no previous-session history',await tv.evaluate("window.__adjacentReturnTv.same(window.__adjacentReturnTv.current,window.__adjacentReturnTv.A)&&document.querySelector('.player-control[data-control=prev]')?.disabled===true"));
  check('no uncaught page exceptions',tv.errors.length===0,{count:tv.errors.length});
  report.pass=true;
}catch(error){
  report.error=error.message;console.error('FAIL',error.message);
  if(tv){try{report.failureState=await tv.evaluate(mediaExpression)}catch{};try{await shot('failure')}catch{}}
}finally{
  if(tv){
    const cleanupErrors=[];
    try{if(opened)await tv.back()}catch(error){cleanupErrors.push('Back: '+error.message)}
    try{
      if(guardInstalled)report.guard=await tv.evaluate(`(()=>{const g=window.__adjacentReturnTv;if(!g)return null;const result={viewRequests:g.sequence,viewReplies:g.viewReplies,lastViewCode:g.lastViewCode,blocked:g.blocked,heartbeatWrites:g.heartbeatWrites};if(webOS.service.request!==g.wrapper)throw Error('Bridge wrapper changed during test');g.timers.forEach(clearTimeout);webOS.service.request=g.original;delete window.__adjacentReturnTv;return result})()`);
    }catch(error){cleanupErrors.push('Bridge: '+error.message)}
    try{report.cleanup=await tv.evaluate("({noPlayer:!document.querySelector('video'),guardRemoved:!window.__adjacentReturnTv,visible:document.visibilityState==='visible'})");if(!report.cleanup.noPlayer||!report.cleanup.guardRemoved)cleanupErrors.push('Cleanup incomplete')}catch(error){cleanupErrors.push('Inspect: '+error.message)}
    if(report.guard?.blocked){report.pass=false;report.blockedWriteFailure=true;}
    if(cleanupErrors.length){report.pass=false;report.cleanupErrors=cleanupErrors;}
    report.pageErrors=tv.errors;report.network=tv.network();tv.close();
  }
  report.finishedAt=new Date().toISOString();save();console.log('RESULT',JSON.stringify({pass:report.pass,checks:report.checks.length,error:report.error,guard:report.guard,cleanup:report.cleanup,output}));if(!report.pass)process.exitCode=1;
}
