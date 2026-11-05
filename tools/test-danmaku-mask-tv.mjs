// Run only when the TV is available for testing. No publishing; settings restored.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTv, sleep } from './_tv-stability.mjs';
const out=process.env.MASK_TV_OUTPUT||'/tmp/bili-mask-tv';mkdirSync(out,{recursive:true});
const run={startedAt:new Date().toISOString(),samples:[],checks:[],pass:false};let tv,original;
const save=()=>writeFileSync(out+'/results.json',JSON.stringify(run,null,2));
const snapshot=`(()=>{const v=document.querySelector('video'),s=window.__shakaPlayer?.getStats();return {time:v?.currentTime,paused:v?.paused,seeking:v?.seeking,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight,error:v?.error?.code||null,mask:window.__danmakuMaskStats?.(),nodes:document.querySelectorAll('.player-page-vod > .danmaku-container .danmaku-item').length,decoded:s?.decodedFrames,dropped:s?.droppedFrames};})()`;
async function open(bvid){await tv.back();await tv.evaluate(`window.__openVideo({bvid:${JSON.stringify(bvid)},resumeMode:'none'})`);await tv.wait("document.querySelector('video')?.currentTime>1&&document.querySelector('video')?.readyState>=2",60000);}
async function toggle(){
 await tv.key('ArrowUp');
 await tv.evaluate(`(()=>{const b=[...document.querySelectorAll('.player-btn')].find(x=>x.textContent.includes('弹幕设置'));if(!b)throw Error('settings unavailable');b.click()})()`);
 await tv.wait("!!document.querySelector('.dm-settings')");
 await tv.evaluate(`(()=>{const b=[...document.querySelectorAll('.dm-setting-row')].find(x=>x.textContent.includes('智能防挡人物'));if(!b)throw Error('mask setting unavailable');b.click()})()`);
 await tv.key('GoBack');await tv.wait("!document.querySelector('.dm-settings')");
}
try{
 tv=await connectTv();original=await tv.evaluate('localStorage.getItem("bili_settings")');await tv.back();run.baseline=await tv.metrics({collect:true});
 await tv.evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('bili_settings')||'{}');Object.assign(s,{language:'zh',danmaku:true,danmakuMask:true,danmakuDensity:24,quality:120,playbackMode:'repeat'});localStorage.setItem('bili_settings',JSON.stringify(s))})()`);
 await open('BV1GJ411x7h7');await tv.wait("window.__danmakuMaskStats?.().state==='active'",30000);
 let lastTime=null,stuck=0;
 for(let n=0;n<60;n++){
  const s=await tv.evaluate(snapshot);run.samples.push({...s,metrics:await tv.metrics()});save();assert.ok(!s.error&&!s.paused&&s.ready>=2);assert.ok(s.mask&&s.mask.failures===0&&s.mask.cached<=2);assert.ok(s.nodes<=24);assert.equal(tv.errors.length,0);stuck=lastTime!==null&&Math.abs(s.time-lastTime)<.1?stuck+1:0;lastTime=s.time;assert.ok(stuck<3,'playback made no progress for 15 seconds');
  if(n%6===0)console.log('MASK seconds',n*5,JSON.stringify(s));await sleep(5000);
 }
 await tv.evaluate("document.querySelector('video').pause()");await sleep(500);const applied=await tv.evaluate('window.__danmakuMaskStats().applied');await sleep(2500);assert.equal(await tv.evaluate('window.__danmakuMaskStats().applied'),applied);await tv.evaluate("document.querySelector('video').play()");run.checks.push('pause freezes mask');
 for(const target of [25,80,2]){await tv.evaluate(`document.querySelector('video').currentTime=${target}`);await tv.wait(`document.querySelector('video').currentTime>${target+.1}&&!document.querySelector('video').seeking&&window.__danmakuMaskStats?.().state==='active'`,30000);run.checks.push('seek '+target);}
 await toggle();await tv.wait('!window.__danmakuMaskStats');assert.equal(await tv.evaluate("document.querySelector('.player-page-vod > .danmaku-container').style.webkitMaskImage"),'none');run.checks.push('live off clears mask');
 await toggle();await tv.wait("window.__danmakuMaskStats?.().state==='active'",30000);run.checks.push('live on resumes mask');
 const shot=await tv.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/mask-tv.png',Buffer.from(shot.data,'base64'));
 await open('BV1kX4y197P4');await tv.wait("document.querySelector('video').videoWidth>=3000",30000);await sleep(5000);assert.ok(!await tv.evaluate('!!window.__danmakuMaskStats'));run.checks.push('4K without metadata uses ordinary danmaku');
 for(let n=0;n<12;n++){const s=await tv.evaluate(snapshot);assert.ok(!s.error&&!s.paused&&s.ready>=2);run.samples.push(s);await sleep(5000);}
 run.pass=true;
}catch(e){run.error=e.message;console.error('FAIL',e.message);}
finally{
 if(tv){try{await tv.back();run.finalIdle=await tv.metrics({collect:true});if(run.baseline&&(run.finalIdle.heapBytes-run.baseline.heapBytes>8*1048576||run.finalIdle.listeners-run.baseline.listeners>20)){run.pass=false;run.resourceError='idle retention exceeds budget';}if(original!==undefined)await tv.evaluate(original===null?'localStorage.removeItem("bili_settings")':`localStorage.setItem('bili_settings',${JSON.stringify(original)})`);run.settingsRestored=await tv.evaluate('localStorage.getItem("bili_settings")')===original;if(!run.settingsRestored)run.pass=false;}catch(e){run.pass=false;run.cleanupError=e.message;}run.pageErrors=tv.errors;tv.close();}
 run.finishedAt=new Date().toISOString();save();console.log('RESULT',JSON.stringify({pass:run.pass,error:run.error,settingsRestored:run.settingsRestored}));if(!run.pass)process.exitCode=1;
}
