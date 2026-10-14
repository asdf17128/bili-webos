// Verify actual LS2 cancellation delivery, independently of danmakuStop.
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTv} from './_tv-stability.mjs';
const output=process.env.UX_OUTPUT||'/tmp/bili-native-subscriptions';
mkdirSync(output,{recursive:true});let tv;
const report={started:new Date().toISOString(),scope:'Real SDK cast subscription, LS2 cancellation, production service counters; no cast commands',checks:[]};
try{
 tv=await connectTv();
 const result=await tv.evaluate(`(async()=>{
  const call=method=>new Promise((resolve,reject)=>{let h;const timer=setTimeout(()=>{h?.cancel?.();reject(new Error('Service timeout'))},5000);h=webOS.service.request('luna://com.biliwebos.app.service/',{method,onSuccess:r=>{clearTimeout(timer);resolve({cast:r.castSubscribers,danmaku:r.danmakuSubscribers,active:r.danmakuActive})},onFailure:()=>{clearTimeout(timer);reject(new Error('Service failed'))}})});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const before=await call('getDiagnostics'),rows=[];let owned,ackTimer;
  try{
   for(let i=0;i<20;i++){
    let done;const ack=new Promise((r,j)=>{done=r;ackTimer=setTimeout(()=>j(new Error('Subscription acknowledgement timeout')),5000)});
    owned=webOS.service.request('luna://com.biliwebos.app.service/',{method:'castSubscribe',subscribe:true,parameters:{subscribe:true},onSuccess:r=>{if(r.subscribed)done(true)}});
    await ack;clearTimeout(ackTimer);const during=await call('getDiagnostics');owned.cancel();owned=null;
    let after;for(let j=0;j<20;j++){after=await call('getDiagnostics');if(after.cast===before.cast)break;await sleep(100)}
    rows.push({cycle:i+1,during:during.cast,after:after.cast,pass:during.cast===before.cast+1&&after.cast===before.cast&&after.danmaku===before.danmaku&&after.active===before.active});
   }
  }finally{clearTimeout(ackTimer);owned?.cancel?.()}
  return {before,rows,after:await call('getDiagnostics')};
 })()`,120000);
 report.result=result;report.checks.push({name:'20 actual native subscriptions cancel back to the service baseline',pass:result.rows.length===20&&result.rows.every(r=>r.pass)});
}catch(error){report.checks.push({name:'completion',pass:false,detail:error.message})}
finally{tv?.close();report.finished=new Date().toISOString();writeFileSync(output+'/results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
if(report.checks.some(c=>!c.pass))process.exitCode=1;
