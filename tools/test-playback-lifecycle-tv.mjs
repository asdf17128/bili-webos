// Repeated actual 4K playback and early exits in ONE TV document.
// Destruction instrumentation forwards the original promise; no media is mocked.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { connectTv, sleep } from './_tv-stability.mjs';

function pausedPositionStable(before, after) {
  return !!after?.paused && Math.abs(after.time - before.time) < .15;
}

const cycles=Number(process.env.TV_CYCLES||20);
if(!Number.isInteger(cycles)||cycles<1||cycles>100)throw new Error('TV_CYCLES must be 1..100');
// Actual D-pad input -> focus class mutation. Observer/listener ownership is
// local to each measurement and cleared BEFORE retained-resource checkpoints.
async function measureFocus(tv,label) {
  let row={label,samples:[]};
  try {
    for(let i=0;i<8;i++) {
      if(await tv.evaluate("!!document.querySelector('[data-focus-id^=sidebar].focused')"))break;
      await tv.key('ArrowLeft',100);
    }
    await tv.key('ArrowRight',100);
    await tv.wait("!!document.querySelector('.video-card[data-focus-id].focused')",5000);
    await tv.evaluate(`(()=>{
      if(window.__lifecycleFocus)throw new Error('A focus probe is already running');
      const s={samples:[],pending:null,start:document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id'),document:window.__lifecycleDocument};
      s.onKey=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight')s.pending={key:e.key,from:document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id'),at:performance.now()}};
      s.observer=new MutationObserver(records=>{
        if(!s.pending)return;
        for(const record of records){const el=record.target,to=el.getAttribute('data-focus-id');
          if(el.classList.contains('focused')&&to&&to!==s.pending.from){
            s.samples.push({key:s.pending.key,from:s.pending.from,to,ms:performance.now()-s.pending.at});s.pending=null;break;
          }
        }
      });
      s.observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
      window.addEventListener('keydown',s.onKey,true);window.__lifecycleFocus=s;
    })()`);
    for(let i=0;i<32;i++) {
      await tv.key(i%2?'ArrowLeft':'ArrowRight',75);
      await tv.wait(`window.__lifecycleFocus.samples.length>${i}`,2000);
    }
    row={...row,...await tv.evaluate(`(()=>{const s=window.__lifecycleFocus;return {samples:s.samples,start:s.start,document:s.document,end:document.querySelector('[data-focus-id].focused')?.getAttribute('data-focus-id')}})()`)};
  } catch(error) {
    row.error=error.message;
    try {row.samples=await tv.evaluate('window.__lifecycleFocus?.samples||[]')} catch {}
  } finally {
    try {await tv.evaluate(`(()=>{const s=window.__lifecycleFocus;if(s){s.observer.disconnect();window.removeEventListener('keydown',s.onKey,true);delete window.__lifecycleFocus}})()`)}
    catch(error){row.cleanupError=error.message;}
  }
  const sorted=row.samples.map(s=>s.ms).sort((a,b)=>a-b);
  row.p50=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.5))]:null;
  row.p95=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null;
  return row;
}
const output=process.env.UX_OUTPUT||'/tmp/bili-playback-lifecycle';
mkdirSync(output,{recursive:true});
const report={started:new Date().toISOString(),cyclesRequested:cycles,warmupCycles:3,
  scope:'Actual decode; native pause/seek stress; TV remote exit; no document reload between cycles',checks:[],cycles:[],retained:[],earlyExits:[],focus:[]};
