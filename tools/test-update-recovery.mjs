// Real production client; controlled Luna responses, no account or network.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../app/package.json',import.meta.url));
const {build}=require('esbuild');
const bundle=await build({entryPoints:[new URL('../app/src/api/client.js',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'client',platform:'browser',target:'es2016',define:{'import.meta.env.DEV':'false'}});
const output=process.env.UPDATE_TEST_OUTPUT||'/tmp/bili-update-recovery';mkdirSync(output,{recursive:true});const results=[];
const ok=version=>({returnValue:true,status:200,body:JSON.stringify({version})});
const api=()=>({returnValue:true,status:200,body:JSON.stringify({tag_name:'v2.4.0'})});
function fixture(responses){
 const values=new Map(),calls=[],delays=[],handles=[];
 const sandbox={console,URL,URLSearchParams,atob:s=>Buffer.from(s,'base64').toString('binary'),navigator:{userAgent:'SmartTV test'},
  setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms/1000)},clearTimeout,
  localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},addEventListener(){},removeEventListener(){},PalmServiceBridge:function(){},
  webOS:{service:{request(uri,opts){calls.push(opts.parameters);const handle={cancelCalls:0,cancel(){this.cancelCalls++}};handles.push(handle);const response=responses[calls.length-1];queueMicrotask(()=>{if(response==='timeout')return;if(response?.failure)opts.onFailure({errorText:response.failure});else opts.onSuccess(response||{returnValue:false,status:503})});return handle;}}}};
 sandbox.window=sandbox;const context=vm.createContext(sandbox);vm.runInContext(bundle.outputFiles[0].text,context);
 return {get:()=>context.client.getLatestVersion(),calls,delays,handles};
}
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name)}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message)}}
await test('valid asset succeeds without a fallback',async()=>{const f=fixture([ok('v2.4.0')]);assert.equal(await f.get(),'2.4.0');assert.equal(f.calls.length,1)});
await test('octet-stream asset is decoded',async()=>{const f=fixture([{returnValue:true,status:200,bodyBase64:Buffer.from('{"version":"2.4.0"}').toString('base64')}]);assert.equal(await f.get(),'2.4.0')});
for(const [name,response]of [['HTML gateway response',{returnValue:true,status:502,body:'<html>gateway</html>'}],['invalid JSON',{returnValue:true,status:200,body:'{invalid'}],['null JSON',{returnValue:true,status:200,body:'null'}],['invalid version',ok('not-a-version')],['transport reset',{failure:'ECONNRESET'}]])await test(name+' falls back once to independent release API',async()=>{const f=fixture([response,api()]);assert.equal(await f.get(),'2.4.0');assert.equal(f.calls.length,2);assert.equal(new URL(f.calls[1].url).host,'api.github.com');assert.ok(f.calls.every(x=>!x.body&&!x.cookie&&!x.headers));});
await test('both failed sources reject instead of claiming latest',async()=>{const f=fixture([{returnValue:true,status:503,body:'unavailable'},{returnValue:true,status:403,body:'{}'}]);await assert.rejects(f.get());assert.equal(f.calls.length,2)});
await test('hung source is cancelled; fallback succeeds within bounded configured deadlines',async()=>{const f=fixture(['timeout',api()]);assert.equal(await f.get(),'2.4.0');assert.equal(f.handles[0].cancelCalls,1);assert.equal(f.calls.length,2);assert.ok(f.delays.reduce((a,b)=>a+b,0)<=14000)});
await test('both hung sources cancel and stop after two deadlines',async()=>{const f=fixture(['timeout','timeout']);await assert.rejects(f.get());assert.equal(f.calls.length,2);assert.ok(f.handles.every(h=>h.cancelCalls===1));assert.equal(f.delays.reduce((a,b)=>a+b,0),14000)});
writeFileSync(output+'/results.json',JSON.stringify({results,limits:'Luna boundary fixture; deadline values checked with accelerated timer, not real elapsed network time.'},null,2));process.exitCode=results.some(x=>!x.pass)?1:0;
