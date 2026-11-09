import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./deviceEnvironment.js',import.meta.url),'utf8').replace('export function','function');
for(const mode of ['missing','throwing','no-zone','modern'])test('device environment survives '+mode+' Intl',()=>{
 const context={navigator:{userAgent:'TV',platform:'Linux',language:'zh-CN'},screen:{width:1920,height:1080,availWidth:1920,availHeight:1080,colorDepth:24},Intl:undefined};
 if(mode==='throwing')context.Intl={DateTimeFormat(){throw Error('unavailable')}};
 if(mode==='no-zone')context.Intl={DateTimeFormat(){return {resolvedOptions(){return {}}}}};
 if(mode==='modern'){context.navigator.hardwareConcurrency=4;context.Intl={DateTimeFormat(){return {resolvedOptions(){return {timeZone:'Asia/Shanghai'}}}}};}
 const result=vm.runInNewContext(source+';deviceEnvironment()',context);
 assert.equal(result.ua,'TV');assert.equal(result.width,1920);
 assert.equal(result.timezone,mode==='modern'?'Asia/Shanghai':undefined);
 assert.equal(result.cores,mode==='modern'?4:undefined);
});
