// Offline contract/privacy tests for the Python home-network probe worker.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const server=createServer((req,res)=>{
 if(req.url.startsWith('/trace'))return res.end('ip=192.0.2.123\nloc=PH\n');
 if(req.url.startsWith('/api')){res.writeHead(412,{'content-type':'application/json'});return res.end('{"code":-352}');}
 if(req.url.startsWith('/denied')){res.writeHead(403);return res.end('private-signature');}
 res.writeHead(206,{'content-range':req.url.startsWith('/wrong')?'bytes 32-63/1000':'bytes 0-31/1000','content-length':'32'});
 if(req.url.startsWith('/stall')){res.flushHeaders();return;}
 res.end(Buffer.alloc(32,7));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const worker=spawn('python3',['-u','tools/probe-region.py'],{stdio:['pipe','pipe','inherit']});
let pending;
const lines=createInterface({input:worker.stdout});
lines.on('line',line=>{const p=pending;pending=null;clearTimeout(p.timer);p.resolve(JSON.parse(line))});
const job=request=>new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>reject(new Error('Worker timeout')),3000)};worker.stdin.write(JSON.stringify(request)+'\n')});
const base='http://127.0.0.1:'+server.address().port;
const results=[];
try {
 const range=await job({op:'range',url:base+'/ok?upsig=private-signature',start:0,end:31});
 assert.equal(range.value.bytes,32);assert.equal(range.value.total,1000);assert.match(range.value.sha256,/^[a-f0-9]{64}$/);results.push(range);
 for(const [path,error] of [['denied','HTTPError'],['wrong','ValueError'],['stall','TimeoutError']]){
  const r=await job({op:'range',url:base+'/'+path+'?upsig=private-signature',start:0,end:31,timeoutMs:150});
  assert.equal(r.error,error);if(path==='denied')assert.equal(r.status,403);results.push(r);
 }
 const api=await job({op:'api',url:base+'/api'});assert.equal(api.value.code,-352);assert.equal(api.value.status,412);results.push(api);
 const trace=await job({op:'location',url:base+'/trace'});assert.equal(trace.value.loc,'PH');assert.equal(typeof trace.value.proxyConfigured,'boolean');results.push(trace);
 const dns=await job({op:'dns',host:'localhost'});assert.ok(dns.value.addresses.length);results.push(dns);
 assert.doesNotMatch(JSON.stringify(results),/private-signature|upsig|192\.0\.2\.123/);
 console.log('PASS local probe: exact Range, HTTP 403, bad Range, stalled-body deadline, API error, IP redaction, system DNS');
} finally {
 if(pending)clearTimeout(pending.timer);worker.stdin.end();worker.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
}
