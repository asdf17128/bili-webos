import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { maskUrl, maskHeader, maskIndex, decodeMaskSegment, maskFrame, MASK_LIMITS } from '../app/src/player/danmakuMask.js';
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
const frame=(time,svg='<svg xmlns="http://www.w3.org/2000/svg"/>')=>{
 const body=Buffer.from('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')+'\n');const h=Buffer.alloc(12);h.writeUInt32BE(body.length);h.writeBigUInt64BE(BigInt(time),4);return Buffer.concat([h,body]);
};
test('mask URLs are restricted to HTTPS Bilibili mask resources',()=>{
 assert.ok(maskUrl('//upos-sz-staticcos-cmask.bilivideo.com/cmaskboss/123_25_2.webmask?x=1'));
 for(const s of ['http://a.bilivideo.com/cmaskboss/a.webmask','https://bilivideo.com.evil.test/cmaskboss/a.webmask','https://user@a.bilivideo.com/cmaskboss/a.webmask','https://a.bilivideo.com:99/cmaskboss/a.webmask','https://a.bilivideo.com/other/a.webmask'])assert.equal(maskUrl(s),null);
});
test('index checks magic, version, lengths, ordering and integer limits',()=>{
 const h=Buffer.alloc(48);h.write('MASK');h.writeUInt32BE(1,4);h.writeUInt32BE(2,12);h.writeBigUInt64BE(48n,24);h.writeBigUInt64BE(10000n,32);h.writeBigUInt64BE(100n,40);
 assert.equal(maskHeader(h),48);assert.equal(maskIndex(h).length,2);
 assert.throws(()=>maskIndex(h.subarray(0,40)));h.writeBigUInt64BE(47n,40);assert.throws(()=>maskIndex(h));h[0]=0;assert.throws(()=>maskHeader(h));
});
test('gzip frame boundaries, repeated timestamps, exact frame selection and stale expiry',()=>{
 const frames=decodeMaskSegment(gzipSync(Buffer.concat([frame(0),frame(0),frame(100)])),0,10000);
 assert.equal(frames.length,3);assert.equal(maskFrame(frames,0),frames[1]);assert.equal(maskFrame(frames,120),frames[2]);assert.equal(maskFrame(frames,351),null);
 assert.throws(()=>decodeMaskSegment(gzipSync(Buffer.concat([frame(100),frame(0)])),0,10000));
 assert.throws(()=>decodeMaskSegment(gzipSync(frame(10000)),0,10000));
 assert.throws(()=>decodeMaskSegment(new Uint8Array([1,2,3]),0,10000));
});
test('compressed and decompressed payload budgets prevent oversized work',()=>{
 assert.throws(()=>decodeMaskSegment(new Uint8Array(MASK_LIMITS.compressed+1),0,10000));
 assert.throws(()=>decodeMaskSegment(gzipSync(Buffer.alloc(MASK_LIMITS.inflated+1)),0,10000),/inflated limit/);
 assert.throws(()=>decodeMaskSegment(gzipSync(Buffer.concat(Array.from({length:601},()=>frame(0)))),0,10000),/frame limit/);
});
for(const path of process.argv.slice(2))test('real mask file '+path,()=>{
 const b=new Uint8Array(readFileSync(path)),idx=maskIndex(b.subarray(0,maskHeader(b)));let count=0;
 idx.forEach((x,i)=>{count+=decodeMaskSegment(b.subarray(x.offset,idx[i+1]?.offset),x.time,idx[i+1]?.time||Infinity).length;});assert.ok(count>100);console.log('segments',idx.length,'frames',count);
});
console.log(passed+'/'+passed+' passed');
