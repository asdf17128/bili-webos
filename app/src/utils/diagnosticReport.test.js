import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlayResponse, diagnosticError, buildDiagnosticReport, diagnosticReportText, diagnosticIssueUrl, DIAGNOSTIC_STAGES } from './diagnosticReport.js';
import { createStartupTrace } from '../player/startupTrace.js';

const secret = 'PRIVATE_USER_93 SESSDATA=cookie-secret token=signed-secret 192.168.7.18 2001:db8::12 BV1privateTitle';
const mediaUrl = 'https://192.168.7.18/watch/BV1privateTitle?token=signed-secret';
const base = { version: '2.4.0', chromeMajor: 120, nodeVersion: 'v16.20.2', platform: 'tv', route: 'auto' };

test('regression #50/#51/#52: -351/-352 remain machine-readable, not a lone B', () => {
  for (const code of [-351, -352]) {
    const response = describePlayResponse({code, message: 'B站 风控校验未通过 ' + secret});
    const input = {...base, checks: [{stage:'playurl', ...response, ms:80}]};
    const text = diagnosticReportText(input);
    assert.match(text, new RegExp('\\[fail\\] playurl code=' + code));
    assert.match(text, /hasStream=no/);
    assert.doesNotMatch(text, /PRIVATE|cookie|token|192\.168|BV1private/);
    assert.equal(new URL(diagnosticIssueUrl(input)).searchParams.get('body'), text);
    const legacy = String('B站 风控校验未通过').replace(/[^\x20-\x7e]/g, '').trim();
    assert.equal(legacy, 'B', 'old ASCII filtering demonstrably loses the code');
  }
});

test('code zero requires a usable stream; vouchers are booleans, not exported values', () => {
  for (const data of [{}, {v_voucher: secret}, {dash:{video:[{}]}}, {dash:{video:[{baseUrl:''}]}}]) {
    const state = describePlayResponse({code:0,data});
    assert.equal(state.status,'fail'); assert.equal(state.hasStream,false);
    assert.equal(state.reason, data.v_voucher ? 'verification_required' : 'no_stream');
    assert.ok(!JSON.stringify(state).includes(secret));
  }
  for (const data of [{dash:{video:[{baseUrl:mediaUrl}]}}, {dash:{video:[{base_url:mediaUrl}]}}, {durl:[{url:mediaUrl}]}]) {
    for (const wrapper of ['data','result']) {
      const state = describePlayResponse({code:0,[wrapper]:data});
      assert.equal(state.status,'ok'); assert.equal(state.hasStream,true);
      assert.ok(!JSON.stringify(state).includes('private'));
    }
  }
  assert.equal(describePlayResponse({code:0,data:{dash:{video:'not-an-array'}}}).status,'fail');
  assert.equal(describePlayResponse(null).reason,'invalid_response');
  assert.equal(describePlayResponse({code:0.1,data:{durl:[{url:mediaUrl}]}}).reason,'invalid_response');
});

test('allowlist removes all free-form fields, including known-looking keys in raw errors', () => {
  const input = {...base, account:secret, ip:secret, cookies:secret, deviceId:secret, url:mediaUrl,
    checks:[{stage:'api',status:'ok',code:0,detail:secret,uname:secret},{stage:secret,status:'ok'},{stage:'cdn',status:secret,reason:secret,code:secret}],
    startup:{state:'failed',elapsedMs:170,retries:2,hosts:{request:secret},points:{content:secret},stages:{url:{ms:80,count:1,code:-351,hasStream:false,voucher:true,detail:secret,reason:secret},[secret]:{code:0}}},
    errors:[{tag:secret,d:'HTTP 403 '+secret,stack:secret},{code:secret,d:secret}]};
  const report = buildDiagnosticReport(input), text = diagnosticReportText(input);
  assert.deepEqual(report.checks.map(r=>r.stage),['api','cdn']);
  assert.match(text,/startup failed ms=170 retries=2/);
  assert.match(text,/stage url code=-351 hasStream=no voucher=yes ms=80 attempts=1/);
  assert.match(text,/error code=403 reason=http/);
  assert.doesNotMatch(text,/PRIVATE|SESSDATA|signed-secret|192\.168|2001:|BV1|https?:|account|deviceId|cookie|token|uname|host=/);
  assert.match(text,/^[\x20-\x7e\n]*$/);
});

test('malformed types, non-finite values, overlong fields and unexpected versions stay bounded', () => {
  const huge = secret.repeat(10000);
  const text = diagnosticReportText({version:huge,nodeVersion:huge,chromeMajor:Infinity,platform:huge,route:huge,
    checks: DIAGNOSTIC_STAGES.map(stage=>({stage,status:'fail',code:-352,reason:'verification_required',hasStream:false,voucher:true,ms:3600000,retries:9999,attempts:9999,errors:9999,detail:huge})),
    startup:{state:'failed',elapsedMs:3600000,retries:9999,stages:Object.fromEntries(['engine','attach','view','resume','url','probe','load'].map(k=>[k,{ms:3600000,count:9999,errors:9999,retries:9999,code:-352,hasStream:false,voucher:true,reason:'verification_required'}]))},
    errors:Array(1000).fill({d:huge})});
  assert.ok(text.length<=1800); assert.match(text,/truncated=1/); assert.doesNotMatch(text,/PRIVATE|Infinity/);
  assert.deepEqual(buildDiagnosticReport({checks:[{stage:'svc',status:'fail',code:'123',ms:-1,retries:Infinity,attempts:10000,errors:NaN}]}).checks,[{stage:'svc',status:'fail'}]);
  assert.equal(buildDiagnosticReport({version:'192.168.7.18',nodeVersion:mediaUrl,chromeMajor:huge}).version,'?');
});

test('exception categorization exports only safe codes and categories', () => {
  assert.deepEqual(diagnosticError({code:'ECONNRESET',message:secret}),{code:'ECONNRESET',reason:'network'});
  assert.deepEqual(diagnosticError({message:'Upstream timeout '+secret}),{code:null,reason:'timeout'});
  assert.deepEqual(diagnosticError({message:'Failed to fetch '+secret}),{code:null,reason:'network'});
  assert.deepEqual(diagnosticError({code:secret,message:secret}),{code:null,reason:'unknown'});
});

test('compile-time candidate version is retained without accepting free-form runtime strings', () => {
  const input = {...base,version:'2.4.0 c9-test.1',nodeVersion:'16.20.2 PRIVATE_USER_93'};
  assert.match(diagnosticReportText(input),/^diag=1 app=2.4.0 c9-test.1\n/);
  assert.equal(new URL(diagnosticIssueUrl(input)).searchParams.get('title'),'[diag] v2.4.0 c9-test.1');
  assert.equal(buildDiagnosticReport(input).environment.node,'?');
});

test('startup trace observes API failures without changing playback return values or retrying', async () => {
  let latest, calls=0;
  const trace = createStartupTrace(value=>{latest=value;});
  const response={code:0,data:{v_voucher:secret},message:secret};
  assert.equal(await trace.measure('url',()=>{calls++;return response;}),response);
  assert.equal(calls,1); assert.equal(latest.stages.url.code,0); assert.equal(latest.stages.url.errors,1);
  assert.equal(latest.stages.url.hasStream,false); assert.equal(latest.stages.url.voucher,true);
  assert.doesNotMatch(JSON.stringify(latest),/PRIVATE|cookie|signed-secret/);
  trace.dispose(); const saved=latest;
  await trace.measure('url',()=>({code:-352})); assert.deepEqual(latest,saved);
});
