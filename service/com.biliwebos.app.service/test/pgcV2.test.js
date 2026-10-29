var test=require('node:test'),assert=require('node:assert/strict');
var body=require('../playurlBody'),diagnostics=require('../playbackDiagnostics');
test('PGC v2 service records nested streams and preserves envelope vouchers',function(){
 var d=diagnostics(),row=d.begin(new URL('https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=301087&qn=127'),false);
 d.response(row,200,Buffer.from(JSON.stringify({code:0,result:{video_info:{dash:{video:[{}]}}}})),null,Date.now());
 assert.equal(row.kind,'pgc_v2');assert.equal(row.outcome,'ok');
 assert.equal(body({result:{v_voucher:'secret',video_info:{}}}).v_voucher,'secret');
 d.response(row,200,Buffer.from(JSON.stringify({code:0,result:{video_info:{v_voucher:'secret'}}})),null,Date.now());
 assert.equal(row.outcome,'failed');assert.equal(row.attempts[1].voucher,true);
 assert.doesNotMatch(JSON.stringify(d.snapshot()),/secret/);
});
