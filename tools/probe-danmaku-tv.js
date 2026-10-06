// Real video decoding with a deterministic dense danmaku response. No auth or
// signed media URLs are returned. Restores the response hook and preferences.
(async () => {
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const settings=localStorage.getItem('bili_settings'), original=webOS.service.request;
  const start=performance.now();let peak=0,frames=[],last=0,stop=false,received=false;
  const frame=now=>{if(last)frames.push(now-last);last=now;peak=Math.max(peak,document.querySelectorAll('.danmaku-item').length);if(!stop)requestAnimationFrame(frame);};
  const xml='<i>'+Array.from({length:6000},(_,i)=>'<d p="'+(i/500)+',1,28,16777215,0,0,0,0">真机弹幕压力测试 '+i+'</d>').join('')+'</i>';
  webOS.service.request=function(uri,opts){
    if(opts.parameters?.url?.includes('/list.so')) {
      const success=opts.onSuccess;
      opts={...opts,onSuccess(res){received=true;success({...res,body:xml});}};
    }
    return original.call(this,uri,opts);
  };
  try {
    localStorage.setItem('bili_settings',JSON.stringify({...JSON.parse(settings||'{}'),danmaku:true,danmakuScale:1}));
    window.__openVideo({bvid:'BV1GJ411x7h7',resumeMode:'none'});
    for(let i=0;i<100&&!document.querySelector('.danmaku-item');i++)await sleep(250);
    requestAnimationFrame(frame);
    await sleep(6500);
    const v=document.querySelector('video');v.pause();await sleep(250);
    const el=document.querySelector('.danmaku-item');
    const before=el&&getComputedStyle(el).transform,state=el&&getComputedStyle(el).animationPlayState;
    await sleep(700);
    const frozen=!!el&&el.isConnected&&before===getComputedStyle(el).transform;
    stop=true;
    frames.sort((a,b)=>a-b);
    window.__dmProbeReady=true;
    if(window.__dmCaptureDelay)await sleep(window.__dmCaptureDelay);
    return {received,peak,pausedState:state,frozen,time:v.currentTime,width:v.videoWidth,height:v.videoHeight,frames:frames.length,rafMedianMs:frames[Math.floor(frames.length*.5)],rafP95Ms:frames[Math.floor(frames.length*.95)],elapsed:Math.round(performance.now()-start)};
  } finally {
    stop=true;delete window.__dmProbeReady;webOS.service.request=original;
    for(let i=0;i<4&&document.querySelector('video');i++) {
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'Backspace',bubbles:true}));await sleep(300);
    }
    if(settings===null)localStorage.removeItem('bili_settings');else localStorage.setItem('bili_settings',settings);
  }
})()
