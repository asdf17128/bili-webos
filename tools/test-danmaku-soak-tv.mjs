// Real wall-clock TV soak. Numeric diagnostics only; restores local settings.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';
const minutes=Number(process.env.DM_SOAK_MINUTES||80);
if(!Number.isInteger(minutes)||minutes<1||minutes>120)throw Error('Invalid duration');
const seekProfile=process.env.DM_SOAK_PROFILE==='4k-seek';
const output=process.env.DM_SOAK_OUTPUT||'/tmp/bili-danmaku-soak-tv';mkdirSync(output,{recursive:true});
const run={startedAt:new Date().toISOString(),requestedMinutes:minutes,profile:seekProfile?'4k-seek':'mixed',seeks:[],samples:[],phases:[],errors:[],pass:false};
const save=()=>writeFileSync(output+'/results.json',JSON.stringify(run,null,2)+'\n');
let tv,original,stopped=false;
const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const snapshot=`(()=>{const v=document.querySelector('video'),stats=window.__shakaPlayer?.getStats();return {visible:document.visibilityState,time:v?.currentTime,duration:v?.duration,paused:v?.paused,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight,error:v?.error?.code||null,danmaku:window.__danmakuStats?.(),nodes:document.querySelectorAll('.danmaku-item').length,fixed:document.querySelectorAll('.danmaku-fixed').length,decoded:stats?.decodedFrames??null,dropped:stats?.droppedFrames??null,monitor:window.__dmMonitor?.read()};})()`;
async function capture(name){const r=await tv.call('Page.captureScreenshot',{format:'png'});writeFileSync(output+'/'+name+'.png',Buffer.from(r.data,'base64'));}
async function phase(index){
 await tv.evaluate('window.__dmMonitor?.clear();delete window.__dmMonitor');
 await tv.back();
 const idle=await tv.metrics({collect:true});run.phases.push({index,idle});save();
 await tv.evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('bili_settings')||'{}');Object.assign(s,{danmaku:true,danmakuDensity:${index%2?48:24},danmakuScale:${index%2?1.6:1},danmakuArea:1,danmakuScroll:true,danmakuTop:true,danmakuBottom:true,danmakuColor:true,quality:120,playbackMode:'repeat',autoplayNext:false});localStorage.setItem('bili_settings',JSON.stringify(s));window.__openVideo({bvid:'${index>=2?'BV1kX4y197P4':'BV1xx411c7Xg'}',resumeMode:'none'});})()`);
 await tv.wait("(()=>{const v=document.querySelector('video');return v&&v.currentTime>1&&!v.paused&&v.videoWidth>0&&window.__danmakuStats;})()",60000);
 if(index>=2)await tv.wait("document.querySelector('video').videoWidth>=3000",30000);
 await tv.evaluate(`(()=>{const v=document.querySelector('video');let last=v.currentTime,at=performance.now(),maximum=0,ticks=0,visiblePeak=0;const timer=setInterval(()=>{ticks++;const now=performance.now();visiblePeak=Math.max(visiblePeak,document.querySelectorAll('.danmaku-item').length);if(v.paused||v.seeking||v.ended||Math.abs(v.currentTime-last)>.05){last=v.currentTime;at=now;}else if(v.readyState>=1){maximum=Math.max(maximum,now-at);}},1000);window.__dmMonitor={read:()=>({ticks,maximumGapMs:Math.round(maximum),visiblePeak}),clear:()=>clearInterval(timer)};})()`);
 await sleep(4000);await capture('phase-'+index);console.log('PHASE',index,JSON.stringify(await tv.evaluate(snapshot)));
}
try{
 tv=await connectTv();original=await tv.evaluate('localStorage.getItem("bili_settings")');
 await phase(seekProfile?3:0);const started=Date.now();run.measurementStartedAt=new Date(started).toISOString();
 for(let n=0;n<=minutes*2;n++){
  const target=started+n*30000;while(Date.now()<target&&!stopped)await sleep(Math.min(1000,target-Date.now()));
  if(stopped)throw Error('Stopped by user');
  if(n>0&&n<minutes*2&&n%40===0)await phase(seekProfile?3:n/40);
  // Directed seeks after a full hour, while keeping the first hour mostly continuous.
  if((seekProfile||n>=120)&&n<minutes*2&&n%10===0){
   const seekStarted=Date.now(),fraction=[.3,.6,.85][Math.floor(n/10)%3];
   const target=await tv.evaluate(`(()=>{const v=document.querySelector('video');return v.currentTime=v.duration*${fraction};})()`);
   const seek={minute:n/2,fraction,target};run.seeks.push(seek);save();
   try{await tv.wait(`(()=>{const v=document.querySelector('video');return v&&!v.error&&!v.paused&&!v.seeking&&v.readyState>=2&&v.currentTime>${target+.2};})()`,20000);}
   finally{seek.recoveryMs=Date.now()-seekStarted;seek.state=await tv.evaluate(snapshot);save();console.log('SEEK',JSON.stringify(seek));}
  }
  const state=await tv.evaluate(snapshot),metrics=await tv.metrics();
  const row={minute:n/2,elapsedMs:Date.now()-started,...state,metrics};run.samples.push(row);save();
  assert.equal(state.visible,'visible','app left foreground');assert.ok(state.width>0&&state.ready>=2&&!state.error&&!state.paused,'video decoder unhealthy');
  assert.ok(state.danmaku,'loader missing');assert.ok(state.danmaku.cached<=3&&state.danmaku.items<=60000&&state.danmaku.pending<=1,'loader budget');
  assert.ok(state.nodes<=48,'DOM budget');assert.ok(state.monitor.maximumGapMs<20000,'playback stalled over 20 seconds');
  assert.equal(tv.errors.length,0,'uncaught page error');
  if(n%10===0){
   const health=await tv.evaluate(`new Promise(resolve=>{let done=false;const finish=r=>{if(!done){done=true;clearTimeout(timer);resolve(r)}};const timer=setTimeout(()=>finish({ok:false,timeout:true}),12000);webOS.service.request('luna://com.biliwebos.app.service/',{method:'fetch',parameters:{url:'https://api.bilibili.com/x/web-interface/nav'},onSuccess:r=>{let code;try{code=JSON.parse(r.body).code}catch{}finish({ok:r.status===200&&code===0,status:r.status,code})},onFailure:()=>finish({ok:false})});})`,15000);
   row.api=health;save();assert.ok(health.ok,'API health probe failed');
  }
  if(n%2===0)console.log('MINUTE',n/2,JSON.stringify({time:Math.round(state.time),nodes:state.nodes,loader:state.danmaku,heapMB:Math.round(metrics.heapBytes/1048576),gapMs:state.monitor.maximumGapMs,decoded:state.decoded,dropped:state.dropped}));
 }
 run.elapsedMs=Date.now()-started;assert.ok(run.elapsedMs>=minutes*60000,'real wall time');
 assert.ok(run.samples.some(s=>s.nodes>0),'no actual danmaku rendered');
 if(!seekProfile&&minutes>=12)assert.ok(run.samples.some(s=>s.danmaku.requests>=3),'segment boundary was not exercised');
 await capture('end');run.pass=true;
}catch(error){run.errors.push(error.message);console.error('FAIL',error.message);}
finally{
 if(tv){
  try{await tv.evaluate('window.__dmMonitor?.clear();delete window.__dmMonitor');await tv.back();run.finalIdle=await tv.metrics({collect:true});const base=run.phases[0]?.idle;if(base){run.retainedHeapBytes=run.finalIdle.heapBytes-base.heapBytes;run.retainedListeners=run.finalIdle.listeners-base.listeners;if(run.retainedHeapBytes>16*1048576||run.retainedListeners>60){run.pass=false;run.errors.push('idle retained resources require investigation');}}}catch(e){run.pass=false;run.errors.push('cleanup: '+e.message);}
  if(original!==undefined){try{await tv.evaluate(original===null?'localStorage.removeItem("bili_settings")':`localStorage.setItem('bili_settings',${JSON.stringify(original)})`);run.settingsRestored=await tv.evaluate('localStorage.getItem("bili_settings")')===original;}catch{run.settingsRestored=false;}if(!run.settingsRestored)run.pass=false;}
  run.pageErrors=tv.errors;tv.close();
 }
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);run.finishedAt=new Date().toISOString();save();console.log('RESULT',JSON.stringify({pass:run.pass,elapsedMs:run.elapsedMs,errors:run.errors,settingsRestored:run.settingsRestored}));if(!run.pass)process.exitCode=1;
}
