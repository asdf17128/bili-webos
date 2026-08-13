import { Client } from 'ssh2'; import { readFileSync, writeFileSync } from 'fs'; import http from 'http'; import net from 'net'; import { WebSocket } from 'ws';
import { tvPassphrase } from './_tvpass.mjs';
const c=new Client(); c.on('ready',()=>{const srv=net.createServer(s=>c.forwardOut('127.0.0.1',0,'127.0.0.1',9998,(e,rs)=>{if(e){s.end();return;}s.pipe(rs).pipe(s);}));srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;http.get(`http://127.0.0.1:${port}/json`,r=>{let d='';r.on('data',x=>d+=x);r.on('end',async()=>{const app=JSON.parse(d).find(p=>p.title&&p.title.includes('哔哩'));const ws=new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/,`127.0.0.1:${port}`));let id=1;const call=(m,p)=>new Promise(res=>{const i=id++;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));const h=x=>{const mm=JSON.parse(x);if(mm.id===i){ws.off('message',h);res(mm.result);}};ws.on('message',h);});
const key=async(k,code)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:code});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:code});};
const evalJs=async(e)=>{const r=await call('Runtime.evaluate',{expression:e,returnByValue:true});return r&&r.result&&r.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await new Promise(r=>ws.on('open',r));
await key('ArrowRight',39); await sleep(600); // into grid
await key('Enter',13);
for(let i=0;i<20;i++){ await sleep(1000); const ok=await evalJs("(function(){var v=document.querySelector('video');return v&&v.currentTime>1;})()"); if(ok) break; }
await sleep(1000);
for(let i=0;i<4;i++){ await key('ArrowRight',39); await sleep(180); }
const shot=await call('Page.captureScreenshot',{format:'png'});
if(shot&&shot.data){writeFileSync('bubble_v126.png',Buffer.from(shot.data,'base64'));console.log('saved');}
await sleep(1400);
ws.close();srv.close();c.end();process.exit(0);
});}).on('error',e=>{console.log('err',e.message);process.exit(1);});});});
c.connect({host:'192.168.50.94',port:9922,username:'prisoner',privateKey:readFileSync(process.env.HOME+'/.ssh/tv_webos'),passphrase: tvPassphrase(),algorithms:{serverHostKey:['ssh-rsa']}});
