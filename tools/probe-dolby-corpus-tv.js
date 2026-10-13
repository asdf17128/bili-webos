// Run the bundled probe in the TV page. Keep signed URLs and media in memory;
// return only byte counts and transform postconditions (no captured film).
import { createTargetDolby120Session, transformTargetDolbyIndex, transformTargetDolbyInit, transformTargetDolbyMedia } from '../app/src/player/dolby120Transform.js';
import { TARGET_DOLBY_120_SOURCE as source } from '../app/src/player/dolbyTimingPatch.js';
import { probeRange } from '../app/src/player/cdnProbe.js';
export async function probe() {
  const dash=window.__premiumSources?.[source.bvid+':'+source.cid]?.dash;
  const rep=dash?.video.find(v=>v.id===source.quality);
  const session=createTargetDolby120Session(source,source.cid,rep);
  if(!session)return {pass:false,reason:'Source metadata no longer matches'};
  const port=await new Promise(resolve=>webOS.service.request('luna://com.biliwebos.app.service/',{method:'ping',onSuccess:r=>resolve(r.localProxyPort)}));
  const urls=[rep.baseUrl,...(rep.backupUrl||[])].filter(u=>!/:\d{4,5}\//.test(u));
  const rows=[];let host;
  const read=async range=>{
    let error;
    for(const candidate of urls){
      const url=new URL(candidate),[start,end]=range.split('-').map(Number);
      try{const result=await probeRange(`http://127.0.0.1:${port}/proxy/${url.host}${url.pathname}${url.search}`,start,end,{timeoutMs:20000});host=url.host;return result.data}catch(e){error=e}
    }
    throw error;
  };
  const index=transformTargetDolbyIndex(await read(session.indexRange));
  const init=transformTargetDolbyInit(await read(session.initRange));
  if(!index.supported||!init.supported)return {pass:false,index:index.reason,init:init.reason};
  for(const entry of session.segmentEntries){
    const input=await read(entry.startByte+'-'+entry.endByte), start=performance.now();
    const result=transformTargetDolbyMedia(input,session,true,entry);
    rows.push({index:entry.index,pass:result.supported&&result.status==='reduced',reason:result.reason,
      input:input.byteLength,output:result.data.byteLength,samples:result.outputSampleCount,duration:result.duration,ms:Math.round(performance.now()-start)});
    if(!rows[rows.length-1].pass)break;
  }
  return {pass:rows.length===35&&rows.every(r=>r.pass),host,index:index.status,init:init.status,rows};
}
