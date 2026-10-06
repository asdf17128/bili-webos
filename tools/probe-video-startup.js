// Production TV measurement: no signed media URLs or account values leave the TV.
// node tools/_cdp.mjs tools/probe-video-startup.js
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const runs = [];
  const cases = window.__vodStartupCases || Array.from({length:3}, () => ({bvid:'BV1xx411c7Xg',resumeMode:'auto'}));
  for (const sample of cases) {
    const run = {sample, events:[], api:[]}, start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    const original = window.webOS.service.request;
    window.webOS.service.request = function(uri, opts) {
      if (opts.method !== 'fetch') return original.apply(this, arguments);
      const path = new URL(opts.parameters.url).pathname;
      const row = {path,start:elapsed()}; run.api.push(row);
      const done = fn => function(res) { row.end=elapsed();row.ms=row.end-row.start;return fn?.(res); };
      return original.call(this,uri,{...opts,onSuccess:done(opts.onSuccess),onFailure:done(opts.onFailure)});
    };
    const types=['loadstart','loadedmetadata','loadeddata','playing','waiting','error'];
    let initialTime;
    const listener = e => {
      if(e.target.tagName !== 'VIDEO')return;
      const v=e.target;
      if(e.type==='loadedmetadata')initialTime=v.currentTime;
      run.events.push({type:e.type,ms:elapsed(),ready:v.readyState,time:v.currentTime,error:v.error?.code});
    };
    for(const t of types)document.addEventListener(t,listener,true);
    try {
      window.__openVideo(sample);
      for(let i=0;i<160;i++) {
        await sleep(250);
        const v=document.querySelector('video');
        if(!run.progress && initialTime!=null && v?.readyState>=2 && v.currentTime>initialTime+.25)run.progress=elapsed();
        if(run.progress && elapsed()>run.progress+1800)break;
      }
      const v=document.querySelector('video');
      run.end={time:v?.currentTime,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight,quality:window.__shakaPlayer?.getVariantTracks()?.find(x=>x.active)?.height};
    } finally {
      window.webOS.service.request=original;
      for(const t of types)document.removeEventListener(t,listener,true);
      for(let i=0;i<4 && document.querySelector('video');i++) {
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));
        window.dispatchEvent(new KeyboardEvent('keyup',{key:'Backspace',bubbles:true}));
        await sleep(300);
      }
    }
    runs.push(run);await sleep(1200);
  }
  return {ua:navigator.userAgent,runs};
})()
