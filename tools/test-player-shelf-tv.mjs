// Real TV input-to-animation timing. Begin sampling at the device's trusted
// input event, not before a potentially slow round trip through the SSH tunnel.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';
const output = process.env.TV_OUTPUT || '/tmp/bili-player-shelf-tv';
mkdirSync(output, { recursive: true });
const results = [];
const tv = await connectTv();
async function observe(input, expand) {
  await tv.evaluate(`(() => {
    const el=document.querySelector('.player-controls-vod');
    if(window.__shelfProbe) throw Error('Probe already active');
    const probe={frames:[],event:null,raf:0,image:el.querySelector('.player-related-scroll img')};
    const capture=e=>{
      if(probe.event || (e.type==='keydown' && e.key!==${JSON.stringify(expand ? 'ArrowDown' : 'GoBack')})) return;
      probe.event={type:e.type,key:e.key,trusted:e.isTrusted,at:performance.now()};
      const sample=()=>{
        const now=performance.now();
        const list=el.querySelector('.player-related-scroll'),image=list?.querySelector('img'),r=list?.getBoundingClientRect(),ir=image?.getBoundingClientRect();
        probe.frames.push({ms:now-probe.event.at,top:el.getBoundingClientRect().top,expanded:el.classList.contains('recommendations-open'),sameImage:probe.image===image,visibleImageHeight:r&&ir?Math.max(0,Math.min(ir.bottom,r.bottom,innerHeight)-Math.max(ir.top,r.top,0)):0,animations:[...el.getAnimations(),...(list?.getAnimations()||[])].map(a=>({time:a.currentTime,state:a.playState}))});
        if(now-probe.event.at<900) probe.raf=requestAnimationFrame(sample);
      };
      sample();
    };
    probe.cleanup=()=>{cancelAnimationFrame(probe.raf);window.removeEventListener(${JSON.stringify(input)},capture,true);delete window.__shelfProbe;};
    window.__shelfProbe=probe;window.addEventListener(${JSON.stringify(input)},capture,true);
  })()`);
  if (input === 'keydown') await tv.key(expand ? 'ArrowDown' : 'GoBack');
  else {
    const point = await tv.evaluate("(() => {const r=document.querySelector('.player-related-heading').getBoundingClientRect();return {x:r.x+60,y:Math.max(10,Math.min(innerHeight-10,r.y+10))};})()");
    await tv.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: expand ? 120 : -120 });
  }
  await sleep(1000);
  const result=await tv.evaluate(`(() => {
    const p=window.__shelfProbe,el=document.querySelector('.player-controls-vod'),v=document.querySelector('video');
    const r={event:p.event,frames:p.frames,expanded:el.classList.contains('recommendations-open'),top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height,viewport:innerHeight,headingTop:el.querySelector('.player-related-heading').getBoundingClientRect().top,rows:[...el.querySelectorAll('.related-card')].slice(0,8).map(c=>({top:c.getBoundingClientRect().top,bottom:c.getBoundingClientRect().bottom})),media:{width:v.videoWidth,time:v.currentTime,paused:v.paused}};
    p.cleanup();return r;
  })()`);
  result.input=input; result.targetExpanded=expand;
  const first=result.frames[0]?.top, last=result.top;
  result.intermediate=result.frames.filter(f=>f.top>Math.min(first,last)+5&&f.top<Math.max(first,last)-5).length;
  result.continuous=result.frames.every(f=>f.sameImage) && result.frames.every((f,i,a)=>!i || (expand ? f.visibleImageHeight>=a[i-1].visibleImageHeight-2 : f.visibleImageHeight<=a[i-1].visibleImageHeight+2));
  result.pass=!!result.event?.trusted && result.expanded===expand && result.intermediate>=3 && result.continuous;
  results.push(result);
  writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify({input,expand,event:result.event,frames:result.frames.length,intermediate:result.intermediate,continuous:result.continuous,pass:result.pass}));
  assert.ok(result.event?.trusted,'trusted input reached TV (otherwise injection is unverified)');
  assert.equal(result.expanded,expand,'shelf state');
  assert.ok(result.continuous,'same card images are revealed or hidden monotonically');

  if(expand) {
    assert.equal(result.rows.length,8,'two populated rows');
    assert.ok(result.headingTop>=0 && result.rows.every(r=>r.top>=0&&r.bottom<=result.viewport),'full-size cards and tabs fit screen');
  }
}
try {
  await tv.back();
  await tv.evaluate("window.__openVideo({bvid:'BV1sapi6qE72',resumeMode:'none'})");
  await tv.wait("document.querySelector('video')?.currentTime>3 && document.querySelector('video').videoWidth>0",60000);
  if(await tv.evaluate("document.querySelector('.player-controls')?.classList.contains('hidden')")) await tv.key('ArrowUp');
  await tv.wait("!!document.querySelector('.player-author-followers')",15000);
  await tv.evaluate(`(() => {
    const node=document.querySelector('.player-author-followers'),text=node.textContent;
    const p={frames:[],raf:0};
    p.begin=e=>{if(e.key!=='GoBack')return;window.removeEventListener('keydown',p.begin,true);const start=performance.now();const sample=()=>{const count=document.querySelector('.player-author-followers');p.frames.push({opacity:Number(getComputedStyle(document.querySelector('.player-controls')).opacity),same:count===node,unchanged:count?.textContent===text});if(performance.now()-start<500)p.raf=requestAnimationFrame(sample);};sample();};
    p.cleanup=()=>{cancelAnimationFrame(p.raf);window.removeEventListener('keydown',p.begin,true);delete window.__followerFadeTv;};window.__followerFadeTv=p;window.addEventListener('keydown',p.begin,true);
  })()`);
  await tv.key('GoBack');await sleep(600);
  const followerFrames=await tv.evaluate('window.__followerFadeTv.frames');
  const followerResult={name:'follower count remains mounted throughout TV fade',pass:followerFrames.length>0&&followerFrames.every(f=>f.same&&f.unchanged),frames:followerFrames};
  writeFileSync(`${output}/follower-fade.json`,JSON.stringify(followerResult,null,2));
  assert.ok(followerResult.pass,followerResult.name);
  await tv.evaluate('window.__followerFadeTv.cleanup()');await tv.key('ArrowUp');await sleep(450);
  for(let i=0;i<3;i++) {await observe('keydown',true);await observe('keydown',false);}
  await observe('wheel',true);
  const shot=await tv.call('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${output}/expanded.png`,Buffer.from(shot.data,'base64'));
  await observe('wheel',false);
  assert.equal(tv.errors.length,0,'no uncaught exceptions');
  assert.ok(results.every(r=>r.pass),'all transitions show at least three actual intermediate positions');
} catch(error) {
  writeFileSync(`${output}/failure.json`,JSON.stringify({message:error.message,exceptions:tv.errors},null,2));
  console.error(error.message);process.exitCode=1;
} finally {
  try {await tv.evaluate('window.__shelfProbe?.cleanup();window.__followerFadeTv?.cleanup()');await tv.back();} finally {tv.close();}
}
