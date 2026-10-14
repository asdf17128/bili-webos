// Actual TV remote selection and time progression through DASH -> native -> DASH.
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTv,sleep} from './_tv-stability.mjs';
const output=process.env.UX_OUTPUT||'/tmp/bili-speed-stability';
mkdirSync(output,{recursive:true});
const result={started:new Date().toISOString(),checks:[]};
const check=(name,pass,detail)=>{result.checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail||''));if(!pass)throw new Error(name)};
let tv,original;
try{
  tv=await connectTv();await tv.back();
  original=await tv.evaluate("localStorage.getItem('bili_settings')");
  await tv.evaluate("localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(localStorage.getItem('bili_settings')||'{}'),quality:80,qualityMode:'manual',playbackMode:'stop'}));window.__openVideo({bvid:'BV1xx411c7Xg',resumeMode:'none'})");
  const state=()=>tv.evaluate("(()=>{const v=document.querySelector('video');return {time:v?.currentTime,width:v?.videoWidth,height:v?.videoHeight,ready:v?.readyState,paused:v?.paused,error:v?.error?.code||null,loading:!!document.querySelector('.player-page .loading'),seeking:v?.seeking,source:v?.currentSrc.startsWith('blob:')?'DASH':v?.currentSrc.startsWith('http')?'native':'unknown'}})()");
  await tv.wait("document.querySelector('video')?.currentTime>2 && document.querySelector('video')?.readyState>=2",45000);
  const choose=async label=>{
    if(!await tv.evaluate("!!document.querySelector('.player-btn.focused')"))await tv.key('ArrowUp');
    for(let i=0;i<18&&!await tv.evaluate("/^(倍速|2x)$/.test(document.querySelector('.player-btn.focused')?.innerText||'')");i++)await tv.key('ArrowRight');
    check('speed control reachable',await tv.evaluate("/^(倍速|2x)$/.test(document.querySelector('.player-btn.focused')?.innerText||'')"));
    await tv.key('Enter');
    await tv.wait("document.querySelectorAll('.quality-option').length>0");
    const rows=await tv.evaluate("[...document.querySelectorAll('.quality-option')].map(e=>({text:e.innerText,focused:e.classList.contains('focused')}))");
    let at=rows.findIndex(x=>x.focused);const to=rows.findIndex(x=>x.text===label);
    check('speed option exists '+label,at>=0&&to>=0);
    while(at!==to){await tv.key(at<to?'ArrowDown':'ArrowUp');at+=at<to?1:-1}
    await tv.key('Enter');
  };
  check('initial DASH actually decodes',(await state()).source==='DASH',await state());
  await choose('2x');
  await tv.wait("document.querySelector('video')?.currentSrc.startsWith('http') && document.querySelector('video')?.readyState>=2 && document.querySelector('video')?.currentTime>5",40000);
  await sleep(2000);let before=await state(),start=Date.now();await sleep(4000);let after=await state();
  const rate=(after.time-before.time)/((Date.now()-start)/1000);
  check('native 2x actually advances near double speed',rate>1.6&&rate<2.4&&!after.error&&after.width>0,{rate,state:after});
  const restorePosition=after.time;
  await choose('正常');
  await tv.wait("document.querySelector('video')?.currentSrc.startsWith('blob:') && document.querySelector('video')?.readyState>=2 && !document.querySelector('.player-page .loading')",40000);
  after=await state();check('1x restores DASH near the same position',after.time>=restorePosition-1&&after.time<restorePosition+10&&!after.error,after);
  await sleep(1000);before=await state();start=Date.now();await sleep(4000);after=await state();
  const normalRate=(after.time-before.time)/((Date.now()-start)/1000);
  check('restored DASH advances at normal speed',normalRate>.8&&normalRate<1.2&&!after.error,{rate:normalRate,state:after});
  // The changed transition also promises to retain an explicitly paused video.
  await tv.evaluate("document.querySelector('video').pause()");
  const paused=await state();
  await tv.evaluate(`(()=>{
    const v=document.querySelector('video'),p=window.__shakaPlayer;
    const read=event=>({event,at:performance.now(),time:v.currentTime,ready:v.readyState,paused:v.paused,seeking:v.seeking,loading:!!document.querySelector('.player-page .loading'),source:v.currentSrc.startsWith('blob:')?'DASH':v.currentSrc.startsWith('http')?'native':'unknown'});
    const rows=[];const names=['emptied','loadedmetadata','canplay','seeking','seeked','playing','pause'];
    const record=e=>rows.push(read(e.type));names.forEach(n=>v.addEventListener(n,record));
    const load=p.load;p.load=function(...args){rows.push({...read('load-called'),startTime:args[1]});return load.apply(this,args).then(x=>{rows.push(read('load-resolved'));return x},e=>{rows.push({...read('load-rejected'),code:e.code});throw e})};
    const timer=setInterval(()=>rows.push(read('sample')),100);
    window.__speedTimeline={rows,cleanup(){clearInterval(timer);names.forEach(n=>v.removeEventListener(n,record));p.load=load;delete window.__speedTimeline}};
  })()`);
  await choose('2x');
  await tv.wait(`document.querySelector('video')?.currentSrc.startsWith('http') && document.querySelector('video')?.readyState>=2 && document.querySelector('video')?.currentTime>=${paused.time-1}`,40000);
  await sleep(1000);after=await state();
  check('paused native switch retains position and pause',after.paused&&Math.abs(after.time-paused.time)<1&&!after.error,after);
  await choose('正常');
  await tv.wait("document.querySelector('video')?.currentSrc.startsWith('blob:') && document.querySelector('video')?.readyState>=2",40000);
  let settled=false;
  try{await tv.wait(`!document.querySelector('.player-page .loading') && !document.querySelector('video')?.seeking && Math.abs(document.querySelector('video')?.currentTime-${paused.time})<1`,15000);settled=true}catch{}
  after=await state();
  result.pausedRestoreSettled=settled;
  check('paused 1x restores DASH with position and pause',settled&&!after.loading&&!after.seeking&&after.paused&&Math.abs(after.time-paused.time)<1&&!after.error,after);
  await tv.evaluate("document.querySelector('video').play()");
  await tv.wait(`document.querySelector('video')?.currentTime>${after.time+1}`,15000);
  check('paused round trip can resume actual decoding',(await state()).width>0);
  await tv.back();await sleep(1500);
  check('normal Back releases player',await tv.evaluate("!document.querySelector('video') && !window.__shakaPlayer"));
}catch(error){result.checks.push({name:'completion',pass:false,detail:error.message});process.exitCode=1}
finally{
  if(tv){
    try{result.timeline=await tv.evaluate('window.__speedTimeline?.rows||[]');await tv.evaluate('window.__speedTimeline?.cleanup()')}catch(error){result.checks.push({name:'timeline cleanup',pass:false,detail:error.message});process.exitCode=1}
    try{await tv.back()}catch(error){result.checks.push({name:'Back cleanup',pass:false,detail:error.message});process.exitCode=1}
    try{if(original!==undefined){await tv.evaluate(original===null?"localStorage.removeItem('bili_settings')":`localStorage.setItem('bili_settings',${JSON.stringify(original)})`);check('original preferences restored',await tv.evaluate("localStorage.getItem('bili_settings')")===original)}}catch(error){result.checks.push({name:'settings cleanup',pass:false,detail:error.message});process.exitCode=1}
    tv.close();
  }
  result.finished=new Date().toISOString();writeFileSync(output+'/results.json',JSON.stringify(result,null,2)+'\n');
}
