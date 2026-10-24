import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticContextLines, diagnosticReportText } from '../utils/diagnosticReport.js';
test('report includes failure and recovery without arbitrary fields', () => {
 const result=diagnosticContextLines({loggedIn:true,identity:{pending:false,cooldownSec:12},playback:{lastFailure:{kind:'wbi',at:1000,bvid:'BV1xx411c7mD',qn:127,secret:'PRIVATE',attempts:[{http:200,code:-352,voucher:true,stream:false,ms:56},{http:200,code:0,stream:true,ms:27}],recovery:'retried',outcome:'ok'}}},2000).join('\n');
 assert.match(result,/code=-352/); assert.match(result,/final=ok/); assert.match(result,/age=1s/); assert.ok(!result.includes('PRIVATE'));
});
test('allowlisted export excludes content, credentials and arbitrary recovery strings', () => {
 const report=diagnosticReportText({service:{loggedIn:true,playback:{lastFailure:{kind:'PRIVATE',bvid:'BV1xx411c7mD',cid:12345,recovery:'SECRET',outcome:'SECRET',attempts:[{error:'SECRET',code:-352,url:'https://secret.test/?token=SECRET'}]}}}});
 assert.doesNotMatch(report,/PRIVATE|SECRET|BV1|12345|https:/);
 assert.match(report,/code=-352/);
 assert.deepEqual(diagnosticContextLines(null),[]);
 assert.deepEqual(diagnosticContextLines({}),[]);
});
