import {Client} from 'ssh2';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tvPassphrase} from './_tvpass.mjs';
import {connectTv} from './_tv-stability.mjs';
// Pass a manifest containing expected app/dist/assets and service file hashes.
const path=process.argv[2];
if(!path)throw new Error('Usage: node tools/verify-stability-package-tv.mjs <environment.json>');
const report=JSON.parse(readFileSync(path));const c=new Client();
await new Promise((r,j)=>{c.once('ready',r).once('error',j).connect({host:'192.168.50.94',port:9922,username:'prisoner',privateKey:readFileSync(process.env.HOME+'/.ssh/tv_webos'),passphrase:tvPassphrase(),algorithms:{serverHostKey:['ssh-rsa']},readyTimeout:10000})});
try {
 const s=await new Promise((r,j)=>c.sftp((e,v)=>e?j(e):r(v)));
 report.installedFiles={};
 for (const [file,hash] of Object.entries(report.files)) {
  if(!file.startsWith('app/dist/assets/')&&!file.startsWith('service/'))continue;
  const remote=file.startsWith('app/')?'/media/developer/apps/usr/palm/applications/com.biliwebos.app/'+file.slice('app/dist/'.length):'/media/developer/apps/usr/palm/services/'+file.slice('service/'.length);
  const bytes=await new Promise((r,j)=>s.readFile(remote,(e,d)=>e?j(e):r(d)));
  const installed=createHash('sha256').update(bytes).digest('hex');report.installedFiles[file]={sha256:installed,match:installed===hash};
 }
 s.end();
}finally{c.end()}
const tv=await connectTv();
try{await tv.call('Debugger.enable');report.device=await tv.evaluate(`(async()=>{const d=await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('diag timeout')),10000);webOS.service.request('luna://com.biliwebos.app.service/',{method:'getDiagnostics',onSuccess:x=>{clearTimeout(t);r(x)},onFailure:()=>{clearTimeout(t);j(Error('diag failed'))}})});return {userAgent:navigator.userAgent,visible:document.visibilityState,node:d.nodeVersion,uptime:d.uptimeSec,loggedIn:d.loggedIn,castSubscribers:d.castSubscribers,danmakuSubscribers:d.danmakuSubscribers,danmakuActive:d.danmakuActive,scripts:[...document.scripts].map(s=>s.src.split('/').pop()).filter(Boolean),loadedBundles:performance.getEntriesByType('resource').map(r=>r.name.split('/').pop()).filter(n=>/^(index|PlayerPage|LivePlayerPage).*\\.js$/.test(n))}})()`);report.device.loadedBundles=[...tv.scripts]}finally{try{await tv.call('Debugger.disable')}finally{tv.close()}}
const expectedEntry=Object.keys(report.files).find(p=>/\/index-legacy-.*\.js$/.test(p))?.split('/').pop();
report.loadedEntryMatches=!!expectedEntry&&report.device.loadedBundles.includes(expectedEntry);
report.installedAt=new Date().toISOString();writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({installed:report.installedFiles,device:report.device}));
if(!report.loadedEntryMatches||Object.values(report.installedFiles).some(x=>!x.match))process.exitCode=1;
