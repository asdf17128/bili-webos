// Anonymous real-network checks through an existing SSH host. The remote
// Python process handles HTTP only; CDN candidates/ranking/cache use production JS.
// REGION_SSH=hk REGION_OUTPUT=/tmp/bili-hk node tools/test-region-network.mjs
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { signWbi } from '../app/src/api/wbi.js';
import { createAutoCdnRouter, createCdnHealthStore, getAutoCdnStatus } from '../app/src/player/cdnAuto.js';
import { playbackCdnUrls, cdnHostOf } from '../app/src/player/cdn.js';
import biliReferer from '../service/com.biliwebos.app.service/biliReferer.js';

const host = process.env.REGION_SSH;
if (!host || !/^[a-zA-Z0-9_.-]+$/.test(host)) throw new Error('Set REGION_SSH to an existing SSH host alias');
const output = process.env.REGION_OUTPUT || `/tmp/bili-region-${host}`;
await mkdir(output, { recursive: true });
const worker = await readFile(new URL('./probe-region.py', import.meta.url), 'utf8');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const ssh = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'python3 -u -c ' + quote(worker)], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: ssh.stdout });
let pending;
lines.on('line', line => { const p = pending; pending = null; if (!p) return; clearTimeout(p.timer); try { const r=JSON.parse(line); r.error ? p.reject(new Error(r.error + (r.status ? ':' + r.status : ''))) : p.resolve(r.value); } catch(e) { p.reject(e); } });
ssh.on('error', () => pending?.reject(new Error('SSH connection error')));
ssh.on('exit', () => pending?.reject(new Error('SSH worker exited')));
// SSH diagnostics stay local to this invocation, never saved with report data.
ssh.stderr.on('data', data => process.stderr.write(data));
const call = job => new Promise((resolve, reject) => {
  if (pending) return reject(new Error('Only one remote request at a time'));
  pending = { resolve, reject, timer: setTimeout(() => { ssh.kill(); reject(new Error('SSH request deadline')); }, 20000) };
  ssh.stdin.write(JSON.stringify(job) + '\n');
});
const report = { at: new Date().toISOString(), credentials: 'anonymous, newly acquired fingerprint only', checks: [], samples: [] };
const check = (name, pass, detail) => { report.checks.push({name,pass,detail}); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail || '')); };
let router;
try {
  report.location = await call({ op:'location', url:'https://www.cloudflare.com/cdn-cgi/trace' });
  await call({op:'api',url:'https://api.bilibili.com/x/frontend/finger/spi'});
  for (const rid of [1008,1005,1003,1010,1002,1007]) {
    const path='/x/web-interface/ranking/v2';
    const response=await call({op:'api',url:`https://api.bilibili.com${path}?rid=${rid}&type=all`,referer:biliReferer('api.bilibili.com',path)});
    check('partition '+rid, response.code===0 && response.data?.list?.length>0, {code:response.code,count:response.data?.list?.length||0});
  }
  const nav=await call({op:'api',url:'https://api.bilibili.com/x/web-interface/nav'});
  report.nav = {code:nav.code,status:nav.status,hasWbiKeys:!!nav.data?.wbi_img?.img_url};
  const key = field => (nav.data?.wbi_img?.[field] || '').split('/').pop().split('.')[0];
  const api=async(path,params)=>call({op:'api',url:'https://api.bilibili.com'+path+'?'+signWbi(params,key('img_url'),key('sub_url'))});
  // signWbi takes the two key strings, matching the production client.
  const bvid='BV1xx411c7Xg';
  let view=await api('/x/web-interface/view',{bvid});
  let cid=view.data?.cid;
  if(!cid) {const pages=await call({op:'api',url:'https://api.bilibili.com/x/player/pagelist?bvid='+bvid});cid=pages.data?.[0]?.cid;}
  check('video metadata or pagelist fallback',!!cid,{viewCode:view.code,viewStatus:view.status});
  if(!cid) throw new Error('No playable cid');
  const play=await api('/x/player/playurl',{bvid,cid,qn:64,fnval:4048,fnver:0,fourk:1});
  const rep=play.data?.dash?.video?.filter(v=>v.codecs?.startsWith('avc1')).sort((a,b)=>Math.abs(a.id-64)-Math.abs(b.id-64))[0];
  check('DASH video source',play.code===0 && !!rep,{code:play.code,quality:rep?.id});
  if(!rep) throw new Error('No DASH representation');
  let cache='';
  const health=createCdnHealthStore({getItem:()=>null,setItem:(key,value)=>{cache=value;}});
  router=createAutoCdnRouter({getRoute:()=> 'auto',canProbe:()=>true,proxyBase:()=>'',health,intervalMs:0,
    probe:async(url,start,end,opts)=>{
      const source='https://'+url.slice('/proxy/'.length);
      try {const value=await call({op:'range',url:source,start,end,timeoutMs:opts.timeoutMs});report.samples.push({host:cdnHostOf(source),start,end,...value});return value;}
      catch(e){report.samples.push({host:cdnHostOf(source),start,end,error:e.message});throw e;}
    }});
  router.setSource(rep);
  for(let i=0;i<getAutoCdnStatus().candidates.length;i++) await router.tick();
  report.selection=getAutoCdnStatus();
  const ordered=router.order(playbackCdnUrls(rep,'auto')),chosen=ordered[0];
  check('automatic route has successful measurements',report.selection.candidates.some(c=>c.host===cdnHostOf(chosen)&&c.ok),{host:cdnHostOf(chosen)});
  const media=await call({op:'range',url:chosen,start:524288,end:589823,timeoutMs:8000});
  check('selected route transfers a new media range',media.bytes===65536,{host:cdnHostOf(chosen),bytes:media.bytes,ms:media.ms});
  check('cache contains no signed media URLs',!!cache&&!/upsig|hdnts|https|upgcxcode|SESSDATA/.test(cache));
}catch(e){check('completion',false,e.message);}
finally{
  router?.dispose();if(pending)clearTimeout(pending.timer);ssh.stdin.end();
  await writeFile(`${output}/results.json`,JSON.stringify(report,null,2)+'\n');
}
if(report.checks.some(c=>!c.pass))process.exitCode=1;
