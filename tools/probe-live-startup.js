// Evaluate on TV with: node tools/_cdp.mjs tools/probe-live-startup.js
// Optional window.__startupCases: [{roomid,format:'default'|'ts'|'fmp4'}].
// Format overrides keep only that format from the real API response for A/B;
// use default to measure installed production selection. No signed URLs leave TV.
// Native webOS video does not reliably invoke requestVideoFrameCallback, so
// first-progress + video dimensions are reported separately from playing events.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const api = url => new Promise(resolve => window.webOS.service.request('luna://com.biliwebos.app.service/', {method:'fetch',parameters:{url},onSuccess(res){try{resolve(JSON.parse(res.body));}catch{resolve({});}},onFailure(){resolve({});}}));
  const rec = await api('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getMoreRecList?platform=web&page=1&page_size=12');
  const available = (rec.data?.recommend_room_list || rec.data?.list || []).slice().sort((a,b)=>(b.online||0)-(a.online||0));
  const rooms = window.__startupRooms || available.slice(0,2).map(r=>r.roomid||r.room_id);
  window.__startupRooms = rooms;
  const runs = [];
  for (const sample of (window.__startupCases || rooms.map(roomid => ({roomid, format:window.__startupFormat || 'default'})))) {
    const {roomid} = sample;
    const run = {roomid,format:sample.format,events:[],api:[]};
    const original = window.webOS.service.request;
    const t0 = performance.now();
    const mark = (type,extra={}) => run.events.push({type,ms:Math.round(performance.now()-t0),...extra});
    let candidates=[];
    window.webOS.service.request = function(uri,opts) {
      const p=opts?.parameters;
      if (p?.url?.includes('/getRoomPlayInfo')) {
        const start=performance.now(),success=opts.onSuccess;
        opts={...opts,onSuccess(res){
          try {
            const body=JSON.parse(res.body);
            const pu=body.data?.playurl_info?.playurl;
            const formats=[];
            for(const stream of pu?.stream || []) {
              for(const f of stream.format || [])for(const c of f.codec || []) {
                formats.push({format:f.format_name,codec:c.codec_name,qn:c.current_qn,hosts:(c.url_info||[]).map(x=>new URL(x.host).hostname)});
                for(const info of c.url_info||[])candidates.push({format:f.format_name,codec:c.codec_name,path:c.base_url,host:new URL(info.host).hostname});
              }
              if(run.format !== 'default')stream.format=stream.format?.filter(f=>f.format_name===run.format);
            }
            run.api.push({ms:Math.round(performance.now()-t0),duration:Math.round(performance.now()-start),code:body.code,formats});
            if(run.format !== 'default')res={...res,body:JSON.stringify(body)};
          }catch(e){mark('probe-error',{message:e.message});}
          success(res);
        }};
      }
      return original.call(this,uri,opts);
    };
    const types=['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','error'];
    let seenVideo, initialTime;
    const event=e=>{
      if(e.target.tagName!=='VIDEO')return;
      const v=e.target;
      if(e.type === 'loadedmetadata' && initialTime == null)initialTime=v.currentTime;
      mark(e.type,{ready:v.readyState,time:v.currentTime,error:v.error?.code});
      if(e.type==='loadstart' && v!==seenVideo){
        seenVideo=v;
        if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(()=>mark('first-frame'));
      }
    };
    for(const type of types)document.addEventListener(type,event,true);
    const observer=new MutationObserver(()=>{
      const v=document.querySelector('video');
      if(v?.src && !run.source){
        const u=new URL(v.src);
        const match=candidates.find(c=>u.pathname.endsWith(c.path.split('?')[0]));
        run.source={ms:Math.round(performance.now()-t0),format:match?.format,codec:match?.codec,host:match?.host};
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
    try {
      window.__openLive({roomid,title:'直播起播耗时测量'});
      for(let i=0;i<180;i++){
        await sleep(250);
        const v=document.querySelector('video');
        if(!run.progress && initialTime != null && v?.readyState >= 3 && v.currentTime > initialTime + 0.25) {run.progress=Math.round(performance.now()-t0);mark('first-progress');}
        if(run.progress && performance.now()-t0 > run.progress + (window.__startupObserveMs || 3000))break;
      }
      const v=document.querySelector('video');
      run.end={ms:Math.round(performance.now()-t0),time:v?.currentTime,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight};
    } finally {
      for(const type of types)document.removeEventListener(type,event,true);
      observer.disconnect();
      window.webOS.service.request=original;
      for(let i=0;i<4 && document.querySelector('video');i++){
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));
        window.dispatchEvent(new KeyboardEvent('keyup',{key:'Backspace',bubbles:true}));
        await sleep(350);
      }
    }
    runs.push(run);
    await sleep(1200);
  }
  return {liveQn:JSON.parse(localStorage.getItem('bili_settings')||'{}').liveQn,runs};
})()
