import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticContextLines, redactDiagnosticText } from '../utils/diagnosticReport.js';
test('report includes failure and recovery without arbitrary fields', () => {
 const result=diagnosticContextLines({loggedIn:true,identity:{pending:false,cooldownSec:12},playback:{lastFailure:{kind:'wbi',at:1000,bvid:'BV1xx411c7mD',qn:127,secret:'PRIVATE',attempts:[{http:200,code:-352,voucher:true,stream:false,ms:56},{http:200,code:0,stream:true,ms:27}],recovery:'retried',outcome:'ok'}}},2000).join('\n');
 assert.match(result,/code=-352/); assert.match(result,/final=ok/); assert.match(result,/age=1s/); assert.ok(!result.includes('PRIVATE'));
});
test('redaction precedes truncation and supports older services', () => {
 assert.equal(redactDiagnosticText('failed https://a.example/v?token=SECRET SESSDATA=SECRET v_voucher=SECRET'), 'failed [url] [private] [private]');
 assert.deepEqual(diagnosticContextLines(null),[]);
 assert.deepEqual(diagnosticContextLines({}),['session: login=N']);
});
