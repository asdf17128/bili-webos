import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePgcPlayurl } from './pgcPlayurl.js';
import { describePlayResponse } from '../utils/diagnosticReport.js';
test('PGC v2 exposes ladder and quality metadata without mutating response',()=>{
 const input={code:0,result:{video_info:{quality:126,accept_quality:[126,120],dash:{video:[{baseUrl:'https://fixture.invalid'}]}}}};
 const result=normalizePgcPlayurl(input);
 assert.equal(result.result.quality,126);assert.deepEqual(result.result.accept_quality,[126,120]);
 assert.equal(describePlayResponse(result).hasStream,true);assert.equal(input.result.quality,undefined);
});
test('PGC v2 preserves refusal and voucher rather than turning them into success',()=>{
 for(const code of [-351,-10403,-403])assert.equal(normalizePgcPlayurl({code,result:{video_info:{}}}).code,code);
 for(const result of [{video_info:{v_voucher:'secret'}},{v_voucher:'secret',video_info:{}}])assert.equal(describePlayResponse(normalizePgcPlayurl({code:0,result})).reason,'verification_required');
 const old={code:0,result:{quality:80}};assert.equal(normalizePgcPlayurl(old),old);
 assert.equal(normalizePgcPlayurl(null),null);
});
