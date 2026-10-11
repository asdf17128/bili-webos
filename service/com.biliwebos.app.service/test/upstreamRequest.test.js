const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const upstream = require('../upstreamRequest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fixture(t, handler) {
  let count = 0;
  const sockets = new Set();
  const server = http.createServer((req,res) => handler(req,res,++count));
  server.on('connection', s => { sockets.add(s); s.on('close',()=>sockets.delete(s)); });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const agent = new http.Agent({keepAlive:true});
  t.after(async()=>{agent.destroy();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
  return { options:{hostname:'127.0.0.1',port:server.address().port,agent}, count:()=>count };
}
function fetch(options, body, ms=500, requests=[]) {
  return new Promise(resolve => upstream((opts,cb)=>{requests.push(opts);return http.request(opts,cb);},options,body,(error,res)=>{
    if(error)return resolve({error});
    let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,data}));
    res.on('error',error=>resolve({error,headers:true}));
  },ms));
}

test('positive control: a peer reset fails a plain GET',async t=>{
  const f=await fixture(t,req=>req.socket.destroy());
  const error=await new Promise(resolve=>http.get(f.options,()=>assert.fail('headers')).on('error',resolve));
  assert.equal(error.code,'ECONNRESET');assert.equal(f.count(),1);
});
test('GET retries once on a fresh connection after reset before headers',async t=>{
  const f=await fixture(t,(req,res,n)=>n===1?req.socket.destroy():res.end('recovered'));
  const calls=[];assert.deepEqual(await fetch(f.options,null,500,calls),{status:200,data:'recovered'});
  assert.equal(f.count(),2);assert.equal(calls[0].agent,f.options.agent);assert.equal(calls[1].agent,false);
});
test('HEAD also retries a reset and a second reset is final',async t=>{
  const f=await fixture(t,req=>req.socket.destroy());
  const result=await fetch({...f.options,method:'HEAD'});
  assert.equal(result.error.code,'ECONNRESET');assert.equal(f.count(),2);
});
test('POST is never replayed, including an empty body',async t=>{
  const f=await fixture(t,req=>req.socket.destroy());
  for(const body of [null,'action=follow']) {
    const before=f.count();const result=await fetch({...f.options,method:'POST'},body);
    assert.equal(result.error.code,'ECONNRESET');assert.equal(f.count()-before,1);
  }
});
test('GET with a body is never replayed',async t=>{
  const f=await fixture(t,req=>req.socket.destroy());
  assert.equal((await fetch(f.options,'payload')).error.code,'ECONNRESET');assert.equal(f.count(),1);
});
test('HTTP errors are returned without retry',async t=>{
  const f=await fixture(t,(_req,res)=>{res.statusCode=503;res.end('busy');});
  assert.deepEqual(await fetch(f.options),{status:503,data:'busy'});assert.equal(f.count(),1);
});
test('a truncated response after headers is never replayed',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Length':100});res.write('part');setTimeout(()=>res.destroy(),20);});
  const result=await fetch(f.options);assert.equal(result.headers,true);assert.equal(result.error.code,'ECONNRESET');assert.equal(f.count(),1);
});
test('retry shares the original response-header deadline',async t=>{
  const f=await fixture(t,(req,_res,n)=>{if(n===1)setTimeout(()=>req.socket.destroy(),150);});
  const started=Date.now();const result=await fetch(f.options,null,250);
  const elapsed=Date.now()-started;
  assert.equal(result.error.code,'ETIMEDOUT');assert.equal(f.count(),2);
  assert.ok(elapsed>=220 && elapsed<370,`elapsed ${elapsed}ms; a new 250ms budget would reach 400ms`);
});
test('cancel follows the active retry and suppresses later callbacks',async t=>{
  let retryStarted;
  const ready=new Promise(r=>retryStarted=r);
  const f=await fixture(t,(req,_res,n)=>n===1?req.socket.destroy():retryStarted(req.socket));
  let callbacks=0;const handle=upstream(http.request,f.options,null,()=>callbacks++,100);
  const socket=await ready;handle.cancel();await sleep(160);
  assert.equal(callbacks,0);assert.equal(f.count(),2);assert.ok(socket.destroyed);
});
