// Run through tools/_cdp.mjs. Only redacted media metadata leaves the TV.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  for(let i=0;i<80 && (typeof window.__openVideo!=='function'||document.visibilityState!=='visible');i++)await sleep(250);
  if(typeof window.__openVideo!=='function')throw new Error('TV app did not become ready');
  const settings = localStorage.getItem('bili_settings');
  const cases = window.__premiumCases || [
    {name:'profile5-cinema',bvid:'BV1kX4y197P4',cid:1127214165,qn:126},
    {name:'profile84-control',bvid:'BV1kX4y197P4',cid:1026939788,qn:126},
    {name:'cinema-4k120',bvid:'BV1fK4y1t7hj',cid:196018899,qn:120},
    {name:'sdr-4k120',bvid:'BV1rp4y1e745',cid:244954665,qn:120},
    {name:'hdr120-control',bvid:'BV1rp4y1e745',cid:244954665,qn:125},
    {name:'pr17-cinema-dolby',bvid:'BV1Bg4vz2ENd',cid:33076743968,qn:126},
    {name:'pr17-dolby120',bvid:'BV1dCNC6hEzE',cid:39933052694,qn:126},
    {name:'issue34-4k50',bvid:'BV1sapi6qE72',cid:42610460057,qn:120},
    {name:'issue11-dolby60',bvid:'BV14BjU6bEo1',cid:39346570554,qn:126},
    {name:'issue11-8k-fallback',bvid:'BV1yuJ56wEQ3',cid:39069354913,qn:127,expectedQn:125},
    {name:'vip-only-bangumi',isBangumi:true,epid:433953,bvid:'BV1vS4y1X7xj',cid:456488230,qn:125},
  ];
  const results=[];window.__premiumProbe={done:0,results};
  async function back() {
    for(let i=0;i<5&&document.querySelector('video');i++){
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));await sleep(300);
    }
  }
  try {
    for(const sample of cases){
      await back();
      localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(settings||'{}'),quality:sample.qn,playbackMode:'stop'}));
      const row={sample,events:[],errors:[],api:[]},start=performance.now();
      let player,first,progress;
      const original=window.webOS.service.request;
      window.webOS.service.request=function(uri,opts){
        if(opts.method!=='fetch'||!opts.parameters.url.includes('/playurl'))return original.apply(this,arguments);
        return original.call(this,uri,{...opts,onSuccess:r=>{try{const j=JSON.parse(r.body),d=j.data||j.result;row.api.push({code:j.code,quality:d?.quality,qualities:d?.accept_quality})}catch{}opts.onSuccess?.(r)}});
      };
      const event=e=>{if(e.target.tagName==='VIDEO')row.events.push({type:e.type,ms:Math.round(performance.now()-start),time:e.target.currentTime,error:e.target.error?.code})};
      const types=['loadedmetadata','loadeddata','playing','waiting','error'];for(const t of types)document.addEventListener(t,event,true);
      const error=e=>row.errors.push({code:e.detail?.code,category:e.detail?.category});
      try{
        window.__openVideo({...sample,resumeMode:'none'});
        for(let i=0;i<180;i++){
          await sleep(250);
          const p=window.__shakaPlayer,v=document.querySelector('video');
          if(p&&p!==player){player?.removeEventListener('error',error);player=p;player.addEventListener('error',error)}
          if(v?.readyState>=2&&v.videoWidth>0){if(first==null)first=v.currentTime;if(v.currentTime>first+.8)progress=true}
          if(progress&&v.currentTime>first+4)break;
          if(document.querySelector('.player-error')&&!v?.videoWidth)break;
        }
        const v=document.querySelector('video'),track=player?.getVariantTracks()?.find(t=>t.active),stats=player?.getStats();
        row.end={progress:!!progress,width:v?.videoWidth,height:v?.videoHeight,time:v?.currentTime,ready:v?.readyState,error:v?.error?.code,
          codec:track?.videoCodec,audioCodec:track?.audioCodec,frameRate:track?.frameRate,bandwidth:track?.bandwidth,
          droppedFrames:stats?.droppedFrames,decodedFrames:stats?.decodedFrames,corruptedFrames:stats?.corruptedFrames,
          runtime:window.__dolbyRuntime?.(),representation:new DOMParser().parseFromString(window.__lastMpd||'', 'application/xml').querySelector('AdaptationSet[contentType="video"] Representation')?.getAttribute('id')};
      }finally{window.webOS.service.request=original;for(const t of types)document.removeEventListener(t,event,true);player?.removeEventListener('error',error);await back()}
      row.pass=!!row.end?.progress && Number(row.end?.representation)===(sample.expectedQn ?? sample.qn);
      results.push(row);window.__premiumProbe.done=results.length;await sleep(400);
    }
  }finally{if(settings==null)localStorage.removeItem('bili_settings');else localStorage.setItem('bili_settings',settings);await back()}
  return {ua:navigator.userAgent,results};
})()
