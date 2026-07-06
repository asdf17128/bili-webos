// Eval JS in the YouTube TV target. Usage: node tools/yteval.mjs '<expr>'
import { Client } from 'ssh2'; import { readFileSync } from 'fs'; import http from 'http'; import net from 'net'; import { WebSocket } from 'ws';
const EXPR=process.argv[2];
const c=new Client(); c.on('ready',()=>{const srv=net.createServer(s=>c.forwardOut('127.0.0.1',0,'127.0.0.1',9998,(e,rs)=>{if(e){s.end();return;}s.pipe(rs).pipe(s);}));srv.listen(0,'127.0.0.1',()=>{const port=srv.address().port;http.get('http://127.0.0.1:'+port+'/json',r=>{let d='';r.on('data',x=>d+=x);r.on('end',async()=>{const app=JSON.parse(d).find(p=>p.title&&p.title.toLowerCase().includes('youtube'));if(!app){console.log('no youtube');process.exit(1);}const ws=new WebSocket(app.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/,'127.0.0.1:'+port));let id=1;const call=(m,p)=>new Promise(res=>{const i=id++;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));const h=x=>{const mm=JSON.parse(x);if(mm.id===i){ws.off('message',h);res(mm.result);}};ws.on('message',h);});await new Promise(r=>ws.on('open',r));await call('Runtime.enable');
const ev=await call('Runtime.evaluate',{expression:EXPR,returnByValue:true,awaitPromise:true});
console.log(typeof (ev&&ev.result&&ev.result.value)==='string'?ev.result.value:JSON.stringify(ev&&ev.result&&ev.result.value));
if(ev&&ev.exceptionDetails) console.log('EXC:', JSON.stringify(ev.exceptionDetails).slice(0,200));
ws.close();srv.close();c.end();process.exit(0);});}).on('error',e=>{console.log('err',e.message);process.exit(1);});});});
c.connect({host:'192.168.50.94',port:9922,username:'prisoner',privateKey:readFileSync(process.env.HOME+'/.ssh/tv_webos'),passphrase:'4E7082',algorithms:{serverHostKey:['ssh-rsa']}});
