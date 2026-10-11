const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const deadline = require('../requestDeadline');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pendingDns() {
  const req = http.request({hostname:'pending.invalid',lookup(){}},()=>assert.fail('unexpected response'));
  req.on('error',()=>{});req.end();return req;
}
test('positive control: socket timeout does not bound a pending DNS lookup',async()=>{
  const req=pendingDns();let timedOut=false;
  req.setTimeout(30,()=>{timedOut=true;});
  await sleep(100);assert.equal(timedOut,false);req.destroy();
});
test('deadline bounds pending DNS and settles exactly once',async()=>{
  const req=pendingDns();const errors=[];
  const guard=deadline(req,e=>errors.push(e),30);
  await sleep(100);
  assert.equal(errors.length,1);assert.equal(errors[0].code,'ETIMEDOUT');assert.ok(req.destroyed);
  assert.equal(guard.headers(),false);req.emit('error',new Error('late'));assert.equal(errors.length,1);
});
test('deadline frees a request queued behind a full connection pool',async()=>{
  const server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const agent=new http.Agent({keepAlive:true,maxSockets:1});
  const opts={hostname:'127.0.0.1',port:server.address().port,agent};
  const first=http.get(opts);first.on('error',()=>{});
  const second=http.get(opts);const errors=[];deadline(second,e=>errors.push(e),30);
  try {await sleep(100);assert.equal(errors.length,1);assert.ok(second.destroyed);assert.equal(second.socket,null);}
  finally {first.destroy();second.destroy();agent.destroy();await new Promise(r=>server.close(r));}
});
test('headers clear total deadline while socket timeout still destroys a stalled body',async()=>{
  const req=new EventEmitter();req.setTimeout=(ms,fn)=>req.stall=fn;let destroys=0;req.destroy=()=>destroys++;
  const errors=[];const guard=deadline(req,e=>errors.push(e),30);
  assert.equal(guard.headers(),true);guard.cancel();await sleep(60);assert.equal(destroys,0);
  req.stall();assert.equal(destroys,1);assert.deepEqual(errors,[]);
});
test('explicit cancellation clears deadline and rejects late headers without callback',async()=>{
  const req=pendingDns();const errors=[];const guard=deadline(req,e=>errors.push(e),30);
  guard.cancel();await sleep(80);assert.ok(req.destroyed);assert.deepEqual(errors,[]);assert.equal(guard.headers(),false);
});
test('early network error settles once and clears deadline',async()=>{
  const req=new EventEmitter();req.setTimeout=()=>{};let destroyed=0;req.destroy=()=>destroyed++;
  const errors=[];deadline(req,e=>errors.push(e),30);req.emit('error',new Error('EAI_AGAIN'));
  await sleep(60);assert.equal(errors.length,1);assert.equal(destroyed,0);
});
