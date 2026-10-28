// Isolated anonymous experiment. Never reads app/TV cookies, writes identity,
// or changes production recovery. Requires --live for official API requests.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { signWbi } from '../app/src/api/wbi.js';
if (!process.argv.includes('--live')) throw new Error('Explicit --live required; anonymous isolated identity only');
const origin='https://api.bilibili.com';
const browser=await chromium.launch();
let profile;
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 profile=await page.evaluate(()=>({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,
   width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,
   depth:screen.colorDepth,offset:new Date().getTimezoneOffset(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
   cores:navigator.hardwareConcurrency}));
} finally {await browser.close()}
let cookie='';
async function api(path,body) {
 const r=await fetch(origin+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{
   'User-Agent':profile.ua,Referer:'https://www.bilibili.com/',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})
 },...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error('HTTP '+r.status);
 return r.json();
}
const spi=await api('/x/frontend/finger/spi');
if(spi.code!==0||!spi.data?.b_3||!spi.data?.b_4)throw new Error('No anonymous identity');
const uuid=randomUUID().toUpperCase()+String(Date.now()%100000).padStart(5,'0')+'infoc';
// _uuid is a random session identifier, not a claimed hardware fingerprint.
// Do not invent buvid_fp or b_nut or copy desktop/GPU/canvas constants.
cookie='buvid3='+spi.data.b_3+'; buvid4='+spi.data.b_4+'; _uuid='+uuid;
const nav=await api('/x/web-interface/nav');
const key=url=>new URL(url).pathname.split('/').pop().split('.')[0];
const keys=[key(nav.data.wbi_img.img_url),key(nav.data.wbi_img.sub_url)];
const view=await api('/x/web-interface/view?bvid=BV1ebxM61EkQ');
if(view.code!==0||!view.data?.cid)throw new Error('Video metadata unavailable');
async function probes(){
 const rows=[];
 for(let i=0;i<3;i++){
   const j=await api('/x/player/wbi/playurl?'+signWbi({bvid:'BV1ebxM61EkQ',cid:view.data.cid,qn:127,fnval:4048,fnver:0,fourk:1,platform:'pc'},...keys));
   const d=j.data||{};rows.push({code:j.code,voucher:!!d.v_voucher,stream:!!(d.dash?.video?.length||d.durl?.length)});
   if(i<2)await new Promise(r=>setTimeout(r,4000));
 }
 return rows;
}
const before=await probes();
const payload={df35:uuid,'39c8':'333.1007.fp.risk','5062':Date.now(),'3c43':{
 b8ce:profile.ua,adca:profile.platform,'07a4':profile.language,'5766':profile.depth,
 '748e':[profile.height,profile.width],d61f:[profile.availHeight,profile.availWidth],fc9d:profile.offset,'6aa9':profile.timezone,'0bd0':profile.cores
}};
const activation=await api('/x/internal/gaia-gateway/ExClimbWuzhi',{payload:JSON.stringify(payload)});
const after=activation.code===0?await probes():[];
console.log(JSON.stringify({scope:'isolated anonymous desktop Chromium; no TV/account',fields:{uuid:true,buvid_fp:false,b_nut:false},before,activation:{code:activation.code,accepted:activation.code===0},after},null,2));
