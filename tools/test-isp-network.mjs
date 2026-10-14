// Public Globalping probes: only fixed, anonymous public endpoints are sent.
// No app cookies, signed media URLs or TV/account data reach this provider.
// Network/ASN selection is strict; missing probes never fall back to a cloud region.
import { mkdir, writeFile } from 'node:fs/promises';
const output=process.env.ISP_OUTPUT||'/tmp/bili-isp-network';
const country=process.env.ISP_COUNTRY||'PH';
const asns=(process.env.ISP_ASNS||'17639,9299').split(',').map(Number);
if(!/^[A-Z]{2}$/.test(country)||!asns.length||asns.some(n=>!Number.isInteger(n)||n<1))throw new Error('Invalid country/ASNs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(path,body)=>{
 const response=await fetch('https://api.globalping.io/v1/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Globalping HTTP '+response.status);
 return response.json();
};
const http = (target, path, resolver) => ({type:'http',target,measurementOptions:{protocol:'HTTPS',...(resolver?{resolver}:{}),request:{path,method:'GET',headers:{Referer:'https://www.bilibili.com/'}}}});
const jobs=process.env.ISP_HTTP_COMPARE==='1' ? Array.from({length:3},()=>[http('www.cloudflare.com','/cdn-cgi/trace'),http('api.bilibili.com','/x/web-interface/nav'),http('api.bilibili.com','/x/web-interface/nav','1.1.1.1')]).flat() : [
 {type:'http',target:'api.bilibili.com',measurementOptions:{protocol:'HTTPS',request:{path:'/x/web-interface/nav',method:'GET',headers:{Referer:'https://www.bilibili.com/'}}}},
 ...['api.bilibili.com','upos-hz-mirrorakam.akamaized.net','upos-sz-mirrorcosov.bilivideo.com','upos-sz-estgoss.bilivideo.com','upos-sz-mirrorhwo1.bilivideo.com'].map(target=>({type:'dns',target,measurementOptions:{query:{type:'A'}}})),
];
const report={at:new Date().toISOString(),provider:'Globalping',country,asns,scope:'Anonymous API HTTPS and system-resolver DNS, not signed media delivery or throughput',measurements:[]};
await mkdir(output,{recursive:true});
for(const job of jobs){
 const row={type:job.type,target:job.target,resolver:job.measurementOptions.resolver||'system'};
 try {
  const created=await api('measurements',{...job,locations:process.env.ISP_PROBES_FROM||asns.map(asn=>({country,asn,tags:['eyeball-network'],limit:2}))});
  row.id=created.id;row.url='https://api.globalping.io/v1/measurements/'+created.id;
  let result,deadline=Date.now()+60000;
  do{await pause(1500);result=await api('measurements/'+created.id)}while(result.status==='in-progress'&&Date.now()<deadline);
  row.status=result.status;
  row.results=(result.results||[]).map(({probe,result:r})=>{
   let code;try{code=JSON.parse(r.rawBody).code}catch{}
   const transportError=String(r.rawOutput||'').match(/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/);
   return {country:probe.country,city:probe.city,asn:probe.asn,network:probe.network,
    expectedNetwork:probe.country===country&&asns.includes(probe.asn)&&probe.tags.includes('eyeball-network'),
    status:r.status,statusCode:r.statusCode,apiCode:code,timings:r.timings,
    dnsStatus:r.statusCodeName,answers:r.answers?.map(a=>({type:a.type,value:a.value})),transportError:transportError?.[0],failureSource:r.failureSource};
  });
  row.missingAsns=asns.filter(asn=>!row.results.some(r=>r.expectedNetwork&&r.asn===asn));
  console.log(job.type,job.target,JSON.stringify(row.results));
 }catch(e){row.error=e.message;console.log('ERROR',job.type,job.target,row.error)}
 report.measurements.push(row);await writeFile(output+'/results.json',JSON.stringify(report,null,2)+'\n');
}
if(report.measurements.some(m=>m.error||m.status==='in-progress'||m.missingAsns?.length||m.results?.some(r=>!r.expectedNetwork)))process.exitCode=1;