const save=()=>writeFileSync(output+'/results.json',JSON.stringify(report,null,2)+'\n');
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail||''));save();};
let tv,original,marker=randomUUID();
try{
  tv=await connectTv();
  await tv.back();
  original=await tv.evaluate("localStorage.getItem('bili_settings')");
  await tv.evaluate(`window.__lifecycleDocument=${JSON.stringify(marker)};localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),quality:120,qualityMode:'manual',playbackMode:'stop'}))`);
  const state=()=>tv.evaluate(`(()=>{
    const v=document.querySelector('video'),p=window.__shakaPlayer,t=p?.getVariantTracks()?.find(x=>x.active);
    return {document:window.__lifecycleDocument,videoCount:document.querySelectorAll('video').length,
      playerPresent:!!p,domNodes:document.querySelectorAll('*').length,focusCount:document.querySelectorAll('[data-focus-id].focused').length,
      cdn:window.__cdnAuto?.()?.state,destroy:window.__cycleDestroy,
      video:v?{time:v.currentTime,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,paused:v.paused,error:v.error?.code||null,codec:t?.videoCodec}:null};
  })()`);
  const drain=async()=>{const deadline=Date.now()+10000;while(tv.network().media&&Date.now()<deadline)await sleep(200);return tv.network()};
  const retained=async cycle=>{
    await sleep(1200);
    const natural=await tv.metrics(),collected=await tv.metrics({collect:true});
    const row={cycle,natural,collected,state:await state()};report.retained.push(row);save();return row;
  };
  for(let i=1;i<=cycles+3;i++){
    const row={cycle:i-3,warmup:i<=3,started:new Date().toISOString()},started=Date.now();
    try{
      await tv.evaluate("window.__cycleDestroy={requested:0,done:0,failed:0};window.__openVideo({bvid:'BV1sapi6qE72',resumeMode:'none'})");
      await tv.wait("!!window.__shakaPlayer",30000);
      await tv.evaluate(`(()=>{const p=window.__shakaPlayer,original=p.destroy.bind(p),s=window.__cycleDestroy;
        p.destroy=function(){s.requested++;return original().then(v=>{s.done++;return v},e=>{s.failed++;throw e})};return true})()`);
      await tv.wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video')?.readyState>=2",50000);
      row.startupMs=Date.now()-started;row.playing=await state();
      check('cycle '+row.cycle+' actually decodes 4K',row.playing.video?.width>=3840&&row.playing.video?.height>=2160&&!row.playing.video?.error,row.playing.video);
      const t=row.playing.video.time;
      await tv.wait(`document.querySelector('video')?.currentTime>${t+1}`,15000);
      if(i%5===0){
        // Stress the media lifecycle; remote seek semantics have a separate suite.
        await tv.evaluate("document.querySelector('video').pause()");
        const paused=await state();await sleep(600);
        check('cycle '+row.cycle+' pause holds position',pausedPositionStable(paused.video,(await state()).video));
        await tv.evaluate("document.querySelector('video').currentTime=62;document.querySelector('video').play()");
        await tv.wait("document.querySelector('video')?.currentTime>63 && !document.querySelector('video').seeking",25000);
        row.seek=await state();
      }
    }catch(error){row.error=error.message;check('cycle '+row.cycle+' playback',false,error.message);}
    finally{
      const exit=Date.now();
      try{
        await tv.back();row.exitNetwork=tv.network();
        await tv.wait("window.__cycleDestroy?.done>=1 && !window.__shakaPlayer",15000);
        row.exitMs=Date.now()-exit;row.idle=await state();await drain();await sleep(2000);row.network=tv.network();
        check('cycle '+row.cycle+' starts no media after exit',row.network.startedMedia===row.exitNetwork.startedMedia,{afterExit:row.exitNetwork.startedMedia,afterIdle:row.network.startedMedia});
        check('cycle '+row.cycle+' releases player and media',row.idle.videoCount===0&&!row.idle.playerPresent&&row.idle.destroy?.requested===1&&row.idle.destroy?.done===1&&!row.idle.destroy?.failed&&row.idle.cdn==='stopped'&&row.network.media===0,row.idle.destroy);
        check('cycle '+row.cycle+' stays in same document',row.idle.document===marker);
        check('cycle '+row.cycle+' leaves one navigable focus',row.idle.focusCount===1,{count:row.idle.focusCount});
      }catch(error){row.exitError=error.message;check('cycle '+row.cycle+' cleanup',false,error.message);}
      report.cycles.push(row);save();
    }
    if(i===3||i===cycles+3){
      const focus=await measureFocus(tv,i===3?'before':'after');report.focus.push(focus);
      check(focus.label+' focus has 32 actual changes in same document',focus.samples.length>=30&&!focus.error&&!focus.cleanupError&&focus.document===marker,focus);
    }
    if(i===3||i>3&&(i-3)%5===0||i===cycles+3)await retained(i-3);
  }
  const [focusBefore,focusAfter]=report.focus;
  if(focusBefore&&focusAfter){
    check('focus follows the same route before and after',focusBefore.start===focusAfter.start&&JSON.stringify(focusBefore.samples.map(s=>[s.key,s.from,s.to]))===JSON.stringify(focusAfter.samples.map(s=>[s.key,s.from,s.to])));
    const delta=focusAfter.p95-focusBefore.p95,budget=Math.max(10,focusBefore.p95*.5);
    check('focus DOM response remains within investigation budget',focusBefore.p95!==null&&focusAfter.p95!==null&&focusBefore.p95<=50&&focusAfter.p95<=50&&delta<=budget,{beforeP95:focusBefore.p95,afterP95:focusAfter.p95,delta,budget,metric:'keydown to focus DOM mutation, excluding final paint'});
  }
  const first=report.retained[0]?.collected,last=report.retained.at(-1)?.collected;
  if(first&&last){
    const budget=Math.max(3*1024*1024,first.heapBytes*.25);
    check('retained JS heap within investigation budget',last.heapBytes-first.heapBytes<=budget,{baseline:first.heapBytes,last:last.heapBytes,growth:last.heapBytes-first.heapBytes,budget});
    const latter=report.retained.filter(r=>r.cycle>=cycles/2).map(r=>({cycle:r.cycle,heapBytes:r.collected.heapBytes}));
    const continuous=latter.length>=3&&latter.slice(1).every((r,i)=>r.heapBytes>latter[i].heapBytes);
    const latterGrowth=latter.length?latter.at(-1).heapBytes-latter[0].heapBytes:0;
    check('no sustained latter-half heap growth beyond investigation budget',!continuous||latterGrowth<=budget,{checkpoints:latter,continuous,growth:latterGrowth,budget});
    check('documents do not accumulate',last.documents<=first.documents,{baseline:first.documents,last:last.documents});
    check('event listeners do not accumulate beyond budget',last.listeners<=first.listeners+10,{baseline:first.listeners,last:last.listeners});
    check('total DOM nodes do not accumulate beyond budget',last.nodes<=first.nodes+100,{baseline:first.nodes,last:last.nodes});
  }
  // Exit before metadata/media settle. Keep the page alive to catch resurrection.
  for(let i=1;i<=5;i++){
    const row={cycle:i};
    try{
      await tv.evaluate("window.__openVideo({bvid:'BV1kX4y197P4',cid:1127214165,resumeMode:'none'})");
      await tv.wait("!!document.querySelector('video')",5000);
      row.before=await state();
      check('early exit '+i+' occurs before media ready',row.before.video?.ready<2&&row.before.video?.time===0,row.before.video);
      await tv.back();row.exitNetwork=tv.network();await drain();await sleep(2000);row.network=tv.network();row.state=await state();
      check('early exit '+i+' starts no media after exit',row.network.startedMedia===row.exitNetwork.startedMedia,{afterExit:row.exitNetwork.startedMedia,afterIdle:row.network.startedMedia});
      check('early exit '+i+' remains closed',row.state.document===marker&&row.state.videoCount===0&&!row.state.playerPresent&&row.network.media===0,row.network);
    }catch(error){row.error=error.message;check('early exit '+i,false,error.message);}
    report.earlyExits.push(row);save();
  }
  report.errors=tv.errors.slice();check('no uncaught JavaScript errors',tv.errors.length===0,{count:tv.errors.length});
}catch(error){check('completion',false,error.message);process.exitCode=1;}
finally{
  if(tv){
    try{await tv.back()}catch(error){check('final player exit',false,error.message)}
    try{if(original!==undefined){await tv.evaluate(original===null?"localStorage.removeItem('bili_settings')":`localStorage.setItem('bili_settings',${JSON.stringify(original)})`);check('original settings restored',await tv.evaluate("localStorage.getItem('bili_settings')")===original)}}
    catch(error){check('settings restoration',false,error.message)}
    try{await tv.evaluate(`(()=>{const s=window.__lifecycleFocus;if(s){s.observer.disconnect();window.removeEventListener('keydown',s.onKey,true)}delete window.__lifecycleFocus;delete window.__lifecycleDocument;delete window.__cycleDestroy})()`)}
    catch(error){check('test instrumentation cleanup',false,error.message)}
    tv.close();
  }
  report.finished=new Date().toISOString();save();
}
if(report.checks.some(x=>!x.pass))process.exitCode=1;
