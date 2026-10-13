import test from 'node:test';
import assert from 'node:assert/strict';
import { createDolbyRuntime } from './dolbyRuntime.js';
import { createTargetDolby120Session, createDolbyTransformFailure } from './dolby120Transform.js';
import { TARGET_DOLBY_120_SOURCE as source, TARGET_DOLBY_120_SIDX_HEX } from './dolbyTimingPatch.js';
const rep={id:126,codecs:source.codec,width:3840,height:2160,frameRate:'120',baseUrl:'https://media.bilivideo.com/upgcxcode/target.m4s',SegmentBase:{Initialization:'0-1037',indexRange:'1038-1497'}};
const session=()=>createTargetDolby120Session(source,source.cid,rep);
const request=(range,proxied=false)=>({uris:[proxied?'http://127.0.0.1:7655/proxy/media.bilivideo.com/upgcxcode/target.m4s':rep.baseUrl],headers:{Range:'bytes='+range}});
const indexBytes=()=>Uint8Array.from(Buffer.from(TARGET_DOLBY_120_SIDX_HEX,'hex')).buffer;
function index(runtime,proxied=false){const ctx={};runtime.request(1,request('1038-1497',proxied),ctx);runtime.response(1,{data:indexBytes()},ctx)}
test('normal media remains byte-identical and never triggers transform recovery',()=>{
 const runtime=createDolbyRuntime();runtime.begin(null);const ctx={stream:{type:'video',originalId:'126'}},data=new Uint8Array([1,2,3]);
 runtime.request(1,request('0-2'),ctx);const response={data};runtime.response(1,response,ctx);assert.equal(response.data,data);assert.equal(runtime.handleError({category:3,code:3016}),false);
});
test('validated index required, including requests already rewritten through another local port',()=>{
 const runtime=createDolbyRuntime(),epoch=runtime.begin(session());
 assert.throws(()=>runtime.ready(epoch,()=>{}),/without-validated-index/);index(runtime,true);
 runtime.ready(epoch,()=>{});assert.equal(runtime.snapshot().phase,'playing');
});
test('wrong ranges, missing context and corrupted index fail closed',()=>{
 const runtime=createDolbyRuntime();runtime.begin(session());
 const ctx={stream:{type:'video',originalId:'126'},type:1,segment:{}};
 runtime.request(1,request('1-2'),ctx);assert.throws(()=>runtime.response(1,{data:new ArrayBuffer(2)},ctx),/unbound/);
 const ic={};runtime.request(1,request('1038-1497'),ic);assert.throws(()=>runtime.response(1,{data:new ArrayBuffer(460)},ic),/fingerprint/);
});
test('late transformed responses cannot enter a new stream',()=>{
 const runtime=createDolbyRuntime();runtime.begin(session());const ctx={};runtime.request(1,request('1038-1497'),ctx);
 runtime.begin(null);assert.throws(()=>runtime.response(1,{data:indexBytes()},ctx),/stale-transform-response/);
});
test('runtime transform/media/stall failure queues one fallback and changing video cancels queued work',async()=>{
 for(const error of [null,{category:3,code:3016},createDolbyTransformFailure('bad-rpu',1)]){
  const runtime=createDolbyRuntime();const epoch=runtime.begin(session());index(runtime);let calls=0;
  runtime.ready(epoch,()=>calls++);if(error)assert.equal(runtime.handleError(error),true);else assert.equal(runtime.stalled(),true);
  runtime.stalled();await Promise.resolve();assert.equal(calls,1);
 }
 const runtime=createDolbyRuntime(),epoch=runtime.begin(session());index(runtime);let calls=0;
 runtime.ready(epoch,()=>calls++);runtime.stalled();runtime.begin(null);await Promise.resolve();assert.equal(calls,0);
});
test('load-time transform failures never trigger generic media retries or a stale runtime fallback',()=>{
 const runtime=createDolbyRuntime(),epoch=runtime.begin(session());
 assert.equal(runtime.handleError(createDolbyTransformFailure('bad-init',epoch)),true);
 assert.equal(runtime.snapshot().phase,'loading');
 assert.equal(runtime.handleError({category:1,code:1001}),false);
});
