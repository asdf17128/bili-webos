import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualitySwitchTrace } from './qualitySwitchTrace.js';
import { diagnosticReportText } from '../utils/diagnosticReport.js';

test('voucher rejection stays distinguishable from media failures and excludes content', async () => {
  let last; const trace = createQualitySwitchTrace(v => { last = v; }, { kind:'wbi', requested:126 });
  await trace.measure('url', () => ({code:0,data:{v_voucher:'SECRET'}}));
  trace.fail(new Error('SECRET'));
  const text=diagnosticReportText({qualitySwitch:last});
  assert.match(text,/quality-switch: state=failed kind=wbi stage=url/);
  assert.match(text,/reason=verification_required/);
  assert.match(text,/requested=126/); assert.doesNotMatch(text,/SECRET/);
});
test('decoder failure keeps stage, selected quality and numeric error without raw errors', async () => {
  let last; const trace=createQualitySwitchTrace(v=>{last=v;},{kind:'pgc',requested:126});
  await trace.measure('url',()=>({code:0,result:{dash:{video:[{baseUrl:'https://SECRET'}]}}}));
  trace.stage('selection');trace.media({id:126,frameRate:'60000/1001'}, {profile:5});
  try { await trace.measure('load',()=>{throw Object.assign(new Error('SECRET'),{code:3016,category:3})}); } catch(e){trace.fail(e)}
  const text=diagnosticReportText({qualitySwitch:last,service:{cookieKeys:['SESSDATA','PRIVATE','buvid3','_uuid']}});
  assert.match(text,/state=failed kind=pgc stage=load/);assert.match(text,/mediaCode=3016/);assert.match(text,/code=0/);
  assert.match(text,/selected=126/);assert.match(text,/profile=5/);
  assert.match(text,/buvid3=Y buvid4=N b_nut=N _uuid=Y buvid_fp=N/);
  assert.doesNotMatch(text,/SECRET|PRIVATE|SESSDATA|https/);
});
test('export ignores arbitrary switch fields and bounds numeric values',()=>{
 const text=diagnosticReportText({qualitySwitch:{kind:'SECRET',state:'SECRET',stage:'SECRET',requested:Infinity,profile:-1,mediaCode:99999999,url:'https://SECRET',error:'SECRET'}});
 assert.doesNotMatch(text,/SECRET|Infinity|99999999|https|profile=/);
});
